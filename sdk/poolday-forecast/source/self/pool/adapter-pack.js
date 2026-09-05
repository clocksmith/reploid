/**
 * @fileoverview Immutable governed-adapter identity used by Poolday.
 */

import { hashJson } from './inference-receipt.js';
import { validateArtifactOrigin } from './artifact-origin.js';

export const ADAPTER_PACK_SCHEMA = 'reploid.pool.adapter-pack/v2';
export const ADAPTER_REQUIREMENT_SCHEMA = 'reploid.pool.adapter-requirement/v2';
export const ADAPTER_PACK_FORMATS = Object.freeze(['peft_safetensors', 'rdrr_lora']);
export const ADAPTER_PACK_VISIBILITY = Object.freeze(['public', 'private', 'entitled']);

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const normalizedHash = (value) => {
  const hash = String(value || '').trim().toLowerCase();
  if (!hash) return '';
  return hash.startsWith('sha256:') ? hash : `sha256:${hash}`;
};

const requireHash = (reasons, value, label) => {
  if (!HASH_PATTERN.test(normalizedHash(value))) reasons.push(`${label} must be a SHA-256 identity`);
};

const adapterPackHashInput = (pack = {}) => {
  const { packHash, publisherSignature, ...identity } = pack;
  return identity;
};

export async function sealAdapterPack(pack = {}) {
  const identity = {
    ...pack,
    schema: ADAPTER_PACK_SCHEMA
  };
  delete identity.packHash;
  delete identity.publisherSignature;
  return Object.freeze({
    ...identity,
    packHash: await hashJson(adapterPackHashInput(identity))
  });
}

