import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
  system, world, BOT_TYPE, MAX_TARGET_DISTANCE,
  CommandPermissionLevel, CustomCommandStatus,
  PATCH_MANAGED_STACK_ITEM_IDS, PATCH_DEFAULT_COMBAT_ITEM_COUNTS,
  OBSIDIAN_ID, END_CRYSTAL_ID, RESPAWN_ANCHOR_ID, GLOWSTONE_ID,
  ENDER_PEARL_ID, TOTEM_ID, PATCH_ENCHANTED_GOLDEN_APPLE_ID,
  PATCH_GOLDEN_APPLE_ID, PATCH_SUPPLY_CHEST_VIEW_DISTANCE,
} from "./constants.js";
import { globalSettings, setGlobalSettings, pendingSpawnRequests } from "./state.js";
import {
  getAllPlayers, getBotUid, getBotLabel, getNearbyBots,
  isEntityUsable, getSpawnLocationNear, addVector, floorLocation,
  distance, formatError, logSystem, appendPersistentDebugLog,
  dumpPersistentDebugLog, clearPersistentDebugLog,
  toDimensionKey, fromDimensionKey, getEquippableComponent,
  isSafeStandingLocation, isLocationOccupiedByPlayer, getAllBots,
  shortId, formatLocation, summarizeNearbyPlayers, summarizeNearbyBots,
  describeBlockContext, updateTrackedBotMeta, logBotEvent,
  scheduleBotProbe, matchPendingSpawnRequest, getPlayerByName,
  patchRunDimensionCommandNoThrow, quoteCoord,
} from "./utils.js";
import {
  getRuntime, materializeConfig, persistBotConfig, writeConfigTags,
  normalizeGlobalSettings, loadGlobalSettings, saveGlobalSettings,
  loadConfigs, saveConfigs,
  patchApplyDifficultyPreset, patchGetDifficultyLabel, getDefaultBotDisplayName,
} from "./config.js";
import {
  ensureBotInitialized, ensureBotEquipmentIntegrity,
  syncBotLoadout, hasSupplyChest, getBlockInventoryContainer,
  patchCollectContainerSnapshot, patchCreateManagedItemCountMap,
} from "./inventory.js";
import { botConfigs, runtimeState, trackedBotIdByUid, trackedBotMetaById } from "./state.js";
import { EntityComponentTypes, EquipmentSlot } from "./constants.js";

// ── Bot Spawn ──
export function spawnBotForPlayer(player) {
  const spawnLocation = getSpawnLocationNear(player);
  pendingSpawnRequests.push({
    playerName: player.name, location: spawnLocation,
    dimensionId: player.dimension.id, createdTick: Date.now(),
    openSettingsAfterSpawn: true,
  });
  try {
    player.dimension.spawnEntity(BOT_TYPE, spawnLocation);
  } catch (error) {
    player.sendMessage(`§c[PvPBot] Bot の召喚に失敗: ${formatError(error)}`);
    appendPersistentDebugLog("error", `spawnBotForPlayer failed: ${formatError(error)}`);
  }
}

// プリセット名を指定してBotを召喚する（インベントリはデフォルトで無限）
export function spawnBotWithPreset(player, presetName) {
  const validPresets = ["easy", "normal", "hard"];
  const preset = presetName?.toLowerCase()?.trim();
  if (!preset || !validPresets.includes(preset)) {
    player.sendMessage(`§c[PvPBot] 無効なプリセット: "${presetName ?? ""}"。有効なプリセット: easy, normal, hard`);
    return;
  }
  const spawnLocation = getSpawnLocationNear(player);
  // openSettingsAfterSpawn=false、presetName を渡して spawn 後に設定を適用
  pendingSpawnRequests.push({
    playerName: player.name, location: spawnLocation,
    dimensionId: player.dimension.id, createdTick: Date.now(),
    openSettingsAfterSpawn: false,
    presetName: preset,
    inventoryMode: "infinite",
  });
  try {
    player.dimension.spawnEntity(BOT_TYPE, spawnLocation);
    player.sendMessage(`§a[PvPBot] §f${preset} §aプリセットのBotを召喚しました。インベントリ: 無限`);
  } catch (error) {
    player.sendMessage(`§c[PvPBot] Bot の召喚に失敗: ${formatError(error)}`);
    appendPersistentDebugLog("error", `spawnBotWithPreset failed: ${formatError(error)}`);
  }
}

