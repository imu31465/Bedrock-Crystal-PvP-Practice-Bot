// Crystal PvP Bot — Main Entry Point
// This file registers events and runs the main tick loop.
// All logic is imported from modular files.

import {
  system, world, BOT_TYPE, BOT_READY_TAG,
  CommandPermissionLevel, CustomCommandParamType, getIntroMessage,
} from "./constants.js";
import {
  blockCache, globalTick, incrementGlobalTick,
  introShown, pendingSpawnRequests, botConfigs, runtimeState,
  trackedBots, trackedBotMetaById, trackedBotIdByUid, clearCaches,
  globalSettings,
} from "./state.js";
import {
  getAllBots, getAllPlayers, getPlayerByName, getPlayersInDimension, findNearestTarget,
  getBotUid, getBotLabel, isEntityUsable, isSpawnProtected,
  formatError, logSystem, logBotEvent, appendPersistentDebugLog,
  debugLog, flushDebugLogIfDirty, loadDebugLogBuffer,
  dumpPersistentDebugLog, clearPersistentDebugLog,
  trackBot, untrackBot, updateTrackedBotMeta,
  matchPendingSpawnRequest, patchGetCurrentHealthValue, patchGetMaxHealthValue,
  broadcastDeathMessage, distance, shortId,
  formatLocation, summarizeNearbyPlayers, summarizeNearbyBots,
  describeBlockContext, scheduleBotProbe,
  isLocationInsideBotBoundary,
} from "./utils.js";
import {
  loadConfigs, loadGlobalSettings, getRuntime, materializeConfig,
  persistBotConfig, patchApplyDifficultyPreset, getDefaultBotDisplayName,
  normalizeGlobalSettings,
} from "./config.js";
import {
  ensureBotInitialized, ensureBotEquipmentIntegrity,
  syncBotLoadout, handleTotemSafety, applyArmorDerivedEffects,
  patchSyncVisualEquipmentSlots, patchShouldEmergencyPopTotem,
  tryPopTotem, selectBestSword, ensureAutoTotem,
} from "./inventory.js";
import {
  handleSwordCombo, handleCrystalCombo, handleAnchorCombo,
  chooseBestExplosiveAction,
} from "./combat.js";
import {
  handleMovement, handlePearlMove, handleGoldenAppleBuff,
  enforceBotBoundary,
} from "./movement.js";
import {
  openRootMenu, openSettingsForm, spawnBotForPlayer, spawnBotWithPreset,
  removeOwnedBots, createPlayerCommandHandler,
  setSupplyChestForNearestBot, clearSupplyChestForNearestBot,
} from "./ui.js";

// ── Tick Bot Loop ──
function tickBots() {
  incrementGlobalTick();
  clearCaches();

  const allBots = getAllBots();
  for (const bot of allBots) {
    if (!isEntityUsable(bot, BOT_TYPE)) continue;

    const config = ensureBotInitialized(bot);
    if (!config) continue;
    const uid = config.uid;
    const runtime = getRuntime(uid);

    // Skip if tickInterval says so
    if (config.tickInterval > 1 && globalTick % config.tickInterval !== 0) continue;

    // Skip if configuring (and make invincible)
    if (runtime.isConfiguring) {
      try { bot.addEffect("resistance", 10, { amplifier: 255, showParticles: false }); } catch {}
      try { bot.addEffect("fire_resistance", 10, { amplifier: 255, showParticles: false }); } catch {}
      continue;
    }

    // Skip if disabled
    if (!config.enabled) {
      ensureBotEquipmentIntegrity(bot, config);
      continue;
    }

    // Spawn protection
    if (isSpawnProtected(uid)) {
      ensureBotEquipmentIntegrity(bot, config);
      patchSyncVisualEquipmentSlots(bot);
      continue;
    }

    // ── Boundary enforcement (highest priority) ──
    const gs = normalizeGlobalSettings(globalSettings || {});
    if (gs.boundaryEnabled && !isLocationInsideBotBoundary(bot.location)) {
      enforceBotBoundary(bot, config);
      continue; // Skip everything else, force return first
    }

    // Staggered Target Finding
    if (runtime.staggerOffset === undefined) runtime.staggerOffset = Math.floor(Math.random() * 3);
    if (globalTick % 3 === runtime.staggerOffset) {
      runtime.cachedTarget = findNearestTarget(bot);
    }
    const target = runtime.cachedTarget;

    if (!target) {
      ensureBotEquipmentIntegrity(bot, config);
      patchSyncVisualEquipmentSlots(bot);
      continue;
    }

    // Skip if target is outside boundary
    if (gs.boundaryEnabled && !isLocationInsideBotBoundary(target.location)) {
      runtime.cachedTarget = null;
      ensureBotEquipmentIntegrity(bot, config);
      patchSyncVisualEquipmentSlots(bot);
      continue;
    }

    // Track health
    runtime.lastKnownHealth = patchGetCurrentHealthValue(bot);

    // Handle totem safety
    handleTotemSafety(bot, config);

    // Apply armor-derived effects
    if (globalTick % 6 === 0) applyArmorDerivedEffects(bot);

    // Golden apple buff
    handleGoldenAppleBuff(bot, config, target);

    // Sync loadout periodically
    if (globalTick % 40 === 0) {
      syncBotLoadout(bot, config, false);
      ensureBotEquipmentIntegrity(bot, config);
    }

    // Movement
    handleMovement(bot, target, config);

    // Pearl move
    handlePearlMove(bot, target, config);

    // Combat
    const explosiveAction = chooseBestExplosiveAction(bot, target, config);
    if (explosiveAction) {
      if (explosiveAction.type === "anchor") {
        handleAnchorCombo(bot, target, config, explosiveAction.candidate);
      } else {
        handleCrystalCombo(bot, target, config, explosiveAction.candidate);
      }
    }
    handleSwordCombo(bot, target, config);

    // Visual sync
    patchSyncVisualEquipmentSlots(bot);
  }

  // Flush debug log at end of tick
  flushDebugLogIfDirty();
}

