// ── Tactics ──
// ターゲットの相対位置(上/下/同高/遠/近)と地形から「今どう動くべきか」を決める層。
// 移動の実行は movement.js が担当し、ここは意思決定と足場作りだけを行う。

import {
  BlockPermutation, EntityComponentTypes, system,
  OBSIDIAN_ID, SWORD_RANGE, MOVE_FILLER_BLOCK_IDS,
  TACTIC_TARGET_ABOVE_THRESHOLD, TACTIC_TARGET_BELOW_THRESHOLD,
  TACTIC_PILLAR_MAX_HEIGHT, TACTIC_BRIDGE_MAX_LENGTH,
  TACTIC_PLACE_COOLDOWN_TICKS, TACTIC_LOW_GROUND_SEARCH_Y,
  TACTIC_LEDGE_SAFETY_MARGIN, PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE,
  SURROUND_OFFSETS, SURROUND_MIN_SEAL, SURROUND_COOLDOWN_TICKS, SURROUND_TARGET_MAX_SPEED,
  SURROUND_WIP_COOLDOWN_TICKS, SURROUND_SEAL_EXPIRE_TICKS,
  SURF_MIN_HP_AFTER, SURF_COOLDOWN_TICKS,
} from "./constants.js";
import { globalTick, globalSettings } from "./state.js";
import {
  distance, addVector, vectorTo, normalize2D, floorLocation,
  getBlock, isAirBlock, isSolidBlock, quoteCoord,
  isLocationInsideBotBoundary, patchRunDimensionCommandNoThrow,
  countItemInContainer, debugLog, patchGetCurrentHealthValue,
} from "./utils.js";
import { getRuntime } from "./config.js";
import {
  navIsStandableCell, navFindStandableNear, navFindGroundY,
  navIsPassableBlock, navCanOccupy, navHasWalkableLine,
} from "./navigation.js";
import { equipMainhandItem, consumeManagedItem, selectBestSword, patchCalculateExpectedHealthDamage } from "./inventory.js";
import { estimateExplosionDamage, runCrystalExplosionWithFallback, patchRunAnchorPlaceAndDetonateSequence, setBlockIdWithFallback } from "./explosion.js";

// ── Tactic modes ──
export const TACTIC_ENGAGE = "engage";        // 同高度・射程内 → 周回して殴る
export const TACTIC_CLOSE_GAP = "close_gap";  // 遠い → 最短で詰める
export const TACTIC_CLIMB = "climb";          // ターゲットが上（遠方）→ 登る/柱を立てる
export const TACTIC_DESCEND = "descend";      // ターゲットが下 → 安全に降りる
export const TACTIC_KITE = "kite";            // 回復中 → 距離を取る
// [B-7] CrystalPvPの実戦メタは「低位有利」(2b2t Wiki: gaining the lower ground)。
// 爆風は体の下面にのみ当たるため、低い位置に立つ側が被弾を最小化できる。
export const TACTIC_LOW_GROUND = "low_ground"; // 低位を取ってから戦う（旧 high_ground の反転）
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

// ── [B-7] 低位（ローグラウンド）取り ──
// CrystalPvPの実戦メタは「低位有利」: 爆風はプレイヤーの体の下面にのみ当たり
// 上面には当たらない（2b2t Wiki）。相手の足元以下（dy=-2〜0）で、射程内に入れる
// 立ち位置を探し、低いほど高スコアを与える。旧 tacticFindHighGroundGoal は
// このメタと逆（高所 +2.6/tick）だったため置き換えた。
export function tacticFindLowGroundGoal(bot, target, config) {
  const desired = Math.max(1.4, Number(config.maintainDistance ?? 3));
  const targetFloor = floorLocation(target.location);
  const searchRadius = Math.min(7, Math.ceil(desired) + 3);
  let best, bestScore = Number.NEGATIVE_INFINITY;
  for (let dy = -TACTIC_LOW_GROUND_SEARCH_Y; dy <= 0; dy++) {
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
        // 低いほど有利（体の上面は爆風が当たらない。1ブロック下なら致死級も生存可）
        const lowAdvantage = targetFloor.y - candidate.y;
        const score = lowAdvantage * 2.6 - Math.abs(horizontal - desired) * 1.3 - travel * 0.42;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
  }
  return best;
}

