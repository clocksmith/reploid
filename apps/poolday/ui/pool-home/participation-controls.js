/**
 * @fileoverview Binds the network participation mode controls. A saved mode change is applied to
 * the provider contribution controller before the controls refresh.
 */
import { readParticipationPreferences, writeParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { errorString } from './control-display-text.js';
import { participationIdentity, refreshParticipationControls } from './participation-state-view.js';
import { getProviderContributionController } from './provider-controls.js';

const updateParticipationPreference = async (nextPreferences) => {
  const previous = readParticipationPreferences();
  const next = writeParticipationPreferences(nextPreferences);
  await getProviderContributionController().applyParticipationPreferences(previous, next);
  await refreshParticipationControls(next);
  return next;
};

export const bindParticipationControls = () => {
  document.querySelectorAll('[data-pool-participation-mode]').forEach((button) => {
    if (button.dataset.poolParticipationBound === 'true') return;
    button.dataset.poolParticipationBound = 'true';
    button.addEventListener('click', () => {
      void updateParticipationPreference({
        ...readParticipationPreferences(),
        mode: button.dataset.poolParticipationMode
      });
    });
  });
  document.querySelectorAll('[data-pool-permission], [data-pool-limit]').forEach((control) => {
    if (control.dataset.poolParticipationBound === 'true') return;
    control.dataset.poolParticipationBound = 'true';
    control.addEventListener('change', () => {
      const current = readParticipationPreferences();
      const permissions = { ...current.permissions };
      const limits = { ...current.limits };
      if (control.dataset.poolPermission) permissions[control.dataset.poolPermission] = control.checked;
      if (control.dataset.poolLimit) {
        limits[control.dataset.poolLimit] = control.type === 'checkbox'
          ? control.checked
          : Number(control.value);
      }
      void updateParticipationPreference({ ...current, permissions, limits });
    });
  });
  document.querySelectorAll('[data-pool-passkey]').forEach((button) => {
    if (button.dataset.poolPasskeyBound === 'true') return;
    button.dataset.poolPasskeyBound = 'true';
    button.addEventListener('click', async () => {
      const status = button.closest('[data-pool-participation]')?.querySelector('[data-pool-passkey-status]');
      button.disabled = true;
      if (status) status.textContent = 'Waiting for passkey';
      try {
        await participationIdentity.enrollPasskey();
        if (status) status.textContent = 'Passkey bound to this device identity.';
      } catch (error) {
        if (status) status.textContent = errorString(error);
      } finally {
        await refreshParticipationControls();
      }
    });
  });
  void refreshParticipationControls();
};
