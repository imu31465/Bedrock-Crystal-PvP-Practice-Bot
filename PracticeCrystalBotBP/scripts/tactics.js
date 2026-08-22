// ── Tactics ──
// ターゲットの相対位置(上/下/同高/遠/近)と地形から「今どう動くべきか」を決める層。
// 移動の実行は movement.js が担当し、ここは意思決定と足場作りだけを行う。

import {
  BlockPermutation, EntityComponentTypes, system,
  OBSIDIAN_ID, SWORD_RANGE, MOVE_FILLER_BLOCK_IDS,
  TACTIC_TARGET_ABOVE_THRESHOLD, TACTIC_TARGET_BELOW_THRESHOLD,
  TACTIC_PILLAR_MAX_HEIGHT, TACTIC_BRIDGE_MAX_LENGTH,
  TACTIC_PLACE_COOLDOWN_TICKS, TACTIC_HIGH_GROUND_BONUS_Y,
  TACTIC_LEDGE_SAFETY_MARGIN, PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE,
} from "./constants.js";
import { globalTick, globalSettings } from "./state.js";
import {
  distance, addVector, vectorTo, normalize2D, floorLocation,
  getBlock, isAirBlock, isSolidBlock, quoteCoord,
  isLocationInsideBotBoundary, patchRunDimensionCommandNoThrow,
  countItemInContainer, debugLog,
} from "./utils.js";
import { getRuntime } from "./config.js";
import {
  navIsStandableCell, navFindStandableNear, navFindGroundY,
  navIsPassableBlock, navCanOccupy, navHasWalkableLine,
} from "./navigation.js";
import { equipMainhandItem, consumeManagedItem, selectBestSword } from "./inventory.js";

// ── Tactic modes ──
export const TACTIC_ENGAGE = "engage";        // 同高度・射程内 → 周回して殴る
export const TACTIC_CLOSE_GAP = "close_gap";  // 遠い → 最短で詰める
export const TACTIC_CLIMB = "climb";          // ターゲットが上 → 登る/柱を立てる
export const TACTIC_DESCEND = "descend";      // ターゲットが下 → 安全に降りる
export const TACTIC_KITE = "kite";            // 回復中 → 距離を取る
export const TACTIC_HIGH_GROUND = "high_ground"; // 高所を取ってから戦う
export const TACTIC_HOLD = "hold";            // 追い詰められた/待機

// ── Block placement ──
function tacticPickFillerBlock(bot, config) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (config?.inventoryMode === "infinite") return MOVE_FILLER_BLOCK_IDS[0];
  if (!inventory) return undefined;
  for (const blockId of MOVE_FILLER_BLOCK_IDS) {
    if (countItemInContainer(inventory, blockId) > 0) return blockId;
  }
  return undefined;
}

function tacticSetBlock(dimension, location, blockId) {
  const block = getBlock(dimension, location);
  if (block) {
    if (!isAirBlock(block)) return false;
    try { block.setPermutation(BlockPermutation.resolve(blockId)); return true; } catch {}
  }
  patchRunDimensionCommandNoThrow(dimension,
    `setblock ${quoteCoord(Math.floor(location.x))} ${quoteCoord(Math.floor(location.y))} ${quoteCoord(Math.floor(location.z))} ${blockId} keep`);
  return true;
}

export function tacticPlaceBlockAt(bot, config, location) {
  if (config.blockPlacing === false) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastBlockPlaceTick ?? -9999) < TACTIC_PLACE_COOLDOWN_TICKS) return false;
  if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(location)) return false;
  const blockId = tacticPickFillerBlock(bot, config);
  if (!blockId) return false;
  if (!equipMainhandItem(bot, blockId, config)) return false;
  if (!consumeManagedItem(bot, config, blockId, 1)) return false;
  if (!tacticSetBlock(bot.dimension, location, blockId)) return false;
  runtime.lastBlockPlaceTick = globalTick;
  system.runTimeout(() => { try { selectBestSword(bot); } catch {} }, 2);
  return true;
}

