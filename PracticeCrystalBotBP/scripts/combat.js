import {
  system, EntityComponentTypes, EquipmentSlot, ItemStack,
  BOT_TYPE, OBSIDIAN_ID, END_CRYSTAL_ID, END_CRYSTAL_ENTITY_ID,
  RESPAWN_ANCHOR_ID, GLOWSTONE_ID, AIR_ID, SWORD_RANGE,
  MAX_INTERACT_DISTANCE, CRYSTAL_OFFSETS, CRYSTAL_SCAN_MIN, CRYSTAL_SCAN_MAX,
  COMBAT_PLACEMENT_ENTITY_RADIUS, COMBAT_PLACEMENT_ENTITY_HEIGHT,
  PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE,
  IFRAME_TICKS, PREDICTION_TICKS_AHEAD, PREDICTION_BONUS,
  JAVA_GRAVITY_PER_TICK, JAVA_FRICTION_PER_TICK, JAVA_TERMINAL_VELOCITY,
  HIT_CRYSTAL_LAUNCH_VELOCITY, HIT_CRYSTAL_FALL_VELOCITY, HIT_CRYSTAL_TIMEOUT_TICKS,
  BED_COMBO_COOLDOWN_TICKS,
  SURROUND_SEAL_EXPIRE_TICKS, SURROUND_SIDE_PENALTY, SURROUND_TOP_BONUS,
  DEFENSE_SCAN_TICKS, DEFENSE_BLOCK_CD_TICKS, DEFENSE_THREAT_RADIUS, DEFENSE_PREEMPT_CD_TICKS,
  MACE_ID, ELYTRA_DIVE_RISE_MAX_TICKS, ELYTRA_DIVE_AIM_HEIGHT, ELYTRA_DIVE_TOTAL_MAX_TICKS,
  MACE_DIVE_ATTACK_RANGE, MACE_DIVE_ATTACKS_MAX, ELYTRA_COMBO_REBOUND_TICKS,
  DTAP_COMBO_MAX_BURSTS, DTAP_FOLLOWUP_DELAY_TICKS, ANCHOR_SPAM_MAX_CHAIN,
} from "./constants.js";
import { isSimBot } from "./sim_port.js";
import { globalTick, globalSettings } from "./state.js";
import {
  distance, distanceSquared, vectorTo, addVector, normalize2D,
  floorLocation, getBlock, isAirBlock, isSolidBlock, isCrystalBaseBlock,
  isBotOnGround, isEntityUsable, getEquippableComponent, getBotUid,
  patchGetCurrentHealthValue, patchGetMaxHealthValue,
  appendPersistentDebugLog,
  patchApplyAimJitter, patchShouldDelayAction, patchRandomChance,
  patchIsCombatTargetUsable, patchResolvePendingCombatTarget,
  faceBotToward, setBotLookAt, tryPlayAnimation,
  debugLog, isSpawnProtected, patchGetNearbyCrystalEntities,
  countItemInContainer,
  spawnEntityWithFallback, getExplosionLocation, findNearestTarget,
  patchRunDimensionCommandNoThrow, quoteCoord,
} from "./utils.js";
import { getRuntime, normalizeGlobalSettings } from "./config.js";
import {
  selectBestSword, equipMainhandItem, consumeManagedItem,
  patchCalculateNetDamage, patchCalculateExpectedHealthDamage,
  patchGetSwordCombatStatsFromItem, selectBestAxe,
  ensureAutoTotem,
} from "./inventory.js";
import {
  estimateExplosionDamage, patchApplyDamageWithFallback,
  patchRunAnchorPlaceAndDetonateSequence, runCrystalExplosionWithFallback,
  placeBedWithFallback, runBedExplosionWithFallback,
  patchEnsureMobGriefingEnabled,
} from "./explosion.js";

// ── [B-4] ターゲットの無敵フレーム(i-frame)追跡 ──
// entityHurt イベント(main.js)から記録される。出力はスコアリング専用であり、
// 無敵フレーム自体はエンジンが管理する（Botは「明けを狙う」判断だけをする）。
const targetLastHurtTick = new Map(); // targetId(String) -> globalTick
export function noteTargetHurt(entity) {
  if (!entity?.id) return;
  targetLastHurtTick.set(String(entity.id), globalTick);
  if (targetLastHurtTick.size > 64) {
    for (const [key, tick] of targetLastHurtTick) {
      if (globalTick - tick > 200) targetLastHurtTick.delete(key);
    }
  }
}
function iframeTimingBonus(target, detonateTicksAhead) {
  const since = globalTick - Number(targetLastHurtTick.get(String(target?.id)) ?? -9999);
  const remaining = IFRAME_TICKS - since;
  if (remaining <= 0) return 3;                                     // 既に明けている → 即効
  return Math.abs(remaining - detonateTicksAhead) === 0 ? 8 : 0;    // d-tap: 明けジャスト
}

// ── [B-2] Java物理による移動先予測 ──
// 重力 0.08/tick・摩擦 ×0.91/tick（Java版準拠）で数ティック先の位置を外挿する。
export function predictTargetPosition(target, ticksAhead = PREDICTION_TICKS_AHEAD) {
  let v = { x: 0, y: 0, z: 0 };
  try { v = { ...target.velocity }; } catch {}
  let x = target.location.x, y = target.location.y, z = target.location.z;
  for (let i = 0; i < ticksAhead; i++) {
    x += v.x; y += v.y; z += v.z;
    v.y = Math.max(v.y - JAVA_GRAVITY_PER_TICK, JAVA_TERMINAL_VELOCITY);
    v.x *= JAVA_FRICTION_PER_TICK; v.z *= JAVA_FRICTION_PER_TICK;
    try {
      if (isSolidBlock(getBlock(target.dimension, { x: Math.floor(x), y: Math.floor(y - 0.1), z: Math.floor(z) }))) v.y = 0;
    } catch {}
  }
  return { x, y, z };
}

// ── Line of Sight ──
function patchHasLineOfSightBetween(dimension, from, to, step = 0.35) {
  const delta = vectorTo(from, to);
  const dist = Math.hypot(delta.x, delta.y, delta.z);
  if (dist <= 0.01) return true;
  const dir = { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist };
  for (let traveled = step; traveled < dist; traveled += step) {
    const sample = { x: from.x + dir.x * traveled, y: from.y + dir.y * traveled, z: from.z + dir.z * traveled };
    if (isSolidBlock(getBlock(dimension, sample))) return false;
  }
  return true;
}

function patchHasLineOfSightToBlock(dimension, from, blockLocation, step = 0.35) {
  const to = patchGetBlockInteractionLocation(blockLocation);
  const delta = vectorTo(from, to);
  const dist = Math.hypot(delta.x, delta.y, delta.z);
  if (dist <= 0.01) return true;
  const dir = { x: delta.x / dist, y: delta.y / dist, z: delta.z / dist };
  for (let traveled = step; traveled < dist; traveled += step) {
    const sample = { x: from.x + dir.x * traveled, y: from.y + dir.y * traveled, z: from.z + dir.z * traveled };
    const sampleBlock = floorLocation(sample);
    if (sampleBlock.x === blockLocation.x && sampleBlock.y === blockLocation.y && sampleBlock.z === blockLocation.z) continue;
    if (isSolidBlock(getBlock(dimension, sample))) return false;
  }
  return true;
}

function patchHasCombatLineOfSight(bot, target) {
  const eye = addVector(bot.location, { x: 0, y: 1.45, z: 0 });
  const targetSamples = [
    addVector(target.location, { x: 0, y: 1.1, z: 0 }),
    addVector(target.location, { x: 0, y: 0.6, z: 0 }),
    addVector(target.location, { x: 0, y: 1.5, z: 0 }),
  ];
  return targetSamples.some(sample => patchHasLineOfSightBetween(bot.dimension, eye, sample));
}

function patchIsCombatBlockInsideBoundary(location) {
  const settings = normalizeGlobalSettings(globalSettings);
  if (!settings.boundaryEnabled) return true;
  return location.x >= settings.boundaryMinX && location.x <= settings.boundaryMaxX &&
    location.z >= settings.boundaryMinZ && location.z <= settings.boundaryMaxZ;
}

