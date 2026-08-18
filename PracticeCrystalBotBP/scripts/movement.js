import {
  system, EntityComponentTypes, EquipmentSlot, ItemStack,
  BOT_TYPE, ENDER_PEARL_ID, OBSIDIAN_ID, TOTEM_ID,
  PEARL_VISUAL_DELAY, STRAFE_FLIP_INTERVAL, SWORD_RANGE,
  PATCH_JUMP_DASH_COOLDOWN_TICKS, PATCH_JUMP_DASH_AIRBORNE_TICKS,
  PATCH_JUMP_DASH_VERTICAL_IMPULSE, PATCH_JUMP_DASH_FORWARD_BONUS,
  PATCH_JUMP_DASH_MIN_DIRECTION, PATCH_STUCK_ESCAPE_TICKS,
  PATCH_ESCAPE_TELEPORT_COOLDOWN, PATCH_ENCHANTED_GOLDEN_APPLE_ID,
  PATCH_GOLDEN_APPLE_ID, PATCH_FOOD_REUSE_BUFFER_TICKS,
  PATCH_FOOD_USE_COOLDOWN_TICKS, AIR_ID, PATCH_EXPLOSION_PRESERVE_IDS,
} from "./constants.js";
import { globalTick, globalSettings } from "./state.js";
import {
  distance, distanceSquared, vectorTo, addVector, normalize2D,
  floorLocation, getBlock, isAirBlock, isSolidBlock,
  isSafeStandingLocation, canOccupyLocation, findNearestStandingLocation,
  patchSnapToBlockCenter, isEntityUsable, getEquippableComponent,
  getBotUid, patchGetCurrentHealthValue, patchGetMaxHealthValue,
  faceBotToward, setBotLookAt, tryPlayAnimation,
  debugLog, appendPersistentDebugLog, quoteCoord,
  patchRunDimensionCommandNoThrow, patchShouldDelayAction, patchRandomChance,
  countItemInContainer, findNearestTarget, getPlayerByName,
  findClosestPlayer, patchApplyAimJitter, getExplosionLocation,
  isLocationInsideBotBoundary, formatError,
} from "./utils.js";
import { getRuntime, normalizeGlobalSettings } from "./config.js";
import {
  selectBestSword, equipMainhandItem, consumeManagedItem,
  syncBotLoadout, selectBestPickaxe,
} from "./inventory.js";

// ── Golden Apple Effects ──
const PATCH_RECOVERY_LOW_HEALTH_RATIO = 0.5;
const PATCH_RECOVERY_CRITICAL_HEALTH = 6;
const PATCH_RECOVERY_HOLD_HEALTH_RATIO = 0.68;
const PATCH_RECOVERY_HOLD_TICKS = 120;
const PATCH_RECOVERY_REFRESH_CRITICAL_TICKS = 40;
const PATCH_RETREAT_PEARL_TRIGGER_DISTANCE = 9;
const PATCH_RETREAT_SEARCH_RETRY_TICKS = 20;
const PATCH_RECOVERY_LOG_MIN_DELTA = 0.5;

function patchGetHealthRatio(bot) {
  const maxHealth = patchGetMaxHealthValue(bot);
  if (maxHealth <= 0.01) return 1;
  return patchGetCurrentHealthValue(bot) / maxHealth;
}

function patchMarkRecovery(runtime) {
  runtime.recoveryUntilTick = Math.max(Number(runtime.recoveryUntilTick ?? -9999), globalTick + PATCH_RECOVERY_HOLD_TICKS);
}

function patchForceRecoveryFood(runtime) {
  runtime.forceRecoveryFoodUntilTick = Math.max(Number(runtime.forceRecoveryFoodUntilTick ?? -9999), globalTick + 20);
}

function patchIsRecoveryWindowActive(runtime) {
  return globalTick <= Number(runtime.recoveryUntilTick ?? -9999) ||
    globalTick - Number(runtime.lastHealTick ?? -9999) < PATCH_RECOVERY_HOLD_TICKS ||
    globalTick - Number(runtime.lastRetreatPearlTick ?? -9999) < PATCH_RECOVERY_HOLD_TICKS;
}

function patchIsRecoveryActive(bot, runtime, config) {
  if (config?.recoveryEnabled === false) return false;
  const healthRatio = patchGetHealthRatio(bot);
  return healthRatio <= PATCH_RECOVERY_LOW_HEALTH_RATIO ||
    patchIsRecoveryWindowActive(runtime) ||
    (healthRatio <= PATCH_RECOVERY_HOLD_HEALTH_RATIO && patchIsRecoveryWindowActive(runtime));
}

function patchGetEffectDurationTicksLocal(entity, effectId) {
  try { const effect = entity.getEffect(effectId); return Number(effect?.duration ?? effect?.durationTicks ?? 0); } catch { return 0; }
}

function patchShouldConsumeGoldenApple(bot, itemId) {
  const runtime = getRuntime(getBotUid(bot) || "");
  const absorptionRemaining = Math.max(patchGetEffectDurationTicksLocal(bot, "absorption"), Number(runtime.foodAbsorptionUntilTick ?? -9999) - globalTick);
  const regenRemaining = Math.max(patchGetEffectDurationTicksLocal(bot, "regeneration"), Number(runtime.foodRegenUntilTick ?? -9999) - globalTick);
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  const healthRatio = maxHealth <= 0.01 ? 1 : currentHealth / maxHealth;
  const isCritical = currentHealth <= PATCH_RECOVERY_CRITICAL_HEALTH;
  const isHealthLow = healthRatio <= PATCH_RECOVERY_LOW_HEALTH_RATIO;
  const ticksSinceFood = globalTick - Number(runtime.lastFoodTick ?? -9999);
  const forceFood = globalTick <= Number(runtime.forceRecoveryFoodUntilTick ?? -9999);
  if (itemId === PATCH_ENCHANTED_GOLDEN_APPLE_ID) {
    return isCritical && ticksSinceFood >= PATCH_RECOVERY_REFRESH_CRITICAL_TICKS;
  }
  if (forceFood && healthRatio <= PATCH_RECOVERY_HOLD_HEALTH_RATIO)
    return ticksSinceFood >= PATCH_RECOVERY_REFRESH_CRITICAL_TICKS;
  if (regenRemaining > 80 && !isCritical) return false;
  return isHealthLow || absorptionRemaining <= PATCH_FOOD_REUSE_BUFFER_TICKS;
}

