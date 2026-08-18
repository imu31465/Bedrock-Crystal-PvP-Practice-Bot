import {
  system, EntityComponentTypes, EquipmentSlot, ItemStack,
  BOT_TYPE, TOTEM_ID, OBSIDIAN_ID, END_CRYSTAL_ID,
  RESPAWN_ANCHOR_ID, GLOWSTONE_ID, ENDER_PEARL_ID, AIR_ID,
  SWORD_STATS, PICKAXE_STATS, BOT_ARMOR, BOT_ARMOR_ENCHANTMENTS,
  BOT_SWORD_ENCHANTMENTS, PATCH_MANAGED_STACK_ITEM_IDS,
  PATCH_DEFAULT_COMBAT_ITEM_COUNTS, PATCH_VISUAL_SLOT_BY_EQUIPMENT,
  PATCH_VISUAL_EQUIPMENT_SELECTOR_RADIUS, PATCH_VISUAL_EQUIPMENT_RESYNC_TICKS,
  PATCH_TOTEM_POP_HEALTH_THRESHOLD, PATCH_TOTEM_POP_HEALTH_RATIO,
  PATCH_TOTEM_POP_COOLDOWN_TICKS, PATCH_TOTEM_DAMAGE_IMMUNITY_TICKS,
  PATCH_TOTEM_DAMAGE_BUFFER, PATCH_TOTEM_REVIVE_HEALTH,
  PATCH_TOTEM_REGEN_TICKS, PATCH_TOTEM_ABSORPTION_TICKS,
  PATCH_TOTEM_FIRE_RESISTANCE_TICKS, PATCH_TOTEM_EMERGENCY_RESISTANCE_TICKS,
  PATCH_TOTEM_NOTIFICATION_RADIUS, PATCH_TOTEM_VISUAL_HOLD_TICKS,
  PATCH_ENCHANTED_GOLDEN_APPLE_ID, PATCH_GOLDEN_APPLE_ID,
  PATCH_ARMOR_EFFECT_REFRESH_TICKS,
} from "./constants.js";
import { botConfigs, globalTick } from "./state.js";
import {
  getBlock, isAirBlock, isSolidBlock, distance, distanceSquared,
  addVector, floorLocation, quoteCoord,
  getBotUid, isEntityUsable, getEquippableComponent,
  patchGetEnchantmentLevel, patchResolveEnchantmentType,
  patchCopyItemMetadata, patchCloneItemStackWithAmount,
  patchGetArmorDefenseValue, patchGetArmorSlotForItem, patchGetArmorSelectionScore,
  applyEnchantments, cloneItemStack, buildFallbackArmor,
  patchGetCurrentHealthValue, patchGetMaxHealthValue, setHealthValue,
  patchRunDimensionCommandNoThrow, debugLog, appendPersistentDebugLog,
  formatError, countItemInContainer, findClosestPlayer,
  getPlayerByName, getAllPlayers, tryPlayAnimation, faceBotToward,
  fromDimensionKey, getBlock as getBlockHelper,
} from "./utils.js";
import { getRuntime, writeConfigTags, materializeConfig, getDefaultBotDisplayName } from "./config.js";

// ── Item Helpers ──
export function patchGetSwordCombatStatsFromItem(item) {
  const base = SWORD_STATS[item?.typeId] ?? SWORD_STATS["minecraft:wooden_sword"];
  const sharpnessLevel = patchGetEnchantmentLevel(item, "sharpness");
  const knockbackLevel = patchGetEnchantmentLevel(item, "knockback");
  const fireAspectLevel = patchGetEnchantmentLevel(item, "fire_aspect");
  const sharpnessBonus = sharpnessLevel > 0 ? sharpnessLevel * 0.5 + 0.5 : 0;
  const damage = Number((base.damage + sharpnessBonus).toFixed(2));
  return {
    ...base, damage, sharpnessLevel, knockbackLevel, fireAspectLevel,
    score: base.score * 100 + damage * 10 + fireAspectLevel * 2 + knockbackLevel,
  };
}

export function patchCreateManagedItemCountMap(sourceCounts = {}) {
  const mapped = {};
  for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
    mapped[itemId] = Math.max(0, Math.floor(Number(sourceCounts?.[itemId] ?? 0)));
  }
  return mapped;
}

function patchGetFirstEmptyContainerSlot(container) {
  if (!container) return -1;
  for (let i = 0; i < container.size; i++) {
    if (!container.getItem(i)) return i;
  }
  return -1;
}

export function patchPlaceItemInContainer(container, item) {
  if (!container || !item) return false;
  const slot = patchGetFirstEmptyContainerSlot(container);
  if (slot === -1) return false;
  try { container.setItem(slot, cloneItemStack(item)); return true; } catch { return false; }
}

export function patchFindInventoryItem(container, itemId) {
  if (!container || !itemId) return undefined;
  let matchedItem, matchedScore = -Infinity;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId !== itemId) continue;
    if (!SWORD_STATS[itemId]) return item;
    const stats = patchGetSwordCombatStatsFromItem(item);
    if (stats.score > matchedScore) { matchedItem = item; matchedScore = stats.score; }
  }
  return matchedItem;
}

