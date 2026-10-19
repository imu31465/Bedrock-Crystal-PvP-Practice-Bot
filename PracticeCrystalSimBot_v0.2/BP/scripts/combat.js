import {
  system, EntityComponentTypes, EquipmentSlot, ItemStack,
  BOT_TYPE, OBSIDIAN_ID, END_CRYSTAL_ID, END_CRYSTAL_ENTITY_ID,
  RESPAWN_ANCHOR_ID, GLOWSTONE_ID, AIR_ID, SWORD_RANGE,
  MAX_INTERACT_DISTANCE, CRYSTAL_OFFSETS, CRYSTAL_SCAN_MIN, CRYSTAL_SCAN_MAX,
  COMBAT_PLACEMENT_ENTITY_RADIUS, COMBAT_PLACEMENT_ENTITY_HEIGHT,
  PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE,
} from "./constants.js";
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
  spawnEntityWithFallback, getExplosionLocation, findNearestTarget,
  patchRunDimensionCommandNoThrow, quoteCoord,
} from "./utils.js";
import { getRuntime, normalizeGlobalSettings } from "./config.js";
import {
  selectBestSword, equipMainhandItem, consumeManagedItem,
  patchCalculateNetDamage, patchCalculateExpectedHealthDamage,
  patchGetSwordCombatStatsFromItem,
  ensureAutoTotem,
} from "./inventory.js";
import {
  estimateExplosionDamageScore, patchApplyDamageWithFallback,
  patchRunAnchorPlaceAndDetonateSequence, runCrystalExplosionWithFallback,
  patchEnsureMobGriefingEnabled,
} from "./explosion.js";

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
  if (config.ignoreSelfDamage) return true;
  if (selfDamage <= 0.05) return true;
  const botHealth = patchGetCurrentHealthValue(bot);
  if (selfDamage >= botHealth - 2) return false;
  return targetDamage > selfDamage * 0.5;
}

function findShieldBlock(bot, explosionLocation) {
  const dist = distance(bot.location, explosionLocation);
  if (dist < 2.5) return undefined;
  const dir = normalize2D(vectorTo(bot.location, explosionLocation));
  const shieldLoc = {
    x: Math.floor(bot.location.x + dir.x * 1.5),
    y: Math.floor(bot.location.y + 1), // Eye level
    z: Math.floor(bot.location.z + dir.z * 1.5)
  };
  if (shieldLoc.x === Math.floor(explosionLocation.x) && shieldLoc.y === Math.floor(explosionLocation.y) && shieldLoc.z === Math.floor(explosionLocation.z)) return undefined;
  try {
    if (isAirBlock(getBlock(bot.dimension, shieldLoc))) return shieldLoc;
  } catch {}
  return undefined;
}

function canPlaceEntityAt(dimension, location) {
  const feetBlock = getBlock(dimension, location);
  const headBlock = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  return isAirBlock(feetBlock) && isAirBlock(headBlock);
}