// ── Bot Remove ──
export function removeOwnedBots(player) {
  let removed = 0;
  for (const bot of getAllBots()) {
    const config = ensureBotInitialized(bot);
    if (!config) continue;
    if (config.ownerName && config.ownerName !== player.name) continue;
    const uid = getBotUid(bot);
    delete botConfigs[uid];
    runtimeState.delete(uid);
    trackedBotIdByUid.delete(uid);
    try { bot.remove(); removed++; } catch {}
  }
  saveConfigs();
  player.sendMessage(`§a${removed} 体の Bot を削除しました。`);
}

function removeSpecificBot(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) { player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。"); return false; }
  const label = getBotLabel(bot);
  const uid = getBotUid(bot);
  const config = ensureBotInitialized(bot);
  if (!config) { player.sendMessage("§c[PvPBot] Bot の設定を取得できませんでした。"); return false; }
  if (config.ownerName && config.ownerName !== player.name) { player.sendMessage(`§c${getBotLabel(bot)} は ${config.ownerName} の所有なので削除できません。`); return false; }
  delete botConfigs[uid]; runtimeState.delete(uid); trackedBotIdByUid.delete(uid);
  try { trackedBotMetaById.delete(bot.id); } catch {}
  try { bot.remove(); } catch (error) { player.sendMessage(`§c[PvPBot] Bot の削除に失敗しました: ${formatError(error)}`); return false; }
  saveConfigs();
  player.sendMessage(`§a${label} を削除しました。`);
  return true;
}

// ── Supply Chest ──
function formatSupplyChest(config) {
  if (!hasSupplyChest(config)) return "未設定";
  return `${fromDimensionKey(config.supplyChestDimensionKey)} (${Math.floor(config.supplyChestX)}, ${Math.floor(config.supplyChestY)}, ${Math.floor(config.supplyChestZ)})`;
}

function findContainerBlockInView(player, maxDistance = PATCH_SUPPLY_CHEST_VIEW_DISTANCE) {
  try {
    const hit = player.getBlockFromViewDirection?.({ maxDistance });
    return getBlockInventoryContainer(hit?.block) ? hit.block : undefined;
  } catch { return undefined; }
}

function setSupplyChestFromView(player, bot) {
  const block = findContainerBlockInView(player);
  if (!block) { player.sendMessage("§c視線先にコンテナブロックがありません。"); return false; }
  const config = ensureBotInitialized(bot, player);
  if (!config || !block) return false;
  const location = floorLocation(block.location);
  const updated = persistBotConfig(bot, {
    ...config, ownerName: player.name,
    supplyChestDimensionKey: toDimensionKey(block.dimension.id),
    supplyChestX: location.x, supplyChestY: location.y, supplyChestZ: location.z,
  });
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(`§a${getBotLabel(bot)} の供給チェストを ${formatSupplyChest(updated)} に設定しました。`);
  return true;
}

function clearSupplyChest(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return false;
  const updated = persistBotConfig(bot, { ...config, ownerName: player.name, supplyChestDimensionKey: "", supplyChestX: 0, supplyChestY: 0, supplyChestZ: 0 });
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(`§a${getBotLabel(bot)} の供給チェスト設定を解除しました。`);
  return true;
}

