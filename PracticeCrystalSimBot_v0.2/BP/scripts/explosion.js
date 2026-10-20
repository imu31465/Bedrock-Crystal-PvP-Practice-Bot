import {
  system, BlockPermutation,
  AIR_ID, FIRE_ID, RESPAWN_ANCHOR_ID, CRYSTAL_POWER, ANCHOR_POWER,
  PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS, PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS,
  PATCH_ANCHOR_FORCE_FALLBACK, PATCH_ANCHOR_BLOCK_BREAK_RADIUS, PATCH_ANCHOR_FIRE_PLACE_CHANCE,
  PATCH_CRYSTAL_BLOCK_BREAK_RADIUS, PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS,
  PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS, PATCH_CRYSTAL_FORCE_FALLBACK_BREAK,
  PATCH_EXPLOSION_PRESERVE_IDS, WATER_ID,
  getExplosionRayDirections, getAnchorBreakOffsetsCachePool,
} from "./constants.js";
import { patchMobGriefingEnabled, setPatchMobGriefingEnabled } from "./state.js";
import {
  getBlock, isAirBlock, isSolidBlock, quoteCoord,
  isRespawnAnchorBlock, resolveRespawnAnchorPermutation,
  getExplosionLocation,
  runDimensionCommand,
} from "./utils.js";

// ── Utility ──
function patchDelayTicks(ticks = 1) {
  return new Promise(resolve => system.runTimeout(resolve, Math.max(0, Math.floor(Number(ticks) || 0))));
}

function patchShouldPreserveExplosionBlock(block) {
  const typeId = block?.typeId ?? AIR_ID;
  if (PATCH_EXPLOSION_PRESERVE_IDS.has(typeId)) return true;
  return /command_block|structure_block|jigsaw|allow|deny/.test(typeId);
}

// ── Mob Griefing ──
export async function patchEnsureMobGriefingEnabled(dimension) {
  if (patchMobGriefingEnabled) return true;
  try {
    await runDimensionCommand(dimension, "gamerule mobgriefing true");
    setPatchMobGriefingEnabled(true);
    return true;
  } catch { return false; }
}

// ── Block Set Helpers ──
export async function setBlockIdWithFallback(dimension, location, blockId, mode = "replace") {
  const block = getBlock(dimension, location);
  if (block?.typeId === "minecraft:bedrock") return false;
  if (mode === "keep" && block && !isAirBlock(block)) return false;
  if (block) { try { block.setPermutation(BlockPermutation.resolve(blockId)); return true; } catch {} }
  const command = `setblock ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)} ${blockId} ${mode}`;
  try { await runDimensionCommand(dimension, command); return true; } catch { return false; }
}

export async function setRespawnAnchorChargeWithFallback(dimension, location, charge) {
  const block = getBlock(dimension, location);
  if (!block) return false;
  if (block?.typeId === "minecraft:bedrock") return false;
  if (block && !isAirBlock(block) && !isRespawnAnchorBlock(block)) return false;
  if (block) { try { block.setPermutation(resolveRespawnAnchorPermutation(charge)); return true; } catch {} }
  const clampedCharge = Math.max(0, Math.min(4, Math.floor(charge)));
  const mode = isAirBlock(block) ? "keep" : "replace";
  const command = `setblock ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)} ${RESPAWN_ANCHOR_ID} ["respawn_anchor_charge"=${clampedCharge}] ${mode}`;
  try { await runDimensionCommand(dimension, command); return true; } catch { return false; }
}

// ── [A-1/A-2] Damage top-up 機構の全廃 ──
// 旧実装の patchCaptureExplosionDamageSnapshots / patchScheduleExplosionDamageTopUp /
// patchCalculateRawDamageForBotNetResult は、独自モデルの期待値と実ダメージの差額を
// applyDamage / setHealthValue で強制適用する「ダメージ改竅」だった。
// 本修正で全廃し、起爆パス（crystal_explode イベント or createExplosion）＝Bedrock
// エンジンの実爆発のみを信頼する。防具・エンチャント・難易度・無敵フレーム・
// ノックバックの全パイプラインが実プレイヤーと同一に機能する。