// ── Armor Calculation ──
export function patchGetProtectionLevelForDamageCause(item, damageCause) {
  const protection = patchGetEnchantmentLevel(item, "protection");
  let specialized = 0;
  switch (`${damageCause ?? ""}`) {
    case "entityExplosion": case "blockExplosion":
      specialized = patchGetEnchantmentLevel(item, "blast_protection"); break;
    case "fire": case "fireTick": case "lava":
      specialized = patchGetEnchantmentLevel(item, "fire_protection"); break;
    case "projectile":
      specialized = patchGetEnchantmentLevel(item, "projectile_protection"); break;
    case "fall":
      specialized = patchGetEnchantmentLevel(item, "feather_falling"); break;
  }
  if (specialized <= 0) {
    const norm = `${damageCause ?? ""}`.replace(/[^a-z]/gi, "").toLowerCase();
    if (norm.includes("explosion")) specialized = patchGetEnchantmentLevel(item, "blast_protection");
    else if (norm.includes("projectile")) specialized = patchGetEnchantmentLevel(item, "projectile_protection");
    else if (norm.includes("fire") || norm.includes("lava")) specialized = patchGetEnchantmentLevel(item, "fire_protection");
    else if (norm.includes("fall")) specialized = patchGetEnchantmentLevel(item, "feather_falling");
  }
  return Math.max(protection, specialized);
}

export function patchGetEquippedArmorItems(entity) {
  const uid = getBotUid(entity);
  const config = uid ? botConfigs[uid] : undefined;
  if (config) {
    const runtime = getRuntime(uid);
    const selectedArmor = Object.values(runtime?.selectedArmorBySlot ?? {}).filter(Boolean);
    if (selectedArmor.length) return selectedArmor;
  }
  const equippable = getEquippableComponent(entity);
  if (equippable) {
    const equipped = [
      equippable.getEquipment(EquipmentSlot.Head),
      equippable.getEquipment(EquipmentSlot.Chest),
      equippable.getEquipment(EquipmentSlot.Legs),
      equippable.getEquipment(EquipmentSlot.Feet),
    ].filter(Boolean);
    if (equipped.length) return equipped;
  }
  const inventory = entity?.getComponent?.(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return [];
  return Object.values(patchCollectContainerSnapshot(inventory).armorBySlot).filter(Boolean);
}

export function patchCalculateArmorDamageReduction(bot, damage, damageCause) {
  const armorItems = patchGetEquippedArmorItems(bot);
  if (!armorItems.length || damage <= 0) return 0;
  const armorPoints = armorItems.reduce((sum, item) => sum + patchGetArmorDefenseValue(item), 0);
  const enchantReduction = armorItems.reduce((sum, item) => sum + patchGetProtectionLevelForDamageCause(item, damageCause), 0);
  const armorRatio = Math.min(0.6, armorPoints * 0.025);
  const enchantRatio = Math.min(0.2, enchantReduction * 0.01);
  return Math.max(0, Math.min(damage, damage * (armorRatio + enchantRatio)));
}

function patchGetActiveEffect(entity, effectId) {
  try {
    const effect = entity?.getEffect?.(effectId);
    const duration = Number(effect?.duration ?? effect?.durationTicks ?? 0);
    if (!effect || duration <= 0) return undefined;
    return effect;
  } catch {
    return undefined;
  }
}

function patchGetEffectAmplifier(entity, effectId) {
  const effect = patchGetActiveEffect(entity, effectId);
  if (!effect) return -1;
  return Math.max(0, Math.floor(Number(effect.amplifier ?? 0)));
}

function patchIsFireDamageCause(damageCause) {
  const normalized = `${damageCause ?? ""}`.replace(/[^a-z]/gi, "").toLowerCase();
  return normalized.includes("fire") || normalized.includes("lava");
}

function patchIsResistanceDamageCause(damageCause) {
  const normalized = `${damageCause ?? ""}`.replace(/[^a-z]/gi, "").toLowerCase();
  return !normalized.includes("void") && !normalized.includes("outofworld");
}

export function patchCalculateEffectDamageReduction(entity, damage, damageCause) {
  const numericDamage = Math.max(0, Number(damage ?? 0));
  if (numericDamage <= 0.01) return 0;
  if (patchIsFireDamageCause(damageCause) && patchGetActiveEffect(entity, "fire_resistance")) return numericDamage;
  const resistanceAmplifier = patchGetEffectAmplifier(entity, "resistance");
  if (resistanceAmplifier < 0 || !patchIsResistanceDamageCause(damageCause)) return 0;
  const resistanceRatio = Math.min(1, (resistanceAmplifier + 1) * 0.2);
  return Math.max(0, Math.min(numericDamage, numericDamage * resistanceRatio));
}

export function patchGetEstimatedAbsorptionValue(entity) {
  const absorptionAmplifier = patchGetEffectAmplifier(entity, "absorption");
  if (absorptionAmplifier < 0) return 0;
  return (absorptionAmplifier + 1) * 4;
}

export function patchCalculateNetDamage(entity, rawDamage, damageCause) {
  const numericDamage = Math.max(0, Number(rawDamage ?? 0));
  if (numericDamage <= 0.01) return 0;
  const afterArmor = Math.max(0, numericDamage - patchCalculateArmorDamageReduction(entity, numericDamage, damageCause));
  return Math.max(0, afterArmor - patchCalculateEffectDamageReduction(entity, afterArmor, damageCause));
}

export function patchCalculateExpectedHealthDamage(entity, rawDamage, damageCause) {
  const netDamage = patchCalculateNetDamage(entity, rawDamage, damageCause);
  if (netDamage <= 0.01) return 0;
  return Math.max(0, netDamage - patchGetEstimatedAbsorptionValue(entity));
}

export function patchCalculateRawDamageForBotNetResult(bot, netDamage, damageCause) {
  const numericNet = Math.max(0, Number(netDamage ?? 0));
  if (numericNet <= 0.01) return 0;
  const probeDamage = Math.max(1, numericNet);
  const mitigated = patchCalculateNetDamage(bot, probeDamage, damageCause);
  const damageRatio = Math.max(0, Math.min(1, mitigated / probeDamage));
  if (damageRatio <= 0.01) return 0;
  return numericNet / damageRatio;
}

// ── Visual Equipment ──
function patchGetVisualEquipmentState(bot) {
  const equippable = getEquippableComponent(bot);
  const uid = getBotUid(bot);
  const runtime = uid ? getRuntime(uid) : undefined;
  const armorBySlot = {};
  for (const armor of BOT_ARMOR) {
    armorBySlot[armor.slot] = equippable?.getEquipment(armor.slot) ?? runtime?.selectedArmorBySlot?.[armor.slot];
  }
  return {
    equippable,
    mainhand: equippable?.getEquipment(EquipmentSlot.Mainhand) ?? runtime?.visualMainhand ?? runtime?.selectedSword,
    offhand: equippable?.getEquipment(EquipmentSlot.Offhand) ?? runtime?.visualOffhand ?? runtime?.selectedOffhand,
    armorBySlot,
  };
}

export function patchUpdateBotVisualEquipmentState(bot) {
  const visual = patchGetVisualEquipmentState(bot);
  try { bot.setProperty("pvpbot:has_head_gear", !!visual.armorBySlot[EquipmentSlot.Head]); } catch {}
}

function patchGetEquipmentSignature(bot) {
  const visual = patchGetVisualEquipmentState(bot);
  return [
    visual.mainhand?.typeId ?? AIR_ID, visual.offhand?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Head]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Chest]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Legs]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Feet]?.typeId ?? AIR_ID,
  ].join("|");
}

