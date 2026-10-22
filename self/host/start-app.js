import { createReploidLauncher } from './reploid-launch.js';
/**
 * @fileoverview Self-owned host launcher for Reploid and the legacy boot modes.
 */

import Utils from '../core/utils.js';
import { SELF_BOOT_SPEC, toSourceWebPath } from '../boot-spec.js';
import { getRuntimeUiSpecByMode } from '../lab/profiles.js';
import { buildDefaultLocalDopplerModelConfig } from '../config/doppler-local-models.js';
import { ZERO_GEMINI_AGENT_THROTTLE } from '../config/zero-inference.js';
import { getCurrentReploidInstanceLabel, getCurrentReploidPeerQuery, getCurrentReploidStorage as getReploidStorage, getSurfaceIdFromUrl } from '../instance.js';

let sharedBootModulesPromise = null;


const MANAGED_SERVER_PROXY_TYPE = 'firebase-function';
const MANAGED_SERVER_PROXY_MAX_ITERATIONS = 99;
const VFS_FILE_CHANGED_EVENTS = Object.freeze([
  'vfs:file_changed',
  'vfs:file-changed'
]);
const ACTIVE_SUBSTRATE_PREFIXES = Object.freeze([
  '/core/',
  '/self/core/',
  '/infrastructure/',
  '/self/infrastructure/',
  '/capabilities/',
  '/self/capabilities/',
  '/boot-helpers/',
  '/self/boot-helpers/',
  '/config/',
  '/self/config/'
]);
const ACTIVE_UI_PREFIXES = Object.freeze([
  '/ui/',
  '/self/ui/',
  '/styles/',
  '/self/styles/',
  '/self/capsule/'
]);
const MODULE_INVALIDATION_PREFIXES = Object.freeze([
  ...ACTIVE_SUBSTRATE_PREFIXES,
  ...ACTIVE_UI_PREFIXES,
  '/tools/',
  '/self/tools/',
  '/shadow/',
  '/personas/',
  '/prompts/'
]);
const MODULE_INVALIDATION_EXTENSIONS = Object.freeze([
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.wgsl',
  '.md',
  '.html'
]);

const stopBootBackgrounds = () => {
  const stopPoolSimulation = window.REPLOID_POOL_SIMULATION_STOP;
  if (typeof stopPoolSimulation === 'function') {
    try {
      stopPoolSimulation();
    } finally {
      window.REPLOID_POOL_SIMULATION_STOP = null;
    }
  }

  const stopLegacyParticleBg = window.stopParticleBg;
  if (typeof stopLegacyParticleBg === 'function') {
    try {
      stopLegacyParticleBg();
    } finally {
      window.stopParticleBg = null;
    }
  }

  document.getElementById('particle-bg-canvas')?.remove();
  document.body?.classList?.remove('particle-active');
};

const normalizeManagedServerProxyMaxIterations = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MANAGED_SERVER_PROXY_MAX_ITERATIONS;
  const limit = Math.floor(parsed);
  if (limit < 1) return MANAGED_SERVER_PROXY_MAX_ITERATIONS;
  return Math.min(limit, MANAGED_SERVER_PROXY_MAX_ITERATIONS);
};


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


const postServiceWorkerMessage = (type, data = {}) => new Promise((resolve) => {
  const controller = navigator.serviceWorker?.controller;
  if (!controller || typeof MessageChannel === 'undefined') {
    resolve(false);
    return;
  }

  const channel = new MessageChannel();
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    channel.port1.onmessage = null;
    resolve(false);
  }, 1000);

  channel.port1.onmessage = (event) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(event.data || true);
  };

  controller.postMessage({ type, data }, [channel.port2]);
});

const isActiveSubstratePath = (path) => (
  typeof path === 'string'
  && ACTIVE_SUBSTRATE_PREFIXES.some((prefix) => path.startsWith(prefix))
);

const isRuntimeUiPath = (path) => (
  typeof path === 'string'
  && ACTIVE_UI_PREFIXES.some((prefix) => path.startsWith(prefix))
);

