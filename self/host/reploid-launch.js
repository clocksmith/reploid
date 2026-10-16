import { SELF_BOOT_SPEC, toSourceWebPath } from '../boot-spec.js';
import { clearRequestedFreshIdentity, getCurrentReploidInstanceLabel, getCurrentReploidPeerQuery, hasRequestedFreshIdentity } from '../instance.js';

export const withSourceQuery = (path, query = {}) => {
  const url = new URL(toSourceWebPath(path), window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};
const withVfsQuery = (path, query = {}) => {
  const url = new URL(path, window.location.origin);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};
const normalizeAwakenInput = input => (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : {
        goal: input,
        environment: '',
        swarmEnabled: true,
        modelConfig: null,
        seedOverrides: {}
      };

export function createReploidLauncher({ prepareInput = normalizeAwakenInput, getLogger = () => console, reloadInitialUi = false, handleReloadErrors = false } = {}) {
  let reploidModulesPromise = null;
  let consumeFreshIdentityOnNextAwaken = hasRequestedFreshIdentity();
  if (consumeFreshIdentityOnNextAwaken) clearRequestedFreshIdentity();
  const loadReploidModules = async () => {
    if (!reploidModulesPromise) {
      reploidModulesPromise = Promise.all([
        import(withSourceQuery(SELF_BOOT_SPEC.runtime.runtimeEntry, {
          bootstrapper: 1,
          ...getCurrentReploidPeerQuery()
        })),
        import(withSourceQuery(SELF_BOOT_SPEC.runtime.uiEntry, {
          bootstrapper: 1,
          ...getCurrentReploidPeerQuery()
        }))
      ]).then(([runtimeModule, capsuleModule]) => ({
        createSelfRuntime: runtimeModule.createSelfRuntime,
        CapsuleUI: capsuleModule.default || capsuleModule
      }));
    }
    return reploidModulesPromise;
  };

  const loadCapsuleUi = async ({ version = Date.now().toString(), preferVfs = false } = {}) => {
    const query = { v: version, ...getCurrentReploidPeerQuery() };
    if (preferVfs) {
      try {
        const vfsModule = await import(withVfsQuery(SELF_BOOT_SPEC.runtime.uiEntry, query));
        return vfsModule.default || vfsModule;
      } catch {
        // Fall through to the source capsule below.
      }
    }

    const sourceModule = await import(withSourceQuery(SELF_BOOT_SPEC.runtime.uiEntry, {
      bootstrapper: 1,
      ...query
    }));
    return sourceModule.default || sourceModule;
  };

  const ensureCapsuleStyles = (version) => {
    let link = document.getElementById('runtime-ui-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.id = 'runtime-ui-stylesheet';
      link.rel = 'stylesheet';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
    link.href = withSourceQuery(SELF_BOOT_SPEC.runtime.uiStylePath, {
      v: version,
      ...getCurrentReploidPeerQuery()
    });
  };

  const completeReploidAwaken = async (input, wizardContainer) => {
    const awakenInput = prepareInput(input);
    const logger = getLogger();
    const appEl = document.getElementById('app');

    if (!appEl) {
      throw new Error('Missing #app container');
    }

    if (wizardContainer) wizardContainer.remove();
    document.body.classList.add('no-grid-pattern');
    appEl.classList.add('active');
    appEl.innerHTML = '';

    const { createSelfRuntime, CapsuleUI } = await loadReploidModules();
    const runtime = createSelfRuntime({
      instanceId: getCurrentReploidInstanceLabel(),
      goal: awakenInput.goal,
      environment: awakenInput.environment,
      swarmEnabled: !!awakenInput.swarmEnabled,
      modelConfig: awakenInput.modelConfig || null,
      seedOverrides: awakenInput.seedOverrides || {},
      forceFreshIdentity: consumeFreshIdentityOnNextAwaken
    });
    consumeFreshIdentityOnNextAwaken = false;

    let runtimeUI = null;
    let reloadTimer = null;
    let reloadInProgress = false;
    let reloadPending = false;
    let pendingPreferVfsReload = false;

    const mountCapsuleUi = async (reason = '', { preferVfs = false } = {}) => {
      if (runtimeUI?.cleanup) {
        try {
          runtimeUI.cleanup();
        } catch {
          // Ignore stale UI cleanup failures during hot reload.
        }
      }

      appEl.innerHTML = '';
      const version = Date.now().toString();
      window.REPLOID_UI_VERSION = version;
      ensureCapsuleStyles(version);

      const Capsule = (preferVfs || reloadInitialUi)
        ? await loadCapsuleUi({ version, preferVfs })
        : CapsuleUI;
      runtimeUI = Capsule.factory({ runtime });
      await runtimeUI.mount(appEl);
      console.info(`[Reploid] Capsule mounted${reason ? ` (${reason})` : ''}.`);
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
        if (!handleReloadErrors) throw error;
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
      getVersion: () => window.REPLOID_UI_VERSION || 'unknown'
    };

    runtime.start().catch((error) => {
      console.error('[Reploid] Runtime error:', error?.message || error);
    });
  };
  const rotateIdentity = async (options = {}) => {
    const runtime = window.REPLOID?.runtime;
    if (runtime && typeof runtime.rotateIdentity === 'function') return runtime.rotateIdentity(options);
    const { rotateIdentityBundle } = await import('../identity.js');
    return rotateIdentityBundle({ ...options, instanceId: getCurrentReploidInstanceLabel(),
      retireLegacy: options.retireLegacy !== false, cryptoApi: globalThis.crypto });
  };
  return { awaken: completeReploidAwaken, loadModules: loadReploidModules, rotateIdentity };
}
