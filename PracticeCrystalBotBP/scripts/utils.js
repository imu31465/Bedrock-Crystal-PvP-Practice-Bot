import {
  world, system, EntityComponentTypes, EquipmentSlot, GameMode,
  BlockPermutation, EnchantmentTypes, ItemStack,
  BOT_TYPE, BOT_UID_TAG_PREFIX, BOT_CONFIG_TAG_PREFIX, AIR_ID,
  OBSIDIAN_ID, RESPAWN_ANCHOR_ID, RESPAWN_ANCHOR_CHARGE_STATE,
  RESPAWN_ANCHOR_MAX_CHARGE, PATCH_CRYSTAL_TYPE_IDS,
  DEBUG_LOG_LIMIT, DEBUG_THROTTLE, SWORD_STATS,
  BOT_ARMOR, BOT_ARMOR_ENCHANTMENTS, PATCH_ARMOR_DEFENSE_VALUES,
  PATCH_ARMOR_MATERIAL_SCORES, DEBUG_LOG_PROPERTY_ID,
} from "./constants.js";
import {
  botConfigs, runtimeState, trackedBots, trackedBotMetaById,
  trackedBotIdByUid, blockCache, entityCache, globalTick, globalSettings,
  pendingSpawnRequests, debugLogBuffer, debugLogDirty,
  setDebugLogBuffer, setDebugLogDirty,
} from "./state.js";
import { normalizeGlobalSettings } from "./config.js";

