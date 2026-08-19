import {
  world, system, CONFIG_PROPERTY_ID, GLOBAL_SETTINGS_PROPERTY_ID,
  BOT_TYPE, BOT_UID_TAG_PREFIX, BOT_CONFIG_TAG_PREFIX,
  MAX_TARGET_DISTANCE, PATCH_DIFFICULTY_PRESETS,
} from "./constants.js";
import {
  botConfigs, runtimeState, globalSettings, setGlobalSettings,
} from "./state.js";
import {
  safeGetDynamicProperty, safeSetDynamicProperty,
  getBotUid, formatError, logSystem,
} from "./utils.js";

// ── Runtime State ──
export function getRuntime(uid) {
  if (!uid) return createRuntimeState();
  if (runtimeState.has(uid)) return runtimeState.get(uid);
  const state = createRuntimeState();
  runtimeState.set(uid, state);
  return state;
}

function createRuntimeState() {
  return {
    lastSwordTick: -9999, lastCrystalTick: -9999, lastAnchorTick: -9999,
    lastPearlTick: -9999, lastRetreatPearlTick: -9999, lastHealTick: -9999,
    lastRetreatPearlSearchTick: -9999, recoveryUntilTick: -9999,
    lastTotemPopTick: -9999, lastLoadoutSyncTick: -9999,
    lastFoodTick: -9999, lastJumpDashTick: -9999,
    lastSeenTick: -9999, lastNoTargetLogTick: -9999,
    lastTargetId: "", pendingAnchor: undefined, pendingCrystal: undefined,
    pendingPearlToken: "", strafeDirection: 1, nextStrafeFlipTick: 0,
    stuckTicks: 0, lastMovementLocation: undefined,
    jumpDashAirborneUntilTick: -9999, lastBuildStepTick: -9999,
    hadTotemLastTick: false, totemShieldUntilTick: -9999,
    selectedSword: undefined, selectedArmorBySlot: {},
    selectedOffhand: undefined, visualMainhand: undefined,
    visualOffhand: undefined, lastVisualEquipmentSignature: "",
    lastVisualEquipmentSyncTick: -9999,
    spawnTick: -9999, isConfiguring: false,
    lastKnownHealth: 20, lastRecoveryLogHealth: 20, ownerSyncBaseCounts: {},
    ownerSyncInitialized: false, customBudgetInitialized: false,
    foodAbsorptionUntilTick: -9999, foodRegenUntilTick: -9999,
    foodResistanceUntilTick: -9999, foodFireResistanceUntilTick: -9999,
    forceRecoveryFoodUntilTick: -9999,
    // ── Movement v2 runtime ──
    navPath: undefined, navLastPathTick: -9999, navGoalKey: "", navSlotOffset: undefined,
    navLastPathFailed: false, navPathComplete: false,
    airborneTicks: 0, lastJumpTick: -9999,
    detourDirection: undefined, detourUntilTick: -9999,
    pillarHeightGain: 0, pillarJumpPending: false, bridgeBlockCount: 0,
    lastBlockPlaceTick: -9999, miningUntilTick: -9999,
    highGroundGoal: undefined, highGroundUntilTick: -9999,
    lastHighGroundSearchTick: -9999, currentTacticMode: "",
    lastEscapeTeleportTick: -9999,
  };
}

// ── Default Config ──
function createBotUid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getBotIdentityText(uid) {
  const raw = `${uid ?? ""}`;
  const suffixSource = raw.split("-").filter(Boolean).pop() ?? raw;
  const suffix = suffixSource.replace(/[^0-9a-z]/gi, "").slice(-6).toUpperCase();
  return `BOT-${suffix || "000000"}`;
}

export function getDefaultBotDisplayName(uid) {
  return `Crystal Bot ${getBotIdentityText(uid)}`;
}

function shouldUseGeneratedDisplayName(displayName) {
  const value = `${displayName ?? ""}`.trim();
  return !value || value === "Crystal Bot";
}