export function scanCrystalCandidates(bot, target, config) {
  const candidates = [];
  const botFloor = floorLocation(bot.location);
  const targetFloor = floorLocation(target.location);
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
      const rawTargetDamage = estimateExplosionDamageScore(target, crystalLocation, 6, "crystal");
      const rawSelfDamage = estimateExplosionDamageScore(bot, crystalLocation, 6, "crystal");
      const targetDamage = patchCalculateExpectedHealthDamage(target, rawTargetDamage, "entityExplosion");
      let selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "entityExplosion");
      if (targetDamage < 1) continue;
      
      let shieldBlock = undefined;
      if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) {
        shieldBlock = findShieldBlock(bot, crystalLocation);
        if (shieldBlock && !patchCanPlaceCombatBlock(bot, shieldBlock)) shieldBlock = undefined;
        if (!shieldBlock) continue;
        const shieldedSelfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage * 0.2, "entityExplosion");
        if (!isExplosionCandidateSafe(bot, targetDamage, shieldedSelfDamage, config)) continue;
        selfDamage = shieldedSelfDamage;
      }
      
      let score = targetDamage - selfDamage * 0.5;
      if (yOffset <= 0) score += 4; // Height advantage
      if (botFloor.y > crystalLocation.y) score += 2; // Bot is above explosion
      if (placementMode === "existing-base") score += 8; // Reuse existing bases instead of spending obsidian.
      
      candidates.push({ location: base, placementMode, targetDamage, selfDamage, score, shieldBlock });
    }
  }
  candidates.sort((a, b) => {
    const basePreference = Number(b.placementMode === "existing-base") - Number(a.placementMode === "existing-base");
    return basePreference || b.score - a.score;
  });
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
  const targetFloor = floorLocation(target.location);
  for (const offset of CRYSTAL_OFFSETS) {
    for (const yOffset of [0, -1, 1, -2]) {
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
      const rawTargetDamage = estimateExplosionDamageScore(target, explosionLocation, 5.25, "anchor");
      const rawSelfDamage = estimateExplosionDamageScore(bot, explosionLocation, 5.25, "anchor");
      const targetDamage = patchCalculateExpectedHealthDamage(target, rawTargetDamage, "blockExplosion");
      let selfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage, "blockExplosion");
      if (targetDamage < 1) continue;
      
      let shieldBlock = undefined;
      if (!isExplosionCandidateSafe(bot, targetDamage, selfDamage, config)) {
        shieldBlock = findShieldBlock(bot, explosionLocation);
        if (shieldBlock && !patchCanPlaceCombatBlock(bot, shieldBlock)) shieldBlock = undefined;
        if (!shieldBlock) continue;
        const shieldedSelfDamage = patchCalculateExpectedHealthDamage(bot, rawSelfDamage * 0.2, "blockExplosion");
        if (!isExplosionCandidateSafe(bot, targetDamage, shieldedSelfDamage, config)) continue;
        selfDamage = shieldedSelfDamage;
      }

      let score = targetDamage - selfDamage * 0.5;
      if (yOffset === -1 && Math.abs(offset.x) <= 1 && Math.abs(offset.z) <= 1) {
        try {
          if (isSolidBlock(getBlock(target.dimension, { x: targetFloor.x, y: targetFloor.y - 1, z: targetFloor.z }))) {
            score += 8; // Anchor Down Tactics: break footing
          }
        } catch {}
      }

      candidates.push({ location: base, placementMode, existingCharge, targetDamage, selfDamage, score, shieldBlock });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  try {
    if (Number(globalTick % 30) === 1) {
      const best = candidates[0];
      appendPersistentDebugLog("scan", `${config.displayName}: anchor cand=${candidates.length}${best ? ` best=${best.placementMode}${best.existingCharge ? `(${best.existingCharge})` : ""}` : ""}`);
    }
  } catch {}
  return candidates;
}

export function chooseBestExplosiveAction(bot, target, config) {
  if (patchShouldDelayAction(config, "explosive")) return undefined;
  if (patchRandomChance(config.suboptimalRate)) return undefined;
  const runtime = getRuntime(config.uid);
  const anchorReady = config.anchorCombo && bot.dimension.id !== "minecraft:nether" && globalTick - runtime.lastAnchorTick >= config.anchorCooldown && !runtime.pendingAnchor;
  const crystalReady = config.crystalCombo && globalTick - runtime.lastCrystalTick >= config.crystalCooldown && !runtime.pendingCrystal;
  let bestAnchor, bestCrystal;
  if (anchorReady) {
    const anchors = scanAnchorCandidates(bot, target, config);
    if (anchors.length) bestAnchor = anchors[0];
  }
  if (crystalReady) {
    const crystals = scanCrystalCandidates(bot, target, config);
    if (crystals.length) bestCrystal = crystals[0];
  }
  if (!bestAnchor && !bestCrystal) return undefined;
  if (bestAnchor && bestCrystal) {
    return bestAnchor.score >= bestCrystal.score
      ? { type: "anchor", candidate: bestAnchor }
      : { type: "crystal", candidate: bestCrystal };
  }
  return bestAnchor ? { type: "anchor", candidate: bestAnchor } : { type: "crystal", candidate: bestCrystal };
}

