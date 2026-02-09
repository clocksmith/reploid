/**
 * @fileoverview Boot loader entry: seed VFS, activate SW, then load start-app.js from VFS.
 */

import { loadVfsManifest, seedVfsFromManifest, clearVfsStore } from '../boot-helpers/vfs-bootstrap.js';

const log = (...args) => console.log('[Bootstrap]', ...args);
const warn = (...args) => console.warn('[Bootstrap]', ...args);
const error = (...args) => console.error('[Bootstrap]', ...args);

const BOOT_SEED_PREFIXES = [
  'entry/',
  'boot-helpers/',
  'ui/boot-wizard/',
  'config/module-resolution.js',
  'config/genesis-levels.json',
  'config/module-registry.json',
  'config/vfs-manifest.json',
  'core/utils.js',
  'core/security-config.js',
  'infrastructure/di-container.js',
  'styles/boot.css',
  'styles/rd.css',
  'styles/rd-tokens.css',
  'styles/rd-primitives.css',
  'styles/rd-components.css'
];

const pickBootSeedFiles = (files) => {
  const out = [];
  const seen = new Set();
  for (const file of files || []) {
    if (typeof file !== 'string') continue;
    if (!BOOT_SEED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  out.sort();
  return out;
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
  const container = document.getElementById('wizard-container') || document.body;
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

const SW_CONTROL_RELOAD_KEY = 'REPLOID_SW_CONTROL_RELOAD';
const VFS_VERSION_KEY = 'REPLOID_VFS_VERSION';

const ensureServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are required for VFS boot');
  }
  const version = (typeof window !== 'undefined' && window.REPLOID_SW_VERSION)
    ? window.REPLOID_SW_VERSION
    : null;
  const swUrl = version
    ? `/sw-module-loader.js?v=${encodeURIComponent(version)}`
    : '/sw-module-loader.js';
  const reg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    const hasReloaded = sessionStorage.getItem(SW_CONTROL_RELOAD_KEY) === 'true';
    if (!hasReloaded) {
      sessionStorage.setItem(SW_CONTROL_RELOAD_KEY, 'true');
      warn('Reloading to allow service worker control');
      window.location.reload();
      return new Promise(() => {});
    }
    throw new Error('Service worker not controlling page');
  }
  sessionStorage.removeItem(SW_CONTROL_RELOAD_KEY);
  return reg;
};

const ensureVfsVersion = async () => {
  const expected = (typeof window !== 'undefined' && window.REPLOID_VFS_VERSION)
    ? window.REPLOID_VFS_VERSION
    : null;
  if (!expected) return false;
  const current = localStorage.getItem(VFS_VERSION_KEY);
  if (current === expected) return false;
  try {
    await clearVfsStore();
  } catch (err) {
    warn('Failed to clear VFS store:', err?.message || err);
  }
  localStorage.setItem(VFS_VERSION_KEY, expected);
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
    localStorage.setItem('REPLOID_RESET_ALL', 'false');
  }
};

(async () => {
  try {
    await maybeFullReset();

    await ensureServiceWorker();
    const vfsReset = await ensureVfsVersion();

    const { manifest, text } = await loadVfsManifest();
    const preserveOnBoot = !vfsReset && localStorage.getItem('REPLOID_PRESERVE_ON_BOOT') === 'true';
    const bootFiles = pickBootSeedFiles(manifest?.files || []);
    if (bootFiles.length === 0) {
      throw new Error('Boot seed manifest is empty');
    }

    log(`Seeding boot VFS set (${bootFiles.length} files)...`);
    await seedVfsFromManifest(
      { files: bootFiles },
      { preserveOnBoot, logger: console, manifestText: text, fetchConcurrency: 6 }
    );

    // Seed the rest of Reploid in the background so Awaken won't hit SW 404s.
    // triggerAwaken awaits this promise before running boot().
    const skipBootVfsPaths = new Set(bootFiles.map((p) => (p.startsWith('/') ? p : `/${p}`)));
    window.REPLOID_VFS_FULL_SEED_PROMISE = scheduleIdle(async () => {
      try {
        log(`Background seeding full VFS set (${(manifest?.files || []).length} files)...`);
        return await seedVfsFromManifest(
          manifest,
          {
            preserveOnBoot,
            logger: console,
            manifestText: text,
            skipVfsPaths: skipBootVfsPaths,
            fetchConcurrency: 3
          }
        );
      } catch (e) {
        warn('Background VFS seed failed:', e?.message || e);
        throw e;
      }
    });

    log('Loading start-app.js from VFS...');
    await import('./start-app.js');
  } catch (err) {
    renderBootstrapError(err);
  }
})();