export function setSupplyChestForNearestBot(player) { const bot = getNearbyBots(player, Infinity)[0]; if (!bot) { player.sendMessage("§c設定できる PvP Bot がいません。"); return; } setSupplyChestFromView(player, bot); }
export function clearSupplyChestForNearestBot(player) { const bot = getNearbyBots(player, Infinity)[0]; if (!bot) { player.sendMessage("§c設定できる PvP Bot がいません。"); return; } clearSupplyChest(player, bot); }

// ── Teleport ──
function getSafeLocationNearBot(bot) {
  const base = floorLocation(bot.location);
  const offsets = [{ x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }, { x: 2, z: -2 }, { x: -2, z: -2 }, { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 }];
  for (const offset of offsets) {
    for (const yOff of [1, 0, 2, -1, -2]) {
      const loc = { x: base.x + offset.x + 0.5, y: base.y + yOff, z: base.z + offset.z + 0.5 };
      if (isSafeStandingLocation(bot.dimension, loc) && !isLocationOccupiedByPlayer(bot.dimension, loc)) return loc;
    }
  }
  return undefined;
}

function teleportPlayerToBot(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) { player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。"); return false; }
  const dest = getSafeLocationNearBot(bot) ?? addVector(bot.location, { x: 1, y: 0, z: 0 });
  try { player.teleport(dest, { dimension: bot.dimension, facingLocation: bot.location }); player.sendMessage(`§a${getBotLabel(bot)} の近くにテレポートしました。`); return true; }
  catch (error) { player.sendMessage(`§c[PvPBot] TP に失敗しました: ${formatError(error)}`); return false; }
}

function teleportBotToPlayer(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) { player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。"); return false; }
  const dest = getSpawnLocationNear(player) ?? addVector(player.location, { x: 1, y: 0, z: 0 });
  try { bot.teleport(dest, { dimension: player.dimension, facingLocation: player.location }); player.sendMessage(`§a${getBotLabel(bot)} を自分の近くへテレポートしました。`); return true; }
  catch (error) { player.sendMessage(`§c[PvPBot] Bot の TP に失敗しました: ${formatError(error)}`); return false; }
}

// ── Forms ──
async function openDifficultyPresetMenu(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const response = await new ActionFormData().title(`${getBotLabel(bot)} - Difficulty`)
    .body(`現在: ${patchGetDifficultyLabel(config)}\n各プリセットは CD と距離設定をまとめて調整します。`)
    .button("Easy").button("Normal").button("Hard").button("戻る").show(player);
  if (response.canceled || response.selection === 3) return;
  const presetId = response.selection === 0 ? "easy" : response.selection === 1 ? "normal" : "hard";
  const updated = persistBotConfig(bot, patchApplyDifficultyPreset({ ...config, ownerName: player.name }, presetId));
  bot.nameTag = updated.displayName || getDefaultBotDisplayName(updated.uid);
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(`§a${getBotLabel(bot)} に ${patchGetDifficultyLabel(updated)} プリセットを適用しました。`);
}

