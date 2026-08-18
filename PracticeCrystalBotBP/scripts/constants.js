import * as mc from "@minecraft/server";

export const BlockPermutation = mc.BlockPermutation;
export const CommandPermissionLevel = mc.CommandPermissionLevel ?? { Any: 0 };
export const CustomCommandStatus = mc.CustomCommandStatus ?? { Success: 0, Failure: 1 };
export const CustomCommandParamType = mc.CustomCommandParamType;
export const EnchantmentTypes = mc.EnchantmentTypes;
export const EntityComponentTypes = mc.EntityComponentTypes ?? {
  Inventory: "inventory",
  Equippable: "equippable",
  Health: "health",
};
export const GameMode = mc.GameMode ?? {
  Survival: "survival",
  Creative: "creative",
  Adventure: "adventure",
  Spectator: "spectator",
};
export const EquipmentSlot = mc.EquipmentSlot ?? {
  Mainhand: "mainhand",
  Offhand: "offhand",
  Head: "head",
  Chest: "chest",
  Legs: "legs",
  Feet: "feet",
  Body: "body",
};
export const ItemStack = mc.ItemStack;
export const system = mc.system;
export const world = mc.world;

export const BOT_TYPE = "pvpbot:crystal_bot";
export const CONFIG_PROPERTY_ID = "pvpbot:configs";
export const GLOBAL_SETTINGS_PROPERTY_ID = "pvpbot:global_settings";
export const DEBUG_LOG_PROPERTY_ID = "pvpbot:debuglog";
export const BOT_UID_TAG_PREFIX = "pvpbot.uid:";
export const BOT_CONFIG_TAG_PREFIX = "pvpbot.cfg:";
export const BOT_READY_TAG = "pvpbot.ready";
export const ADDON_VERSION = "1.4.00";

export const OBSIDIAN_ID = "minecraft:obsidian";
export const END_CRYSTAL_ID = "minecraft:end_crystal";
export const END_CRYSTAL_ENTITY_ID = "minecraft:ender_crystal";
export const ENDER_PEARL_ID = "minecraft:ender_pearl";
export const TOTEM_ID = "minecraft:totem_of_undying";
export const RESPAWN_ANCHOR_ID = "minecraft:respawn_anchor";
export const GLOWSTONE_ID = "minecraft:glowstone";
export const AIR_ID = "minecraft:air";
export const FIRE_ID = "minecraft:fire";

export const PATCH_CRYSTAL_TYPE_IDS = new Set([
  END_CRYSTAL_ENTITY_ID,
  END_CRYSTAL_ID,
  "ender_crystal",
  "end_crystal",
]);

export const MAX_TARGET_DISTANCE = 128;
export const MAX_INTERACT_DISTANCE = 4.5;
export const SWORD_RANGE = 3.5;
export const CRYSTAL_SCAN_MIN = 0.7;
export const CRYSTAL_SCAN_MAX = 1.5;
export const PEARL_PREDICTION_TICKS = 6;
export const PEARL_VISUAL_DELAY = 4;
export const STRAFE_FLIP_INTERVAL = 14;
export const BOT_SPAWN_GRACE_TICKS = 20;
export const CRYSTAL_POWER = 6;
export const ANCHOR_POWER = 5.0;
export const CRYSTAL_DAMAGE_SCORE_RADIUS = 6;
export const ANCHOR_DAMAGE_SCORE_RADIUS = 5.25;
export const COMBAT_PLACEMENT_ENTITY_RADIUS = 0.78;
export const COMBAT_PLACEMENT_ENTITY_HEIGHT = 1.9;
export const RESPAWN_ANCHOR_CHARGE_STATE = "respawn_anchor_charge";
export const RESPAWN_ANCHOR_MAX_CHARGE = 4;
export const DEBUG_LOG_LIMIT = 120;

export const DEBUG_THROTTLE = {
  movement: 10,
  scan: 6,
  combat: 0,
  health: 0,
  totem: 0,
  loadout: 0,
  inventory: 0,
};