// ── Event Handlers ──
function onEntitySpawn(event) {
  const entity = event.entity;
  if (entity?.typeId !== BOT_TYPE) return;
  const request = matchPendingSpawnRequest(entity);
  let config = ensureBotInitialized(entity, request?.playerName ? { name: request.playerName } : undefined);
  if (config) {
    // プリセット指定あり → 設定を即適用
    if (request?.presetName) {
      const presetApplied = patchApplyDifficultyPreset(config, request.presetName);
      // インベントリモードも上書き
      const merged = { ...presetApplied, inventoryMode: request.inventoryMode ?? presetApplied.inventoryMode };
      config = persistBotConfig(entity, merged);
      entity.nameTag = config.displayName || getDefaultBotDisplayName(config.uid);
    }
    trackBot(entity);
    updateTrackedBotMeta(entity, { uid: config.uid });
    logBotEvent(entity, `spawned preset=${request?.presetName ?? "none"}`);
    if (request?.openSettingsAfterSpawn) {
      const owner = request?.playerName ? world.getAllPlayers().find(p => p.name === request.playerName) : undefined;
      if (owner) system.runTimeout(() => { void openSettingsForm(owner); }, 10);
    }
  }
}

function onEntityDie(event) {
  const entity = event.deadEntity;
  if (entity?.typeId !== BOT_TYPE) return;
  const uid = getBotUid(entity);
  if (uid) {
    broadcastDeathMessage(entity);
    delete botConfigs[uid];
    runtimeState.delete(uid);
    trackedBotIdByUid.delete(uid);
    try { trackedBotMetaById.delete(entity.id); } catch {}
    appendPersistentDebugLog("death", `bot ${uid} died`);
  }
  untrackBot(entity);
}

function onEntityHurt(event) {
  const entity = event.hurtEntity;
  if (entity?.typeId !== BOT_TYPE || !isEntityUsable(entity, BOT_TYPE)) return;
  const uid = getBotUid(entity);
  const config = botConfigs[uid];
  if (!config) return;
  const runtime = getRuntime(uid);
  const damage = Number(event.damage ?? 0);
  const remainingHealth = patchGetCurrentHealthValue(entity);
  const maxHealth = patchGetMaxHealthValue(entity);
  const cause = event.damageSource?.cause ?? "unknown";
  if (config.debug?.health) {
    debugLog(entity, config, "health", `被ダメージ=${damage.toFixed(1)} 残HP=${remainingHealth.toFixed(1)}/${maxHealth.toFixed(1)} cause=${cause}`, true);
  }
  if (config.autoTotem &&
      globalTick > (runtime.totemShieldUntilTick ?? -9999) &&
      patchShouldEmergencyPopTotem(entity, damage, cause)) {
    tryPopTotem(entity, config, `damage=${damage}`);
  }
  runtime.lastKnownHealth = remainingHealth;
}

function onEntityRemove(event) {
  const entity = event.removedEntity;
  if (entity?.typeId !== BOT_TYPE) return;
  untrackBot(entity);
}

function onPlayerSpawn(event) {
  const player = event.player;
  if (!player) return;
  if (!introShown.has(player.name)) {
    introShown.add(player.name);
    try { player.sendMessage(getIntroMessage()); } catch {}
  }
}