function patchGetBotEquipmentSelector(bot) {
  return `@e[type=${BOT_TYPE},x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=${PATCH_VISUAL_EQUIPMENT_SELECTOR_RADIUS},c=1]`;
}

export function patchSyncVisualEquipmentSlots(bot, force = false) {
  const uid = getBotUid(bot);
  if (!uid) return;
  const runtime = getRuntime(uid);
  const visual = patchGetVisualEquipmentState(bot);
  const signature = patchGetEquipmentSignature(bot);
  if (!force && runtime.lastVisualEquipmentSignature === signature &&
      globalTick - runtime.lastVisualEquipmentSyncTick < PATCH_VISUAL_EQUIPMENT_RESYNC_TICKS) return;
  const selector = patchGetBotEquipmentSelector(bot);
  for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
    const commandSlot = PATCH_VISUAL_SLOT_BY_EQUIPMENT.get(slot);
    if (!commandSlot) continue;
    const item = slot === EquipmentSlot.Mainhand ? visual.mainhand : slot === EquipmentSlot.Offhand ? visual.offhand : visual.armorBySlot[slot];
    const itemId = item?.typeId ?? AIR_ID;
    const command = item
      ? `replaceitem entity ${selector} ${commandSlot} 0 ${itemId} 1 0`
      : `replaceitem entity ${selector} ${commandSlot} 0 air`;
    patchRunDimensionCommandNoThrow(bot.dimension, command);
  }
  runtime.lastVisualEquipmentSignature = signature;
  runtime.lastVisualEquipmentSyncTick = globalTick;
}

function patchApplyArmorSelection(bot, armorBySlot) {
  const equippable = getEquippableComponent(bot);
  if (!equippable || !armorBySlot) {
    patchUpdateBotVisualEquipmentState(bot);
    patchSyncVisualEquipmentSlots(bot, true);
    return;
  }
  for (const armor of BOT_ARMOR) {
    try {
      equippable.setEquipment(armor.slot, armorBySlot[armor.slot] ? cloneItemStack(armorBySlot[armor.slot]) : undefined);
    } catch {}
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
}

function patchCloneArmorBySlot(armorBySlot = {}) {
  return {
    [EquipmentSlot.Head]: armorBySlot[EquipmentSlot.Head] ? cloneItemStack(armorBySlot[EquipmentSlot.Head]) : undefined,
    [EquipmentSlot.Chest]: armorBySlot[EquipmentSlot.Chest] ? cloneItemStack(armorBySlot[EquipmentSlot.Chest]) : undefined,
    [EquipmentSlot.Legs]: armorBySlot[EquipmentSlot.Legs] ? cloneItemStack(armorBySlot[EquipmentSlot.Legs]) : undefined,
    [EquipmentSlot.Feet]: armorBySlot[EquipmentSlot.Feet] ? cloneItemStack(armorBySlot[EquipmentSlot.Feet]) : undefined,
  };
}

// ── Container Snapshot ──
export function patchCollectContainerSnapshot(container) {
  const counts = patchCreateManagedItemCountMap();
  const armorBySlot = {};
  const armorScoreBySlot = {};
  let bestSword, bestSwordStats;
  if (!container) return { counts, armorBySlot, bestSword, bestSwordStats };
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    if (Object.prototype.hasOwnProperty.call(counts, item.typeId)) counts[item.typeId] += item.amount ?? 1;
    if (SWORD_STATS[item.typeId]) {
      const stats = patchGetSwordCombatStatsFromItem(item);
      if (!bestSwordStats || stats.score > bestSwordStats.score) { bestSword = item; bestSwordStats = stats; }
    }
    const armorSlot = patchGetArmorSlotForItem(item);
    if (armorSlot === undefined) continue;
    const armorScore = patchGetArmorSelectionScore(item);
    if ((armorScoreBySlot[armorSlot] ?? -1) < armorScore) { armorBySlot[armorSlot] = item; armorScoreBySlot[armorSlot] = armorScore; }
  }
  return { counts, armorBySlot, bestSword, bestSwordStats };
}

