/**
 * @fileoverview Examples route request controls: workload lanes, model options, suggested
 * prompts and the home run surface.
 */
import {
  LAUNCH_MODEL,
  POOLDAY_MODEL_WORKLOADS,
  getEnabledPoolModelContract,
  getPoolModelWorkload,
  listPoolModels
} from '../../../../shared/pool/model-contract.js';
import { SEQUENCE_ALPHABETS, getMaxPublicSequenceLength, normalizeSequenceInput } from '../../../../shared/pool/sequence-workload.js';
import { choosePooldayAskPlaceholderForLane } from './constants.js';
import { writeSequencePublicConsent, syncSequencePublicConsent } from './sequence-consent.js';
import { createSelectOption, bindPeerRunSurface } from './peer-run-surface.js';

const bindSuggestedPromptEditing = (input) => {
  if (!input || input.dataset.poolSuggestedPromptBound === 'true') return;
  input.dataset.poolSuggestedPromptBound = 'true';
  const intervalId = setInterval(() => {
    if (!document.body.contains(input)) {
      clearInterval(intervalId);
      return;
    }
    if (document.activeElement !== input && !input.value.trim()) {
      const lane = document.querySelector('.pool-home-stage')?.dataset.poolLane || 'sequence';
      const nextPrompt = choosePooldayAskPlaceholderForLane(lane);
      input.placeholder = nextPrompt;
      input.dataset.poolSuggestedPrompt = nextPrompt;
    }
  }, 4000);
};

const setDrawerSummary = (sectionId, value) => {
  const summary = document.querySelector(`[data-pool-drawer-summary="${sectionId}"]`);
  if (summary) summary.textContent = String(value || '');
};

const requestModelsForLane = (lane) => listPoolModels({
  enabledOnly: true,
  workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding
});

const replaceRequestModelOptions = (modelSelect, lane, preferredModelId = null) => {
  if (!modelSelect) return null;
  const models = requestModelsForLane(lane);
  modelSelect.replaceChildren(...models.map((model) => {
    const option = createSelectOption(model.label || model.modelId, model.modelId);
    option.dataset.workload = getPoolModelWorkload(model);
    return option;
  }));
  const preferredExists = models.some((model) => model.modelId === preferredModelId);
  const selectedModel = preferredExists ? preferredModelId : models[0]?.modelId || '';
  modelSelect.value = selectedModel;
  modelSelect.disabled = models.length === 0;
  return getEnabledPoolModelContract(selectedModel);
};

