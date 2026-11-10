/** Signed research questions and receipt-backed results; creation does not admit evidence. */
import {
  RESEARCH_RECORD_KINDS,
  agreementIsAccepted,
  declaredAgreementProviderIds,
  normalizeIntent
} from '../evidence-record-contract.js';
import {
  MAX_EMBEDDING_DIMENSIONS,
  clone,
  compactText,
  isSha256,
  providerIdentities,
  requireHash,
  unique,
  withContentHash
} from './primitives.js';
import {
  normalizeConsent,
  normalizeModelContract,
  normalizeVerifiedReceiptEvidence
} from './compute-normalization.js';
import {
  createAuthor,
  signResearchRecord
} from './record-signing.js';
import {
  MAX_SEQUENCE_POSITIONS,
  SEQUENCE_ALPHABETS,
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
  hashSequenceFloat32Values,
  validateSequenceOutputIntegrity
} from '../sequence-result.js';

export async function createSignedResearchSubmission({
  identity,
  roomId,
  sequence,
  alphabet = null,
  intent,
  consent,
  modelContract,
  policyId,
  createdAt = new Date().toISOString()
} = {}) {
  const resolvedAlphabet = alphabet || modelContract?.sequence?.alphabet || SEQUENCE_ALPHABETS.aminoAcid;
  const normalizedSequence = normalizeSequenceInput(sequence, resolvedAlphabet);
  const maximumLength = getMaxPublicSequenceLength(resolvedAlphabet);
  if (maximumLength && normalizedSequence.length > maximumLength) {
    const label = resolvedAlphabet === SEQUENCE_ALPHABETS.nucleotide ? 'DNA' : 'protein';
    throw new TypeError(`sequence exceeds the maximum public ${label} length (${maximumLength})`);
  }
  const normalizedModelContract = normalizeModelContract(modelContract);
  if (normalizedModelContract.sequence?.alphabet
    && normalizedModelContract.sequence.alphabet !== resolvedAlphabet) {
    throw new TypeError('research sequence alphabet does not match the exact model contract');
  }
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.submission);
  return signResearchRecord(RESEARCH_RECORD_KINDS.submission, { roomId, createdAt, author, privateKey }, async () => {
    const fields = {
      sequence: {
        alphabet: resolvedAlphabet,
        value: normalizedSequence,
        length: normalizedSequence.length,
        hash: await sha256Hex(normalizedSequence)
      },
      consent: normalizeConsent(consent, resolvedAlphabet),
      requesterIntent: normalizeIntent(intent),
      modelContract: normalizedModelContract,
      policyId: compactText(policyId, 160)
    };
    if (!fields.policyId) throw new TypeError('policyId is required');
    return fields;
  });
}

