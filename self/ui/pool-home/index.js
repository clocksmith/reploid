/**
 * @fileoverview Public product home for the verified browser inference pool.
 */

import { createPoolSdk, verifyReceiptRecord } from '../../pool/sdk.js';
import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel, getEnabledPoolModelContract, listPoolModels } from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, listPolicies } from '../../pool/policy-router.js';

const PRODUCT_ROUTES = Object.freeze({
  '/': 'home',
  '/run': 'run',
  '/contribute': 'contribute',
  '/agents': 'agents',
  '/receipts': 'receipts',
  '/reputation': 'reputation'
});

const POOLDAY_NAME = 'Poolday';
const POOLDAY_PROTOCOL = 'Verified Browser Inference';
const POOLDAY_VERSION_TAG = 'vBI-1.6';
const PROVIDER_WORKER_INTERVAL_MS = 3000;
const SIMULATION_TARGET_STEP_MS = 1000 / 60;
const SIMULATION_MAX_STEP_MS = 1000 / 16;
const SIMULATION_MIN_STEP_MS = 1000 / 120;
const SIMULATION_GENTLE_SPEED = 0.72;
const SIMULATION_POINTER_LERP = 0.12;
const SIMULATION_FORCE_LERP = 0.08;
const SIMULATION_MIN_FORCE = 0.002;
const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
const POOLDAY_NODE_GRID_SQUARES = 20;
const POOLDAY_STREAM_CHUNK_SIZE = 18;
const POOLDAY_STREAM_TICK_MS = 14;
const POOLDAY_STREAM_STATE = new Map();
const POOLDAY_RECEIPT_LEDGER = [];

const ROUTE_COPY = Object.freeze({
  home: {
    eyebrow: POOLDAY_PROTOCOL,
    title: POOLDAY_NAME,
    body: 'Browser inference with receipts.'
  },
  run: {
    eyebrow: 'Run',
    title: 'Run a Job',
    body: 'Send a prompt and stream the result.'
  },
  contribute: {
    eyebrow: 'Share',
    title: 'Share Browser',
    body: 'Let this tab pick up jobs.'
  },
  agents: {
    eyebrow: 'API',
    title: 'API',
    body: 'Submit, poll, verify, accept.'
  },
  receipts: {
    eyebrow: 'Receipts',
    title: 'Receipts',
    body: 'Check work and results.'
  },
  reputation: {
    eyebrow: 'Reputation',
    title: 'Reputation',
    body: 'Review provider history.'
  }
});
const NODE_GRID_SQUARES = POOLDAY_NODE_GRID_SQUARES;

const renderNodeGrid = () => `
  <div class="pool-node-grid" data-pool-node-grid aria-label="Node status tiles">
    ${Array.from({ length: NODE_GRID_SQUARES }).map(() => '<span class="pool-node-square" aria-hidden="true"></span>').join('')}
  </div>
`;

const setNodeGridProgress = (nodeGrid, value) => {
  if (!nodeGrid) return;
  const squares = nodeGrid.querySelectorAll('.pool-node-square');
  const ratio = Math.max(0, Math.min(1, value));
  const limit = Math.round(squares.length * ratio);
  squares.forEach((square, index) => {
    square.classList.toggle('is-active', index < limit);
  });
};

const getProviderStatusEl = (mount) => mount?.querySelector('[data-pool-provider-status]');
const getNodeGrid = (mount) => mount?.querySelector('[data-pool-node-grid]');

