/**
 * @fileoverview Self-owned kernel boot for the browser shell.
 */

import { SELF_BOOT_SPEC, cloneSelfBootSpec, getRouteBootSpec, toSourceWebPath } from '../boot-spec.js';
import {
  createReploidPeerUrl,
  ensureReploidWindowInstance,
  getCurrentReploidInstanceLabel,
  getCurrentReploidSessionStorage as getScopedSessionStorage,
  getCurrentReploidStorage as getScopedLocalStorage
} from '../instance.js';

const BUILD_VERSION = '1735500008';
const IMPORTMAP_ID = 'reploid-doppler-importmap';
const BASE_ID = 'reploid-base';
const CORE_STYLE_ID = 'reploid-core-style';
const BOOT_STYLE_ID = 'reploid-boot-style';
const SW_VERSION_KEY = 'REPLOID_SW_VERSION';

const getBuildVersion = () => String(globalThis.window?.REPLOID_BUILD_VERSION || BUILD_VERSION);
const ensureBaseHref = () => {
  let base = document.getElementById(BASE_ID);
  if (!base) {
    base = document.createElement('base');
    base.id = BASE_ID;
    document.head.prepend(base);
  }
  if (base.getAttribute('href') !== SELF_BOOT_SPEC.baseHref) {
    base.setAttribute('href', SELF_BOOT_SPEC.baseHref);
  }
};

const ensureStylesheet = (id, href) => {
  let link = document.getElementById(id);
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
};