async function openBotSettingsModal(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const form = new ModalFormData().title("PvP Bot 戦闘設定")
    .toggle("[基本] BotのAIを動かす", { defaultValue: config.enabled })
    .slider("[基本] 敵との維持距離 (1=密着, 6=遠距離)", 1, 6, { valueStep: 1, defaultValue: config.maintainDistance })
    .slider("[基本] 敵を認識する範囲", 4, 128, { valueStep: 1, defaultValue: config.targetRange ?? MAX_TARGET_DISTANCE })
    .toggle("[基本] モブを攻撃対象にする", { defaultValue: config.targetMobs })
    .toggle("[基本] 他のBotを攻撃対象にする", { defaultValue: config.targetBots })
    .toggle("[基本] ジャンプダッシュで接近する", { defaultValue: config.jumpDash })
    .toggle("[基本] 左右に動き回る (Strafe)", { defaultValue: config.strafeMove ?? true })
    .toggle("[基本] 行く手を阻むブロックを採掘する", { defaultValue: config.enableMining ?? true })
    .slider("[基本] 採掘開始までのスタック時間 (0=即座, 120=6秒)", 0, 120, { valueStep: 10, defaultValue: config.mineStuckTicksThreshold ?? 40 })
    .toggle("[アイテム] 自動トーテム補充", { defaultValue: config.autoTotem })
    .toggle("[アイテム] 回復行動を使う", { defaultValue: config.recoveryEnabled ?? true })
    .slider("[アイテム] トーテム即補充 (0=最速, 60=3秒遅れ)", 0, 60, { valueStep: 1, defaultValue: config.totemRefillDelay })
    .toggle("[アイテム] 距離を詰める時にエンパを使う", { defaultValue: config.pearlMove })
    .toggle("[アイテム] 回復行動時にエンパで逃げる", { defaultValue: config.pearlRecover ?? true })
    .slider("[アイテム] エンパを使う距離", 8, 16, { valueStep: 1, defaultValue: config.pearlDistance })
    .slider("[アイテム] 次のパールまでの待ち (0=最速, 80=4秒)", 0, 80, { valueStep: 5, defaultValue: config.pearlCooldown })
    .toggle("[戦闘] 剣攻撃を使う", { defaultValue: config.swordCombo })
    .slider("[戦闘] 剣を振る間隔 (0=最速連打, 20=1秒)", 0, 25, { valueStep: 1, defaultValue: config.swordCooldown })
    .toggle("[戦闘] クリスタルを使う", { defaultValue: config.crystalCombo })
    .slider("[戦闘] クリスタルの設置間隔 (0=最速, 20=1秒)", 0, 25, { valueStep: 1, defaultValue: config.crystalCooldown })
    .slider("[戦闘] クリスタルの起爆遅れ (0=即座, 10=0.5秒)", 0, 10, { valueStep: 1, defaultValue: config.crystalDetonateDelay })
    .toggle("[戦闘] 自爆ダメージを気にせず特攻する", { defaultValue: config.ignoreSelfDamage ?? false })
    .toggle("[戦闘] アンカーを使う", { defaultValue: config.anchorCombo })
    .slider("[戦闘] アンカーの設置間隔 (0=最速, 20=1秒)", 0, 25, { valueStep: 1, defaultValue: config.anchorCooldown })
    .slider("[戦闘] アンカーの起爆遅れ (0=即座, 10=0.5秒)", 0, 10, { valueStep: 1, defaultValue: config.anchorDetonateDelay })
    .toggle("[戦闘] アンカー破壊パターンをキャッシュ (ラグ軽減)", { defaultValue: config.anchorBreakCache ?? true })
    .toggle("[戦闘] 逃げ場がない時は反撃せず回復に専念する", { defaultValue: config.eatWhenCornered ?? true })
    .toggle("[人間味] 遅れ・ブレ・ミスを有効にする", { defaultValue: config.humanize })
    .slider("[人間味] 反応の遅れ (大きいほど鈍い)", 0, 12, { valueStep: 1, defaultValue: config.reactionDelay })
    .slider("[人間味] 視線のブレ (%)", 0, 30, { valueStep: 1, defaultValue: Math.round(Number(config.aimJitter ?? 0) * 100) })
    .slider("[人間味] ミス率 (空振り・見送り %)", 0, 30, { valueStep: 1, defaultValue: config.mistakeRate })
    .slider("[人間味] 非最適行動率 (%)", 0, 60, { valueStep: 1, defaultValue: config.suboptimalRate })
    .toggle("[システム] 装備が壊れないようにする", { defaultValue: config.unbreakableEquipment ?? true })
    .slider("[システム] 処理の軽さ (1=重い/強い, 4=軽い/鈍い)", 1, 4, { valueStep: 1, defaultValue: config.tickInterval })
    .toggle("[Debug] 全体のログ", { defaultValue: config.debug.enabled })
    .toggle("[Debug] 移動のログ", { defaultValue: config.debug.movement })
    .toggle("[Debug] 候補探索のログ", { defaultValue: config.debug.scan })
    .toggle("[Debug] 攻撃のログ", { defaultValue: config.debug.combat })
    .toggle("[Debug] 被ダメージ/残HPのログ", { defaultValue: config.debug.health })
    .toggle("[Debug] トーテムのログ", { defaultValue: config.debug.totem })
    .toggle("[Debug] 装備同期のログ", { defaultValue: config.debug.loadout })
    .toggle("[Debug] インベントリのログ", { defaultValue: config.debug.inventory });
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  let response;
  try {
    response = await form.show(player);
  } finally {
    runtime.isConfiguring = false;
  }
  if (response.canceled || !response.formValues) return;
  const [enabled, maintainDistance, targetRange, targetMobs, targetBots, jumpDash, strafeMove, enableMining, mineStuckTicksThreshold, autoTotem, recoveryEnabled, totemRefillDelay, pearlMove, pearlRecover, pearlDistance, pearlCooldown, swordCombo, swordCooldown, crystalCombo, crystalCooldown, crystalDetonateDelay, ignoreSelfDamage, anchorCombo, anchorCooldown, anchorDetonateDelay, anchorBreakCache, eatWhenCornered, humanize, reactionDelay, aimJitterPercent, mistakeRate, suboptimalRate, unbreakableEquipment, tickInterval, debugEnabled, debugMovement, debugScan, debugCombat, debugHealth, debugTotem, debugLoadout, debugInventory] = response.formValues;
  const current = ensureBotInitialized(bot, player);
  if (!current) return;
  const updated = persistBotConfig(bot, {
    ...current, ownerName: player.name, enabled, maintainDistance, targetRange, targetMobs, targetBots, jumpDash, strafeMove, enableMining, mineStuckTicksThreshold, autoTotem, recoveryEnabled, totemRefillDelay, pearlMove, pearlRecover, pearlDistance, pearlCooldown, swordCombo, swordCooldown, crystalCombo, crystalCooldown, crystalDetonateDelay, ignoreSelfDamage, anchorCombo, anchorCooldown, anchorDetonateDelay, anchorBreakCache, eatWhenCornered, humanize, reactionDelay, aimJitter: Number(aimJitterPercent) / 100, mistakeRate, suboptimalRate, unbreakableEquipment, tickInterval,
    debug: { enabled: debugEnabled, movement: debugMovement, scan: debugScan, combat: debugCombat, health: debugHealth, totem: debugTotem, loadout: debugLoadout, inventory: debugInventory },
  });
  bot.nameTag = updated.displayName || getDefaultBotDisplayName(updated.uid);
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(`§a${getBotLabel(bot)} の設定を保存しました。`);
}

