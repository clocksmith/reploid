// @vitest-environment node
/**
 * Weight-supply acceptance over the production transport: two peers whose custody exchanges (artifacts/custody/
 * exchange.js) talk through the real room transport (transport/room.js: its envelope wrapping, its receive-side
 * envelope validation and its frame registry, transport/message-types.js), not the in-memory loopback the other
 * weight-supply checks use, which skips validation. Only the byte data channel is in memory (the room transport
 * has none without WebRTC); its frames are the production peer-pack channel's.
 *
 * Peer A announces demand (reploid:custody-demand); peer B, which holds one verified synthetic piece, offers it
 * because it saw that demand; A fetches and verifies it and sends its signed delivery confirmation
 * (reploid:custody-delivered); B counts served bytes only once that confirmation arrives. Each frame type is then
 * removed from the registry in turn: the flow must stop there and nothing is counted. Deterministic: no GPU, no
 * timing assertions (waits poll for a state, and "nothing happened" is checked after the transports went idle).
 */
import { describe, expect, it, vi } from 'vitest';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { pieceFile } from '../../packages/reploid/src/contracts/weight-supply.js';
import { createPeerPackArtifactStore, createPeerPackSupplier } from '../../apps/poolday/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../apps/poolday/pool/peer-pack-data-channel.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../shared/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../shared/pool/executable-pack.js';
import { ROOM_POLICY } from '../fixtures/weight-supply-room.js';

const quiet = { info() {}, debug() {}, warn() {}, error() {} };
const PIECE_BYTES = 65536;

/** The room's BroadcastChannel: structured-clone delivery between instances of one name, as the browser does. */
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

/** An in-memory pair of open data channels: the room transport has no data channel without WebRTC. */
function channelPair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [i, channel] of channels.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { const copy = structuredClone(data); queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: copy }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  return channels;
}

/** Waits for macrotasks until nothing is left to deliver (every hop is a microtask or an awaited promise). */
const idle = async () => { for (let i = 0; i < 50; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

/**
 * Two peers on the production room transport, loaded with `withoutType` removed from the frame registry (a fresh
 * module graph, so the transport reads the edited registry). `gate` holds A's delivery confirmations until released.
 */
async function twoPeers({ withoutType = null } = {}) {
  vi.resetModules();
  if (withoutType) {
    vi.doMock('../../packages/reploid/src/transport/message-types.js', async original => {
      const actual = await original();
      return { ...actual, ROOM_MESSAGE_TYPES: Object.freeze(actual.ROOM_MESSAGE_TYPES.filter(type => type !== withoutType)),
        RTC_MESSAGE_TYPES: Object.freeze(actual.RTC_MESSAGE_TYPES.filter(type => type !== withoutType)) };
    });
  } else vi.doUnmock('../../packages/reploid/src/transport/message-types.js');
  const { createSwarmTransport } = await import('../../packages/reploid/src/transport/room.js');
  const { ROOM_MESSAGE_TYPES } = await import('../../packages/reploid/src/transport/message-types.js');
  const { resolveConfig } = await import('../../packages/reploid/src/config/index.js');
  const BroadcastChannel = broadcastChannels();
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'weight-room' }, webrtc: { broadcastRoomId: 'weight-room', transportOrder: ['broadcast'] } } });
  const dataHandlers = new Map(), held = [];
  let gated = true;
  const piece = new Uint8Array(PIECE_BYTES);
  for (let offset = 0; offset < PIECE_BYTES; offset += 65536) crypto.getRandomValues(piece.subarray(offset, offset + 65536));
  const pieceId = await sha256Hex(piece);
  const file = pieceFile({ pieceId, sizeBytes: PIECE_BYTES });

  async function peer(id, pieces) {
    const room = createSwarmTransport({ config, peerId: id, BroadcastChannel, Utils: { generateId: () => id, logger: quiet }, EventBus: { emit() {} } });
    await room.init();
    const transport = { ...room,
      // A's signed delivery confirmations wait here (above the codec) until the test releases them.
      sendToPeer(peerId, type, payload) {
        if (id === 'peer-a' && type === 'reploid:custody-delivered' && gated) { held.push([peerId, type, payload]); return true; }
        return room.sendToPeer(peerId, type, payload);
      },
      onDataChannel: (_, handler) => { dataHandlers.set(id, handler); return () => dataHandlers.delete(id); },
      openDataChannel(peerId) { const [left, right] = channelPair(); dataHandlers.get(peerId)?.(id, right); return left; } };
    const keys = await createSigningKeyPair(), publicKey = await exportPublicKey(keys.publicKey);
    let reserved = 0;
    const exchange = createCustodyExchange({ transport, identity: { peerId: id, privateKey: keys.privateKey, publicKey }, policy: ROOM_POLICY, ports: {
      supplyBudget: { getState: () => ({ reservedBytes: reserved, maxBytes: ROOM_POLICY.maxSupplyBytes }), async reserve(bytes) { reserved += bytes; return this.getState(); } },
      createSupplier: createPeerPackSupplier, createStore: createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
      readArtifact: async descriptor => { const bytes = pieces.get(`sha256:${descriptor.hash}`); if (!bytes) throw new Error('Piece is not held here'); return bytes.slice(); },
      async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== `sha256:${descriptor.hash}`) throw new Error('integrity'); },
      hash: hashDopplerEvidence, hashBytes: sha256Hex } });
    return { id, room, exchange };
  }
  const a = await peer('peer-a', new Map());
  const b = await peer('peer-b', new Map([[pieceId, piece]]));
  await vi.waitFor(() => expect([a, b].every(row => row.room.getConnectedPeers().length === 1)).toBe(true));
  return { a, b, file, pieceId, held, registry: ROOM_MESSAGE_TYPES,
    release() { gated = false; for (const [peerId, type, payload] of held.splice(0)) a.room.sendToPeer(peerId, type, payload); },
    async close() { for (const row of [a, b]) { await row.exchange.close(); row.room.disconnect(); } } };
}