const bindHomeLaneChips = (input, adapterSelect, modelSelect) => {
  const chips = [...document.querySelectorAll('.pool-lane-chip[data-pool-lane]')];
  const stage = document.querySelector('.pool-home-stage');
  const adapterPicker = adapterSelect?.closest('[data-pool-home-adapter-picker]');
  const sequenceOptions = document.querySelector('[data-pool-sequence-options]');
  const sequencePublicControl = document.getElementById('pool-home-sequence-public');
  const taskDescription = document.querySelector('[data-pool-task-description]:not(.pool-lane-chip)');
  const submitButton = document.getElementById('pool-home-run-submit');
  const resultLabel = document.querySelector('label[for="pool-home-run-result-stream"]');
  const laneValues = new Map([[stage?.dataset.poolLane || 'sequence', input?.value || '']]);
  const laneModels = new Map([[stage?.dataset.poolLane || 'sequence', modelSelect?.value || '']]);
  if (chips.length === 0 || !stage) return;
  chips.forEach((chip) => {
    if (chip.disabled || chip.dataset.poolLaneBound === 'true') return;
    chip.dataset.poolLaneBound = 'true';
    chip.addEventListener('click', () => {
      const lane = chip.dataset.poolLane || 'sequence';
      chips.forEach((other) => {
        const active = other.dataset.poolLane === lane;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      const previousLane = stage.dataset.poolLane || 'sequence';
      const previousModelId = modelSelect?.value || '';
      laneValues.set(previousLane, input.value);
      if (previousModelId) laneModels.set(previousLane, previousModelId);
      stage.dataset.poolLane = lane;
      input.value = laneValues.get(lane) || '';
      setDrawerSummary('request-task', chip.textContent.trim());
      if (taskDescription) taskDescription.textContent = chip.dataset.poolTaskDescription || '';
      const nextPrompt = choosePooldayAskPlaceholderForLane(lane);
      input.placeholder = nextPrompt;
      input.dataset.poolSuggestedPrompt = nextPrompt;
      input.dataset.poolSuggestedPromptCleared = 'false';
      input.name = lane === 'sequence' ? 'sequence' : 'prompt';
      input.setAttribute('aria-label', lane === 'sequence' ? 'Public protein sequence' : 'Ask prompt');
      if (submitButton) submitButton.setAttribute('aria-label', 'Run model');
      if (resultLabel) resultLabel.textContent = lane === 'sequence' ? 'Embedding' : 'Answer';
      if (adapterPicker) adapterPicker.hidden = lane !== 'adapters';
      if (sequenceOptions) sequenceOptions.hidden = lane !== 'sequence';
      if (sequencePublicControl) sequencePublicControl.required = lane === 'sequence';
      const sameModelFamily = true;
      replaceRequestModelOptions(
        modelSelect,
        lane,
        laneModels.get(lane) || (sameModelFamily ? previousModelId : null)
      );
      if (modelSelect) {
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (adapterSelect) {
        adapterSelect.value = '';
      }
    });
  });
};

export const bindHomeAskControls = () => {
  const form = document.getElementById('pool-home-ask-form');
  const input = document.getElementById('pool-home-ask-prompt');
  const button = document.getElementById('pool-home-run-submit');
  const adapterSelect = document.getElementById('pool-home-adapter');
  const modelSelect = document.getElementById('pool-home-request-model');
  const policySelect = document.getElementById('pool-home-request-policy');
  const sequencePublicControl = document.getElementById('pool-home-sequence-public');
  if (!form || !input || !button) return;
  let dockObserver;
  const stage = form.closest('.pool-home-stage');
  if (stage && form.dataset.poolDockMeasurementBound !== 'true') {
    form.dataset.poolDockMeasurementBound = 'true';
    const syncDockHeight = () => {
      const height = Math.ceil(form.getBoundingClientRect().height);
      if (height > 0) stage.style.setProperty('--pool-param-ask-dock-height', `${height}px`);
    };
    syncDockHeight();
    if (typeof ResizeObserver === 'function') {
      dockObserver = new ResizeObserver(syncDockHeight);
      dockObserver.observe(form);
    }
  }
  if (sequencePublicControl && sequencePublicControl.dataset.poolConsentBound !== 'true') {
    sequencePublicControl.dataset.poolConsentBound = 'true';
    syncSequencePublicConsent(sequencePublicControl);
    sequencePublicControl.addEventListener('change', () => {
      if (sequencePublicControl.checked) writeSequencePublicConsent();
      syncSequencePublicConsent(sequencePublicControl);
    });
  }
  bindSuggestedPromptEditing(input);
  const example = form.querySelector('[data-pool-use-example]');
  if (example && example.dataset.poolExampleBound !== 'true') {
    example.dataset.poolExampleBound = 'true';
    example.addEventListener('click', () => {
      if (input.disabled || example.disabled || !input.dataset.poolSuggestedPrompt) return;
      input.value = input.dataset.poolSuggestedPrompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
  }
  if (input.dataset.poolSequenceFeedbackBound !== 'true') {
    input.dataset.poolSequenceFeedbackBound = 'true';
    const updateFeedback = () => {
      const model = getEnabledPoolModelContract(modelSelect?.value) || LAUNCH_MODEL;
      const alphabet = model.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid;
      const policyLimit = getMaxPublicSequenceLength(alphabet);
      const limit = Math.min(policyLimit, Number(model.sequence?.maxLength) || policyLimit);
      const length = input.value.replace(/\s+/g, '').length;
      let message = '';
      if (length) {
        try {
          normalizeSequenceInput(input.value, alphabet);
          if (length > limit) message = `This model accepts up to ${limit} residues.`;
        } catch (error) {
          message = error.message;
        }
      }
      const counter = form.querySelector('#pool-sequence-count');
      const feedback = form.querySelector('#pool-sequence-feedback');
      if (counter) counter.textContent = `${length} / ${limit}`;
      if (feedback) feedback.textContent = message || 'Whitespace is ignored.';
      input.setAttribute('aria-invalid', String(Boolean(message)));
      input.setCustomValidity(message);
    };
    input.addEventListener('input', updateFeedback);
    input.addEventListener('change', updateFeedback);
    modelSelect?.addEventListener('change', updateFeedback);
    // Keep programmatically restored/suggested inputs in sync as well.
    form.addEventListener('submit', () => queueMicrotask(updateFeedback));
    updateFeedback();
  }
  bindHomeLaneChips(input, adapterSelect, modelSelect);
  if (modelSelect && modelSelect.dataset.poolRequestModelBound !== 'true') {
    modelSelect.dataset.poolRequestModelBound = 'true';
    const syncModel = () => {
      setDrawerSummary('request-model', modelSelect.selectedOptions[0]?.textContent || modelSelect.value);

    };
    modelSelect.addEventListener('change', syncModel);
    syncModel();
  }
  if (policySelect && policySelect.dataset.poolRequestPolicyBound !== 'true') {
    policySelect.dataset.poolRequestPolicyBound = 'true';
    const syncPolicy = () => {
      const label = policySelect.selectedOptions[0]?.textContent || policySelect.value;
      setDrawerSummary('request-checks', label.split(' - ')[0]);
    };
    policySelect.addEventListener('change', syncPolicy);
    syncPolicy();
  }
  const stopRun = bindPeerRunSurface({
    button,
    prompt: input,
    form,
    policySelect,
    modelSelect,
    adapterSelect,
    adapterRequired: () => document.querySelector('.pool-home-stage')?.dataset.poolLane === 'adapters',
    sequencePublicControl,
    researchPublicControl: document.getElementById('pool-home-research-public'),
    intentKindControl: document.getElementById('pool-home-intent-kind'),
    intentLabelControl: document.getElementById('pool-home-intent-label'),
    intentTextControl: document.getElementById('pool-home-intent-text'),
    intentConditionsControl: document.getElementById('pool-home-intent-conditions'),
    intentObservationControl: document.getElementById('pool-home-intent-observation'),
    intentDecisionControl: document.getElementById('pool-home-intent-decision'),
    intentScopeControl: document.getElementById('pool-home-intent-scope'),
    intentExclusionsControl: document.getElementById('pool-home-intent-exclusions'),
    intentUnknownsControl: document.getElementById('pool-home-intent-unknowns'),
    resultId: 'pool-home-run-result'
  });
  return () => { stopRun?.(); dockObserver?.disconnect(); };
};