export const PATCH_GOLDEN_APPLE_ID = "minecraft:golden_apple";
export const PATCH_ENCHANTED_GOLDEN_APPLE_ID = "minecraft:enchanted_golden_apple";
export const PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE = 6.25;
export const PATCH_ARMOR_EFFECT_REFRESH_TICKS = 6;
export const PATCH_FOOD_REEQUIP_DELAY = 8;
export const PATCH_FOOD_REUSE_BUFFER_TICKS = 20;
export const PATCH_FOOD_USE_COOLDOWN_TICKS = 16;
export const PATCH_SUPPLY_CHEST_VIEW_DISTANCE = 8;
export const PATCH_JUMP_DASH_COOLDOWN_TICKS = 5;
export const PATCH_JUMP_DASH_AIRBORNE_TICKS = 4;
export const PATCH_JUMP_DASH_VERTICAL_IMPULSE = 0.4;
export const PATCH_JUMP_DASH_FORWARD_BONUS = 0.18;
export const PATCH_JUMP_DASH_MIN_DIRECTION = 0.025;
export const PATCH_STUCK_ESCAPE_TICKS = 60;
export const PATCH_ESCAPE_TELEPORT_COOLDOWN = 40;
export const PATCH_ANCHOR_NATIVE_BREAK_CHECK_RADIUS = 4.75;
export const PATCH_ANCHOR_NATIVE_BREAK_MIN_CHANGED_BLOCKS = 1;
export const PATCH_ANCHOR_FORCE_FALLBACK = false;
export const PATCH_ANCHOR_BLOCK_BREAK_RADIUS = 11.0;
export const PATCH_ANCHOR_FIRE_PLACE_CHANCE = 0.3;
export const PATCH_CRYSTAL_BLOCK_BREAK_RADIUS = 5.75;
export const PATCH_CRYSTAL_NATIVE_BREAK_CHECK_RADIUS = 6.25;
export const PATCH_CRYSTAL_NATIVE_BREAK_MIN_CHANGED_BLOCKS = 1;
export const PATCH_CRYSTAL_FORCE_FALLBACK_BREAK = false;
export const PATCH_VISUAL_EQUIPMENT_SELECTOR_RADIUS = 0.8;
export const PATCH_VISUAL_EQUIPMENT_RESYNC_TICKS = 6;
export const PATCH_TOTEM_POP_HEALTH_THRESHOLD = 4.5;
export const PATCH_TOTEM_POP_HEALTH_RATIO = 0.22;
export const PATCH_TOTEM_POP_COOLDOWN_TICKS = 8;
export const PATCH_TOTEM_DAMAGE_IMMUNITY_TICKS = 10;
export const PATCH_TOTEM_DAMAGE_BUFFER = 1.25;
export const PATCH_TOTEM_REVIVE_HEALTH = 2;
export const PATCH_TOTEM_REGEN_TICKS = 900;
export const PATCH_TOTEM_ABSORPTION_TICKS = 100;
export const PATCH_TOTEM_FIRE_RESISTANCE_TICKS = 800;
export const PATCH_TOTEM_EMERGENCY_RESISTANCE_TICKS = 18;
export const PATCH_TOTEM_NOTIFICATION_RADIUS = 20;
export const PATCH_TOTEM_VISUAL_HOLD_TICKS = 7;
export const PATCH_TOTEM_NAMETAG_FLASH_TICKS = 24;

export function getIntroMessage() {
  return `§5[Crystal PvP Bot] v${ADDON_VERSION}`;
}

export const SWORD_STATS = {
  "minecraft:netherite_sword": { score: 6, damage: 8 },
  "minecraft:diamond_sword": { score: 5, damage: 7 },
  "minecraft:iron_sword": { score: 4, damage: 6 },
  "minecraft:stone_sword": { score: 3, damage: 5 },
  "minecraft:golden_sword": { score: 2, damage: 4 },
  "minecraft:wooden_sword": { score: 1, damage: 4 },
};