export function patchGetDamageCauseForComboType(comboType = "crystal") {
  return comboType === "anchor" ? "blockExplosion" : "entityExplosion";
}

export function patchApplyDamageWithFallback(entity, damage, damageCause, source) {
  const numericDamage = Math.max(0, Number(damage ?? 0));
  if (!entity || numericDamage <= 0.01 || typeof entity.applyDamage !== "function") return false;
  const attempts = [
    source ? { cause: damageCause, damagingEntity: source } : { cause: damageCause },
    source ? { cause: damageCause, source } : { cause: damageCause },
    undefined,
  ];
  for (const options of attempts) {
    try { if (options) entity.applyDamage(numericDamage, options); else entity.applyDamage(numericDamage); return true; } catch {}
  }
  return false;
}

// ── [A-6/F-2/B-6] AI判断専用の爆発ダメージ推定 ──
// Wiki「Explosion」準拠: 影響半径 = 2P、距離は当たり判定の最近点(B-6)、
// impact = (1 - dist/2P) × exposure、raw = 7P(impact² + impact) + 1。
// 防具軽減は combat.js の patchCalculateExpectedHealthDamage（判断専用）で行う。
// 出力はスコアリングと自傷回避のみに使われ、HP への反映は一切行わない。

// [B-6] 爆発中心からエンティティ当たり判定(幅0.6×高1.8)の最近点への距離
export function distanceToEntityBox(entity, point) {
  const loc = entity.location;
  const halfW = 0.3, height = 1.8;
  const dx = Math.max(Math.abs(point.x - loc.x) - halfW, 0);
  const dz = Math.max(Math.abs(point.z - loc.z) - halfW, 0);
  const dy = Math.max(point.y - (loc.y + height), loc.y - point.y, 0);
  return Math.hypot(dx, dy, dz);
}

// 簡易 exposure: 当たり判定上の7点サンプルへの可視率（Javaはレイサンプリング）
function estimateExposure(entity, explosionLocation, dimension) {
  const loc = entity.location;
  const samples = [
    { x: loc.x, y: loc.y + 0.9, z: loc.z },
    { x: loc.x, y: loc.y + 0.15, z: loc.z },
    { x: loc.x, y: loc.y + 1.65, z: loc.z },
    { x: loc.x + 0.28, y: loc.y + 0.9, z: loc.z },
    { x: loc.x - 0.28, y: loc.y + 0.9, z: loc.z },
    { x: loc.x, y: loc.y + 0.9, z: loc.z + 0.28 },
    { x: loc.x, y: loc.y + 0.9, z: loc.z - 0.28 },
  ];
  let visible = 0;
  for (const sample of samples) {
    if (hasClearLine(dimension, explosionLocation, sample)) visible++;
  }
  return visible / samples.length;
}

function hasClearLine(dimension, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist <= 0.01) return true;
  const step = 0.45;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  for (let t = step; t < dist; t += step) {
    if (isSolidBlock(getBlock(dimension, { x: from.x + ux * t, y: from.y + uy * t, z: from.z + uz * t }))) return false;
  }
  return true;
}

// [F-2] Bedrockでは水中の爆発は無ダメージ (Mojira MCPE-21611, 2023年「仕様通り」裁定)。
// 爆発中心または被弾者が水中なら推定0（AIが無駄弾を置かないための判断専用）。
function isWaterBlockAt(dimension, location) {
  const block = getBlock(dimension, location);
  if (!block) return false;
  if (block.typeId === WATER_ID || block.typeId === "minecraft:flowing_water") return true;
  try { if (block.isLiquid && String(block.typeId).includes("water")) return true; } catch {}
  return false;
}