const installDopplerImportMap = () => {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('dopplerBase');
  if (fromQuery) {
    try {
      localStorage.setItem('DOPPLER_BASE_URL', fromQuery);
    } catch {
      // Ignore storage failures.
    }
  }

  let stored = null;
  try {
    stored = localStorage.getItem('DOPPLER_BASE_URL');
  } catch {
    stored = null;
  }

  const base = (fromQuery || stored || '/doppler').replace(/\/$/, '');
  window.DOPPLER_BASE_URL = base;

  const join = (suffix) => `${base}${suffix}`;
  const imports = {
    '@simulatte/doppler': join('/src/index.js'),
    '@simulatte/doppler/provider': join('/src/client/doppler-provider.js'),
    '@simulatte/doppler/bridge/': join('/src/bridge/'),
    '@simulatte/doppler/browser/': join('/src/browser/'),
    '@simulatte/doppler/': join('/src/')
  };

  let script = document.getElementById(IMPORTMAP_ID);
  if (!script) {
    script = document.createElement('script');
    script.id = IMPORTMAP_ID;
    script.type = 'importmap';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify({ imports }, null, 2);
};

const installResetHelpers = () => {
  async function performFullReset() {
    const instanceId = getCurrentReploidInstanceLabel();
    const scopedLocalStorage = getScopedLocalStorage();
    const scopedSessionStorage = getScopedSessionStorage();
    const steps = [];
    const removedLocal = scopedLocalStorage.clearNamespace({
      preserve: (key) => key.includes('KEY_') || key.includes('api_key')
    });
    const removedSession = scopedSessionStorage.clearNamespace();
    steps.push(`Cleared ${removedLocal.length} localStorage key(s) for instance ${instanceId}`);
    if (removedSession.length > 0) {
      steps.push(`Cleared ${removedSession.length} session key(s) for instance ${instanceId}`);
    }

    await clearVFS();

    console.log('[Reset]', steps.join('; '));
    return steps;
  }

  async function clearVFS() {
    try {
      const mod = await import('../host/vfs-bootstrap.js');
      await mod.clearVfsStore();
      const instanceId = getCurrentReploidInstanceLabel();
      console.log(`[Reset] Cleared VFS for instance ${instanceId}`);
      return [`Cleared VFS for instance ${instanceId}`];
    } catch (error) {
      console.log('[Reset] Failed to clear current VFS instance', error?.message || error);
      return [];
    }
  }

  window.shouldResetAll = () => getScopedLocalStorage().getItem('REPLOID_RESET_ALL') === 'true';
  window.performFullReset = performFullReset;
  window.clearVFS = clearVFS;
};

const installRuntimeGlobals = () => {
  const scopedLocalStorage = getScopedLocalStorage();
  window.REPLOID_BOOT_SPEC = cloneSelfBootSpec();
  window.REPLOID_INSTANCE_ID = ensureReploidWindowInstance();
  window.REPLOID_BUILD_VERSION = getBuildVersion();
  window.REPLOID_SW_VERSION = window.REPLOID_BUILD_VERSION;
  window.REPLOID_VFS_VERSION = window.REPLOID_BUILD_VERSION;
  window.getReploidInstanceId = () => getCurrentReploidInstanceLabel();
  window.createReploidPeerUrl = (pathname = window.location.pathname, options = {}) => createReploidPeerUrl(pathname, options);

  window.getExecutionLimits = () => {
    const stored = scopedLocalStorage.getItem('REPLOID_MAX_ITERATIONS');
    const maxIterations = stored === '0' ? Infinity : parseInt(stored, 10) || 25;
    return {
      maxIterations,
      approvalInterval: parseInt(scopedLocalStorage.getItem('REPLOID_APPROVAL_INTERVAL'), 10) || 0
    };
  };

  window.getReploidRouteMode = () => {
    const route = getRouteBootSpec(window.location.pathname || '/');
    return route?.mode || null;
  };

  window.getReploidBootProfile = () => {
    const route = getRouteBootSpec(window.location.pathname || '/');
    return route?.bootProfile || 'wizard';
  };

  window.isReploidHome = () => window.location.pathname === '/';

  window.getReploidMode = () => {
    const routeMode = window.getReploidRouteMode();
    if (routeMode) return routeMode;

    const storedMode = scopedLocalStorage.getItem('REPLOID_MODE');
    if (storedMode === 'zero' || storedMode === 'reploid' || storedMode === 'x') {
      return storedMode;
    }

    const storedGenesis = scopedLocalStorage.getItem('REPLOID_GENESIS_LEVEL');
    if (storedGenesis === 'capsule' || storedGenesis === 'tabula') return 'reploid';
    if (storedGenesis === 'spark') return 'zero';
    if (storedGenesis === 'full' || storedGenesis === 'substrate' || storedGenesis === 'cognition' || storedGenesis === 'reflection') {
      return 'x';
    }
    return 'reploid';
  };

  window.getGenesisLevel = () => {
    const stored = scopedLocalStorage.getItem('REPLOID_GENESIS_LEVEL');
    if (stored) return stored;
    const route = getRouteBootSpec(window.location.pathname || '/');
    return route?.genesisLevel || 'capsule';
  };

  window.getCognitionConfig = () => {
    try {
      return JSON.parse(scopedLocalStorage.getItem('REPLOID_COGNITION_CONFIG') || '{}');
    } catch {
      return {};
    }
  };
};

const ensureServiceWorkerVersion = async () => {
  if (!('serviceWorker' in navigator)) return false;

  const expected = getBuildVersion();
  const current = localStorage.getItem(SW_VERSION_KEY);
  if (current === expected) return false;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) {
      localStorage.setItem(SW_VERSION_KEY, expected);
      return false;
    }
    await Promise.all(registrations.map((registration) => registration.unregister()));
    localStorage.setItem(SW_VERSION_KEY, expected);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

const prepareShell = () => {
  ensureBaseHref();
  document.title = SELF_BOOT_SPEC.title;
  const version = encodeURIComponent(getBuildVersion());
  ensureStylesheet(CORE_STYLE_ID, `styles/rd.css?v=${version}`);
  ensureStylesheet(BOOT_STYLE_ID, `styles/boot.css?v=${version}`);
};

const main = async () => {
  ensureReploidWindowInstance();
  prepareShell();
  installRuntimeGlobals();
  installResetHelpers();
  installDopplerImportMap();

  const reloadingForVersion = await ensureServiceWorkerVersion();
  if (reloadingForVersion) {
    return;
  }

  const seedEntry = `${toSourceWebPath(SELF_BOOT_SPEC.host.seedEntry)}?v=${encodeURIComponent(getBuildVersion())}`;
  await import(seedEntry);
};

main().catch((error) => {
  console.error('[Kernel] Boot failed', error);
  const mount = document.getElementById('wizard-container') || document.body;
  if (mount) {
    mount.style.display = 'block';
    mount.innerHTML = `
      <div class="error-ui border-error">
        <div class="error-ui-header">Kernel boot failed</div>
        <div class="error-ui-message">${String(error?.message || error || 'Unknown kernel error')}</div>
      </div>
    `;
  }
});
