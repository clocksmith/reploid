/**
 * @fileoverview Descriptor hash negotiation handshake for Reploid orchestration.
 * Section 2 of TODO_REPLOID.md: Descriptor Hash Negotiation Handshake.
 *
 * Three-step protocol:
 *   1. Coordinator sends Negotiate(manifestHash, shardHashes)
 *   2. Peer responds NegotiationResponse(HAS_SHARDS | FETCH_FAIL)
 *   3. Coordinator sends Dispatch or Terminate
 */

export const SHARD_NEGOTIATION_VERSION = 'reploid_shard_negotiation/v1';

export const NEGOTIATION_STATES = Object.freeze({
  INIT: 'INIT',
  NEGOTIATE_SENT: 'NEGOTIATE_SENT',
  HAS_SHARDS: 'HAS_SHARDS',
  FETCH_FAIL: 'FETCH_FAIL',
  DISPATCHED: 'DISPATCHED',
  TERMINATED: 'TERMINATED',
  TIMEOUT: 'TIMEOUT'
});

export const NEGOTIATION_RESPONSE_TYPES = Object.freeze({
  HAS_SHARDS: 'HAS_SHARDS',
  FETCH_FAIL: 'FETCH_FAIL'
});

const DEFAULT_TIMEOUT_MS = 500;

function buildNegotiateMessage({ coordinatorId, peerId, manifestHash, shardHashes, sessionId }) {
  if (!manifestHash) throw new TypeError('manifestHash is required');
  if (!Array.isArray(shardHashes) || !shardHashes.length) throw new TypeError('shardHashes must be a non-empty array');
  return Object.freeze({
    negotiationVersion: SHARD_NEGOTIATION_VERSION,
    type: 'NEGOTIATE',
    coordinatorId: String(coordinatorId || ''),
    peerId: String(peerId || ''),
    sessionId: String(sessionId || ''),
    manifestHash: String(manifestHash),
    shardHashes: Object.freeze([...shardHashes].map(String)),
    sentAt: new Date().toISOString()
  });
}

function buildDispatchMessage({ coordinatorId, peerId, sessionId, assignmentId }) {
  return Object.freeze({
    negotiationVersion: SHARD_NEGOTIATION_VERSION,
    type: 'DISPATCH',
    coordinatorId: String(coordinatorId || ''),
    peerId: String(peerId || ''),
    sessionId: String(sessionId || ''),
    assignmentId: String(assignmentId || ''),
    sentAt: new Date().toISOString()
  });
}

function buildTerminateMessage({ coordinatorId, peerId, sessionId, reason }) {
  return Object.freeze({
    negotiationVersion: SHARD_NEGOTIATION_VERSION,
    type: 'TERMINATE',
    coordinatorId: String(coordinatorId || ''),
    peerId: String(peerId || ''),
    sessionId: String(sessionId || ''),
    reason: String(reason || 'FETCH_FAIL'),
    sentAt: new Date().toISOString()
  });
}

function buildNegotiationResponse({ peerId, sessionId, type, missingShards = [] }) {
  if (!NEGOTIATION_RESPONSE_TYPES[type]) throw new TypeError(`type must be HAS_SHARDS or FETCH_FAIL`);
  return Object.freeze({
    negotiationVersion: SHARD_NEGOTIATION_VERSION,
    type,
    peerId: String(peerId || ''),
    sessionId: String(sessionId || ''),
    missingShards: Object.freeze([...missingShards].map(String)),
    respondedAt: new Date().toISOString()
  });
}