async function openInventorySettingsMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const modeLabels = { infinite: "無限 (アイテムを消費しない)", owner_sync: "オーナー同期", custom: "カスタム", auto_refill: "自動補充 (デフォルト値まで補充)" };
  const form = new ActionFormData().title("インベントリ設定").body(`現在: ${modeLabels[config.inventoryMode ?? "auto_refill"]}`)
    .button("無限モード").button("オーナー同期モード").button("自動補充モード").button("カスタムモード").button("カスタム値を設定").button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  let response;
  try {
    response = await form.show(player);
  } finally {
    runtime.isConfiguring = false;
  }
  if (response.canceled) return;
  const modes = ["infinite", "owner_sync", "auto_refill", "custom"];
  if (response.selection < 4) {
    config.inventoryMode = modes[response.selection];
    if (response.selection === 3) getRuntime(config.uid).customBudgetInitialized = false;
    writeConfigTags(bot, config); saveConfigs(); syncBotLoadout(bot, config, true);
    player.sendMessage(`§a${getBotLabel(bot)} のインベントリモードを変更しました。`);
    system.run(() => { void openInventorySettingsMenu(player, bot, defaultIndex); });
  } else if (response.selection === 4) {
    await openCustomItemCountsMenu(player, bot, defaultIndex);
  } else {
    system.run(() => { void openBotManageMenu(player, bot, defaultIndex); });
  }
}

