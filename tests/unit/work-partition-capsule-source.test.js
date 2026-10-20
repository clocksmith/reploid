// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { assertSignedPreparation } from '../../artifacts/cleanup-failure-20261012/signed-preflight.js';
const ports = vi.hoisted(() => ({ models: [], createStorage: vi.fn(), computeHash: vi.fn(), exchange: vi.fn() }));
// A four-file inventory fits the three metadata files and only one of two cached pieces.
vi.mock('../../self/config/chat-files.json', async original => ({ default: { ...(await original()).default, maxInventoryFiles: 4 } }));
vi.mock('../../self/infrastructure/custody-supply-budget.js', () => ({
  openBrowserSupplyBudget: async ({ maxBytes }) => ({ getState: () => ({ maxBytes, reservedBytes: 0 }), close() {} }),
  openBrowserAcquisitionBudget: vi.fn(() => { throw Error('Cached-only sharing must not open a download allowance'); })
}));
vi.mock('../../self/config/doppler-local-models.js', () => ({
  LOCAL_DOPPLER_MODELS: ports.models, DOPPLER_BROWSER_RUNTIME_VERSION: '0.6.27',
  DOPPLER_PARTITIONS_MODULE_URL: 'doppler-gpu/partitions',
  DOPPLER_STORAGE_TOOLING_URL: 'doppler-gpu/tooling/storage',
  DOPPLER_MODULE_URL: '/vendor/doppler/0.6.27/src/index.js',
}));
vi.mock('doppler-gpu/partitions', () => ({ createVerifiedPieceStorage: ports.createStorage }));
vi.mock('doppler-gpu/tooling/storage', () => ({ computeHash: ports.computeHash }));
vi.mock('../../self/vendor/reploid/artifacts/custody/exchange.js', () => ({ createCustodyExchange: ports.exchange }));
vi.mock('../../self/infrastructure/pack-transfer-storage.js', () => ({ openPeerPackFileCheckpoints: async () => ({ close: async () => {} }) }));
import { createWorkModelFiles } from '../../self/host/work-model-files.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
let model, files, cache, weight, artifact, storage;
beforeEach(() => {
  vi.resetAllMocks(); cache = new Map(); weight = Uint8Array.from([1, 2, 3, 4]);
  const manifest = { modelId: 'signed-source', hashAlgorithm: 'sha256', tokenizer: { file: 'tokenizer.json' },
    shards: [{ index: 0, filename: 'weights.bin', size: 4, hash: hash(weight) }] };
  const manifestBytes = bytes(manifest), piece = weight.slice(0, 2);
  const index = bytes({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + hash(manifestBytes),
    maxPieceBytes: 2, files: [{ path: 'weights.bin', size: 4, pieces: [
      { offset: 0, size: 2, identity: 'sha256:' + hash(piece) },
      { offset: 2, size: 2, identity: 'sha256:' + hash(weight.slice(2)) }] }] });
  const descriptor = (path, payload, role) => {
    cache.set('sha256-' + hash(payload), payload);
    return { path, role, hashAlgorithm: 'sha256', hash: hash(payload), sizeBytes: payload.length };
  };
  model = { id: manifest.modelId, identity: 'sha256:' + hash(manifestBytes), source: { baseUrl: 'https://invalid.example/', files: [
    descriptor('manifest.json', manifestBytes, 'model-manifest'),
    descriptor('pieces.json', index, 'model-piece-index'), descriptor('tokenizer.json', bytes({}), 'tokenizer')] } };
  cache.set('sha256-' + hash(piece), piece);
  ports.models.splice(0, ports.models.length, model);
  storage = { close: vi.fn().mockResolvedValue() };
  ports.createStorage.mockResolvedValue({ manifest, storage, getReceipt: () => ({ verifiedBytes: 0 }) });
  ports.computeHash.mockImplementation(async payload => hash(payload));
  const folder = { async *entries() {}, async getFileHandle(name) {
    if (!cache.has(name)) throw new DOMException('missing', 'NotFoundError');
    const payload = cache.get(name);
    return { async getFile() { return { size: payload.length, arrayBuffer: async () => payload.slice().buffer }; } };
  } };
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => folder }) } });
  artifact = { artifactId: 'weights', role: 'weight-shard', path: 'weights.bin', hash: 'sha256:' + hash(weight), sizeBytes: 4 };
  files = createWorkModelFiles({ getTransport: () => null, fetchImpl: vi.fn(() => { throw new Error('Origin must not be used'); }) });
});
afterEach(() => vi.unstubAllGlobals());
it('provides pinned metadata and complete cached pieces without requiring an external signal', async () => {
  const source = await files.preparePartitionSource(model, {});
  const manifest = model.source.files[0];
  const metadata = await source.artifactStore.readArtifact({ path: manifest.path, hash: 'sha256:' + manifest.hash, sizeBytes: manifest.sizeBytes });
  expect(hash(metadata)).toBe(manifest.hash);
  expect([...await source.artifactStore.readArtifactRange(artifact, 0, 2)]).toEqual([1, 2]);
  expect(source.getReceipt().custody.cacheBytes).toBe(2);
  await source.storage.close();
  await expect(source.artifactStore.readArtifactRange(artifact, 0, 2)).rejects.toThrow('closed');
  expect(storage.close).toHaveBeenCalledOnce();
});
it('rejects changed artifact identities, undeclared files and non-piece ranges before acquisition', async () => {
  const source = await files.preparePartitionSource(model, {});
  for (const changed of [{ ...artifact, hash: 'sha256:' + '0'.repeat(64) }, { ...artifact, path: 'other.bin' }, { ...artifact, sizeBytes: 3 }]) {
    await expect(source.artifactStore.readArtifactRange(changed, 0, 2)).rejects.toThrow('pinned catalog');
  }
  await expect(source.artifactStore.readArtifactRange(artifact, 1, 1)).rejects.toThrow('complete pinned piece');
  await source.storage.close();
});
it('propagates cancellation before retained piece reads', async () => {
  const source = await files.preparePartitionSource(model, {}), controller = new AbortController();
  controller.abort(new Error('cancelled piece'));
  await expect(source.artifactStore.readArtifactRange(artifact, 0, 2, { signal: controller.signal })).rejects.toThrow('cancelled piece');
  await source.storage.close();
});