const updateProviderStatus = (mount, status = 'NODE // OFFLINE') => {
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

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clampRange = (value, min, max) => Math.max(min, Math.min(max, value));
const clampCanvasPoint = (point, width, height, margin = 6) => {
  if (!point) return point;
  return {
    ...point,
    x: clampRange(point.x, margin, Math.max(margin, width - margin)),
    y: clampRange(point.y, margin, Math.max(margin, height - margin)),
    alpha: clamp01(point.alpha ?? 1),
    size: Math.max(0, Number(point.size) || 0)
  };
};

const addReceiptLedgerRow = (record = {}, receiptHash = '') => {
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

const renderReceiptLedger = (rows = POOLDAY_RECEIPT_LEDGER) => {
  if (!rows.length) {
    return '<p class="type-caption pool-receipt-empty">No rounds logged yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Execution receipt scoreboard">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Provider</th>
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
const getRouteId = () => PRODUCT_ROUTES[normalizeProductPath()] || 'home';
const isProductPath = (path) => Object.prototype.hasOwnProperty.call(PRODUCT_ROUTES, normalizeProductPath(path));

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

const setResult = (id, value, options = {}) => {
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

const renderNav = (activeRoute) => {
  const primaryItems = [
    ['/', 'Poolday'],
    ['/run', 'Run'],
    ['/contribute', 'Share']
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
        <a class="pool-zero-link link-secondary" href="/0" title="Open Zero.">Zero</a>
      </div>
    </div>
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

const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))} - ${escapeHtml(renderPolicyTrustLabel(policy))}</option>
`).join('');

const renderModelOptions = () => listPoolModels().map((model) => {
  const enabled = model.enabled !== false && model.modelHash && model.manifestHash;
  const label = model.label || model.modelId;
  const suffix = enabled ? '' : ` - ${model.unavailableReason || 'not enabled'}`;
  return `<option value="${escapeHtml(model.modelId)}"${enabled ? '' : ' disabled'}>${escapeHtml(`${label}${suffix}`)}</option>`;
}).join('');

const renderHomeSimulation = () => `
  <section class="pool-simulation-shell" aria-label="Browser inference pool simulation">
    <div class="pool-simulation-intro">
      <h1 class="type-h1">Poolday</h1>
      <p class="type-caption">Browser compute with receipts.</p>
      <div class="pool-home-actions">
        <button class="btn btn-primary pool-role-action" type="button" data-pool-route="/run">
          <span>Run a Job</span>
          <small>Prompt in. Receipt out.</small>
        </button>
        <button class="btn btn-ghost pool-role-action" type="button" data-pool-route="/contribute">
          <span>Share Browser</span>
          <small>This tab earns reputation.</small>
        </button>
      </div>
    </div>
    <canvas class="pool-simulation-canvas" data-pool-simulation width="1200" height="680"></canvas>
    <div class="pool-simulation-labels" aria-hidden="true">
      <span style="--x: 18%; --y: 58%;" title="A prompt enters the pool.">job</span>
      <span style="--x: 50%; --y: 40%;" title="Browsers run and verify.">pool</span>
      <span style="--x: 78%; --y: 58%;" title="The result has a receipt.">receipt</span>
    </div>
    <div class="pool-simulation-readout" aria-label="Simulation state">
      <span>jobs</span>
      <span>receipts</span>
      <span><b data-pool-peer-count>0</b> tabs</span>
    </div>
  </section>
`;

const renderRoutePanel = (routeId) => {
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

const renderRouteDetail = (routeId) => {
  if (routeId === 'run') {
    return `
      <section class="panel pool-panel">
        <h2 class="type-h2">Run</h2>
        <div class="pool-form pool-run-layout" data-pool-run>
          <div class="pool-run-compose">
            <label class="pool-field">
              <span>Prompt</span>
              <textarea id="pool-run-prompt" rows="6">Summarize Poolday in one sentence.</textarea>
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
              <button class="btn btn-primary" id="pool-run-submit" type="button">Run</button>
              <button class="btn btn-ghost" id="pool-run-poll" type="button">Refresh</button>
            </div>
          </div>
          <div class="pool-run-output">
            <div class="pool-result-heading">
              <h3 class="type-h2">Result</h3>
              <span class="pool-meta-tag">Verified when receipt appears</span>
            </div>
            ${renderResultBox('pool-run-result', { stream: true, streamLabel: 'Output' })}
            <div class="pool-control-row pool-post-run-actions" aria-label="Receipt decision controls">
              <button class="btn btn-ghost" id="pool-run-accept" type="button" disabled>Accept</button>
              <button class="btn btn-ghost" id="pool-run-reject" type="button" disabled>Reject</button>
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
            <h2 class="type-h2">Share Browser</h2>
            <p class="type-caption">Start this tab. It waits for work.</p>
          </div>
          <p class="pool-provider-status" data-pool-provider-status>NODE // OFFLINE</p>
        </div>
        <div class="pool-form pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <label class="pool-field">
              <span>Model</span>
              <select id="pool-provider-model">${renderModelOptions()}</select>
            </label>
            <div class="pool-control-row pool-primary-actions" aria-label="Provider worker controls">
              <button class="btn btn-primary" id="pool-provider-worker-start" type="button">Start</button>
              <button class="btn btn-ghost" id="pool-provider-worker-stop" type="button" disabled>Stop</button>
            </div>
          </div>
          <div class="pool-provider-live" aria-label="Provider live state">
            ${renderNodeGrid()}
            <div class="pool-provider-stats">
              <span><b>0</b> active</span>
              <span><b>0</b> queued</span>
              <span><b>0</b> receipts</span>
            </div>
          </div>
          <details class="pool-advanced">
            <summary>Manual controls</summary>
            <div class="pool-control-row" aria-label="Manual provider controls">
              <button class="btn btn-ghost" id="pool-provider-load" type="button">Load</button>
              <button class="btn btn-ghost" id="pool-provider-profile" type="button">Profile</button>
              <button class="btn btn-ghost" id="pool-provider-register" type="button">Register</button>
              <button class="btn btn-ghost" id="pool-provider-next" type="button">Next Job</button>
              <button class="btn btn-ghost" id="pool-provider-execute" type="button">Execute</button>
              <button class="btn btn-ghost" id="pool-provider-step" type="button">Step</button>
              <button class="btn btn-ghost" id="pool-provider-points" type="button">Points</button>
              <button class="btn btn-ghost" id="pool-provider-reputation" type="button">Reputation</button>
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
          <button class="btn btn-primary" id="pool-agent-submit" type="button">Submit</button>
          <button class="btn btn-ghost" id="pool-agent-poll" type="button">Refresh</button>
          <button class="btn btn-ghost" id="pool-agent-accept" type="button">Accept</button>
          <button class="btn btn-ghost" id="pool-agent-reject" type="button">Reject</button>
          <code>submitJob({ policyId, prompt, modelRequirements })</code>
          <code>pollJob(jobId)</code>
          <code>verifyReceiptRecord(record)</code>
          <code>acceptReceipt(receiptHash)</code>
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
          <button class="btn btn-primary" id="pool-receipt-lookup" type="button">Lookup</button>
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
        <p class="type-caption">Review provider history.</p>
        <div class="pool-form" data-pool-reputation>
          <label class="pool-field">
            <span>Provider id</span>
            <input id="pool-reputation-provider" placeholder="provider_..." />
          </label>
          <button class="btn btn-primary" id="pool-reputation-lookup" type="button">Lookup</button>
          <button class="btn btn-ghost" id="pool-status-lookup" type="button">Status</button>
          <button class="btn btn-ghost" id="pool-metrics-lookup" type="button">Metrics</button>
          <button class="btn btn-ghost" id="pool-deployment-check" type="button">Deploy Check</button>
          ${renderResultBox('pool-reputation-result')}
          <p class="pool-meta-tag" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
        </div>
      </section>
    `;
  }
  return '';
};

const bindRunControls = (sdk) => {
  const button = document.getElementById('pool-run-submit');
  const pollButton = document.getElementById('pool-run-poll');
  const acceptButton = document.getElementById('pool-run-accept');
  const rejectButton = document.getElementById('pool-run-reject');
  const prompt = document.getElementById('pool-run-prompt');
  const policySelect = document.getElementById('pool-run-policy');
  const modelSelect = document.getElementById('pool-run-model');
  const maxSpendInput = document.getElementById('pool-run-max-spend');
  if (!button || !prompt) return;
  const requesterIdentity = createPoolIdentity('requester');
  const requesterClient = createRequesterClient({
    sdk,
    identity: requesterIdentity
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  const syncReceiptActions = () => {
    const canDecide = !!lastReceiptHash;
    if (acceptButton) acceptButton.disabled = !canDecide;
    if (rejectButton) rejectButton.disabled = !canDecide;
  };
  syncReceiptActions();
  button.addEventListener('click', async () => {
    button.disabled = true;
    setResult('pool-run-result', { status: 'submitting' }, { stream: true });
    try {
      const result = await requesterClient.submitJob({
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      lastJobId = result?.job?.jobId || null;
      lastReceiptHash = result?.job?.receiptHash || null;
      syncReceiptActions();
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      button.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (!lastJobId) {
      setResult('pool-run-result', { error: 'No submitted job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await requesterClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      syncReceiptActions();
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to accept' }, { stream: true });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-run-result', { error: 'No verifier-accepted receipt to reject' }, { stream: true });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-run-result', await requesterClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

const bindAgentControls = (sdk) => {
  const submitButton = document.getElementById('pool-agent-submit');
  const pollButton = document.getElementById('pool-agent-poll');
  const acceptButton = document.getElementById('pool-agent-accept');
  const rejectButton = document.getElementById('pool-agent-reject');
  const prompt = document.getElementById('pool-agent-prompt');
  const policySelect = document.getElementById('pool-agent-policy');
  const maxSpendInput = document.getElementById('pool-agent-max-spend');
  if (!submitButton || !prompt) return;
  const agentIdentity = createPoolIdentity('agent');
  const agentClient = createAgentClient({
    sdk,
    identity: agentIdentity,
    pointBudget: 0
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    setResult('pool-agent-result', { status: 'submitting_agent_job' });
    try {
      const identity = await agentIdentity.resolve();
      const result = await agentClient.submitJob({
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null
      });
      lastJobId = result?.job?.jobId || null;
      lastReceiptHash = result?.job?.receiptHash || null;
      setResult('pool-agent-result', { identity, ...result });
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      submitButton.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (!lastJobId) {
      setResult('pool-agent-result', { error: 'No submitted agent job to poll' });
      return;
    }
    pollButton.disabled = true;
    try {
      const result = await agentClient.pollJob(lastJobId);
      lastReceiptHash = result?.job?.receiptHash || lastReceiptHash;
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      pollButton.disabled = false;
    }
  });
  acceptButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to accept' });
      return;
    }
    acceptButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, true));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      acceptButton.disabled = false;
    }
  });
  rejectButton?.addEventListener('click', async () => {
    if (!lastReceiptHash) {
      setResult('pool-agent-result', { error: 'No verifier-accepted receipt to reject' });
      return;
    }
    rejectButton.disabled = true;
    try {
      setResult('pool-agent-result', await agentClient.acceptReceipt(lastReceiptHash, false));
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      rejectButton.disabled = false;
    }
  });
};

const bindProviderControls = (sdk) => {
  const loadButton = document.getElementById('pool-provider-load');
  const profileButton = document.getElementById('pool-provider-profile');
  const registerButton = document.getElementById('pool-provider-register');
  const nextButton = document.getElementById('pool-provider-next');
  const executeButton = document.getElementById('pool-provider-execute');
  const stepButton = document.getElementById('pool-provider-step');
  const workerStartButton = document.getElementById('pool-provider-worker-start');
  const workerStopButton = document.getElementById('pool-provider-worker-stop');
  const pointsButton = document.getElementById('pool-provider-points');
  const reputationButton = document.getElementById('pool-provider-reputation');
  const modelInput = document.getElementById('pool-provider-model');
  if (!registerButton || !nextButton || !modelInput) return;
  const providerIdentity = createPoolIdentity('provider');
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  const mount = document.getElementById('app');
  const nodeGrid = getNodeGrid(mount);
  updateProviderStatus(mount, 'NODE // OFFLINE');
  setNodeGridProgress(nodeGrid, 0);
  const providerClient = createProviderClient({
    sdk,
    runtime,
    identity: providerIdentity
  });
  const getProviderModel = () => ({
    ...buildLaunchProviderModel({ modelId: modelInput.value || LAUNCH_MODEL.modelId })
  });
  const modelMatchesLoadedRuntime = (model = {}) => {
    const loaded = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    return !!loaded
      && loaded.modelId === model.modelId
      && loaded.modelHash === model.modelHash
      && loaded.manifestHash === model.manifestHash
      && loaded.runtime === model.runtime
      && loaded.backend === model.backend;
  };
  const loadSelectedProviderModel = async () => {
    updateProviderStatus(mount, 'NODE // SPAWNING');
    setNodeGridProgress(nodeGrid, 0.2);
    const model = getEnabledPoolModelContract(modelInput.value || LAUNCH_MODEL.modelId);
    if (!model) throw new Error('Selected model is not enabled for provider registration');
    if (modelMatchesLoadedRuntime(model) && runtime.isReady?.()) {
      setNodeGridProgress(nodeGrid, 0.7);
      return {
        ok: true,
        status: 'model_loaded',
        model: runtime.getModelInfo()
      };
    }
    const loadResult = await runtime.loadModel(model);
    if (!loadResult?.ok || !runtime.isReady?.() || !modelMatchesLoadedRuntime(model)) {
      const reason = loadResult?.reason || 'Doppler runtime did not expose the selected model after load';
      const error = new Error(`Doppler model load failed: ${reason}`);
      error.payload = {
        model,
        loadResult,
        loadState: runtime.getLoadState?.() || null
      }; 
      throw error;
    }
    setNodeGridProgress(nodeGrid, 0.7);
    return {
      ...loadResult,
      status: 'model_loaded'
    };
  };
  const ensureProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    const providerIdentityState = await providerIdentity.resolve();
    const result = await providerClient.register({
      models: [model],
      device: {
        hasWebGPU: !!navigator.gpu,
        browserSurface: 'pool_provider_ui'
      },
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId)
      },
    });
    return {
      identity: providerIdentityState,
      registration: result
    };
  };
  let lastAssignment = null;
  let workerRunning = false;
  let workerTimer = null;
  const syncWorkerButtons = () => {
    if (workerStartButton) workerStartButton.disabled = workerRunning;
    if (workerStopButton) workerStopButton.disabled = !workerRunning;
  };
  const stopWorker = () => {
    workerRunning = false;
    if (workerTimer) window.clearTimeout(workerTimer);
    workerTimer = null;
    syncWorkerButtons();
    updateProviderStatus(mount, 'NODE // OFFLINE');
    setNodeGridProgress(nodeGrid, 0);
  };
  const runWorkerLoop = async () => {
    if (!workerRunning) return;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      setResult('pool-provider-result', {
        worker: 'running',
        ...result
      });
      if (workerRunning) {
        workerTimer = window.setTimeout(runWorkerLoop, PROVIDER_WORKER_INTERVAL_MS);
      }
    } catch (error) {
      stopWorker();
      setResult('pool-provider-result', { worker: 'stopped', error: error.message, payload: error.payload || null });
    }
  };
  loadButton?.addEventListener('click', async () => {
    loadButton.disabled = true;
    setResult('pool-provider-result', { status: 'loading_model', model: getProviderModel() });
    try {
      setResult('pool-provider-result', await loadSelectedProviderModel());
      setNodeGridProgress(nodeGrid, 0.8);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
      updateProviderStatus(mount, 'NODE // OFFLINE');
      setNodeGridProgress(nodeGrid, 0);
    } finally {
      loadButton.disabled = false;
    }
  });
  profileButton?.addEventListener('click', async () => {
    profileButton.disabled = true;
    try {
      const runtimeProfile = typeof runtime.getRuntimeProfile === 'function'
        ? await runtime.getRuntimeProfile()
        : { error: 'runtime profile unavailable' };
      setResult('pool-provider-result', runtimeProfile);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      profileButton.disabled = false;
    }
  });
  registerButton.addEventListener('click', async () => {
    registerButton.disabled = true;
    try {
      setResult('pool-provider-result', { status: 'registering', model: getProviderModel() });
      setResult('pool-provider-result', await ensureProviderReady());
      setNodeGridProgress(nodeGrid, 1);
      updateProviderStatus(mount, 'NODE // SPAWNED');
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
      updateProviderStatus(mount, 'NODE // OFFLINE');
      setNodeGridProgress(nodeGrid, 0);
    } finally {
      registerButton.disabled = false;
    }
  });
  nextButton.addEventListener('click', async () => {
    nextButton.disabled = true;
    try {
      const result = await providerClient.nextAssignment();
      lastAssignment = result?.assignment || null;
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      nextButton.disabled = false;
    }
  });
  executeButton?.addEventListener('click', async () => {
    if (!lastAssignment) {
      setResult('pool-provider-result', { error: 'No assignment to execute' });
      return;
    }
    executeButton.disabled = true;
    try {
      setResult('pool-provider-result', await providerClient.executeAssignment(lastAssignment, {
        commitReveal: 'auto'
      }));
      lastAssignment = null;
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      executeButton.disabled = false;
    }
  });
  stepButton?.addEventListener('click', async () => {
    stepButton.disabled = true;
    try {
      const result = await providerClient.runWorkerStep();
      lastAssignment = result?.status === 'executed_assignment' ? null : result?.assignment || lastAssignment;
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      stepButton.disabled = false;
    }
  });
  workerStartButton?.addEventListener('click', async () => {
    if (workerRunning) return;
    workerStartButton.disabled = true;
    setResult('pool-provider-result', { worker: 'registering', model: getProviderModel() });
    updateProviderStatus(mount, 'NODE // SPAWNING');
    setNodeGridProgress(nodeGrid, 0.9);
    try {
      const ready = await ensureProviderReady();
      workerRunning = true;
      syncWorkerButtons();
      updateProviderStatus(mount, 'NODE // SPAWNED');
      setNodeGridProgress(nodeGrid, 1);
      setResult('pool-provider-result', { worker: 'running', ...ready });
      await runWorkerLoop();
    } catch (error) {
      stopWorker();
      setResult('pool-provider-result', { worker: 'stopped', error: error.message, payload: error.payload || null });
    } finally {
      syncWorkerButtons();
    }
  });
  workerStopButton?.addEventListener('click', () => {
    stopWorker();
    setResult('pool-provider-result', { worker: 'stopped' });
  });
  pointsButton?.addEventListener('click', async () => {
    pointsButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      setResult('pool-provider-result', await sdk.points(identity.roleId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      pointsButton.disabled = false;
    }
  });
  reputationButton?.addEventListener('click', async () => {
    reputationButton.disabled = true;
    try {
      const identity = await providerIdentity.resolve();
      setResult('pool-provider-result', await sdk.reputation(identity.roleId));
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      reputationButton.disabled = false;
    }
  });
};

const bindReceiptControls = (sdk) => {
  const button = document.getElementById('pool-receipt-lookup');
  const input = document.getElementById('pool-receipt-hash');
  if (!button || !input) return;
  const ledgerContainer = document.getElementById('pool-receipt-ledger');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = renderReceiptLedger();
  }
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Receipt hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = await sdk.getReceipt(receiptHash);
      addReceiptLedgerRow(record, receiptHash);
      if (ledgerContainer) {
        ledgerContainer.innerHTML = renderReceiptLedger();
      }
      setResult('pool-receipt-result', {
        ...record,
        localVerification: await verifyReceiptRecord(record)
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};

const bindReputationControls = (sdk) => {
  const button = document.getElementById('pool-reputation-lookup');
  const statusButton = document.getElementById('pool-status-lookup');
  const metricsButton = document.getElementById('pool-metrics-lookup');
  const deploymentButton = document.getElementById('pool-deployment-check');
  const input = document.getElementById('pool-reputation-provider');
  if (!button || !input) return;
  const providerIdentity = createPoolIdentity('provider');
  providerIdentity.resolve().then((identity) => {
    input.value = identity.roleId;
  }).catch(() => {});
  button.addEventListener('click', async () => {
    const providerId = input.value.trim();
    if (!providerId) {
      setResult('pool-reputation-result', { error: 'Provider id is required' });
      return;
    }
    button.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.reputation(providerId));
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
  metricsButton?.addEventListener('click', async () => {
    metricsButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.metrics());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      metricsButton.disabled = false;
    }
  });
  statusButton?.addEventListener('click', async () => {
    statusButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.status());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      statusButton.disabled = false;
    }
  });
  deploymentButton?.addEventListener('click', async () => {
    deploymentButton.disabled = true;
    try {
      setResult('pool-reputation-result', await sdk.deploymentCheck());
    } catch (error) {
      setResult('pool-reputation-result', { error: error.message, payload: error.payload || null });
    } finally {
      deploymentButton.disabled = false;
    }
  });
};

const compilePoolShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
};

const createPoolProgram = (gl, vertexSource, fragmentSource) => {
  const vertex = compilePoolShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compilePoolShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown program error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
};

const createPoolSimulationState = () => {
  const peerLayout = [
    [0.58, 0.22],
    [0.74, 0.27],
    [0.86, 0.45],
    [0.76, 0.68],
    [0.58, 0.72],
    [0.91, 0.65]
  ];
  const peers = peerLayout.map(([x, y], index) => ({
    index,
    x,
    y,
    phase: index * 1.7,
    driftX: 8 + (index % 3) * 3,
    driftY: 9 + (index % 2) * 4,
    size: 10 + (index % 3) * 1.5,
    presence: 1,
    lineDraw: 1,
    pulse: 0
  }));
  const particles = Array.from({ length: 54 }, (_, index) => ({
    index,
    offset: (index * 0.137) % 1,
    speed: 0.10 + (index % 5) * 0.018,
    route: index % 3,
    peerIndex: index % peers.length,
    phase: index * 0.47,
    size: 2.4 + (index % 4) * 0.7
  }));
  return {
    peers,
    particles,
    pointer: {
      x: 0.5,
      y: 0.5,
      targetX: 0.5,
      targetY: 0.5,
      active: false,
      force: 0
    },
    time: 0,
    lastFrameMs: performance.now() - SIMULATION_TARGET_STEP_MS
  };
};

const resizePoolCanvas = (canvas) => {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(box.width * ratio));
  const height = Math.max(1, Math.floor(box.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
};

const interpolatePoint = (a, b, amount) => ({
  x: a.x + (b.x - a.x) * amount,
  y: a.y + (b.y - a.y) * amount
});

const resolvePathPoint = (path, amount) => {
  if (path.length === 1) return path[0];
  const scaled = Math.max(0, Math.min(0.999, amount)) * (path.length - 1);
  const index = Math.floor(scaled);
  return interpolatePoint(path[index], path[index + 1], scaled - index);
};

const easeOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 3);
};

const easeInOutCubic = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded < 0.5
    ? 4 * bounded * bounded * bounded
    : 1 - Math.pow(-2 * bounded + 2, 3) / 2;
};

const easeInOutSine = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return -(Math.cos(Math.PI * bounded) - 1) / 2;
};

const easeOutQuart = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - bounded, 4);
};

const routeEase = (value, route) => {
  if (route % 5 === 1) return easeOutQuart(value);
  if (route % 5 === 2) return easeInOutCubic(value);
  if (route % 5 === 3) return easeInOutSine(value);
  return easeOutCubic(value);
};

const lerpToward = (current, target, rate, deltaSeconds) => {
  const deltaMs = Math.max(SIMULATION_MIN_STEP_MS, Math.min(SIMULATION_MAX_STEP_MS, deltaSeconds * 1000));
  const deltaScale = deltaMs / SIMULATION_MIN_STEP_MS;
  const blend = 1 - Math.pow(1 - rate, deltaScale);
  return current + (target - current) * blend;
};

const makeSimulationLine = (from, to, alpha, draw = 1, pulse = 0) => [
  from,
  to,
  alpha,
  easeOutCubic(draw),
  pulse
];

const resolveCurvedPathPoint = (path, amount, route = 0, phase = 0, width = 1, height = 1) => {
  if (path.length === 1) return path[0];
  const bounded = Math.max(0, Math.min(0.999, amount));
  const scaled = bounded * (path.length - 1);
  const index = Math.floor(scaled);
  const local = scaled - index;
  const curvedLocal = routeEase(local, route);
  const from = path[index];
  const to = path[index + 1];
  const base = interpolatePoint(from, to, curvedLocal);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const direction = route % 2 === 0 ? 1 : -1;
  const curve = Math.min(width, height) * (0.035 + (route % 3) * 0.012);
  const wave = Math.sin(local * Math.PI) * Math.sin(phase + route * 1.3);
  return {
    x: base.x + (-dy / distance) * curve * wave * direction,
    y: base.y + (dx / distance) * curve * wave * direction
  };
};

const buildPoolSimulationFrame = (state, width, height, deltaSeconds = SIMULATION_MIN_STEP_MS / 1000) => {
  const safeDelta = Math.max(SIMULATION_MIN_STEP_MS / 1000, Math.min(SIMULATION_MAX_STEP_MS / 1000, deltaSeconds));
  state.time += safeDelta * SIMULATION_GENTLE_SPEED;
  state.pointer.x = lerpToward(state.pointer.x, state.pointer.targetX, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.y = lerpToward(state.pointer.y, state.pointer.targetY, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.force = lerpToward(state.pointer.force, state.pointer.active ? 1 : 0, SIMULATION_FORCE_LERP, safeDelta);
  if (state.pointer.force < SIMULATION_MIN_FORCE) state.pointer.force = 0;

  const time = state.time;
  const makeRole = (x, y, size, phase, orbit = 9) => {
    const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + phase);
    return {
      x: width * x + Math.cos(time * 0.52 + phase) * orbit,
      y: height * y + Math.sin(time * 0.46 + phase * 1.3) * orbit,
      size: size * (0.9 + breathe * 0.2),
      alpha: 1,
      pulse: breathe
    };
  };
  const roles = {
    requester: makeRole(0.16, 0.58, 17, 0.2, 7),
    coordinator: makeRole(0.44, 0.42, 21, 1.8, 8),
    verifier: makeRole(0.62, 0.43, 16, 3.3, 7),
    ledger: makeRole(0.80, 0.58, 17, 4.8, 7)
  };
  const pointerX = state.pointer.x * width;
  const pointerY = state.pointer.y * height;
  const peers = state.peers.map((peer) => {
    peer.presence = 1;
    peer.lineDraw = 1;
    peer.pulse = 0.5 + 0.5 * Math.sin(time * 1.55 + peer.phase);
    const baseX = width * peer.x;
    const baseY = height * peer.y;
    const dx = baseX - pointerX;
    const dy = baseY - pointerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pointerLift = state.pointer.active || state.pointer.force > 0.02
      ? Math.max(0, 1 - distance / (width * 0.34)) * (14 + state.pointer.force * 22)
      : 0;
    return {
      ...peer,
      online: true,
      x: baseX
        + Math.cos(time * 0.78 + peer.phase) * peer.driftX
        + Math.sin(time * 0.33 + peer.phase * 1.4) * peer.driftX * 0.55
        + (dx / distance) * pointerLift,
      y: baseY
        + Math.sin(time * 0.72 + peer.phase) * peer.driftY
        + Math.cos(time * 0.41 + peer.phase * 1.2) * peer.driftY * 0.42
        + (dy / distance) * pointerLift,
      alpha: 0.78 + peer.pulse * 0.18,
      size: peer.size * (0.78 + peer.pulse * 0.5) + state.pointer.force * 2,
      presence: peer.presence,
      lineDraw: peer.lineDraw,
      pulse: peer.pulse
    };
  });
  const peerFor = (index) => peers[index % peers.length];
  const corePulse = (phase) => 0.14 + 0.18 * (Math.sin(time * 2.4 + phase) * 0.5 + 0.5);
  const lines = [
    makeSimulationLine(roles.requester, roles.coordinator, 0.38, 1, corePulse(0)),
    makeSimulationLine(roles.coordinator, roles.verifier, 0.30, 1, corePulse(1)),
    makeSimulationLine(roles.verifier, roles.ledger, 0.40, 1, corePulse(2)),
    ...peers.map((peer) => makeSimulationLine(
      roles.coordinator,
      peer,
      0.06 + peer.pulse * 0.08,
      peer.lineDraw,
      peer.pulse * 0.45
    )),
    ...peers.map((peer) => makeSimulationLine(
      peer,
      roles.verifier,
      0.04 + peer.pulse * 0.07,
      peer.lineDraw,
      (1 - peer.pulse) * 0.35
    ))
  ];
  const particles = state.particles.map((particle) => {
    const peer = peerFor(particle.peerIndex);
    const flowPulse = Math.sin(time * 6.2 + particle.phase) * 0.5 + 0.5;
    const progress = (particle.offset + time * particle.speed * (1.1 + peer.pulse * 0.28) + state.pointer.force * 0.05) % 1;
    const path = particle.route === 0
      ? [roles.requester, roles.coordinator, roles.verifier, roles.ledger]
      : particle.route === 1
        ? [roles.coordinator, peer, roles.verifier]
        : [peer, roles.verifier, roles.ledger];
    const point = resolveCurvedPathPoint(path, progress, particle.route, particle.phase + time, width, height);
    return {
      x: point.x,
      y: point.y,
      size: particle.size + flowPulse * 2.1 + peer.pulse * 0.8,
      alpha: 0.18 + flowPulse * 0.46,
      route: particle.route
    };
  });
  return {
    lines,
    nodes: [roles.requester, roles.coordinator, roles.verifier, roles.ledger, ...peers].map((node) => clampCanvasPoint(node, width, height, 8)),
    particles: particles.map((particle) => clampCanvasPoint(particle, width, height, 5)),
    peerCount: peers.length
  };
};

const drawPoolSimulation2D = (ctx, frame, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const softCyan = (alpha) => `rgba(0, 172, 190, ${alpha})`;
  const softGold = (alpha) => `rgba(177, 115, 38, ${alpha})`;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  for (let index = 0; index < 6; index += 1) {
    const y = height * (0.18 + index * 0.12);
    ctx.beginPath();
    ctx.moveTo(width * 0.10, y);
    ctx.bezierCurveTo(width * 0.34, y - 22, width * 0.62, y + 22, width * 0.92, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 1.35;
  frame.lines.forEach(([a, b, alpha, draw = 1, pulse = 0], index) => {
    const end = interpolatePoint(a, b, draw);
    ctx.strokeStyle = index < 3 ? softCyan(alpha * 0.9) : `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    if (pulse > 0.02) {
      const pulsePoint = interpolatePoint(a, end, 0.5 + Math.sin(pulse * Math.PI) * 0.34);
      ctx.fillStyle = index < 3
        ? softGold(Math.min(0.54, alpha + pulse * 0.26))
        : `rgba(0, 0, 0, ${Math.min(0.50, alpha + pulse * 0.22)})`;
      ctx.beginPath();
      ctx.arc(pulsePoint.x, pulsePoint.y, 3 + pulse * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (const particle of frame.particles) {
    ctx.fillStyle = particle.route === 0
      ? softCyan(particle.alpha)
      : particle.route === 1
        ? `rgba(0, 0, 0, ${particle.alpha * 0.72})`
        : softGold(particle.alpha * 0.88);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  frame.nodes.forEach((node, index) => {
    const core = index < 4;
    ctx.strokeStyle = core ? softCyan(0.74) : `rgba(0, 0, 0, ${node.alpha * 0.62})`;
    ctx.fillStyle = core ? `rgba(0, 0, 0, ${node.alpha * 0.82})` : `rgba(0, 0, 0, ${node.alpha * 0.54})`;
    ctx.lineWidth = core ? 2 : 1.25;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(node.x, node.y, Math.max(2, node.size * 0.28), 0, Math.PI * 2);
    ctx.fill();
  });
};

const createPoolWebGLRenderer = (canvas) => {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
    || canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
  if (!gl) return null;
  const lineProgram = createPoolProgram(gl, `
    attribute vec2 a_position;
    attribute float a_alpha;
    uniform vec2 u_resolution;
    varying float v_alpha;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      v_alpha = a_alpha;
    }
  `, `
    precision mediump float;
    varying float v_alpha;
    void main() {
      gl_FragColor = vec4(0.0, 0.0, 0.0, v_alpha);
    }
  `);
  const pointProgram = createPoolProgram(gl, `
    attribute vec2 a_position;
    attribute float a_alpha;
    attribute float a_size;
    uniform vec2 u_resolution;
    varying float v_alpha;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 clipSpace = zeroToOne * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      gl_PointSize = a_size;
      v_alpha = a_alpha;
    }
  `, `
    precision mediump float;
    varying float v_alpha;
    void main() {
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) discard;
      float edge = smoothstep(0.5, 0.22, dist);
      gl_FragColor = vec4(0.0, 0.0, 0.0, v_alpha * edge);
    }
  `);
  const lineBuffer = gl.createBuffer();
  const pointBuffer = gl.createBuffer();
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return (frame, width, height) => {
    gl.viewport(0, 0, width, height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const lineData = [];
    const linePulseData = [];
    for (const [a, b, alpha, draw = 1, pulse = 0] of frame.lines) {
      const end = interpolatePoint(a, b, draw);
      lineData.push(a.x, a.y, alpha, end.x, end.y, alpha);
      if (pulse > 0.02) {
        const pulsePoint = interpolatePoint(a, end, 0.5 + Math.sin(pulse * Math.PI) * 0.34);
        linePulseData.push(pulsePoint.x, pulsePoint.y, Math.min(0.65, alpha + pulse * 0.32), 8 + pulse * 18);
      }
    }
    gl.useProgram(lineProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineData), gl.DYNAMIC_DRAW);
    let location = gl.getAttribLocation(lineProgram, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 12, 0);
    location = gl.getAttribLocation(lineProgram, 'a_alpha');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 12, 8);
    gl.uniform2f(gl.getUniformLocation(lineProgram, 'u_resolution'), width, height);
    gl.drawArrays(gl.LINES, 0, lineData.length / 3);

    const pointData = [];
    for (const particle of frame.particles) pointData.push(particle.x, particle.y, particle.alpha, particle.size);
    pointData.push(...linePulseData);
    for (const node of frame.nodes) pointData.push(node.x, node.y, node.alpha, node.size * 2);
    gl.useProgram(pointProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointData), gl.DYNAMIC_DRAW);
    location = gl.getAttribLocation(pointProgram, 'a_position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, 0);
    location = gl.getAttribLocation(pointProgram, 'a_alpha');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 16, 8);
    location = gl.getAttribLocation(pointProgram, 'a_size');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 16, 12);
    gl.uniform2f(gl.getUniformLocation(pointProgram, 'u_resolution'), width, height);
    gl.drawArrays(gl.POINTS, 0, pointData.length / 4);
  };
};

const bindHomeSimulation = (mount) => {
  const canvas = mount.querySelector('[data-pool-simulation]');
  if (!canvas) return;
  if (window.REPLOID_POOL_SIMULATION_STOP) {
    window.REPLOID_POOL_SIMULATION_STOP();
    window.REPLOID_POOL_SIMULATION_STOP = null;
  }
  const state = createPoolSimulationState();
  let active = true;
  let frameId = null;
  const renderer = null;
  const ctx = canvas.getContext('2d');
  const readout = mount.querySelector('.pool-simulation-readout');
  const draw = (timestamp = performance.now()) => {
    if (!active) return;
    const rawDeltaMs = Math.max(0, timestamp - state.lastFrameMs);
    state.lastFrameMs = timestamp;
    const deltaMs = Math.max(SIMULATION_MIN_STEP_MS, Math.min(SIMULATION_MAX_STEP_MS, rawDeltaMs || SIMULATION_TARGET_STEP_MS));
    const { width, height } = resizePoolCanvas(canvas);
    const frame = buildPoolSimulationFrame(state, width, height, deltaMs / 1000);
    if (renderer) renderer(frame, width, height);
    else if (ctx) drawPoolSimulation2D(ctx, frame, width, height);
    if (readout) {
      readout.dataset.peers = String(frame.peerCount);
      readout.setAttribute('aria-label', `tokens, receipts, ${frame.peerCount} browsers`);
      const peerCount = readout.querySelector('[data-pool-peer-count]');
      if (peerCount) peerCount.textContent = String(frame.peerCount);
    }
    frameId = window.requestAnimationFrame(draw);
  };
  const movePointer = (event) => {
    const box = canvas.getBoundingClientRect();
    state.pointer.targetX = (event.clientX - box.left) / Math.max(1, box.width);
    state.pointer.targetY = (event.clientY - box.top) / Math.max(1, box.height);
    state.pointer.active = true;
    state.pointer.force = Math.min(1, state.pointer.force + 0.04);
  };
  const leavePointer = () => {
    state.pointer.active = false;
  };
  const pulsePointer = (event) => {
    movePointer(event);
    state.pointer.force = 1;
  };
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerdown', pulsePointer);
  canvas.addEventListener('pointerleave', leavePointer);
  window.REPLOID_POOL_SIMULATION_STOP = () => {
    active = false;
    if (frameId) window.cancelAnimationFrame(frameId);
    canvas.removeEventListener('pointermove', movePointer);
    canvas.removeEventListener('pointerdown', pulsePointer);
    canvas.removeEventListener('pointerleave', leavePointer);
  };
  draw();
};

const bindPoolRouteControls = (mount, render) => {
  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      if (!isProductPath(path)) return;
      event.preventDefault();
      if (window.location.pathname !== path) {
        window.history.pushState({ reploidPoolRoute: path }, '', path);
      }
      render();
    });
  });
};