export function estimateExplosionDamage(entity, explosionLocation, comboType) {
  if (!entity || !entity.location) return 0;
  const dimension = entity.dimension;
  // [F-2] 水中判定（どちらかが水中なら期待ダメージ0）
  if (isWaterBlockAt(dimension, explosionLocation)) return 0;
  if (isWaterBlockAt(dimension, entity.location) ||
      isWaterBlockAt(dimension, { x: entity.location.x, y: entity.location.y + 1.0, z: entity.location.z })) return 0;
  const P = comboType === "anchor" || comboType === "bed" ? ANCHOR_POWER : CRYSTAL_POWER;
  const radius = 2 * P; // 実影響半径 = 2P
  const dist = distanceToEntityBox(entity, explosionLocation);
  if (dist >= radius) return 0;
  const exposure = estimateExposure(entity, explosionLocation, dimension);
  const impact = Math.max(0, 1 - dist / radius) * exposure;
  return 7 * P * (impact * impact + impact) + 1;
}

// ── Block Break Patterns ──
export function patchCaptureExplosionSnapshot(dimension, center, radius, minY = Number.NEGATIVE_INFINITY) {
  const entries = [];
  const radiusSquared = radius * radius;
  const minX = Math.floor(center.x - radius), maxX = Math.floor(center.x + radius);
  const minYBound = Math.floor(center.y - radius), maxY = Math.floor(center.y + radius);
  const minZ = Math.floor(center.z - radius), maxZ = Math.floor(center.z + radius);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minYBound; y <= maxY; y++) {
      if (y < minY) continue;
      for (let z = minZ; z <= maxZ; z++) {
        const dx = x + 0.5 - center.x, dy = y + 0.5 - center.y, dz = z + 0.5 - center.z;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
        const location = { x, y, z };
        const block = getBlock(dimension, location);
        if (!block || patchShouldPreserveExplosionBlock(block)) continue;
        entries.push({ location, typeId: block.typeId });
      }
    }
  }
  return entries;
}

function patchCountExplosionSnapshotChanges(dimension, snapshot, shouldIgnore) {
  let changed = 0;
  for (const entry of snapshot) {
    if (typeof shouldIgnore === "function" && shouldIgnore(entry)) continue;
    const block = getBlock(dimension, entry.location);
    if (!block || block.typeId !== entry.typeId) changed += 1;
  }
  return changed;
}

function patchCollectExplosionAffectedBlocks(dimension, center, power, maxRadius = 8.5) {
  const affected = new Map();
  const maxRadiusSquared = maxRadius * maxRadius;
  for (const { dx, dy, dz } of getExplosionRayDirections()) {
    let strength = power * (0.7 + Math.random() * 0.6);
    let currX = center.x, currY = center.y, currZ = center.z;
    while (strength > 0) {
      const loc = { x: Math.floor(currX), y: Math.floor(currY), z: Math.floor(currZ) };
      const distSq = (loc.x + 0.5 - center.x) ** 2 + (loc.y + 0.5 - center.y) ** 2 + (loc.z + 0.5 - center.z) ** 2;
      if (distSq > maxRadiusSquared) break;
      const block = getBlock(dimension, loc);
      if (block) {
        const isCenterAnchor = block.typeId === RESPAWN_ANCHOR_ID && loc.x === Math.floor(center.x) && loc.y === Math.floor(center.y) && loc.z === Math.floor(center.z);
        if (patchShouldPreserveExplosionBlock(block) && !isCenterAnchor) break;
        if (!isAirBlock(block) && !block.isLiquid && !isCenterAnchor) {
          affected.set(`${loc.x}|${loc.y}|${loc.z}`, loc);
          const typeId = block.typeId;
          let resistance = 1.0;
          if (typeId.includes("stone") || typeId.includes("deepslate") || typeId.includes("cobble")) resistance = 6.0;
          else if (typeId.includes("dirt") || typeId.includes("grass") || typeId.includes("sand")) resistance = 0.5;
          else if (typeId.includes("wood") || typeId.includes("log") || typeId.includes("planks")) resistance = 2.0;
          strength -= (resistance + 0.3) * 0.3;
        }
      }
      strength -= 0.225;
      currX += dx; currY += dy; currZ += dz;
    }
  }
  return [...affected.values()];
}