it('maps Rig model artifacts through the signed manifest directory, without basename fallback', async () => {
  const metadata = model.source.files[0];
  const manifestArtifact = { artifactId: 'manifest', role: 'manifest', path: 'artifacts/model/manifest.json',
    hash: 'sha256:' + metadata.hash, sizeBytes: metadata.sizeBytes };
  artifact = { ...artifact, path: 'artifacts/model/weights.bin' };
  model.capsule = { program: { manifestArtifactId: 'manifest' }, artifacts: [manifestArtifact, artifact] };
  const source = await files.preparePartitionSource(model, {});
  expect(hash(await source.artifactStore.readArtifact(manifestArtifact))).toBe(metadata.hash);
  expect([...await source.artifactStore.readArtifactRange(artifact, 0, 2)]).toEqual([1, 2]);
  await expect(source.artifactStore.readArtifact(artifact)).rejects.toThrow('piece ranges');
  for (const path of ['other/weights.bin', 'artifacts/model/../weights.bin', 'artifacts/model/nested/weights.bin']) {
    const changed = { ...artifact, path };
    model.capsule.artifacts[1] = changed;
    await expect(source.artifactStore.readArtifactRange(changed, 0, 2)).rejects.toThrow('pinned catalog');
    model.capsule.artifacts[1] = artifact;
  }
  await source.storage.close();
});