// ── Supply Chest ──
export function hasSupplyChest(config) { return !!config?.supplyChestDimensionKey; }
export function getSupplyChestLocation(config) {
  if (!hasSupplyChest(config)) return undefined;
  return { x: Math.floor(Number(config.supplyChestX ?? 0)), y: Math.floor(Number(config.supplyChestY ?? 0)), z: Math.floor(Number(config.supplyChestZ ?? 0)) };
}
function getBlockInventoryContainer(block) {
  if (!block || typeof block.getComponent !== "function") return undefined;
  try {
    return block.getComponent("minecraft:inventory")?.container ?? block.getComponent("inventory")?.container ??
           block.getComponent("minecraft:container")?.container ?? block.getComponent("container")?.container;
  } catch { return undefined; }
}
export { getBlockInventoryContainer };
export function getSupplyChestState(config) {
  const dimensionId = fromDimensionKey(config?.supplyChestDimensionKey);
  const location = getSupplyChestLocation(config);
  if (!dimensionId || !location) return undefined;
  let dimension;
  try { dimension = world.getDimension(dimensionId); } catch { return undefined; }
  const block = getBlock(dimension, location);
  const container = getBlockInventoryContainer(block);
  if (!block || !container) return undefined;
  return { block, container, dimension, location, snapshot: patchCollectContainerSnapshot(container) };
}

// ── Equip / Select ──
export function selectBestSword(bot) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const runtime = getRuntime(getBotUid(bot));
  let bestStats, bestItem;
  if (inventory) {
    for (let i = 0; i < inventory.size; i++) {
      const item = inventory.getItem(i);
      const stats = item && SWORD_STATS[item.typeId] ? patchGetSwordCombatStatsFromItem(item) : undefined;
      if (!stats || (bestStats && stats.score < bestStats.score)) continue;
      bestStats = stats; bestItem = item;
    }
  }
  if (bestItem) {
    runtime.visualMainhand = cloneItemStack(bestItem);
    if (equippable) {
      try { equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(bestItem)); } catch {}
      patchSyncVisualEquipmentSlots(bot, true);
    }
    return bestStats;
  }
  const current = equippable?.getEquipment?.(EquipmentSlot.Mainhand);
  if (SWORD_STATS[current?.typeId]) {
    runtime.visualMainhand = cloneItemStack(current);
    return patchGetSwordCombatStatsFromItem(current);
  }
  runtime.visualMainhand = applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS);
  return patchGetSwordCombatStatsFromItem(new ItemStack("minecraft:netherite_sword", 1));
}

export function selectBestPickaxe(bot) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const runtime = getRuntime(getBotUid(bot));
  
  let bestStats, bestItem;
  if (inventory) {
    for (let i = 0; i < inventory.size; i++) {
      const item = inventory.getItem(i);
      const stats = item && PICKAXE_STATS[item.typeId] ? PICKAXE_STATS[item.typeId] : undefined;
      if (!stats || (bestStats && stats.score < bestStats.score)) continue;
      bestStats = stats; bestItem = item;
    }
  }
  if (bestItem) {
    runtime.visualMainhand = cloneItemStack(bestItem);
    if (equippable) {
      try { equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(bestItem)); } catch {}
      patchSyncVisualEquipmentSlots(bot, true);
    }
    return bestStats;
  }
  return undefined;
}

export function equipMainhandItem(bot, itemId, config, allowSync = true) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const equippable = getEquippableComponent(bot);
  if (!inventory) {
    if (itemId === "minecraft:end_crystal") debugLog(bot, config, "combat", "§c[Equip] failed: no inventory component", true);
    return false;
  }
  let item = patchFindInventoryItem(inventory, itemId);
  if (!item && allowSync && config) {
    syncBotLoadout(bot, config, true);
    item = patchFindInventoryItem(inventory, itemId);
  }
  if (!item) {
    if (itemId === "minecraft:end_crystal") {
      let counts = 0;
      for (let i = 0; i < inventory.size; i++) if (inventory.getItem(i)) counts++;
      debugLog(bot, config, "combat", `§c[Equip] failed: item not found in inventory. items=${counts}, mode=${config?.inventoryMode}`, true);
    }
    return false;
  }
  const runtime = getRuntime(config?.uid ?? getBotUid(bot));
  runtime.visualMainhand = cloneItemStack(item);
  if (!equippable) { patchSyncVisualEquipmentSlots(bot, true); return true; }
  try { equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(item)); } catch {}
  patchSyncVisualEquipmentSlots(bot, true);
  return true;
}

export function consumeInventoryItem(container, itemId, amount = 1) {
  if (!container || !itemId || amount <= 0) return false;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId !== itemId) continue;
    const remaining = (item.amount ?? 1) - amount;
    if (remaining > 0) container.setItem(i, patchCloneItemStackWithAmount(item, remaining));
    else container.setItem(i, undefined);
    return true;
  }
  return false;
}

export function consumeManagedItem(bot, config, itemId, amount = 1) {
  if (config?.inventoryMode === "infinite") {
    debugLog(bot, config, "inventory", `アイテム消費: ${itemId.replace("minecraft:", "")} -${amount} (無限モード)`);
    return true;
  }
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) { debugLog(bot, config, "combat", `§4アイテム消費失敗: インベントリ取得不可 (${itemId})`, true); return false; }
  if (consumeInventoryItem(inventory, itemId, amount)) {
    const remaining = countItemInContainer(inventory, itemId);
    debugLog(bot, config, "inventory", `アイテム消費: ${itemId.replace("minecraft:", "")} -${amount} 残量=${remaining} mode=${config?.inventoryMode ?? "?"}`);
    return true;
  }
  if (config) syncBotLoadout(bot, config, true);
  const result = consumeInventoryItem(inventory, itemId, amount);
  if (!result) {
    const remaining = countItemInContainer(inventory, itemId);
    debugLog(bot, config, "combat", `§4アイテム消費失敗: ${itemId.replace("minecraft:", "")} 残量=${remaining} 要求=${amount} mode=${config?.inventoryMode ?? "?"}`, true);
  }
  return result;
}