export function patchCollectAnchorBreakBlocks(dimension, baseLocation, useCache = false) {
  const explosionCenter = getExplosionLocation(baseLocation, "anchor");
  if (useCache) {
    const pool = getAnchorBreakOffsetsCachePool();
    const cx = Math.floor(explosionCenter.x), cy = Math.floor(explosionCenter.y), cz = Math.floor(explosionCenter.z);
    const hash = Math.abs(cx * 31 + cy * 17 + cz) % pool.length;
    return pool[hash].map(o => ({ x: cx + o.x, y: cy + o.y, z: cz + o.z })).filter(loc => {
      const block = getBlock(dimension, loc);
      return block && !patchShouldPreserveExplosionBlock(block);
    });
  }
  return [...new Map(patchCollectExplosionAffectedBlocks(dimension, explosionCenter, ANCHOR_POWER, PATCH_ANCHOR_BLOCK_BREAK_RADIUS).map(l => [`${l.x}|${l.y}|${l.z}`, l])).values()];
}

function patchCollectCrystalBreakBlocks(dimension, baseLocation) {
  const explosionCenter = getExplosionLocation(baseLocation, "crystal");
  const affected = new Map();
  const minimumBreakY = Math.floor(baseLocation.y) + 1;
  for (const location of patchCollectExplosionAffectedBlocks(dimension, explosionCenter, CRYSTAL_POWER, PATCH_CRYSTAL_BLOCK_BREAK_RADIUS)) {
    if (location.y < minimumBreakY) continue;
    affected.set(`${location.x}|${location.y}|${location.z}`, location);
  }
  return [...affected.values()];
}

async function patchBreakBlocksInAnchorPattern(dimension, centerBlockLocation, precomputedBlocks) {
  const affectedBlocks = precomputedBlocks ?? patchCollectAnchorBreakBlocks(dimension, centerBlockLocation);
  let processed = 0;
  for (const location of affectedBlocks) {
    const block = getBlock(dimension, location);
    if (!block || patchShouldPreserveExplosionBlock(block)) continue;
    try { block.setPermutation(BlockPermutation.resolve(AIR_ID)); continue; } catch {}
    await setBlockIdWithFallback(dimension, location, AIR_ID);
    processed++;
    if (processed % 12 === 0) await patchDelayTicks(1);
  }
  // Fire placement
  const explosionCenter = getExplosionLocation(centerBlockLocation, "anchor");
  let fireCount = 0;
  const MAX_FIRE = 50, fireRadius = 5.5, fireRadiusSq = fireRadius * fireRadius;
  for (let x = -Math.ceil(fireRadius); x <= Math.ceil(fireRadius) && fireCount < MAX_FIRE; x++) {
    for (let y = -Math.ceil(fireRadius); y <= Math.ceil(fireRadius) && fireCount < MAX_FIRE; y++) {
      for (let z = -Math.ceil(fireRadius); z <= Math.ceil(fireRadius) && fireCount < MAX_FIRE; z++) {
        if (x * x + y * y + z * z > fireRadiusSq || Math.random() > PATCH_ANCHOR_FIRE_PLACE_CHANCE) continue;
        const loc = { x: Math.floor(explosionCenter.x) + x, y: Math.floor(explosionCenter.y) + y, z: Math.floor(explosionCenter.z) + z };
        const block = getBlock(dimension, loc);
        const below = getBlock(dimension, { x: loc.x, y: loc.y - 1, z: loc.z });
        if (block && isAirBlock(block) && below && isSolidBlock(below) && !below.isLiquid) {
          try { block.setPermutation(BlockPermutation.resolve(FIRE_ID)); fireCount++; } catch {
            await setBlockIdWithFallback(dimension, loc, FIRE_ID); fireCount++;
          }
        }
      }
    }
  }
}

async function patchBreakBlocksInCrystalPattern(dimension, baseLocation) {
  const affectedBlocks = patchCollectCrystalBreakBlocks(dimension, baseLocation);
  let brokenBlocks = 0, processed = 0;
  for (const location of affectedBlocks) {
    const block = getBlock(dimension, location);
    if (!block || patchShouldPreserveExplosionBlock(block)) continue;
    try { block.setPermutation(BlockPermutation.resolve(AIR_ID)); brokenBlocks++; continue; } catch {}
    if (await setBlockIdWithFallback(dimension, location, AIR_ID)) brokenBlocks++;
    processed++;
    if (processed % 12 === 0) await patchDelayTicks(1);
  }
  return brokenBlocks;
}