it.skipIf(!process.env.DOPPLER_SIGNED_READER_PACKAGE)('uses actual signed-reader counters after host artifactStore acquisition bypasses manifest storage', async () => {
  const packageRoot = path.resolve(process.env.DOPPLER_SIGNED_READER_PACKAGE);
  const load = name => import(/* @vite-ignore */ pathToFileURL(path.join(packageRoot, 'src', name)).href);
  const runtime = await load('partitions.js');
  const { createVerifiedCapsuleArtifactStore } = await load('client/runtime/verified-capsule-artifact-store.js');
  ports.createStorage.mockImplementation(runtime.createVerifiedPieceStorage);
  const manifestFile = model.source.files.find(file => file.role === 'model-manifest');
  const indexFile = model.source.files.find(file => file.role === 'model-piece-index');
  const asArtifact = (file, role, artifactId) => ({ artifactId, role, path: file.path,
    hash: 'sha256:' + file.hash, sizeBytes: file.sizeBytes });
  model.partitionPlan = { modelId: model.id };
  model.capsule = { modelId: model.id, program: { manifestArtifactId: 'manifest', pieceIndexArtifactId: 'pieces', weightArtifactIds: ['weights'] },
    artifacts: [asArtifact(manifestFile, 'manifest', 'manifest'), asArtifact(indexFile, 'piece-index', 'pieces'), artifact] };
  cache.delete('sha256-' + hash(weight.slice(0, 2)));
  const acquire = vi.fn(async () => weight.slice(0, 2));
  ports.exchange.mockReturnValue({ announce() {}, has: () => true, acquire, getState: () => ({}), close: async () => {} });
  files = createWorkModelFiles({ getTransport: () => ({ onDataChannel() {}, _getPeerId: () => 'synthetic-peer' }),
    fetchImpl: vi.fn(() => { throw Error('Origin must not be used'); }) });
  await files.attach();
  const source = await files.preparePartitionSource(model, {});
  const signedStore = createVerifiedCapsuleArtifactStore(model.capsule, source.artifactStore);
  try {
    await signedStore.enableResidentPieces();
    expect(signedStore.getPieceVerification().verifiedBytes).toBe(0);
    expect(signedStore.getPieceVerification().ranges).toEqual([]);
    expect([...await signedStore.readArtifactRange(artifact, 0, 1)]).toEqual([1]);
    const actual = { openingMode: 'signed-capsule', plan: model.partitionPlan,
      descriptor: { modelIdentity: model.identity }, acquisition: source.getReceipt(),
      capsuleVerification: { artifactVerificationScope: 'resident-pieces', capsule: model.capsule,
        pieceVerification: { ...signedStore.getPieceVerification(), observation: 'resident-opening' } } };
    expect(actual.acquisition.verifiedBytes).toBe(0);
    expect(actual.acquisition.custody.peerBytes).toBe(2);
    expect(actual.acquisition.custody.transfers).toBe(1);
    expect(actual.capsuleVerification.pieceVerification.verifiedBytes).toBe(2);
    expect(actual.capsuleVerification.pieceVerification.ranges).toEqual([{ path: 'weights.bin', offset: 0, size: 2,
      identity: 'sha256:' + hash(weight.slice(0, 2)) }]);
    expect(acquire).toHaveBeenCalledOnce();
    expect(() => assertSignedPreparation(actual, model)).not.toThrow();
    expect(() => assertSignedPreparation({ ...actual, acquisition: { ...actual.acquisition,
      custody: { peerBytes: 0, transfers: 0, cacheBytes: 2 } } }, model)).toThrow();
    expect(() => assertSignedPreparation({ ...actual, capsuleVerification: { ...actual.capsuleVerification,
      pieceVerification: { ...actual.capsuleVerification.pieceVerification, verifiedBytes: 0 } } }, model)).toThrow();
  } finally { await signedStore.close(); await source.storage.close(); await files.close(); }
});

it('offers only the bounded verified subset when cached pieces exceed the inventory allowance', async () => {
  cache.set('sha256-' + hash(weight.slice(2)), weight.slice(2));
  const offer = vi.fn();
  ports.exchange.mockReturnValue({ announce() {}, has: () => false, offer, stopSupply() {}, getState: () => ({}), close: async () => {} });
  files = createWorkModelFiles({ getTransport: () => ({ onDataChannel() {}, _getPeerId: () => 'synthetic-peer' }),
    fetchImpl: vi.fn(() => { throw Error('Cached-only sharing cannot download'); }) });
  try {
    await files.share(model, true, { mode: 'cached-only' });
    expect(offer).toHaveBeenCalledOnce();
    const inventory = offer.mock.calls[0][0];
    expect(inventory.map(item => item.path)).toEqual(['manifest.json', 'pieces.json', 'tokenizer.json', `piece-${hash(weight.slice(0, 2))}.bin`]);
    expect(cache.has('sha256-' + hash(weight.slice(2)))).toBe(true);
  } finally { await files.close(); }
});
