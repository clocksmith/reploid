/**
 * @fileoverview Boot loader entry: seed VFS, activate SW, then load start-app.js from VFS.
 */

import { loadVfsManifest, seedVfsFromManifest, clearVfsStore } from '../boot-helpers/vfs-bootstrap.js';

const log = (...args) => console.log('[Bootstrap]', ...args);
const warn = (...args) => console.warn('[Bootstrap]', ...args);
const error = (...args) => console.error('[Bootstrap]', ...args);

const renderBootstrapError = (err) => {
  error('Boot failed:', err);
  const container = document.getElementById('wizard-container') || document.body;
  const box = document.createElement('div');
  box.style.cssText = 'padding:16px;margin:16px;border:1px solid #b00;background:#1b0b0b;color:#f6d1d1;font-family:monospace;white-space:pre-wrap;';
  box.textContent = `Bootstrap failed:\n${err?.message || err}`;
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
    await seedVfsFromManifest(manifest, { preserveOnBoot, logger: console, manifestText: text });

    log('Loading start-app.js from VFS...');
    await import('./start-app.js');
  } catch (err) {
    renderBootstrapError(err);
  }
})();