// ── Startup ──
// Register commands via system.beforeEvents.startup (must happen before world load)
try {
  system.beforeEvents.startup.subscribe((event) => {
    const commands = [
      {
        name: "bot",
        description: "Crystal PvP Bot のメニューを開きます。プリセット名を指定すると即召喚します。",
        optionalParameters: [{ name: "preset", type: CustomCommandParamType ? CustomCommandParamType.String : 0 }],
        handler: (player, presetArg) => {
          const preset = presetArg?.value ?? presetArg;
          if (preset && typeof preset === "string" && preset.trim()) {
            spawnBotWithPreset(player, preset.trim());
          } else {
            openRootMenu(player);
          }
        },
      },
      {
        name: "pvpbot:bot",
        description: "Crystal PvP Bot のメニューを開きます。プリセット名を指定すると即召喚します。",
        optionalParameters: [{ name: "preset", type: CustomCommandParamType ? CustomCommandParamType.String : 0 }],
        handler: (player, presetArg) => {
          const preset = presetArg?.value ?? presetArg;
          if (preset && typeof preset === "string" && preset.trim()) {
            spawnBotWithPreset(player, preset.trim());
          } else {
            openRootMenu(player);
          }
        },
      },
      {
        name: "pvpbot:spawn",
        description: "Crystal PvP Bot を召喚します。プリセット名を指定可能。",
        optionalParameters: [{ name: "preset", type: CustomCommandParamType ? CustomCommandParamType.String : 0 }],
        handler: (player, presetArg) => {
          const preset = presetArg?.value ?? presetArg;
          if (preset && typeof preset === "string" && preset.trim()) {
            spawnBotWithPreset(player, preset.trim());
          } else {
            spawnBotForPlayer(player);
          }
        },
      },
      {
        name: "pvpbot:easy",
        description: "Easy プリセットで Bot を即召喚 (インベントリ: 無限)",
        handler: (player) => spawnBotWithPreset(player, "easy"),
      },
      {
        name: "pvpbot:normal",
        description: "Normal プリセットで Bot を即召喚 (インベントリ: 無限)",
        handler: (player) => spawnBotWithPreset(player, "normal"),
      },
      {
        name: "pvpbot:hard",
        description: "Hard プリセットで Bot を即召喚 (インベントリ: 無限)",
        handler: (player) => spawnBotWithPreset(player, "hard"),
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
    console.warn(`[PvPBot] Registering ${commands.length} commands...`);
    for (const command of commands) {
      try {
        const cmdDef = {
          name: command.name,
          description: command.description,
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
        };
        if (command.optionalParameters) {
          cmdDef.optionalParameters = command.optionalParameters;
        }
        event.customCommandRegistry.registerCommand(
          cmdDef,
          createPlayerCommandHandler(command.handler),
        );
        console.warn(`[PvPBot] Registered: ${command.name}`);
      } catch (error) {
        console.warn(
          `[PvPBot] command registration failed (${command.name}): ${formatError(error)}`,
        );
      }
    }
    console.warn(`[PvPBot] Command registration complete.`);
  });
} catch (error) {
  console.warn(`[PvPBot] startup subscribe failed: ${formatError(error)}`);
}

// Register event handlers
world.afterEvents.entitySpawn.subscribe(onEntitySpawn);
try { world.afterEvents.entityDie.subscribe(onEntityDie); } catch {}
try { world.afterEvents.entityHurt.subscribe(onEntityHurt); } catch {}
try {
  if (world.afterEvents.entityRemove) {
    world.afterEvents.entityRemove.subscribe(onEntityRemove);
  }
} catch {}
try {
  world.afterEvents.playerSpawn.subscribe((event) => {
    system.runTimeout(() => {
      if (introShown.has(event.player.name)) return;
      introShown.add(event.player.name);
      event.player.sendMessage(getIntroMessage());
    }, 5);
  });
} catch (error) {
  console.warn(`[PvPBot] playerSpawn subscribe failed: ${formatError(error)}`);
}

// Deferred initialization (after world is ready)
system.run(() => {
  try {
    loadDebugLogBuffer();
    loadConfigs();
    loadGlobalSettings();
    logSystem("PvPBot startup complete");

    // Start main tick loop
    system.runInterval(() => {
      try { tickBots(); } catch (error) { logSystem(`tickBots error: ${formatError(error)}`); }
    }, 1);

    // Show intro to already-online players
    system.runTimeout(() => {
      for (const player of getAllPlayers()) {
        if (introShown.has(player.name)) continue;
        introShown.add(player.name);
        player.sendMessage(getIntroMessage());
      }
    }, 10);
  } catch (error) {
    console.warn(`[PvPBot] boot failed: ${formatError(error)}`);
  }
});