// ターゲットが上にいて登れる足場が無い時、自分の足元にブロックを積んで高度を稼ぐ
export function tacticTryPillarUp(bot, config, target) {
  const runtime = getRuntime(config.uid);
  const heightGain = Number(runtime.pillarHeightGain ?? 0);
  if (heightGain >= TACTIC_PILLAR_MAX_HEIGHT) return false;
  if (target.location.y - bot.location.y < 1.6) { runtime.pillarHeightGain = 0; return false; }
  const feet = floorLocation(bot.location);
  const below = { x: feet.x, y: feet.y - 1, z: feet.z };
  // 頭上が塞がっていたら上には行けない
  if (!navIsPassableBlock(getBlock(bot.dimension, { x: feet.x, y: feet.y + 2, z: feet.z }))) return false;
  const belowBlock = getBlock(bot.dimension, below);
  if (belowBlock && !isAirBlock(belowBlock)) {
    // 既に足場がある場合はジャンプしながら真下に置く必要があるので、
    // 「ジャンプ中に足元へ設置」を movement 側の jump 要求と組み合わせる
    if (!runtime.pillarJumpPending) { runtime.pillarJumpPending = true; return false; }
  }
  runtime.pillarJumpPending = false;
  if (!tacticPlaceBlockAt(bot, config, below)) return false;
  runtime.pillarHeightGain = heightGain + 1;
  debugLog(bot, config, "movement", `§b[戦術] 柱で高度を稼いでいます (+${runtime.pillarHeightGain})`);
  return true;
}

// 空中の隙間をブロックで埋めて渡る
export function tacticTryBridgeToward(bot, config, direction) {
  const runtime = getRuntime(config.uid);
  const bridged = Number(runtime.bridgeBlockCount ?? 0);
  if (bridged >= TACTIC_BRIDGE_MAX_LENGTH) return false;
  const feet = floorLocation(bot.location);
  const step = {
    x: feet.x + Math.round(direction.x),
    y: feet.y - 1,
    z: feet.z + Math.round(direction.z),
  };
  if (step.x === feet.x && step.z === feet.z) return false;
  const stepBlock = getBlock(bot.dimension, step);
  if (stepBlock && !isAirBlock(stepBlock)) { runtime.bridgeBlockCount = 0; return false; }
  // 渡った先の足元が空 かつ 体が通る空間があることを確認
  if (!navIsPassableBlock(getBlock(bot.dimension, { x: step.x, y: step.y + 1, z: step.z }))) return false;
  if (!tacticPlaceBlockAt(bot, config, step)) return false;
  runtime.bridgeBlockCount = bridged + 1;
  debugLog(bot, config, "movement", `§b[戦術] 橋を架けています (${runtime.bridgeBlockCount})`);
  return true;
}

// ── Ledge safety ──
// 進行方向の先が致命的な高さの崖かどうか（回復中や不要な自殺ダイブを防ぐ）
export function tacticIsDangerousLedge(bot, direction, allowedDrop = TACTIC_LEDGE_SAFETY_MARGIN) {
  const probe = addVector(bot.location, { x: direction.x * 0.85, y: 0, z: direction.z * 0.85 });
  if (navIsStandableCell(bot.dimension, Math.floor(probe.x), Math.floor(probe.y), Math.floor(probe.z))) return false;
  const groundY = navFindGroundY(bot.dimension, probe, 24);
  if (groundY === undefined) return true; // 底なし
  return bot.location.y - groundY > allowedDrop;
}

// ── Orbit point (周回位置) ──
// ターゲットの周りを維持距離で回る点を返す。地形が安全な点を優先。
export function tacticComputeOrbitGoal(bot, target, config, strafeDirection) {
  const desired = Math.max(1.4, Number(config.maintainDistance ?? 3));
  const toBot = normalize2D(vectorTo(target.location, bot.location));
  const base = (Math.abs(toBot.x) < 0.0001 && Math.abs(toBot.z) < 0.0001) ? { x: 1, y: 0, z: 0 } : toBot;
  // 現在角度から少し先(周回方向)へ回した点を目標にする
  const angles = [26, 52, 8, -26, 78, -52];
  for (const rawAngle of angles) {
    const angle = (rawAngle * strafeDirection * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const rotated = { x: base.x * cos - base.z * sin, z: base.x * sin + base.z * cos };
    const candidate = {
      x: target.location.x + rotated.x * desired,
      y: bot.location.y,
      z: target.location.z + rotated.z * desired,
    };
    const groundY = navFindGroundY(bot.dimension, { ...candidate, y: candidate.y + 1 }, 4);
    if (groundY === undefined) continue;
    const resolved = { x: candidate.x, y: groundY, z: candidate.z };
    if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(resolved)) continue;
    if (!navCanOccupy(bot.dimension, resolved)) continue;
    return resolved;
  }
  return undefined;
}