export function createDefaultConfig(uid) {
  return {
    uid, enabled: true, displayName: getDefaultBotDisplayName(uid),
    ownerName: "", targetRange: MAX_TARGET_DISTANCE,
    maintainDistance: 3, swordCombo: true, crystalCombo: true,
    anchorCombo: true, anchorBreakCache: true,
    swordCooldown: 15, crystalCooldown: 15, crystalDetonateDelay: 3,
    anchorCooldown: 15, anchorDetonateDelay: 3,
    autoTotem: true, totemRefillDelay: 0,
    recoveryEnabled: true,
    pearlMove: true, pearlRecover: true, pearlDistance: 10, pearlCooldown: 40,
    mirrorOwnerLoadout: true, jumpDash: true, strafeMove: true,
    humanize: false, reactionDelay: 0, aimJitter: 0,
    mistakeRate: 0, suboptimalRate: 0,
    tickInterval: 1, unbreakableEquipment: true,
    ignoreSelfDamage: false, targetMobs: false, targetBots: false,
    supplyChestDimensionKey: "", supplyChestX: 0, supplyChestY: 0, supplyChestZ: 0,
    inventoryMode: "auto_refill", customItemCounts: {},
    difficultyPreset: "normal",
    enableMining: true, mineStuckTicksThreshold: 10, eatWhenCornered: true,
    pathfinding: true, blockPlacing: true, highGroundTactic: true,
    escapeTeleport: true, lookTurnSpeed: 42,
    debug: { enabled: false, movement: false, scan: false, combat: false, health: false, totem: false, loadout: false, inventory: false },
  };
}

// ── Normalize / Validate ──
export function normalizeConfig(config) {
  const defaults = createDefaultConfig(config?.uid ?? "");
  return {
    ...defaults,
    ...config,
    uid: config?.uid ?? defaults.uid,
    enabled: config?.enabled ?? defaults.enabled,
    displayName: config?.displayName ?? defaults.displayName,
    ownerName: config?.ownerName ?? defaults.ownerName,
    targetRange: Math.max(4, Math.min(128, Number(config?.targetRange ?? defaults.targetRange))),
    maintainDistance: Math.max(1, Math.min(6, Number(config?.maintainDistance ?? defaults.maintainDistance))),
    recoveryEnabled: config?.recoveryEnabled ?? defaults.recoveryEnabled,
    swordCooldown: Math.max(0, Math.min(25, Number(config?.swordCooldown ?? defaults.swordCooldown))),
    crystalCooldown: Math.max(0, Math.min(25, Number(config?.crystalCooldown ?? defaults.crystalCooldown))),
    crystalDetonateDelay: Math.max(0, Math.min(10, Number(config?.crystalDetonateDelay ?? defaults.crystalDetonateDelay))),
    anchorCooldown: Math.max(0, Math.min(25, Number(config?.anchorCooldown ?? defaults.anchorCooldown))),
    anchorDetonateDelay: Math.max(0, Math.min(10, Number(config?.anchorDetonateDelay ?? defaults.anchorDetonateDelay))),
    totemRefillDelay: Math.max(0, Math.min(60, Number(config?.totemRefillDelay ?? defaults.totemRefillDelay))),
    pearlDistance: Math.max(8, Math.min(16, Number(config?.pearlDistance ?? defaults.pearlDistance))),
    pearlCooldown: Math.max(0, Math.min(80, Number(config?.pearlCooldown ?? defaults.pearlCooldown))),
    pearlMove: config?.pearlMove ?? defaults.pearlMove,
    pearlRecover: config?.pearlRecover ?? defaults.pearlRecover,
    swordCombo: config?.swordCombo ?? defaults.swordCombo,
    crystalCombo: config?.crystalCombo ?? defaults.crystalCombo,
    ignoreSelfDamage: config?.ignoreSelfDamage ?? defaults.ignoreSelfDamage,
    anchorCombo: config?.anchorCombo ?? defaults.anchorCombo,
    anchorBreakCache: config?.anchorBreakCache ?? defaults.anchorBreakCache,
    eatWhenCornered: config?.eatWhenCornered ?? defaults.eatWhenCornered,
    humanize: config?.humanize ?? defaults.humanize,
    reactionDelay: Math.max(0, Math.min(12, Number(config?.reactionDelay ?? defaults.reactionDelay))),
    aimJitter: Math.max(0, Math.min(0.3, Number(config?.aimJitter ?? defaults.aimJitter))),
    mistakeRate: Math.max(0, Math.min(30, Number(config?.mistakeRate ?? defaults.mistakeRate))),
    suboptimalRate: Math.max(0, Math.min(60, Number(config?.suboptimalRate ?? defaults.suboptimalRate))),
    unbreakableEquipment: config?.unbreakableEquipment ?? defaults.unbreakableEquipment,
    tickInterval: Math.max(1, Math.min(4, Math.floor(Number(config?.tickInterval ?? defaults.tickInterval)))),
    targetMobs: config?.targetMobs ?? defaults.targetMobs,
    targetBots: config?.targetBots ?? defaults.targetBots,
    enableMining: config?.enableMining ?? defaults.enableMining,
    mineStuckTicksThreshold: Math.max(0, Math.min(120, Number(config?.mineStuckTicksThreshold ?? defaults.mineStuckTicksThreshold))),
    pathfinding: config?.pathfinding ?? defaults.pathfinding,
    blockPlacing: config?.blockPlacing ?? defaults.blockPlacing,
    highGroundTactic: config?.highGroundTactic ?? defaults.highGroundTactic,
    escapeTeleport: config?.escapeTeleport ?? defaults.escapeTeleport,
    lookTurnSpeed: Math.max(6, Math.min(180, Number(config?.lookTurnSpeed ?? defaults.lookTurnSpeed))),
    debug: {
      enabled: config?.debug?.enabled ?? defaults.debug.enabled,
      movement: config?.debug?.movement ?? defaults.debug.movement,
      scan: config?.debug?.scan ?? defaults.debug.scan,
      combat: config?.debug?.combat ?? defaults.debug.combat,
      health: config?.debug?.health ?? defaults.debug.health,
      totem: config?.debug?.totem ?? defaults.debug.totem,
      loadout: config?.debug?.loadout ?? defaults.debug.loadout,
      inventory: config?.debug?.inventory ?? defaults.debug.inventory,
    }
  };
}

