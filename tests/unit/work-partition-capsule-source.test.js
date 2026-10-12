import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const ports = vi.hoisted(() => ({ models: [], createStorage: vi.fn(), computeHash: vi.fn() }));
vi.mock('../../self/config/doppler-local-models.js', () => ({
  LOCAL_DOPPLER_MODELS: ports.models, DOPPLER_BROWSER_RUNTIME_VERSION: '0.6.27',
  DOPPLER_PARTITIONS_MODULE_URL: '../vendor/doppler/0.6.27/src/partitions.js',
  DOPPLER_STORAGE_TOOLING_URL: '../vendor/doppler/0.6.27/src/tooling-exports/storage.js',
  DOPPLER_MODULE_URL: '/vendor/doppler/0.6.27/src/index.js',
}));
vi.mock('../../self/vendor/doppler/0.6.27/src/partitions.js', () => ({ createVerifiedPieceStorage: ports.createStorage }));
vi.mock('../../self/vendor/doppler/0.6.27/src/tooling-exports/storage.js', () => ({ computeHash: ports.computeHash }));
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
  const folder = { async getFileHandle(name) {
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