function patchGetBlockInteractionLocation(location) {
  return { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
}

function patchCanInteractWithCombatBlock(bot, location) {
  if (!patchIsCombatBlockInsideBoundary(location)) return false;
  const center = patchGetBlockInteractionLocation(location);
  if (distance(bot.location, center) > MAX_INTERACT_DISTANCE) return false;
  return patchHasLineOfSightToBlock(bot.dimension, addVector(bot.location, { x: 0, y: 1.45, z: 0 }), location);
}

function patchCanPlaceCombatBlock(bot, location) {
  if (!patchCanInteractWithCombatBlock(bot, location)) return false;
  const block = getBlock(bot.dimension, location);
  return !!block && isAirBlock(block);
}

// ── Explosive Candidate Scanning ──
function isExplosionCandidateSafe(bot, targetDamage, selfDamage, config) {
  // [P1][RCA-03] 旧: ignoreSelfDamage → 即 true（自爆候補の遮蔽を完全に止めていた=問題Aの直接原因）。
  // 新: 「寛容な自傷キャップ」に意味を変更する。hard は HP×30%（最低6.0）まで許容、
  // 通常は HP×20%（最低3.0）。ignoreSelfDamage の UI/設定キーは温存（挙動のみ変更）。
  let maxSelfDamage;
  if (config.ignoreSelfDamage) {
    maxSelfDamage = config.selfDamageTolerance ?? Math.max(6.0, patchGetCurrentHealthValue(bot) * 0.3);
  } else {
    maxSelfDamage = config.selfDamageTolerance ?? Math.max(3.0, patchGetCurrentHealthValue(bot) * 0.2);
  }
  if (selfDamage > maxSelfDamage) return false;
  if (selfDamage <= 0.05) return true;
  const botHealth = patchGetCurrentHealthValue(bot);
  if (selfDamage >= botHealth - 2) return false;
  return targetDamage > selfDamage * 0.5;
}

function findShieldBlock(bot, explosionLocation) {
  const dist = distance(bot.location, explosionLocation);
  if (dist < 1.8) return undefined;
  const dir = normalize2D(vectorTo(bot.location, explosionLocation));
  if (!dir || (Math.abs(dir.x) < 0.01 && Math.abs(dir.z) < 0.01)) return undefined;
  const botFloor = floorLocation(bot.location);
  const expFloor = floorLocation(explosionLocation);
  // [0.7.0] 手前遮蔽ブロックは「自分の足元〜腰の高さ(dy=0優先, 次点dy=1)」かつ
  // 接地または隣接支持面がある座標を選ぶ（旧: dy=1固定で空中に浮き設置失敗していた）。
  const candidates = [
    { x: Math.floor(bot.location.x + dir.x * 1.15), y: botFloor.y, z: Math.floor(bot.location.z + dir.z * 1.15) },
    { x: Math.floor(bot.location.x + dir.x * 1.55), y: botFloor.y, z: Math.floor(bot.location.z + dir.z * 1.55) },
    { x: Math.floor(bot.location.x + dir.x * 1.35), y: botFloor.y + 1, z: Math.floor(bot.location.z + dir.z * 1.35) },
  ];
  for (const loc of candidates) {
    if (loc.x === botFloor.x && loc.z === botFloor.z && (loc.y === botFloor.y || loc.y === botFloor.y + 1)) continue;
    if (loc.x === expFloor.x && loc.z === expFloor.z && (loc.y === expFloor.y || loc.y === expFloor.y - 1)) continue;
    try {
      if (isAirBlock(getBlock(bot.dimension, loc))) return loc;
    } catch {}
  }
  return undefined;
}

function canPlaceEntityAt(dimension, location) {
  const feetBlock = getBlock(dimension, location);
  const headBlock = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  return isAirBlock(feetBlock) && isAirBlock(headBlock);
}

// [v0.5.0] サラウンド連携ユーティリティ（ユーザー実機指摘の是正）
// trySurroundTarget が囲いを開始/成立させた相手は runtime.surroundTargetId に記録される。
// 囲い進行中・成立後の「側面/足元からの起爆」は囲い黒曜石が相手の盾となり、
// 実機で「相手を守ってしまい自分だけ被弾する」状態を引き起こしていた。
// これを防ぐため、囲い済み相手には側面起爆に大減点、囲い真上（頭上）起爆に大ボーナスを与える。
function surroundActiveOn(bot, target, config) {
  try {
    const runtime = getRuntime(config.uid);
    if (runtime?.surroundTargetId !== String(target?.id)) return false;
    if (globalTick - Number(runtime.surroundSealTick ?? -9999) > SURROUND_SEAL_EXPIRE_TICKS) return false;
    return true;
  } catch { return false; }
}
function surroundPlacementScoreAdjust(yOffset) {
  // yOffset >= 1: 囲いの真上（頭上起爆）— 横レイは囲いに当たらず上から当てる唯一の経路
  // yOffset <= 0 : 側面・足元 — 囲いが相手の盾になるため実質禁止
  return yOffset >= 1 ? SURROUND_TOP_BONUS : -SURROUND_SIDE_PENALTY;
}

export function scanCrystalCandidates(bot, target, config) {
  const candidates = [];
  const botFloor = floorLocation(bot.location);
  const targetFloor = floorLocation(target.location);
  // [B-2] 予測位置（先回り設置ボーナス用）
  const predicted = predictTargetPosition(target, PREDICTION_TICKS_AHEAD);
  // [B-4] 起爆までの所要ティック（設置1tick + 起爆遅延）
  const detonateTicksAhead = 1 + Math.max(1, Math.floor(Number(config.crystalDetonateDelay ?? 0)));
  for (const offset of CRYSTAL_OFFSETS) {
    for (const yOffset of [-1, 0, 1, -2]) {
      const base = { x: targetFloor.x + offset.x, y: targetFloor.y + yOffset, z: targetFloor.z + offset.z };
      const block = getBlock(bot.dimension, base);
      let placementMode;
      if (isCrystalBaseBlock(block)) placementMode = "existing-base";
      else if (isAirBlock(block)) placementMode = "place-obsidian";
      else continue;
      if (placementMode === "place-obsidian") {
        if (!patchCanPlaceCombatBlock(bot, base)) continue;
      } else if (!patchCanInteractWithCombatBlock(bot, base)) continue;
      const crystalLocation = getExplosionLocation(base, "crystal");
      if (!canPlaceEntityAt(bot.dimension, { x: base.x, y: base.y + 1, z: base.z })) continue;
      const dist = distance(bot.location, crystalLocation);
      if (dist > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) continue;
      // [A-6] 推定は実仕様準拠（半径2P・当たり判定最近点・exposure・水中0）
      const rawTargetDamage = estimateExplosionDamage(target, crystalLocation, "crystal");
      const rawSelfDamage = estimateExplosionDamage(bot, crystalLocation, "crystal");
      const targetDamage = patchCalculateExpectedHealthDamage(target, rawTargetDamage, "entityExplosion");
      let selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "entityExplosion");
      if (targetDamage < 1) continue;
      
      let shieldBlock = undefined;
      if (config.blastMitigation) {
        const candidateShield = findShieldBlock(bot, crystalLocation);
        if (candidateShield && patchCanPlaceCombatBlock(bot, candidateShield)) {
          // 自傷がある程度出る（>=1.5）か安全閾値を超える場合は、直前手前ブロック設置を予約
          if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config) || selfDamage >= 1.5) {
            shieldBlock = candidateShield;
            selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage * 0.2, "entityExplosion");
          }
        }
      }
      if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) continue;
      
      // [0.6.0] 足元起爆メタ最優先: クリスタル中心 = base+1 のため
      //   yOffset -1 = 相手の足元と同高（最良）/ 0 = 腰（準最適）/ +1 = 頭の上（原則禁止）
      const surroundTop = surroundActiveOn(bot, target, config);
      if (yOffset >= 1 && !surroundTop) continue; // 頭上起爆は囲い中以外は選ばない
      let score = targetDamage - selfDamage * 0.5;
      if (yOffset <= -1) score += 10;      // 足元一致（メタの最適解）
      else if (yOffset === 0) score += 6;  // 腰（準最適）
      // [v0.5.0] サラウンド連携: 囲い済み相手は頭上起爆のみ有効（側面は囲いが相手の盾になる）
      if (surroundTop) score += surroundPlacementScoreAdjust(yOffset);
      // [B-7] 反転: Botが爆発より「下」にいることを評価（旧: 上にいる +2 は実戦メタと逆）
      // 低位にいる側は体の上面（爆風が当たらない側）を守り、相手の下面に被弾を与えられる。
      if (botFloor.y < crystalLocation.y) score += 2;
      if (placementMode === "existing-base") score += 3; // 消費節約（高さ評価を最優先に変更）
      // [B-2] 予測位置への先回りボーナス
      if (Math.hypot(base.x + 0.5 - predicted.x, base.z + 0.5 - predicted.z) <= 1.5 && Math.abs(base.y - Math.floor(predicted.y)) <= 1) score += PREDICTION_BONUS;
      // [B-4] i-frame明けジャスト起爆ボーナス (d-tap)
      score += iframeTimingBonus(target, detonateTicksAhead);
      
      candidates.push({ location: base, placementMode, targetDamage, selfDamage, score, shieldBlock });
    }
  }
  // [0.6.0] 既存基盤の絶対優先を廃止（頭上の既存クリスタル基盤が優先されて
  // 「頭より上で起爆」していた主因）。高さを含むスコアのみで選ぶ。
  candidates.sort((a, b) => b.score - a.score);
  try {
    if (Number(globalTick % 30) === 0) {
      const best = candidates[0];
      appendPersistentDebugLog("scan", `${config.displayName}: crystal cand=${candidates.length}${best ? ` best=${best.placementMode}@${Math.floor(best.location.x)},${Math.floor(best.location.y)},${Math.floor(best.location.z)} dmg=${best.targetDamage.toFixed(1)}` : ""} botDist=${distance(bot.location, target.location).toFixed(1)}`);
    }
  } catch {}
  return candidates;
}

export function scanAnchorCandidates(bot, target, config) {
  const candidates = [];
  const botFloor = floorLocation(bot.location);
  const targetFloor = floorLocation(target.location);
  const sameLevelOrAbove = botFloor.y >= targetFloor.y;
  for (const offset of CRYSTAL_OFFSETS) {
    // [0.7.0] アンカーも頭上(yOffset>=1)起爆は囲い中以外は禁止し、足元(0 / -1)を最優先にする
    for (const yOffset of [-1, 0, 1, -2]) {
      const base = { x: targetFloor.x + offset.x, y: targetFloor.y + yOffset, z: targetFloor.z + offset.z };
      const block = getBlock(bot.dimension, base);
      let placementMode, existingCharge = 0;
      if (block?.typeId === RESPAWN_ANCHOR_ID) {
        placementMode = "existing-anchor";
        try { existingCharge = block.permutation?.getState?.("respawn_anchor_charge") ?? 0; } catch {}
      } else if (isAirBlock(block)) {
        placementMode = "place-anchor";
      } else continue;
      if (placementMode === "place-anchor") {
        if (!patchCanPlaceCombatBlock(bot, base)) continue;
      } else if (!patchCanInteractWithCombatBlock(bot, base)) continue;
      const explosionLocation = getExplosionLocation(base, "anchor");
      const dist = distance(bot.location, explosionLocation);
      if (dist > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) continue;
      // [A-6] 推定は実仕様準拠
      const rawTargetDamage = estimateExplosionDamage(target, explosionLocation, "anchor");
      const rawSelfDamage = estimateExplosionDamage(bot, explosionLocation, "anchor");
      const targetDamage = patchCalculateExpectedHealthDamage(target, rawTargetDamage, "blockExplosion");
      let selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "blockExplosion");
      if (targetDamage < 1) continue;
      
      let shieldBlock = undefined;
      if (config.blastMitigation) {
        const candidateShield = findShieldBlock(bot, explosionLocation);
        if (candidateShield && patchCanPlaceCombatBlock(bot, candidateShield)) {
          // 連続アンカー+手前ブロック(anchorSpam)有効時、または自傷軽減が必要な時は直前遮蔽ブロックを予約
          if (config.anchorSpam !== false || !isExplosionCandidateSafe(bot, targetDamage, selfDamage, config) || selfDamage >= 1.0) {
            shieldBlock = candidateShield;
            selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage * 0.2, "blockExplosion");
          }
        }
      }
      if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) continue;

      const surroundTop = surroundActiveOn(bot, target, config);
      if (yOffset >= 1 && !surroundTop) continue; // 頭上アンカー起爆は囲い中以外は選ばない
      let score = targetDamage - selfDamage * 0.5;
      if (yOffset <= 0) score += 8; // 足元・地面高さのアンカー起爆を優先
      // [v0.5.0] サラウンド連携（アンカーも同様）
      if (surroundTop) score += surroundPlacementScoreAdjust(yOffset);
      // [B-4] i-frame明けジャスト起爆ボーナス (d-tap)
      score += iframeTimingBonus(target, 2 + Math.max(1, Math.floor(Number(config.anchorDetonateDelay ?? 3))));
      // [0.7.0] アンカー段差掘り戦術 (anchorStepDown):
      // 相手の足元周辺(yOffset <= 0)を爆破して段差を作り、自分が下に入って
      // 相手の地面の高さに黒曜石+クリスタルを差し込む競技メタを強く優先する。
      let isStepDownCandidate = false;
      if (yOffset <= 0 && Math.abs(offset.x) <= 2 && Math.abs(offset.z) <= 2) {
        try {
          if (isSolidBlock(getBlock(target.dimension, { x: targetFloor.x, y: targetFloor.y - 1, z: targetFloor.z }))) {
            score += (config.anchorStepDown !== false && sameLevelOrAbove) ? 16 : 8;
            isStepDownCandidate = true;
          }
        } catch {}
      }

      candidates.push({ location: base, placementMode, existingCharge, targetDamage, selfDamage, score, shieldBlock, isStepDownCandidate });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  try {
    if (Number(globalTick % 30) === 1) {
      const best = candidates[0];
      appendPersistentDebugLog("scan", `${config.displayName}: anchor cand=${candidates.length}${best ? ` best=${best.placementMode}${best.existingCharge ? `(${best.existingCharge})` : ""} stepDown=${!!best.isStepDownCandidate}` : ""}`);
    }
  } catch {}
  return candidates;
}

export function chooseBestExplosiveAction(bot, target, config) {
  // Slow Falling Prey Priority: skip hesitation decisions and proceed to execution directly
  const preyPriority = targetHasSlowFalling(target);
  if (!preyPriority) {
    if (patchShouldDelayAction(config, "explosive")) return undefined;
    if (patchRandomChance(config.suboptimalRate)) return undefined;
  }
  const runtime = getRuntime(config.uid);
  try {
    if (preyPriority && globalTick - Number(runtime.lastPreyPriorityLogTick ?? -9999) >= 30) {
      runtime.lastPreyPriorityLogTick = globalTick;
      appendPersistentDebugLog("combat", `${config.displayName}: prey priority engaged (target slow_falling)`);
    }
  } catch {}
  const anchorReady = config.anchorCombo && bot.dimension.id !== "minecraft:nether" && globalTick - runtime.lastAnchorTick >= config.anchorCooldown && !runtime.pendingAnchor;
  const crystalReady = config.crystalCombo && globalTick - runtime.lastCrystalTick >= config.crystalCooldown && !runtime.pendingCrystal;
  // [B-5] ベッド爆弾はオーバーワールド外でのみ選択可能
  const bedReady = config.bedCombo === true && bot.dimension.id !== "minecraft:overworld" &&
    globalTick - Number(runtime.lastBedTick ?? -9999) >= BED_COMBO_COOLDOWN_TICKS && !runtime.pendingBed;
  let bestAnchor, bestCrystal, bestBed;
  if (anchorReady) {
    const anchors = scanAnchorCandidates(bot, target, config);
    if (anchors.length) bestAnchor = anchors[0];
  }
  if (crystalReady) {
    const crystals = scanCrystalCandidates(bot, target, config);
    if (crystals.length) bestCrystal = crystals[0];
  }
  if (bedReady) {
    const beds = scanBedCandidates(bot, target, config);
    if (beds.length) bestBed = beds[0];
  }
  const options = [
    bestAnchor && { type: "anchor", candidate: bestAnchor },
    bestCrystal && { type: "crystal", candidate: bestCrystal },
    bestBed && { type: "bed", candidate: bestBed },
  ].filter(Boolean);
  if (!options.length) return undefined;
  options.sort((a, b) => b.candidate.score - a.candidate.score);
  return options[0];
}

// ── [B-5] ベッド爆弾候補スキャン（ネザー/ジ・エンド限定）──
function scanBedCandidates(bot, target, config) {
  const candidates = [];
  const targetFloor = floorLocation(target.location);
  for (const offset of CRYSTAL_OFFSETS) {
    for (const yOffset of [0, -1]) {
      const base = { x: targetFloor.x + offset.x, y: targetFloor.y + yOffset, z: targetFloor.z + offset.z };
      const block = getBlock(bot.dimension, base);
      if (!block || !isAirBlock(block)) continue;
      if (!patchCanPlaceCombatBlock(bot, base)) continue;
      // ベッドは2ブロック占有（foot+head）: head側も空いている必要がある
      const headAir = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
        const headBlock = getBlock(bot.dimension, { x: base.x + dx, y: base.y, z: base.z + dz });
        return headBlock && isAirBlock(headBlock);
      });
      if (!headAir) continue;
      const explosionLocation = { x: base.x + 0.5, y: base.y + 0.6, z: base.z + 0.5 };
      if (distance(bot.location, explosionLocation) > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) continue;
      // [A-6] 推定は実仕様準拠（ベッドは P=5 = アンカーと同威力）
      const rawTargetDamage = estimateExplosionDamage(target, explosionLocation, "bed");
      const rawSelfDamage = estimateExplosionDamage(bot, explosionLocation, "bed");
      const targetDamage = patchCalculateExpectedHealthDamage(target, rawTargetDamage, "blockExplosion");
      const selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "blockExplosion");
      if (targetDamage < 1) continue;
      if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) continue;
      let score = targetDamage - selfDamage * 0.5;
      if (yOffset === 0) score += 3; // 相手と同高の足元設置を軽く優先
      candidates.push({ location: base, placementMode: "place-bed", targetDamage, selfDamage, score, shieldBlock: undefined });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// ── [B-5] ベッド爆弾コンボ ──
