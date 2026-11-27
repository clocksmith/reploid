// @vitest-environment node
/**
 * Owner acceptance for the empty-cache Contribute journey: a second device loads a model faster, or completes a
 * load it otherwise could not, BECAUSE a new empty-cache peer was offered under-supplied pieces, approved, fetched
 * and verified them, and served them. Each scenario runs twice in a fresh private room: a control without the new
 * peer and a run with it. The consumer starts cold in both (a fresh identity, an empty piece store and no custody
 * checkpoints, asserted before the load). Which computer served each piece is read from the transfer records
 * (reploid.operation-roles/1 provider computerId, verified through the room's custody certificates), never from
 * timing, and cross-checked against the new peer's own served-transfer records.
 *
 * Default: a synthetic pinned model (8 pieces of 256 KiB), a few seconds, in CI-sized form. Opt-in real model:
 * REPLOID_WEIGHT_SUPPLY_REAL_MODEL=1 fetches 4 real 4 MiB pieces (16 MiB) of the smallest pinned model,
 * qwen-3-5-0-8b-q4k-ef16-af32-vf16, from its pinned origin, verifies them against its pinned piece index and runs
 * the same scenarios (about 1-2 minutes, network bound). REPLOID_WEIGHT_SUPPLY_EVIDENCE=<file> writes the tables.
 * No GPU: piece transfer only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pieceFile, pinnedModelPieces, parseWeightTransfer } from '../../packages/reploid/src/contracts/weight-supply.js';
import { createWeightSupply, weightTransferFromDelivery } from '../../packages/reploid/src/artifacts/custody/weight-supply.js';
import { createPieceAcquisition } from '../../packages/reploid/src/artifacts/custody/piece-acquisition.js';
import { WEIGHT_SUPPLY_POLICY } from '../../packages/reploid/src/contracts/weight-supply.js';
import { createRoom, sha256Hex, syntheticModel } from '../fixtures/weight-supply-room.js';

const REAL = process.env.REPLOID_WEIGHT_SUPPLY_REAL_MODEL === '1';
const REAL_MODEL_ID = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
const evidence = { model: null, scenarios: {} };

async function realModel() {
  const catalog = JSON.parse(readFileSync(new URL('../../shared/config/chat-models.json', import.meta.url), 'utf8'));
  const pinned = (catalog.models ?? catalog).find(model => model.id === REAL_MODEL_ID);
  const indexFile = pinned.source.files.find(file => file.role === 'model-piece-index');
  const indexBytes = readFileSync(new URL(`../../shared/config/model-pieces/${indexFile.path}`, import.meta.url));
  expect(await sha256Hex(indexBytes)).toBe(`sha256:${indexFile.hash}`);
  const index = JSON.parse(new TextDecoder().decode(indexBytes));
  const bytes = new Map();
  for (const piece of index.files[0].pieces.slice(0, 4)) {
    const response = await fetch(new URL(index.files[0].path, pinned.source.baseUrl),
      { headers: { Range: `bytes=${piece.offset}-${piece.offset + piece.size - 1}` }, redirect: 'follow' });
    const data = new Uint8Array(await response.arrayBuffer());
    expect(await sha256Hex(data), `pinned piece ${piece.identity}`).toBe(piece.identity);
    bytes.set(piece.identity, data);
  }
  return { modelId: pinned.id, modelIdentity: pinned.identity, pieceIndexDigest: `sha256:${indexFile.hash}`, index, bytes };
}

const model = REAL ? await realModel() : await syntheticModel({ count: 8, pieceBytes: 262144 });
const pinned = pinnedModelPieces(model);
// The pieces the consumer loads: those the source holds (all synthetic pieces, or the four fetched real ones).
const loadSet = pinned.pieces.filter(piece => model.bytes.has(piece.pieceId));
const chunksPerPiece = Math.ceil(loadSet[0].sizeBytes / 262144);
evidence.model = { modelId: model.modelId, modelIdentity: model.modelIdentity, pieceIndexDigest: model.pieceIndexDigest,
  real: REAL, loadPieces: loadSet.length, pieceBytes: loadSet[0].sizeBytes };

const until = async (check, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
const label = (computerId, peers) => Object.entries(peers).find(([, peer]) => peer.computerId === computerId)?.[0] ?? (computerId ? 'other' : 'unverified');

/** A cold consumer joins, asserts its empty cache, announces what it will load and loads it through piece acquisition. */
async function coldConsumer(room, id) {
  const consumer = await room.join(id);
  expect(consumer.pieces.size, 'cold: no cached pieces').toBe(0);
  expect(consumer.checkpoints.size, 'cold: no custody checkpoints').toBe(0);
  expect(consumer.deliveries, 'cold: no earlier transfers').toEqual([]);
  expect(await consumer.store.list()).toEqual([]);
  consumer.exchange.announceDemand(loadSet.map(pieceFile));
  return consumer;
}

