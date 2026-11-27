// @vitest-environment node
/**
 * This device's weight supply (artifacts/custody/weight-supply.js) over real custody exchanges in an in-process
 * private room: the read-only recommendation, the signed approval, per-piece readiness, served bytes only from
 * confirmed transfers, pausing, and replacement inside the approved cap. Policy numbers come from
 * contracts/weight-supply-policy.json; tests that need other numbers pass a policy built from it.
 */
import { describe, expect, it } from 'vitest';
import {
  WEIGHT_SUPPLY_POLICY, parseWeightSupplyPolicy, parseWeightSupplyReport, pieceFile, pinnedModelPieces,
  weightDemandFromInferenceOffer
} from '../../packages/reploid/src/contracts/weight-supply.js';
import { inferenceOffer } from '../../packages/reploid/src/contracts/computer-records.js';
import { createWeightSupply, verifyWeightSupplyApproval } from '../../packages/reploid/src/artifacts/custody/weight-supply.js';
import { createRoom, sha256Hex, syntheticModel } from '../fixtures/weight-supply-room.js';

const PIECE = 4096;
const until = async (check, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!await check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
const policyWith = changes => parseWeightSupplyPolicy({ ...structuredClone(WEIGHT_SUPPLY_POLICY),
  ...Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, { ...WEIGHT_SUPPLY_POLICY[key], ...value }])) });

/** A room with a source holding `count` pieces, a consumer that announces demand for `demanded` of them, and the new peer. */
async function setup({ count = 4, demanded = count, policy = WEIGHT_SUPPLY_POLICY, announce = true, clock = null } = {}) {
  const model = await syntheticModel({ count, pieceBytes: PIECE });
  const pinned = pinnedModelPieces(model);
  const room = createRoom();
  const source = await room.join('source-peer', { pieces: new Map(model.bytes) });
  source.exchange.offer(pinned.pieces.map(pieceFile));
  const consumer = await room.join('consumer-peer');
  if (announce) consumer.exchange.announceDemand(pinned.pieces.slice(0, demanded).map(pieceFile));
  let supply;
  const peer = await room.join('new-peer', { observeServed: event => supply.recordServed(event) });
  const records = [];
  supply = createWeightSupply({ identity: peer.identity, connectionId: peer.id, exchange: peer.exchange, models: [pinned], store: peer.store, policy,
    ports: { hashBytes: sha256Hex, onRecord: value => records.push(value), ...(clock ? { now: clock } : {}) } });
  await until(() => peer.exchange.getState().offers.length > 0 && (!announce || peer.exchange.getState().demand.length > 0));
  const close = () => Promise.all([source.leave(), consumer.leave(), peer.leave()]);
  return { model, pinned, room, source, consumer, peer, supply, records, close };
}

