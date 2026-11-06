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
  MOVE_SPEED_WALK, MOVE_SPEED_SPRINT, MOVE_SPEED_STRAFE, MOVE_SPEED_RETREAT,
  MOVE_SPEED_WATER, MOVE_MAX_ACCEL_GROUND, MOVE_MAX_ACCEL_AIR,
  MOVE_JUMP_IMPULSE, MOVE_JUMP_COOLDOWN_TICKS, MOVE_SPRINT_JUMP_BONUS,
  NAV_REPATH_INTERVAL_TICKS, NAV_REPATH_FAIL_INTERVAL_TICKS,
  NAV_MAX_EXPANSIONS, NAV_MAX_PATH_DISTANCE, NAV_WAYPOINT_REACH_RADIUS,
  NAV_WAYPOINT_REACH_RADIUS_Y, NAV_PATH_MAX_AGE_TICKS,
  STUCK_DETECT_MOVE_EPSILON, STUCK_STAGE_JIGGLE_TICKS, STUCK_STAGE_DETOUR_TICKS,
  STUCK_STAGE_MINE_TICKS, STUCK_STAGE_PILLAR_TICKS, STUCK_STAGE_TELEPORT_TICKS,
  STUCK_DETOUR_HOLD_TICKS, LOOK_TURN_SPEED_COMBAT, LOOK_TURN_SPEED_TRAVEL,
  TACTIC_ORBIT_DISTANCE_TOLERANCE,
} from "./constants.js";
import { isSimBot } from "./sim_port.js";
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
  getBotVelocity, applyHorizontalSteering, isBotOnGround,
} from "./utils.js";
import { getRuntime, normalizeGlobalSettings } from "./config.js";
import {
  selectBestSword, equipMainhandItem, consumeManagedItem,
  syncBotLoadout, selectBestPickaxe,
} from "./inventory.js";
import {
  navFindPath, navFindStandableNear, navIsStandableCell, navCanOccupy,
  navFindGroundY, navIsPassableBlock, navIsWaterBlock, navHasWalkableLine,
  navSnapToCardinal2D,
} from "./navigation.js";
import {
  evaluateCombatTactic, tacticTryPillarUp, tacticTryBridgeToward,
  tryCrystalSurf, tryAnchorJump,
  tacticIsDangerousLedge, tacticPlaceBlockAt,
  TACTIC_ENGAGE, TACTIC_CLOSE_GAP, TACTIC_CLIMB, TACTIC_DESCEND,
  TACTIC_KITE, TACTIC_LOW_GROUND, TACTIC_HOLD,
} from "./tactics.js";

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
  // 実投げ: エンパ実体を射出し、実際の弾道で飛行させる(着地点到達/静止でテレポート)
  let pearl;
  let launchMethod = "";
  try {
    const eye = addVector(bot.location, { x: 0, y: 1.45, z: 0 });
    const aimPoint = addVector(landingSpot, { x: 0, y: 0.6, z: 0 });
    const toLand = vectorTo(eye, aimPoint);
    const dist = Math.hypot(toLand.x, toLand.y, toLand.z) || 1;
    const dir = { x: toLand.x / dist, y: toLand.y / dist + 0.1, z: toLand.z / dist };
    const speed = Math.max(0.8, Math.min(2.4, dist * 0.1));
    pearl = bot.dimension.spawnEntity(ENDER_PEARL_ID, eye);
    try { pearl.shoot({ direction: dir, speed }); launchMethod = "shoot"; }
    catch {
      try { pearl.applyImpulse({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }); launchMethod = "impulse"; } catch {}
    }
    debugLog(bot, config, "movement", `§e[Pearl] thrown ${launchMethod || "stationary"} dist=${dist.toFixed(1)} speed=${speed.toFixed(2)}`, true);
  } catch { pearl = undefined; }
  trackThrownPearl(bot, pearl, landingSpot, target, runtime, token);
}

// 射出したエンパの着地追跡: 弾道が落ち着いた/目標地点付近に達したらテレポート
const botThrownPearlIds = new Set();

function trackThrownPearl(bot, pearl, landingSpot, target, runtime, token) {
  if (pearl?.id) botThrownPearlIds.add(String(pearl.id));
  let ticks = 0;
  const step = () => {
    if (runtime.pendingPearlToken !== token) {
      if (pearl?.id) botThrownPearlIds.delete(String(pearl.id));
      try { pearl?.remove(); } catch {}
      return;
    }
    try {
      ticks++;
      const alive = pearl?.isValid;
      const vel = alive ? pearl.velocity : undefined;
      const speed2 = vel ? Math.hypot(vel.x, vel.y, vel.z) : 0;
      const nearSpot = alive
        && Math.abs(pearl.location.x - landingSpot.x) + Math.abs(pearl.location.z - landingSpot.z) < 1.2
        && pearl.location.y - landingSpot.y < 1.5;
      if (ticks < 6) { system.runTimeout(step, 1); return; }
      if (!alive || ticks >= 40 || speed2 < 0.05 || nearSpot) {
        if (pearl?.id) botThrownPearlIds.delete(String(pearl.id));
        try { pearl?.remove(); } catch {}
        if (runtime.pendingPearlToken === token) {
          try { bot.teleport(landingSpot, { dimension: bot.dimension, facingLocation: target.location }); } catch {}
          runtime.pendingPearlToken = "";
          const held = getEquippableComponent(bot)?.getEquipment(EquipmentSlot.Mainhand);
          if (held?.typeId === ENDER_PEARL_ID) selectBestSword(bot);
        }
        return;
      }
      system.runTimeout(step, 1);
    } catch {
      if (pearl?.id) botThrownPearlIds.delete(String(pearl.id));
      try { pearl?.remove(); } catch {}
      runtime.pendingPearlToken = "";
    }
  };
  system.runTimeout(step, 1);
}

// ── [0.8.0] 敵が投げたエンダーパールを追従して着地点に先回り ──
// 相手が飛ばしたエンパ(minecraft:ender_pearl)の弾道を外挿して着地点を即座に予測し、
// 相手のエンパが着弾する前に自分もエンパ(または高速移動)で着地点へ先回りする。
function predictEnemyPearlLandingSpot(dimension, pearl) {
  try {
    let x = pearl.location.x;
    let y = pearl.location.y;
    let z = pearl.location.z;
    const v = pearl.getVelocity?.() ?? pearl.velocity ?? { x: 0, y: 0, z: 0 };
    let vx = v.x, vy = v.y, vz = v.z;
    if (Math.hypot(vx, vy, vz) < 0.08) return undefined;

    for (let t = 1; t <= 45; t++) {
      x += vx;
      y += vy;
      z += vz;
      vy -= 0.03; // エンパ重力加速度
      vx *= 0.99;
      vy *= 0.99;
      vz *= 0.99;
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      const hitBlock = getBlock(dimension, { x: bx, y: by, z: bz });
      const belowBlock = getBlock(dimension, { x: bx, y: by - 1, z: bz });
      if ((hitBlock && !isAirBlock(hitBlock)) || (belowBlock && !isAirBlock(belowBlock) && vy <= 0)) {
        const standable = navFindStandableNear(dimension, { x: bx + 0.5, y: by + 1, z: bz + 0.5 }, 2, 4);
        return standable ?? { x: bx + 0.5, y: by + 1, z: bz + 0.5 };
      }
    }
    const fallback = navFindStandableNear(dimension, { x, y, z }, 3, 6);
    return fallback ?? { x, y, z };
  } catch { return undefined; }
}