async function load(consumer, peers) {
  const timings = new Map();
  const acquisition = createPieceAcquisition({
    sources: () => [{ id: 'mesh', read: async (piece, { signal, onSupplier }) => {
      const startedAt = Date.now();
      try { return await consumer.exchange.acquire(pieceFile({ pieceId: piece.identity, sizeBytes: piece.size }), { signal, onSupplier }); }
      finally { timings.set(piece.identity, { startedAt, completedAt: Date.now() }); }
    } }],
    cache: { get: consumer.store.get, put: consumer.store.put }, authorize: async () => true,
    verify: async (piece, data) => await sha256Hex(data) === piece.identity,
    limits: { maxConcurrent: 2, maxQueued: 64, maxPieceBytes: 8 << 20, timeoutMs: 120_000 }, foregroundIdle: async () => {} });
  const started = performance.now();
  const results = await Promise.allSettled(loadSet.map(piece => acquisition.acquire({ identity: piece.pieceId, size: piece.sizeBytes })));
  const elapsedMs = Math.round(performance.now() - started);
  await acquisition.close();
  const transfers = consumer.deliveries.filter(record => record.role === 'requester').map(record => {
    const hashOf = record.receipt.completed[0].hash;
    return weightTransferFromDelivery(record, { ...timings.get(hashOf), modelIdentity: model.modelIdentity });
  });
  const table = loadSet.map((piece, index) => {
    const transfer = transfers.find(row => row.pieceId === piece.pieceId);
    const failure = results[index].status === 'rejected' ? results[index].reason : null;
    return { piece: piece.pieceId.slice(7, 19), pieceId: piece.pieceId, provider: transfer ? label(transfer.roles.provider.computerId, peers) : 'none',
      providerComputerId: transfer?.roles.provider.computerId ?? null, transferId: transfer?.transferId ?? null,
      bytes: transfer?.deliveredBytes ?? 0, ms: transfer ? transfer.completedAt - transfer.startedAt : null,
      failure: failure ? [failure.message, ...(failure.errors ?? []).map(error => error.message)].join('; ') : null };
  });
  return { completed: results.every(result => result.status === 'fulfilled'), completedPieces: results.filter(result => result.status === 'fulfilled').length,
    elapsedMs, table, transfers };
}

/** The new empty-cache peer: recommendation, approval within `capBytes`, acquisition; returns its service and timing. */
async function newSupplier(room, capBytes) {
  let supply;
  const peer = await room.join('new-peer', { observeServed: event => supply.recordServed(event) });
  supply = createWeightSupply({ identity: peer.identity, connectionId: peer.id, exchange: peer.exchange, models: [pinned], store: peer.store,
    ports: { hashBytes: sha256Hex } });
  // What the mesh already has: the source's offer and the consumer's announced demand.
  await until(() => peer.exchange.getState().demand.length > 0 && peer.exchange.getState().offers.length > 0);
  const recommendation = await supply.recommendWeightSupply({ storageCapBytes: capBytes, deviceLimits: { freeStorageBytes: 1 << 30 } });
  expect(recommendation.cached).toEqual([]);
  expect(recommendation.offer, 'an empty cache is offered under-supplied pieces').not.toBeNull();
  const started = performance.now();
  await supply.approveWeightSupply({ offerId: recommendation.offer.offerId, storageCapBytes: capBytes });
  await supply.whenIdle();
  const report = supply.getWeightSupplyReport();
  expect(report.pieces.every(piece => piece.state === 'verified')).toBe(true);
  expect(report.verifiedBytes).toBe(recommendation.offer.totalDownloadBytes);
  expect(report.servedBytes, 'Ready is not served').toBe(0);
  return { peer, supply, recommendation, acquisitionMs: Math.round(performance.now() - started) };
}

