// SimulatedPlayer port layer
// Replaces the custom-entity spawn/remove/identity layer of PracticeCr with
// @minecraft/server-gametest SimulatedPlayer equivalents.

import { world, system, GameMode } from "@minecraft/server";
import { spawnSimulatedPlayer, getPlayerSkin } from "@minecraft/server-gametest";
import { appendPersistentDebugLog } from "./utils.js";

// id -> live player object
export const simBotByPlayerId = new Map();
let nextBotNumber = 1;

export function isSimBot(entity) {
  if (!entity) return false;
  try {
    if (entity.id && simBotByPlayerId.has(entity.id)) return true;
  } catch {}
  try {
    return entity?.typeId === "minecraft:player" &&
      String(entity?.name ?? "").startsWith("SimBot_");
  } catch {
    return false;
  }
}

export function getAllSimBots() {
  const out = [];
  for (const [id, sim] of [...simBotByPlayerId.entries()]) {
    let valid = false;
    try { valid = !!sim && sim.isValid && sim.location; } catch {}
    if (valid) out.push(sim);
    else simBotByPlayerId.delete(id);
  }
  return out;
}

export function getNextBotName() {
  return `SimBot_${nextBotNumber++}`;
}

export function spawnSimBotAt(location, dimension, name, gameMode) {
  const sim = spawnSimulatedPlayer(
    { x: location.x, y: location.y, z: location.z, dimension },
    name,
    gameMode ?? GameMode.Survival,
  );
  if (!sim) throw new Error("spawnSimulatedPlayer returned null (Beta APIs experiment must be ON)");
  simBotByPlayerId.set(sim.id, sim);
  try { sim.nameTag = name; } catch {}
  return sim;
}

export function applyOwnerSkin(sim, ownerPlayer, delayTicks = 2) {
  system.runTimeout(() => {
    let simName = "?";
    try { simName = sim?.name ?? "?"; } catch {}
    try {
      if (!sim?.isValid) return;
      const skin = ownerPlayer ? getPlayerSkin(ownerPlayer) : undefined;
      if (skin) {
        sim.setSkin(skin);
      } else {
        appendPersistentDebugLog("sim", `${simName}: skin=null owner=${ownerPlayer?.name ?? "?"}`);
      }
    } catch (error) {
      appendPersistentDebugLog("sim", `${simName}: skin fail ${String(error)}`);
    }
  }, delayTicks);
}

export function despawnSimBot(bot) {
  const id = bot?.id;
  try { bot?.disconnect?.(); } catch {}
  try { if (id) simBotByPlayerId.delete(id); } catch {}
}

export function scheduleDespawn(bot, delayTicks = 1) {
  system.runTimeout(() => despawnSimBot(bot), delayTicks);
}

// Shared command-caller resolution.
// This engine's CustomCommandOrigin exposes only `sourceType`; sourceEntity /
// initiator do not exist. Fall back to the single-real-player heuristic used by
// the POC (multiplayer should use /scriptevent instead).
export function resolveCommandPlayer(origin) {
  const candidates = world.getAllPlayers().filter(p => !isSimBot(p));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1 && origin?.sourceType) {
    // ambiguous in multiplayer: pick none (caller flow asks for scriptevent)
    return undefined;
  }
  return undefined;
}