function patchCreateExplosionWithFallback(dimension, location, power, options = {}) {
  const attempts = [options, { ...options, causesFire: false },
    (() => { const c = { ...options }; delete c.source; return c; })(),
    (() => { const c = { ...options, causesFire: false }; delete c.source; return c; })()];
  let lastError;
  for (const attempt of attempts) {
    try { dimension.createExplosion(location, power, attempt); return { success: true, options: attempt }; } catch (e) { lastError = e; }
  }
  return { success: false, error: lastError };
}

// ── Anchor Explosion ──
export async function runAnchorExplosionWithFallback(dimension, baseLocation, source, options = {}) {
  const anchorLocation = getExplosionLocation(baseLocation, "anchor");
  // [A-1] damageSnapshots / top-up は全廃。起爆は実エンジン爆発のみ。
  let explosionResult = { success: true }, changedBlocks = 0, usedFallback = false;
  if (PATCH_ANCHOR_FORCE_FALLBACK) {
    usedFallback = true;
    const affectedBlocks = patchCollectAnchorBreakBlocks(dimension, baseLocation, !!options?.useBreakCache);
    await patchBreakBlocksInAnchorPattern(dimension, baseLocation, affectedBlocks);
  } else {
    const nativeBreakSnapshot = patchCaptureExplosionSnapshot(dimension, anchorLocation, PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS);
    const expectedAffectedBlocks = patchCollectAnchorBreakBlocks(dimension, baseLocation);
    const centerBlock = getBlock(dimension, baseLocation);
    if (centerBlock && centerBlock.typeId === RESPAWN_ANCHOR_ID) { try { centerBlock.setPermutation(BlockPermutation.resolve(AIR_ID)); } catch {} }
    explosionResult = patchCreateExplosionWithFallback(dimension, anchorLocation, ANCHOR_POWER, { breaksBlocks: true, causesFire: false, source });
    changedBlocks = patchCountExplosionSnapshotChanges(dimension, nativeBreakSnapshot,
      options?.ignoreCenterAnchorChange ? (entry) => entry.typeId === RESPAWN_ANCHOR_ID && entry.location.x === baseLocation.x && entry.location.y === baseLocation.y && entry.location.z === baseLocation.z : undefined);
    const required = options?.requireFullNativeBreakPattern ? expectedAffectedBlocks.length : Math.min(PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS, expectedAffectedBlocks.length);
    if (changedBlocks < required) { usedFallback = true; await patchBreakBlocksInAnchorPattern(dimension, baseLocation, expectedAffectedBlocks); }
  }
  if (options?.debugMessage && typeof options.debugMessage === "function") options.debugMessage(changedBlocks, usedFallback, explosionResult);
  return { changedBlocks, usedFallback, explosionResult };
}

