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
export const ADDON_VERSION = "0.5.0";

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
// [A-6] 実体影響半径 = 2P（Wiki「Explosion」）。旧 6/5.25 は誤りだった推定半径。
// ダメージ推定は estimateExplosionDamage() が P から自動計算するため、
// 以下は参照値（キャリブレーション表示用）としてのみ使用する。
export const CRYSTAL_DAMAGE_SCORE_RADIUS = 12; // 2 * CRYSTAL_POWER
export const ANCHOR_DAMAGE_SCORE_RADIUS = 10;  // 2 * ANCHOR_POWER
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
// [F-4] 爆発系の設置・起爆干渉距離。旧 6.25 は実プレイヤーの設置リーチを超えていた
// （Botが届かない距離から起爆できる = パリティ違反）。Java版実測 ~4.5 を暫定上限とし、
// Bedrock実測値は A-7 キャリブレーション（pvpbot:chainstats 添付の検証手順参照）で確定する。
export const PATCH_MAX_EXPLOSIVE_INTERACT_DISTANCE = 4.5;
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

// ── Movement v2 (physics based smooth movement) ──
// 目標水平速度 (blocks/tick)。プレイヤーのスプリント ≈ 0.28
export const MOVE_SPEED_WALK = 0.132;
export const MOVE_SPEED_SPRINT = 0.235;
export const MOVE_SPEED_STRAFE = 0.155;
export const MOVE_SPEED_RETREAT = 0.19;
export const MOVE_SPEED_WATER = 0.09;
// 1tickで加えられる速度変化の上限。大きすぎると振動、小さすぎると鈍い
export const MOVE_MAX_ACCEL_GROUND = 0.085;
export const MOVE_MAX_ACCEL_AIR = 0.028;
export const MOVE_JUMP_IMPULSE = 0.44;
export const MOVE_JUMP_COOLDOWN_TICKS = 8;
export const MOVE_SPRINT_JUMP_BONUS = 0.055;
// 経路探索
export const NAV_REPATH_INTERVAL_TICKS = 10;
export const NAV_REPATH_FAIL_INTERVAL_TICKS = 24;
export const NAV_MAX_EXPANSIONS = 340;
export const NAV_MAX_PATH_DISTANCE = 48;
export const NAV_WAYPOINT_REACH_RADIUS = 0.62;
export const NAV_WAYPOINT_REACH_RADIUS_Y = 1.35;
export const NAV_PATH_MAX_AGE_TICKS = 60;
// スタック検知・脱出のエスカレーション段階
export const STUCK_DETECT_MOVE_EPSILON = 0.055;
export const STUCK_STAGE_JIGGLE_TICKS = 8;
export const STUCK_STAGE_DETOUR_TICKS = 16;
export const STUCK_STAGE_MINE_TICKS = 28;
export const STUCK_STAGE_PILLAR_TICKS = 44;
export const STUCK_STAGE_TELEPORT_TICKS = 80;
export const STUCK_DETOUR_HOLD_TICKS = 14;
// 人間らしい視線追従（度/tick）。大きいほど機械的に瞬間で向く
export const LOOK_TURN_SPEED_COMBAT = 42;
export const LOOK_TURN_SPEED_TRAVEL = 26;
// 位置戦術
// [B-7] CrystalPvPの実戦メタは「低位有利」(2b2t Wiki: gaining the lower ground)。
// 爆風は体の下面にのみ当たり上面には当たらないため、低い位置に立つ側が有利。
export const TACTIC_HIGH_GROUND_BONUS_Y = 2.0; // 旧名の互換定数（未使用）
export const TACTIC_LOW_GROUND_SEARCH_Y = 2.0;  // 相手足元から下へ探索する深さ
export const TACTIC_TARGET_ABOVE_THRESHOLD = 2.2;
export const TACTIC_TARGET_BELOW_THRESHOLD = 2.0;
export const TACTIC_PILLAR_MAX_HEIGHT = 8;
export const TACTIC_BRIDGE_MAX_LENGTH = 6;
export const TACTIC_PLACE_COOLDOWN_TICKS = 5;
export const TACTIC_ORBIT_DISTANCE_TOLERANCE = 0.55;
export const TACTIC_LEDGE_SAFETY_MARGIN = 3.5;
// [B-1] ヒットクリスタリング: 剣で浮かせてから着地地点に設置→落下開始で起爆
export const HIT_CRYSTAL_LAUNCH_VELOCITY = 0.1;   // 浮き判定の最小上向き速度
export const HIT_CRYSTAL_FALL_VELOCITY = -0.05;  // 落下開始判定
export const HIT_CRYSTAL_TIMEOUT_TICKS = 12;
// [B-3] サラウンド: 相手の周囲4面+足元を黒曜石で封鎖
export const SURROUND_OFFSETS = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  { x: 0, y: -1, z: 0 }, // 足元（床抜け防止）
];
export const SURROUND_MIN_SEAL = 4;          // 4面封鎖で成立
export const SURROUND_COOLDOWN_TICKS = 60;   // 成立後の再試行間隔 3秒
export const SURROUND_WIP_COOLDOWN_TICKS = 10; // [v0.5.0] 封鎖未完成のうちは高速試行
export const SURROUND_TARGET_MAX_SPEED = 0.08; // 相手がほぼ静止している時のみ
// [v0.5.0] サラウンド連携: 囲い進行中/成立後の起爆位置制御（ユーザー実機指摘の是正）
// 囲った相手への側面起爆は囲いが相手の盾になるため実質禁止し、頭上起爆へ誘導する。
export const SURROUND_SEAL_EXPIRE_TICKS = 120; // 囲い情報の有効期限 6秒
export const SURROUND_SIDE_PENALTY = 40;       // 囲い済み相手への側面/足元起爆の減点
export const SURROUND_TOP_BONUS = 25;          // 囲いの真上（頭上）起爆のボーナス
// [v0.5.0] 遮蔽防御の即応性（ユーザー実機指摘「全然置けてない」の是正）
export const DEFENSE_SCAN_TICKS = 4;           // 脅威スキャン間隔 4tick（旧10）
export const DEFENSE_BLOCK_CD_TICKS = 8;       // 遮蔽設置CD 8tick（旧16）
export const DEFENSE_THREAT_RADIUS = 8;        // 脅威検知半径 8（旧6.5）
export const DEFENSE_PREEMPT_CD_TICKS = 100;   // 予測先回り遮蔽のCD 5秒
// [B-4] i-frame明けジャスト起爆 (d-tap)
export const IFRAME_TICKS = 10;              // 無敵フレーム 10tick
// [B-2] 予測設置: Java物理で数ティック先を撃つ
export const PREDICTION_TICKS_AHEAD = 4;
export const PREDICTION_BONUS = 6;
export const JAVA_GRAVITY_PER_TICK = 0.08;   // Java版の重力加速度
export const JAVA_FRICTION_PER_TICK = 0.91;  // Java版の接地摩擦
export const JAVA_TERMINAL_VELOCITY = -3.92;
// [C-2/C-3] クリスタルサーフィン・アンカージャンプ
export const SURF_MIN_HP_AFTER = 6;          // 自傷後にこのHPを下回るなら不発
export const SURF_COOLDOWN_TICKS = 100;      // 5秒
// [B-5] ベッド爆弾 (ネザー/ジ・エンド限定)
export const BED_COMBO_COOLDOWN_TICKS = 160; // 8秒
// [F-2] Bedrockは水中の爆発が無ダメージ (MCPE-21611, Works As Intended)
// → 推定値0として扱い、水中の対象への無駄設置を防ぐ（実ダメージはエンジン判定）
export const WATER_ID = "minecraft:water";
export const MOVE_FILLER_BLOCK_IDS = [
  OBSIDIAN_ID,
];
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
// [A-3] トーテム発火時のHPは1（Wiki「Totem of Undying」）。旧 2 は誤り。
// SimBot(SimulatedPlayer)は実プレイヤーであり、オフハンドの実トーテムは
// エンジンが自動発火する。以下の手動レイヤーはフォールバック専用。
export const PATCH_TOTEM_REVIVE_HEALTH = 1;
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
  { id: "minecraft:knockback", level: 2 },
  { id: "minecraft:fire_aspect", level: 2 },
  { id: "minecraft:looting", level: 3 },
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];