describe('recommendWeightSupply', () => {
  it('offers an empty cache a bounded set of in-demand, under-supplied pieces with exact bytes, and changes nothing', async () => {
    const f = await setup({ count: 12, demanded: 10 });
    try {
      const recommendation = await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 });
      const { offer } = recommendation;
      expect(recommendation).toMatchObject({ cached: [], noOffer: null, computerId: f.peer.computerId });
      // Policy offer.maxPieces bounds it; only demanded pieces are offered; one source copy is below targetCopies.
      expect(offer.pieces).toHaveLength(WEIGHT_SUPPLY_POLICY.offer.maxPieces);
      expect(offer.pieces.map(piece => piece.pieceId)).toEqual(f.pinned.pieces.slice(0, 8).map(piece => piece.pieceId));
      expect(offer.totalDownloadBytes).toBe(8 * PIECE);
      expect(offer).toMatchObject({ modelIdentity: f.model.modelIdentity, pieceIndexDigest: f.model.pieceIndexDigest,
        expiresAt: offer.createdAt + WEIGHT_SUPPLY_POLICY.offer.ttlMs });
      expect(offer.pieces[0]).toMatchObject({ demand: { consumers: 1, loads: 0, requests: 1 }, supply: { verifiedCopies: 1 } });
      // Read-only: nothing fetched, nothing offered by the new peer.
      expect(f.peer.pieces.size).toBe(0);
      expect(f.peer.exchange.getState().sharing).toBe(false);
      expect(f.supply.getWeightSupplyReport()).toMatchObject({ approval: null, offer: null, verifiedBytes: 0, servedBytes: 0, pieces: [] });
    } finally { await f.close(); }
  });

  it('offers nothing when no piece is in demand or every piece has enough copies', async () => {
    const quiet = await setup({ announce: false });
    try {
      expect(await quiet.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).toMatchObject({ offer: null, noOffer: 'no-under-supplied-piece' });
    } finally { await quiet.close(); }
    const supplied = await setup({ policy: policyWith({ supply: { targetCopies: 1 } }) });
    try {
      expect(await supplied.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).toMatchObject({ offer: null, noOffer: 'no-under-supplied-piece' });
    } finally { await supplied.close(); }
  });

  it('fits the offer inside the storage cap and device limits, or offers nothing', async () => {
    const f = await setup({ count: 4 });
    try {
      expect((await f.supply.recommendWeightSupply({ storageCapBytes: 2 * PIECE + 1 })).offer.totalDownloadBytes).toBe(2 * PIECE);
      expect((await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20, deviceLimits: { freeStorageBytes: PIECE } })).offer.pieces).toHaveLength(1);
      expect(await f.supply.recommendWeightSupply({ storageCapBytes: PIECE - 1 })).toMatchObject({ offer: null, noOffer: 'storage-cap' });
      expect(await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20, deviceLimits: { modelIdentities: [] } }))
        .toMatchObject({ offer: null, noOffer: 'no-under-supplied-piece' });
    } finally { await f.close(); }
  });

  it('lists compatible models already cached here instead of asking for a download', async () => {
    const f = await setup({ count: 4 });
    try {
      await f.peer.store.put(f.pinned.pieces[0].pieceId, f.model.bytes.get(f.pinned.pieces[0].pieceId));
      expect(await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).toMatchObject({ offer: null, noOffer: 'cached-models',
        cached: [{ modelId: f.model.modelId, heldPieces: 1, heldBytes: PIECE, totalPieces: 4, complete: false }] });
    } finally { await f.close(); }
  });

  it('counts a peer loading the model through its preparing inference offer as demand', () => {
    const offer = inferenceOffer({ connectionId: 'consumer-peer', readiness: 'preparing', modelIdentities: [`sha256:${'a'.repeat(64)}`] });
    expect(weightDemandFromInferenceOffer(offer, { observedAt: 5 })).toMatchObject({ kind: 'load', modelIdentity: `sha256:${'a'.repeat(64)}`, pieceIds: [] });
    expect(weightDemandFromInferenceOffer(inferenceOffer({ connectionId: 'consumer-peer', readiness: 'ready', modelIdentities: [`sha256:${'a'.repeat(64)}`] }), { observedAt: 5 })).toBeNull();
  });
});

