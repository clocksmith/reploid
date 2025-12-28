/**
 * @fileoverview REPLOID Boot Orchestrator
 * Slim entry point that coordinates the boot sequence.
 */

import { loadGenesisConfig, getGenesisLevel, resolveModules, getLevelConfig } from './config.js';
import { loadExternalDependencies, registerModules } from './modules.js';
import { resetSession, seedCodeIntel, hydrateVFS } from './vfs-hydrate.js';
import { createGenesisSnapshot, initializeSwarm, resolveServices, setupExportFunctions } from './services.js';
import { initIframeBridge, setSystemReadyCallback, getPendingGoal, isIframeChild } from './iframe-bridge.js';
import { renderErrorUI } from './error-ui.js';

/**
 * Main boot sequence.
 * @param {Object} Utils - Utils module
 * @param {Object} DIContainer - DI Container module
 * @param {Function} initModelConfig - Model config initializer
 * @param {Object} GoalHistory - Goal history module
 * @returns {Promise<Object>} Boot result with container and services
 */
export async function boot(Utils, DIContainer, initModelConfig, GoalHistory) {
  const logger = Utils.factory().logger;
  logger.info('[Boot] Starting REPLOID System...');

  // Check for full reset
  if (typeof window.shouldResetAll === 'function' && window.shouldResetAll()) {
    logger.info('[Boot] Full reset requested...');
    try {
      await window.performFullReset();
      localStorage.setItem('REPLOID_RESET_ALL', 'false');
    } catch (e) {
      logger.warn('[Boot] Full reset failed:', e.message);
    }
  }

  // Initialize iframe bridge
  initIframeBridge(logger);

  // Initialize model config UI
  initModelConfig();

  // Load configuration
  const genesisConfig = await loadGenesisConfig();
  const genesisLevel = getGenesisLevel(genesisConfig);
  const levelConfig = getLevelConfig(genesisLevel, genesisConfig);
  const resolvedModules = resolveModules(genesisLevel, genesisConfig);

  logger.info(`[Boot] Genesis level: ${levelConfig.name} (${resolvedModules.length} modules)`);

  // Create DI container
  const container = DIContainer.factory({ Utils: Utils.factory() });

  // Load external dependencies (Transformers.js etc.)
  await loadExternalDependencies(resolvedModules, genesisConfig.moduleFiles, logger);

  // Register modules (parallel loading)
  await registerModules(resolvedModules, genesisConfig, container, logger);

  // Initialize VFS
  const vfs = await container.resolve('VFS');

  // Reset session artifacts
  await resetSession(vfs, genesisConfig, genesisLevel, logger);

  // Seed essential files
  await seedCodeIntel(vfs, logger);

  // Hydrate VFS with source files
  await hydrateVFS(vfs, genesisConfig, resolvedModules, genesisLevel, logger);

  // Create genesis snapshot
  await createGenesisSnapshot(container, logger);

  // Initialize swarm if enabled
  await initializeSwarm(container, resolvedModules, logger);

  // Resolve core services and expose globals
  const services = await resolveServices(container, logger);

  // Setup import/export functions
  setupExportFunctions(container, logger);

  logger.info('[Boot] Core System Ready.');

  // Notify model config UI
  if (window.onGenesisLevelLoaded) {
    window.onGenesisLevelLoaded();
  }

  return {
    container,
    genesisConfig,
    genesisLevel,
    resolvedModules,
    ...services
  };
}

/**
 * Setup awaken button and UI triggering.
 * @param {Object} bootResult - Result from boot()
 * @param {Object} Utils - Utils module
 * @param {Object} GoalHistory - Goal history module
 */