export function validateAdapterPack(pack = {}, { requirePromoted = true } = {}) {
  const reasons = [];
  if (pack.schema !== ADAPTER_PACK_SCHEMA) reasons.push('adapter pack schema mismatch');
  if (!String(pack.packId || '').trim()) reasons.push('packId is required');
  if (!String(pack.version || '').trim()) reasons.push('version is required');
  requireHash(reasons, pack.packHash, 'packHash');

  const adapter = pack.adapter || {};
  if (!String(adapter.id || '').trim()) reasons.push('adapter.id is required');
  requireHash(reasons, adapter.sha256, 'adapter.sha256');
  if (!Number.isInteger(Number(adapter.bytes)) || Number(adapter.bytes) <= 0) {
    reasons.push('adapter.bytes must be a positive integer');
  }
  if (!ADAPTER_PACK_FORMATS.includes(adapter.format)) reasons.push('adapter.format is not supported');
  if (!Number.isInteger(Number(adapter.rank)) || Number(adapter.rank) <= 0) {
    reasons.push('adapter.rank must be a positive integer');
  }
  if (!Number.isFinite(Number(adapter.alpha)) || Number(adapter.alpha) <= 0) {
    reasons.push('adapter.alpha must be positive');
  }
  if (!Array.isArray(adapter.targetModules) || adapter.targetModules.length === 0) {
    reasons.push('adapter.targetModules must be a non-empty array');
  }

  const base = pack.baseModel || {};
  if (!String(base.modelId || '').trim()) reasons.push('baseModel.modelId is required');
  requireHash(reasons, base.modelHash, 'baseModel.modelHash');
  requireHash(reasons, base.manifestHash, 'baseModel.manifestHash');
  requireHash(reasons, base.checkpointSha256, 'baseModel.checkpointSha256');
  requireHash(reasons, base.tokenizerHash, 'baseModel.tokenizerHash');
  requireHash(reasons, base.moduleGraphHash, 'baseModel.moduleGraphHash');
  if (!String(base.sourceRepo || '').trim()) reasons.push('baseModel.sourceRepo is required');
  if (!/^[a-f0-9]{40,64}$/.test(String(base.sourceRevision || '').trim())) {
    reasons.push('baseModel.sourceRevision must be a full immutable source revision');
  }
  if (!String(base.weightPackId || '').trim()) reasons.push('baseModel.weightPackId is required');
  requireHash(reasons, base.weightPackHash, 'baseModel.weightPackHash');
  if (!String(base.manifestVariantId || '').trim()) reasons.push('baseModel.manifestVariantId is required');
  requireHash(reasons, base.conversionConfigDigest, 'baseModel.conversionConfigDigest');

  const runtime = pack.runtime || {};
  if (runtime.name !== 'doppler') reasons.push('runtime.name must be doppler');
  if (!String(runtime.minimumVersion || '').trim()) reasons.push('runtime.minimumVersion is required');
  if (!Array.isArray(runtime.allowedSurfaces) || !runtime.allowedSurfaces.includes('browser-webgpu')) {
    reasons.push('runtime.allowedSurfaces must include browser-webgpu');
  }
  const runtimeManifest = pack.runtimeManifest || {};
  if (runtimeManifest.id !== adapter.id) reasons.push('runtimeManifest.id must match adapter.id');
  if (runtimeManifest.baseModel !== base.modelId) {
    reasons.push('runtimeManifest.baseModel must match baseModel.modelId');
  }
  if (Number(runtimeManifest.rank) !== Number(adapter.rank)
    || Number(runtimeManifest.alpha) !== Number(adapter.alpha)) {
    reasons.push('runtimeManifest rank and alpha must match the adapter identity');
  }
  if (JSON.stringify(runtimeManifest.targetModules || []) !== JSON.stringify(adapter.targetModules || [])) {
    reasons.push('runtimeManifest.targetModules must match the adapter identity');
  }
  if (normalizedHash(runtimeManifest.checksum) !== normalizedHash(adapter.sha256)) {
    reasons.push('runtimeManifest.checksum must match adapter.sha256');
  }
  if (runtimeManifest.checksumAlgorithm !== 'sha256') {
    reasons.push('runtimeManifest.checksumAlgorithm must be sha256');
  }
  if (Number(runtimeManifest.weightsSize) !== Number(adapter.bytes)) {
    reasons.push('runtimeManifest.weightsSize must match adapter.bytes');
  }
  if (!String(runtimeManifest.weightsPath || '').trim()) reasons.push('runtimeManifest.weightsPath is required');

  const evidence = pack.evidence || {};
  for (const field of [
    'dopplerIdentityReceiptHash',
    'dopplerParityReceiptHash',
    'gammaSelectionReceiptHash',
    'humanPromotionReceiptHash'
  ]) requireHash(reasons, evidence[field], `evidence.${field}`);

  if (requirePromoted) {
    if (pack.promotion?.state !== 'promoted') reasons.push('adapter pack is not promoted');
    if (pack.promotion?.humanRequired !== true) reasons.push('adapter pack promotion must require a human');
  }

  const distribution = pack.distribution || {};
  if (!ADAPTER_PACK_VISIBILITY.includes(distribution.visibility)) {
    reasons.push('distribution.visibility is not supported');
  }
  const primaryOriginValidation = validateArtifactOrigin(distribution.primaryOrigin);
  reasons.push(...primaryOriginValidation.reasons.map((reason) => `distribution.primaryOrigin: ${reason}`));
  if (!Array.isArray(distribution.preservationMirrors)) {
    reasons.push('distribution.preservationMirrors must be an array');
  } else {
    distribution.preservationMirrors.forEach((origin, index) => {
      const validation = validateArtifactOrigin(origin, { allowPreservation: true });
      reasons.push(...validation.reasons.map((reason) => `distribution.preservationMirrors[${index}]: ${reason}`));
    });
  }
  if (!Array.isArray(distribution.chunks) || distribution.chunks.length === 0) {
    reasons.push('distribution.chunks must be a non-empty array');
  } else {
    distribution.chunks.forEach((chunk, index) => {
      if (Number(chunk.index) !== index) reasons.push(`distribution.chunks[${index}].index must be ${index}`);
      requireHash(reasons, chunk.sha256, `distribution.chunks[${index}].sha256`);
      if (!Number.isInteger(Number(chunk.bytes)) || Number(chunk.bytes) <= 0) {
        reasons.push(`distribution.chunks[${index}].bytes must be a positive integer`);
      }
    });
    const total = distribution.chunks.reduce((sum, chunk) => sum + Number(chunk.bytes || 0), 0);
    if (Number.isInteger(Number(adapter.bytes)) && total !== Number(adapter.bytes)) {
      reasons.push('distribution chunk bytes do not equal adapter.bytes');
    }
  }
  if (String(distribution.originUrl || '').trim()) reasons.push('distribution.originUrl is forbidden; use primaryOrigin');

  return { ok: reasons.length === 0, reasons };
}