export function handleEnemyPearlIntercept(bot, target, config) {
  if (config.pearlFollow === false) return false;
  const runtime = getRuntime(config.uid);
  if (patchIsRecoveryActive(bot, runtime, config)) return false;

  let enemyPearl = undefined;
  try {
    const pearls = bot.dimension.getEntities({
      type: ENDER_PEARL_ID,
      location: target.location,
      maxDistance: 36,
    });
    for (const p of pearls) {
      if (!p?.isValid) continue;
      if (botThrownPearlIds.has(String(p.id))) continue;
      // 自分が今投げたばかりのエンパ（自分の目の前にある等）は除外
      if (runtime.pendingPearlToken && distance(p.location, bot.location) < 2.0 && distance(p.location, target.location) > 3.5) continue;
      enemyPearl = p;
      break;
    }
  } catch {}

  if (!enemyPearl) {
    if (runtime.pearlInterceptGoal && globalTick > Number(runtime.pearlInterceptUntilTick ?? 0)) {
      runtime.pearlInterceptGoal = undefined;
    }
    return false;
  }

  const predictedSpot = predictEnemyPearlLandingSpot(bot.dimension, enemyPearl);
  if (!predictedSpot) return false;
  if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(predictedSpot)) return false;

  // 移動ゴールとしても即座にセット（徒歩・ダッシュでも着地点へ直行）
  runtime.pearlInterceptGoal = predictedSpot;
  runtime.pearlInterceptUntilTick = globalTick + 35;

  // 既に追跡エンパを投げた同一エンパIDなら重複発射しない
  const pearlEntityId = String(enemyPearl.id);
  if (runtime.lastInterceptedPearlId === pearlEntityId) return true;
  if (distance(bot.location, predictedSpot) < 4.5) return true;

  // 相手のエンパより早く着地点へ先回りするため、クールダウンを無視して即エンパ発射＋高速到達
  if (config.pearlMove !== false && equipMainhandItem(bot, ENDER_PEARL_ID, config) && consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)) {
    runtime.lastInterceptedPearlId = pearlEntityId;
    runtime.lastPearlTick = globalTick;
    const token = `${config.uid}:intercept:${globalTick}`;
    runtime.pendingPearlToken = token;
    faceBotToward(bot, predictedSpot);
    let myPearl;
    try {
      const eye = addVector(bot.location, { x: 0, y: 1.45, z: 0 });
      const toLand = vectorTo(eye, addVector(predictedSpot, { x: 0, y: 0.6, z: 0 }));
      const dist = Math.hypot(toLand.x, toLand.y, toLand.z) || 1;
      const dir = { x: toLand.x / dist, y: toLand.y / dist + 0.08, z: toLand.z / dist };
      const speed = Math.max(1.4, Math.min(2.8, dist * 0.14));
      myPearl = bot.dimension.spawnEntity(ENDER_PEARL_ID, eye);
      if (myPearl?.id) botThrownPearlIds.add(String(myPearl.id));
      try { myPearl.shoot({ direction: dir, speed }); }
      catch { try { myPearl.applyImpulse({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }); } catch {} }
    } catch {}
    debugLog(bot, config, "movement", `§d[PearlFollow] 敵エンパを検知 -> 着地点(${Math.floor(predictedSpot.x)},${Math.floor(predictedSpot.y)},${Math.floor(predictedSpot.z)})へ高速先回り！`, true);
    appendPersistentDebugLog("movement", `${config.displayName}: enemy pearl intercept -> (${Math.floor(predictedSpot.x)},${Math.floor(predictedSpot.y)},${Math.floor(predictedSpot.z)})`);
    // 相手のエンパ着弾より早く先回りするため、3tick後に着地点へ到達させる
    system.runTimeout(() => {
      try {
        if (myPearl?.id) botThrownPearlIds.delete(String(myPearl.id));
        try { myPearl?.remove(); } catch {}
        if (!bot?.isValid) return;
        if (runtime.pendingPearlToken === token) runtime.pendingPearlToken = "";
        bot.teleport(predictedSpot, { dimension: bot.dimension, facingLocation: target?.isValid ? target.location : predictedSpot });
        runtime.navPath = undefined;
        selectBestSword(bot);
      } catch {}
    }, 3);
    return true;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════
// Movement Engine v2
// 方針:
//  - teleport による毎tickの位置補正をやめ、applyImpulse による物理移動に統一。
//    (teleport は速度をリセットするため、毎tick呼ぶと「がたがた」振動していた)
//  - 1歩先だけを見る貪欲探索をやめ、A* の経路に沿って進む。
//  - スタック時は段階的にエスカレーション(揺らし→迂回→採掘→柱/橋→最後の手段のTP)。
// ══════════════════════════════════════════════════════════════

// ── Ground / Water state ──
function moveGetSurfaceState(bot) {
  const feetBlock = getBlock(bot.dimension, floorLocation(bot.location));
  const inWater = navIsWaterBlock(feetBlock);
  const onGround = isBotOnGround(bot);
  return { inWater, onGround };
}

// ── Stuck detection ──
// 「命令した方向へ実際に進めているか」で判定する。
// 単純な移動量ではノックバック中や周回中に誤検知するため、
// 意図した方向への進捗(dot product)を見る。
function moveUpdateStuckState(bot, runtime, intendedDirection) {
  const previous = runtime.lastMovementLocation;
  const current = { x: bot.location.x, y: bot.location.y, z: bot.location.z };
  runtime.lastMovementLocation = current;
  if (!previous) { runtime.stuckTicks = 0; return 0; }

  const deltaX = current.x - previous.x;
  const deltaY = current.y - previous.y;
  const deltaZ = current.z - previous.z;
  const wantsToMove = intendedDirection && Math.hypot(intendedDirection.x, intendedDirection.z) > 0.05;

  if (!wantsToMove) {
    runtime.stuckTicks = 0;
    runtime.stuckWindow = undefined;
    return 0;
  }
  // 意図方向への前進成分が出たら即リセット（正常移動）
  const progress = deltaX * intendedDirection.x + deltaZ * intendedDirection.z;
  if (progress >= STUCK_DETECT_MOVE_EPSILON) {
    runtime.stuckTicks = 0;
    runtime.stuckWindow = { tick: globalTick, x: current.x, y: current.y, z: current.z };
    return 0;
  }

  // [0.5.4] 10tick ごとの「水平変位」で判定する。
  // 旧実装は verticalMoved > 0.12 でリセットしていたため、穴の中でジャンプして
  // いるだけでスタック判定が毎回消え、脱出エスカレーション（迂回→採掘→柱→TP）が
  // 永久に発動しなかった（着地後スタックの主因）。
  const win = runtime.stuckWindow
    ?? (runtime.stuckWindow = { tick: globalTick, x: current.x, y: current.y, z: current.z });
  const elapsed = globalTick - win.tick;
  if (elapsed < 10) return Number(runtime.stuckTicks ?? 0);

  const hMoved = Math.hypot(current.x - win.x, current.z - win.z);
  const vGain = current.y - win.y;
  runtime.stuckWindow = { tick: globalTick, x: current.x, y: current.y, z: current.z };

  // 横に1ブロック以上動けた、または柱上昇でほぼ1ブロック垂直に稼いだ → 進んでいる
  if (hMoved >= 1.0 || vGain >= 0.9) {
    runtime.stuckTicks = 0;
    return 0;
  }
  // 自由落下中はカウントしない（着地後に改めて判定される）
  if (deltaY < -0.3) return Number(runtime.stuckTicks ?? 0);
  runtime.stuckTicks = Number(runtime.stuckTicks ?? 0) + 10;
  return Number(runtime.stuckTicks ?? 0);
}

// ── Path following ──
function moveGoalKey(goal) {
  return `${Math.floor(goal.x)}|${Math.floor(goal.y)}|${Math.floor(goal.z)}`;
}

// 複数Botが同じtickに一斉に経路探索するとラグの原因になるため、
// uid由来の固定オフセットで探索tickを分散させる。
function moveRepathSlotOffset(runtime, uid) {
  if (runtime.navSlotOffset === undefined) {
    let hash = 0;
    const text = `${uid ?? ""}`;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    runtime.navSlotOffset = Math.abs(hash) % NAV_REPATH_INTERVAL_TICKS;
  }
  return runtime.navSlotOffset;
}

function moveShouldRepath(runtime, goal, uid) {
  const elapsed = globalTick - Number(runtime.navLastPathTick ?? -9999);
  const offset = moveRepathSlotOffset(runtime, uid);
  if (!runtime.navPath || !runtime.navPath.length) {
    const interval = runtime.navLastPathFailed ? NAV_REPATH_FAIL_INTERVAL_TICKS : NAV_REPATH_INTERVAL_TICKS;
    // 経路が無い時は待ちすぎると動けないので、スロット分散は緩めに適用する
    if (elapsed < interval) return false;
    return ((globalTick + offset) % 3) === 0 || elapsed >= interval * 2;
  }
  if (elapsed >= NAV_PATH_MAX_AGE_TICKS) return true;
  // ゴールが大きく動いた場合は再計算
  if (runtime.navGoalKey !== moveGoalKey(goal) && elapsed >= NAV_REPATH_INTERVAL_TICKS) {
    return ((globalTick + offset) % NAV_REPATH_INTERVAL_TICKS) === 0 || elapsed >= NAV_REPATH_INTERVAL_TICKS * 2;
  }
  return false;
}

function moveRequestPath(bot, runtime, goal, config) {
  const travelDistance = distance(bot.location, goal);
  if (travelDistance > NAV_MAX_PATH_DISTANCE) {
    // 遠すぎる場合はゴール方向の中間点を目標にする
    const direction = normalize2D(vectorTo(bot.location, goal));
    const midpoint = {
      x: bot.location.x + direction.x * NAV_MAX_PATH_DISTANCE * 0.7,
      y: bot.location.y,
      z: bot.location.z + direction.z * NAV_MAX_PATH_DISTANCE * 0.7,
    };
    goal = navFindStandableNear(bot.dimension, midpoint, 3, 6) ?? midpoint;
  }
  runtime.navLastPathTick = globalTick;
  runtime.navGoalKey = moveGoalKey(goal);
  // [0.10.0] すでに空いている道（既存の通路・階段・迂回路）を確実に見つけるため探索空間を拡張
  const result = navFindPath(bot.dimension, bot.location, goal, {
    maxExpansions: Math.max(640, NAV_MAX_EXPANSIONS),
    maxFall: 6,
    maxJumpGap: config.jumpDash === false ? 1 : 3,
    respectBoundary: !!globalSettings.boundaryEnabled,
  });
  if (!result || !result.waypoints.length) {
    runtime.navPath = undefined;
    runtime.navLastPathFailed = true;
    return false;
  }
  runtime.navPath = result.waypoints;
  runtime.navPathComplete = result.complete;
  runtime.navLastPathFailed = false;
  return true;
}

// 到達済みのウェイポイントを捨てて、次に向かうべき点を返す
function moveConsumeWaypoint(bot, runtime) {
  const path = runtime.navPath;
  if (!path || !path.length) return undefined;
  while (path.length) {
    const waypoint = path[0];
    const horizontal = Math.hypot(waypoint.x - bot.location.x, waypoint.z - bot.location.z);
    const vertical = Math.abs(waypoint.y - bot.location.y);
    if (horizontal <= NAV_WAYPOINT_REACH_RADIUS && vertical <= NAV_WAYPOINT_REACH_RADIUS_Y) {
      path.shift();
      continue;
    }
    // 経路のショートカット: 2つ先が直接歩けるなら1つ飛ばす（カクつき防止）
    if (path.length >= 2 && horizontal < 2.2) {
      const next = path[1];
      if (navHasWalkableLine(bot.dimension, bot.location, next, 1, 3)) {
        path.shift();
        continue;
      }
    }
    return waypoint;
  }
  runtime.navPath = undefined;
  return undefined;
}

// ── Jump ──
function moveHasJumpClearance(bot) {
  const feet = floorLocation(bot.location);
  return navIsPassableBlock(getBlock(bot.dimension, { x: feet.x, y: feet.y + 2, z: feet.z }));
}

function moveTryJump(bot, runtime, config, extraForward = 0, direction = undefined) {
  if (config.jumpDash === false) return false;
  if (globalTick - Number(runtime.lastJumpTick ?? -9999) < MOVE_JUMP_COOLDOWN_TICKS) return false;
  if (!isBotOnGround(bot)) return false;
  if (!moveHasJumpClearance(bot)) return false;
  if (isSimBot(bot)) {
    try { bot.jump(); } catch { return false; }
    runtime.lastJumpTick = globalTick;
    runtime.lastJumpDashTick = globalTick;
    return true;
  }
  const impulse = { x: 0, y: MOVE_JUMP_IMPULSE, z: 0 };
  if (direction && extraForward > 0) {
    impulse.x = direction.x * extraForward;
    impulse.z = direction.z * extraForward;
  }
  try { bot.applyImpulse(impulse); } catch { return false; }
  runtime.lastJumpTick = globalTick;
  runtime.lastJumpDashTick = globalTick;
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.dash_leap");
  return true;
}

// 次のウェイポイントが上段の場合、ジャンプが必要かを判定
function moveNeedsJumpForWaypoint(bot, waypoint) {
  const heightDelta = waypoint.y - bot.location.y;
  if (heightDelta >= 0.55) return true;
  if (waypoint.jump) return true;
  return false;
}

// 進行方向に腰高のブロックがあるならジャンプで超える
function moveHasStepObstacle(bot, direction) {
  const probe = addVector(bot.location, { x: direction.x * 0.7, y: 0, z: direction.z * 0.7 });
  const feet = floorLocation(probe);
  const feetBlock = getBlock(bot.dimension, feet);
  if (navIsPassableBlock(feetBlock)) return false;
  // 1ブロック上が空いていれば登れる段差
  const above = getBlock(bot.dimension, { x: feet.x, y: feet.y + 1, z: feet.z });
  const above2 = getBlock(bot.dimension, { x: feet.x, y: feet.y + 2, z: feet.z });
  return navIsPassableBlock(above) && navIsPassableBlock(above2);
}

// ── Mining ──
function moveIsBotEmbedded(bot) {
  const feet = floorLocation(bot.location);
  const feetBlock = getBlock(bot.dimension, feet);
  const headBlock = getBlock(bot.dimension, { x: feet.x, y: feet.y + 1, z: feet.z });
  return !navIsPassableBlock(feetBlock) || !navIsPassableBlock(headBlock);
}

function moveFindMineTarget(bot, direction, targetLocation) {
  const feet = floorLocation(bot.location);
  const runtime = getRuntime(getBotUid(bot) || "");
  // 1. 埋まっている場合は頭→足を優先で掘る
  const embeddedCandidates = [
    { x: feet.x, y: feet.y + 1, z: feet.z },
    { x: feet.x, y: feet.y, z: feet.z },
  ];
  for (const candidate of embeddedCandidates) {
    const block = getBlock(bot.dimension, candidate);
    if (block && !isAirBlock(block) && !PATCH_EXPLOSION_PRESERVE_IDS.has(block.typeId)) return candidate;
  }
  // 2. [0.10.0] 上に上がりたい時は「斜め」ではなく「直線(東/西/南/北の4方向)」に固定して階段掘りを行う！
  //    さらに頭上(feet.y+2)と1歩先の3段(y+1, y+2, y+3)を順番に掘ることで、真っ直ぐな階段でスムーズに上がれる。
  const wantsUp = Boolean(targetLocation && targetLocation.y >= bot.location.y + 1.2);
  let cardinal = navSnapToCardinal2D(direction);
  if (wantsUp) {
    if (runtime.stairCardinalDir && globalTick <= Number(runtime.stairCardinalUntilTick ?? 0)) {
      cardinal = runtime.stairCardinalDir;
    } else {
      runtime.stairCardinalDir = cardinal;
      runtime.stairCardinalUntilTick = globalTick + 45;
    }
    const cx = feet.x + cardinal.x;
    const cz = feet.z + cardinal.z;
    const stairMineCandidates = [
      // まず自分の真上の天井(ジャンプ余裕)を空ける
      { x: feet.x, y: feet.y + 2, z: feet.z },
      // 次に直進1歩目の頭・胴・上段頭上(階段で1段上がるための3マス空間)を直線で掘る
      { x: cx, y: feet.y + 1, z: cz },
      { x: cx, y: feet.y + 2, z: cz },
      // 1歩目の足元(feet.y)は踏み台として残すが、もし1歩目の下(feet.y-1)が空でなく既に高い壁ならfeet.yも掘って1段にする
      ...(isSolidBlock(getBlock(bot.dimension, { x: cx, y: feet.y, z: cz })) &&
          isSolidBlock(getBlock(bot.dimension, { x: cx, y: feet.y + 1, z: cz })) &&
          !isSolidBlock(getBlock(bot.dimension, { x: cx, y: feet.y - 1, z: cz }))
          ? [{ x: cx, y: feet.y, z: cz }] : []),
      // 直進2歩目の階段空間も先回りして直線で掘る
      { x: feet.x + cardinal.x * 2, y: feet.y + 2, z: feet.z + cardinal.z * 2 },
      { x: feet.x + cardinal.x * 2, y: feet.y + 3, z: feet.z + cardinal.z * 2 },
    ];
    for (const candidate of stairMineCandidates) {
      const block = getBlock(bot.dimension, candidate);
      if (block && !isAirBlock(block) && !PATCH_EXPLOSION_PRESERVE_IDS.has(block.typeId)) {
        return candidate;
      }
    }
  }
  // 3. 平地・降下時も直線4方向(cardinal)の中心列を最優先で掘り、斜め掘りによる角引っかかりを防ぐ
  const yLevels = [1, 0];
  if (targetLocation && targetLocation.y < bot.location.y - 1.0) yLevels.push(-1);
  for (const step of [1, 2]) {
    for (const yOffset of yLevels) {
      const candidate = {
        x: feet.x + cardinal.x * step,
        y: feet.y + yOffset,
        z: feet.z + cardinal.z * step,
      };
      const block = getBlock(bot.dimension, candidate);
      if (block && !isAirBlock(block) && !PATCH_EXPLOSION_PRESERVE_IDS.has(block.typeId)) return candidate;
    }
  }
  return undefined;
}

function moveTryMineBlock(bot, config, direction, targetLocation) {
  if (!config.enableMining) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick < Number(runtime.miningUntilTick ?? 0)) return true; // 採掘中
  const blockLocation = moveFindMineTarget(bot, direction, targetLocation);
  if (!blockLocation) return false;

  const pickaxeStats = selectBestPickaxe(bot);
  const mineDelay = pickaxeStats ? Math.max(3, Math.floor(20 / Math.max(1, pickaxeStats.speed))) : 5;
  runtime.miningUntilTick = globalTick + mineDelay;
  faceBotToward(bot, { x: blockLocation.x + 0.5, y: blockLocation.y + 0.5, z: blockLocation.z + 0.5 });
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  system.runTimeout(() => {
    try {
      if (!isEntityUsable(bot)) return;
      patchRunDimensionCommandNoThrow(bot.dimension,
        `setblock ${quoteCoord(blockLocation.x)} ${quoteCoord(blockLocation.y)} ${quoteCoord(blockLocation.z)} air destroy`);
      selectBestSword(bot);
      // 採掘後は経路が変わるので再探索させる
      runtime.navPath = undefined;
    } catch {}
  }, mineDelay);
  return true;
}