// ── [B-3] サラウンド（囲い戦術）──
// 相手の周囲4面+足元を黒曜石で塞いで逃げ道を断つ。設置は tacticPlaceBlockAt の
// クールダウンに従って数ティックに分けて行われ、4面封鎖で成立 → 直後の
// クリスタルコンボが確実に通る。
export function trySurroundTarget(bot, target, config) {
  if (config.surroundTactic === false || config.blockPlacing === false) return false;
  const runtime = getRuntime(config.uid);
  // [v0.5.0] 封鎖が未完成のうちは高速で試行を重ねる (旧: 途中でも3秒待つため囲いが
  // 完成する前に通常起爆が「部分囲いの隙間」から飛び、囲いだけが相手の盾になる事故が起きた)
  const sealedBefore = countSurroundSeal(bot, target);
  const cd = sealedBefore >= SURROUND_MIN_SEAL ? SURROUND_COOLDOWN_TICKS : SURROUND_WIP_COOLDOWN_TICKS;
  if (globalTick - Number(runtime.lastSurroundTick ?? -9999) < cd) return false;
  // 相手がほぼ静止（接地して動けない）時のみ狙う
  let speed = 0;
  try { const v = target.velocity; speed = Math.hypot(v.x, v.y, v.z); } catch {}
  if (speed > SURROUND_TARGET_MAX_SPEED) return false;
  if (distance(bot.location, target.location) > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE + 1) return false;
  runtime.lastSurroundTick = globalTick;
  const feet = floorLocation(target.location);
  // [v0.5.0] 囲い対象を記録 (scanCrystalCandidates/scanAnchorCandidates が参照)。
  // 1個でも置いた時点で記録する — 部分囲いでも既に側面起爆は遮蔽され、
  // 相手を守ってしまうため (ユーザー実機指摘の根本原因)。
  runtime.surroundTargetId = String(target.id);
  runtime.surroundSealTick = globalTick;
  let sealed = 0, placed = 0;
  for (const off of SURROUND_OFFSETS) {
    const loc = { x: feet.x + off.x, y: feet.y + off.y, z: feet.z + off.z };
    if (off.y === 0 && loc.x === Math.floor(bot.location.x) && loc.z === Math.floor(bot.location.z) &&
        Math.abs(loc.y - Math.floor(bot.location.y)) <= 1) continue; // Bot自身の位置は塞がない
    const block = getBlock(bot.dimension, loc);
    if (block && !isAirBlock(block)) { sealed++; continue; }         // 既に塞がっている
    if (placed >= 2) continue;                                       // 1呼び出しで2設置まで
    if (tacticPlaceBlockAt(bot, config, loc)) { sealed++; placed++; }
  }
  if (sealed >= SURROUND_MIN_SEAL) {
    debugLog(bot, config, "combat", `§d[Surround] 封鎖成立 ${sealed}/5 → 頭上起爆へ移行`, true);
    return true;   // 呼び出し側は直後の爆発コンボへ繋ぐ
  }
  if (placed > 0) debugLog(bot, config, "combat", `§d[Surround] 封鎖進捗 ${sealed}/5`, false);
  return false;
}

// [v0.5.0] 現在の封鎖数を数える（高速試行のCD判定用）
function countSurroundSeal(bot, target) {
  try {
    const feet = floorLocation(target.location);
    let sealed = 0;
    for (const off of SURROUND_OFFSETS) {
      if (off.y !== 0) continue; // 側面4面のみカウント
      const block = getBlock(bot.dimension, { x: feet.x + off.x, y: feet.y + off.y, z: feet.z + off.z });
      if (block && !isAirBlock(block)) sealed++;
    }
    return sealed;
  } catch { return SURROUND_MIN_SEAL; }
}