export const PICKAXE_STATS = {
  "minecraft:netherite_pickaxe": { score: 6, speed: 9 },
  "minecraft:diamond_pickaxe": { score: 5, speed: 8 },
  "minecraft:iron_pickaxe": { score: 4, speed: 6 },
  "minecraft:stone_pickaxe": { score: 3, speed: 4 },
  "minecraft:golden_pickaxe": { score: 2, speed: 12 },
  "minecraft:wooden_pickaxe": { score: 1, speed: 2 },
};

export const BOT_ARMOR = [
  { slot: EquipmentSlot.Head, itemId: "minecraft:netherite_helmet" },
  { slot: EquipmentSlot.Chest, itemId: "minecraft:netherite_chestplate" },
  { slot: EquipmentSlot.Legs, itemId: "minecraft:netherite_leggings" },
  { slot: EquipmentSlot.Feet, itemId: "minecraft:netherite_boots" },
];

export const BOT_SWORD_ENCHANTMENTS = [
  { id: "minecraft:sharpness", level: 5 },
  { id: "minecraft:knockback", level: 1 },
  { id: "minecraft:unbreaking", level: 3 },
];

export const BOT_ARMOR_ENCHANTMENTS = {
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

export const CRYSTAL_OFFSETS = [
  { x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 },
  { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: -1, z: -1 },
  { x: 2, z: 1 }, { x: 2, z: -1 }, { x: -2, z: 1 }, { x: -2, z: -1 },
];

// Lazy-initialized explosion ray directions for faster startup
let _explosionRayDirections = null;
export function getExplosionRayDirections() {
  if (_explosionRayDirections) return _explosionRayDirections;
  const step = 0.3;
  const dirs = [];
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        if (!(x === 0 || x === 15 || y === 0 || y === 15 || z === 0 || z === 15)) continue;
        let dx = (x / 15.0) * 2.0 - 1.0;
        let dy = (y / 15.0) * 2.0 - 1.0;
        let dz = (z / 15.0) * 2.0 - 1.0;
        const len = Math.hypot(dx, dy, dz);
        dirs.push({ dx: (dx / len) * step, dy: (dy / len) * step, dz: (dz / len) * step });
      }
    }
  }
  _explosionRayDirections = dirs;
  return dirs;
}

// Lazy-initialized anchor break offsets cache pool
let _anchorBreakOffsetsCachePool = null;
export function getAnchorBreakOffsetsCachePool() {
  if (_anchorBreakOffsetsCachePool) return _anchorBreakOffsetsCachePool;
  const maxRadiusSq = 11.0 * 11.0;
  const poolSize = 5;
  const pool = [];
  const rayDirs = getExplosionRayDirections();
  for (let i = 0; i < poolSize; i++) {
    const affected = new Map();
    for (const { dx, dy, dz } of rayDirs) {
      let strength = ANCHOR_POWER * (0.7 + Math.random() * 0.6);
      let cx = 0, cy = 0, cz = 0;
      while (strength > 0) {
        const lx = Math.floor(cx), ly = Math.floor(cy), lz = Math.floor(cz);
        const distSq = (lx + 0.5) ** 2 + (ly + 0.5) ** 2 + (lz + 0.5) ** 2;
        if (distSq > maxRadiusSq) break;
        const key = `${lx}|${ly}|${lz}`;
        if (!affected.has(key)) affected.set(key, { x: lx, y: ly, z: lz });
        strength -= (0.5 + 0.3) * 0.3;
        strength -= 0.225;
        cx += dx; cy += dy; cz += dz;
      }
    }
    pool.push([...affected.values()]);
  }
  _anchorBreakOffsetsCachePool = pool;
  return pool;
}

export const PATCH_MANAGED_STACK_ITEM_IDS = [
  OBSIDIAN_ID, END_CRYSTAL_ID, RESPAWN_ANCHOR_ID, GLOWSTONE_ID,
  ENDER_PEARL_ID, TOTEM_ID, PATCH_ENCHANTED_GOLDEN_APPLE_ID,
  PATCH_GOLDEN_APPLE_ID, "minecraft:cobblestone", "minecraft:dirt", "minecraft:stone",
  "minecraft:diamond_pickaxe",
];

