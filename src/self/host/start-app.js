/**
 * @fileoverview Self-owned host launcher for Reploid and the legacy boot modes.
 */

import Utils from '../../core/utils.js';
import { SELF_BOOT_SPEC, toSourceWebPath } from '../boot-spec.js';
import { rotateIdentityBundle } from '../identity.js';
import {
  clearRequestedFreshIdentity,
  getCurrentReploidInstanceLabel,
  getCurrentReploidPeerQuery,
  getCurrentReploidStorage as getReploidStorage,
  hasRequestedFreshIdentity
} from '../instance.js';

let sharedBootModulesPromise = null;
let reploidModulesPromise = null;
let consumeFreshIdentityOnNextAwaken = hasRequestedFreshIdentity();

if (consumeFreshIdentityOnNextAwaken) {
  clearRequestedFreshIdentity();
}

const withQuery = (path, query = {}) => {
  const url = new URL(toSourceWebPath(path), window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const withSelfQuery = (path, query = {}) => {
  const url = new URL(path, window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const withBootstrapQuery = (path, query = {}) => withSelfQuery(path, {
  bootstrapper: 1,
  ...query
});

const loadSharedBootModules = async () => {
  if (!sharedBootModulesPromise) {
    sharedBootModulesPromise = Promise.all([
      import('../../boot-helpers/index.js'),
      import('../../infrastructure/di-container.js')
    ]).then(([bootHelpers, diContainer]) => ({
      boot: bootHelpers.boot,
      renderErrorUI: bootHelpers.renderErrorUI,
      DIContainer: diContainer.default || diContainer
    }));
  }
  return sharedBootModulesPromise;
};

const loadReploidModules = async () => {
  if (!reploidModulesPromise) {
    reploidModulesPromise = Promise.all([
      import(withBootstrapQuery(SELF_BOOT_SPEC.runtime.runtimeEntry, getCurrentReploidPeerQuery())),
      import(withBootstrapQuery(SELF_BOOT_SPEC.runtime.uiEntry, getCurrentReploidPeerQuery()))
    ]).then(([runtimeMod, capsuleUiMod]) => ({
      createSelfRuntime: runtimeMod.createSelfRuntime,
      CapsuleUI: capsuleUiMod.default || capsuleUiMod
    }));
  }
  return reploidModulesPromise;
};

window.preloadReploidModules = loadReploidModules;

const loadReploidCapsuleUi = async ({ version = Date.now().toString(), preferVfs = false } = {}) => {
  const query = { v: version, ...getCurrentReploidPeerQuery() };
  let sourceError = null;

  if (preferVfs) {
    try {
      const vfsModule = await import(withSelfQuery(SELF_BOOT_SPEC.runtime.uiEntry, query));
      return vfsModule.default || vfsModule;
    } catch (error) {
      sourceError = error;
    }
  }

  try {
    const sourceModule = await import(withBootstrapQuery(SELF_BOOT_SPEC.runtime.uiEntry, query));
    return sourceModule.default || sourceModule;
  } catch (error) {
    throw sourceError || error;
  }
};

const renderBootFailure = async (err) => {
  console.error('[Boot] CRITICAL BOOT FAILURE', err);
  try {
    const { renderErrorUI } = await loadSharedBootModules();
    renderErrorUI(err);
    return;
  } catch (fallbackErr) {
    console.error('[Boot] Error UI fallback failed', fallbackErr);
  }

  const mount = document.getElementById('wizard-container') || document.body;
  if (!mount) return;

  const box = document.createElement('div');
  box.className = 'error-ui border-error';
  box.innerHTML = `
    <div class="error-ui-header">Boot failed</div>
    <div class="error-ui-message">${String(err?.message || err || 'Unknown boot failure')}</div>
  `;
  mount.appendChild(box);
};

/**
 * Parse models from localStorage with fallback
 */
function parseModels() {
  const storage = getReploidStorage();
  try {
    const saved = storage.getItem('SELECTED_MODELS');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[Boot] Failed to parse SELECTED_MODELS, resetting');
    storage.removeItem('SELECTED_MODELS', { removeLegacy: true });
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
            vfsModulePath: '/ui/proto/index.js',
            sourceModulePath: '/ui/proto/index.js'
          }
      : runtimeMode === 'reploid'
        ? {
            name: 'capsule',
            stylePath: SELF_BOOT_SPEC.runtime.uiStylePath,
            vfsModulePath: SELF_BOOT_SPEC.runtime.uiEntry,
            sourceModulePath: toSourceWebPath(SELF_BOOT_SPEC.runtime.uiEntry)
          }
        : {
            name: 'zero',
            stylePath: 'styles/zero.css',
            vfsModulePath: '/ui/zero/index.js',
            sourceModulePath: '/ui/zero/index.js'
          }
  );

  const ensureRuntimeStyles = (version, spec) => {
    const params = new URLSearchParams({
      v: encodeURIComponent(version),
      ...getCurrentReploidPeerQuery()
    });
    const href = `${spec.stylePath}?${params.toString()}`;
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
    const peerQuery = getCurrentReploidPeerQuery();
    let mod = null;
    try {
      mod = await import(withQuery(spec.vfsModulePath, { v: version, ...peerQuery }));
    } catch (error) {
      mod = await import(withQuery(spec.sourceModulePath, { v: version, ...peerQuery }));
    }
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
      if (path.startsWith('/ui/') || path.startsWith('/styles/') || path.startsWith('/self/capsule/')) {
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
    const storage = getReploidStorage();
    const consensusStrategy = storage.getItem('CONSENSUS_TYPE') || 'arena';
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

    logger.info('[Boot] Awakening Reploid with goal: ' + goal);
    agent.run(goal).catch(e => logger.error('[Boot] Agent error:', e.message));
  }
}

async function completeReploidAwaken(goal, wizardContainer) {
  const storage = getReploidStorage();
  const awakenInput = (goal && typeof goal === 'object' && !Array.isArray(goal))
    ? goal
    : {
        goal,
        environment: storage.getItem('REPLOID_ENVIRONMENT') || '',
        swarmEnabled: storage.getItem('REPLOID_SWARM_ENABLED') === 'true'
      };
  const utils = Utils.factory();
  const logger = utils.logger;
  const appEl = document.getElementById('app');

  if (!appEl) {
    throw new Error('Missing #app container');
  }

  const { createSelfRuntime } = await loadReploidModules();

  if (wizardContainer) wizardContainer.remove();
  document.body.classList.add('no-grid-pattern');
  appEl.classList.add('active');
  appEl.innerHTML = '';

  const version = Date.now().toString();

  let models = parseModels();
  const hasExplicitModelConfig = Object.prototype.hasOwnProperty.call(awakenInput, 'modelConfig');
  if (!hasExplicitModelConfig && models.length === 0 && navigator.gpu) {
    models = [{
      id: 'smollm2-360m',
      name: 'SmolLM2 360M (Auto)',
      provider: 'doppler',
      hostType: 'browser-local'
    }];
    logger.info('[Reploid] Auto-selected: ' + models[0].name);
  }

  const modelConfig = hasExplicitModelConfig ? awakenInput.modelConfig : (models[0] || null);

  const runtime = createSelfRuntime({
    instanceId: getCurrentReploidInstanceLabel(),
    goal: awakenInput.goal,
    environment: awakenInput.environment,
    swarmEnabled: awakenInput.swarmEnabled,
    modelConfig,
    seedOverrides: awakenInput.seedOverrides,
    forceFreshIdentity: consumeFreshIdentityOnNextAwaken
  });
  consumeFreshIdentityOnNextAwaken = false;
  let runtimeUI = null;
  let reloadTimer = null;
  let reloadInProgress = false;
  let reloadPending = false;
  let pendingPreferVfsReload = false;

  const ensureCapsuleStyles = (nextVersion) => {
    let link = document.getElementById('runtime-ui-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.id = 'runtime-ui-stylesheet';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = withQuery(SELF_BOOT_SPEC.runtime.uiStylePath, { v: nextVersion, ...getCurrentReploidPeerQuery() });
  };

  const mountCapsuleUi = async (reason = '', { preferVfs = false } = {}) => {
    if (runtimeUI?.cleanup) {
      try {
        runtimeUI.cleanup();
      } catch (error) {
        logger.debug('[Boot] Capsule cleanup failed', error?.message || error);
      }
    }

    appEl.classList.add('active');
    appEl.innerHTML = '';

    const nextVersion = Date.now().toString();
    window.REPLOID_UI_VERSION = nextVersion;
    ensureCapsuleStyles(nextVersion);

    const CapsuleUI = await loadReploidCapsuleUi({
      version: nextVersion,
      preferVfs
    });
    runtimeUI = CapsuleUI.factory({ runtime });
    await runtimeUI.mount(appEl);
    logger.info(`[Boot] Capsule shell mounted (reploid${reason ? `: ${reason}` : ''}).`);
  };

  const reloadCapsuleUi = async (reason = 'manual', { preferVfs = false } = {}) => {
    if (reloadInProgress) {
      reloadPending = true;
      pendingPreferVfsReload = pendingPreferVfsReload || preferVfs;
      return;
    }

    reloadInProgress = true;
    try {
      await mountCapsuleUi(reason, { preferVfs });
    } catch (error) {
      logger.error('[Boot] Capsule reload failed:', error?.message || error);
    } finally {
      reloadInProgress = false;
      if (reloadPending) {
        const nextPreferVfs = pendingPreferVfsReload;
        reloadPending = false;
        pendingPreferVfsReload = false;
        void reloadCapsuleUi('pending', { preferVfs: nextPreferVfs });
      }
    }
  };

  const scheduleCapsuleReload = (reason = 'vfs', { preferVfs = false } = {}) => {
    pendingPreferVfsReload = pendingPreferVfsReload || preferVfs;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      const nextPreferVfs = pendingPreferVfsReload;
      pendingPreferVfsReload = false;
      void reloadCapsuleUi(reason, { preferVfs: nextPreferVfs });
    }, 150);
  };

  await mountCapsuleUi('initial');

  if (typeof runtime.on === 'function') {
    runtime.on('file-changed', (data = {}) => {
      const path = data?.path || '';
      if (typeof path !== 'string') return;
      if (path === SELF_BOOT_SPEC.runtime.uiEntry || path.startsWith('/self/capsule/')) {
        scheduleCapsuleReload('self-vfs', { preferVfs: true });
      }
    });
  }

  window.REPLOID = {
    mode: 'reploid',
    instanceId: getCurrentReploidInstanceLabel(),
    runtime
  };
  window.REPLOID_UI = {
    reload: async (reason = 'manual') => reloadCapsuleUi(reason, { preferVfs: true }),
    getVersion: () => window.REPLOID_UI_VERSION || version
  };
  runtime.start().catch((e) => {
    logger.error('[Reploid] Runtime error:', e?.message || e);
  });
}

(async () => {
  try {
    const runtimeMode = typeof window.getReploidMode === 'function'
      ? window.getReploidMode()
      : 'reploid';
    const routeMode = typeof window.getReploidRouteMode === 'function'
      ? window.getReploidRouteMode()
      : null;
    const bootProfile = typeof window.getReploidBootProfile === 'function'
      ? window.getReploidBootProfile()
      : 'wizard';
    const useLockedRouteHome = bootProfile !== 'wizard';

    // Show the appropriate boot UI first, before awaken.
    const wizardContainer = document.getElementById('wizard-container');

    if (wizardContainer) {
      wizardContainer.style.display = 'block';
      if (useLockedRouteHome) {
        const { initLockedBootHome } = await import('/ui/boot-home/index.js');
        initLockedBootHome(wizardContainer, routeMode || runtimeMode);
        if (runtimeMode === 'reploid') {
          loadReploidModules().catch((err) => {
            console.warn('[Boot] Failed to prewarm Reploid modules:', err?.message || err);
          });
        } else {
          loadSharedBootModules().catch((err) => {
            console.warn('[Boot] Failed to prewarm shared boot modules:', err?.message || err);
          });
        }
      } else {
        const { initWizard: initWizardUI } = await import('/ui/boot-wizard/index.js');
        initWizardUI(wizardContainer);
      }
    }

    window.rotateReploidIdentity = async (options = {}) => {
      const runtime = window.REPLOID?.runtime;
      if (runtime && typeof runtime.rotateIdentity === 'function') {
        return runtime.rotateIdentity(options);
      }

      return rotateIdentityBundle({
        ...options,
        instanceId: getCurrentReploidInstanceLabel(),
        retireLegacy: options.retireLegacy !== false,
        cryptoApi: globalThis.crypto
      });
    };

    // Expose awaken trigger - this runs boot() when user clicks Awaken
    window.triggerAwaken = async (goal) => {
      try {
        const runtimeMode = typeof window.getReploidMode === 'function'
          ? window.getReploidMode()
          : 'reploid';

        if (runtimeMode === 'reploid') {
          await completeReploidAwaken(goal, wizardContainer);
          return;
        }

        // Ensure the full VFS hydration finished so module imports don't 404 under the SW.
        const fullSeed = window.REPLOID_VFS_FULL_SEED_PROMISE;
        if (fullSeed && typeof fullSeed.then === 'function') {
          console.log('[Boot] Waiting for background VFS hydration...');
          await fullSeed;
        }

        // NOW run the boot sequence
        const { boot, renderErrorUI, DIContainer } = await loadSharedBootModules();
        const bootResult = await boot(Utils, DIContainer);
        await completeAwaken(bootResult, goal, wizardContainer);
      } catch (err) {
        const shared = await loadSharedBootModules().catch(() => null);
        if (shared?.renderErrorUI) {
          shared.renderErrorUI(err);
          return;
        }
        await renderBootFailure(err);
      }
    };

  } catch (err) {
    await renderBootFailure(err);
  }
})();
