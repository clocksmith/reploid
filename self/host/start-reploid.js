import { createReploidLauncher, withSourceQuery } from './reploid-launch.js';
const launcher = createReploidLauncher();
/**
 * @fileoverview Minimal launcher for the primary Reploid route.
 */

import { getRouteBootSpec } from '../boot-spec.js';
import { getCurrentReploidPeerQuery } from '../instance.js';


const renderInlineBootError = (mount, title, message) => {
  const box = document.createElement('div');
  box.className = 'error-ui border-error';
  const header = document.createElement('div');
  header.className = 'error-ui-header';
  header.textContent = title;
  const body = document.createElement('div');
  body.className = 'error-ui-message';
  body.textContent = message;
  box.append(header, body);
  mount.replaceChildren(box);
};


const renderBootFailure = (error) => {
  console.error('[Reploid] Boot failed', error);
  const mount = document.getElementById('wizard-container') || document.body;
  if (!mount) return;
  mount.style.display = 'block';
  renderInlineBootError(
    mount,
    'Reploid boot failed',
    String(error?.message || error || 'Unknown boot failure')
  );
};

const getRouteSurface = () => {
  const route = getRouteBootSpec(window.location.pathname || '/');
  return route?.surface || null;
};

const isProductSurface = () => {
  const profile = typeof window.getReploidBootProfile === 'function'
    ? window.getReploidBootProfile()
    : null;
  return profile === 'pool_home' || getRouteSurface() === 'pool';
};

const loadPoolHome = async () => {
  const module = await import(withSourceQuery('/ui/pool-home/index.js', {
    ...getCurrentReploidPeerQuery()
  }));
  return module.initPoolHome;
};

const loadReploidHome = async () => {
  const module = await import(withSourceQuery('/ui/reploid-home/index.js', {
    ...getCurrentReploidPeerQuery()
  }));
  return module.initReploidHome;
};

(async () => {
  try {
    const wizardContainer = document.getElementById('wizard-container');
    window.triggerAwaken = async (payload) => launcher.awaken(payload, wizardContainer);
    window.rotateReploidIdentity = launcher.rotateIdentity;

    if (isProductSurface()) {
      const initPoolHome = await loadPoolHome();
      initPoolHome(wizardContainer);
      return;
    }

    const initReploidHome = await loadReploidHome();
    initReploidHome(wizardContainer, {
      onAwaken: (payload) => window.triggerAwaken(payload)
    });
  } catch (error) {
    renderBootFailure(error);
  }
})();
