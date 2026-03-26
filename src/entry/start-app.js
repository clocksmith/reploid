/**
 * @fileoverview REPLOID Bootstrapper
 * Slim entry point that delegates to modular boot components.
 *
 * Genesis levels are defined in src/config/genesis-levels.json.
 * Current ladder: tabula -> spark -> reflection -> cognition -> substrate -> full.
 */

// === BOOT INFRASTRUCTURE ===
import Utils from '../core/utils.js';
import DIContainer from '../infrastructure/di-container.js';

// === MODULAR BOOT ===
import { boot, renderErrorUI } from '../boot-helpers/index.js';
import { createCapsuleRuntime } from '../capsule/runtime.js';
import CapsuleUI from '../ui/capsule/index.js';

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

  const runtimeMode = typeof window.getReploidMode === 'function'
    ? window.getReploidMode()
    : 'zero';

  let runtimeUI = null;
  let reloadTimer = null;
  let reloadInProgress = false;
  let reloadPending = false;

  const getRuntimeUiSpec = () => (
    runtimeMode === 'x'
      ? {
          name: 'proto',
          stylePath: 'styles/proto/index.css',
          modulePath: '../ui/proto/index.js'
        }
      : runtimeMode === 'absolute_zero'
        ? {
            name: 'capsule',
            stylePath: 'styles/capsule.css',
            modulePath: '../ui/capsule/index.js'
          }
        : {
            name: 'zero',
            stylePath: 'styles/zero.css',
            modulePath: '../ui/zero/index.js'
          }
  );

  const ensureRuntimeStyles = (version, spec) => {
    const href = `${spec.stylePath}?v=${encodeURIComponent(version)}`;
    let link = document.getElementById('runtime-ui-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.id = 'runtime-ui-stylesheet';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.href = href;
    }
  };

  const buildRuntimeUi = async (version, spec) => {
    const mod = await import(`${spec.modulePath}?v=${encodeURIComponent(version)}`);
    const runtime = mod.default || mod;
    return runtime.factory({
      Utils: utils,
      EventBus: eventBus,
      AgentLoop: agent,
      StateManager: stateManager,
      ErrorStore: errorStore,
      VFS: vfs,
      WorkerManager: workerManager,
      ArenaHarness: arenaHarness,
      initialGoal: goal,
      mode: runtimeMode
    });
  };

  const mountRuntimeUi = async (reason = '') => {
    if (!appEl) throw new Error('Missing #app container');
    if (runtimeUI?.cleanup) {
      try { runtimeUI.cleanup(); } catch (e) { logger.debug('[Boot] Runtime UI cleanup failed', e?.message || e); }
    }
    appEl.classList.add('active');
    appEl.innerHTML = '';

    const version = Date.now().toString();
    window.REPLOID_UI_VERSION = version;
    const spec = getRuntimeUiSpec();
    ensureRuntimeStyles(version, spec);

    runtimeUI = await buildRuntimeUi(version, spec);
    await runtimeUI.mount(appEl);
    logger.info(`[Boot] ${spec.name} UI mounted${reason ? ` (${reason})` : ''}.`);
  };

  const reloadUI = async (reason = 'reload') => {
    if (reloadInProgress) {
      reloadPending = true;
      return;
    }
    reloadInProgress = true;
    try {
      await mountRuntimeUi(reason);
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

  await mountRuntimeUi('initial');

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
        provider: 'doppler',
        hostType: 'browser-local'
      }];
      logger.info('[Boot] Auto-selected: ' + models[0].name);
    }

    if (models.length > 0) {
      agent.setModels(models);
      agent.setConsensusStrategy(consensusStrategy);
      if (runtimeUI?.setModels) {
        runtimeUI.setModels(models);
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
}

async function completeAbsoluteZeroAwaken(goal, wizardContainer) {
  const awakenInput = (goal && typeof goal === 'object' && !Array.isArray(goal))
    ? goal
    : {
        goal,
        environment: localStorage.getItem('REPLOID_ENVIRONMENT') || '',
        includeHostWithinSelf: localStorage.getItem('REPLOID_INCLUDE_HOST_WITHIN_SELF') === 'true'
      };
  const utils = Utils.factory();
  const logger = utils.logger;
  const appEl = document.getElementById('app');

  if (!appEl) {
    throw new Error('Missing #app container');
  }

  if (wizardContainer) wizardContainer.remove();
  document.body.classList.add('no-grid-pattern');
  appEl.classList.add('active');
  appEl.innerHTML = '';

  const version = Date.now().toString();
  let link = document.getElementById('runtime-ui-stylesheet');
  if (!link) {
    link = document.createElement('link');
    link.id = 'runtime-ui-stylesheet';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `styles/capsule.css?v=${encodeURIComponent(version)}`;

  let models = parseModels();
  if (models.length === 0 && navigator.gpu) {
    models = [{
      id: 'smollm2-360m',
      name: 'SmolLM2 360M (Auto)',
      provider: 'doppler',
      hostType: 'browser-local'
    }];
    logger.info('[AbsoluteZero] Auto-selected: ' + models[0].name);
  }

  const capsuleRuntime = createCapsuleRuntime({
    goal: awakenInput.goal,
    environment: awakenInput.environment,
    includeHostWithinSelf: awakenInput.includeHostWithinSelf,
    modelConfig: models[0] || null
  });
  const runtimeUI = CapsuleUI.factory({
    CapsuleRuntime: capsuleRuntime
  });

  await runtimeUI.mount(appEl);
  window.REPLOID = {
    mode: 'absolute_zero',
    capsuleRuntime
  };
  window.REPLOID_UI = {
    reload: async () => {},
    getVersion: () => version
  };

  logger.info('[Boot] capsule UI mounted (absolute_zero).');
  capsuleRuntime.start().catch((e) => {
    logger.error('[AbsoluteZero] Capsule runtime error:', e?.message || e);
  });
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
        const runtimeMode = typeof window.getReploidMode === 'function'
          ? window.getReploidMode()
          : 'absolute_zero';

        if (runtimeMode === 'absolute_zero') {
          await completeAbsoluteZeroAwaken(goal, wizardContainer);
          return;
        }

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
