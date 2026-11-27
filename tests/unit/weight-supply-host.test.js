// @vitest-environment node
/**
 * The browser host's weight supply (apps/poolday/host/weight-supply-host.js) over real custody exchanges in an
 * in-process room: one service per session, created only when asked; the projection the UI renders; approve, refresh,
 * pause and resume; one shared-file inventory with the cached-model path; and the saved state across a reload, with
 * every held piece verified against the pinned piece index before it is shared again.
 */
import { describe, expect, it } from 'vitest';
import { parseOffer } from '../../packages/reploid/src/contracts/computer-records.js';
import { pieceFile, pinnedModelPieces } from '../../packages/reploid/src/contracts/weight-supply.js';
import { createSharedFileInventory } from '../../packages/reploid/src/artifacts/custody/shared-inventory.js';
import { createHostWeightSupply, createMemoryWeightSupplyRecords } from '../../apps/poolday/host/weight-supply-host.js';
import { ROOM_POLICY, createRoom, sha256Hex, syntheticModel } from '../fixtures/weight-supply-room.js';

const PIECE = 4096;
const until = async (check, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!await check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};

async function setup({ count = 4, records = createMemoryWeightSupplyRecords(), model = null, store = null } = {}) {
  model ??= await syntheticModel({ count, pieceBytes: PIECE });
  const pinned = pinnedModelPieces(model);
  const room = createRoom();
  const source = await room.join('source-peer', { pieces: new Map(model.bytes) });
  source.exchange.offer(pinned.pieces.map(pieceFile));
  const consumer = await room.join('consumer-peer');
  consumer.exchange.announceDemand(pinned.pieces.map(pieceFile));
  let host;
  const peer = await room.join('new-peer', { observeServed: event => host.recordServed(event) });
  if (store) Object.assign(peer.store, store(peer));
  const inventory = createSharedFileInventory({ exchange: peer.exchange, maxFiles: ROOM_POLICY.maxInventoryFiles });
  let loads = 0;
  host = createHostWeightSupply({ identity: peer.identity, connectionId: peer.id, exchange: peer.exchange, inventory, store: peer.store, records,
    loadModels: async () => { loads++; return [pinned]; }, ports: { hashBytes: sha256Hex } });
  await until(() => peer.exchange.getState().offers.length > 0 && peer.exchange.getState().demand.length > 0);
  const close = async () => { await host.close(); await Promise.all([source.leave(), consumer.leave(), peer.leave()]); };
  return { model, pinned, room, source, consumer, peer, inventory, host, records, loads: () => loads, close };
}