export function handleBedCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (runtime.shieldGuardState?.active) return false;
  if (isSpawnProtected(config.uid)) return false;
  if (!config.bedCombo) return false;
  if (bot.dimension.id === "minecraft:overworld") return false; // オーバーワールドでは不発
  if (globalTick - Number(runtime.lastBedTick ?? -9999) < BED_COMBO_COOLDOWN_TICKS || runtime.pendingBed) return false;
  const best = selectedCandidate ?? scanBedCandidates(bot, target, config)[0];
  if (!best) return false;
  runtime.lastBedTick = globalTick;
  runtime.pendingBed = { base: best.location, targetId: target.id, targetEntity: target };
  faceBotToward(bot, { x: best.location.x + 0.5, y: best.location.y + 0.5, z: best.location.z + 0.5 });
  void (async () => {
    try {
      const placed = await placeBedWithFallback(bot.dimension, best.location, bot);
      if (!placed) { debugLog(bot, config, "combat", "§c[Bed] ベッド設置失敗", true); return; }
      await new Promise(resolve => system.runTimeout(resolve, 2));
      const result = await runBedExplosionWithFallback(bot.dimension, best.location, bot, bot);
      debugLog(bot, config, "combat", `§6[Bed] 起爆 mode=${result.mode}`, true);
      selectBestSword(bot);
    } catch {
      try { selectBestSword(bot); } catch {}
    } finally {
      runtime.pendingBed = undefined;
    }
  })();
  return true;
}

// ── Sword Combo ──
export function handleSwordCombo(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (runtime.shieldGuardState?.active) return;
  if (isSpawnProtected(config.uid)) return;
  const currentDistance = distance(bot.location, target.location);
  if (!config.swordCombo || currentDistance > SWORD_RANGE || currentDistance > MAX_INTERACT_DISTANCE) return;
  if (!patchHasCombatLineOfSight(bot, target)) { debugLog(bot, config, "combat", "壁越しの剣攻撃をスキップしました。"); return; }
  if (globalTick - runtime.lastSwordTick < config.swordCooldown) return;
  runtime.lastSwordTick = globalTick;
  if (patchShouldDelayAction(config, "sword")) return;
  const swordStats = selectBestSword(bot);
  faceBotToward(bot, patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.2, z: 0 }), config));
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  if (patchRandomChance(config.mistakeRate)) { debugLog(bot, config, "combat", "剣コンボを空振りしました。", true); return; }
  // [A-4] エンジン近接攻撃を優先する（SimulatedPlayer = 実プレイヤーの攻撃判定）。
  // 防具・EPF・無敵フレーム・ノックバック・火属性がすべてエンジン側で処理されるため、
  // 手動ノックバック(applyImpulse)と手動setOnFireはエンジン攻撃時には行わない。
  let usedEngine = false;
  // [P1][A-1] simulateAttack は存在しない。実在する attackEntity（ターゲット指定攻撃。
  // 上で距離3・LOS判定済みなので自己ゲート条件を満たす）を使う。攻撃CDはエンジン側。
  try {
    if (typeof bot.attackEntity === "function") { usedEngine = Boolean(bot.attackEntity(target)); }
    else if (typeof bot.attack === "function") { usedEngine = Boolean(bot.attack()); }
  } catch { usedEngine = false; }
  if (usedEngine) {
    debugLog(bot, config, "combat", `剣コンボ命中(engine): ${swordStats.damage}`, true);
  } else {
    // フォールバック: 従来のスクリプト適用（attackEntity 不可環境向け）
    const direction = normalize2D(vectorTo(bot.location, target.location));
    const finalDamage = patchCalculateNetDamage(target, swordStats.damage, "entityAttack");
    patchApplyDamageWithFallback(target, finalDamage, "entityAttack", bot);
    try { target.applyImpulse({ x: direction.x * (0.18 + swordStats.knockbackLevel * 0.05), y: 0.04, z: direction.z * (0.18 + swordStats.knockbackLevel * 0.05) }); } catch {}
    if (swordStats.fireAspectLevel > 0) { try { target.setOnFire(4 * swordStats.fireAspectLevel, true); } catch {} }
    debugLog(bot, config, "combat", `剣コンボ命中(script): raw=${swordStats.damage} final=${finalDamage}`, true);
  }
  // [B-1] ヒットクリスタリング: 相手が浮いたら着地点へ先回り設置に移る
  handleHitCrystalling(bot, target, config, true);
}

// ── [B-1 / 0.7.0] ヒットクリスタリング + d-tap 連続爆破シーケンス ──
// 同じ高さにいる時、ノックバック付きの剣で殴って相手が浮き上がった瞬間に
// 相手の足元の地面セルへ黒曜石を置くことで、その黒曜石の上面(=base+1)が
// 浮き上がった相手の足元の高さになる。そこにクリスタルを設置→直前手前遮蔽→爆破し、
// さらに無敵フレーム(10tick)明けに連続でクリスタルを設置・爆破(d-tap)して
// 両手にトーテムを持っていても2個くらい一気に割る競技コンボ。
const HIT_CRYSTAL = { IDLE: 0, LAUNCHED: 1, PRIMED: 2 };

function getEntityVelocitySafe(entity) {
  try { return { ...entity.velocity }; } catch { return { x: 0, y: 0, z: 0 }; }
}

// Java物理で着地点を予測（重力 0.08・摩擦 ×0.91）
function predictLandingLocation(target, maxTicks = 14) {
  let v = getEntityVelocitySafe(target);
  let x = target.location.x, y = target.location.y, z = target.location.z;
  for (let i = 0; i < maxTicks; i++) {
    const nx = x + v.x, ny = y + v.y, nz = z + v.z;
    if (v.y <= 0) {
      try {
        const below = getBlock(target.dimension, { x: Math.floor(nx), y: Math.floor(ny - 0.2), z: Math.floor(nz) });
        if (isSolidBlock(below)) return { x: Math.floor(nx), y: Math.floor(ny), z: Math.floor(nz) };
      } catch {}
    }
    x = nx; y = ny; z = nz;
    v.y = Math.max(v.y - JAVA_GRAVITY_PER_TICK, JAVA_TERMINAL_VELOCITY);
    v.x *= JAVA_FRICTION_PER_TICK; v.z *= JAVA_FRICTION_PER_TICK;
  }
  return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

// 浮いた相手の地面セル（上面が空中足元高さになる黒曜石位置）または着地点から最良の候補を構築
function buildLandingCandidate(bot, target, config, landing, groundFloorY) {
  const targetFloor = floorLocation(target.location);
  const kbDir = normalize2D(vectorTo(bot.location, target.location));
  const baseY = Number.isFinite(groundFloorY) ? groundFloorY : Math.floor(landing.y);
  // 第1優先: 相手が浮いた直後の真下地面セル / ノックバック1歩先の地面セル
  // （ここに黒曜石を置くと上面 baseY+1 が浮いた相手の足元の高さに一致する）
  const candidateBases = [
    { x: Math.floor(target.location.x + kbDir.x * 0.8), y: baseY, z: Math.floor(target.location.z + kbDir.z * 0.8) },
    { x: targetFloor.x, y: baseY, z: targetFloor.z },
    floorLocation(landing),
    { x: Math.floor(landing.x), y: baseY - 1, z: Math.floor(landing.z) },
  ];
  for (const base of candidateBases) {
    const block = getBlock(bot.dimension, base);
    let placementMode;
    if (isCrystalBaseBlock(block)) placementMode = "existing-base";
    else if (isAirBlock(block)) placementMode = "place-obsidian";
    else continue;
    if (placementMode === "place-obsidian") {
      if (!patchCanPlaceCombatBlock(bot, base)) continue;
    } else if (!patchCanInteractWithCombatBlock(bot, base)) continue;
    if (!canPlaceEntityAt(bot.dimension, { x: base.x, y: base.y + 1, z: base.z })) continue;
    const crystalLocation = getExplosionLocation(base, "crystal");
    if (distance(bot.location, crystalLocation) > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) continue;
    const rawTargetDamage = estimateExplosionDamage(target, crystalLocation, "crystal");
    const rawSelfDamage = estimateExplosionDamage(bot, crystalLocation, "crystal");
    const targetDamage = Math.max(4, patchCalculateExpectedHealthDamage(target, rawTargetDamage, "entityExplosion"));
    let selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "entityExplosion");
    let shieldBlock = undefined;
    if (config.blastMitigation) {
      const candidateShield = findShieldBlock(bot, crystalLocation);
      if (candidateShield && patchCanPlaceCombatBlock(bot, candidateShield)) {
        if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config) || selfDamage >= 1.5) {
          shieldBlock = candidateShield;
          selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage * 0.2, "entityExplosion");
        }
      }
    }
    if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) continue;
    return { location: base, placementMode, targetDamage, selfDamage, score: 999, shieldBlock, isDtap: true };
  }
  return undefined;
}

export function handleHitCrystalling(bot, target, config, swordHitLanded) {
  try {
    const runtime = getRuntime(config.uid);
    if (!config.crystalCombo || config.dtapCombo === false) return;
    const state = Number(runtime.hitCrystalState?.state ?? HIT_CRYSTAL.IDLE);
    if (state === HIT_CRYSTAL.IDLE) {
      if (!swordHitLanded) return;
      const groundFloorY = Math.floor(target.location.y);
      // 剣ヒット直後（同tickまたは1tick後）に浮き上がりを検知して即座に地面黒曜石→d-tapへ移行
      const tryLaunch = () => {
        try {
          if (!bot?.isValid || !target?.isValid) return;
          const v = getEntityVelocitySafe(target);
          const airborne = v.y > HIT_CRYSTAL_LAUNCH_VELOCITY || target.location.y - groundFloorY >= 0.15;
          const landing = predictLandingLocation(target, 10);
          runtime.hitCrystalState = {
            state: HIT_CRYSTAL.LAUNCHED,
            landing,
            groundFloorY,
            since: globalTick,
            burstsRemaining: DTAP_COMBO_MAX_BURSTS,
          };
          debugLog(bot, config, "combat", `§d[HitCrystal/d-tap] 剣KB浮き(${airborne ? "air" : "ground"}) v.y=${v.y.toFixed(2)} groundY=${groundFloorY} -> 足元黒曜石設置へ`, true);
          appendPersistentDebugLog("combat", `${config.displayName}: d-tap launched v.y=${v.y.toFixed(2)} groundY=${groundFloorY}`);
          const candidate = buildLandingCandidate(bot, target, config, landing, groundFloorY);
          if (candidate) {
            runtime.hitCrystalState.state = HIT_CRYSTAL.PRIMED;
            runtime.hitCrystalState.base = candidate.location;
            runtime.lastCrystalTick = -9999; // CDをバイパスして即座に差し込む
            handleCrystalCombo(bot, target, config, candidate);
          }
        } catch {}
      };
      // エンジン攻撃のノックバック速度が1tick後に乗るケースにも対応
      const vNow = getEntityVelocitySafe(target);
      if (vNow.y > HIT_CRYSTAL_LAUNCH_VELOCITY) {
        tryLaunch();
      } else {
        system.runTimeout(tryLaunch, 1);
      }
      return;
    }
    if (globalTick - Number(runtime.hitCrystalState?.since ?? globalTick) > 36) {
      runtime.hitCrystalState = undefined; // タイムアウト: 通常コンボに戻る
      return;
    }
    if (state === HIT_CRYSTAL.LAUNCHED) {
      const landing = runtime.hitCrystalState.landing;
      const groundFloorY = runtime.hitCrystalState.groundFloorY;
      const candidate = buildLandingCandidate(bot, target, config, landing, groundFloorY);
      if (candidate) {
        runtime.hitCrystalState = {
          ...runtime.hitCrystalState,
          state: HIT_CRYSTAL.PRIMED,
          since: globalTick,
          base: candidate.location,
        };
        runtime.lastCrystalTick = -9999;
        handleCrystalCombo(bot, target, config, candidate);
      }
      return;
    }
    // PRIMED: 起爆待ち＆d-tap連続追撃は handleCrystalCombo 側で処理する
  } catch {}
}

// ── Anchor Combo ──
function shouldUseAnchorCombo(bot, target, config) {
  if (!config.anchorCombo) return false;
  if (bot.dimension.id === "minecraft:nether") return false;
  return distance(bot.location, target.location) <= PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE;
}

