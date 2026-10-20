// ── [D-1] チェーン速度の計測・評価 ──
// CrystalPvPの腕前を最も直接的に表す指標「黒曜石設置 → クリスタル設置 → 起爆」の
// チェーン速度を測り、アクションバーに表示する。
// レーティング閾値は mcrpg.com の Crystal Reaction Test (350〜1150ms, 5段階) 準拠。
//   Cracked <=350 / Demon <=480 / Sharp <=650 / Solid <=850 / Learning >850
//
// 計測経路:
//  - playerPlaceBlock (黒曜石)        → obsidianTick を記録
//  - entitySpawn (end_crystal)        → 近くの実プレイヤーへ placeTick を帰属
//  - entityDie   (end_crystal)        → パンチ起爆を検知してチェーンmsを算出・表示
// Bot自身の起爆は crystal_explode イベント経由で entityDie を発生させないため、
// 自然にプレイヤーの手動起爆だけが計測される。

import { world, system } from "@minecraft/server";
import { isSimBot } from "./sim_port.js";
import { globalTick } from "./state.js";

const CHAIN_HISTORY_LIMIT = 12;
const OBSIDIAN_ID = "minecraft:obsidian";
const CRYSTAL_ENTITY_ID = "minecraft:end_crystal";
const CHAIN_PROP = "pvpbot:chain_history";

// playerId -> { obsidianTick?, placeTick?, placedCrystalId? }
const chainState = new Map();
// crystalId -> playerId (設置者の帰属)
const crystalOwner = new Map();

function stateFor(player) {
  let s = chainState.get(player.id);
  if (!s) { s = {}; chainState.set(player.id, s); }
  return s;
}

function nearestRealPlayer(location, dimension, maxDist) {
  let best, bestDist = maxDist;
  try {
    for (const p of dimension.getPlayers()) {
      if (isSimBot(p)) continue;
      const dx = p.location.x - location.x, dy = p.location.y - location.y, dz = p.location.z - location.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
  } catch {}
  return best;
}

function rateChain(ms) {
  if (ms <= 350) return "Cracked";
  if (ms <= 480) return "Demon";
  if (ms <= 650) return "Sharp";
  if (ms <= 850) return "Solid";
  return "Learning";
}

function loadHistory(player) {
  try {
    const raw = player.getDynamicProperty(CHAIN_PROP);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return [];
}

function saveHistory(player, history) {
  try { player.setDynamicProperty(CHAIN_PROP, JSON.stringify(history.slice(-CHAIN_HISTORY_LIMIT))); } catch {}
}

export function getChainStats(player) {
  const history = loadHistory(player);
  if (!history.length) return undefined;
  const avg = history.reduce((a, b) => a + b, 0) / history.length;
  const best = Math.min(...history);
  return { count: history.length, avg: Math.round(avg), best, rating: rateChain(Math.round(avg)) };
}

// ── イベント登録 ──
export function registerChainSpeedTracking() {
  // (1) 黒曜石設置
  try {
    world.afterEvents.playerPlaceBlock.subscribe((ev) => {
      try {
        if (ev.block?.typeId !== OBSIDIAN_ID) return;
        stateFor(ev.player).obsidianTick = globalTick;
      } catch {}
    });
  } catch {}

  // (2) クリスタル出現 → 近くの実プレイヤーへ帰属（SimBotが近い場合は除外）
  try {
    world.afterEvents.entitySpawn.subscribe((ev) => {
      try {
        const entity = ev.entity;
        if (entity?.typeId !== CRYSTAL_ENTITY_ID) return;
        const player = nearestRealPlayer(entity.location, entity.dimension, 6);
        if (!player) return;
        // SimBotの設置したクリスタンルは除外: Bot が誰よりも近ければ帰属しない
        let simCloser = false;
        try {
          for (const e of entity.dimension.getEntities({ location: entity.location, maxDistance: 8 })) {
            if (isSimBot(e)) {
              const d1 = Math.hypot(e.location.x - entity.location.x, e.location.y - entity.location.y, e.location.z - entity.location.z);
              const d2 = Math.hypot(player.location.x - entity.location.x, player.location.y - entity.location.y, player.location.z - entity.location.z);
              if (d1 < d2) { simCloser = true; break; }
            }
          }
        } catch {}
        if (simCloser) return;
        const s = stateFor(player);
        s.placeTick = globalTick;
        crystalOwner.set(String(entity.id), player.id);
        // 古いエントリの掃除
        if (crystalOwner.size > 64) {
          const cutoff = globalTick - 600;
          for (const [key,] of [...crystalOwner.entries()].slice(0, 32)) crystalOwner.delete(key);
          void cutoff;
        }
      } catch {}
    });
  } catch {}

  // (3) クリスタル破壊（パンチ起爆）→ チェーンms を算出して表示
  try {
    world.afterEvents.entityDie.subscribe((ev) => {
      try {
        const entity = ev.deadEntity;
        if (entity?.typeId !== CRYSTAL_ENTITY_ID) return;
        const key = String(entity.id);
        const ownerId = crystalOwner.get(key);
        crystalOwner.delete(key);
        if (!ownerId) return;
        const player = world.getAllPlayers().find(p => p.id === ownerId);
        if (!player) return;
        const s = chainState.get(player.id);
        if (!s || s.placeTick === undefined) return;
        const ms = (globalTick - s.placeTick) * 50;
        s.placeTick = undefined;
        if (ms < 0 || ms > 10000) return; // 異常値は無視
        const history = loadHistory(player);
        history.push(ms);
        saveHistory(player, history);
        const rank = rateChain(ms);
        try { player.onScreenDisplay.setActionBar(`§eチェーン §f${ms}ms §7[§b${rank}§7] §8(平均 ${Math.round(history.reduce((a, b) => a + b, 0) / history.length)}ms)`); } catch {}
      } catch {}
    });
  } catch {}

  // (4) 履歴表示コマンド用にsystem準備（不要だが将来のD-2統計の接続点）
  void system;
}

// チャット形式での統計表示 (!chain は将来的にカスタムコマンド化予定)
export function sendChainStats(player) {
  const stats = getChainStats(player);
  if (!stats) {
    try { player.sendMessage("§7[PvPBot] まだチェーン計測の記録がありません。黒曜石→クリスタル→パンチ起爆を試してください。"); } catch {}
    return;
  }
  try {
    player.sendMessage(`§e[PvPBot] チェーン統計: §f${stats.count}回 §e平均 §f${stats.avg}ms §e最高 §f${stats.best}ms §e判定 §b${stats.rating}`);
  } catch {}
}