// ── Totem ──
export function patchGetTotemPopThreshold(entity) {
  return Math.max(PATCH_TOTEM_POP_HEALTH_THRESHOLD, patchGetMaxHealthValue(entity) * PATCH_TOTEM_POP_HEALTH_RATIO);
}

export function patchShouldEmergencyPopTotem(entity, damage = 0, damageCause) {
  const currentHealth = patchGetCurrentHealthValue(entity);
  if (currentHealth <= 0.01) return true;
  const numericDamage = Number(damage ?? 0);
  if (numericDamage > 0) {
    const effectiveDamage = damageCause
      ? Math.min(numericDamage, patchCalculateExpectedHealthDamage(entity, numericDamage, damageCause))
      : numericDamage;
    const runtime = getRuntime(getBotUid(entity));
    const lastKnownHealth = Number(runtime?.lastKnownHealth ?? currentHealth);
    if (lastKnownHealth - effectiveDamage <= 0.35 || currentHealth - effectiveDamage <= 0.35) return true;
    const popThreshold = patchGetTotemPopThreshold(entity);
    if (Math.min(lastKnownHealth, currentHealth) <= popThreshold &&
        effectiveDamage >= Math.max(PATCH_TOTEM_DAMAGE_BUFFER, Math.min(lastKnownHealth, currentHealth) - 0.25))
      return true;
  }
  return false;
}

function patchHighlightBotTotemPop(bot, config) {
  const equippable = getEquippableComponent(bot);
  const runtime = getRuntime(config.uid);
  const previousMainhand = equippable?.getEquipment?.(EquipmentSlot.Mainhand);
  if (equippable) {
    try { equippable.setEquipment(EquipmentSlot.Mainhand, new ItemStack(TOTEM_ID, 1)); } catch {}
  }
  runtime.visualMainhand = new ItemStack(TOTEM_ID, 1);
  patchSyncVisualEquipmentSlots(bot, true);
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.totem_pop");
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) return;
    const nextEquippable = getEquippableComponent(bot);
    if (nextEquippable) {
      try {
        if (nextEquippable.getEquipment(EquipmentSlot.Mainhand)?.typeId === TOTEM_ID)
          nextEquippable.setEquipment(EquipmentSlot.Mainhand, previousMainhand ? cloneItemStack(previousMainhand) : undefined);
      } catch {}
      if (!previousMainhand) selectBestSword(bot);
    } else {
      runtime.visualMainhand = previousMainhand ? cloneItemStack(previousMainhand) : cloneItemStack(runtime.selectedSword);
      patchSyncVisualEquipmentSlots(bot, true);
    }
    patchUpdateBotVisualEquipmentState(bot);
  }, PATCH_TOTEM_VISUAL_HOLD_TICKS);
}

function applyConfiguredBotNameTag(bot, config) {
  const displayName = config?.displayName || getDefaultBotDisplayName(config?.uid);
  try {
    if (bot.nameTag !== displayName) bot.nameTag = displayName;
  } catch {}
}

function patchNotifyTotemPop(bot, config, reason) {
  const center = { x: bot.location.x, y: bot.location.y + 1, z: bot.location.z };
  patchRunDimensionCommandNoThrow(bot.dimension, `playsound random.totem @a[x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=${PATCH_TOTEM_NOTIFICATION_RADIUS}] ${quoteCoord(center.x)} ${quoteCoord(center.y)} ${quoteCoord(center.z)} 1 1`);
  patchRunDimensionCommandNoThrow(bot.dimension, `particle minecraft:totem_particle ${quoteCoord(center.x)} ${quoteCoord(center.y)} ${quoteCoord(center.z)}`);
  patchHighlightBotTotemPop(bot, config);
}

export function tryPopTotem(bot, config, reason = "unknown") {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const health = bot.getComponent(EntityComponentTypes.Health);
  if (!inventory || !health) return false;
  let consumed = false;
  const runtime = getRuntime(config.uid);
  const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
  if (equippable) {
    if (offhand?.typeId === TOTEM_ID) {
      try { equippable.setEquipment(EquipmentSlot.Offhand, undefined); runtime.visualOffhand = undefined; consumed = true; } catch {}
    }
  } else {
    if (runtime.visualOffhand?.typeId === TOTEM_ID) { runtime.visualOffhand = undefined; consumed = true; }
  }
  if (!consumed) {
    appendPersistentDebugLog("totem", `${config.uid}: tryPopTotem失敗 reason=${reason}`);
    return false;
  }
  const maxHealth = Number(health.effectiveMax ?? health.defaultValue ?? 20);
  const reviveHealth = Math.max(1, Math.min(maxHealth, PATCH_TOTEM_REVIVE_HEALTH));
  setHealthValue(bot, reviveHealth);
  try { bot.addEffect("regeneration", PATCH_TOTEM_REGEN_TICKS, { amplifier: 1, showParticles: false }); } catch {}
  try { bot.addEffect("absorption", PATCH_TOTEM_ABSORPTION_TICKS, { amplifier: 1, showParticles: false }); } catch {}
  try { bot.addEffect("fire_resistance", PATCH_TOTEM_FIRE_RESISTANCE_TICKS, { amplifier: 0, showParticles: false }); } catch {}
  try { bot.addEffect("resistance", PATCH_TOTEM_EMERGENCY_RESISTANCE_TICKS, { amplifier: 4, showParticles: false }); } catch {}
  runtime.lastTotemPopTick = globalTick;
  runtime.totemShieldUntilTick = globalTick + PATCH_TOTEM_DAMAGE_IMMUNITY_TICKS;
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.totem_pop");
  const remaining = countItemInContainer(inventory, TOTEM_ID);
  debugLog(bot, config, "totem", `疑似トーテム発動: ${reason} (手持ち消費完了 / インベントリ残量: ${remaining}個)`, true);
  ensureAutoTotem(bot, config);
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) return;
    if (patchGetCurrentHealthValue(bot) < reviveHealth) setHealthValue(bot, reviveHealth);
  }, 1);
  patchNotifyTotemPop(bot, config, reason);
  return true;
}