const isModuleInvalidationPath = (path) => (
  typeof path === 'string'
  && MODULE_INVALIDATION_PREFIXES.some((prefix) => path.startsWith(prefix))
  && MODULE_INVALIDATION_EXTENSIONS.some((extension) => path.endsWith(extension))
);

const getChangedPath = (data = {}) => {
  const path = data?.path || data?.targetPath || data?.newPath || data?.oldPath || '';
  return typeof path === 'string' ? path : '';
};

const loadSharedBootModules = async () => {
  if (!sharedBootModulesPromise) {
    sharedBootModulesPromise = Promise.all([
      import('../boot-helpers/index.js'),
      import('../infrastructure/di-container.js')
    ]).then(([bootHelpers, diContainer]) => ({
      boot: bootHelpers.boot,
      renderErrorUI: bootHelpers.renderErrorUI,
      DIContainer: diContainer.default || diContainer
    }));
  }
  return sharedBootModulesPromise;
};


const launcher = createReploidLauncher({
  reloadInitialUi: true, handleReloadErrors: true, getLogger: () => Utils.factory().logger,
  prepareInput(goal) {
    const storage = getReploidStorage();
    const input = goal && typeof goal === 'object' && !Array.isArray(goal) ? goal : {
      goal, environment: storage.getItem('REPLOID_ENVIRONMENT') || '',
      swarmEnabled: storage.getItem('REPLOID_SWARM_ENABLED') === 'true'
    };
    const hasModel = Object.prototype.hasOwnProperty.call(input, 'modelConfig');
    let models = parseModels();
    if (!hasModel && models.length === 0 && navigator.gpu) {
      const model = buildDefaultLocalDopplerModelConfig();
      models = model ? [model] : [];
    }
    return { ...input, modelConfig: hasModel ? input.modelConfig : models[0] || null };
  }
});
const loadReploidModules = launcher.loadModules;
window.preloadReploidModules = loadReploidModules;


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
  const header = document.createElement('div');
  header.className = 'error-ui-header';
  header.textContent = 'Boot failed';
  const message = document.createElement('div');
  message.className = 'error-ui-message';
  message.textContent = String(err?.message || err || 'Unknown boot failure');
  box.append(header, message);
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
    if (!Array.isArray(parsed)) return [];
    return parsed.map((model) => {
      if (model?.serverType !== MANAGED_SERVER_PROXY_TYPE) return model;
      return {
        ...model,
        maxIterations: normalizeManagedServerProxyMaxIterations(model.maxIterations ?? model.iterationLimit),
        managedServerProxy: true,
        agentThrottle: model.agentThrottle || ZERO_GEMINI_AGENT_THROTTLE
      };
    });
  } catch (e) {
    console.warn('[Boot] Failed to parse SELECTED_MODELS, resetting');
    storage.removeItem('SELECTED_MODELS', { removeLegacy: true });
    return [];
  }
}

/**
 * Complete the awaken process after boot
 */
const normalizeAwakenGoal = (goal) => {
  if (goal && typeof goal === 'object' && !Array.isArray(goal)) {
    return String(goal.goal ?? goal.text ?? goal.objective ?? '').trim();
  }
  return String(goal ?? '').trim();
};

