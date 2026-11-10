/**
 * @fileoverview Compute route contribution controls: one provider contribution controller per
 * page, started and stopped by the contributor.
 */
import { createProviderContributionSession } from '../../host/provider-contribution-session.js';
import { POOLDAY_MODEL_WORKLOADS } from '../../../../shared/pool/model-contract.js';
import {
  addReceiptLedgerRow,
  getPeerInviteUrl,
  refreshContributionStatusBar,
  refreshProviderStorageHealth,
  setResult,
  updateProviderHealth,
  updateProviderNotice,
  updateProviderStatus
} from './view.js';
import { recordContributionReceipt, updateContributionState } from './contribution-state.js';
import { displayPoolError, formatDeviceLabel } from './control-display-text.js';
import { getProviderIdentityNamespace } from './page-identity.js';
import { canContributeWith, refreshParticipationControls } from './participation-state-view.js';
import { refreshServerRoomActivity } from './room-activity-controls.js';

const createProviderContributionController = () => {
  let controls = { workerToggleButton: null, modelInput: null, mount: null };
  let visibilityHandler = null;
  const mount = () => controls.mount || document.getElementById('app');
  const session = createProviderContributionSession({
    getProviderIdentityNamespace, refreshContributionStatusBar, updateProviderHealth, refreshProviderStorageHealth,
    formatDeviceLabel, recordContributionReceipt, addReceiptLedgerRow, updateContributionState, setResult,
    refreshServerRoomActivity, refreshParticipationControls, displayPoolError, getPeerInviteUrl, canContributeWith,
    getSelectedModelId: () => controls.modelInput?.value,
    hasControls: () => !!(controls.modelInput || controls.workerToggleButton),
    setProviderStatus: value => updateProviderStatus(mount(), value),
    setProviderNotice: value => updateProviderNotice(mount(), value),
    selectModel(modelId) {
      if (controls.modelInput) { controls.modelInput.value = modelId; syncProviderWorkloadCapability(controls.modelInput); }
    },
    setStopping() { controls.workerToggleButton?.setAttribute('disabled', 'true'); },
    renderControls({ workerRunning, workerStarting, modelId }) {
      if (controls.modelInput && modelId && (workerRunning || workerStarting)) controls.modelInput.value = modelId;
      const button = controls.workerToggleButton;
      if (button) {
        const active = workerRunning || workerStarting;
        button.disabled = workerStarting;
        button.textContent = workerStarting ? 'Starting...' : active ? 'Stop sharing' : 'Start sharing';
        button.dataset.op = workerStarting ? '○' : active ? '■' : '▶';
        button.dataset.contributionAction = active ? 'stop' : 'start';
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('btn-primary', !active); button.classList.toggle('btn-ghost', active);
      }
      if (controls.modelInput) controls.modelInput.disabled = workerRunning || workerStarting;
      refreshContributionStatusBar();
    }
  });
  return {
    ...session,
    attachControls(nextControls = {}) {
      controls = { workerToggleButton: nextControls.workerToggleButton || null, modelInput: nextControls.modelInput || null,
        mount: nextControls.mount || controls.mount || document.getElementById('app') };
      if (controls.workerToggleButton && controls.workerToggleButton.dataset.poolContributionBound !== 'true') {
        controls.workerToggleButton.dataset.poolContributionBound = 'true';
        controls.workerToggleButton.addEventListener('click', () => { void session.toggle(); });
      }
      session.attach();
      if (!visibilityHandler) {
        visibilityHandler = () => { if (document.visibilityState === 'visible') void session.resume(); };
        document.addEventListener('visibilitychange', visibilityHandler);
      }
    },
    async dispose(options) {
      if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
      await session.dispose(options);
    }
  };
};

let providerContributionController = null;

export const getProviderContributionController = () => {
  if (!providerContributionController) {
    providerContributionController = createProviderContributionController();
  }
  return providerContributionController;
};

export const resetProviderContributionControllerForTests = async ({
  preserveResumeIntent = false
} = {}) => {
  const current = providerContributionController;
  providerContributionController = null;
  if (current?.dispose) await current.dispose({ preserveResumeIntent });
};

const syncProviderWorkloadCapability = (modelSelect) => {
  const badge = document.querySelector('[data-pool-provider-workload]');
  if (!badge) return;
  const workload = modelSelect?.selectedOptions?.[0]?.dataset?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding;
  badge.textContent = workload.replace(/[-_]/g, ' ');
};

export const bindProviderControls = () => {
  const modelInput = document.getElementById('pool-provider-model');
  getProviderContributionController().attachControls({
    workerToggleButton: document.getElementById('pool-provider-worker-toggle')
      || document.getElementById('pool-home-provider-toggle'),
    modelInput,
    mount: document.getElementById('app')
  });
  if (modelInput && modelInput.dataset.poolWorkloadBound !== 'true') {
    modelInput.dataset.poolWorkloadBound = 'true';
    modelInput.addEventListener('change', () => {
      syncProviderWorkloadCapability(modelInput);
      void getProviderContributionController().handleModelChange();
    });
    syncProviderWorkloadCapability(modelInput);
  }
};