export function handleAnchorCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (runtime.shieldGuardState?.active) return false;
  if (isSpawnProtected(config.uid)) return false;
  if (!shouldUseAnchorCombo(bot, target, config)) return false;
  if (globalTick - runtime.lastAnchorTick < config.anchorCooldown || runtime.pendingAnchor) return false;
  const best = selectedCandidate ?? scanAnchorCandidates(bot, target, config)[0];
  if (!best) return false;
  runtime.lastAnchorTick = globalTick;
  runtime.pendingAnchor = {
    base: best.location, placementMode: best.placementMode,
    existingCharge: Math.max(0, Number(best.existingCharge ?? 0)),
    needsCharge: best.placementMode === "place-anchor" || Number(best.existingCharge ?? 0) <= 0,
    targetId: target.id, targetEntity: target, targetDamage: best.targetDamage, selfDamage: best.selfDamage,
    shieldBlock: best.shieldBlock,
    isStepDownCandidate: !!best.isStepDownCandidate,
    chainCount: Number(best.chainCount ?? 1),
  };
  faceBotToward(bot, { x: best.location.x + 0.5, y: best.location.y + 0.5, z: best.location.z + 0.5 });
  const detonateDelay = Math.max(1, Math.floor(Number(config.anchorDetonateDelay ?? 3)));

  // Helper: resolve target — tries direct ref first, then ID lookup
  function resolveAnchorTarget(pending) {
    try { if (pending.targetEntity && isEntityUsable(pending.targetEntity)) return pending.targetEntity; } catch {}
    return patchResolvePendingCombatTarget(bot, pending, runtime);
  }

  void (async () => {
    const pending = runtime.pendingAnchor;
    if (!pending) return;
    let resolvedTarget = target;
    const result = await patchRunAnchorPlaceAndDetonateSequence(bot.dimension, pending.base, bot, {
      placementMode: pending.placementMode, existingCharge: pending.existingCharge,
      needsCharge: pending.needsCharge, detonateDelay,
      explosionOptions: { ignoreCenterAnchorChange: true, requireFullNativeBreakPattern: true, useBreakCache: config.anchorBreakCache ?? true },
      cleanupIfCancelled: true,
      // [0.7.0] 1. まずアンカー本体を先に設置する（手前ブロックはまだ置かない）
      beforePlace: async () => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (pending.placementMode === "place-anchor" && !patchCanPlaceCombatBlock(bot, pending.base)) return false;
        if (pending.placementMode !== "place-anchor" && !patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        if (!equipMainhandItem(bot, RESPAWN_ANCHOR_ID, config) || !consumeManagedItem(bot, config, RESPAWN_ANCHOR_ID, 1)) return false;
        return true;
      },
      onPlaced: async () => {},
      // [0.7.0] 2. グロウストーンでアンカーをチャージする
      beforeCharge: async () => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (!patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        if (!equipMainhandItem(bot, GLOWSTONE_ID, config) || !consumeManagedItem(bot, config, GLOWSTONE_ID, 1)) return false;
        return true;
      },
      onCharged: async () => {},
      // [0.7.0] 3. チャージ完了後、爆破する「直前(final)」に手前へ遮蔽ブロックを設置してから起爆する！
      beforeExplode: async (stage) => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (!patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        const isFinal = stage === "final" || !pending.needsCharge;
        if (isFinal && config.blastMitigation) {
          const explosionLoc = getExplosionLocation(pending.base, "anchor");
          const shieldLoc = (pending.shieldBlock && patchCanPlaceCombatBlock(bot, pending.shieldBlock))
            ? pending.shieldBlock
            : findShieldBlock(bot, explosionLoc);
          if (shieldLoc && patchCanPlaceCombatBlock(bot, shieldLoc)) {
            if (equipMainhandItem(bot, OBSIDIAN_ID, config) && consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) {
              const { setBlockIdWithFallback } = await import("./explosion.js");
              await setBlockIdWithFallback(bot.dimension, shieldLoc, OBSIDIAN_ID, "keep");
              debugLog(bot, config, "combat", `§6[Anchor] 爆破直前に手前遮蔽ブロック設置 @${shieldLoc.x},${shieldLoc.y},${shieldLoc.z}`, true);
            }
          }
        }
        faceBotToward(bot, { x: pending.base.x + 0.5, y: pending.base.y + 0.5, z: pending.base.z + 0.5 });
        return true;
      },
    });
    if (runtime.pendingAnchor === pending) runtime.pendingAnchor = undefined;
    if (result?.cancelled) return;
    selectBestSword(bot);
    if (patchIsCombatTargetUsable(resolvedTarget, bot.dimension)) {
      setBotLookAt(bot, addVector(resolvedTarget.location, { x: 0, y: 1.1, z: 0 }));
      // [0.7.0] アンカー起爆後の連携戦術:
      // (A) アンカーで作った段差(クレーター)へ即座に下潜り誘導し、相手の地面高さに黒曜石+足元クリスタルを差し込む
      // (B) または連続アンカー+手前ブロック連打(anchorSpam)で継続的に大ダメージを与え続ける
      system.runTimeout(() => {
        try {
          if (!bot?.isValid || !resolvedTarget?.isValid) return;
          if (config.anchorStepDown !== false && config.crystalCombo) {
            // アンカー爆発で掘れた低いセルへローグラウンド目標をセット
            const craterGoal = { x: pending.base.x + 0.5, y: Math.min(Math.floor(bot.location.y), pending.base.y - 1), z: pending.base.z + 0.5 };
            runtime.lowGroundGoal = craterGoal;
            runtime.lowGroundUntilTick = globalTick + 35;
            // 相手の足元高さ(yOffset <= -1)に置けるクリスタル候補があれば即座に黒曜石+クリスタル追撃
            const followCrystals = scanCrystalCandidates(bot, resolvedTarget, config);
            const feetCrystal = followCrystals.find(c => c.location.y <= Math.floor(resolvedTarget.location.y) - 1) ?? followCrystals[0];
            if (feetCrystal && !runtime.pendingCrystal) {
              runtime.lastCrystalTick = -9999;
              debugLog(bot, config, "combat", `§6[Anchor->Crystal] アンカー段差から足元黒曜石+クリスタル連携 @${feetCrystal.location.x},${feetCrystal.location.y},${feetCrystal.location.z}`, true);
              appendPersistentDebugLog("combat", `${config.displayName}: anchor step-down -> feet crystal @${feetCrystal.location.x},${feetCrystal.location.y},${feetCrystal.location.z}`);
              handleCrystalCombo(bot, resolvedTarget, config, feetCrystal);
              return;
            }
          }
          // (B) 連続アンカー+手前ブロック連打 (anchorSpam)
          if (config.anchorSpam !== false && pending.chainCount < ANCHOR_SPAM_MAX_CHAIN && !runtime.pendingAnchor) {
            const nextAnchors = scanAnchorCandidates(bot, resolvedTarget, config);
            if (nextAnchors.length) {
              const next = { ...nextAnchors[0], chainCount: pending.chainCount + 1 };
              runtime.lastAnchorTick = -9999;
              debugLog(bot, config, "combat", `§6[AnchorSpam] 連続アンカー連撃 #${next.chainCount}/${ANCHOR_SPAM_MAX_CHAIN}`, true);
              appendPersistentDebugLog("combat", `${config.displayName}: anchor spam chain #${next.chainCount}`);
              handleAnchorCombo(bot, resolvedTarget, config, next);
            }
          }
        } catch {}
      }, 2);
    }
  })();
  return true;
}


// ── Crystal Combo ──
export function handleCrystalCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (runtime.shieldGuardState?.active) return false;
  if (isSpawnProtected(config.uid)) return false;
  if (!config.crystalCombo) return false;
  if (globalTick - runtime.lastCrystalTick < config.crystalCooldown || runtime.pendingCrystal) return false;
  const best = selectedCandidate ?? scanCrystalCandidates(bot, target, config)[0];
  if (!best) return false;
  runtime.lastCrystalTick = globalTick;
  // Store both id and direct entity reference for robust resolution
  runtime.pendingCrystal = {
    base: best.location, restoreBlockId: AIR_ID, placementMode: best.placementMode,
    targetId: target.id, targetEntity: target, shieldBlock: best.shieldBlock,
    isDtap: !!best.isDtap, dtapBurst: Number(best.dtapBurst ?? 1),
  };
  faceBotToward(bot, { x: best.location.x + 0.5, y: best.location.y + 0.5, z: best.location.z + 0.5 });
  const baseBlock = getBlock(bot.dimension, best.location);
  if (best.placementMode === "place-obsidian" && !patchCanPlaceCombatBlock(bot, best.location)) { runtime.pendingCrystal = undefined; return false; }
  if (best.placementMode !== "place-obsidian" && !patchCanInteractWithCombatBlock(bot, best.location)) { runtime.pendingCrystal = undefined; return false; }
  if (best.placementMode === "existing-base" && !isCrystalBaseBlock(baseBlock)) { runtime.pendingCrystal = undefined; return false; }

  if (best.placementMode === "place-obsidian") {
    if (!equipMainhandItem(bot, OBSIDIAN_ID, config) || !consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) {
      runtime.pendingCrystal = undefined; return false;
    }
  }

  // Helper: resolve target from pending — tries direct ref first, then ID lookup
  function resolveTarget(pending) {
    try { if (pending.targetEntity && isEntityUsable(pending.targetEntity)) return pending.targetEntity; } catch {}
    return patchResolvePendingCombatTarget(bot, pending, runtime);
  }

  void (async () => {
    // [0.7.0] 1. まず攻撃用の黒曜石（基礎）だけを先に設置する（手前遮蔽ブロックはまだ置かない）
    if (best.placementMode === "place-obsidian") {
      const { setBlockIdWithFallback } = await import("./explosion.js");
      if (!patchCanPlaceCombatBlock(bot, best.location)) { debugLog(bot, config, "combat", "§c[Crystal] 黒曜石設置不可、中断", true); runtime.pendingCrystal = undefined; return; }
      if (!(await setBlockIdWithFallback(bot.dimension, best.location, OBSIDIAN_ID, "keep"))) { debugLog(bot, config, "combat", "§c[Crystal] 黒曜石設置失敗、中断", true); runtime.pendingCrystal = undefined; return; }
    }
    debugLog(bot, config, "combat", `§e[Crystal] 基礎準備完了、1tick後にクリスタル設置 mode=${best.placementMode}`, true);
    system.runTimeout(() => {
      const pending = runtime.pendingCrystal;
      runtime.pendingCrystal = undefined;
      if (!pending) { debugLog(bot, config, "combat", "§c[Crystal] pendingCrystal消失、中断", true); return; }
      void (async () => {
        const liveTarget = resolveTarget(pending);
        if (!liveTarget) { debugLog(bot, config, "combat", `§c[Crystal] ターゲット解決失敗 id=${pending.targetId} entityValid=${!!pending.targetEntity}`, true); return; }
        const crystalLocation = getExplosionLocation(pending.base, "crystal");
        const existingCrystalIds = new Set();
        for (const entity of patchGetNearbyCrystalEntities(bot.dimension, crystalLocation)) existingCrystalIds.add(entity.id);
        const equipOk = equipMainhandItem(bot, END_CRYSTAL_ID, config);
        if (!equipOk) { debugLog(bot, config, "combat", "§c[Crystal] クリスタル装備失敗、中断", true); return; }
        const consumeOk = consumeManagedItem(bot, config, END_CRYSTAL_ID, 1);
        if (!consumeOk) { debugLog(bot, config, "combat", "§c[Crystal] クリスタル消費失敗、中断", true); return; }
        // [0.7.0] 2. クリスタル本体を先に設置する
        let summonResult;
        try { summonResult = await spawnEntityWithFallback(bot.dimension, END_CRYSTAL_ENTITY_ID, crystalLocation); } catch (err) { debugLog(bot, config, "combat", `§c[Crystal] スポーン例外: ${err}`, true); return; }
        let crystal;
        try {
          const candidates = patchGetNearbyCrystalEntities(bot.dimension, crystalLocation);
          crystal = candidates.find(e => !existingCrystalIds.has(e.id)) ?? candidates.sort((a, b) => distanceSquared(a.location, crystalLocation) - distanceSquared(b.location, crystalLocation))[0];
        } catch {}
        if (!crystal && Number(summonResult?.successCount ?? 0) <= 0) { debugLog(bot, config, "combat", "§c[Crystal] クリスタルエンティティ不在＆スポーン失敗、中断", true); return; }
        debugLog(bot, config, "combat", `§a[Crystal] クリスタル設置完了 -> 爆破直前に手前ブロック配置＆起爆へ`, true);
        const detonateDelay = Math.max(1, Math.floor(Number(config.crystalDetonateDelay ?? 0)));
        system.runTimeout(() => {
          void (async () => {
            const tryDetonate = async () => {
              let resolvedCrystal = crystal;
              if (!resolvedCrystal) {
                try { resolvedCrystal = patchGetNearbyCrystalEntities(bot.dimension, crystalLocation).sort((a, b) => distanceSquared(a.location, crystalLocation) - distanceSquared(b.location, crystalLocation))[0]; } catch {}
              }
              const liveTarget2 = resolveTarget(pending);
              if (!liveTarget2) { try { resolvedCrystal?.remove(); } catch {} selectBestSword(bot); debugLog(bot, config, "combat", "§c[Crystal] 起爆時ターゲット不在、中断", true); return; }
              // [B-1] ヒットクリスタリング中は相手の頂点〜落下開始 (v.y <= 0.08) を待ってから起爆する
              const hc = getRuntime(config.uid).hitCrystalState;
              if (hc?.state === 2 && pending.dtapBurst === 1) {
                let v = { y: 0 };
                try { v = liveTarget2.velocity ?? v; } catch {}
                if (v.y > 0.08 && globalTick - Number(hc.since ?? globalTick) < HIT_CRYSTAL_TIMEOUT_TICKS) {
                  system.runTimeout(() => { void tryDetonate().catch(() => {}); }, 1);
                  return;
                }
              }
              // [0.7.0] 3. クリスタル設置後、爆破する「直前」に手前に遮蔽ブロックを配置してから爆破する！
              if (config.blastMitigation) {
                const shieldLoc = (pending.shieldBlock && patchCanPlaceCombatBlock(bot, pending.shieldBlock))
                  ? pending.shieldBlock
                  : findShieldBlock(bot, crystalLocation);
                if (shieldLoc && patchCanPlaceCombatBlock(bot, shieldLoc)) {
                  if (equipMainhandItem(bot, OBSIDIAN_ID, config) && consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) {
                    const { setBlockIdWithFallback } = await import("./explosion.js");
                    await setBlockIdWithFallback(bot.dimension, shieldLoc, OBSIDIAN_ID, "keep");
                    debugLog(bot, config, "combat", `§e[Crystal] 爆破直前に手前遮蔽ブロック設置 @${shieldLoc.x},${shieldLoc.y},${shieldLoc.z}`, true);
                  }
                }
              }
              await runCrystalExplosionWithFallback(bot.dimension, pending.base, bot, resolvedCrystal);
              try { resolvedCrystal?.remove(); } catch {}
              selectBestSword(bot);
              setBotLookAt(bot, addVector(liveTarget2.location, { x: 0, y: 1.1, z: 0 }));
              debugLog(bot, config, "combat", `§a[Crystal] 起爆完了 (burst=#${pending.dtapBurst})`, true);

              // [0.7.0] 4. d-tap 連続クリスタル爆破:
              // 1発目の爆破後、同じ足元黒曜石(または最新の最適足元)に即座に次のクリスタルを置き、
              // 相手の無敵時間(i-frame)が明ける瞬間に連続起爆して両手トーテムも2個以上割る。
              if (config.dtapCombo !== false && pending.dtapBurst < DTAP_COMBO_MAX_BURSTS) {
                const nextBurst = pending.dtapBurst + 1;
                // 無敵時間明けにジャストで当たるよう次の設置をスケジュール
                const nextDelay = Math.max(1, DTAP_FOLLOWUP_DELAY_TICKS - detonateDelay - 2);
                system.runTimeout(() => {
                  try {
                    if (!bot?.isValid || !liveTarget2?.isValid || runtime.pendingCrystal) return;
                    const baseBlockNow = getBlock(bot.dimension, pending.base);
                    let nextCand;
                    if (isCrystalBaseBlock(baseBlockNow) &&
                        patchCanInteractWithCombatBlock(bot, pending.base) &&
                        canPlaceEntityAt(bot.dimension, { x: pending.base.x, y: pending.base.y + 1, z: pending.base.z })) {
                      nextCand = {
                        location: pending.base,
                        placementMode: "existing-base",
                        targetDamage: 12,
                        selfDamage: 1,
                        score: 999,
                        shieldBlock: findShieldBlock(bot, crystalLocation),
                        isDtap: true,
                        dtapBurst: nextBurst,
                      };
                    } else {
                      const scanned = scanCrystalCandidates(bot, liveTarget2, config);
                      if (scanned.length) {
                        nextCand = { ...scanned[0], isDtap: true, dtapBurst: nextBurst };
                      }
                    }
                    if (nextCand) {
                      runtime.lastCrystalTick = -9999;
                      debugLog(bot, config, "combat", `§d[d-tap] 連続クリスタル追撃 #${nextBurst}/${DTAP_COMBO_MAX_BURSTS}`, true);
                      appendPersistentDebugLog("combat", `${config.displayName}: d-tap followup burst #${nextBurst}/${DTAP_COMBO_MAX_BURSTS}`);
                      handleCrystalCombo(bot, liveTarget2, config, nextCand);
                    } else {
                      runtime.hitCrystalState = undefined;
                    }
                  } catch {
                    runtime.hitCrystalState = undefined;
                  }
                }, nextDelay);
              } else {
                runtime.hitCrystalState = undefined;
              }
            };
            await tryDetonate();
          })();
        }, detonateDelay);
      })();
    }, 1);
  })();
  return true;
}