// ── Persistence ──
function configToTag(config) {
  const data = {
    ownerName: config.ownerName,
    enabled: config.enabled ? "1" : "0",
    maintainDistance: config.maintainDistance.toString(),
    targetRange: config.targetRange.toString(),
    targetMobs: config.targetMobs ? "1" : "0",
    targetBots: config.targetBots ? "1" : "0",
    jumpDash: config.jumpDash ? "1" : "0",
    strafeMove: config.strafeMove ? "1" : "0",
    enableMining: config.enableMining ? "1" : "0",
    mineStuckTicksThreshold: config.mineStuckTicksThreshold.toString(),
    inventoryMode: config.inventoryMode,
    mirrorOwnerLoadout: config.mirrorOwnerLoadout ? "1" : "0",
    customItemCounts: JSON.stringify(config.customItemCounts ?? {}),
    autoTotem: config.autoTotem ? "1" : "0",
    recoveryEnabled: config.recoveryEnabled ? "1" : "0",
    totemRefillDelay: config.totemRefillDelay.toString(),
    pearlMove: config.pearlMove ? "1" : "0",
    pearlRecover: config.pearlRecover ? "1" : "0",
    pearlDistance: config.pearlDistance.toString(),
    pearlCooldown: config.pearlCooldown.toString(),
    swordCombo: config.swordCombo ? "1" : "0",
    swordCooldown: config.swordCooldown.toString(),
    crystalCombo: config.crystalCombo ? "1" : "0",
    crystalCooldown: config.crystalCooldown.toString(),
    crystalDetonateDelay: config.crystalDetonateDelay.toString(),
    ignoreSelfDamage: config.ignoreSelfDamage ? "1" : "0",
    anchorCombo: config.anchorCombo ? "1" : "0",
    anchorCooldown: config.anchorCooldown.toString(),
    anchorDetonateDelay: config.anchorDetonateDelay.toString(),
    anchorBreakCache: config.anchorBreakCache ? "1" : "0",
    eatWhenCornered: config.eatWhenCornered ? "1" : "0",
    humanize: config.humanize ? "1" : "0",
    reactionDelay: config.reactionDelay.toString(),
    aimJitter: config.aimJitter.toString(),
    mistakeRate: config.mistakeRate.toString(),
    suboptimalRate: config.suboptimalRate.toString(),
    unbreakableEquipment: config.unbreakableEquipment ? "1" : "0",
    tickInterval: config.tickInterval.toString(),
    debugEnabled: config.debug.enabled ? "1" : "0",
    debugMovement: config.debug.movement ? "1" : "0",
    debugScan: config.debug.scan ? "1" : "0",
    debugCombat: config.debug.combat ? "1" : "0",
    debugHealth: config.debug.health ? "1" : "0",
    debugTotem: config.debug.totem ? "1" : "0",
    debugLoadout: config.debug.loadout ? "1" : "0",
    debugInventory: config.debug.inventory ? "1" : "0",
  };
  return `${BOT_CONFIG_TAG_PREFIX}${JSON.stringify(data)}`;
}