const normalizePublishedSequenceEvidence = async ({
  submission,
  modelContract = submission?.modelContract,
  receipt,
  receiptRecord,
  sequenceResult,
  sequenceOutput
} = {}) => {
  const metadata = sequenceResult
    || receiptRecord?.sequenceResult
    || receiptRecord?.execution?.sequenceResult
    || receipt?.sequence
    || null;
  if (!metadata || !sequenceOutput) return null;
  const expectedResultHash = receipt?.sequenceResultHash
    || receipt?.sequence?.resultHash
    || receiptRecord?.sequenceResultHash
    || receiptRecord?.execution?.sequenceResultHash
    || null;
  const integrity = await validateSequenceOutputIntegrity({
    sequenceResult: metadata,
    sequenceOutput,
    expectedResultHash
  });
  if (!integrity.ok) {
    throw new TypeError(`sequence evidence integrity failed: ${integrity.reasons.join('; ')}`);
  }
  const residueEmbeddings = Array.isArray(sequenceOutput?.residueEmbeddings)
    ? sequenceOutput.residueEmbeddings.slice(0, MAX_SEQUENCE_POSITIONS).map((entry) => ({
      coordinateSystem: compactText(entry.coordinateSystem, 80),
      sequenceIndex: Number(entry.sequenceIndex),
      tokenIndex: Number(entry.tokenIndex),
      dimensions: Number(entry.dimensions),
      values: Array.from(entry.values || [], Number),
      vectorHash: compactText(entry.vectorHash, 160),
      l2Norm: Number(entry.l2Norm)
    }))
    : [];
  const maskedResidueProposals = Array.isArray(sequenceOutput?.maskedLogits)
    ? clone(sequenceOutput.maskedLogits.slice(0, MAX_SEQUENCE_POSITIONS))
    : [];
  if ((residueEmbeddings.length > 0 || maskedResidueProposals.length > 0)
    && submission.consent?.publishResidueEvidence !== true) {
    throw new TypeError('residue-level evidence publication is not consented');
  }
  const evidence = {
    schema: 'poolday.model_sequence_evidence/v1',
    workload: compactText(metadata.workload, 120),
    alphabet: compactText(metadata.alphabet || submission.sequence?.alphabet, 80),
    sequenceHash: compactText(metadata.sequenceHash || submission.sequence?.hash, 160),
    sequenceLength: Number(metadata.sequenceLength || submission.sequence?.length || 0),
    tokenCount: Number(metadata.tokenCount || 0),
    includedTokenCount: Number(metadata.includedTokenCount || 0),
    embeddingDimensions: Number(metadata.embeddingDim || modelContract?.dimensions || 0),
    coordinateSystem: compactText(metadata.coordinateSystem, 80) || null,
    sequenceIndices: Array.isArray(metadata.sequenceIndices) ? metadata.sequenceIndices.map(Number) : [],
    tokenIndices: Array.isArray(metadata.tokenIndices) ? metadata.tokenIndices.map(Number) : [],
    pooledEmbeddingHash: compactText(metadata.pooledEmbeddingHash, 160) || null,
    tokenEmbeddingsHash: compactText(metadata.tokenEmbeddingsHash, 160) || null,
    residueEmbeddingsHash: compactText(metadata.residueEmbeddingsHash, 160) || null,
    maskedLogitsHash: compactText(metadata.maskedLogitsHash, 160) || null,
    sequenceResultHash: compactText(expectedResultHash, 160) || null,
    residueEmbeddings,
    maskedResidueProposals,
    claimBoundary: maskedResidueProposals.length > 0
      ? 'Masked-token logits are model-specific residue plausibility evidence, not mutation fitness.'
      : 'Token representations are model-specific evidence and are not directly comparable across model contracts.'
  };
  if (evidence.sequenceHash !== submission.sequence?.hash) {
    throw new TypeError('sequence evidence does not match the submitted sequence');
  }
  if (evidence.sequenceLength !== submission.sequence?.length) {
    throw new TypeError('sequence evidence length does not match the submitted sequence');
  }
  if (evidence.alphabet !== submission.sequence?.alphabet) {
    throw new TypeError('sequence evidence alphabet does not match the submitted sequence');
  }
  return withContentHash(evidence, 'evidenceHash');
};

