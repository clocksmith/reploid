/**
 * @fileoverview Self-owned VFS seeding entry.
 */

import { SELF_BOOT_SPEC, toSourceWebPath } from '../boot-spec.js';
import { getRuntimeSelfMirrorsByBootProfile } from '../lab/profiles.js';
import { normalizeVfsPath } from '../lab/mirrors.js';
import {
  getCurrentReploidInstanceId,
  getCurrentReploidSessionStorage as getScopedSessionStorage,
  getCurrentReploidStorage as getScopedLocalStorage
} from '../instance.js';
import {
  loadVfsManifest,
  seedVfsFromManifest,
  clearVfsStore,
  readVfsFile,
  ensureVfsFileMirrors,
  pruneVfsStoreToPaths
} from './vfs-bootstrap.js';
import {
  getBootSeedProfile,
  isLockedHomeBootProfile,
  pickBootSeedFiles,
  shouldAwaitFullManifestBeforeStart,
  shouldHydrateFullManifest
} from '../config/boot-seed.js';

const log = (...args) => console.log('[Bootstrap]', ...args);
const warn = (...args) => console.warn('[Bootstrap]', ...args);
const error = (...args) => console.error('[Bootstrap]', ...args);
const BOOTSTRAP_STATUS_ID = 'bootstrap-status-copy';
const BOOTSTRAP_PROGRESS_ID = 'bootstrap-progress-copy';
const BOOTSTRAP_PROGRESS_BAR_ID = 'bootstrap-progress-bar';
const BOOTSTRAP_STAGE_COPY = Object.freeze({
  starting: 'Preparing browser substrate.',
  service_worker: 'Preparing service worker.',
  'service_worker:register': 'Registering service worker.',
  'service_worker:ready': 'Waiting for service worker readiness.',
  'service_worker:control': 'Checking service worker control.',
  vfs_version: 'Checking VFS version.',
  manifest: 'Loading VFS manifest.',
  seed_boot: 'Seeding the minimal boot payload.',
  seed_background: 'Scheduling the full VFS hydration.',
  start_app: 'Loading the boot interface.',
  ready: 'Boot interface ready.'
});

const renderBootstrapLoading = () => {
  const wizardContainer = document.getElementById('wizard-container');
  if (!wizardContainer) return;
  wizardContainer.style.display = 'block';
  wizardContainer.innerHTML = `
    <div class="wizard-sections wizard-sections-home">
      <div class="wizard-step wizard-stage-placeholder">
        <div class="goal-header">
          <h2 class="type-h1">Booting Reploid</h2>
          <p class="type-caption" id="${BOOTSTRAP_STATUS_ID}">${BOOTSTRAP_STAGE_COPY.starting}</p>
          <div class="bootstrap-progress" aria-live="polite">
            <div class="bootstrap-progress-track">
              <div class="bootstrap-progress-bar" id="${BOOTSTRAP_PROGRESS_BAR_ID}" style="width: 0%"></div>
            </div>
            <p class="type-caption" id="${BOOTSTRAP_PROGRESS_ID}"></p>
          </div>
        </div>
      </div>
    </div>
  `;
};

const prepareBootstrapVisibility = (bootProfile, options = {}) => {
  const { quiet = false } = options;
  const wizardContainer = document.getElementById('wizard-container');
  if (!wizardContainer) return;
  if (!isLockedHomeBootProfile(bootProfile)) {
    renderBootstrapLoading();
    return;
  }

  if (quiet) return;

  // Locked routes (/0, /x): keep wizard-container empty/hidden (boot contract: no
  // wizard content before mirror:done). Show a minimal progress indicator in #app
  // instead so the viewport is never blank during VFS hydration.
  wizardContainer.style.display = 'none';
  wizardContainer.replaceChildren();

  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.innerHTML = `
      <div id="boot-vfs-progress" class="boot-vfs-loader">
        <p class="type-caption" id="${BOOTSTRAP_STATUS_ID}">${BOOTSTRAP_STAGE_COPY.starting}</p>
        <div class="bootstrap-progress" aria-live="polite">
          <div class="bootstrap-progress-track">
            <div class="bootstrap-progress-bar" id="${BOOTSTRAP_PROGRESS_BAR_ID}" style="width: 0%"></div>
          </div>
          <p class="type-caption" id="${BOOTSTRAP_PROGRESS_ID}"></p>
        </div>
      </div>
    `;
  }
};