// ── Totem Auto-equip ──
function equipTotemOffhand(bot, config, allowSync = true) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return false;
  const runtime = getRuntime(config.uid);
  if (!equippable && config.inventoryMode === "infinite") {
    runtime.visualOffhand = new ItemStack(TOTEM_ID, 1);
    patchSyncVisualEquipmentSlots(bot, true);
    return true;
  }
  let foundSlot = -1;
  for (let i = 0; i < inventory.size; i++) {
    if (inventory.getItem(i)?.typeId === TOTEM_ID) { foundSlot = i; break; }
  }
  if (foundSlot === -1 && allowSync) {
    syncBotLoadout(bot, config, true);
    for (let i = 0; i < inventory.size; i++) {
      if (inventory.getItem(i)?.typeId === TOTEM_ID) { foundSlot = i; break; }
    }
  }
  if (foundSlot === -1) {
    if (config.inventoryMode === "infinite" && equippable) {
      try { equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack(TOTEM_ID, 1)); } catch {}
      runtime.visualOffhand = new ItemStack(TOTEM_ID, 1);
      patchSyncVisualEquipmentSlots(bot, true);
      return true;
    }
    return false;
  }
  const stack = inventory.getItem(foundSlot);
  if (!stack) return false;
  inventory.setItem(foundSlot, undefined);
  if (equippable) {
    const offhand = equippable.getEquipment(EquipmentSlot.Offhand);
    if (offhand) patchPlaceItemInContainer(inventory, cloneItemStack(offhand));
    try { equippable.setEquipment(EquipmentSlot.Offhand, patchCloneItemStackWithAmount(stack, 1)); } catch {
      patchPlaceItemInContainer(inventory, cloneItemStack(stack));
      return false;
    }
  } else {
    if (runtime.visualOffhand) patchPlaceItemInContainer(inventory, cloneItemStack(runtime.visualOffhand));
  }
  if ((stack.amount ?? 1) > 1) patchPlaceItemInContainer(inventory, patchCloneItemStackWithAmount(stack, (stack.amount ?? 1) - 1));
  runtime.visualOffhand = new ItemStack(TOTEM_ID, 1);
  patchSyncVisualEquipmentSlots(bot, true);
  return true;
}

export function ensureAutoTotem(bot, config) {
  if (!config.autoTotem) return;
  const runtime = getRuntime(config.uid);
  if (globalTick - runtime.lastTotemPopTick < Number(config.totemRefillDelay ?? 0)) return;
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const equippable = getEquippableComponent(bot);
  const currentOffhand = equippable ? equippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
  if (currentOffhand?.typeId === TOTEM_ID) return;
  equipTotemOffhand(bot, config, true);
}

export function handleTotemSafety(bot, config) {
  if (!config.autoTotem) return;
  const runtime = getRuntime(config.uid);
  const currentOffhand = getEquippableComponent(bot)?.getEquipment(EquipmentSlot.Offhand);
  const hasTotemNow = currentOffhand?.typeId === TOTEM_ID;
  if (runtime.hadTotemLastTick && !hasTotemNow) {
    runtime.lastTotemPopTick = globalTick;
    const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
    const remaining = countItemInContainer(inventory, TOTEM_ID);
    debugLog(bot, config, "totem", `トーテムが発動しました (インベントリ残量: ${remaining}個)`, true);
  }
  runtime.hadTotemLastTick = hasTotemNow;
  ensureAutoTotem(bot, config);
}

