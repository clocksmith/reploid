/**
 * @fileoverview Recovery of an in-flight public sequence request after a reload or history
 * navigation in the same room and relay, within a bounded time.
 */
import { FASTEST_RECEIPT_POLICY_ID } from '../../pool/policy-router.js';
import { SEQUENCE_PUBLIC_SENSITIVITY } from '../../../../shared/pool/sequence-workload.js';
import { getPeerRelayMode, getPeerRoomId } from './view.js';
import { pageIdentityNavigationType } from './page-identity.js';

export const POOL_PENDING_REQUEST_STORAGE_KEY = 'reploid.pool.pending-request.v1';
const POOL_PENDING_REQUEST_VERSION = 1;
export const POOL_PENDING_REQUEST_TTL_MS = 15 * 60 * 1000;

const pendingRequestIsRecoverable = (record, { navigationType = pageIdentityNavigationType() } = {}) => {
  if (!record || typeof record !== 'object') return false;
  if (navigationType !== 'reload' && navigationType !== 'back_forward') return false;
  if (record.version !== POOL_PENDING_REQUEST_VERSION || record.lane !== 'sequence') return false;
  if (record.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY || typeof record.sequence !== 'string' || !record.sequence.trim()) return false;
  if (record.roomId !== getPeerRoomId() || record.relay !== getPeerRelayMode()) return false;
  const startedAt = Date.parse(record.startedAt || '');
  return Number.isFinite(startedAt) && Date.now() - startedAt >= 0 && Date.now() - startedAt <= POOL_PENDING_REQUEST_TTL_MS;
};

export const readPendingRequestRecovery = () => {
  try {
    const record = JSON.parse(window.sessionStorage?.getItem(POOL_PENDING_REQUEST_STORAGE_KEY) || 'null');
    if (pendingRequestIsRecoverable(record)) return record;
    window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
  } catch {
    try {
      window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
    } catch {
      // A malformed recovery record must not prevent the current page from loading.
    }
  }
  return null;
};

export const writePendingRequestRecovery = (request) => {
  if (
    request?.lane !== 'sequence'
    || request?.sequenceRequest?.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY
    || typeof request.sequence !== 'string'
    || !request.sequence.trim()
  ) return;
  const record = {
    version: POOL_PENDING_REQUEST_VERSION,
    lane: 'sequence',
    sequence: request.sequence,
    selectedModelId: request.selectedModel?.modelId || null,
    policyId: request.policyId || FASTEST_RECEIPT_POLICY_ID,
    researchSubmission: request.researchSubmission || null,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    sensitivity: SEQUENCE_PUBLIC_SENSITIVITY,
    startedAt: new Date().toISOString()
  };
  try {
    window.sessionStorage?.setItem(POOL_PENDING_REQUEST_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // The current run continues, but a reload cannot offer restoration.
  }
};

export const clearPendingRequestRecovery = () => {
  try {
    window.sessionStorage?.removeItem(POOL_PENDING_REQUEST_STORAGE_KEY);
  } catch {
    // The in-memory request state remains valid for the current page.
  }
};
