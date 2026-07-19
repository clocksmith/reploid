/**
 * @fileoverview Builds a Poolday pack from a human-promoted NeuralCompiler entry.
 *
 * Publication signatures are owned by adapter-publication.js. This module only
 * derives and seals immutable pack identity from promotion evidence.
 */

import { sealAdapterPack, verifyAdapterPack } from './adapter-pack.js';
import { hashJson } from './inference-receipt.js';

const prefixedHash = (value) => {
  const hash = String(value || '').trim().toLowerCase();
  return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
};

const approvalHashInput = (approval = {}) => {
  const { receiptSha256, ...core } = approval;
  return core;
};

const manifestAdapterConfig = (manifest = {}) => ({
  id: manifest.id || manifest.adapterId || null,
  sha256: prefixedHash(manifest.adapterSha256 || manifest.sha256),
  bytes: Number(manifest.bytes || manifest.size || manifest.adapterBytes || 0),
  format: manifest.format || manifest.adapterFormat || 'peft_safetensors',
  rank: Number(manifest.rank || manifest.r || manifest.lora?.rank || 0),
  alpha: Number(manifest.alpha || manifest.loraAlpha || manifest.lora?.alpha || 0),
  targetModules: manifest.targetModules || manifest.lora?.targetModules || []
});

export async function buildPromotedAdapterPack(entry = {}, {
  packId = null,
  version,
  baseModel,
  runtime,
  distribution,
  runtimeManifest = null
} = {}) {
  const metadata = entry.metadata || {};
  const admission = metadata.trainedAdapterAdmission || {};
  const artifact = admission.artifact || {};
  const receipts = admission.receipts || {};
  const approval = metadata.humanApproval || {};
  if (metadata.trainedAdapter !== true || metadata.admissionState !== 'promoted') {
    throw new Error('Only a human-promoted trained adapter can be published');
  }
  if (approval.source !== 'hitl-controller'
    || approval.humanRequired !== true
    || approval.decision !== 'approve') {
    throw new Error('Adapter publication requires a controller-owned human approval');
  }
  if (prefixedHash(await hashJson(approvalHashInput(approval))) !== prefixedHash(approval.receiptSha256)) {
    throw new Error('Human approval receipt hash mismatch');
  }
  if (approval.adapterId !== artifact.adapterId
    || prefixedHash(approval.adapterSha256) !== prefixedHash(artifact.adapterSha256)
    || prefixedHash(approval.dopplerIdentityReceiptHash) !== prefixedHash(receipts.identityReceiptHash)
    || prefixedHash(approval.dopplerParityReceiptHash) !== prefixedHash(receipts.parityReceiptHash)
    || prefixedHash(approval.gammaSelectionReceiptHash) !== prefixedHash(receipts.gammaReceiptHash)) {
    throw new Error('Human approval receipt does not bind the admitted adapter evidence');
  }
  if (baseModel?.modelId !== artifact.baseModelId
    || prefixedHash(baseModel?.checkpointSha256) !== prefixedHash(artifact.baseCheckpointSha256)) {
    throw new Error('Published base model does not match the admitted checkpoint');
  }

  const manifest = entry.manifest || {};
  const adapter = manifestAdapterConfig({
    ...manifest,
    id: artifact.adapterId,
    adapterSha256: artifact.adapterSha256,
    bytes: manifest.bytes || distribution?.chunks?.reduce(
      (sum, chunk) => sum + Number(chunk.bytes || 0),
      0
    )
  });
  const pack = await sealAdapterPack({
    packId: packId || `${artifact.adapterId}@${version}`,
    version,
    adapter,
    baseModel,
    runtime,
    evidence: {
      dopplerIdentityReceiptHash: prefixedHash(receipts.identityReceiptHash),
      dopplerParityReceiptHash: prefixedHash(receipts.parityReceiptHash),
      gammaSelectionReceiptHash: prefixedHash(receipts.gammaReceiptHash),
      humanPromotionReceiptHash: prefixedHash(approval.receiptSha256)
    },
    promotion: {
      state: 'promoted',
      humanRequired: true,
      approvalId: approval.approvalId,
      approvedAt: approval.approvedAt
    },
    distribution,
    runtimeManifest
  });
  const verification = await verifyAdapterPack(pack, { requirePromoted: true });
  if (!verification.ok) throw new Error(`Published adapter pack is invalid: ${verification.reasons.join('; ')}`);
  return pack;
}

export default { buildPromotedAdapterPack };
