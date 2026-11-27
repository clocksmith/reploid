/**
 * A private room of in-process peers for weight-supply checks: each peer is a real custody exchange (signed grants,
 * the bounded byte channel, verified chunks) over the production room transport (transport/room.js: envelope
 * wrapping, receive-side validation and the frame registry in transport/message-types.js, over an in-process
 * BroadcastChannel), with a persistent participant identity whose certificate binds its custody key, so transfer
 * roles name verified computers. Only the byte data channel is in memory: the room transport has none without
 * WebRTC. No GPU and no browser.
 */
import { createSwarmTransport } from '../../packages/reploid/src/transport/room.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { CUSTODY_CERTIFICATE_LIFETIME_MS, checkCustodyKeyCertificate, createCustodyKeyCertifier } from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPeerPackArtifactStore, createPeerPackSupplier } from '../../apps/poolday/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../apps/poolday/pool/peer-pack-data-channel.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../shared/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../shared/pool/executable-pack.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function channelPair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [i, channel] of channels.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { const copy = structuredClone(data); queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: copy }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  return channels;
}

/** Exchange policy sized for 4 MiB model pieces (apps/poolday/config/chat-files.json channel limits). */
export const ROOM_POLICY = Object.freeze({ maxTransfers: 4, maxPeers: 16, maxAcquisitionAttempts: 4, maxSupplyBytes: 1 << 30,
  maxArtifactBytes: 64 << 20, maxInventoryFiles: 1024, grantMs: 60_000,
  channel: { maxFrameBytes: 16384, maxControlBytes: 32768, maxChunkBytes: 262144, maxBufferedBytes: 1048576,
    maxPendingRequests: 2, maxTransferBytes: 1 << 30, timeoutMs: 15_000 } });

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

/** BroadcastChannel between in-process instances of one name, with the browser's structured-clone delivery. */
function broadcastChannels() {
  const open = new Set();
  return class Channel {
    constructor(name) { this.name = name; open.add(this); }
    postMessage(data) {
      for (const channel of open) if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.onmessage?.({ data: structuredClone(data) }));
    }
    close() { open.delete(this); }
  };
}