async function openCustomItemCountsMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const itemEntries = [
    { id: OBSIDIAN_ID, name: "黒曜石", default: 64 }, { id: END_CRYSTAL_ID, name: "エンドクリスタル", default: 64 },
    { id: RESPAWN_ANCHOR_ID, name: "リスポーンアンカー", default: 32 }, { id: GLOWSTONE_ID, name: "グロウストーン", default: 64 },
    { id: ENDER_PEARL_ID, name: "エンダーパール", default: 16 }, { id: TOTEM_ID, name: "トーテム", default: 8 },
    { id: PATCH_ENCHANTED_GOLDEN_APPLE_ID, name: "エンチャント金リンゴ", default: 8 },
    { id: PATCH_GOLDEN_APPLE_ID, name: "金リンゴ", default: 16 },
    { id: "minecraft:cobblestone", name: "丸石", default: 64 }, { id: "minecraft:dirt", name: "土", default: 64 }, { id: "minecraft:stone", name: "石", default: 64 },
  ];
  const customCounts = config.customItemCounts ?? {};
  const form = new ActionFormData().title("カスタムアイテム数設定").body("設定するアイテムを選択してください。");
  for (const entry of itemEntries) form.button(`${entry.name}: ${customCounts[entry.id] ?? entry.default}`);
  form.button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  let response;
  try {
    response = await form.show(player);
  } finally {
    runtime.isConfiguring = false;
  }
  if (response.canceled) return;
  if (response.selection === itemEntries.length) { system.run(() => { void openInventorySettingsMenu(player, bot, defaultIndex); }); return; }
  if (response.selection < itemEntries.length) { await openItemCountInput(player, bot, itemEntries[response.selection], defaultIndex); }
}

async function openItemCountInput(player, bot, itemEntry, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const currentCount = (config.customItemCounts ?? {})[itemEntry.id] ?? itemEntry.default;
  const form = new ModalFormData().title(`${itemEntry.name}の数を設定`).slider("数量", 0, 64, { valueStep: 1, defaultValue: currentCount }).toggle("無限 (64に設定)", { defaultValue: currentCount === 64 });
  const response = await form.show(player);
  if (response.canceled) { system.run(() => { void openCustomItemCountsMenu(player, bot, defaultIndex); }); return; }
  if (response.formValues) {
    let count = Number(response.formValues[0]);
    if (Boolean(response.formValues[1])) count = 64;
    if (!config.customItemCounts) config.customItemCounts = {};
    config.customItemCounts[itemEntry.id] = count;
    getRuntime(config.uid).customBudgetInitialized = false;
    writeConfigTags(bot, config); saveConfigs(); syncBotLoadout(bot, config, true);
    player.sendMessage(`§a${itemEntry.name}の数を${count}に設定しました。`);
  }
  system.run(() => { void openCustomItemCountsMenu(player, bot, defaultIndex); });
}

