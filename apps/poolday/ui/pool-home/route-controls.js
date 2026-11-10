/**
 * @fileoverview Request and sharing controls shared by the focused routes: model and
 * verification choices, pack facts, sharing limits and network participation.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { getPeerRoomId, getPeerRelayMode } from '../../host/product-context.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract, getPoolModelWorkload, listPoolModels } from '../../../../shared/pool/model-contract.js';
import { readParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import { compactHash } from './view-markup.js';

const renderPolicyProductLabel = (policy) => {
  const labels = {
    fastest_receipt: 'One peer',
    canary_audited: 'One peer with audit',
    redundant_agreement: 'Two matching peers',
    ring_quorum_receipt: 'Peer quorum'
  };
  return labels[policy.policyId] || policy.policyId.replace(/_/g, ' ');
};

export const describeSelectedRun = ({
  policyId,
  modelId,
  adapterPackHash = null,
  status = 'finding_peer_provider'
} = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status,
    transport: `webrtc_peer_room_${getPeerRelayMode()}`,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    workMode: 'whole_job_redundant_records',
    policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'group check' : 'one tab',
    requiredAgreement: policy?.adaptiveRing
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} tabs, match by output hash`
      : `${policy?.redundancy || 1} tab${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: {
      modelId: model.modelId,
      modelHash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend
    },
    adapter: adapterPackHash ? {
      packHash: adapterPackHash,
      state: 'selected_pending_provider'
    } : null
  };
};

export const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))}</option>
`).join('');

export const renderModelOptions = ({ workload = null, disableSequence = false } = {}) => listPoolModels({
  enabledOnly: true,
  workload
}).map((model) => {
  const label = model.label || model.modelId;
  const modelWorkload = getPoolModelWorkload(model);
  const isSequence = true;
  const selected = model.modelId === LAUNCH_MODEL.modelId ? ' selected' : '';
  const disabled = disableSequence && isSequence ? ' disabled' : '';
  const workloadLabel = disabled ? ' (unavailable)' : '';
  return `<option value="${escapeHtml(model.modelId)}" data-workload="${escapeHtml(modelWorkload)}"${selected}${disabled}>${escapeHtml(label)}${escapeHtml(workloadLabel)}</option>`;
}).join('');

export const renderPackSummary = (model = LAUNCH_MODEL, { disclosure = true } = {}) => {
  const identity = model.artifactIdentity || {};
  const dimensions = Number(model.embeddingDimensions || model.dimensions || 0);
  const maxInput = Number(model.sequence?.maxLength || model.contextLength || 0);
  const work = model.executionMode === 'full_model_browser_sequence'
    ? 'Full model · one sequence'
    : `${model.runtime || 'Doppler'} · ${model.backend || 'qualified provider'}`;
  return `
    ${disclosure ? '<details class="pool-advanced pool-disclosure pool-model-details"><summary>Model details</summary>' : ''}
    <dl class="pool-pack-summary pool-facts pool-small pool-surface" data-pool-pack-summary>
      <div><dt>Model identity</dt><dd title="${escapeHtml(identity.weightPackId || model.modelHash || model.modelId)}">${escapeHtml(compactHash(identity.weightPackId || model.modelHash || model.modelId))}</dd></div>
      <div><dt>Capability</dt><dd>${escapeHtml(dimensions ? `Sequence embedding · ${dimensions} dimensions` : getPoolModelWorkload(model).replace(/[._-]/g, ' '))}</dd></div>
      <div><dt>Input</dt><dd>${escapeHtml(maxInput ? `Public protein sequence · up to ${maxInput} residues` : 'Public protein sequence')}</dd></div>
      <div><dt>Work</dt><dd>${escapeHtml(work)}</dd></div>
      <div><dt>Providers</dt><dd data-pool-pack-provider-state>Searching</dd></div>
    </dl>
    ${disclosure ? '</details>' : ''}
  `;
};

export const renderSharingLimits = (preferences = readParticipationPreferences()) => `
  <details class="pool-advanced pool-disclosure pool-sharing-limits">
    <summary>Sharing limits</summary>
    <div class="pool-sharing-limit-grid pool-small">
      <label><input type="checkbox" data-pool-permission="relayArtifacts"${preferences.permissions.relayArtifacts ? ' checked' : ''}> Share checked model and adapter files</label>
      <label><input type="checkbox" data-pool-permission="verifyResults"${preferences.permissions.verifyResults ? ' checked' : ''}> Check peer results</label>
      <label><span>Concurrent runs</span><input type="number" min="1" max="4" step="1" value="${preferences.limits.maxConcurrentJobs}" data-pool-limit="maxConcurrentJobs"></label>
      <label><span>Tokens per run</span><input type="number" min="16" max="2048" step="16" value="${preferences.limits.maxTokensPerJob}" data-pool-limit="maxTokensPerJob"></label>
      <label><span>Adapter cache MiB</span><input type="number" min="128" max="65536" step="128" value="${preferences.limits.storageBudgetMiB}" data-pool-limit="storageBudgetMiB"></label>
      <label><span>Available network Mbps</span><input type="number" min="1" max="10000" step="1" value="${preferences.limits.bandwidthBudgetMbps}" data-pool-limit="bandwidthBudgetMbps"></label>
    </div>
    <button class="btn btn-ghost" type="button" data-pool-passkey>Protect identity with passkey</button>
    <p class="pool-caption" data-pool-passkey-status></p>
  </details>
`;

export const renderSharingBoundary = (preferences = readParticipationPreferences(), model = LAUNCH_MODEL) => `
  <section class="pool-sharing-boundary pool-surface" aria-label="Current sharing limits">
    <h2 class="pool-heading">Before you share</h2>
    <ul>
      <li><strong>${escapeHtml(model.label || model.modelId)}</strong> only</li>
      <li><strong>${escapeHtml(preferences.limits.maxConcurrentJobs)}</strong> run${preferences.limits.maxConcurrentJobs === 1 ? '' : 's'} at a time</li>
      <li>Public protein sequences only. Results and signed records go to the requester.</li>
      <li>${escapeHtml(preferences.limits.storageBudgetMiB)} MiB cache · ${escapeHtml(preferences.limits.bandwidthBudgetMbps)} Mbps</li>
      <li>Share until you stop or close this tab</li>
    </ul>
  </section>
`;

export const renderParticipationControl = ({
  surface = 'home',
  advanced = false,
  shareAction = surface === 'home',
  showIdentity = true
} = {}) => {
  const preferences = readParticipationPreferences();
  const modeButton = (mode, label) => `
    <button
      type="button"
      class="pool-participation-mode pool-button btn-ghost${preferences.mode === mode ? ' is-active' : ''}${mode === 'both' ? ' is-primary' : ''}"
      data-pool-participation-mode="${mode}"
      aria-pressed="${preferences.mode === mode}"
    >${label}</button>
  `;
  const showModeSwitcher = surface !== 'ask' && surface !== 'compute';
  return `
    <section class="pool-participation" data-pool-participation data-pool-participation-surface="${surface}" data-participation-mode="${preferences.mode}" aria-label="Network participation">
      ${showModeSwitcher ? `
        <div class="pool-participation-modes pool-surface" role="group" aria-label="Network mode">
          ${modeButton('request', 'Request')}
          ${modeButton('contribute', 'Contribute')}
          ${modeButton('both', 'Both')}
        </div>
      ` : ''}
      ${showIdentity ? '<span class="pool-device-identity pool-caption pool-muted pool-mono" data-pool-device-identity title="This device signs its network roles">Identity</span>' : ''}
      ${shareAction ? `
        <button class="btn btn-primary pool-home-share-toggle pool-caption" id="pool-home-provider-toggle" type="button" aria-pressed="false">Start sharing</button>
      ` : ''}
      ${advanced ? renderSharingLimits(preferences) : ''}
    </section>
  `;
};