async function completeAwaken(bootResult, goal, wizardContainer, captureCleanup) {
  const { agent, vfs, container, genesisConfig } = bootResult;
  const goalText = normalizeAwakenGoal(goal);
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

  const hitlController = container.hasModule?.('HITLController')
    ? await container.resolve('HITLController') : null;
  const stateManager = await container.resolve('StateManager');
  const appEl = document.getElementById('app');

  const runtimeMode = typeof window.getReploidMode === 'function'
    ? window.getReploidMode()
    : 'zero';

  let dopplerOptimizer = null;
  let toolRunner = null;
  if (container.hasModule?.('DopplerOptimizer')) {
    try {
      [dopplerOptimizer, toolRunner] = await Promise.all([
        container.resolve('DopplerOptimizer'),
        container.resolve('ToolRunner')
      ]);
      await dopplerOptimizer.restoreActiveProfile();
    } catch (error) {
      logger.warn('[Boot] Doppler optimization state unavailable', error?.message || error);
    }
  }

  let runtimeUI = null;
  let disposed = false;
  const subscriptions = [];
  let documentReloadTimer = null;
  let reloadTimer = null;
  let reloadInProgress = false;
  let reloadPending = false;
  let documentReloadRequested = false;
  const handledVfsChangeDetails = new WeakSet();
  captureCleanup(async () => {
    disposed = true;
    clearTimeout(reloadTimer);
    clearTimeout(documentReloadTimer);
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe?.(); }
      catch (error) { logger.warn('[Boot] UI subscription cleanup failed', error); }
    }
    try { await runtimeUI?.cleanup?.(); }
    finally {
      appEl?.replaceChildren();
      appEl?.classList.remove('active');
    }
  });

  const getRuntimeUiSpec = () => (
    getRuntimeUiSpecByMode(runtimeMode)
      || (runtimeMode === 'reploid'
        ? {
            name: 'capsule',
            stylePath: SELF_BOOT_SPEC.runtime.uiStylePath,
            vfsModulePath: SELF_BOOT_SPEC.runtime.uiEntry,
            sourceModulePath: toSourceWebPath(SELF_BOOT_SPEC.runtime.uiEntry)
          }
        : getRuntimeUiSpecByMode('zero'))
  );

  const ensureRuntimeStyles = (version, spec) => {
    const params = new URLSearchParams({
      v: encodeURIComponent(version),
      ...getCurrentReploidPeerQuery()
    });
    const buildStyleHref = (path) => (
      String(path || '').startsWith('/self/')
        ? withSelfQuery(path, Object.fromEntries(params.entries()))
        : `${path}?${params.toString()}`
    );
    const href = buildStyleHref(spec.stylePath);
    let link = document.getElementById('runtime-ui-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.id = 'runtime-ui-stylesheet';
      link.rel = 'stylesheet';
      link.crossOrigin = 'anonymous';
      link.addEventListener('error', () => {
        if (!spec.sourceStylePath || link.dataset.fallbackApplied === 'true') return;
        link.dataset.fallbackApplied = 'true';
        link.href = buildStyleHref(spec.sourceStylePath);
      });
      document.head.appendChild(link);
    }
    if (link.href !== href) {
      link.dataset.fallbackApplied = 'false';
      link.href = href;
    }
  };

  const buildRuntimeUi = async (version, spec) => {
    const peerQuery = getCurrentReploidPeerQuery();
    let mod = null;
    try {
      const vfsUrl = String(spec.vfsModulePath || '').startsWith('/self/')
        ? withSelfQuery(spec.vfsModulePath, { v: version, ...peerQuery })
        : withQuery(spec.vfsModulePath, { v: version, ...peerQuery });
      mod = await import(vfsUrl);
    } catch (error) {
      if (spec.allowSourceFallback === false) {
        throw error;
      }
      mod = await import(withQuery(spec.sourceModulePath, { v: version, ...peerQuery }));
    }
    const runtime = mod.default || mod;
    return runtime.factory({
      Utils: utils,
      EventBus: eventBus,
      AgentLoop: agent,
      StateManager: stateManager,
      ErrorStore: errorStore,
      HITLController: hitlController,
      VFS: vfs,
      WorkerManager: workerManager,
      ArenaHarness: arenaHarness,
      DopplerOptimizer: dopplerOptimizer,
      ToolRunner: toolRunner,
      initialGoal: goalText,
      mode: runtimeMode
    });
  };

  const mountRuntimeUi = async (reason = '') => {
    if (disposed) return;
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
    if (disposed) { await runtimeUI?.cleanup?.(); return; }
    await runtimeUI.mount(appEl);
    if (disposed) { await runtimeUI?.cleanup?.(); return; }
    logger.info(`[Boot] ${spec.name} UI mounted${reason ? ` (${reason})` : ''}.`);
  };

  const reloadUI = async (reason = 'reload') => {
    if (disposed) return;
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

  const scheduleDocumentReload = (reason, path) => {
    if (disposed || documentReloadRequested) return;
    documentReloadRequested = true;
    postServiceWorkerMessage('INVALIDATE_ALL', {
      instanceId: getCurrentReploidInstanceLabel(),
      surfaceId: getSurfaceIdFromUrl(),
      reason,
      path
    }).finally(() => {
      if (!disposed) documentReloadTimer = setTimeout(() => {
        if (!disposed) window.location.reload();
      }, 50);
    });
  };

  const handleVfsChange = (data = {}) => {
    if (disposed) return;
    if (data && typeof data === 'object') {
      if (handledVfsChangeDetails.has(data)) return;
      handledVfsChangeDetails.add(data);
    }

    const path = getChangedPath(data);
    if (!path) return;

    if (isModuleInvalidationPath(path)) {
      void postServiceWorkerMessage('INVALIDATE_MODULE', {
        instanceId: getCurrentReploidInstanceLabel(),
        surfaceId: getSurfaceIdFromUrl(),
        path
      });
    }

    if (isActiveSubstratePath(path)) {
      scheduleDocumentReload('substrate-vfs', path);
      return;
    }

    if (isRuntimeUiPath(path)) {
      scheduleReload('vfs');
    }
  };

  // Remove boot UI
  if (wizardContainer) wizardContainer.remove();
  document.body.classList.add('no-grid-pattern');

  await mountRuntimeUi('initial');

  // Hot-reload UI on VFS changes
  if (eventBus?.on) {
    VFS_FILE_CHANGED_EVENTS.forEach((eventName) => {
      subscriptions.push(eventBus.on(eventName, handleVfsChange));
    });
    subscriptions.push(eventBus.on('promotion:accepted', (data = {}) => {
      const path = getChangedPath(data);
      if (isActiveSubstratePath(path)) {
        scheduleDocumentReload('promotion-substrate', path);
        return;
      }
      if (isRuntimeUiPath(path)) {
        scheduleReload('promotion');
      }
    }));
  }

  window.REPLOID_UI = {
    reload: reloadUI,
    getVersion: () => window.REPLOID_UI_VERSION || 'unknown'
  };

  // Start agent if goal provided
  if (goalText) {
    const storage = getReploidStorage();
    const consensusStrategy = storage.getItem('CONSENSUS_TYPE') || 'arena';
    let models = parseModels();

    if (models.length === 0 && navigator.gpu) {
      const defaultModel = buildDefaultLocalDopplerModelConfig();
      models = defaultModel ? [defaultModel] : [];
      if (models[0]) {
        logger.info('[Boot] Auto-selected: ' + models[0].name);
      }
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

    logger.info('[Boot] Awakening Reploid with goal: ' + goalText);
    agent.run(goalText).catch(e => logger.error('[Boot] Agent error:', e.message));
  }
}


(async () => {
  try {
    // Remove seed-phase progress loader now that start-app has control.
    document.getElementById('boot-vfs-progress')?.remove();

    const runtimeMode = typeof window.getReploidMode === 'function'
      ? window.getReploidMode()
      : 'reploid';
    const routeMode = typeof window.getReploidRouteMode === 'function'
      ? window.getReploidRouteMode()
      : null;
    const bootProfile = typeof window.getReploidBootProfile === 'function'
      ? window.getReploidBootProfile()
      : 'reploid_home';
    const useLockedRouteHome = bootProfile !== 'wizard';

    // Show the appropriate boot UI first, before awaken.
    const wizardContainer = document.getElementById('wizard-container');

    if (wizardContainer) {
      wizardContainer.style.display = 'block';
      if (useLockedRouteHome) {
        if (runtimeMode === 'pool') {
          const { initPoolHome } = await import(withQuery('/ui/pool-home/index.js', getCurrentReploidPeerQuery()));
          initPoolHome(wizardContainer);
        } else if (runtimeMode === 'reploid') {
          const { initReploidHome } = await import(withQuery('/ui/reploid-home/index.js', getCurrentReploidPeerQuery()));
          initReploidHome(wizardContainer, {
            onAwaken: async (payload) => window.triggerAwaken?.(payload)
          });
          loadReploidModules().catch((err) => {
            console.warn('[Boot] Failed to prewarm Reploid modules:', err?.message || err);
          });
        } else if (runtimeMode === 'zero' || runtimeMode === 'x' || routeMode === 'zero' || routeMode === 'x') {
          const { initZeroBootHome } = await import(withQuery('/ui/zero-home/index.js', getCurrentReploidPeerQuery()));
          initZeroBootHome(wizardContainer);
          loadSharedBootModules().catch((err) => {
            console.warn('[Boot] Failed to prewarm shared boot modules:', err?.message || err);
          });
        } else {
          const { initLockedBootHome } = await import(withQuery('/ui/boot-home/index.js', getCurrentReploidPeerQuery()));
          initLockedBootHome(wizardContainer, routeMode || runtimeMode);
          loadSharedBootModules().catch((err) => {
            console.warn('[Boot] Failed to prewarm shared boot modules:', err?.message || err);
          });
        }
      } else {
        const { initWizard: initWizardUI } = await import(withQuery('/ui/boot-wizard/index.js', getCurrentReploidPeerQuery()));
        initWizardUI(wizardContainer);
      }
    }

    window.rotateReploidIdentity = launcher.rotateIdentity;

    // Expose awaken trigger - this runs boot() when user clicks Awaken
    window.triggerAwaken = async (goal) => {
      let bootContainer = null;
      let cleanupCompletion = null;
      const runtimeGlobals = ['REPLOID', 'REPLOID_DI', '__REPLOID_CONTAINER__', 'REPLOID_UI', 'REPLOID_UI_VERSION',
        'downloadReploid', 'downloadTraces', 'importREPLOID'];
      const previousGlobals = runtimeGlobals.map(key => [key, Object.hasOwn(window, key), window[key]]);
      try {
        const runtimeMode = typeof window.getReploidMode === 'function'
          ? window.getReploidMode()
          : 'reploid';

        if (runtimeMode === 'pool') {
          return;
        }

        if (runtimeMode === 'reploid') {
          await launcher.awaken(goal, wizardContainer);
          return;
        }

        stopBootBackgrounds();

        // Ensure the full VFS hydration finished so module imports don't 404 under the SW.
        const fullSeed = window.REPLOID_VFS_FULL_SEED_PROMISE;
        if (fullSeed && typeof fullSeed.then === 'function') {
          console.log('[Boot] Waiting for background VFS hydration...');
          await fullSeed;
        }

        // NOW run the boot sequence
        const { boot, DIContainer } = await loadSharedBootModules();
        const bootResult = await boot(Utils, { ...DIContainer, factory: (...args) => {
          bootContainer = DIContainer.factory(...args);
          return bootContainer;
        } });
        await completeAwaken(bootResult, goal, wizardContainer, cleanup => { cleanupCompletion = cleanup; });
      } catch (err) {
        if (bootContainer) {
          // Revoke only this failed boot's in-memory capabilities, never files
          // or a previously running instance. Do not instantiate new services.
          try {
            const runner = bootContainer.hasInstance('ToolRunner')
              ? await bootContainer.resolve('ToolRunner') : null;
            if (runner?.dispose) runner.dispose();
            else for (const name of runner?.list() || []) runner.unload(name);
          } catch (cleanupError) {
            console.error('[Boot] Failed tool cleanup:', cleanupError);
          }
          try { await cleanupCompletion?.(); }
          catch (cleanupError) { console.error('[Boot] Failed UI cleanup:', cleanupError); }
          try {
            const agent = bootContainer.hasInstance('AgentLoop')
              ? await bootContainer.resolve('AgentLoop') : null;
            await agent?.close?.();
          } catch (cleanupError) {
            console.error('[Boot] Failed runtime cleanup:', cleanupError);
          } finally {
            bootContainer.clearInstances();
            for (const [key, existed, value] of previousGlobals) {
              if (existed) window[key] = value;
              else delete window[key];
            }
          }
        }
        const shared = await loadSharedBootModules().catch(() => null);
        if (shared?.renderErrorUI) shared.renderErrorUI(err);
        else await renderBootFailure(err);
        return { success: false, error: err?.message || String(err) };
      }
    };

  } catch (err) {
    await renderBootFailure(err);
  }
})();