// ── Anchor Place+Detonate Sequence ──
export async function patchRunAnchorPlaceAndDetonateSequence(dimension, baseLocation, source, options = {}) {
  const placementMode = `${options?.placementMode ?? "place-anchor"}`;
  const needsCharge = options?.needsCharge === undefined ? (placementMode === "place-anchor" || Number(options?.existingCharge ?? 0) <= 0) : !!options.needsCharge;
  const detonateDelay = Math.max(0, Math.floor(Number(options?.detonateDelay ?? 0)));
  const temporaryAnchorPlaced = placementMode === "place-anchor";
  if (temporaryAnchorPlaced) {
    if ((await options?.beforePlace?.()) === false) return { cancelled: true, reason: "before-place" };
    if (!(await setRespawnAnchorChargeWithFallback(dimension, baseLocation, 0))) return { cancelled: true, reason: "place-failed" };
    await options?.onPlaced?.();
  } else if (!isRespawnAnchorBlock(getBlock(dimension, baseLocation))) return { cancelled: true, reason: "missing-anchor" };
  if (detonateDelay > 0) await patchDelayTicks(detonateDelay);
  if ((await options?.beforeExplode?.("pre-charge")) === false) {
    if (temporaryAnchorPlaced && options?.cleanupIfCancelled) await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
    return { cancelled: true, reason: "before-explode" };
  }
  if (needsCharge) {
    if ((await options?.beforeCharge?.()) === false) {
      if (temporaryAnchorPlaced && options?.cleanupIfCancelled) await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      return { cancelled: true, reason: "before-charge" };
    }
    if (!(await setRespawnAnchorChargeWithFallback(dimension, baseLocation, 1))) {
      if (temporaryAnchorPlaced && options?.cleanupIfCancelled) await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      return { cancelled: true, reason: "charge-failed" };
    }
    await options?.onCharged?.();
    await patchDelayTicks(1);
    if ((await options?.beforeExplode?.("final")) === false) {
      if (temporaryAnchorPlaced && options?.cleanupIfCancelled) await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      return { cancelled: true, reason: "before-final-explode" };
    }
  }
  const result = await runAnchorExplosionWithFallback(dimension, baseLocation, source, { ...(options?.explosionOptions ?? {}), debugMessage: options?.debugMessage });
  const centerBlock = getBlock(dimension, baseLocation);
  if (isRespawnAnchorBlock(centerBlock)) await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
  return { ...result, cancelled: false, needsCharge, temporaryAnchorPlaced };
}

// ── Crystal Explosion ──
async function patchDetonateCrystalExplosion(dimension, location, source, crystalEntity) {
  if (crystalEntity && typeof crystalEntity.triggerEvent === "function") {
    try { crystalEntity.triggerEvent("minecraft:crystal_explode"); return { success: true, mode: "api-event" }; } catch {}
  }
  const selectorCenter = `${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)}`;
  const commandAttempts = [
    `execute positioned ${selectorCenter} run event entity @e[r=2,c=1] minecraft:crystal_explode`,
    `event entity @e[x=${quoteCoord(location.x)},y=${quoteCoord(location.y)},z=${quoteCoord(location.z)},r=2,c=1] minecraft:crystal_explode`,
  ];
  for (const command of commandAttempts) {
    try { const result = await runDimensionCommand(dimension, command); if (Number(result?.successCount ?? 1) > 0) return { success: true, mode: "command-event" }; } catch {}
  }
  const explosionResult = patchCreateExplosionWithFallback(dimension, location, CRYSTAL_POWER, { breaksBlocks: true, causesFire: false, source });
  return { success: explosionResult.success, mode: "api", error: explosionResult.error };
}

export async function runCrystalExplosionWithFallback(dimension, baseLocation, source, crystalEntity) {
  const crystalLocation = getExplosionLocation(baseLocation, "crystal");
  // [A-1] damageSnapshots / top-up は全廃。起爆は実エンジン爆発のみ。
  const nativeBreakSnapshot = patchCaptureExplosionSnapshot(dimension, crystalLocation, PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS);
  await patchEnsureMobGriefingEnabled(dimension);
  const explosionResult = await patchDetonateCrystalExplosion(dimension, crystalLocation, source, crystalEntity);
  await patchDelayTicks(1);
  const changedBlocks = patchCountExplosionSnapshotChanges(dimension, nativeBreakSnapshot);
  let usedFallback = false, brokenBlocks = 0;
  if (PATCH_CRYSTAL_FORCE_FALLBACK_BREAK || !explosionResult.success || changedBlocks < PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS) {
    usedFallback = true;
    brokenBlocks = await patchBreakBlocksInCrystalPattern(dimension, baseLocation);
  }
  return { brokenBlocks, changedBlocks, crystalLocation, explosionResult, usedFallback };
}