function patchSelectRecoveryFood(bot, inventory) {
  const candidates = [PATCH_ENCHANTED_GOLDEN_APPLE_ID, PATCH_GOLDEN_APPLE_ID];
  for (const itemId of candidates) {
    if (countItemInContainer(inventory, itemId) <= 0) continue;
    if (patchShouldConsumeGoldenApple(bot, itemId)) return itemId;
  }
  return undefined;
}

function patchApplyGoldenAppleEffects(bot, itemId) {
  const runtime = getRuntime(getBotUid(bot) || "");
  if (itemId === PATCH_ENCHANTED_GOLDEN_APPLE_ID) {
    try { bot.addEffect("regeneration", 600, { amplifier: 2, showParticles: false }); } catch {}
    try { bot.addEffect("absorption", 2400, { amplifier: 3, showParticles: false }); } catch {}
    try { bot.addEffect("resistance", 6000, { amplifier: 0, showParticles: false }); } catch {}
    try { bot.addEffect("fire_resistance", 6000, { amplifier: 0, showParticles: false }); } catch {}
    runtime.foodAbsorptionUntilTick = globalTick + 2400;
    runtime.foodRegenUntilTick = globalTick + 600;
    runtime.foodResistanceUntilTick = globalTick + 6000;
    runtime.foodFireResistanceUntilTick = globalTick + 6000;
    return;
  }
  try { bot.addEffect("regeneration", 100, { amplifier: 1, showParticles: false }); } catch {}
  try { bot.addEffect("absorption", 2400, { amplifier: 0, showParticles: false }); } catch {}
  runtime.foodAbsorptionUntilTick = globalTick + 2400;
  runtime.foodRegenUntilTick = globalTick + 100;
}

function patchRotate2D(vector, degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalize2D({ x: vector.x * cos - vector.z * sin, y: 0, z: vector.x * sin + vector.z * cos });
}

