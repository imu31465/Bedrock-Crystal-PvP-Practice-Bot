import * as mc from "@minecraft/server";
import * as mcui from "@minecraft/server-ui";
const BlockPermutation = mc.BlockPermutation;
const CommandPermissionLevel = mc.CommandPermissionLevel ?? { Any: 0 };
const CustomCommandStatus = mc.CustomCommandStatus ?? { Success: 0 };
const EnchantmentTypes = mc.EnchantmentTypes;
const EntityComponentTypes = mc.EntityComponentTypes ?? {
  Inventory: "inventory",
  Equippable: "equippable",
  Health: "health",
};
const GameMode = mc.GameMode ?? {
  Survival: "survival",
  Creative: "creative",
  Adventure: "adventure",
  Spectator: "spectator",
};
const EquipmentSlot = mc.EquipmentSlot ?? {
  Mainhand: "mainhand",
  Offhand: "offhand",
  Head: "head",
  Chest: "chest",
  Legs: "legs",
  Feet: "feet",
  Body: "body",
};
const ItemStack = mc.ItemStack;
const system = mc.system;
const world = mc.world;
const ActionFormData = mcui.ActionFormData;
const ModalFormData = mcui.ModalFormData;
const BOT_TYPE = "pvpbot:crystal_bot";
const CONFIG_PROPERTY_ID = "pvpbot:configs";
const GLOBAL_SETTINGS_PROPERTY_ID = "pvpbot:global_settings";
const DEBUG_LOG_PROPERTY_ID = "pvpbot:debuglog";
const BOT_UID_TAG_PREFIX = "pvpbot.uid:";
const BOT_CONFIG_TAG_PREFIX = "pvpbot.cfg:";
const BOT_READY_TAG = "pvpbot.ready";
const ADDON_VERSION = "1.2.1";
const OBSIDIAN_ID = "minecraft:obsidian";
const END_CRYSTAL_ID = "minecraft:end_crystal";
const END_CRYSTAL_ENTITY_ID = "minecraft:ender_crystal";
const ENDER_PEARL_ID = "minecraft:ender_pearl";
const TOTEM_ID = "minecraft:totem_of_undying";
const RESPAWN_ANCHOR_ID = "minecraft:respawn_anchor";
const GLOWSTONE_ID = "minecraft:glowstone";
const AIR_ID = "minecraft:air";
const FIRE_ID = "minecraft:fire";
const PATCH_CRYSTAL_TYPE_IDS = new Set([
  END_CRYSTAL_ENTITY_ID,
  END_CRYSTAL_ID,
  "ender_crystal",
  "end_crystal",
]);
const MAX_TARGET_DISTANCE = 16;
const MAX_INTERACT_DISTANCE = 4.5;
const SWORD_RANGE = 3.5;
const CRYSTAL_SCAN_MIN = 0.7;
const CRYSTAL_SCAN_MAX = 1.5;
const PEARL_PREDICTION_TICKS = 6;
const PEARL_VISUAL_DELAY = 4;
const STRAFE_FLIP_INTERVAL = 14;
const BOT_SPAWN_GRACE_TICKS = 20;
const CRYSTAL_POWER = 6;
const ANCHOR_POWER = 5.0;
const CRYSTAL_DAMAGE_SCORE_RADIUS = 6;
const ANCHOR_DAMAGE_SCORE_RADIUS = 5.25;
const COMBAT_PLACEMENT_ENTITY_RADIUS = 0.78;
const COMBAT_PLACEMENT_ENTITY_HEIGHT = 1.9;
const RESPAWN_ANCHOR_CHARGE_STATE = "respawn_anchor_charge";
const RESPAWN_ANCHOR_MAX_CHARGE = 4;
const DEBUG_LOG_LIMIT = 120;
const DEBUG_THROTTLE = {
  movement: 10,
  scan: 6,
  combat: 0,
  totem: 0,
  loadout: 0,
  inventory: 0,
};
function getIntroMessage() {
  return `§5[Crystal PvP Bot] v${ADDON_VERSION}`;
}
const SWORD_STATS = {
  "minecraft:netherite_sword": { score: 6, damage: 8 },
  "minecraft:diamond_sword": { score: 5, damage: 7 },
  "minecraft:iron_sword": { score: 4, damage: 6 },
  "minecraft:stone_sword": { score: 3, damage: 5 },
  "minecraft:golden_sword": { score: 2, damage: 4 },
  "minecraft:wooden_sword": { score: 1, damage: 4 },
};
const BOT_ARMOR = [
  { slot: EquipmentSlot.Head, itemId: "minecraft:netherite_helmet" },
  { slot: EquipmentSlot.Chest, itemId: "minecraft:netherite_chestplate" },
  { slot: EquipmentSlot.Legs, itemId: "minecraft:netherite_leggings" },
  { slot: EquipmentSlot.Feet, itemId: "minecraft:netherite_boots" },
];
const BOT_SWORD_ENCHANTMENTS = [
  { id: "minecraft:sharpness", level: 5 },
  { id: "minecraft:knockback", level: 1 },
  { id: "minecraft:unbreaking", level: 3 },
];
const BOT_ARMOR_ENCHANTMENTS = {
  [EquipmentSlot.Head]: [
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
  ],
  [EquipmentSlot.Chest]: [
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
  ],
  [EquipmentSlot.Legs]: [
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
  ],
  [EquipmentSlot.Feet]: [
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:feather_falling", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
  ],
};
const CRYSTAL_OFFSETS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
  { x: 1, z: 1 },
  { x: 1, z: -1 },
  { x: -1, z: 1 },
  { x: -1, z: -1 },
  { x: 2, z: 1 },
  { x: 2, z: -1 },
  { x: -2, z: 1 },
  { x: -2, z: -1 },
];
const EXPLOSION_RAY_DIRECTIONS = (() => {
  const step = 0.3;
  const dirs = [];
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        if (
          !(x === 0 || x === 15 || y === 0 || y === 15 || z === 0 || z === 15)
        ) {
          continue;
        }
        let dx = (x / 15.0) * 2.0 - 1.0;
        let dy = (y / 15.0) * 2.0 - 1.0;
        let dz = (z / 15.0) * 2.0 - 1.0;
        const len = Math.hypot(dx, dy, dz);
        dirs.push({
          dx: (dx / len) * step,
          dy: (dy / len) * step,
          dz: (dz / len) * step,
        });
      }
    }
  }
  return dirs;
})();
const ANCHOR_BREAK_OFFSETS_CACHE_POOL = (() => {
  const step = 0.3;
  const maxRadiusSq = 11.0 * 11.0;
  const poolSize = 5;
  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const affected = new Map();
    for (const { dx, dy, dz } of EXPLOSION_RAY_DIRECTIONS) {
      let strength = ANCHOR_POWER * (0.7 + Math.random() * 0.6);
      let cx = 0,
        cy = 0,
        cz = 0;
      while (strength > 0) {
        const lx = Math.floor(cx),
          ly = Math.floor(cy),
          lz = Math.floor(cz);
        const distSq = (lx + 0.5) ** 2 + (ly + 0.5) ** 2 + (lz + 0.5) ** 2;
        if (distSq > maxRadiusSq) break;
        const key = `${lx}|${ly}|${lz}`;
        if (!affected.has(key)) affected.set(key, { x: lx, y: ly, z: lz });
        strength -= (0.5 + 0.3) * 0.3;
        strength -= 0.225;
        cx += dx;
        cy += dy;
        cz += dz;
      }
    }
    pool.push([...affected.values()]);
  }
  return pool;
})();
const botConfigs = {};
let globalSettings = {
  boundaryEnabled: true,
  boundaryMinX: -50,
  boundaryMaxX: 50,
  boundaryMinZ: 100,
  boundaryMaxZ: 200,
};
const runtimeState = new Map();
const introShown = new Set();
const trackedBots = new Map();
const trackedBotMetaById = new Map();
const trackedBotIdByUid = new Map();
const pendingSpawnRequests = [];
let debugLogBuffer = [];
let globalTick = 0;
let botLoopStarted = false;
let configCounter = 0;
let patchMobGriefingEnabled = false;
function createDefaultConfig(uid = "", ownerName = "", displayName = "") {
  return {
    uid,
    ownerName,
    displayName:
      displayName || `Crystal Bot ${uid ? uid.slice(-4) : ""}`.trim(),
    enabled: true,
    maintainDistance: 3,
    targetRange: MAX_TARGET_DISTANCE,
    pearlDistance: 10,
    pearlCooldown: 40,
    swordCooldown: 15,
    crystalCooldown: 15,
    anchorCooldown: 15,
    autoTotem: true,
    mirrorOwnerLoadout: true,
    pearlMove: true,
    swordCombo: true,
    crystalCombo: true,
    anchorCombo: true,
    anchorBreakCache: true,
    ignoreSelfDamage: false,
    debug: {
      enabled: false,
      movement: false,
      scan: false,
      combat: false,
      totem: false,
    },
  };
}
function getRuntime(uid) {
  if (!runtimeState.has(uid)) {
    runtimeState.set(uid, {
      spawnTick: globalTick,
      lastPearlTick: -9999,
      lastSwordTick: -9999,
      lastCrystalTick: -9999,
      lastAnchorTick: -9999,
      lastLoadoutSyncTick: -9999,
      nextStrafeFlipTick: 0,
      strafeDirection: 1,
      lastTargetId: "",
      lastNoTargetLogTick: -9999,
      lastSeenTick: -9999,
      debugTickByCategory: {},
      pendingPearlToken: "",
      pendingCrystal: undefined,
      pendingAnchor: undefined,
      customBudgetInitialized: false,
    });
  }
  return runtimeState.get(uid);
}
function normalizeConfig(input) {
  const base = createDefaultConfig(
    input?.uid ?? "",
    input?.ownerName ?? "",
    input?.displayName ?? "",
  );
  return {
    ...base,
    ...input,
    maintainDistance: Number.isFinite(Number(input?.maintainDistance))
      ? Number(input.maintainDistance)
      : base.maintainDistance,
    targetRange: Number.isFinite(Number(input?.targetRange))
      ? Number(input.targetRange)
      : base.targetRange,
    pearlDistance: Number.isFinite(Number(input?.pearlDistance))
      ? Number(input.pearlDistance)
      : base.pearlDistance,
    pearlCooldown: Number.isFinite(Number(input?.pearlCooldown))
      ? Number(input.pearlCooldown)
      : base.pearlCooldown,
    swordCooldown: Number.isFinite(Number(input?.swordCooldown))
      ? Number(input.swordCooldown)
      : base.swordCooldown,
    crystalCooldown: Number.isFinite(Number(input?.crystalCooldown))
      ? Number(input.crystalCooldown)
      : base.crystalCooldown,
    anchorCooldown: Number.isFinite(Number(input?.anchorCooldown))
      ? Number(input.anchorCooldown)
      : base.anchorCooldown,
    inventoryMode: input?.inventoryMode ?? base.inventoryMode,
    customItemCounts: input?.customItemCounts ?? base.customItemCounts,
    debug: {
      ...base.debug,
      ...(input?.debug ?? {}),
    },
  };
}
function formatError(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return `${error}`;
}
function sanitizeTagValue(value) {
  return `${value ?? ""}`.replace(/[^\w.-]/g, "_");
}
function getAllPlayers() {
  try {
    return [...world.getPlayers()];
  } catch {
    return [];
  }
}
function getPlayerByName(name) {
  return getAllPlayers().find((player) => player.name === name);
}
function getPlayersInDimension(dimension) {
  try {
    return [...dimension.getPlayers()];
  } catch {
    return getAllPlayers().filter(
      (player) => player.dimension.id === dimension.id,
    );
  }
}
function getAllDimensions() {
  const ids = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
  return ids
    .map((id) => {
      try {
        return world.getDimension(id);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}
function safeGetDynamicProperty(id) {
  try {
    return world.getDynamicProperty(id);
  } catch {
    return undefined;
  }
}
function safeSetDynamicProperty(id, value) {
  try {
    world.setDynamicProperty(id, value);
    return true;
  } catch {
    return false;
  }
}
function loadDebugLogBuffer() {
  try {
    const serialized = safeGetDynamicProperty(DEBUG_LOG_PROPERTY_ID);
    if (!serialized || typeof serialized !== "string") {
      debugLogBuffer = [];
      return;
    }
    const parsed = JSON.parse(serialized);
    debugLogBuffer = Array.isArray(parsed) ? parsed : [];
  } catch {
    debugLogBuffer = [];
  }
}
function saveDebugLogBuffer() {
  safeSetDynamicProperty(
    DEBUG_LOG_PROPERTY_ID,
    JSON.stringify(debugLogBuffer.slice(-DEBUG_LOG_LIMIT)),
  );
}
function appendPersistentDebugLog(level, message) {
  const entry = {
    tick: globalTick,
    level,
    time: Date.now(),
    message: `${message}`,
  };
  debugLogBuffer.push(entry);
  if (debugLogBuffer.length > DEBUG_LOG_LIMIT) {
    debugLogBuffer = debugLogBuffer.slice(-DEBUG_LOG_LIMIT);
  }
  saveDebugLogBuffer();
}
function dumpPersistentDebugLog(player, limit = 25) {
  const lines = debugLogBuffer.slice(-limit).map((entry) => {
    return `§7[${entry.level}] t${entry.tick} §f${entry.message}`;
  });
  if (!lines.length) {
    player.sendMessage("§e[PvPBot] 保存されたデバッグログはありません。");
    return;
  }
  player.sendMessage(`§6[PvPBot] debug log dump (${lines.length} lines)`);
  for (const line of lines) {
    player.sendMessage(line);
  }
}
function clearPersistentDebugLog(player) {
  debugLogBuffer = [];
  saveDebugLogBuffer();
  if (player) {
    player.sendMessage("§a[PvPBot] デバッグログを消去しました。");
  }
}
function loadConfigs() {
  try {
    const serialized = safeGetDynamicProperty(CONFIG_PROPERTY_ID);
    if (!serialized || typeof serialized !== "string") {
      return;
    }
    const parsed = JSON.parse(serialized);
    for (const [uid, config] of Object.entries(parsed)) {
      botConfigs[uid] = normalizeConfig({ uid, ...config });
    }
  } catch (error) {
    console.warn(`[PvPBot] loadConfigs failed: ${formatError(error)}`);
  }
}
function saveConfigs() {
  return safeSetDynamicProperty(CONFIG_PROPERTY_ID, JSON.stringify(botConfigs));
}
function normalizeGlobalSettings(input = {}) {
  const minX = Number.isFinite(Number(input.boundaryMinX))
    ? Number(input.boundaryMinX)
    : -50;
  const maxX = Number.isFinite(Number(input.boundaryMaxX))
    ? Number(input.boundaryMaxX)
    : 50;
  const minZ = Number.isFinite(Number(input.boundaryMinZ))
    ? Number(input.boundaryMinZ)
    : 100;
  const maxZ = Number.isFinite(Number(input.boundaryMaxZ))
    ? Number(input.boundaryMaxZ)
    : 200;
  return {
    boundaryEnabled:
      input.boundaryEnabled === undefined ? true : !!input.boundaryEnabled,
    boundaryMinX: Math.min(minX, maxX),
    boundaryMaxX: Math.max(minX, maxX),
    boundaryMinZ: Math.min(minZ, maxZ),
    boundaryMaxZ: Math.max(minZ, maxZ),
  };
}
function loadGlobalSettings() {
  try {
    const serialized = safeGetDynamicProperty(GLOBAL_SETTINGS_PROPERTY_ID);
    if (!serialized || typeof serialized !== "string") {
      globalSettings = normalizeGlobalSettings(globalSettings);
      saveGlobalSettings();
      return;
    }
    globalSettings = normalizeGlobalSettings(JSON.parse(serialized));
  } catch (error) {
    globalSettings = normalizeGlobalSettings(globalSettings);
    console.warn(`[PvPBot] loadGlobalSettings failed: ${formatError(error)}`);
  }
}
function saveGlobalSettings() {
  globalSettings = normalizeGlobalSettings(globalSettings);
  return safeSetDynamicProperty(
    GLOBAL_SETTINGS_PROPERTY_ID,
    JSON.stringify(globalSettings),
  );
}
function getUidTag(bot) {
  return bot.getTags().find((tag) => tag.startsWith(BOT_UID_TAG_PREFIX));
}
function getBotUid(bot) {
  return getUidTag(bot)?.slice(BOT_UID_TAG_PREFIX.length) ?? "";
}
function setUidTag(bot, uid) {
  const current = getUidTag(bot);
  if (current && current !== `${BOT_UID_TAG_PREFIX}${uid}`) {
    bot.removeTag(current);
  }
  if (current !== `${BOT_UID_TAG_PREFIX}${uid}`) {
    bot.addTag(`${BOT_UID_TAG_PREFIX}${uid}`);
  }
}
function readConfigFromTags(bot) {
  const config = {};
  for (const tag of bot.getTags()) {
    if (!tag.startsWith(BOT_CONFIG_TAG_PREFIX)) {
      continue;
    }
    const payload = tag.slice(BOT_CONFIG_TAG_PREFIX.length);
    const separator = payload.indexOf("=");
    if (separator === -1) {
      continue;
    }
    config[payload.slice(0, separator)] = payload.slice(separator + 1);
  }
  return config;
}
function writeConfigTags(bot, config) {
  for (const tag of bot.getTags()) {
    if (tag.startsWith(BOT_CONFIG_TAG_PREFIX)) {
      bot.removeTag(tag);
    }
  }
  const flat = {
    ownerName: sanitizeTagValue(config.ownerName),
    displayName: sanitizeTagValue(config.displayName),
    enabled: config.enabled ? "1" : "0",
    maintainDistance: config.maintainDistance,
    targetRange: config.targetRange,
    pearlDistance: config.pearlDistance,
    pearlCooldown: config.pearlCooldown,
    swordCooldown: config.swordCooldown,
    crystalCooldown: config.crystalCooldown,
    anchorCooldown: config.anchorCooldown,
    autoTotem: config.autoTotem ? "1" : "0",
    mirrorOwnerLoadout: config.mirrorOwnerLoadout ? "1" : "0",
    pearlMove: config.pearlMove ? "1" : "0",
    swordCombo: config.swordCombo ? "1" : "0",
    crystalCombo: config.crystalCombo ? "1" : "0",
    anchorCombo: config.anchorCombo ? "1" : "0",
    debugEnabled: config.debug.enabled ? "1" : "0",
    debugMovement: config.debug.movement ? "1" : "0",
    debugScan: config.debug.scan ? "1" : "0",
    debugCombat: config.debug.combat ? "1" : "0",
    debugTotem: config.debug.totem ? "1" : "0",
  };
  for (const [key, value] of Object.entries(flat)) {
    bot.addTag(`${BOT_CONFIG_TAG_PREFIX}${key}=${value}`);
  }
}
function materializeConfig(bot, ownerPlayer) {
  let uid = getBotUid(bot);
  if (!uid) {
    configCounter += 1;
    uid = `${Date.now().toString(36)}-${configCounter.toString(36)}`;
    setUidTag(bot, uid);
  }
  const tagged = readConfigFromTags(bot);
  const saved = botConfigs[uid];
  const config = normalizeConfig({
    uid,
    ownerName: ownerPlayer?.name ?? saved?.ownerName ?? tagged.ownerName ?? "",
    displayName:
      saved?.displayName ?? tagged.displayName?.replace(/_/g, " ") ?? "",
    ...saved,
    enabled:
      tagged.enabled === undefined ? saved?.enabled : tagged.enabled === "1",
    maintainDistance: Number(
      tagged.maintainDistance ?? saved?.maintainDistance,
    ),
    targetRange: Number(tagged.targetRange ?? saved?.targetRange),
    pearlDistance: Number(tagged.pearlDistance ?? saved?.pearlDistance),
    pearlCooldown: Number(tagged.pearlCooldown ?? saved?.pearlCooldown),
    swordCooldown: Number(tagged.swordCooldown ?? saved?.swordCooldown),
    crystalCooldown: Number(tagged.crystalCooldown ?? saved?.crystalCooldown),
    anchorCooldown: Number(tagged.anchorCooldown ?? saved?.anchorCooldown),
    autoTotem:
      tagged.autoTotem === undefined
        ? saved?.autoTotem
        : tagged.autoTotem === "1",
    mirrorOwnerLoadout:
      tagged.mirrorOwnerLoadout === undefined
        ? saved?.mirrorOwnerLoadout
        : tagged.mirrorOwnerLoadout === "1",
    pearlMove:
      tagged.pearlMove === undefined
        ? saved?.pearlMove
        : tagged.pearlMove === "1",
    swordCombo:
      tagged.swordCombo === undefined
        ? saved?.swordCombo
        : tagged.swordCombo === "1",
    crystalCombo:
      tagged.crystalCombo === undefined
        ? saved?.crystalCombo
        : tagged.crystalCombo === "1",
    anchorCombo:
      tagged.anchorCombo === undefined
        ? saved?.anchorCombo
        : tagged.anchorCombo === "1",
    debug: {
      enabled:
        tagged.debugEnabled === undefined
          ? saved?.debug?.enabled
          : tagged.debugEnabled === "1",
      movement:
        tagged.debugMovement === undefined
          ? saved?.debug?.movement
          : tagged.debugMovement === "1",
      scan:
        tagged.debugScan === undefined
          ? saved?.debug?.scan
          : tagged.debugScan === "1",
      combat:
        tagged.debugCombat === undefined
          ? saved?.debug?.combat
          : tagged.debugCombat === "1",
      totem:
        tagged.debugTotem === undefined
          ? saved?.debug?.totem
          : tagged.debugTotem === "1",
    },
  });
  botConfigs[uid] = config;
  writeConfigTags(bot, config);
  saveConfigs();
  return config;
}
function persistBotConfig(bot, config) {
  botConfigs[config.uid] = normalizeConfig(config);
  writeConfigTags(bot, botConfigs[config.uid]);
  saveConfigs();
  return botConfigs[config.uid];
}
function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
function distance(a, b) {
  return Math.sqrt(distanceSquared(a, b));
}
function vectorTo(from, to) {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}
function addVector(base, delta) {
  return { x: base.x + delta.x, y: base.y + delta.y, z: base.z + delta.z };
}
function normalize2D(vector) {
  const length = Math.hypot(vector.x, vector.z);
  return length > 0.0001
    ? { x: vector.x / length, y: 0, z: vector.z / length }
    : { x: 0, y: 0, z: 0 };
}
function floorLocation(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
  };
}
let blockCacheTick = -1;
const blockCache = new Map();
function getBlock(dimension, location) {
  try {
    if (globalTick !== blockCacheTick) {
      blockCache.clear();
      blockCacheTick = globalTick;
    }
    const loc = floorLocation(location);
    const key = `${dimension.id}|${loc.x}|${loc.y}|${loc.z}`;
    if (blockCache.has(key)) return blockCache.get(key);
    const block = dimension.getBlock(loc);
    blockCache.set(key, block);
    return block;
  } catch {}
}
function isAirBlock(block) {
  return (
    !!block &&
    (block.typeId === "minecraft:air" ||
      block.typeId === "minecraft:fire" ||
      block.typeId === "minecraft:soul_fire")
  );
}
function isSolidBlock(block) {
  return !!block && !isAirBlock(block) && !block.isLiquid;
}
function isCrystalBaseBlock(block) {
  return (
    !!block &&
    (block.typeId === OBSIDIAN_ID || block.typeId === "minecraft:bedrock")
  );
}
function isSafeStandingLocation(dimension, location) {
  const feet = getBlock(dimension, location);
  const head = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  const below = getBlock(dimension, addVector(location, { x: 0, y: -1, z: 0 }));
  return (
    isAirBlock(feet) &&
    isAirBlock(head) &&
    !!below &&
    below.typeId !== "minecraft:air"
  );
}
function canOccupyLocation(dimension, location) {
  const feet = getBlock(dimension, location);
  const head = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  return isAirBlock(feet) && isAirBlock(head);
}
function findNearestStandingLocation(
  dimension,
  location,
  offsets = [0, -1, -2, -3, 1],
) {
  for (const yOffset of offsets) {
    const candidate = addVector(location, { x: 0, y: yOffset, z: 0 });
    if (isSafeStandingLocation(dimension, candidate)) {
      return candidate;
    }
  }
  return undefined;
}
function patchSnapToBlockCenter(location) {
  const floored = floorLocation(location);
  return {
    x: floored.x + 0.5,
    y: location.y,
    z: floored.z + 0.5,
  };
}
function isRespawnAnchorBlock(block) {
  return !!block && block.typeId === RESPAWN_ANCHOR_ID;
}
function getRespawnAnchorCharge(block) {
  if (!isRespawnAnchorBlock(block)) {
    return 0;
  }
  try {
    const charge = Number(
      block.permutation?.getState?.(RESPAWN_ANCHOR_CHARGE_STATE) ?? 0,
    );
    if (Number.isFinite(charge)) {
      return Math.max(
        0,
        Math.min(RESPAWN_ANCHOR_MAX_CHARGE, Math.floor(charge)),
      );
    }
  } catch {}
  return 0;
}
function resolveRespawnAnchorPermutation(charge = 0) {
  try {
    return BlockPermutation.resolve(RESPAWN_ANCHOR_ID, {
      [RESPAWN_ANCHOR_CHARGE_STATE]: Math.max(
        0,
        Math.min(RESPAWN_ANCHOR_MAX_CHARGE, Math.floor(charge)),
      ),
    });
  } catch {
    return BlockPermutation.resolve(RESPAWN_ANCHOR_ID);
  }
}
function getExplosionLocation(baseLocation, comboType) {
  if (comboType === "anchor") {
    return {
      x: baseLocation.x + 0.5,
      y: baseLocation.y + 0.0,
      z: baseLocation.z + 0.5,
    };
  }
  return {
    x: baseLocation.x + 0.5,
    y: baseLocation.y + 1,
    z: baseLocation.z + 0.5,
  };
}
function patchGetCombatBaseYCandidates(target) {
  const targetFeet = floorLocation(target.location);
  const groundedFeet = findNearestStandingLocation(
    target.dimension,
    target.location,
    [0, -1, -2, -3, 1],
  );
  const groundedFeetY = groundedFeet
    ? floorLocation(groundedFeet).y
    : targetFeet.y;
  return [
    ...new Set(
      [groundedFeetY - 1, targetFeet.y - 1, targetFeet.y].map((value) =>
        Math.floor(value),
      ),
    ),
  ];
}
function estimateExplosionDamageScore(
  entity,
  explosionLocation,
  radius,
  comboType = "crystal",
) {
  const samplePoints = [
    addVector(entity.location, { x: 0, y: 0.1, z: 0 }),
    addVector(entity.location, { x: 0, y: 0.9, z: 0 }),
    addVector(entity.location, { x: 0, y: 1.55, z: 0 }),
  ];
  const nearestDistance = samplePoints.reduce(
    (best, point) =>
      Math.min(
        best,
        Math.hypot(
          point.x - explosionLocation.x,
          point.y - explosionLocation.y,
          point.z - explosionLocation.z,
        ),
      ),
    Number.POSITIVE_INFINITY,
  );
  const feetDelta = entity.location.y - explosionLocation.y;
  const explosionInsideBody =
    explosionLocation.y >= entity.location.y - 0.2 &&
    explosionLocation.y <= entity.location.y + 1.65;
  const verticalPenalty =
    feetDelta > 0
      ? feetDelta * (comboType === "anchor" ? 0.85 : 0.8)
      : Math.abs(feetDelta) * (comboType === "anchor" ? 0.38 : 0.35);
  const scale = comboType === "anchor" ? 2.1 : 2.15;
  const bodyBonus = explosionInsideBody
    ? comboType === "anchor"
      ? 0.7
      : 0.65
    : 0;
  const baseScore =
    Math.max(0, radius - nearestDistance) * scale - verticalPenalty + bodyBonus;
  return Math.max(0, Number(baseScore.toFixed(2)));
}
function patchIsExplosionCandidateSafe(
  bot,
  config,
  targetDamage,
  selfDamage,
  comboType = "crystal",
) {
  if (config?.ignoreSelfDamage) {
    return true;
  }
  const currentHealth = patchGetCurrentHealthValue(bot);
  const reserve = comboType === "anchor" ? 7 : 6;
  const maxSelfDamage = Math.max(
    comboType === "anchor" ? 1.75 : 2.25,
    currentHealth - reserve,
  );
  const relativeMargin = comboType === "anchor" ? 1.35 : 0.8;
  if (selfDamage > maxSelfDamage) {
    return false;
  }
  if (selfDamage > targetDamage - relativeMargin) {
    return false;
  }
  return true;
}
function entityOverlapsCombatPlacement(entity, baseLocation, comboType) {
  const center = {
    x: baseLocation.x + 0.5,
    y: comboType === "anchor" ? baseLocation.y + 0.5 : baseLocation.y + 1.5,
    z: baseLocation.z + 0.5,
  };
  const dx = Math.abs(entity.location.x - center.x);
  const dz = Math.abs(entity.location.z - center.z);
  const feetY = entity.location.y;
  const headY = feetY + COMBAT_PLACEMENT_ENTITY_HEIGHT;
  const minY = comboType === "anchor" ? baseLocation.y : baseLocation.y + 1;
  const maxY = comboType === "anchor" ? baseLocation.y + 1 : baseLocation.y + 3;
  return (
    dx < COMBAT_PLACEMENT_ENTITY_RADIUS &&
    dz < COMBAT_PLACEMENT_ENTITY_RADIUS &&
    feetY < maxY &&
    headY > minY
  );
}
function entityOverlapsBlockSpace(entity, blockLocation) {
  const center = {
    x: blockLocation.x + 0.5,
    y: blockLocation.y + 0.5,
    z: blockLocation.z + 0.5,
  };
  const dx = Math.abs(entity.location.x - center.x);
  const dz = Math.abs(entity.location.z - center.z);
  const feetY = entity.location.y;
  const headY = feetY + COMBAT_PLACEMENT_ENTITY_HEIGHT;
  return (
    dx < COMBAT_PLACEMENT_ENTITY_RADIUS &&
    dz < COMBAT_PLACEMENT_ENTITY_RADIUS &&
    feetY < blockLocation.y + 1 &&
    headY > blockLocation.y
  );
}
function isCombatPlacementBlocked(
  dimension,
  baseLocation,
  comboType,
  target,
  bot,
) {
  if (entityOverlapsCombatPlacement(target, baseLocation, comboType)) {
    return true;
  }
  if (entityOverlapsCombatPlacement(bot, baseLocation, comboType)) {
    return true;
  }
  for (const player of getPlayersInDimension(dimension)) {
    if (player.id === target.id || player.id === bot.id) {
      continue;
    }
    if (entityOverlapsCombatPlacement(player, baseLocation, comboType)) {
      return true;
    }
  }
  return false;
}
function isBlockPlacementBlocked(dimension, blockLocation, target, bot) {
  if (
    entityOverlapsBlockSpace(target, blockLocation) ||
    entityOverlapsBlockSpace(bot, blockLocation)
  ) {
    return true;
  }
  for (const player of getPlayersInDimension(dimension)) {
    if (player.id === target.id || player.id === bot.id) {
      continue;
    }
    if (entityOverlapsBlockSpace(player, blockLocation)) {
      return true;
    }
  }
  return false;
}
function describeDamageTrade(targetScore, selfScore) {
  return `target=${targetScore.toFixed(2)} self=${selfScore.toFixed(2)}`;
}
function applyEnchantments(item, enchantments = [], unbreakable = true) {
  if (!enchantments.length || typeof item?.getComponent !== "function") {
    return item;
  }
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.addEnchantments !== "function") {
      return item;
    }
    const prepared = enchantments
      .map((entry) => {
        const type = EnchantmentTypes.get(entry.id);
        const level =
          unbreakable && entry.id === "minecraft:unbreaking"
            ? 255
            : entry.level;
        return type ? { type, level } : undefined;
      })
      .filter(Boolean);
    if (prepared.length) {
      enchantable.addEnchantments(prepared);
    }
  } catch {}
  return item;
}
function cloneItemStack(
  item,
  fallbackTypeId = "minecraft:air",
  fallbackAmount = 1,
) {
  if (item?.clone) {
    try {
      return item.clone();
    } catch {}
  }
  const cloned = new ItemStack(
    item?.typeId ?? fallbackTypeId,
    item?.amount ?? fallbackAmount,
  );
  try {
    if (item?.nameTag) {
      cloned.nameTag = item.nameTag;
    }
  } catch {}
  return cloned;
}
function countItemInContainer(container, itemId) {
  if (!container || !itemId) {
    return 0;
  }
  let amount = 0;
  for (let index = 0; index < container.size; index += 1) {
    const item = container.getItem(index);
    if (item?.typeId === itemId) {
      amount += item.amount ?? 1;
    }
  }
  return amount;
}
function addOrFallbackInventoryItem(inventory, preferredItem, fallbackItem) {
  if (!inventory) {
    return;
  }
  try {
    inventory.addItem(preferredItem);
    return;
  } catch {}
  if (fallbackItem) {
    try {
      inventory.addItem(fallbackItem);
    } catch {}
  }
}
function equipMainhandItem(bot, itemId, config) {
  if (!config) config = ensureBotInitialized(bot);
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable || !inventory) {
    return false;
  }
  for (let index = 0; index < inventory.size; index += 1) {
    const item = inventory.getItem(index);
    if (item?.typeId !== itemId) {
      continue;
    }
    try {
      equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(item));
      return true;
    } catch {}
  }
  if (config?.inventoryMode === "infinite") {
    try {
      equippable.setEquipment(
        EquipmentSlot.Mainhand,
        new ItemStack(itemId, 64),
      );
      return true;
    } catch {}
  }
  return false;
}
function setHealthValue(entity, value) {
  const health = entity.getComponent(EntityComponentTypes.Health);
  if (!health) {
    return false;
  }
  try {
    if (typeof health.setCurrentValue === "function") {
      health.setCurrentValue(value);
      return true;
    }
  } catch {}
  try {
    if ("currentValue" in health) {
      health.currentValue = value;
      return true;
    }
  } catch {}
  return false;
}
function getEquippableComponent(entity) {
  if (!entity || typeof entity.getComponent !== "function") {
    return undefined;
  }
  try {
    const component = entity.getComponent(EntityComponentTypes.Equippable);
    if (component) {
      return component;
    }
  } catch {}
  for (const componentId of ["minecraft:equippable", "equippable"]) {
    try {
      const component = entity.getComponent(componentId);
      if (component) {
        return component;
      }
    } catch {}
  }
  return undefined;
}
function consumeInventoryItem(container, itemId, amount = 1) {
  if (!container || !itemId || amount <= 0) {
    return false;
  }
  for (let index = 0; index < container.size; index += 1) {
    const item = container.getItem(index);
    if (item?.typeId !== itemId) {
      continue;
    }
    const remaining = (item.amount ?? 1) - amount;
    if (remaining > 0) {
      container.setItem(index, new ItemStack(item.typeId, remaining));
    } else {
      container.setItem(index, undefined);
    }
    return true;
  }
  return false;
}
function tryPopTotem(bot, config, reason = "unknown") {
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const health = bot.getComponent(EntityComponentTypes.Health);
  if (!equippable || !inventory || !health) {
    return false;
  }
  let consumed = false;
  const offhand = equippable.getEquipment(EquipmentSlot.Offhand);
  if (offhand?.typeId === TOTEM_ID) {
    try {
      equippable.setEquipment(EquipmentSlot.Offhand, undefined);
      consumed = true;
    } catch {}
  } else {
    consumed = consumeManagedItem(bot, config, TOTEM_ID, 1);
  }
  if (!consumed) {
    return false;
  }
  const maxHealth = Number(health.effectiveMax ?? health.defaultValue ?? 20);
  setHealthValue(bot, Math.max(8, Math.min(maxHealth, maxHealth * 0.7)));
  try {
    bot.addEffect("regeneration", 45, { amplifier: 1, showParticles: false });
  } catch {}
  try {
    bot.addEffect("absorption", 120, { amplifier: 1, showParticles: false });
  } catch {}
  try {
    bot.addEffect("fire_resistance", 160, {
      amplifier: 0,
      showParticles: false,
    });
  } catch {}
  ensureAutoTotem(bot, config);
  debugLog(bot, config, "totem", `疑似トーテム発動: ${reason}`, true);
  return true;
}
function buildFallbackArmor(slot) {
  const armor = BOT_ARMOR.find((entry) => entry.slot === slot);
  if (!armor) {
    return undefined;
  }
  return applyEnchantments(
    new ItemStack(armor.itemId, 1),
    BOT_ARMOR_ENCHANTMENTS[slot] ?? [],
    true,
  );
}
function syncBotLoadoutFromOwner(bot, config, force = false) {
  if (!config.mirrorOwnerLoadout || !config.ownerName) {
    return;
  }
  const runtime = getRuntime(config.uid);
  if (!force && globalTick - runtime.lastLoadoutSyncTick < 20) {
    return;
  }
  const owner = getPlayerByName(config.ownerName);
  const ownerInventory = owner?.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const ownerEquippable = getEquippableComponent(owner);
  const botInventory = bot.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const botEquippable = getEquippableComponent(bot);
  if (
    !owner ||
    !ownerInventory ||
    !ownerEquippable ||
    !botInventory ||
    !botEquippable
  ) {
    return;
  }
  runtime.lastLoadoutSyncTick = globalTick;
  const ownerSword = (() => {
    const equipped = ownerEquippable.getEquipment(EquipmentSlot.Mainhand);
    if (equipped && SWORD_STATS[equipped.typeId]) {
      return cloneItemStack(equipped);
    }
    let bestItem;
    let bestScore = -1;
    for (let index = 0; index < ownerInventory.size; index += 1) {
      const current = ownerInventory.getItem(index);
      const score = current ? (SWORD_STATS[current.typeId]?.score ?? -1) : -1;
      if (score > bestScore) {
        bestScore = score;
        bestItem = current;
      }
    }
    return bestItem
      ? cloneItemStack(bestItem)
      : applyEnchantments(
          new ItemStack("minecraft:netherite_sword", 1),
          BOT_SWORD_ENCHANTMENTS,
        );
  })();
  const ownerArmor = {
    [EquipmentSlot.Head]: ownerEquippable.getEquipment(EquipmentSlot.Head),
    [EquipmentSlot.Chest]: ownerEquippable.getEquipment(EquipmentSlot.Chest),
    [EquipmentSlot.Legs]: ownerEquippable.getEquipment(EquipmentSlot.Legs),
    [EquipmentSlot.Feet]: ownerEquippable.getEquipment(EquipmentSlot.Feet),
  };
  const offhandTotem =
    ownerEquippable.getEquipment(EquipmentSlot.Offhand)?.typeId === TOTEM_ID
      ? ownerEquippable.getEquipment(EquipmentSlot.Offhand)
      : undefined;
  const itemCounts = {
    [OBSIDIAN_ID]: countItemInContainer(ownerInventory, OBSIDIAN_ID),
    [END_CRYSTAL_ID]: countItemInContainer(ownerInventory, END_CRYSTAL_ID),
    [RESPAWN_ANCHOR_ID]: countItemInContainer(
      ownerInventory,
      RESPAWN_ANCHOR_ID,
    ),
    [GLOWSTONE_ID]: countItemInContainer(ownerInventory, GLOWSTONE_ID),
    [ENDER_PEARL_ID]: countItemInContainer(ownerInventory, ENDER_PEARL_ID),
    [TOTEM_ID]:
      countItemInContainer(ownerInventory, TOTEM_ID) +
      (offhandTotem ? (offhandTotem.amount ?? 1) : 0),
  };
  for (let index = 0; index < botInventory.size; index += 1) {
    botInventory.setItem(index, undefined);
  }
  addOrFallbackInventoryItem(
    botInventory,
    ownerSword,
    applyEnchantments(
      new ItemStack("minecraft:netherite_sword", 1),
      BOT_SWORD_ENCHANTMENTS,
    ),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(OBSIDIAN_ID, Math.max(1, itemCounts[OBSIDIAN_ID] || 64)),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(
      END_CRYSTAL_ID,
      Math.max(1, itemCounts[END_CRYSTAL_ID] || 16),
    ),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(
      RESPAWN_ANCHOR_ID,
      Math.max(1, itemCounts[RESPAWN_ANCHOR_ID] || 8),
    ),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(GLOWSTONE_ID, Math.max(1, itemCounts[GLOWSTONE_ID] || 16)),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(
      ENDER_PEARL_ID,
      Math.max(1, itemCounts[ENDER_PEARL_ID] || 16),
    ),
  );
  addOrFallbackInventoryItem(
    botInventory,
    new ItemStack(TOTEM_ID, Math.max(1, itemCounts[TOTEM_ID] || 8)),
  );
  for (const armor of BOT_ARMOR) {
    botEquippable.setEquipment(
      armor.slot,
      ownerArmor[armor.slot]
        ? cloneItemStack(ownerArmor[armor.slot])
        : buildFallbackArmor(armor.slot),
    );
  }
  botEquippable.setEquipment(
    EquipmentSlot.Mainhand,
    cloneItemStack(ownerSword),
  );
  botEquippable.setEquipment(
    EquipmentSlot.Offhand,
    offhandTotem ? cloneItemStack(offhandTotem) : new ItemStack(TOTEM_ID, 1),
  );
}
function ensureBotEquipmentIntegrity(bot, config) {
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable) {
    return;
  }
  if (!equippable.getEquipment(EquipmentSlot.Mainhand)) {
    let hasSword = false;
    if (inventory) {
      for (let index = 0; index < inventory.size; index += 1) {
        const item = inventory.getItem(index);
        if (item && SWORD_STATS[item.typeId]) {
          hasSword = true;
          break;
        }
      }
    }
    if (hasSword) {
      selectBestSword(bot);
      debugLog(bot, config, "inventory", "剣をインベントリから再装備");
    } else {
      equippable.setEquipment(
        EquipmentSlot.Mainhand,
        applyEnchantments(
          new ItemStack("minecraft:netherite_sword", 1),
          BOT_SWORD_ENCHANTMENTS,
        ),
      );
      debugLog(bot, config, "inventory", "剣をデフォルトで再装備");
    }
  }
  for (const armor of BOT_ARMOR) {
    if (!equippable.getEquipment(armor.slot)) {
      equippable.setEquipment(armor.slot, buildFallbackArmor(armor.slot));
      debugLog(
        bot,
        config,
        "inventory",
        `防具をデフォルトで再装備: ${armor.slot}`,
      );
    }
  }
  if (!equippable.getEquipment(EquipmentSlot.Offhand)) {
    ensureAutoTotem(bot, config);
  }
}
function shouldUseAnchorCombo(bot, target, config) {
  if (!config.anchorCombo) {
    return false;
  }
  if (bot.dimension.id === "minecraft:nether") {
    return false;
  }
  return true;
}
function isLocationOccupiedByPlayer(dimension, location, radius = 0.95) {
  const radiusSquared = radius * radius;
  for (const player of getPlayersInDimension(dimension)) {
    if (distanceSquared(player.location, location) <= radiusSquared) {
      return true;
    }
  }
  return false;
}
function setBotLookAt(bot, location) {
  const eye = addVector(bot.location, { x: 0, y: 1.45, z: 0 });
  const delta = vectorTo(eye, location);
  const xz = Math.max(0.0001, Math.hypot(delta.x, delta.z));
  const pitch = 90 - Math.atan2(delta.y, xz) * (180 / Math.PI);
  try {
    bot.setProperty("pvpbot:head_yaw", 0);
    bot.setProperty("pvpbot:head_pitch", Math.max(0, Math.min(180, pitch)));
  } catch {}
}
function faceBotToward(bot, location) {
  try {
    bot.teleport(bot.location, {
      dimension: bot.dimension,
      facingLocation: location,
    });
  } catch {}
}
function debugLog(bot, config, category, message, force = false) {
  if (!config.debug.enabled || !config.debug[category]) {
    return;
  }
  const owner = getPlayerByName(config.ownerName);
  if (!owner) {
    return;
  }
  const runtime = getRuntime(config.uid);
  const throttle = DEBUG_THROTTLE[category] ?? 0;
  const lastTick = runtime.debugTickByCategory[category] ?? -9999;
  if (!force && throttle > 0 && globalTick - lastTick < throttle) {
    return;
  }
  runtime.debugTickByCategory[category] = globalTick;
  appendPersistentDebugLog(
    category,
    `${config.displayName || config.uid}: ${message}`,
  );
  const DEBUG_CATEGORY_COLORS = {
    movement: "§b",
    scan: "§d",
    combat: "§c",
    totem: "§e",
    loadout: "§a",
    inventory: "§9",
  };
  const categoryColor = DEBUG_CATEGORY_COLORS[category] ?? "§7";
  owner.sendMessage(`${categoryColor}[PvPBot:${category}]§r §f${message}`);
}
function isSpawnProtected(uid) {
  const runtime = getRuntime(uid);
  return globalTick - runtime.spawnTick < BOT_SPAWN_GRACE_TICKS;
}
function logSystem(message) {
  appendPersistentDebugLog("system", message);
}
function logBotEvent(bot, message) {
  const uid = getBotUid(bot);
  const config = botConfigs[uid];
  appendPersistentDebugLog(
    "bot",
    `${config?.displayName ?? bot.nameTag ?? uid}: ${message}`,
  );
}
function broadcastDeathMessage(bot, meta) {
  const uid = meta?.uid || getBotUid(bot);
  const config = botConfigs[uid];
  const displayName =
    config?.displayName ?? meta?.nameTag ?? bot.nameTag ?? "Crystal Bot";
  const botLabel = `${displayName} (${uid.slice(-4)})`;
  const players = getAllPlayers();
  for (const player of players) {
    try {
      player.sendMessage(`§cPractice Bot ${botLabel} は死んだ`);
    } catch {}
  }
}
function isEntityUsable(entity, expectedTypeId) {
  try {
    if (!entity) {
      return false;
    }
    if (expectedTypeId && entity.typeId !== expectedTypeId) {
      return false;
    }
    if (typeof entity.isValid === "function") {
      return entity.isValid();
    }
    if (typeof entity.isValid === "boolean") {
      return entity.isValid;
    }
    const location = entity.location;
    return Number.isFinite(location?.x) && !!entity.dimension;
  } catch {
    return false;
  }
}
function shortId(value) {
  return value ? `${value}`.slice(-4) : "none";
}
function cloneLocation(location) {
  if (!location) {
    return undefined;
  }
  return {
    x: location.x,
    y: location.y,
    z: location.z,
  };
}
function formatLocation(location) {
  if (!location) {
    return "?,?,?";
  }
  const x = Number.isFinite(location.x) ? location.x.toFixed(1) : "?";
  const y = Number.isFinite(location.y) ? location.y.toFixed(1) : "?";
  const z = Number.isFinite(location.z) ? location.z.toFixed(1) : "?";
  return `${x},${y},${z}`;
}
function resolveDimension(dimensionOrId) {
  if (!dimensionOrId) {
    return undefined;
  }
  if (typeof dimensionOrId !== "string") {
    return dimensionOrId;
  }
  try {
    return world.getDimension(dimensionOrId);
  } catch {
    return undefined;
  }
}
function updateTrackedBotMeta(bot, overrides = {}) {
  const botId =
    overrides.id ??
    (() => {
      try {
        return bot?.id;
      } catch {
        return undefined;
      }
    })();
  if (!botId) {
    return overrides;
  }
  const current = trackedBotMetaById.get(botId) ?? {};
  const next = {
    ...current,
    id: botId,
    ...overrides,
  };
  try {
    if (bot) {
      next.typeId = bot.typeId ?? next.typeId ?? "";
      next.uid = getBotUid(bot) || next.uid || "";
      next.nameTag = bot.nameTag ?? next.nameTag ?? "";
      next.dimensionId = bot.dimension?.id ?? next.dimensionId ?? "";
      next.location = cloneLocation(bot.location) ?? next.location;
      next.lastValidTick = globalTick;
    }
  } catch {}
  trackedBotMetaById.set(botId, next);
  if (next.uid) {
    trackedBotIdByUid.set(next.uid, botId);
  }
  return next;
}
function getTrackedBotMetaByUid(uid) {
  const id = trackedBotIdByUid.get(uid);
  return id ? trackedBotMetaById.get(id) : undefined;
}
function summarizeNearbyPlayers(
  dimensionOrId,
  location,
  radius = 1.5,
  limit = 3,
) {
  const dimension = resolveDimension(dimensionOrId);
  if (!dimension || !location) {
    return "none";
  }
  const radiusSquared = radius * radius;
  const nearby = [];
  for (const player of getPlayersInDimension(dimension)) {
    const current = distanceSquared(player.location, location);
    if (current > radiusSquared) {
      continue;
    }
    nearby.push(`${player.name}@${Math.sqrt(current).toFixed(2)}`);
    if (nearby.length >= limit) {
      break;
    }
  }
  return nearby.length ? nearby.join(",") : "none";
}
function summarizeNearbyBots(dimensionOrId, location, radius = 8, limit = 3) {
  const dimension = resolveDimension(dimensionOrId);
  if (!dimension || !location) {
    return "none";
  }
  const radiusSquared = radius * radius;
  const nearby = [];
  try {
    for (const entity of dimension.getEntities()) {
      if (entity.typeId !== BOT_TYPE) {
        continue;
      }
      const current = distanceSquared(entity.location, location);
      if (current > radiusSquared) {
        continue;
      }
      nearby.push(
        `${shortId(entity.id)}/${shortId(getBotUid(entity))}@${Math.sqrt(current).toFixed(2)}:${formatLocation(entity.location)}`,
      );
      if (nearby.length >= limit) {
        break;
      }
    }
  } catch {}
  return nearby.length ? nearby.join(",") : "none";
}
function describeBlockContext(dimensionOrId, location) {
  const dimension = resolveDimension(dimensionOrId);
  if (!dimension || !location) {
    return "blocks=?";
  }
  const below =
    getBlock(dimension, addVector(location, { x: 0, y: -1, z: 0 }))?.typeId ??
    "?";
  const feet = getBlock(dimension, location)?.typeId ?? "?";
  const head =
    getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }))?.typeId ??
    "?";
  return `below=${below} feet=${feet} head=${head}`;
}
function describeTrackedBotMeta(meta) {
  if (!meta) {
    return "meta=missing";
  }
  return `id=${shortId(meta.id)} uid=${shortId(meta.uid)} dim=${meta.dimensionId ?? "?"} loc=${formatLocation(meta.location)} lastValid=${meta.lastValidTick ?? "?"}`;
}
function trackBot(bot) {
  try {
    trackedBots.set(bot.id, bot);
    updateTrackedBotMeta(bot);
  } catch {}
}
function untrackBot(bot) {
  try {
    trackedBots.delete(bot.id);
    updateTrackedBotMeta(bot);
  } catch {}
}
function quoteCoord(value) {
  return Number(value).toFixed(2);
}
function queueSpawnRequest(player, location, openSettingsAfterSpawn, presetName, inventoryMode) {
  const request = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    playerName: player.name,
    dimensionId: player.dimension.id,
    location: { ...location },
    openSettingsAfterSpawn,
    createdTick: globalTick,
    resolved: false,
    presetName: presetName ?? undefined,
    inventoryMode: inventoryMode ?? undefined,
  };
  pendingSpawnRequests.push(request);
  return request;
}
async function spawnBotWithPreset(player, presetName) {
  const validPresets = ["easy", "normal", "hard"];
  const preset = presetName?.toLowerCase()?.trim();
  if (!preset || !validPresets.includes(preset)) {
    player.sendMessage(`§c[PvPBot] 無効なプリセット: "${presetName ?? ""}"。有効: easy, normal, hard`);
    return;
  }
  const spawnLocation = getSpawnLocationNear(player);
  if (!spawnLocation) {
    player.sendMessage("§c[PvPBot] Bot を置ける安全な場所が近くにありません。");
    return;
  }
  if (globalSettings.boundaryEnabled && !isLocationInsideBotBoundary(spawnLocation)) {
    player.sendMessage(`§c[PvPBot] 召喚予定位置が安全範囲外です。`);
    return;
  }
  const request = queueSpawnRequest(player, spawnLocation, false, preset, "infinite");
  try {
    const result = await spawnEntityFromPlayer(player, BOT_TYPE, spawnLocation);
    appendPersistentDebugLog("probe", `spawnBotWithPreset preset=${preset} for ${player.name} status=${result?.statusMessage ?? "?"}`);
  } catch (error) {
    const idx = pendingSpawnRequests.findIndex(e => e.id === request.id);
    if (idx !== -1) pendingSpawnRequests.splice(idx, 1);
    player.sendMessage(`§c[PvPBot] 召喚に失敗: ${formatError(error)}`);
  }
}
function findBotByUid(uid) {
  const tag = `${BOT_UID_TAG_PREFIX}${uid}`;
  for (const dimension of getAllDimensions()) {
    try {
      for (const entity of dimension.getEntities()) {
        if (entity.typeId !== BOT_TYPE) {
          continue;
        }
        if (!entity.getTags().includes(tag)) {
          continue;
        }
        return entity;
      }
    } catch {}
  }
  return undefined;
}
function scheduleBotProbe(bot, label, uid = "") {
  const checkpoints = [1, 5, 20, 40];
  for (const delay of checkpoints) {
    system.runTimeout(() => {
      try {
        const usable = isEntityUsable(bot, BOT_TYPE);
        const scanned = uid ? findBotByUid(uid) : undefined;
        const meta = uid
          ? getTrackedBotMetaByUid(uid)
          : updateTrackedBotMeta(bot);
        if (!usable) {
          appendPersistentDebugLog(
            "probe",
            `${label}: unusable at +${delay} scanned=${scanned ? "yes" : "no"} ${describeTrackedBotMeta(meta)} nearbyBots=${summarizeNearbyBots(meta?.dimensionId, meta?.location, 10)} nearbyPlayers=${summarizeNearbyPlayers(meta?.dimensionId, meta?.location, 2.5)} ${describeBlockContext(meta?.dimensionId, meta?.location)}`,
          );
          return;
        }
        updateTrackedBotMeta(bot, { uid });
        const runtime = uid ? getRuntime(uid) : undefined;
        const seen = runtime?.lastSeenTick ?? -9999;
        appendPersistentDebugLog(
          "probe",
          `${label}: alive at +${delay} loc=${bot.location.x.toFixed(1)},${bot.location.y.toFixed(1)},${bot.location.z.toFixed(1)} lastSeen=${seen} scanned=${scanned ? "yes" : "no"} nearbyPlayers=${summarizeNearbyPlayers(bot.dimension, bot.location, 2.5)} ${describeBlockContext(bot.dimension, bot.location)}`,
        );
      } catch (error) {
        appendPersistentDebugLog(
          "probe",
          `${label}: probe failed at +${delay}: ${formatError(error)}`,
        );
      }
    }, delay);
  }
}
function matchPendingSpawnRequest(bot) {
  for (let index = pendingSpawnRequests.length - 1; index >= 0; index -= 1) {
    const request = pendingSpawnRequests[index];
    if (request.resolved) {
      continue;
    }
    if (request.dimensionId !== bot.dimension.id) {
      continue;
    }
    if (distance(bot.location, request.location) > 24) {
      continue;
    }
    request.resolved = true;
    pendingSpawnRequests.splice(index, 1);
    return request;
  }
  return undefined;
}
async function spawnEntityWithFallback(dimension, typeId, location) {
  let apiError;
  const summonIds =
    typeId === END_CRYSTAL_ENTITY_ID || typeId === END_CRYSTAL_ID
      ? ["end_crystal", "ender_crystal", END_CRYSTAL_ID, END_CRYSTAL_ENTITY_ID]
      : [typeId];
  let lastCommandError;
  for (const summonId of summonIds) {
    try {
      const command = `summon ${summonId} ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)}`;
      const result =
        typeof dimension.runCommandAsync === "function"
          ? await dimension.runCommandAsync(command)
          : await Promise.resolve(dimension.runCommand(command));
      return {
        successCount: result?.successCount ?? 1,
        statusMessage: result?.statusMessage ?? "",
        path: "command",
        entityId: "",
        apiError: apiError ? formatError(apiError) : "",
      };
    } catch (error) {
      lastCommandError = error;
    }
  }
  if (typeof dimension.spawnEntity === "function") {
    try {
      const entity = dimension.spawnEntity(typeId, location);
      return {
        successCount: 1,
        statusMessage: "spawnEntity",
        path: "api",
        entityId: entity?.id ?? "",
      };
    } catch (error) {
      apiError = error;
      appendPersistentDebugLog(
        "probe",
        `spawnEntity fallback for ${typeId}: ${formatError(error)}`,
      );
    }
  }
  throw lastCommandError ?? apiError ?? new Error(`spawn failed: ${typeId}`);
}
function patchIsCrystalEntity(entity) {
  const typeId = `${entity?.typeId ?? ""}`;
  return (
    PATCH_CRYSTAL_TYPE_IDS.has(typeId) || /end(?:er)?_crystal/.test(typeId)
  );
}
function patchGetNearbyCrystalEntities(dimension, location, maxDistance = 2) {
  try {
    return [...dimension.getEntities({ location, maxDistance })].filter(
      (entity) => patchIsCrystalEntity(entity),
    );
  } catch {
    return [];
  }
}
async function spawnEntityFromPlayer(player, typeId, location) {
  const command = `summon ${typeId} ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)}`;
  if (typeof player.runCommandAsync === "function") {
    const result = await player.runCommandAsync(command);
    return {
      successCount: result?.successCount ?? 1,
      statusMessage: result?.statusMessage ?? "",
      path: "player-command-async",
      entityId: "",
      apiError: "",
    };
  }
  if (typeof player.runCommand === "function") {
    const result = player.runCommand(command);
    return {
      successCount: result?.successCount ?? 1,
      statusMessage: result?.statusMessage ?? "",
      path: "player-command",
      entityId: "",
      apiError: "",
    };
  }
  return spawnEntityWithFallback(player.dimension, typeId, location);
}
function findClosestPlayer(location, dimension, maxDistance) {
  let best;
  let bestDistance = maxDistance * maxDistance;
  for (const player of getPlayersInDimension(dimension)) {
    const current = distanceSquared(player.location, location);
    if (current > bestDistance) {
      continue;
    }
    best = player;
    bestDistance = current;
  }
  return best;
}
function seedBotLoadout(bot) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  if (!inventory || !equippable) {
    return;
  }
  for (let index = 0; index < inventory.size; index += 1) {
    inventory.setItem(index, undefined);
  }
  inventory.addItem(
    applyEnchantments(
      new ItemStack("minecraft:netherite_sword", 1),
      BOT_SWORD_ENCHANTMENTS,
      true,
    ),
  );
  inventory.addItem(new ItemStack(OBSIDIAN_ID, 64));
  inventory.addItem(new ItemStack(END_CRYSTAL_ID, 16));
  inventory.addItem(new ItemStack(RESPAWN_ANCHOR_ID, 8));
  inventory.addItem(new ItemStack(GLOWSTONE_ID, 16));
  inventory.addItem(new ItemStack(ENDER_PEARL_ID, 16));
  inventory.addItem(new ItemStack(TOTEM_ID, 8));
  for (const armor of BOT_ARMOR) {
    equippable.setEquipment(
      armor.slot,
      applyEnchantments(
        new ItemStack(armor.itemId, 1),
        BOT_ARMOR_ENCHANTMENTS[armor.slot] ?? [],
        true,
      ),
    );
  }
  equippable.setEquipment(
    EquipmentSlot.Mainhand,
    applyEnchantments(
      new ItemStack("minecraft:netherite_sword", 1),
      BOT_SWORD_ENCHANTMENTS,
      true,
    ),
  );
  equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack(TOTEM_ID, 1));
  try {
    bot.setProperty("pvpbot:has_head_gear", false);
  } catch {}
}
function ensureBotInitialized(bot, ownerPlayer) {
  if (bot.typeId !== BOT_TYPE) {
    return undefined;
  }
  trackBot(bot);
  const owner =
    ownerPlayer ?? findClosestPlayer(bot.location, bot.dimension, 24);
  const config = materializeConfig(bot, owner);
  if (!bot.hasTag(BOT_READY_TAG)) {
    bot.addTag(BOT_READY_TAG);
    getRuntime(config.uid).spawnTick = globalTick;
    bot.nameTag = config.displayName || "Crystal Bot";
    seedBotLoadout(bot);
    syncBotLoadoutFromOwner(bot, config, true);
    logBotEvent(
      bot,
      `initialized at ${bot.location.x.toFixed(1)}, ${bot.location.y.toFixed(1)}, ${bot.location.z.toFixed(1)}`,
    );
  }
  return config;
}
function getAllBots() {
  const bots = [];
  for (const dimension of getAllDimensions()) {
    try {
      for (const entity of dimension.getEntities()) {
        if (entity.typeId === BOT_TYPE) {
          trackBot(entity);
          bots.push(entity);
        }
      }
    } catch {}
  }
  if (bots.length) {
    return bots;
  }
  for (const [id, bot] of trackedBots.entries()) {
    try {
      if (isEntityUsable(bot, BOT_TYPE)) {
        bots.push(bot);
      } else {
        trackedBots.delete(id);
      }
    } catch {
      trackedBots.delete(id);
    }
  }
  return bots;
}
function patchIsCombatTargetUsable(player, dimension) {
  if (!isEntityUsable(player, "minecraft:player")) {
    return false;
  }
  if (dimension && player.dimension?.id !== dimension.id) {
    return false;
  }
  if (patchGetCurrentHealthValue(player) <= 0.01) {
    return false;
  }
  try {
    const gameMode = player.getGameMode?.();
    if (
      gameMode &&
      gameMode !== GameMode.Survival &&
      gameMode !== GameMode.Adventure
    ) {
      return false;
    }
  } catch {}
  return true;
}
function patchResolveCombatTargetById(dimension, targetId) {
  if (!dimension || !targetId) {
    return undefined;
  }
  for (const player of getPlayersInDimension(dimension)) {
    if (
      player.id === targetId &&
      patchIsCombatTargetUsable(player, dimension)
    ) {
      return player;
    }
  }
  return undefined;
}
function patchResolvePendingCombatTarget(bot, pending, runtime) {
  if (!isEntityUsable(bot, BOT_TYPE) || !pending?.targetId) {
    return undefined;
  }
  return patchResolveCombatTargetById(bot.dimension, pending.targetId);
}
function findNearestTarget(bot) {
  let target;
  const config = botConfigs[getBotUid(bot)];
  const targetRange = Math.max(
    2,
    Number(config?.targetRange ?? MAX_TARGET_DISTANCE),
  );
  let bestDistance = targetRange * targetRange;
  for (const player of getPlayersInDimension(bot.dimension)) {
    if (!patchIsCombatTargetUsable(player, bot.dimension)) {
      continue;
    }
    const current = distanceSquared(player.location, bot.location);
    if (current > bestDistance) {
      continue;
    }
    target = player;
    bestDistance = current;
  }
  return target;
}
function tryPlayAnimation(bot, animation) {
  try {
    bot.playAnimation(animation);
  } catch {}
}
function selectBestSword(bot) {
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable || !inventory) {
    return SWORD_STATS["minecraft:netherite_sword"];
  }
  let bestStats = SWORD_STATS["minecraft:wooden_sword"];
  let bestItem;
  for (let index = 0; index < inventory.size; index += 1) {
    const item = inventory.getItem(index);
    const stats = item ? SWORD_STATS[item.typeId] : undefined;
    if (!stats || stats.score < bestStats.score) {
      continue;
    }
    bestStats = stats;
    bestItem = item;
  }
  if (bestItem) {
    equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(bestItem));
  }
  return bestStats;
}
function ensureAutoTotem(bot, config) {
  if (!config.autoTotem) {
    return;
  }
  const equippable = bot.getComponent(EntityComponentTypes.Equippable);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable || !inventory) {
    return;
  }
  const offhand = equippable.getEquipment(EquipmentSlot.Offhand);
  if (offhand?.typeId === TOTEM_ID) {
    return;
  }
  let foundSlot = -1;
  for (let index = 0; index < inventory.size; index += 1) {
    if (inventory.getItem(index)?.typeId === TOTEM_ID) {
      foundSlot = index;
      break;
    }
  }
  if (foundSlot === -1) {
    syncBotLoadoutFromOwner(bot, config, true);
    for (let index = 0; index < inventory.size; index += 1) {
      if (inventory.getItem(index)?.typeId === TOTEM_ID) {
        foundSlot = index;
        break;
      }
    }
    if (foundSlot === -1) {
      debugLog(
        bot,
        config,
        "totem",
        "トーテムが見つからないため補充できません。",
      );
      return;
    }
  }
  const stack = inventory.getItem(foundSlot);
  inventory.setItem(foundSlot, undefined);
  if (offhand) {
    inventory.addItem(offhand);
  }
  equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack(TOTEM_ID, 1));
  if (stack && stack.amount > 1) {
    inventory.addItem(new ItemStack(TOTEM_ID, stack.amount - 1));
  }
  debugLog(
    bot,
    config,
    "totem",
    `オフハンドへトーテムを補充しました (slot ${foundSlot})`,
    true,
  );
}
function handleMovement(bot, target, config) {
  const runtime = getRuntime(config.uid);
  const grounded = findNearestStandingLocation(bot.dimension, bot.location);
  if (grounded && distanceSquared(grounded, bot.location) > 0.0001) {
    try {
      bot.teleport(grounded, {
        dimension: bot.dimension,
        facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
    } catch {}
  }
  const toTarget = vectorTo(bot.location, target.location);
  let planar = normalize2D(toTarget);
  const currentDistance = distance(bot.location, target.location);
  if (Math.abs(planar.x) < 0.0001 && Math.abs(planar.z) < 0.0001) {
    const fallback = normalize2D(
      target.getViewDirection?.() ?? { x: 1, y: 0, z: 0 },
    );
    planar =
      Math.abs(fallback.x) < 0.0001 && Math.abs(fallback.z) < 0.0001
        ? { x: 1, y: 0, z: 0 }
        : { x: -fallback.x, y: 0, z: -fallback.z };
  }
  const targetEyeLocation = patchApplyAimJitter(
    addVector(target.location, { x: 0, y: 1.1, z: 0 }),
    config,
  );
  faceBotToward(bot, targetEyeLocation);
  setBotLookAt(bot, targetEyeLocation);
  try {
    bot.addEffect("speed", 6, { amplifier: 1, showParticles: false });
  } catch {}
  if (globalTick >= runtime.nextStrafeFlipTick) {
    runtime.strafeDirection *= -1;
    runtime.nextStrafeFlipTick = globalTick + STRAFE_FLIP_INTERVAL;
  }
  const strafe = {
    x: -planar.z * runtime.strafeDirection,
    y: 0,
    z: planar.x * runtime.strafeDirection,
  };
  const impulse = { x: strafe.x * 0.05, y: 0, z: strafe.z * 0.05 };
  const distanceError = currentDistance - config.maintainDistance;
  const radialStrength = Math.max(-0.16, Math.min(0.18, distanceError * 0.16));
  impulse.x += planar.x * radialStrength;
  impulse.z += planar.z * radialStrength;
  try {
    bot.applyImpulse(impulse);
  } catch {}
  const moveDirection = normalize2D(impulse);
  const moveStep = Math.max(
    0.16,
    Math.min(0.35, Math.hypot(impulse.x, impulse.z) * 1.8),
  );
  const stepLocation = addVector(bot.location, {
    x: moveDirection.x * moveStep,
    y: 0,
    z: moveDirection.z * moveStep,
  });
  const candidateY = [0, 1, -1];
  for (const offsetY of candidateY) {
    const candidate = addVector(stepLocation, { x: 0, y: offsetY, z: 0 });
    if (!isSafeStandingLocation(bot.dimension, candidate)) {
      continue;
    }
    try {
      bot.teleport(candidate, {
        dimension: bot.dimension,
        facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
      break;
    } catch {}
  }
  debugLog(
    bot,
    config,
    "movement",
    `距離=${currentDistance.toFixed(2)} strafe=${runtime.strafeDirection > 0 ? "R" : "L"}`,
  );
}
function findPearlLandingSpot(bot, target) {
  const velocity = target.getVelocity?.() ?? { x: 0, y: 0, z: 0 };
  const predicted = addVector(target.location, {
    x: velocity.x * PEARL_PREDICTION_TICKS,
    y: 0,
    z: velocity.z * PEARL_PREDICTION_TICKS,
  });
  const origin = floorLocation(predicted);
  for (let radius = 0; radius <= 2; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        const location = {
          x: origin.x + x + 0.5,
          y: origin.y,
          z: origin.z + z + 0.5,
        };
        if (isSafeStandingLocation(bot.dimension, location)) {
          return location;
        }
      }
    }
  }
  return undefined;
}
function handlePearlMove(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (
    !config.pearlMove ||
    globalTick - runtime.lastPearlTick < config.pearlCooldown
  ) {
    return;
  }
  const currentDistance = distance(bot.location, target.location);
  if (currentDistance <= config.pearlDistance) {
    return;
  }
  const landingSpot = findPearlLandingSpot(bot, target);
  if (!landingSpot) {
    debugLog(bot, config, "movement", "安全なパール着地点が見つかりません。");
    return;
  }
  runtime.lastPearlTick = globalTick;
  const token = `${config.uid}:${globalTick}`;
  runtime.pendingPearlToken = token;
  equipMainhandItem(bot, ENDER_PEARL_ID);
  faceBotToward(bot, landingSpot);
  try {
    bot.dimension.spawnEntity(
      ENDER_PEARL_ID,
      addVector(bot.location, { x: 0, y: 1.45, z: 0 }),
    );
  } catch {}
  debugLog(
    bot,
    config,
    "movement",
    `パール移動を実行: (${landingSpot.x.toFixed(1)}, ${landingSpot.y.toFixed(1)}, ${landingSpot.z.toFixed(1)})`,
    true,
  );
  system.runTimeout(() => {
    if (runtime.pendingPearlToken !== token) {
      return;
    }
    try {
      bot.teleport(landingSpot, {
        dimension: bot.dimension,
        facingLocation: target.location,
      });
    } catch {}
  }, PEARL_VISUAL_DELAY);
}
function handleSwordCombo(bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return;
  }
  const currentDistance = distance(bot.location, target.location);
  if (
    !config.swordCombo ||
    currentDistance > SWORD_RANGE ||
    currentDistance > MAX_INTERACT_DISTANCE
  ) {
    return;
  }
  if (globalTick - runtime.lastSwordTick < config.swordCooldown) {
    return;
  }
  runtime.lastSwordTick = globalTick;
  const swordStats = selectBestSword(bot);
  const direction = normalize2D(vectorTo(bot.location, target.location));
  faceBotToward(bot, addVector(target.location, { x: 0, y: 1.2, z: 0 }));
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  try {
    target.applyDamage(swordStats.damage);
  } catch {}
  try {
    target.applyImpulse({
      x: direction.x * 0.18,
      y: 0.04,
      z: direction.z * 0.18,
    });
  } catch {}
  debugLog(
    bot,
    config,
    "combat",
    `剣コンボ命中: damage=${swordStats.damage}`,
    true,
  );
}
function scanCrystalCandidates(bot, target, config) {
  const targetFeet = floorLocation(target.location);
  const baseYCandidates = patchGetCombatBaseYCandidates(target, bot);
  const preferredBaseY = baseYCandidates[0] ?? targetFeet.y - 1;
  const candidates = [];
  const seen = new Set();
  for (const offset of CRYSTAL_OFFSETS) {
    for (const baseY of baseYCandidates) {
      const candidate = {
        x: targetFeet.x + offset.x,
        y: baseY,
        z: targetFeet.z + offset.z,
      };
      const key = `${candidate.x}|${candidate.y}|${candidate.z}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!isLocationInsideBotBoundary(candidate)) {
        continue;
      }
      const centerDistance = Math.hypot(
        candidate.x + 0.5 - (targetFeet.x + 0.5),
        candidate.z + 0.5 - (targetFeet.z + 0.5),
      );
      const crystalLocation = getExplosionLocation(candidate, "crystal");
      const crystalHorizontalDistance = Math.hypot(
        crystalLocation.x - target.location.x,
        crystalLocation.z - target.location.z,
      );
      if (
        centerDistance < CRYSTAL_SCAN_MIN ||
        centerDistance > CRYSTAL_SCAN_MAX + 0.8
      ) {
        continue;
      }
      if (crystalHorizontalDistance < 1.28) {
        continue;
      }
      if (distance(bot.location, crystalLocation) > MAX_INTERACT_DISTANCE) {
        continue;
      }
      const placeBlock = getBlock(bot.dimension, candidate);
      const above = getBlock(
        bot.dimension,
        addVector(candidate, { x: 0, y: 1, z: 0 }),
      );
      const below = getBlock(
        bot.dimension,
        addVector(candidate, { x: 0, y: -1, z: 0 }),
      );
      let placementMode;
      if (
        isCrystalBaseBlock(placeBlock) &&
        isAirBlock(above) &&
        isAirBlock(
          getBlock(bot.dimension, addVector(candidate, { x: 0, y: 2, z: 0 })),
        )
      ) {
        placementMode = "existing-base";
      } else if (
        isAirBlock(placeBlock) &&
        isAirBlock(above) &&
        isSolidBlock(below)
      ) {
        placementMode = "place-obsidian";
      } else {
        continue;
      }
      if (
        isCombatPlacementBlocked(
          bot.dimension,
          candidate,
          "crystal",
          target,
          bot,
        )
      ) {
        continue;
      }
      if (
        placementMode === "place-obsidian" &&
        isBlockPlacementBlocked(bot.dimension, candidate, target, bot)
      ) {
        continue;
      }
      const targetDamage = estimateExplosionDamageScore(
        target,
        crystalLocation,
        CRYSTAL_DAMAGE_SCORE_RADIUS,
        "crystal",
      );
      const selfDamage = estimateExplosionDamageScore(
        bot,
        crystalLocation,
        CRYSTAL_DAMAGE_SCORE_RADIUS,
        "crystal",
      );
      if (targetDamage < 2.2) {
        continue;
      }
      if (
        !patchIsExplosionCandidateSafe(
          bot,
          config,
          targetDamage,
          selfDamage,
          "crystal",
        )
      ) {
        continue;
      }
      const groundYOffsetPenalty =
        Math.abs(candidate.y - preferredBaseY) * 1.35;
      candidates.push({
        location: candidate,
        placementMode,
        explosionLocation: crystalLocation,
        targetDamage,
        selfDamage,
        score:
          targetDamage * 2.1 -
          selfDamage * 1.45 -
          distance(crystalLocation, bot.location) * 0.2 -
          groundYOffsetPenalty +
          (placementMode === "existing-base" ? 5.0 : 0.15),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) {
    debugLog(
      bot,
      config,
      "scan",
      `crystal候補=${candidates.length} best=(${candidates[0].location.x}, ${candidates[0].location.y}, ${candidates[0].location.z}) ${describeDamageTrade(candidates[0].targetDamage, candidates[0].selfDamage)}`,
    );
  }
  return candidates;
}
function scanAnchorCandidates(bot, target, config) {
  const targetFeet = floorLocation(target.location);
  const baseYCandidates = patchGetCombatBaseYCandidates(target, bot);
  const preferredBaseY = baseYCandidates[0] ?? targetFeet.y - 1;
  const candidates = [];
  const seen = new Set();
  for (const offset of CRYSTAL_OFFSETS) {
    for (const baseY of baseYCandidates) {
      const candidate = {
        x: targetFeet.x + offset.x,
        y: baseY,
        z: targetFeet.z + offset.z,
      };
      const key = `${candidate.x}|${candidate.y}|${candidate.z}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (!isLocationInsideBotBoundary(candidate)) {
        continue;
      }
      const centerDistance = Math.hypot(
        candidate.x + 0.5 - target.location.x,
        candidate.z + 0.5 - target.location.z,
      );
      const anchorLocation = getExplosionLocation(candidate, "anchor");
      const anchorDamageEstimationLocation = {
        x: candidate.x + 0.5,
        y: candidate.y + 0.0,
        z: candidate.z + 0.5,
      };
      if (centerDistance < 1.05 || centerDistance > 2.3) {
        continue;
      }
      if (distance(bot.location, anchorLocation) > MAX_INTERACT_DISTANCE) {
        continue;
      }
      const place = getBlock(bot.dimension, candidate);
      const above = getBlock(
        bot.dimension,
        addVector(candidate, { x: 0, y: 1, z: 0 }),
      );
      const below = getBlock(
        bot.dimension,
        addVector(candidate, { x: 0, y: -1, z: 0 }),
      );
      let placementMode;
      let existingCharge = 0;
      if (isRespawnAnchorBlock(place)) {
        placementMode = "existing-anchor";
        existingCharge = getRespawnAnchorCharge(place);
      } else if (
        isAirBlock(place) &&
        isAirBlock(above) &&
        isSolidBlock(below)
      ) {
        placementMode = "place-anchor";
      } else {
        continue;
      }
      if (
        isCombatPlacementBlocked(
          bot.dimension,
          candidate,
          "anchor",
          target,
          bot,
        )
      ) {
        continue;
      }
      const targetDamage = estimateExplosionDamageScore(
        target,
        anchorDamageEstimationLocation,
        ANCHOR_DAMAGE_SCORE_RADIUS,
        "anchor",
      );
      const selfDamage = estimateExplosionDamageScore(
        bot,
        anchorDamageEstimationLocation,
        ANCHOR_DAMAGE_SCORE_RADIUS,
        "anchor",
      );
      if (targetDamage < 1.8) {
        continue;
      }
      if (
        !patchIsExplosionCandidateSafe(
          bot,
          config,
          targetDamage,
          selfDamage,
          "anchor",
        )
      ) {
        continue;
      }
      const groundYOffsetPenalty =
        Math.abs(candidate.y - preferredBaseY) * 1.15;
      candidates.push({
        location: candidate,
        placementMode,
        existingCharge,
        explosionLocation: anchorLocation,
        targetDamage,
        selfDamage,
        score:
          targetDamage * 2 -
          selfDamage * 1.7 -
          distance(anchorLocation, bot.location) * 0.15 -
          groundYOffsetPenalty +
          (placementMode === "existing-anchor" ? 0.35 : 0) +
          Math.min(existingCharge, 1) * 0.25,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) {
    debugLog(
      bot,
      config,
      "scan",
      `anchor候補=${candidates.length} best=(${candidates[0].location.x}, ${candidates[0].location.y}, ${candidates[0].location.z}) ${describeDamageTrade(candidates[0].targetDamage, candidates[0].selfDamage)}`,
    );
  }
  return candidates;
}
function chooseBestExplosiveAction(bot, target, config) {
  if (patchShouldDelayAction(config, "explosive")) {
    return undefined;
  }
  if (config.humanize && patchRandomChance(config.mistakeRate)) {
    debugLog(bot, config, "combat", "爆破行動を見送りました。", true);
    return undefined;
  }
  const crystal = config.crystalCombo
    ? patchPickHumanizedCandidate(
        scanCrystalCandidates(bot, target, config),
        config,
      )
    : undefined;
  const anchor = shouldUseAnchorCombo(bot, target, config)
    ? patchPickHumanizedCandidate(
        scanAnchorCandidates(bot, target, config),
        config,
      )
    : undefined;
  if (anchor && crystal) {
    const isTargetAbove = target.location.y > bot.location.y + 0.5;
    const isTargetBelow = target.location.y < bot.location.y - 0.5;
    let anchorScore =
      anchor.targetDamage -
      anchor.selfDamage * 0.85 +
      (distance(bot.location, target.location) <= 2.2 ? 0.45 : 0);
    let crystalScore = crystal.targetDamage - crystal.selfDamage * 0.65 + 0.2;
    const yDiff = target.location.y - bot.location.y;
    if (yDiff >= 0.5) crystalScore += 100.0;
    else anchorScore += 100.0;
    return crystalScore >= anchorScore
      ? { type: "crystal", candidate: crystal }
      : { type: "anchor", candidate: anchor };
  }
  if (crystal) {
    return { type: "crystal", candidate: crystal };
  }
  if (anchor) {
    return { type: "anchor", candidate: anchor };
  }
  return undefined;
}
function handleAnchorCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return false;
  }
  if (!shouldUseAnchorCombo(bot, target, config)) {
    return false;
  }
  if (
    globalTick - runtime.lastAnchorTick < config.anchorCooldown ||
    runtime.pendingAnchor
  ) {
    return false;
  }
  const best =
    selectedCandidate ?? scanAnchorCandidates(bot, target, config)[0];
  if (!best) {
    return false;
  }
  runtime.lastAnchorTick = globalTick;
  runtime.pendingAnchor = { base: best.location };
  equipMainhandItem(bot, RESPAWN_ANCHOR_ID);
  faceBotToward(bot, {
    x: best.location.x + 0.5,
    y: best.location.y + 0.5,
    z: best.location.z + 0.5,
  });
  setRespawnAnchorChargeWithFallback(bot.dimension, best.location, 0);
  debugLog(
    bot,
    config,
    "combat",
    `アンカー設置: (${best.location.x}, ${best.location.y}, ${best.location.z})`,
    true,
  );
  system.runTimeout(() => {
    const pending = runtime.pendingAnchor;
    if (!pending) {
      return;
    }
    equipMainhandItem(bot, GLOWSTONE_ID);
    setRespawnAnchorChargeWithFallback(
      bot.dimension,
      pending.base,
      RESPAWN_ANCHOR_MAX_CHARGE,
    );
    debugLog(bot, config, "combat", "アンカーをチャージしました。");
  }, 1);
  system.runTimeout(async () => {
    const pending = runtime.pendingAnchor;
    runtime.pendingAnchor = undefined;
    if (!pending) {
      return;
    }
    const anchorLocation = getExplosionLocation(pending.base, "anchor");
    try {
      await runAnchorExplosionWithFallback(bot.dimension, pending.base, bot, {
        ignoreCenterAnchorChange: true,
      });
    } catch {}
    try {
      const centerBlock = getBlock(bot.dimension, pending.base);
      if (isRespawnAnchorBlock(centerBlock)) {
        await setBlockIdWithFallback(bot.dimension, pending.base, AIR_ID);
      }
    } catch {}
    selectBestSword(bot);
    debugLog(
      bot,
      config,
      "combat",
      `アンカー爆破を実行しました。 ${describeDamageTrade(estimateExplosionDamageScore(target, anchorLocation, ANCHOR_DAMAGE_SCORE_RADIUS), estimateExplosionDamageScore(bot, anchorLocation, ANCHOR_DAMAGE_SCORE_RADIUS))}`,
      true,
    );
  }, 2);
  return true;
}
function handleCrystalCombo(bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return false;
  }
  if (!config.crystalCombo) {
    return false;
  }
  if (
    globalTick - runtime.lastCrystalTick < config.crystalCooldown ||
    runtime.pendingCrystal
  ) {
    return false;
  }
  const best =
    selectedCandidate ?? scanCrystalCandidates(bot, target, config)[0];
  if (!best) {
    return false;
  }
  runtime.lastCrystalTick = globalTick;
  runtime.pendingCrystal = {
    base: best.location,
    previousPermutation: undefined,
    placementMode: best.placementMode,
  };
  faceBotToward(bot, {
    x: best.location.x + 0.5,
    y: best.location.y + 0.5,
    z: best.location.z + 0.5,
  });
  const baseBlock = getBlock(bot.dimension, best.location);
  if (
    best.placementMode === "existing-base" &&
    !isCrystalBaseBlock(baseBlock)
  ) {
    debugLog(
      bot,
      config,
      "combat",
      "既存土台が無効になったためクリスタル設置を中止しました。",
    );
    runtime.pendingCrystal = undefined;
    return false;
  }
  if (best.placementMode === "place-obsidian") {
    if (
      !isAirBlock(baseBlock) ||
      !isSolidBlock(
        getBlock(
          bot.dimension,
          addVector(best.location, { x: 0, y: -1, z: 0 }),
        ),
      )
    ) {
      debugLog(
        bot,
        config,
        "combat",
        "黒曜石を合法設置できないためクリスタル設置を中止しました。",
      );
      runtime.pendingCrystal = undefined;
      return false;
    }
    equipMainhandItem(bot, OBSIDIAN_ID, config);
    try {
      runtime.pendingCrystal.previousPermutation = baseBlock?.permutation;
    } catch {}
    setBlockIdWithFallback(bot.dimension, best.location, OBSIDIAN_ID);
    debugLog(
      bot,
      config,
      "combat",
      `黒曜石設置: (${best.location.x}, ${best.location.y}, ${best.location.z})`,
      true,
    );
  } else {
    debugLog(
      bot,
      config,
      "combat",
      `既存土台を使用: (${best.location.x}, ${best.location.y}, ${best.location.z})`,
    );
  }
  system.runTimeout(() => {
    const pending = runtime.pendingCrystal;
    runtime.pendingCrystal = undefined;
    if (!pending) {
      return;
    }
    const crystalLocation = getExplosionLocation(pending.base, "crystal");
    let crystal;
    equipMainhandItem(bot, END_CRYSTAL_ID);
    try {
      crystal = bot.dimension.spawnEntity(END_CRYSTAL_ID, crystalLocation);
    } catch {
      debugLog(
        bot,
        config,
        "combat",
        "クリスタル召喚に失敗したため爆破を中止しました。",
      );
      try {
        if (
          pending.placementMode === "place-obsidian" &&
          pending.previousPermutation
        ) {
          getBlock(bot.dimension, pending.base)?.setPermutation(
            pending.previousPermutation,
          );
        }
      } catch {}
      return;
    }
    if (!isEntityUsable(crystal, END_CRYSTAL_ID)) {
      debugLog(
        bot,
        config,
        "combat",
        "クリスタル実体が無効のため爆破を中止しました。",
      );
      try {
        if (
          pending.placementMode === "place-obsidian" &&
          pending.previousPermutation
        ) {
          getBlock(bot.dimension, pending.base)?.setPermutation(
            pending.previousPermutation,
          );
        }
      } catch {}
      return;
    }
    try {
      bot.dimension.createExplosion(crystalLocation, CRYSTAL_POWER, {
        breaksBlocks: false,
        causesFire: false,
        source: bot,
      });
    } catch {}
    try {
      crystal.remove();
    } catch {}
    selectBestSword(bot);
    setBotLookAt(bot, addVector(target.location, { x: 0, y: 1.1, z: 0 }));
    debugLog(
      bot,
      config,
      "combat",
      `クリスタル爆破を実行しました。 ${describeDamageTrade(estimateExplosionDamageScore(target, crystalLocation, CRYSTAL_DAMAGE_SCORE_RADIUS), estimateExplosionDamageScore(bot, crystalLocation, CRYSTAL_DAMAGE_SCORE_RADIUS))}`,
      true,
    );
  }, 1);
  return true;
}
function tickBots() {
  globalTick += 1;
  for (const [id, bot] of trackedBots.entries()) {
    if (isEntityUsable(bot, BOT_TYPE)) {
      updateTrackedBotMeta(bot);
      continue;
    }
    const meta = trackedBotMetaById.get(id);
    if (!meta?.invalidLoggedTick) {
      appendPersistentDebugLog(
        "probe",
        `tracked invalid ${describeTrackedBotMeta(meta)} nearbyBots=${summarizeNearbyBots(meta?.dimensionId, meta?.location, 10)} nearbyPlayers=${summarizeNearbyPlayers(meta?.dimensionId, meta?.location, 2.5)} ${describeBlockContext(meta?.dimensionId, meta?.location)}`,
      );
      trackedBotMetaById.set(id, {
        ...meta,
        invalidLoggedTick: globalTick,
      });
    }
    trackedBots.delete(id);
  }
  for (const bot of getAllBots()) {
    try {
      if (!patchMobGriefingEnabled) {
        patchEnsureMobGriefingEnabled(bot.dimension);
      }
      const config = ensureBotInitialized(bot);
      if (config && enforceBotBoundary(bot, config)) {
        continue;
      }
      if (!config?.enabled) {
        continue;
      }
      if (enforceBotBoundary(bot, config)) {
        continue;
      }
      updateTrackedBotMeta(bot, { uid: config.uid });
      const runtime = getRuntime(config.uid);
      runtime.lastSeenTick = globalTick;
      const tickInterval = Math.max(
        1,
        Math.min(4, Math.floor(Number(config.tickInterval ?? 1))),
      );
      if (
        tickInterval > 1 &&
        (globalTick + Math.abs(hashString(config.uid))) % tickInterval !== 0
      ) {
        continue;
      }
      syncBotLoadoutFromOwner(bot, config);
      ensureBotEquipmentIntegrity(bot, config);
      ensureAutoTotem(bot, config);
      const target = findNearestTarget(bot);
      if (!target) {
        runtime.pendingAnchor = undefined;
        runtime.pendingCrystal = undefined;
        if (runtime.lastTargetId) {
          runtime.lastTargetId = "";
          logBotEvent(bot, "target lost");
        } else if ((runtime.lastNoTargetLogTick ?? -9999) + 40 <= globalTick) {
          runtime.lastNoTargetLogTick = globalTick;
          appendPersistentDebugLog(
            "bot",
            `${config.displayName || config.uid}: no target in range`,
          );
        }
        continue;
      }
      if (runtime.lastTargetId !== target.id) {
        runtime.lastTargetId = target.id;
        logBotEvent(bot, `target acquired: ${target.name}`);
      }
      handlePearlMove(bot, target, config);
      handleMovement(bot, target, config);
      const explosiveAction = chooseBestExplosiveAction(bot, target, config);
      if (explosiveAction?.type === "anchor") {
        if (handleAnchorCombo(bot, target, config, explosiveAction.candidate)) {
          continue;
        }
      } else if (explosiveAction?.type === "crystal") {
        if (
          handleCrystalCombo(bot, target, config, explosiveAction.candidate)
        ) {
          continue;
        }
      }
      handleSwordCombo(bot, target, config);
    } catch (error) {
      appendPersistentDebugLog("error", `tick failed: ${formatError(error)}`);
      console.warn(`[PvPBot] tick failed: ${formatError(error)}`);
    }
  }
  for (let index = pendingSpawnRequests.length - 1; index >= 0; index -= 1) {
    if (globalTick - pendingSpawnRequests[index].createdTick > 40) {
      pendingSpawnRequests.splice(index, 1);
    }
  }
}
function startBotLoop() {
  if (!botLoopStarted) {
    botLoopStarted = true;
    system.runInterval(tickBots, 1);
  }
}
function getSpawnLocationNear(player) {
  const base = floorLocation(player.location);
  const view = player.getViewDirection?.() ?? { x: 1, y: 0, z: 0 };
  const normalizedView = normalize2D(view);
  const offsets = [
    { x: normalizedView.x * 2, z: normalizedView.z * 2 },
    { x: normalizedView.x * 3, z: normalizedView.z * 3 },
    { x: normalizedView.x * 4, z: normalizedView.z * 4 },
    { x: 2, z: 0 },
    { x: -2, z: 0 },
    { x: 0, z: 2 },
    { x: 0, z: -2 },
    { x: 2, z: 2 },
    { x: -2, z: 2 },
    { x: 2, z: -2 },
    { x: -2, z: -2 },
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 0, z: 0 },
  ];
  for (const offset of offsets) {
    for (const yOffset of [1, 0, 2, -1, -2]) {
      const location = {
        x: base.x + offset.x + 0.5,
        y: base.y + yOffset,
        z: base.z + offset.z + 0.5,
      };
      if (!isSafeStandingLocation(player.dimension, location)) {
        continue;
      }
      if (isLocationOccupiedByPlayer(player.dimension, location)) {
        continue;
      }
      return location;
    }
  }
  for (const offset of offsets) {
    for (const yOffset of [1, 0, 2, -1, -2]) {
      const location = {
        x: base.x + offset.x + 0.5,
        y: base.y + yOffset,
        z: base.z + offset.z + 0.5,
      };
      if (isSafeStandingLocation(player.dimension, location)) {
        return location;
      }
    }
  }
  return undefined;
}
function logSpawnLocationContext(player, location) {
  appendPersistentDebugLog(
    "probe",
    `spawn context for ${player.name}: loc=${formatLocation(location)} players=${summarizeNearbyPlayers(player.dimension, location, 2.5)} nearbyBots=${summarizeNearbyBots(player.dimension, location, 10)} ${describeBlockContext(player.dimension, location)}`,
  );
}
function getNearbyBots(player, radius = 32) {
  return getAllBots()
    .filter((bot) => bot.dimension.id === player.dimension.id)
    .filter(
      (bot) =>
        !Number.isFinite(radius) ||
        distance(bot.location, player.location) <= radius,
    )
    .sort(
      (a, b) =>
        distance(a.location, player.location) -
        distance(b.location, player.location),
    );
}
function getBotLabel(bot) {
  const uid = getBotUid(bot);
  const config = botConfigs[uid];
  return `${config?.displayName ?? bot.nameTag ?? "Crystal Bot"} (${uid.slice(-4)})`;
}
async function showHelpForm(player) {
  await new ActionFormData()
    .title("Crystal PvP Bot")
    .body(
      "1. /bot で Bot メニューを開きます。\n2. /pvpbot:spawn または /summon pvpbot:crystal_bot で Bot を出せます。\n3. 安全範囲設定は /bot のメニューから変更できます。\n4. 1人ワールドでは Bot が自動であなたをターゲットします。",
    )
    .button("閉じる")
    .show(player);
}
async function openSettingsForm(player, defaultIndex = 0) {
  const nearbyBots = getNearbyBots(player, Number.POSITIVE_INFINITY);
  if (!nearbyBots.length) {
    player.sendMessage("§c設定できる PvP Bot がいません。");
    logSystem(`openSettingsForm: no nearby bots for ${player.name}`);
    return;
  }
  const safeIndex = Math.max(0, Math.min(defaultIndex, nearbyBots.length - 1));
  const pickerForm = new ActionFormData()
    .title("Select Bot")
    .body("設定する Bot を選択してください。");
  for (const bot of nearbyBots) {
    pickerForm.button(getBotLabel(bot));
  }
  const picker = await pickerForm.show(player);
  if (picker.canceled) {
    logSystem(`openSettingsForm: picker canceled by ${player.name}`);
    return;
  }
  const pickedIndex =
    typeof picker.selection === "number" ? picker.selection : safeIndex;
  const selectedBot = nearbyBots[pickedIndex];
  const config = ensureBotInitialized(selectedBot, player);
  if (!config) {
    logSystem(
      `openSettingsForm: ensureBotInitialized failed for ${player.name}`,
    );
    return;
  }
  const form = new ModalFormData()
    .title("PvP Bot Settings")
    .toggle("Bot を有効化", { defaultValue: config.enabled })
    .slider("維持距離", 1, 6, {
      valueStep: 1,
      defaultValue: config.maintainDistance,
    })
    .slider("敵認識範囲", 4, 32, {
      valueStep: 1,
      defaultValue: config.targetRange ?? MAX_TARGET_DISTANCE,
    })
    .slider("パール発動距離", 8, 16, {
      valueStep: 2,
      defaultValue: config.pearlDistance,
    })
    .slider("パール CD", 0, 80, {
      valueStep: 5,
      defaultValue: config.pearlCooldown,
    })
    .slider("剣 CD", 0, 25, {
      valueStep: 1,
      defaultValue: config.swordCooldown,
    })
    .slider("クリスタル CD", 0, 25, {
      valueStep: 1,
      defaultValue: config.crystalCooldown,
    })
    .slider("クリスタル起爆遅延", 0, 10, {
      valueStep: 1,
      defaultValue: config.crystalDetonateDelay,
    })
    .slider("アンカー CD", 0, 25, {
      valueStep: 1,
      defaultValue: config.anchorCooldown,
    })
    .slider("アンカー起爆遅延", 0, 10, {
      valueStep: 1,
      defaultValue: config.anchorDetonateDelay,
    })
    .slider("トーテム再装填遅延", 0, 20, {
      valueStep: 1,
      defaultValue: config.totemRefillDelay,
    })
    .toggle("Humanize", { defaultValue: config.humanize })
    .slider("反応遅延", 0, 12, {
      valueStep: 1,
      defaultValue: config.reactionDelay,
    })
    .slider("エイム揺れ", 0, 0.3, {
      valueStep: 0.01,
      defaultValue: config.aimJitter,
    })
    .slider("ミス率 %", 0, 30, {
      valueStep: 1,
      defaultValue: config.mistakeRate,
    })
    .slider("準最適行動率 %", 0, 60, {
      valueStep: 1,
      defaultValue: config.suboptimalRate,
    })
    .toggle("Jump Dash", { defaultValue: config.jumpDash })
    .slider("更新間隔", 1, 4, {
      valueStep: 1,
      defaultValue: config.tickInterval,
    })
    .toggle("Auto Totem", { defaultValue: config.autoTotem })
    .toggle("Owner 装備同期", { defaultValue: config.mirrorOwnerLoadout })
    .toggle("Pearl Move", { defaultValue: config.pearlMove })
    .toggle("Sword Combo", { defaultValue: config.swordCombo })
    .toggle("Crystal Combo", { defaultValue: config.crystalCombo })
    .toggle("Anchor Combo", { defaultValue: config.anchorCombo })
    .toggle("Debug 全体", { defaultValue: config.debug.enabled })
    .toggle("Debug Movement", { defaultValue: config.debug.movement })
    .toggle("Debug Scan", { defaultValue: config.debug.scan })
    .toggle("Debug Combat", { defaultValue: config.debug.combat })
    .toggle("Debug Totem", { defaultValue: config.debug.totem });
  const response = await form.show(player);
  if (response.canceled || !response.formValues) {
    logSystem(`openSettingsForm: settings canceled by ${player.name}`);
    return;
  }
  const [
    enabled,
    maintainDistance,
    targetRange,
    pearlDistance,
    pearlCooldown,
    swordCooldown,
    crystalCooldown,
    crystalDetonateDelay,
    anchorCooldown,
    totemRefillDelay,
    autoTotem,
    mirrorOwnerLoadout,
    pearlMove,
    swordCombo,
    crystalCombo,
    anchorCombo,
    debugEnabled,
    debugMovement,
    debugScan,
    debugCombat,
    debugTotem,
  ] = response.formValues;
  const bot = selectedBot;
  const current = ensureBotInitialized(bot, player);
  if (!current) {
    logSystem(
      `openSettingsForm: current bot invalid after modal for ${player.name}`,
    );
    return;
  }
  const updated = persistBotConfig(bot, {
    ...current,
    ownerName: player.name,
    enabled,
    maintainDistance,
    targetRange,
    pearlDistance,
    pearlCooldown,
    swordCooldown,
    crystalCooldown,
    crystalDetonateDelay,
    anchorCooldown,
    anchorDetonateDelay,
    anchorBreakCache,
    totemRefillDelay,
    humanize,
    reactionDelay,
    aimJitter,
    mistakeRate,
    suboptimalRate,
    jumpDash,
    tickInterval,
    autoRestockCombatItems,
    autoTotem,
    mirrorOwnerLoadout,
    pearlMove,
    swordCombo,
    crystalCombo,
    anchorCombo,
    debug: {
      enabled: debugEnabled,
      movement: debugMovement,
      scan: debugScan,
      combat: debugCombat,
      totem: debugTotem,
    },
  });
  bot.nameTag = updated.displayName || "Crystal Bot";
  player.sendMessage(`§a${getBotLabel(bot)} の設定を保存しました。`);
  logBotEvent(bot, `settings saved by ${player.name}`);
}
async function spawnBotForPlayer(player, openSettingsAfterSpawn = false) {
  const spawnLocation = getSpawnLocationNear(player);
  if (!spawnLocation) {
    appendPersistentDebugLog(
      "error",
      `safe spawn location not found for ${player.name}`,
    );
    player.sendMessage("§c[PvPBot] Bot を置ける安全な場所が近くにありません。");
    return;
  }
  if (
    globalSettings.boundaryEnabled &&
    !isLocationInsideBotBoundary(spawnLocation)
  ) {
    player.sendMessage(
      `§c[PvPBot] 召喚予定位置が安全範囲外です。 /bot の安全範囲設定を確認してください。`,
    );
    return;
  }
  logSystem(
    `spawn requested by ${player.name} at ${spawnLocation.x.toFixed(1)}, ${spawnLocation.y.toFixed(1)}, ${spawnLocation.z.toFixed(1)}`,
  );
  logSpawnLocationContext(player, spawnLocation);
  const request = queueSpawnRequest(
    player,
    spawnLocation,
    openSettingsAfterSpawn,
  );
  try {
    const result = await spawnEntityFromPlayer(player, BOT_TYPE, spawnLocation);
    appendPersistentDebugLog(
      "probe",
      `summon command result for ${player.name}: path=${result?.path ?? "?"} entityId=${shortId(result?.entityId)} successCount=${result?.successCount ?? "?"} status=${result?.statusMessage ?? "?"} apiError=${result?.apiError ?? ""}`,
    );
  } catch (error) {
    const requestIndex = pendingSpawnRequests.findIndex(
      (entry) => entry.id === request.id,
    );
    if (requestIndex !== -1) {
      pendingSpawnRequests.splice(requestIndex, 1);
    }
    appendPersistentDebugLog(
      "error",
      `summon command failed for ${player.name}: ${formatError(error)}`,
    );
    player.sendMessage(
      `§c[PvPBot] summon command failed: ${formatError(error)}`,
    );
    return;
  }
  system.runTimeout(() => {
    const stillPending = pendingSpawnRequests.find(
      (entry) => entry.id === request.id && !entry.resolved,
    );
    if (stillPending) {
      pendingSpawnRequests.splice(
        pendingSpawnRequests.indexOf(stillPending),
        1,
      );
      appendPersistentDebugLog(
        "error",
        `spawn request timed out for ${player.name}`,
      );
      player.sendMessage(
        "§c[PvPBot] 召喚後の Bot 実体を取得できませんでした。",
      );
    }
  }, 20);
}
function removeOwnedBots(player) {
  let removed = 0;
  for (const bot of getNearbyBots(player, Number.POSITIVE_INFINITY)) {
    const uid = getBotUid(bot);
    const config = ensureBotInitialized(bot);
    if (!config || (config.ownerName && config.ownerName !== player.name)) {
      continue;
    }
    delete botConfigs[uid];
    runtimeState.delete(uid);
    try {
      bot.remove();
      removed += 1;
    } catch {}
  }
  saveConfigs();
  player.sendMessage(
    removed
      ? `§a${removed} 体の Bot を削除しました。`
      : "§e削除できる Bot がいません。",
  );
}
async function openRootMenu(player) {
  const response = await new ActionFormData()
    .title("Crystal PvP Bot")
    .body(
      `召喚式 PvP Bot の操作を行います。\n安全範囲: ${
        globalSettings.boundaryEnabled ? "ON" : "OFF"
      } x${globalSettings.boundaryMinX}..${globalSettings.boundaryMaxX} z${globalSettings.boundaryMinZ}..${globalSettings.boundaryMaxZ}`,
    )
    .button("Bot を召喚")
    .button("近くの Bot を設定")
    .button("所有 Bot を削除")
    .button("安全範囲設定")
    .button("爆発テスト")
    .button("Debug Log")
    .button("使い方")
    .show(player);
  if (response.canceled) {
    return;
  }
  if (response.selection === 0) {
    await spawnBotForPlayer(player, true);
  } else if (response.selection === 1) {
    await openSettingsForm(player);
  } else if (response.selection === 2) {
    removeOwnedBots(player);
  } else if (response.selection === 3) {
    await openGlobalSafetySettings(player);
  } else if (response.selection === 4) {
    await openExplosionTestMenu(player);
  } else if (response.selection === 5) {
    dumpPersistentDebugLog(player);
  } else {
    await showHelpForm(player);
  }
}
async function openGlobalSafetySettings(player) {
  const current = normalizeGlobalSettings(globalSettings);
  const response = await new ModalFormData()
    .title("Bot Safety")
    .toggle("Botを安全範囲内に戻す", { defaultValue: current.boundaryEnabled })
    .textField("最小X", "-500", { defaultValue: String(current.boundaryMinX) })
    .textField("最大X", "500", { defaultValue: String(current.boundaryMaxX) })
    .textField("最小Z", "-500", { defaultValue: String(current.boundaryMinZ) })
    .textField("最大Z", "500", { defaultValue: String(current.boundaryMaxZ) })
    .show(player);
  if (response.canceled || !response.formValues) {
    return;
  }
  const [boundaryEnabled, rawMinX, rawMaxX, rawMinZ, rawMaxZ] =
    response.formValues;
  globalSettings = normalizeGlobalSettings({
    boundaryEnabled,
    boundaryMinX: Number(rawMinX) || 0,
    boundaryMaxX: Number(rawMaxX) || 0,
    boundaryMinZ: Number(rawMinZ) || 0,
    boundaryMaxZ: Number(rawMaxZ) || 0,
  });
  saveGlobalSettings();
  player.sendMessage(
    `§a[PvPBot] 安全範囲を保存しました: ${globalSettings.boundaryEnabled ? "ON" : "OFF"} x${
      globalSettings.boundaryMinX
    }..${globalSettings.boundaryMaxX} z${globalSettings.boundaryMinZ}..${globalSettings.boundaryMaxZ}`,
  );
}
function getExplosionTestTargetBlock(player, maxDistance = 16) {
  try {
    return player.getBlockFromViewDirection?.({ maxDistance })?.block;
  } catch {
    return undefined;
  }
}
async function runAnchorExplosionTestForPlayer(player) {
  const block = getExplosionTestTargetBlock(player);
  if (!block) {
    player.sendMessage(
      "§c[PvPBot] 視線先のブロックを取得できません。地面を見ながら実行してください。",
    );
    return;
  }
  const testBase = resolveAnchorTestBaseLocation(block);
  if (!testBase) {
    player.sendMessage(
      "§c[PvPBot] 視線先の周辺にアンカーを置ける空間がありません。地面の上面を見ながら実行してください。",
    );
    return;
  }
  const result = await patchRunAnchorPlaceAndDetonateSequence(
    player.dimension,
    testBase.location,
    player,
    {
      placementMode: testBase.placementMode,
      existingCharge: testBase.existingCharge,
      needsCharge: testBase.needsCharge,
      detonateDelay: 3,
      explosionOptions: {
        ignoreCenterAnchorChange: true,
        requireFullNativeBreakPattern: true,
      },
    },
  );
  player.sendMessage(
    `§a[PvPBot] 視線先で疑似アンカー爆破を実行しました。 changed=${result.changedBlocks ?? 0} fallback=${result.usedFallback ? "on" : "off"} api=${result.explosionResult?.success ? "ok" : "fail"}`,
  );
}
function resolveAnchorTestBaseLocation(block) {
  const base = floorLocation(block.location);
  if (isRespawnAnchorBlock(block) || isAirBlock(block)) {
    return {
      location: base,
      placementMode: isRespawnAnchorBlock(block)
        ? "existing-anchor"
        : "place-anchor",
      existingCharge: getRespawnAnchorCharge(block),
      needsCharge:
        !isRespawnAnchorBlock(block) || getRespawnAnchorCharge(block) <= 0,
    };
  }
  const above = addVector(base, { x: 0, y: 1, z: 0 });
  if (isAirBlock(getBlock(block.dimension, above))) {
    return {
      location: above,
      placementMode: "place-anchor",
      existingCharge: 0,
      needsCharge: true,
    };
  }
  return undefined;
}
async function runCrystalExplosionTestForPlayer(player) {
  const block = getExplosionTestTargetBlock(player);
  if (!block) {
    player.sendMessage(
      "§c[PvPBot] 視線先のブロックを取得できません。地面を見ながら実行してください。",
    );
    return;
  }
  const base = floorLocation(block.location);
  const explosionLocation = getExplosionLocation(base, "crystal");
  let spawnedCrystal;
  try {
    await spawnEntityWithFallback(
      player.dimension,
      END_CRYSTAL_ENTITY_ID,
      explosionLocation,
    );
    spawnedCrystal = patchGetNearbyCrystalEntities(
      player.dimension,
      explosionLocation,
    ).sort(
      (a, b) =>
        distanceSquared(a.location, explosionLocation) -
        distanceSquared(b.location, explosionLocation),
    )[0];
  } catch {}
  const result = await runCrystalExplosionWithFallback(
    player.dimension,
    base,
    player,
    spawnedCrystal,
  );
  try {
    spawnedCrystal?.remove();
  } catch {}
  player.sendMessage(
    `§a[PvPBot] 視線先で疑似クリスタル爆破を実行しました。 changed=${result.changedBlocks} broken=${result.brokenBlocks} fallback=${result.usedFallback ? "on" : "off"} mode=${result.explosionResult.mode ?? "api"} api=${result.explosionResult.success ? "ok" : "fail"}`,
  );
}
async function openExplosionTestMenu(player) {
  const response = await new ActionFormData()
    .title("爆発テスト")
    .body(
      "視線先のブロックを基準に疑似爆発を起こします。\nアンカーは視線先ブロック中心、クリスタルは視線先ブロックの上で爆発します。",
    )
    .button("視線先で疑似アンカー爆破")
    .button("視線先で疑似クリスタル爆破")
    .button("戻る")
    .show(player);
  if (response.canceled || response.selection === 2) {
    return;
  }
  if (response.selection === 0) {
    await runAnchorExplosionTestForPlayer(player);
  } else if (response.selection === 1) {
    await runCrystalExplosionTestForPlayer(player);
  }
}
const PATCH_GOLDEN_APPLE_ID = "minecraft:golden_apple";
const PATCH_ENCHANTED_GOLDEN_APPLE_ID = "minecraft:enchanted_golden_apple";
const PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE = 6.25;
const PATCH_ARMOR_EFFECT_REFRESH_TICKS = 6;
const PATCH_FOOD_REEQUIP_DELAY = 8;
const PATCH_FOOD_REUSE_BUFFER_TICKS = 20;
const PATCH_FOOD_USE_COOLDOWN_TICKS = 16;
const PATCH_SUPPLY_CHEST_VIEW_DISTANCE = 8;
const PATCH_JUMP_DASH_COOLDOWN_TICKS = 5;
const PATCH_JUMP_DASH_AIRBORNE_TICKS = 4;
const PATCH_JUMP_DASH_VERTICAL_IMPULSE = 0.4;
const PATCH_JUMP_DASH_FORWARD_BONUS = 0.18;
const PATCH_JUMP_DASH_MIN_DIRECTION = 0.025;
const PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS = 4.75;
const PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS = 1;
const PATCH_ANCHOR_FORCE_FALLBACK = false;
const PATCH_ANCHOR_BLOCK_BREAK_RADIUS = 11.0;
const PATCH_ANCHOR_FIRE_PLACE_CHANCE = 0.3;
const PATCH_CRYSTAL_BLOCK_BREAK_RADIUS = 5.75;
const PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS = 6.25;
const PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS = 1;
const PATCH_CRYSTAL_FORCE_FALLBACK_BREAK = false;
const PATCH_VISUAL_EQUIPMENT_SELECTOR_RADIUS = 0.8;
const PATCH_VISUAL_EQUIPMENT_RESYNC_TICKS = 6;
const PATCH_TOTEM_POP_HEALTH_THRESHOLD = 4.5;
const PATCH_TOTEM_POP_HEALTH_RATIO = 0.22;
const PATCH_TOTEM_POP_COOLDOWN_TICKS = 8;
const PATCH_TOTEM_DAMAGE_IMMUNITY_TICKS = 10;
const PATCH_TOTEM_DAMAGE_BUFFER = 1.25;
const PATCH_TOTEM_REVIVE_HEALTH = 2;
const PATCH_TOTEM_REGEN_TICKS = 900;
const PATCH_TOTEM_ABSORPTION_TICKS = 100;
const PATCH_TOTEM_FIRE_RESISTANCE_TICKS = 800;
const PATCH_TOTEM_EMERGENCY_RESISTANCE_TICKS = 18;
const PATCH_TOTEM_NOTIFICATION_RADIUS = 20;
const PATCH_TOTEM_VISUAL_HOLD_TICKS = 7;
const PATCH_TOTEM_NAMETAG_FLASH_TICKS = 24;
const PATCH_MANAGED_STACK_ITEM_IDS = [
  OBSIDIAN_ID,
  END_CRYSTAL_ID,
  RESPAWN_ANCHOR_ID,
  GLOWSTONE_ID,
  ENDER_PEARL_ID,
  TOTEM_ID,
  PATCH_ENCHANTED_GOLDEN_APPLE_ID,
  PATCH_GOLDEN_APPLE_ID,
  "minecraft:cobblestone",
  "minecraft:dirt",
  "minecraft:stone",
];
const PATCH_DEFAULT_COMBAT_ITEM_COUNTS = {
  [OBSIDIAN_ID]: 64,
  [END_CRYSTAL_ID]: 64,
  [RESPAWN_ANCHOR_ID]: 32,
  [GLOWSTONE_ID]: 64,
  [ENDER_PEARL_ID]: 16,
  [PATCH_ENCHANTED_GOLDEN_APPLE_ID]: 8,
  [PATCH_GOLDEN_APPLE_ID]: 16,
  [TOTEM_ID]: 8,
  ["minecraft:cobblestone"]: 64,
  ["minecraft:dirt"]: 64,
  ["minecraft:stone"]: 64,
};
const PATCH_ARMOR_MATERIAL_SCORES = {
  netherite: 60,
  diamond: 50,
  iron: 40,
  chainmail: 30,
  golden: 20,
  leather: 10,
  turtle: 35,
};
const PATCH_ARMOR_DEFENSE_VALUES = {
  "minecraft:leather_helmet": 1,
  "minecraft:golden_helmet": 2,
  "minecraft:chainmail_helmet": 2,
  "minecraft:iron_helmet": 2,
  "minecraft:diamond_helmet": 3,
  "minecraft:netherite_helmet": 3,
  "minecraft:turtle_helmet": 2,
  "minecraft:leather_chestplate": 3,
  "minecraft:golden_chestplate": 5,
  "minecraft:chainmail_chestplate": 5,
  "minecraft:iron_chestplate": 6,
  "minecraft:diamond_chestplate": 8,
  "minecraft:netherite_chestplate": 8,
  "minecraft:leather_leggings": 2,
  "minecraft:golden_leggings": 3,
  "minecraft:chainmail_leggings": 4,
  "minecraft:iron_leggings": 5,
  "minecraft:diamond_leggings": 6,
  "minecraft:netherite_leggings": 6,
  "minecraft:leather_boots": 1,
  "minecraft:golden_boots": 1,
  "minecraft:chainmail_boots": 1,
  "minecraft:iron_boots": 2,
  "minecraft:diamond_boots": 3,
  "minecraft:netherite_boots": 3,
};
const PATCH_EXPLOSION_PRESERVE_IDS = new Set([
  AIR_ID,
  OBSIDIAN_ID,
  "minecraft:crying_obsidian",
  "minecraft:bedrock",
  "minecraft:respawn_anchor",
  "minecraft:reinforced_deepslate",
  "minecraft:barrier",
  "minecraft:end_portal_frame",
  "minecraft:end_portal",
]);
function toDimensionKey(dimensionId) {
  switch (`${dimensionId ?? ""}`) {
    case "minecraft:overworld":
      return "overworld";
    case "minecraft:nether":
      return "nether";
    case "minecraft:the_end":
      return "the_end";
    default:
      return sanitizeTagValue(dimensionId);
  }
}
function fromDimensionKey(dimensionKey) {
  switch (`${dimensionKey ?? ""}`) {
    case "overworld":
      return "minecraft:overworld";
    case "nether":
      return "minecraft:nether";
    case "the_end":
      return "minecraft:the_end";
    default:
      return `${dimensionKey ?? ""}`;
  }
}
function patchNormalizeEnchantmentId(enchantmentId) {
  return `${enchantmentId ?? ""}`.replace(/^minecraft:/, "");
}
function patchResolveEnchantmentType(enchantmentId) {
  if (typeof EnchantmentTypes?.get !== "function") {
    return undefined;
  }
  return (
    EnchantmentTypes.get(enchantmentId) ??
    EnchantmentTypes.get(patchNormalizeEnchantmentId(enchantmentId))
  );
}
function patchGetItemEnchantments(item) {
  if (typeof item?.getComponent !== "function") {
    return [];
  }
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.getEnchantments !== "function") {
      return [];
    }
    const entries = enchantable.getEnchantments();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
function patchGetEnchantmentLevel(item, enchantmentId) {
  const target = patchNormalizeEnchantmentId(enchantmentId);
  let highest = 0;
  for (const entry of patchGetItemEnchantments(item)) {
    const currentId = patchNormalizeEnchantmentId(
      entry?.type?.id ?? entry?.typeId ?? entry?.id,
    );
    if (currentId === target) {
      highest = Math.max(highest, Number(entry?.level ?? 0));
    }
  }
  return highest;
}
function patchGetTotalEnchantmentLevel(item) {
  return patchGetItemEnchantments(item).reduce(
    (sum, entry) => sum + Number(entry?.level ?? 0),
    0,
  );
}
function patchCopyItemMetadata(source, target) {
  if (!source || !target) {
    return target;
  }
  try {
    if (source.nameTag) {
      target.nameTag = source.nameTag;
    }
  } catch {}
  try {
    if (
      typeof source.getLore === "function" &&
      typeof target.setLore === "function"
    ) {
      const lore = source.getLore();
      if (Array.isArray(lore) && lore.length) {
        target.setLore(lore);
      }
    }
  } catch {}
  const enchantments = patchGetItemEnchantments(source).map((entry) => ({
    id: entry?.type?.id ?? entry?.typeId ?? entry?.id,
    level: Number(entry?.level ?? 0),
  }));
  if (enchantments.length) {
    applyEnchantments(target, enchantments);
  }
  return target;
}
function patchCloneItemStackWithAmount(item, amount) {
  const normalizedAmount = Math.max(1, Math.floor(Number(amount) || 1));
  if (item?.clone) {
    try {
      const cloned = item.clone();
      cloned.amount = normalizedAmount;
      return cloned;
    } catch {}
  }
  return patchCopyItemMetadata(
    item,
    new ItemStack(item?.typeId ?? AIR_ID, normalizedAmount),
  );
}
function patchGetArmorSlotForItem(itemOrTypeId) {
  const typeId =
    typeof itemOrTypeId === "string" ? itemOrTypeId : itemOrTypeId?.typeId;
  if (!typeId) {
    return undefined;
  }
  if (typeId === "minecraft:turtle_helmet" || typeId.endsWith("_helmet")) {
    return EquipmentSlot.Head;
  }
  if (typeId.endsWith("_chestplate")) {
    return EquipmentSlot.Chest;
  }
  if (typeId.endsWith("_leggings")) {
    return EquipmentSlot.Legs;
  }
  if (typeId.endsWith("_boots")) {
    return EquipmentSlot.Feet;
  }
  return undefined;
}
function patchGetArmorSelectionScore(item) {
  const typeId = item?.typeId ?? "";
  const material =
    typeId === "minecraft:turtle_helmet"
      ? "turtle"
      : typeId.replace(/^minecraft:/, "").split("_")[0];
  return (
    (PATCH_ARMOR_MATERIAL_SCORES[material] ?? 0) * 100 +
    patchGetTotalEnchantmentLevel(item) * 10
  );
}
function patchGetArmorDefenseValue(item) {
  return PATCH_ARMOR_DEFENSE_VALUES[item?.typeId ?? ""] ?? 0;
}
createDefaultConfig = function (uid = "", ownerName = "", displayName = "") {
  return {
    uid,
    ownerName,
    displayName:
      displayName || `Crystal Bot ${uid ? uid.slice(-4) : ""}`.trim(),
    difficultyPreset: "normal",
    enabled: true,
    maintainDistance: 3,
    targetRange: MAX_TARGET_DISTANCE,
    pearlDistance: 10,
    pearlCooldown: 40,
    swordCooldown: 15,
    crystalCooldown: 15,
    crystalDetonateDelay: 3,
    anchorCooldown: 15,
    anchorDetonateDelay: 3,
    totemRefillDelay: 0,
    humanize: true,
    reactionDelay: 4,
    aimJitter: 0.08,
    mistakeRate: 0,
    suboptimalRate: 25,
    jumpDash: true,
    tickInterval: 1,
    autoRestockCombatItems: true,
    autoTotem: true,
    mirrorOwnerLoadout: true,
    supplyChestDimensionKey: "",
    supplyChestX: 0,
    supplyChestY: 0,
    supplyChestZ: 0,
    pearlMove: true,
    swordCombo: true,
    crystalCombo: true,
    anchorCombo: true,
    ignoreSelfDamage: false,
    inventoryMode: "auto_refill",
    customItemCounts: {},
    debug: {
      enabled: false,
      movement: false,
      scan: false,
      combat: false,
      totem: false,
      loadout: false,
      inventory: false,
    },
  };
};
getRuntime = function (uid) {
  if (!runtimeState.has(uid)) {
    runtimeState.set(uid, {
      spawnTick: globalTick,
      lastPearlTick: -9999,
      lastSwordTick: -9999,
      lastCrystalTick: -9999,
      lastAnchorTick: -9999,
      lastFoodTick: -9999,
      foodAbsorptionUntilTick: -9999,
      foodRegenUntilTick: -9999,
      foodResistanceUntilTick: -9999,
      foodFireResistanceUntilTick: -9999,
      lastJumpDashTick: -9999,
      jumpDashAirborneUntilTick: -9999,
      lastTotemPopTick: -9999,
      totemShieldUntilTick: -9999,
      lastKnownHealth: 20,
      lastLoadoutSyncTick: -9999,
      lastVisualEquipmentSyncTick: -9999,
      lastMovementLocation: undefined,
      stuckTicks: 0,
      lastBuildStepTick: -9999,
      nextStrafeFlipTick: 0,
      strafeDirection: 1,
      lastTargetId: "",
      lastNoTargetLogTick: -9999,
      lastSeenTick: -9999,
      lastVisualEquipmentSignature: "",
      selectedArmorBySlot: {},
      selectedSword: undefined,
      selectedOffhand: undefined,
      visualMainhand: undefined,
      visualOffhand: undefined,
      debugTickByCategory: {},
      pendingPearlToken: "",
      pendingCrystal: undefined,
      pendingAnchor: undefined,
      delayedActions: {},
    });
  }
  return runtimeState.get(uid);
};
function patchRandomChance(percent) {
  return Math.random() * 100 < Math.max(0, Number(percent ?? 0));
}
function hashString(value) {
  let hash = 0;
  for (const char of `${value ?? ""}`) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return hash;
}
function patchHumanizedDelay(config, actionKey) {
  if (!config?.humanize) {
    return 0;
  }
  const base = Math.max(0, Number(config.reactionDelay ?? 0));
  if (base <= 0) {
    return 0;
  }
  const actionBias =
    actionKey === "pearl" ? 1.4 : actionKey === "sword" ? 0.8 : 1;
  return Math.max(0, Math.floor(Math.random() * base * actionBias));
}
function patchShouldDelayAction(config, actionKey) {
  if (!config?.humanize) {
    return false;
  }
  const runtime = getRuntime(config.uid);
  const delayed = runtime.delayedActions ?? {};
  runtime.delayedActions = delayed;
  const nowReadyTick = delayed[actionKey] ?? -9999;
  if (nowReadyTick > globalTick) {
    return true;
  }
  const delay = patchHumanizedDelay(config, actionKey);
  if (delay <= 0) {
    return false;
  }
  delayed[actionKey] = globalTick + delay;
  return true;
}
function patchApplyAimJitter(location, config) {
  const jitter = config?.humanize
    ? Math.max(0, Number(config.aimJitter ?? 0))
    : 0;
  if (jitter <= 0) {
    return location;
  }
  const t = globalTick * 0.3;
  const offset =
    typeof config?.uid === "string" ? config.uid.charCodeAt(0) * 0.1 : 0;
  return {
    x: location.x + Math.sin(t + offset) * jitter,
    y: location.y + Math.sin(t * 0.7 + offset * 1.5) * jitter * 0.65,
    z: location.z + Math.cos(t * 0.85 + offset) * jitter,
  };
}
function patchPickHumanizedCandidate(candidates, config) {
  if (
    !Array.isArray(candidates) ||
    candidates.length <= 1 ||
    !config?.humanize
  ) {
    return candidates?.[0];
  }
  if (!patchRandomChance(config.suboptimalRate)) {
    return candidates[0];
  }
  const limit = Math.min(candidates.length, 3);
  return candidates[Math.floor(Math.random() * limit)];
}
normalizeConfig = function (input) {
  const base = createDefaultConfig(
    input?.uid ?? "",
    input?.ownerName ?? "",
    input?.displayName ?? "",
  );
  return {
    ...base,
    ...input,
    maintainDistance: Number.isFinite(Number(input?.maintainDistance))
      ? Number(input.maintainDistance)
      : base.maintainDistance,
    targetRange: Number.isFinite(Number(input?.targetRange))
      ? Number(input.targetRange)
      : base.targetRange,
    difficultyPreset: `${input?.difficultyPreset ?? base.difficultyPreset ?? "normal"}`,
    pearlDistance: Number.isFinite(Number(input?.pearlDistance))
      ? Number(input.pearlDistance)
      : base.pearlDistance,
    pearlCooldown: Number.isFinite(Number(input?.pearlCooldown))
      ? Number(input.pearlCooldown)
      : base.pearlCooldown,
    swordCooldown: Number.isFinite(Number(input?.swordCooldown))
      ? Number(input.swordCooldown)
      : base.swordCooldown,
    crystalCooldown: Number.isFinite(Number(input?.crystalCooldown))
      ? Number(input.crystalCooldown)
      : base.crystalCooldown,
    crystalDetonateDelay: Number.isFinite(Number(input?.crystalDetonateDelay))
      ? Number(input.crystalDetonateDelay)
      : base.crystalDetonateDelay,
    anchorCooldown: Number.isFinite(Number(input?.anchorCooldown))
      ? Number(input.anchorCooldown)
      : base.anchorCooldown,
    anchorDetonateDelay: Number.isFinite(Number(input?.anchorDetonateDelay))
      ? Number(input.anchorDetonateDelay)
      : base.anchorDetonateDelay,
    totemRefillDelay: Number.isFinite(Number(input?.totemRefillDelay))
      ? Number(input.totemRefillDelay)
      : base.totemRefillDelay,
    humanize: input?.humanize === undefined ? base.humanize : !!input.humanize,
    reactionDelay: Number.isFinite(Number(input?.reactionDelay))
      ? Number(input.reactionDelay)
      : base.reactionDelay,
    aimJitter: Number.isFinite(Number(input?.aimJitter))
      ? Number(input.aimJitter)
      : base.aimJitter,
    mistakeRate: Number.isFinite(Number(input?.mistakeRate))
      ? Number(input.mistakeRate)
      : base.mistakeRate,
    suboptimalRate: Number.isFinite(Number(input?.suboptimalRate))
      ? Number(input.suboptimalRate)
      : base.suboptimalRate,
    jumpDash: input?.jumpDash === undefined ? base.jumpDash : !!input.jumpDash,
    tickInterval: Math.max(
      1,
      Math.min(
        4,
        Number.isFinite(Number(input?.tickInterval))
          ? Math.floor(Number(input.tickInterval))
          : base.tickInterval,
      ),
    ),
    autoRestockCombatItems:
      input?.autoRestockCombatItems === undefined
        ? base.autoRestockCombatItems
        : !!input.autoRestockCombatItems,
    supplyChestDimensionKey: `${input?.supplyChestDimensionKey ?? base.supplyChestDimensionKey ?? ""}`,
    supplyChestX: Number.isFinite(Number(input?.supplyChestX))
      ? Number(input.supplyChestX)
      : base.supplyChestX,
    supplyChestY: Number.isFinite(Number(input?.supplyChestY))
      ? Number(input.supplyChestY)
      : base.supplyChestY,
    supplyChestZ: Number.isFinite(Number(input?.supplyChestZ))
      ? Number(input.supplyChestZ)
      : base.supplyChestZ,
    debug: {
      ...base.debug,
      ...(input?.debug ?? {}),
    },
  };
};
writeConfigTags = function (bot, config) {
  for (const tag of bot.getTags()) {
    if (tag.startsWith(BOT_CONFIG_TAG_PREFIX)) {
      bot.removeTag(tag);
    }
  }
  const flat = {
    ownerName: sanitizeTagValue(config.ownerName),
    displayName: sanitizeTagValue(config.displayName),
    difficultyPreset: sanitizeTagValue(config.difficultyPreset),
    enabled: config.enabled ? "1" : "0",
    maintainDistance: config.maintainDistance,
    targetRange: config.targetRange,
    pearlDistance: config.pearlDistance,
    pearlCooldown: config.pearlCooldown,
    swordCooldown: config.swordCooldown,
    crystalCooldown: config.crystalCooldown,
    crystalDetonateDelay: config.crystalDetonateDelay,
    anchorCooldown: config.anchorCooldown,
    anchorDetonateDelay: config.anchorDetonateDelay,
    totemRefillDelay: config.totemRefillDelay,
    humanize: config.humanize ? "1" : "0",
    reactionDelay: config.reactionDelay,
    aimJitter: config.aimJitter,
    mistakeRate: config.mistakeRate,
    suboptimalRate: config.suboptimalRate,
    jumpDash: config.jumpDash ? "1" : "0",
    tickInterval: config.tickInterval,
    autoRestockCombatItems: config.autoRestockCombatItems ? "1" : "0",
    autoTotem: config.autoTotem ? "1" : "0",
    mirrorOwnerLoadout: config.mirrorOwnerLoadout ? "1" : "0",
    supplyChestDimensionKey: sanitizeTagValue(config.supplyChestDimensionKey),
    supplyChestX: Math.floor(Number(config.supplyChestX ?? 0)),
    supplyChestY: Math.floor(Number(config.supplyChestY ?? 0)),
    supplyChestZ: Math.floor(Number(config.supplyChestZ ?? 0)),
    pearlMove: config.pearlMove ? "1" : "0",
    swordCombo: config.swordCombo ? "1" : "0",
    crystalCombo: config.crystalCombo ? "1" : "0",
    anchorCombo: config.anchorCombo ? "1" : "0",
    anchorBreakCache: config.anchorBreakCache !== false ? "1" : "0",
    inventoryMode: config.inventoryMode ?? "auto_refill",
    debugEnabled: config.debug.enabled ? "1" : "0",
    debugMovement: config.debug.movement ? "1" : "0",
    debugScan: config.debug.scan ? "1" : "0",
    debugCombat: config.debug.combat ? "1" : "0",
    debugTotem: config.debug.totem ? "1" : "0",
    debugLoadout: config.debug.loadout ? "1" : "0",
    debugInventory: config.debug.inventory ? "1" : "0",
  };
  for (const [key, value] of Object.entries(flat)) {
    bot.addTag(`${BOT_CONFIG_TAG_PREFIX}${key}=${value}`);
  }
};
materializeConfig = function (bot, ownerPlayer) {
  let uid = getBotUid(bot);
  if (!uid) {
    configCounter += 1;
    uid = `${Date.now().toString(36)}-${configCounter.toString(36)}`;
    setUidTag(bot, uid);
  }
  const tagged = readConfigFromTags(bot);
  const saved = botConfigs[uid];
  const config = normalizeConfig({
    uid,
    ownerName: ownerPlayer?.name ?? saved?.ownerName ?? tagged.ownerName ?? "",
    displayName:
      saved?.displayName ?? tagged.displayName?.replace(/_/g, " ") ?? "",
    difficultyPreset: `${tagged.difficultyPreset ?? saved?.difficultyPreset ?? "normal"}`,
    ...saved,
    enabled:
      tagged.enabled === undefined ? saved?.enabled : tagged.enabled === "1",
    maintainDistance: Number(
      tagged.maintainDistance ?? saved?.maintainDistance,
    ),
    targetRange: Number(tagged.targetRange ?? saved?.targetRange),
    pearlDistance: Number(tagged.pearlDistance ?? saved?.pearlDistance),
    pearlCooldown: Number(tagged.pearlCooldown ?? saved?.pearlCooldown),
    swordCooldown: Number(tagged.swordCooldown ?? saved?.swordCooldown),
    crystalCooldown: Number(tagged.crystalCooldown ?? saved?.crystalCooldown),
    crystalDetonateDelay: Number(
      tagged.crystalDetonateDelay ?? saved?.crystalDetonateDelay,
    ),
    anchorCooldown: Number(tagged.anchorCooldown ?? saved?.anchorCooldown),
    anchorDetonateDelay: Number(
      tagged.anchorDetonateDelay ?? saved?.anchorDetonateDelay,
    ),
    totemRefillDelay: Number(
      tagged.totemRefillDelay ?? saved?.totemRefillDelay,
    ),
    humanize:
      tagged.humanize === undefined ? saved?.humanize : tagged.humanize === "1",
    reactionDelay: Number(tagged.reactionDelay ?? saved?.reactionDelay),
    aimJitter: Number(tagged.aimJitter ?? saved?.aimJitter),
    mistakeRate: Number(tagged.mistakeRate ?? saved?.mistakeRate),
    suboptimalRate: Number(tagged.suboptimalRate ?? saved?.suboptimalRate),
    jumpDash:
      tagged.jumpDash === undefined ? saved?.jumpDash : tagged.jumpDash === "1",
    tickInterval: Number(tagged.tickInterval ?? saved?.tickInterval),
    autoRestockCombatItems:
      tagged.autoRestockCombatItems === undefined
        ? saved?.autoRestockCombatItems
        : tagged.autoRestockCombatItems === "1",
    autoTotem:
      tagged.autoTotem === undefined
        ? saved?.autoTotem
        : tagged.autoTotem === "1",
    mirrorOwnerLoadout:
      tagged.mirrorOwnerLoadout === undefined
        ? saved?.mirrorOwnerLoadout
        : tagged.mirrorOwnerLoadout === "1",
    supplyChestDimensionKey: `${tagged.supplyChestDimensionKey ?? saved?.supplyChestDimensionKey ?? ""}`,
    supplyChestX: Number(tagged.supplyChestX ?? saved?.supplyChestX),
    supplyChestY: Number(tagged.supplyChestY ?? saved?.supplyChestY),
    supplyChestZ: Number(tagged.supplyChestZ ?? saved?.supplyChestZ),
    pearlMove:
      tagged.pearlMove === undefined
        ? saved?.pearlMove
        : tagged.pearlMove === "1",
    swordCombo:
      tagged.swordCombo === undefined
        ? saved?.swordCombo
        : tagged.swordCombo === "1",
    crystalCombo:
      tagged.crystalCombo === undefined
        ? saved?.crystalCombo
        : tagged.crystalCombo === "1",
    anchorCombo:
      tagged.anchorCombo === undefined
        ? saved?.anchorCombo
        : tagged.anchorCombo === "1",
    anchorBreakCache:
      tagged.anchorBreakCache === undefined
        ? (saved?.anchorBreakCache ?? true)
        : tagged.anchorBreakCache === "1",
    inventoryMode:
      tagged.inventoryMode ?? saved?.inventoryMode ?? "auto_refill",
    customItemCounts: (() => {
      try {
        return JSON.parse(
          tagged.customItemCounts ?? saved?.customItemCounts ?? "{}",
        );
      } catch {
        return {};
      }
    })(),
    debug: {
      enabled:
        tagged.debugEnabled === undefined
          ? saved?.debug?.enabled
          : tagged.debugEnabled === "1",
      movement:
        tagged.debugMovement === undefined
          ? saved?.debug?.movement
          : tagged.debugMovement === "1",
      scan:
        tagged.debugScan === undefined
          ? saved?.debug?.scan
          : tagged.debugScan === "1",
      combat:
        tagged.debugCombat === undefined
          ? saved?.debug?.combat
          : tagged.debugCombat === "1",
      totem:
        tagged.debugTotem === undefined
          ? saved?.debug?.totem
          : tagged.debugTotem === "1",
      loadout:
        tagged.debugLoadout === undefined ? saved?.debug?.loadout : undefined,
      inventory:
        tagged.debugInventory === undefined
          ? saved?.debug?.inventory
          : tagged.debugInventory === "1",
    },
  });
  botConfigs[uid] = config;
  writeConfigTags(bot, config);
  saveConfigs();
  return config;
};
applyEnchantments = function (item, enchantments = []) {
  if (!enchantments.length || typeof item?.getComponent !== "function") {
    return item;
  }
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.addEnchantments !== "function") {
      return item;
    }
    const prepared = enchantments
      .map((entry) => {
        const type = patchResolveEnchantmentType(entry.id);
        return type ? { type, level: entry.level } : undefined;
      })
      .filter(Boolean);
    if (prepared.length) {
      enchantable.addEnchantments(prepared);
    }
  } catch {}
  return item;
};
cloneItemStack = function (item, fallbackTypeId = AIR_ID, fallbackAmount = 1) {
  if (item?.clone) {
    try {
      return item.clone();
    } catch {}
  }
  const cloned = new ItemStack(
    item?.typeId ?? fallbackTypeId,
    item?.amount ?? fallbackAmount,
  );
  return patchCopyItemMetadata(item, cloned);
};
function patchGetEquippedArmorItems(entity) {
  const uid = getBotUid(entity);
  const config = uid ? botConfigs[uid] : undefined;
  if (config) {
    const runtime = getRuntime(uid);
    const selectedArmor = Object.values(
      runtime?.selectedArmorBySlot ?? {},
    ).filter(Boolean);
    if (selectedArmor.length) {
      return selectedArmor;
    }
    const supplyChest = getSupplyChestState(config);
    const supplyArmor = Object.values(
      supplyChest?.snapshot?.armorBySlot ?? {},
    ).filter(Boolean);
    if (supplyArmor.length) {
      return supplyArmor;
    }
  }
  const equippable = getEquippableComponent(entity);
  if (equippable) {
    const equipped = [
      equippable.getEquipment(EquipmentSlot.Head),
      equippable.getEquipment(EquipmentSlot.Chest),
      equippable.getEquipment(EquipmentSlot.Legs),
      equippable.getEquipment(EquipmentSlot.Feet),
    ].filter(Boolean);
    if (equipped.length) {
      return equipped;
    }
  }
  const inventory = entity?.getComponent?.(
    EntityComponentTypes.Inventory,
  )?.container;
  if (!inventory) {
    return [];
  }
  return Object.values(
    patchCollectContainerSnapshot(inventory).armorBySlot,
  ).filter(Boolean);
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
      equippable.setEquipment(
        armor.slot,
        armorBySlot[armor.slot]
          ? cloneItemStack(armorBySlot[armor.slot])
          : undefined,
      );
    } catch {}
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
}
function patchGetProtectionLevelForDamageCause(item, damageCause) {
  const normalizedCause = `${damageCause ?? ""}`
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
  const protection = patchGetEnchantmentLevel(item, "protection");
  let specialized = 0;
  switch (`${damageCause ?? ""}`) {
    case "entityExplosion":
    case "blockExplosion":
      specialized = patchGetEnchantmentLevel(item, "blast_protection");
      break;
    case "fire":
    case "fireTick":
    case "lava":
      specialized = patchGetEnchantmentLevel(item, "fire_protection");
      break;
    case "projectile":
      specialized = patchGetEnchantmentLevel(item, "projectile_protection");
      break;
    case "fall":
      specialized = patchGetEnchantmentLevel(item, "feather_falling");
      break;
    default:
      specialized = 0;
      break;
  }
  if (specialized <= 0) {
    if (normalizedCause.includes("explosion")) {
      specialized = patchGetEnchantmentLevel(item, "blast_protection");
    } else if (normalizedCause.includes("projectile")) {
      specialized = patchGetEnchantmentLevel(item, "projectile_protection");
    } else if (
      normalizedCause.includes("fire") ||
      normalizedCause.includes("lava")
    ) {
      specialized = patchGetEnchantmentLevel(item, "fire_protection");
    } else if (normalizedCause.includes("fall")) {
      specialized = patchGetEnchantmentLevel(item, "feather_falling");
    }
  }
  return Math.max(protection, specialized);
}
function patchCalculateArmorDamageReduction(bot, damage, damageCause) {
  const armorItems = patchGetEquippedArmorItems(bot);
  if (!armorItems.length || damage <= 0) {
    return 0;
  }
  const armorPoints = armorItems.reduce(
    (sum, item) => sum + patchGetArmorDefenseValue(item),
    0,
  );
  const enchantReduction = armorItems.reduce(
    (sum, item) =>
      sum + patchGetProtectionLevelForDamageCause(item, damageCause),
    0,
  );
  const armorRatio = Math.min(0.6, armorPoints * 0.025);
  const enchantRatio = Math.min(0.2, enchantReduction * 0.01);
  return Math.max(0, Math.min(damage, damage * (armorRatio + enchantRatio)));
}
function patchCalculateNetDamage(entity, rawDamage, damageCause) {
  const numericDamage = Math.max(0, Number(rawDamage ?? 0));
  if (numericDamage <= 0.01) {
    return 0;
  }
  return Math.max(
    0,
    numericDamage -
      patchCalculateArmorDamageReduction(entity, numericDamage, damageCause),
  );
}
function patchGetDamageCauseForComboType(comboType = "crystal") {
  return comboType === "anchor" ? "blockExplosion" : "entityExplosion";
}
function patchCalculateRawDamageForBotNetResult(bot, netDamage, damageCause) {
  const numericNet = Math.max(0, Number(netDamage ?? 0));
  if (numericNet <= 0.01) {
    return 0;
  }
  const probeDamage = Math.max(1, numericNet);
  const prevented = patchCalculateArmorDamageReduction(
    bot,
    probeDamage,
    damageCause,
  );
  const ratio = Math.max(0, Math.min(0.95, prevented / probeDamage));
  return numericNet / Math.max(0.05, 1 - ratio);
}
function patchApplyDamageWithFallback(entity, damage, damageCause, source) {
  const numericDamage = Math.max(0, Number(damage ?? 0));
  if (
    !entity ||
    numericDamage <= 0.01 ||
    typeof entity.applyDamage !== "function"
  ) {
    return false;
  }
  const attempts = [
    source
      ? { cause: damageCause, damagingEntity: source }
      : { cause: damageCause },
    source ? { cause: damageCause, source } : { cause: damageCause },
    undefined,
  ];
  for (const options of attempts) {
    try {
      if (options) {
        entity.applyDamage(numericDamage, options);
      } else {
        entity.applyDamage(numericDamage);
      }
      return true;
    } catch {}
  }
  return false;
}
function patchShouldTrackExplosionVictim(
  entity,
  explosionLocation,
  maxDistanceSquared,
) {
  if (!entity?.id) {
    return false;
  }
  if (patchGetCurrentHealthValue(entity) <= 0.01) {
    return false;
  }
  if (
    distanceSquared(entity.location, explosionLocation) > maxDistanceSquared
  ) {
    return false;
  }
  if (entity.typeId === BOT_TYPE) {
    return isEntityUsable(entity, BOT_TYPE);
  }
  if (entity.typeId !== "minecraft:player") {
    return false;
  }
  try {
    const gameMode = entity.getGameMode?.();
    if (
      gameMode &&
      gameMode !== GameMode.Survival &&
      gameMode !== GameMode.Adventure
    ) {
      return false;
    }
  } catch {}
  return true;
}
function patchCaptureExplosionDamageSnapshots(
  dimension,
  explosionLocation,
  comboType = "crystal",
) {
  const radius =
    comboType === "anchor"
      ? ANCHOR_DAMAGE_SCORE_RADIUS
      : CRYSTAL_DAMAGE_SCORE_RADIUS;
  const maxDistanceSquared = Math.pow(radius + 1.5, 2);
  const snapshots = [];
  const seen = new Set();
  const addEntity = (entity) => {
    if (
      !patchShouldTrackExplosionVictim(
        entity,
        explosionLocation,
        maxDistanceSquared,
      ) ||
      seen.has(entity.id)
    ) {
      return;
    }
    const rawDamage = estimateExplosionDamageScore(
      entity,
      explosionLocation,
      radius,
      comboType,
    );
    if (rawDamage <= 0.05) {
      return;
    }
    seen.add(entity.id);
    snapshots.push({
      entity,
      beforeHealth: patchGetCurrentHealthValue(entity),
      rawDamage,
    });
  };
  for (const player of getPlayersInDimension(dimension)) {
    addEntity(player);
  }
  for (const bot of getAllBots()) {
    if (bot.dimension.id !== dimension.id) {
      continue;
    }
    addEntity(bot);
  }
  return snapshots;
}
function patchScheduleExplosionDamageTopUp(snapshots, comboType, source) {
  if (!Array.isArray(snapshots) || !snapshots.length) {
    return;
  }
  const damageCause = patchGetDamageCauseForComboType(comboType);
  system.runTimeout(() => {
    for (const snapshot of snapshots) {
      const entity = snapshot.entity;
      if (!entity?.id) {
        continue;
      }
      if (entity.typeId === BOT_TYPE) {
        if (!isEntityUsable(entity, BOT_TYPE)) {
          continue;
        }
      } else if (patchGetCurrentHealthValue(entity) <= 0.01) {
        continue;
      }
      const currentHealth = patchGetCurrentHealthValue(entity);
      const actualDamage = Math.max(
        0,
        Number(snapshot.beforeHealth ?? 0) - currentHealth,
      );
      const damageMultiplier = comboType === "anchor" ? 2.5 : 1.5;
      const expectedNetDamage = patchCalculateNetDamage(
        entity,
        snapshot.rawDamage * damageMultiplier,
        damageCause,
      );
      const missingNetDamage = Number(
        (expectedNetDamage - actualDamage).toFixed(2),
      );
      if (missingNetDamage <= 0.2) {
        continue;
      }
      const appliedDamage =
        entity.typeId === BOT_TYPE
          ? patchCalculateRawDamageForBotNetResult(
              entity,
              missingNetDamage,
              damageCause,
            )
          : missingNetDamage;
      patchApplyDamageWithFallback(entity, appliedDamage, damageCause, source);
    }
  }, 1);
}
function patchGetSwordCombatStatsFromItem(item) {
  const base =
    SWORD_STATS[item?.typeId] ?? SWORD_STATS["minecraft:wooden_sword"];
  const sharpnessLevel = patchGetEnchantmentLevel(item, "sharpness");
  const knockbackLevel = patchGetEnchantmentLevel(item, "knockback");
  const fireAspectLevel = patchGetEnchantmentLevel(item, "fire_aspect");
  const sharpnessBonus = sharpnessLevel > 0 ? sharpnessLevel * 0.5 + 0.5 : 0;
  const damage = Number((base.damage + sharpnessBonus).toFixed(2));
  return {
    ...base,
    damage,
    sharpnessLevel,
    knockbackLevel,
    fireAspectLevel,
    score:
      base.score * 100 + damage * 10 + fireAspectLevel * 2 + knockbackLevel,
  };
}
function patchCreateManagedItemCountMap(sourceCounts = {}) {
  const mapped = {};
  for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
    mapped[itemId] = Math.max(
      0,
      Math.floor(Number(sourceCounts?.[itemId] ?? 0)),
    );
  }
  return mapped;
}
function patchGetFirstEmptyContainerSlot(container) {
  if (!container) {
    return -1;
  }
  for (let index = 0; index < container.size; index += 1) {
    if (!container.getItem(index)) {
      return index;
    }
  }
  return -1;
}
function patchPlaceItemInContainer(container, item) {
  if (!container || !item) {
    return false;
  }
  const slot = patchGetFirstEmptyContainerSlot(container);
  if (slot === -1) {
    return false;
  }
  try {
    container.setItem(slot, cloneItemStack(item));
    return true;
  } catch {
    return false;
  }
}
function patchFindInventoryItem(container, itemId) {
  if (!container || !itemId) {
    return undefined;
  }
  let matchedItem;
  let matchedScore = -Infinity;
  for (let index = 0; index < container.size; index += 1) {
    const item = container.getItem(index);
    if (item?.typeId !== itemId) {
      continue;
    }
    if (!SWORD_STATS[itemId]) {
      return item;
    }
    const stats = patchGetSwordCombatStatsFromItem(item);
    if (stats.score > matchedScore) {
      matchedItem = item;
      matchedScore = stats.score;
    }
  }
  return matchedItem;
}
function patchGetEffectDurationTicks(entity, effectId) {
  try {
    const effect = entity.getEffect(effectId);
    return Number(effect?.duration ?? effect?.durationTicks ?? 0);
  } catch {
    return 0;
  }
}
function patchGetCurrentHealthValue(entity) {
  const health = entity?.getComponent?.(EntityComponentTypes.Health);
  return Number(health?.currentValue ?? health?.value ?? 0);
}
function patchGetMaxHealthValue(entity) {
  const health = entity?.getComponent?.(EntityComponentTypes.Health);
  return Number(
    health?.effectiveMax ?? health?.defaultValue ?? health?.value ?? 20,
  );
}
function patchGetTotemPopThreshold(entity) {
  return Math.max(
    PATCH_TOTEM_POP_HEALTH_THRESHOLD,
    patchGetMaxHealthValue(entity) * PATCH_TOTEM_POP_HEALTH_RATIO,
  );
}
function patchShouldEmergencyPopTotem(entity, damage = 0) {
  const currentHealth = patchGetCurrentHealthValue(entity);
  if (currentHealth <= 0.01) {
    return true;
  }
  const numericDamage = Number(damage ?? 0);
  if (numericDamage > 0) {
    const runtime = getRuntime(getBotUid(entity));
    const lastKnownHealth = Number(runtime?.lastKnownHealth ?? currentHealth);
    const projectedFromLast = lastKnownHealth - numericDamage;
    const projectedFromCurrent = currentHealth - numericDamage;
    if (projectedFromLast <= 0.35 || projectedFromCurrent <= 0.35) {
      return true;
    }
    const popThreshold = patchGetTotemPopThreshold(entity);
    if (
      Math.min(lastKnownHealth, currentHealth) <= popThreshold &&
      numericDamage >=
        Math.max(
          PATCH_TOTEM_DAMAGE_BUFFER,
          Math.min(lastKnownHealth, currentHealth) - 0.25,
        )
    ) {
      return true;
    }
  }
  return false;
}
function patchUpdateBotVisualEquipmentState(bot) {
  const visual = patchGetVisualEquipmentState(bot);
  try {
    bot.setProperty(
      "pvpbot:has_head_gear",
      !!visual.armorBySlot[EquipmentSlot.Head],
    );
  } catch {}
}
function patchFormatItemShort(item) {
  if (!item?.typeId) {
    return "none";
  }
  const itemName = item.typeId.replace(/^minecraft:/, "");
  const enchantments = [];
  for (const enchantmentId of [
    "sharpness",
    "knockback",
    "fire_aspect",
    "protection",
    "blast_protection",
    "fire_protection",
    "projectile_protection",
    "feather_falling",
    "unbreaking",
  ]) {
    const level = patchGetEnchantmentLevel(item, enchantmentId);
    if (level > 0) {
      enchantments.push(`${enchantmentId.replace(/^.+:/, "")}${level}`);
    }
  }
  return `${itemName}${enchantments.length ? `[${enchantments.join(",")}]` : ""}${item.amount && item.amount > 1 ? `x${item.amount}` : ""}`;
}
function patchDescribeArmorMap(armorBySlot = {}) {
  return [
    `head=${patchFormatItemShort(armorBySlot[EquipmentSlot.Head])}`,
    `chest=${patchFormatItemShort(armorBySlot[EquipmentSlot.Chest])}`,
    `legs=${patchFormatItemShort(armorBySlot[EquipmentSlot.Legs])}`,
    `feet=${patchFormatItemShort(armorBySlot[EquipmentSlot.Feet])}`,
  ].join(" ");
}
function patchFormatManagedCounts(counts = {}) {
  return [
    `obs=${Math.max(0, Math.floor(Number(counts?.[OBSIDIAN_ID] ?? 0)))}`,
    `cry=${Math.max(0, Math.floor(Number(counts?.[END_CRYSTAL_ID] ?? 0)))}`,
    `anchor=${Math.max(0, Math.floor(Number(counts?.[RESPAWN_ANCHOR_ID] ?? 0)))}`,
    `glow=${Math.max(0, Math.floor(Number(counts?.[GLOWSTONE_ID] ?? 0)))}`,
    `totem=${Math.max(0, Math.floor(Number(counts?.[TOTEM_ID] ?? 0)))}`,
    `egap=${Math.max(0, Math.floor(Number(counts?.[PATCH_ENCHANTED_GOLDEN_APPLE_ID] ?? 0)))}`,
    `gap=${Math.max(0, Math.floor(Number(counts?.[PATCH_GOLDEN_APPLE_ID] ?? 0)))}`,
  ].join(" ");
}
function patchCloneArmorBySlot(armorBySlot = {}) {
  return {
    [EquipmentSlot.Head]: armorBySlot[EquipmentSlot.Head]
      ? cloneItemStack(armorBySlot[EquipmentSlot.Head])
      : undefined,
    [EquipmentSlot.Chest]: armorBySlot[EquipmentSlot.Chest]
      ? cloneItemStack(armorBySlot[EquipmentSlot.Chest])
      : undefined,
    [EquipmentSlot.Legs]: armorBySlot[EquipmentSlot.Legs]
      ? cloneItemStack(armorBySlot[EquipmentSlot.Legs])
      : undefined,
    [EquipmentSlot.Feet]: armorBySlot[EquipmentSlot.Feet]
      ? cloneItemStack(armorBySlot[EquipmentSlot.Feet])
      : undefined,
  };
}
function patchGetVisualEquipmentState(bot) {
  const equippable = getEquippableComponent(bot);
  const uid = getBotUid(bot);
  const runtime = uid ? getRuntime(uid) : undefined;
  const armorBySlot = {};
  for (const armor of BOT_ARMOR) {
    armorBySlot[armor.slot] =
      equippable?.getEquipment(armor.slot) ??
      runtime?.selectedArmorBySlot?.[armor.slot];
  }
  return {
    equippable,
    mainhand:
      equippable?.getEquipment(EquipmentSlot.Mainhand) ??
      runtime?.visualMainhand ??
      runtime?.selectedSword,
    offhand:
      equippable?.getEquipment(EquipmentSlot.Offhand) ??
      runtime?.visualOffhand ??
      runtime?.selectedOffhand,
    armorBySlot,
  };
}
const PATCH_VISUAL_SLOT_BY_EQUIPMENT = new Map([
  [EquipmentSlot.Mainhand, "slot.weapon.mainhand"],
  [EquipmentSlot.Offhand, "slot.weapon.offhand"],
  [EquipmentSlot.Head, "slot.armor.head"],
  [EquipmentSlot.Chest, "slot.armor.chest"],
  [EquipmentSlot.Legs, "slot.armor.legs"],
  [EquipmentSlot.Feet, "slot.armor.feet"],
]);
function patchGetBotEquipmentSelector(bot) {
  return `@e[type=${BOT_TYPE},x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=${PATCH_VISUAL_EQUIPMENT_SELECTOR_RADIUS},c=1]`;
}
function patchGetEquipmentSignature(bot) {
  const visual = patchGetVisualEquipmentState(bot);
  return [
    visual.mainhand?.typeId ?? AIR_ID,
    visual.offhand?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Head]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Chest]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Legs]?.typeId ?? AIR_ID,
    visual.armorBySlot[EquipmentSlot.Feet]?.typeId ?? AIR_ID,
  ].join("|");
}
function patchSyncVisualEquipmentSlots(bot, force = false) {
  const uid = getBotUid(bot);
  if (!uid) {
    return;
  }
  const runtime = getRuntime(uid);
  const visual = patchGetVisualEquipmentState(bot);
  const signature = patchGetEquipmentSignature(bot);
  if (
    !force &&
    runtime.lastVisualEquipmentSignature === signature &&
    globalTick - runtime.lastVisualEquipmentSyncTick <
      PATCH_VISUAL_EQUIPMENT_RESYNC_TICKS
  ) {
    return;
  }
  const selector = patchGetBotEquipmentSelector(bot);
  for (const slot of [
    EquipmentSlot.Mainhand,
    EquipmentSlot.Offhand,
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
  ]) {
    const commandSlot = PATCH_VISUAL_SLOT_BY_EQUIPMENT.get(slot);
    if (!commandSlot) {
      continue;
    }
    const item =
      slot === EquipmentSlot.Mainhand
        ? visual.mainhand
        : slot === EquipmentSlot.Offhand
          ? visual.offhand
          : visual.armorBySlot[slot];
    const itemId = item?.typeId ?? AIR_ID;
    const command = item
      ? `replaceitem entity ${selector} ${commandSlot} 0 ${itemId} 1 0`
      : `replaceitem entity ${selector} ${commandSlot} 0 air`;
    patchRunDimensionCommandNoThrow(bot.dimension, command);
  }
  runtime.lastVisualEquipmentSignature = signature;
  runtime.lastVisualEquipmentSyncTick = globalTick;
}
function patchDebugLoadoutSync(
  bot,
  config,
  sourceLabel,
  armorBySlot,
  selectedSword,
  selectedOffhandTotem,
  itemCounts = {},
) {
  const visual = patchGetVisualEquipmentState(bot);
  debugLog(
    bot,
    config,
    "loadout",
    `sync source=${sourceLabel} preset=${config.difficultyPreset} main=${patchFormatItemShort(selectedSword)} off=${patchFormatItemShort(selectedOffhandTotem)} ${patchDescribeArmorMap(armorBySlot)} ${patchFormatManagedCounts(itemCounts)}`,
    true,
  );
  debugLog(
    bot,
    config,
    "loadout",
    `actual ${visual.equippable ? "equippable=present" : "equippable=missing"} main=${patchFormatItemShort(visual.mainhand)} off=${patchFormatItemShort(
      visual.offhand,
    )} ${patchDescribeArmorMap(visual.armorBySlot)}`,
    true,
  );
}
const PATCH_DIFFICULTY_PRESETS = {
  easy: {
    maintainDistance: 4,
    pearlDistance: 14,
    pearlCooldown: 60,
    swordCooldown: 18,
    crystalCooldown: 20,
    crystalDetonateDelay: 5,
    anchorCooldown: 22,
    anchorDetonateDelay: 4,
  },
  normal: {
    maintainDistance: 3,
    pearlDistance: 10,
    pearlCooldown: 40,
    swordCooldown: 15,
    crystalCooldown: 15,
    crystalDetonateDelay: 3,
    anchorCooldown: 15,
    anchorDetonateDelay: 3,
  },
  hard: {
    maintainDistance: 2,
    pearlDistance: 8,
    pearlCooldown: 20,
    swordCooldown: 10,
    crystalCooldown: 10,
    crystalDetonateDelay: 1,
    anchorCooldown: 10,
    anchorDetonateDelay: 2,
  },
};
function patchApplyDifficultyPreset(config, presetId) {
  const preset =
    PATCH_DIFFICULTY_PRESETS[presetId] ?? PATCH_DIFFICULTY_PRESETS.normal;
  return {
    ...config,
    difficultyPreset: presetId,
    maintainDistance: preset.maintainDistance,
    pearlDistance: preset.pearlDistance,
    pearlCooldown: preset.pearlCooldown,
    swordCooldown: preset.swordCooldown,
    crystalCooldown: preset.crystalCooldown,
    crystalDetonateDelay: preset.crystalDetonateDelay,
    anchorCooldown: preset.anchorCooldown,
    anchorDetonateDelay: preset.anchorDetonateDelay,
  };
}
function patchGetDifficultyLabel(config) {
  switch (`${config?.difficultyPreset ?? "custom"}`) {
    case "easy":
      return "Easy";
    case "normal":
      return "Normal";
    case "hard":
      return "Hard";
    default:
      return "Custom";
  }
}
function patchRunDimensionCommandNoThrow(dimension, command) {
  try {
    const pending = runDimensionCommand(dimension, command);
    if (pending && typeof pending.catch === "function") {
      pending.catch(() => {});
    }
  } catch {}
}
function patchHighlightBotTotemPop(bot, config) {
  const equippable = getEquippableComponent(bot);
  const runtime = getRuntime(config.uid);
  const previousMainhand = equippable?.getEquipment?.(EquipmentSlot.Mainhand);
  const flashNameTag = `§e✦ ${config.displayName || "Crystal Bot"} §6[TOTEM]`;
  try {
    bot.nameTag = flashNameTag;
  } catch {}
  if (equippable) {
    try {
      equippable.setEquipment(
        EquipmentSlot.Mainhand,
        new ItemStack(TOTEM_ID, 1),
      );
    } catch {}
  }
  runtime.visualMainhand = new ItemStack(TOTEM_ID, 1);
  patchSyncVisualEquipmentSlots(bot, true);
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.totem_pop");
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) {
      return;
    }
    try {
      if (bot.nameTag === flashNameTag) {
        const latestConfig = botConfigs[getBotUid(bot)];
        bot.nameTag =
          latestConfig?.displayName || config.displayName || "Crystal Bot";
      }
    } catch {}
  }, PATCH_TOTEM_NAMETAG_FLASH_TICKS);
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) {
      return;
    }
    const nextEquippable = getEquippableComponent(bot);
    if (nextEquippable) {
      try {
        if (
          nextEquippable.getEquipment(EquipmentSlot.Mainhand)?.typeId ===
          TOTEM_ID
        ) {
          nextEquippable.setEquipment(
            EquipmentSlot.Mainhand,
            previousMainhand ? cloneItemStack(previousMainhand) : undefined,
          );
        }
      } catch {}
      if (!previousMainhand) {
        selectBestSword(bot);
      }
    } else {
      runtime.visualMainhand = previousMainhand
        ? cloneItemStack(previousMainhand)
        : cloneItemStack(runtime.selectedSword);
      patchSyncVisualEquipmentSlots(bot, true);
    }
    patchUpdateBotVisualEquipmentState(bot);
  }, PATCH_TOTEM_VISUAL_HOLD_TICKS);
}
function patchNotifyTotemPop(bot, config, reason) {
  const center = {
    x: bot.location.x,
    y: bot.location.y + 1,
    z: bot.location.z,
  };
  patchRunDimensionCommandNoThrow(
    bot.dimension,
    `playsound random.totem @a[x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=${PATCH_TOTEM_NOTIFICATION_RADIUS}] ${quoteCoord(center.x)} ${quoteCoord(center.y)} ${quoteCoord(center.z)} 1 1`,
  );
  patchRunDimensionCommandNoThrow(
    bot.dimension,
    `particle minecraft:totem_particle ${quoteCoord(center.x)} ${quoteCoord(center.y)} ${quoteCoord(center.z)}`,
  );
  patchHighlightBotTotemPop(bot, config);
}
function hasSupplyChest(config) {
  return !!config?.supplyChestDimensionKey;
}
function getSupplyChestLocation(config) {
  if (!hasSupplyChest(config)) {
    return undefined;
  }
  return {
    x: Math.floor(Number(config.supplyChestX ?? 0)),
    y: Math.floor(Number(config.supplyChestY ?? 0)),
    z: Math.floor(Number(config.supplyChestZ ?? 0)),
  };
}
function getBlockInventoryContainer(block) {
  if (!block || typeof block.getComponent !== "function") {
    return undefined;
  }
  try {
    return (
      block.getComponent("minecraft:inventory")?.container ??
      block.getComponent("inventory")?.container ??
      block.getComponent("minecraft:container")?.container ??
      block.getComponent("container")?.container
    );
  } catch {
    return undefined;
  }
}
function patchCollectContainerSnapshot(container) {
  const counts = patchCreateManagedItemCountMap();
  const armorBySlot = {};
  const armorScoreBySlot = {};
  let bestSword;
  let bestSwordStats;
  if (!container) {
    return { counts, armorBySlot, bestSword, bestSwordStats };
  }
  for (let index = 0; index < container.size; index += 1) {
    const item = container.getItem(index);
    if (!item) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(counts, item.typeId)) {
      counts[item.typeId] += item.amount ?? 1;
    }
    if (SWORD_STATS[item.typeId]) {
      const stats = patchGetSwordCombatStatsFromItem(item);
      if (!bestSwordStats || stats.score > bestSwordStats.score) {
        bestSword = item;
        bestSwordStats = stats;
      }
    }
    const armorSlot = patchGetArmorSlotForItem(item);
    if (armorSlot === undefined) {
      continue;
    }
    const armorScore = patchGetArmorSelectionScore(item);
    if ((armorScoreBySlot[armorSlot] ?? -1) < armorScore) {
      armorBySlot[armorSlot] = item;
      armorScoreBySlot[armorSlot] = armorScore;
    }
  }
  return { counts, armorBySlot, bestSword, bestSwordStats };
}
function getSupplyChestState(config) {
  const dimensionId = fromDimensionKey(config?.supplyChestDimensionKey);
  const location = getSupplyChestLocation(config);
  if (!dimensionId || !location) {
    return undefined;
  }
  let dimension;
  try {
    dimension = world.getDimension(dimensionId);
  } catch {
    return undefined;
  }
  const block = getBlock(dimension, location);
  const container = getBlockInventoryContainer(block);
  if (!block || !container) {
    return undefined;
  }
  return {
    block,
    container,
    dimension,
    location,
    snapshot: patchCollectContainerSnapshot(container),
  };
}
function syncBotLoadout(bot, config, force = false) {
  const runtime = getRuntime(config.uid);
  if (!force && globalTick - runtime.lastLoadoutSyncTick < 20) {
    return;
  }
  const supplyChest = getSupplyChestState(config);
  const owner = config.ownerName
    ? getPlayerByName(config.ownerName)
    : undefined;
  const ownerInventory = owner?.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const ownerEquippable = getEquippableComponent(owner);
  const botInventory = bot.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const botEquippable = getEquippableComponent(bot);
  if (!botInventory) {
    return;
  }
  const ownerSnapshot = ownerInventory
    ? patchCollectContainerSnapshot(ownerInventory)
    : undefined;
  const useSupplyChest = !!supplyChest;
  const inventoryMode = config.inventoryMode ?? "auto_refill";
  const needsOwner =
    (inventoryMode === "owner_sync" || config.mirrorOwnerLoadout) &&
    !useSupplyChest;
  if (
    needsOwner &&
    (!owner || !ownerInventory || !ownerEquippable || !ownerSnapshot)
  ) {
    return;
  }
  runtime.lastLoadoutSyncTick = globalTick;
  const ownerMainhand = ownerEquippable?.getEquipment(EquipmentSlot.Mainhand);
  const ownerSword = SWORD_STATS[ownerMainhand?.typeId]
    ? ownerMainhand
    : ownerSnapshot?.bestSword;
  const ownerArmor = ownerEquippable
    ? {
        [EquipmentSlot.Head]: ownerEquippable.getEquipment(EquipmentSlot.Head),
        [EquipmentSlot.Chest]: ownerEquippable.getEquipment(
          EquipmentSlot.Chest,
        ),
        [EquipmentSlot.Legs]: ownerEquippable.getEquipment(EquipmentSlot.Legs),
        [EquipmentSlot.Feet]: ownerEquippable.getEquipment(EquipmentSlot.Feet),
      }
    : {};
  const ownerOffhand = ownerEquippable?.getEquipment(EquipmentSlot.Offhand);
  const ownerOffhandTotem =
    ownerOffhand?.typeId === TOTEM_ID ? ownerOffhand : undefined;
  const selectedArmorBySlot = {};
  let itemCounts = {};
  if (inventoryMode === "infinite") {
    for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
      itemCounts[itemId] = 64;
    }
  } else if (
    inventoryMode === "owner_sync" &&
    ownerSnapshot &&
    !useSupplyChest
  ) {
    const ownerCounts = patchCreateManagedItemCountMap(ownerSnapshot.counts);
    itemCounts = {};
    if (!runtime.ownerSyncInitialized) {
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
        itemCounts[itemId] = ownerCounts[itemId] ?? 0;
      }
      runtime.ownerSyncBaseCounts = { ...ownerCounts };
      runtime.ownerSyncInitialized = true;
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable ? botEquippable.getEquipment(EquipmentSlot.Offhand) : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) {
        currentCounts[off.typeId] = (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      }
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
        const prevOwnerCount = runtime.ownerSyncBaseCounts[itemId] ?? 0;
        const currentOwnerCount = ownerCounts[itemId] ?? 0;
        const diff = currentOwnerCount - prevOwnerCount;
        let newBotCount = currentCounts[itemId] ?? 0;
        if (diff !== 0) {
          newBotCount += diff;
          runtime.ownerSyncBaseCounts[itemId] = currentOwnerCount;
        }
        itemCounts[itemId] = Math.max(0, newBotCount);
      }
    }
  } else if (inventoryMode === "custom") {
    const baseItemCounts = patchCreateManagedItemCountMap(
      config.customItemCounts ?? {},
    );
    for (const [itemId, defaultCount] of Object.entries(
      PATCH_DEFAULT_COMBAT_ITEM_COUNTS,
    )) {
      if (config.customItemCounts?.[itemId] === undefined) {
        baseItemCounts[itemId] = defaultCount;
      }
    }
    if (!runtime.customBudgetInitialized) {
      itemCounts = { ...baseItemCounts };
      runtime.customBudgetInitialized = true;
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable
        ? botEquippable.getEquipment(EquipmentSlot.Offhand)
        : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) {
        currentCounts[off.typeId] =
          (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      }
      const main = botEquippable
        ? botEquippable.getEquipment(EquipmentSlot.Mainhand)
        : runtime.visualMainhand;
      if (main && PATCH_MANAGED_STACK_ITEM_IDS.includes(main.typeId)) {
        if (main.typeId !== TOTEM_ID) {
          currentCounts[main.typeId] =
            (currentCounts[main.typeId] ?? 0) + (main.amount ?? 1);
        }
      }
      for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
        itemCounts[itemId] = Math.min(
          baseItemCounts[itemId] ?? 0,
          currentCounts[itemId] ?? 0,
        );
      }
    }
  } else {
    if (useSupplyChest) {
      itemCounts = patchCreateManagedItemCountMap(supplyChest.snapshot.counts);
    } else {
      const currentCounts = patchCollectContainerSnapshot(botInventory).counts;
      const off = botEquippable
        ? botEquippable.getEquipment(EquipmentSlot.Offhand)
        : runtime.visualOffhand;
      if (off && PATCH_MANAGED_STACK_ITEM_IDS.includes(off.typeId)) {
        currentCounts[off.typeId] =
          (currentCounts[off.typeId] ?? 0) + (off.amount ?? 1);
      }
      const main = botEquippable
        ? botEquippable.getEquipment(EquipmentSlot.Mainhand)
        : runtime.visualMainhand;
      if (
        main &&
        PATCH_MANAGED_STACK_ITEM_IDS.includes(main.typeId) &&
        main.typeId !== TOTEM_ID
      ) {
        currentCounts[main.typeId] =
          (currentCounts[main.typeId] ?? 0) + (main.amount ?? 1);
      }
      itemCounts = patchCreateManagedItemCountMap(currentCounts);
      let totalItems = 0;
      for (const count of Object.values(itemCounts)) totalItems += count;
      if (totalItems === 0) {
        itemCounts = patchCreateManagedItemCountMap(
          PATCH_DEFAULT_COMBAT_ITEM_COUNTS,
        );
      }
    }
  }
  const selectedSword =
    supplyChest?.snapshot.bestSword ??
    ownerSword ??
    applyEnchantments(
      new ItemStack("minecraft:netherite_sword", 1),
      BOT_SWORD_ENCHANTMENTS,
      config.unbreakableEquipment ?? true,
    );
  let totemCountForInventory = itemCounts[TOTEM_ID] ?? 0;
  const currentBotOffhand = botEquippable
    ? botEquippable.getEquipment(EquipmentSlot.Offhand)
    : runtime.visualOffhand;
  const botHasTotemInHand = currentBotOffhand?.typeId === TOTEM_ID;
  const totemDelayActive =
    config.autoTotem &&
    Number(config.totemRefillDelay ?? 0) > 0 &&
    runtime.lastTotemPopTick > -9999 &&
    globalTick - runtime.lastTotemPopTick <
      Number(config.totemRefillDelay ?? 0);
  let selectedOffhandTotem = undefined;
  if (botHasTotemInHand) {
    selectedOffhandTotem = new ItemStack(TOTEM_ID, 1);
    if (totemCountForInventory > 0) totemCountForInventory -= 1;
  } else if (totemDelayActive) {
    selectedOffhandTotem = undefined;
  } else if (config.autoTotem) {
    if (inventoryMode === "infinite") {
      selectedOffhandTotem = new ItemStack(TOTEM_ID, 1);
    } else if (totemCountForInventory > 0) {
      selectedOffhandTotem = new ItemStack(TOTEM_ID, 1);
      totemCountForInventory -= 1;
    } else if (totemCountForInventory > 0) {
      selectedOffhandTotem = new ItemStack(TOTEM_ID, 1);
      totemCountForInventory -= 1;
    }
  }
  for (let index = 0; index < botInventory.size; index += 1) {
    botInventory.setItem(index, undefined);
  }
  patchPlaceItemInContainer(
    botInventory,
    cloneItemStack(selectedSword) ??
      applyEnchantments(
        new ItemStack("minecraft:netherite_sword", 1),
        BOT_SWORD_ENCHANTMENTS,
      ),
  );
  for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
    let countToGive =
      itemId === TOTEM_ID ? totemCountForInventory : itemCounts[itemId];
    if (countToGive > 0) {
      try {
        const dummyItem = new ItemStack(itemId, 1);
        const maxAmount = dummyItem.maxAmount ?? 64;
        while (countToGive > 0) {
          const stackSize = Math.min(countToGive, maxAmount);
          const stack = new ItemStack(itemId, stackSize);
          try {
            botInventory.addItem(stack);
          } catch {
            patchPlaceItemInContainer(botInventory, stack);
          }
          countToGive -= stackSize;
        }
      } catch (error) {
        appendPersistentDebugLog(
          "inventory",
          `Item creation failed for ${itemId}: ${formatError(error)}`,
        );
      }
    }
  }
  for (const armor of BOT_ARMOR) {
    const selectedArmor =
      supplyChest?.snapshot.armorBySlot[armor.slot] ??
      ownerArmor[armor.slot] ??
      ownerSnapshot?.armorBySlot[armor.slot] ??
      buildFallbackArmor(armor.slot);
    selectedArmorBySlot[armor.slot] = selectedArmor;
    if (selectedArmor) {
      patchPlaceItemInContainer(botInventory, cloneItemStack(selectedArmor));
    }
  }
  runtime.selectedArmorBySlot = patchCloneArmorBySlot(selectedArmorBySlot);
  runtime.selectedSword = cloneItemStack(selectedSword);
  runtime.visualMainhand = cloneItemStack(selectedSword);
  patchApplyArmorSelection(bot, selectedArmorBySlot);
  if (botEquippable) {
    try {
      botEquippable.setEquipment(
        EquipmentSlot.Mainhand,
        cloneItemStack(selectedSword),
      );
    } catch {}
  }
  runtime.selectedOffhand = selectedOffhandTotem
    ? cloneItemStack(selectedOffhandTotem)
    : undefined;
  runtime.visualOffhand = selectedOffhandTotem
    ? cloneItemStack(selectedOffhandTotem)
    : undefined;
  if (botEquippable) {
    try {
      botEquippable.setEquipment(EquipmentSlot.Offhand, selectedOffhandTotem);
    } catch {}
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
  patchDebugLoadoutSync(
    bot,
    config,
    useSupplyChest
      ? `supply_chest:${formatSupplyChest(config)}`
      : `owner:${config.ownerName || "none"}`,
    selectedArmorBySlot,
    selectedSword,
    selectedOffhandTotem,
    itemCounts,
  );
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) {
      return;
    }
    patchApplyArmorSelection(bot, selectedArmorBySlot);
    patchSyncVisualEquipmentSlots(bot, true);
  }, 1);
}
addOrFallbackInventoryItem = function (inventory, preferredItem, fallbackItem) {
  patchPlaceItemInContainer(inventory, preferredItem ?? fallbackItem);
};
equipMainhandItem = function (bot, itemId, config, allowSync = true) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const equippable = getEquippableComponent(bot);
  if (!inventory) {
    return false;
  }
  let item = patchFindInventoryItem(inventory, itemId);
  if (!item && allowSync && config) {
    syncBotLoadout(bot, config, true);
    item = patchFindInventoryItem(inventory, itemId);
  }
  if (!item) {
    return false;
  }
  const runtime = getRuntime(config?.uid ?? getBotUid(bot));
  runtime.visualMainhand = cloneItemStack(item);
  if (!equippable) {
    patchSyncVisualEquipmentSlots(bot, true);
    return true;
  }
  try {
    equippable.setEquipment(EquipmentSlot.Mainhand, cloneItemStack(item));
  } catch {}
  patchSyncVisualEquipmentSlots(bot, true);
  return true;
};
consumeInventoryItem = function (container, itemId, amount = 1) {
  if (!container || !itemId || amount <= 0) {
    return false;
  }
  for (let index = 0; index < container.size; index += 1) {
    const item = container.getItem(index);
    if (item?.typeId !== itemId) {
      continue;
    }
    const remaining = (item.amount ?? 1) - amount;
    if (remaining > 0) {
      container.setItem(index, patchCloneItemStackWithAmount(item, remaining));
    } else {
      container.setItem(index, undefined);
    }
    return true;
  }
  return false;
};
function consumeManagedItem(bot, config, itemId, amount = 1) {
  if (config?.inventoryMode === "infinite") {
    return true;
  }
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) {
    debugLog(
      bot,
      config,
      "combat",
      `§4アイテム消費失敗: インベントリ取得不可 (${itemId})`,
      true,
    );
    return false;
  }
  if (consumeInventoryItem(inventory, itemId, amount)) {
    const remaining = countItemInContainer(inventory, itemId);
    debugLog(
      bot,
      config,
      "inventory",
      `アイテム消費: ${itemId.replace("minecraft:", "")} -${amount} 残量=${remaining} mode=${config?.inventoryMode ?? "?"}`,
    );
    return true;
  }
  if (config) {
    syncBotLoadout(bot, config, true);
  }
  const result = consumeInventoryItem(inventory, itemId, amount);
  if (!result) {
    const remaining = countItemInContainer(inventory, itemId);
    debugLog(
      bot,
      config,
      "combat",
      `§4アイテム消費失敗: ${itemId.replace("minecraft:", "")} 残量=${remaining} 要求=${amount} mode=${config?.inventoryMode ?? "?"}`,
      true,
    );
  }
  return result;
}
tryPopTotem = function (bot, config, reason = "unknown") {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const health = bot.getComponent(EntityComponentTypes.Health);
  if (!inventory || !health) {
    return false;
  }
  let consumed = false;
  const runtime = getRuntime(config.uid);
  const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
  if (equippable) {
    if (offhand?.typeId === TOTEM_ID) {
      try {
        equippable.setEquipment(EquipmentSlot.Offhand, undefined);
        runtime.visualOffhand = undefined;
        consumed = true;
      } catch {}
    }
  } else {
    if (runtime.visualOffhand?.typeId === TOTEM_ID) {
      runtime.visualOffhand = undefined;
      consumed = true;
    }
  }
  if (!consumed) {
    const offhandId = equippable
      ? (offhand?.typeId ?? "none")
      : (runtime.visualOffhand?.typeId ?? "none");
    appendPersistentDebugLog(
      "totem",
      `${config.uid}: tryPopTotem失敗 reason=${reason} offhand=${offhandId} mode=${config.inventoryMode}`,
    );
    return false;
  }
  const maxHealth = Number(health.effectiveMax ?? health.defaultValue ?? 20);
  const reviveHealth = Math.max(
    1,
    Math.min(maxHealth, PATCH_TOTEM_REVIVE_HEALTH),
  );
  setHealthValue(bot, reviveHealth);
  try {
    bot.addEffect("regeneration", PATCH_TOTEM_REGEN_TICKS, {
      amplifier: 1,
      showParticles: false,
    });
  } catch {}
  try {
    bot.addEffect("absorption", PATCH_TOTEM_ABSORPTION_TICKS, {
      amplifier: 1,
      showParticles: false,
    });
  } catch {}
  try {
    bot.addEffect("fire_resistance", PATCH_TOTEM_FIRE_RESISTANCE_TICKS, {
      amplifier: 0,
      showParticles: false,
    });
  } catch {}
  try {
    bot.addEffect("resistance", PATCH_TOTEM_EMERGENCY_RESISTANCE_TICKS, {
      amplifier: 4,
      showParticles: false,
    });
  } catch {}
  runtime.lastTotemPopTick = globalTick;
  runtime.totemShieldUntilTick = globalTick + PATCH_TOTEM_DAMAGE_IMMUNITY_TICKS;
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.totem_pop");
  const remaining = countItemInContainer(inventory, TOTEM_ID);
  debugLog(
    bot,
    config,
    "totem",
    `疑似トーテム発動: ${reason} (手持ち消費完了 / インベントリ残量: ${remaining}個)`,
    true,
  );
  ensureAutoTotem(bot, config);
  system.runTimeout(() => {
    if (!isEntityUsable(bot, BOT_TYPE)) return;
    if (patchGetCurrentHealthValue(bot) < reviveHealth) {
      setHealthValue(bot, reviveHealth);
    }
  }, 1);
  patchNotifyTotemPop(bot, config, reason);
  return true;
};
seedBotLoadout = function (bot) {
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const equippable = getEquippableComponent(bot);
  if (!inventory) {
    return;
  }
  for (let index = 0; index < inventory.size; index += 1) {
    inventory.setItem(index, undefined);
  }
  const starterItems = [
    applyEnchantments(
      new ItemStack("minecraft:netherite_sword", 1),
      BOT_SWORD_ENCHANTMENTS,
      true,
    ),
    new ItemStack(OBSIDIAN_ID, 64),
    new ItemStack(END_CRYSTAL_ID, 16),
    new ItemStack(RESPAWN_ANCHOR_ID, 8),
    new ItemStack(GLOWSTONE_ID, 16),
    new ItemStack(ENDER_PEARL_ID, 16),
    new ItemStack(TOTEM_ID, 8),
    new ItemStack(PATCH_ENCHANTED_GOLDEN_APPLE_ID, 4),
    new ItemStack(PATCH_GOLDEN_APPLE_ID, 8),
  ];
  for (const item of starterItems) {
    patchPlaceItemInContainer(inventory, item);
  }
  if (equippable) {
    for (const armor of BOT_ARMOR) {
      try {
        equippable.setEquipment(
          armor.slot,
          applyEnchantments(
            new ItemStack(armor.itemId, 1),
            BOT_ARMOR_ENCHANTMENTS[armor.slot] ?? [],
            true,
          ),
        );
      } catch {}
    }
    try {
      equippable.setEquipment(
        EquipmentSlot.Mainhand,
        applyEnchantments(
          new ItemStack("minecraft:netherite_sword", 1),
          BOT_SWORD_ENCHANTMENTS,
          true,
        ),
      );
    } catch {}
    try {
      equippable.setEquipment(
        EquipmentSlot.Offhand,
        new ItemStack(TOTEM_ID, 1),
      );
    } catch {}
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
};
ensureBotInitialized = function (bot, ownerPlayer) {
  if (bot.typeId !== BOT_TYPE) {
    return undefined;
  }
  trackBot(bot);
  const owner =
    ownerPlayer ?? findClosestPlayer(bot.location, bot.dimension, 24);
  const config = materializeConfig(bot, owner);
  if (!bot.hasTag(BOT_READY_TAG)) {
    bot.addTag(BOT_READY_TAG);
    getRuntime(config.uid).spawnTick = globalTick;
    bot.nameTag = config.displayName || "Crystal Bot";
    seedBotLoadout(bot);
    syncBotLoadout(bot, config, true);
    logBotEvent(
      bot,
      `initialized at ${bot.location.x.toFixed(1)}, ${bot.location.y.toFixed(1)}, ${bot.location.z.toFixed(1)}`,
    );
  }
  return config;
};
syncBotLoadoutFromOwner = function (bot, config, force = false) {
  syncBotLoadout(bot, config, force);
};
ensureBotEquipmentIntegrity = function (bot, config) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!equippable) {
    patchUpdateBotVisualEquipmentState(bot);
    patchSyncVisualEquipmentSlots(bot, true);
    return;
  }
  if (!equippable.getEquipment(EquipmentSlot.Mainhand)) {
    let hasSword = false;
    if (inventory) {
      for (let index = 0; index < inventory.size; index += 1) {
        const item = inventory.getItem(index);
        if (item && SWORD_STATS[item.typeId]) {
          hasSword = true;
          break;
        }
      }
    }
    if (hasSword) {
      selectBestSword(bot);
    } else {
      equippable.setEquipment(
        EquipmentSlot.Mainhand,
        applyEnchantments(
          new ItemStack("minecraft:netherite_sword", 1),
          BOT_SWORD_ENCHANTMENTS,
        ),
      );
    }
  }
  for (const armor of BOT_ARMOR) {
    if (!equippable.getEquipment(armor.slot)) {
      equippable.setEquipment(armor.slot, buildFallbackArmor(armor.slot));
    }
  }
  if (!equippable.getEquipment(EquipmentSlot.Offhand)) {
    ensureAutoTotem(bot, config);
  }
  patchUpdateBotVisualEquipmentState(bot);
  patchSyncVisualEquipmentSlots(bot, true);
};
shouldUseAnchorCombo = function (bot, target, config) {
  if (!config.anchorCombo) {
    return false;
  }
  if (bot.dimension.id === "minecraft:nether") {
    return false;
  }
  const currentDistance = distance(bot.location, target.location);
  return currentDistance <= PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE;
};
selectBestSword = function (bot) {
  const equippable = getEquippableComponent(bot);
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  const runtime = getRuntime(getBotUid(bot));
  let bestStats;
  let bestItem;
  if (inventory) {
    for (let index = 0; index < inventory.size; index += 1) {
      const item = inventory.getItem(index);
      const stats =
        item && SWORD_STATS[item.typeId]
          ? patchGetSwordCombatStatsFromItem(item)
          : undefined;
      if (!stats || (bestStats && stats.score < bestStats.score)) {
        continue;
      }
      bestStats = stats;
      bestItem = item;
    }
  }
  if (bestItem) {
    runtime.visualMainhand = cloneItemStack(bestItem);
    if (equippable) {
      try {
        equippable.setEquipment(
          EquipmentSlot.Mainhand,
          cloneItemStack(bestItem),
        );
      } catch {}
      patchSyncVisualEquipmentSlots(bot, true);
    }
    return bestStats;
  }
  const current = equippable?.getEquipment?.(EquipmentSlot.Mainhand);
  if (SWORD_STATS[current?.typeId]) {
    runtime.visualMainhand = cloneItemStack(current);
    return patchGetSwordCombatStatsFromItem(current);
  }
  runtime.visualMainhand = applyEnchantments(
    new ItemStack("minecraft:netherite_sword", 1),
    BOT_SWORD_ENCHANTMENTS,
  );
  return patchGetSwordCombatStatsFromItem(
    new ItemStack("minecraft:netherite_sword", 1),
  );
};
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
  for (let index = 0; index < inventory.size; index += 1) {
    if (inventory.getItem(index)?.typeId === TOTEM_ID) {
      foundSlot = index;
      break;
    }
  }
  if (foundSlot === -1 && allowSync) {
    syncBotLoadout(bot, config, true);
    for (let index = 0; index < inventory.size; index += 1) {
      if (inventory.getItem(index)?.typeId === TOTEM_ID) {
        foundSlot = index;
        break;
      }
    }
  }
  if (foundSlot === -1) {
    if (config.inventoryMode === "infinite" && equippable) {
      try {
        equippable.setEquipment(
          EquipmentSlot.Offhand,
          new ItemStack(TOTEM_ID, 1),
        );
      } catch {}
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
    try {
      equippable.setEquipment(
        EquipmentSlot.Offhand,
        patchCloneItemStackWithAmount(stack, 1),
      );
    } catch {
      patchPlaceItemInContainer(inventory, cloneItemStack(stack));
      return false;
    }
  } else {
    if (runtime.visualOffhand) {
      patchPlaceItemInContainer(
        inventory,
        cloneItemStack(runtime.visualOffhand),
      );
    }
  }
  if ((stack.amount ?? 1) > 1) {
    patchPlaceItemInContainer(
      inventory,
      patchCloneItemStackWithAmount(stack, (stack.amount ?? 1) - 1),
    );
  }
  runtime.visualOffhand = new ItemStack(TOTEM_ID, 1);
  patchSyncVisualEquipmentSlots(bot, true);
  const remaining = countItemInContainer(inventory, TOTEM_ID);
  const modeText = equippable ? "" : "(代替処理) ";
  debugLog(
    bot,
    config,
    "totem",
    modeText + "オフハンドへトーテムを装填しました。残量: " + remaining + "個",
    true,
  );
  return true;
}
ensureAutoTotem = function (bot, config) {
  if (!config.autoTotem) return;
  const runtime = getRuntime(config.uid);
  if (
    globalTick - runtime.lastTotemPopTick <
    Number(config.totemRefillDelay ?? 0)
  )
    return;
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const equippable = getEquippableComponent(bot);
  const currentOffhand = equippable
    ? equippable.getEquipment(EquipmentSlot.Offhand)
    : runtime.visualOffhand;
  if (currentOffhand?.typeId === TOTEM_ID) {
    return;
  }
  if (!equipTotemOffhand(bot, config, true)) {
  }
};
function handleTotemSafety(bot, config) {
  if (!config.autoTotem) {
    return;
  }
  const runtime = getRuntime(config.uid);
  const currentOffhand = getEquippableComponent(bot)?.getEquipment(
    EquipmentSlot.Offhand,
  );
  const hasTotemNow = currentOffhand?.typeId === TOTEM_ID;
  if (runtime.hadTotemLastTick && !hasTotemNow) {
    runtime.lastTotemPopTick = globalTick;
    const inventory = bot.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    const remaining = countItemInContainer(inventory, TOTEM_ID);
    debugLog(
      bot,
      config,
      "totem",
      `トーテムが発動しました (インベントリ残量: ${remaining}個)`,
      true,
    );
  }
  runtime.hadTotemLastTick = hasTotemNow;
  ensureAutoTotem(bot, config);
}
function applyArmorDerivedEffects(bot) {
  const armorItems = patchGetEquippedArmorItems(bot);
  if (!armorItems.length) {
    return;
  }
  const armorPoints = armorItems.reduce(
    (sum, item) => sum + patchGetArmorDefenseValue(item),
    0,
  );
  const enchantPoints = armorItems.reduce(
    (sum, item) => sum + patchGetProtectionLevelForDamageCause(item),
    0,
  );
  let resistanceAmplifier = -1;
  if (armorPoints >= 20 || armorPoints + enchantPoints * 0.5 >= 24) {
    resistanceAmplifier = 1;
  } else if (armorPoints >= 10 || enchantPoints >= 8) {
    resistanceAmplifier = 0;
  }
  if (resistanceAmplifier >= 0) {
    try {
      bot.addEffect("resistance", PATCH_ARMOR_EFFECT_REFRESH_TICKS, {
        amplifier: resistanceAmplifier,
        showParticles: false,
      });
    } catch {}
  }
}
function patchHasLineOfSightBetween(dimension, from, to, step = 0.35) {
  const delta = vectorTo(from, to);
  const distanceToTarget = Math.hypot(delta.x, delta.y, delta.z);
  if (distanceToTarget <= 0.01) {
    return true;
  }
  const direction = {
    x: delta.x / distanceToTarget,
    y: delta.y / distanceToTarget,
    z: delta.z / distanceToTarget,
  };
  for (let traveled = step; traveled < distanceToTarget; traveled += step) {
    const sample = {
      x: from.x + direction.x * traveled,
      y: from.y + direction.y * traveled,
      z: from.z + direction.z * traveled,
    };
    if (isSolidBlock(getBlock(dimension, sample))) {
      return false;
    }
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
  return targetSamples.some((sample) =>
    patchHasLineOfSightBetween(bot.dimension, eye, sample),
  );
}
function patchHasJumpDashClearance(dimension, location) {
  return (
    isAirBlock(
      getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 })),
    ) &&
    isAirBlock(getBlock(dimension, addVector(location, { x: 0, y: 2, z: 0 })))
  );
}
function patchIsEntityOnGroundSafe(entity) {
  try {
    if (typeof entity?.isOnGround === "boolean") {
      return entity.isOnGround;
    }
  } catch {}
  const grounded = findNearestStandingLocation(
    entity.dimension,
    entity.location,
    [0, -1],
  );
  return !!grounded && Math.abs(grounded.y - entity.location.y) <= 0.45;
}
function patchShouldJumpDash(bot, target, config, moveDirection) {
  if (!config?.jumpDash) {
    return false;
  }
  const runtime = getRuntime(config.uid);
  if (globalTick - runtime.lastJumpDashTick < PATCH_JUMP_DASH_COOLDOWN_TICKS) {
    return false;
  }
  if (
    !patchIsEntityOnGroundSafe(bot) ||
    !patchHasJumpDashClearance(bot.dimension, bot.location)
  ) {
    return false;
  }
  if (
    distance(bot.location, target.location) <=
    config.maintainDistance - 0.1
  ) {
    return false;
  }
  return (
    Math.hypot(moveDirection.x, moveDirection.z) > PATCH_JUMP_DASH_MIN_DIRECTION
  );
}
function isLocationInsideBotBoundary(location) {
  const settings = normalizeGlobalSettings(globalSettings);
  if (!settings.boundaryEnabled) return true;
  return (
    location.x >= settings.boundaryMinX - 0.5 &&
    location.x <= settings.boundaryMaxX + 0.5 &&
    location.y >= settings.boundaryMinY &&
    location.y <= settings.boundaryMaxY &&
    location.z >= settings.boundaryMinZ - 0.5 &&
    location.z <= settings.boundaryMaxZ + 0.5
  );
}
function clampLocationToBotBoundary(location) {
  const settings = normalizeGlobalSettings(globalSettings);
  return {
    x: Math.max(
      settings.boundaryMinX + 0.5,
      Math.min(settings.boundaryMaxX - 0.5, location.x),
    ),
    y: Math.max(
      settings.boundaryMinY,
      Math.min(settings.boundaryMaxY, location.y),
    ),
    z: Math.max(
      settings.boundaryMinZ + 0.5,
      Math.min(settings.boundaryMaxZ - 0.5, location.z),
    ),
  };
}
function findSafeBoundaryReturnLocation(bot) {
  const clamped = clampLocationToBotBoundary(bot.location);
  for (const yOffset of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const candidate = addVector(clamped, { x: 0, y: yOffset, z: 0 });
    if (
      isSafeStandingLocation(bot.dimension, candidate) &&
      isLocationInsideBotBoundary(candidate)
    ) {
      return candidate;
    }
  }
  return clamped;
}
function enforceBotBoundary(bot, config) {
  if (
    !globalSettings.boundaryEnabled ||
    isLocationInsideBotBoundary(bot.location)
  ) {
    return false;
  }
  const destination = findSafeBoundaryReturnLocation(bot);
  try {
    bot.teleport(destination, { dimension: bot.dimension });
    debugLog(
      bot,
      config,
      "movement",
      "安全範囲外に出たため範囲内へ戻しました。",
      true,
    );
    return true;
  } catch (error) {
    appendPersistentDebugLog(
      "error",
      `boundary return failed: ${formatError(error)}`,
    );
    return false;
  }
}
function patchUpdateStuckState(bot, runtime) {
  const previous = runtime.lastMovementLocation;
  runtime.lastMovementLocation = { ...bot.location };
  if (!previous) {
    runtime.stuckTicks = 0;
    return false;
  }
  const moved = Math.hypot(
    bot.location.x - previous.x,
    bot.location.z - previous.z,
  );
  runtime.stuckTicks = moved < 0.12 ? Number(runtime.stuckTicks ?? 0) + 1 : 0;
  return runtime.stuckTicks >= 4;
}
function patchFindMovementStep(
  dimension,
  origin,
  moveDirection,
  aggressive = false,
) {
  const distances = aggressive ? [0.45, 0.7, 0.95, 1.2] : [0.28, 0.45, 0.65];
  const yOffsets = aggressive ? [0, -1, -2, 1, 2] : [0, -1, 1, -2];
  for (const step of distances) {
    const base = addVector(origin, {
      x: moveDirection.x * step,
      y: 0,
      z: moveDirection.z * step,
    });
    for (const yOffset of yOffsets) {
      const candidate = addVector(base, { x: 0, y: yOffset, z: 0 });
      if (isSafeStandingLocation(dimension, candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}
function patchFindDescendStep(
  dimension,
  origin,
  targetLocation,
  moveDirection,
) {
  if (!targetLocation || targetLocation.y >= origin.y - 0.1) {
    return undefined;
  }
  const distances = [0, 0.35, 0.7, 1.05, 1.35];
  const yOffsets = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const step of distances) {
    const base = addVector(origin, {
      x: moveDirection.x * step,
      y: 0,
      z: moveDirection.z * step,
    });
    for (const yOffset of yOffsets) {
      const candidate = addVector(base, { x: 0, y: yOffset, z: 0 });
      if (
        candidate.y >= origin.y - 0.2 ||
        !isSafeStandingLocation(dimension, candidate)
      ) {
        continue;
      }
      const verticalScore = Math.abs(candidate.y - targetLocation.y);
      const horizontalScore =
        Math.hypot(
          candidate.x - targetLocation.x,
          candidate.z - targetLocation.z,
        ) * 0.25;
      const score = verticalScore + horizontalScore;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}
function patchTryBuildStep(bot, config, moveDirection) {
  const runtime = getRuntime(config.uid);
  if (globalTick - Number(runtime.lastBuildStepTick ?? -9999) < 4) {
    return undefined;
  }
  const origin = floorLocation(bot.location);
  const front = {
    x: origin.x + Math.round(moveDirection.x),
    y: origin.y,
    z: origin.z + Math.round(moveDirection.z),
  };
  if (front.x === origin.x && front.z === origin.z) {
    return undefined;
  }
  const climbTargets = [
    addVector(front, { x: 0, y: 1, z: 0 }),
    addVector(front, { x: 0, y: 2, z: 0 }),
  ];
  for (const target of climbTargets) {
    if (isSafeStandingLocation(bot.dimension, target)) {
      runtime.lastBuildStepTick = globalTick;
      return target;
    }
  }
  const support = addVector(front, { x: 0, y: -1, z: 0 });
  const supportBlock = getBlock(bot.dimension, support);
  const feet = getBlock(bot.dimension, front);
  const head = getBlock(bot.dimension, addVector(front, { x: 0, y: 1, z: 0 }));
  if (!isAirBlock(supportBlock) || !isAirBlock(feet) || !isAirBlock(head)) {
    return undefined;
  }
  const buildBlocks = [
    OBSIDIAN_ID,
    "minecraft:cobblestone",
    "minecraft:dirt",
    "minecraft:stone",
  ];
  for (const blockId of buildBlocks) {
    if (
      equipMainhandItem(bot, blockId, config) &&
      consumeManagedItem(bot, config, blockId, 1)
    ) {
      try {
        supportBlock.setPermutation(BlockPermutation.resolve(blockId));
        runtime.lastBuildStepTick = globalTick;
        return front;
      } catch {}
    }
  }
  return undefined;
}
function patchTryJumpDashTeleport(bot, target, config, moveDirection) {
  const runtime = getRuntime(config.uid);
  const toTarget = normalize2D(vectorTo(bot.location, target.location));
  const forwardDot =
    moveDirection.x * toTarget.x + moveDirection.z * toTarget.z;
  const dashScale = forwardDot < 0.25 ? 0.35 : forwardDot < 0.7 ? 0.6 : 1;
  const landing = patchFindMovementStep(
    bot.dimension,
    addVector(bot.location, {
      x: moveDirection.x * 0.45 * dashScale,
      y: 0.55,
      z: moveDirection.z * 0.45 * dashScale,
    }),
    moveDirection,
    dashScale >= 0.6,
  );
  if (!landing) {
    return false;
  }
  try {
    const snapped = patchSnapToBlockCenter(landing);
    if (
      !isSafeStandingLocation(bot.dimension, snapped) ||
      !canOccupyLocation(bot.dimension, snapped)
    ) {
      return false;
    }
    bot.teleport(snapped, {
      dimension: bot.dimension,
      facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
    });
    runtime.jumpDashAirborneUntilTick = globalTick + 1;
    return true;
  } catch {}
  return false;
}
function patchShouldConsumeGoldenApple(bot, itemId) {
  const runtime = getRuntime(getBotUid(bot) || "");
  const absorptionRemaining = Math.max(
    patchGetEffectDurationTicks(bot, "absorption"),
    Number(runtime.foodAbsorptionUntilTick ?? -9999) - globalTick,
  );
  const regenRemaining = Math.max(
    patchGetEffectDurationTicks(bot, "regeneration"),
    Number(runtime.foodRegenUntilTick ?? -9999) - globalTick,
  );
  if (regenRemaining > 80) {
    return false;
  }
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  const isHealthLow = currentHealth / maxHealth <= 0.5;
  if (itemId === PATCH_ENCHANTED_GOLDEN_APPLE_ID) {
    if (isHealthLow || absorptionRemaining <= PATCH_FOOD_REUSE_BUFFER_TICKS) {
      return true;
    }
    return false;
  }
  if (isHealthLow || absorptionRemaining <= PATCH_FOOD_REUSE_BUFFER_TICKS) {
    return true;
  }
  return false;
}
function patchApplyGoldenAppleEffects(bot, itemId) {
  const runtime = getRuntime(getBotUid(bot) || "");
  if (itemId === PATCH_ENCHANTED_GOLDEN_APPLE_ID) {
    try {
      bot.addEffect("regeneration", 600, {
        amplifier: 1,
        showParticles: false,
      });
    } catch {}
    try {
      bot.addEffect("absorption", 2400, { amplifier: 3, showParticles: false });
    } catch {}
    try {
      bot.addEffect("resistance", 6000, { amplifier: 0, showParticles: false });
    } catch {}
    try {
      bot.addEffect("fire_resistance", 6000, {
        amplifier: 0,
        showParticles: false,
      });
    } catch {}
    runtime.foodAbsorptionUntilTick = globalTick + 2400;
    runtime.foodRegenUntilTick = globalTick + 600;
    runtime.foodResistanceUntilTick = globalTick + 6000;
    runtime.foodFireResistanceUntilTick = globalTick + 6000;
    return;
  }
  try {
    bot.addEffect("regeneration", 100, { amplifier: 1, showParticles: false });
  } catch {}
  try {
    bot.addEffect("absorption", 2400, { amplifier: 0, showParticles: false });
  } catch {}
  runtime.foodAbsorptionUntilTick = globalTick + 2400;
  runtime.foodRegenUntilTick = globalTick + 100;
}
function patchFindRetreatPearlLandingSpot(bot, target) {
  const toTarget = vectorTo(bot.location, target.location);
  const planar = normalize2D(toTarget);
  const retreatDir = { x: -planar.x, y: 0, z: -planar.z };
  const origin = floorLocation(
    addVector(bot.location, {
      x: retreatDir.x * 14,
      y: 0,
      z: retreatDir.z * 14,
    }),
  );
  for (let radius = 0; radius <= 3; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        for (let y = 4; y >= -4; y -= 1) {
          const location = {
            x: origin.x + x + 0.5,
            y: origin.y + y,
            z: origin.z + z + 0.5,
          };
          if (isSafeStandingLocation(bot.dimension, location)) {
            return location;
          }
        }
      }
    }
  }
  return undefined;
}
function handleGoldenAppleBuff(bot, config) {
  const runtime = getRuntime(config.uid);
  if (globalTick - runtime.lastFoodTick < 60) return;
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const preferredFood =
    countItemInContainer(inventory, PATCH_ENCHANTED_GOLDEN_APPLE_ID) > 0
      ? PATCH_ENCHANTED_GOLDEN_APPLE_ID
      : countItemInContainer(inventory, PATCH_GOLDEN_APPLE_ID) > 0
        ? PATCH_GOLDEN_APPLE_ID
        : undefined;
  if (!preferredFood || !patchShouldConsumeGoldenApple(bot, preferredFood)) return;

  // ↓ リンゴを先に食べる（退避より優先）
  if (
    equipMainhandItem(bot, preferredFood, config) &&
    consumeManagedItem(bot, config, preferredFood, 1)
  ) {
    runtime.lastFoodTick = globalTick;
    patchApplyGoldenAppleEffects(bot, preferredFood);
    patchRunDimensionCommandNoThrow(
      bot.dimension,
      `playsound random.eat @a[x=${quoteCoord(bot.location.x)},y=${quoteCoord(bot.location.y)},z=${quoteCoord(bot.location.z)},r=16] ${quoteCoord(bot.location.x)} ${quoteCoord(bot.location.y)} ${quoteCoord(bot.location.z)} 1 1`
    );
    debugLog(bot, config, "inventory", `${preferredFood.replace("minecraft:", "")} を食べました`);
  }

  // ↓ 退避はリンゴを食べた後に判断（体力低下かつターゲット近い場合）
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  const isHealthLow = currentHealth / maxHealth <= 0.5;
  if (isHealthLow) {
    const target = findNearestTarget(bot);
    if (target && distance(bot.location, target.location) < 10) {
      const retreatCooldown = Math.max(40, config.pearlCooldown ?? 40);
      if (globalTick - runtime.lastPearlTick >= retreatCooldown) {
        if (countItemInContainer(inventory, ENDER_PEARL_ID) > 0) {
          const landingSpot = patchFindRetreatPearlLandingSpot(bot, target);
          if (landingSpot) {
            runtime.lastPearlTick = globalTick;
            const token = `${config.uid}:${globalTick}`;
            runtime.pendingPearlToken = token;
            if (
              equipMainhandItem(bot, ENDER_PEARL_ID, config) &&
              consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)
            ) {
              faceBotToward(bot, landingSpot);
              try { bot.dimension.spawnEntity(ENDER_PEARL_ID, addVector(bot.location, { x: 0, y: 1.45, z: 0 })); } catch {}
              debugLog(bot, config, "movement", "体力低下: パールで退避します", true);
              system.runTimeout(() => {
                if (runtime.pendingPearlToken !== token) return;
                try { bot.teleport(landingSpot, { dimension: bot.dimension, facingLocation: target.location }); } catch {}
              }, PEARL_VISUAL_DELAY);
            }
          }
        }
      }
    }
  }
}
handleMovement = function (bot, target, config) {
  const runtime = getRuntime(config.uid);
  const isStuck = patchUpdateStuckState(bot, runtime);
  const grounded = findNearestStandingLocation(bot.dimension, bot.location);
  if (
    globalTick > (runtime.jumpDashAirborneUntilTick ?? -9999) &&
    grounded &&
    distanceSquared(grounded, bot.location) > 0.0001
  ) {
    try {
      const snapped = patchSnapToBlockCenter(grounded);
      if (
        !isSafeStandingLocation(bot.dimension, snapped) ||
        !canOccupyLocation(bot.dimension, snapped)
      ) {
        throw new Error("unsafe grounded snap");
      }
      bot.teleport(snapped, {
        dimension: bot.dimension,
        facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
    } catch {}
  }
  const toTarget = vectorTo(bot.location, target.location);
  let planar = normalize2D(toTarget);
  const currentDistance = distance(bot.location, target.location);
  if (Math.abs(planar.x) < 0.0001 && Math.abs(planar.z) < 0.0001) {
    const fallback = normalize2D(
      target.getViewDirection?.() ?? { x: 1, y: 0, z: 0 },
    );
    planar =
      Math.abs(fallback.x) < 0.0001 && Math.abs(fallback.z) < 0.0001
        ? { x: 1, y: 0, z: 0 }
        : { x: -fallback.x, y: 0, z: -fallback.z };
  }
  try {
    bot.addEffect("speed", 6, { amplifier: 1, showParticles: false });
  } catch {}
  if (globalTick >= runtime.nextStrafeFlipTick) {
    runtime.strafeDirection *= -1;
    runtime.nextStrafeFlipTick = globalTick + STRAFE_FLIP_INTERVAL;
  }
  let targetMaintainDistance = config.maintainDistance;
  const currentHealth = patchGetCurrentHealthValue(bot);
  const maxHealth = patchGetMaxHealthValue(bot);
  if ((currentHealth / maxHealth) <= 0.5) {
    targetMaintainDistance = 12;
  }
const isFleeing = (currentHealth / maxHealth) <= 0.5;
  const distanceError = currentDistance - targetMaintainDistance;
  const groundedNow = patchIsEntityOnGroundSafe(bot);
  const isSignificantlyAbove = bot.location.y - target.location.y >= 2.0;
  const tooClose = distanceError < -0.1 && !isSignificantlyAbove;
  const airborneTooClose = tooClose && !groundedNow;
  const shouldStandbyForHeal = isFleeing && !tooClose;
  const targetEyeLocation = addVector(target.location, { x: 0, y: 1.1, z: 0 });
  const retreatDirection = { x: -planar.x, y: 0, z: -planar.z };
  const retreatWalk = tooClose && groundedNow;
  const inMeleeRange = currentDistance <= SWORD_RANGE;
  const targetBelow = target.location.y < bot.location.y - 1.5;
  const isStrafeNeeded =
    runtime.stuckTicks > 0 ||
    (inMeleeRange && !retreatWalk && globalTick % 40 < 20);
  const strafeScale = isStrafeNeeded && !targetBelow && !shouldStandbyForHeal ? 0.032 : 0;
  const strafe = {
    x: -planar.z * runtime.strafeDirection,
    y: 0,
    z: planar.x * runtime.strafeDirection,
  };
  const impulse = {
    x: strafe.x * strafeScale,
    y: 0,
    z: strafe.z * strafeScale,
  };
  const retreatLimit = groundedNow ? -0.038 : 0;
  const radialStrength = airborneTooClose || shouldStandbyForHeal
    ? 0
    : retreatWalk
      ? Math.max(-0.095, distanceError * 0.11)
      : Math.max(retreatLimit, Math.min(0.18, distanceError * 0.16));
  faceBotToward(bot, targetEyeLocation);
  setBotLookAt(bot, targetEyeLocation);
  impulse.x += planar.x * radialStrength;
  impulse.z += planar.z * radialStrength;
  const moveDirection = normalize2D(impulse);
  const jumpDashTriggered = patchShouldJumpDash(
    bot,
    target,
    config,
    moveDirection,
  );
  if (jumpDashTriggered) {
    impulse.y += PATCH_JUMP_DASH_VERTICAL_IMPULSE;
    impulse.x += moveDirection.x * PATCH_JUMP_DASH_FORWARD_BONUS;
    impulse.z += moveDirection.z * PATCH_JUMP_DASH_FORWARD_BONUS;
    runtime.lastJumpDashTick = globalTick;
    runtime.jumpDashAirborneUntilTick =
      globalTick + PATCH_JUMP_DASH_AIRBORNE_TICKS;
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.dash_leap");
  }
  try {
    bot.applyImpulse(impulse);
  } catch {}
  if (jumpDashTriggered) {
    const teleported = patchTryJumpDashTeleport(
      bot,
      target,
      config,
      moveDirection,
    );
    debugLog(
      bot,
      config,
      "movement",
      `距離=${currentDistance.toFixed(2)} strafe=${runtime.strafeDirection > 0 ? "R" : "L"} jumpdash=${teleported ? "tp" : "impulse"}`,
    );
    return;
  }
  const landingCandidate = !groundedNow
    ? findNearestStandingLocation(
        bot.dimension,
        bot.location,
        [0, -1, -2, -3, -4, -5],
      )
    : undefined;
  const candidate =
    landingCandidate ??
    patchFindDescendStep(
      bot.dimension,
      bot.location,
      target.location,
      planar,
    ) ??
    (retreatWalk
      ? patchFindMovementStep(
          bot.dimension,
          bot.location,
          retreatDirection,
          isStuck,
        )
      : undefined) ??
    (retreatWalk
      ? patchFindMovementStep(bot.dimension, bot.location, strafe, isStuck)
      : undefined) ??
    (retreatWalk
      ? patchFindMovementStep(
          bot.dimension,
          bot.location,
          { x: -strafe.x, y: 0, z: -strafe.z },
          isStuck,
        )
      : undefined) ??
    (!airborneTooClose && !retreatWalk
      ? patchFindMovementStep(
          bot.dimension,
          bot.location,
          moveDirection,
          isStuck,
        )
      : undefined) ??
    (isStuck && !airborneTooClose
      ? patchTryBuildStep(
          bot,
          config,
          retreatWalk ? retreatDirection : moveDirection,
        )
      : undefined);
  if (candidate) {
    try {
      bot.teleport(candidate, {
        dimension: bot.dimension,
        facingLocation: retreatWalk
          ? addVector(candidate, {
              x: retreatDirection.x * 2,
              y: 1.1,
              z: retreatDirection.z * 2,
            })
          : addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
      tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.walk");
    } catch {}
  }
  debugLog(
    bot,
    config,
    "movement",
    `距離=${currentDistance.toFixed(2)} strafe=${runtime.strafeDirection > 0 ? "R" : "L"} retreatWalk=${retreatWalk ? 1 : 0} stuck=${runtime.stuckTicks ?? 0} airborneClose=${airborneTooClose ? 1 : 0}`,
  );
};
handlePearlMove = function (bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (
    !config.pearlMove ||
    globalTick - runtime.lastPearlTick < config.pearlCooldown
  ) {
    return;
  }
  const currentDistance = distance(bot.location, target.location);
  const targetAbove = target.location.y - bot.location.y >= 2.5;
  if (currentDistance <= config.pearlDistance && !targetAbove) {
    return;
  }
  if (patchShouldDelayAction(config, "pearl")) {
    return;
  }
  if (patchRandomChance(config.mistakeRate)) {
    debugLog(bot, config, "movement", "パール移動を見送りました。");
    return;
  }
  const landingSpot = findPearlLandingSpot(bot, target);
  if (!landingSpot) {
    debugLog(bot, config, "movement", "安全なパール着地点が見つかりません。");
    return;
  }
  runtime.lastPearlTick = globalTick;
  const token = `${config.uid}:${globalTick}`;
  runtime.pendingPearlToken = token;
  if (
    !equipMainhandItem(bot, ENDER_PEARL_ID, config) ||
    !consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)
  ) {
    runtime.pendingPearlToken = "";
    return;
  }
  faceBotToward(bot, landingSpot);
  try {
    bot.dimension.spawnEntity(
      ENDER_PEARL_ID,
      addVector(bot.location, { x: 0, y: 1.45, z: 0 }),
    );
  } catch {}
  debugLog(
    bot,
    config,
    "movement",
    `パール移動を実行: (${landingSpot.x.toFixed(1)}, ${landingSpot.y.toFixed(1)}, ${landingSpot.z.toFixed(1)})`,
    true,
  );
  system.runTimeout(() => {
    if (runtime.pendingPearlToken !== token) {
      return;
    }
    try {
      bot.teleport(landingSpot, {
        dimension: bot.dimension,
        facingLocation: target.location,
      });
    } catch {}
    const held = getEquippableComponent(bot)?.getEquipment(
      EquipmentSlot.Mainhand,
    );
    if (held?.typeId === ENDER_PEARL_ID) {
      selectBestSword(bot);
    }
  }, PEARL_VISUAL_DELAY);
};
handleSwordCombo = function (bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return;
  }
  const currentDistance = distance(bot.location, target.location);
  if (
    !config.swordCombo ||
    currentDistance > SWORD_RANGE ||
    currentDistance > MAX_INTERACT_DISTANCE
  ) {
    return;
  }
  if (!patchHasCombatLineOfSight(bot, target)) {
    debugLog(bot, config, "combat", "壁越しの剣攻撃をスキップしました。");
    return;
  }
  if (globalTick - runtime.lastSwordTick < config.swordCooldown) {
    return;
  }
  runtime.lastSwordTick = globalTick;
  if (patchShouldDelayAction(config, "sword")) {
    return;
  }
  const swordStats = selectBestSword(bot);
  const direction = normalize2D(vectorTo(bot.location, target.location));
  const finalDamage = patchCalculateNetDamage(
    target,
    swordStats.damage,
    "entityAttack",
  );
  faceBotToward(
    bot,
    patchApplyAimJitter(
      addVector(target.location, { x: 0, y: 1.2, z: 0 }),
      config,
    ),
  );
  tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.swing");
  if (patchRandomChance(config.mistakeRate)) {
    debugLog(bot, config, "combat", "剣コンボを空振りしました。", true);
    return;
  }
  patchApplyDamageWithFallback(target, finalDamage, "entityAttack", bot);
  try {
    target.applyImpulse({
      x: direction.x * (0.18 + swordStats.knockbackLevel * 0.05),
      y: 0.04,
      z: direction.z * (0.18 + swordStats.knockbackLevel * 0.05),
    });
  } catch {}
  if (swordStats.fireAspectLevel > 0) {
    try {
      target.setOnFire(4 * swordStats.fireAspectLevel, true);
    } catch {}
  }
  debugLog(
    bot,
    config,
    "combat",
    `剣コンボ命中: raw=${swordStats.damage} final=${finalDamage}`,
    true,
  );
};
async function runDimensionCommand(dimension, command) {
  if (typeof dimension?.runCommandAsync === "function") {
    return dimension.runCommandAsync(command);
  }
  if (typeof dimension?.runCommand === "function") {
    return Promise.resolve(dimension.runCommand(command));
  }
  throw new Error(`Command execution unavailable: ${command}`);
}
async function patchEnsureMobGriefingEnabled(dimension) {
  if (patchMobGriefingEnabled) {
    return true;
  }
  try {
    await runDimensionCommand(dimension, "gamerule mobgriefing true");
    patchMobGriefingEnabled = true;
    return true;
  } catch {
    return false;
  }
}
function patchDelayTicks(ticks = 1) {
  return new Promise((resolve) => {
    system.runTimeout(resolve, Math.max(0, Math.floor(Number(ticks) || 0)));
  });
}
async function setBlockIdWithFallback(
  dimension,
  location,
  blockId,
  mode = "replace",
) {
  const block = getBlock(dimension, location);
  if (block?.typeId === "minecraft:bedrock") {
    return false;
  }
  if (block) {
    try {
      block.setPermutation(BlockPermutation.resolve(blockId));
      return true;
    } catch {}
  }
  const command = `setblock ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)} ${blockId} ${mode}`;
  try {
    await runDimensionCommand(dimension, command);
    return true;
  } catch {
    return false;
  }
}
async function setRespawnAnchorChargeWithFallback(dimension, location, charge) {
  const block = getBlock(dimension, location);
  if (block) {
    try {
      block.setPermutation(resolveRespawnAnchorPermutation(charge));
      return true;
    } catch {}
  }
  const clampedCharge = Math.max(
    0,
    Math.min(RESPAWN_ANCHOR_MAX_CHARGE, Math.floor(charge)),
  );
  const command = `setblock ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)} ${RESPAWN_ANCHOR_ID} ["${RESPAWN_ANCHOR_CHARGE_STATE}"=${clampedCharge}] replace`;
  try {
    await runDimensionCommand(dimension, command);
    return true;
  } catch {
    return false;
  }
}
function patchShouldPreserveExplosionBlock(block) {
  const typeId = block?.typeId ?? AIR_ID;
  if (PATCH_EXPLOSION_PRESERVE_IDS.has(typeId)) {
    return true;
  }
  return /command_block|structure_block|jigsaw|allow|deny/.test(typeId);
}
function patchCaptureExplosionSnapshot(
  dimension,
  center,
  radius,
  minY = Number.NEGATIVE_INFINITY,
) {
  const entries = [];
  const radiusSquared = radius * radius;
  const minX = Math.floor(center.x - radius);
  const maxX = Math.floor(center.x + radius);
  const minYBound = Math.floor(center.y - radius);
  const maxY = Math.floor(center.y + radius);
  const minZ = Math.floor(center.z - radius);
  const maxZ = Math.floor(center.z + radius);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minYBound; y <= maxY; y += 1) {
      if (y < minY) {
        continue;
      }
      for (let z = minZ; z <= maxZ; z += 1) {
        const dx = x + 0.5 - center.x;
        const dy = y + 0.5 - center.y;
        const dz = z + 0.5 - center.z;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) {
          continue;
        }
        const location = { x, y, z };
        const block = getBlock(dimension, location);
        if (!block || patchShouldPreserveExplosionBlock(block)) {
          continue;
        }
        entries.push({ location, typeId: block.typeId });
      }
    }
  }
  return entries;
}
function patchCountExplosionSnapshotChanges(dimension, snapshot, shouldIgnore) {
  let changed = 0;
  for (const entry of snapshot) {
    if (typeof shouldIgnore === "function" && shouldIgnore(entry)) {
      continue;
    }
    const block = getBlock(dimension, entry.location);
    if (!block || block.typeId !== entry.typeId) {
      changed += 1;
    }
  }
  return changed;
}
let patchExplosionDirectionCache;
function patchCollectExplosionAffectedBlocks(
  dimension,
  center,
  power,
  maxRadius = 8.5,
) {
  const affected = new Map();
  const maxRadiusSquared = maxRadius * maxRadius;
  for (const { dx, dy, dz } of EXPLOSION_RAY_DIRECTIONS) {
    let strength = power * (0.7 + Math.random() * 0.6);
    let currX = center.x;
    let currY = center.y;
    let currZ = center.z;
    while (strength > 0) {
      const loc = {
        x: Math.floor(currX),
        y: Math.floor(currY),
        z: Math.floor(currZ),
      };
      const distSq =
        (loc.x + 0.5 - center.x) ** 2 +
        (loc.y + 0.5 - center.y) ** 2 +
        (loc.z + 0.5 - center.z) ** 2;
      if (distSq > maxRadiusSquared) {
        break;
      }
      const block = getBlock(dimension, loc);
      if (block) {
        const isCenterAnchor =
          block.typeId === RESPAWN_ANCHOR_ID &&
          loc.x === Math.floor(center.x) &&
          loc.y === Math.floor(center.y) &&
          loc.z === Math.floor(center.z);
        if (patchShouldPreserveExplosionBlock(block) && !isCenterAnchor) {
          break;
        }
        if (!isAirBlock(block) && !block.isLiquid && !isCenterAnchor) {
          affected.set(`${loc.x}|${loc.y}|${loc.z}`, loc);
          const typeId = block.typeId;
          let resistance = 1.0;
          if (
            typeId.includes("stone") ||
            typeId.includes("deepslate") ||
            typeId.includes("cobble")
          ) {
            resistance = 6.0;
          } else if (
            typeId.includes("dirt") ||
            typeId.includes("grass") ||
            typeId.includes("sand")
          ) {
            resistance = 0.5;
          } else if (
            typeId.includes("wood") ||
            typeId.includes("log") ||
            typeId.includes("planks")
          ) {
            resistance = 2.0;
          }
          strength -= (resistance + 0.3) * 0.3;
        }
      }
      strength -= 0.225;
      currX += dx;
      currY += dy;
      currZ += dz;
    }
  }
  return [...affected.values()];
}
function patchCollectAnchorBreakBlocks(
  dimension,
  baseLocation,
  useCache = false,
) {
  const explosionCenter = getExplosionLocation(baseLocation, "anchor");
  if (useCache) {
    const cx = Math.floor(explosionCenter.x);
    const cy = Math.floor(explosionCenter.y);
    const cz = Math.floor(explosionCenter.z);
    const hash =
      Math.abs(cx * 31 + cy * 17 + cz) % ANCHOR_BREAK_OFFSETS_CACHE_POOL.length;
    const cacheToUse = ANCHOR_BREAK_OFFSETS_CACHE_POOL[hash];
    return cacheToUse
      .map((o) => ({ x: cx + o.x, y: cy + o.y, z: cz + o.z }))
      .filter((loc) => {
        const block = getBlock(dimension, loc);
        return block && !patchShouldPreserveExplosionBlock(block);
      });
  }
  const affected = new Map();
  for (const location of patchCollectExplosionAffectedBlocks(
    dimension,
    explosionCenter,
    ANCHOR_POWER,
    PATCH_ANCHOR_BLOCK_BREAK_RADIUS,
  )) {
    affected.set(`${location.x}|${location.y}|${location.z}`, location);
  }
  return [...affected.values()];
}
function patchCollectIgnitionCandidates(affectedBlocks) {
  const candidates = new Map();
  const offsets = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  for (const location of affectedBlocks) {
    for (const offset of offsets) {
      const candidate = addVector(location, offset);
      candidates.set(`${candidate.x}|${candidate.y}|${candidate.z}`, candidate);
    }
  }
  return [...candidates.values()];
}
async function patchIgniteExplosionBlocks(
  dimension,
  affectedBlocks,
  fireChance = PATCH_ANCHOR_FIRE_PLACE_CHANCE,
) {
  for (const location of patchCollectIgnitionCandidates(affectedBlocks)) {
    if (Math.random() > fireChance) {
      continue;
    }
    const block = getBlock(dimension, location);
    const below = getBlock(
      dimension,
      addVector(location, { x: 0, y: -1, z: 0 }),
    );
    if (
      !block ||
      !isAirBlock(block) ||
      !below ||
      !isSolidBlock(below) ||
      below.isLiquid
    ) {
      continue;
    }
    try {
      block.setPermutation(BlockPermutation.resolve(FIRE_ID));
      continue;
    } catch {}
    await setBlockIdWithFallback(dimension, location, FIRE_ID);
  }
}
async function patchBreakBlocksInAnchorPattern(
  dimension,
  centerBlockLocation,
  precomputedBlocks,
) {
  const affectedBlocks =
    precomputedBlocks ??
    patchCollectAnchorBreakBlocks(dimension, centerBlockLocation);
  let processed = 0;
  for (const location of affectedBlocks) {
    const block = getBlock(dimension, location);
    if (!block || patchShouldPreserveExplosionBlock(block)) {
      continue;
    }
    try {
      block.setPermutation(BlockPermutation.resolve(AIR_ID));
      continue;
    } catch {}
    await setBlockIdWithFallback(dimension, location, AIR_ID);
    processed += 1;
    if (processed % 12 === 0) {
      await patchDelayTicks(1);
    }
  }
  const explosionCenter = getExplosionLocation(centerBlockLocation, "anchor");
  let fireCount = 0;
  const MAX_FIRE_BLOCKS = 50;
  const fireRadius = 5.5;
  const fireRadiusSq = fireRadius * fireRadius;
  fireLoop: for (
    let x = -Math.ceil(fireRadius);
    x <= Math.ceil(fireRadius);
    x += 1
  ) {
    for (let y = -Math.ceil(fireRadius); y <= Math.ceil(fireRadius); y += 1) {
      for (let z = -Math.ceil(fireRadius); z <= Math.ceil(fireRadius); z += 1) {
        if (fireCount >= MAX_FIRE_BLOCKS) break fireLoop;
        if (x * x + y * y + z * z > fireRadiusSq) {
          continue;
        }
        if (Math.random() > PATCH_ANCHOR_FIRE_PLACE_CHANCE) {
          continue;
        }
        const loc = {
          x: Math.floor(explosionCenter.x) + x,
          y: Math.floor(explosionCenter.y) + y,
          z: Math.floor(explosionCenter.z) + z,
        };
        const block = getBlock(dimension, loc);
        const belowLoc = { x: loc.x, y: loc.y - 1, z: loc.z };
        const below = getBlock(dimension, belowLoc);
        if (
          block &&
          isAirBlock(block) &&
          below &&
          isSolidBlock(below) &&
          !below.isLiquid
        ) {
          try {
            block.setPermutation(BlockPermutation.resolve(FIRE_ID));
            fireCount++;
          } catch {
            await setBlockIdWithFallback(dimension, loc, FIRE_ID);
            fireCount++;
          }
        }
      }
    }
  }
}
function patchCollectCrystalBreakBlocks(dimension, baseLocation) {
  const explosionCenter = getExplosionLocation(baseLocation, "crystal");
  const affected = new Map();
  const minimumBreakY = Math.floor(baseLocation.y) + 1;
  for (const location of patchCollectExplosionAffectedBlocks(
    dimension,
    explosionCenter,
    CRYSTAL_POWER,
    PATCH_CRYSTAL_BLOCK_BREAK_RADIUS,
  )) {
    if (location.y < minimumBreakY) {
      continue;
    }
    affected.set(`${location.x}|${location.y}|${location.z}`, location);
  }
  return [...affected.values()];
}
async function patchBreakBlocksInCrystalPattern(dimension, baseLocation) {
  const affectedBlocks = patchCollectCrystalBreakBlocks(
    dimension,
    baseLocation,
  );
  let brokenBlocks = 0;
  let processed = 0;
  for (const location of affectedBlocks) {
    const block = getBlock(dimension, location);
    if (!block || patchShouldPreserveExplosionBlock(block)) {
      continue;
    }
    try {
      block.setPermutation(BlockPermutation.resolve(AIR_ID));
      brokenBlocks += 1;
      block.setPermutation(BlockPermutation.resolve(AIR_ID));
      continue;
    } catch {}
    if (await setBlockIdWithFallback(dimension, location, AIR_ID)) {
      brokenBlocks += 1;
    }
    processed += 1;
    if (processed % 12 === 0) {
      await patchDelayTicks(1);
    }
  }
  return brokenBlocks;
}
function patchCreateExplosionWithFallback(
  dimension,
  location,
  power,
  options = {},
) {
  const attempts = [
    options,
    { ...options, causesFire: false },
    (() => {
      const copy = { ...options };
      delete copy.source;
      return copy;
    })(),
    (() => {
      const copy = { ...options, causesFire: false };
      delete copy.source;
      return copy;
    })(),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      dimension.createExplosion(location, power, attempt);
      return { success: true, options: attempt };
    } catch (error) {
      lastError = error;
    }
  }
  return { success: false, error: lastError };
}
async function runAnchorExplosionWithFallback(
  dimension,
  baseLocation,
  source,
  options = {},
) {
  const anchorLocation = getExplosionLocation(baseLocation, "anchor");
  const damageSnapshots = patchCaptureExplosionDamageSnapshots(
    dimension,
    anchorLocation,
    "anchor",
  );
  let explosionResult = { success: true };
  let changedBlocks = 0;
  let usedFallback = false;
  if (PATCH_ANCHOR_FORCE_FALLBACK) {
    usedFallback = true;
    const useCache = !!options?.useBreakCache;
    const affectedBlocks = patchCollectAnchorBreakBlocks(
      dimension,
      baseLocation,
      useCache,
    );
    await patchBreakBlocksInAnchorPattern(
      dimension,
      baseLocation,
      affectedBlocks,
    );
  } else {
    const nativeBreakSnapshot = patchCaptureExplosionSnapshot(
      dimension,
      anchorLocation,
      PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS,
    );
    const expectedAffectedBlocks = patchCollectAnchorBreakBlocks(
      dimension,
      baseLocation,
    );
    const ignoreCenterAnchorChange = !!options?.ignoreCenterAnchorChange;
    const requireFullNativeBreakPattern =
      !!options?.requireFullNativeBreakPattern;
    const minimumNativeChangedBlocks = Math.max(
      0,
      Math.floor(
        Number(
          options?.minNativeChangedBlocks ??
            PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS,
        ),
      ),
    );
    const centerBlock = getBlock(dimension, baseLocation);
    if (centerBlock && centerBlock.typeId === RESPAWN_ANCHOR_ID) {
      try {
        centerBlock.setPermutation(BlockPermutation.resolve(AIR_ID));
      } catch {}
    }
    explosionResult = patchCreateExplosionWithFallback(
      dimension,
      anchorLocation,
      ANCHOR_POWER,
      {
        breaksBlocks: true,
        causesFire: false,
        source,
      },
    );
    changedBlocks = patchCountExplosionSnapshotChanges(
      dimension,
      nativeBreakSnapshot,
      ignoreCenterAnchorChange
        ? (entry) => {
            return (
              entry.typeId === RESPAWN_ANCHOR_ID &&
              entry.location.x === baseLocation.x &&
              entry.location.y === baseLocation.y &&
              entry.location.z === baseLocation.z
            );
          }
        : undefined,
    );
    const requiredNativeBreakBlocks = requireFullNativeBreakPattern
      ? expectedAffectedBlocks.length
      : Math.min(minimumNativeChangedBlocks, expectedAffectedBlocks.length);
    if (changedBlocks < requiredNativeBreakBlocks) {
      usedFallback = true;
      await patchBreakBlocksInAnchorPattern(
        dimension,
        baseLocation,
        expectedAffectedBlocks,
      );
    } else {
      await patchIgniteExplosionBlocks(dimension, expectedAffectedBlocks);
    }
  }
  if (options?.debugMessage && typeof options.debugMessage === "function") {
    options.debugMessage(changedBlocks, usedFallback, explosionResult);
  }
  patchScheduleExplosionDamageTopUp(damageSnapshots, "anchor", source);
  return { changedBlocks, usedFallback, explosionResult };
}
async function patchRunAnchorPlaceAndDetonateSequence(
  dimension,
  baseLocation,
  source,
  options = {},
) {
  const placementMode = `${options?.placementMode ?? "place-anchor"}`;
  const needsCharge =
    options?.needsCharge === undefined
      ? placementMode === "place-anchor" ||
        Number(options?.existingCharge ?? 0) <= 0
      : !!options.needsCharge;
  const detonateDelay = Math.max(
    0,
    Math.floor(Number(options?.detonateDelay ?? 0)),
  );
  const cleanupIfCancelled = !!options?.cleanupIfCancelled;
  const temporaryAnchorPlaced = placementMode === "place-anchor";
  if (temporaryAnchorPlaced) {
    if ((await options?.beforePlace?.()) === false) {
      return { cancelled: true, reason: "before-place" };
    }
    if (
      !(await setRespawnAnchorChargeWithFallback(dimension, baseLocation, 0))
    ) {
      return { cancelled: true, reason: "place-failed" };
    }
    await options?.onPlaced?.();
  } else if (!isRespawnAnchorBlock(getBlock(dimension, baseLocation))) {
    return { cancelled: true, reason: "missing-anchor" };
  }
  if (detonateDelay > 0) {
    await patchDelayTicks(detonateDelay);
  }
  if ((await options?.beforeExplode?.("pre-charge")) === false) {
    if (temporaryAnchorPlaced && cleanupIfCancelled) {
      await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
    }
    return { cancelled: true, reason: "before-explode" };
  }
  if (needsCharge) {
    if ((await options?.beforeCharge?.()) === false) {
      if (temporaryAnchorPlaced && cleanupIfCancelled) {
        await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      }
      return { cancelled: true, reason: "before-charge" };
    }
    if (
      !(await setRespawnAnchorChargeWithFallback(dimension, baseLocation, 1))
    ) {
      if (temporaryAnchorPlaced && cleanupIfCancelled) {
        await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      }
      return { cancelled: true, reason: "charge-failed" };
    }
    await options?.onCharged?.();
    await patchDelayTicks(1);
    if ((await options?.beforeExplode?.("final")) === false) {
      if (temporaryAnchorPlaced && cleanupIfCancelled) {
        await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
      }
      return { cancelled: true, reason: "before-final-explode" };
    }
  }
  const result = await runAnchorExplosionWithFallback(
    dimension,
    baseLocation,
    source,
    {
      ...(options?.explosionOptions ?? {}),
      debugMessage: options?.debugMessage,
    },
  );
  const centerBlock = getBlock(dimension, baseLocation);
  if (isRespawnAnchorBlock(centerBlock)) {
    await setBlockIdWithFallback(dimension, baseLocation, AIR_ID);
  }
  return {
    ...result,
    cancelled: false,
    needsCharge,
    temporaryAnchorPlaced,
  };
}
async function runCrystalExplosionWithFallback(
  dimension,
  baseLocation,
  source,
  crystalEntity,
) {
  const crystalLocation = getExplosionLocation(baseLocation, "crystal");
  const damageSnapshots = patchCaptureExplosionDamageSnapshots(
    dimension,
    crystalLocation,
    "crystal",
  );
  const nativeBreakSnapshot = patchCaptureExplosionSnapshot(
    dimension,
    crystalLocation,
    PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS,
  );
  await patchEnsureMobGriefingEnabled(dimension);
  const explosionResult = await patchDetonateCrystalExplosion(
    dimension,
    crystalLocation,
    source,
    crystalEntity,
  );
  patchScheduleExplosionDamageTopUp(damageSnapshots, "crystal", source);
  await patchDelayTicks(1);
  const changedBlocks = patchCountExplosionSnapshotChanges(
    dimension,
    nativeBreakSnapshot,
  );
  let usedFallback = false;
  let brokenBlocks = 0;
  if (
    PATCH_CRYSTAL_FORCE_FALLBACK_BREAK ||
    !explosionResult.success ||
    changedBlocks < PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS
  ) {
    usedFallback = true;
    brokenBlocks = await patchBreakBlocksInCrystalPattern(
      dimension,
      baseLocation,
    );
  }
  return {
    brokenBlocks,
    changedBlocks,
    crystalLocation,
    explosionResult,
    usedFallback,
  };
}
async function patchDetonateCrystalExplosion(
  dimension,
  location,
  source,
  crystalEntity,
) {
  if (crystalEntity && typeof crystalEntity.triggerEvent === "function") {
    try {
      crystalEntity.triggerEvent("minecraft:crystal_explode");
      return { success: true, mode: "api-event" };
    } catch {}
  }
  const selectorCenter = `${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)}`;
  const commandAttempts = [
    `execute positioned ${selectorCenter} run event entity @e[r=2,c=1] minecraft:crystal_explode`,
    `event entity @e[x=${quoteCoord(location.x)},y=${quoteCoord(location.y)},z=${quoteCoord(location.z)},r=2,c=1] minecraft:crystal_explode`,
  ];
  for (const command of commandAttempts) {
    try {
      const result = await runDimensionCommand(dimension, command);
      if (Number(result?.successCount ?? 1) > 0) {
        return { success: true, mode: "command-event" };
      }
    } catch {}
  }
  const sourceCommand =
    "execute @s ~ ~ ~ execute @s ^ ^ ^2 event entity @e[r=2,c=1] minecraft:crystal_explode";
  if (typeof source?.runCommandAsync === "function") {
    try {
      const result = await source.runCommandAsync(sourceCommand);
      if (Number(result?.successCount ?? 1) > 0) {
        return { success: true, mode: "source-command-event" };
      }
    } catch {}
  } else if (typeof source?.runCommand === "function") {
    try {
      const result = source.runCommand(sourceCommand);
      if (Number(result?.successCount ?? 1) > 0) {
        return { success: true, mode: "source-command-event" };
      }
    } catch {}
  }
  const explosionResult = patchCreateExplosionWithFallback(
    dimension,
    location,
    CRYSTAL_POWER,
    {
      breaksBlocks: true,
      causesFire: false,
      source,
    },
  );
  return {
    success: explosionResult.success,
    mode: "api",
    error: explosionResult.error,
  };
}
handleAnchorCombo = function (bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return false;
  }
  if (!shouldUseAnchorCombo(bot, target, config)) {
    return false;
  }
  if (
    globalTick - runtime.lastAnchorTick < config.anchorCooldown ||
    runtime.pendingAnchor
  ) {
    return false;
  }
  const best =
    selectedCandidate ?? scanAnchorCandidates(bot, target, config)[0];
  if (!best) {
    return false;
  }
  runtime.lastAnchorTick = globalTick;
  runtime.pendingAnchor = {
    base: best.location,
    placementMode: best.placementMode,
    existingCharge: Math.max(0, Number(best.existingCharge ?? 0)),
    needsCharge:
      best.placementMode === "place-anchor" ||
      Number(best.existingCharge ?? 0) <= 0,
    targetId: target.id,
    targetDamage: best.targetDamage,
    selfDamage: best.selfDamage,
  };
  faceBotToward(bot, {
    x: best.location.x + 0.5,
    y: best.location.y + 0.5,
    z: best.location.z + 0.5,
  });
  const detonateDelay = Math.max(
    1,
    Math.floor(Number(config.anchorDetonateDelay ?? 3)),
  );
  void (async () => {
    const pending = runtime.pendingAnchor;
    if (!pending) {
      return;
    }
    let resolvedTarget = target;
    const result = await patchRunAnchorPlaceAndDetonateSequence(
      bot.dimension,
      pending.base,
      bot,
      {
        placementMode: pending.placementMode,
        existingCharge: pending.existingCharge,
        needsCharge: pending.needsCharge,
        detonateDelay,
        explosionOptions: {
          ignoreCenterAnchorChange: true,
          requireFullNativeBreakPattern: true,
          useBreakCache: config.anchorBreakCache ?? true,
        },
        cleanupIfCancelled: true,
        beforePlace: async () => {
          resolvedTarget = patchResolvePendingCombatTarget(
            bot,
            pending,
            runtime,
          );
          if (runtime.pendingAnchor !== pending || !resolvedTarget) {
            return false;
          }
          if (
            !equipMainhandItem(bot, RESPAWN_ANCHOR_ID, config) ||
            !consumeManagedItem(bot, config, RESPAWN_ANCHOR_ID, 1)
          ) {
            debugLog(
              bot,
              config,
              "combat",
              "§4アンカー設置中断: アンカーの装備/消費に失敗",
              true,
            );
            return false;
          }
          return true;
        },
        onPlaced: async () => {},
        beforeCharge: async () => {
          resolvedTarget = patchResolvePendingCombatTarget(
            bot,
            pending,
            runtime,
          );
          if (runtime.pendingAnchor !== pending || !resolvedTarget) {
            return false;
          }
          if (
            !equipMainhandItem(bot, GLOWSTONE_ID, config) ||
            !consumeManagedItem(bot, config, GLOWSTONE_ID, 1)
          ) {
            debugLog(
              bot,
              config,
              "combat",
              "§4アンカーチャージ中断: グロウストーンの装備/消費に失敗",
              true,
            );
            return false;
          }
          return true;
        },
        onCharged: async () => {},
        beforeExplode: async () => {
          resolvedTarget = patchResolvePendingCombatTarget(
            bot,
            pending,
            runtime,
          );
          if (runtime.pendingAnchor !== pending || !resolvedTarget) {
            return false;
          }
          faceBotToward(bot, {
            x: pending.base.x + 0.5,
            y: pending.base.y + 0.5,
            z: pending.base.z + 0.5,
          });
          return true;
        },
      },
    );
    if (runtime.pendingAnchor === pending) {
      runtime.pendingAnchor = undefined;
    }
    if (result?.cancelled) {
      return;
    }
    selectBestSword(bot);
    if (patchIsCombatTargetUsable(resolvedTarget, bot.dimension)) {
      setBotLookAt(
        bot,
        addVector(resolvedTarget.location, { x: 0, y: 1.1, z: 0 }),
      );
    }
  })();
  return true;
};
handleCrystalCombo = function (bot, target, config, selectedCandidate) {
  const runtime = getRuntime(config.uid);
  if (isSpawnProtected(config.uid)) {
    return false;
  }
  if (!config.crystalCombo) {
    return false;
  }
  if (
    globalTick - runtime.lastCrystalTick < config.crystalCooldown ||
    runtime.pendingCrystal
  ) {
    return false;
  }
  const best =
    selectedCandidate ?? scanCrystalCandidates(bot, target, config)[0];
  if (!best) {
    return false;
  }
  runtime.lastCrystalTick = globalTick;
  runtime.pendingCrystal = {
    base: best.location,
    restoreBlockId: AIR_ID,
    placementMode: best.placementMode,
    targetId: target.id,
  };
  faceBotToward(bot, {
    x: best.location.x + 0.5,
    y: best.location.y + 0.5,
    z: best.location.z + 0.5,
  });
  const baseBlock = getBlock(bot.dimension, best.location);
  if (
    best.placementMode === "existing-base" &&
    !isCrystalBaseBlock(baseBlock)
  ) {
    runtime.pendingCrystal = undefined;
    return false;
  }
  if (best.placementMode === "place-obsidian") {
    if (
      !equipMainhandItem(bot, OBSIDIAN_ID, config) ||
      !consumeManagedItem(bot, config, OBSIDIAN_ID, 1)
    ) {
      debugLog(
        bot,
        config,
        "combat",
        "§4クリスタル設置中断: 黒曜石の装備/消費に失敗",
        true,
      );
      runtime.pendingCrystal = undefined;
      return false;
    }
  }
  void (async () => {
    if (best.placementMode === "place-obsidian") {
      if (
        !(await setBlockIdWithFallback(
          bot.dimension,
          best.location,
          OBSIDIAN_ID,
        ))
      ) {
        runtime.pendingCrystal = undefined;
        return;
      }
      debugLog(
        bot,
        config,
        "combat",
        `黒曜石設置: (${best.location.x}, ${best.location.y}, ${best.location.z})`,
        true,
      );
    } else {
      debugLog(
        bot,
        config,
        "combat",
        `既存土台を使用: (${best.location.x}, ${best.location.y}, ${best.location.z})`,
        true,
      );
    }
    system.runTimeout(() => {
      const pending = runtime.pendingCrystal;
      runtime.pendingCrystal = undefined;
      if (!pending) {
        return;
      }
      void (async () => {
        const liveTarget = patchResolvePendingCombatTarget(
          bot,
          pending,
          runtime,
        );
        if (!liveTarget) {
          return;
        }
        const crystalLocation = getExplosionLocation(pending.base, "crystal");
        const existingCrystalIds = new Set();
        for (const entity of patchGetNearbyCrystalEntities(
          bot.dimension,
          crystalLocation,
        )) {
          existingCrystalIds.add(entity.id);
        }
        if (
          !equipMainhandItem(bot, END_CRYSTAL_ID, config) ||
          !consumeManagedItem(bot, config, END_CRYSTAL_ID, 1)
        ) {
          debugLog(
            bot,
            config,
            "combat",
            "§4クリスタル設置中断: クリスタルの装備/消費に失敗",
            true,
          );
          return;
        }
        let summonResult;
        try {
          summonResult = await spawnEntityWithFallback(
            bot.dimension,
            END_CRYSTAL_ENTITY_ID,
            crystalLocation,
          );
        } catch (error) {
          return;
        }
        let crystal;
        try {
          const candidates = patchGetNearbyCrystalEntities(
            bot.dimension,
            crystalLocation,
          );
          crystal =
            candidates.find((entity) => !existingCrystalIds.has(entity.id)) ??
            candidates.sort(
              (a, b) =>
                distanceSquared(a.location, crystalLocation) -
                distanceSquared(b.location, crystalLocation),
            )[0];
        } catch {}
        if (!crystal && Number(summonResult?.successCount ?? 0) <= 0) {
          return;
        }
        const detonateDelay = Math.max(
          1,
          Math.floor(Number(config.crystalDetonateDelay ?? 0)),
        );
        system.runTimeout(() => {
          void (async () => {
            let resolvedCrystal = crystal;
            if (!resolvedCrystal) {
              try {
                resolvedCrystal = patchGetNearbyCrystalEntities(
                  bot.dimension,
                  crystalLocation,
                ).sort(
                  (a, b) =>
                    distanceSquared(a.location, crystalLocation) -
                    distanceSquared(b.location, crystalLocation),
                )[0];
              } catch {}
            }
            const liveTarget = patchResolvePendingCombatTarget(
              bot,
              pending,
              runtime,
            );
            if (!liveTarget) {
              try {
                resolvedCrystal?.remove();
              } catch {}
              selectBestSword(bot);
              return;
            }
            const result = await runCrystalExplosionWithFallback(
              bot.dimension,
              pending.base,
              bot,
              resolvedCrystal,
            );
            try {
              resolvedCrystal?.remove();
            } catch {}
            selectBestSword(bot);
            setBotLookAt(
              bot,
              addVector(liveTarget.location, { x: 0, y: 1.1, z: 0 }),
            );
          })();
        }, detonateDelay);
      })();
    }, 1);
  })();
  return true;
};
tickBots = function () {
  globalTick += 1;
  for (const [id, bot] of trackedBots.entries()) {
    if (isEntityUsable(bot, BOT_TYPE)) {
      updateTrackedBotMeta(bot);
      continue;
    }
    const meta = trackedBotMetaById.get(id);
    if (!meta?.invalidLoggedTick) {
      appendPersistentDebugLog("probe", `tracked invalid`);
      trackedBotMetaById.set(id, { ...meta, invalidLoggedTick: globalTick });
    }
    trackedBots.delete(id);
  }
  for (const bot of getAllBots()) {
    try {
      const config = ensureBotInitialized(bot);
      if (!config?.enabled) continue;
      if (!patchMobGriefingEnabled) {
        patchEnsureMobGriefingEnabled(bot.dimension);
      }
      if (enforceBotBoundary(bot, config)) {
        continue;
      }
      updateTrackedBotMeta(bot, { uid: config.uid });
      const runtime = getRuntime(config.uid);
      if (runtime.isConfiguring) {
        continue;
      }
      runtime.lastSeenTick = globalTick;
      runtime.lastKnownHealth = patchGetCurrentHealthValue(bot);
      handleTotemSafety(bot, config);
      syncBotLoadout(bot, config);
      ensureBotEquipmentIntegrity(bot, config);
      applyArmorDerivedEffects(bot);
      handleGoldenAppleBuff(bot, config);
      const target = findNearestTarget(bot);
      if (!target) {
        if (runtime.lastTargetId) {
          runtime.lastTargetId = "";
          logBotEvent(bot, "target lost");
        } else if ((runtime.lastNoTargetLogTick ?? -9999) + 40 <= globalTick) {
          runtime.lastNoTargetLogTick = globalTick;
        }
        continue;
      }
      if (runtime.lastTargetId !== target.id) {
        runtime.lastTargetId = target.id;
        logBotEvent(bot, `target acquired: ${target.name}`);
      }
      handlePearlMove(bot, target, config);
      const currentDistance = distance(bot.location, target.location);
      const isBotStuck = (runtime.stuckTicks ?? 0) >= 4;
      const isTooClose = currentDistance < config.maintainDistance - 0.1;
      if (isBotStuck && isTooClose) {
        faceBotToward(bot, addVector(target.location, { x: 0, y: 1.1, z: 0 }));
        setBotLookAt(bot, addVector(target.location, { x: 0, y: 1.1, z: 0 }));
        const stuckExplosive = chooseBestExplosiveAction(bot, target, config);
        if (stuckExplosive?.type === "anchor") {
          if (
            handleAnchorCombo(bot, target, config, stuckExplosive.candidate)
          ) {
            debugLog(
              bot,
              config,
              "combat",
              `§e狭所戦闘: アンカー発動 (stuck=${runtime.stuckTicks} dist=${currentDistance.toFixed(2)})`,
              true,
            );
            continue;
          }
        } else if (stuckExplosive?.type === "crystal") {
          if (
            handleCrystalCombo(bot, target, config, stuckExplosive.candidate)
          ) {
            debugLog(
              bot,
              config,
              "combat",
              `§e狭所戦闘: クリスタル発動 (stuck=${runtime.stuckTicks} dist=${currentDistance.toFixed(2)})`,
              true,
            );
            continue;
          }
        }
        if (
          !stuckExplosive &&
          config.anchorCombo &&
          patchGetCurrentHealthValue(bot) > 8
        ) {
          const widenSpot = patchFindMovementStep(bot.dimension, bot.location, {
            x: 1,
            y: 0,
            z: 0,
          });
          if (widenSpot) {
            const candidateLocation = addVector(bot.location, {
              x: 0,
              y: -1,
              z: 0,
            });
            if (
              handleAnchorCombo(bot, target, config, {
                location: candidateLocation,
                placementMode: "place-anchor",
              })
            ) {
              debugLog(
                bot,
                config,
                "combat",
                `§e狭所戦闘: 空間こじ開けアンカー発動 (stuck=${runtime.stuckTicks})`,
                true,
              );
              continue;
            }
          }
        }
        handleSwordCombo(bot, target, config);
        debugLog(
          bot,
          config,
          "movement",
          `§e狭所戦闘: 剣攻撃にフォールバック (stuck=${runtime.stuckTicks} dist=${currentDistance.toFixed(2)})`,
          true,
        );
        continue;
      }
      handleMovement(bot, target, config);
      const explosiveAction = chooseBestExplosiveAction(bot, target, config);
      if (explosiveAction?.type === "anchor") {
        if (handleAnchorCombo(bot, target, config, explosiveAction.candidate))
          continue;
      } else if (explosiveAction?.type === "crystal") {
        if (handleCrystalCombo(bot, target, config, explosiveAction.candidate))
          continue;
      }
      handleSwordCombo(bot, target, config);
    } catch (error) {
      console.warn(`[PvPBot] tick failed: ${formatError(error)}`);
    }
  }
  for (let index = pendingSpawnRequests.length - 1; index >= 0; index -= 1) {
    if (globalTick - pendingSpawnRequests[index].createdTick > 40) {
      pendingSpawnRequests.splice(index, 1);
    }
  }
};
function formatSupplyChest(config) {
  if (!hasSupplyChest(config)) {
    return "未設定";
  }
  return `${fromDimensionKey(config.supplyChestDimensionKey)} (${Math.floor(config.supplyChestX)}, ${Math.floor(
    config.supplyChestY,
  )}, ${Math.floor(config.supplyChestZ)})`;
}
async function openDifficultyPresetMenu(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return;
  }
  const response = await new ActionFormData()
    .title(`${getBotLabel(bot)} - Difficulty`)
    .body(
      `現在: ${patchGetDifficultyLabel(config)}\n各プリセットは CD と距離設定をまとめて調整します。`,
    )
    .button("Easy")
    .button("Normal")
    .button("Hard")
    .button("戻る")
    .show(player);
  if (response.canceled || response.selection === 3) {
    return;
  }
  const presetId =
    response.selection === 0
      ? "easy"
      : response.selection === 1
        ? "normal"
        : "hard";
  const updated = persistBotConfig(
    bot,
    patchApplyDifficultyPreset({ ...config, ownerName: player.name }, presetId),
  );
  bot.nameTag = updated.displayName || "Crystal Bot";
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(
    `§a${getBotLabel(bot)} に ${patchGetDifficultyLabel(updated)} プリセットを適用しました。`,
  );
}
function findContainerBlockInView(
  player,
  maxDistance = PATCH_SUPPLY_CHEST_VIEW_DISTANCE,
) {
  try {
    const hit = player.getBlockFromViewDirection?.({ maxDistance });
    const block = hit?.block;
    return getBlockInventoryContainer(block) ? block : undefined;
  } catch {
    return undefined;
  }
}
function getNearestConfigurableBot(player) {
  return getNearbyBots(player, Number.POSITIVE_INFINITY)[0];
}
function setSupplyChestFromBlock(player, bot, block) {
  const config = ensureBotInitialized(bot, player);
  if (!config || !block) {
    return false;
  }
  const location = floorLocation(block.location);
  const updated = persistBotConfig(bot, {
    ...config,
    ownerName: player.name,
    supplyChestDimensionKey: toDimensionKey(block.dimension.id),
    supplyChestX: location.x,
    supplyChestY: location.y,
    supplyChestZ: location.z,
  });
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(
    `§a${getBotLabel(bot)} の供給チェストを ${formatSupplyChest(updated)} に設定しました。`,
  );
  return true;
}
function setSupplyChestFromView(player, bot) {
  const block = findContainerBlockInView(player);
  if (!block) {
    player.sendMessage(
      "§c視線先にコンテナブロックがありません。チェストを見ながら実行してください。",
    );
    return false;
  }
  return setSupplyChestFromBlock(player, bot, block);
}
function clearSupplyChest(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return false;
  }
  const updated = persistBotConfig(bot, {
    ...config,
    ownerName: player.name,
    supplyChestDimensionKey: "",
    supplyChestX: 0,
    supplyChestY: 0,
    supplyChestZ: 0,
  });
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(
    `§a${getBotLabel(bot)} の供給チェスト設定を解除しました。`,
  );
  return true;
}
function setSupplyChestForNearestBot(player) {
  const bot = getNearestConfigurableBot(player);
  if (!bot) {
    player.sendMessage("§c設定できる PvP Bot がいません。");
    return;
  }
  setSupplyChestFromView(player, bot);
}
function clearSupplyChestForNearestBot(player) {
  const bot = getNearestConfigurableBot(player);
  if (!bot) {
    player.sendMessage("§c設定できる PvP Bot がいません。");
    return;
  }
  clearSupplyChest(player, bot);
}
function getSafeLocationNearBot(bot) {
  const base = floorLocation(bot.location);
  const offsets = [
    { x: 2, z: 0 },
    { x: -2, z: 0 },
    { x: 0, z: 2 },
    { x: 0, z: -2 },
    { x: 2, z: 2 },
    { x: -2, z: 2 },
    { x: 2, z: -2 },
    { x: -2, z: -2 },
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: 3, z: 0 },
    { x: -3, z: 0 },
    { x: 0, z: 3 },
    { x: 0, z: -3 },
  ];
  for (const offset of offsets) {
    for (const yOffset of [1, 0, 2, -1, -2]) {
      const location = {
        x: base.x + offset.x + 0.5,
        y: base.y + yOffset,
        z: base.z + offset.z + 0.5,
      };
      if (!isSafeStandingLocation(bot.dimension, location)) {
        continue;
      }
      if (isLocationOccupiedByPlayer(bot.dimension, location)) {
        continue;
      }
      return location;
    }
  }
  return undefined;
}
function teleportPlayerToBot(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) {
    player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。");
    return false;
  }
  const destination =
    getSafeLocationNearBot(bot) ??
    addVector(bot.location, { x: 1, y: 0, z: 0 });
  try {
    player.teleport(destination, {
      dimension: bot.dimension,
      facingLocation: bot.location,
    });
    player.sendMessage(`§a${getBotLabel(bot)} の近くにテレポートしました。`);
    return true;
  } catch (error) {
    player.sendMessage(
      `§c[PvPBot] プレイヤーの TP に失敗しました: ${formatError(error)}`,
    );
    return false;
  }
}
function teleportBotToPlayer(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) {
    player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。");
    return false;
  }
  const destination =
    getSpawnLocationNear(player) ??
    addVector(player.location, { x: 1, y: 0, z: 0 });
  try {
    bot.teleport(destination, {
      dimension: player.dimension,
      facingLocation: player.location,
    });
    player.sendMessage(
      `§a${getBotLabel(bot)} を自分の近くへテレポートしました。`,
    );
    logBotEvent(bot, `teleported to ${player.name}`);
    return true;
  } catch (error) {
    player.sendMessage(
      `§c[PvPBot] Bot の TP に失敗しました: ${formatError(error)}`,
    );
    return false;
  }
}
function removeSpecificBot(player, bot) {
  if (!isEntityUsable(bot, BOT_TYPE)) {
    player.sendMessage("§c[PvPBot] 対象の Bot はもう存在しません。");
    return false;
  }
  const label = getBotLabel(bot);
  const uid = getBotUid(bot);
  const config = ensureBotInitialized(bot);
  if (!config) {
    player.sendMessage("§c[PvPBot] Bot の設定を取得できませんでした。");
    return false;
  }
  if (config.ownerName && config.ownerName !== player.name) {
    player.sendMessage(
      `§c${getBotLabel(bot)} は ${config.ownerName} の所有なので削除できません。`,
    );
    return false;
  }
  delete botConfigs[uid];
  runtimeState.delete(uid);
  trackedBotIdByUid.delete(uid);
  try {
    trackedBotMetaById.delete(bot.id);
  } catch {}
  try {
    bot.remove();
  } catch (error) {
    player.sendMessage(
      `§c[PvPBot] Bot の削除に失敗しました: ${formatError(error)}`,
    );
    return false;
  }
  saveConfigs();
  player.sendMessage(`§a${label} を削除しました。`);
  return true;
}
showHelpForm = async function (player) {
  await new ActionFormData()
    .title("Crystal PvP Bot")
    .body(
      "1. /bot で Bot メニューを開きます。\n2. /pvpbot:spawn または /summon pvpbot:crystal_bot で Bot を出せます。\n3. チェストを見ながら供給チェストを設定できます。\n4. 安全範囲はデフォルトONです。\n5. 1人ワールドでは Bot が自動であなたをターゲットします。",
    )
    .button("閉じる")
    .show(player);
};
async function openBotSettingsModal(player, bot) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return;
  }
  const form = new ModalFormData()
    .title("PvP Bot 戦闘設定")
    .toggle("[基本] BotのAIを動かす", { defaultValue: config.enabled })
    .slider("[基本] 敵との維持距離 (1=密着, 6=遠距離)", 1, 6, {
      valueStep: 1,
      defaultValue: config.maintainDistance,
    })
    .slider("[基本] 敵を認識する範囲", 4, 32, {
      valueStep: 1,
      defaultValue: config.targetRange ?? MAX_TARGET_DISTANCE,
    })
    .toggle("[基本] ジャンプダッシュで接近する", {
      defaultValue: config.jumpDash,
    })
    .toggle("[アイテム] 自動トーテム補充", { defaultValue: config.autoTotem })
    .slider("[アイテム] トーテム即補充 (0=最速, 60=3秒遅れ)", 0, 60, {
      valueStep: 1,
      defaultValue: config.totemRefillDelay,
    })
    .toggle("[アイテム] パール移動を使う", { defaultValue: config.pearlMove })
    .slider("[アイテム] パールを使用する遠さ", 8, 16, {
      valueStep: 2,
      defaultValue: config.pearlDistance,
    })
    .slider("[アイテム] 次のパールまでの待ち (0=最速, 80=4秒)", 0, 80, {
      valueStep: 5,
      defaultValue: config.pearlCooldown,
    })
    .toggle("[戦闘] 剣攻撃を使う", { defaultValue: config.swordCombo })
    .slider("[戦闘] 剣を振る間隔 (0=最速連打, 20=1秒)", 0, 25, {
      valueStep: 1,
      defaultValue: config.swordCooldown,
    })
    .toggle("[戦闘] クリスタルを使う", { defaultValue: config.crystalCombo })
    .slider("[戦闘] クリスタルの設置間隔 (0=最速, 20=1秒)", 0, 25, {
      valueStep: 1,
      defaultValue: config.crystalCooldown,
    })
    .slider("[戦闘] クリスタルの起爆遅れ (0=即座, 10=0.5秒)", 0, 10, {
      valueStep: 1,
      defaultValue: config.crystalDetonateDelay,
    })
    .toggle("[戦闘] 自爆ダメージを気にせず特攻する", {
      defaultValue: config.ignoreSelfDamage ?? false,
    })
    .toggle("[戦闘] アンカーを使う", { defaultValue: config.anchorCombo })
    .slider("[戦闘] アンカーの設置間隔 (0=最速, 20=1秒)", 0, 25, {
      valueStep: 1,
      defaultValue: config.anchorCooldown,
    })
    .slider("[戦闘] アンカーの起爆遅れ (0=即座, 10=0.5秒)", 0, 10, {
      valueStep: 1,
      defaultValue: config.anchorDetonateDelay,
    })
    .toggle("[戦闘] アンカー破壊パターンをキャッシュ (ラグ軽減)", {
      defaultValue: config.anchorBreakCache ?? true,
    })
    .toggle("[人間味] 遅れ・ブレ・ミスを有効にする", {
      defaultValue: config.humanize,
    })
    .slider("[人間味] 反応の遅れ (大きいほど鈍い)", 0, 12, {
      valueStep: 1,
      defaultValue: config.reactionDelay,
    })
    .slider("[人間味] 視線のブレ (%)", 0, 30, {
      valueStep: 1,
      defaultValue: Math.round(Number(config.aimJitter ?? 0) * 100),
    })
    .slider("[人間味] ミス率 (空振り・見送り %)", 0, 30, {
      valueStep: 1,
      defaultValue: config.mistakeRate,
    })
    .slider("[人間味] 非最適行動率 (%)", 0, 60, {
      valueStep: 1,
      defaultValue: config.suboptimalRate,
    })
    .toggle("[システム] 装備が壊れないようにする", {
      defaultValue: config.unbreakableEquipment ?? true,
    })
    .slider("[システム] 処理の軽さ (1=重い/強い, 4=軽い/鈍い)", 1, 4, {
      valueStep: 1,
      defaultValue: config.tickInterval,
    })
    .toggle("[Debug] 全体のログ", { defaultValue: config.debug.enabled })
    .toggle("[Debug] 移動のログ", { defaultValue: config.debug.movement })
    .toggle("[Debug] 候補探索のログ", { defaultValue: config.debug.scan })
    .toggle("[Debug] 攻撃のログ", { defaultValue: config.debug.combat })
    .toggle("[Debug] トーテムのログ", { defaultValue: config.debug.totem })
    .toggle("[Debug] 装備同期のログ", { defaultValue: config.debug.loadout })
    .toggle("[Debug] インベントリのログ", {
      defaultValue: config.debug.inventory,
    });
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  const response = await form.show(player);
  runtime.isConfiguring = false;
  if (response.canceled || !response.formValues) {
    return;
  }
  const [
    enabled,
    maintainDistance,
    targetRange,
    jumpDash,
    autoTotem,
    totemRefillDelay,
    pearlMove,
    pearlDistance,
    pearlCooldown,
    swordCombo,
    swordCooldown,
    crystalCombo,
    crystalCooldown,
    crystalDetonateDelay,
    ignoreSelfDamage,
    anchorCombo,
    anchorCooldown,
    anchorDetonateDelay,
    anchorBreakCache,
    humanize,
    reactionDelay,
    aimJitterPercent,
    mistakeRate,
    suboptimalRate,
    unbreakableEquipment,
    tickInterval,
    debugEnabled,
    debugMovement,
    debugScan,
    debugCombat,
    debugTotem,
    debugLoadout,
    debugInventory,
  ] = response.formValues;
  const current = ensureBotInitialized(bot, player);
  if (!current) {
    return;
  }
  const updated = persistBotConfig(bot, {
    ...current,
    ownerName: player.name,
    enabled,
    maintainDistance,
    targetRange,
    jumpDash,
    autoTotem,
    totemRefillDelay,
    pearlMove,
    pearlDistance,
    pearlCooldown,
    swordCombo,
    swordCooldown,
    crystalCombo,
    crystalCooldown,
    crystalDetonateDelay,
    ignoreSelfDamage,
    anchorCombo,
    anchorCooldown,
    anchorDetonateDelay,
    anchorBreakCache,
    humanize,
    reactionDelay,
    aimJitter: Number(aimJitterPercent) / 100,
    mistakeRate,
    suboptimalRate,
    unbreakableEquipment,
    tickInterval,
    debug: {
      enabled: debugEnabled,
      movement: debugMovement,
      scan: debugScan,
      combat: debugCombat,
      totem: debugTotem,
      loadout: debugLoadout,
      inventory: debugInventory,
    },
  });
  bot.nameTag = updated.displayName || "Crystal Bot";
  syncBotLoadout(bot, updated, true);
  ensureBotEquipmentIntegrity(bot, updated);
  player.sendMessage(`§a${getBotLabel(bot)} の設定を保存しました。`);
  logBotEvent(bot, `settings saved by ${player.name}`);
}
async function openInventorySettingsMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) return;
  const modeLabels = {
    infinite: "無限 (アイテムを消費しない)",
    owner_sync: "オーナー同期 (オーナーのインベントリと同じ)",
    custom: "カスタム (個別に設定)",
    auto_refill: "自動補充 (デフォルト値まで補充)",
  };
  const currentMode = config.inventoryMode ?? "auto_refill";
  const customCounts = config.customItemCounts ?? {};
  let bodyText = "インベントリモードを選択してください。\n\n";
  bodyText += `現在: ${modeLabels[currentMode]}\n\n`;
  if (currentMode === "custom") {
    bodyText += "カスタム設定:\n";
    for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
      const count =
        customCounts[itemId] ?? PATCH_DEFAULT_COMBAT_ITEM_COUNTS[itemId] ?? 0;
      const itemName = itemId.replace("minecraft:", "").replace("_", " ");
      bodyText += `  ${itemName}: ${count}\n`;
    }
  } else if (currentMode === "owner_sync") {
    const owner = config.ownerName
      ? getPlayerByName(config.ownerName)
      : undefined;
    const ownerInventory = owner?.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    const botInventory = bot.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    const ownerCounts = ownerInventory
      ? patchCreateManagedItemCountMap(
          patchCollectContainerSnapshot(ownerInventory).counts,
        )
      : {};
    const botCounts = botInventory
      ? patchCreateManagedItemCountMap(
          patchCollectContainerSnapshot(botInventory).counts,
        )
      : {};
    bodyText += "オーナー同期 現在の所持数:\n";
    bodyText += "  (現在の所持数 / オーナーの合計数)\n";
    for (const itemId of PATCH_MANAGED_STACK_ITEM_IDS) {
      const oCount = ownerCounts[itemId] ?? 0;
      const bCount = botCounts[itemId] ?? 0;
      const itemName = itemId.replace("minecraft:", "").replace("_", " ");
      bodyText += `  ${itemName}: ${bCount} / ${oCount}\n`;
    }
  }
  const form = new ActionFormData()
    .title("インベントリ設定")
    .body(bodyText)
    .button("無限モード")
    .button("オーナー同期モード")
    .button("自動補充モード")
    .button("カスタムモード")
    .button("カスタム値を設定")
    .button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  const response = await form.show(player);
  runtime.isConfiguring = false;
  if (response.canceled) return;
  if (response.selection === 0) {
    config.inventoryMode = "infinite";
    writeConfigTags(bot, config);
    saveConfigs();
    syncBotLoadout(bot, config, true);
    player.sendMessage(
      `§a${getBotLabel(bot)} のインベントリを無限モードに設定しました。`,
    );
  } else if (response.selection === 1) {
    config.inventoryMode = "owner_sync";
    writeConfigTags(bot, config);
    saveConfigs();
    syncBotLoadout(bot, config, true);
    player.sendMessage(
      `§a${getBotLabel(bot)} のインベントリをオーナー同期モードに設定しました。`,
    );
  } else if (response.selection === 2) {
    config.inventoryMode = "auto_refill";
    writeConfigTags(bot, config);
    saveConfigs();
    syncBotLoadout(bot, config, true);
    player.sendMessage(
      `§a${getBotLabel(bot)} のインベントリを自動補充モードに設定しました。`,
    );
  } else if (response.selection === 3) {
    config.inventoryMode = "custom";
    getRuntime(config.uid).customBudgetInitialized = false;
    writeConfigTags(bot, config);
    saveConfigs();
    syncBotLoadout(bot, config, true);
    player.sendMessage(
      `§a${getBotLabel(bot)} のインベントリをカスタムモードに設定しました。`,
    );
  } else if (response.selection === 4) {
    await openCustomItemCountsMenu(player, bot, defaultIndex);
    return;
  } else {
    system.run(() => {
      void openBotManageMenu(player, bot, defaultIndex);
    });
    return;
  }
  system.run(() => {
    void openInventorySettingsMenu(player, bot, defaultIndex);
  });
}
async function openCustomItemCountsMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return;
  }
  const customCounts = config.customItemCounts ?? {};
  const itemEntries = [
    { id: OBSIDIAN_ID, name: "黒曜石", default: 64 },
    { id: END_CRYSTAL_ID, name: "エンドクリスタル", default: 64 },
    { id: RESPAWN_ANCHOR_ID, name: "リスポーンアンカー", default: 32 },
    { id: GLOWSTONE_ID, name: "グロウストーン", default: 64 },
    { id: ENDER_PEARL_ID, name: "エンダーパール", default: 16 },
    { id: TOTEM_ID, name: "トーテム", default: 8 },
    {
      id: PATCH_ENCHANTED_GOLDEN_APPLE_ID,
      name: "エンチャント金リンゴ",
      default: 8,
    },
    { id: PATCH_GOLDEN_APPLE_ID, name: "金リンゴ", default: 16 },
    { id: "minecraft:cobblestone", name: "丸石", default: 64 },
    { id: "minecraft:dirt", name: "土", default: 64 },
    { id: "minecraft:stone", name: "石", default: 64 },
  ];
  let bodyText = "設定するアイテムを選択してください。\n\n現在の設定:\n";
  for (const entry of itemEntries) {
    const count = customCounts[entry.id] ?? entry.default;
    bodyText += `${entry.name}: ${count}\n`;
  }
  const form = new ActionFormData()
    .title("カスタムアイテム数設定")
    .body(bodyText);
  for (const entry of itemEntries) {
    const count = customCounts[entry.id] ?? entry.default;
    form.button(`${entry.name}: ${count}`);
  }
  form.button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  const response = await form.show(player);
  runtime.isConfiguring = false;
  if (response.canceled) {
    return;
  }
  if (response.selection === itemEntries.length) {
    system.run(() => {
      void openInventorySettingsMenu(player, bot, defaultIndex);
    });
    return;
  }
  if (response.selection < itemEntries.length) {
    await openItemCountInput(
      player,
      bot,
      itemEntries[response.selection],
      defaultIndex,
    );
    return;
  }
}
async function openItemCountInput(player, bot, itemEntry, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return;
  }
  const customCounts = config.customItemCounts ?? {};
  const currentCount = customCounts[itemEntry.id] ?? itemEntry.default;
  const form = new ModalFormData()
    .title(`${itemEntry.name}の数を設定`)
    .slider("数量", 0, 64, { valueStep: 1, defaultValue: currentCount })
    .toggle("無限 (64に設定)", { defaultValue: currentCount === 64 });
  const response = await form.show(player);
  if (response.canceled) {
    system.run(() => {
      void openCustomItemCountsMenu(player, bot, defaultIndex);
    });
    return;
  }
  if (response.formValues) {
    let count = Number(response.formValues[0]);
    const isInfinite = Boolean(response.formValues[1]);
    if (isInfinite) {
      count = 64;
    }
    if (!config.customItemCounts) {
      config.customItemCounts = {};
    }
    config.customItemCounts[itemEntry.id] = count;
    getRuntime(config.uid).customBudgetInitialized = false;
    writeConfigTags(bot, config);
    saveConfigs();
    syncBotLoadout(bot, config, true);
    debugLog(
      bot,
      config,
      "inventory",
      `カスタム個数変更: ${itemEntry.id}=${count}`,
    );
    player.sendMessage(`§a${itemEntry.name}の数を${count}に設定しました。`);
  }
  system.run(() => {
    void openCustomItemCountsMenu(player, bot, defaultIndex);
  });
}
async function openBotManageMenu(player, bot, defaultIndex = 0) {
  const config = ensureBotInitialized(bot, player);
  if (!config) {
    return;
  }
  const inventoryModeLabel = {
    infinite: "無限",
    owner_sync: "オーナー同期",
    custom: "カスタム",
    auto_refill: "自動補充",
  }[config.inventoryMode ?? "auto_refill"];
  const form = new ActionFormData()
    .title(getBotLabel(bot))
    .body(
      `Owner: ${config.ownerName || "none"}\n供給チェスト: ${formatSupplyChest(config)}\n同期元: ${
        hasSupplyChest(config)
          ? "供給チェスト優先"
          : config.mirrorOwnerLoadout
            ? "Owner 装備"
            : "固定ロードアウト"
      }\nインベントリ: ${inventoryModeLabel}\n維持距離: ${config.maintainDistance}\n敵認識範囲: ${
        config.targetRange ?? MAX_TARGET_DISTANCE
      }`,
    )
    .button("戦闘設定")
    .button("インベントリ設定")
    .button("視線先チェストを供給元に設定")
    .button("供給チェストを解除")
    .button("装備を今すぐ同期")
    .button("自分をこの Bot に TP")
    .button("この Bot を自分に TP")
    .button("この Bot を削除")
    .button("戻る");
  const runtime = getRuntime(config.uid);
  runtime.isConfiguring = true;
  const response = await form.show(player);
  runtime.isConfiguring = false;
  if (response.canceled) {
    return;
  }
  if (response.selection === 0) {
    await openBotSettingsModal(player, bot);
    return;
  }
  if (response.selection === 1) {
    await openInventorySettingsMenu(player, bot, defaultIndex);
    return;
  }
  if (response.selection === 2) {
    setSupplyChestFromView(player, bot);
  } else if (response.selection === 3) {
    clearSupplyChest(player, bot);
  } else if (response.selection === 4) {
    const current = ensureBotInitialized(bot, player);
    if (current) {
      syncBotLoadout(bot, current, true);
      ensureBotEquipmentIntegrity(bot, current);
      player.sendMessage(`§a${getBotLabel(bot)} の装備を同期しました。`);
    }
  } else if (response.selection === 5) {
    teleportPlayerToBot(player, bot);
  } else if (response.selection === 6) {
    teleportBotToPlayer(player, bot);
  } else if (response.selection === 7) {
    if (removeSpecificBot(player, bot)) {
      system.run(() => {
        void openSettingsForm(player, defaultIndex);
      });
      return;
    }
  } else {
    system.run(() => {
      void openSettingsForm(player, defaultIndex);
    });
    return;
  }
  system.run(() => {
    void openBotManageMenu(player, bot, defaultIndex);
  });
}
openSettingsForm = async function (player, defaultIndex = 0) {
  const nearbyBots = getNearbyBots(player, Number.POSITIVE_INFINITY);
  if (!nearbyBots.length) {
    player.sendMessage("§c設定できる PvP Bot がいません。");
    logSystem(`openSettingsForm: no nearby bots for ${player.name}`);
    return;
  }
  const safeIndex = Math.max(0, Math.min(defaultIndex, nearbyBots.length - 1));
  const pickerForm = new ActionFormData()
    .title("Select Bot")
    .body("設定する Bot を選択してください。");
  for (const bot of nearbyBots) {
    pickerForm.button(getBotLabel(bot));
  }
  const picker = await pickerForm.show(player);
  if (picker.canceled) {
    logSystem(`openSettingsForm: picker canceled by ${player.name}`);
    return;
  }
  const pickedIndex =
    typeof picker.selection === "number" ? picker.selection : safeIndex;
  const selectedBot = nearbyBots[pickedIndex];
  await openBotManageMenu(player, selectedBot, pickedIndex);
};
try {
  if (world.afterEvents.entityHurt) {
    world.afterEvents.entityHurt.subscribe((event) => {
      if (event.hurtEntity?.typeId !== BOT_TYPE) {
        return;
      }
      const bot = event.hurtEntity;
      const config = ensureBotInitialized(bot);
      if (!config) {
        return;
      }
      const damage = Number(event.damage ?? 0);
      const preventedDamage = patchCalculateArmorDamageReduction(
        bot,
        damage,
        event.damageSource?.cause,
      );
      if (preventedDamage > 0.01) {
        const currentHealth = patchGetCurrentHealthValue(bot);
        const maxHealth = patchGetMaxHealthValue(bot);
        setHealthValue(
          bot,
          Math.min(maxHealth, currentHealth + preventedDamage),
        );
      }
      if (!config.autoTotem) {
        return;
      }
      const runtime = getRuntime(config.uid);
      if ((runtime.totemShieldUntilTick ?? -9999) > globalTick) {
        const currentHealth = patchGetCurrentHealthValue(bot);
        const maxHealth = patchGetMaxHealthValue(bot);
        setHealthValue(bot, Math.min(maxHealth, currentHealth + damage));
        return;
      }
      handleTotemSafety(bot, config);
      if (
        globalTick - runtime.lastTotemPopTick <
        PATCH_TOTEM_POP_COOLDOWN_TICKS
      ) {
        return;
      }
      if (!patchShouldEmergencyPopTotem(bot, damage)) {
        return;
      }
      const cause = event.damageSource?.cause ?? "unknown";
      if (tryPopTotem(bot, config, cause)) {
        logBotEvent(bot, `pseudo totem popped: ${cause}`);
      }
    });
  }
} catch {}
function createPlayerCommandHandler(callback) {
  return (origin) => {
    const executor =
      origin.sourceEntity?.typeId === "minecraft:player"
        ? origin.sourceEntity
        : origin.initiator?.typeId === "minecraft:player"
          ? origin.initiator
          : undefined;
    if (!executor) {
      return {
        status: CustomCommandStatus.Failure,
        message: "このコマンドはプレイヤーから実行してください。",
      };
    }
    system.run(() => {
      try {
        logSystem(`command invoked by ${executor.name}`);
        const result = callback(executor);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            appendPersistentDebugLog(
              "error",
              `async command error for ${executor.name}: ${formatError(error)}`,
            );
            executor.sendMessage(`§c[PvPBot] ${formatError(error)}`);
          });
        }
      } catch (error) {
        appendPersistentDebugLog(
          "error",
          `sync command error for ${executor.name}: ${formatError(error)}`,
        );
        executor.sendMessage(`§c[PvPBot] ${formatError(error)}`);
      }
    });
    return {
      status: CustomCommandStatus.Success,
      message: "PvP Bot コマンドを受け付けました。",
    };
  };
}
try {
  system.beforeEvents.startup.subscribe((event) => {
    // 通常コマンド（引数なし）
    const commands = [
      {
        name: "bot",
        description: "Crystal PvP Bot のメニューを開きます",
        handler: (player) => openRootMenu(player),
      },
      {
        name: "pvpbot:setsupplychest",
        description: "視線先のチェストを近くの Bot の供給元に設定します",
        handler: (player) => setSupplyChestForNearestBot(player),
      },
      {
        name: "pvpbot:clearsupplychest",
        description: "近くの Bot の供給チェスト設定を解除します",
        handler: (player) => clearSupplyChestForNearestBot(player),
      },
      {
        name: "pvpbot:remove",
        description: "所有している Crystal PvP Bot を削除します",
        handler: (player) => removeOwnedBots(player),
      },
      {
        name: "pvpbot:debugdump",
        description: "保存されたデバッグログを表示します",
        handler: (player) => dumpPersistentDebugLog(player),
      },
      {
        name: "pvpbot:debugclear",
        description: "保存されたデバッグログを消去します",
        handler: (player) => clearPersistentDebugLog(player),
      },
    ];
    for (const command of commands) {
      try {
        event.customCommandRegistry.registerCommand(
          {
            name: command.name,
            description: command.description,
            permissionLevel: CommandPermissionLevel.Any,
            cheatsRequired: false,
          },
          createPlayerCommandHandler(command.handler),
        );
      } catch (error) {
        console.warn(
          `[PvPBot] command registration failed (${command.name}): ${formatError(error)}`,
        );
      }
    }
    // pvpbot:bot — メニューを開く
    try {
      event.customCommandRegistry.registerCommand(
        { name: "pvpbot:bot", description: "Crystal PvP Bot のメニューを開きます", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
        createPlayerCommandHandler((player) => openRootMenu(player)),
      );
    } catch (error) { console.warn(`[PvPBot] pvpbot:bot failed: ${formatError(error)}`); }

    // pvpbot:spawn — 設定画面を開いて召喚
    try {
      event.customCommandRegistry.registerCommand(
        { name: "pvpbot:spawn", description: "Crystal PvP Bot を召喚します", permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false },
        createPlayerCommandHandler((player) => spawnBotForPlayer(player, true)),
      );
    } catch (error) { console.warn(`[PvPBot] pvpbot:spawn failed: ${formatError(error)}`); }

    // プリセット別即召喚コマンド
    for (const preset of ["easy", "normal", "hard"]) {
      const p = preset;
      try {
        event.customCommandRegistry.registerCommand(
          {
            name: `pvpbot:${p}`,
            description: `Crystal PvP Bot を ${p} プリセットで即召喚します (インベントリ: 無限)`,
            permissionLevel: CommandPermissionLevel.Any,
            cheatsRequired: false,
          },
          createPlayerCommandHandler((player) => spawnBotWithPreset(player, p)),
        );
      } catch (error) { console.warn(`[PvPBot] pvpbot:${p} failed: ${formatError(error)}`); }
    }

  });
} catch (error) {
  console.warn(`[PvPBot] startup subscribe failed: ${formatError(error)}`);
}
world.afterEvents.entitySpawn.subscribe((event) => {
  if (event.entity.typeId === BOT_TYPE) {
    trackBot(event.entity);
    system.run(() => {
      const request = matchPendingSpawnRequest(event.entity);
      const owner = request ? getPlayerByName(request.playerName) : undefined;
      const config = ensureBotInitialized(event.entity, owner);
      if (!config) {
        appendPersistentDebugLog("error", "entitySpawn init failed");
        return;
      }
      updateTrackedBotMeta(event.entity, { uid: config.uid });
      appendPersistentDebugLog(
        "probe",
        `entitySpawn id=${shortId(event.entity.id)} uid=${shortId(config.uid)} owner=${owner?.name ?? "none"} loc=${formatLocation(event.entity.location)} players=${summarizeNearbyPlayers(event.entity.dimension, event.entity.location, 2.5)} nearbyBots=${summarizeNearbyBots(event.entity.dimension, event.entity.location, 10)} ${describeBlockContext(event.entity.dimension, event.entity.location)}`,
      );
      scheduleBotProbe(
        event.entity,
        request ? `spawn:${owner?.name ?? "unknown"}` : "summon:manual",
        config.uid,
      );
      if (request && owner) {
        let updatedConfig = { ...config, ownerName: owner.name, enabled: true };
        // プリセット指定があれば適用
        if (request.presetName) {
          updatedConfig = patchApplyDifficultyPreset(updatedConfig, request.presetName);
        }
        // インベントリモード指定があれば適用
        if (request.inventoryMode) {
          updatedConfig = { ...updatedConfig, inventoryMode: request.inventoryMode };
        }
        persistBotConfig(event.entity, updatedConfig);
        const presetLabel = request.presetName ? ` [${request.presetName}]` : "";
        owner.sendMessage(`§a${getBotLabel(event.entity)}${presetLabel} を召喚しました。`);
        logBotEvent(event.entity, `spawned for ${owner.name} preset=${request.presetName ?? "none"}`);
        if (request.openSettingsAfterSpawn) {
          system.runTimeout(() => {
            void openSettingsForm(owner, 0);
          }, 2);
        }
      }
    });
  }
});
try {
  world.afterEvents.entityDie.subscribe((event) => {
    const deadEntity = event.deadEntity;
    if (deadEntity?.typeId === "minecraft:player" && deadEntity.id) {
      for (const bot of getAllBots()) {
        const config = ensureBotInitialized(bot);
        if (!config) {
          continue;
        }
        const runtime = getRuntime(config.uid);
        if (runtime.pendingAnchor?.targetId === deadEntity.id) {
          runtime.pendingAnchor = undefined;
        }
        if (runtime.pendingCrystal?.targetId === deadEntity.id) {
          runtime.pendingCrystal = undefined;
        }
      }
    }
    if (deadEntity?.typeId !== BOT_TYPE) {
      return;
    }
    const meta = updateTrackedBotMeta(deadEntity);
    const cause = event.damageSource?.cause ?? "unknown";
    appendPersistentDebugLog(
      "probe",
      `entityDie cause=${cause} ${describeTrackedBotMeta(meta)} nearbyBots=${summarizeNearbyBots(meta?.dimensionId, meta?.location, 10)} nearbyPlayers=${summarizeNearbyPlayers(meta?.dimensionId, meta?.location, 2.5)}`,
    );
    logBotEvent(deadEntity, `died: ${cause}`);
    broadcastDeathMessage(deadEntity, meta);
    untrackBot(deadEntity);
  });
} catch {}
try {
  if (world.afterEvents.entityRemove) {
    world.afterEvents.entityRemove.subscribe((event) => {
      const removed = event.removedEntity;
      const typeId = (() => {
        try {
          return removed?.typeId ?? event.typeId ?? "";
        } catch {
          return event.typeId ?? "";
        }
      })();
      if (typeId !== BOT_TYPE) {
        return;
      }
      const id = (() => {
        try {
          return removed?.id ?? event.removedEntityId ?? "";
        } catch {
          return event.removedEntityId ?? "";
        }
      })();
      const meta = removed
        ? updateTrackedBotMeta(removed)
        : trackedBotMetaById.get(id);
      appendPersistentDebugLog(
        "probe",
        `entityRemove ${describeTrackedBotMeta(meta)} nearbyBots=${summarizeNearbyBots(meta?.dimensionId, meta?.location, 10)} nearbyPlayers=${summarizeNearbyPlayers(meta?.dimensionId, meta?.location, 2.5)}`,
      );
      if (removed) {
        logBotEvent(removed, "removed");
        untrackBot(removed);
      } else if (id) {
        trackedBots.delete(id);
      }
    });
  }
} catch {}
try {
  world.afterEvents.playerSpawn.subscribe((event) => {
    system.runTimeout(() => {
      if (introShown.has(event.player.name)) {
        return;
      }
      introShown.add(event.player.name);
      event.player.sendMessage(getIntroMessage());
    }, 5);
  });
} catch (error) {
  console.warn(`[PvPBot] playerSpawn subscribe failed: ${formatError(error)}`);
}
// ============================================================
// [ELEVATION ADVANTAGE PATCH]
// クリスタルPvPの基本原理:
//   爆発物(クリスタル/アンカー)は「エンティティと同じ高さ」にあると最大ダメージになる。
//   よってクリスタルの土台(黒曜石)は、相手が立っている地面と同じか、それより下に置くのが正解。
//   結果として「自分が相手より低い位置にいる」方が圧倒的に有利。
//   逆に「相手と同じ高さ or 自分が上」は不利なので、
//   エンダーパール / 落下 / アンカー自爆 で能動的に下へ降りる必要がある。
// ============================================================
const ELEV_ADVANTAGE_EPSILON = 0.35;        // 同高度と見なす許容差
const ELEV_IDEAL_LOWER_DELTA = 1.0;         // 相手より1ブロック低いのが基本の理想
const ELEV_MAX_USEFUL_LOWER_DELTA = 3.0;    // これ以上低いとクリスタルが届かない
const ELEV_DESCENT_COOLDOWN_TICKS = 4;      // 開いている下層を逃さず再評価する
const ELEV_DESCENT_SCAN_RADIUS = 6;         // 下降先の水平探索半径
const ELEV_DESCENT_MAX_DROP = 12;           // 探索する最大落下量
const ELEV_TACTICAL_MAX_DROP = 8;           // 射程外でも危険な同高度から逃れる最大深度
const ELEV_ANCHOR_SELFBLAST_MIN_HEALTH = 12; // アンカー自爆で降りるのに必要な体力
const ELEV_SELFBLAST_COOLDOWN_TICKS = 60;

// 立っている地面(足元ブロックの上面)のYを求める。空中なら落下予測先。
function elevResolveGroundY(dimension, location, maxDrop = ELEV_DESCENT_MAX_DROP) {
  const origin = floorLocation(location);
  for (let drop = 0; drop <= maxDrop; drop += 1) {
    const feet = { x: origin.x, y: origin.y - drop, z: origin.z };
    const below = getBlock(dimension, addVector(feet, { x: 0, y: -1, z: 0 }));
    const feetBlock = getBlock(dimension, feet);
    if (isSolidBlock(below) && (isAirBlock(feetBlock) || drop > 0)) {
      return feet.y;
    }
  }
  return origin.y;
}

// 自分と相手の高さ関係を評価する。
// state: "lower"(有利) / "level"(不利) / "higher"(最も不利)
function elevEvaluateAdvantage(bot, target) {
  const botGroundY = elevResolveGroundY(bot.dimension, bot.location);
  const targetGroundY = elevResolveGroundY(
    target.dimension ?? bot.dimension,
    target.location,
  );
  const rawDelta = bot.location.y - target.location.y; // +なら自分が上
  const groundDelta = botGroundY - targetGroundY;
  let state;
  if (rawDelta < -ELEV_ADVANTAGE_EPSILON) {
    state = "lower";
  } else if (rawDelta > ELEV_ADVANTAGE_EPSILON) {
    state = "higher";
  } else {
    state = "level";
  }
  // 低すぎてクリスタルが相手に届かない場合は「有利」ではなく「離れすぎ」
  const tooLow = -rawDelta > ELEV_MAX_USEFUL_LOWER_DELTA;
  return {
    state,
    rawDelta,
    groundDelta,
    botGroundY,
    targetGroundY,
    tooLow,
    // 同高度は有利扱いしない。爆心より明確に下にいる時だけ攻めの高さとする。
    isFavorable: rawDelta < -ELEV_ADVANTAGE_EPSILON && !tooLow,
    // 同高度/上なら、下層が射程外でもまず危険な高さから離脱する。
    needsDescent: state === "level" || state === "higher",
    // どれだけ下がりたいか
    desiredDrop: Math.max(
      0,
      Math.min(
        ELEV_MAX_USEFUL_LOWER_DELTA,
        rawDelta + ELEV_IDEAL_LOWER_DELTA,
      ),
    ),
  };
}

// 相手より低い立ち位置を探す。
// 条件: 相手より低い / クリスタルの射程内 / 立てる / 境界内
function elevFindLowerStandingSpot(bot, target, advantage) {
  const dimension = bot.dimension;
  const botOrigin = floorLocation(bot.location);
  const targetGroundY = advantage.targetGroundY;
  // まず相手より1〜3下を狙う。そこが無ければ現在地から最大8ブロック下も
  // 候補にし、同高度で爆破を受け続けるより下層への離脱を優先する。
  const desiredYs = [];
  for (let drop = 1; drop <= ELEV_MAX_USEFUL_LOWER_DELTA; drop += 1) {
    desiredYs.push(targetGroundY - drop);
  }
  for (let drop = 1; drop <= ELEV_TACTICAL_MAX_DROP; drop += 1) {
    desiredYs.push(Math.floor(bot.location.y) - drop);
  }
  const uniqueDesiredYs = [...new Set(desiredYs)];
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (
    let dx = -ELEV_DESCENT_SCAN_RADIUS;
    dx <= ELEV_DESCENT_SCAN_RADIUS;
    dx += 1
  ) {
    for (
      let dz = -ELEV_DESCENT_SCAN_RADIUS;
      dz <= ELEV_DESCENT_SCAN_RADIUS;
      dz += 1
    ) {
      for (const y of uniqueDesiredYs) {
        const candidate = {
          x: botOrigin.x + dx + 0.5,
          y,
          z: botOrigin.z + dz + 0.5,
        };
        if (candidate.y >= bot.location.y - 0.2) {
          continue; // 実際に下がれていないならスキップ
        }
        if (!isLocationInsideBotBoundary(candidate)) {
          continue;
        }
        if (!isSafeStandingLocation(dimension, candidate)) {
          continue;
        }
        const horizontal = Math.hypot(
          candidate.x - target.location.x,
          candidate.z - target.location.z,
        );
        const dropFromTarget = targetGroundY - candidate.y;
        // 降りた先から相手の足元のクリスタル(= targetGroundY の高さ)に
        // 実際に手が届くかを3D距離で検証する。
        // 低く降りるほど縦距離が伸びるので、水平距離の許容量は自動的に縮む。
        const reach3d = Math.hypot(horizontal, dropFromTarget);
        if (horizontal < 0.65) {
          continue;
        }
        const outsideImmediateReach = reach3d > MAX_INTERACT_DISTANCE - 0.1;
        // 理想は1ブロック下。射程外の深い退避先も最後の手段として残す。
        const verticalScore = Math.abs(dropFromTarget - ELEV_IDEAL_LOWER_DELTA) * 2.0;
        const horizontalScore = Math.abs(horizontal - 2.2) * 1.1;
        const travelScore = Math.hypot(
          candidate.x - bot.location.x,
          candidate.z - bot.location.z,
        ) * 0.25;
        const score =
          verticalScore +
          horizontalScore +
          travelScore +
          (outsideImmediateReach ? 8 : 0);
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

// 真下または隣の開口部から落ちられる着地点を探す。
// 従来は「既に立てる1〜3段下」だけを見ていたため、穴の入口が空気だと見逃していた。
function elevFindOpenDropLanding(bot, target, advantage) {
  const origin = floorLocation(bot.location);
  const planar = normalize2D(vectorTo(bot.location, target.location));
  const offsets = [
    { x: 0, z: 0 },
    { x: Math.round(planar.x), z: Math.round(planar.z) },
    { x: -Math.round(planar.z), z: Math.round(planar.x) },
    { x: Math.round(planar.z), z: -Math.round(planar.x) },
    { x: -Math.round(planar.x), z: -Math.round(planar.z) },
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ];
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const offset of offsets) {
    const x = origin.x + offset.x;
    const z = origin.z + offset.z;
    if (offset.x !== 0 || offset.z !== 0) {
      const entryFeet = getBlock(bot.dimension, { x, y: origin.y, z });
      const entryHead = getBlock(bot.dimension, { x, y: origin.y + 1, z });
      if (!isAirBlock(entryFeet) || !isAirBlock(entryHead)) continue;
    }
    for (let drop = 1; drop <= ELEV_TACTICAL_MAX_DROP; drop += 1) {
      const candidate = { x: x + 0.5, y: origin.y - drop, z: z + 0.5 };
      if (!isLocationInsideBotBoundary(candidate)) continue;
      const shaftFeet = getBlock(bot.dimension, {
        x,
        y: origin.y - drop + 1,
        z,
      });
      if (!isAirBlock(shaftFeet)) break;
      if (!isSafeStandingLocation(bot.dimension, candidate)) continue;
      const dropFromTarget = advantage.targetGroundY - candidate.y;
      if (dropFromTarget < ELEV_ADVANTAGE_EPSILON) continue;
      const horizontal = Math.hypot(
        candidate.x - target.location.x,
        candidate.z - target.location.z,
      );
      const score =
        Math.abs(dropFromTarget - ELEV_IDEAL_LOWER_DELTA) * 2 +
        horizontal * 0.2 +
        drop * 0.08;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

// 段差を歩いて降りられる1歩を探す(テレポート的な瞬間移動ではなく自然な移動)
function elevFindWalkableDescendStep(bot, target, advantage) {
  const dimension = bot.dimension;
  const planar = normalize2D(vectorTo(bot.location, target.location));
  const directions = [
    planar,
    { x: -planar.z, y: 0, z: planar.x },
    { x: planar.z, y: 0, z: -planar.x },
    { x: -planar.x, y: 0, z: -planar.z },
  ];
  const targetGroundY = advantage.targetGroundY;
  let best;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const dir of directions) {
    for (const step of [0.45, 0.8, 1.15, 1.5]) {
      const base = addVector(bot.location, { x: dir.x * step, y: 0, z: dir.z * step });
      for (let drop = 1; drop <= 4; drop += 1) {
        const candidate = {
          x: base.x,
          y: Math.floor(bot.location.y) - drop,
          z: base.z,
        };
        if (!isLocationInsideBotBoundary(candidate)) continue;
        if (!isSafeStandingLocation(dimension, candidate)) continue;
        const horizontal = Math.hypot(
          candidate.x - target.location.x,
          candidate.z - target.location.z,
        );
        const dropFromTarget = targetGroundY - candidate.y;
        if (dropFromTarget < 0.5 || dropFromTarget > ELEV_MAX_USEFUL_LOWER_DELTA) continue;
        // 降りた先から相手足元のクリスタルに手が届くか(3D距離)で判定
        if (
          Math.hypot(horizontal, dropFromTarget) >
          MAX_INTERACT_DISTANCE - 0.3
        ) {
          continue;
        }
        const score =
          Math.abs(dropFromTarget - ELEV_IDEAL_LOWER_DELTA) * 2.0 +
          Math.abs(horizontal - 2.2) * 1.0 +
          step * 0.2;
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
    }
  }
  return best;
}

// --- 下降手段 1: 歩いて段差を降りる ---
function elevTryWalkDescend(bot, target, config, advantage) {
  const step =
    elevFindOpenDropLanding(bot, target, advantage) ??
    elevFindWalkableDescendStep(bot, target, advantage);
  if (!step) {
    return false;
  }
  try {
    bot.teleport(patchSnapToBlockCenter(step), {
      dimension: bot.dimension,
      facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
    });
    tryPlayAnimation(bot, "animation.pvpbot.crystal_bot.walk");
    debugLog(
      bot,
      config,
      "movement",
      `§b高さ調整: 歩いて降下 (dY=${advantage.rawDelta.toFixed(2)} -> ${(step.y - target.location.y).toFixed(2)})`,
      true,
    );
    return true;
  } catch {}
  return false;
}

// --- 下降手段 2: エンダーパールで低い足場へ飛ぶ ---
function elevTryPearlDescend(bot, target, config, advantage) {
  if (!config.pearlMove) {
    return false;
  }
  const runtime = getRuntime(config.uid);
  const cooldown = Math.max(8, Number(config.pearlCooldown ?? 40) * 0.35);
  if (globalTick - Number(runtime.lastPearlTick ?? -9999) < cooldown) {
    return false;
  }
  const spot = elevFindLowerStandingSpot(bot, target, advantage);
  if (!spot) {
    return false;
  }
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (
    config.inventoryMode !== "infinite" &&
    (!inventory || countItemInContainer(inventory, ENDER_PEARL_ID) <= 0)
  ) {
    return false;
  }
  runtime.lastPearlTick = globalTick;
  const token = `${config.uid}:elev:${globalTick}`;
  runtime.pendingPearlToken = token;
  if (
    !equipMainhandItem(bot, ENDER_PEARL_ID, config) ||
    !consumeManagedItem(bot, config, ENDER_PEARL_ID, 1)
  ) {
    runtime.pendingPearlToken = "";
    return false;
  }
  faceBotToward(bot, spot);
  try {
    bot.dimension.spawnEntity(
      ENDER_PEARL_ID,
      addVector(bot.location, { x: 0, y: 1.45, z: 0 }),
    );
  } catch {}
  debugLog(
    bot,
    config,
    "movement",
    `§b高さ調整: エンパで降下 (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}, ${spot.z.toFixed(1)}) dY=${advantage.rawDelta.toFixed(2)}`,
    true,
  );
  system.runTimeout(() => {
    if (runtime.pendingPearlToken !== token) {
      return;
    }
    runtime.pendingPearlToken = "";
    try {
      bot.teleport(spot, {
        dimension: bot.dimension,
        facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
      });
    } catch {}
    const held = getEquippableComponent(bot)?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId === ENDER_PEARL_ID) {
      selectBestSword(bot);
    }
  }, PEARL_VISUAL_DELAY);
  return true;
}

// --- 下降手段 3: 足元でアンカーを爆破して床を抜き、下の層へ落ちる ---
// 実際のクリスタルPvPで「アンカーで足元を破壊して降りる」動きの再現。
function elevTryAnchorSelfBlastDescend(bot, target, config, advantage) {
  if (!config.anchorCombo || bot.dimension.id === "minecraft:nether") {
    return false;
  }
  const runtime = getRuntime(config.uid);
  if (runtime.pendingAnchor) {
    return false;
  }
  if (
    globalTick - Number(runtime.lastElevSelfBlastTick ?? -9999) <
    ELEV_SELFBLAST_COOLDOWN_TICKS
  ) {
    return false;
  }
  if (patchGetCurrentHealthValue(bot) < ELEV_ANCHOR_SELFBLAST_MIN_HEALTH) {
    return false; // 体力が低い時に自爆はしない
  }
  const botFeet = floorLocation(bot.location);
  // 足元1つ下の床が壊せて、さらにその下に降りられる空間があるか
  const floorLoc = addVector(botFeet, { x: 0, y: -1, z: 0 });
  const floorBlock = getBlock(bot.dimension, floorLoc);
  if (!isSolidBlock(floorBlock) || patchShouldPreserveExplosionBlock(floorBlock)) {
    return false; // 黒曜石/岩盤などは壊せない
  }
  // アンカーを置く場所 = 足元の隣接空間(自分の真横)
  let anchorBase;
  for (const offset of [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ]) {
    const candidate = { x: botFeet.x + offset.x, y: botFeet.y, z: botFeet.z + offset.z };
    if (!isLocationInsideBotBoundary(candidate)) continue;
    const block = getBlock(bot.dimension, candidate);
    const above = getBlock(bot.dimension, addVector(candidate, { x: 0, y: 1, z: 0 }));
    const below = getBlock(bot.dimension, addVector(candidate, { x: 0, y: -1, z: 0 }));
    if (!isAirBlock(block) || !isAirBlock(above) || !isSolidBlock(below)) continue;
    if (isCombatPlacementBlocked(bot.dimension, candidate, "anchor", target, bot)) continue;
    anchorBase = candidate;
    break;
  }
  if (!anchorBase) {
    return false;
  }
  const anchorLocation = getExplosionLocation(anchorBase, "anchor");
  const selfDamage = estimateExplosionDamageScore(
    bot,
    anchorLocation,
    ANCHOR_DAMAGE_SCORE_RADIUS,
    "anchor",
  );
  // 自爆ダメージが致命的なら諦める
  if (!config.ignoreSelfDamage && selfDamage > patchGetCurrentHealthValue(bot) - 8) {
    return false;
  }
  // インベントリにアンカーとグロウストーンがあるか確認
  const inventory = bot.getComponent(EntityComponentTypes.Inventory)?.container;
  if (
    config.inventoryMode !== "infinite" &&
    (!inventory ||
      countItemInContainer(inventory, RESPAWN_ANCHOR_ID) <= 0 ||
      countItemInContainer(inventory, GLOWSTONE_ID) <= 0)
  ) {
    return false;
  }
  runtime.lastElevSelfBlastTick = globalTick;
  runtime.lastAnchorTick = globalTick;
  runtime.pendingAnchor = {
    base: anchorBase,
    placementMode: "place-anchor",
    existingCharge: 0,
    needsCharge: true,
    targetId: target.id,
    targetDamage: 0,
    selfDamage,
    elevationDescent: true,
  };
  faceBotToward(bot, {
    x: anchorBase.x + 0.5,
    y: anchorBase.y + 0.5,
    z: anchorBase.z + 0.5,
  });
  debugLog(
    bot,
    config,
    "combat",
    `§b高さ調整: アンカーで床を破壊して降下開始 (dY=${advantage.rawDelta.toFixed(2)} self=${selfDamage.toFixed(2)})`,
    true,
  );
  void (async () => {
    const pending = runtime.pendingAnchor;
    if (!pending || !pending.elevationDescent) {
      return;
    }
    try {
      await patchRunAnchorPlaceAndDetonateSequence(
        bot.dimension,
        anchorBase,
        bot,
        {
          placementMode: "place-anchor",
          existingCharge: 0,
          needsCharge: true,
          detonateDelay: Math.max(
            1,
            Math.floor(Number(config.anchorDetonateDelay ?? 3)),
          ),
          explosionOptions: {
            ignoreCenterAnchorChange: true,
            requireFullNativeBreakPattern: true,
            useBreakCache: config.anchorBreakCache ?? true,
          },
          cleanupIfCancelled: true,
          beforePlace: async () => {
            if (runtime.pendingAnchor !== pending) return false;
            return (
              equipMainhandItem(bot, RESPAWN_ANCHOR_ID, config) &&
              consumeManagedItem(bot, config, RESPAWN_ANCHOR_ID, 1)
            );
          },
          beforeCharge: async () => {
            if (runtime.pendingAnchor !== pending) return false;
            return (
              equipMainhandItem(bot, GLOWSTONE_ID, config) &&
              consumeManagedItem(bot, config, GLOWSTONE_ID, 1)
            );
          },
          beforeExplode: async () => runtime.pendingAnchor === pending,
        },
      );
    } catch {}
    if (runtime.pendingAnchor === pending) {
      runtime.pendingAnchor = undefined;
    }
    selectBestSword(bot);
    // 爆破で床が抜けたので、下の階層へ落ちる処理を促す
    system.runTimeout(() => {
      try {
        if (!isEntityUsable(bot, BOT_TYPE)) return;
        const landing = findNearestStandingLocation(
          bot.dimension,
          bot.location,
          [-1, -2, -3, -4, -5, -6],
        );
        if (landing && isLocationInsideBotBoundary(landing)) {
          bot.teleport(patchSnapToBlockCenter(landing), {
            dimension: bot.dimension,
            facingLocation: addVector(target.location, { x: 0, y: 1.1, z: 0 }),
          });
          debugLog(
            bot,
            config,
            "movement",
            `§b高さ調整: 破壊した床から降下完了 (y=${landing.y})`,
            true,
          );
        }
      } catch {}
    }, 3);
  })();
  return true;
}

// --- 下降ディスパッチャ: 高さ不利なら降りることを最優先する ---
function elevMaintainLowGround(bot, target, config, advantage) {
  const runtime = getRuntime(config.uid);
  if (!advantage.needsDescent) {
    return false;
  }
  // 実行中の下降や自然落下を通常移動で打ち消さない。
  if (
    runtime.pendingAnchor?.elevationDescent ||
    `${runtime.pendingPearlToken ?? ""}`.includes(":elev:") ||
    !patchIsEntityOnGroundSafe(bot)
  ) {
    return true;
  }
  if (
    globalTick - Number(runtime.lastElevDescentTick ?? -9999) <
    ELEV_DESCENT_COOLDOWN_TICKS
  ) {
    return false;
  }
  runtime.lastElevDescentTick = globalTick;
  // 1. 歩いて降りられるならそれが最も自然かつ低コスト
  if (elevTryWalkDescend(bot, target, config, advantage)) {
    return true;
  }
  // 2. 段差がなければエンパで低い足場に飛ぶ
  if (elevTryPearlDescend(bot, target, config, advantage)) {
    return true;
  }
  // 3. 平地で降りる場所がない場合はアンカーで床を抜いて降りる
  if (elevTryAnchorSelfBlastDescend(bot, target, config, advantage)) {
    return true;
  }
  runtime.lastElevDescentTick = globalTick - ELEV_DESCENT_COOLDOWN_TICKS + 4;
  return false;
}

// ============================================================
// 土台Y候補の是正
// 黒曜石(クリスタル土台)は「相手が立っている地面と同じか、それより下」に置く。
// 相手の足元より高い位置に置いてもクリスタルが相手の体より上に来てしまい、
// ダメージが激減する(かつ自分が上に立つ形になり不利)。
// ============================================================
patchGetCombatBaseYCandidates = function (target, bot) {
  const dimension = target.dimension ?? bot?.dimension;
  const targetFeet = floorLocation(target.location);
  const groundY = dimension
    ? elevResolveGroundY(dimension, target.location)
    : targetFeet.y;
  // 基準: 相手の地面ブロック = groundY - 1 (足元の1つ下が土台になる)
  // 許容: 土台Yは groundY - 1 以下 (= クリスタルは groundY 以下の高さに出現)
  const primary = groundY - 1;
  const candidates = [primary, primary - 1, primary - 2];
  // ジャンプ中の現在Yを土台基準にすると地面より上へ置いてしまうため、
  // 常に実際の着地面を基準にする。
  const result = [
    ...new Set(
      candidates
        .map((value) => Math.floor(value))
        // 土台の上に出るクリスタル(base+1)が、相手の頭より上に行かないよう制限
        .filter((value) => value + 1 <= groundY + 1),
    ),
  ];
  return result.length > 0 ? result : [Math.floor(primary)];
};

// ============================================================
// 移動フック: 高さ不利なら「下がる」ことを移動の最優先にする
// ============================================================
const elevBaseHandleMovement = handleMovement;
handleMovement = function (bot, target, config) {
  const runtime = getRuntime(config.uid);
  let advantage;
  try {
    advantage = elevEvaluateAdvantage(bot, target);
  } catch {
    advantage = undefined;
  }
  runtime.elevAdvantage = advantage;
  if (advantage?.needsDescent) {
    // 高さ不利(同高度 or 自分が上)の場合、まず降りる
    if (elevMaintainLowGround(bot, target, config, advantage)) {
      return; // 降下行動を取ったのでこのtickの通常移動はスキップ
    }
  }
  return elevBaseHandleMovement(bot, target, config);
};

// ============================================================
// 登り防止: 相手より高くなる足場は作らない
// (ブロックを積んで上に登るのはクリスタルPvPでは不利)
// ============================================================
const elevBasePatchTryBuildStep = patchTryBuildStep;
patchTryBuildStep = function (bot, config, moveDirection) {
  // 高さ不利の時は元関数を呼ぶ前に止める。元関数は呼び出し中に
  // ブロックを設置するため、戻り値だけ破棄しても登り防止にならない。
  try {
    const target = findNearestTarget(bot);
    if (target && elevEvaluateAdvantage(bot, target).needsDescent) {
      return undefined;
    }
  } catch {}
  const result = elevBasePatchTryBuildStep(bot, config, moveDirection);
  if (!result) {
    return result;
  }
  try {
    const target = findNearestTarget(bot);
    if (target) {
      const targetGroundY = elevResolveGroundY(bot.dimension, target.location);
      // 到達先が相手の地面より高くなるなら却下
      if (result.y > targetGroundY) {
        return undefined;
      }
    }
  } catch {}
  return result;
};

// ============================================================
// ジャンプダッシュ制限: 高さ不利なのに跳んでさらに滞空しない
// ============================================================
const elevBasePatchShouldJumpDash = patchShouldJumpDash;
patchShouldJumpDash = function (bot, target, config, moveDirection) {
  try {
    const advantage =
      getRuntime(config.uid).elevAdvantage ?? elevEvaluateAdvantage(bot, target);
    if (advantage && (advantage.state === "higher" || advantage.state === "level")) {
      return false;
    }
  } catch {}
  return elevBasePatchShouldJumpDash(bot, target, config, moveDirection);
};

// ============================================================
// 爆破スコアの是正
// クリスタルは「相手の体と同じ高さ」に来た時が最大ダメージ。
// 逆に自分が爆心より低い位置にいれば自分への被害は小さい。
// そのため「自分が相手より低い」状況を積極的に評価し、
// 「自分が相手より高い(=爆心が自分の足元に来る)」状況を強く減点する。
// ============================================================
const elevBaseChooseBestExplosiveAction = chooseBestExplosiveAction;
chooseBestExplosiveAction = function (bot, target, config) {
  const runtime = getRuntime(config.uid);
  if (
    runtime.pendingAnchor?.elevationDescent ||
    `${runtime.pendingPearlToken ?? ""}`.includes(":elev:")
  ) {
    return undefined;
  }
  const crystalReady =
    config.crystalCombo &&
    !runtime.pendingCrystal &&
    globalTick - Number(runtime.lastCrystalTick ?? -9999) >=
      Number(config.crystalCooldown ?? 0);
  const anchorReady =
    config.anchorCombo &&
    !runtime.pendingAnchor &&
    globalTick - Number(runtime.lastAnchorTick ?? -9999) >=
      Number(config.anchorCooldown ?? 0);
  if (!crystalReady && !anchorReady) {
    return undefined;
  }
  let advantage;
  try {
    advantage = runtime.elevAdvantage ?? elevEvaluateAdvantage(bot, target);
  } catch {}
  // CD中の種類を候補走査から外す。以前は毎tick両方を全走査したうえで
  // CD中の行動を選ぶことがあり、利用可能なクリスタルまで遅れていた。
  const action = elevBaseChooseBestExplosiveAction(bot, target, {
    ...config,
    crystalCombo: crystalReady,
    anchorCombo: anchorReady,
  });
  if (!action || !advantage) {
    return action;
  }
  // 高さ調整に失敗したtickでも、有効な爆破まで止めない。
  // 以前の「高さ不利なら爆破保留」が体感速度を大きく落としていた。
  return action;
};

// ============================================================
// 候補フィルタ: 相手の地面より高い土台は原則使わない
// (土台が高い = クリスタルが相手の体より上 = ダメージが落ちる)
// さらに「自分が土台より高い位置から撃つ」形も自爆が増えるので減点する。
// ============================================================
function elevRefineCandidates(bot, target, config, candidates, comboType) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return candidates;
  }
  let targetGroundY;
  try {
    targetGroundY = elevResolveGroundY(bot.dimension, target.location);
  } catch {
    return candidates;
  }
  const botGroundY = (() => {
    try {
      return elevResolveGroundY(bot.dimension, bot.location);
    } catch {
      return Math.floor(bot.location.y);
    }
  })();
  const refined = [];
  for (const candidate of candidates) {
    const baseY = candidate.location.y;
    // クリスタルは base+1、アンカーは base の高さで爆発する
    const blastY = comboType === "anchor" ? baseY : baseY + 1;
    // 爆心が相手の頭より上(足元+2以上)なら無意味なので除外
    if (blastY > targetGroundY + 1) {
      continue;
    }
    // 爆心が相手の足元より 3 以上低いと届かない
    if (blastY < targetGroundY - 3) {
      continue;
    }
    // 自分が爆心より高い位置にいると自分の胴体に爆発が直撃する形になる
    const selfAboveBlast = botGroundY - blastY;
    const elevationBonus =
      // 同じ高さも危険。自分の足元が爆心より明確に下の時だけ加点する。
      selfAboveBlast <= -ELEV_ADVANTAGE_EPSILON
        ? 4.0
        : selfAboveBlast <= ELEV_ADVANTAGE_EPSILON
          ? -1.5
          : -3.0 * selfAboveBlast;
    // 爆心が相手の足元と同じ高さに近いほど高評価
    const blastAlignBonus = 2.0 - Math.abs(blastY - targetGroundY) * 1.5;
    refined.push({
      ...candidate,
      score: Number(candidate.score ?? 0) + elevationBonus + blastAlignBonus,
      elevationBonus,
    });
  }
  if (refined.length === 0) {
    // 高さ条件を満たす土台が一つも無い場合は、
    // 元候補のうち最も爆心が低いものだけを残す(高い土台を掴んで自滅するのを防ぐ)。
    const fallback = [...candidates]
      .sort((a, b) => a.location.y - b.location.y)
      .slice(0, 1)
      .filter((candidate) => {
        const blastY =
          comboType === "anchor"
            ? candidate.location.y
            : candidate.location.y + 1;
        // それでも相手の頭より完全に上ならば撃たない
        return blastY <= targetGroundY + 2;
      });
    debugLog(
      bot,
      config,
      "scan",
      `${comboType}候補: 高さ条件を満たす土台なし (targetGroundY=${targetGroundY} fallback=${fallback.length})`,
    );
    return fallback;
  }
  refined.sort((a, b) => b.score - a.score);
  debugLog(
    bot,
    config,
    "scan",
    `${comboType}候補(高さ補正後)=${refined.length} bestY=${refined[0].location.y} targetGroundY=${targetGroundY} botGroundY=${botGroundY}`,
  );
  return refined;
}

const elevBaseScanCrystalCandidates = scanCrystalCandidates;
scanCrystalCandidates = function (bot, target, config) {
  return elevRefineCandidates(
    bot,
    target,
    config,
    elevBaseScanCrystalCandidates(bot, target, config),
    "crystal",
  );
};

const elevBaseScanAnchorCandidates = scanAnchorCandidates;
scanAnchorCandidates = function (bot, target, config) {
  return elevRefineCandidates(
    bot,
    target,
    config,
    elevBaseScanAnchorCandidates(bot, target, config),
    "anchor",
  );
};
system.run(() => {
  try {
    loadDebugLogBuffer();
    loadConfigs();
    loadGlobalSettings();
    logSystem("PvPBot startup complete");
    startBotLoop();
    system.runTimeout(() => {
      for (const player of getAllPlayers()) {
        if (introShown.has(player.name)) {
          continue;
        }
        introShown.add(player.name);
        player.sendMessage(getIntroMessage());
      }
    }, 10);
  } catch (error) {
    console.warn(`[PvPBot] boot failed: ${formatError(error)}`);
  }
});