/**
 * @fileoverview Device capability assessment controls: run the local check on request and show
 * the measured profile. The assessment grants no work.
 */
import { assessPoolDeviceCapability } from '../../host/device-capability.js';

const formatMetric = (value, suffix, digits = 0) => (
  Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : '--'
);

const renderCapabilityProfileState = (root, profile) => {
  if (!root || !profile) return;
  root.dataset.capabilityState = profile.supported ? 'ready' : 'unsupported';
  const setText = (selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  };
  setText('[data-pool-capability-tier]', profile.tier.label);
  setText('[data-pool-capability-score]', profile.supported ? `${profile.score}/100` : 'N/A');
  setText('[data-pool-capability-summary]', profile.summary);
  setText('[data-pool-capability-webgpu]', profile.supported ? 'Available' : 'Unavailable');
  setText('[data-pool-capability-buffer]', formatMetric(profile.maxBufferMiB, ' MiB'));
  setText('[data-pool-capability-kernel]', profile.measured ? formatMetric(profile.gigaOpsPerSecond, ' GOPS', 1) : 'Not measured');
  setText('[data-pool-capability-stability]', profile.measured ? `${Math.round(profile.stability * 100)}%` : '--');
  const meter = root.querySelector('[data-pool-capability-meter]');
  meter?.style.setProperty('--pool-param-capability-score', `${profile.score}%`);
  const models = root.querySelector('[data-pool-capability-models]');
  if (models) {
    models.replaceChildren();
    const eligible = profile.modelEligibility.filter((model) => model.eligible);
    const rows = eligible.length ? eligible : [{ label: 'Request from another contributor', eligible: false }];
    for (const model of rows) {
      const item = document.createElement('span');
      item.dataset.eligible = String(Boolean(model.eligible));
      item.textContent = model.label;
      models.append(item);
    }
  }
  const providerModel = document.getElementById('pool-provider-model');
  if (providerModel) {
    const previousModelId = providerModel.value;
    for (const option of providerModel.options) {
      const eligibility = profile.modelEligibility.find((entry) => entry.modelId === option.value);
      option.disabled = eligibility ? !eligibility.eligible : true;
      option.title = eligibility?.eligible
        ? `Qualified at ${profile.tier.label}`
        : eligibility?.reasons?.join('; ') || 'Not qualified by this device profile';
    }
    if (providerModel.selectedOptions[0]?.disabled) {
      const eligibleOption = [...providerModel.options].find((option) => !option.disabled);
      if (eligibleOption) providerModel.value = eligibleOption.value;
    }
    if (providerModel.value !== previousModelId) {
      providerModel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
};

export const bindCapabilityAssessmentControls = () => {
  const roots = [...document.querySelectorAll('[data-pool-capability-profile]')];
  if (!roots.length) return;
  const run = async (force = false) => {
    roots.forEach((root) => { root.dataset.capabilityState = 'checking'; });
    const profile = await assessPoolDeviceCapability({ force });
    roots.forEach((root) => renderCapabilityProfileState(root, profile));
  };
  roots.forEach((root) => {
    const rerun = root.querySelector('[data-pool-capability-rerun]');
    if (!rerun || rerun.dataset.poolCapabilityBound === 'true') return;
    rerun.dataset.poolCapabilityBound = 'true';
    rerun.addEventListener('click', () => void run(true));
  });
  void run(false);
};