describe('createHostWeightSupply', () => {
  it('a fresh profile: joining offers nothing, computes nothing and has no approval', async () => {
    const f = await setup();
    try {
      await f.host.start();
      expect(f.loads(), 'no models loaded, no service built on join').toBe(0);
      expect(f.host.getState()).toMatchObject({ recommendation: null, downloadBytes: null, approval: null, paused: false,
        pieces: [], verifiedBytes: 0, servedBytes: 0, replacements: [], transfers: [], restore: { approval: 'none' } });
      expect(f.host.localOffer({ chosen: false })).toBeNull();
      expect(f.peer.exchange.getState().sharing).toBe(false);
    } finally { await f.close(); }
  });

  it('recommends only when asked, approves with the cap the UI passes, and projects every field', async () => {
    const f = await setup();
    try {
      await f.host.start();
      const recommendation = await f.host.recommend({ storageCapBytes: 1 << 20 });
      expect(f.loads()).toBe(1);
      const view = f.host.getState();
      expect(view.recommendation).toEqual(recommendation);
      expect(view.downloadBytes).toBe(4 * PIECE);
      expect(view.offerExpiresAt).toBe(recommendation.offer.expiresAt);
      await expect(f.host.approve({ offerId: recommendation.offer.offerId, storageCapBytes: 2 * PIECE })).rejects.toThrow(/cap/i);
      const approval = await f.host.approve({ offerId: recommendation.offer.offerId, storageCapBytes: 1 << 20 });
      await f.host.whenIdle();
      const state = f.host.getState();
      expect(state.approval).toEqual({ approvalId: approval.approvalId, storageCapBytes: 1 << 20, modelIdentities: [f.model.modelIdentity],
        approvedAt: approval.approvedAt, expiresAt: approval.expiresAt });
      expect(state.recommendation, 'an approved offer is no longer pending').toBeNull();
      expect(state).toMatchObject({ paused: false, verifiedBytes: 4 * PIECE, servedBytes: 0, servedTransfers: 0,
        acquisition: { queuedPieces: 0, acquiringPieces: 0, failedPieces: 0, pendingBytes: 0 } });
      expect(state.pieces.map(piece => [piece.state, piece.sources])).toEqual(Array(4).fill(['verified', ['weight-supply']]));
      // The device's weight-supply offer is the service's, listing the shared inventory.
      const offer = parseOffer(f.host.localOffer({ chosen: false }));
      expect(offer).toMatchObject({ kind: 'weight-supply', readiness: 'ready', paused: false, expiresAt: approval.expiresAt,
        scope: { modelIdentities: [f.model.modelIdentity], pieceIndexDigests: [f.model.pieceIndexDigest], maxStorageBytes: 1 << 20 } });
      expect(offer.scope.files).toHaveLength(4);
      // A consumer fetches a piece: served bytes count from its confirmation.
      await f.source.exchange.stopSupply();
      await until(() => f.consumer.exchange.getState().offers.filter(row => row.scope.files.length).length === 1);
      await f.consumer.exchange.acquire(pieceFile(f.pinned.pieces[0]), { signal: new AbortController().signal });
      await until(() => f.host.getState().servedTransfers === 1);
      expect(f.host.getState()).toMatchObject({ servedBytes: PIECE, transfers: [{ recordedBy: 'provider', pieceId: f.pinned.pieces[0].pieceId }] });
      expect(await f.host.refresh()).toBeNull();
    } finally { await f.close(); }
  });

  it('one inventory: cached-model files and approved pieces both listed with their sources; pause stops all serving', async () => {
    const f = await setup({ count: 3 });
    try {
      await f.host.start();
      const cachedOnly = { path: `piece-${'a'.repeat(64)}.bin`, role: 'model-weights', sizeBytes: PIECE, hash: 'a'.repeat(64), hashAlgorithm: 'sha256' };
      const shared = pieceFile(f.pinned.pieces[0]);
      f.inventory.set('cached-model', [cachedOnly, shared]);
      const { offer } = await f.host.recommend({ storageCapBytes: 1 << 20 });
      await f.host.approve({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      await f.host.whenIdle();
      expect(f.host.getState().inventory.files.map(row => [row.hash.slice(0, 4), row.sources]).sort()).toEqual([
        [cachedOnly.hash.slice(0, 4), ['cached-model']],
        ...f.pinned.pieces.map((piece, index) => [piece.pieceId.slice(7, 11), index === 0 ? ['cached-model', 'weight-supply'] : ['weight-supply']])].sort());
      // The cached path stops: the approved pieces, the shared one included, stay offered.
      f.inventory.set('cached-model', []);
      expect(f.inventory.isServing(shared)).toBe(true);
      f.inventory.set('cached-model', [cachedOnly, shared]);
      // Pausing weight supply pauses all serving from this device, the cached-model files included.
      await f.host.pause();
      expect(f.peer.exchange.getState().sharing).toBe(false);
      expect(f.inventory.isServing(cachedOnly)).toBe(false);
      expect(f.host.getState().paused).toBe(true);
      expect(parseOffer(f.host.localOffer({ chosen: true, enabled: true }))).toMatchObject({ paused: true, readiness: 'unavailable' });
      f.host.resume();
      expect(f.inventory.isServing(cachedOnly) && f.inventory.isServing(shared)).toBe(true);
      // A piece the cached-model path holds is never deleted by weight supply.
      expect(await f.host.deletePiece(f.pinned.pieces[0].pieceId)).toBe(false);
      expect(f.peer.pieces.has(f.pinned.pieces[0].pieceId)).toBe(true);
    } finally { await f.close(); }
  });

  it('survives a reload: signed approval, held pieces re-verified against the pinned index, replacements and transfers', async () => {
    const records = createMemoryWeightSupplyRecords();
    const f = await setup({ count: 3, records });
    try {
      await f.host.start();
      const { offer } = await f.host.recommend({ storageCapBytes: 1 << 20 });
      const approval = await f.host.approve({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      await f.host.whenIdle();
      await f.host.flush();
      const saved = await records.read(f.peer.identity.peerId);
      expect(saved).toMatchObject({ schema: 'reploid.weight-supply-state/1', approval });
      // One piece is corrupted on disk before the reload.
      const [bad] = f.pinned.pieces;
      f.peer.pieces.set(bad.pieceId, new Uint8Array(PIECE));
      await f.host.close();
      f.peer.exchange.stopSupply();
      const inventory = createSharedFileInventory({ exchange: f.peer.exchange, maxFiles: ROOM_POLICY.maxInventoryFiles });
      const reloaded = createHostWeightSupply({ identity: f.peer.identity, connectionId: f.peer.id, exchange: f.peer.exchange, inventory,
        store: f.peer.store, records, loadModels: async () => [f.pinned], ports: { hashBytes: sha256Hex } });
      f.host = reloaded;
      await reloaded.start();
      const state = reloaded.getState();
      expect(state.restore).toMatchObject({ approval: 'restored', restoredPieces: 2, dropped: [{ pieceId: bad.pieceId, reason: 'verification-failed' }] });
      expect(state.approval.approvalId).toBe(approval.approvalId);
      expect(state.verifiedBytes).toBe(2 * PIECE);
      expect(inventory.isServing(pieceFile(bad))).toBe(false);
      expect(inventory.isServing(pieceFile(f.pinned.pieces[1]))).toBe(true);
      expect(f.peer.pieces.has(bad.pieceId)).toBe(false);
    } finally { await f.close(); }
  });

  it('a paused supply stays paused after a reload, so nothing on this device is served', async () => {
    const records = createMemoryWeightSupplyRecords();
    const f = await setup({ count: 2, records });
    try {
      await f.host.start();
      const { offer } = await f.host.recommend({ storageCapBytes: 1 << 20 });
      await f.host.approve({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      await f.host.whenIdle();
      await f.host.pause();
      await f.host.flush();
      await f.host.close();
      const inventory = createSharedFileInventory({ exchange: f.peer.exchange, maxFiles: ROOM_POLICY.maxInventoryFiles });
      inventory.set('cached-model', [pieceFile(f.pinned.pieces[0])]);
      f.host = createHostWeightSupply({ identity: f.peer.identity, connectionId: f.peer.id, exchange: f.peer.exchange, inventory,
        store: f.peer.store, records, loadModels: async () => [f.pinned], ports: { hashBytes: sha256Hex } });
      await f.host.start();
      expect(f.host.getState().paused).toBe(true);
      expect(f.peer.exchange.getState().sharing).toBe(false);
    } finally { await f.close(); }
  });
});