function tagToConfig(tagStr, uid, bot) {
  const jsonStr = tagStr.slice(BOT_CONFIG_TAG_PREFIX.length);
  try {
    const tagged = JSON.parse(jsonStr);
    const saved = bot ? safeGetDynamicProperty(bot, "pvpbot:config_v3") : null;
    return materializeConfig({
      uid,
      displayName: bot?.nameTag,
      ownerName: tagged.ownerName || saved?.ownerName || "",
      enabled: tagged.enabled === undefined ? saved?.enabled : tagged.enabled === "1",
      maintainDistance: parseInt(tagged.maintainDistance) || saved?.maintainDistance || 3,
      targetRange: parseInt(tagged.targetRange) || saved?.targetRange || MAX_TARGET_DISTANCE,
      targetMobs: tagged.targetMobs === undefined ? saved?.targetMobs : tagged.targetMobs === "1",
      targetBots: tagged.targetBots === undefined ? saved?.targetBots : tagged.targetBots === "1",
      jumpDash: tagged.jumpDash === undefined ? saved?.jumpDash : tagged.jumpDash === "1",
      strafeMove: tagged.strafeMove === undefined ? saved?.strafeMove : tagged.strafeMove === "1",
      enableMining: tagged.enableMining === undefined ? saved?.enableMining : tagged.enableMining === "1",
      mineStuckTicksThreshold: parseInt(tagged.mineStuckTicksThreshold) || saved?.mineStuckTicksThreshold || 40,
      inventoryMode: tagged.inventoryMode || saved?.inventoryMode || "auto_refill",
      mirrorOwnerLoadout: tagged.mirrorOwnerLoadout === undefined ? saved?.mirrorOwnerLoadout : tagged.mirrorOwnerLoadout === "1",
      customItemCounts: tagged.customItemCounts ? JSON.parse(tagged.customItemCounts) : saved?.customItemCounts || {},
      autoTotem: tagged.autoTotem === undefined ? saved?.autoTotem : tagged.autoTotem === "1",
      recoveryEnabled: tagged.recoveryEnabled === undefined ? saved?.recoveryEnabled : tagged.recoveryEnabled === "1",
      totemRefillDelay: parseInt(tagged.totemRefillDelay) || saved?.totemRefillDelay || 0,
      pearlMove: tagged.pearlMove === undefined ? saved?.pearlMove : tagged.pearlMove === "1",
      pearlRecover: tagged.pearlRecover === undefined ? saved?.pearlRecover : tagged.pearlRecover === "1",
      pearlDistance: parseInt(tagged.pearlDistance) || saved?.pearlDistance || 10,
      pearlCooldown: parseInt(tagged.pearlCooldown) || saved?.pearlCooldown || 40,
      swordCombo: tagged.swordCombo === undefined ? saved?.swordCombo : tagged.swordCombo === "1",
      swordCooldown: parseInt(tagged.swordCooldown) || saved?.swordCooldown || 0,
      crystalCombo: tagged.crystalCombo === undefined ? saved?.crystalCombo : tagged.crystalCombo === "1",
      crystalCooldown: parseInt(tagged.crystalCooldown) || saved?.crystalCooldown || 0,
      crystalDetonateDelay: parseInt(tagged.crystalDetonateDelay) || saved?.crystalDetonateDelay || 0,
      ignoreSelfDamage: tagged.ignoreSelfDamage === undefined ? saved?.ignoreSelfDamage : tagged.ignoreSelfDamage === "1",
      anchorCombo: tagged.anchorCombo === undefined ? saved?.anchorCombo : tagged.anchorCombo === "1",
      anchorCooldown: parseInt(tagged.anchorCooldown) || saved?.anchorCooldown || 0,
      anchorDetonateDelay: parseInt(tagged.anchorDetonateDelay) || saved?.anchorDetonateDelay || 0,
      anchorBreakCache: tagged.anchorBreakCache === undefined ? saved?.anchorBreakCache : tagged.anchorBreakCache === "1",
      eatWhenCornered: tagged.eatWhenCornered === undefined ? saved?.eatWhenCornered : tagged.eatWhenCornered === "1",
      humanize: tagged.humanize === undefined ? saved?.humanize : tagged.humanize === "1",
      reactionDelay: parseInt(tagged.reactionDelay) || saved?.reactionDelay || 0,
      aimJitter: parseFloat(tagged.aimJitter) || saved?.aimJitter || 0,
      mistakeRate: parseInt(tagged.mistakeRate) || saved?.mistakeRate || 0,
      suboptimalRate: parseInt(tagged.suboptimalRate) || saved?.suboptimalRate || 0,
      unbreakableEquipment: tagged.unbreakableEquipment === undefined ? saved?.unbreakableEquipment : tagged.unbreakableEquipment === "1",
      tickInterval: parseInt(tagged.tickInterval) || saved?.tickInterval || 1,
      debug: {
        enabled: tagged.debugEnabled === "1",
        movement: tagged.debugMovement === "1",
        scan: tagged.debugScan === "1",
        combat: tagged.debugCombat === "1",
        health: tagged.debugHealth === "1",
        totem: tagged.debugTotem === "1",
        loadout: tagged.debugLoadout === "1",
        inventory: tagged.debugInventory === "1",
      }
    }, uid);
  } catch (e) {
    return materializeConfig({ uid }, uid);
  }
}

