import {
  system, BlockPermutation,
  AIR_ID, FIRE_ID, RESPAWN_ANCHOR_ID, CRYSTAL_POWER, ANCHOR_POWER,
  CRYSTAL_DAMAGE_SCORE_RADIUS, ANCHOR_DAMAGE_SCORE_RADIUS,
  PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS, PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS,
  PATCH_ANCHOR_FORCE_FALLBACK, PATCH_ANCHOR_BLOCK_BREAK_RADIUS, PATCH_ANCHOR_FIRE_PLACE_CHANCE,
  PATCH_CRYSTAL_BLOCK_BREAK_RADIUS, PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS,
  PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS, PATCH_CRYSTAL_FORCE_FALLBACK_BREAK,
  PATCH_EXPLOSION_PRESERVE_IDS, BOT_TYPE,
  getExplosionRayDirections, getAnchorBreakOffsetsCachePool,
} from "./constants.js";
import { patchMobGriefingEnabled, setPatchMobGriefingEnabled, globalTick } from "./state.js";
import {
  getBlock, isAirBlock, isSolidBlock, addVector, quoteCoord, floorLocation,
  isEntityUsable, isRespawnAnchorBlock, resolveRespawnAnchorPermutation,
  getExplosionLocation, distance, distanceSquared,
  patchGetCurrentHealthValue, getBotUid, getPlayersInDimension,
  runDimensionCommand, patchRunDimensionCommandNoThrow,
  getAllBots, setHealthValue,
} from "./utils.js";
import {
  patchCalculateExpectedHealthDamage,
  patchCalculateRawDamageForBotNetResult,
} from "./inventory.js";

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

// ── Damage Snapshots ──
function patchShouldTrackExplosionVictim(entity, explosionLocation, maxDistanceSquared) {
  if (!entity?.id) return false;
  if (patchGetCurrentHealthValue(entity) <= 0.01) return false;
  if (distanceSquared(entity.location, explosionLocation) > maxDistanceSquared) return false;
  if (entity.typeId === BOT_TYPE) return isEntityUsable(entity, BOT_TYPE);
  if (entity.typeId !== "minecraft:player") return false;
  try {
    const gameMode = entity.getGameMode?.();
    if (gameMode && gameMode !== "survival" && gameMode !== "adventure") return false;
  } catch {}
  return true;
}

export function patchCaptureExplosionDamageSnapshots(dimension, explosionLocation, comboType = "crystal") {
  const radius = comboType === "anchor" ? ANCHOR_DAMAGE_SCORE_RADIUS : CRYSTAL_DAMAGE_SCORE_RADIUS;
  const maxDistanceSquared = Math.pow(radius + 1.5, 2);
  const damageCause = patchGetDamageCauseForComboType(comboType);
  const damageMultiplier = comboType === "anchor" ? 2.5 : 1.5;
  const snapshots = [];
  const seen = new Set();
  const addEntity = (entity) => {
    if (!patchShouldTrackExplosionVictim(entity, explosionLocation, maxDistanceSquared) || seen.has(entity.id)) return;
    const rawDamage = estimateExplosionDamageScore(entity, explosionLocation, radius, comboType);
    if (rawDamage <= 0.05) return;
    seen.add(entity.id);
    snapshots.push({
      entity,
      beforeHealth: patchGetCurrentHealthValue(entity),
      rawDamage,
      expectedNetDamage: patchCalculateExpectedHealthDamage(entity, rawDamage * damageMultiplier, damageCause),
    });
  };
  for (const player of getPlayersInDimension(dimension)) addEntity(player);
  for (const bot of getAllBots()) { if (bot.dimension.id === dimension.id) addEntity(bot); }
  return snapshots;
}

export function patchGetDamageCauseForComboType(comboType = "crystal") {
  return comboType === "anchor" ? "blockExplosion" : "entityExplosion";
}

export function patchScheduleExplosionDamageTopUp(snapshots, comboType, source) {
  if (!Array.isArray(snapshots) || !snapshots.length) return;
  const damageCause = patchGetDamageCauseForComboType(comboType);
  const damageMultiplier = comboType === "anchor" ? 2.5 : 1.5;
  system.runTimeout(() => {
    for (const snapshot of snapshots) {
      const entity = snapshot.entity;
      if (!entity?.id) continue;
      if (entity.typeId === BOT_TYPE) { if (!isEntityUsable(entity, BOT_TYPE)) continue; }
      else if (patchGetCurrentHealthValue(entity) <= 0.01) continue;
      const currentHealth = patchGetCurrentHealthValue(entity);
      const actualDamage = Math.max(0, Number(snapshot.beforeHealth ?? 0) - currentHealth);
      const expectedNetDamage = Number(snapshot.expectedNetDamage ?? patchCalculateExpectedHealthDamage(entity, snapshot.rawDamage * damageMultiplier, damageCause));
      if (entity.typeId === BOT_TYPE && actualDamage > expectedNetDamage + 0.2) {
        setHealthValue(entity, Math.max(0.01, Number(snapshot.beforeHealth ?? currentHealth) - expectedNetDamage));
        continue;
      }
      const missingNetDamage = Number((expectedNetDamage - actualDamage).toFixed(2));
      if (missingNetDamage <= 0.2) continue;
      const appliedDamage = entity.typeId === BOT_TYPE
        ? patchCalculateRawDamageForBotNetResult(entity, missingNetDamage, damageCause)
        : missingNetDamage;
      patchApplyDamageWithFallback(entity, appliedDamage, damageCause, source);
    }
  }, 1);
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

// ── Explosion Damage Score ──
export function estimateExplosionDamageScore(entity, explosionLocation, radius, comboType) {
  const dist = distance(entity.location, explosionLocation);
  if (dist > radius) return 0;
  const normalized = 1 - dist / radius;
  const baseDamage = normalized * normalized * (comboType === "anchor" ? 90 : 65);
  return Math.max(0, baseDamage);
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
  const damageSnapshots = patchCaptureExplosionDamageSnapshots(dimension, anchorLocation, "anchor");
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
  patchScheduleExplosionDamageTopUp(damageSnapshots, "anchor", source);
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
  const damageSnapshots = patchCaptureExplosionDamageSnapshots(dimension, crystalLocation, "crystal");
  const nativeBreakSnapshot = patchCaptureExplosionSnapshot(dimension, crystalLocation, PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS);
  await patchEnsureMobGriefingEnabled(dimension);
  const explosionResult = await patchDetonateCrystalExplosion(dimension, crystalLocation, source, crystalEntity);
  patchScheduleExplosionDamageTopUp(damageSnapshots, "crystal", source);
  await patchDelayTicks(1);
  const changedBlocks = patchCountExplosionSnapshotChanges(dimension, nativeBreakSnapshot);
  let usedFallback = false, brokenBlocks = 0;
  if (PATCH_CRYSTAL_FORCE_FALLBACK_BREAK || !explosionResult.success || changedBlocks < PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS) {
    usedFallback = true;
    brokenBlocks = await patchBreakBlocksInCrystalPattern(dimension, baseLocation);
  }
  return { brokenBlocks, changedBlocks, crystalLocation, explosionResult, usedFallback };
}