describe('approveWeightSupply and reporting', () => {
  it('signs a scoped approval, shares each piece as it verifies, and counts served bytes only from confirmed transfers', async () => {
    const f = await setup({ count: 3 });
    try {
      const { offer } = await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 });
      const approval = await f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      expect(approval).toMatchObject({ offerId: offer.offerId, computerId: f.peer.computerId, storageCapBytes: 1 << 20,
        modelIdentities: [f.model.modelIdentity], pieceIndexDigests: [f.model.pieceIndexDigest], expiresAt: approval.approvedAt + WEIGHT_SUPPLY_POLICY.approval.ttlMs });
      expect(await verifyWeightSupplyApproval(approval)).toBe(true);
      expect(f.records[0]).toEqual(approval);
      await expect(f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: 1 << 20 })).rejects.toMatchObject({ code: 'WEIGHT_SUPPLY_OFFER_EXPIRED' });
      await f.supply.whenIdle();
      const ready = f.supply.getWeightSupplyReport();
      expect(ready.pieces.map(piece => piece.state)).toEqual(['verified', 'verified', 'verified']);
      expect(ready).toMatchObject({ verifiedBytes: 3 * PIECE, servedBytes: 0, servedTransfers: 0,
        offer: { kind: 'weight-supply', readiness: 'ready', paused: false, connectionId: 'new-peer', scope: { maxStorageBytes: 1 << 20 } } });
      expect(ready.offer.scope.files).toHaveLength(3);
      expect(await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).toMatchObject({ offer: null, noOffer: 'approved' });

      // The consumer fetches one piece from the new peer only (the source stops), and confirms it.
      f.source.exchange.stopSupply();
      const piece = offer.pieces[0];
      await until(() => f.consumer.exchange.getState().offers.length === 1);
      await f.consumer.exchange.acquire(pieceFile(piece), { signal: new AbortController().signal });
      await until(() => f.supply.getWeightSupplyReport().servedTransfers === 1);
      const report = parseWeightSupplyReport(f.supply.getWeightSupplyReport());
      expect(report.servedBytes).toBe(PIECE);
      expect(report.pieces.find(row => row.pieceId === piece.pieceId)).toMatchObject({ servedBytes: PIECE, servedTransfers: 1 });
      const [transfer] = f.supply.getServedTransfers();
      expect(transfer).toMatchObject({ recordedBy: 'provider', pieceId: piece.pieceId, deliveredBytes: PIECE,
        roles: { operation: 'weight-transfer', provider: { computerId: f.peer.computerId, connectionId: 'new-peer' },
          consumer: { computerId: f.consumer.computerId, connectionId: 'consumer-peer' } } });
      expect(f.peer.exchange.getState()).toMatchObject({ servedBytes: PIECE, servedTransfers: 1 });
    } finally { await f.close(); }
  });

  it('pausing stops serving and fetching, keeps verified pieces, and never stops this device consuming', async () => {
    const f = await setup({ count: 2 });
    try {
      const { offer } = await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 });
      await f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      await f.supply.whenIdle();
      f.supply.pauseWeightSupply();
      const paused = f.supply.getWeightSupplyReport();
      expect(paused).toMatchObject({ paused: true, verifiedBytes: 2 * PIECE, offer: { paused: true } });
      expect(f.peer.exchange.getState().sharing).toBe(false);
      expect(f.peer.pieces.size).toBe(2);
      await until(() => !f.consumer.exchange.getState().offers.some(row => row.connectionId === 'new-peer'));
      expect(await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).toMatchObject({ offer: null, noOffer: 'paused' });
      // Its own consumption is untouched: it can still fetch from the source.
      const own = await f.peer.exchange.acquire(pieceFile(f.pinned.pieces[0]), { signal: new AbortController().signal });
      expect(await sha256Hex(own)).toBe(f.pinned.pieces[0].pieceId);
      f.supply.resumeWeightSupply();
      await until(() => f.consumer.exchange.getState().offers.some(row => row.connectionId === 'new-peer'));
      expect(f.supply.getWeightSupplyReport()).toMatchObject({ paused: false, offer: { paused: false, readiness: 'ready' } });
    } finally { await f.close(); }
  });

  it('replaces well-supplied pieces with more useful ones inside the cap without a new approval, and records it', async () => {
    let offset = 0;
    const f = await setup({ count: 4, demanded: 2, policy: policyWith({ supply: { targetCopies: 2 } }), clock: () => Date.now() + offset });
    try {
      const { offer } = await f.supply.recommendWeightSupply({ storageCapBytes: 2 * PIECE });
      expect(offer.pieces.map(piece => piece.pieceId)).toEqual(f.pinned.pieces.slice(0, 2).map(piece => piece.pieceId));
      const approval = await f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: 2 * PIECE });
      await f.supply.whenIdle();
      expect(await f.supply.refreshWeightSupply()).toBeNull();
      // Another computer now holds piece 0, and consumers move on to pieces 2 and 3.
      const other = await f.room.join('other-peer', { pieces: new Map([[f.pinned.pieces[0].pieceId, f.model.bytes.get(f.pinned.pieces[0].pieceId)]]) });
      other.exchange.offer([pieceFile(f.pinned.pieces[0])]);
      f.consumer.exchange.announceDemand([0, 2, 3].map(index => pieceFile(f.pinned.pieces[index])));
      await until(() => f.peer.exchange.getState().offers.length === 2 && f.peer.exchange.getState().demand[0]?.files.length === 3);
      offset += 1000;
      const replacement = await f.supply.refreshWeightSupply();
      expect(replacement).toMatchObject({ approvalId: approval.approvalId, storageCapBytes: 2 * PIECE, heldBytesBefore: 2 * PIECE, heldBytesAfter: 2 * PIECE,
        // Piece 0 now has enough copies elsewhere; piece 1 is no longer requested. Pieces 2 and 3 take their place.
        removed: [{ pieceId: f.pinned.pieces[0].pieceId, reason: 'well-supplied' }, { pieceId: f.pinned.pieces[1].pieceId, reason: 'no-demand' }],
        added: [2, 3].map(index => ({ pieceId: f.pinned.pieces[index].pieceId, modelIdentity: f.model.modelIdentity, sizeBytes: PIECE })) });
      expect(f.records.at(-1)).toEqual(replacement);
      await f.supply.whenIdle();
      const report = f.supply.getWeightSupplyReport();
      expect(report.pieces.map(piece => piece.pieceId).sort()).toEqual([2, 3].map(index => f.pinned.pieces[index].pieceId).sort());
      expect(report.verifiedBytes).toBeLessThanOrEqual(2 * PIECE);
      expect(report.replacements).toEqual([replacement]);
      expect(f.peer.pieces.has(f.pinned.pieces[0].pieceId)).toBe(false);
      expect(f.supply.getApproval()).toEqual(approval);
      await other.leave();
    } finally { await f.close(); }
  });

  it('an expired approval stops new fetching and replacement', async () => {
    let offset = 0;
    const f = await setup({ count: 2, policy: policyWith({ approval: { ttlMs: 1000 } }), clock: () => Date.now() + offset });
    try {
      const { offer } = await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 });
      await f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: 1 << 20 });
      await f.supply.whenIdle();
      offset += 2000;
      expect(await f.supply.refreshWeightSupply()).toBeNull();
      expect((await f.supply.recommendWeightSupply({ storageCapBytes: 1 << 20 })).noOffer).toBe('cached-models');
    } finally { await f.close(); }
  });
});