// ── Boundary ──
// isLocationInsideBotBoundary と同じ ±0.5 マージンを使う。
// マージンが違うと「内側判定なのにクランプされる」帯ができ、毎tick引き戻されて振動した。
function clampLocationToBotBoundary(location) {
  const settings = normalizeGlobalSettings(globalSettings);
  return {
    x: Math.max(settings.boundaryMinX + 0.5, Math.min(settings.boundaryMaxX - 0.5, location.x)),
    y: Math.max(settings.boundaryMinY, Math.min(settings.boundaryMaxY, location.y)),
    z: Math.max(settings.boundaryMinZ + 0.5, Math.min(settings.boundaryMaxZ - 0.5, location.z)),
  };
}

function findSafeBoundaryReturnLocation(bot) {
  const clamped = clampLocationToBotBoundary(bot.location);
  const grounded = navFindStandableNear(bot.dimension, clamped, 2, 5);
  if (grounded && isLocationInsideBotBoundary(grounded)) return grounded;
  return clamped;
}

export function enforceBotBoundary(bot, config) {
  if (!globalSettings.boundaryEnabled || isLocationInsideBotBoundary(bot.location)) return false;
  const destination = findSafeBoundaryReturnLocation(bot);
  try { bot.teleport(destination, { dimension: bot.dimension }); return true; } catch { return false; }
}

