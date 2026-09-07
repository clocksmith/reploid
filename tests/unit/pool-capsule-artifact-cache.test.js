import { describe, expect, it, vi } from 'vitest';
import { openCapsuleArtifactCache } from '../../self/pool/capsule-artifact-cache.js';
import { sha256Hex } from '../../self/pool/inference-receipt.js';

async function fixture() {
  const envelopeBytes = new TextEncoder().encode('{"fixture":true}');
  const weightBytes = new Uint8Array([1, 2, 3]);
  const artifact = { artifactId: 'weights', role: 'weight-shard', path: 'weights.bin',
    hash: await sha256Hex(weightBytes), sizeBytes: weightBytes.length };
  const envelopeArtifact = { artifactId: 'capsule-envelope', role: 'capsule-envelope', path: 'capsule.json',
    hash: await sha256Hex(envelopeBytes), sizeBytes: envelopeBytes.length };
  const bytes = new Map();
  const close = vi.fn();
  const store = { close, getChunk: async a => bytes.get(a.hash) ?? null,
    deleteChunk: async a => bytes.delete(a.hash),
    putChunk: async (a, value) => { bytes.set(a.hash, value); return { evictedBytes: 0 }; } };
  const model = { packSource: 'https://fixtures.invalid/capsule.json',
    executablePack: { envelopeDigest: 'fixture', artifacts: [artifact] },
    artifactPolicy: { envelopeArtifact, maxCacheBytes: 100, cacheName: 'fixture' } };
  const fetchImpl = vi.fn(async url => ({ ok: true, arrayBuffer: async () =>
    (url.endsWith('capsule.json') ? envelopeBytes : weightBytes).buffer }));
  return { model, artifact, bytes, weightBytes, fetchImpl, close, openCheckpoints: async () => store };
}

describe('Capsule artifact acquisition cache', () => {
  it('reuses exact cached bytes and repairs corrupted bytes from the pinned source', async () => {
    const f = await fixture();
    const first = await openCapsuleArtifactCache(f);
    expect(await first.artifactStore.readArtifact(f.artifact)).toEqual(f.weightBytes);
    first.close(); f.fetchImpl.mockClear();
    const restored = await openCapsuleArtifactCache(f);
    expect(await restored.artifactStore.readArtifact(f.artifact)).toEqual(f.weightBytes);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(restored.getReceipt().fromCache).toBe(true);
    f.bytes.set(f.artifact.hash, new Uint8Array([9, 9, 9]));
    expect(await restored.artifactStore.readArtifact(f.artifact)).toEqual(f.weightBytes);
    expect(restored.getReceipt().corruptCacheBytes).toBe(3);
    expect(f.fetchImpl).toHaveBeenCalledWith('https://fixtures.invalid/weights.bin', expect.any(Object));
    await expect(restored.artifactStore.readArtifact({ ...f.artifact, path: 'other.bin' })).rejects.toThrow('outside');
    restored.close();
    await expect(restored.artifactStore.readArtifact(f.artifact)).rejects.toThrow('closed');
  });

  it('closes storage after envelope failure and rejects corrupt source bytes', async () => {
    const f = await fixture();
    f.fetchImpl.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0]).buffer });
    await expect(openCapsuleArtifactCache(f)).rejects.toThrow('byte identity mismatch');
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.bytes.size).toBe(0);
  });
});
