/** Verification checks shared by record kinds: canonical re-normalization, protocols and analyses. */
import {
  contentHashReason,
  isHashList,
  sameJson,
  SHA256_PATTERN
} from './primitives.js';
import {
  conditionsHaveContent
} from './scientific-normalization.js';

/**
 * Re-normalizes a declared shape. Records `${label} is not canonical` when it differs, or the
 * normalizer's error message when it throws. Returns the normalized shape, or null after an error.
 */
export const checkCanonical = async (reasons, label, declared, normalize) => {
  try {
    const normalized = await normalize();
    if (!sameJson(normalized, declared)) reasons.push(`${label} is not canonical`);
    return normalized;
  } catch (error) {
    reasons.push(error.message);
    return null;
  }
};

export const verifyProtocolEvidence = async (protocol, reasons, label = 'protocol') => {
  if (!protocol || typeof protocol !== 'object') {
    reasons.push(`${label} is required`);
    return;
  }
  const hashReason = await contentHashReason(protocol, 'protocolHash', label);
  if (hashReason) reasons.push(hashReason);
  if (!protocol.protocolId || !protocol.version || !protocol.assayType) reasons.push(`${label} identity is incomplete`);
  if (!conditionsHaveContent(protocol.conditions)) reasons.push(`${label} conditions are required`);
  if (!Array.isArray(protocol.controls) || protocol.controls.length === 0) reasons.push(`${label} controls are required`);
  if (!Array.isArray(protocol.readouts) || protocol.readouts.length === 0) reasons.push(`${label} readouts are required`);
  if (!protocol.normalization?.method || !protocol.normalization?.version) reasons.push(`${label} normalization identity is required`);
  if (!protocol.uncertaintyPlan || !protocol.acceptanceCriteria) reasons.push(`${label} uncertainty and acceptance criteria are required`);
};

export const verifyAnalysisEvidence = async (analysis, reasons, label = 'analysis') => {
  if (!analysis || typeof analysis !== 'object') {
    reasons.push(`${label} identity is required`);
    return;
  }
  const hashReason = await contentHashReason(analysis, 'analysisHash', label);
  if (hashReason) reasons.push(hashReason);
  if (!analysis.methodId || !analysis.version) reasons.push(`${label} method id and version are required`);
  if (analysis.artifactHash && !SHA256_PATTERN.test(analysis.artifactHash)) reasons.push(`${label} artifact hash is invalid`);
  if (analysis.parametersHash && !SHA256_PATTERN.test(analysis.parametersHash)) reasons.push(`${label} parameters hash is invalid`);
  if (!isHashList(analysis.lineageHashes)) {
    reasons.push(`${label} lineage hashes are invalid`);
  }
};