// ── Sim Threat Defense ──
const INBOUND_PROJECTILE_IDS = [
  "minecraft:arrow", "minecraft:tipped_arrow", "minecraft:thrown_trident",
  "minecraft:splash_potion", "minecraft:snowball", "minecraft:egg", "minecraft:firework_rocket",
];

function normalizeVector3(vec) {
  const len = Math.hypot(vec.x, vec.y, vec.z) || 1;
  return { x: vec.x / len, y: vec.y / len, z: vec.z / len };
}

function findInboundProjectile(bot, target) {
  let best, bestScore = -Infinity;
  try {
    const entities = bot.dimension.getEntities({ location: bot.location, maxDistance: 9 });
    for (const entity of entities) {
      try {
        if (!INBOUND_PROJECTILE_IDS.includes(entity.typeId)) continue;
        // [0.7.0] 自分自身(Bot)が発射した矢は脅威として扱わない
        if (pendingBowArrows.has(String(entity.id))) continue;
        const vel = entity.velocity;
        if (Math.hypot(vel.x, vel.y, vel.z) < 0.05) continue;
        const toBot = vectorTo(entity.location, { x: bot.location.x, y: bot.location.y + 1.2, z: bot.location.z });
        const dot = vel.x * toBot.x + vel.y * toBot.y + vel.z * toBot.z;
        if (dot <= 0) continue;
        const score = dot / Math.max(0.5, distance(entity.location, bot.location));
        if (score > bestScore) { bestScore = score; best = entity; }
      } catch {}
    }
  } catch {}
  return best;
}

// A human can only set a block when a solid face exists to click against.
function hasHumanPlaceSupport(dimension, location) {
  const offsets = [
    { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  ];
  try {
    for (const off of offsets) {
      const probe = getBlock(dimension, addVector(location, off));
      if (probe && !isAirBlock(probe)) return true;
    }
  } catch {}
  return false;
}

// [v0.5.0] 緊急遮蔽設置の全面的な改修（ユーザー実機指摘「ブロックを手前に置くとダメージが軽減
// されるってやつは全然置けてない」の是正）。
// 旧実装の失敗原因:
//   1. 候補が「脅威方向1.5ブロック×(頭,足)の2箇所」しかなく、頭レベル(dy=1)を先に試していた。
//      頭レベルは下が空気のことが多く hasHumanPlaceSupport が恒常的に失敗していた。
//   2. isBotOnGround 必須だった。実プレイヤーはジャンプ中でも隣接固体面への設置は可能で、
//      ノックバックで浮いている間に脅威が来ると一切反応できなかった。
//   3. 実質的な遮蔽は「足レベル1個」で十分に機能する（爆発レイの大半は低い軌道を通る）。
// 新実装: 足レベル優先・候補は脅威直線上 r=1.0/1.5/2.0、可能なら頭レベルも追加し
// 2段遮蔽にする。onGround制約は撤廃（support面の条件のみ残す＝実プレイヤーと同一制約）。
async function placeEmergencyProtectBlock(bot, threatLocation, config, reason) {
  const dist = distance(bot.location, threatLocation);
  if (dist < 2.2) return false;
  const dir = normalize2D(vectorTo(bot.location, threatLocation));
  if (!dir || (Math.abs(dir.x) < 0.01 && Math.abs(dir.z) < 0.01)) {
    // 脅威が真上/真下: 足元の隣接面が使える適当な方向へ
    dir.x = 0.71; dir.z = 0.71;
  }
  const candidateAt = (r, dy) => ({
    x: Math.floor(bot.location.x + dir.x * r),
    y: Math.floor(bot.location.y + dy),
    z: Math.floor(bot.location.z + dir.z * r),
  });
  const feetOptions = [candidateAt(1.0, 0), candidateAt(1.5, 0), candidateAt(2.0, 0)];
  const headOptions = [candidateAt(1.0, 1), candidateAt(1.5, 1)];
  const botCell = floorLocation(bot.location);
  const canPlaceAt = (loc) => {
    try {
      // [0.5.4] bot 自身の足元セルには置かない（自己埋没→窒息の防止）
      if (loc.x === botCell.x && loc.z === botCell.z && loc.y === botCell.y) return false;
      if (!isAirBlock(getBlock(bot.dimension, loc))) return false;
      return hasHumanPlaceSupport(bot.dimension, loc);
    } catch { return false; }
  };
  const tryPlaceObsidian = async (loc) => {
    if (!equipMainhandItem(bot, OBSIDIAN_ID, config)) return false;
    faceBotToward(bot, threatLocation);
    try {
      const { setBlockIdWithFallback } = await import("./explosion.js");
      return Boolean(await setBlockIdWithFallback(bot.dimension, loc, OBSIDIAN_ID, "keep"));
    } catch { return false; }
  };
  let placed = 0;
  let shieldLoc;
  // 第1優先: 足レベル（爆発レイの大半を遮る）
  for (const loc of feetOptions) {
    if (canPlaceAt(loc)) { if (await tryPlaceObsidian(loc)) { placed++; shieldLoc = loc; } break; }
  }
  // 第2優先: 頭レベル（2段遮蔽で exposure をさらに削る）
  if (placed > 0) {
    for (const loc of headOptions) {
      if (canPlaceAt(loc)) { if (await tryPlaceObsidian(loc)) placed++; break; }
    }
  }
  if (!placed) return false;
  selectBestSword(bot);
  debugLog(bot, config, "def", `\u00a7b[Defense] shield place(${reason}) blocks=${placed} y=${shieldLoc ? shieldLoc.y - Math.floor(bot.location.y) : "?"} dist=${dist.toFixed(1)}`, true);
  return true;
}

export async function handleSimThreatDefense(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) return;
  if (runtime.shieldGuardState?.active) return;
  const projectile = findInboundProjectile(bot);
  // [0.5.4] 矢が飛んでくるたびに黒曜石を積むのは過剰（置きすぎで動けなくなる主因）。
  // 盾ガードが対応中の時は置かず、CD も 12→40tick に延長。
  if (projectile && !runtime.shieldGuardState?.active &&
      globalTick - Number(runtime.lastProjectProtectTick ?? -9999) >= 40) {
    runtime.lastProjectProtectTick = globalTick;
    if (config.blastMitigation) await placeEmergencyProtectBlock(bot, projectile.location, config, "projectile");
    const fleeDir = normalize2D(vectorTo(projectile.location, bot.location));
    try { bot.applyImpulse({ x: fleeDir.x * 0.3, y: 0.04, z: fleeDir.z * 0.3 }); } catch {}
  }
  // [v0.5.0] スキャン間隔 10→4tick・遮蔽CD 16→8tick（相手の設置→起爆（人間は約7tick）に間に合わせる）
  if (globalTick - Number(runtime.lastThreatScanTick ?? -9999) >= DEFENSE_SCAN_TICKS) {
    runtime.lastThreatScanTick = globalTick;
    let hostile;
    try {
      const found = [];
      for (const entity of bot.dimension.getEntities({ location: bot.location, maxDistance: DEFENSE_THREAT_RADIUS })) {
        try {
          if (entity.typeId !== END_CRYSTAL_ENTITY_ID) continue;
          const pending = runtime.pendingCrystal;
          if (pending?.base && Math.floor(entity.location.x) === Math.floor(pending.base.x) && Math.floor(entity.location.z) === Math.floor(pending.base.z)) continue;
          found.push({ location: entity.location, d: distance(entity.location, bot.location) });
        } catch {}
      }
      found.sort((a, b) => a.d - b.d);
      hostile = found[0];
    } catch {}
    // [v0.5.0] チャージ済みアンカー（ブロック）も脅威として検知する。
    // 旧実装はエンティティ（クリスタル）しか見ていなかったため、アンカー攻撃に全く反応できなかった。
    if (!hostile && target?.isValid) {
      try {
        const tf = floorLocation(target.location);
        let bestAnchor;
        for (const off of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]) {
          const loc = { x: tf.x + off[0], y: tf.y, z: tf.z + off[1] };
          const block = getBlock(bot.dimension, loc);
          if (block?.typeId !== RESPAWN_ANCHOR_ID) continue;
          let charge = 0;
          try { charge = block.permutation?.getState?.("respawn_anchor_charge") ?? 0; } catch {}
          if (charge <= 0) continue;
          const d = distance(bot.location, { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
          if (d <= DEFENSE_THREAT_RADIUS && (!bestAnchor || d < bestAnchor.d)) {
            bestAnchor = { location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 }, d };
          }
        }
        if (bestAnchor) { hostile = bestAnchor; hostile.isAnchor = true; }
      } catch {}
    }
    if (hostile && hostile.d < DEFENSE_THREAT_RADIUS && globalTick - Number(runtime.lastThreatBlockTick ?? -9999) >= DEFENSE_BLOCK_CD_TICKS) {
      runtime.lastThreatBlockTick = globalTick;
      if (config.blastMitigation && await placeEmergencyProtectBlock(bot, hostile.location, config, hostile.isAnchor ? "anchor" : "crystal")) {
        const fleeDir = normalize2D(vectorTo(hostile.location, bot.location));
        try { bot.applyImpulse({ x: fleeDir.x * 0.28, y: 0.05, z: fleeDir.z * 0.28 }); } catch {}
      }
    }
  }
  // [0.5.4] 予測先回り遮蔽の乱発を是正。旧実装は相手のホットバーにクリスタルが
  // あるだけで毎CD置き続け、フィールドが黒曜石で埋まり身動き不能になっていた。
  // 新条件: 「メインハンドに爆発アイテム（今まさに撃つ構え）」かつ至近距離のみ。
  if (config.blastMitigation && target?.isValid &&
      globalTick - Number(runtime.lastPreemptShieldTick ?? -9999) >= DEFENSE_PREEMPT_CD_TICKS) {
    try {
      const mainhand = target.getComponent("minecraft:equippable")?.getEquipment?.(EquipmentSlot.Mainhand);
      const armed = Boolean(mainhand && (
        mainhand.typeId === END_CRYSTAL_ID ||
        mainhand.typeId === RESPAWN_ANCHOR_ID ||
        mainhand.typeId === OBSIDIAN_ID
      ));
      const d = distance(bot.location, target.location);
      if (armed && d <= 5.5 && d >= 2) {
        runtime.lastPreemptShieldTick = globalTick;
        await placeEmergencyProtectBlock(bot, target.location, config, "preempt");
      }
    } catch {}
  }
}

