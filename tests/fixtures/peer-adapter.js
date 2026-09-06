/** Synthetic bytes and promotion evidence for protocol tests only. */
import { sealAdapterPack } from '../../self/pool/adapter-pack.js';
import { createSignedAdapterPublication } from '../../self/pool/adapter-publication.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { sha256Hex } from '../../self/pool/inference-receipt.js';
import { packPeerIdentity } from './peer-pack-operation.js';
import { packPeerModel } from '../../self/pool/peer-pack-job.js';
export async function peerAdapterFixture(modelInput) {
  modelInput.runtimeVersion = '0.6.0';
  const h = char => `sha256:${char.repeat(64)}`;
  const model = { ...modelInput, tokenizerHash: h('1'), artifactIdentity: { tokenizerHash: h('1'),
    sourceRepo: 'test/base', sourceRevision: 'a'.repeat(40), weightPackId: 'base-weights', weightPackHash: h('2'),
    manifestVariantId: 'base-f32', conversionConfigDigest: h('3') } };
  const bytes = new TextEncoder().encode('synthetic adapter bytes');
  const identity = model.artifactIdentity;
  const pack = await sealAdapterPack({ packId: 'test-adapter', version: '1.0.0',
    adapter: { id: 'test-adapter', sha256: await sha256Hex(bytes), bytes: bytes.length, format: 'peft_safetensors',
      rank: 1, alpha: 1, targetModules: ['q_proj'] },
    baseModel: { modelId: model.modelId, modelHash: model.modelHash, manifestHash: model.manifestHash,
      checkpointSha256: h('4'), moduleGraphHash: h('5'), ...identity },
    runtime: { name: 'doppler', minimumVersion: '0.4.10', allowedSurfaces: ['browser-webgpu'] },
    evidence: { dopplerIdentityReceiptHash: h('6'), dopplerParityReceiptHash: h('7'), gammaSelectionReceiptHash: h('8'), humanPromotionReceiptHash: h('9') },
    promotion: { state: 'promoted', humanRequired: true },
    distribution: { visibility: 'public', primaryOrigin: { provider: 'huggingface', repoId: 'test/adapter',
      revision: 'b'.repeat(40), path: 'adapter.safetensors' }, preservationMirrors: [],
      chunks: [{ index: 0, bytes: bytes.length, sha256: await sha256Hex(bytes) }] },
    runtimeManifest: { id: 'test-adapter', name: 'Test adapter', version: '1.0.0', baseModel: model.modelId,
      rank: 1, alpha: 1, targetModules: ['q_proj'], checksum: await sha256Hex(bytes), checksumAlgorithm: 'sha256',
      weightsFormat: 'safetensors', weightsPath: 'adapter.safetensors', weightsSize: bytes.length }
  });
  const publisher = await packPeerIdentity();
  const publication = await createSignedAdapterPublication({ pack, publisherId: publisher.keyId,
    publisherPublicKey: publisher.publicKey, privateKey: publisher.privateKey });
  return { model, bytes, pack, publication, publisher,
    entry: { identity: pack.packHash, baseModelIdentity: await hashDopplerEvidence(packPeerModel(model)), publication } };
}