export function setupAwaken(bootResult, Utils, GoalHistory) {
  const { container, agent, vfs, genesisConfig } = bootResult;
  const logger = Utils.factory().logger;

  const awakenBtn = document.getElementById('awaken-btn');
  const goalInput = document.getElementById('goal-input');

  // Initialize goal history
  if (goalInput) {
    GoalHistory.initDropdown(goalInput, (selectedGoal) => {
      goalInput.value = selectedGoal;
    });
  }

  // Lazy load Proto styles
  const ensureProtoStyles = () => {
    if (document.getElementById('proto-stylesheet')) return;
    const link = document.createElement('link');
    link.id = 'proto-stylesheet';
    link.rel = 'stylesheet';
    link.href = 'styles/proto/index.css';
    document.head.appendChild(link);
  };

  // Awaken function
  const triggerAwaken = async (overrideGoal) => {
    try {
      const goal = overrideGoal || goalInput?.value?.trim() || '';

      if (goal) {
        if (localStorage.getItem('REPLOID_GOAL') !== goal) {
          localStorage.setItem('REPLOID_GOAL', goal);
        }
        if (!isIframeChild()) {
          GoalHistory.add(goal);
        }
      }

      ensureProtoStyles();

      const { default: Proto } = await import('../ui/proto.js');

      let workerManager = null;
      try {
        workerManager = await container.resolve('WorkerManager');
      } catch (e) {
        logger.debug('[Boot] WorkerManager not available');
      }

      let arenaHarness = null;
      try {
        arenaHarness = await container.resolve('ArenaHarness');
      } catch (e) {
        logger.debug('[Boot] ArenaHarness not available');
      }

      const proto = Proto.factory({
        Utils: Utils.factory(),
        EventBus: await container.resolve('EventBus'),
        AgentLoop: agent,
        StateManager: await container.resolve('StateManager'),
        WorkerManager: workerManager,
        ArenaHarness: arenaHarness
      });

      // Remove boot UI
      const bootContainer = document.getElementById('boot-container');
      if (bootContainer) bootContainer.remove();

      ['tl', 'tr', 'bl', 'br'].forEach(corner => {
        const line = document.getElementById(`reticle-${corner}`);
        if (line) line.remove();
      });

      document.body.classList.add('no-grid-pattern');

      const appEl = document.getElementById('app');
      appEl.classList.add('active');
      proto.mount(appEl);
      proto.setVFS(vfs);

      logger.info('[Boot] UI Mounted.');

      // Start agent if goal provided
      if (goal) {
        const savedModels = localStorage.getItem('SELECTED_MODELS');
        const consensusStrategy = localStorage.getItem('CONSENSUS_TYPE') || 'arena';
        let models = savedModels ? JSON.parse(savedModels) : [];

        if (models.length === 0 && navigator.gpu) {
          models = [{
            id: 'smollm2-360m',
            name: 'SmolLM2 360M (Auto)',
            provider: 'transformers',
            hostType: 'browser-local'
          }];
          logger.info('[Boot] Auto-selected: ' + models[0].name);
        }

        if (models.length > 0) {
          agent.setModels(models);
          agent.setConsensusStrategy(consensusStrategy);

          if (models.length >= 2) {
            localStorage.setItem('REPLOID_ARENA_GATING', 'true');
          }

          if (workerManager) {
            try {
              await workerManager.init(genesisConfig);
              workerManager.setModelConfig(models[0]);
            } catch (e) {
              logger.warn('[Boot] WorkerManager init failed');
            }
          }
        }

        logger.info('[Boot] Starting agent with goal: ' + goal);
        agent.run(goal).catch(e => logger.error('[Boot] Agent error:', e.message));
      }
    } catch (e) {
      logger.error('[Boot] UI failed', e);
    }
  };

  if (awakenBtn) {
    awakenBtn.disabled = false;
    awakenBtn.textContent = 'Awaken Agent';
    awakenBtn.addEventListener('click', () => triggerAwaken());

    // Iframe auto-awaken
    if (isIframeChild()) {
      setSystemReadyCallback(() => {
        const goal = getPendingGoal();
        if (goal) {
          logger.info('[Boot] Auto-awakening as iframe child');
          triggerAwaken(goal);
        }
      });
    }
  } else {
    logger.warn('[Boot] Running in headless mode');
  }
}

// Re-export error UI for use in boot.js
export { renderErrorUI };