export function normalizeGlobalSettings(settings) {
  // Parse raw inputs first, then auto-swap min/max so that min <= max.
  // Without this, if the user accidentally enters Min Y=36 / Max Y=-60,
  // the bot gets clamped to a single point and frozen forever.
  const rawMinX = Number(settings?.boundaryMinX ?? -49);
  const rawMaxX = Number(settings?.boundaryMaxX ?? 49);
  const rawMinY = Number(settings?.boundaryMinY ?? -60);
  const rawMaxY = Number(settings?.boundaryMaxY ?? 38);
  const rawMinZ = Number(settings?.boundaryMinZ ?? 115);
  const rawMaxZ = Number(settings?.boundaryMaxZ ?? 199);
  return {
    boundaryEnabled: settings?.boundaryEnabled ?? true,
    boundaryMinX: Math.min(rawMinX, rawMaxX),
    boundaryMaxX: Math.max(rawMinX, rawMaxX),
    boundaryMinY: Math.min(rawMinY, rawMaxY),
    boundaryMaxY: Math.max(rawMinY, rawMaxY),
    boundaryMinZ: Math.min(rawMinZ, rawMaxZ),
    boundaryMaxZ: Math.max(rawMinZ, rawMaxZ),
  };
}

// ── Tag I/O ──
export function readConfigFromTags(entity) {
  const tagged = {};
  try {
    for (const tag of entity.getTags()) {
      if (!tag.startsWith(BOT_CONFIG_TAG_PREFIX)) continue;
      const content = tag.slice(BOT_CONFIG_TAG_PREFIX.length);
      const eqIndex = content.indexOf("=");
      if (eqIndex < 0) continue;
      tagged[content.slice(0, eqIndex)] = content.slice(eqIndex + 1);
    }
  } catch {}
  return tagged;
}