const setBootstrapStage = (stage) => {
  if (typeof window !== 'undefined') {
    window.REPLOID_BOOTSTRAP_STAGE = stage;
  }
  const statusEl = document.getElementById(BOOTSTRAP_STATUS_ID);
  if (statusEl) {
    statusEl.textContent = BOOTSTRAP_STAGE_COPY[stage] || stage;
  }
};

const setBootstrapProgress = (progress = {}) => {
  if (typeof window !== 'undefined') {
    window.REPLOID_BOOTSTRAP_PROGRESS = progress;
  }
  const total = Number(progress.total || 0);
  const current = Number(progress.current ?? progress.written ?? progress.fetched ?? 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
  const label = progress.label || '';
  const progressEl = document.getElementById(BOOTSTRAP_PROGRESS_ID);
  const barEl = document.getElementById(BOOTSTRAP_PROGRESS_BAR_ID);
  if (progressEl) {
    progressEl.textContent = label;
  }
  if (barEl) {
    barEl.style.width = `${percent}%`;
  }
};

const scheduleIdle = (fn) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return new Promise((resolve) => {
      window.requestIdleCallback(() => resolve(fn()), { timeout: 1500 });
    });
  }
  return new Promise((resolve) => setTimeout(() => resolve(fn()), 0));
};

const renderBootstrapError = (err) => {
  error('Boot failed:', err);
  const wizardContainer = document.getElementById('wizard-container');
  if (wizardContainer) {
    wizardContainer.style.display = 'block';
  }
  const container = wizardContainer || document.body;
  const box = document.createElement('div');
  box.className = 'error-ui border-error';
  const header = document.createElement('div');
  header.className = 'error-ui-header';
  header.textContent = 'Bootstrap failed';
  const message = document.createElement('div');
  message.className = 'error-ui-message';
  message.textContent = err?.message || err;
  box.appendChild(header);
  box.appendChild(message);
  container.appendChild(box);
};