// ── Loadout Sync ──
export function syncBotLoadout(bot, config, force = false) {
  const runtime = getRuntime(config.uid);
  if (!force && globalTick - runtime.lastLoadoutSyncTick < 20) return;
  const supplyChest = getSupplyChestState(config);
  const owner = config.ownerName ? getPlayerByName(config.ownerName) : undefined;
  const ownerInventory = owner?.getComponent(EntityComponentTypes.Inventory)?.container;
  const ownerEquippable = getEquippableComponent(owner);
  const botInventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const botEquippable = getEquippableComponent(bot);
  if (!botInventory) return;
  const ownerSnapshot = ownerInventory ? patchCollectContainerSnapshot(ownerInventory) : undefined;
  const useSupplyChest = !!supplyChest;
  const inventoryMode = config.inventoryMode ?? "auto_refill";
  const needsOwner = (inventoryMode === "owner_sync" || config.mirrorOwnerLoadout) && !useSupplyChest;
  if (needsOwner && (!owner || !ownerInventory || !ownerEquippable || !ownerSnapshot)) return;
  runtime.lastLoadoutSyncTick = globalTick;

  const ownerMainhand = ownerEquippable?.getEquipment(EquipmentSlot.Mainhand);
  const ownerSword = SWORD_STATS[ownerMainhand?.typeId] ? ownerMainhand : ownerSnapshot?.bestSword;
  const ownerArmor = ownerEquippable ? {
    [EquipmentSlot.Head]: ownerEquippable.getEquipment(EquipmentSlot.Head),
    [EquipmentSlot.Chest]: ownerEquippable.getEquipment(EquipmentSlot.Chest),
    [EquipmentSlot.Legs]: ownerEquippable.getEquipment(EquipmentSlot.Legs),
    [EquipmentSlot.Feet]: ownerEquippable.getEquipment(EquipmentSlot.Feet),
  } : {};

  let itemCounts = {};
  if (inventoryMode === "infinite") {
    for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) itemCounts[itemId] = 64;
  } else if (inventoryMode === "owner_sync" && ownerSnapshot && !useSupplyChest) {
    const ownerCounts = patchCreateManagedItemCountMap(ownerSnapshot.counts);
    if (!runtime.ownerSyncInitialized) {
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) itemCounts[itemId] = ownerCounts[itemId] ?? 0;
      runtime.ownerSyncBaseCounts = { ...ownerCounts }; runtime.ownerSyncInitialized = true;
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) currentCounts[off.typeId] = (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
        const diff = (ownerCounts[itemId] ?? 0) - (runtime.ownerSyncBaseCounts[itemId] ?? 0);
        let newBotCount = (currentCounts[itemId] ?? 0) + diff;
        if (diff !== 0) runtime.ownerSyncBaseCounts[itemId] = ownerCounts[itemId] ?? 0;
        itemCounts[itemId] = Math.max(0, newBotCount);
      }
    }
  } else if (inventoryMode === "custom") {
    const baseItemCounts = patchCreateManagedItemCountMap(config.customItemCounts ?? {});
    for (const [itemId, defaultCount] of Object.entries(PATCH_DEFAULT_COMBAT_ITEM_COUNTS)) {
      if (config.customItemCounts?.[itemId] === undefined) baseItemCounts[itemId] = defaultCount;
    }
    if (!runtime.customBudgetInitialized) {
      itemCounts = { ...baseItemCounts }; runtime.customBudgetInitialized = true;
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) currentCounts[off.typeId] = (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      const main = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Mainhand) : runtime.visualMainhand;
      if (main && PATCH_MANAGED_STACK_ITEM_IDS.includes(main.typeId) && main.typeId !== TOTEM_ID) currentCounts[main.typeId] = (currentCounts[main.typeId] ?? 0) + (main.amount ?? 1);
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) itemCounts[itemId] = Math.min(baseItemCounts[itemId] ?? 0, currentCounts[itemId] ?? 0);
    }
  } else {
    if (useSupplyChest) {
      itemCounts = patchCreateManagedItemCountMap(supplyChest.snapshot.counts);
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) currentCounts[off.typeId] = (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      const main = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Mainhand) : runtime.visualMainhand;
      if (main && PATCH_MANAGED_STACK_ITEM_IDS.includes(main.typeId) && main.typeId !== TOTEM_ID) currentCounts[main.typeId] = (currentCounts[main.typeId] ?? 0) + (main.amount ?? 1);
      itemCounts = patchCreateManagedItemCountMap(currentCounts);
      let totalItems = 0;
      for (const count of Object.values(itemCounts)) totalItems += count;
      if (totalItems === 0) itemCounts = patchCreateManagedItemCountMap(PATCH_DEFAULT_COMBAT_ITEM_COUNTS);
    }
  }

  const selectedSword = supplyChest?.snapshot.bestSword ?? ownerSword ?? applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS, config.unbreakableEquipment ?? true);
  let totemCountForInventory = itemCounts[TOTEM_ID] ?? 0;
  const currentBotOffhand = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
  const botHasTotemInHand = currentBotOffhand?.typeId === TOTEM_ID;
  const totemDelayActive = config.autoTotem && Number(config.totemRefillDelay ?? 0) > 0 && runtime.lastTotemPopTick > -9999 && globalTick - runtime.lastTotemPopTick < Number(config.totemRefillDelay ?? 0);
  let selectedOffhandTotem;
  if (botHasTotemInHand) { selectedOffhandTotem = new ItemStack(TOTEM_ID, 1); if (totemCountForInventory > 0) totemCountForInventory -= 1; }
  else if (totemDelayActive) { selectedOffhandTotem = undefined; }
  else if (config.autoTotem) {
    if (inventoryMode === "infinite") selectedOffhandTotem = new ItemStack(TOTEM_ID, 1);
    else if (totemCountForInventory > 0) { selectedOffhandTotem = new ItemStack(TOTEM_ID, 1); totemCountForInventory -= 1; }
  }

  for (let i = 0; i < botInventory.size; i++) botInventory.setItem(i, undefined);
  patchPlaceItemInContainer(botInventory, cloneItemStack(selectedSword) ?? applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS));
  for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
    let countToGive = itemId === TOTEM_ID ? totemCountForInventory : itemCounts[itemId];
    if (countToGive > 0) {
      try {
        const dummyItem = new ItemStack(itemId, 1);
        const maxAmount = dummyItem.maxAmount ?? 64;
        while (countToGive > 0) {
          const stackSize = Math.min(countToGive, maxAmount);
          const stack = new ItemStack(itemId, stackSize);
          try { botInventory.addItem(stack); } catch { patchPlaceItemInContainer(botInventory, stack); }
          countToGive -= stackSize;
        }
      } catch (error) { appendPersistentDebugLog("inventory", `Item creation failed for ${itemId}: ${formatError(error)}`); }
    }
  }

  const selectedArmorBySlot = {};
  for (const armor of BOT_ARMOR) {
    const selectedArmor = supplyChest?.snapshot.armorBySlot[armor.slot] ?? ownerArmor[armor.slot] ?? ownerSnapshot?.armorBySlot[armor.slot] ?? buildFallbackArmor(armor.slot);
    selectedArmorBySlot[armor.slot] = selectedArmor;
    if (selectedArmor) patchPlaceItemInContainer(botInventory, cloneItemStack(selectedArmor));
  }

  runtime.selectedArmorBySlot = patchCloneArmorBySlot(selectedArmorBySlot);
  runtime.selectedSword = cloneItemStack(selectedSword);
  runtime.visualMainhand = cloneItemStack(selectedSword);
  patchApplyArmorSelection(bot, selectedArmorBySlot);
  if (botEquippable) { try { botEquippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(selectedSword)); } catch {} }
  runtime.selectedOffhand = selectedOffhandTotem ? cloneItemStack(selectedOffhandTotem) : undefined;
  runtime.visualOffhand = selectedOffhandTotem ? cloneItemStack(selectedOffhandTotem) : undefined;
  if (botEquippable) { try { botEquippable.setEquipment(EquipmentSlot.Offhand, selectedOffhandTotem); } catch {} }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) return;
    patchApplyArmorSelection(bot, selectedArmorBySlot);
    patchSyncVisualEquipmentSlots(bot, true);
  }, 1);
}