describe('exportWeightSupplyState and restoreWeightSupply', () => {
  /** A second service on the same computer, store and models: what a reload builds. */
  const reopen = (f, extra = {}) => createWeightSupply({ identity: f.peer.identity, connectionId: f.peer.id, exchange: f.peer.exchange,
    models: [f.pinned], store: f.peer.store, ports: { hashBytes: sha256Hex, ...extra } });
  async function approved(f, cap = 1 << 20) {
    const { offer } = await f.supply.recommendWeightSupply({ storageCapBytes: cap });
    const approval = await f.supply.approveWeightSupply({ offerId: offer.offerId, storageCapBytes: cap });
    await f.supply.whenIdle();
    return approval;
  }

  it('restores the signed approval, re-verified pieces, replacements and served transfers, and shares the pieces again', async () => {
    const f = await setup({ count: 3 });
    try {
      const approval = await approved(f);
      const state = JSON.parse(JSON.stringify(f.supply.exportWeightSupplyState()));
      expect(state).toMatchObject({ schema: 'reploid.weight-supply-state/1', computerId: f.peer.computerId, paused: false, approval });
      expect(state.pieces.map(piece => piece.state)).toEqual(['verified', 'verified', 'verified']);
      f.peer.exchange.stopSupply();
      const restored = reopen(f);
      const result = await restored.restoreWeightSupply(state);
      expect(result).toMatchObject({ approval: 'restored', restoredPieces: 3, requeuedPieces: 0, dropped: [] });
      expect(restored.getApproval()).toEqual(approval);
      expect(restored.getWeightSupplyReport()).toMatchObject({ verifiedBytes: 3 * PIECE, paused: false, servedBytes: 0 });
      expect(f.peer.exchange.getState().sharing).toBe(true);
    } finally { await f.close(); }
  });

  it('drops a piece that fails verification against the pinned index or is missing, and deletes its bytes', async () => {
    const f = await setup({ count: 3 });
    try {
      await approved(f);
      const state = f.supply.exportWeightSupplyState();
      const [tampered, missing] = state.pieces;
      f.peer.pieces.set(tampered.pieceId, new Uint8Array(PIECE));
      f.peer.pieces.delete(missing.pieceId);
      // A row the pinned index does not hold at that offset is dropped without reading it.
      const moved = { ...state.pieces[2], offset: state.pieces[2].offset + 1 };
      const result = await reopen(f).restoreWeightSupply({ ...state, pieces: [tampered, missing, moved] });
      expect(result.dropped).toEqual([{ pieceId: tampered.pieceId, reason: 'verification-failed' },
        { pieceId: missing.pieceId, reason: 'missing' }, { pieceId: moved.pieceId, reason: 'not-in-pinned-index' }]);
      expect(result.restoredPieces).toBe(0);
      expect(f.peer.pieces.has(tampered.pieceId)).toBe(false);
    } finally { await f.close(); }
  });

  it('drops everything under an expired, forged or other computer\'s approval; a fresh service restores nothing', async () => {
    let offset = 0;
    const f = await setup({ count: 2, clock: () => Date.now() + offset });
    try {
      const approval = await approved(f);
      const state = f.supply.exportWeightSupplyState();
      const other = await f.room.join('other-computer');
      const foreign = createWeightSupply({ identity: other.identity, connectionId: other.id, exchange: other.exchange, models: [f.pinned],
        store: f.peer.store, ports: { hashBytes: sha256Hex } });
      // Another computer's approval: not restored, and its pieces are not this computer's to delete.
      expect((await foreign.restoreWeightSupply(state)).approval).toBe('other-computer');
      expect(f.peer.pieces.size).toBe(2);
      const forged = { ...state, approval: { ...approval, storageCapBytes: approval.storageCapBytes * 2 } };
      const invalid = await reopen(f).restoreWeightSupply({ ...forged, pieces: [state.pieces[0]] });
      expect(invalid).toMatchObject({ approval: 'invalid', restoredPieces: 0, dropped: [{ pieceId: state.pieces[0].pieceId, reason: 'approval-invalid' }] });
      expect(f.peer.pieces.size).toBe(1);
      offset += WEIGHT_SUPPLY_POLICY.approval.ttlMs + 1;
      const expired = await reopen(f, { now: () => Date.now() + offset }).restoreWeightSupply(state);
      expect(expired).toMatchObject({ approval: 'expired', restoredPieces: 0 });
      expect(expired.dropped.map(row => row.reason)).toEqual(['approval-expired', 'approval-expired']);
      expect(f.peer.pieces.size).toBe(0);
      expect(await reopen(f).restoreWeightSupply(null)).toMatchObject({ approval: 'none', restoredPieces: 0, dropped: [] });
      await other.leave();
    } finally { await f.close(); }
  });

  it('keeps a paused supply paused across a reload', async () => {
    const f = await setup({ count: 2 });
    try {
      await approved(f);
      f.supply.pauseWeightSupply();
      const state = f.supply.exportWeightSupplyState();
      expect(state.paused).toBe(true);
      const restored = reopen(f);
      expect(await restored.restoreWeightSupply(state)).toMatchObject({ approval: 'restored', restoredPieces: 2 });
      expect(restored.getWeightSupplyReport().paused).toBe(true);
      expect(f.peer.exchange.getState().sharing).toBe(false);
    } finally { await f.close(); }
  });
});

describe('cachedPieceIds', () => {
  it('counts a full cached model held elsewhere as cached, so an empty piece store is not offered a download', async () => {
    const f = await setup({ count: 2 });
    try {
      const supply = createWeightSupply({ identity: f.peer.identity, connectionId: f.peer.id, exchange: f.peer.exchange, models: [f.pinned],
        store: f.peer.store, ports: { hashBytes: sha256Hex, cachedPieceIds: async () => f.pinned.pieces.map(piece => piece.pieceId) } });
      const recommendation = await supply.recommendWeightSupply({ storageCapBytes: 1 << 20 });
      expect(recommendation).toMatchObject({ offer: null, noOffer: 'cached-models', cached: [{ complete: true, heldPieces: 2 }] });
    } finally { await f.close(); }
  });
});