const loadStartApp = async () => {
  const bootProfile = getBootSeedProfile();
  const useSelfOwnedLauncher = bootProfile === 'pool_home'
    || bootProfile === 'reploid_home'
    || bootProfile === 'substrate_console';
  const primaryStartEntry = useSelfOwnedLauncher
    ? SELF_BOOT_SPEC.host.reploidStartEntry || SELF_BOOT_SPEC.host.startEntry
    : SELF_BOOT_SPEC.host.startEntry;
  const buildCandidateUrl = (path) => {
    const url = new URL(path, window.location.origin);
    const currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach((value, key) => {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });
    if (typeof window !== 'undefined' && window.REPLOID_VFS_VERSION) {
      url.searchParams.set('v', window.REPLOID_VFS_VERSION);
    }
    url.searchParams.set('bootstrapper', '1');
    return url.toString();
  };
  const candidates = [
    toSourceWebPath(primaryStartEntry),
    '/entry/start-app.js'
  ];
  let lastError = null;

  for (const path of candidates) {
    try {
      return await import(buildCandidateUrl(path));
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to load start-app.js');
};

const SW_CONTROL_RELOAD_KEY = 'REPLOID_SW_CONTROL_RELOAD';
const VFS_VERSION_KEY = 'REPLOID_VFS_VERSION';
const SW_CONTROL_WAIT_MS = 1500;
const SW_READY_WAIT_MS = 3000;
const SW_REGISTER_WAIT_MS = 3000;
const SW_INSTANCE_REGISTER_ACK_MS = 1000;
const SERVICE_WORKER_BOOT_PROFILES = new Set(['zero_home', 'x_home']);
const SERVICE_WORKER_SCOPE_BY_BOOT_PROFILE = Object.freeze({
  zero_home: '/0',
  x_home: '/x'
});
const LEGACY_ROOT_SERVICE_WORKER_SCOPE = '/';
const SW_LEGACY_ROOT_RELEASE_RELOAD_KEY = 'REPLOID_SW_LEGACY_ROOT_RELEASE_RELOAD';
const BOOT_SEED_READY_PREFIX = 'REPLOID_BOOT_SEED_READY';
const FULL_SEED_READY_PREFIX = 'REPLOID_FULL_SEED_READY';
const WARM_BOOT_PROBE_PATHS = Object.freeze([
  '/boot-spec.js',
  '/host/start-app.js',
  '/lab/profiles.js',
  '/lab/mirrors.js',
  '/config/boot-seed.js',
  '/config/lab-route-profiles.js'
]);

const shouldUseServiceWorkerForBoot = (bootProfile) => SERVICE_WORKER_BOOT_PROFILES.has(bootProfile);

const normalizeServiceWorkerScopePath = (value = '/') => {
  const normalized = String(value || '/').replace(/\/+$/, '') || '/';
  return normalized;
};

const getServiceWorkerScopeForBoot = (bootProfile) => SERVICE_WORKER_SCOPE_BY_BOOT_PROFILE[bootProfile] || null;

const getRegistrationScopePath = (registration) => {
  try {
    const scopeUrl = new URL(registration.scope);
    if (scopeUrl.origin !== window.location.origin) return null;
    return normalizeServiceWorkerScopePath(scopeUrl.pathname);
  } catch {
    return null;
  }
};

const isRegistrationActiveController = (registration) => {
  const controller = navigator.serviceWorker?.controller;
  return !!controller && registration?.active === controller;
};

const releaseLegacyRootServiceWorkers = async () => {
  if (!('serviceWorker' in navigator)) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const rootRegistrations = registrations.filter(
    (registration) => getRegistrationScopePath(registration) === LEGACY_ROOT_SERVICE_WORKER_SCOPE
  );
  if (rootRegistrations.length === 0) return false;
  const controlsCurrentPage = rootRegistrations.some(isRegistrationActiveController);
  await Promise.all(rootRegistrations.map((registration) => registration.unregister()));
  return controlsCurrentPage;
};

const getExpectedVfsVersion = () => (
  (typeof window !== 'undefined' && window.REPLOID_VFS_VERSION)
    ? String(window.REPLOID_VFS_VERSION)
    : 'unversioned'
);

const getSeedReadyKey = (prefix, bootProfile) => `${prefix}:${bootProfile}:${getExpectedVfsVersion()}`;

const isSeedReady = (prefix, bootProfile) => (
  getScopedLocalStorage().getItem(getSeedReadyKey(prefix, bootProfile)) === 'true'
);

const markSeedReady = (prefix, bootProfile) => {
  getScopedLocalStorage().setItem(getSeedReadyKey(prefix, bootProfile), 'true');
};

const isLikelyWarmBoot = (bootProfile) => {
  if (!isLockedHomeBootProfile(bootProfile)) return false;
  const expected = getExpectedVfsVersion();
  const storage = getScopedLocalStorage();
  if (expected !== 'unversioned' && storage.getItem(VFS_VERSION_KEY) !== expected) return false;
  return isSeedReady(BOOT_SEED_READY_PREFIX, bootProfile);
};

const hasWarmBootProbeFiles = async (bootProfile, runtimeSelfMirrors = []) => {
  if (!isLikelyWarmBoot(bootProfile)) return false;
  const probePaths = [
    ...WARM_BOOT_PROBE_PATHS,
    ...runtimeSelfMirrors.map((mirror) => mirror.targetPath)
  ].filter(Boolean);
  const uniquePaths = [...new Set(probePaths)];
  for (const path of uniquePaths) {
    const content = await readVfsFile(path);
    if (content === null) return false;
  }
  return true;
};

const waitForServiceWorkerRegister = async (url, options = {}, timeoutMs = SW_REGISTER_WAIT_MS) => new Promise((resolve) => {
  let settled = false;

  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    resolve(value);
  };

  const timeoutId = setTimeout(() => finish(null), timeoutMs);

  navigator.serviceWorker.register(url, options)
    .then((registration) => finish(registration))
    .catch(() => finish(null));
});

const waitForServiceWorkerReady = async (timeoutMs = SW_READY_WAIT_MS) => {
  if (!('serviceWorker' in navigator)) return false;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };

    const timeoutId = setTimeout(() => finish(false), timeoutMs);

    navigator.serviceWorker.ready
      .then(() => finish(true))
      .catch(() => finish(false));
  });
};

