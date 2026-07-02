/**
 * @fileoverview Peer-room rendezvous buses for Reploid browser peers.
 */

export const PEER_ROOM_RELAY_VERSION = 'reploid_peer_room_relay/v1';
export const DEFAULT_RELAY_POLL_INTERVAL_MS = 1000;
export const DEFAULT_RELAY_TTL_MS = 120000;

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
  now = () => Date.now()
} = {}) {
  if (!sdk || typeof sdk.publishPeerRoomMessage !== 'function' || typeof sdk.listPeerRoomMessages !== 'function') {
    throw new TypeError('sdk must provide publishPeerRoomMessage() and listPeerRoomMessages()');
  }
  const resolvedRoomId = requireString(roomId, 'roomId');
  const listeners = new Set();
  const seen = new Set();
  let cursor = 0;
  let timer = null;
  let closed = false;

  const deliver = (message) => {
    const id = message.relay?.relayId || message.relayId || message.id || message.createdAt || JSON.stringify(message);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    for (const listener of listeners) listener({ data: message });
  };

  const poll = async () => {
    if (closed) return;
    try {
      const result = await sdk.listPeerRoomMessages(resolvedRoomId, {
        after: Math.max(0, cursor - 1),
        peerId: localPeerId || null
      });
      const messages = Array.isArray(result?.messages) ? result.messages : Array.isArray(result) ? result : [];
      for (const record of messages) {
        const message = record.message || record;
        cursor = Math.max(cursor, Number(record.createdAt || message.createdAt || 0));
        if (message?.peerRoomVersion) deliver(message);
      }
    } catch {
      // Relay failure should not break an already-open room loop.
    } finally {
      if (!closed) timer = globalThis.setTimeout(poll, pollIntervalMs);
    }
  };

  return Object.freeze({
    addEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.add(listener);
      if (!timer && !closed) void poll();
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
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
      await sdk.publishPeerRoomMessage(resolvedRoomId, message);
      return message;
    },
    close() {
      closed = true;
      if (timer) globalThis.clearTimeout(timer);
      timer = null;
      listeners.clear();
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
        relayTtlMs
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
  peerRoomMessageFromPeerId,
  createBroadcastPeerRoomBus,
  createInMemoryPeerRoomBusNetwork,
  createSdkPeerRoomRelayBus,
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl,
  parsePeerRoomInviteUrl
};
