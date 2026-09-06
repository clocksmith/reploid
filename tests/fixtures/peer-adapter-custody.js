/** Synthetic bytes and signed custody for transfer contract tests. */
import { packPeerIdentity } from './peer-pack-operation.js';
import { executionAdapterArtifactSet } from '../../self/pool/adapter-execution.js';
import { createPeerPackSupplier } from '../../self/pool/peer-pack-custody.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
export async function adapterCustodyFixture(f) {
  const supplierId = await packPeerIdentity(), receiver = await packPeerIdentity();
  const artifactSet = executionAdapterArtifactSet(f.entry), artifact = artifactSet.artifacts[0];
  const index = { schema: 'reploid.pool.pack-custody-index/v2', artifactSetIdentity: f.entry.identity,
    artifacts: [{ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: artifact.sizeBytes,
      chunks: [{ index: 0, offset: 0, sizeBytes: artifact.sizeBytes, hash: artifact.hash }] }] };
  const authorization = { schema: 'reploid.pool.pack-custody-authorization/v2', artifactSet,
    transferId: crypto.randomUUID(), attempt: 1, expiresAt: Date.now() + 30000,
    requester: { peerId: receiver.keyId, publicKey: receiver.publicKey },
    suppliers: [{ peerId: supplierId.keyId, publicKey: supplierId.publicKey }], indexDigest: await hashDopplerEvidence(index),
    limits: { maxArtifactBytes: 1000, maxChunkBytes: 1000, maxTransferBytes: 2000, requestTimeoutMs: 1000, maxConcurrentChunks: 2 } };
  const supplier = await createPeerPackSupplier({ authorization, index, peerId: supplierId.keyId, privateKey: supplierId.privateKey,
    inventory: { expiresAt: authorization.expiresAt, maxBytes: 2000, artifacts: [{ artifactId: artifact.artifactId, chunkIndexes: [0] }] },
    readChunk: async () => f.bytes });
  return { authorization, index, requesterPrivateKey: receiver.privateKey, inventories: [supplier.inventory],
    requestChunk: async (_peer, request) => supplier.serve(request) };
}
