/**
 * @fileoverview Browser-local contribution status and recent work counters.
 */

export const POOL_CONTRIBUTION_HISTORY_STORAGE_KEY = 'reploid.pool.contribution-history.v1';

const MAX_HISTORY_ROWS = 60;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const listeners = new Set();

const defaultLiveState = () => ({
  state: 'inactive',
  optedIn: false,
  label: 'Not active',
  modelId: null,
  roomId: null,
  relay: null,
  lastReceiptHash: null,
  lastError: null,
  updatedAt: null
});

let liveState = defaultLiveState();

const getStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const safeParseArray = (value) => {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readHistory = () => safeParseArray(getStorage()?.getItem(POOL_CONTRIBUTION_HISTORY_STORAGE_KEY));

const writeHistory = (rows) => {
  try {
    getStorage()?.setItem(POOL_CONTRIBUTION_HISTORY_STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_HISTORY_ROWS)));
  } catch {
    // Contribution history is a convenience view. Worker execution continues without localStorage.
  }
};

const stateLabel = (state) => ({
  inactive: 'Not active',
  starting: 'Starting',
  idle: 'Available',
  working: 'Answering',
  error: 'Needs attention'
}[state] || 'Not active');

const notify = () => {
  const snapshot = getContributionSnapshot();
  for (const listener of listeners) listener(snapshot);
};

const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const receiptTokenCounts = (record = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  const tokenIds = record.tokenIds || record.body?.tokenIds || receipt.tokenIds || [];
  const counts = receipt.tokenCounts || record.tokenCounts || {};
  const input = numeric(counts.input);
  const output = numeric(counts.output) || (Array.isArray(tokenIds) ? tokenIds.length : 0);
  return {
    input,
    output,
    total: input + output
  };
};

const receiptCompletedAt = (record = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  return receipt.timing?.completedAt
    || receipt.timing?.endedAt
    || receipt.endTimestamp
    || record.completedAt
    || record.createdAt
    || new Date().toISOString();
};

const contributionFromRecord = (record = {}, meta = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  const receiptHash = String(record.receiptHash || record.body?.receiptHash || receipt.receiptHash || '');
  const tokens = receiptTokenCounts(record);
  return {
    receiptHash,
    assignmentId: receipt.assignmentId || record.assignmentId || null,
    jobId: receipt.jobId || record.jobId || null,
    modelId: receipt.model?.id || receipt.model?.modelId || meta.modelId || null,
    roomId: meta.roomId || null,
    tokens: tokens.total,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    completedAt: receiptCompletedAt(record)
  };
};

const metricsForHistory = (history, nowMs = Date.now()) => {
  let tokens24h = 0;
  let tokensHour = 0;
  let contributions24h = 0;
  for (const row of history) {
    const completedMs = Date.parse(row.completedAt || '');
    if (!Number.isFinite(completedMs)) continue;
    const age = nowMs - completedMs;
    if (age >= 0 && age <= DAY_MS) {
      tokens24h += numeric(row.tokens);
      contributions24h += 1;
    }
    if (age >= 0 && age <= HOUR_MS) {
      tokensHour += numeric(row.tokens);
    }
  }
  return {
    tokens24h,
    tokensHour,
    contributions24h
  };
};

export const getContributionSnapshot = () => {
  const history = readHistory();
  const metrics = metricsForHistory(history);
  return {
    ...liveState,
    label: liveState.label || stateLabel(liveState.state),
    ...metrics,
    recent: history.slice(0, 3)
  };
};

export const updateContributionState = (patch = {}) => {
  const state = patch.state || liveState.state || 'inactive';
  liveState = {
    ...liveState,
    ...patch,
    state,
    label: patch.label || stateLabel(state),
    updatedAt: patch.updatedAt || new Date().toISOString()
  };
  notify();
  return getContributionSnapshot();
};

export const recordContributionReceipt = (record = {}, meta = {}) => {
  const contribution = contributionFromRecord(record, meta);
  if (!contribution.receiptHash) return null;
  const history = readHistory().filter((row) => row.receiptHash !== contribution.receiptHash);
  history.unshift(contribution);
  writeHistory(history);
  updateContributionState({
    lastReceiptHash: contribution.receiptHash,
    lastError: null
  });
  return contribution;
};

export const subscribeContributionState = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  listeners.add(listener);
  listener(getContributionSnapshot());
  return () => listeners.delete(listener);
};

export const resetContributionStateForTests = () => {
  liveState = defaultLiveState();
  listeners.clear();
  try {
    getStorage()?.removeItem(POOL_CONTRIBUTION_HISTORY_STORAGE_KEY);
  } catch {
    // Test-only reset should not fail when storage is unavailable.
  }
};

export default {
  POOL_CONTRIBUTION_HISTORY_STORAGE_KEY,
  getContributionSnapshot,
  updateContributionState,
  recordContributionReceipt,
  subscribeContributionState,
  resetContributionStateForTests
};