// ── 高所取り ──
// ターゲット周辺で、ターゲットより高くて射程内に入れる立ち位置を探す
export function tacticFindHighGroundGoal(bot, target, config) {
  const desired = Math.max(2, Number(config.maintainDistance ?? 3));
  const targetFloor = floorLocation(target.location);
  const searchRadius = Math.min(7, Math.ceil(desired) + 3);
  let best, bestScore = Number.NEGATIVE_INFINITY;
  for (let dy = 1; dy <= 4; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const x = targetFloor.x + dx, y = targetFloor.y + dy, z = targetFloor.z + dz;
        if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary({ x: x + 0.5, y, z: z + 0.5 })) continue;
        if (navIsStandableCell(bot.dimension, x, y, z) !== 1) continue;
        const candidate = { x: x + 0.5, y, z: z + 0.5 };
        const horizontal = Math.hypot(candidate.x - target.location.x, candidate.z - target.location.z);
        if (horizontal < 1.2 || horizontal > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) continue;
        const travel = distance(bot.location, candidate);
        if (travel > 16) continue;
        const heightAdvantage = candidate.y - target.location.y;
        const score = heightAdvantage * 2.6 - Math.abs(horizontal - desired) * 1.3 - travel * 0.42;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
  }
  return best;
}

// ── ターゲットが下 → 安全な降下地点 ──
export function tacticFindDescendGoal(bot, target) {
  const targetFloor = floorLocation(target.location);
  const cache = new Map();
  let best, bestScore = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius <= 4; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        for (let dy = 1; dy >= -2; dy--) {
          const x = targetFloor.x + dx, y = targetFloor.y + dy, z = targetFloor.z + dz;
          if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary({ x: x + 0.5, y, z: z + 0.5 })) continue;
          if (!navIsStandableCell(bot.dimension, x, y, z, cache)) continue;
          const candidate = { x: x + 0.5, y, z: z + 0.5 };
          const score = distance(candidate, target.location) + Math.abs(candidate.y - target.location.y) * 0.7;
          if (score < bestScore) { bestScore = score; best = candidate; }
        }
      }
    }
    if (best) break;
  }
  return best;
}

