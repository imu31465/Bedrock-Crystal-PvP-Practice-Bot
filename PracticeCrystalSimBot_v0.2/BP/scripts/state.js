// Shared mutable state used across all modules
// All modules import from here to avoid circular dependencies

export const botConfigs = {};
export const runtimeState = new Map();
export const trackedBots = new Map();
export const trackedBotMetaById = new Map();
export const trackedBotIdByUid = new Map();
export const pendingSpawnRequests = [];
export const introShown = new Set();
export const blockCache = new Map();
export const entityCache = new Map();

export function clearCaches() {
  blockCache.clear();
  entityCache.clear();
}

export let globalTick = 0;
export let globalSettings = {};
export let patchMobGriefingEnabled = false;
export let debugLogBuffer = [];
export let debugLogDirty = false;

export function incrementGlobalTick() { globalTick += 1; }
export function setGlobalSettings(s) { globalSettings = s; }
export function setPatchMobGriefingEnabled(v) { patchMobGriefingEnabled = v; }
export function setDebugLogBuffer(buf) { debugLogBuffer = buf; }
export function setDebugLogDirty(v) { debugLogDirty = v; }