// ── Sword Combo ──
export function handleSwordCombo(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) return;
  const currentDistance = distance(bot.location, target.location);
  if (!config.swordCombo || currentDistance > SWORD_RANGE || currentDistance > MAX_INTERACT_DISTANCE) return;
  if (!patchHasCombatLineOfSight(bot, target)) { debugLog(bot, config, "combat", "壁越しの剣攻撃をスキップしました。"); return; }
  if (globalTick - runtime.lastSwordTick < config.swordCooldown) return;
  runtime.lastSwordTick = globalTick;
  if (patchShouldDelayAction(config, "sword")) return;
  const swordStats = selectBestSword(bot);
  const direction = normalize2D(vectorTo(bot.location, target.location));
  const finalDamage = patchCalculateNetDamage(target, swordStats.damage, "entityAttack");
  faceBotToward(bot, patchApplyAimJitter(addVector(target.location, { x: 0, y: 1.2, z: 0 }), config));
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  if (patchRandomChance(config.mistakeRate)) { debugLog(bot, config, "combat", "剣コンボを空振りしました。", true); return; }
  patchApplyDamageWithFallback(target, finalDamage, "entityAttack", bot);
  try { target.applyImpulse({ x: direction.x * (0.18 + swordStats.knockbackLevel * 0.05), y: 0.04, z: direction.z * (0.18 + swordStats.knockbackLevel * 0.05) }); } catch {}
  if (swordStats.fireAspectLevel > 0) { try { target.setOnFire(4 * swordStats.fireAspectLevel, true); } catch {} }
  debugLog(bot, config, "combat", `剣コンボ命中: raw=${swordStats.damage} final=${finalDamage}`, true);
}

// ── Anchor Combo ──
function shouldUseAnchorCombo(bot, target, config) {
  if (!config.anchorCombo) return false;
  if (bot.dimension.id === "minecraft:nether") return false;
  return distance(bot.location, target.location) <= PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE;
}

export function handleAnchorCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
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
      beforePlace: async () => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (pending.placementMode === "place-anchor" && !patchCanPlaceCombatBlock(bot, pending.base)) return false;
        if (pending.placementMode !== "place-anchor" && !patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        if (pending.shieldBlock && !patchCanPlaceCombatBlock(bot, pending.shieldBlock)) return false;
        if (pending.shieldBlock && equipMainhandItem(bot, OBSIDIAN_ID, config) && consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) {
          const { setBlockIdWithFallback } = await import("./explosion.js");
          if (!(await setBlockIdWithFallback(bot.dimension, pending.shieldBlock, OBSIDIAN_ID, "keep"))) return false;
        }
        if (!equipMainhandItem(bot, RESPAWN_ANCHOR_ID, config) || !consumeManagedItem(bot, config, RESPAWN_ANCHOR_ID, 1)) return false;
        return true;
      },
      onPlaced: async () => {},
      beforeCharge: async () => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (!patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        if (!equipMainhandItem(bot, GLOWSTONE_ID, config) || !consumeManagedItem(bot, config, GLOWSTONE_ID, 1)) return false;
        return true;
      },
      onCharged: async () => {},
      beforeExplode: async () => {
        resolvedTarget = resolveAnchorTarget(pending);
        if (runtime.pendingAnchor !== pending || !resolvedTarget) return false;
        if (!patchCanInteractWithCombatBlock(bot, pending.base)) return false;
        faceBotToward(bot, { x: pending.base.x + 0.5, y: pending.base.y + 0.5, z: pending.base.z + 0.5 });
        return true;
      },
    });
    if (runtime.pendingAnchor === pending) runtime.pendingAnchor = undefined;
    if (result?.cancelled) return;
    selectBestSword(bot);
    if (patchIsCombatTargetUsable(resolvedTarget, bot.dimension)) setBotLookAt(bot, addVector(resolvedTarget.location, { x: 0, y: 1.1, z: 0 }));
  })();
  return true;
}