/** B supplies only what a consumer asked for: it offers the pieces named in the demand it received. */
function supplyDemand(b, file) {
  const asked = b.exchange.getState().demand.some(row => row.files.some(item => item.hash === file.hash));
  if (asked) b.exchange.offer([file]);
  return asked;
}

describe('weight supply over the production room transport', () => {
  it('demand reaches the supplier, one verified piece transfers, and served bytes count only after the signed confirmation', async () => {
    const f = await twoPeers();
    try {
      expect(f.registry).toEqual(expect.arrayContaining(['reploid:custody-demand', 'reploid:custody-delivered']));
      f.a.exchange.announceDemand([f.file]);
      await vi.waitFor(() => expect(supplyDemand(f.b, f.file)).toBe(true));
      await vi.waitFor(() => expect(f.a.exchange.has(f.file)).toBe(true));
      const bytes = await f.a.exchange.acquire(f.file, { signal: new AbortController().signal });
      expect(await sha256Hex(bytes)).toBe(f.pieceId);
      // The transfer is complete and verified on A, but B has not seen the confirmation: nothing is served yet.
      await vi.waitFor(() => expect(f.held).toHaveLength(1));
      await idle();
      expect(f.b.exchange.getState()).toMatchObject({ servedBytes: 0, servedTransfers: 0 });
      f.release();
      await vi.waitFor(() => expect(f.b.exchange.getState().servedTransfers).toBe(1));
      expect(f.b.exchange.getState().servedBytes).toBe(PIECE_BYTES);
    } finally { await f.close(); }
  });

  it('without reploid:custody-demand registered, the supplier never sees the demand, offers nothing and serves nothing', async () => {
    const f = await twoPeers({ withoutType: 'reploid:custody-demand' });
    try {
      expect(f.registry).not.toContain('reploid:custody-demand');
      f.a.exchange.announceDemand([f.file]);
      await idle();
      expect(f.b.exchange.getState().demand).toEqual([]);
      expect(supplyDemand(f.b, f.file)).toBe(false);
      await idle();
      expect(f.a.exchange.has(f.file)).toBe(false);
      await expect(f.a.exchange.acquire(f.file, { signal: new AbortController().signal })).rejects.toThrow(/No authorized peer/);
      expect(f.b.exchange.getState()).toMatchObject({ servedBytes: 0, servedTransfers: 0 });
    } finally { await f.close(); }
  });

  it('without reploid:custody-delivered registered, the confirmation is dropped and the supplier counts nothing', async () => {
    const f = await twoPeers({ withoutType: 'reploid:custody-delivered' });
    try {
      expect(f.registry).not.toContain('reploid:custody-delivered');
      f.a.exchange.announceDemand([f.file]);
      await vi.waitFor(() => expect(supplyDemand(f.b, f.file)).toBe(true));
      await vi.waitFor(() => expect(f.a.exchange.has(f.file)).toBe(true));
      await f.a.exchange.acquire(f.file, { signal: new AbortController().signal });
      await vi.waitFor(() => expect(f.held).toHaveLength(1));
      f.release();
      await idle();
      expect(f.b.exchange.getState()).toMatchObject({ servedBytes: 0, servedTransfers: 0 });
    } finally { await f.close(); }
  });
});
