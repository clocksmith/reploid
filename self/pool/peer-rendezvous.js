/**
 * @fileoverview Peer-room rendezvous buses for Reploid browser peers.
 */

import { verifyPeerMessage } from './peer-protocol.js';
import { boundedRetryDelay, retryAfterMsFromError } from './retry-policy.js';

export const PEER_ROOM_RELAY_VERSION = 'reploid_peer_room_relay/v1';
export const DEFAULT_RELAY_POLL_INTERVAL_MS = 1000;
export const DEFAULT_RELAY_TTL_MS = 120000;
export const DEFAULT_RELAY_CURSOR_LOOKBACK_MS = 5000;
export const DEFAULT_RELAY_DEDUP_WINDOW_MS = 120000;
export const DEFAULT_RELAY_MAX_DEDUP_IDS = 2048;
export const DEFAULT_RELAY_PUBLISH_ATTEMPTS = 3;
export const DEFAULT_RELAY_RETRY_BASE_MS = 250;
export const DEFAULT_RELAY_POLL_TIMEOUT_MS = 5000;
export const DEFAULT_RELAY_PUBLISH_TIMEOUT_MS = 5000;
export const DEFAULT_RELAY_FAILURE_THRESHOLD = 3;
export const DEFAULT_RELAY_BACKOFF_BASE_MS = 1000;
export const DEFAULT_RELAY_BACKOFF_MAX_MS = 30000;

const requireString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const roomChannelName = (roomId) => `reploid-peer-room:${roomId}`;