// ── Crystal Combo ──
export function handleCrystalCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) return false;
  if (!config.crystalCombo) return false;
  if (globalTick - runtime.lastCrystalTick < config.crystalCooldown || runtime.pendingCrystal) return false;
  const best = selectedCandidate ?? scanCrystalCandidates(bot, target, config)[0];
  if (!best) return false;
  runtime.lastCrystalTick = globalTick;
  // Store both id and direct entity reference for robust resolution
  runtime.pendingCrystal = { base: best.location, restoreBlockId: AIR_ID, placementMode: best.placementMode, targetId: target.id, targetEntity: target, shieldBlock: best.shieldBlock };
  faceBotToward(bot, { x: best.location.x + 0.5, y: best.location.y + 0.5, z: best.location.z + 0.5 });
  const baseBlock = getBlock(bot.dimension, best.location);
  if (best.placementMode === "place-obsidian" && !patchCanPlaceCombatBlock(bot, best.location)) { runtime.pendingCrystal = undefined; return false; }
  if (best.placementMode !== "place-obsidian" && !patchCanInteractWithCombatBlock(bot, best.location)) { runtime.pendingCrystal = undefined; return false; }
  if (best.placementMode === "existing-base" && !isCrystalBaseBlock(baseBlock)) { runtime.pendingCrystal = undefined; return false; }
  
  let shielded = false;
  if (best.shieldBlock && !patchCanPlaceCombatBlock(bot, best.shieldBlock)) {
    runtime.pendingCrystal = undefined; return false;
  }
  if (best.shieldBlock && equipMainhandItem(bot, OBSIDIAN_ID, config) && consumeManagedItem(bot, config, OBSIDIAN_ID, 1)) {
    shielded = true;
  }

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
    if (shielded || best.placementMode === "place-obsidian") {
      const { setBlockIdWithFallback } = await import("./explosion.js");
      if (shielded) {
        if (!patchCanPlaceCombatBlock(bot, best.shieldBlock)) { debugLog(bot, config, "combat", "§c[Crystal] シールドブロック設置不可、中断", true); runtime.pendingCrystal = undefined; return; }
        if (!(await setBlockIdWithFallback(bot.dimension, best.shieldBlock, OBSIDIAN_ID, "keep"))) { debugLog(bot, config, "combat", "§c[Crystal] シールドブロック設置失敗、中断", true); runtime.pendingCrystal = undefined; return; }
      }
      if (best.placementMode === "place-obsidian") {
        if (!patchCanPlaceCombatBlock(bot, best.location)) { debugLog(bot, config, "combat", "§c[Crystal] 黒曜石設置不可、中断", true); runtime.pendingCrystal = undefined; return; }
        if (!(await setBlockIdWithFallback(bot.dimension, best.location, OBSIDIAN_ID, "keep"))) { debugLog(bot, config, "combat", "§c[Crystal] 黒曜石設置失敗、中断", true); runtime.pendingCrystal = undefined; return; }
      }
    }
    debugLog(bot, config, "combat", `§e[Crystal] ブロック設置完了、1tick後にクリスタル召喚予約 mode=${best.placementMode}`, true);
    system.runTimeout(() => {
      const pending = runtime.pendingCrystal;
      runtime.pendingCrystal = undefined;
      if (!pending) { debugLog(bot, config, "combat", "§c[Crystal] pendingCrystal消失、中断", true); return; }
      void (async () => {
        const liveTarget = resolveTarget(pending);
        if (!liveTarget) { debugLog(bot, config, "combat", `§c[Crystal] ターゲット解決失敗 id=${pending.targetId} entityValid=${!!pending.targetEntity}`, true); return; }
        debugLog(bot, config, "combat", `§e[Crystal] ターゲット解決成功 type=${liveTarget.typeId}`, true);
        const crystalLocation = getExplosionLocation(pending.base, "crystal");
        const existingCrystalIds = new Set();
        for (const entity of patchGetNearbyCrystalEntities(bot.dimension, crystalLocation)) existingCrystalIds.add(entity.id);
        const equipOk = equipMainhandItem(bot, END_CRYSTAL_ID, config);
        if (!equipOk) { debugLog(bot, config, "combat", "§c[Crystal] クリスタル装備失敗、中断", true); return; }
        const consumeOk = consumeManagedItem(bot, config, END_CRYSTAL_ID, 1);
        if (!consumeOk) { debugLog(bot, config, "combat", "§c[Crystal] クリスタル消費失敗、中断", true); return; }
        debugLog(bot, config, "combat", `§e[Crystal] クリスタル装備＆消費成功、スポーン中...`, true);
        let summonResult;
        try { summonResult = await spawnEntityWithFallback(bot.dimension, END_CRYSTAL_ENTITY_ID, crystalLocation); } catch (err) { debugLog(bot, config, "combat", `§c[Crystal] スポーン例外: ${err}`, true); return; }
        debugLog(bot, config, "combat", `§e[Crystal] スポーン結果: successCount=${summonResult?.successCount}`, true);
        let crystal;
        try {
          const candidates = patchGetNearbyCrystalEntities(bot.dimension, crystalLocation);
          crystal = candidates.find(e => !existingCrystalIds.has(e.id)) ?? candidates.sort((a, b) => distanceSquared(a.location, crystalLocation) - distanceSquared(b.location, crystalLocation))[0];
        } catch {}
        if (!crystal && Number(summonResult?.successCount ?? 0) <= 0) { debugLog(bot, config, "combat", "§c[Crystal] クリスタルエンティティ不在＆スポーン失敗、中断", true); return; }
        debugLog(bot, config, "combat", `§a[Crystal] クリスタル設置完了、起爆待ち`, true);
        const detonateDelay = Math.max(1, Math.floor(Number(config.crystalDetonateDelay ?? 0)));
        system.runTimeout(() => {
          void (async () => {
            let resolvedCrystal = crystal;
            if (!resolvedCrystal) {
              try { resolvedCrystal = patchGetNearbyCrystalEntities(bot.dimension, crystalLocation).sort((a, b) => distanceSquared(a.location, crystalLocation) - distanceSquared(b.location, crystalLocation))[0]; } catch {}
            }
            const liveTarget2 = resolveTarget(pending);
            if (!liveTarget2) { try { resolvedCrystal?.remove(); } catch {} selectBestSword(bot); debugLog(bot, config, "combat", "§c[Crystal] 起爆時ターゲット不在、中断", true); return; }
            const result = await runCrystalExplosionWithFallback(bot.dimension, pending.base, bot, resolvedCrystal);
            try { resolvedCrystal?.remove(); } catch {}
            selectBestSword(bot);
            setBotLookAt(bot, addVector(liveTarget2.location, { x: 0, y: 1.1, z: 0 }));
            debugLog(bot, config, "combat", `§a[Crystal] 起爆完了`, true);
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

function findInboundProjectile(bot) {
  let best, bestScore = -Infinity;
  try {
    const entities = bot.dimension.getEntities({ location: bot.location, maxDistance: 9 });
    for (const entity of entities) {
      try {
        if (!INBOUND_PROJECTILE_IDS.includes(entity.typeId)) continue;
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

async function placeEmergencyProtectBlock(bot, threatLocation, config, reason) {
  const dist = distance(bot.location, threatLocation);
  if (dist < 2.2) return false;
  if (!isBotOnGround(bot)) return false;
  const dir = normalize2D(vectorTo(bot.location, threatLocation));
  const candidate = (dy) => ({
    x: Math.floor(bot.location.x + dir.x * 1.5),
    y: Math.floor(bot.location.y + dy),
    z: Math.floor(bot.location.z + dir.z * 1.5),
  });
  const options = [candidate(1), candidate(0)];
  let shieldLoc;
  for (const loc of options) {
    try {
      if (isAirBlock(getBlock(bot.dimension, loc)) && hasHumanPlaceSupport(bot.dimension, loc)) {
        shieldLoc = loc;
        break;
      }
    } catch {}
  }
  if (!shieldLoc) return false;
  if (!equipMainhandItem(bot, OBSIDIAN_ID, config)) return false;
  faceBotToward(bot, threatLocation);
  let ok = false;
  try {
    const { setBlockIdWithFallback } = await import("./explosion.js");
    ok = Boolean(await setBlockIdWithFallback(bot.dimension, shieldLoc, OBSIDIAN_ID, "keep"));
  } catch { ok = false; }
  selectBestSword(bot);
  if (!ok) return false;
  debugLog(bot, config, "def", `\u00a7b[Defense] human place(${reason}) eye?y=${shieldLoc.y - Math.floor(bot.location.y)} dist=${dist.toFixed(1)}`, true);
  return true;
}

export async function handleSimThreatDefense(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) return;
  const projectile = findInboundProjectile(bot);
  if (projectile && globalTick - Number(runtime.lastProjectProtectTick ?? -9999) >= 12) {
    runtime.lastProjectProtectTick = globalTick;
    await placeEmergencyProtectBlock(bot, projectile.location, config, "projectile");
    const fleeDir = normalize2D(vectorTo(projectile.location, bot.location));
    try { bot.applyImpulse({ x: fleeDir.x * 0.3, y: 0.04, z: fleeDir.z * 0.3 }); } catch {}
  }
  if (globalTick - Number(runtime.lastThreatScanTick ?? -9999) >= 10) {
    runtime.lastThreatScanTick = globalTick;
    let hostile;
    try {
      const found = [];
      for (const entity of bot.dimension.getEntities({ location: bot.location, maxDistance: 6.5 })) {
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
    if (hostile && hostile.d < 6.0 && globalTick - Number(runtime.lastThreatBlockTick ?? -9999) >= 16) {
      runtime.lastThreatBlockTick = globalTick;
      if (await placeEmergencyProtectBlock(bot, hostile.location, config, "crystal")) {
        const fleeDir = normalize2D(vectorTo(hostile.location, bot.location));
        try { bot.applyImpulse({ x: fleeDir.x * 0.28, y: 0.05, z: fleeDir.z * 0.28 }); } catch {}
      }
    }
  }
}

export function handleSimRangedAttack(bot, target, config) {
  if (!config.rangedCombo) return false;
  if (isSpawnProtected(config.uid)) return false;
  const runtime = getRuntime(config.uid);
  if (runtime.pendingCrystal || runtime.pendingAnchor) return false;
  if (runtime.pendingRangedDraw) return false;
  if (globalTick - Number(runtime.lastRangedTick ?? -9999) < Math.max(15, Number(config.rangedCooldown ?? 30))) return false;
  const d = distance(bot.location, target.location);
  if (d < 8 || d > PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE * 3) return false;
  if (!patchHasCombatLineOfSight(bot, target)) return false;
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
      try {
        bot.useItem?.(new ItemStack(weaponId, 1));
        method = "useItem";
      } catch { method = ""; }
      if (!method) {
        try {
          const eye = addVector(bot.location, { x: 0, y: 1.55, z: 0 });
          const drop = curD * curD * 0.0045;
          const aimPoint = addVector(aimFresh, { x: 0, y: drop, z: 0 });
          const dir = normalizeVector3(vectorTo(eye, aimPoint));
          const arrow = bot.dimension.spawnEntity("minecraft:arrow", eye);
          let shot = false;
          try { arrow.shoot?.({ direction: dir, speed: 3 }); shot = true; } catch {}
          if (!shot) {
            try { arrow.applyImpulse({ x: dir.x * 3, y: dir.y * 3, z: dir.z * 3 }); shot = true; } catch {}
          }
          if (shot) {
            method = "chargedShot";
          } else {
            try { arrow.remove(); } catch {}
          }
        } catch {}
      }
      if (method) {
        debugLog(bot, config, "ranged", `\u00a7d[Ranged] ${method} fired dist=${curD.toFixed(1)}`, true);
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
