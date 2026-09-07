import { openCapsuleOpfsCheckpoints } from '../infrastructure/capsule-artifact-storage.js';
import { executablePacksMatch } from './executable-pack.js';
import { sha256Hex } from './inference-receipt.js';

/** Durable acquisition bytes. Doppler independently verifies signatures and every artifact. */
export async function openCapsuleArtifactCache({ model, openCheckpoints = openCapsuleOpfsCheckpoints, fetchImpl = globalThis.fetch }) {
  const policy = model.artifactPolicy;
  const binding = model.executablePack;
  const envelope = policy.envelopeArtifact;
  if (!envelope || envelope.role !== 'capsule-envelope' || !Number.isSafeInteger(policy.maxCacheBytes)
    || policy.maxCacheBytes <= 0 || typeof policy.cacheName !== 'string' || !policy.cacheName) {
    throw new Error('Capsule cache requires an exact envelope commitment and disk byte limit');
  }
  const store = await openCheckpoints({ name: policy.cacheName, maxBytes: policy.maxCacheBytes });
  const observations = { backend: 'opfs', cacheBytes: 0, fetchedBytes: 0, corruptCacheBytes: 0, evictedBytes: 0,
    manifestHash: binding.envelopeDigest, fromCache: false };
  let closed = false;
  const readArtifact = async artifact => {
    if (closed) throw new Error('Capsule cache is closed');
    if (![envelope, ...binding.artifacts].some(entry => executablePacksMatch(entry, artifact))) {
      throw new Error('Artifact is outside the pinned Capsule closure');
    }
    let bytes = await store.getChunk(artifact);
    if (bytes !== null) {
      if (bytes.byteLength === artifact.sizeBytes && await sha256Hex(bytes) === artifact.hash) {
        observations.cacheBytes += bytes.byteLength;
        return bytes;
      }
      observations.corruptCacheBytes += bytes.byteLength;
      await store.deleteChunk(artifact);
    }
    const url = artifact === envelope ? model.packSource : new URL(artifact.path, model.packSource).href;
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Capsule artifact fetch failed: ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== artifact.sizeBytes || await sha256Hex(bytes) !== artifact.hash) {
      throw new Error('Capsule artifact byte identity mismatch');
    }
    observations.fetchedBytes += bytes.byteLength;
    observations.evictedBytes += (await store.putChunk(artifact, bytes)).evictedBytes;
    return bytes;
  };
  try {
    const capsule = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readArtifact(envelope)));
    return { capsule, artifactStore: { readArtifact },
      getReceipt: () => ({ ...observations, fromCache: observations.fetchedBytes === 0 && observations.cacheBytes > 0 }),
      close() { closed = true; store.close(); } };
  } catch (error) { store.close(); throw error; }
}