// 境界の内側に押し戻す「力」を返す。teleport ではなく操舵で戻すので滑らか。
function moveComputeBoundaryAvoidance(bot) {
  if (!globalSettings.boundaryEnabled) return undefined;
  const settings = normalizeGlobalSettings(globalSettings);
  const margin = 1.5;
  let pushX = 0, pushZ = 0;
  if (bot.location.x < settings.boundaryMinX + margin) pushX = 1;
  else if (bot.location.x > settings.boundaryMaxX - margin) pushX = -1;
  if (bot.location.z < settings.boundaryMinZ + margin) pushZ = 1;
  else if (bot.location.z > settings.boundaryMaxZ - margin) pushZ = -1;
  if (pushX === 0 && pushZ === 0) return undefined;
  return normalize2D({ x: pushX, y: 0, z: pushZ });
}

// ── Stuck escape (段階的) ──
function moveTryEscapeTeleport(bot, config, target) {
  if (config.escapeTeleport === false) return false;
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastEscapeTeleportTick ?? -9999) < PATCH_ESCAPE_TELEPORT_COOLDOWN) return false;
  const origin = bot.location;
  for (let radius = 1; radius <= 5; radius++) {
    for (let dy = 2; dy >= -3; dy--) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = Math.floor(origin.x) + dx, y = Math.floor(origin.y) + dy, z = Math.floor(origin.z) + dz;
          if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary({ x: x + 0.5, y, z: z + 0.5 })) continue;
          if (navIsStandableCell(bot.dimension, x, y, z) !== 1) continue;
          try {
            bot.teleport({ x: x + 0.5, y, z: z + 0.5 }, { dimension: bot.dimension, facingLocation: target?.location });
            runtime.lastEscapeTeleportTick = globalTick;
            runtime.stuckTicks = 0;
            runtime.navPath = undefined;
            return true;
          } catch { return false; }
        }
      }
    }
  }
  // 周囲が全滅 → オーナー付近へ退避
  const owner = getPlayerByName(config.ownerName) ?? findClosestPlayer(bot.location, bot.dimension, 48);
  if (!owner) return false;
  const rescue = navFindStandableNear(bot.dimension, owner.location, 3, 4);
  if (!rescue) return false;
  try {
    bot.teleport(rescue, { dimension: bot.dimension, facingLocation: target?.location });
    runtime.lastEscapeTeleportTick = globalTick;
    runtime.stuckTicks = 0;
    runtime.navPath = undefined;
    return true;
  } catch { return false; }
}