// ── [C-2] クリスタルサーフィン ──
// 自分の足元前方に黒曜石+クリスタルを置いて自爆し、エンジンの爆発ノックバックで
// 高速移動・高度獲得を行う実戦移動技術。自傷推定 (A-6) を超えたら不発。
// ダメージもノックバックもすべてエンジン計算（実プレイヤーと同一）。
export async function tryCrystalSurf(bot, config, direction) {
  if (config.crystalSurf === false || config.crystalCombo === false) return false;
  if (config.blockPlacing === false) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastSurfTick ?? -9999) < SURF_COOLDOWN_TICKS) return false;
  const dir = normalize2D(direction);
  if (!dir || (Math.abs(dir.x) < 0.01 && Math.abs(dir.z) < 0.01)) return false;
  const feet = floorLocation(bot.location);
  const base = { x: feet.x + Math.round(dir.x), y: feet.y, z: feet.z + Math.round(dir.z) };
  // 設置先は空気、その上も空気（クリスタルは2x2）
  if (!isAirBlock(getBlock(bot.dimension, base))) return false;
  if (!isAirBlock(getBlock(bot.dimension, { x: base.x, y: base.y + 1, z: base.z }))) return false;
  // 自傷推定 [A-6]: エンジンが計算する自爆ダメージを見積もる
  const crystalLocation = { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 };
  const rawSelf = estimateExplosionDamage(bot, crystalLocation, "crystal");
  const selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelf, "entityExplosion");
  const hpAfter = patchGetCurrentHealthValue(bot) - selfDamage;
  if (hpAfter < SURF_MIN_HP_AFTER && !hasTotemInOffhand(bot)) return false; // 危険なら不発
  runtime.lastSurfTick = globalTick;
  // 実行: 黒曜石設置 → クリスタル設置 → エンジン起爆（ノックバックで移動）
  if (!equipMainhandItem(bot, OBSIDIAN_ID, config)) return false;
  if (!consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) return false;
  if (!(await setBlockIdWithFallback(bot.dimension, base, OBSIDIAN_ID, "keep"))) return false;
  if (!equipMainhandItem(bot, "minecraft:end_crystal", config)) return false;
  if (!consumeManagedItem(bot, config, "minecraft:end_crystal", 1)) return false;
  const crystal = bot.dimension.spawnEntity("minecraft:end_crystal", crystalLocation);
  await new Promise(resolve => system.runTimeout(resolve, 1));
  await runCrystalExplosionWithFallback(bot.dimension, base, bot, crystal);
  selectBestSword(bot);
  debugLog(bot, config, "movement", `§d[Surf] サーフィン起爆 estSelf=${selfDamage.toFixed(1)}`, true);
  return true;
}

function hasTotemInOffhand(bot) {
  try {
    const equippable = bot.getComponent("minecraft:equippable");
    return equippable?.getEquipment?.("Offhand")?.typeId === "minecraft:totem_of_undying";
  } catch { return false; }
}

