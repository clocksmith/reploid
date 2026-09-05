/** Internally operated test keys and byte suppliers; no independent-operator claim. */
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createPeerPackSupplier } from '../../self/pool/peer-pack-custody.js';

export async function createCustodyFixture(pack, artifactBytes, chunkSize = 2, limits = {}, envelopeArtifact = undefined) {
  const keys = await Promise.all(Array.from({ length: 4 }, () => createSigningKeyPair()));
  const publicKeys = await Promise.all(keys.map((key) => exportPublicKey(key.publicKey)));
  const index = { schema: 'reploid.pool.pack-custody-index/v1', envelopeDigest: pack.envelopeDigest,
    artifactClosureDigest: pack.artifactClosureDigest, artifacts: [] };
  for (const artifact of [...pack.artifacts, ...(envelopeArtifact ? [envelopeArtifact] : [])]) {
    const bytes = artifactBytes.get(artifact.artifactId);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const part = bytes.slice(offset, offset + chunkSize);
      chunks.push({ index: chunks.length, offset, sizeBytes: part.length, hash: await sha256Hex(part) });
    }
    index.artifacts.push({ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: bytes.length, chunks });
  }
  const now = 1000;
  const authorization = { schema: 'reploid.pool.pack-custody-authorization/v1', pack,
    ...(envelopeArtifact ? { envelopeArtifact } : {}),
    transferId: 'custody-test', attempt: 1, expiresAt: now + 60000,
    requester: { peerId: 'requester', publicKey: publicKeys[0] },
    suppliers: ['faulty', 'even', 'odd'].map((peerId, index) => ({ peerId, publicKey: publicKeys[index + 1] })),
    indexDigest: await hashDopplerEvidence(index),
    limits: { maxArtifactBytes: 1024 * 1024, maxChunkBytes: chunkSize, maxTransferBytes: 4 * 1024 * 1024, requestTimeoutMs: 1000, ...limits } };
  const suppliers = new Map();
  for (const [position, peer] of authorization.suppliers.entries()) {
    const inventory = { expiresAt: authorization.expiresAt, maxBytes: authorization.limits.maxTransferBytes,
      artifacts: index.artifacts.map((artifact) => ({ artifactId: artifact.artifactId,
        chunkIndexes: artifact.chunks.filter((chunk) => position === 0 || chunk.index % 2 === position - 1).map((chunk) => chunk.index) })) };
    suppliers.set(peer.peerId, await createPeerPackSupplier({ authorization, index, peerId: peer.peerId,
      privateKey: keys[position + 1].privateKey, inventory, now: () => now,
      readChunk: async (id, chunk) => artifactBytes.get(id).slice(chunk.offset, chunk.offset + chunk.sizeBytes) }));
  }
  const requests = [];
  const requestChunk = async (peerId, request) => {
    requests.push(structuredClone(request));
    if (peerId === 'faulty' && request.chunkIndex % 2 === 1) throw new Error('injected supplier interruption');
    const response = await suppliers.get(peerId).serve(request);
    if (peerId === 'faulty') response.bytes[0] ^= 255;
    return response;
  };
  return { authorization, index, suppliers, requests, keys, artifactBytes,
    options: { authorization, index, inventories: [...suppliers.values()].map((supplier) => supplier.inventory),
      requesterPrivateKey: keys[0].privateKey, requestChunk, now: () => now } };
}
