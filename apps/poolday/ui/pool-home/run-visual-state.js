/**
 * @fileoverview Visual network and run state: writes the observed room and run state to the
 * marked controls and announces it to listeners. Decoration follows recorded state only.
 */
import { getPeerRelayMode } from '../../host/product-context.js';
import { POOLDAY_NETWORK_VISUAL_EVENT, POOLDAY_RUN_VISUAL_EVENT } from './constants.js';
import { resolvePoolNetworkVisualState } from './network-projection.js';

export const applyPoolNetworkVisualState = (summary = null) => {
  const visual = resolvePoolNetworkVisualState(summary);
  const status = visual.available
    ? `${visual.peerCount} live tab${visual.peerCount === 1 ? '' : 's'}, ${visual.providerCount} contributor${visual.providerCount === 1 ? '' : 's'}, ${visual.messageCount} message${visual.messageCount === 1 ? '' : 's'}`
    : 'room status unavailable';
  for (const connection of document.querySelectorAll('[data-pool-connection-activity]')) {
    connection.textContent = visual.available
      ? `${visual.peerCount} tab${visual.peerCount === 1 ? '' : 's'} · ${visual.providerCount} contributor${visual.providerCount === 1 ? '' : 's'}`
      : getPeerRelayMode() === 'local'
        ? 'Local tab · live discovery'
        : 'Checking live room';
  }
  for (const control of document.querySelectorAll('[data-pool-network-state]')) {
    control.dataset.networkMode = visual.mode;
    control.setAttribute('aria-label', `Live Network, ${status}`);
    control.setAttribute('title', status);
    const badge = control.querySelector('[data-pool-network-count]');
    if (badge) {
      const count = Math.max(visual.peerCount, visual.liveParticipantCount);
      badge.textContent = String(count);
      badge.hidden = visual.mode === 'simulation';
    }
    const label = control.querySelector('[data-pool-network-label]');
    if (label) {
      label.textContent = !visual.available
        ? 'Unavailable'
        : visual.providerCount > 0
          ? `${visual.providerCount} provider${visual.providerCount === 1 ? '' : 's'}`
          : visual.peerCount > 0
            ? `${visual.peerCount} peer${visual.peerCount === 1 ? '' : 's'}`
            : summary
              ? '0 peers'
              : 'Searching';
    }
  }
  for (const state of document.querySelectorAll('[data-pool-pack-provider-state]')) {
    state.textContent = !visual.available
      ? 'Unavailable'
      : visual.providerCount > 0
        ? `${visual.providerCount} available`
        : summary
          ? 'No providers'
          : 'Searching';
  }
  for (const shell of document.querySelectorAll('.pool-simulation-shell')) {
    shell.dataset.networkMode = visual.mode;
  }
  window.REPLOID_POOL_NETWORK_VISUAL_STATE = visual;
  window.dispatchEvent(new CustomEvent(POOLDAY_NETWORK_VISUAL_EVENT, { detail: visual }));
  return visual;
};

const RUN_STATE_COPY = Object.freeze({
  idle: 'Ready',
  submitting: 'Preparing request',
  running: 'Running on the network',
  complete: 'Answer verified',
  error: 'Run needs attention',
  inspecting: 'Inspecting proof'
});

export const setPoolRunVisualState = ({ state = 'idle', phase = '', message = '' } = {}) => {
  const visual = {
    state,
    phase,
    message: message || RUN_STATE_COPY[state] || RUN_STATE_COPY.idle
  };
  const outputVisible = ['complete', 'error', 'inspecting'].includes(visual.state);
  for (const surface of document.querySelectorAll('[data-pool-run-surface]')) {
    surface.dataset.runState = visual.state;
    surface.dataset.runPhase = visual.phase;
  }
  for (const status of document.querySelectorAll('[data-pool-run-status]')) {
    status.textContent = visual.message;
  }
  for (const status of document.querySelectorAll('[data-pool-brand-status]')) {
    status.textContent = visual.state === 'idle' ? '' : visual.message;
    status.hidden = visual.state === 'idle';
  }
  for (const output of document.querySelectorAll('[data-pool-run-output]')) {
    const documentsSelected = output.closest('.pool-home-task')?.querySelector('[data-pool-workflow="documents"][aria-pressed="true"]');
    output.hidden = !outputVisible || Boolean(documentsSelected);
  }
  window.REPLOID_POOL_RUN_VISUAL_STATE = visual;
  window.dispatchEvent(new CustomEvent(POOLDAY_RUN_VISUAL_EVENT, { detail: visual }));
  return visual;
};