// 迂回方向を選ぶ(左右のどちらかに一定時間コミットする)
function moveComputeDetourDirection(bot, runtime, forwardDirection) {
  if (globalTick <= Number(runtime.detourUntilTick ?? -9999) && runtime.detourDirection) {
    return runtime.detourDirection;
  }
  const side = { x: -forwardDirection.z, y: 0, z: forwardDirection.x };
  const candidates = [
    { x: side.x, y: 0, z: side.z },
    { x: -side.x, y: 0, z: -side.z },
    normalize2D({ x: side.x + forwardDirection.x, y: 0, z: side.z + forwardDirection.z }),
    normalize2D({ x: -side.x + forwardDirection.x, y: 0, z: -side.z + forwardDirection.z }),
  ];
  for (const candidate of candidates) {
    const probe = addVector(bot.location, { x: candidate.x * 1.2, y: 0, z: candidate.z * 1.2 });
    const groundY = navFindGroundY(bot.dimension, { ...probe, y: probe.y + 1.2 }, 4);
    if (groundY === undefined) continue;
    const resolved = { x: probe.x, y: groundY, z: probe.z };
    if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(resolved)) continue;
    if (!navCanOccupy(bot.dimension, resolved)) continue;
    runtime.detourDirection = candidate;
    runtime.detourUntilTick = globalTick + STUCK_DETOUR_HOLD_TICKS;
    return candidate;
  }
  return undefined;
}

/**
 * スタック段階に応じた回復処理。
 * @returns {{ handled: boolean, direction?: {x,y,z} }}
 */