export function initPoolHome(mount) {
  if (!mount) return;
  const sdk = createPoolSdk();
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => runtime.attachHandle(handle, model, runtimeInfo);
  window.REPLOID_POOL_SDK = sdk;
  mount.style.display = 'block';

  const render = () => {
    const routeId = getRouteId();
    if (routeId !== 'home' && window.REPLOID_POOL_SIMULATION_STOP) {
      window.REPLOID_POOL_SIMULATION_STOP();
      window.REPLOID_POOL_SIMULATION_STOP = null;
    }
    const secondaryContent = renderRouteDetail(routeId);
    document.title = routeId === 'home'
      ? POOLDAY_NAME
      : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.eyebrow || 'Verified Browser Inference'}`;
    mount.innerHTML = `
      <main class="pool-home" data-pool-route-id="${routeId}">
        ${renderNav(routeId)}
        ${renderRoutePanel(routeId)}
        ${secondaryContent}
      </main>
    `;
    bindPoolRouteControls(mount, render);
    bindHomeSimulation(mount);
    bindRunControls(sdk);
    bindAgentControls(sdk);
    bindProviderControls(sdk);
    bindReceiptControls(sdk);
    bindReputationControls(sdk);
  };

  if (window.REPLOID_POOL_POPSTATE_HANDLER) {
    window.removeEventListener('popstate', window.REPLOID_POOL_POPSTATE_HANDLER);
  }
  window.REPLOID_POOL_POPSTATE_HANDLER = render;
  window.addEventListener('popstate', render);
  render();
}

export default {
  initPoolHome
};