const waitForServiceWorkerControl = async (timeoutMs = SW_CONTROL_WAIT_MS) => {
  if (navigator.serviceWorker.controller) return true;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      clearTimeout(timeoutId);
      resolve(value);
    };

    const onControllerChange = () => {
      finish(!!navigator.serviceWorker.controller);
    };

    const timeoutId = setTimeout(() => {
      finish(!!navigator.serviceWorker.controller);
    }, timeoutMs);

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  });
};

const postServiceWorkerMessageWithAck = (target, message, timeoutMs = SW_INSTANCE_REGISTER_ACK_MS) => new Promise((resolve) => {
  if (!target || typeof MessageChannel === 'undefined') {
    resolve(false);
    return;
  }

  const channel = new MessageChannel();
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    channel.port1.onmessage = null;
    channel.port1.close();
    try {
      channel.port2.close();
    } catch {
      // The worker owns port2 after transfer in browsers that detach it.
    }
    resolve(value);
  };

  const timeoutId = setTimeout(() => finish(false), timeoutMs);
  channel.port1.onmessage = (event) => {
    finish(event.data?.success === true);
  };

  try {
    target.postMessage(message, [channel.port2]);
  } catch {
    finish(false);
  }
});

const registerServiceWorkerInstance = async () => {
  if (!('serviceWorker' in navigator)) return false;
  const instanceId = getCurrentReploidInstanceId();
  if (!instanceId) return false;

  const message = {
    type: 'REGISTER_INSTANCE',
    data: { instanceId }
  };
  const controller = navigator.serviceWorker.controller;
  if (controller) {
    const controllerAcked = await postServiceWorkerMessageWithAck(controller, message);
    if (controllerAcked) return true;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration?.active && registration.active !== controller) {
      return await postServiceWorkerMessageWithAck(registration.active, message);
    }
  } catch {
    // Service worker readiness is already handled by ensureServiceWorker.
  }

  return false;
};

const ensureServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    window.REPLOID_SW_CONTROLLED = false;
    window.REPLOID_SW_DEGRADED = true;
    warn('Service workers are unavailable. Continuing with network-backed bootstrap.');
    return null;
  }
  const bootProfile = getBootSeedProfile();
  const serviceWorkerScope = getServiceWorkerScopeForBoot(bootProfile);
  const scopedSessionStorage = getScopedSessionStorage();
  const legacyRootControlled = await releaseLegacyRootServiceWorkers();
  if (legacyRootControlled) {
    const hasReloaded = scopedSessionStorage.getItem(SW_LEGACY_ROOT_RELEASE_RELOAD_KEY, { legacyFallback: false }) === 'true';
    if (!hasReloaded) {
      scopedSessionStorage.setItem(SW_LEGACY_ROOT_RELEASE_RELOAD_KEY, 'true');
      warn('Reloading to release legacy root service worker control');
      window.location.reload();
      return new Promise(() => {});
    }
  }
  scopedSessionStorage.removeItem(SW_LEGACY_ROOT_RELEASE_RELOAD_KEY);
  setBootstrapStage('service_worker:register');
  const version = (typeof window !== 'undefined' && window.REPLOID_SW_VERSION)
    ? window.REPLOID_SW_VERSION
    : null;
  const serviceWorkerEntry = SELF_BOOT_SPEC.host.serviceWorkerBootstrapEntry || SELF_BOOT_SPEC.host.serviceWorkerEntry;
  const swUrl = version
    ? `${serviceWorkerEntry}?v=${encodeURIComponent(version)}`
    : serviceWorkerEntry;
  const reg = await waitForServiceWorkerRegister(swUrl, { scope: serviceWorkerScope });
  if (!reg) {
    window.REPLOID_SW_CONTROLLED = false;
    window.REPLOID_SW_DEGRADED = true;
    warn('Service worker registration timed out. Continuing with network-backed bootstrap; VFS hot-reload may require a later refresh.');
    return null;
  }
  setBootstrapStage('service_worker:ready');
  const ready = await waitForServiceWorkerReady();
  if (!ready) {
    warn('Service worker readiness timed out. Continuing while checking for control.');
  }
  setBootstrapStage('service_worker:control');
  const hasController = await waitForServiceWorkerControl();
  window.REPLOID_SW_CONTROLLED = hasController;

  if (!hasController) {
    const hasReloaded = scopedSessionStorage.getItem(SW_CONTROL_RELOAD_KEY, { legacyFallback: false }) === 'true';
    if (!hasReloaded) {
      scopedSessionStorage.setItem(SW_CONTROL_RELOAD_KEY, 'true');
      warn('Reloading to allow service worker control');
      window.location.reload();
      return new Promise(() => {});
    }
    scopedSessionStorage.removeItem(SW_CONTROL_RELOAD_KEY);
    window.REPLOID_SW_DEGRADED = true;
    warn('Service worker is active but not controlling this page. Continuing with network-backed bootstrap; VFS hot-reload may require a later refresh.');
    return reg;
  }
  scopedSessionStorage.removeItem(SW_CONTROL_RELOAD_KEY);
  const registeredInstance = await registerServiceWorkerInstance();
  if (!registeredInstance) {
    warn('Service worker instance registration was not acknowledged. Continuing with query/referrer instance resolution.');
  }
  return reg;
};