export function writeConfigTags(bot, config) {
  try {
    const toRemove = [];
    for (const tag of bot.getTags()) {
      if (tag.startsWith(BOT_CONFIG_TAG_PREFIX)) toRemove.push(tag);
    }
    for (const tag of toRemove) { try { bot.removeTag(tag); } catch {} }
  } catch {}

  const entries = {
    enabled: config.enabled ? "1" : "0",
    displayName: config.displayName ?? "",
    ownerName: config.ownerName ?? "",
    targetRange: `${config.targetRange ?? MAX_TARGET_DISTANCE}`,
    maintainDistance: `${config.maintainDistance ?? 3}`,
    swordCombo: config.swordCombo ? "1" : "0",
    crystalCombo: config.crystalCombo ? "1" : "0",
    anchorCombo: config.anchorCombo ? "1" : "0",
    anchorBreakCache: (config.anchorBreakCache ?? true) ? "1" : "0",
    swordCooldown: `${config.swordCooldown ?? 15}`,
    crystalCooldown: `${config.crystalCooldown ?? 15}`,
    crystalDetonateDelay: `${config.crystalDetonateDelay ?? 3}`,
    anchorCooldown: `${config.anchorCooldown ?? 15}`,
    anchorDetonateDelay: `${config.anchorDetonateDelay ?? 3}`,
    autoTotem: config.autoTotem ? "1" : "0",
    totemRefillDelay: `${config.totemRefillDelay ?? 0}`,
    recoveryEnabled: (config.recoveryEnabled ?? true) ? "1" : "0",
    pearlMove: config.pearlMove ? "1" : "0",
    pearlRecover: config.pearlRecover ? "1" : "0",
    pearlDistance: `${config.pearlDistance ?? 10}`,
    pearlCooldown: `${config.pearlCooldown ?? 40}`,
    mirrorOwnerLoadout: config.mirrorOwnerLoadout ? "1" : "0",
    jumpDash: config.jumpDash ? "1" : "0",
    strafeMove: config.strafeMove ? "1" : "0",
    humanize: config.humanize ? "1" : "0",
    reactionDelay: `${config.reactionDelay ?? 0}`,
    aimJitter: `${config.aimJitter ?? 0}`,
    mistakeRate: `${config.mistakeRate ?? 0}`,
    suboptimalRate: `${config.suboptimalRate ?? 0}`,
    tickInterval: `${config.tickInterval ?? 1}`,
    unbreakableEquipment: (config.unbreakableEquipment ?? true) ? "1" : "0",
    ignoreSelfDamage: config.ignoreSelfDamage ? "1" : "0",
    targetMobs: config.targetMobs ? "1" : "0",
    targetBots: config.targetBots ? "1" : "0",
    supplyChestDimensionKey: config.supplyChestDimensionKey ?? "",
    supplyChestX: `${config.supplyChestX ?? 0}`,
    supplyChestY: `${config.supplyChestY ?? 0}`,
    supplyChestZ: `${config.supplyChestZ ?? 0}`,
    inventoryMode: config.inventoryMode ?? "auto_refill",
    customItemCounts: JSON.stringify(config.customItemCounts ?? {}),
    difficultyPreset: config.difficultyPreset ?? "normal",
    enableMining: config.enableMining ? "1" : "0",
    mineStuckTicksThreshold: `${config.mineStuckTicksThreshold ?? 40}`,
    eatWhenCornered: config.eatWhenCornered ? "1" : "0",
    pathfinding: (config.pathfinding ?? true) ? "1" : "0",
    blockPlacing: (config.blockPlacing ?? true) ? "1" : "0",
    highGroundTactic: (config.highGroundTactic ?? true) ? "1" : "0",
    escapeTeleport: (config.escapeTeleport ?? true) ? "1" : "0",
    lookTurnSpeed: `${config.lookTurnSpeed ?? 42}`,
    debugEnabled: config.debug?.enabled ? "1" : "0",
    debugMovement: config.debug?.movement ? "1" : "0",
    debugScan: config.debug?.scan ? "1" : "0",
    debugCombat: config.debug?.combat ? "1" : "0",
    debugHealth: config.debug?.health ? "1" : "0",
    debugTotem: config.debug?.totem ? "1" : "0",
    debugLoadout: config.debug?.loadout ? "1" : "0",
    debugInventory: config.debug?.inventory ? "1" : "0",
  };

  for (const [key, value] of Object.entries(entries)) {
    try { bot.addTag(`${BOT_CONFIG_TAG_PREFIX}${key}=${value}`); } catch {}
  }
}

