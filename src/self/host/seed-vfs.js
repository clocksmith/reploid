/**
 * @fileoverview Self-owned VFS seeding entry.
 */

import { SELF_BOOT_SPEC, toSourceWebPath } from '../boot-spec.js';
import {
  getCurrentReploidSessionStorage as getScopedSessionStorage,
  getCurrentReploidStorage as getScopedLocalStorage
} from '../instance.js';
import { loadVfsManifest, seedVfsFromManifest, clearVfsStore } from './vfs-bootstrap.js';
import { pickBootSeedFiles } from '../../config/boot-seed.js';

const log = (...args) => console.log('[Bootstrap]', ...args);
const warn = (...args) => console.warn('[Bootstrap]', ...args);
const error = (...args) => console.error('[Bootstrap]', ...args);
const BOOTSTRAP_STATUS_ID = 'bootstrap-status-copy';
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
        </div>
      </div>
    </div>
  `;
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
  const version = (typeof window !== 'undefined' && window.REPLOID_VFS_VERSION)
    ? `?v=${encodeURIComponent(window.REPLOID_VFS_VERSION)}`
    : '';
  const candidates = [
    SELF_BOOT_SPEC.host.startEntry,
    toSourceWebPath(SELF_BOOT_SPEC.host.startEntry),
    '/entry/start-app.js',
    '/src/entry/start-app.js'
  ];
  let lastError = null;

  for (const path of candidates) {
    try {
      return await import(`${path}${version}`);
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

const ensureServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    window.REPLOID_SW_CONTROLLED = false;
    window.REPLOID_SW_DEGRADED = true;
    warn('Service workers are unavailable. Continuing with network-backed bootstrap.');
    return null;
  }
  setBootstrapStage('service_worker:register');
  const version = (typeof window !== 'undefined' && window.REPLOID_SW_VERSION)
    ? window.REPLOID_SW_VERSION
    : null;
  const swUrl = version
    ? `/sw-module-loader.js?v=${encodeURIComponent(version)}`
    : '/sw-module-loader.js';
  const reg = await waitForServiceWorkerRegister(swUrl, { scope: '/' });
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
  const scopedSessionStorage = getScopedSessionStorage();

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
    renderBootstrapLoading();
    setBootstrapStage('starting');
    await maybeFullReset();

    setBootstrapStage('service_worker');
    await ensureServiceWorker();
    setBootstrapStage('vfs_version');
    const vfsReset = await ensureVfsVersion();

    setBootstrapStage('manifest');
    const { manifest, text } = await loadVfsManifest();
    const preserveOnBoot = !vfsReset && getScopedLocalStorage().getItem('REPLOID_PRESERVE_ON_BOOT') === 'true';
    const bootFiles = pickBootSeedFiles(manifest?.files || []);
    if (bootFiles.length === 0) {
      throw new Error('Boot seed manifest is empty');
    }

    const skipBootVfsPaths = new Set(bootFiles.map((p) => (p.startsWith('/') ? p : `/${p}`)));
    const scheduleFullSeed = () => scheduleIdle(async () => {
      try {
        log(`Background seeding full VFS set (${(manifest?.files || []).length} files)...`);
        return await seedVfsFromManifest(
          manifest,
          {
            preserveOnBoot,
            logger: console,
            manifestText: text,
            skipVfsPaths: skipBootVfsPaths,
            fetchConcurrency: 6
          }
        );
      } catch (e) {
        warn('Background VFS seed failed:', e?.message || e);
        throw e;
      }
    });

    log(`Seeding boot VFS set (${bootFiles.length} files)...`);
    setBootstrapStage('seed_boot');
    await seedVfsFromManifest(
      { files: bootFiles },
      { preserveOnBoot, logger: console, manifestText: text, fetchConcurrency: 16 }
    );

    // Seed the rest of Reploid in the background so Awaken won't hit SW 404s.
    // triggerAwaken awaits this promise before running boot().
    setBootstrapStage('seed_background');
    window.REPLOID_VFS_FULL_SEED_PROMISE = scheduleFullSeed();

    log('Loading start-app.js from VFS...');
    setBootstrapStage('start_app');
    await loadStartApp();
    setBootstrapStage('ready');
  } catch (err) {
    setBootstrapStage(`error:${err?.message || err}`);
    renderBootstrapError(err);
  }
})();