// ── 回復時の退避先 ──
export function tacticFindKiteGoal(bot, target, config) {
  const away = normalize2D(vectorTo(target.location, bot.location));
  const base = (Math.abs(away.x) < 0.0001 && Math.abs(away.z) < 0.0001) ? { x: 1, y: 0, z: 0 } : away;
  const distances = [10, 8, 12, 6, 14];
  const angles = [0, -30, 30, -60, 60, -90, 90];
  let best, bestScore = Number.NEGATIVE_INFINITY;
  for (const rawAngle of angles) {
    const angle = (rawAngle * Math.PI) / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const direction = { x: base.x * cos - base.z * sin, z: base.x * sin + base.z * cos };
    for (const travelDistance of distances) {
      const probe = {
        x: bot.location.x + direction.x * travelDistance,
        y: bot.location.y,
        z: bot.location.z + direction.z * travelDistance,
      };
      const groundY = navFindGroundY(bot.dimension, { ...probe, y: probe.y + 2 }, 6);
      if (groundY === undefined) continue;
      const candidate = { x: probe.x, y: groundY, z: probe.z };
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
      if (!navCanOccupy(bot.dimension, candidate)) continue;
      const targetDistance = distance(candidate, target.location);
      if (targetDistance < 6) continue;
      const score = Math.min(targetDistance, 14) * 2 - Math.abs(candidate.y - bot.location.y) * 0.5;
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
  }
  return best ?? navFindStandableNear(bot.dimension, {
    x: bot.location.x + base.x * 8, y: bot.location.y, z: bot.location.z + base.z * 8,
  }, 3, 4);
}

/**
 * 現在の状況から戦術を決定する。
 * @returns {{ mode: string, goal?: {x,y,z}, desiredDistance: number, sprint: boolean, allowJump: boolean, reason: string }}
 */
export function evaluateCombatTactic(bot, target, config, options = {}) {
  const runtime = getRuntime(config.uid);
  const isRecovering = !!options.isRecovering;
  const verticalDelta = target.location.y - bot.location.y;
  const horizontalDistance = Math.hypot(target.location.x - bot.location.x, target.location.z - bot.location.z);
  const totalDistance = distance(bot.location, target.location);
  const maintainDistance = Math.max(1.4, Number(config.maintainDistance ?? 3));

  if (isRecovering) {
    return {
      mode: TACTIC_KITE,
      goal: tacticFindKiteGoal(bot, target, config),
      desiredDistance: 12,
      sprint: true,
      allowJump: true,
      reason: "回復のため距離を取る",
    };
  }

  // ターゲットが上 → 登る
  if (verticalDelta >= TACTIC_TARGET_ABOVE_THRESHOLD) {
    const goal = navFindStandableNear(bot.dimension, target.location, 3, 3) ??
                 tacticFindHighGroundGoal(bot, target, config);
    return {
      mode: TACTIC_CLIMB,
      goal,
      desiredDistance: maintainDistance,
      sprint: horizontalDistance > 3,
      allowJump: true,
      reason: `ターゲットが上 (+${verticalDelta.toFixed(1)})`,
    };
  }

  // ターゲットが下 → 安全に降りる
  if (verticalDelta <= -TACTIC_TARGET_BELOW_THRESHOLD) {
    return {
      mode: TACTIC_DESCEND,
      goal: tacticFindDescendGoal(bot, target),
      desiredDistance: maintainDistance,
      sprint: horizontalDistance > 4,
      allowJump: true,
      reason: `ターゲットが下 (${verticalDelta.toFixed(1)})`,
    };
  }

  // 遠い → 詰める
  if (totalDistance > maintainDistance + 2.2) {
    return {
      mode: TACTIC_CLOSE_GAP,
      goal: navFindStandableNear(bot.dimension, target.location, 2, 3) ?? { ...target.location },
      desiredDistance: maintainDistance,
      sprint: true,
      allowJump: true,
      reason: `距離を詰める (${totalDistance.toFixed(1)})`,
    };
  }

  // 射程内。高所が近くにあるなら取りに行く（クリスタル有利ポジション）
  const wantsHighGround = config.highGroundTactic !== false && config.crystalCombo !== false &&
    verticalDelta > -TACTIC_HIGH_GROUND_BONUS_Y &&
    globalTick - Number(runtime.lastHighGroundSearchTick ?? -9999) >= 40;
  if (wantsHighGround) {
    runtime.lastHighGroundSearchTick = globalTick;
    const highGround = tacticFindHighGroundGoal(bot, target, config);
    if (highGround && highGround.y - bot.location.y >= 1.2 &&
        navHasWalkableLine(bot.dimension, bot.location, highGround, 1, 3)) {
      runtime.highGroundGoal = highGround;
      runtime.highGroundUntilTick = globalTick + 40;
    }
  }
  if (runtime.highGroundGoal && globalTick <= Number(runtime.highGroundUntilTick ?? -9999)) {
    const goal = runtime.highGroundGoal;
    if (Math.abs(bot.location.y - goal.y) > 0.6 || distance(bot.location, goal) > 1.2) {
      return {
        mode: TACTIC_HIGH_GROUND,
        goal,
        desiredDistance: maintainDistance,
        sprint: false,
        allowJump: true,
        reason: "高所を確保",
      };
    }
    runtime.highGroundGoal = undefined;
  }

  // 通常の戦闘: 周回しつつ維持距離をキープ
  return {
    mode: TACTIC_ENGAGE,
    goal: tacticComputeOrbitGoal(bot, target, config, Number(runtime.strafeDirection ?? 1)),
    desiredDistance: maintainDistance,
    sprint: totalDistance > SWORD_RANGE,
    allowJump: true,
    reason: "周回して交戦",
  };
}