let rooms = 0;
export function createRoom() {
  const members = new Map(), directory = new Map();
  const BroadcastChannel = broadcastChannels(), roomId = `weight-room-${++rooms}`;
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId }, webrtc: { broadcastRoomId: roomId, transportOrder: ['broadcast'] } } });
  const verifyPeerCertificate = async certificate => {
    const publicJwk = directory.get(certificate?.participantId);
    if (!publicJwk) return null;
    const problems = await checkCustodyKeyCertificate(certificate, { publicJwk, atMs: Date.now(),
      maxLifetimeMs: CUSTODY_CERTIFICATE_LIFETIME_MS, maxClockSkewMs: 0 });
    return problems.length ? null : certificate.participantId;
  };

  /**
   * Adds a peer. `pieces` (Map pieceId -> bytes) is its verified piece store; `throttleMsPerChunk` slows only what it
   * serves. Returns { id, computerId, identity, exchange, store, deliveries, leave }.
   */
  async function join(id, { pieces = new Map(), throttleMsPerChunk = 0, observeServed } = {}) {
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    directory.set(identity.peerId, identity.publicJwk);
    const keys = await createSigningKeyPair(), publicKey = await exportPublicKey(keys.publicKey);
    const certifier = createCustodyKeyCertifier({ identity });
    const checkpoints = new Map(), deliveries = [], receipts = [];
    let onChannel = null, reserved = 0;
    const room = createSwarmTransport({ config, peerId: id, BroadcastChannel, Utils: { generateId: () => id, logger: quiet }, EventBus: { emit() {} } });
    await room.init();
    const member = { room, open: (from, channel) => onChannel?.(from, channel) };
    const transport = { ...room,
      // Peers this one has discovered over the room and that are still in it.
      getConnectedPeers: () => room.getConnectedPeers().filter(peer => members.has(peer.id)),
      sendToPeer: (peer, type, payload) => members.has(peer) && members.has(id) && room.sendToPeer(peer, type, payload),
      onDataChannel: (_, callback) => { onChannel = callback; return () => {}; },
      openDataChannel(peer) { const [left, right] = channelPair(); members.get(peer)?.open(id, right); return left; }
    };
    members.set(id, member);
    // Discovery over the room transport: this peer and every member already here see each other.
    for (let i = 0; [...members].some(([other, row]) => other !== id && (!room.getConnectedPeers().some(peer => peer.id === other)
      || !row.room.getConnectedPeers().some(peer => peer.id === id))); i++) {
      if (i > 2000) throw new Error('Room discovery timed out');
      await sleep(1);
    }
    const exchange = createCustodyExchange({ transport, identity: { peerId: id, privateKey: keys.privateKey, publicKey }, policy: ROOM_POLICY,
      ports: {
        supplyBudget: { getState: () => ({ reservedBytes: reserved, maxBytes: ROOM_POLICY.maxSupplyBytes }),
          async reserve(bytes) { reserved += bytes; return this.getState(); } },
        createSupplier: options => createPeerPackSupplier(throttleMsPerChunk > 0
          ? { ...options, readChunk: async (...args) => { await sleep(throttleMsPerChunk); return options.readChunk(...args); } } : options),
        createStore: createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
        readArtifact: async file => {
          const bytes = pieces.get(`sha256:${file.hash}`);
          if (!bytes) throw new Error('Piece is not held here');
          return bytes.slice();
        },
        async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== `sha256:${descriptor.hash}`) throw new Error('integrity'); },
        checkpoints: { getChunk: async chunk => checkpoints.get(chunk.hash)?.slice() || null,
          putChunk: async (chunk, data) => { checkpoints.set(chunk.hash, data.slice()); }, deleteChunk: async chunk => { checkpoints.delete(chunk.hash); } },
        hash: hashDopplerEvidence, hashBytes: sha256Hex,
        certificate: () => certifier.certify({ custodyPeerId: id, custodyPublicKey: publicKey }),
        verifyPeerCertificate,
        observe: receipt => receipts.push(receipt), observeDelivery: record => deliveries.push(record),
        observeServed: event => observeServed?.(event) } });
    exchange.announce();
    const store = { get: async pieceId => pieces.get(pieceId)?.slice() ?? null, put: async (pieceId, bytes) => { pieces.set(pieceId, bytes.slice()); },
      delete: async pieceId => { pieces.delete(pieceId); }, list: async () => [...pieces.keys()] };
    return { id, computerId: identity.peerId, identity, exchange, store, pieces, checkpoints, deliveries, receipts,
      async leave() { members.delete(id); await exchange.close(); room.disconnect(); } };
  }
  return { join, members, directory };
}

/** A synthetic pinned model: one shard of `count` random pieces and its Doppler piece index. */
export async function syntheticModel({ count = 8, pieceBytes = 262144, modelId = 'synthetic-weight-supply' } = {}) {
  const pieces = new Map(), rows = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(pieceBytes);
    for (let offset = 0; offset < pieceBytes; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
    const identity = await sha256Hex(bytes);
    pieces.set(identity, bytes); rows.push({ offset: i * pieceBytes, size: pieceBytes, identity });
  }
  const modelIdentity = await sha256Hex(new TextEncoder().encode(modelId));
  const index = { schema: 'doppler.verified-pieces/v1', manifestIdentity: modelIdentity, maxPieceBytes: pieceBytes,
    files: [{ path: 'shard_00000.bin', size: count * pieceBytes, pieces: rows }] };
  return { modelId, modelIdentity, pieceIndexDigest: await sha256Hex(new TextEncoder().encode(JSON.stringify(index))), index, bytes: pieces };
}

export { sha256Hex };
