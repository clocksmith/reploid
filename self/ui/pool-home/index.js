/**
 * @fileoverview Public product home for the verified browser inference pool.
 */

import { createPoolSdk, verifyReceiptRecord } from '../../pool/sdk.js';
import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createAgentClient } from '../../pool/agent-client.js';
import { createProviderClient } from '../../pool/provider-client.js';
import { verifyModelArtifactManifest } from '../../pool/model-artifacts.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { LAUNCH_MODEL, buildLaunchProviderModel, getEnabledPoolModelContract, listPoolModels } from '../../pool/model-contract.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import { DEFAULT_PEER_ROOM_ID, createPeerProviderNode, runPeerJob } from '../../pool/peer-room.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import {
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl
} from '../../pool/peer-rendezvous.js';

const PRODUCT_ROUTES = Object.freeze({
  '/': 'home',
  '/run': 'run',
  '/contribute': 'contribute',
  '/agents': 'agents',
  '/receipts': 'receipts',
  '/reputation': 'reputation'
});

const POOLDAY_NAME = 'Reploid';
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
const SIMULATION_MAX_PIXEL_RATIO = 1.35;
const POOLDAY_RECEIPT_LEDGER_LIMIT = 10;
const POOLDAY_NODE_GRID_SQUARES = 20;
const POOLDAY_STREAM_CHUNK_SIZE = 18;
const POOLDAY_STREAM_TICK_MS = 14;
const POOLDAY_FLOW_TUNING = Object.freeze({
  particleCount: 80,
  baseSpeed: 0.118,
  speedJitter: 0.026,
  edgeSpeedStep: 0.008,
  laneGap: 11,
  curveLift: 0.034,
  pipeCurveLift: 0.006,
  particleScale: 1.05,
  pulseScale: 0.42,
  coreLineWidth: 1.55,
  peerLineWidth: 1.18,
  pipeLineWidth: 1.34,
  backgroundBandAlpha: 0.10,
  prismFacetAlpha: 0.026,
  nodeGlowAlpha: 0.092,
  edgeGlowAlpha: 0.11,
  edgeGlowWidth: 4.2,
  maxGlowLines: 18,
  shimmerStride: 3,
  shimmerAlpha: 0.58
});
const POOLDAY_MORPH_TUNING = Object.freeze({
  shapeHold: 9.2,
  floatHold: 3.8,
  holdJitter: 1.65,
  shapeSpan: 3.35,
  floatSpan: 2.35,
  anticipationSpan: 2.15,
  arcLift: 0.105,
  swirlLift: 0.078,
  foldLift: 0.064,
  pipeLift: 0.048,
  settleRate: 0.018
});
const POOLDAY_RAINBOW_COLORS = Object.freeze([
  [246, 82, 118],
  [247, 139, 83],
  [238, 197, 82],
  [105, 210, 153],
  [68, 199, 217],
  [104, 145, 236],
  [174, 122, 238]
]);
const POOLDAY_PROVIDER_LAYOUT = Object.freeze([
  [0.58, 0.22],
  [0.74, 0.27],
  [0.86, 0.45],
  [0.76, 0.68],
  [0.58, 0.72],
  [0.91, 0.65]
]);
const POOLDAY_PROVIDER_NODE_IDS = Object.freeze(
  POOLDAY_PROVIDER_LAYOUT.map((_, index) => `provider${index}`)
);
const POOLDAY_GRAPH_NODE_IDS = Object.freeze([
  'requester',
  'assignment',
  'agreement',
  'ledger',
  ...POOLDAY_PROVIDER_NODE_IDS
]);
const POOLDAY_GRAPH_PALETTES = Object.freeze([
  {
    id: 'rainbow-prism',
    primary: [68, 199, 217],
    evidence: [247, 139, 83],
    peer: [104, 145, 236],
    pipe: [105, 210, 153],
    accent: [246, 82, 118]
  },
  {
    id: 'rainbow-warm',
    primary: [247, 139, 83],
    evidence: [238, 197, 82],
    peer: [174, 122, 238],
    pipe: [68, 199, 217],
    accent: [246, 82, 118]
  },
  {
    id: 'rainbow-cool',
    primary: [104, 145, 236],
    evidence: [105, 210, 153],
    peer: [246, 82, 118],
    pipe: [174, 122, 238],
    accent: [238, 197, 82]
  },
  {
    id: 'rainbow-violet',
    primary: [174, 122, 238],
    evidence: [246, 82, 118],
    peer: [68, 199, 217],
    pipe: [238, 197, 82],
    accent: [104, 145, 236]
  }
]);
const POOLDAY_GRAPH_TOPOLOGIES = Object.freeze([
  {
    id: 'chain_arc',
    label: 'chain + provider arc',
    edgePreset: 'chain_arc',
    morph: 'arc',
    points: {
      requester: [0.16, 0.58],
      assignment: [0.44, 0.42],
      agreement: [0.62, 0.43],
      ledger: [0.80, 0.58],
      provider0: [0.58, 0.22],
      provider1: [0.74, 0.27],
      provider2: [0.86, 0.45],
      provider3: [0.76, 0.68],
      provider4: [0.58, 0.72],
      provider5: [0.91, 0.65]
    }
  },
  {
    id: 'ring_quorum',
    label: 'ring quorum',
    edgePreset: 'ring_quorum',
    morph: 'orbit',
    points: {
      requester: [0.50, 0.15],
      assignment: [0.71, 0.23],
      provider0: [0.86, 0.40],
      provider1: [0.85, 0.61],
      agreement: [0.70, 0.78],
      ledger: [0.50, 0.85],
      provider2: [0.30, 0.78],
      provider3: [0.15, 0.61],
      provider4: [0.14, 0.40],
      provider5: [0.29, 0.23]
    }
  },
  {
    id: 'ring_reduce',
    label: 'ring reduce x5',
    edgePreset: 'ring_reduce',
    morph: 'pipe',
    points: {
      requester: [0.12, 0.50],
      assignment: [0.28, 0.50],
      provider0: [0.43, 0.30],
      provider1: [0.43, 0.40],
      provider2: [0.43, 0.50],
      provider3: [0.43, 0.60],
      provider4: [0.43, 0.70],
      provider5: [0.57, 0.78],
      agreement: [0.68, 0.50],
      ledger: [0.88, 0.50]
    }
  },
  {
    id: 'star_rendezvous',
    label: 'star rendezvous',
    edgePreset: 'star_rendezvous',
    morph: 'fan',
    points: {
      assignment: [0.50, 0.50],
      requester: [0.18, 0.50],
      agreement: [0.72, 0.38],
      ledger: [0.78, 0.66],
      provider0: [0.38, 0.22],
      provider1: [0.55, 0.20],
      provider2: [0.71, 0.24],
      provider3: [0.38, 0.78],
      provider4: [0.55, 0.80],
      provider5: [0.71, 0.76]
    }
  },
  {
    id: 'hourglass',
    label: 'hourglass',
    edgePreset: 'hourglass',
    morph: 'fold',
    points: {
      requester: [0.15, 0.22],
      provider0: [0.17, 0.38],
      provider1: [0.17, 0.56],
      provider2: [0.15, 0.72],
      assignment: [0.44, 0.50],
      agreement: [0.58, 0.50],
      provider3: [0.84, 0.25],
      provider4: [0.86, 0.50],
      provider5: [0.84, 0.74],
      ledger: [0.78, 0.62]
    }
  },
  {
    id: 'provider_mesh',
    label: 'provider mesh',
    edgePreset: 'provider_mesh',
    morph: 'braid',
    points: {
      requester: [0.18, 0.50],
      assignment: [0.38, 0.50],
      agreement: [0.66, 0.50],
      ledger: [0.84, 0.50],
      provider0: [0.49, 0.24],
      provider1: [0.61, 0.24],
      provider2: [0.70, 0.42],
      provider3: [0.61, 0.72],
      provider4: [0.49, 0.72],
      provider5: [0.40, 0.42]
    }
  },
  {
    id: 'two_rail_ladder',
    label: 'two-rail ladder',
    edgePreset: 'two_rail_ladder',
    morph: 'slide',
    points: {
      requester: [0.15, 0.33],
      assignment: [0.36, 0.33],
      agreement: [0.62, 0.33],
      ledger: [0.84, 0.33],
      provider0: [0.24, 0.68],
      provider1: [0.36, 0.68],
      provider2: [0.48, 0.68],
      provider3: [0.60, 0.68],
      provider4: [0.72, 0.68],
      provider5: [0.84, 0.68]
    }
  },
  {
    id: 'receipt_tree',
    label: 'receipt tree',
    edgePreset: 'receipt_tree',
    morph: 'root',
    points: {
      requester: [0.50, 0.15],
      assignment: [0.50, 0.34],
      provider0: [0.20, 0.52],
      provider1: [0.32, 0.55],
      provider2: [0.44, 0.58],
      provider3: [0.56, 0.58],
      provider4: [0.68, 0.55],
      provider5: [0.80, 0.52],
      agreement: [0.50, 0.74],
      ledger: [0.50, 0.88]
    }
  },
  {
    id: 'circuit_board',
    label: 'circuit board',
    edgePreset: 'circuit_board',
    morph: 'orthogonal',
    points: {
      requester: [0.12, 0.35],
      assignment: [0.34, 0.35],
      provider0: [0.34, 0.18],
      provider1: [0.52, 0.18],
      provider2: [0.70, 0.18],
      agreement: [0.70, 0.50],
      provider3: [0.34, 0.78],
      provider4: [0.52, 0.78],
      provider5: [0.70, 0.78],
      ledger: [0.88, 0.50]
    }
  }
]);
const POOLDAY_FLOW_CORE_NODES = Object.freeze([
  {
    id: 'requester',
    label: 'Requesters',
    caption: 'originate',
    body: 'Nodes asking the network to do work. A node can request one job and provide for another.',
    x: '16%',
    y: '58%'
  },
  {
    id: 'assignment',
    label: 'Assignment',
    caption: 'route',
    body: 'The routing phase where work, policy, and available nodes are matched before execution starts.',
    x: '44%',
    y: '42%'
  },
  {
    id: 'agreement',
    label: 'Agreement',
    caption: 'compare',
    body: 'The comparison phase where receipts and outputs are checked before the result is accepted.',
    x: '62%',
    y: '43%'
  },
  {
    id: 'ledger',
    label: 'Ledger',
    caption: 'record',
    body: 'The record of accepted receipts, decisions, and local reputation evidence.',
    x: '80%',
    y: '58%'
  }
]);
const POOLDAY_FLOW_LABELS = Object.freeze([
  ...POOLDAY_FLOW_CORE_NODES,
  {
    id: 'providers',
    label: 'Providers',
    caption: 'serve',
    body: 'Nodes serving work, verifying outputs, or returning receipts. Provider is a role, not a permanent identity.',
    x: '75%',
    y: '27%'
  }
]);
const POOLDAY_FLOW_NODE_COUNT = POOLDAY_FLOW_CORE_NODES.length + POOLDAY_PROVIDER_LAYOUT.length;
const POOLDAY_STREAM_STATE = new Map();
const POOLDAY_RECEIPT_LEDGER = [];
const POOLDAY_PEER_LEDGER_STORAGE_KEY = 'reploid.peerLedgerEvents.v1';
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