// ── Vector Math ──
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
export function distanceSquared(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
export function vectorTo(from, to) {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}
export function addVector(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function normalize2D(v) {
  const len = Math.hypot(v.x, v.z);
  return len < 0.0001 ? { x: 0, y: 0, z: 0 } : { x: v.x / len, y: 0, z: v.z / len };
}
export function floorLocation(loc) {
  return { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
}
export function quoteCoord(v) {
  return `${Number(v).toFixed(2)}`;
}

// ── Block Helpers ──
export function getBlock(dimension, location) {
  const key = `${dimension.id}|${Math.floor(location.x)}|${Math.floor(location.y)}|${Math.floor(location.z)}`;
  if (blockCache.has(key)) return blockCache.get(key);
  try {
    const block = dimension.getBlock(location);
    blockCache.set(key, block);
    return block;
  } catch {
    return undefined;
  }
}
export function isAirBlock(block) {
  return !block || block.typeId === AIR_ID || block.isAir;
}
export function isSolidBlock(block) {
  if (!block || block.isAir || block.isLiquid) return false;
  const typeId = block.typeId;
  if (!typeId || typeId === AIR_ID || typeId === "minecraft:fire" || typeId === "minecraft:soul_fire") return false;
  if (typeId.includes("button") || typeId.includes("sign") || typeId.includes("torch") ||
      typeId.includes("carpet") || typeId.includes("flower") || typeId.includes("pressure_plate") ||
      typeId.includes("rail") || typeId === "minecraft:snow_layer" || typeId.includes("web")) return false;
  return true;
}
export function isCrystalBaseBlock(block) {
  if (!block) return false;
  return block.typeId === OBSIDIAN_ID || block.typeId === "minecraft:bedrock" ||
         block.typeId === "minecraft:crying_obsidian";
}
export function isRespawnAnchorBlock(block) {
  return block?.typeId === RESPAWN_ANCHOR_ID;
}
export function resolveRespawnAnchorPermutation(charge) {
  const c = Math.max(0, Math.min(RESPAWN_ANCHOR_MAX_CHARGE, Math.floor(charge)));
  return BlockPermutation.resolve(RESPAWN_ANCHOR_ID, { [RESPAWN_ANCHOR_CHARGE_STATE]: c });
}
export function isSafeStandingLocation(dimension, location) {
  const feetBlock = getBlock(dimension, location);
  const headBlock = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  const belowBlock = getBlock(dimension, addVector(location, { x: 0, y: -1, z: 0 }));
  return isAirBlock(feetBlock) && isAirBlock(headBlock) && isSolidBlock(belowBlock);
}
export function canOccupyLocation(dimension, location) {
  const feetBlock = getBlock(dimension, location);
  const headBlock = getBlock(dimension, addVector(location, { x: 0, y: 1, z: 0 }));
  return isAirBlock(feetBlock) && isAirBlock(headBlock);
}
export function findNearestStandingLocation(dimension, location, yOffsets) {
  const gs = normalizeGlobalSettings(globalSettings || {});
  const offsets = yOffsets ?? [0, -1, 1, -2, 2];
  for (const yOffset of offsets) {
    const candidate = addVector(location, { x: 0, y: yOffset, z: 0 });
    if (gs.boundaryEnabled && !isLocationInsideBotBoundary(candidate)) continue;
    if (isSafeStandingLocation(dimension, candidate)) return candidate;
  }
  return undefined;
}
export function patchSnapToBlockCenter(location) {
  return {
    x: Math.floor(location.x) + 0.5,
    y: location.y,
    z: Math.floor(location.z) + 0.5,
  };
}

// ── Player & Entity Helpers ──
export function getAllPlayers() {
  try { return world.getAllPlayers(); } catch { return []; }
}
export function getPlayerByName(name) {
  return getAllPlayers().find(p => p.name === name);
}
export function getPlayersInDimension(dimension) {
  return getAllPlayers().filter(p => p.dimension?.id === dimension?.id);
}
export function isLocationOccupiedByPlayer(dimension, location) {
  return getPlayersInDimension(dimension).some(
    p => distanceSquared(p.location, location) < 1.44
  );
}
export function isEntityUsable(entity, typeId) {
  try {
    if (!entity?.id) return false;
    if (typeId && entity.typeId !== typeId) return false;
    const _ = entity.location;
    return true;
  } catch { return false; }
}
export function getEquippableComponent(entity) {
  try {
    return entity?.getComponent?.(EntityComponentTypes.Equippable ?? "equippable");
  } catch { return undefined; }
}

// ── Bot Registry ──
export function getBotUid(entity) {
  if (!entity) return "";
  try {
    for (const tag of entity.getTags()) {
      if (tag.startsWith(BOT_UID_TAG_PREFIX)) return tag.slice(BOT_UID_TAG_PREFIX.length);
    }
  } catch {}
  return "";
}
export function getAllBots() {
  const bots = [];
  for (const dim of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      const d = world.getDimension(dim);
      for (const e of d.getEntities({ type: BOT_TYPE })) {
        if (isEntityUsable(e, BOT_TYPE)) bots.push(e);
      }
    } catch {}
  }
  return bots;
}
export function getNearbyBots(player, maxDistance = 64) {
  return getAllBots()
    .filter(b => b.dimension.id === player.dimension.id && distance(b.location, player.location) <= maxDistance)
    .sort((a, b) => distance(a.location, player.location) - distance(b.location, player.location));
}
export function trackBot(entity) {
  if (!entity?.id) return;
  trackedBots.set(entity.id, entity);
  const uid = getBotUid(entity);
  if (uid) trackedBotIdByUid.set(uid, entity.id);
}
export function untrackBot(entity) {
  if (!entity?.id) return;
  trackedBots.delete(entity.id);
  const uid = getBotUid(entity);
  if (uid) trackedBotIdByUid.delete(uid);
}
export function updateTrackedBotMeta(entity, extra) {
  if (!entity?.id) return undefined;
  const meta = {
    ...(trackedBotMetaById.get(entity.id) ?? {}),
    lastSeenTick: globalTick,
    ...extra,
  };
  try {
    meta.location = { ...entity.location };
    meta.dimensionId = entity.dimension.id;
  } catch {}
  trackedBotMetaById.set(entity.id, meta);
  return meta;
}
export function getBotLabel(bot) {
  try {
    const uid = getBotUid(bot);
    const config = uid ? botConfigs[uid] : undefined;
    return bot.nameTag || config?.displayName || (uid ? `Crystal Bot BOT-${uid.slice(-6).toUpperCase()}` : "Crystal Bot");
  } catch { return "Crystal Bot"; }
}
export function shortId(id) {
  return `${id ?? ""}`.slice(0, 8);
}

// ── Boundary ──
export function isLocationInsideBotBoundary(location) {
  const s = normalizeGlobalSettings(globalSettings || {});
  if (!s.boundaryEnabled) return true;
  const minX = s.boundaryMinX - 0.5;
  const maxX = s.boundaryMaxX + 0.5;
  const minZ = s.boundaryMinZ - 0.5;
  const maxZ = s.boundaryMaxZ + 0.5;
  return location.x >= minX && location.x <= maxX &&
         location.z >= minZ && location.z <= maxZ;
}

// ── Target Finding ──
export function findClosestPlayer(location, dimension, maxDist = 16, insideBoundaryOnly = false) {
  let closest, best = maxDist;
  for (const p of getPlayersInDimension(dimension)) {
    try {
      const gm = p.getGameMode?.();
      if (gm && gm !== GameMode.Survival && gm !== GameMode.Adventure) continue;
    } catch {}
    if (insideBoundaryOnly && !isLocationInsideBotBoundary(p.location)) continue;
    const d = distance(location, p.location);
    if (d < best) { closest = p; best = d; }
  }
  return closest;
}
export function findNearestTarget(bot) {
  const uid = getBotUid(bot);
  const config = botConfigs[uid];
  const range = config?.targetRange ?? 16;
  const dimId = bot.dimension.id;

  // Start with nearest valid player (arena boundary only)
  let closest = findClosestPlayer(bot.location, bot.dimension, range, true);
  let best = closest ? distance(bot.location, closest.location) : range;

  if (config?.targetMobs || config?.targetBots) {
    try {
      // 1. Check other tracked bots directly (no API call needed)
      if (config.targetBots) {
        for (const otherBot of trackedBots.values()) {
          if (otherBot.id === bot.id || otherBot.dimension.id !== dimId || !isEntityUsable(otherBot)) continue;
          if (!isLocationInsideBotBoundary(otherBot.location)) continue;
          const currentHealth = patchGetCurrentHealthValue(otherBot);
          if (currentHealth <= 0) continue;
          
          const d = distance(bot.location, otherBot.location);
          if (d < best) {
            best = d;
            closest = otherBot;
          }
        }
      }

      // 2. Check mobs via cached dimension search
      if (config.targetMobs) {
        let cachedMobs = entityCache.get(dimId);
        if (!cachedMobs) {
          // Fetch all non-player, non-bot, non-item entities in the dimension
          cachedMobs = bot.dimension.getEntities({ excludeTypes: ["minecraft:player", "minecraft:item", "minecraft:xp_orb", BOT_TYPE] });
          entityCache.set(dimId, cachedMobs);
        }

        for (const e of cachedMobs) {
          if (e.id === bot.id || !isEntityUsable(e)) continue;
          if (!isLocationInsideBotBoundary(e.location)) continue;
          
          const d = distance(bot.location, e.location);
          if (d >= best) continue;

          // Exclude certain entities from being targeted
          if (e.typeId.includes("projectile") || e.typeId.includes("crystal") || 
              e.typeId.includes("tnt") || e.typeId.includes("falling_block") ||
              e.typeId.includes("xp_orb") || e.typeId.includes("item") || e.typeId.includes("arrow")) continue;

          const hp = patchGetCurrentHealthValue(e);
          if (hp !== undefined && hp <= 0) continue;

          best = d;
          closest = e;
        }
      }
    } catch {}
  }

  return closest;
}

// ── Enchantment Helpers ──
export function patchResolveEnchantmentType(id) {
  const candidates = [id, id.replace(/^minecraft:/, ""), `minecraft:${id.replace(/^minecraft:/, "")}`];
  for (const cid of candidates) {
    try {
      const type = EnchantmentTypes?.get?.(cid);
      if (type) return type;
    } catch {}
  }
  return undefined;
}
export function patchGetEnchantmentLevel(item, enchantmentId) {
  if (!item || typeof item.getComponent !== "function") return 0;
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.getEnchantments !== "function") return 0;
    for (const e of enchantable.getEnchantments()) {
      const typeId = typeof e.type === "string" ? e.type : e.type?.id;
      if (!typeId) continue;
      const normalized = typeId.replace(/^minecraft:/, "");
      if (normalized === enchantmentId.replace(/^minecraft:/, "")) return e.level ?? 0;
    }
  } catch {}
  return 0;
}
export function patchGetItemEnchantments(item) {
  if (!item || typeof item.getComponent !== "function") return [];
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.getEnchantments !== "function") return [];
    return enchantable.getEnchantments().map(e => {
      const typeId = typeof e.type === "string" ? e.type : (e.type?.id ?? "");
      return { id: typeId, level: e.level ?? 0 };
    });
  } catch { return []; }
}
export function patchCopyItemMetadata(source, target) {
  if (!source || !target) return target;
  try {
    const enchants = patchGetItemEnchantments(source);
    if (enchants.length) {
      const enchantable = target.getComponent?.("minecraft:enchantable");
      if (enchantable && typeof enchantable.addEnchantments === "function") {
        const prepared = enchants.map(e => {
          const type = patchResolveEnchantmentType(e.id);
          return type ? { type, level: e.level } : undefined;
        }).filter(Boolean);
        if (prepared.length) enchantable.addEnchantments(prepared);
      }
    }
  } catch {}
  return target;
}
export function patchCloneItemStackWithAmount(item, amount) {
  try { const c = item.clone(); c.amount = amount; return c; } catch {}
  const cloned = new ItemStack(item.typeId, amount);
  return patchCopyItemMetadata(item, cloned);
}