export const BOT_CROSSBOW_ENCHANTMENTS = [
  { id: "minecraft:multishot", level: 1 },
  { id: "minecraft:quick_charge", level: 3 },
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];

export const BOT_BOW_ENCHANTMENTS = [
  { id: "minecraft:power", level: 5 },
  { id: "minecraft:flame", level: 1 },
  { id: "minecraft:punch", level: 2 },
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];

export const BOT_PICKAXE_ENCHANTMENTS = [
  { id: "minecraft:efficiency", level: 5 },
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];

export const BOT_ELYTRA_ENCHANTMENTS = [
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];

// [v0.5.0] メイス（エリトラ落下攻撃コンボ用）
// 注意: density / breach / wind_burst は相互排他。エリトラ急降下→メイスの定番は
// Wind Burst（ヒット時に突風で跳ね上がり連撃できる）。火力特化なら density V、
// フル装備相手なら breach IV に差し替え。
export const MACE_ID = "minecraft:mace";
export const BOT_MACE_ENCHANTMENTS = [
  { id: "minecraft:wind_burst", level: 3 },
  { id: "minecraft:unbreaking", level: 3 },
  { id: "minecraft:mending", level: 1 },
];
// [v0.5.0] エリトラ+メイス急降下（上空滞留を廃して被弾を最小化する再設計）
export const ELYTRA_DIVE_RISE_MAX_TICKS = 10;  // 上昇フェーズの上限（被弾暴露の最小化）
export const ELYTRA_DIVE_AIM_HEIGHT = 7;       // 相手+7ブロックを目標高度
export const ELYTRA_DIVE_TOTAL_MAX_TICKS = 26; // 滞空総上限（旧30）
export const MACE_DIVE_ATTACK_RANGE = 3.0;     // simulateAttack を叩く距離
export const MACE_DIVE_ATTACKS_MAX = 2;        // Wind Burst 跳ね返り後の再攻撃回数