// ── Seed / Init ──
export function seedBotLoadout(bot) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const equippable = getEquippableComponent(bot);
  if (!inventory) return;
  for (let i = 0; i < inventory.size; i++) inventory.setItem(i, undefined);
  const starterItems = [
    applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS, true),
    new ItemStack(OBSIDIAN_ID, 64), new ItemStack(END_CRYSTAL_ID, 16),
    new ItemStack(RESPAWN_ANCHOR_ID, 8), new ItemStack(GLOWSTONE_ID, 16),
    new ItemStack(ENDER_PEARL_ID, 16), new ItemStack(TOTEM_ID, 8),
    new ItemStack(PATCH_ENCHANTED_GOLDEN_APPLE_ID, 4), new ItemStack(PATCH_GOLDEN_APPLE_ID, 8),
  ];
  for (const item of starterItems) patchPlaceItemInContainer(inventory, item);
  if (equippable) {
    for (const armor of BOT_ARMOR) {
      try { equippable.setEquipment(armor.slot, applyEnchantments(new ItemStack(armor.itemId, 1), BOT_ARMOR_ENCHANTMENTS[armor.slot] ?? [], true)); } catch {}
    }
    try { equippable.setEquipment(EquipmentSlot.Mainhand, applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS, true)); } catch {}
    try { equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack(TOTEM_ID, 1)); } catch {}
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
}

export function ensureBotInitialized(bot, ownerPlayer) {
  if (bot.typeId !== BOT_TYPE) return undefined;
  trackBot(bot);
  const owner = ownerPlayer ?? findClosestPlayer(bot.location, bot.dimension, 24);
  const config = materializeConfig(bot, owner);
  applyConfiguredBotNameTag(bot, config);
  if (!bot.hasTag("pvpbot.ready")) {
    bot.addTag("pvpbot.ready");
    getRuntime(config.uid).spawnTick = globalTick;
    seedBotLoadout(bot);
    syncBotLoadout(bot, config, true);
    logBotEvent(bot, `initialized at ${bot.location.x.toFixed(1)}, ${bot.location.y.toFixed(1)}, ${bot.location.z.toFixed(1)}`);
  }
  return config;
}

export function ensureBotEquipmentIntegrity(bot, config) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable) { patchUpdateBotVisualEquipmentState(bot); patchSyncVisualEquipmentSlots(bot, true); return; }
  if (!equippable.getEquipment(EquipmentSlot.Mainhand)) {
    let hasSword = false;
    if (inventory) { for (let i = 0; i < inventory.size; i++) { if (inventory.getItem(i) && SWORD_STATS[inventory.getItem(i).typeId]) { hasSword = true; break; } } }
    if (hasSword) selectBestSword(bot);
    else equippable.setEquipment(EquipmentSlot.Mainhand, applyEnchantments(new ItemStack("minecraft:netherite_sword", 1), BOT_SWORD_ENCHANTMENTS));
  }
  for (const armor of BOT_ARMOR) {
    if (!equippable.getEquipment(armor.slot)) equippable.setEquipment(armor.slot, buildFallbackArmor(armor.slot));
  }
  if (!equippable.getEquipment(EquipmentSlot.Offhand)) ensureAutoTotem(bot, config);
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
}

export function applyArmorDerivedEffects(bot) {
  const armorItems = patchGetEquippedArmorItems(bot);
  if (!armorItems.length) return;
  const armorPoints = armorItems.reduce((sum, item) => sum + patchGetArmorDefenseValue(item), 0);
  const enchantPoints = armorItems.reduce((sum, item) => sum + patchGetProtectionLevelForDamageCause(item), 0);
  let resistanceAmplifier = -1;
  if (armorPoints >= 20 || armorPoints + enchantPoints * 0.5 >= 24) resistanceAmplifier = 1;
  else if (armorPoints >= 10 || enchantPoints >= 8) resistanceAmplifier = 0;
  if (resistanceAmplifier >= 0) {
    try { bot.addEffect("resistance", PATCH_ARMOR_EFFECT_REFRESH_TICKS, { amplifier: resistanceAmplifier, showParticles: false }); } catch {}
  }
}

// Re-export imports needed by other modules
import { trackBot, logBotEvent } from "./utils.js";
import { world as mcWorld } from "./constants.js";