// ── Armor Helpers ──
export function patchGetArmorDefenseValue(item) {
  return Number(PATCH_ARMOR_DEFENSE_VALUES[item?.typeId] ?? 0);
}
export function patchGetArmorSlotForItem(item) {
  const typeId = item?.typeId ?? "";
  if (typeId.includes("helmet") || typeId.includes("turtle")) return EquipmentSlot.Head;
  if (typeId.includes("chestplate") || typeId.includes("elytra")) return EquipmentSlot.Chest;
  if (typeId.includes("leggings")) return EquipmentSlot.Legs;
  if (typeId.includes("boots")) return EquipmentSlot.Feet;
  return undefined;
}
export function patchGetArmorSelectionScore(item) {
  const typeId = item?.typeId ?? "";
  let materialScore = 0;
  for (const [material, score] of Object.entries(PATCH_ARMOR_MATERIAL_SCORES)) {
    if (typeId.includes(material)) { materialScore = score; break; }
  }
  const protection = patchGetEnchantmentLevel(item, "protection");
  const blastProtection = patchGetEnchantmentLevel(item, "blast_protection");
  return materialScore * 100 + protection * 10 + blastProtection * 8 + patchGetArmorDefenseValue(item);
}
export function buildFallbackArmor(slot) {
  const armor = BOT_ARMOR.find(a => a.slot === slot);
  if (!armor) return undefined;
  return applyEnchantments(new ItemStack(armor.itemId, 1), BOT_ARMOR_ENCHANTMENTS[slot] ?? []);
}
export function applyEnchantments(item, enchantments = []) {
  if (!enchantments.length || typeof item?.getComponent !== "function") return item;
  try {
    const enchantable = item.getComponent("minecraft:enchantable");
    if (!enchantable || typeof enchantable.addEnchantments !== "function") return item;
    const prepared = enchantments.map(entry => {
      const type = patchResolveEnchantmentType(entry.id);
      return type ? { type, level: entry.level } : undefined;
    }).filter(Boolean);
    if (prepared.length) enchantable.addEnchantments(prepared);
  } catch {}
  return item;
}
export function cloneItemStack(item, fallbackTypeId = AIR_ID, fallbackAmount = 1) {
  if (item?.clone) {
    try { return item.clone(); } catch {}
  }
  const cloned = new ItemStack(item?.typeId ?? fallbackTypeId, item?.amount ?? fallbackAmount);
  return patchCopyItemMetadata(item, cloned);
}