const makeRelayId = (prefix = 'peer_room_msg') => (
  `${prefix}_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
);

export function peerRoomMessageFromPeerId(message = {}, fallbackPeerId = null) {
  const body = message.body || {};
  if (message.type === 'webrtc-signal') return body.fromPeerId || body.signal?.fromPeerId || fallbackPeerId || null;
  if (message.type === 'peer-run-request') return body.requesterId || body.intent?.body?.requesterId || body.assignment?.requesterId || fallbackPeerId || null;
  if (message.type === 'peer-run-accepted') return body.providerId || body.assignment?.providerId || fallbackPeerId || null;
  if (message.type === 'provider-advert') return body.advert?.fromPeerId || body.advert?.body?.providerId || body.providerId || fallbackPeerId || null;
  return body.fromPeerId
    || body.requesterId
    || body.providerId
    || body.advert?.fromPeerId
    || body.advert?.body?.providerId
    || body.intent?.fromPeerId
    || body.intent?.body?.requesterId
    || body.assignment?.requesterId
    || body.assignment?.providerId
    || body.signal?.fromPeerId
    || fallbackPeerId
    || null;
}

export function createBroadcastPeerRoomBus({ roomId } = {}) {
  const resolvedRoomId = requireString(roomId, 'roomId');
  if (typeof globalThis.BroadcastChannel !== 'function') {
    throw new Error('BroadcastChannel is required for local peer room bootstrap');
  }
  const channel = new globalThis.BroadcastChannel(roomChannelName(resolvedRoomId));
  const listeners = new Set();
  const counters = {
    published: 0,
    publishRetries: 0,
    publishFailures: 0,
    received: 0,
    duplicateSuppressed: 0,
    acknowledgements: 0,
    acknowledgementExpired: 0,
    pollFailures: 0,
    dispatchFailures: 0,
    publishLatencyCount: 0,
    publishLatencyTotalMs: 0,
    publishLatencyMaxMs: 0,
    deliveryLagCount: 0,
    deliveryLagTotalMs: 0,
    deliveryLagMaxMs: 0,
    backlogSampleCount: 0,
    backlogOldestAgeTotalMs: 0,
    backlogOldestAgeMaxMs: 0,
    lastBacklogOldestAgeMs: 0,
    acknowledgementLatencyCount: 0,
    acknowledgementLatencyTotalMs: 0,
    acknowledgementLatencyMaxMs: 0,
    reconnectSuccesses: 0
  };
  let closed = false;
  const dispatch = (event) => {
    counters.received += 1;
    for (const listener of listeners) listener(event);
  };
  channel.addEventListener('message', dispatch);
  return Object.freeze({
    addEventListener(type, listener) {
      if (type === 'message' && typeof listener === 'function') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(data) {
      if (closed) throw new Error('local peer-room bus is closed');
      const startedAt = Date.now();
      channel.postMessage(data);
      const elapsed = Math.max(0, Date.now() - startedAt);
      counters.published += 1;
      counters.publishLatencyCount += 1;
      counters.publishLatencyTotalMs += elapsed;
      counters.publishLatencyMaxMs = Math.max(counters.publishLatencyMaxMs, elapsed);
    },
    getStatus() {
      return Object.freeze({
        roomId: resolvedRoomId,
        relay: 'local_broadcast_channel',
        circuitState: closed ? 'closed' : 'local',
        consecutivePollFailures: 0,
        consecutiveDispatchFailures: 0,
        lastPollRetryAfterMs: 0,
        ...counters
      });
    },
    close() {
      if (closed) return;
      closed = true;
      channel.removeEventListener('message', dispatch);
      listeners.clear();
      channel.close();
    }
  });
}

export function createInMemoryPeerRoomBusNetwork() {
  const rooms = new Map();
  const roomFor = (roomId) => {
    const resolvedRoomId = requireString(roomId, 'roomId');
    const existing = rooms.get(resolvedRoomId);
    if (existing) return existing;
    const created = new Set();
    rooms.set(resolvedRoomId, created);
    return created;
  };
  return Object.freeze({
    createBus({ roomId }) {
      const peers = roomFor(roomId);
      const listeners = new Set();
      const bus = {
        closed: false,
        addEventListener(type, listener) {
          if (type === 'message') listeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === 'message') listeners.delete(listener);
        },
        postMessage(data) {
          for (const peer of peers) {
            if (peer === bus || peer.closed) continue;
            queueMicrotask(() => {
              if (peer.closed) return;
              for (const listener of peer.listeners) listener({ data });
            });
          }
        },
        close() {
          bus.closed = true;
          listeners.clear();
          peers.delete(bus);
          if (peers.size === 0) rooms.delete(roomId);
        },
        listeners
      };
      peers.add(bus);
      return bus;
    },
    reset() {
      rooms.clear();
    }
  });
}

export function createSdkPeerRoomRelayBus({
  sdk,
  roomId,
  localPeerId = null,
  pollIntervalMs = DEFAULT_RELAY_POLL_INTERVAL_MS,
  relayTtlMs = DEFAULT_RELAY_TTL_MS,
  cursorLookbackMs = DEFAULT_RELAY_CURSOR_LOOKBACK_MS,
  dedupWindowMs = DEFAULT_RELAY_DEDUP_WINDOW_MS,
  maxDedupIds = DEFAULT_RELAY_MAX_DEDUP_IDS,
  publishAttempts = DEFAULT_RELAY_PUBLISH_ATTEMPTS,
  retryBaseMs = DEFAULT_RELAY_RETRY_BASE_MS,
  publishTimeoutMs = DEFAULT_RELAY_PUBLISH_TIMEOUT_MS,
  pollTimeoutMs = DEFAULT_RELAY_POLL_TIMEOUT_MS,
  failureThreshold = DEFAULT_RELAY_FAILURE_THRESHOLD,
  pollBackoffBaseMs = DEFAULT_RELAY_BACKOFF_BASE_MS,
  pollBackoffMaxMs = DEFAULT_RELAY_BACKOFF_MAX_MS,
  pendingAcknowledgementStorage = globalThis.sessionStorage,
  relayAckSigner = null,
  onStatus = null,
  now = () => Date.now()
} = {}) {
  if (!sdk || typeof sdk.publishPeerRoomMessage !== 'function' || typeof sdk.listPeerRoomMessages !== 'function') {
    throw new TypeError('sdk must provide publishPeerRoomMessage() and listPeerRoomMessages()');
  }
  const resolvedRoomId = requireString(roomId, 'roomId');
  const listeners = new Set();
  const statusListeners = new Set();
  const seen = new Map();
  const pendingAcks = new Map();
  const counters = {
    published: 0,
    publishRetries: 0,
    publishFailures: 0,
    received: 0,
    duplicateSuppressed: 0,
    acknowledgements: 0,
    acknowledgementExpired: 0,
    pollFailures: 0,
    dispatchFailures: 0,
    publishLatencyCount: 0,
    publishLatencyTotalMs: 0,
    publishLatencyMaxMs: 0,
    deliveryLagCount: 0,
    deliveryLagTotalMs: 0,
    deliveryLagMaxMs: 0,
    backlogSampleCount: 0,
    backlogOldestAgeTotalMs: 0,
    backlogOldestAgeMaxMs: 0,
    lastBacklogOldestAgeMs: 0,
    acknowledgementLatencyCount: 0,
    acknowledgementLatencyTotalMs: 0,
    acknowledgementLatencyMaxMs: 0,
    reconnectSuccesses: 0
  };
  let cursor = {
    sequence: null,
    createdAt: 0,
    messageId: ''
  };
  let timer = null;
  let closed = false;
  let polling = false;
  let circuitState = 'closed';
  let consecutivePollFailures = 0;
  let consecutiveDispatchFailures = 0;
  let lastPollRetryAfterMs = 0;
  const pendingAckStorageKey = localPeerId
    ? `reploid.peer-room.pending-acks/v1:${resolvedRoomId}:${localPeerId}`
    : null;

  const emitStatus = (type, detail = {}) => {
    const event = Object.freeze({ type, roomId: resolvedRoomId, at: now(), ...detail });
    // Status is observability, not a delivery dependency. A UI or metrics
    // callback must never turn a successful relay poll into another failure.
    if (typeof onStatus === 'function') {
      try {
        onStatus(event);
      } catch {
        // Keep the relay state machine independent from its observers.
      }
    }
    for (const listener of statusListeners) {
      try {
        listener({ data: event });
      } catch {
        // A second observer must not prevent other observers or recovery.
      }
    }
  };
  const persistPendingAcks = () => {
    if (!pendingAckStorageKey || !pendingAcknowledgementStorage) return;
    try {
      pendingAcknowledgementStorage.setItem(pendingAckStorageKey, JSON.stringify(Array.from(pendingAcks.entries())));
    } catch {
      // Storage is a recovery aid. A relay record remains the durable source.
    }
  };
  const restorePendingAcks = () => {
    if (!pendingAckStorageKey || !pendingAcknowledgementStorage) return;
    try {
      const entries = JSON.parse(pendingAcknowledgementStorage.getItem(pendingAckStorageKey) || '[]');
      for (const [relayId, pending] of entries) {
        if (relayId && pending?.targetPeerId && Number.isFinite(Number(pending.publishedAt))) {
          pendingAcks.set(relayId, { publishedAt: Number(pending.publishedAt), targetPeerId: pending.targetPeerId });
        }
      }
    } catch {
      // A relay record remains the durable source. Clear corrupt same-tab state so
      // the next reload does not repeat a failed recovery parse.
      try {
        pendingAcknowledgementStorage.removeItem(pendingAckStorageKey);
      } catch {
        // Storage is a recovery aid. Continue from relay history when unavailable.
      }
    }
  };
  const pruneSeen = () => {
    const expiresBefore = now();
    for (const [id, expiresAt] of seen) {
      if (expiresAt <= expiresBefore) seen.delete(id);
    }
    while (seen.size > Math.max(1, Number(maxDedupIds || 1))) {
      seen.delete(seen.keys().next().value);
    }
  };
  const prunePendingAcks = () => {
    const expiresBefore = now() - Math.max(1, Number(dedupWindowMs || 1));
    for (const [relayId, pending] of pendingAcks) {
      if (pending.publishedAt > expiresBefore) continue;
      pendingAcks.delete(relayId);
      counters.acknowledgementExpired += 1;
      emitStatus('relay-ack-expired', { relayId });
    }
    persistPendingAcks();
  };
  const relayIdFor = (record, message) => (
    record?.relayId || message?.relay?.relayId || message?.relayId || message?.id || null
  );
  const waitFor = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
  const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), Math.max(1, Number(timeoutMs || 1)));
    Promise.resolve(promise).then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      }
    );
  });
  const acknowledgementTargetFor = (message = {}) => (
    message.body?.toPeerId || message.body?.signal?.toPeerId || null
  );
  const publish = async (message, { awaitAcknowledgement = message?.type !== 'relay-ack' } = {}) => {
    const relayId = message?.relay?.relayId || message?.relayId || null;
    const maxAttempts = Math.max(1, Number(publishAttempts || 1));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      prunePendingAcks();
      const startedAt = now();
      try {
        const result = await withTimeout(
          sdk.publishPeerRoomMessage(resolvedRoomId, message),
          publishTimeoutMs,
          'peer-room relay publish timed out'
        );
        counters.published += 1;
        const targetPeerId = acknowledgementTargetFor(message);
        if (relayId && awaitAcknowledgement && targetPeerId) {
          pendingAcks.set(relayId, { publishedAt: startedAt, targetPeerId });
          persistPendingAcks();
        }
        const elapsedMs = Math.max(0, now() - startedAt);
        counters.publishLatencyCount += 1;
        counters.publishLatencyTotalMs += elapsedMs;
        counters.publishLatencyMaxMs = Math.max(counters.publishLatencyMaxMs, elapsedMs);
        emitStatus('relay-published', {
          relayId,
          attempt,
          elapsedMs,
          relaySequence: result?.message?.relaySequence ?? null
        });
        return result;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        counters.publishRetries += 1;
        const retryDelayMs = Math.max(0, Number(retryBaseMs || 0)) * (2 ** (attempt - 1));
        emitStatus('relay-publish-retrying', { relayId, attempt, retryDelayMs, error: String(error?.message || error) });
        await waitFor(retryDelayMs);
      }
    }
    counters.publishFailures += 1;
    emitStatus('relay-publish-failed', { relayId, error: String(lastError?.message || lastError) });
    throw lastError;
  };
  const acknowledge = async (record) => {
    const relayId = relayIdFor(record, record?.message || record);
    if (!relayId || !localPeerId || typeof relayAckSigner !== 'function') return;
    const proof = await relayAckSigner({
      roomId: resolvedRoomId,
      relayId,
      relaySequence: record?.relaySequence ?? null
    });
    await publish({
      peerRoomVersion: 'reploid_peer_room/v1',
      roomId: resolvedRoomId,
      type: 'relay-ack',
      body: {
        fromPeerId: localPeerId,
        relayId,
        relaySequence: record?.relaySequence ?? null,
        proof
      },
      relay: {
        version: PEER_ROOM_RELAY_VERSION,
        relayId: makeRelayId('peer_room_ack'),
        fromPeerId: localPeerId,
        createdAt: now(),
        expiresAt: relayTtlMs === null ? null : now() + relayTtlMs
      }
    }, { awaitAcknowledgement: false });
  };
  const verifyAcknowledgement = async (message, pending) => {
    const proof = message?.body?.proof;
    if (!proof || !pending?.targetPeerId) return false;
    const verification = await verifyPeerMessage(proof);
    if (!verification.ok) return false;
    const signed = proof.body || {};
    return proof.type === 'heartbeat'
      && proof.fromPeerId === pending.targetPeerId
      && message.body?.fromPeerId === pending.targetPeerId
      && signed.schema === 'reploid.peer.relay_ack/v1'
      && signed.roomId === resolvedRoomId
      && signed.relayId === message.body?.relayId
      && Number(signed.relaySequence) === Number(message.body?.relaySequence);
  };
  const deliver = async (record) => {
    const message = record?.message || record;
    const id = relayIdFor(record, message) || JSON.stringify(message);
    pruneSeen();
    if (id && seen.has(id)) {
      counters.duplicateSuppressed += 1;
      emitStatus('relay-duplicate-suppressed', { relayId: id });
      return;
    }
    if (message?.type === 'relay-ack') {
      const acknowledgedRelayId = message.body?.relayId || null;
      const pending = pendingAcks.get(acknowledgedRelayId);
      if (acknowledgedRelayId && pending && await verifyAcknowledgement(message, pending)) {
        pendingAcks.delete(acknowledgedRelayId);
        persistPendingAcks();
        counters.acknowledgements += 1;
        const elapsedMs = Math.max(0, now() - pending.publishedAt);
        counters.acknowledgementLatencyCount += 1;
        counters.acknowledgementLatencyTotalMs += elapsedMs;
        counters.acknowledgementLatencyMaxMs = Math.max(counters.acknowledgementLatencyMaxMs, elapsedMs);
        emitStatus('relay-acknowledged', { relayId: acknowledgedRelayId, byPeerId: message.body?.fromPeerId || null, elapsedMs });
      } else {
        emitStatus('relay-ack-rejected', { relayId: acknowledgedRelayId, byPeerId: message.body?.fromPeerId || null });
      }
      if (id) seen.set(id, now() + Math.max(1, Number(dedupWindowMs || 1)));
      return;
    }
    counters.received += 1;
    const recordedAt = Number(record?.createdAt || 0);
    if (Number.isFinite(recordedAt) && recordedAt > 0) {
      const deliveryLagMs = Math.max(0, now() - recordedAt);
      counters.deliveryLagCount += 1;
      counters.deliveryLagTotalMs += deliveryLagMs;
      counters.deliveryLagMaxMs = Math.max(counters.deliveryLagMaxMs, deliveryLagMs);
    }
    for (const listener of listeners) listener({ data: message });
    if (id) seen.set(id, now() + Math.max(1, Number(dedupWindowMs || 1)));
    if (Number.isSafeInteger(record?.relaySequence) && record.relaySequence > 0) {
      void acknowledge(record).catch((error) => emitStatus('relay-ack-failed', {
        relayId: id,
        error: String(error?.message || error)
      }));
    }
  };

  const nextPollDelay = (retryAfterMs = 0) => {
    const consecutiveFailures = Math.max(consecutivePollFailures, consecutiveDispatchFailures);
    if (consecutiveFailures === 0) return Math.max(Number(pollIntervalMs || 0), Number(retryAfterMs || 0));
    return boundedRetryDelay({
      consecutiveFailures,
      baseDelayMs: pollBackoffBaseMs,
      maxDelayMs: pollBackoffMaxMs,
      retryAfterMs
    });
  };
  const cursorForRecord = (record = {}) => {
    const message = record.message || record;
    return {
      sequence: Number.isSafeInteger(record?.relaySequence) ? record.relaySequence : null,
      createdAt: Number(record.createdAt || message?.createdAt || 0),
      messageId: String(relayIdFor(record, message) || '')
    };
  };
  const schedulePoll = (delay) => {
    if (closed || timer) return;
    timer = globalThis.setTimeout(() => {
      timer = null;
      void poll();
    }, Math.max(0, Number(delay || 0)));
  };
  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    let scheduledPollDelay = nextPollDelay();
    prunePendingAcks();
    if (circuitState === 'open') {
      circuitState = 'half_open';
      emitStatus('relay-circuit-half-open', { consecutivePollFailures });
    }
    try {
      const result = await withTimeout(sdk.listPeerRoomMessages(resolvedRoomId, {
        // The server orders pages by its receive timestamp and relay id. Advance
        // only from the returned page cursor, after every scanned relay record.
        after: cursor.createdAt,
        afterId: cursor.messageId,
        afterSequence: cursor.sequence,
        peerId: localPeerId || null
      }), pollTimeoutMs, 'peer-room relay poll timed out');
      const messages = Array.isArray(result?.messages) ? result.messages : Array.isArray(result) ? result : [];
      const relayTimestamps = messages
        .map((record) => Number(record?.createdAt || 0))
        .filter((createdAt) => Number.isFinite(createdAt) && createdAt > 0);
      if (relayTimestamps.length > 0) {
        const oldestAgeMs = Math.max(0, now() - Math.min(...relayTimestamps));
        counters.backlogSampleCount += 1;
        counters.backlogOldestAgeTotalMs += oldestAgeMs;
        counters.backlogOldestAgeMaxMs = Math.max(counters.backlogOldestAgeMaxMs, oldestAgeMs);
        counters.lastBacklogOldestAgeMs = oldestAgeMs;
      }
      let lastDispatchedCursor = null;
      let dispatchError = null;
      let failedRelayId = null;
      for (const record of messages) {
        const message = record.message || record;
        if (!message?.peerRoomVersion) {
          lastDispatchedCursor = cursorForRecord(record);
          continue;
        }
        try {
          await deliver(record);
          lastDispatchedCursor = cursorForRecord(record);
        } catch (error) {
          dispatchError = error;
          failedRelayId = relayIdFor(record, message);
          break;
        }
      }
      if (dispatchError) {
        counters.dispatchFailures += 1;
        consecutiveDispatchFailures += 1;
        if (lastDispatchedCursor) cursor = lastDispatchedCursor;
        emitStatus('relay-dispatch-retrying', {
          relayId: failedRelayId,
          consecutiveDispatchFailures,
          retryDelayMs: nextPollDelay(),
          error: String(dispatchError?.message || dispatchError)
        });
      } else {
        const nextCursor = result?.nextCursor;
        const hasSequence = Number.isSafeInteger(nextCursor?.sequence) && nextCursor.sequence >= 0;
        if (nextCursor && (hasSequence || Number.isFinite(Number(nextCursor.createdAt)))) {
          cursor = {
            sequence: hasSequence ? nextCursor.sequence : null,
            createdAt: Number(nextCursor.createdAt),
            messageId: String(nextCursor.messageId || '')
          };
        } else if (messages.length > 0) {
          cursor = lastDispatchedCursor || cursorForRecord(messages.at(-1));
        }
        if (consecutiveDispatchFailures > 0) emitStatus('relay-dispatch-recovered');
        consecutiveDispatchFailures = 0;
      }
      if (circuitState !== 'closed') emitStatus('relay-circuit-closed');
      if (consecutivePollFailures > 0) counters.reconnectSuccesses += 1;
      circuitState = 'closed';
      consecutivePollFailures = 0;
      lastPollRetryAfterMs = 0;
    } catch (error) {
      // Relay failure should not break an already-open room loop.
      counters.pollFailures += 1;
      consecutivePollFailures += 1;
      const threshold = Math.max(1, Number(failureThreshold || 1));
      lastPollRetryAfterMs = retryAfterMsFromError(error, { maxDelayMs: pollBackoffMaxMs });
      const retryDelayMs = nextPollDelay(lastPollRetryAfterMs);
      scheduledPollDelay = retryDelayMs;
      emitStatus('relay-poll-failed', {
        error: String(error?.message || error),
        consecutivePollFailures,
        retryDelayMs,
        retryAfterMs: lastPollRetryAfterMs || null
      });
      if (consecutivePollFailures >= threshold) {
        circuitState = 'open';
        emitStatus('relay-circuit-open', { consecutivePollFailures, retryDelayMs });
      } else {
        circuitState = 'retrying';
      }
    } finally {
      polling = false;
      schedulePoll(scheduledPollDelay);
    }
  };

  restorePendingAcks();
  prunePendingAcks();

  return Object.freeze({
    addEventListener(type, listener) {
      if (type === 'status') {
        statusListeners.add(listener);
        return;
      }
      if (type === 'message') {
        listeners.add(listener);
        if (!timer && !closed) void poll();
      }
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
      if (type === 'status') statusListeners.delete(listener);
    },
    async postMessage(data) {
      const createdAt = now();
      const message = {
        ...data,
        roomId: data?.roomId || resolvedRoomId,
        relay: {
          version: PEER_ROOM_RELAY_VERSION,
          relayId: makeRelayId(),
          fromPeerId: peerRoomMessageFromPeerId(data, localPeerId),
          createdAt,
          expiresAt: relayTtlMs === null ? null : createdAt + relayTtlMs
        }
      };
      await publish(message);
      return message;
    },
    getStatus() {
      pruneSeen();
      prunePendingAcks();
      return Object.freeze({
        roomId: resolvedRoomId,
        cursor: { ...cursor },
        pendingAcknowledgements: pendingAcks.size,
        dedupWindowSize: seen.size,
        circuitState,
        consecutivePollFailures,
        consecutiveDispatchFailures,
        lastPollRetryAfterMs,
        ...counters
      });
    },
    close() {
      closed = true;
      if (timer) globalThis.clearTimeout(timer);
      timer = null;
      listeners.clear();
      statusListeners.clear();
      seen.clear();
    }
  });
}

export function createPeerRoomBusFactory({
  sdk = null,
  relay = 'local',
  pollIntervalMs,
  relayTtlMs,
  publishTimeoutMs
} = {}) {
  return (options = {}) => {
    if (relay === 'server' || relay === 'sdk') {
      return createSdkPeerRoomRelayBus({
        sdk,
        roomId: options.roomId,
        localPeerId: options.localPeerId,
        pollIntervalMs,
        relayTtlMs,
        publishTimeoutMs,
        relayAckSigner: options.relayAckSigner,
        onStatus: options.onStatus
      });
    }
    return createBroadcastPeerRoomBus({ roomId: options.roomId });
  };
}

export function createPeerRoomInviteUrl({
  roomId,
  relay = 'local',
  baseUrl = globalThis.location?.href || 'https://reploid.local/'
} = {}) {
  const url = new URL(baseUrl, globalThis.location?.origin || 'https://reploid.local');
  url.searchParams.set('room', requireString(roomId, 'roomId'));
  if (relay && relay !== 'local') {
    url.searchParams.set('relay', relay);
  } else {
    url.searchParams.delete('relay');
  }
  return url.toString();
}

export function parsePeerRoomInviteUrl(value = globalThis.location?.href || '') {
  const url = new URL(String(value || ''), globalThis.location?.origin || 'https://reploid.local');
  return {
    roomId: url.searchParams.get('room') || null,
    relay: url.searchParams.get('relay') || 'local'
  };
}

export default {
  PEER_ROOM_RELAY_VERSION,
  DEFAULT_RELAY_POLL_INTERVAL_MS,
  DEFAULT_RELAY_TTL_MS,
  DEFAULT_RELAY_CURSOR_LOOKBACK_MS,
  peerRoomMessageFromPeerId,
  createBroadcastPeerRoomBus,
  createInMemoryPeerRoomBusNetwork,
  createSdkPeerRoomRelayBus,
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl,
  parsePeerRoomInviteUrl
};