async function openBotManageMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const inventoryModeLabel = { infinite: "無限", owner_sync: "オーナー同期", custom: "カスタム", auto_refill: "自動補充" }[config.inventoryMode ?? "auto_refill"];
  const form = new ActionFormData().title(getBotLabel(bot)).body(
    `Owner: ${config.ownerName || "none"}\n供給チェスト: ${formatSupplyChest(config)}\nインベントリ: ${inventoryModeLabel}\n維持距離: ${config.maintainDistance}\n敵認識範囲: ${config.targetRange ?? MAX_TARGET_DISTANCE}`
  ).button("戦闘設定").button("インベントリ設定").button("視線先チェストを供給元に設定").button("供給チェストを解除").button("装備を今すぐ同期").button("自分をこの Bot に TP").button("この Bot を自分に TP").button("この Bot を削除").button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  let response;
  try {
    response = await form.show(player);
  } finally {
    runtime.isConfiguring = false;
  }
  if (response.canceled) return;
  if (response.selection === 0) { await openBotSettingsModal(player, bot); return; }
  if (response.selection === 1) { await openInventorySettingsMenu(player, bot, defaultIndex); return; }
  if (response.selection === 2) setSupplyChestFromView(player, bot);
  else if (response.selection === 3) clearSupplyChest(player, bot);
  else if (response.selection === 4) { const c = ensureBotInitialized(bot, player); if (c) { syncBotLoadout(bot, c, true); ensureBotEquipmentIntegrity(bot, c); player.sendMessage(`§a${getBotLabel(bot)} の装備を同期しました。`); } }
  else if (response.selection === 5) teleportPlayerToBot(player, bot);
  else if (response.selection === 6) teleportBotToPlayer(player, bot);
  else if (response.selection === 7) { if (removeSpecificBot(player, bot)) { system.run(() => { void openSettingsForm(player, defaultIndex); }); return; } }
  else { system.run(() => { void openSettingsForm(player, defaultIndex); }); return; }
  system.run(() => { void openBotManageMenu(player, bot, defaultIndex); });
}

export async function openSettingsForm(player, defaultIndex = 0) {
  const nearbyBots = getNearbyBots(player, Infinity);
  if (!nearbyBots.length) { player.sendMessage("§c設定できる PvP Bot がいません。"); return; }
  const pickerForm = new ActionFormData().title("Select Bot").body("設定する Bot を選択してください。");
  for (const bot of nearbyBots) pickerForm.button(getBotLabel(bot));
  const picker = await pickerForm.show(player);
  if (picker.canceled) return;
  const pickedIndex = typeof picker.selection === "number" ? picker.selection : 0;
  await openBotManageMenu(player, nearbyBots[pickedIndex], pickedIndex);
}

export async function openRootMenu(player) {
  const response = await new ActionFormData().title("Crystal PvP Bot")
    .body(`v${await import("./constants.js").then(c => c.ADDON_VERSION)}`)
    .button("Bot を召喚").button("Bot 設定").button("難易度プリセット").button("ヘルプ").show(player);
  if (response.canceled) return;
  if (response.selection === 0) spawnBotForPlayer(player);
  else if (response.selection === 1) await openSettingsForm(player);
  else if (response.selection === 2) {
    const bots = getNearbyBots(player, Infinity);
    if (bots.length) await openDifficultyPresetMenu(player, bots[0]);
    else player.sendMessage("§c近くに Bot がいません。");
  }
  else if (response.selection === 3) {
    await new ActionFormData().title("Crystal PvP Bot")
      .body("1. /bot で Bot メニューを開きます。\n2. /pvpbot:spawn で Bot を出せます。\n3. チェストを見ながら供給チェストを設定できます。\n4. 安全範囲はデフォルトONです。")
      .button("閉じる").show(player);
  }
}

// Command handler factory
export function createPlayerCommandHandler(callback) {
  return (origin, ...args) => {
    const executor = origin.sourceEntity?.typeId === "minecraft:player" ? origin.sourceEntity
      : origin.initiator?.typeId === "minecraft:player" ? origin.initiator : undefined;
    if (!executor) return { status: CustomCommandStatus.Failure, message: "このコマンドはプレイヤーから実行してください。" };
    system.run(() => {
      try {
        const result = callback(executor, ...args);
        if (result && typeof result.then === "function") result.catch(error => { executor.sendMessage(`§c[PvPBot] ${formatError(error)}`); });
      } catch (error) { executor.sendMessage(`§c[PvPBot] ${formatError(error)}`); }
    });
    return { status: CustomCommandStatus.Success, message: "PvP Bot コマンドを受け付けました。" };
  };
}