async function seedSource(room, { throttleMsPerChunk = 0, pieces = loadSet } = {}) {
  const source = await room.join('source-peer', { pieces: new Map(pieces.map(piece => [piece.pieceId, model.bytes.get(piece.pieceId)])), throttleMsPerChunk });
  source.exchange.offer(pieces.map(pieceFile));
  return source;
}

/** Each piece the table credits to the new peer is one of its own confirmed served transfers to this consumer. */
function expectServedByNewPeer(table, consumer, supplier) {
  const served = supplier.supply.getServedTransfers();
  for (const row of table.filter(item => item.provider === 'new')) {
    const record = served.find(transfer => transfer.transferId === row.transferId);
    expect(record, `new peer recorded ${row.piece}`).toBeDefined();
    expect(parseWeightTransfer(record)).toEqual(record);
    expect(record).toMatchObject({ recordedBy: 'provider', pieceId: row.pieceId, deliveredBytes: row.bytes,
      roles: { operation: 'weight-transfer', provider: { computerId: supplier.peer.computerId }, consumer: { computerId: consumer.computerId, connectionId: consumer.id } } });
  }
  const report = supplier.supply.getWeightSupplyReport();
  expect(report.servedBytes).toBe(table.filter(item => item.provider === 'new').reduce((total, row) => total + row.bytes, 0));
}