const ensureVfsVersion = async () => {
  const storage = getScopedLocalStorage();
  const expected = (typeof window !== 'undefined' && window.REPLOID_VFS_VERSION)
    ? window.REPLOID_VFS_VERSION
    : null;
  if (!expected) return false;
  const current = storage.getItem(VFS_VERSION_KEY);
  if (current === expected) return false;
  try {
    await clearVfsStore();
  } catch (err) {
    warn('Failed to clear VFS store:', err?.message || err);
  }
  storage.setItem(VFS_VERSION_KEY, expected);
  return true;
};

const shouldPreserveBootVfs = ({ bootProfile, vfsReset }) => {
  if (vfsReset) return false;
  if (bootProfile === 'reploid_home' || bootProfile === 'substrate_console') return true;
  return getScopedLocalStorage().getItem('REPLOID_PRESERVE_ON_BOOT') === 'true';
};

const maybeFullReset = async () => {
  if (typeof window.shouldResetAll !== 'function') return;
  if (!window.shouldResetAll()) return;

  log('Full reset requested...');
  try {
    await window.performFullReset();
  } catch (err) {
    warn('Full reset failed:', err?.message || err);
  } finally {
    getScopedLocalStorage().setItem('REPLOID_RESET_ALL', 'false');
  }
};