export async function createSignedResearchResult({
  identity,
  roomId,
  submission,
  receiptRecord,
  receiptEvidence = null,
  modelContract: declaredModelContract = null,
  agreement = null,
  routeDecision = null,
  embedding = null,
  sequenceResult = null,
  sequenceOutput = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.result);
  if (submission?.kind !== RESEARCH_RECORD_KINDS.submission || !isSha256(submission.recordHash)) {
    throw new TypeError('signed research submission is required');
  }
  const receipt = receiptRecord?.receipt || receiptRecord || {};
  const receiptHash = receiptRecord?.receiptHash || await hashJson(receipt);
  if (!isSha256(receiptHash)) throw new TypeError('accepted receipt hash is required');
  const accepted = receiptRecord?.requesterAcceptance || receipt.requesterAcceptance || null;
  const verifierDecision = receiptRecord?.verifierDecision || receipt.verifierDecision || null;
  const peerDecision = receiptRecord?.peerDecision || null;
  const vector = Array.isArray(embedding) ? embedding.map(Number) : null;
  if (vector && (!submission.consent.publishEmbedding || vector.length === 0 || vector.length > MAX_EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value)))) {
    throw new TypeError('embedding publication is not consented or is invalid');
  }
  const publishedVectorHash = vector ? await hashSequenceFloat32Values(vector) : null;
  const receiptVectorHash = receipt.vectorHash || receipt.sequence?.vectorHash || receiptRecord?.vectorHash || null;
  if (vector && receiptVectorHash && receiptVectorHash !== publishedVectorHash) {
    throw new TypeError('published embedding does not match the receipt vector commitment');
  }
  const resultModelContract = normalizeModelContract(declaredModelContract || receipt.model || submission.modelContract);
  const receiptModelContract = normalizeModelContract(receipt.model || resultModelContract);
  const requiredModelFields = ['id', 'hash', 'manifestHash', 'tokenizerHash', 'runtime', 'backend', 'workload', 'executionMode'];
  for (const field of requiredModelFields) {
    if (receiptModelContract[field] !== resultModelContract[field]) {
      throw new TypeError(`compute receipt ${field} does not match the result exact model contract`);
    }
  }
  if (exactModelContractKey(receiptModelContract) !== exactModelContractKey(resultModelContract)) {
    throw new TypeError('compute receipt model contract does not exactly match the result exact model contract');
  }
  if (resultModelContract.sequence?.alphabet
    && resultModelContract.sequence.alphabet !== submission.sequence?.alphabet) {
    throw new TypeError('result exact model contract alphabet does not match the submitted sequence');
  }
  const modelContract = clone(resultModelContract);
  const sequenceEvidence = await normalizePublishedSequenceEvidence({
    submission,
    modelContract,
    receipt,
    receiptRecord,
    sequenceResult,
    sequenceOutput
  });
  if (agreement?.receiptHashes != null && !Array.isArray(agreement.receiptHashes)) {
    throw new TypeError('compute agreement receiptHashes must be an array');
  }
  const agreementReceiptHashes = unique([receiptHash, ...(agreement?.receiptHashes || [])])
    .map((hash) => requireHash(hash, 'compute agreement receipt'));
  const agreementAccepted = agreementIsAccepted(agreement);
  if (agreementAccepted && agreementReceiptHashes.length < 2) {
    throw new TypeError('accepted compute agreement requires at least two distinct receipt identities');
  }
  const declaredProviderIds = declaredAgreementProviderIds(agreement) ?? null;
  if (declaredProviderIds != null && !Array.isArray(declaredProviderIds)) {
    throw new TypeError('compute agreement provider identities must be an array');
  }
  if (Array.isArray(declaredProviderIds)
    && declaredProviderIds.some((providerId) => typeof providerId !== 'string' || !providerId.trim())) {
    throw new TypeError('compute agreement provider identities must be non-empty strings');
  }
  const primaryProviderId = compactText(receipt.providerId || receiptRecord?.providerId, 240);
  if (!primaryProviderId) throw new TypeError('compute receipt provider identity is required');
  const agreementProviderIds = providerIdentities([
    primaryProviderId,
    ...(declaredProviderIds || [])
  ]);
  if (agreementAccepted
    && (!declaredProviderIds || agreementProviderIds.length < 2)) {
    throw new TypeError('accepted compute agreement requires at least two distinct provider identities');
  }
  const verifiedReceiptEvidence = await normalizeVerifiedReceiptEvidence({
    receiptEvidence,
    receiptRecord,
    receiptHash,
    agreement,
    modelContract,
    sequenceHash: submission.sequence.hash
  });
  const acceptedByVerifier = verifierDecision?.accepted === true;
  const acceptedByPeerAgreement = peerDecision?.accepted === true
    && agreementAccepted
    && verifiedReceiptEvidence.length >= 2;
  if (!acceptedByVerifier && !acceptedByPeerAgreement) {
    throw new TypeError('an accepted verifier decision or verified peer agreement is required for a research result');
  }
  return signResearchRecord(RESEARCH_RECORD_KINDS.result, { roomId: roomId || submission.roomId, createdAt, author, privateKey }, async () => ({
    submissionHash: submission.recordHash,
    sequenceHash: submission.sequence.hash,
    sequenceLength: submission.sequence.length,
    modelContract,
    compute: {
      receiptHash,
      receiptAdmission: {
        accepted: true,
        source: acceptedByVerifier ? 'server_verifier' : 'verified_peer_agreement'
      },
      verifierDecision: acceptedByVerifier ? clone(verifierDecision) : null,
      peerDecision: acceptedByPeerAgreement ? clone(peerDecision) : null,
      submissionModelContractKey: exactModelContractKey(submission.modelContract),
      receiptModelContractKey: exactModelContractKey(receiptModelContract),
      // The primary receipt is the immutable execution anchor for this result.
      // Agreement receipts may add reproductions but cannot replace it.
      receiptHashes: agreementReceiptHashes,
      // Every receipt counted toward independent execution carries its signed
      // provider evidence. Projection never infers independence from hashes or
      // caller-supplied provider labels alone.
      receiptEvidence: verifiedReceiptEvidence,
      requesterAcceptanceHash: accepted?.acceptanceHash || accepted?.receiptHash || null,
      agreementHash: agreement ? await hashJson(agreement) : null,
      agreement: clone(agreement),
      routeDecisionHash: receipt.routeDecisionHash || (routeDecision ? await hashJson(routeDecision) : null),
      assignmentId: receipt.assignmentId || receiptRecord?.assignmentId || null,
      jobId: receipt.jobId || receiptRecord?.jobId || null,
      providerId: primaryProviderId,
      runtimeProfileHash: receipt.verification?.runtimeProfileHash || receipt.runtime?.runtimeProfileHash || null,
      outputKind: receipt.outputKind || null,
      sequenceResultHash: receipt.sequenceResultHash || receiptRecord?.sequenceResultHash || null,
      vectorHash: receiptVectorHash
    },
    embedding: vector ? {
      dimensions: vector.length,
      values: vector,
      vectorHash: publishedVectorHash
    } : null,
    sequenceEvidence
  }));
}
