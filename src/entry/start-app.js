/**
 * @fileoverview REPLOID Bootstrapper
 * Slim entry point that delegates to modular boot components.
 *
 * Genesis Levels:
 *   TABULA     - Minimal agent core (17 modules)
 *   REFLECTION - +self-awareness, HITL (6 modules)
 *   FULL       - +cognition, arena, swarm (28 modules)
 */

// === BOOT INFRASTRUCTURE ===
import Utils from '../core/utils.js';
import DIContainer from '../infrastructure/di-container.js';

// === MODULAR BOOT ===
import { boot, renderErrorUI } from '../boot-helpers/index.js';

/**
 * Parse models from localStorage with fallback
 */
function parseModels() {
  try {
    const saved = localStorage.getItem('SELECTED_MODELS');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[Boot] Failed to parse SELECTED_MODELS, resetting');
    localStorage.removeItem('SELECTED_MODELS');
    return [];
  }
}

/**
 * Complete the awaken process after boot
 */
async function completeAwaken(bootResult, goal, wizardContainer) {
  const { agent, vfs, container, genesisConfig } = bootResult;
  const utils = Utils.factory();
  const logger = utils.logger;
  const eventBus = await container.resolve('EventBus');
  let errorStore = null;
  try {
    errorStore = await container.resolve('ErrorStore');
  } catch (e) {
    logger.debug('[Boot] ErrorStore not available');
  }

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

  const stateManager = await container.resolve('StateManager');
  const appEl = document.getElementById('app');

  let proto = null;
  let reloadTimer = null;
  let reloadInProgress = false;
  let reloadPending = false;

  const ensureProtoStyles = (version) => {
    const href = `styles/proto/index.css?v=${encodeURIComponent(version)}`;
    let link = document.getElementById('proto-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.id = 'proto-stylesheet';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
  };

  const buildProto = async (version) => {
    const { default: Proto } = await import(`../ui/proto/index.js?v=${encodeURIComponent(version)}`);
    return Proto.factory({
      Utils: utils,
      EventBus: eventBus,
      AgentLoop: agent,
      StateManager: stateManager,
      ErrorStore: errorStore,
      VFS: vfs,
      WorkerManager: workerManager,
      ArenaHarness: arenaHarness
    });
  };

  const mountProto = async (reason = '') => {
    if (!appEl) throw new Error('Missing #app container');
    if (proto?.cleanup) {
      try { proto.cleanup(); } catch (e) { logger.debug('[Boot] Proto cleanup failed', e?.message || e); }
    }
    appEl.classList.add('active');
    appEl.innerHTML = '';

    const version = Date.now().toString();
    window.REPLOID_UI_VERSION = version;
    ensureProtoStyles(version);

    proto = await buildProto(version);
    await proto.mount(appEl);
    logger.info(`[Boot] UI Mounted${reason ? ` (${reason})` : ''}.`);
  };

  const reloadUI = async (reason = 'reload') => {
    if (reloadInProgress) {
      reloadPending = true;
      return;
    }
    reloadInProgress = true;
    try {
      await mountProto(reason);
    } catch (e) {
      logger.error('[Boot] UI reload failed:', e?.message || e);
    } finally {
      reloadInProgress = false;
      if (reloadPending) {
        reloadPending = false;
        reloadUI('pending');
      }
    }
  };

  const scheduleReload = (reason) => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      reloadUI(reason);
    }, 150);
  };

  // Remove boot UI
  if (wizardContainer) wizardContainer.remove();
  document.body.classList.add('no-grid-pattern');

  await mountProto('initial');

  // Hot-reload UI on VFS changes
  if (eventBus?.on) {
    eventBus.on('vfs:file_changed', (data = {}) => {
      const path = data?.path || data?.oldPath || '';
      if (typeof path !== 'string') return;
      if (path.startsWith('/ui/') || path.startsWith('/styles/')) {
        scheduleReload('vfs');
      }
    });
  }

  window.REPLOID_UI = {
    reload: reloadUI,
    getVersion: () => window.REPLOID_UI_VERSION || 'unknown'
  };

  // Start agent if goal provided
  if (goal) {
    const consensusStrategy = localStorage.getItem('CONSENSUS_TYPE') || 'arena';
    let models = parseModels();

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
}

(async () => {
  try {
    // Show wizard FIRST, before boot
    const { initWizard: initWizardUI } = await import('../ui/boot-wizard/index.js');
    const wizardContainer = document.getElementById('wizard-container');

    if (wizardContainer) {
      wizardContainer.style.display = 'block';
      initWizardUI(wizardContainer);
    }

    // Expose awaken trigger - this runs boot() when user clicks Awaken
    window.triggerAwaken = async (goal) => {
      try {
        // Ensure the full VFS hydration finished so module imports don't 404 under the SW.
        const fullSeed = window.REPLOID_VFS_FULL_SEED_PROMISE;
        if (fullSeed && typeof fullSeed.then === 'function') {
          console.log('[Boot] Waiting for background VFS hydration...');
          await fullSeed;
        }

        // NOW run the boot sequence
        const bootResult = await boot(Utils, DIContainer);
        await completeAwaken(bootResult, goal, wizardContainer);
      } catch (err) {
        console.error('[Boot] CRITICAL BOOT FAILURE', err);
        renderErrorUI(err);
      }
    };

  } catch (err) {
    console.error('[Boot] CRITICAL BOOT FAILURE', err);
    renderErrorUI(err);
  }
})();
