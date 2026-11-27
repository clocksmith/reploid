// @vitest-environment node
/**
 * The host's model-file cache (apps/poolday/host/work-model-files.js) as weight supply's ports: one shared inventory
 * over the custody exchange (the cached-model path sets only its own files), the piece store in the same cache with
 * weight-supply pieces kept from eviction, the pinned piece indexes read from this site and verified, served-transfer
 * forwarding, and demand announced while this device's own load fetches a weights file. Browser storage is the
 * in-memory stand-in in tests/fixtures/browser-model-storage.js.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({ exchange: vi.fn(), budget: null }));
vi.mock('../../shared/vendor/reploid/artifacts/custody/exchange.js', () => ({ createCustodyExchange: ports.exchange }));
vi.mock('../../apps/poolday/infrastructure/pack-transfer-storage.js', () => ({
  openPeerPackFileCheckpoints: async () => ({ close() {}, getStats: async () => ({ storedBytes: 0 }), deleteChunk: async () => {} }) }));
vi.mock('../../apps/poolday/infrastructure/custody-supply-budget.js', () => ({
  openBrowserSupplyBudget: async ({ maxBytes }) => ({ getState: () => ({ maxBytes, reservedBytes: 0 }), reserve: async () => ({ maxBytes, reservedBytes: 0 }), close() {} }),
  openBrowserAcquisitionBudget: async ({ maxBytes }) => {
    if (!ports.budget) throw Object.assign(new Error('none'), { code: 'CUSTODY_BUDGET_MISSING' });
    return ports.budget(maxBytes);
  } }));
vi.mock('/vendor/doppler/0.2.0/src/partitions.js', () => ({ createVerifiedPieceStorage: async () => ({ storage: { close: async () => {} } }) }));

import { createWorkModelFiles } from '../../apps/poolday/host/work-model-files.js';
import { LOCAL_DOPPLER_MODELS } from '../../shared/config/doppler-local-models.js';
import { pieceFile } from '../../packages/reploid/src/contracts/weight-supply.js';
import { browserModelStorage } from '../fixtures/browser-model-storage.js';
import { sha256Hex } from '../fixtures/weight-supply-room.js';

const MODEL = LOCAL_DOPPLER_MODELS.find(model => model.id === 'qwen-3-5-0-8b-q4k-ef16-af32-vf16');
const INDEX = MODEL.source.files.find(file => file.role === 'model-piece-index');
const indexBytes = readFileSync(new URL(`../../shared/config/model-pieces/${INDEX.path}`, import.meta.url));
const index = JSON.parse(indexBytes.toString('utf8'));
let captured, exchange, storage;

beforeEach(() => {
  storage = browserModelStorage();
  vi.stubGlobal('navigator', storage.navigator);
  vi.stubGlobal('REPLOID_DOPPLER_STORAGE_MODULE_URL', new URL('../fixtures/doppler-storage-stub.js', import.meta.url).href);
  vi.stubGlobal('location', { href: 'https://replo.id/' });
  ports.exchange.mockReset();
  ports.budget = null;
  ports.exchange.mockImplementation(options => {
    captured = options;
    let sharing = false, offered = [];
    exchange = { demand: [], calls: [], announce() {}, close: async () => {}, has: () => false,
      getState: () => ({ sharing, offered, servedBytes: 0 }),
      offer(files) { offered = files; sharing = true; this.calls.push(['offer', files.length]); },
      stopSupply() { sharing = false; offered = []; this.calls.push(['stop']); return Promise.resolve([]); },
      announceDemand(files) { this.demand.push(files.map(file => file.hash)); } };
    return exchange;
  });
});
afterEach(() => vi.unstubAllGlobals());

const transport = { onDataChannel() {}, getPeerId: () => 'browser-transport' };
const origin = routes => vi.fn(async url => {
  const body = routes[String(url)];
  if (!body) return new Response(null, { status: 404 });
  return typeof body === 'function' ? body() : new Response(body);
});

it('reads the pinned piece indexes from this site, verified, and keeps the 177B index out', async () => {
  const fetchImpl = origin({ [INDEX.url]: indexBytes });
  const files = createWorkModelFiles({ getTransport: () => transport, fetchImpl });
  await files.attach();
  const weight = files.weightSupplyPorts();
  const models = await weight.loadModels();
  const small = models.find(model => model.modelId === MODEL.id);
  expect(small).toMatchObject({ modelIdentity: MODEL.identity, pieceIndexDigest: `sha256:${INDEX.hash}` });
  expect(small.pieces.length).toBe(index.files.reduce((total, row) => total + row.pieces.length, 0));
  expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain(expect.stringContaining('huggingface'));
  // Read once per session.
  expect(await weight.loadModels()).toBe(models);
  await files.close();
});

it('one inventory: weight supply\'s pieces stay shared when the cached-model path stops, and serving follows the inventory', async () => {
  const served = [];
  const files = createWorkModelFiles({ getTransport: () => transport, onServed: event => served.push(event) });
  await files.attach();
  const { inventory, store } = files.weightSupplyPorts();
  const bytes = new Uint8Array(4096).fill(7), pieceId = await sha256Hex(bytes), piece = pieceFile({ pieceId, sizeBytes: 4096 });
  await store.put(pieceId, bytes);
  expect(await store.list()).toContain(pieceId);
  expect(await store.get(pieceId)).toEqual(bytes);
  inventory.source('weight-supply').offer([piece]);
  expect(files.getState()).toMatchObject({ sharing: false, inventory: { files: [{ hash: piece.hash, sources: ['weight-supply'] }] } });
  // Serving reads the piece from the cache while the inventory offers it.
  expect(await captured.ports.readArtifact(piece, {})).toEqual(bytes);
  await files.stop();
  expect(inventory.isServing(piece)).toBe(true);
  inventory.pause();
  await expect(captured.ports.readArtifact(piece, {})).rejects.toThrow(/stopped/);
  // Served transfers reach the host's weight supply.
  captured.ports.observeServed({ transferId: 't1' });
  expect(served).toEqual([{ transferId: 't1' }]);
  await store.delete(pieceId);
  expect(await store.get(pieceId)).toBeNull();
  await files.close();
});

it('announces the pieces of a weights file as demand while this device\'s own load fetches it, then withdraws them', async () => {
  const shard = index.files[0];
  const shardBytes = new Uint8Array(1024).fill(3), hash = (await sha256Hex(shardBytes)).slice(7);
  const url = new URL(shard.path, MODEL.source.baseUrl).href;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = origin({ [INDEX.url]: indexBytes,
    [url]: async () => { await gate; return new Response(shardBytes); } });
  const files = createWorkModelFiles({ getTransport: () => transport, fetchImpl });
  await files.attach();
  // The load's model already holds its piece index here.
  await files.retainPieceIndex(MODEL);
  const loading = files.acquireAdapter({ path: shard.path, role: 'model-weights', url, sizeBytes: shardBytes.byteLength, hash }, {});
  await vi.waitFor(() => expect(exchange.demand.length).toBe(1));
  const expected = shard.pieces.slice(0, 1024).map(piece => piece.identity.slice(7));
  expect(exchange.demand[0]).toEqual(expected);
  release();
  await loading;
  expect(exchange.demand.at(-1)).toEqual([]);
  await files.close();
});

it('announces the piece a download within a limit is fetching as demand, and withdraws it when the fetch ends', async () => {
  const shard = index.files[0], piece = shard.pieces[0];
  const manifest = MODEL.source.files.find(file => file.role === 'model-manifest');
  const manifestBytes = readFileSync(new URL(`../../shared/config/model-manifests/${manifest.hash}.json`, import.meta.url));
  let reserved = 0;
  // The approved allowance also pays for the manifest and piece index this fresh profile reads first: exactly one piece fits.
  const maxBytes = manifest.sizeBytes + INDEX.sizeBytes + piece.size;
  ports.budget = () => ({ getState: () => ({ maxBytes, reservedBytes: reserved }),
    reserve: async bytes => { reserved += bytes; return { maxBytes, reservedBytes: reserved }; }, close() {} });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = origin({ [new URL(manifest.url, 'https://replo.id/').href]: manifestBytes, [new URL(INDEX.url, 'https://replo.id/').href]: indexBytes,
    // The catalog origin holds the piece's range until the test releases it, then refuses it.
    [new URL(shard.path, MODEL.source.baseUrl).href]: async () => { await gate; return new Response(null, { status: 503 }); } });
  const files = createWorkModelFiles({ getTransport: () => transport, fetchImpl });
  await files.attach();
  const sharing = files.share(MODEL, true, { mode: 'bounded-acquisition', downloadBytes: maxBytes });
  await vi.waitFor(() => expect(exchange.demand.at(-1)).toEqual([piece.identity.slice(7)]));
  release();
  await expect(sharing).rejects.toThrow(/HTTP 503/);
  expect(exchange.demand.at(-1)).toEqual([]);
  await files.close();
});
