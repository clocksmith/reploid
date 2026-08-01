/**
 * @fileoverview Peer-room rendezvous buses for Reploid browser peers.
 */

import { verifyPeerMessage } from './peer-protocol.js';

export const PEER_ROOM_RELAY_VERSION = 'reploid_peer_room_relay/v1';
export const DEFAULT_RELAY_POLL_INTERVAL_MS = 1000;
export const DEFAULT_RELAY_TTL_MS = 120000;
export const DEFAULT_RELAY_CURSOR_LOOKBACK_MS = 5000;
export const DEFAULT_RELAY_DEDUP_WINDOW_MS = 120000;
export const DEFAULT_RELAY_MAX_DEDUP_IDS = 2048;
export const DEFAULT_RELAY_PUBLISH_ATTEMPTS = 3;
export const DEFAULT_RELAY_RETRY_BASE_MS = 250;
export const DEFAULT_RELAY_POLL_TIMEOUT_MS = 5000;

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
  return new globalThis.BroadcastChannel(roomChannelName(resolvedRoomId));
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
  pollTimeoutMs = DEFAULT_RELAY_POLL_TIMEOUT_MS,
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
    pollFailures: 0
  };
  let cursor = {
    sequence: null,
    createdAt: 0,
    messageId: ''
  };
  let timer = null;
  let closed = false;

  const emitStatus = (type, detail = {}) => {
    const event = Object.freeze({ type, roomId: resolvedRoomId, at: now(), ...detail });
    if (typeof onStatus === 'function') onStatus(event);
    for (const listener of statusListeners) listener({ data: event });
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
        const result = await sdk.publishPeerRoomMessage(resolvedRoomId, message);
        counters.published += 1;
        const targetPeerId = acknowledgementTargetFor(message);
        if (relayId && awaitAcknowledgement && targetPeerId) {
          pendingAcks.set(relayId, { publishedAt: startedAt, targetPeerId });
        }
        emitStatus('relay-published', {
          relayId,
          attempt,
          elapsedMs: Math.max(0, now() - startedAt),
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
        counters.acknowledgements += 1;
        emitStatus('relay-acknowledged', { relayId: acknowledgedRelayId, byPeerId: message.body?.fromPeerId || null });
      } else {
        emitStatus('relay-ack-rejected', { relayId: acknowledgedRelayId, byPeerId: message.body?.fromPeerId || null });
      }
      if (id) seen.set(id, now() + Math.max(1, Number(dedupWindowMs || 1)));
      return;
    }
    counters.received += 1;
    for (const listener of listeners) listener({ data: message });
    if (id) seen.set(id, now() + Math.max(1, Number(dedupWindowMs || 1)));
    if (Number.isSafeInteger(record?.relaySequence) && record.relaySequence > 0) {
      void acknowledge(record).catch((error) => emitStatus('relay-ack-failed', {
        relayId: id,
        error: String(error?.message || error)
      }));
    }
  };

  const poll = async () => {
    if (closed) return;
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
      for (const record of messages) {
        const message = record.message || record;
        if (message?.peerRoomVersion) await deliver(record);
      }
      const nextCursor = result?.nextCursor;
      const hasSequence = Number.isSafeInteger(nextCursor?.sequence) && nextCursor.sequence >= 0;
      if (nextCursor && (hasSequence || Number.isFinite(Number(nextCursor.createdAt)))) {
        cursor = {
          sequence: hasSequence ? nextCursor.sequence : null,
          createdAt: Number(nextCursor.createdAt),
          messageId: String(nextCursor.messageId || '')
        };
      } else if (messages.length > 0) {
        const last = messages.at(-1);
        cursor = {
          sequence: Number.isSafeInteger(last?.relaySequence) ? last.relaySequence : null,
          createdAt: Number(last.createdAt || last.message?.createdAt || 0),
          messageId: String(last.relayId || last.message?.relay?.relayId || '')
        };
      }
    } catch (error) {
      // Relay failure should not break an already-open room loop.
      counters.pollFailures += 1;
      emitStatus('relay-poll-failed', { error: String(error?.message || error) });
    } finally {
      if (!closed) timer = globalThis.setTimeout(poll, pollIntervalMs);
    }
  };

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
      pendingAcks.clear();
    }
  });
}

export function createPeerRoomBusFactory({ sdk = null, relay = 'local', pollIntervalMs, relayTtlMs } = {}) {
  return (options = {}) => {
    if (relay === 'server' || relay === 'sdk') {
      return createSdkPeerRoomRelayBus({
        sdk,
        roomId: options.roomId,
        localPeerId: options.localPeerId,
        pollIntervalMs,
        relayTtlMs,
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