export async function runCoordinatorNegotiation({
  coordinatorId,
  peerId,
  sessionId,
  assignmentId,
  manifestHash,
  shardHashes,
  sendToPeer,
  waitForResponse,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  let state = NEGOTIATION_STATES.INIT;
  const log = [];

  const record = (event) => log.push({ ...event, at: new Date().toISOString() });

  const negotiateMsg = buildNegotiateMessage({ coordinatorId, peerId, manifestHash, shardHashes, sessionId });
  await sendToPeer(negotiateMsg);
  state = NEGOTIATION_STATES.NEGOTIATE_SENT;
  record({ step: 1, type: 'NEGOTIATE_SENT', manifestHash, shardCount: shardHashes.length });

  let response;
  try {
    response = await Promise.race([
      waitForResponse(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('negotiation_timeout')), timeoutMs))
    ]);
  } catch (err) {
    state = NEGOTIATION_STATES.TIMEOUT;
    record({ step: 2, type: 'TIMEOUT', reason: err.message });
    const terminate = buildTerminateMessage({ coordinatorId, peerId, sessionId, reason: 'TIMEOUT' });
    await sendToPeer(terminate).catch(() => {});
    return { state, log, peerId, outcome: 'TIMEOUT' };
  }

  if (response.type === NEGOTIATION_RESPONSE_TYPES.HAS_SHARDS) {
    state = NEGOTIATION_STATES.HAS_SHARDS;
    record({ step: 2, type: 'HAS_SHARDS' });
    const dispatch = buildDispatchMessage({ coordinatorId, peerId, sessionId, assignmentId });
    await sendToPeer(dispatch);
    state = NEGOTIATION_STATES.DISPATCHED;
    record({ step: 3, type: 'DISPATCHED', assignmentId });
    return { state, log, peerId, outcome: 'DISPATCHED' };
  }

  state = NEGOTIATION_STATES.FETCH_FAIL;
  record({ step: 2, type: 'FETCH_FAIL', missingShards: response.missingShards || [] });
  const terminate = buildTerminateMessage({ coordinatorId, peerId, sessionId, reason: 'FETCH_FAIL' });
  await sendToPeer(terminate);
  state = NEGOTIATION_STATES.TERMINATED;
  record({ step: 3, type: 'TERMINATED', reason: 'FETCH_FAIL' });
  return { state, log, peerId, outcome: 'FETCH_FAIL' };
}

export async function runPeerNegotiation({
  peerId,
  sessionId,
  waitForNegotiate,
  checkLocalShards,
  fetchMissingShards = null,
  sendToCoordinator
}) {
  const negotiateMsg = await waitForNegotiate();
  const { manifestHash, shardHashes = [] } = negotiateMsg;

  const locallyPresent = await checkLocalShards({ manifestHash, shardHashes });
  const missing = shardHashes.filter((h) => !locallyPresent.includes(h));

  if (missing.length && typeof fetchMissingShards === 'function') {
    try {
      await fetchMissingShards({ manifestHash, missing });
      const verified = await checkLocalShards({ manifestHash, shardHashes });
      const stillMissing = shardHashes.filter((h) => !verified.includes(h));
      if (stillMissing.length) {
        await sendToCoordinator(buildNegotiationResponse({ peerId, sessionId, type: 'FETCH_FAIL', missingShards: stillMissing }));
        return { outcome: 'FETCH_FAIL', missing: stillMissing };
      }
    } catch {
      await sendToCoordinator(buildNegotiationResponse({ peerId, sessionId, type: 'FETCH_FAIL', missingShards: missing }));
      return { outcome: 'FETCH_FAIL', missing };
    }
  } else if (missing.length) {
    await sendToCoordinator(buildNegotiationResponse({ peerId, sessionId, type: 'FETCH_FAIL', missingShards: missing }));
    return { outcome: 'FETCH_FAIL', missing };
  }

  await sendToCoordinator(buildNegotiationResponse({ peerId, sessionId, type: 'HAS_SHARDS' }));
  return { outcome: 'HAS_SHARDS', manifestHash };
}

export {
  buildNegotiateMessage,
  buildNegotiationResponse,
  buildDispatchMessage,
  buildTerminateMessage
};

export default {
  SHARD_NEGOTIATION_VERSION,
  NEGOTIATION_STATES,
  NEGOTIATION_RESPONSE_TYPES,
  buildNegotiateMessage,
  buildNegotiationResponse,
  buildDispatchMessage,
  buildTerminateMessage,
  runCoordinatorNegotiation,
  runPeerNegotiation
};