export const BOT_ARMOR_ENCHANTMENTS = {
  [EquipmentSlot.Head]: [
    { id: "minecraft:respiration", level: 3 },
    { id: "minecraft:aqua_affinity", level: 1 },
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
    { id: "minecraft:mending", level: 1 },
  ],
  [EquipmentSlot.Chest]: [
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
    { id: "minecraft:mending", level: 1 },
  ],
  [EquipmentSlot.Legs]: [
    { id: "minecraft:swift_sneak", level: 3 },
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
    { id: "minecraft:mending", level: 1 },
  ],
  [EquipmentSlot.Feet]: [
    { id: "minecraft:depth_strider", level: 3 },
    { id: "minecraft:feather_falling", level: 4 },
    { id: "minecraft:soul_speed", level: 3 },
    { id: "minecraft:blast_protection", level: 4 },
    { id: "minecraft:unbreaking", level: 3 },
    { id: "minecraft:mending", level: 1 },
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
  PATCH_GOLDEN_APPLE_ID,
  "minecraft:netherite_pickaxe",
];

export const PATCH_DEFAULT_COMBAT_ITEM_COUNTS = {
  [OBSIDIAN_ID]: 64, [END_CRYSTAL_ID]: 64, [RESPAWN_ANCHOR_ID]: 32,
  [GLOWSTONE_ID]: 64, [ENDER_PEARL_ID]: 16,
  [PATCH_ENCHANTED_GOLDEN_APPLE_ID]: 8, [PATCH_GOLDEN_APPLE_ID]: 16,
  [TOTEM_ID]: 8,
  "minecraft:netherite_pickaxe": 1,
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
    pathfinding: true, blockPlacing: false, highGroundTactic: false,
    escapeTeleport: true, lookTurnSpeed: 18, humanize: true,
  },
  normal: {
    maintainDistance: 3, pearlDistance: 10, pearlCooldown: 40,
    swordCooldown: 15, crystalCooldown: 15, crystalDetonateDelay: 3,
    anchorCooldown: 15, anchorDetonateDelay: 3,
    targetMobs: true, targetBots: true, autoTotem: true,
    pathfinding: true, blockPlacing: true, highGroundTactic: true,
    escapeTeleport: true, lookTurnSpeed: 32, humanize: true,
  },
  hard: {
    maintainDistance: 2, pearlDistance: 8, pearlCooldown: 12,
    swordCooldown: 0, crystalCooldown: 0, crystalDetonateDelay: 0,
    anchorCooldown: 0, anchorDetonateDelay: 0, totemRefillDelay: 0,
    reactionDelay: 0, aimJitter: 0, mistakeRate: 0, suboptimalRate: 0,
    jumpDash: true, pearlRecover: false, strafeMove: true,
    targetMobs: true, targetBots: true, autoTotem: true,
    pathfinding: true, blockPlacing: true, highGroundTactic: true,
    escapeTeleport: true, lookTurnSpeed: 120, humanize: false,
    crossbowCombo: true, blastMitigation: true, shieldGuard: true,
    bowCombo: true, bowDistance: 16, elytraDash: true, elytraDistance: 12,
    ignoreSelfDamage: true, tickInterval: 1,
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