// ── [B-5] Bed Bomb Explosion (ネザー/ジ・エンド限定) ──
// ベッドはオーバーワールド外で「使う」と P=5 の実エンジン爆発を起こす（アンカーと同威力）。
// 1) ベッドブロックを setblock で設置（2ブロック占有: foot + head）
// 2) 起爆は優先的に実操作（SimulatedPlayer のインタラクト）で行い、
//    不可能な環境では dimension.createExplosion(P=5) ＝ 実エンジン爆発にフォールバックする。
//    いずれの経路もダメージは Bedrock エンジンの計算のみ（A-1 原則）。
const BED_DIRECTIONS = [
  { dir: 0, dx: 0, dz: 1 },   // South
  { dir: 1, dx: -1, dz: 0 },  // West
  { dir: 2, dx: 0, dz: -1 },  // North
  { dir: 3, dx: 1, dz: 0 },   // East
];

export async function placeBedWithFallback(dimension, footLocation, sourceEntity) {
  // 設置方向: Botから見て奥へ伸ばす（head が対象側）
  let facing = BED_DIRECTIONS[0];
  try {
    if (sourceEntity?.location) {
      const dx = footLocation.x + 0.5 - sourceEntity.location.x;
      const dz = footLocation.z + 0.5 - sourceEntity.location.z;
      if (Math.abs(dz) >= Math.abs(dx)) facing = dz >= 0 ? BED_DIRECTIONS[0] : BED_DIRECTIONS[2];
      else facing = dx >= 0 ? BED_DIRECTIONS[3] : BED_DIRECTIONS[1];
    }
  } catch {}
  const head = { x: footLocation.x + facing.dx, y: footLocation.y, z: footLocation.z + facing.dz };
  const footBlock = getBlock(dimension, footLocation);
  const headBlock = getBlock(dimension, head);
  if (!footBlock || !isAirBlock(footBlock) || !headBlock || !isAirBlock(headBlock)) return false;
  // Bedrock のベッドブロック: minecraft:bed + direction/head_bit ステート
  try {
    dimension.getBlock(footLocation).setPermutation(BlockPermutation.resolve("minecraft:bed", { direction: facing.dir, head_bit: false }));
    dimension.getBlock(head).setPermutation(BlockPermutation.resolve("minecraft:bed", { direction: facing.dir, head_bit: true }));
    return true;
  } catch {}
  // コマンドフォールバック
  const cmd = (loc, headBit) =>
    `setblock ${quoteCoord(loc.x)} ${quoteCoord(loc.y)} ${quoteCoord(loc.z)} minecraft:bed ["direction"=${facing.dir},"head_bit"=${headBit ? "true" : "false"}] replace`;
  try {
    await runDimensionCommand(dimension, cmd(footLocation, false));
    await runDimensionCommand(dimension, cmd(head, true));
    return true;
  } catch { return false; }
}

export async function runBedExplosionWithFallback(dimension, footLocation, source, sourceEntity) {
  // (1) 実操作による起爆（本物のベッド爆発: 火・ブロック破壊・ダメージすべてエンジン側）
  if (sourceEntity && typeof sourceEntity.simulateInteract === "function") {
    try {
      // ベッドの方を向いてインタラクト
      sourceEntity.simulateInteract();
      await patchDelayTicks(2);
      // ベッドが消えていれば実爆発が起きた
      const foot = getBlock(dimension, footLocation);
      if (!foot || foot.typeId !== "minecraft:bed") {
        return { success: true, mode: "interact" };
      }
    } catch {}
  }
  // (2) フォールバック: 実API爆発 (P=5 = ベッドと同威力、ダメージはエンジン計算)
  const center = { x: footLocation.x + 0.5, y: footLocation.y + 0.6, z: footLocation.z + 0.5 };
  const explosionResult = patchCreateExplosionWithFallback(dimension, center, ANCHOR_POWER, { breaksBlocks: true, causesFire: false, source });
  // ベッド残骸を掃除（実爆発と同じ扱い）
  try {
    const foot = getBlock(dimension, footLocation);
    if (foot?.typeId === "minecraft:bed") foot.setPermutation(BlockPermutation.resolve(AIR_ID));
  } catch {}
  return { success: explosionResult.success, mode: "api", error: explosionResult.error };
}