describe(`weight-supply acceptance (${REAL ? 'real pinned model' : 'synthetic model'})`, () => {
  it('a throttled source: the cold consumer loads faster because the new peer serves pieces', async () => {
    const throttleMsPerChunk = Math.ceil(150 / chunksPerPiece) * (REAL ? 2 : 1);
    const control = createRoom();
    const controlSource = await seedSource(control, { throttleMsPerChunk });
    const controlConsumer = await coldConsumer(control, 'consumer-control');
    await until(() => loadSet.every(piece => controlConsumer.exchange.has(pieceFile(piece))));
    const controlRun = await load(controlConsumer, { source: controlSource });
    await Promise.all([controlSource.leave(), controlConsumer.leave()]);

    const room = createRoom();
    const source = await seedSource(room, { throttleMsPerChunk });
    const consumer = await coldConsumer(room, 'consumer-with');
    const supplier = await newSupplier(room, loadSet.reduce((total, piece) => total + piece.sizeBytes, 0));
    await until(() => loadSet.every(piece => consumer.exchange.getState().offers.filter(offer => offer.scope.files.some(file => `sha256:${file.hash}` === piece.pieceId)).length === 2));
    const withRun = await load(consumer, { source, new: supplier.peer });
    evidence.scenarios.throttled = { throttleMsPerChunk, newPeerAcquisitionMs: supplier.acquisitionMs,
      offer: { pieces: supplier.recommendation.offer.pieces.length, totalDownloadBytes: supplier.recommendation.offer.totalDownloadBytes },
      control: { completed: controlRun.completed, elapsedMs: controlRun.elapsedMs, table: controlRun.table },
      withNewPeer: { completed: withRun.completed, elapsedMs: withRun.elapsedMs, table: withRun.table,
        newPeer: { servedBytes: supplier.supply.getWeightSupplyReport().servedBytes, servedTransfers: supplier.supply.getWeightSupplyReport().servedTransfers } } };
    try {
      expect(controlRun.completed).toBe(true);
      expect(controlRun.table.every(row => row.provider === 'source')).toBe(true);
      expect(withRun.completed).toBe(true);
      expect(withRun.table.every(row => ['source', 'new'].includes(row.provider))).toBe(true);
      expect(withRun.table.filter(row => row.provider === 'new').length).toBeGreaterThan(0);
      expectServedByNewPeer(withRun.table, consumer, supplier);
      expect(withRun.elapsedMs).toBeLessThan(controlRun.elapsedMs);
    } finally { await Promise.all([source.leave(), consumer.leave(), supplier.peer.leave()]); }
  }, 300_000);

  it('a source missing pieces: the cold consumer completes only because the new peer supplied them', async () => {
    const capBytes = loadSet.slice(0, Math.max(1, loadSet.length / 2)).reduce((total, piece) => total + piece.sizeBytes, 0);
    // Control: the source holds all but the pieces the new peer would hold in the with-run; no new peer.
    const room = createRoom();
    const source = await seedSource(room);
    const consumer = await coldConsumer(room, 'consumer-with');
    const supplier = await newSupplier(room, capBytes);
    const supplied = new Set(supplier.supply.getWeightSupplyReport().pieces.map(piece => piece.pieceId));
    const remaining = loadSet.filter(piece => !supplied.has(piece.pieceId));
    // The source loses the pieces the new peer now holds (an eviction).
    source.exchange.offer(remaining.map(pieceFile));
    for (const pieceId of supplied) source.pieces.delete(pieceId);
    await until(() => loadSet.every(piece => consumer.exchange.has(pieceFile(piece)))
      && [...supplied].every(pieceId => consumer.exchange.getState().offers.filter(offer => offer.scope.files.some(file => `sha256:${file.hash}` === pieceId)).length === 1));
    const withRun = await load(consumer, { source, new: supplier.peer });

    const control = createRoom();
    const controlSource = await seedSource(control, { pieces: remaining });
    const controlConsumer = await coldConsumer(control, 'consumer-control');
    await until(() => remaining.every(piece => controlConsumer.exchange.has(pieceFile(piece))));
    const controlRun = await load(controlConsumer, { source: controlSource });
    await Promise.all([controlSource.leave(), controlConsumer.leave()]);
    evidence.scenarios.missing = { suppliedPieces: supplied.size, capBytes, newPeerAcquisitionMs: supplier.acquisitionMs,
      control: { completed: controlRun.completed, completedPieces: controlRun.completedPieces, elapsedMs: controlRun.elapsedMs, table: controlRun.table },
      withNewPeer: { completed: withRun.completed, completedPieces: withRun.completedPieces, elapsedMs: withRun.elapsedMs, table: withRun.table,
        newPeer: { servedBytes: supplier.supply.getWeightSupplyReport().servedBytes } } };
    try {
      expect(controlRun.completed).toBe(false);
      expect(controlRun.table.filter(row => supplied.has(row.pieceId)).every(row => row.provider === 'none')).toBe(true);
      expect(withRun.completed).toBe(true);
      // Every piece the source lacked was served by the new peer, per the transfer records.
      expect(withRun.table.filter(row => supplied.has(row.pieceId)).every(row => row.provider === 'new')).toBe(true);
      expect(withRun.table.filter(row => !supplied.has(row.pieceId)).every(row => row.provider === 'source')).toBe(true);
      expectServedByNewPeer(withRun.table, consumer, supplier);
    } finally {
      await Promise.all([source.leave(), consumer.leave(), supplier.peer.leave()]);
      if (process.env.REPLOID_WEIGHT_SUPPLY_EVIDENCE) writeFileSync(process.env.REPLOID_WEIGHT_SUPPLY_EVIDENCE, JSON.stringify({ policy: WEIGHT_SUPPLY_POLICY, ...evidence }, null, 2));
    }
  }, 300_000);
});