// ── Materialize ──
export function materializeConfig(bot, owner) {
  let uid = getBotUid(bot);
  if (!uid) {
    uid = createBotUid();
    try { bot.addTag(`${BOT_UID_TAG_PREFIX}${uid}`); } catch {}
  }
  const saved = botConfigs[uid];
  const tagged = readConfigFromTags(bot);
  const configuredDisplayName = tagged.displayName ?? saved?.displayName;
  const config = normalizeConfig({
    uid,
    enabled: tagged.enabled === undefined ? saved?.enabled : tagged.enabled === "1",
    displayName: shouldUseGeneratedDisplayName(configuredDisplayName) ? getDefaultBotDisplayName(uid) : configuredDisplayName,
    ownerName: tagged.ownerName || saved?.ownerName || owner?.name || "",
    targetRange: Number(tagged.targetRange ?? saved?.targetRange ?? MAX_TARGET_DISTANCE),
    maintainDistance: Number(tagged.maintainDistance ?? saved?.maintainDistance ?? 3),
    swordCombo: tagged.swordCombo === undefined ? saved?.swordCombo : tagged.swordCombo === "1",
    crystalCombo: tagged.crystalCombo === undefined ? saved?.crystalCombo : tagged.crystalCombo === "1",
    anchorCombo: tagged.anchorCombo === undefined ? saved?.anchorCombo : tagged.anchorCombo === "1",
    anchorBreakCache: tagged.anchorBreakCache === undefined ? (saved?.anchorBreakCache ?? true) : tagged.anchorBreakCache === "1",
    swordCooldown: Number(tagged.swordCooldown ?? saved?.swordCooldown ?? 15),
    crystalCooldown: Number(tagged.crystalCooldown ?? saved?.crystalCooldown ?? 15),
    crystalDetonateDelay: Number(tagged.crystalDetonateDelay ?? saved?.crystalDetonateDelay ?? 3),
    anchorCooldown: Number(tagged.anchorCooldown ?? saved?.anchorCooldown ?? 15),
    anchorDetonateDelay: Number(tagged.anchorDetonateDelay ?? saved?.anchorDetonateDelay ?? 3),
    autoTotem: tagged.autoTotem === undefined ? saved?.autoTotem : tagged.autoTotem === "1",
    totemRefillDelay: Number(tagged.totemRefillDelay ?? saved?.totemRefillDelay ?? 0),
    recoveryEnabled: tagged.recoveryEnabled === undefined ? (saved?.recoveryEnabled ?? true) : tagged.recoveryEnabled === "1",
    pearlMove: tagged.pearlMove === undefined ? saved?.pearlMove : tagged.pearlMove === "1",
    pearlRecover: tagged.pearlRecover === undefined ? saved?.pearlRecover : tagged.pearlRecover === "1",
    pearlDistance: Number(tagged.pearlDistance ?? saved?.pearlDistance ?? 10),
    pearlCooldown: Number(tagged.pearlCooldown ?? saved?.pearlCooldown ?? 40),
    mirrorOwnerLoadout: tagged.mirrorOwnerLoadout === undefined ? saved?.mirrorOwnerLoadout : tagged.mirrorOwnerLoadout === "1",
    jumpDash: tagged.jumpDash === undefined ? saved?.jumpDash : tagged.jumpDash === "1",
    strafeMove: tagged.strafeMove === undefined ? (saved?.strafeMove ?? true) : tagged.strafeMove === "1",
    humanize: tagged.humanize === undefined ? saved?.humanize : tagged.humanize === "1",
    reactionDelay: Number(tagged.reactionDelay ?? saved?.reactionDelay ?? 0),
    aimJitter: Number(tagged.aimJitter ?? saved?.aimJitter ?? 0),
    mistakeRate: Number(tagged.mistakeRate ?? saved?.mistakeRate ?? 0),
    suboptimalRate: Number(tagged.suboptimalRate ?? saved?.suboptimalRate ?? 0),
    tickInterval: Number(tagged.tickInterval ?? saved?.tickInterval ?? 1),
    unbreakableEquipment: tagged.unbreakableEquipment === undefined ? (saved?.unbreakableEquipment ?? true) : tagged.unbreakableEquipment === "1",
    ignoreSelfDamage: tagged.ignoreSelfDamage === undefined ? saved?.ignoreSelfDamage : tagged.ignoreSelfDamage === "1",
    supplyChestDimensionKey: tagged.supplyChestDimensionKey ?? saved?.supplyChestDimensionKey ?? "",
    supplyChestX: Number(tagged.supplyChestX ?? saved?.supplyChestX),
    supplyChestY: Number(tagged.supplyChestY ?? saved?.supplyChestY),
    supplyChestZ: Number(tagged.supplyChestZ ?? saved?.supplyChestZ),
    inventoryMode: tagged.inventoryMode ?? saved?.inventoryMode ?? "auto_refill",
    customItemCounts: (() => { try { return JSON.parse(tagged.customItemCounts ?? saved?.customItemCounts ?? "{}"); } catch { return {}; } })(),
    difficultyPreset: tagged.difficultyPreset ?? saved?.difficultyPreset ?? "normal",
    targetMobs: tagged.targetMobs === undefined ? (saved?.targetMobs ?? false) : tagged.targetMobs === "1",
    targetBots: tagged.targetBots === undefined ? (saved?.targetBots ?? false) : tagged.targetBots === "1",
    enableMining: tagged.enableMining === undefined ? (saved?.enableMining ?? true) : tagged.enableMining === "1",
    mineStuckTicksThreshold: Number(tagged.mineStuckTicksThreshold ?? saved?.mineStuckTicksThreshold ?? 40),
    eatWhenCornered: tagged.eatWhenCornered === undefined ? (saved?.eatWhenCornered ?? true) : tagged.eatWhenCornered === "1",
    pathfinding: tagged.pathfinding === undefined ? (saved?.pathfinding ?? true) : tagged.pathfinding === "1",
    blockPlacing: tagged.blockPlacing === undefined ? (saved?.blockPlacing ?? true) : tagged.blockPlacing === "1",
    highGroundTactic: tagged.highGroundTactic === undefined ? (saved?.highGroundTactic ?? true) : tagged.highGroundTactic === "1",
    escapeTeleport: tagged.escapeTeleport === undefined ? (saved?.escapeTeleport ?? true) : tagged.escapeTeleport === "1",
    lookTurnSpeed: Number(tagged.lookTurnSpeed ?? saved?.lookTurnSpeed ?? 42),
    debug: {
      enabled: tagged.debugEnabled === undefined ? saved?.debug?.enabled : tagged.debugEnabled === "1",
      movement: tagged.debugMovement === undefined ? saved?.debug?.movement : tagged.debugMovement === "1",
      scan: tagged.debugScan === undefined ? saved?.debug?.scan : tagged.debugScan === "1",
      combat: tagged.debugCombat === undefined ? saved?.debug?.combat : tagged.debugCombat === "1",
      health: tagged.debugHealth === undefined ? saved?.debug?.health : tagged.debugHealth === "1",
      totem: tagged.debugTotem === undefined ? saved?.debug?.totem : tagged.debugTotem === "1",
      loadout: tagged.debugLoadout === undefined ? saved?.debug?.loadout : tagged.debugLoadout === "1",
      inventory: tagged.debugInventory === undefined ? saved?.debug?.inventory : tagged.debugInventory === "1",
    },
  });
  botConfigs[uid] = config;
  writeConfigTags(bot, config);
  saveConfigs();
  return config;
}