export const PATCH_DEFAULT_COMBAT_ITEM_COUNTS = {
  [OBSIDIAN_ID]: 64, [END_CRYSTAL_ID]: 64, [RESPAWN_ANCHOR_ID]: 32,
  [GLOWSTONE_ID]: 64, [ENDER_PEARL_ID]: 16,
  [PATCH_ENCHANTED_GOLDEN_APPLE_ID]: 8, [PATCH_GOLDEN_APPLE_ID]: 16,
  [TOTEM_ID]: 8, ["minecraft:cobblestone"]: 64,
  ["minecraft:dirt"]: 64, ["minecraft:stone"]: 64,
  "minecraft:diamond_pickaxe": 1,
};

export const PATCH_ARMOR_MATERIAL_SCORES = {
  netherite: 60, diamond: 50, iron: 40, chainmail: 30,
  golden: 20, leather: 10, turtle: 35,
};

export const PATCH_ARMOR_DEFENSE_VALUES = {
  "minecraft:leather_helmet": 1, "minecraft:golden_helmet": 2,
  "minecraft:chainmail_helmet": 2, "minecraft:iron_helmet": 2,
  "minecraft:diamond_helmet": 3, "minecraft:netherite_helmet": 3,
  "minecraft:turtle_helmet": 2, "minecraft:leather_chestplate": 3,
  "minecraft:golden_chestplate": 5, "minecraft:chainmail_chestplate": 5,
  "minecraft:iron_chestplate": 6, "minecraft:diamond_chestplate": 8,
  "minecraft:netherite_chestplate": 8, "minecraft:leather_leggings": 2,
  "minecraft:golden_leggings": 3, "minecraft:chainmail_leggings": 4,
  "minecraft:iron_leggings": 5, "minecraft:diamond_leggings": 6,
  "minecraft:netherite_leggings": 6, "minecraft:leather_boots": 1,
  "minecraft:golden_boots": 1, "minecraft:chainmail_boots": 1,
  "minecraft:iron_boots": 2, "minecraft:diamond_boots": 3,
  "minecraft:netherite_boots": 3,
};

export const PATCH_EXPLOSION_PRESERVE_IDS = new Set([
  AIR_ID, OBSIDIAN_ID, "minecraft:crying_obsidian", "minecraft:bedrock",
  "minecraft:respawn_anchor", "minecraft:reinforced_deepslate",
  "minecraft:barrier", "minecraft:end_portal_frame", "minecraft:end_portal",
]);

export const PATCH_DIFFICULTY_PRESETS = {
  easy: {
    maintainDistance: 4, pearlDistance: 14, pearlCooldown: 60,
    swordCooldown: 18, crystalCooldown: 20, crystalDetonateDelay: 5,
    anchorCooldown: 22, anchorDetonateDelay: 4,
    targetMobs: true, targetBots: true, autoTotem: true,
  },
  normal: {
    maintainDistance: 3, pearlDistance: 10, pearlCooldown: 40,
    swordCooldown: 15, crystalCooldown: 15, crystalDetonateDelay: 3,
    anchorCooldown: 15, anchorDetonateDelay: 3,
    targetMobs: true, targetBots: true, autoTotem: true,
  },
  hard: {
    maintainDistance: 2, pearlDistance: 8, pearlCooldown: 20,
    swordCooldown: 0, crystalCooldown: 0, crystalDetonateDelay: 0,
    anchorCooldown: 0, anchorDetonateDelay: 0, totemRefillDelay: 0,
    reactionDelay: 0, jumpDash: true, pearlRecover: false,
    targetMobs: true, targetBots: true, autoTotem: true,
  },
};

export const PATCH_VISUAL_SLOT_BY_EQUIPMENT = new Map([
  [EquipmentSlot.Mainhand, "slot.weapon.mainhand"],
  [EquipmentSlot.Offhand, "slot.weapon.offhand"],
  [EquipmentSlot.Head, "slot.armor.head"],
  [EquipmentSlot.Chest, "slot.armor.chest"],
  [EquipmentSlot.Legs, "slot.armor.legs"],
  [EquipmentSlot.Feet, "slot.armor.feet"],
]);
