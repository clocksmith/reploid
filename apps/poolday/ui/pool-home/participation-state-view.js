/**
 * @fileoverview Shows the saved participation preferences on the controls: the request, contribute
 * or both mode, this device's identity, and which request controls are enabled.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { PARTICIPATION_MODES, readParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { getPeerRoomId } from './view.js';
import { errorString } from './control-display-text.js';

export const participationIdentity = createPoolIdentity('requester', {
  localOnly: true,
  namespace: 'network_participation'
});

const canRequestWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.request || preferences.mode === PARTICIPATION_MODES.both
);
export const canContributeWith = (preferences) => (
  preferences.mode === PARTICIPATION_MODES.contribute || preferences.mode === PARTICIPATION_MODES.both
);

const requestControlAvailability = new WeakMap();

const setRequestControlParticipation = (control, canRequest) => {
  if (!canRequest) {
    if (!requestControlAvailability.has(control)) {
      requestControlAvailability.set(control, control.disabled);
    }
    control.disabled = true;
    return;
  }
  if (!requestControlAvailability.has(control)) return;
  control.disabled = requestControlAvailability.get(control);
  requestControlAvailability.delete(control);
};

const shortIdentity = (identity = {}) => {
  const value = String(identity.identityRootId || identity.deviceId || '');
  const fingerprint = value.replace(/^[^_]+_/, '');
  return fingerprint ? `ID ${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}` : 'Identity unavailable';
};

export const refreshParticipationControls = async (preferences = readParticipationPreferences()) => {
  const canRequest = canRequestWith(preferences);
  const canContribute = canContributeWith(preferences);
  document.documentElement.dataset.poolParticipationMode = preferences.mode;
  document.body.dataset.poolParticipationMode = preferences.mode;
  document.querySelectorAll('[data-pool-participation]').forEach((surface) => {
    surface.dataset.participationMode = preferences.mode;
  });
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    const active = button.dataset.poolParticipationMode === preferences.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-pool-request-control], [data-pool-run-surface="run"] input, [data-pool-run-surface="run"] textarea, [data-pool-run-surface="run"] select, [data-pool-run-surface="run"] button').forEach((control) => {
    if (control.closest('[data-pool-participation]')) return;
    setRequestControlParticipation(control, canRequest);
  });
  document.querySelectorAll('.pool-home-ask-dock').forEach((form) => {
    form.hidden = Boolean(form.closest('.pool-home-task')?.querySelector('[data-pool-workflow="documents"][aria-pressed="true"]'));
  });
  document.querySelectorAll('.pool-home-share-toggle').forEach((button) => {
    button.hidden = !canContribute;
  });
  const connectionSummary = document.querySelector('[data-pool-drawer-summary="network-connection"]');
  if (connectionSummary) {
    const modeLabel = preferences.mode === PARTICIPATION_MODES.both
      ? 'Both'
      : preferences.mode === PARTICIPATION_MODES.contribute
        ? 'Contribute'
        : 'Request';
    connectionSummary.textContent = `${getPeerRoomId()} · ${modeLabel}`;
  }
  try {
    const identity = await participationIdentity.getDeviceIdentity();
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = shortIdentity(identity);
      element.dataset.identityProtection = identity.keyProtection;
      element.title = identity.keyProtection === 'passkey'
        ? 'Passkey-bound device identity'
        : identity.keyProtection === 'browser_non_exportable'
          ? 'Non-exportable browser device key'
          : 'Browser identity fallback; use a passkey for stronger protection';
    });
    document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
      button.disabled = identity.keyProtection === 'passkey';
      button.textContent = identity.keyProtection === 'passkey'
        ? 'Passkey protected'
        : 'Protect identity with passkey';
    });
  } catch (error) {
    document.querySelectorAll('[data-pool-device-identity]').forEach((element) => {
      element.textContent = 'Identity unavailable';
      element.title = errorString(error);
    });
  }
  return preferences;
};
