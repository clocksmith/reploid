/** Field verification for signed questions, receipt-backed results and published sequence evidence. */
import {
  RESEARCH_RECORD_KINDS,
  agreementIsAccepted,
  declaredAgreementProviderIds,
  normalizeIntent,
  projectResearchExecutionIndependence
} from '../evidence-record-contract.js';
import {
  MAX_EMBEDDING_DIMENSIONS,
  SHA256_PATTERN,
  compactText,
  contentHashReason,
  isSha256
} from './primitives.js';
import {
  normalizeConsent,
  normalizeModelContract,
  normalizeVerifiedReceiptEvidence
} from './compute-normalization.js';
import {
  MAX_SEQUENCE_POSITIONS,
  getMaxPublicSequenceLength,
  normalizeSequenceInput
} from '../../../../shared/pool/sequence-workload.js';
import {
  hashJson,
  sha256Hex
} from '../../../../shared/pool/inference-receipt.js';
import {
  exactModelContractKey
} from '../../../../shared/pool/model-contract.js';
import {
  hashSequenceFloat32Values
} from '../sequence-result.js';

const verifyPublishedSequenceEvidence = async (evidence, record, reasons) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    reasons.push('published sequence evidence is invalid');
    return;
  }
  if (evidence.schema !== 'poolday.model_sequence_evidence/v1') {
    reasons.push('published sequence evidence schema is invalid');
  }
  const evidenceHashReason = await contentHashReason(evidence, 'evidenceHash', 'sequence evidence');
  if (evidenceHashReason) reasons.push(evidenceHashReason);
  if (evidence.sequenceHash !== record.sequenceHash) reasons.push('sequence evidence hash does not match the result sequence');
  if (evidence.alphabet !== record.modelContract?.sequence?.alphabet) reasons.push('sequence evidence alphabet does not match the exact model contract');
  if (evidence.workload !== record.modelContract?.workload) reasons.push('sequence evidence workload does not match the exact model contract');
  if (!Number.isInteger(evidence.sequenceLength) || evidence.sequenceLength <= 0) {
    reasons.push('sequence evidence length is invalid');
  }
  if (evidence.sequenceLength !== record.sequenceLength) {
    reasons.push('sequence evidence length does not match the result sequence');
  }
  if (evidence.sequenceLength > Number(record.modelContract?.sequence?.maxSequenceLength || 0)) {
    reasons.push('sequence evidence length exceeds the exact model contract limit');
  }
  if (!Number.isInteger(evidence.embeddingDimensions) || evidence.embeddingDimensions <= 0
    || (record.modelContract?.dimensions && evidence.embeddingDimensions !== record.modelContract.dimensions)) {
    reasons.push('sequence evidence dimensions do not match the exact model contract');
  }
  if (!['zero_based_sequence_index', 'model_token_index'].includes(evidence.coordinateSystem)) {
    reasons.push('sequence evidence coordinate system is invalid');
  }
  if (!Array.isArray(evidence.sequenceIndices) || evidence.sequenceIndices.length > MAX_SEQUENCE_POSITIONS
    || evidence.sequenceIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= evidence.sequenceLength)) {
    reasons.push('sequence evidence sequence indices are invalid');
  }
  if (!Array.isArray(evidence.tokenIndices) || evidence.tokenIndices.length > MAX_SEQUENCE_POSITIONS
    || evidence.tokenIndices.some((index) => !Number.isInteger(index) || index < 0)) {
    reasons.push('sequence evidence model-token indices are invalid');
  }
  if (evidence.coordinateSystem === 'zero_based_sequence_index'
    && evidence.sequenceIndices?.length !== evidence.tokenIndices?.length) {
    reasons.push('sequence evidence residue and model-token indices do not align');
  }
  if (evidence.coordinateSystem === 'model_token_index' && evidence.sequenceIndices?.length !== 0) {
    reasons.push('model-token sequence evidence must not claim residue indices');
  }
  const coordinatePolicy = record.modelContract?.sequence?.coordinates || {};
  if (evidence.coordinateSystem === 'zero_based_sequence_index'
    && coordinatePolicy.mapping === 'one_token_per_sequence_symbol') {
    const prefixTokens = Number(coordinatePolicy.prefixTokens || 0);
    for (const [index, sequenceIndex] of evidence.sequenceIndices.entries()) {
      if (evidence.tokenIndices?.[index] !== sequenceIndex + prefixTokens) {
        reasons.push('sequence evidence token coordinates do not match the exact model contract');
        break;
      }
    }
  }
  const selectedResiduePositions = new Set((evidence.sequenceIndices || []).map((sequenceIndex, index) => (
    `${sequenceIndex}:${evidence.tokenIndices?.[index]}`
  )));
  const selectedModelTokens = new Set(evidence.tokenIndices || []);
  for (const [label, value] of [
    ['pooled embedding', evidence.pooledEmbeddingHash],
    ['token embeddings', evidence.tokenEmbeddingsHash],
    ['residue embeddings', evidence.residueEmbeddingsHash],
    ['masked logits', evidence.maskedLogitsHash],
    ['sequence result', evidence.sequenceResultHash]
  ]) {
    if (value !== null && value !== undefined && !SHA256_PATTERN.test(String(value))) {
      reasons.push(`sequence evidence ${label} hash is invalid`);
    }
  }
  if (evidence.sequenceResultHash && evidence.sequenceResultHash !== record.compute?.sequenceResultHash) {
    reasons.push('sequence evidence result hash does not match compute provenance');
  }
  if (!Array.isArray(evidence.residueEmbeddings)
    || evidence.residueEmbeddings.length > MAX_SEQUENCE_POSITIONS) {
    reasons.push('bounded residue embeddings are invalid');
  } else {
    if (evidence.coordinateSystem === 'model_token_index' && evidence.residueEmbeddings.length > 0) {
      reasons.push('model-token sequence evidence must not publish residue embeddings');
    }
    for (const entry of evidence.residueEmbeddings) {
      if (entry.coordinateSystem !== evidence.coordinateSystem) reasons.push('bounded residue embedding coordinate system is invalid');
      if (!Number.isInteger(entry.sequenceIndex) || entry.sequenceIndex < 0 || entry.sequenceIndex >= evidence.sequenceLength) {
        reasons.push('bounded residue embedding sequence index is invalid');
      }
      if (!Number.isInteger(entry.tokenIndex) || entry.tokenIndex < 0) reasons.push('bounded residue embedding token index is invalid');
      if (!selectedResiduePositions.has(`${entry.sequenceIndex}:${entry.tokenIndex}`)) {
        reasons.push('bounded residue embedding is outside the selected coordinate set');
      }
      if (!Number.isInteger(entry.dimensions) || entry.dimensions !== evidence.embeddingDimensions
        || !Array.isArray(entry.values)
        || entry.values.length !== entry.dimensions
        || entry.values.some((value) => !Number.isFinite(value))) {
        reasons.push('bounded residue embedding values are invalid');
      } else if (!isSha256(entry.vectorHash)
        || await hashSequenceFloat32Values(entry.values) !== entry.vectorHash) {
        reasons.push('bounded residue embedding vector hash mismatch');
      }
      if (!Number.isFinite(entry.l2Norm)) reasons.push('bounded residue embedding norm is invalid');
    }
    if (evidence.residueEmbeddings.length > 0
      && await hashJson(evidence.residueEmbeddings) !== evidence.residueEmbeddingsHash) {
      reasons.push('bounded residue embeddings collection hash mismatch');
    }
  }
  if (!Array.isArray(evidence.maskedResidueProposals)
    || evidence.maskedResidueProposals.length > MAX_SEQUENCE_POSITIONS) {
    reasons.push('masked residue proposals are invalid');
  } else {
    for (const proposal of evidence.maskedResidueProposals) {
      if (proposal.coordinateSystem !== evidence.coordinateSystem) reasons.push('masked residue proposal coordinate system is invalid');
      if (!Number.isInteger(proposal.tokenIndex) || proposal.tokenIndex < 0) reasons.push('masked residue proposal token index is invalid');
      if (evidence.coordinateSystem === 'zero_based_sequence_index'
        && (!Number.isInteger(proposal.sequenceIndex) || proposal.sequenceIndex < 0 || proposal.sequenceIndex >= evidence.sequenceLength)) {
        reasons.push('masked residue proposal sequence index is invalid');
      }
      if (evidence.coordinateSystem === 'model_token_index' && proposal.sequenceIndex !== null) {
        reasons.push('model-token proposal must not claim a residue index');
      }
      if (evidence.coordinateSystem === 'zero_based_sequence_index'
        && !selectedResiduePositions.has(`${proposal.sequenceIndex}:${proposal.tokenIndex}`)) {
        reasons.push('masked residue proposal is outside the selected coordinate set');
      }
      if (evidence.coordinateSystem === 'model_token_index' && !selectedModelTokens.has(proposal.tokenIndex)) {
        reasons.push('masked residue proposal is outside the selected model-token set');
      }
      if (!Array.isArray(proposal.candidates) || proposal.candidates.length < 1 || proposal.candidates.length > 64
        || proposal.candidates.some((candidate) => !Number.isInteger(candidate?.tokenId) || candidate.tokenId < 0 || !Number.isFinite(candidate.score))) {
        reasons.push('masked residue proposal candidates are invalid');
      }
    }
    if (evidence.maskedResidueProposals.length > 0
      && await hashJson(evidence.maskedResidueProposals) !== evidence.maskedLogitsHash) {
      reasons.push('masked residue proposals hash mismatch');
    }
  }
};