export function handleSimCrossbowAttack(bot, target, config) {
  // [P1][診断] クロスボウが発動しない原因を特定するゲートトレース (2秒毎)
  if (globalTick % 40 === 0) {
    const d0 = distance(bot.location, target.location);
    debugLog(bot, config, "combat", `[XBowGate] combo=${config.crossbowCombo} d=${d0.toFixed(1)} los=${patchHasCombatLineOfSight(bot, target)} shielded=${targetIsShielded(target)} xbowInv=${countItemInContainer(bot.getComponent(EntityComponentTypes.Inventory)?.container, "minecraft:crossbow")}`);
  }
  if (!config.crossbowCombo) return false;
  if (isSpawnProtected(config.uid)) return false;
  const runtime = getRuntime(config.uid);
  if (runtime.pendingCrystal || runtime.pendingAnchor) return false;
  if (runtime.pendingRangedDraw) return false;
  if (runtime.shieldGuardState?.active) return false;
  if (globalTick - Number(runtime.lastRangedTick ?? -9999) < CROSSBOW_COOLDOWN_TICKS) return false;
  const d = distance(bot.location, target.location);
  if (d < 8 || d > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE * 3) return false;
  if (!patchHasCombatLineOfSight(bot, target)) return false;
  if (targetIsShielded(target)) { debugLog(bot, config, "ranged", "[Ranged] target shield up", false); return false; }
  runtime.lastRangedTick = globalTick;
  runtime.pendingRangedDraw = true;
  const weaponId = "minecraft:crossbow";
  if (!equipMainhandItem(bot, weaponId, config)) {
    runtime.pendingRangedDraw = false;
    return false;
  }
  const drawTicks = 20 + Math.floor(Math.random() * 7);
  const aim = patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.5, z: 0 }), config);
  faceBotToward(bot, aim);
  debugLog(bot, config, "ranged", `\u00a7d[Ranged] drawing ${drawTicks}t dist=${d.toFixed(1)}`, true);
  system.runTimeout(() => {
    try {
      runtime.pendingRangedDraw = false;
      if (!bot?.isValid) { try { selectBestSword(bot); } catch {} return; }
      const curD = distance(bot.location, target.location);
      if (curD < 3 || curD > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE * 3.5) { selectBestSword(bot); return; }
      const aimFresh = patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.5, z: 0 }), config);
      faceBotToward(bot, aimFresh);
      let method = "";
      let firedArrow = null;
      try {
        const eye = addVector(bot.location, { x: 0, y: 1.55, z: 0 });
        const drop = curD * curD * 0.0045;
        const aimPoint = addVector(aimFresh, { x: 0, y: drop, z: 0 });
        const dir = normalizeVector3(vectorTo(eye, aimPoint));
        // [0.7.0] 自ヒット完全防止:
        // 1) SimulatedPlayer移動中や1.5ブロック程度では前進速度で自分の当たり判定が追いつき自傷していたため、
        //    水平方向に2.2ブロック前方・頭上側(y+0.15)の自分のヒットボックス完全外から発射する。
        // 2) 前方にブロックがある場合は誤射・跳ね返り自傷を防ぐため発射を中止する。
        // 3) applyImpulse(質量依存で初速が足りず足元に落ちる環境がある)に加え、
        //    projectile コンポーネントの shoot(dir * speed) を最優先で呼び出して確実に高速飛翔させる。
        const muzzle = {
          x: bot.location.x + dir.x * 2.2,
          y: bot.location.y + 1.55 + Math.max(-0.2, dir.y * 1.4),
          z: bot.location.z + dir.z * 2.2,
        };
        if (isSolidBlock(getBlock(bot.dimension, muzzle))) {
          selectBestSword(bot);
          return;
        }
        firedArrow = bot.dimension.spawnEntity("minecraft:arrow", muzzle);
        let shot = false;
        const speed = 3.2;
        const velVec = { x: dir.x * speed, y: dir.y * speed + 0.06, z: dir.z * speed };
        try {
          const proj = firedArrow.getComponent?.("minecraft:projectile") ?? firedArrow.getComponent?.("projectile");
          if (proj && typeof proj.shoot === "function") {
            try { proj.shoot(velVec, { uncertainty: 0, source: bot }); shot = true; }
            catch { proj.shoot(velVec); shot = true; }
          }
        } catch {}
        if (!shot) {
          try {
            if (typeof firedArrow.shoot === "function") {
              firedArrow.shoot({ direction: dir, speed });
              shot = true;
            }
          } catch {}
        }
        if (!shot) {
          try { firedArrow.applyImpulse(velVec); shot = true; } catch {}
        }
        if (shot) {
          // 初速が0のまま残って自分に当たる事故を防ぐため、1tick後にも速度を検証・補正
          trackBowArrow(bot, firedArrow, target, config, velVec);
        } else {
          try { firedArrow.remove(); } catch {}
          firedArrow = null;
        }
      } catch { firedArrow = null; }
      if (firedArrow) {
        method = "chargedShot";
      }
      if (method) {
        debugLog(bot, config, "ranged", `\u00a7d[Ranged] ${method} fired dist=${curD.toFixed(1)}`, true);
        appendPersistentDebugLog("combat", `${config.displayName}: crossbow fired dist=${curD.toFixed(1)}`);
        system.runTimeout(() => { try { selectBestSword(bot); } catch {} }, 5);
      } else {
        selectBestSword(bot);
      }
    } catch {
      try { runtime.pendingRangedDraw = false; selectBestSword(bot); } catch {}
    }
  }, drawTicks);
  return true;
}

// ── Crossbow constants ──
// [F-5] SLOWFALL_DURATION_TICKS / pendingSlowfallArrows / trackChargedArrow は削除。
// 実体の矢はエンジンが命中・ダメージを処理するため、追跡と効果付与は不要。
const CROSSBOW_COOLDOWN_TICKS = 30;

function targetHasSlowFalling(target) {
  try {
    if (target?.getEffect?.("slow_falling")) return true;
  } catch {}
  return false;
}

// Human-discernible shield state: sneaking + holding shield in main/off hand
const shieldDisableUntil = new Map(); // key: targetId(String) -> untilTick (axe break effect)

function targetIsShielded(target) {
  try {
    if (shieldDisableUntil.get(String(target?.id)) > globalTick) return false;
    if (!target?.isSneaking) return false;
    const equippable = target.getComponent?.("minecraft:equippable");
    const mainhand = equippable?.getEquipment?.(EquipmentSlot.Mainhand);
    const offhand = equippable?.getEquipment?.(EquipmentSlot.Offhand);
    if (mainhand?.typeId === "minecraft:shield" || offhand?.typeId === "minecraft:shield") return true;
  } catch {}
  return false;
}

// ── Axe Shield Break (招時は斧で盾を破壊する) ──
const AXE_BREAK_COOLDOWN_TICKS = 25; // 人間可: 斧への持ち替えサイクル 1.25秒
const SHIELD_DISABLE_DURATION_TICKS = 100; // バニラ準拠 5秒

export function handleAxeShieldBreak(bot, target, config) {
  if (isSpawnProtected(config.uid)) return false;
  const runtime = getRuntime(config.uid);
  if (runtime.shieldGuardState?.active) return false;
  if (runtime.pendingCrystal || runtime.pendingAnchor || runtime.pendingRangedDraw) return false;
  try {
    if (shieldDisableUntil.get(String(target?.id)) > globalTick) return false;
    if (!targetIsShielded(target)) return false;
  } catch { return false; }
  if (distance(bot.location, target.location) > MAX_INTERACT_DISTANCE) return false;
  if (!patchHasCombatLineOfSight(bot, target)) return false;
  if (globalTick - Number(runtime.lastAxeBreakTick ?? -9999) < AXE_BREAK_COOLDOWN_TICKS) return false;
  const axeId = selectBestAxe(bot);
  if (!axeId) return false;
  runtime.lastAxeBreakTick = globalTick;
  if (!equipMainhandItem(bot, axeId, config)) {
    runtime.lastAxeBreakTick = globalTick - AXE_BREAK_COOLDOWN_TICKS + 5;
    return false;
  }
  faceBotToward(bot, addVector(target.location, { x: 0, y: 1.2, z: 0 }));
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  // [A-4/F-5] エンジン近接攻撃: 斧ダメージ・ノックバック・そして盾の5秒無効化
  // (Bedrock 1.18.30+: 盾アップ中のヒットでエンジン側が無効化を処理) がすべて
  // エンジン側で行われる。旧実装の applyDamage(7)+手動KB+手動無効化トラッキングの
  // 「効果適用」は全廃し、shieldDisableUntil はAI判断用の信念記録のみに残す。
  let usedEngine = false;
  // [P1][A-1] simulateAttack は存在しない。実在する attackEntity に置換
  // （盾の5秒無効化もエンジン側で処理される。距離・LOSは呼出側で担保済み）。
  try {
    if (typeof bot.attackEntity === "function") { usedEngine = Boolean(bot.attackEntity(target)); }
    else if (typeof bot.attack === "function") { usedEngine = Boolean(bot.attack()); }
  } catch { usedEngine = false; }
  if (!usedEngine) {
    const axeDamage = patchCalculateNetDamage(target, 7, "entityAttack"); // フォールバック
    patchApplyDamageWithFallback(target, axeDamage, "entityAttack", bot);
    const knock = normalize2D(vectorTo(bot.location, target.location));
    try { target.applyImpulse({ x: knock.x * 0.22, y: 0.04, z: knock.z * 0.22 }); } catch {}
  }
  // AI判断用の記録（効果の適用は上記のエンジン攻撃が担う）
  shieldDisableUntil.set(String(target.id), globalTick + SHIELD_DISABLE_DURATION_TICKS);
  debugLog(bot, config, "combat", `\u00a76[Axe] 盾破解り ${axeId.replace("minecraft:", "")} mode=${usedEngine ? "engine" : "script"} disable=5s`, true);
  system.runTimeout(() => { try { selectBestSword(bot); } catch {} }, 4);
  return true;
}

// [F-5] trackChargedArrow（合成スロウフォール付与の矢追跡）は削除。
// 実体の矢はエンジンが命中・ダメージ・効果を処理する。

// ── Shield Guard ──
// [F-3] Bedrockの盾は爆発ダメージを防げない（Wiki「Shield」: "All explosions" は
// [JE only]）。敵クリスタルへの盾構えは実プレイヤーに不可能な防御＝パリティ違反のため
// 発動条件を「飛来する投射物（矢・トライデント等）」のみに絞った。
// 敵クリスタルへの対処は handleSimThreatDefense（遮蔽ブロック＋距離管理）が担う。
const SHIELD_GUARD_MAX_HOLD_TICKS = 40;
const SHIELD_GUARD_RE_RAISE_COOLDOWN_TICKS = 20;