function patchGetRetreatSearchDirections(awayDir) {
  const directions = [];
  const seen = new Set();
  const addDirection = (direction) => {
    const normalized = normalize2D(direction);
    if (Math.abs(normalized.x) < 0.0001 && Math.abs(normalized.z) < 0.0001) return;
    const key = `${Math.round(normalized.x * 100)}:${Math.round(normalized.z * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    directions.push(normalized);
  };

  for (const angle of [0, -45, 45, -90, 90, -135, 135, 180]) {
    addDirection(patchRotate2D(awayDir, angle));
  }
  return directions;
}

function patchFindRetreatPearlLandingSpot(bot, target) {
  const toTarget = vectorTo(bot.location, target.location);
  let planar = normalize2D(toTarget);
  if (Math.abs(planar.x) < 0.0001 && Math.abs(planar.z) < 0.0001) planar = { x: 1, y: 0, z: 0 };
  const awayDir = { x: -planar.x, y: 0, z: -planar.z };
  const startTargetDistance = distance(bot.location, target.location);
  const searchDistances = [12, 14, 9, 17, 6, 20, 0];
  const lateralOffsets = [0, -2, 2, -4, 4, -6, 6];
  const yOffsets = [0, 2, 4, 6, 8, 10, 12, 1, 3, 5, 7, -1, -2, -3, -4, -6, -8, -10, -12];
  const idealTargetDistance = 12;
  let best, bestScore = Number.NEGATIVE_INFINITY;

  for (const direction of patchGetRetreatSearchDirections(awayDir)) {
    const directionAlignment = direction.x * awayDir.x + direction.z * awayDir.z;
    const side = { x: -direction.z, y: 0, z: direction.x };
    for (const searchDistance of searchDistances) {
      const base = addVector(bot.location, { x: direction.x * searchDistance, y: 0, z: direction.z * searchDistance });
      for (const lateralOffset of lateralOffsets) {
        const origin = floorLocation(addVector(base, { x: side.x * lateralOffset, y: 0, z: side.z * lateralOffset }));
        for (const y of yOffsets) {
          const location = { x: origin.x + 0.5, y: origin.y + y, z: origin.z + 0.5 };
          if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(location)) continue;
          if (!isSafeStandingLocation(bot.dimension, location)) continue;
          const targetDistance = distance(location, target.location);
          if (targetDistance < 6) continue;
          const fromBot = normalize2D(vectorTo(bot.location, location));
          const awayScore = fromBot.x * awayDir.x + fromBot.z * awayDir.z;
          if (targetDistance < startTargetDistance + 0.75 && awayScore < 0.1) continue;
          const heightPenalty = Math.abs(location.y - bot.location.y) * 0.18;
          const lateralPenalty = Math.abs(lateralOffset) * 0.08;
          const travelPenalty = Math.max(0, distance(bot.location, location) - 16) * 0.12;
          const distanceScore = Math.min(targetDistance, idealTargetDistance) * 2.4 + Math.max(0, targetDistance - idealTargetDistance) * 0.45;
          const score = distanceScore + awayScore * 5 + directionAlignment * 1.5 - heightPenalty - lateralPenalty - travelPenalty;
          if (score > bestScore) {
            best = location;
            bestScore = score;
          }
        }
      }
    }
  }
  return best;
}

function patchTryRetreatPearl(bot, target, config, inventory, currentHealth, maxHealth) {
  if (config.pearlRecover === false) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - runtime.lastPearlTick < config.pearlCooldown) return false;
  if (!target || !inventory || config?.recoveryEnabled === false) return false;
  const healthRatio = maxHealth <= 0.01 ? 1 : currentHealth / maxHealth;
  const targetDistance = distance(bot.location, target.location);
  const recoveryWindowActive = patchIsRecoveryWindowActive(runtime);
  const shouldRetreat = healthRatio <= PATCH_RECOVERY_LOW_HEALTH_RATIO ||
    (recoveryWindowActive && healthRatio <= PATCH_RECOVERY_HOLD_HEALTH_RATIO && targetDistance <= PATCH_RETREAT_PEARL_TRIGGER_DISTANCE);
  if (!shouldRetreat) return false;
  if (targetDistance > 14) { patchForceRecoveryFood(runtime); return false; }
  if (countItemInContainer(inventory, ENDER_PEARL_ID) <= 0) { patchForceRecoveryFood(runtime); return false; }

  const retreatCooldown = Math.max(10, Number(config.pearlCooldown ?? 40));
  if (globalTick - Number(runtime.lastRetreatPearlTick ?? -9999) < retreatCooldown) { patchForceRecoveryFood(runtime); return false; }
  if (globalTick - Number(runtime.lastRetreatPearlSearchTick ?? -9999) < PATCH_RETREAT_SEARCH_RETRY_TICKS) { patchForceRecoveryFood(runtime); return false; }
  runtime.lastRetreatPearlSearchTick = globalTick;

  const landingSpot = patchFindRetreatPearlLandingSpot(bot, target);
  if (!landingSpot) {
    if (config?.eatWhenCornered) {
      patchForceRecoveryFood(runtime);
      runtime.isCorneredTick = globalTick;
    } else {
      patchForceRecoveryFood(runtime);
    }
    debugLog(bot, config, "combat", `§e[回復] 逃走先が見つかりませんでした`, true);
    return false;
  }

  const token = `${config.uid}:retreat:${globalTick}`;
  runtime.pendingPearlToken = token;
  if (!equipMainhandItem(bot, ENDER_PEARL_ID, config) || !consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)) {
    runtime.pendingPearlToken = "";
    return false;
  }

  runtime.lastRetreatPearlTick = globalTick;
  runtime.lastPearlTick = globalTick;
  patchMarkRecovery(runtime);
  faceBotToward(bot, landingSpot);
  try { bot.dimension.spawnEntity(ENDER_PEARL_ID, addVector(bot.location, { x: 0, y: 1.45, z: 0 })); } catch {}
  debugLog(bot, config, "combat", `§e[回復] 逃走パール発射 HP=${currentHealth.toFixed(1)}/${maxHealth.toFixed(1)}`, true);
  system.runTimeout(() => {
    if (runtime.pendingPearlToken !== token) return;
    runtime.pendingPearlToken = "";
    try { bot.teleport(landingSpot, { dimension: bot.dimension, facingLocation: target.location }); } catch {}
    const held = getEquippableComponent(bot)?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId === ENDER_PEARL_ID) selectBestSword(bot);
  }, PEARL_VISUAL_DELAY);
  return true;
}

function patchLogRecoveryProgress(bot, config, runtime, currentHealth, maxHealth) {
  if (!config?.debug?.health) {
    runtime.lastRecoveryLogHealth = currentHealth;
    return;
  }
  const foodRegenActive = globalTick <= Number(runtime.foodRegenUntilTick ?? -9999);
  const recentlyAte = globalTick - Number(runtime.lastHealTick ?? -9999) <= PATCH_RECOVERY_HOLD_TICKS;
  if (!foodRegenActive && !recentlyAte) {
    runtime.lastRecoveryLogHealth = currentHealth;
    return;
  }

  const previousHealth = Number(runtime.lastRecoveryLogHealth ?? currentHealth);
  const delta = currentHealth - previousHealth;
  if (delta >= PATCH_RECOVERY_LOG_MIN_DELTA) {
    debugLog(bot, config, "health", `§a[回復] HP ${previousHealth.toFixed(1)} -> ${currentHealth.toFixed(1)}/${maxHealth.toFixed(1)} (+${delta.toFixed(1)})`, true);
    runtime.lastRecoveryLogHealth = currentHealth;
  } else if (currentHealth < previousHealth - 0.1) {
    runtime.lastRecoveryLogHealth = currentHealth;
  }
}

export function handleGoldenAppleBuff(bot, config, target) {
  if (config?.recoveryEnabled === false) return;
  const runtime = getRuntime(config.uid);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const preferredFood = patchSelectRecoveryFood(bot, inventory);
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  patchLogRecoveryProgress(bot, config, runtime, currentHealth, maxHealth);

  if (preferredFood &&
      globalTick - Number(runtime.lastFoodTick ?? -9999) >= PATCH_FOOD_USE_COOLDOWN_TICKS &&
      patchShouldConsumeGoldenApple(bot, preferredFood) &&
      equipMainhandItem(bot, preferredFood, config) &&
      consumeManagedItem(bot, config, preferredFood, 1)) {
    runtime.lastFoodTick = globalTick;
    runtime.lastHealTick = globalTick;
    runtime.lastRecoveryLogHealth = currentHealth;
    runtime.forceRecoveryFoodUntilTick = -9999;
    patchMarkRecovery(runtime);
    patchApplyGoldenAppleEffects(bot, preferredFood);
    patchRunDimensionCommandNoThrow(bot.dimension, `playsound random.eat @a[x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=16] ${quoteCoord(bot.location.x)} ${quoteCoord(bot.location.y)} ${quoteCoord(bot.location.z)} 1 1`);
    debugLog(bot, config, "combat", `§a[回復] ${preferredFood.replace("minecraft:", "")} を使用 HP=${currentHealth.toFixed(1)}/${maxHealth.toFixed(1)}`, true);
  }

  const activeTarget = target && isEntityUsable(target) ? target : findNearestTarget(bot);
  patchTryRetreatPearl(bot, activeTarget, config, inventory, currentHealth, maxHealth);
}

// ── Pearl Move ──
function findPearlLandingSpot(bot, target) {
  const settings = normalizeGlobalSettings(globalSettings);
  const toTarget = vectorTo(bot.location, target.location);
  const planar = normalize2D(toTarget);
  const targetAbove = target.location.y - bot.location.y >= 2.5;
  // ターゲットが高い場所にいる場合: ターゲットの高さ付近の足場を探してパールで登る
  if (targetAbove) {
    const t = target.location;
    for (let radius = 0; radius <= 2; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          for (let y = 2; y >= -3; y--) {
            const location = { x: Math.floor(t.x) + x + 0.5, y: t.y + y, z: Math.floor(t.z) + z + 0.5 };
            if (location.y <= bot.location.y + 0.5) continue;
            if (settings.boundaryEnabled && !isLocationInsideBotBoundary(location)) continue;
            if (isSafeStandingLocation(bot.dimension, location)) return location;
          }
        }
      }
    }
  }
  const landDist = Math.max(3, distance(bot.location, target.location) * 0.6);
  const origin = floorLocation(addVector(bot.location, { x: planar.x * landDist, y: 0, z: planar.z * landDist }));
  for (let radius = 0; radius <= 2; radius++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        for (let y = 3; y >= -3; y--) {
          const location = { x: origin.x + x + 0.5, y: origin.y + y, z: origin.z + z + 0.5 };
          if (settings.boundaryEnabled && !isLocationInsideBotBoundary(location)) continue;
          if (isSafeStandingLocation(bot.dimension, location)) return location;
        }
      }
    }
  }
  return undefined;
}

export function handlePearlMove(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (!config.pearlMove || globalTick - runtime.lastPearlTick < config.pearlCooldown) return;
  if (patchIsRecoveryActive(bot, runtime, config)) {
    // debugLog(bot, config, "movement", "§e[Pearl] 回復中のため接近パールをキャンセル");
    return;
  }
  const currentDistance = distance(bot.location, target.location);
  const targetAbove = target.location.y - bot.location.y >= 2.5;
  if (currentDistance <= config.pearlDistance && !targetAbove) return;
  if (patchShouldDelayAction(config, "pearl")) return;
  if (patchRandomChance(config.mistakeRate)) return;
  const landingSpot = findPearlLandingSpot(bot, target);
  if (!landingSpot) return;
  runtime.lastPearlTick = globalTick;
  const token = `${config.uid}:${globalTick}`;
  runtime.pendingPearlToken = token;
  if (!equipMainhandItem(bot, ENDER_PEARL_ID, config) || !consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)) { runtime.pendingPearlToken = ""; return; }
  faceBotToward(bot, landingSpot);
  try { bot.dimension.spawnEntity(ENDER_PEARL_ID, addVector(bot.location, { x: 0, y: 1.45, z: 0 })); } catch {}
  system.runTimeout(() => {
    if (runtime.pendingPearlToken !== token) return;
    try { bot.teleport(landingSpot, { dimension: bot.dimension, facingLocation: target.location }); } catch {}
    const held = getEquippableComponent(bot)?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId === ENDER_PEARL_ID) selectBestSword(bot);
  }, PEARL_VISUAL_DELAY);
}

// ── Movement Helpers ──
function patchIsEntityOnGroundSafe(entity) {
  try { if (typeof entity?.isOnGround === "boolean") return entity.isOnGround; } catch {}
  const grounded = findNearestStandingLocation(entity.dimension, entity.location, [0, -1]);
  return !!grounded && Math.abs(grounded.y - entity.location.y) <= 0.45;
}

function patchUpdateStuckState(bot, runtime) {
  const previous = runtime.lastMovementLocation;
  runtime.lastMovementLocation = { ...bot.location };
  if (!previous) { runtime.stuckTicks = 0; return false; }
  const moved = Math.hypot(bot.location.x - previous.x, bot.location.z - previous.z);
  runtime.stuckTicks = moved < 0.12 ? Number(runtime.stuckTicks ?? 0) + 1 : 0;
  return runtime.stuckTicks >= 4;
}

export function patchFindMovementStep(dimension, origin, moveDirection, aggressive = false) {
  const distances = aggressive ? [0.45, 0.7, 0.95, 1.2] : [0.28, 0.45, 0.65];
  const yOffsets = aggressive ? [0, -1, -2, 1, 2] : [0, -1, 1, -2];
  for (const step of distances) {
    const base = addVector(origin, { x: moveDirection.x * step, y: 0, z: moveDirection.z * step });
    for (const yOffset of yOffsets) {
      const candidate = addVector(base, { x: 0, y: yOffset, z: 0 });
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
      if (isSafeStandingLocation(dimension, candidate)) return candidate;
    }
  }
  
  // Gap jumping for 1-block gaps
  if (aggressive) {
    const jumpDistances = [2.0, 2.5, 3.0];
    for (const step of jumpDistances) {
      const candidate = addVector(origin, { x: moveDirection.x * step, y: 0, z: moveDirection.z * step });
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
      if (isSafeStandingLocation(dimension, candidate)) {
        // Ensure there is clearance to jump
        if (isAirBlock(getBlock(dimension, addVector(origin, {x: 0, y: 1, z: 0}))) &&
            isAirBlock(getBlock(dimension, addVector(origin, {x: 0, y: 2, z: 0})))) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

function patchFindDescendStep(dimension, origin, targetLocation, moveDirection) {
  if (!targetLocation || targetLocation.y >= origin.y - 0.1) return undefined;
  const distances = [0, 0.35, 0.7, 1.05, 1.35];
  const yOffsets = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
  let best, bestScore = Number.POSITIVE_INFINITY;
  for (const step of distances) {
    const base = addVector(origin, { x: moveDirection.x * step, y: 0, z: moveDirection.z * step });
    for (const yOffset of yOffsets) {
      const candidate = addVector(base, { x: 0, y: yOffset, z: 0 });
      if (candidate.y >= origin.y - 0.2 || !isSafeStandingLocation(dimension, candidate)) continue;
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
      const score = Math.abs(candidate.y - targetLocation.y) + Math.hypot(candidate.x - targetLocation.x, candidate.z - targetLocation.z) * 0.25;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
  }
  return best;
}

function patchTryBuildStep(bot, config, moveDirection) {
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastBuildStepTick ?? -9999) < 4) return undefined;
  const origin = floorLocation(bot.location);
  const front = { x: origin.x + Math.round(moveDirection.x), y: origin.y, z: origin.z + Math.round(moveDirection.z) };
  if (front.x === origin.x && front.z === origin.z) return undefined;
  const climbTargets = [addVector(front, { x: 0, y: 1, z: 0 }), addVector(front, { x: 0, y: 2, z: 0 })];
  for (const target of climbTargets) {
    if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(target)) continue;
    if (isSafeStandingLocation(bot.dimension, target)) { runtime.lastBuildStepTick = globalTick; return target; }
  }
  return undefined;
}

// ── Mining ──

// Check if the bot is embedded (head or feet inside a solid block)
function patchIsBotEmbedded(bot) {
  const feetLoc = floorLocation(bot.location);
  const headLoc = floorLocation(addVector(bot.location, { x: 0, y: 1, z: 0 }));
  const feetBlock = getBlock(bot.dimension, feetLoc);
  const headBlock = getBlock(bot.dimension, headLoc);
  return (feetBlock && !isAirBlock(feetBlock)) || (headBlock && !isAirBlock(headBlock));
}

function patchFindMineTarget(bot, direction, targetLoc) {
  // 進行方向に進んだ場合のBotの当たり判定（幅0.6、高さ1.8）を計算して、ぶつかるブロックを特定する
  const checkDistances = [0.4, 0.8, 1.2];
  
  for (const dist of checkDistances) {
    const shiftX = direction.x * dist;
    const shiftZ = direction.z * dist;
    
    // 足元(y=0)、頭(y=1)の2段をデフォルトでチェック
    const yLevels = [1, 0];
    // ターゲットが上や下にいる場合は、上下のブロックもチェック対象に追加
    if (targetLoc) {
      if (targetLoc.y >= bot.location.y + 1.5) yLevels.push(2);
      if (targetLoc.y < bot.location.y - 1.0) yLevels.push(-1);
    }
    
    // Botの幅（約0.6）をカバーするための中心と端のオフセット
    const offsets = [
      { x: 0, z: 0 },
      { x: 0.3, z: 0 },
      { x: -0.3, z: 0 },
      { x: 0, z: 0.3 },
      { x: 0, z: -0.3 },
    ];
    
    for (const yOff of yLevels) {
      for (const offset of offsets) {
        const checkLoc = {
          x: bot.location.x + shiftX + offset.x,
          y: bot.location.y + yOff,
          z: bot.location.z + shiftZ + offset.z
        };
        const blockLoc = floorLocation(checkLoc);
        const block = getBlock(bot.dimension, blockLoc);
        if (block && !isAirBlock(block) && !PATCH_EXPLOSION_PRESERVE_IDS.has(block.typeId)) {
          return blockLoc;
        }
      }
    }
  }
  return undefined;
}

function patchTryMineBlock(bot, config, moveDirection, primaryDirection, target) {
  if (!config.enableMining) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick < Number(runtime.miningUntilTick ?? 0)) return true; // Already mining

  // First: check if bot is embedded in a block — mine feet/head directly
  const feetLoc = floorLocation(bot.location);
  const headLoc = floorLocation(addVector(bot.location, { x: 0, y: 1, z: 0 }));
  let targetBlockLocation = undefined;

  const headBlock = getBlock(bot.dimension, headLoc);
  if (headBlock && !isAirBlock(headBlock) && !PATCH_EXPLOSION_PRESERVE_IDS.has(headBlock.typeId)) {
    targetBlockLocation = headLoc;
  }
  if (!targetBlockLocation) {
    const feetBlock = getBlock(bot.dimension, feetLoc);
    if (feetBlock && !isAirBlock(feetBlock) && !PATCH_EXPLOSION_PRESERVE_IDS.has(feetBlock.typeId)) {
      targetBlockLocation = feetLoc;
    }
  }

  // If not embedded, use bounding box collision detection in the intended movement direction
  if (!targetBlockLocation) {
    const mdLen = Math.hypot(moveDirection.x, moveDirection.z);
    const useDir = mdLen > 0.1 ? moveDirection : primaryDirection;
    targetBlockLocation = patchFindMineTarget(bot, useDir, target?.location);
  }

  if (!targetBlockLocation) return false;

  const pickaxeStats = selectBestPickaxe(bot);
  if (!pickaxeStats) {
    // No pickaxe — try setblock directly with a shorter delay
    runtime.miningUntilTick = globalTick + 5;
    faceBotToward(bot, { x: targetBlockLocation.x + 0.5, y: targetBlockLocation.y + 0.5, z: targetBlockLocation.z + 0.5 });
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
    const loc = targetBlockLocation;
    system.runTimeout(() => {
      try {
        if (isEntityUsable(bot)) {
          patchRunDimensionCommandNoThrow(bot.dimension, `setblock ${quoteCoord(loc.x)} ${quoteCoord(loc.y)} ${quoteCoord(loc.z)} air destroy`);
        }
      } catch {}
    }, 5);
    return true;
  }

  const mineDelay = Math.max(3, Math.floor(20 / Math.max(1, pickaxeStats.speed)));
  runtime.miningUntilTick = globalTick + mineDelay;

  faceBotToward(bot, { x: targetBlockLocation.x + 0.5, y: targetBlockLocation.y + 0.5, z: targetBlockLocation.z + 0.5 });
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");

  const loc = targetBlockLocation;
  system.runTimeout(() => {
    try {
      if (isEntityUsable(bot)) {
        patchRunDimensionCommandNoThrow(bot.dimension, `setblock ${quoteCoord(loc.x)} ${quoteCoord(loc.y)} ${quoteCoord(loc.z)} air destroy`);
        selectBestSword(bot);
      }
    } catch {}
  }, mineDelay);

  return true;
}

// ── Jump Dash ──
function patchHasJumpDashClearance(dimension, location) {
  return isAirBlock(getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }))) &&
         isAirBlock(getBlock(dimension, addVector(location, { x: 0, y: 2, z: 0 })));
}

function patchShouldJumpDash(bot, target, config, moveDirection) {
  if (!config?.jumpDash) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - runtime.lastJumpDashTick < PATCH_JUMP_DASH_COOLDOWN_TICKS) return false;
  if (!patchIsEntityOnGroundSafe(bot) || !patchHasJumpDashClearance(bot.dimension, bot.location)) return false;
  if (distance(bot.location, target.location) <= config.maintainDistance - 0.1) return false;
  return Math.hypot(moveDirection.x, moveDirection.z) > PATCH_JUMP_DASH_MIN_DIRECTION;
}

function patchTryJumpDashTeleport(bot, target, config, moveDirection) {
  const runtime = getRuntime(config.uid);
  const toTarget = normalize2D(vectorTo(bot.location, target.location));
  const forwardDot = moveDirection.x * toTarget.x + moveDirection.z * toTarget.z;
  const dashScale = forwardDot < 0.25 ? 0.35 : forwardDot < 0.7 ? 0.6 : 1;
  const landing = patchFindMovementStep(bot.dimension, addVector(bot.location, { x: moveDirection.x * 0.45 * dashScale, y: 0.55, z: moveDirection.z * 0.45 * dashScale }), moveDirection, dashScale >= 0.6);
  if (!landing) return false;
  try {
    let snapped = patchSnapToBlockCenter(landing);
    if (!isSafeStandingLocation(bot.dimension, snapped) || !canOccupyLocation(bot.dimension, snapped)) return false;
    if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(snapped)) { const c = clampLocationToBotBoundary(snapped); if (isSafeStandingLocation(bot.dimension, c) && canOccupyLocation(bot.dimension, c)) snapped = c; else return false; }
    bot.teleport(snapped, { dimension: bot.dimension, facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }) });
    runtime.jumpDashAirborneUntilTick = globalTick + 1;
    return true;
  } catch {}
  return false;
}

// ── Boundary ──
function clampLocationToBotBoundary(location) {
  const settings = normalizeGlobalSettings(globalSettings);
  return {
    x: Math.max(settings.boundaryMinX + 1.5, Math.min(settings.boundaryMaxX - 0.5, location.x)),
    y: Math.max(settings.boundaryMinY, Math.min(settings.boundaryMaxY, location.y)),
    z: Math.max(settings.boundaryMinZ + 1.5, Math.min(settings.boundaryMaxZ - 0.5, location.z)),
  };
}

function findSafeBoundaryReturnLocation(bot) {
  const clamped = clampLocationToBotBoundary(bot.location);
  for (const yOffset of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const candidate = addVector(clamped, { x: 0, y: yOffset, z: 0 });
    if (isSafeStandingLocation(bot.dimension, candidate) && isLocationInsideBotBoundary(candidate)) return candidate;
  }
  return clamped;
}

export function enforceBotBoundary(bot, config) {
  if (!globalSettings.boundaryEnabled || isLocationInsideBotBoundary(bot.location)) return false;
  const destination = findSafeBoundaryReturnLocation(bot);
  try { bot.teleport(destination, { dimension: bot.dimension }); return true; } catch { return false; }
}

// ── Stuck Escape (穴・崩壊地形・埋没からの強制脱出) ──
function patchTryEscapeStuck(bot, config, target) {
  const settings = normalizeGlobalSettings(globalSettings);
  const origin = bot.location;
  // 近いリングから順に、高い位置を優先して安全な足場を探す(穴から這い上がる)
  for (let radius = 1; radius <= 5; radius++) {
    for (let dy = 3; dy >= -2; dy--) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const candidate = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
          if (settings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
          if (!isSafeStandingLocation(bot.dimension, candidate)) continue;
          try {
            bot.teleport(candidate, { dimension: bot.dimension, facingLocation: target?.location });
            return true;
          } catch { return false; }
        }
      }
    }
  }
  // 周囲に安全な場所がない → オーナー/最寄りプレイヤーの近くへ退避
  const owner = getPlayerByName(config.ownerName) ?? findClosestPlayer(bot.location, bot.dimension, 32);
  if (!owner) return false;
  const ownerOrigin = owner.location;
  for (let radius = 1; radius <= 3; radius++) {
    for (let dy = 2; dy >= -2; dy--) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const candidate = { x: ownerOrigin.x + dx, y: ownerOrigin.y + dy, z: ownerOrigin.z + dz };
          if (settings.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
          if (!isSafeStandingLocation(bot.dimension, candidate)) continue;
          try {
            bot.teleport(candidate, { dimension: bot.dimension, facingLocation: target?.location });
            return true;
          } catch { return false; }
        }
      }
    }
  }
  return false;
}

// ── Main Movement Handler ──
export function handleMovement(bot, target, config) {
  const runtime = getRuntime(config.uid);
  const isStuck = patchUpdateStuckState(bot, runtime);
  const grounded = findNearestStandingLocation(bot.dimension, bot.location);
  if (globalTick > (runtime.jumpDashAirborneUntilTick ?? -9999) && grounded && distanceSquared(grounded, bot.location) > 0.0001) {
    try {
      const snapped = patchSnapToBlockCenter(grounded);
      let clampSnapped = snapped;
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(clampSnapped)) { const c = clampLocationToBotBoundary(clampSnapped); if (isSafeStandingLocation(bot.dimension, c) && canOccupyLocation(bot.dimension, c)) clampSnapped = c; }
      if (isSafeStandingLocation(bot.dimension, clampSnapped) && canOccupyLocation(bot.dimension, clampSnapped))
        bot.teleport(clampSnapped, { dimension: bot.dimension, facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }) });
    } catch {}
  }
  const toTarget = vectorTo(bot.location, target.location);
  let planar = normalize2D(toTarget);
  const currentDistance = distance(bot.location, target.location);
  if (Math.abs(planar.x) < 0.0001 && Math.abs(planar.z) < 0.0001) {
    const fallback = normalize2D(target.getViewDirection?.() ?? { x: 1, y: 0, z: 0 });
    planar = Math.abs(fallback.x) < 0.0001 && Math.abs(fallback.z) < 0.0001 ? { x: 1, y: 0, z: 0 } : { x: -fallback.x, y: 0, z: -fallback.z };
  }
  try { bot.addEffect("speed", 6, { amplifier: 1, showParticles: false }); } catch {}
  if (globalTick >= runtime.nextStrafeFlipTick) { runtime.strafeDirection *= -1; runtime.nextStrafeFlipTick = globalTick + STRAFE_FLIP_INTERVAL; }
  let targetMaintainDistance = config.maintainDistance;
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  const isFleeing = patchIsRecoveryActive(bot, runtime, config);
  if (isFleeing) targetMaintainDistance = 12;
  const distanceError = currentDistance - targetMaintainDistance;
  const groundedNow = patchIsEntityOnGroundSafe(bot);
  const tooClose = distanceError < -0.1 && !(bot.location.y - target.location.y >= 2.0);
  const airborneTooClose = tooClose && !groundedNow;
  const shouldStandbyForHeal = isFleeing && !tooClose;
  const retreatDirection = { x: -planar.x, y: 0, z: -planar.z };
  const retreatWalk = tooClose && groundedNow;
  const inMeleeRange = currentDistance <= SWORD_RANGE;
  const targetBelow = target.location.y < bot.location.y - 1.5;
  const isCornered = (runtime.isCorneredTick === globalTick) && config.eatWhenCornered;
  
  const isStrafeNeeded = !isCornered && (runtime.stuckTicks > 0 || (config.strafeMove !== false && inMeleeRange && !retreatWalk && globalTick % 40 < 20));
  const strafeScale = isStrafeNeeded && !targetBelow && !shouldStandbyForHeal ? 0.032 : 0;
  const strafe = { x: -planar.z * runtime.strafeDirection, y: 0, z: planar.x * runtime.strafeDirection };
  const impulse = { x: strafe.x * strafeScale, y: 0, z: strafe.z * strafeScale };
  const retreatLimit = groundedNow ? -0.038 : 0;
  const radialStrength = isCornered ? 0 : (airborneTooClose || shouldStandbyForHeal ? 0
    : retreatWalk ? Math.max(-0.095, distanceError * 0.11)
    : Math.max(retreatLimit, Math.min(0.18, distanceError * 0.16)));
  const targetEyeLocation = addVector(target.location, { x: 0, y: 1.1, z: 0 });
  faceBotToward(bot, targetEyeLocation);
  setBotLookAt(bot, targetEyeLocation);
  impulse.x += planar.x * radialStrength;
  impulse.z += planar.z * radialStrength;
  const moveDirection = normalize2D(impulse);
  const jumpDashTriggered = patchShouldJumpDash(bot, target, config, moveDirection);
  if (jumpDashTriggered) {
    impulse.y += PATCH_JUMP_DASH_VERTICAL_IMPULSE;
    impulse.x += moveDirection.x * PATCH_JUMP_DASH_FORWARD_BONUS;
    impulse.z += moveDirection.z * PATCH_JUMP_DASH_FORWARD_BONUS;
    runtime.lastJumpDashTick = globalTick;
    runtime.jumpDashAirborneUntilTick = globalTick + PATCH_JUMP_DASH_AIRBORNE_TICKS;
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.dash_leap");
  }
  try { bot.applyImpulse(impulse); } catch {}
  if (jumpDashTriggered) {
    patchTryJumpDashTeleport(bot, target, config, moveDirection);
    return;
  }
  
  // Embedded detection — mine immediately, no threshold needed (but NOT when fleeing for recovery)
  const embedded = !isFleeing && patchIsBotEmbedded(bot);
  if (embedded) {
    debugLog(bot, config, "movement", `§e[Mining] EMBEDDED detected! Attempting mine immediately`, true);
    const embeddedDir = retreatWalk ? retreatDirection : (Math.hypot(planar.x, planar.z) > 0.1 ? planar : { x: 1, y: 0, z: 0 });
    if (patchTryMineBlock(bot, config, embeddedDir, embeddedDir, target)) {
      debugLog(bot, config, "movement", `§a[Mining] Embedded mine started`, true);
      return;
    } else {
      debugLog(bot, config, "movement", `§c[Mining] Embedded mine FAILED (no target block or mining disabled)`, true);
    }
  }

  const forwardStep = (!airborneTooClose && !retreatWalk) ? patchFindMovementStep(bot.dimension, bot.location, moveDirection, isStuck) : undefined;
  
  if (!forwardStep && !airborneTooClose) {
    runtime.forwardBlockedTicks = (runtime.forwardBlockedTicks ?? 0) + 1;
  } else {
    runtime.forwardBlockedTicks = 0;
  }
  
  // Debug: log stuck state every 10 ticks
  if (globalTick % 10 === 0 && (runtime.stuckTicks > 0 || runtime.forwardBlockedTicks > 0)) {
    const mdLen = Math.hypot(moveDirection.x, moveDirection.z).toFixed(3);
    const plLen = Math.hypot(planar.x, planar.z).toFixed(3);
    debugLog(bot, config, "movement", `§e[Stuck] stuckTicks=${runtime.stuckTicks} blockedTicks=${runtime.forwardBlockedTicks} isStuck=${isStuck} embedded=${embedded} enableMining=${config.enableMining} threshold=${config.mineStuckTicksThreshold ?? 10} mdLen=${mdLen} plLen=${plLen} retreatWalk=${retreatWalk}`, true);
  }

  const mineThreshold = Math.max(1, config.mineStuckTicksThreshold ?? 10);
  if (!isFleeing && ((isStuck && runtime.stuckTicks > mineThreshold) || 
      (runtime.forwardBlockedTicks > mineThreshold))) {
    debugLog(bot, config, "movement", `§e[Mining] Threshold reached! stuckTicks=${runtime.stuckTicks} blockedTicks=${runtime.forwardBlockedTicks} threshold=${mineThreshold}`, true);
    const mineDir = retreatWalk ? retreatDirection : moveDirection;
    const fallbackDir = Math.hypot(planar.x, planar.z) > 0.1 ? planar : { x: 1, y: 0, z: 0 };
    if (patchTryMineBlock(bot, config, mineDir, fallbackDir, target)) {
      debugLog(bot, config, "movement", `§a[Mining] Mine started!`, true);
      return; // Stop moving while mining
    } else {
      debugLog(bot, config, "movement", `§c[Mining] Mine FAILED after threshold`, true);
    }
  }
  
  const candidate = (!groundedNow ? findNearestStandingLocation(bot.dimension, bot.location, [0, -1, -2, -3, -4, -5]) : undefined) ??
    patchFindDescendStep(bot.dimension, bot.location, target.location, planar) ??
    (retreatWalk ? patchFindMovementStep(bot.dimension, bot.location, retreatDirection, isStuck) : undefined) ??
    (retreatWalk ? patchFindMovementStep(bot.dimension, bot.location, strafe, isStuck) : undefined) ??
    (retreatWalk ? patchFindMovementStep(bot.dimension, bot.location, { x: -strafe.x, y: 0, z: -strafe.z }, isStuck) : undefined) ??
    forwardStep ??
    (isStuck && !airborneTooClose ? patchTryBuildStep(bot, config, retreatWalk ? retreatDirection : moveDirection) : undefined);
  if (candidate) {
    try {
      let tptarget = candidate;
      if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(tptarget)) { const c = clampLocationToBotBoundary(tptarget); if (isSafeStandingLocation(bot.dimension, c) && canOccupyLocation(bot.dimension, c)) tptarget = c; }
      bot.teleport(tptarget, {
        dimension: bot.dimension,
        facingLocation: retreatWalk ? addVector(tptarget, { x: retreatDirection.x * 2, y: 1.1, z: retreatDirection.z * 2 }) : addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
      tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.walk");
    } catch {}
  } else if (!isFleeing && !shouldStandbyForHeal &&
             config.strafeMove !== false &&
             (Math.abs(distanceError) > 0.8 || Math.abs(target.location.y - bot.location.y) > 2.0) &&
             (runtime.stuckTicks ?? 0) > PATCH_STUCK_ESCAPE_TICKS &&
             globalTick - Number(runtime.lastEscapeTeleportTick ?? -9999) >= PATCH_ESCAPE_TELEPORT_COOLDOWN) {
    // 長時間動けない(クレーター/埋没など) → 安全な足場へ強制脱出
    if (patchTryEscapeStuck(bot, config, target)) {
      runtime.lastEscapeTeleportTick = globalTick;
      runtime.stuckTicks = 0;
      debugLog(bot, config, "movement", `§e[脱出] スタック状態から強制脱出`, true);
    }
  }
  // Safety net: if bot ended up outside boundary after all movement, pull back
  if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(bot.location)) {
    const safe = findSafeBoundaryReturnLocation(bot);
    try { bot.teleport(safe, { dimension: bot.dimension }); } catch {}
  }
}