const verifySubmissionFields = async (record, reasons) => {
  try {
    const normalized = normalizeSequenceInput(record.sequence?.value, record.sequence?.alphabet);
    if (normalized.length !== record.sequence?.length) reasons.push('sequence length mismatch');
    const maximumLength = getMaxPublicSequenceLength(record.sequence?.alphabet);
    if (maximumLength && normalized.length > maximumLength) reasons.push('sequence exceeds the maximum public sequence length');
    if (await sha256Hex(normalized) !== record.sequence?.hash) reasons.push('sequence hash mismatch');
    normalizeIntent(record.requesterIntent);
    normalizeConsent(record.consent, record.sequence?.alphabet);
    const modelContract = normalizeModelContract(record.modelContract);
    if (modelContract.sequence?.alphabet
      && modelContract.sequence.alphabet !== record.sequence?.alphabet) {
      reasons.push('research sequence alphabet does not match the exact model contract');
    }
  } catch (error) {
    reasons.push(error.message);
  }
};

const verifyResultFields = async (record, reasons, { legacyRecord }) => {
  if (!isSha256(record.submissionHash)) reasons.push('result submissionHash is invalid');
  if (!isSha256(record.sequenceHash)) reasons.push('result sequenceHash is invalid');
  if (!Number.isInteger(record.sequenceLength) || record.sequenceLength <= 0) reasons.push('result sequenceLength is invalid');
  if (!isSha256(record.compute?.receiptHash)) reasons.push('result receiptHash is invalid');
  if (!compactText(record.compute?.providerId, 240)) reasons.push('result providerId is required');
  if (legacyRecord) {
    if (record.compute?.verifierDecision?.accepted !== true) reasons.push('legacy result requires an explicitly accepted verifier decision');
  } else if (record.compute?.receiptAdmission?.accepted !== true) {
    reasons.push('result requires an accepted receipt admission decision');
  }
  if (!Array.isArray(record.compute?.receiptHashes) || record.compute.receiptHashes.some((hash) => !isSha256(hash))) {
    reasons.push('result receiptHashes are invalid');
  } else if (!record.compute.receiptHashes.includes(record.compute.receiptHash)) {
    reasons.push('result receiptHashes must include the primary receiptHash');
  } else if (!legacyRecord
    && agreementIsAccepted(record.compute?.agreement)
    && projectResearchExecutionIndependence(record).independentReceiptCount < 2) {
    reasons.push('accepted compute agreement requires at least two distinct receipt identities');
  }
  const declaredAgreementProviders = declaredAgreementProviderIds(record.compute?.agreement) ?? null;
  if (!legacyRecord && declaredAgreementProviders != null && !Array.isArray(declaredAgreementProviders)) {
    reasons.push('accepted compute agreement provider identities must be an array');
  } else if (Array.isArray(declaredAgreementProviders)
    && declaredAgreementProviders.some((providerId) => typeof providerId !== 'string' || !providerId.trim())) {
    reasons.push('accepted compute agreement provider identities must be non-empty strings');
  }
  if (!legacyRecord
    && agreementIsAccepted(record.compute?.agreement)
    && (!Array.isArray(declaredAgreementProviders)
      || projectResearchExecutionIndependence(record).independentProviderCount < 2)) {
    reasons.push('accepted compute agreement requires at least two distinct provider identities');
  }
  if (!legacyRecord) {
    try {
      await normalizeVerifiedReceiptEvidence({
        receiptEvidence: record.compute?.receiptEvidence,
        receiptRecord: null,
        receiptHash: record.compute?.receiptHash,
        agreement: record.compute?.agreement,
        modelContract: record.modelContract,
        sequenceHash: record.sequenceHash
      });
    } catch (error) {
      reasons.push(error.message);
    }
  }
  try {
    normalizeModelContract(record.modelContract);
  } catch (error) {
    reasons.push(error.message);
  }
  if (record.compute?.receiptModelContractKey !== exactModelContractKey(record.modelContract)) {
    reasons.push('result receipt model contract identity does not match the published exact model contract');
  }
  if (record.embedding) {
    const values = record.embedding.values;
    if (!Array.isArray(values) || values.length !== record.embedding.dimensions || values.length > MAX_EMBEDDING_DIMENSIONS || values.some((value) => !Number.isFinite(value))) {
      reasons.push('published embedding is invalid');
    }
    if (!isSha256(record.embedding.vectorHash)) reasons.push('embedding vectorHash is invalid');
    else if (Array.isArray(values) && await hashSequenceFloat32Values(values) !== record.embedding.vectorHash) {
      reasons.push('published embedding vectorHash does not match its float32 values');
    }
    if (record.compute?.vectorHash && record.compute.vectorHash !== record.embedding.vectorHash) {
      reasons.push('published embedding vectorHash does not match the receipt vector commitment');
    }
    if (record.modelContract?.dimensions && record.modelContract.dimensions !== record.embedding.dimensions) reasons.push('embedding dimensions do not match the exact model contract');
  }
  if (record.sequenceEvidence) await verifyPublishedSequenceEvidence(record.sequenceEvidence, record, reasons);
};

export const computeRecordVerifiers = Object.freeze([
  [RESEARCH_RECORD_KINDS.submission, verifySubmissionFields],
  [RESEARCH_RECORD_KINDS.result, verifyResultFields]
]);
