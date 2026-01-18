/**
 * @fileoverview Bootstrap entry: seed VFS, activate SW, then load boot.js from VFS.
 */

import { loadVfsManifest, seedVfsFromManifest } from './boot/vfs-bootstrap.js';

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

const ensureServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are required for VFS boot');
  }
  const reg = await navigator.serviceWorker.register('./sw-module-loader.js');
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

const maybeFullReset = async () => {
  if (typeof window.shouldResetAll !== 'function') return;
  if (!window.shouldResetAll()) return;

  log('Full reset requested...');
  try {
    await window.performFullReset();
    localStorage.setItem('REPLOID_RESET_ALL', 'false');
  } catch (err) {
    warn('Full reset failed:', err?.message || err);
  }
};

(async () => {
  try {
    await maybeFullReset();

    await ensureServiceWorker();

    const { manifest, text } = await loadVfsManifest();
    const preserveOnBoot = localStorage.getItem('REPLOID_PRESERVE_ON_BOOT') === 'true';
    await seedVfsFromManifest(manifest, { preserveOnBoot, logger: console, manifestText: text });

    log('Loading boot.js from VFS...');
    await import('./boot.js');
  } catch (err) {
    renderBootstrapError(err);
  }
})();
