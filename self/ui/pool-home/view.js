/**
 * @fileoverview Rendering and UI state helpers for the Reploid product home.
 */

import { LAUNCH_MODEL, getEnabledPoolModelContract, listPoolModels } from '../../pool/model-contract.js';
import { FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import {
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl
} from '../../pool/peer-rendezvous.js';
import {
  PRODUCT_ROUTES,
  POOLDAY_FLOW_LABELS,
  POOLDAY_NAME,
  POOLDAY_NODE_GRID_SQUARES,
  POOLDAY_PEER_LEDGER_STORAGE_KEY,
  POOLDAY_PROTOCOL,
  POOLDAY_RECEIPT_LEDGER_LIMIT,
  POOLDAY_STREAM_CHUNK_SIZE,
  POOLDAY_STREAM_TICK_MS,
  POOLDAY_VERSION_TAG,
  ROUTE_COPY
} from './constants.js';

const POOLDAY_STREAM_STATE = new Map();
const POOLDAY_RECEIPT_LEDGER = [];
const loadPeerLedgerEvents = () => {
  try {
    const value = globalThis.localStorage?.getItem(POOLDAY_PEER_LEDGER_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const persistPeerLedgerEvents = (events) => {
  try {
    globalThis.localStorage?.setItem(POOLDAY_PEER_LEDGER_STORAGE_KEY, JSON.stringify(events.slice(-100)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
};
const POOLDAY_PEER_EVENTS = loadPeerLedgerEvents();
const POOLDAY_PEER_EVENT_HASHES = new Set();
for (const event of POOLDAY_PEER_EVENTS) {
  const eventHash = event?.messageHash || `${event?.type || 'event'}:${event?.body?.agreementHash || ''}:${event?.body?.receiptHash || ''}:${event?.body?.userId || event?.body?.providerId || ''}`;
  if (eventHash) POOLDAY_PEER_EVENT_HASHES.add(eventHash);
}
const POOLDAY_PROVIDER_HEALTH = {
  webgpu: 'unknown',
  model: 'not_loaded',
  artifact: 'not_checked',
  storage: 'unknown',
  queue: 'idle',
  lastReceipt: 'none',
  trust: 'receipt-backed',
  reputation: 'not_loaded'
};

export const getPeerRoomId = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('room') || window.REPLOID_POOL_ROOM_ID || DEFAULT_PEER_ROOM_ID;
};

export const getPeerRelayMode = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('relay') || window.REPLOID_POOL_RELAY || 'local';
};

export const getPeerRoomBusFactory = (sdk) => createPeerRoomBusFactory({
  sdk,
  relay: getPeerRelayMode()
});

export const getPeerInviteUrl = () => createPeerRoomInviteUrl({
  roomId: getPeerRoomId(),
  relay: getPeerRelayMode(),
  baseUrl: window.location.href
});

const NODE_GRID_SQUARES = POOLDAY_NODE_GRID_SQUARES;

const renderNodeGrid = () => `
  <div class="pool-node-grid" data-pool-node-grid aria-label="Node status tiles">
    ${Array.from({ length: NODE_GRID_SQUARES }).map(() => '<span class="pool-node-square" aria-hidden="true"></span>').join('')}
  </div>
`;

export const setNodeGridProgress = (nodeGrid, value) => {
  if (!nodeGrid) return;
  const squares = nodeGrid.querySelectorAll('.pool-node-square');
  const ratio = Math.max(0, Math.min(1, value));
  const limit = Math.round(squares.length * ratio);
  squares.forEach((square, index) => {
    square.classList.toggle('is-active', index < limit);
  });
};

const getProviderStatusEl = (mount) => mount?.querySelector('[data-pool-provider-status]');
export const getNodeGrid = (mount) => mount?.querySelector('[data-pool-node-grid]');

export const updateProviderStatus = (mount, status = 'NODE // OFFLINE') => {
  const statusEl = getProviderStatusEl(mount);
  if (!statusEl) return;
  statusEl.textContent = status;
  statusEl.dataset.providerState = status.includes('SPAWNED') ? 'spawned' : status.includes('SPAWNING') ? 'spawning' : 'offline';
};

const streamOutputText = (elementId, text) => {
  const outputEl = document.getElementById(elementId);
  if (!outputEl) return;
  const value = String(text || '');
  const previous = POOLDAY_STREAM_STATE.get(elementId);
  if (previous?.timer) window.clearTimeout(previous.timer);
  outputEl.textContent = '';
  if (!value.length) {
    const cursorEl = document.getElementById(`${elementId}-cursor`);
    if (cursorEl) cursorEl.classList.remove('is-visible', 'is-active');
    POOLDAY_STREAM_STATE.delete(elementId);
    return;
  }
  POOLDAY_STREAM_STATE.set(elementId, {
    text: value,
    timer: null,
    index: 0
  });
  const cursorEl = document.getElementById(`${elementId}-cursor`);
  const tick = () => {
    const state = POOLDAY_STREAM_STATE.get(elementId);
    if (!state) return;
    state.index += POOLDAY_STREAM_CHUNK_SIZE;
    outputEl.textContent = value.slice(0, state.index);
    if (state.index < value.length) {
      state.timer = window.setTimeout(tick, POOLDAY_STREAM_TICK_MS);
    } else {
      POOLDAY_STREAM_STATE.delete(elementId);
      if (cursorEl) cursorEl.classList.remove('is-active');
    }
  };
  if (cursorEl) cursorEl.classList.add('is-visible', 'is-active');
  tick();
};

const normalizeReceiptFidelity = (value) => {
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    if (value.accepted === true) return 'accepted';
    if (value.accepted === false) return 'rejected';
    if (value.status) return String(value.status);
  }
  return 'pending';
};

const normalizeReceiptSpeed = (value) => {
  const candidate = firstPresent(
    value?.tokensPerSecond,
    value?.throughput,
    value?.runtime?.tokensPerSecond,
    value?.stats?.throughput,
    value?.performance?.tokensPerSecond
  );
  if (candidate === undefined || candidate === null || candidate === '') return '—';
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)} t/s` : String(candidate);
};

export const addReceiptLedgerRow = (record = {}, receiptHash = '') => {
  const jobId = firstPresent(
    record?.job?.jobId,
    record?.jobId,
    record?.receipt?.jobId,
    receiptHash
  );
  const provider = firstPresent(
    record?.providerId,
    record?.provider?.id,
    record?.providerIdHash,
    record?.provider,
    record?.assignment?.providerId
  );
  const fidelity = normalizeReceiptFidelity(record?.verifierDecision || record?.verification || record?.requesterAcceptance);
  const speed = normalizeReceiptSpeed(record);
  POOLDAY_RECEIPT_LEDGER.unshift({
    jobId: String(jobId || '—'),
    provider: String(provider || '—'),
    fidelity,
    speed,
    receiptHash: String(receiptHash || record?.receiptHash || '—')
  });
  while (POOLDAY_RECEIPT_LEDGER.length > POOLDAY_RECEIPT_LEDGER_LIMIT) {
    POOLDAY_RECEIPT_LEDGER.pop();
  }
};

export const renderReceiptLedger = (rows = POOLDAY_RECEIPT_LEDGER) => {
  if (!rows.length) {
    return '<p class="type-caption pool-receipt-empty">No rounds logged yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Execution receipt scoreboard">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Runner</th>
            <th>Fidelity</th>
            <th>Speed (t/s)</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td title="${escapeHtml(row.jobId)}">${escapeHtml(compactHex(row.jobId))}</td>
              <td title="${escapeHtml(row.provider)}">${escapeHtml(row.provider)}</td>
              <td>${escapeHtml(row.fidelity)}</td>
              <td>${escapeHtml(row.speed)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

const recordPeerLedgerEvents = (events = []) => {
  if (!Array.isArray(events) || events.length === 0) return;
  let changed = false;
  for (const event of events) {
    const eventHash = event?.messageHash || `${event?.type || 'event'}:${event?.body?.agreementHash || ''}:${event?.body?.receiptHash || ''}:${event?.body?.userId || event?.body?.providerId || ''}`;
    if (POOLDAY_PEER_EVENT_HASHES.has(eventHash)) continue;
    POOLDAY_PEER_EVENT_HASHES.add(eventHash);
    POOLDAY_PEER_EVENTS.push(event);
    changed = true;
  }
  if (changed) persistPeerLedgerEvents(POOLDAY_PEER_EVENTS);
};

const renderPeerLedgerState = () => {
  const reduced = createPeerEventReducer().reduce(POOLDAY_PEER_EVENTS);
  const pointRows = Object.entries(reduced.points || {}).sort(([left], [right]) => left.localeCompare(right));
  const reputationRows = Object.values(reduced.reputation || {}).sort((left, right) => String(left.providerId).localeCompare(String(right.providerId)));
  if (pointRows.length === 0 && reputationRows.length === 0) {
    return '<p class="type-caption pool-receipt-empty">No local peer ledger events yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Local peer ledger">
      <table>
        <thead>
          <tr>
            <th>Peer</th>
            <th>Points</th>
            <th>Accepted</th>
            <th>Rejected</th>
          </tr>
        </thead>
        <tbody>
          ${pointRows.map(([peerId, points]) => {
            const reputation = reduced.reputation?.[peerId] || {};
            return `
              <tr>
                <td title="${escapeHtml(peerId)}">${escapeHtml(compactHash(peerId))}</td>
                <td>${escapeHtml(points)}</td>
                <td>${escapeHtml(reputation.acceptedReceipts || 0)}</td>
                <td>${escapeHtml(reputation.rejectedReceipts || 0)}</td>
              </tr>
            `;
          }).join('')}
          ${reputationRows.filter((row) => !Object.prototype.hasOwnProperty.call(reduced.points || {}, row.providerId)).map((row) => `
            <tr>
              <td title="${escapeHtml(row.providerId)}">${escapeHtml(compactHash(row.providerId))}</td>
              <td>${escapeHtml(row.points || 0)}</td>
              <td>${escapeHtml(row.acceptedReceipts || 0)}</td>
              <td>${escapeHtml(row.rejectedReceipts || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

const refreshPeerLedgerState = () => {
  const ledger = document.getElementById('pool-peer-ledger');
  if (ledger) ledger.innerHTML = renderPeerLedgerState();
};

const renderProviderHealth = (state = POOLDAY_PROVIDER_HEALTH) => {
  const rows = [
    ['WebGPU', state.webgpu],
    ['Model', state.model],
    ['Artifact', state.artifact],
    ['Storage', state.storage],
    ['Queue', state.queue],
    ['Last Receipt', state.lastReceipt],
    ['Trust', state.trust],
    ['Reputation', state.reputation]
  ];
  return `
    <div class="boot-status-strip pool-summary" aria-label="Node health">
      ${rows.map(([label, value]) => `
        <span class="pool-summary-item">
          <span class="rgr-status-label">${escapeHtml(label)}</span>
          <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
        </span>
      `).join('')}
    </div>
  `;
};

export const updateProviderHealth = (partial = {}) => {
  Object.assign(POOLDAY_PROVIDER_HEALTH, partial);
  const health = document.getElementById('pool-provider-health');
  if (health) health.innerHTML = renderProviderHealth();
};

export const refreshProviderStorageHealth = async () => {
  if (!navigator.storage?.estimate) {
    updateProviderHealth({ storage: navigator.storage ? 'available' : 'unknown' });
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usedMb = Math.round(Number(estimate.usage || 0) / (1024 * 1024));
    const quotaMb = Math.round(Number(estimate.quota || 0) / (1024 * 1024));
    updateProviderHealth({ storage: quotaMb > 0 ? `${usedMb}/${quotaMb} MB` : 'available' });
  } catch {
    updateProviderHealth({ storage: 'unavailable' });
  }
};

const extractOutputText = (value = {}) => {
  const receipt = value.receipt || value.record || null;
  const candidates = [
    value.outputText,
    value.output,
    value.responseText,
    value.text,
    value.content,
    value.completion,
    value?.job?.outputText,
    value?.job?.output,
    receipt?.outputText,
    receipt?.output,
    receipt?.transcript?.outputText
  ];
  return String(candidates.find((entry) => typeof entry === 'string' && entry.length > 0) || '');
};

const formatLedgerValue = (value, fallback = '—') => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

const renderReceiptSummaryCell = (value, fallback = '—') => `<td>${escapeHtml(formatLedgerValue(value, fallback))}</td>`;

const compactHex = (value) => {
  const normalized = formatLedgerValue(value, '—');
  return normalized === '—' ? '—' : compactHash(normalized);
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normalizeProductPath = (path = window.location.pathname) => {
  if (!path || path === '/') return '/';
  return path.replace(/\/+$/, '');
};
export const getRouteId = () => PRODUCT_ROUTES[normalizeProductPath()] || 'home';
export const isProductPath = (path) => Object.prototype.hasOwnProperty.call(PRODUCT_ROUTES, normalizeProductPath(path));

const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const compactHash = (value) => {
  const normalized = String(value || '');
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 16)}...${normalized.slice(-8)}`;
};

const extractResultSummary = (value = {}) => {
  const job = value.job || value;
  const record = value.receipt || value.record || value;
  const receipt = record.receipt || value.receipt?.receipt || value.receipt || {};
  const verifier = record.verifierDecision || value.verifierDecision || value.localVerification || null;
  const acceptance = record.requesterAcceptance || value.requesterAcceptance || value.acceptance || null;
  const agreement = job.agreement || acceptance?.agreement || value.agreement || null;
  const ring = receipt?.verification?.ring || job.ring || agreement?.ring || null;
  const fields = [
    ['Job', firstPresent(job.jobId, record.jobId, receipt.jobId)],
    ['Receipt', firstPresent(job.receiptHash, record.receiptHash, verifier?.receiptHash, acceptance?.receiptHash)],
    ['Status', firstPresent(job.status, agreement?.status, verifier?.accepted === true ? 'accepted' : verifier?.accepted === false ? 'rejected' : null)],
    ['Trust', firstPresent(job.trustTier, job.effectiveTrustTier, agreement?.effectiveTrustTier, ring?.effectiveTrustTier, receipt?.trustTier)],
    ['Agreement', agreement ? `${agreement.status || 'pending'} ${Number(agreement.requiredAgreement || agreement.requiredProviders || 1)}-of-${Number(agreement.providerCount || agreement.providerIds?.length || 1)}` : null],
    ['Transport', firstPresent(job.transport, value.transport, receipt?.promptTransport)],
    ['Model', firstPresent(job.model?.id, job.modelRequirements?.modelId, receipt?.model?.id, value.model?.modelId)],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
    ['Output', firstPresent(receipt?.outputHash, record.outputHash, job.outputHash)],
    ['Tokens', firstPresent(receipt?.tokenIdsHash, record.tokenIdsHash, job.tokenIdsHash)],
    ['Verifier', verifier ? (verifier.ok === true || verifier.accepted === true ? 'accepted' : verifier.reasons?.length ? verifier.reasons.join('; ') : 'rejected') : null]
  ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
  return fields.slice(0, 10);
};

const renderSummaryRows = (summary) => summary.map(([label, value]) => `
  <span class="pool-summary-item">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
  </span>
`).join('');

const renderResultBox = (id, options = {}) => {
  if (options?.stream) {
    return `
      <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
      <div class="pool-stream-box">
        <label class="pool-result-label" for="${id}-stream">${escapeHtml(options.streamLabel || 'Output stream')}</label>
        <div class="pool-stream-shell">
          <pre class="pool-stream-output" id="${id}-stream" aria-live="polite"></pre>
          <span class="pool-stream-cursor" id="${id}-stream-cursor" aria-hidden="true">▍</span>
        </div>
      </div>
    `;
  }
  const placeholder = options.placeholder || '{}';
  return `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <pre class="pool-result" id="${id}" aria-live="polite">${escapeHtml(placeholder)}</pre>
  `;
};

export const setResult = (id, value, options = {}) => {
  if (value && typeof value === 'object') {
    recordPeerLedgerEvents(value.ledgerEvents || value.body?.ledgerEvents || []);
    refreshPeerLedgerState();
  }
  const summaryEl = document.getElementById(`${id}-summary`);
  const streamMode = !!options.stream;
  const outputText = streamMode ? extractOutputText(value) : null;
  const summary = value && typeof value === 'object' ? extractResultSummary(value) : [];
  const raw = value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2) || String(value);
  const streamEl = streamMode ? document.getElementById(`${id}-stream`) : document.getElementById(id);
  const streamCursor = streamMode ? document.getElementById(`${id}-stream-cursor`) : null;
  if (summaryEl) {
    summaryEl.innerHTML = summary.length > 0 ? renderSummaryRows(summary) : '';
  }
  if (streamMode && streamEl) {
    if (outputText && outputText.length > 0) {
      if (streamCursor) streamCursor.classList.add('is-visible', 'is-active');
      streamOutputText(`${id}-stream`, outputText);
    } else {
      const previous = POOLDAY_STREAM_STATE.get(`${id}-stream`);
      if (previous?.timer) window.clearTimeout(previous.timer);
      POOLDAY_STREAM_STATE.delete(`${id}-stream`);
      streamEl.textContent = raw;
      if (streamCursor) streamCursor.classList.remove('is-visible', 'is-active');
    }
    return;
  }
  if (streamMode) return;
  const outputEl = document.getElementById(id);
  if (outputEl) {
    outputEl.textContent = raw;
  }
};

export const renderNav = (activeRoute) => {
  const primaryItems = [
    ['/', 'Reploid'],
    ['/run', 'Run'],
    ['/contribute', 'Contribute']
  ];
  const utilityItems = [
    ['/receipts', 'Receipts'],
    ['/reputation', 'Reputation']
  ];
  const renderItem = ([href, label]) => {
    const isActive = activeRoute === PRODUCT_ROUTES[href];
    return `<button class="btn segmented-btn pool-nav-toggle${isActive ? ' is-active' : ''}" type="button" data-pool-route="${href}" aria-pressed="${isActive ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  };
  return `
    <div class="pool-topbar">
      <nav class="segmented-control pool-nav" aria-label="Pool route toggles">
        ${primaryItems.map(renderItem).join('')}
      </nav>
      <div class="pool-utility-nav" aria-label="Pool inspection routes">
        ${utilityItems.map(renderItem).join('')}
      </div>
    </div>
    <a class="pool-zero-link pool-zero-corner link-secondary" href="/0" title="Open Zero.">Zero</a>
  `;
};

const renderPolicyStrip = () => `
  <div class="boot-status-strip pool-policy-strip" aria-label="Launch policy">
    <span class="rgr-status-metric"><span class="rgr-status-label">Model</span><span class="rgr-status-value">${escapeHtml(LAUNCH_MODEL.modelId)}</span></span>
    <span class="rgr-status-metric"><span class="rgr-status-label">Trust</span><span class="rgr-status-value">receipt-backed</span></span>
  </div>
`;

const renderPolicyTrustLabel = (policy) => (
  policy.adaptiveRing ? 'adaptive quorum' : policy.trustTier
);

const renderPolicyProductLabel = (policy) => {
  const labels = {
    fastest_receipt: 'Fastest receipt',
    canary_audited: 'Canary audited',
    redundant_agreement: 'Redundant agreement',
    ring_quorum_receipt: 'Ring quorum'
  };
  return labels[policy.policyId] || policy.policyId.replace(/_/g, ' ');
};

export const describeSelectedRun = ({ policyId, modelId, status = 'finding_peer_provider' } = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status,
    transport: getPeerRelayMode() === 'local' ? 'webrtc_peer_room_local' : 'webrtc_peer_room_relay_bootstrap',
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'adaptive quorum receipt' : (policy?.trustTier || 'signed receipt'),
    requiredAgreement: policy?.adaptiveRing
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} runners, quorum by matching receipt`
      : `${policy?.redundancy || 1} runner receipt${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: {
      modelId: model.modelId,
      modelHash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend
    }
  };
};

const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))} - ${escapeHtml(renderPolicyTrustLabel(policy))}</option>
`).join('');

const renderModelOptions = () => listPoolModels().map((model) => {
  const enabled = model.enabled !== false && model.modelHash && model.manifestHash;
  const label = model.label || model.modelId;
  const suffix = enabled ? '' : ` - ${model.unavailableReason || 'not enabled'}`;
  return `<option value="${escapeHtml(model.modelId)}"${enabled ? '' : ' disabled'}>${escapeHtml(`${label}${suffix}`)}</option>`;
}).join('');

const renderHostedAgentExamples = () => {
  const model = LAUNCH_MODEL;
  const example = `const job = await reploid.submitJob({
  policyId: '${FASTEST_RECEIPT_POLICY_ID}',
  prompt,
  modelRequirements: {
    modelId: '${model.modelId}',
    modelHash: '${model.modelHash}',
    manifestHash: '${model.manifestHash}',
    runtime: '${model.runtime}',
    backend: '${model.backend}'
  }
});
const current = await reploid.pollJob(job.jobId);
const receipt = await reploid.getReceipt(current.job.receiptHash);
const verified = await reploid.verifyReceiptRecord(receipt);
await reploid.acceptReceipt(current.job.receiptHash, verified.ok);`;
  return `<pre class="pool-result" aria-label="Hosted agent compatibility example">${escapeHtml(example)}</pre>`;
};

const renderFlowLabels = () => POOLDAY_FLOW_LABELS.map((item) => `
  <span
    class="pool-flow-label pool-flow-label-${escapeHtml(item.id)}"
    data-pool-flow-label="${escapeHtml(item.id)}"
    data-tooltip-title="${escapeHtml(item.label)}"
    data-tooltip-body="${escapeHtml(item.body)}"
    style="--x: ${escapeHtml(item.x)}; --y: ${escapeHtml(item.y)};"
    tabindex="0"
    aria-label="${escapeHtml(`${item.label}: ${item.body}`)}"
  >
    <b>${escapeHtml(item.label)}</b>
  </span>