// ── Dimension Helpers ──
export function toDimensionKey(dimensionId) {
  switch (dimensionId) {
    case "minecraft:overworld": return "overworld";
    case "minecraft:nether": return "nether";
    case "minecraft:the_end": return "the_end";
    default: return dimensionId ?? "";
  }
}
export function fromDimensionKey(key) {
  switch (key) {
    case "overworld": return "minecraft:overworld";
    case "nether": return "minecraft:nether";
    case "the_end": return "minecraft:the_end";
    default: return key ?? undefined;
  }
}
export function getExplosionLocation(baseLocation, comboType) {
  return comboType === "anchor"
    ? { x: baseLocation.x + 0.5, y: baseLocation.y + 0.5, z: baseLocation.z + 0.5 }
    : { x: baseLocation.x + 0.5, y: baseLocation.y + 1, z: baseLocation.z + 0.5 };
}

// ── Spawn Helpers ──
export function getSpawnLocationNear(player) {
  const base = floorLocation(player.location);
  const offsets = [
    { x: 2, z: 0 }, { x: -2, z: 0 }, { x: 0, z: 2 }, { x: 0, z: -2 },
    { x: 2, z: 2 }, { x: -2, z: 2 }, { x: 2, z: -2 }, { x: -2, z: -2 },
    { x: 3, z: 0 }, { x: -3, z: 0 }, { x: 0, z: 3 }, { x: 0, z: -3 },
    { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
  ];
  for (const offset of offsets) {
    for (const yOffset of [0, 1, -1, 2, -2]) {
      const candidate = { x: base.x + offset.x + 0.5, y: base.y + yOffset, z: base.z + offset.z + 0.5 };
      if (isSafeStandingLocation(player.dimension, candidate)) return candidate;
    }
  }
  return addVector(player.location, { x: 2, y: 0, z: 0 });
}

// ── Crystal / Pearl Entity Lookup ──
export function patchGetNearbyCrystalEntities(dimension, location) {
  const radius = 2.5;
  const crystals = [];
  try {
    for (const entity of dimension.getEntities({
      location, maxDistance: radius
    })) {
      if (PATCH_CRYSTAL_TYPE_IDS.has(entity.typeId) && isEntityUsable(entity)) crystals.push(entity);
    }
  } catch {}
  return crystals;
}
export async function spawnEntityWithFallback(dimension, entityTypeId, location) {
  try {
    const spawned = dimension.spawnEntity(entityTypeId, location);
    return { entity: spawned, successCount: 1 };
  } catch {}
  const command = `summon ${entityTypeId} ${quoteCoord(location.x)} ${quoteCoord(location.y)} ${quoteCoord(location.z)}`;
  try {
    const result = await runDimensionCommand(dimension, command);
    return result;
  } catch { return { successCount: 0 }; }
}
export async function runDimensionCommand(dimension, command) {
  if (typeof dimension?.runCommandAsync === "function") return dimension.runCommandAsync(command);
  if (typeof dimension?.runCommand === "function") return Promise.resolve(dimension.runCommand(command));
  throw new Error(`Command execution unavailable: ${command}`);
}
export function patchRunDimensionCommandNoThrow(dimension, command) {
  try {
    const pending = runDimensionCommand(dimension, command);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {}
}

// ── DynamicProperty Helpers ──
export function safeGetDynamicProperty(key) {
  try { return world.getDynamicProperty(key); } catch { return undefined; }
}
export function safeSetDynamicProperty(key, value) {
  try { world.setDynamicProperty(key, value); return true; } catch { return false; }
}

// ── Health Helpers ──
export function patchGetCurrentHealthValue(entity) {
  const health = entity?.getComponent?.(EntityComponentTypes.Health);
  return Number(health?.currentValue ?? health?.value ?? 0);
}
export function patchGetMaxHealthValue(entity) {
  const health = entity?.getComponent?.(EntityComponentTypes.Health);
  return Number(health?.effectiveMax ?? health?.defaultValue ?? health?.value ?? 20);
}
export function setHealthValue(bot, value) {
  const health = bot?.getComponent?.(EntityComponentTypes.Health);
  if (!health) return;
  try {
    if (typeof health.setCurrentValue === "function") { health.setCurrentValue(value); return; }
    health.currentValue = value;
  } catch {}
}

// ── Debug & Logging ──
export function formatError(error) {
  if (!error) return "unknown";
  return error.message ?? `${error}`;
}
export function logSystem(message) {
  console.warn(`[PvPBot] ${message}`);
}
export function logBotEvent(bot, message) {
  const uid = getBotUid(bot);
  const label = getBotLabel(bot);
  console.warn(`[PvPBot] [${uid ? shortId(uid) : "?"}] ${label}: ${message}`);
}

let debugLastTickByCategory = {};
export function debugLog(bot, config, category, message, force = false) {
  if (!config?.debug?.enabled || !config.debug[category]) return;
  const owner = getPlayerByName(config.ownerName);
  if (!owner) return;
  const uid = config.uid;
  let runtime = runtimeState.get(uid);
  if (!runtime) { runtime = {}; runtimeState.set(uid, runtime); }
  if (!runtime.debugTickByCategory) runtime.debugTickByCategory = {};
  const throttle = DEBUG_THROTTLE[category] ?? 0;
  const lastTick = runtime.debugTickByCategory[category] ?? -9999;
  if (!force && throttle > 0 && globalTick - lastTick < throttle) return;
  runtime.debugTickByCategory[category] = globalTick;
  appendPersistentDebugLog(category, `${config.displayName || config.uid}: ${message}`);
  const DEBUG_CATEGORY_COLORS = {
    movement: "§b", scan: "§d", combat: "§c",
    health: "§6", totem: "§e", loadout: "§a", inventory: "§9",
  };
  const categoryColor = DEBUG_CATEGORY_COLORS[category] ?? "§7";
  owner.sendMessage(`${categoryColor}[PvPBot:${category}]§r §f${message}`);
}

export function appendPersistentDebugLog(category, message) {
  debugLogBuffer.push({ tick: globalTick, category, message, time: Date.now() });
  while (debugLogBuffer.length > DEBUG_LOG_LIMIT) debugLogBuffer.shift();
  setDebugLogDirty(true);
}
export function flushDebugLogIfDirty() {
  if (!debugLogDirty) return;
  setDebugLogDirty(false);
  saveDebugLogBuffer();
}
export function saveDebugLogBuffer() {
  try {
    safeSetDynamicProperty(DEBUG_LOG_PROPERTY_ID, JSON.stringify(debugLogBuffer.slice(-DEBUG_LOG_LIMIT)));
  } catch {}
}
export function loadDebugLogBuffer() {
  try {
    const raw = safeGetDynamicProperty(DEBUG_LOG_PROPERTY_ID);
    if (raw) setDebugLogBuffer(JSON.parse(raw));
  } catch {}
}
export function dumpPersistentDebugLog(player) {
  if (!debugLogBuffer.length) { player.sendMessage("§7[PvPBot] ログは空です。"); return; }
  for (const entry of debugLogBuffer.slice(-20)) {
    player.sendMessage(`§7[t${entry.tick}][${entry.category}] ${entry.message}`);
  }
}
export function clearPersistentDebugLog(player) {
  setDebugLogBuffer([]);
  saveDebugLogBuffer();
  player.sendMessage("§a[PvPBot] デバッグログを消去しました。");
}

// ── Formatting ──
export function formatLocation(loc) {
  if (!loc) return "?";
  return `(${Number(loc.x).toFixed(1)}, ${Number(loc.y).toFixed(1)}, ${Number(loc.z).toFixed(1)})`;
}
export function describeBlockContext(dimension, location) {
  try {
    const block = getBlock(dimension, location);
    const below = getBlock(dimension, addVector(location, { x: 0, y: -1, z: 0 }));
    return `block=${block?.typeId ?? "?"} below=${below?.typeId ?? "?"}`;
  } catch { return "block=? below=?"; }
}
export function summarizeNearbyPlayers(dimensionOrId, location, radius) {
  if (!location) return "0";
  try {
    const dimId = typeof dimensionOrId === "string" ? dimensionOrId : dimensionOrId?.id;
    return `${getAllPlayers().filter(p => p.dimension?.id === dimId && distance(p.location, location) <= radius).length}`;
  } catch { return "?"; }
}
export function summarizeNearbyBots(dimensionOrId, location, radius) {
  if (!location) return "0";
  try {
    const dimId = typeof dimensionOrId === "string" ? dimensionOrId : dimensionOrId?.id;
    return `${getAllBots().filter(b => b.dimension?.id === dimId && distance(b.location, location) <= radius).length}`;
  } catch { return "?"; }
}
export function describeTrackedBotMeta(meta) {
  if (!meta) return "meta=none";
  return `uid=${shortId(meta.uid)} loc=${formatLocation(meta.location)} dim=${meta.dimensionId ?? "?"}`;
}

// ── Bot Direction / Look ──
export function faceBotToward(bot, targetLocation) {
  try {
    bot.teleport(bot.location, {
      dimension: bot.dimension,
      facingLocation: targetLocation,
    });
  } catch {}
}
export function setBotLookAt(bot, targetLocation) {
  faceBotToward(bot, targetLocation);
}
export function tryPlayAnimation(bot, animationId) {
  try { bot.playAnimation?.(animationId); } catch {}
}

// ── Aim Jitter / Humanize ──
export function patchApplyAimJitter(location, config) {
  if (!config?.humanize || !config?.aimJitter) return location;
  const jitter = Number(config.aimJitter);
  return {
    x: location.x + (Math.random() - 0.5) * jitter * 2,
    y: location.y + (Math.random() - 0.5) * jitter * 1.5,
    z: location.z + (Math.random() - 0.5) * jitter * 2,
  };
}
export function patchShouldDelayAction(config, actionType) {
  if (!config?.humanize || !config?.reactionDelay) return false;
  const delay = Number(config.reactionDelay ?? 0);
  if (delay <= 0) return false;
  return Math.random() < delay / 20;
}
export function patchRandomChance(rate) {
  if (!rate || rate <= 0) return false;
  return Math.random() * 100 < rate;
}

// ── Misc ──
export function matchPendingSpawnRequest(entity) {
  for (let i = pendingSpawnRequests.length - 1; i >= 0; i--) {
    const req = pendingSpawnRequests[i];
    if (distance(entity.location, req.location) < 3 && entity.dimension.id === req.dimensionId) {
      pendingSpawnRequests.splice(i, 1);
      return req;
    }
  }
  return undefined;
}

export function patchIsCombatTargetUsable(target, dimension) {
  if (!target?.id) return false;
  if (!isEntityUsable(target)) return false;
  try {
    if (target.dimension.id !== dimension.id) return false;
  } catch { return false; }
  return true;
}
export function patchResolvePendingCombatTarget(bot, pending, runtime) {
  if (!pending?.targetId) return undefined;
  // Try world.getEntity first (available in newer API versions)
  try {
    if (typeof world.getEntity === "function") {
      const found = world.getEntity(pending.targetId);
      if (found && isEntityUsable(found)) return found;
    }
  } catch {}
  // Try dimension.getEntity
  try {
    if (typeof bot.dimension.getEntity === "function") {
      const found = bot.dimension.getEntity(pending.targetId);
      if (found && isEntityUsable(found)) return found;
    }
  } catch {}
  // Search players in bot's dimension
  try {
    for (const player of getPlayersInDimension(bot.dimension)) {
      if (player.id === pending.targetId) return player;
    }
  } catch {}
  // Search all nearby entities (mobs etc.)
  try {
    const entities = bot.dimension.getEntities({ location: bot.location, maxDistance: 128 });
    for (const e of entities) {
      if (e.id === pending.targetId && isEntityUsable(e)) return e;
    }
  } catch {}
  // Last resort: search without location filter (all entities in dimension)
  try {
    for (const e of bot.dimension.getEntities({})) {
      if (e.id === pending.targetId && isEntityUsable(e)) return e;
    }
  } catch {}
  return undefined;
}
export function countItemInContainer(container, itemId) {
  if (!container || !itemId) return 0;
  let count = 0;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId === itemId) count += (item.amount ?? 1);
  }
  return count;
}
export function isSpawnProtected(uid) {
  const runtime = runtimeState.get(uid);
  if (!runtime) return false;
  return globalTick - (runtime.spawnTick ?? -9999) < 20;
}
export function scheduleBotProbe(bot, source, uid) {
  // Probe scheduling is a no-op placeholder; actual probing is done via debug logs
  appendPersistentDebugLog("probe", `probe scheduled source=${source} uid=${shortId(uid)}`);
}
export function broadcastDeathMessage(bot, meta) {
  const label = getBotLabel(bot);
  for (const player of getAllPlayers()) {
    try { player.sendMessage(`§c${label} が倒れました。`); } catch {}
  }
}