const getPeerRoomId = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('room') || window.REPLOID_POOL_ROOM_ID || DEFAULT_PEER_ROOM_ID;
};

const getPeerRelayMode = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('relay') || window.REPLOID_POOL_RELAY || 'local';
};

const getPeerRoomBusFactory = (sdk) => createPeerRoomBusFactory({
  sdk,
  relay: getPeerRelayMode()
});

const getPeerInviteUrl = () => createPeerRoomInviteUrl({
  roomId: getPeerRoomId(),
  relay: getPeerRelayMode(),
  baseUrl: window.location.href
});

const ROUTE_COPY = Object.freeze({
  home: {
    eyebrow: POOLDAY_PROTOCOL,
    title: POOLDAY_NAME,
    body: 'Browser inference with receipts.'
  },
  run: {
    eyebrow: 'Run',
    title: 'Run',
    body: 'Send a prompt and stream the result.'
  },
  contribute: {
    eyebrow: 'Contribute',
    title: 'Contribute',
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
    <div class="boot-status-strip pool-summary" aria-label="Provider health">
      ${rows.map(([label, value]) => `
        <span class="pool-summary-item">
          <span class="rgr-status-label">${escapeHtml(label)}</span>
          <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
        </span>
      `).join('')}
    </div>
  `;
};

const updateProviderHealth = (partial = {}) => {
  Object.assign(POOLDAY_PROVIDER_HEALTH, partial);
  const health = document.getElementById('pool-provider-health');
  if (health) health.innerHTML = renderProviderHealth();
};

const refreshProviderStorageHealth = async () => {
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

const setResult = (id, value, options = {}) => {
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

const renderNav = (activeRoute) => {
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

const describeSelectedRun = ({ policyId, modelId, status = 'finding_peer_provider' } = {}) => {
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
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} providers, quorum by matching receipt`
      : `${policy?.redundancy || 1} provider receipt${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
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
    <small>${escapeHtml(item.caption)}</small>
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
            <div class="pool-control-row pool-primary-actions" aria-label="Provider worker controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-provider-worker-start" type="button">Start</button>
              <button class="btn btn-ghost btn-op" data-op="■" id="pool-provider-worker-stop" type="button" disabled>Stop</button>
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
          <div id="pool-provider-health" class="pool-ledger-shell" aria-live="polite">${renderProviderHealth()}</div>
          <details class="pool-advanced">
            <summary>Manual controls</summary>
            <div class="pool-control-row" aria-label="Manual provider controls">
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
        <p class="type-caption">Review provider history.</p>
        <div class="pool-form" data-pool-reputation>
          <label class="pool-field">
            <span>Provider id</span>
            <input id="pool-reputation-provider" placeholder="provider_..." />
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
  const requesterIdentity = createPoolIdentity('requester', { localOnly: true });
  const requesterClient = createRequesterClient({
    sdk,
    identity: requesterIdentity
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  let lastPeerResult = null;
  const syncReceiptActions = () => {
    const canDecide = !!lastReceiptHash && !lastPeerResult;
    if (acceptButton) acceptButton.disabled = !canDecide;
    if (rejectButton) rejectButton.disabled = !canDecide;
  };
  syncReceiptActions();
  button.addEventListener('click', async () => {
    button.disabled = true;
    lastJobId = null;
    lastReceiptHash = null;
    lastPeerResult = null;
    syncReceiptActions();
    setResult('pool-run-result', describeSelectedRun({
      status: 'finding_peer_provider',
      policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
      modelId: modelSelect?.value || LAUNCH_MODEL.modelId
    }), { stream: true });
    try {
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient,
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: getEnabledPoolModelContract(modelSelect?.value || LAUNCH_MODEL.modelId) || LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        roomBusFactory: getPeerRoomBusFactory(sdk),
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      lastPeerResult = result;
      lastJobId = result?.assignment?.jobId || null;
      lastReceiptHash = result?.receiptHash || null;
      syncReceiptActions();
      setResult('pool-run-result', result, { stream: true });
    } catch (error) {
      setResult('pool-run-result', { error: error.message, payload: error.payload || null }, { stream: true });
    } finally {
      button.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-run-result', lastPeerResult, { stream: true });
      return;
    }
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
    if (lastPeerResult) {
      setResult('pool-run-result', lastPeerResult, { stream: true });
      return;
    }
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
    if (lastPeerResult) {
      setResult('pool-run-result', { error: 'Peer receipt already has a local requester decision', result: lastPeerResult }, { stream: true });
      return;
    }
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
  const agentIdentity = createPoolIdentity('agent', { localOnly: true });
  const agentClient = createAgentClient({
    sdk,
    identity: agentIdentity,
    pointBudget: 0
  });
  let lastJobId = null;
  let lastReceiptHash = null;
  let lastPeerResult = null;
  submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    lastJobId = null;
    lastReceiptHash = null;
    lastPeerResult = null;
    setResult('pool-agent-result', describeSelectedRun({
      status: 'finding_peer_provider',
      policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
      modelId: LAUNCH_MODEL.modelId
    }));
    try {
      const identity = await agentIdentity.resolve();
      const result = await runPeerJob({
        roomId: getPeerRoomId(),
        requesterClient: agentClient,
        prompt: prompt.value,
        policyId: policySelect?.value || FASTEST_RECEIPT_POLICY_ID,
        modelRequirements: LAUNCH_MODEL,
        maxPointSpend: maxSpendInput?.value ? Number(maxSpendInput.value) : null,
        roomBusFactory: getPeerRoomBusFactory(sdk),
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          seed: '0000000000000000'
        }
      });
      result.identity = identity;
      result.inviteUrl = getPeerInviteUrl();
      result.relay = getPeerRelayMode();
      lastPeerResult = result;
      lastJobId = result?.assignment?.jobId || null;
      lastReceiptHash = result?.receiptHash || null;
      setResult('pool-agent-result', result);
    } catch (error) {
      setResult('pool-agent-result', { error: error.message, payload: error.payload || null });
    } finally {
      submitButton.disabled = false;
    }
  });
  pollButton?.addEventListener('click', async () => {
    if (lastPeerResult) {
      setResult('pool-agent-result', lastPeerResult);
      return;
    }
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
    if (lastPeerResult) {
      setResult('pool-agent-result', lastPeerResult);
      return;
    }
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
    if (lastPeerResult) {
      setResult('pool-agent-result', { error: 'Peer receipt already has a local agent decision', result: lastPeerResult });
      return;
    }
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
  const heartbeatButton = document.getElementById('pool-provider-heartbeat');
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
  const peerProviderIdentity = createPoolIdentity('provider', { localOnly: true });
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  const mount = document.getElementById('app');
  const nodeGrid = getNodeGrid(mount);
  updateProviderStatus(mount, 'NODE // OFFLINE');
  setNodeGridProgress(nodeGrid, 0);
  updateProviderHealth({
    webgpu: navigator.gpu ? 'available' : 'unavailable',
    storage: navigator.storage ? 'available' : 'unknown'
  });
  void refreshProviderStorageHealth();
  const providerClient = createProviderClient({
    sdk,
    runtime,
    identity: providerIdentity
  });
  const peerProviderClient = createProviderClient({
    sdk,
    runtime,
    identity: peerProviderIdentity
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
    await refreshProviderStorageHealth();
    updateProviderHealth({
      webgpu: navigator.gpu ? 'available' : 'unavailable',
      model: 'loading',
      artifact: window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true ? 'checking' : 'strict_preflight_off',
      queue: 'starting'
    });
    const model = getEnabledPoolModelContract(modelInput.value || LAUNCH_MODEL.modelId);
    if (!model) throw new Error('Selected model is not enabled for provider registration');
    if (modelMatchesLoadedRuntime(model) && runtime.isReady?.()) {
      setNodeGridProgress(nodeGrid, 0.7);
      updateProviderHealth({
        model: model.modelId,
        artifact: 'ready',
        trust: 'receipt-backed'
      });
      return {
        ok: true,
        status: 'model_loaded',
        model: runtime.getModelInfo()
      };
    }
    let artifactPreflight = null;
    if (window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT === true) {
      artifactPreflight = await verifyModelArtifactManifest({ model });
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
    updateProviderHealth({
      model: model.modelId,
      artifact: artifactPreflight ? 'verified_manifest' : 'ready',
      trust: 'receipt-backed'
    });
    return {
      ...loadResult,
      artifactPreflight,
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
  let peerProviderNode = null;
  const stopPeerProvider = async () => {
    if (!peerProviderNode) return null;
    const node = peerProviderNode;
    peerProviderNode = null;
    return node.stop();
  };
  const ensurePeerProviderReady = async () => {
    const loaded = await loadSelectedProviderModel();
    const model = loaded.model || runtime.getModelInfo();
    const providerIdentityState = await peerProviderIdentity.resolve();
    await stopPeerProvider();
    const node = createPeerProviderNode({
      roomId: getPeerRoomId(),
      providerClient: peerProviderClient,
      roomBusFactory: getPeerRoomBusFactory(sdk),
      onActivity(event) {
        if (event?.status === 'provider_advertised') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          updateProviderHealth({ queue: 'listening' });
          return;
        }
        if (event?.status === 'peer_session_opening') {
          updateProviderStatus(mount, 'NODE // SPAWNING');
          setNodeGridProgress(nodeGrid, 0.9);
          updateProviderHealth({ queue: 'opening_session' });
        }
        if (event?.status === 'peer_session_open') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          setNodeGridProgress(nodeGrid, 1);
          updateProviderHealth({ queue: 'running_peer_job' });
        }
        if (event?.status === 'peer_receipt_sent') {
          updateProviderStatus(mount, 'NODE // SPAWNED');
          setNodeGridProgress(nodeGrid, 1);
          updateProviderHealth({
            queue: 'receipt_sent',
            lastReceipt: event.receiptRecord?.receiptHash || 'signed'
          });
        }
        if (event?.status === 'peer_acceptance_received') {
          updateProviderHealth({
            queue: 'accepted',
            reputation: 'local_event_received'
          });
        }
        if (event?.status === 'peer_session_failed') {
          updateProviderStatus(mount, 'NODE // OFFLINE');
          setNodeGridProgress(nodeGrid, 0);
          updateProviderHealth({ queue: 'session_failed' });
        }
        setResult('pool-provider-result', {
          worker: 'peer_room',
          roomId: getPeerRoomId(),
          relay: getPeerRelayMode(),
          inviteUrl: getPeerInviteUrl(),
          ...event
        });
      }
    });
    peerProviderNode = node;
    const result = await node.start({
      models: [model],
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: listPolicies().map((policy) => policy.policyId)
      }
    });
    return {
      identity: providerIdentityState,
      transport: 'webrtc_peer_room',
      ...result
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
      updateProviderHealth({ model: 'load_failed', artifact: error.payload?.artifactPreflight?.status || 'failed', queue: 'error' });
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
      updateProviderHealth({ queue: 'hosted_registered' });
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
      updateProviderHealth({ queue: 'hosted_register_failed' });
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
      updateProviderHealth({ queue: lastAssignment ? 'hosted_assignment_ready' : 'hosted_queue_empty' });
      setResult('pool-provider-result', result);
    } catch (error) {
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      nextButton.disabled = false;
    }
  });
  heartbeatButton?.addEventListener('click', async () => {
    heartbeatButton.disabled = true;
    try {
      const result = await providerClient.heartbeat();
      updateProviderHealth({ queue: result?.status || 'hosted_heartbeat_sent' });
      setResult('pool-provider-result', result);
    } catch (error) {
      updateProviderHealth({ queue: 'hosted_heartbeat_failed' });
      setResult('pool-provider-result', { error: error.message, payload: error.payload || null });
    } finally {
      heartbeatButton.disabled = false;
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
      updateProviderHealth({ queue: 'hosted_assignment_executed' });
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
      updateProviderHealth({ queue: result?.status || 'hosted_step_complete' });
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
    setResult('pool-provider-result', { worker: 'peer_room_starting', roomId: getPeerRoomId(), model: getProviderModel() });
    updateProviderStatus(mount, 'NODE // SPAWNING');
    setNodeGridProgress(nodeGrid, 0.9);
    try {
      const ready = await ensurePeerProviderReady();
      workerRunning = true;
      syncWorkerButtons();
      updateProviderStatus(mount, 'NODE // SPAWNED');
      setNodeGridProgress(nodeGrid, 1);
      updateProviderHealth({ queue: 'listening' });
      setResult('pool-provider-result', { worker: 'peer_room_listening', relay: getPeerRelayMode(), inviteUrl: getPeerInviteUrl(), ...ready });
    } catch (error) {
      await stopPeerProvider().catch(() => null);
      stopWorker();
      updateProviderHealth({ queue: 'stopped', model: 'load_failed' });
      setResult('pool-provider-result', { worker: 'stopped', error: error.message, payload: error.payload || null });
    } finally {
      syncWorkerButtons();
    }
  });
  workerStopButton?.addEventListener('click', async () => {
    workerStopButton.disabled = true;
    const stopped = await stopPeerProvider().catch((error) => ({ error: error.message, payload: error.payload || null }));
    stopWorker();
    updateProviderHealth({ queue: 'stopped' });
    setResult('pool-provider-result', { worker: 'stopped', peer: stopped });
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
      const reputation = await sdk.reputation(identity.roleId);
      updateProviderHealth({ reputation: reputation?.providerId || reputation?.record?.providerId || 'loaded' });
      setResult('pool-provider-result', reputation);
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

const cloneTopologyPoints = (topology) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => {
    const point = topology.points[id] || [0.5, 0.5];
    return [id, { x: point[0], y: point[1] }];
  })
);

const copyGraphPoints = (points) => Object.fromEntries(
  POOLDAY_GRAPH_NODE_IDS.map((id) => [id, { ...(points[id] || { x: 0.5, y: 0.5 }) }])
);

const findTopologyByIndex = (index) => POOLDAY_GRAPH_TOPOLOGIES[
  ((index % POOLDAY_GRAPH_TOPOLOGIES.length) + POOLDAY_GRAPH_TOPOLOGIES.length) % POOLDAY_GRAPH_TOPOLOGIES.length
] || POOLDAY_GRAPH_TOPOLOGIES[0];

const getInitialGraphTopologyIndex = () => {
  try {
    const shape = new URLSearchParams(globalThis.location?.search || '').get('shape');
    if (!shape) return 0;
    const normalized = shape.trim().toLowerCase().replace(/\s+/g, '_');
    const index = POOLDAY_GRAPH_TOPOLOGIES.findIndex((topology) => (
      topology.id === normalized || topology.label.toLowerCase().replace(/\s+/g, '_') === normalized
    ));
    return index >= 0 ? index : 0;
  } catch {
    return 0;
  }
};

const createFloatTopologyPoints = (sourcePoints = {}) => {
  const centerX = 0.50 + (Math.random() - 0.5) * 0.10;
  const centerY = 0.50 + (Math.random() - 0.5) * 0.08;
  const rotation = Math.random() * Math.PI * 2;
  return Object.fromEntries(POOLDAY_GRAPH_NODE_IDS.map((id, index) => {
    const source = sourcePoints[id] || { x: centerX, y: centerY };
    const angle = rotation + index * 2.399963229728653;
    const radius = 0.14 + Math.random() * 0.25;
    const sourcePull = id.startsWith('provider') ? 0.42 : 0.28;
    return [
      id,
      {
        x: clampRange(centerX + Math.cos(angle) * radius + (source.x - centerX) * sourcePull, 0.10, 0.90),
        y: clampRange(centerY + Math.sin(angle) * radius * 0.78 + (source.y - centerY) * sourcePull, 0.14, 0.86)
      }
    ];
  }));
};

const createTopologyTransition = (fromPoints, toPoints, mode = 'arc', span = POOLDAY_MORPH_TUNING.shapeSpan, options = {}) => ({
  from: copyGraphPoints(fromPoints),
  to: copyGraphPoints(toPoints),
  mode,
  span,
  progress: 0,
  fromEdgePreset: options.fromEdgePreset || null,
  toEdgePreset: options.toEdgePreset || null,
  twist: Math.random() > 0.5 ? 1 : -1,
  controls: Object.fromEntries(POOLDAY_GRAPH_NODE_IDS.map((id, index) => {
    const from = fromPoints[id] || { x: 0.5, y: 0.5 };
    const to = toPoints[id] || from;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    const normalX = -dy / distance;
    const normalY = dx / distance;
    const lane = id.startsWith('provider') ? Number(id.replace('provider', '')) : index;
    const lanePhase = ((lane % 5) - 2) / 2;
    return [
      id,
      {
        normalX,
        normalY,
        lanePhase,
        delay: id.startsWith('provider') ? (lane % 6) * 0.018 : index * 0.01,
        spin: (index % 2 === 0 ? 1 : -1) * (0.65 + (lane % 3) * 0.16)
      }
    ];
  }))
});

const resolveMorphLift = (transition, id, eased, raw) => {
  const control = transition.controls[id] || {};
  const lift = Math.sin(raw * Math.PI);
  const mode = transition.mode;
  if (mode === 'orbit') return {
    x: Math.cos(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * lift,
    y: Math.sin(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * lift
  };
  if (mode === 'fan') return {
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * lift,
    y: ((control.normalY || 0) + (control.lanePhase || 0) * 0.32) * POOLDAY_MORPH_TUNING.arcLift * lift
  };
  if (mode === 'fold') return {
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.foldLift * lift,
    y: (eased < 0.5 ? -1 : 1) * POOLDAY_MORPH_TUNING.foldLift * (0.7 + Math.abs(control.lanePhase || 0)) * lift
  };
  if (mode === 'braid') return {
    x: Math.sin(raw * Math.PI * 2 + (control.lanePhase || 0)) * POOLDAY_MORPH_TUNING.swirlLift * 0.62 * lift,
    y: Math.cos(raw * Math.PI * 2 + (control.lanePhase || 0)) * POOLDAY_MORPH_TUNING.swirlLift * 0.42 * lift
  };
  if (mode === 'slide') return {
    x: 0,
    y: (control.lanePhase || 0) * POOLDAY_MORPH_TUNING.foldLift * lift
  };
  if (mode === 'root') return {
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * 0.42 * lift,
    y: -Math.abs(control.lanePhase || 0) * POOLDAY_MORPH_TUNING.arcLift * lift
  };
  if (mode === 'pipe') return {
    x: Math.sin(raw * Math.PI * 2) * POOLDAY_MORPH_TUNING.pipeLift * 0.32 * lift,
    y: (control.lanePhase || 0) * POOLDAY_MORPH_TUNING.pipeLift * lift
  };
  if (mode === 'orthogonal') return {
    x: (eased < 0.5 ? control.normalX || 0 : 0) * POOLDAY_MORPH_TUNING.arcLift * 0.52 * lift,
    y: (eased >= 0.5 ? control.normalY || 0 : 0) * POOLDAY_MORPH_TUNING.arcLift * 0.52 * lift
  };
  if (mode === 'float') return {
    x: Math.cos(raw * Math.PI * control.spin) * POOLDAY_MORPH_TUNING.swirlLift * 0.74 * lift,
    y: Math.sin(raw * Math.PI * (1.2 + Math.abs(control.lanePhase || 0))) * POOLDAY_MORPH_TUNING.swirlLift * 0.52 * lift
  };
  return {
    x: (control.normalX || 0) * POOLDAY_MORPH_TUNING.arcLift * lift,
    y: (control.normalY || 0) * POOLDAY_MORPH_TUNING.arcLift * lift
  };
};

const resolveTransitionPoint = (id, transition) => {
  const from = transition.from[id] || { x: 0.5, y: 0.5 };
  const to = transition.to[id] || from;
  const control = transition.controls[id] || {};
  const raw = clamp01((transition.progress - (control.delay || 0)) / Math.max(0.001, 1 - (control.delay || 0)));
  const eased = easeSinePlateau(raw);
  const lift = resolveMorphLift(transition, id, eased, raw);
  return {
    x: clampRange(from.x + (to.x - from.x) * eased + lift.x, 0.08, 0.92),
    y: clampRange(from.y + (to.y - from.y) * eased + lift.y, 0.12, 0.88)
  };
};

const createPoolGraphLayout = () => {
  const initialIndex = getInitialGraphTopologyIndex();
  const firstTopology = findTopologyByIndex(initialIndex);
  const points = cloneTopologyPoints(firstTopology);
  return {
    positions: copyGraphPoints(points),
    targets: points,
    topologyIndex: initialIndex,
    phase: 'shape',
    label: firstTopology.label,
    edgePreset: firstTopology.edgePreset,
    nextShiftAt: POOLDAY_MORPH_TUNING.shapeHold + Math.random() * POOLDAY_MORPH_TUNING.holdJitter,
    transition: null,
    anticipation: 0,
    flowEnergy: 1,
    flowEnergyTarget: 1,
    paletteFromIndex: 0,
    paletteToIndex: 0,
    paletteBlend: 1
  };
};

const pickPoolPaletteIndex = (currentIndex) => {
  if (POOLDAY_GRAPH_PALETTES.length < 2) return 0;
  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * POOLDAY_GRAPH_PALETTES.length);
  }
  return nextIndex;
};

const shiftPoolGraphTarget = (layout, time) => {
  const fromEdgePreset = layout.edgePreset;
  if (layout.phase === 'shape') {
    layout.phase = 'float';
    layout.targets = createFloatTopologyPoints(layout.positions);
    layout.label = 'floating reassort';
    layout.transition = createTopologyTransition(
      layout.positions,
      layout.targets,
      'float',
      POOLDAY_MORPH_TUNING.floatSpan,
      {
        fromEdgePreset,
        toEdgePreset: 'float'
      }
    );
    layout.nextShiftAt = time + POOLDAY_MORPH_TUNING.floatHold + Math.random() * POOLDAY_MORPH_TUNING.holdJitter;
  } else {
    layout.phase = 'shape';
    layout.topologyIndex = (layout.topologyIndex + 1) % POOLDAY_GRAPH_TOPOLOGIES.length;
    const topology = findTopologyByIndex(layout.topologyIndex);
    layout.targets = cloneTopologyPoints(topology);
    layout.label = topology.label;
    layout.transition = createTopologyTransition(
      layout.positions,
      layout.targets,
      topology.morph || 'arc',
      POOLDAY_MORPH_TUNING.shapeSpan,
      {
        fromEdgePreset,
        toEdgePreset: topology.edgePreset
      }
    );
    layout.nextShiftAt = time + POOLDAY_MORPH_TUNING.shapeHold + Math.random() * POOLDAY_MORPH_TUNING.holdJitter;
  }
  layout.flowEnergyTarget = 0.62 + Math.random() * 0.92;
  layout.paletteFromIndex = layout.paletteToIndex;
  layout.paletteToIndex = pickPoolPaletteIndex(layout.paletteToIndex);
  layout.paletteBlend = 0;
};

const mixColor = (from, to, amount) => from.map((value, index) => (
  Math.round(value + (to[index] - value) * amount)
));

const resolvePoolGraphPalette = (layout) => {
  const from = POOLDAY_GRAPH_PALETTES[layout.paletteFromIndex] || POOLDAY_GRAPH_PALETTES[0];
  const to = POOLDAY_GRAPH_PALETTES[layout.paletteToIndex] || from;
  const blend = clamp01(layout.paletteBlend);
  return {
    primary: mixColor(from.primary, to.primary, blend),
    evidence: mixColor(from.evidence, to.evidence, blend),
    peer: mixColor(from.peer, to.peer, blend),
    pipe: mixColor(from.pipe, to.pipe, blend),
    accent: mixColor(from.accent, to.accent, blend),
    rainbow: POOLDAY_RAINBOW_COLORS
  };
};

const updatePoolGraphLayout = (state, safeDelta) => {
  const layout = state.layout;
  if (state.time >= layout.nextShiftAt) {
    shiftPoolGraphTarget(layout, state.time);
  }
  if (layout.transition) {
    layout.anticipation = 0;
    layout.transition.progress = clamp01(
      layout.transition.progress + safeDelta / Math.max(0.001, layout.transition.span)
    );
    for (const id of POOLDAY_GRAPH_NODE_IDS) {
      layout.positions[id] = resolveTransitionPoint(id, layout.transition);
    }
    if (layout.transition.progress >= 1) {
      layout.positions = copyGraphPoints(layout.transition.to);
      layout.edgePreset = layout.transition.toEdgePreset || layout.edgePreset;
      layout.transition = null;
    }
  } else {
    layout.anticipation = clamp01(
      1 - Math.max(0, layout.nextShiftAt - state.time) / POOLDAY_MORPH_TUNING.anticipationSpan
    );
    for (const id of POOLDAY_GRAPH_NODE_IDS) {
      const current = layout.positions[id];
      const target = layout.targets[id] || current;
      current.x = lerpToward(current.x, target.x, POOLDAY_MORPH_TUNING.settleRate, safeDelta);
      current.y = lerpToward(current.y, target.y, POOLDAY_MORPH_TUNING.settleRate, safeDelta);
    }
  }
  layout.flowEnergy = lerpToward(layout.flowEnergy, layout.flowEnergyTarget, 0.035, safeDelta);
  layout.paletteBlend = lerpToward(layout.paletteBlend, 1, 0.042, safeDelta);
  return layout.positions;
};

const createPoolSimulationState = () => {
  const peers = POOLDAY_PROVIDER_LAYOUT.map(([x, y], index) => ({
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
  const particles = Array.from({ length: POOLDAY_FLOW_TUNING.particleCount }, (_, index) => ({
    index,
    offset: (index * 0.113) % 1,
    speed: POOLDAY_FLOW_TUNING.baseSpeed
      + (index % 5) * POOLDAY_FLOW_TUNING.edgeSpeedStep
      + ((index % 7) / 7) * POOLDAY_FLOW_TUNING.speedJitter,
    edgeIndex: index,
    laneBias: (index % 5) - 2,
    tone: index % 4,
    peerIndex: index % peers.length,
    phase: index * 0.47,
    size: (2.7 + (index % 4) * 0.74) * POOLDAY_FLOW_TUNING.particleScale
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
    layout: createPoolGraphLayout(),
    time: 0,
    lastFrameMs: performance.now() - SIMULATION_TARGET_STEP_MS
  };
};

const resizePoolCanvas = (canvas) => {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, SIMULATION_MAX_PIXEL_RATIO);
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

const easeSinePlateau = (value) => {
  const bounded = Math.max(0, Math.min(1, value));
  const shoulder = 0.32;
  if (bounded < shoulder) {
    return shoulder * (0.5 - 0.5 * Math.cos(Math.PI * bounded / shoulder));
  }
  if (bounded > 1 - shoulder) {
    return 1 - shoulder * (0.5 - 0.5 * Math.cos(Math.PI * (1 - bounded) / shoulder));
  }
  return bounded;
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

const makeSimulationLine = (from, to, options = {}) => ({
  from,
  to,
  alpha: options.alpha ?? 0.18,
  draw: easeOutCubic(options.draw ?? 1),
  pulse: options.pulse ?? 0,
  tone: options.tone || 'peer',
  toneIndex: options.toneIndex || 0,
  laneIndex: options.laneIndex || 0,
  laneCount: options.laneCount || 1,
  curve: options.curve ?? POOLDAY_FLOW_TUNING.curveLift,
  speed: options.speed ?? 1,
  width: options.width ?? POOLDAY_FLOW_TUNING.peerLineWidth
});

const addSimulationEdgeBundle = (lines, nodes, fromId, toId, options = {}) => {
  const from = nodes[fromId];
  const to = nodes[toId];
  if (!from || !to) return;
  const lanes = Math.max(1, Number(options.lanes || 1));
  const toneSeed = Number(options.toneIndex ?? lines.length);
  for (let laneIndex = 0; laneIndex < lanes; laneIndex += 1) {
    lines.push(makeSimulationLine(from, to, {
      ...options,
      laneIndex,
      laneCount: lanes,
      tone: options.tone || 'rainbow',
      toneIndex: toneSeed + laneIndex,
      alpha: (options.alpha ?? 0.16) * (lanes > 1 ? 0.82 : 1),
      pulse: (options.pulse || 0) + laneIndex * 0.05,
      speed: (options.speed || 1) + laneIndex * 0.035
    }));
  }
};

const addProviderRingEdges = (lines, nodes, options = {}) => {
  for (let index = 0; index < POOLDAY_PROVIDER_NODE_IDS.length; index += 1) {
    addSimulationEdgeBundle(
      lines,
      nodes,
      POOLDAY_PROVIDER_NODE_IDS[index],
      POOLDAY_PROVIDER_NODE_IDS[(index + 1) % POOLDAY_PROVIDER_NODE_IDS.length],
      {
        alpha: 0.10,
        tone: 'accent',
        curve: 0.025,
        speed: 0.82,
        ...options
      }
    );
  }
};

const buildSimulationLines = ({ roles, peers, preset, time }) => {
  const nodes = {
    requester: roles.requester,
    assignment: roles.coordinator,
    agreement: roles.verifier,
    ledger: roles.ledger
  };
  for (const peer of peers) nodes[peer.id] = peer;
  const pulse = (phase, scale = 1) => (
    0.12 + 0.22 * (Math.sin(time * 2.35 + phase) * 0.5 + 0.5) * scale
  );
  const lines = [];
  const core = (from, to, options = {}) => addSimulationEdgeBundle(lines, nodes, from, to, {
    alpha: 0.34,
    tone: 'primary',
    curve: 0.018,
    width: POOLDAY_FLOW_TUNING.coreLineWidth,
    speed: 1,
    ...options
  });
  const peer = (from, to, options = {}) => addSimulationEdgeBundle(lines, nodes, from, to, {
    alpha: 0.105,
    tone: 'peer',
    curve: 0.032,
    width: POOLDAY_FLOW_TUNING.peerLineWidth,
    speed: 0.9,
    ...options
  });
  const pipe = (from, to, options = {}) => addSimulationEdgeBundle(lines, nodes, from, to, {
    alpha: 0.19,
    tone: 'pipe',
    curve: POOLDAY_FLOW_TUNING.pipeCurveLift,
    width: POOLDAY_FLOW_TUNING.pipeLineWidth,
    speed: 1.06,
    ...options
  });
  if (preset === 'ring_reduce') {
    core('requester', 'assignment', { lanes: 2, pulse: pulse(0), speed: 0.98 });
    pipe('assignment', 'agreement', { lanes: 5, alpha: 0.24, pulse: pulse(1, 1.35), speed: 1.12 });
    core('agreement', 'ledger', { lanes: 2, pulse: pulse(2), tone: 'evidence', speed: 0.96 });
    for (let index = 0; index < 5; index += 1) {
      peer(`provider${index}`, 'agreement', { alpha: 0.095, tone: 'accent', curve: 0.018, speed: 0.88 });
    }
    peer('provider5', 'agreement', { lanes: 2, alpha: 0.12, tone: 'evidence', curve: 0.025, speed: 0.78 });
    addProviderRingEdges(lines, nodes, { alpha: 0.075, speed: 0.74 });
    return lines;
  }
  if (preset === 'ring_quorum') {
    const ring = ['requester', 'assignment', 'provider0', 'provider1', 'agreement', 'ledger', 'provider2', 'provider3', 'provider4', 'provider5'];
    for (let index = 0; index < ring.length; index += 1) {
      peer(ring[index], ring[(index + 1) % ring.length], { alpha: 0.13, tone: index % 2 ? 'pipe' : 'peer', speed: 0.88 });
    }
    core('requester', 'assignment', { pulse: pulse(0) });
    core('agreement', 'ledger', { pulse: pulse(2), tone: 'evidence' });
    pipe('assignment', 'agreement', { lanes: 3, alpha: 0.18, pulse: pulse(1), speed: 1.02 });
    return lines;
  }
  if (preset === 'star_rendezvous') {
    core('requester', 'assignment', { lanes: 2, pulse: pulse(0) });
    for (const providerId of POOLDAY_PROVIDER_NODE_IDS) peer('assignment', providerId, { tone: 'pipe', alpha: 0.12, speed: 0.94 });
    pipe('assignment', 'agreement', { lanes: 4, pulse: pulse(1), speed: 1.08 });
    core('agreement', 'ledger', { pulse: pulse(2), tone: 'evidence' });
    return lines;
  }
  if (preset === 'hourglass') {
    core('requester', 'assignment', { pulse: pulse(0), speed: 0.96 });
    for (const providerId of ['provider0', 'provider1', 'provider2']) peer(providerId, 'assignment', { alpha: 0.12, speed: 0.82 });
    pipe('assignment', 'agreement', { lanes: 3, pulse: pulse(1), speed: 1.04 });
    for (const providerId of ['provider3', 'provider4', 'provider5']) peer('agreement', providerId, { alpha: 0.12, tone: 'accent', speed: 0.84 });
    core('agreement', 'ledger', { tone: 'evidence', pulse: pulse(2) });
    return lines;
  }
  if (preset === 'provider_mesh' || preset === 'float') {
    core('requester', 'assignment', { pulse: pulse(0) });
    pipe('assignment', 'agreement', { lanes: preset === 'float' ? 2 : 3, pulse: pulse(1), speed: 1.02 });
    core('agreement', 'ledger', { tone: 'evidence', pulse: pulse(2) });
    addProviderRingEdges(lines, nodes, { alpha: preset === 'float' ? 0.08 : 0.12, tone: 'pipe' });
    for (let index = 0; index < POOLDAY_PROVIDER_NODE_IDS.length; index += 2) {
      peer(POOLDAY_PROVIDER_NODE_IDS[index], 'agreement', { alpha: 0.09, tone: 'accent', speed: 0.8 });
    }
    return lines;
  }
  if (preset === 'two_rail_ladder') {
    core('requester', 'assignment', { pulse: pulse(0) });
    core('assignment', 'agreement', { lanes: 2, pulse: pulse(1), speed: 1.02 });
    core('agreement', 'ledger', { tone: 'evidence', pulse: pulse(2) });
    for (let index = 0; index < POOLDAY_PROVIDER_NODE_IDS.length - 1; index += 1) {
      peer(POOLDAY_PROVIDER_NODE_IDS[index], POOLDAY_PROVIDER_NODE_IDS[index + 1], { alpha: 0.12, tone: 'pipe', curve: 0.006, speed: 0.88 });
    }
    for (let index = 0; index < 4; index += 1) {
      peer(['requester', 'assignment', 'agreement', 'ledger'][index], POOLDAY_PROVIDER_NODE_IDS[Math.min(index + 1, 5)], { alpha: 0.08, speed: 0.72 });
    }
    return lines;
  }
  if (preset === 'receipt_tree') {
    core('requester', 'assignment', { pulse: pulse(0), curve: 0.01 });
    for (const providerId of POOLDAY_PROVIDER_NODE_IDS) peer('assignment', providerId, { alpha: 0.10, tone: 'pipe', speed: 0.86 });
    for (const providerId of POOLDAY_PROVIDER_NODE_IDS) peer(providerId, 'agreement', { alpha: 0.09, tone: 'accent', speed: 0.86 });
    core('agreement', 'ledger', { lanes: 2, tone: 'evidence', pulse: pulse(2), curve: 0.01 });
    return lines;
  }
  if (preset === 'circuit_board') {
    core('requester', 'assignment', { pulse: pulse(0), curve: 0.001 });
    pipe('assignment', 'agreement', { lanes: 3, pulse: pulse(1), curve: 0.001, speed: 1.04 });
    core('agreement', 'ledger', { tone: 'evidence', pulse: pulse(2), curve: 0.001 });
    for (const providerId of ['provider0', 'provider1', 'provider2']) peer('assignment', providerId, { alpha: 0.10, curve: 0.001, tone: 'pipe' });
    for (const providerId of ['provider3', 'provider4', 'provider5']) peer(providerId, 'agreement', { alpha: 0.10, curve: 0.001, tone: 'accent' });
    return lines;
  }
  core('requester', 'assignment', { pulse: pulse(0) });
  core('assignment', 'agreement', { pulse: pulse(1) });
  core('agreement', 'ledger', { tone: 'evidence', pulse: pulse(2) });
  for (const providerId of POOLDAY_PROVIDER_NODE_IDS) {
    peer('assignment', providerId, { alpha: 0.10, speed: 0.84 });
    peer(providerId, 'agreement', { alpha: 0.09, tone: 'accent', speed: 0.82 });
  }
  return lines;
};

const scaleSimulationLine = (line, amount, toneOffset = 0) => ({
  ...line,
  alpha: line.alpha * amount,
  flowAlpha: amount,
  width: line.width * (0.82 + amount * 0.18),
  toneIndex: line.toneIndex + toneOffset
});

const buildTransitionSimulationLines = ({ roles, peers, layout, time }) => {
  const transition = layout.transition;
  if (!transition?.toEdgePreset || transition.toEdgePreset === layout.edgePreset) {
    return buildSimulationLines({
      roles,
      peers,
      preset: layout.edgePreset,
      time
    });
  }
  const blend = easeSinePlateau(transition.progress);
  const fromAmount = 1 - blend * 0.72;
  const toAmount = 0.16 + blend * 0.84;
  const fromLines = buildSimulationLines({
    roles,
    peers,
    preset: transition.fromEdgePreset || layout.edgePreset,
    time
  }).map((line) => scaleSimulationLine(line, fromAmount, 0));
  const toLines = buildSimulationLines({
    roles,
    peers,
    preset: transition.toEdgePreset,
    time
  }).map((line) => scaleSimulationLine(line, toAmount, 3));
  return [...fromLines, ...toLines];
};

const resolveLineGeometry = (line, width, height) => {
  const from = line.from;
  const to = line.to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const laneOffset = (line.laneIndex - (line.laneCount - 1) / 2) * POOLDAY_FLOW_TUNING.laneGap;
  const curveOffset = Math.min(width, height) * line.curve * (line.laneIndex % 2 === 0 ? 1 : -1);
  return {
    start: {
      x: from.x + normalX * laneOffset,
      y: from.y + normalY * laneOffset
    },
    end: {
      x: to.x + normalX * laneOffset,
      y: to.y + normalY * laneOffset
    },
    control: {
      x: (from.x + to.x) * 0.5 + normalX * (laneOffset + curveOffset),
      y: (from.y + to.y) * 0.5 + normalY * (laneOffset + curveOffset)
    }
  };
};

const resolveLinePoint = (line, amount, width, height) => {
  const { start, end, control } = resolveLineGeometry(line, width, height);
  const t = routeEase(amount, line.laneIndex + Math.round(line.speed * 10));
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
  };
};

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

const resolveFrameBounds = (nodes = [], width = 1, height = 1) => {
  if (!nodes.length) {
    return {
      x: width * 0.5,
      y: height * 0.5,
      radius: Math.min(width, height) * 0.24
    };
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const x = (minX + maxX) * 0.5;
  const y = (minY + maxY) * 0.5;
  const radius = Math.max(60, Math.min(width, height) * 0.12, Math.hypot(maxX - minX, maxY - minY) * 0.56);
  return { x, y, radius };
};

const drawPreChangeCue = (ctx, frame, width, height, toneColor) => {
  const amount = clamp01(frame.anticipation || 0);
  if (amount <= 0.01) return;
  const eased = easeInOutCubic(amount);
  const bounds = resolveFrameBounds(frame.nodes, width, height);
  const ringCount = 4;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < ringCount; index += 1) {
    const ringPhase = clamp01(eased - index * 0.12);
    if (ringPhase <= 0) continue;
    const radius = bounds.radius + 18 + index * 17 + Math.sin(eased * Math.PI + index) * 6;
    const start = -Math.PI * 0.5 + index * 0.62 + eased * Math.PI * 0.42;
    const end = start + Math.PI * (0.46 + ringPhase * 0.52);
    ctx.strokeStyle = toneColor('rainbow', 0.10 + ringPhase * 0.28, index + Math.round(eased * 8));
    ctx.lineWidth = 1.2 + ringPhase * 2.4;
    ctx.beginPath();
    ctx.arc(bounds.x, bounds.y, radius, start, end);
    ctx.stroke();
  }
  for (let index = 0; index < frame.nodes.length; index += 1) {
    const node = frame.nodes[index];
    const pulse = Math.sin(eased * Math.PI * 2 + index * 0.8) * 0.5 + 0.5;
    ctx.strokeStyle = toneColor('rainbow', 0.10 + eased * 0.22, index);
    ctx.lineWidth = 1 + eased * 1.7;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.size + 7 + pulse * 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

const createPrismGradient = (ctx, start, end, toneColor, toneIndex, alpha) => {
  const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, toneColor('rainbow', alpha * 0.70, toneIndex));
  gradient.addColorStop(0.36, toneColor('rainbow', alpha, toneIndex + 2));
  gradient.addColorStop(0.68, toneColor('rainbow', alpha * 0.86, toneIndex + 4));
  gradient.addColorStop(1, toneColor('rainbow', alpha * 0.62, toneIndex + 6));
  return gradient;
};

const drawRuntimePrismField = (ctx, frame, width, height, toneColor) => {
  const time = Number(frame.time || 0);
  const nodes = frame.nodes || [];
  if (!nodes.length) return;
  const bounds = resolveFrameBounds(nodes, width, height);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < 4; index += 1) {
    const radius = bounds.radius * (0.42 + index * 0.18);
    const drift = Math.sin(time * 0.52 + index * 1.7) * 18;
    const gradient = ctx.createRadialGradient(
      bounds.x + Math.cos(index * 1.9 + time * 0.18) * 42,
      bounds.y + Math.sin(index * 1.6 + time * 0.14) * 30,
      Math.max(8, radius * 0.08),
      bounds.x,
      bounds.y + drift,
      Math.max(60, radius)
    );
    gradient.addColorStop(0, toneColor('rainbow', 0.038, index * 2));
    gradient.addColorStop(0.48, toneColor('rainbow', 0.020, index * 2 + 2));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bounds.x, bounds.y + drift, Math.max(80, radius), 0, Math.PI * 2);
    ctx.fill();
  }
  const facetCount = Math.min(6, Math.max(2, Math.floor(nodes.length / 2)));
  for (let index = 0; index < facetCount; index += 1) {
    const a = nodes[index % nodes.length];
    const b = nodes[(index + 3) % nodes.length];
    const c = nodes[(index + 6) % nodes.length];
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.82 + index);
    ctx.fillStyle = toneColor('rainbow', POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.48 + pulse * 0.52), index * 2);
    ctx.strokeStyle = toneColor('rainbow', POOLDAY_FLOW_TUNING.prismFacetAlpha * (0.38 + pulse * 0.42), index * 2 + 3);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

const drawRuntimeNodeHalos = (ctx, frame, toneColor) => {
  const time = Number(frame.time || 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let index = 0; index < frame.nodes.length; index += 1) {
    const node = frame.nodes[index];
    const core = index < 4;
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.15 + index * 0.74);
    const radius = node.size * (core ? 6.8 : 5.2) + pulse * (core ? 10 : 7);
    const gradient = ctx.createRadialGradient(node.x, node.y, Math.max(1, node.size * 0.18), node.x, node.y, radius);
    gradient.addColorStop(0, toneColor('rainbow', POOLDAY_FLOW_TUNING.nodeGlowAlpha * (core ? 1.15 : 0.82), index + 2));
    gradient.addColorStop(0.44, toneColor('rainbow', POOLDAY_FLOW_TUNING.nodeGlowAlpha * 0.38, index + 4));
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const drawRuntimeEdgeGlow = (ctx, frame, width, height, toneColor) => {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  const stride = Math.max(1, Math.ceil(frame.lines.length / POOLDAY_FLOW_TUNING.maxGlowLines));
  for (let index = 0; index < frame.lines.length; index += stride) {
    const line = frame.lines[index];
    const { start, end, control } = resolveLineGeometry(line, width, height);
    const alpha = Math.min(0.32, (line.alpha || 0.1) * POOLDAY_FLOW_TUNING.edgeGlowAlpha * 2.6);
    ctx.strokeStyle = createPrismGradient(ctx, start, end, toneColor, line.toneIndex, alpha);
    ctx.lineWidth = Math.max(3, line.width * POOLDAY_FLOW_TUNING.edgeGlowWidth);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
};

const buildPoolSimulationFrame = (state, width, height, deltaSeconds = SIMULATION_MIN_STEP_MS / 1000) => {
  const safeDelta = Math.max(SIMULATION_MIN_STEP_MS / 1000, Math.min(SIMULATION_MAX_STEP_MS / 1000, deltaSeconds));
  state.time += safeDelta * SIMULATION_GENTLE_SPEED;
  state.pointer.x = lerpToward(state.pointer.x, state.pointer.targetX, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.y = lerpToward(state.pointer.y, state.pointer.targetY, SIMULATION_POINTER_LERP, safeDelta);
  state.pointer.force = lerpToward(state.pointer.force, state.pointer.active ? 1 : 0, SIMULATION_FORCE_LERP, safeDelta);
  if (state.pointer.force < SIMULATION_MIN_FORCE) state.pointer.force = 0;

  const time = state.time;
  const graphPositions = updatePoolGraphLayout(state, safeDelta);
  const makeRole = (id, size, phase, orbit = 9) => {
    const base = graphPositions[id] || { x: 0.5, y: 0.5 };
    const breathe = 0.5 + 0.5 * Math.sin(time * 1.4 + phase);
    return {
      id,
      x: width * base.x + Math.cos(time * 0.52 + phase) * orbit,
      y: height * base.y + Math.sin(time * 0.46 + phase * 1.3) * orbit,
      size: size * (0.9 + breathe * 0.2),
      alpha: 1,
      pulse: breathe
    };
  };
  const roles = {
    requester: makeRole('requester', 17, 0.2, 7),
    coordinator: makeRole('assignment', 21, 1.8, 8),
    verifier: makeRole('agreement', 16, 3.3, 7),
    ledger: makeRole('ledger', 17, 4.8, 7)
  };
  const pointerX = state.pointer.x * width;
  const pointerY = state.pointer.y * height;
  const peers = state.peers.map((peer) => {
    const id = `provider${peer.index}`;
    const base = graphPositions[id] || { x: peer.x, y: peer.y };
    peer.presence = 1;
    peer.lineDraw = 1;
    peer.pulse = 0.5 + 0.5 * Math.sin(time * 1.55 + peer.phase);
    const baseX = width * base.x;
    const baseY = height * base.y;
    const dx = baseX - pointerX;
    const dy = baseY - pointerY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pointerLift = state.pointer.active || state.pointer.force > 0.02
      ? Math.max(0, 1 - distance / (width * 0.34)) * (14 + state.pointer.force * 22)
      : 0;
    return {
      ...peer,
      id,
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
  const flowScale = 0.72 + state.layout.flowEnergy * 0.42;
  const lines = buildTransitionSimulationLines({
    roles,
    peers,
    layout: state.layout,
    time
  });
  const particles = state.particles.map((particle) => {
    const line = lines[particle.edgeIndex % Math.max(1, lines.length)];
    const peer = peers[particle.peerIndex % peers.length];
    const flowPulse = Math.sin(time * 6.2 + particle.phase) * 0.5 + 0.5;
    const progress = (
      particle.offset
      + time * particle.speed * (line?.speed || 1) * (1.02 + peer.pulse * 0.18) * flowScale
      + state.pointer.force * 0.05
    ) % 1;
    const point = line
      ? resolveLinePoint(line, progress, width, height)
      : { x: roles.coordinator.x, y: roles.coordinator.y };
    return {
      index: particle.index,
      x: point.x,
      y: point.y,
      size: particle.size + flowPulse * 2.45 + peer.pulse * 0.9,
      alpha: clamp01((0.34 + flowPulse * 0.60) * (0.84 + state.layout.flowEnergy * 0.22) * (line?.flowAlpha ?? 1)),
      tone: line?.tone || 'rainbow',
      toneIndex: line?.toneIndex || particle.tone
    };
  });
  const providerAnchor = peers.reduce((acc, peer) => ({
    x: acc.x + peer.x / peers.length,
    y: acc.y + peer.y / peers.length
  }), { x: 0, y: 0 });
  return {
    lines,
    nodes: [roles.requester, roles.coordinator, roles.verifier, roles.ledger, ...peers].map((node) => clampCanvasPoint(node, width, height, 8)),
    particles: particles.map((particle) => clampCanvasPoint(particle, width, height, 5)),
    peerCount: peers.length,
    topologyLabel: state.layout.label,
    time,
    flowEnergy: state.layout.flowEnergy,
    anticipation: state.layout.anticipation,
    palette: resolvePoolGraphPalette(state.layout),
    labelAnchors: {
      requester: roles.requester,
      assignment: roles.coordinator,
      agreement: roles.verifier,
      ledger: roles.ledger,
      providers: providerAnchor
    }
  };
};

const drawPoolSimulation2D = (ctx, frame, width, height) => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const palette = frame.palette || POOLDAY_GRAPH_PALETTES[0];
  const flowEnergy = Number(frame.flowEnergy || 1);
  const rgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp01(alpha)})`;
  const toneColor = (tone, alpha, toneIndex = 0) => {
    const rainbow = palette.rainbow || POOLDAY_RAINBOW_COLORS;
    const color = tone === 'rainbow'
      ? rainbow[((toneIndex % rainbow.length) + rainbow.length) % rainbow.length]
      : palette[tone] || rainbow[((toneIndex % rainbow.length) + rainbow.length) % rainbow.length];
    return rgba(color, alpha);
  };
  ctx.save();
  ctx.globalAlpha = POOLDAY_FLOW_TUNING.backgroundBandAlpha;
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
  drawRuntimePrismField(ctx, frame, width, height, toneColor);
  drawRuntimeNodeHalos(ctx, frame, toneColor);
  drawRuntimeEdgeGlow(ctx, frame, width, height, toneColor);
  drawPreChangeCue(ctx, frame, width, height, toneColor);
  frame.lines.forEach((line) => {
    const activeAlpha = line.alpha * (1.05 + flowEnergy * 0.50);
    const { start, end, control } = resolveLineGeometry(line, width, height);
    const drawPoint = {
      x: start.x + (end.x - start.x) * line.draw,
      y: start.y + (end.y - start.y) * line.draw
    };
    const drawControl = {
      x: start.x + (control.x - start.x) * line.draw,
      y: start.y + (control.y - start.y) * line.draw
    };
    ctx.lineWidth = line.width;
    ctx.strokeStyle = createPrismGradient(ctx, start, end, toneColor, line.toneIndex, activeAlpha);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(drawControl.x, drawControl.y, drawPoint.x, drawPoint.y);
    ctx.stroke();
    if (line.pulse > 0.02) {
      const pulsePoint = resolveLinePoint(line, clamp01(0.5 + Math.sin(line.pulse * Math.PI) * 0.34), width, height);
      ctx.fillStyle = toneColor(line.tone === 'primary' ? 'evidence' : line.tone, Math.min(0.64, activeAlpha + line.pulse * POOLDAY_FLOW_TUNING.pulseScale), line.toneIndex + 1);
      ctx.beginPath();
      ctx.arc(pulsePoint.x, pulsePoint.y, 3 + line.pulse * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  for (const particle of frame.particles) {
    if (particle.index % POOLDAY_FLOW_TUNING.shimmerStride === 0) {
      const shimmer = 0.58 + Math.sin((frame.time || 0) * 3 + particle.toneIndex) * 0.18;
      const glowRadius = particle.size * (2.2 + shimmer * 0.72);
      ctx.fillStyle = toneColor(particle.tone, particle.alpha * POOLDAY_FLOW_TUNING.shimmerAlpha * 0.28, particle.toneIndex);
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(4, glowRadius), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = toneColor(particle.tone, particle.alpha, particle.toneIndex);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  frame.nodes.forEach((node, index) => {
    const core = index < 4;
    ctx.strokeStyle = core ? toneColor('primary', 0.74, index) : toneColor('rainbow', node.alpha * 0.62, index);
    ctx.fillStyle = core ? toneColor('rainbow', node.alpha * 0.82, index + 3) : toneColor('rainbow', node.alpha * 0.54, index);
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
    for (const line of frame.lines) {
      const { start, end } = resolveLineGeometry(line, width, height);
      const alpha = line.alpha;
      lineData.push(start.x, start.y, alpha, end.x, end.y, alpha);
      if (line.pulse > 0.02) {
        const pulsePoint = resolveLinePoint(line, 0.5 + Math.sin(line.pulse * Math.PI) * 0.34, width, height);
        linePulseData.push(pulsePoint.x, pulsePoint.y, Math.min(0.65, alpha + line.pulse * 0.32), 8 + line.pulse * 18);
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
  const flowLabels = [...mount.querySelectorAll('[data-pool-flow-label]')];
  const simulationShell = mount.querySelector('.pool-simulation-shell') || mount;
  const tooltip = mount.querySelector('[data-pool-tooltip]');
  const tooltipTitle = tooltip?.querySelector('[data-pool-tooltip-title]');
  const tooltipBody = tooltip?.querySelector('[data-pool-tooltip-body]');
  let activeTooltipLabel = null;
  const updateTooltipPosition = () => {
    if (!tooltip || !activeTooltipLabel) return;
    const shellBox = simulationShell.getBoundingClientRect();
    const labelBox = activeTooltipLabel.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth || 280;
    const tooltipHeight = tooltip.offsetHeight || 112;
    const padding = 16;
    const anchorX = labelBox.left + labelBox.width / 2 - shellBox.left;
    const hasRoomAbove = labelBox.top - shellBox.top > tooltipHeight + padding * 2;
    const placement = hasRoomAbove ? 'above' : 'below';
    const rawTop = placement === 'above'
      ? labelBox.top - shellBox.top - 13
      : labelBox.bottom - shellBox.top + 13;
    tooltip.dataset.placement = placement;
    tooltip.style.left = `${clampRange(anchorX, tooltipWidth / 2 + padding, Math.max(tooltipWidth / 2 + padding, shellBox.width - tooltipWidth / 2 - padding))}px`;
    tooltip.style.top = `${clampRange(rawTop, padding, Math.max(padding, shellBox.height - padding))}px`;
  };
  const showTooltip = (label) => {
    if (!tooltip || !tooltipTitle || !tooltipBody) return;
    activeTooltipLabel?.classList.remove('is-tooltip-active');
    activeTooltipLabel = label;
    tooltipTitle.textContent = label.dataset.tooltipTitle || label.textContent?.trim() || '';
    tooltipBody.textContent = label.dataset.tooltipBody || '';
    updateTooltipPosition();
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');
    label.classList.add('is-tooltip-active');
  };
  const hideTooltip = (label) => {
    if (!tooltip) return;
    if (label && activeTooltipLabel !== label) return;
    activeTooltipLabel?.classList.remove('is-tooltip-active');
    activeTooltipLabel = null;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
  };
  for (const label of flowLabels) {
    label.addEventListener('pointerenter', () => showTooltip(label));
    label.addEventListener('pointermove', () => {
      if (activeTooltipLabel === label) updateTooltipPosition();
    });
    label.addEventListener('pointerleave', () => hideTooltip(label));
    label.addEventListener('focus', () => showTooltip(label));
    label.addEventListener('blur', () => hideTooltip(label));
  }
  const syncFlowLabels = (anchors = {}, width = 1, height = 1) => {
    for (const label of flowLabels) {
      const anchor = anchors[label.dataset.poolFlowLabel];
      if (!anchor) continue;
      label.style.setProperty('--x', `${(anchor.x / Math.max(1, width)) * 100}%`);
      label.style.setProperty('--y', `${(anchor.y / Math.max(1, height)) * 100}%`);
    }
  };
  const draw = (timestamp = performance.now()) => {
    if (!active) return;
    const rawDeltaMs = Math.max(0, timestamp - state.lastFrameMs);
    state.lastFrameMs = timestamp;
    const deltaMs = Math.max(SIMULATION_MIN_STEP_MS, Math.min(SIMULATION_MAX_STEP_MS, rawDeltaMs || SIMULATION_TARGET_STEP_MS));
    const { width, height } = resizePoolCanvas(canvas);
    const frame = buildPoolSimulationFrame(state, width, height, deltaMs / 1000);
    if (renderer) renderer(frame, width, height);
    else if (ctx) drawPoolSimulation2D(ctx, frame, width, height);
    syncFlowLabels(frame.labelAnchors, width, height);
    updateTooltipPosition();
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
    hideTooltip();
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
  window.reploid = sdk;
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