function releaseShieldGuard(bot, config, runtime, reason) {
  const state = runtime.shieldGuardState;
  if (!state?.active) return;
  state.active = false;
  runtime.shieldGuardLowerTick = globalTick;
  // [F-3] 盾を下ろす = スニーク解除（Bedrockの実操作）
  try { bot.isSneaking = false; } catch {}
  try { selectBestSword(bot); } catch {}
  debugLog(bot, config, "guard", `\u00a7e[Shield] lower(${reason}) held=${globalTick - state.since}t`, true);
}

export function handleSimShieldGuard(bot, target, config) {
  if (!config.shieldGuard) return;
  if (isSpawnProtected(config.uid)) return;
  const runtime = getRuntime(config.uid);
  if (runtime.pendingCrystal || runtime.pendingAnchor || runtime.pendingBed) {
    releaseShieldGuard(bot, config, runtime, "own combo");
    return;
  }
  const state = runtime.shieldGuardState ?? (runtime.shieldGuardState = { active: false, since: 0, lastRaiseTick: 0 });
  if (state.active) {
    if (globalTick - state.since >= SHIELD_GUARD_MAX_HOLD_TICKS) { releaseShieldGuard(bot, config, runtime, "timeout"); return; }
    // [F-3] 盾の維持: スニーク状態を維持する（Bedrockの実操作）
    if (globalTick - Number(state.lastRaiseTick ?? state.since) >= 10) {
      state.lastRaiseTick = globalTick;
      try { bot.isSneaking = true; } catch {}
      try { bot.useItem?.(new ItemStack("minecraft:shield", 1)); } catch {}
    }
    return;
  }
  if (globalTick - Number(runtime.shieldGuardLowerTick ?? -9999) < SHIELD_GUARD_RE_RAISE_COOLDOWN_TICKS) return;
  if (runtime.pendingRangedDraw) return;
  // [F-3] トリガーは投射物のみ（爆発は防げないため除外）
  const projectile = findInboundProjectile(bot);
  if (!projectile || distance(bot.location, projectile.location) > 9) return;
  if (!equipMainhandItem(bot, "minecraft:shield", config)) return;
  faceBotToward(bot, projectile.location);
  // [F-3] Bedrockの実操作は「スニーク」で盾を構える。useItem はフォールバック。
  let raised = false;
  try { bot.isSneaking = true; raised = true; } catch {}
  if (!raised) { try { bot.useItem?.(new ItemStack("minecraft:shield", 1)); raised = true; } catch {} }
  state.active = true;
  state.since = globalTick;
  state.lastRaiseTick = globalTick;
  debugLog(bot, config, "guard", `\u00a7e[Shield] raise vs projectile sneak=${raised} dist=${distance(bot.location, projectile.location).toFixed(1)}`, true);
}

// ── Bow Attack (遠距離からの射撃攻撃) ──
const BOW_COOLDOWN_TICKS = 40;
const BOW_MAX_RANGE = 48;
const BOW_ARROW_TRACK_MAX_TICKS = 60;
const pendingBowArrows = new Map();

export function handleBowAttack(bot, target, config) {
  // [P1][診断] 弓が発動しない原因を特定するゲートトレース (2秒毎)
  if (globalTick % 40 === 0) {
    const d0 = distance(bot.location, target.location);
    debugLog(bot, config, "combat", `[BowGate] combo=${config.bowCombo} d=${d0.toFixed(1)} los=${patchHasCombatLineOfSight(bot, target)} shielded=${targetIsShielded(target)} bowInv=${countItemInContainer(bot.getComponent(EntityComponentTypes.Inventory)?.container, "minecraft:bow")}`);
  }
  if (!config.bowCombo) return false;
  if (isSpawnProtected(config.uid)) return false;
  const runtime = getRuntime(config.uid);
  if (runtime.pendingCrystal || runtime.pendingAnchor || runtime.pendingRangedDraw) return false;
  if (runtime.shieldGuardState?.active) return false;
  if (runtime.elytraDashState?.active) return false;
  if (globalTick - Number(runtime.lastBowTick ?? -9999) < BOW_COOLDOWN_TICKS) return false;
  const d = distance(bot.location, target.location);
  if (d < Math.max(8, Number(config.bowDistance ?? 16)) || d > BOW_MAX_RANGE) return false;
  if (!patchHasCombatLineOfSight(bot, target)) return false;
  if (targetIsShielded(target)) { debugLog(bot, config, "ranged", "[Bow] target shield up", false); return false; }
  runtime.lastBowTick = globalTick;
  runtime.pendingRangedDraw = true;
  if (!equipMainhandItem(bot, "minecraft:bow", config)) {
    runtime.pendingRangedDraw = false;
    runtime.lastBowTick = globalTick - BOW_COOLDOWN_TICKS + 10;
    return false;
  }
  const drawTicks = 18 + Math.floor(Math.random() * 4);
  const aim = patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.5, z: 0 }), config);
  faceBotToward(bot, aim);
  debugLog(bot, config, "ranged", `\u00a7b[Bow] drawing ${drawTicks}t dist=${d.toFixed(1)}`, true);
  system.runTimeout(() => {
    try {
      runtime.pendingRangedDraw = false;
      if (!bot?.isValid) { try { selectBestSword(bot); } catch {} return; }
      const curD = distance(bot.location, target.location);
      if (curD < 4 || curD > BOW_MAX_RANGE * 1.2) { selectBestSword(bot); return; }
      const aimFresh = patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.5, z: 0 }), config);
      faceBotToward(bot, aimFresh);
      let firedArrow = null;
      try {
        const eye = addVector(bot.location, { x: 0, y: 1.55, z: 0 });
        const drop = curD * curD * 0.0045;
        const aimPoint = addVector(aimFresh, { x: 0, y: drop, z: 0 });
        const delta = vectorTo(eye, aimPoint);
        const len = Math.hypot(delta.x, delta.y, delta.z) || 1;
        const dir = { x: delta.x / len, y: delta.y / len, z: delta.z / len };
        // [0.7.0] 自ヒット完全防止:
        // 自分のヒットボックス内(eye)へのフォールバックを完全廃止し、2.2ブロック前方から射出する。
        // 前方が固体ブロックで塞がれている場合は射撃を中止する（跳ね返り自傷防止）。
        // さらに projectile コンポーネントの shoot(velocityVec) を最優先で使い、
        // 飛距離ゼロで自分の足元に落ちて全部自分に当たる問題を根絶する。
        const muzzle = {
          x: bot.location.x + dir.x * 2.2,
          y: bot.location.y + 1.55 + Math.max(-0.2, dir.y * 1.4),
          z: bot.location.z + dir.z * 2.2,
        };
        if (isSolidBlock(getBlock(bot.dimension, muzzle))) {
          selectBestSword(bot);
          return;
        }
        firedArrow = bot.dimension.spawnEntity("minecraft:arrow", muzzle);
        let shot = false;
        const speed = 3.4;
        const velVec = { x: dir.x * speed, y: dir.y * speed + 0.06, z: dir.z * speed };
        try {
          const proj = firedArrow.getComponent?.("minecraft:projectile") ?? firedArrow.getComponent?.("projectile");
          if (proj && typeof proj.shoot === "function") {
            try { proj.shoot(velVec, { uncertainty: 0, source: bot }); shot = true; }
            catch { proj.shoot(velVec); shot = true; }
          }
        } catch {}
        if (!shot) {
          try {
            if (typeof firedArrow.shoot === "function") {
              firedArrow.shoot({ direction: dir, speed });
              shot = true;
            }
          } catch {}
        }
        if (!shot) {
          try { firedArrow.applyImpulse(velVec); shot = true; } catch {}
        }
        if (!shot) { try { firedArrow.remove(); } catch {} firedArrow = null; }
        if (firedArrow) {
          trackBowArrow(bot, firedArrow, target, config, velVec);
        }
      } catch { firedArrow = null; }
      if (firedArrow) {
        debugLog(bot, config, "ranged", `\u00a7b[Bow] fired dist=${curD.toFixed(1)}`, true);
        appendPersistentDebugLog("combat", `${config.displayName}: bow fired dist=${curD.toFixed(1)}`);
        system.runTimeout(() => { try { selectBestSword(bot); } catch {} }, 5);
      } else {
        selectBestSword(bot);
      }
    } catch {
      try { runtime.pendingRangedDraw = false; selectBestSword(bot); } catch {}
    }
  }, drawTicks);
  return true;
}

function trackBowArrow(bot, arrow, target, config, initialVel) {
  // [0.7.0] 矢の初速保証＆自傷防止ガード:
  // 発射直後(ticks<=2)に初速が乗っていない場合は再度速度を付与し、
  // 万一Bot自身のヒットボックス内(距離<1.1)へ逆流・滞留した場合は即消去して自傷を防ぐ。
  const entry = { arrow, ticks: 0 };
  pendingBowArrows.set(String(arrow.id), entry);
  const step = () => {
    try {
      if (!entry.arrow?.isValid) { pendingBowArrows.delete(String(arrow.id)); return; }
      entry.ticks++;
      if (entry.ticks <= 2 && initialVel) {
        try {
          const v = entry.arrow.getVelocity?.() ?? entry.arrow.velocity ?? { x: 0, y: 0, z: 0 };
          if (Math.hypot(v.x, v.y, v.z) < 0.4) {
            const proj = entry.arrow.getComponent?.("minecraft:projectile") ?? entry.arrow.getComponent?.("projectile");
            if (proj && typeof proj.shoot === "function") {
              try { proj.shoot(initialVel); } catch {}
            } else {
              try { entry.arrow.applyImpulse(initialVel); } catch {}
            }
          }
        } catch {}
      }
      if (bot?.isValid && entry.ticks >= 2 && distance(entry.arrow.location, bot.location) < 1.05) {
        try { entry.arrow.remove(); } catch {}
        pendingBowArrows.delete(String(arrow.id));
        return;
      }
      if (entry.ticks > BOW_ARROW_TRACK_MAX_TICKS) {
        try { entry.arrow.remove(); } catch {}
        pendingBowArrows.delete(String(arrow.id));
        return;
      }
      system.runTimeout(step, 1);
    } catch {
      pendingBowArrows.delete(String(arrow.id));
    }
  };
  system.runTimeout(step, 1);
}

// ── [v0.5.0] Elytra + Mace Dive（エリトラ急降下メイス攻撃）──
// ユーザー実機指摘の是正: 旧 Elytra Dash は最長30tick(1.5秒)上空に滞留し続け、
// CrystalPvPの「低位有利」メタと真逆で被弾を最大化していた（上にいるほど相手の
// クリスタル爆発のexposureが増す）。加えて空中は遮蔽設置もできず、攻撃もしない
// 「ただ標的になる時間」だった。
// 新設計: エリトラは「メイス落下攻撃の到達手段」に限定する。
//   1. 発進ゲート: 相手の近くに敵クリスタル/チャージ済みアンカーがある時は不発
//      (浮上して食らう場面を作らない)。メイス未所持でも不発。
//   2. 上昇は最短 (上限10tick・高度は相手+7)。上昇中に相手が起爆源を置いたら即降下。
//   3. 降下: メイス装備で真下へ急降下し、距離3以内で attackEntity() を実行。
//      落下ダメージボーナス・Wind Burstの跳ね返りはすべてエンジン計算。
//      (メイスの落下攻撃仕様はエンジン側が持つため、スクリプトは攻撃操作のみ)
//   4. 攻撃後は即チェスト/剣を復帰し、遮蔽設置を試みて通常戦闘(低位)へ戻る。
//      Wind Burstで跳ね返った場合は1回だけ再急降下を許可する。
const ELYTRA_DASH_COOLDOWN_TICKS = 160; // 8秒
const ELYTRA_SKY_CHECK_BLOCKS = 7;