export async function verifyAdapterPack(pack = {}, options = {}) {
  const validation = validateAdapterPack(pack, options);
  if (!validation.ok) return validation;
  const computedPackHash = await hashJson(adapterPackHashInput(pack));
  if (computedPackHash !== normalizedHash(pack.packHash)) {
    return { ok: false, reasons: ['adapter pack hash mismatch'], computedPackHash };
  }
  return { ok: true, reasons: [], computedPackHash };
}

export function adapterRequirementFromPack(pack = {}) {
  return Object.freeze({
    schema: ADAPTER_REQUIREMENT_SCHEMA,
    packHash: normalizedHash(pack.packHash),
    adapterId: pack.adapter?.id || null,
    adapterSha256: normalizedHash(pack.adapter?.sha256),
    baseModelId: pack.baseModel?.modelId || null,
    baseModelHash: normalizedHash(pack.baseModel?.modelHash),
    baseManifestHash: normalizedHash(pack.baseModel?.manifestHash),
    baseTokenizerHash: normalizedHash(pack.baseModel?.tokenizerHash),
    baseSourceRepo: pack.baseModel?.sourceRepo || null,
    baseSourceRevision: pack.baseModel?.sourceRevision || null,
    baseWeightPackId: pack.baseModel?.weightPackId || null,
    baseWeightPackHash: normalizedHash(pack.baseModel?.weightPackHash),
    baseManifestVariantId: pack.baseModel?.manifestVariantId || null,
    baseConversionConfigDigest: normalizedHash(pack.baseModel?.conversionConfigDigest),
    humanPromotionReceiptHash: normalizedHash(pack.evidence?.humanPromotionReceiptHash),
    dopplerParityReceiptHash: normalizedHash(pack.evidence?.dopplerParityReceiptHash),
    gammaSelectionReceiptHash: normalizedHash(pack.evidence?.gammaSelectionReceiptHash)
  });
}

export function validateAdapterRequirement(requirement = {}) {
  const reasons = [];
  if (requirement.schema !== ADAPTER_REQUIREMENT_SCHEMA) reasons.push('adapter requirement schema mismatch');
  if (!String(requirement.adapterId || '').trim()) reasons.push('adapter requirement adapterId is required');
  for (const field of [
    'packHash',
    'adapterSha256',
    'baseModelHash',
    'baseManifestHash',
    'baseTokenizerHash',
    'baseWeightPackHash',
    'baseConversionConfigDigest',
    'humanPromotionReceiptHash',
    'dopplerParityReceiptHash',
    'gammaSelectionReceiptHash'
  ]) requireHash(reasons, requirement[field], `adapter requirement ${field}`);
  if (!String(requirement.baseModelId || '').trim()) reasons.push('adapter requirement baseModelId is required');
  if (!String(requirement.baseSourceRepo || '').trim()) reasons.push('adapter requirement baseSourceRepo is required');
  if (!/^[a-f0-9]{40,64}$/.test(String(requirement.baseSourceRevision || '').trim())) {
    reasons.push('adapter requirement baseSourceRevision must be immutable');
  }
  if (!String(requirement.baseWeightPackId || '').trim()) reasons.push('adapter requirement baseWeightPackId is required');
  if (!String(requirement.baseManifestVariantId || '').trim()) reasons.push('adapter requirement baseManifestVariantId is required');
  return { ok: reasons.length === 0, reasons };
}