`).join('');

const renderHomeSimulation = () => `
  <section class="pool-simulation-shell" aria-label="Reploid network graph">
    <canvas class="pool-simulation-canvas" data-pool-simulation width="1200" height="680"></canvas>
    <div class="pool-simulation-labels">
      ${renderFlowLabels()}
    </div>
    <div class="pool-simulation-tooltip" data-pool-tooltip data-placement="above" role="tooltip" aria-hidden="true">
      <b data-pool-tooltip-title></b>
      <span data-pool-tooltip-body></span>
    </div>
  </section>
`;

export const renderRoutePanel = (routeId) => {
  if (routeId === 'home') return renderHomeSimulation();
  const copy = ROUTE_COPY[routeId] || ROUTE_COPY.home;
  return `
    <section class="pool-hero${routeId === 'home' ? ' pool-hero-home' : ''}">
      <div class="pool-hero-copy">
        <p class="pool-eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
        <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
      </div>
    </section>
  `;
};

export const renderRouteDetail = (routeId) => {
  if (routeId === 'run') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Run</h2>
        <div class="pool-form pool-run-layout" data-pool-run>
          <div class="pool-run-compose">
            <label class="pool-field">
              <span>Prompt</span>
              <textarea id="pool-run-prompt" rows="6">Summarize Reploid in one sentence.</textarea>
            </label>
            <details class="pool-advanced">
              <summary>Advanced</summary>
              <div class="pool-advanced-grid">
                <label class="pool-field">
                  <span>Policy</span>
                  <select id="pool-run-policy">${renderPolicyOptions()}</select>
                </label>
                <label class="pool-field">
                  <span>Model</span>
                  <select id="pool-run-model">${renderModelOptions()}</select>
                </label>
                <label class="pool-field">
                  <span>Max point spend</span>
                  <input id="pool-run-max-spend" type="number" min="0" step="1" placeholder="optional" />
                </label>
              </div>
            </details>
            <div class="pool-control-row pool-primary-actions" aria-label="Run controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-run-submit" type="button">Run</button>
              <button class="btn btn-ghost btn-op" data-op="♺" id="pool-run-poll" type="button">Refresh</button>
            </div>
          </div>
          <div class="pool-run-output">
            <div class="pool-result-heading">
              <h3 class="type-h2">Result</h3>
              <span class="pool-meta-tag">Verified when receipt appears</span>
            </div>
            ${renderResultBox('pool-run-result', { stream: true, streamLabel: 'Output' })}
            <div class="pool-control-row pool-post-run-actions" aria-label="Receipt decision controls">
              <button class="btn btn-ghost btn-op" data-op="✓" id="pool-run-accept" type="button" disabled>Accept</button>
              <button class="btn btn-ghost btn-op" data-op="✗" id="pool-run-reject" type="button" disabled>Reject</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }
  if (routeId === 'contribute') {
    return `
      <section class="panel pool-panel">
        <div class="pool-provider-heading">
          <div>
            <h2 class="type-h2">Contribute</h2>
            <p class="type-caption">Start this node. It waits for work.</p>
          </div>
          <p class="pool-provider-status" data-pool-provider-status>NODE // OFFLINE</p>
        </div>
        <div class="pool-form pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <label class="pool-field">
              <span>Model</span>
              <select id="pool-provider-model">${renderModelOptions()}</select>
            </label>
            <div class="pool-control-row pool-primary-actions" aria-label="Contribute controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-provider-worker-start" type="button">Start</button>
              <button class="btn btn-ghost btn-op" data-op="■" id="pool-provider-worker-stop" type="button" disabled>Stop</button>
            </div>
          </div>
          <div class="pool-provider-live" aria-label="Node live state">
            ${renderNodeGrid()}
            <div class="pool-provider-stats">
              <span><b>0</b> active</span>
              <span><b>0</b> queued</span>
              <span><b>0</b> receipts</span>
            </div>
          </div>
          <div id="pool-provider-health" class="pool-ledger-shell" aria-live="polite">${renderProviderHealth()}</div>
          <details class="pool-advanced">
            <summary>Manual controls</summary>
            <div class="pool-control-row" aria-label="Manual node controls">
              <button class="btn btn-ghost btn-op" data-op="☁" id="pool-provider-load" type="button">Load</button>
              <button class="btn btn-ghost btn-op" data-op="☨" id="pool-provider-profile" type="button">Profile</button>
              <button class="btn btn-ghost btn-op" data-op="☩" id="pool-provider-register" type="button">Register</button>
              <button class="btn btn-ghost btn-op" data-op="☍" id="pool-provider-heartbeat" type="button">Heartbeat</button>
              <button class="btn btn-ghost btn-op" data-op="☛" id="pool-provider-next" type="button">Next Job</button>
              <button class="btn btn-ghost btn-op" data-op="☇" id="pool-provider-execute" type="button">Execute</button>
              <button class="btn btn-ghost btn-op" data-op="⏎" id="pool-provider-step" type="button">Step</button>
              <button class="btn btn-ghost btn-op" data-op="∑" id="pool-provider-points" type="button">Points</button>
              <button class="btn btn-ghost btn-op" data-op="★" id="pool-provider-reputation" type="button">Reputation</button>
            </div>
          </details>
          <div class="pool-inspector-shell">
            <div class="pool-result-heading">
              <h3 class="type-h2">Activity</h3>
              <span class="pool-meta-tag">Inspector</span>
            </div>
            ${renderResultBox('pool-provider-result', { placeholder: 'No activity yet.' })}
          </div>
        </div>
      </section>
    `;
  }
  if (routeId === 'agents') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">API</h2>
        <p class="type-caption">Submit, poll, verify, accept.</p>
        <div class="pool-form" data-pool-agent>
          <label class="pool-field">
            <span>Prompt</span>
            <textarea id="pool-agent-prompt" rows="5">Return one concise sentence about receipt-backed browser inference.</textarea>
          </label>
          <label class="pool-field">
            <span>Policy</span>
            <select id="pool-agent-policy">${renderPolicyOptions()}</select>
          </label>
          <label class="pool-field">
            <span>Max point spend</span>
            <input id="pool-agent-max-spend" type="number" min="0" step="1" placeholder="optional" />
          </label>
          <button class="btn btn-primary btn-op" data-op="⏎" id="pool-agent-submit" type="button">Submit</button>
          <button class="btn btn-ghost btn-op" data-op="♺" id="pool-agent-poll" type="button">Refresh</button>
          <button class="btn btn-ghost btn-op" data-op="✓" id="pool-agent-accept" type="button">Accept</button>
          <button class="btn btn-ghost btn-op" data-op="✗" id="pool-agent-reject" type="button">Reject</button>
          <details class="pool-advanced" open>
            <summary>Hosted compatibility</summary>
            ${renderHostedAgentExamples()}
          </details>
          ${renderResultBox('pool-agent-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'receipts') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Receipts</h2>
        <p class="type-caption">Check completed work.</p>
        <div class="pool-form" data-pool-receipts>
          <label class="pool-field">
            <span>Receipt hash</span>
            <input id="pool-receipt-hash" placeholder="sha256:..." />
          </label>
          <button class="btn btn-primary btn-op" data-op="⚲" id="pool-receipt-lookup" type="button">Lookup</button>
          <div id="pool-receipt-ledger" class="pool-ledger-shell" aria-live="polite">${renderReceiptLedger()}</div>
          ${renderResultBox('pool-receipt-result')}
        </div>
      </section>
    `;
  }
  if (routeId === 'reputation') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Reputation</h2>
        <p class="type-caption">Review peer history.</p>
        <div class="pool-form" data-pool-reputation>
          <label class="pool-field">
            <span>Peer id</span>
            <input id="pool-reputation-provider" placeholder="peer_..." />
          </label>
          <button class="btn btn-primary btn-op" data-op="⚲" id="pool-reputation-lookup" type="button">Lookup</button>
          <button class="btn btn-ghost btn-op" data-op="☛" id="pool-status-lookup" type="button">Status</button>
          <button class="btn btn-ghost btn-op" data-op="∑" id="pool-metrics-lookup" type="button">Metrics</button>
          <button class="btn btn-ghost btn-op" data-op="✓" id="pool-deployment-check" type="button">Deploy Check</button>
          <h3 class="type-h2">Local peer ledger</h3>
          <div id="pool-peer-ledger" class="pool-ledger-shell" aria-live="polite">${renderPeerLedgerState()}</div>
          ${renderResultBox('pool-reputation-result')}
          <p class="pool-meta-tag" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
        </div>
      </section>
    `;
  }
  return '';
};