export function handleElytraMaceDive(bot, target, config) {
  // [P1][診断] 急降下が発動しない原因を特定するゲートトレース (2秒毎)
  if (globalTick % 40 === 0) {
    const d0 = distance(bot.location, target.location);
    let skyFree = true;
    try {
      for (let h = 1; h <= ELYTRA_SKY_CHECK_BLOCKS; h++) {
        if (isSolidBlock(getBlock(bot.dimension, addVector(bot.location, { x: 0, y: h, z: 0 })))) { skyFree = false; break; }
      }
    } catch { skyFree = false; }
    const traceRuntime = getRuntime(config.uid);
    debugLog(bot, config, "combat", `[DiveGate] dash=${config.elytraDash} maceCombo=${config.maceCombo} cd=${Math.max(0, ELYTRA_DASH_COOLDOWN_TICKS - (globalTick - Number(traceRuntime.lastElytraDashTick ?? -9999)))} d=${d0.toFixed(1)} los=${patchHasCombatLineOfSight(bot, target)} skyFree=${skyFree} hp=${patchGetCurrentHealthValue(bot).toFixed(1)} maceInv=${countItemInContainer(bot.getComponent(EntityComponentTypes.Inventory)?.container, MACE_ID)}`);
  }
  if (!config.elytraDash) return false;
  if (config.maceCombo === false) return false;
  if (isSpawnProtected(config.uid)) return false;
  const runtime = getRuntime(config.uid);
  if (runtime.pendingCrystal || runtime.pendingAnchor || runtime.pendingRangedDraw) return false;
  if (runtime.shieldGuardState?.active) return false;
  if (runtime.elytraDashState?.active) return false;
  if (globalTick - Number(runtime.lastElytraDashTick ?? -9999) < ELYTRA_DASH_COOLDOWN_TICKS) return false;
  const d = distance(bot.location, target.location);
  if (d < Math.max(6, Number(config.elytraDistance ?? 12))) return false;
  if (!patchHasCombatLineOfSight(bot, target)) return false;
  // ゲート: メイスを所持している事 (コンボの前提)
  if (!equipMainhandItem(bot, MACE_ID, config)) return false;
  // ゲート: 相手の近くに既に起爆源があるなら浮上しない (上空は被弾が最大になる)
  try {
    for (const entity of bot.dimension.getEntities({ location: target.location, maxDistance: 5 })) {
      if (entity.typeId === END_CRYSTAL_ENTITY_ID) return false;
    }
    const tf = floorLocation(target.location);
    for (const off of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]) {
      const block = getBlock(bot.dimension, { x: tf.x + off[0], y: tf.y, z: tf.z + off[1] });
      if (block?.typeId === RESPAWN_ANCHOR_ID) {
        let charge = 0;
        try { charge = block.permutation?.getState?.("respawn_anchor_charge") ?? 0; } catch {}
        if (charge > 0) return false;
      }
    }
  } catch { return false; }
  // ゲート: 自分頭上の空き (発進のため)
  try {
    for (let h = 1; h <= ELYTRA_SKY_CHECK_BLOCKS; h++) {
      if (isSolidBlock(getBlock(bot.dimension, addVector(bot.location, { x: 0, y: h, z: 0 })))) return false;
    }
  } catch { return false; }
  const equippable = getEquippableComponent(bot);
  if (!equippable) return false;
  let chestItem;
  try { chestItem = equippable.getEquipment?.(EquipmentSlot.Chest); } catch {}
  if (chestItem?.typeId === "minecraft:elytra") return false;
  // 自傷リスク: HPが低い状態での浮上はしない (落下攻撃前に撃ち落とされる)
  if (patchGetCurrentHealthValue(bot) < 10) return false;
  runtime.lastElytraDashTick = globalTick;
  const state = {
    active: true, phase: "rise", ticks: 0, attacks: 0, attempts: 0,
    until: globalTick + ELYTRA_DIVE_TOTAL_MAX_TICKS,
    chestItem: chestItem ?? undefined, startTick: globalTick, lastStepTick: globalTick,
  };
  runtime.elytraDashState = state;
  try { equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:elytra", 1)); } catch {}
  if (!equipMainhandItem(bot, MACE_ID, config)) { endElytraMaceDive(bot, config, state); return false; }
  const aim = addVector(target.location, { x: 0, y: 1.0, z: 0 });
  faceBotToward(bot, aim);
  const launchDir = normalize2D(vectorTo(bot.location, target.location));
  // [0.7.0] SimBot は moveRelative / jump / glide を併用して確実に浮上・突進させる
  try {
    if (isSimBot(bot)) {
      try { bot.jump?.(); } catch {}
      try { bot.moveRelative?.(0, 1, 1); } catch {}
    }
    bot.applyImpulse({ x: launchDir.x * 0.55, y: 0.62, z: launchDir.z * 0.55 });
  } catch {}
  debugLog(bot, config, "combat", `\u00a75[ElytraMace] dive開始 dist=${d.toFixed(1)}`, true);
  appendPersistentDebugLog("combat", `${config.displayName}: elytra mace combo started dist=${d.toFixed(1)}`);

  const executeMaceStrike = (targetEntity, heightDiff) => {
    // 攻撃直前に必ずメイスへ持ち替える（絶対メイス契約）
    try { equipMainhandItem(bot, MACE_ID, config); } catch {}
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
    let ok = false;
    try {
      if (typeof bot.attackEntity === "function") { ok = Boolean(bot.attackEntity(targetEntity)); }
      else if (typeof bot.attack === "function") { ok = Boolean(bot.attack()); }
    } catch { ok = false; }
    // [0.7.0] エンジン attackEntity が空中判定・リーチ差で false を返した場合でも
    // エリトラで突っ込んだら絶対にメイス攻撃を成立させ、さらに Wind Burst 相当のバウンドで
    // 連続メイスコンボへ繋げるフォールバック保証
    if (!ok) {
      const fallHeight = Math.max(2.5, Math.abs(heightDiff) + 3.0);
      const rawMaceDmg = 6 + fallHeight * 3.5; // メイス落下ボーナス + Density 相当
      const netDmg = patchCalculateNetDamage(targetEntity, rawMaceDmg, "entityAttack");
      ok = patchApplyDamageWithFallback(targetEntity, Math.max(4, netDmg), "entityAttack", bot);
    }
    return ok;
  };

  const step = () => {
    try {
      if (!bot?.isValid || !state.active) { endElytraMaceDive(bot, config, state); return; }
      state.ticks++;
      state.lastStepTick = globalTick;
      if (globalTick >= state.until) { endElytraMaceDive(bot, config, state, "timeout"); return; }
      const targetLoc = target?.isValid ? target.location : undefined;
      if (!targetLoc) { endElytraMaceDive(bot, config, state); return; }
      const heightDiff = bot.location.y - targetLoc.y;
      const curD = distance(bot.location, targetLoc);
      const dirToTarget = normalize2D(vectorTo(bot.location, targetLoc));

      if (state.phase === "rise") {
        // 上昇中に相手が起爆源を設置したら即急降下へ (上空滞留の被弾を断つ)
        let threatAppeared = false;
        try {
          for (const entity of bot.dimension.getEntities({ location: targetLoc, maxDistance: 4 })) {
            if (entity.typeId === END_CRYSTAL_ENTITY_ID) threatAppeared = true;
          }
        } catch {}
        if (threatAppeared || heightDiff >= ELYTRA_DIVE_AIM_HEIGHT || state.ticks >= ELYTRA_DIVE_RISE_MAX_TICKS) {
          state.phase = "dive";
          try { if (isSimBot(bot)) bot.glide?.(); } catch {}
          faceBotToward(bot, addVector(targetLoc, { x: 0, y: 0.4, z: 0 }));
        } else {
          faceBotToward(bot, addVector(targetLoc, { x: 0, y: 2.0, z: 0 }));
          try { if (isSimBot(bot)) bot.moveRelative?.(0, 1, 1); } catch {}
          try { bot.applyImpulse({ x: dirToTarget.x * 0.48, y: 0.32, z: dirToTarget.z * 0.48 }); } catch {}
        }
      } else if (state.phase === "dive") {
        // [0.7.0] 急降下突進: 真下だけでなくターゲットの水平位置へも強くホーミングして突っ込む
        faceBotToward(bot, addVector(targetLoc, { x: 0, y: 0.4, z: 0 }));
        try { if (isSimBot(bot)) bot.moveRelative?.(0, 1, 1); } catch {}
        try { bot.applyImpulse({ x: dirToTarget.x * 0.52, y: -0.45, z: dirToTarget.z * 0.52 }); } catch {}
        // 「エリトラで飛んだら絶対メイス＋連続コンボ」保証:
        const inPrimaryWindow = curD <= MACE_DIVE_ATTACK_RANGE;
        const inGuaranteedWindow = curD <= 5.2 && heightDiff <= 1.2;
        if ((inPrimaryWindow || inGuaranteedWindow) && state.attempts < MACE_DIVE_ATTACKS_MAX) {
          const ok = executeMaceStrike(target, heightDiff);
          state.attempts++;
          if (ok) {
            state.attacks++;
            debugLog(bot, config, "combat", `\u00a75[ElytraMace] コンボ打撃 hit #${state.attacks}/${MACE_DIVE_ATTACKS_MAX}`, true);
            appendPersistentDebugLog("combat", `${config.displayName}: elytra mace hit #${state.attacks}/${MACE_DIVE_ATTACKS_MAX} dist=${curD.toFixed(1)}`);
          } else {
            debugLog(bot, config, "combat", `\u00a75[ElytraMace] 落下攻撃 attempt #${state.attempts}`, false);
          }
          if (state.attempts >= MACE_DIVE_ATTACKS_MAX) {
            endElytraMaceDive(bot, config, state, "combo-complete");
            return;
          }
          // [0.7.0] 1回だけで終わらせず、エリトラ再推進＋上方向バウンドで2撃目・3撃目の急降下メイスコンボへ繋げる！
          state.phase = "rebound";
          state.reboundUntil = globalTick + ELYTRA_COMBO_REBOUND_TICKS;
          try {
            if (isSimBot(bot)) {
              try { bot.jump?.(); } catch {}
              try { bot.glide?.(); } catch {}
            }
            bot.applyImpulse({ x: dirToTarget.x * 0.38, y: 0.68, z: dirToTarget.z * 0.38 });
          } catch {}
          system.runTimeout(step, 1);
          return;
        }
        // 地面スレスレまで来たとき: まだコンボ回数が残っていれば再浮上して必ずメイスコンボを継続する
        if (heightDiff <= -0.8 || isBotOnGround(bot)) {
          if (state.attempts < MACE_DIVE_ATTACKS_MAX && globalTick + 12 < state.until) {
            // 近くにいれば接地直前に1撃叩き込んでから再ジャンプ
            if (curD <= 5.5) {
              const ok = executeMaceStrike(target, heightDiff);
              state.attempts++;
              if (ok) state.attacks++;
              if (state.attempts >= MACE_DIVE_ATTACKS_MAX) {
                endElytraMaceDive(bot, config, state, "combo-complete");
                return;
              }
            }
            state.phase = "rebound";
            state.reboundUntil = globalTick + 6;
            try {
              if (isSimBot(bot)) bot.jump?.();
              bot.applyImpulse({ x: dirToTarget.x * 0.45, y: 0.62, z: dirToTarget.z * 0.45 });
            } catch {}
            system.runTimeout(step, 1);
            return;
          }
          endElytraMaceDive(bot, config, state, "landed");
          return;
        }
      } else if (state.phase === "rebound") {
        // 再上昇フェーズ: 相手の上空へ素早く跳ね上がってから再び急降下("dive")へ入る
        faceBotToward(bot, addVector(targetLoc, { x: 0, y: 0.6, z: 0 }));
        try { if (isSimBot(bot)) bot.moveRelative?.(0, 1, 1); } catch {}
        if (globalTick < state.reboundUntil) {
          try { bot.applyImpulse({ x: dirToTarget.x * 0.42, y: 0.26, z: dirToTarget.z * 0.42 }); } catch {}
        } else {
          state.phase = "dive";
          try { bot.applyImpulse({ x: dirToTarget.x * 0.48, y: -0.38, z: dirToTarget.z * 0.48 }); } catch {}
        }
      }
      system.runTimeout(step, 1);
    } catch { endElytraMaceDive(bot, config, state); }
  };
  system.runTimeout(step, 1);
  return true;
}

export function endElytraMaceDive(bot, config, state, reason = "end") {
  try {
    state.active = false;
    try {
      const rt = getRuntime(config.uid);
      rt.elytraDashState = undefined;
      // [0.5.4] 着地後に経路を再構築（穴に嵌まったまま古い経路を追い続けない）
      rt.navPath = undefined;
      rt.navLastPathTick = -9999;
      // [0.6.0] ダイブで中断した移動を確実に再開させる（詰まり判定をリセット）
      rt.stuckTicks = 0;
      rt.stuckWindow = undefined;
      rt.airborneTicks = 0;
    } catch {}
    // [0.7.0] SimulatedPlayer が滑空(glide)・飛行状態のまま残って地上移動不能（フリーズ）になるバグを解消
    try { bot?.stopGliding?.(); } catch {}
    try { bot?.stopFlying?.(); } catch {}
    try { bot?.isSneaking = false; } catch {}
    const equippable = getEquippableComponent(bot);
    if (equippable) {
      try { equippable.setEquipment(EquipmentSlot.Chest, state.chestItem ?? new ItemStack("minecraft:netherite_chestplate", 1)); } catch {}
    }
    try { selectBestSword(bot); } catch {}
    // 着地直後に移動入力を1回キックして確実に地上AIへ復帰させる
    try { if (isSimBot(bot)) bot.moveRelative?.(0, 1, 0.8); } catch {}
    debugLog(bot, config, "combat", `\u00a75[ElytraMace] 終了(${reason}) attempts=${state.attempts ?? 0} hits=${state.attacks ?? 0} -> 復帰 (低位戦へ)`, true);
    appendPersistentDebugLog("combat", `${config.displayName}: elytra mace ended(${reason}) attempts=${state.attempts ?? 0} hits=${state.attacks ?? 0}`);
  } catch {}
}

// [0.6.0] ウォッチドッグ用: 進行が止まった elytraDashState を外部（main tick）から強制終了する。
export function abortElytraMaceDive(bot, config) {
  try {
    const rt = getRuntime(config.uid);
    const state = rt.elytraDashState;
    if (state) endElytraMaceDive(bot, config, state, "watchdog");
  } catch {}
}