export function persistBotConfig(bot, configUpdate) {
  const uid = getBotUid(bot);
  const config = normalizeConfig({ ...configUpdate, uid });
  botConfigs[uid] = config;
  writeConfigTags(bot, config);
  saveConfigs();
  return config;
}

// ── Difficulty Presets ──
export function patchApplyDifficultyPreset(config, presetId) {
  const preset = PATCH_DIFFICULTY_PRESETS[presetId] ?? PATCH_DIFFICULTY_PRESETS.normal;
  return { ...config, difficultyPreset: presetId, ...preset };
}
export function patchGetDifficultyLabel(config) {
  switch (`${config?.difficultyPreset ?? "custom"}`) {
    case "easy": return "Easy";
    case "normal": return "Normal";
    case "hard": return "Hard";
    default: return "Custom";
  }
}

// ── Load / Save ──
export function loadConfigs() {
  try {
    const raw = safeGetDynamicProperty(CONFIG_PROPERTY_ID);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const [uid, config] of Object.entries(parsed)) {
      botConfigs[uid] = normalizeConfig({ ...config, uid });
    }
    logSystem(`loaded ${Object.keys(botConfigs).length} bot configs`);
  } catch (error) {
    logSystem(`loadConfigs failed: ${formatError(error)}`);
  }
}
export function saveConfigs() {
  try {
    safeSetDynamicProperty(CONFIG_PROPERTY_ID, JSON.stringify(botConfigs));
  } catch {}
}
export function loadGlobalSettings() {
  try {
    const raw = safeGetDynamicProperty(GLOBAL_SETTINGS_PROPERTY_ID);
    const parsed = raw ? JSON.parse(raw) : {};
    setGlobalSettings(normalizeGlobalSettings(parsed));
  } catch {
    setGlobalSettings(normalizeGlobalSettings({}));
  }
}
export function saveGlobalSettings() {
  try {
    safeSetDynamicProperty(GLOBAL_SETTINGS_PROPERTY_ID, JSON.stringify(globalSettings));
  } catch {}
}