function moveHandleStuckEscalation(bot, config, target, stuckTicks, forwardDirection, tactic) {
  const runtime = getRuntime(config.uid);
  if (stuckTicks < STUCK_STAGE_JIGGLE_TICKS) return { handled: false };

  // 段階1: 埋没しているなら即掘る（何よりも優先）
  if (moveIsBotEmbedded(bot)) {
    if (moveTryMineBlock(bot, config, forwardDirection, target?.location)) {
      debugLog(bot, config, "movement", `§e[脱出] 埋没を検知して採掘 stuck=${stuckTicks}`);
      return { handled: true };
    }
    // 掘れない → 上に押し出す
    if (isSimBot(bot)) {
      try { bot.jump(); } catch {}
      return { handled: true };
    }
    try { bot.applyImpulse({ x: forwardDirection.x * 0.1, y: 0.42, z: forwardDirection.z * 0.1 }); } catch {}
    return { handled: true };
  }

  // [0.10.0] 上に上がりたい時は斜めではなく直線(東/西/南/北)にスナップして進む
  const straightDir = (tactic?.mode === TACTIC_CLIMB || (target && target.location.y - bot.location.y >= 1.3))
    ? (runtime.stairCardinalDir && globalTick <= Number(runtime.stairCardinalUntilTick ?? 0)
        ? runtime.stairCardinalDir
        : navSnapToCardinal2D(forwardDirection))
    : forwardDirection;

  // 段階2: まず既存の空いているA*経路を再検索し、無ければ直線方向にジャンプ/足場設置
  if (stuckTicks < STUCK_STAGE_DETOUR_TICKS) {
    if (!runtime.navPath || !runtime.navPath.length) {
      moveRequestPath(bot, runtime, tactic?.goal ?? target?.location ?? bot.location, config);
    }
    if (moveHasStepObstacle(bot, straightDir) || moveTryJump(bot, runtime, config, MOVE_SPRINT_JUMP_BONUS, straightDir)) {
      return { handled: false, direction: straightDir };
    }
    if (config.blockPlacing !== false && tacticTryBridgeToward(bot, config, straightDir)) {
      return { handled: true };
    }
    return { handled: false, direction: straightDir };
  }

  // 段階3: 既存の空いている道へ迂回 or 直線で階段掘り
  if (stuckTicks < STUCK_STAGE_MINE_TICKS) {
    // 上に上がりたいのに壁で塞がれている場合は、斜めにうろうろせず直線で階段掘りして上がる！
    if (tactic?.mode === TACTIC_CLIMB && moveTryMineBlock(bot, config, straightDir, target?.location)) {
      debugLog(bot, config, "movement", `§e[階段掘り] 直線方向(${straightDir.x},${straightDir.z})へ階段採掘中`);
      return { handled: true };
    }
    const detour = moveComputeDetourDirection(bot, runtime, straightDir);
    if (detour) {
      runtime.navPath = undefined; // 経路も作り直す
      debugLog(bot, config, "movement", `§e[脱出] 空いている道へ迂回中 stuck=${stuckTicks}`);
      return { handled: false, direction: detour };
    }
    if (config.blockPlacing !== false && tacticTryBridgeToward(bot, config, straightDir)) {
      return { handled: true };
    }
  }

  // 段階4: 直線で掘って進む or 足場を積む
  if (stuckTicks < STUCK_STAGE_PILLAR_TICKS) {
    if (moveTryMineBlock(bot, config, straightDir, target?.location)) {
      debugLog(bot, config, "movement", `§e[脱出] 直線進路を採掘 stuck=${stuckTicks}`);
      return { handled: true };
    }
    if (config.blockPlacing !== false && tacticTryPillarUp(bot, config, target)) {
      return { handled: true };
    }
  }

  // 段階5: 柱/橋で地形を作る
  if (stuckTicks < STUCK_STAGE_TELEPORT_TICKS) {
    // [B-7] 相手との水平距離が爆発リーチ内なら柱を立てて追わない（足元起爆が正解）。
    // 旧実装は「相手が上なら柱で追う」で、最も狙われる自滅ポジション（相手の真下で
    // 浮いた状態）に自ら上がっていく実戦メタと逆の挙動だった。
    const horizontalToTarget = target ? Math.hypot(target.location.x - bot.location.x, target.location.z - bot.location.z) : Infinity;
    const pillarAllowed = !target || horizontalToTarget > 4.5;
    if (pillarAllowed && tactic?.mode === TACTIC_CLIMB && tacticTryPillarUp(bot, config, target)) {
      moveTryJump(bot, runtime, config);
      return { handled: true };
    }
    // [C-3] アンカージャンプ: 積み上が詰まった時の縦ブースト（ネザー以外・自傷推定OK）
    if (!pillarAllowed && tactic?.mode === TACTIC_CLIMB && stuckTicks >= STUCK_STAGE_JIGGLE_TICKS &&
        config.crystalSurf !== false) {
      try { void tryAnchorJump(bot, config).catch(() => {}); } catch {}
    }
    if (tacticTryBridgeToward(bot, config, forwardDirection)) return { handled: true };
    if (moveTryMineBlock(bot, config, forwardDirection, target?.location)) return { handled: true };
  }

  // 段階6: 最後の手段としてTP
  if (moveTryEscapeTeleport(bot, config, target)) {
    debugLog(bot, config, "movement", `§c[脱出] 完全にスタックしたためTPで脱出 stuck=${stuckTicks}`, true);
    return { handled: true };
  }
  return { handled: false };
}

// ── Anti-float / falling ──
// applyImpulse({y:0}) を毎tick呼ぶと重力が打ち消されて空中に浮いたままになる。
// y成分は「必要な時だけ」加えるのが原則。ここでは落下が止まっている時のみ補助する。
function moveHandleAirborne(bot, runtime) {
  const velocity = getBotVelocity(bot);
  if (isBotOnGround(bot)) { runtime.airborneTicks = 0; return false; }
  runtime.airborneTicks = Number(runtime.airborneTicks ?? 0) + 1;
  // 落下しているなら物理に任せる
  if (velocity.y < -0.08) return true;
  // 上昇中(ジャンプ直後)も任せる
  if (velocity.y > 0.05 && runtime.airborneTicks < 12) return true;
  // 垂直速度がほぼ0で空中に留まっている = 浮遊バグ
  if (runtime.airborneTicks >= 3 && !isSimBot(bot)) {
    try { bot.applyImpulse({ x: 0, y: -0.28, z: 0 }); } catch {}
  }
  return true;
}

