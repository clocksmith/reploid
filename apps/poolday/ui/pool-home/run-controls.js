/**
 * @fileoverview Ask and Room-1 run controls and the embedding result actions, bound to the shared
 * peer run surface.
 */
import { POOLDAY_MODEL_WORKLOADS } from '../../../../shared/pool/model-contract.js';
import { bindPeerRunSurface } from './peer-run-surface.js';

const runWorkloadOf = (modelSelect) => (
  modelSelect?.selectedOptions?.[0]?.dataset?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding
);

const syncRunWorkloadAffordance = (modelSelect) => {
  const badge = document.querySelector('[data-pool-run-workload]');
  const promptLabel = document.querySelector('[data-pool-run-prompt-label]');
  const workload = runWorkloadOf(modelSelect);
  const isSequence = true;
  if (badge) badge.textContent = workload.replace(/[-_]/g, ' ');
  if (promptLabel) promptLabel.textContent = isSequence ? 'Sequence' : 'Prompt';
};

export const bindRunControls = () => {
  const modelSelect = document.getElementById('pool-run-model');
  const sequencePublicControl = document.getElementById('pool-run-sequence-public');
  const stopRun = bindPeerRunSurface({
    button: document.getElementById('pool-run-submit'),
    prompt: document.getElementById('pool-run-prompt'),
    policySelect: document.getElementById('pool-run-policy'),
    modelSelect,
    sequencePublicControl,
    researchPublicControl: document.getElementById('pool-run-research-public'),
    intentKindControl: document.getElementById('pool-run-intent-kind'),
    intentLabelControl: document.getElementById('pool-run-intent-label'),
    intentTextControl: document.getElementById('pool-run-intent-text'),
    intentConditionsControl: document.getElementById('pool-run-intent-conditions'),
    intentObservationControl: document.getElementById('pool-run-intent-observation'),
    intentDecisionControl: document.getElementById('pool-run-intent-decision'),
    intentScopeControl: document.getElementById('pool-run-intent-scope'),
    intentExclusionsControl: document.getElementById('pool-run-intent-exclusions'),
    intentUnknownsControl: document.getElementById('pool-run-intent-unknowns'),
    resultId: 'pool-run-result'
  });
  if (modelSelect && modelSelect.dataset.poolWorkloadBound !== 'true') {
    modelSelect.dataset.poolWorkloadBound = 'true';
    modelSelect.addEventListener('change', () => {
      syncRunWorkloadAffordance(modelSelect);
    });
    syncRunWorkloadAffordance(modelSelect);
  }
  return stopRun;
};

export const bindEmbeddingResultControls = () => {
  document.querySelectorAll('[data-pool-copy-embedding]').forEach((button) => {
    if (button.dataset.poolEmbeddingCopyBound === 'true') return;
    button.dataset.poolEmbeddingCopyBound = 'true';
    button.addEventListener('click', async () => {
      const resultId = String(button.dataset.poolEmbeddingResultId || '').trim();
      const vector = resultId ? document.getElementById(`${resultId}-embedding`)?.textContent?.trim() : '';
      const status = button.closest('.pool-embedding-outcome')?.querySelector('[data-pool-embedding-copy-status]');
      if (button.dataset.poolEmbeddingPublicationPermitted !== 'true') {
        if (status) status.textContent = 'The raw embedding is withheld because publication consent was not granted.';
        return;
      }
      if (!vector) {
        if (status) status.textContent = 'The embedding is not available to copy.';
        return;
      }
      if (typeof navigator.clipboard?.writeText !== 'function') {
        if (status) status.textContent = 'Clipboard access is unavailable. Open View embedding vector and copy it manually.';
        return;
      }
      try {
        await navigator.clipboard.writeText(vector);
        if (status) status.textContent = 'Embedding vector copied.';
      } catch {
        if (status) status.textContent = 'Copy failed. Open View embedding vector and copy it manually.';
      }
    });
  });
};