export const adapterRequirementsEqual = (left = {}, right = {}) => (
  left.schema === right.schema
  && normalizedHash(left.packHash) === normalizedHash(right.packHash)
  && left.adapterId === right.adapterId
  && normalizedHash(left.adapterSha256) === normalizedHash(right.adapterSha256)
  && left.baseModelId === right.baseModelId
  && normalizedHash(left.baseModelHash) === normalizedHash(right.baseModelHash)
  && normalizedHash(left.baseManifestHash) === normalizedHash(right.baseManifestHash)
  && normalizedHash(left.baseTokenizerHash) === normalizedHash(right.baseTokenizerHash)
  && left.baseSourceRepo === right.baseSourceRepo
  && left.baseSourceRevision === right.baseSourceRevision
  && left.baseWeightPackId === right.baseWeightPackId
  && normalizedHash(left.baseWeightPackHash) === normalizedHash(right.baseWeightPackHash)
  && left.baseManifestVariantId === right.baseManifestVariantId
  && normalizedHash(left.baseConversionConfigDigest) === normalizedHash(right.baseConversionConfigDigest)
  && normalizedHash(left.humanPromotionReceiptHash) === normalizedHash(right.humanPromotionReceiptHash)
  && normalizedHash(left.dopplerParityReceiptHash) === normalizedHash(right.dopplerParityReceiptHash)
  && normalizedHash(left.gammaSelectionReceiptHash) === normalizedHash(right.gammaSelectionReceiptHash)
);

export function modelIdentityMatchesAdapterRequirement(model = {}, requirement = null) {
  if (!requirement) return true;
  if (!validateAdapterRequirement(requirement).ok) return false;
  if (model.modelId !== requirement.baseModelId) return false;
  if (normalizedHash(model.modelHash) !== normalizedHash(requirement.baseModelHash)) return false;
  if (normalizedHash(model.manifestHash) !== normalizedHash(requirement.baseManifestHash)) return false;
  const identity = model.artifactIdentity || {};
  if (normalizedHash(model.tokenizerHash || identity.tokenizerHash) !== normalizedHash(requirement.baseTokenizerHash)) return false;
  if (identity.sourceRepo !== requirement.baseSourceRepo) return false;
  if (identity.sourceRevision !== requirement.baseSourceRevision) return false;
  if (identity.weightPackId !== requirement.baseWeightPackId) return false;
  if (normalizedHash(identity.weightPackHash || model.modelHash) !== normalizedHash(requirement.baseWeightPackHash)) return false;
  if (identity.manifestVariantId !== requirement.baseManifestVariantId) return false;
  if (normalizedHash(identity.conversionConfigDigest) !== normalizedHash(requirement.baseConversionConfigDigest)) return false;
  return true;
}

export function modelSupportsAdapterRequirement(model = {}, requirement = null, {
  allowedStates = ['active', 'cached', 'fetchable']
} = {}) {
  if (!requirement) return true;
  if (!modelIdentityMatchesAdapterRequirement(model, requirement)) return false;
  return (model.adapterPacks || []).some((candidate) => (
    allowedStates.includes(candidate?.state) && adapterRequirementsEqual(candidate, requirement)
  ));
}

export function runtimeHasActiveAdapterRequirement(model = {}, requirement = null) {
  return modelSupportsAdapterRequirement(model, requirement, { allowedStates: ['active'] });
}

export default {
  ADAPTER_PACK_SCHEMA,
  ADAPTER_REQUIREMENT_SCHEMA,
  sealAdapterPack,
  validateAdapterPack,
  verifyAdapterPack,
  adapterRequirementFromPack,
  validateAdapterRequirement,
  adapterRequirementsEqual,
  modelIdentityMatchesAdapterRequirement,
  modelSupportsAdapterRequirement,
  runtimeHasActiveAdapterRequirement
};