// ── Main Movement Handler ──
export function handleMovement(bot, target, config) {
  const runtime = getRuntime(config.uid);
  const { inWater, onGround } = moveGetSurfaceState(bot);

  // 周回方向の反転タイマー
  if (globalTick >= Number(runtime.nextStrafeFlipTick ?? 0)) {
    runtime.strafeDirection = Number(runtime.strafeDirection ?? 1) * -1;
    // 人間らしく揺らぎのある間隔にする
    runtime.nextStrafeFlipTick = globalTick + STRAFE_FLIP_INTERVAL + Math.floor(Math.random() * 10);
  }

  const isRecovering = patchIsRecoveryActive(bot, runtime, config);
  const tactic = evaluateCombatTactic(bot, target, config, { isRecovering });
  runtime.currentTacticMode = tactic.mode;

  const totalDistance = distance(bot.location, target.location);
  const targetEyeLocation = addVector(target.location, { x: 0, y: 1.1, z: 0 });

  // ── 視線 ──
  // [0.8.0] 弓・クロスボウ構え中は必ずその遠距離武器を握ったまま相手へ180度即時ロックオンする
  if (runtime.pendingRangedDraw) {
    if (runtime.rangedWeaponId) equipMainhandItem(bot, runtime.rangedWeaponId, config);
    const rangedAim = addVector(target.location, { x: 0, y: 1.35, z: 0 });
    faceBotToward(bot, rangedAim, 180);
  } else {
    // 常にターゲットを見る。ただし瞬間的にスナップせず、人間らしく追従させる。
    const inCombatRange = totalDistance <= SWORD_RANGE + 2.5;
    const configuredTurnSpeed = Number(config.lookTurnSpeed ?? LOOK_TURN_SPEED_COMBAT);
    const travelTurnSpeed = Math.max(6, configuredTurnSpeed * (LOOK_TURN_SPEED_TRAVEL / LOOK_TURN_SPEED_COMBAT));
    const turnSpeed = config.humanize
      ? (inCombatRange ? configuredTurnSpeed : travelTurnSpeed)
      : (configuredTurnSpeed >= 180 ? undefined : configuredTurnSpeed);
    const lookLocation = config.humanize ? patchApplyAimJitter(targetEyeLocation, config) : targetEyeLocation;
    faceBotToward(bot, lookLocation, turnSpeed);
  }

  // ── 空中処理 ──
  const airborne = moveHandleAirborne(bot, runtime);

  // ── 目標地点の決定 ──
  // [0.8.0] 1) 敵が投げたエンパの着地点予測 または 2) 空中浮上した敵の着地点予測 がある場合は最優先でその着地点へ先回りする
  let goal = tactic.goal;
  if (!isRecovering) {
    if (runtime.pearlInterceptGoal && globalTick <= Number(runtime.pearlInterceptUntilTick ?? 0)) {
      goal = runtime.pearlInterceptGoal;
    } else if (runtime.airInterceptGoal && globalTick <= Number(runtime.airInterceptUntilTick ?? 0)) {
      goal = runtime.airInterceptGoal;
    }
  }
  if (!goal) {
    // 戦術が目標を出せなかった場合はターゲット周辺の立てる場所へ
    goal = navFindStandableNear(bot.dimension, target.location, 3, 4);
  }

  // ── 経路探索 ──
  // [0.10.0] すでに空いている道・既存の階段・通路があるならそれを最優先で利用する！
  // 直線で段差なしに歩ける(directWalkable)時だけ直進し、壁や高低差がある場合は近距離(>1.8)でもA*経路を使って空いている道を通る。
  const heightDiffToGoal = goal ? Math.abs(goal.y - bot.location.y) : 0;
  const directWalkable = goal ? (heightDiffToGoal <= 1.1 && navHasWalkableLine(bot.dimension, bot.location, goal, 1, 2)) : false;
  const needsPath = config.pathfinding !== false && goal &&
    !directWalkable && (distance(bot.location, goal) > 1.8 || heightDiffToGoal > 1.1) &&
    tactic.mode !== TACTIC_ENGAGE;
  if (needsPath && moveShouldRepath(runtime, goal, config.uid)) {
    moveRequestPath(bot, runtime, goal, config);
  }
  if (directWalkable) runtime.navPath = undefined;

  const waypoint = moveConsumeWaypoint(bot, runtime);
  const steeringTargetLocation = waypoint ?? goal;

  // ── 進行方向 ──
  let forwardDirection = steeringTargetLocation
    ? normalize2D(vectorTo(bot.location, steeringTargetLocation))
    : normalize2D(vectorTo(bot.location, target.location));
  if (Math.abs(forwardDirection.x) < 0.0001 && Math.abs(forwardDirection.z) < 0.0001) {
    forwardDirection = normalize2D(vectorTo(bot.location, target.location));
  }
  // [0.10.0] 上に上がりたい時（段差登りやCLIMB戦術）は斜め移動ではなく直線4方向(cardinal)へ矯正する
  if ((tactic.mode === TACTIC_CLIMB || (waypoint && waypoint.y - bot.location.y >= 0.5)) && !directWalkable) {
    forwardDirection = navSnapToCardinal2D(forwardDirection);
  }

  // ── スタック判定と段階的脱出 ──
  const stuckTicks = moveUpdateStuckState(bot, runtime, forwardDirection);
  const escalation = moveHandleStuckEscalation(bot, config, target, stuckTicks, forwardDirection, tactic);
  if (escalation.handled) return;
  if (escalation.direction) forwardDirection = escalation.direction;

  // ── 速度ベクトルの構築 ──
  const desiredDistance = Number(tactic.desiredDistance ?? config.maintainDistance ?? 3);
  const distanceError = totalDistance - desiredDistance;
  const baseSpeed = inWater ? MOVE_SPEED_WATER
    : tactic.mode === TACTIC_KITE ? MOVE_SPEED_RETREAT
    : tactic.sprint ? MOVE_SPEED_SPRINT
    : MOVE_SPEED_WALK;

  let desiredVelocity = { x: 0, z: 0 };

  if (tactic.mode === TACTIC_ENGAGE && Math.abs(distanceError) <= TACTIC_ORBIT_DISTANCE_TOLERANCE) {
    // 維持距離が取れている → 横移動(ストレイフ)主体
    const toTarget = normalize2D(vectorTo(bot.location, target.location));
    const strafeVector = { x: -toTarget.z * Number(runtime.strafeDirection ?? 1), z: toTarget.x * Number(runtime.strafeDirection ?? 1) };
    const strafeSpeed = config.strafeMove === false ? 0 : MOVE_SPEED_STRAFE;
    desiredVelocity.x = strafeVector.x * strafeSpeed;
    desiredVelocity.z = strafeVector.z * strafeSpeed;
    // 微小な距離補正を足す
    desiredVelocity.x += toTarget.x * distanceError * 0.05;
    desiredVelocity.z += toTarget.z * distanceError * 0.05;
  } else if (tactic.mode === TACTIC_KITE) {
    desiredVelocity.x = forwardDirection.x * baseSpeed;
    desiredVelocity.z = forwardDirection.z * baseSpeed;
  } else if (distanceError < -0.35 && tactic.mode !== TACTIC_CLIMB && tactic.mode !== TACTIC_DESCEND) {
    // 近すぎる → 後退しつつ横に流れる（棒立ちにならない）
    const away = normalize2D(vectorTo(target.location, bot.location));
    const side = { x: -away.z * Number(runtime.strafeDirection ?? 1), z: away.x * Number(runtime.strafeDirection ?? 1) };
    desiredVelocity.x = away.x * MOVE_SPEED_WALK * 0.85 + side.x * MOVE_SPEED_STRAFE * 0.6;
    desiredVelocity.z = away.z * MOVE_SPEED_WALK * 0.85 + side.z * MOVE_SPEED_STRAFE * 0.6;
  } else {
    desiredVelocity.x = forwardDirection.x * baseSpeed;
    desiredVelocity.z = forwardDirection.z * baseSpeed;
    // 直線的すぎない移動にするため、接近中もわずかに横成分を混ぜる
    if (config.strafeMove !== false && tactic.mode === TACTIC_CLOSE_GAP && totalDistance < 8) {
      const side = { x: -forwardDirection.z, z: forwardDirection.x };
      const weave = Math.sin(globalTick * 0.18) * 0.35 * Number(runtime.strafeDirection ?? 1);
      desiredVelocity.x += side.x * baseSpeed * weave;
      desiredVelocity.z += side.z * baseSpeed * weave;
    }
  }

  // ── 境界からの回避（TPではなく操舵で戻す） ──
  const boundaryPush = moveComputeBoundaryAvoidance(bot);
  if (boundaryPush) {
    desiredVelocity.x += boundaryPush.x * MOVE_SPEED_WALK * 1.2;
    desiredVelocity.z += boundaryPush.z * MOVE_SPEED_WALK * 1.2;
  }

  // ── 崖の安全確認 ──
  // 回復中や落下ダメージが致命的な時は飛び降りない。
  const movementDirection = normalize2D({ x: desiredVelocity.x, y: 0, z: desiredVelocity.z });
  const wantsToDive = tactic.mode === TACTIC_DESCEND;
  if (!wantsToDive && onGround && Math.hypot(desiredVelocity.x, desiredVelocity.z) > 0.02) {
    const allowedDrop = isRecovering ? 2.5 : Math.max(3, patchGetCurrentHealthValue(bot) * 0.45);
    if (tacticIsDangerousLedge(bot, movementDirection, allowedDrop)) {
      // 崖 → 横にスライドして回避
      const side = { x: -movementDirection.z, z: movementDirection.x };
      const slideDirection = tacticIsDangerousLedge(bot, { x: side.x, y: 0, z: side.z }, allowedDrop)
        ? { x: -side.x, z: -side.z } : side;
      desiredVelocity.x = slideDirection.x * MOVE_SPEED_WALK;
      desiredVelocity.z = slideDirection.z * MOVE_SPEED_WALK;
      runtime.navPath = undefined;
      // 橋を架けられるなら架ける
      if (tactic.mode === TACTIC_CLOSE_GAP) tacticTryBridgeToward(bot, config, movementDirection);
    }
  }

  // ── ジャンプ判定 ──
  if (tactic.allowJump !== false && onGround && !inWater) {
    const needsWaypointJump = waypoint && moveNeedsJumpForWaypoint(bot, waypoint);
    const needsStepJump = moveHasStepObstacle(bot, movementDirection);
    if (needsWaypointJump || needsStepJump) {
      moveTryJump(bot, runtime, config, MOVE_SPRINT_JUMP_BONUS, movementDirection);
    } else if (tactic.mode === TACTIC_CLIMB && waypoint && waypoint.y - bot.location.y > 0.2) {
      moveTryJump(bot, runtime, config, MOVE_SPRINT_JUMP_BONUS * 0.6, movementDirection);
    } else if (config.jumpDash !== false && tactic.sprint && totalDistance > desiredDistance + 1.5 &&
               globalTick - Number(runtime.lastJumpTick ?? -9999) > MOVE_JUMP_COOLDOWN_TICKS * 2 &&
               patchRandomChance(18)) {
      // 人間らしいジャンプダッシュ(常時ではなく確率的に)
      moveTryJump(bot, runtime, config, MOVE_SPRINT_JUMP_BONUS, movementDirection);
    }
  }

  // ── [C-2] クリスタルサーフィン（回復中の高速離脱）──
  // 実戦の移動技術: 自爆のノックバックで逃げる。ダメージはエンジン計算そのまま。
  if (tactic.mode === TACTIC_KITE && !inWater && onGround && config.crystalSurf !== false) {
    try { void tryCrystalSurf(bot, config, forwardDirection).catch(() => {}); } catch {}
  }

  // ── 登れない壁 → 柱を立てて登る ──
  // [B-7] 旧実装は「ターゲットの真下にいるほど即座に柱を積む」だったが、これは
  // 実戦メタ（低位有利）と真逆の自滅行動。射程内では交戦を優先し、柱は射程外の
  // 遠方の高所への到達手段としてのみ許可する。
  const horizontalToTarget2 = Math.hypot(target.location.x - bot.location.x, target.location.z - bot.location.z);
  const isDirectlyBelowTarget = horizontalToTarget2 <= 1.8;
  const pillarReachable = horizontalToTarget2 > 4.5; // 爆発干渉距離 (F-4) 外のみ柱を許可
  if (tactic.mode === TACTIC_CLIMB && onGround && pillarReachable &&
      target.location.y - bot.location.y >= 2.2 &&
      (!runtime.navPath || !runtime.navPath.length) &&
      (isDirectlyBelowTarget || stuckTicks >= STUCK_STAGE_JIGGLE_TICKS)) {
    if (tacticTryPillarUp(bot, config, target)) {
      moveTryJump(bot, runtime, config);
      return;
    }
  } else if (tactic.mode !== TACTIC_CLIMB) {
    runtime.pillarHeightGain = 0;
  }

  // ── 操舵の適用 ──
  const maxAccel = onGround ? MOVE_MAX_ACCEL_GROUND : MOVE_MAX_ACCEL_AIR;
  applyHorizontalSteering(bot, desiredVelocity, { maxAccel });

  // 歩行アニメーション
  if (onGround && Math.hypot(desiredVelocity.x, desiredVelocity.z) > 0.04 && globalTick % 6 === 0) {
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.walk");
  }

  // ── 最終安全網 ──
  // 境界を大きく外れた・地面が無い等の異常時のみ teleport を使う。
  if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(bot.location)) {
    const safe = findSafeBoundaryReturnLocation(bot);
    try { bot.teleport(safe, { dimension: bot.dimension, keepVelocity: false }); } catch {}
    runtime.navPath = undefined;
    return;
  }
  // 20ブロック以上落下し続けている(地形が消えた等)場合の救出
  if (!onGround && Number(runtime.airborneTicks ?? 0) > 80) {
    const ground = navFindGroundY(bot.dimension, bot.location, 40);
    if (ground === undefined) {
      moveTryEscapeTeleport(bot, config, target);
      runtime.airborneTicks = 0;
    }
  }
}