// ── [C-3] アンカージャンプ ──
// ジャンプで浮いた瞬間に足元（旧足位置）へアンカーを置き、チャージ1で起爆して
// 上方向KBを得る。ネザー以外の次元で有効（アンカーはネザー以外で爆発する）。
export async function tryAnchorJump(bot, config) {
  if (config.crystalSurf === false || config.anchorCombo === false) return false;
  if (bot.dimension.id === "minecraft:nether") return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastAnchorJumpTick ?? -9999) < SURF_COOLDOWN_TICKS) return false;
  // 自傷推定 [A-6]
  const feet = floorLocation(bot.location);
  const explosionLocation = { x: feet.x + 0.5, y: feet.y + 0.5, z: feet.z + 0.5 };
  const rawSelf = estimateExplosionDamage(bot, explosionLocation, "anchor");
  const selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelf, "blockExplosion");
  if (patchGetCurrentHealthValue(bot) - selfDamage < SURF_MIN_HP_AFTER && !hasTotemInOffhand(bot)) return false;
  runtime.lastAnchorJumpTick = globalTick;
  // ジャンプ → 浮いた先の旧足位置にアンカー設置＋チャージ＋起爆（すべて実エンジン爆発）
  try { bot.applyImpulse({ x: 0, y: 0.42, z: 0 }); } catch {}
  await new Promise(resolve => system.runTimeout(resolve, 2));
  const result = await patchRunAnchorPlaceAndDetonateSequence(bot.dimension, feet, bot, {
    placementMode: "place-anchor", needsCharge: true, detonateDelay: 1, cleanupIfCancelled: true,
  });
  selectBestSword(bot);
  if (!result?.cancelled) debugLog(bot, config, "movement", `§d[AnchorJump] 起爆 estSelf=${selfDamage.toFixed(1)}`, true);
  return !result?.cancelled;
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

  // ターゲットが上 → [B-7] 射程内なら登らずに足元（柱の根元）を狙う
  // 爆風は体の下面にのみ当たるため、上にいる相手ほど足元起爆で大ダメージを受ける。
  // Botは安全な低位から攻撃でき、自ら最大被弾位置（高所）に立つ必要がない。
  if (verticalDelta >= TACTIC_TARGET_ABOVE_THRESHOLD) {
    if (horizontalDistance <= PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE) {
      // 射程内の高所の相手: その場の高さで交戦（足元への起爆は通常のコンボが担う）
      return {
        mode: TACTIC_ENGAGE,
        goal: tacticComputeOrbitGoal(bot, target, config, Number(runtime.strafeDirection ?? 1)),
        desiredDistance: maintainDistance,
        sprint: horizontalDistance > 3,
        allowJump: false, // ジャンプで浮くと自分の下面を曝すため抑制
        reason: `相手は高所・射程内 → 低位から足元を狙う (+${verticalDelta.toFixed(1)})`,
      };
    }
    // 遠方の高所: 根元まで最短で詰める（柱は最終手段のみ）
    const goal = navFindStandableNear(bot.dimension, { x: target.location.x, y: target.location.y - 2, z: target.location.z }, 3, 3) ??
                 navFindStandableNear(bot.dimension, target.location, 3, 3);
    return {
      mode: TACTIC_CLIMB,
      goal,
      desiredDistance: maintainDistance,
      sprint: horizontalDistance > 3,
      allowJump: true,
      reason: `ターゲットが上・遠方 → 根元へ詰める (+${verticalDelta.toFixed(1)})`,
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

  // 射程内。[B-7] 低位（ローグラウンド）が近くにあるなら取りに行く
  // （実戦メタ: 低い位置に立つ側が有利。旧「高所を取る」はメタと逆だった）
  const wantsLowGround = config.highGroundTactic !== false && config.crystalCombo !== false &&
    verticalDelta < 1.0 &&
    globalTick - Number(runtime.lastLowGroundSearchTick ?? -9999) >= 40;
  if (wantsLowGround) {
    runtime.lastLowGroundSearchTick = globalTick;
    const lowGround = tacticFindLowGroundGoal(bot, target, config);
    // 意味があるのは「今より少なくとも1ブロック低い」位置にある場合のみ
    if (lowGround && bot.location.y - lowGround.y >= 1.2 &&
        navHasWalkableLine(bot.dimension, bot.location, lowGround, 1, 3)) {
      runtime.lowGroundGoal = lowGround;
      runtime.lowGroundUntilTick = globalTick + 40;
    }
  }
  if (runtime.lowGroundGoal && globalTick <= Number(runtime.lowGroundUntilTick ?? -9999)) {
    const goal = runtime.lowGroundGoal;
    if (Math.abs(bot.location.y - goal.y) > 0.6 || distance(bot.location, goal) > 1.2) {
      return {
        mode: TACTIC_LOW_GROUND,
        goal,
        desiredDistance: maintainDistance,
        sprint: false,
        allowJump: false, // 低位へは落ちて移動（ジャンプで浮かない）
        reason: "低位を確保 (ローグラウンド)",
      };
    }
    runtime.lowGroundGoal = undefined;
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