(async () => {
  try {
    const bootProfile = getBootSeedProfile();
    prepareBootstrapVisibility(bootProfile, { quiet: isLikelyWarmBoot(bootProfile) });
    setBootstrapStage('starting');
    await maybeFullReset();

    setBootstrapStage('service_worker');
    if (shouldUseServiceWorkerForBoot(bootProfile)) {
      await ensureServiceWorker();
    } else {
      window.REPLOID_SW_CONTROLLED = false;
      window.REPLOID_SW_DEGRADED = false;
      log(`Skipping service worker for boot profile "${bootProfile}".`);
    }
    setBootstrapStage('vfs_version');
    const vfsReset = await ensureVfsVersion();

    setBootstrapStage('manifest');
    const { manifest, text } = await loadVfsManifest();
    const preserveOnBoot = shouldPreserveBootVfs({ bootProfile, vfsReset });
    const bootFiles = pickBootSeedFiles(manifest?.files || [], bootProfile);
    if (bootFiles.length === 0) {
      throw new Error('Boot seed manifest is empty');
    }
    const runtimeSelfMirrors = getRuntimeSelfMirrorsByBootProfile(bootProfile, manifest?.files || []);
    const bootVfsPaths = new Set(bootFiles.map((path) => normalizeVfsPath(path)));
    const bootRuntimeSelfMirrors = runtimeSelfMirrors.filter((mirror) => bootVfsPaths.has(mirror.sourcePath));
    const warmBootReady = !vfsReset && await hasWarmBootProbeFiles(bootProfile, runtimeSelfMirrors);
    const fullHydrationReady = warmBootReady && isSeedReady(FULL_SEED_READY_PREFIX, bootProfile);
    if (!warmBootReady) {
      prepareBootstrapVisibility(bootProfile);
    }
    const mirrorRuntimeSelf = (progressScope) => {
      if (runtimeSelfMirrors.length === 0) return null;
      return ensureVfsFileMirrors(runtimeSelfMirrors, {
        overwrite: !preserveOnBoot,
        logger: console,
        progressScope,
        onProgress: setBootstrapProgress
      });
    };

    const skipBootVfsPaths = new Set(bootFiles.map((p) => (p.startsWith('/') ? p : `/${p}`)));
    const scheduleFullSeed = () => scheduleIdle(async () => {
      try {
        log(`Background seeding full VFS set (${(manifest?.files || []).length} files)...`);
        const result = await seedVfsFromManifest(
          manifest,
          {
            preserveOnBoot,
            logger: console,
            manifestText: text,
            skipVfsPaths: skipBootVfsPaths,
            fetchConcurrency: 6,
            progressScope: 'full',
            progressLabel: 'Full VFS hydration',
            onProgress: setBootstrapProgress
          }
        );
        await mirrorRuntimeSelf('full');
        markSeedReady(FULL_SEED_READY_PREFIX, bootProfile);
        return result;
      } catch (e) {
        warn('Background VFS seed failed:', e?.message || e);
        throw e;
      }
    });

    if (warmBootReady) {
      log(`Using warm VFS boot profile "${bootProfile}" (${bootFiles.length} boot files already seeded).`);
      setBootstrapProgress({
        scope: 'boot',
        phase: 'warm',
        label: 'Warm VFS boot: boot payload already seeded.',
        total: bootFiles.length,
        current: bootFiles.length,
        written: 0,
        skipped: bootFiles.length
      });
    } else {
      log(`Seeding boot VFS set (${bootFiles.length} files)...`);
      setBootstrapStage('seed_boot');
      await seedVfsFromManifest(
        { files: bootFiles },
        {
          preserveOnBoot,
          logger: console,
          manifestText: text,
          fetchConcurrency: 16,
          progressScope: 'boot',
          progressLabel: 'Boot VFS seed',
          onProgress: setBootstrapProgress
        }
      );
      if (bootRuntimeSelfMirrors.length > 0) {
        await ensureVfsFileMirrors(bootRuntimeSelfMirrors, {
          overwrite: !preserveOnBoot,
          logger: console,
          progressScope: 'boot',
          onProgress: setBootstrapProgress
        });
        if (!preserveOnBoot) {
          await pruneVfsStoreToPaths([
            ...bootFiles.map((path) => (path.startsWith('/') ? path : `/${path}`)),
            ...bootRuntimeSelfMirrors.flatMap((mirror) => [mirror.sourcePath, mirror.targetPath])
          ], {
            logger: console
          });
        }
      }
      markSeedReady(BOOT_SEED_READY_PREFIX, bootProfile);
    }

    if (shouldHydrateFullManifest(bootProfile)) {
      if (fullHydrationReady) {
        window.REPLOID_VFS_FULL_SEED_PROMISE = null;
        log(`Using warm full VFS profile "${bootProfile}"; full hydration already seeded.`);
      } else {
        // Locked route homes wait here so no runtime sees a partial VFS.
        // Other broad modes keep the promise for awaken-time gating.
        setBootstrapStage('seed_background');
        window.REPLOID_VFS_FULL_SEED_PROMISE = scheduleFullSeed();
        if (shouldAwaitFullManifestBeforeStart(bootProfile)) {
          await window.REPLOID_VFS_FULL_SEED_PROMISE;
        }
      }
    } else {
      window.REPLOID_VFS_FULL_SEED_PROMISE = null;
      log(`Skipping full VFS hydration for minimal boot profile "${bootProfile}".`);
    }

    log('Loading start-app.js from VFS...');
    setBootstrapStage('start_app');
    await loadStartApp();
    setBootstrapStage('ready');
  } catch (err) {
    setBootstrapStage(`error:${err?.message || err}`);
    renderBootstrapError(err);
  }
})();
