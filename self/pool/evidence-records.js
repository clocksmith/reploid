/** Signed immutable record construction; creation does not admit evidence. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  EVIDENCE_RELATIONS,
  HUMAN_CLAIM_KINDS,
  MAX_EMBEDDING_DIMENSIONS,
  PRIOR_EVIDENCE_KINDS,
  RESEARCH_ATTEMPT_STATUSES,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_OUTCOME_CLASSES,
  RESEARCH_RECORD_KINDS,
  RESEARCH_RECORD_VERSION,
  RESEARCH_REVIEW_DECISIONS,
  SHA256_PATTERN,
  clone,
  compactText,
  deepFreeze,
  normalizeIntent,
  normalizeRoomId,
  providerIdentities,
  sameStringSet,
  unique
} from './evidence-record-contract.js';
import {
  MAX_SEQUENCE_POSITIONS,
  SEQUENCE_ALPHABETS,
  getMaxPublicSequenceLength,
  normalizeSequenceInput
} from './sequence-workload.js';
import {
  SIGNATURE_DOMAINS,
  exportPublicKey,
  hashJson,
  sha256Hex,
  signCanonical
} from './inference-receipt.js';
import {
  adjudicationMetricResult,
  assessAdjudicationExperiment,
  conditionsHaveContent,
  normalizeAdjudicationExperimentContract,
  normalizeAnalysisIdentity,
  normalizeAssayProtocol,
  normalizeConditions,
  normalizeConsent,
  normalizeContextualReuseReview,
  normalizeCrossRoomReuseContext,
  normalizeDiscoveryCheckpoint,
  normalizeExperimentalExecutionContext,
  normalizeHashList,
  normalizeLaboratoryCapabilityClaim,
  normalizeModelContract,
  normalizeProteinAnnotationIdentity,
  normalizePublicProteinEvidenceProfile,
  normalizeReferenceIdentity,
  normalizeResearchResolutionPolicy,
  normalizeResearchWorkOrderContract,
  normalizeTaskApprovalContract,
  normalizeTextList,
  normalizeTransformations,
  normalizeUncertainty,
  normalizeVerifiedReceiptEvidence,
  requireHash,
  requiredInteger
} from './evidence-normalization.js';
import {
  exactModelContractKey
} from './model-contract.js';
import {
  hashSequenceFloat32Values,
  validateSequenceOutputIntegrity
} from './sequence-result.js';
import {
  normalizeAdjudicationNorthStarEvidence
} from './adjudication-north-star.js';
import {
  normalizeDiscoveryCandidateAction
} from './discovery-candidate-action.js';
import {
  normalizeRealizedActionValue
} from './realized-action-value.js';
const createAuthor = async (identity, expectedRoles = []) => {
  if (!identity?.resolve || !identity?.getSigningKeyPair) throw new TypeError('signing identity is required');
  const [resolved, keyPair] = await Promise.all([identity.resolve(), identity.getSigningKeyPair()]);
  if (expectedRoles.length > 0 && !expectedRoles.includes(resolved.kind)) {
    throw new TypeError(`identity role must be one of: ${expectedRoles.join(', ')}`);
  }
  return {
    author: {
      role: resolved.kind,
      roleId: resolved.roleId,
      userId: resolved.userId,
      deviceId: resolved.deviceId,
      identityRootId: resolved.identityRootId,
      publicKey: await exportPublicKey(keyPair.publicKey)
    },
    privateKey: keyPair.privateKey
  };
};

const signRecord = async (payload, privateKey, domain) => {
  const recordHash = await hashJson(payload);
  const record = { ...payload, recordHash };
  return deepFreeze({
    ...record,
    signature: await signCanonical(record, privateKey, { domain })
  });
};

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
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher']);
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.submission,
    signatureDomain: SIGNATURE_DOMAINS.researchSubmission,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
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
  if (!payload.policyId) throw new TypeError('policyId is required');
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchSubmission);
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
  return {
    ...evidence,
    evidenceHash: await hashJson(evidence)
  };
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
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher']);
  if (submission?.kind !== RESEARCH_RECORD_KINDS.submission || !SHA256_PATTERN.test(String(submission.recordHash || ''))) {
    throw new TypeError('signed research submission is required');
  }
  const receipt = receiptRecord?.receipt || receiptRecord || {};
  const receiptHash = receiptRecord?.receiptHash || await hashJson(receipt);
  if (!SHA256_PATTERN.test(String(receiptHash || ''))) throw new TypeError('accepted receipt hash is required');
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
  const agreementStatus = compactText(agreement?.status, 64).toLowerCase();
  if (['accepted', 'agreed'].includes(agreementStatus) && agreementReceiptHashes.length < 2) {
    throw new TypeError('accepted compute agreement requires at least two distinct receipt identities');
  }
  const declaredProviderIds = agreement?.providerIds ?? agreement?.acceptedProviderIds ?? null;
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
  if (['accepted', 'agreed'].includes(agreementStatus)
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
    && ['accepted', 'agreed'].includes(agreementStatus)
    && verifiedReceiptEvidence.length >= 2;
  if (!acceptedByVerifier && !acceptedByPeerAgreement) {
    throw new TypeError('an accepted verifier decision or verified peer agreement is required for a research result');
  }
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.result,
    signatureDomain: SIGNATURE_DOMAINS.researchResult,
    roomId: normalizeRoomId(roomId || submission.roomId),
    createdAt,
    author,
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
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchResult);
}

export async function createSignedHumanClaim({
  identity,
  roomId,
  targetHash,
  claimKind,
  relation,
  text,
  confidence,
  evidenceLinks = [],
  decision = null,
  contextAssessment = null,
  taskId = null,
  taskContract = null,
  actionContractHash = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['reviewer', 'verifier', 'researcher']);
  const kind = compactText(claimKind, 40).toLowerCase();
  const edge = compactText(relation, 40).toLowerCase();
  if (!HUMAN_CLAIM_KINDS.includes(kind)) throw new TypeError('human claim kind is not supported');
  if (!EVIDENCE_RELATIONS.includes(edge)) throw new TypeError('evidence relation is not supported');
  if (!SHA256_PATTERN.test(String(targetHash || ''))) throw new TypeError('targetHash must be a SHA-256 record identity');
  const normalizedText = compactText(text);
  if (!normalizedText) throw new TypeError('human claim text is required');
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    throw new TypeError('confidence must be between 0 and 1');
  }
  const links = evidenceLinks.map((link) => {
    const url = new URL(typeof link === 'string' ? link : link.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('evidence links must use http or https');
    return { url: url.href, label: compactText(link.label, 240) };
  }).slice(0, 24);
  const normalizedDecision = decision ? compactText(decision, 32).toLowerCase() : null;
  if (kind === 'review_decision' && !RESEARCH_REVIEW_DECISIONS.includes(normalizedDecision)) {
    throw new TypeError(`review decision must be one of: ${RESEARCH_REVIEW_DECISIONS.join(', ')}`);
  }
  if (kind === 'task_approval' && normalizedDecision !== 'approved') {
    throw new TypeError('task approval decision must be approved');
  }
  if (kind === 'candidate_action_approval'
    && (normalizedDecision !== 'approved' || edge !== 'approves')) {
    throw new TypeError('candidate action approval must approve the proposed action');
  }
  if (contextAssessment && kind !== 'review_decision') {
    throw new TypeError('contextual reuse assessment is valid only for review decisions');
  }
  const normalizedContextAssessment = contextAssessment
    ? await normalizeContextualReuseReview(contextAssessment)
    : null;
  const normalizedTaskId = compactText(taskId, 240) || null;
  const normalizedTaskContract = kind === 'task_approval'
    ? normalizeTaskApprovalContract(taskContract, normalizedTaskId, targetHash)
    : null;
  const normalizedActionContractHash = kind === 'candidate_action_approval'
    ? requireHash(actionContractHash, 'candidate action contract hash')
    : null;
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.claim,
    signatureDomain: SIGNATURE_DOMAINS.humanClaim,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    targetHash,
    claim: {
      kind,
      relation: edge,
      text: normalizedText,
      confidence: normalizedConfidence,
      evidenceLinks: links,
      decision: normalizedDecision,
      ...(normalizedContextAssessment ? { contextAssessment: normalizedContextAssessment } : {}),
      taskId: normalizedTaskId,
      taskContract: normalizedTaskContract,
      actionContractHash: normalizedActionContractHash
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.humanClaim);
}

export async function createSignedResearchHypothesis({
  identity,
  roomId,
  questionHash,
  statement,
  rationale = '',
  conditions = {},
  discriminatingObservations = [],
  priorEvidenceHashes = [],
  alternativeToHashes = [],
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher', 'reviewer', 'agent']);
  const normalizedStatement = compactText(statement);
  if (!normalizedStatement) throw new TypeError('hypothesis statement is required');
  const normalizedConditions = normalizeConditions(conditions);
  if (!conditionsHaveContent(normalizedConditions)) throw new TypeError('hypothesis conditions are required');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.hypothesis,
    signatureDomain: SIGNATURE_DOMAINS.researchHypothesis,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesis: {
      statement: normalizedStatement,
      rationale: compactText(rationale),
      conditions: normalizedConditions,
      discriminatingObservations: normalizeTextList(discriminatingObservations, {
        min: 1,
        max: 32,
        itemMax: 1000,
        label: 'discriminating observations'
      }),
      priorEvidenceHashes: normalizeHashList(priorEvidenceHashes, 'prior evidence', { max: 128 }),
      alternativeToHashes: normalizeHashList(alternativeToHashes, 'alternative hypotheses', { max: 64 })
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchHypothesis);
}

const createSignedPriorEvidenceRecord = async ({
  identity,
  roomId,
  questionHash,
  evidenceKind,
  summary,
  reference,
  annotation = null,
  reuseContext = null,
  conditions = {},
  transformations = [],
  uncertainty = {},
  provenance = {},
  finding = {},
  createdAt = new Date().toISOString()
} = {}, { publicProteinEvidence = false } = {}) => {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'verifier', 'agent']);
  const category = compactText(evidenceKind, 40).toLowerCase();
  if (!PRIOR_EVIDENCE_KINDS.includes(category)) throw new TypeError('prior evidence kind is not supported');
  if (['assay', 'negative_result', 'failed_attempt'].includes(category) && !publicProteinEvidence) {
    throw new TypeError('assay, negative-result, and failed-attempt imports require the public protein evidence contract');
  }
  const normalizedSummary = compactText(summary);
  if (!normalizedSummary) throw new TypeError('prior evidence summary is required');
  const retrievalMethod = compactText(provenance.retrievalMethod || provenance.method, 500);
  const retrievedAt = compactText(provenance.retrievedAt, 64) || createdAt;
  if (!retrievalMethod || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new TypeError('prior evidence retrieval method and timestamp are required');
  }
  const normalizedReference = normalizeReferenceIdentity(reference);
  const normalizedAnnotation = annotation ? await normalizeProteinAnnotationIdentity(annotation) : null;
  const normalizedReuseContext = reuseContext ? await normalizeCrossRoomReuseContext(reuseContext) : null;
  const normalizedConditions = normalizeConditions(conditions);
  const normalizedTransformations = normalizeTransformations(transformations);
  const normalizedProvenance = {
    retrievedAt,
    retrievalMethod,
    retrievedBy: compactText(provenance.retrievedBy, 500) || author.roleId,
    sourceIdentity: compactText(provenance.sourceIdentity, 500),
    license: compactText(provenance.license, 240)
  };
  const publicProfile = publicProteinEvidence
    ? normalizePublicProteinEvidenceProfile({
      evidenceKind: category,
      conditions: normalizedConditions,
      transformations: normalizedTransformations,
      provenance: normalizedProvenance,
      finding
    })
    : null;
  if (publicProteinEvidence && ['annotation', 'domain'].includes(category) && !normalizedAnnotation) {
    throw new TypeError('public annotation and domain evidence requires a normalized annotation identity');
  }
  if (category === 'domain' && normalizedAnnotation?.scope !== 'domain') {
    throw new TypeError('domain evidence requires a domain annotation scope');
  }
  if (normalizedReuseContext && normalizedReference.contentHash !== normalizedReuseContext.originRecordHash) {
    throw new TypeError('cross-room reuse reference must bind the exact origin record hash');
  }
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.priorEvidence,
    signatureDomain: SIGNATURE_DOMAINS.researchPriorEvidence,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    evidence: {
      ...(publicProfile || {}),
      kind: category,
      summary: normalizedSummary,
      reference: normalizedReference,
      ...(normalizedAnnotation ? { annotation: normalizedAnnotation } : {}),
      ...(normalizedReuseContext ? { reuseContext: normalizedReuseContext } : {}),
      conditions: normalizedConditions,
      transformations: normalizedTransformations,
      uncertainty: normalizeUncertainty(uncertainty),
      provenance: normalizedProvenance
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchPriorEvidence);
};

export async function createSignedPriorEvidence(options = {}) {
  return createSignedPriorEvidenceRecord(options);
}

export async function createSignedPublicProteinEvidence(options = {}) {
  return createSignedPriorEvidenceRecord(options, { publicProteinEvidence: true });
}

export async function createSignedResearchPrediction({
  identity,
  roomId,
  questionHash,
  hypothesisHash,
  method,
  expectedObservation,
  normalizedLabel,
  conditions = {},
  confidence,
  outcomeAccess = 'blinded',
  receiptHashes = [],
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'requester', 'verifier', 'agent']);
  const normalizedObservation = compactText(expectedObservation);
  const label = compactText(normalizedLabel, 240).toLowerCase();
  if (!normalizedObservation || !label) throw new TypeError('predicted observation and normalized label are required');
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    throw new TypeError('prediction confidence must be between 0 and 1');
  }
  if (!['blinded', 'not_available'].includes(outcomeAccess)) throw new TypeError('prediction outcome access must be blinded or not_available');
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('prediction frozenAt must be an ISO timestamp');
  const analysis = await normalizeAnalysisIdentity(method);
  const linkedReceipts = normalizeHashList(receiptHashes, 'prediction receipt', { max: 64 });
  if (!analysis.artifactHash && linkedReceipts.length === 0) {
    throw new TypeError('prediction requires an exact method artifact hash or receipt hash');
  }
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.prediction,
    signatureDomain: SIGNATURE_DOMAINS.researchPrediction,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesisHash: requireHash(hypothesisHash, 'hypothesisHash'),
    prediction: {
      method: analysis,
      expectedObservation: normalizedObservation,
      normalizedLabel: label,
      conditions: normalizeConditions(conditions),
      confidence: normalizedConfidence,
      outcomeAccess,
      receiptHashes: linkedReceipts,
      frozenAt
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchPrediction);
}

export async function createSignedResearchResolutionPolicy({
  identity,
  roomId,
  questionHash,
  targetHypothesisHash,
  conclusionLabel,
  decisionScope,
  provisionalAcceptance,
  continuedUncertainty,
  rejection,
  reopening,
  closure,
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'requester']);
  const policy = await normalizeResearchResolutionPolicy({
    targetHypothesisHash,
    conclusionLabel,
    decisionScope,
    provisionalAcceptance,
    continuedUncertainty,
    rejection,
    reopening,
    closure,
    frozenAt
  });
  if (createdAt !== frozenAt) throw new TypeError('resolution policy creation must equal its freeze timestamp');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.resolutionPolicy,
    signatureDomain: SIGNATURE_DOMAINS.researchResolutionPolicy,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    policy
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchResolutionPolicy);
}

export async function createSignedResearchWorkOrder({
  identity,
  roomId,
  questionHash,
  hypothesisHashes,
  workKind = 'experimental_assay',
  title,
  protocol,
  replicaTarget = 1,
  blindness = {},
  feasibility = {},
  analysis,
  failureCategories,
  custody,
  publication,
  replication,
  scopeBoundary,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'requester', 'agent']);
  const work = await normalizeResearchWorkOrderContract({
    workKind,
    title,
    protocol,
    replicaTarget,
    blindness,
    feasibility,
    analysis,
    failureCategories,
    custody,
    publication,
    replication,
    scopeBoundary
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.workOrder,
    signatureDomain: SIGNATURE_DOMAINS.researchWorkOrder,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesisHashes: normalizeHashList(hypothesisHashes, 'work order hypotheses', { min: 1, max: 32 }),
    work
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchWorkOrder);
}

export async function createSignedResearchWorkClaim({
  identity,
  roomId,
  workOrderHash,
  laboratory,
  capabilityClaims = [],
  protocolCustody,
  safety,
  availability,
  consent = {},
  conflictDisclosure = '',
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'verifier']);
  const workClaim = await normalizeLaboratoryCapabilityClaim({
    laboratory,
    capabilityClaims,
    protocolCustody,
    safety,
    availability,
    consent,
    conflictDisclosure,
    createdAt
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.workClaim,
    signatureDomain: SIGNATURE_DOMAINS.researchWorkClaim,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    workOrderHash: requireHash(workOrderHash, 'workOrderHash'),
    workClaim
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchWorkClaim);
}

export async function createSignedExperimentalOutcome({
  identity,
  roomId,
  questionHash,
  workOrderHash,
  workClaimHash,
  hypothesisHashes,
  classification,
  summary,
  attempt = {},
  observations = [],
  protocol,
  analysis,
  executionContext,
  uncertainty = {},
  blind = {},
  replicationOfHash = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'verifier']);
  const normalizedClass = compactText(classification, 40).toLowerCase();
  if (!RESEARCH_OUTCOME_CLASSES.includes(normalizedClass)) throw new TypeError('outcome must be positive, negative, or ambiguous');
  const normalizedSummary = compactText(summary);
  if (!normalizedSummary) throw new TypeError('outcome summary is required');
  const attemptStatus = compactText(attempt.status, 40).toLowerCase();
  const failureCategory = compactText(attempt.failureCategory || 'none', 80).toLowerCase();
  if (!RESEARCH_ATTEMPT_STATUSES.includes(attemptStatus)) throw new TypeError('attempt status must be completed or failed');
  if (!RESEARCH_FAILURE_CATEGORIES.includes(failureCategory)) throw new TypeError('attempt failure category is not supported');
  if (attemptStatus === 'failed' && failureCategory === 'none') throw new TypeError('failed attempts require a failure category');
  if (attemptStatus === 'completed' && failureCategory !== 'none') throw new TypeError('completed attempts must use the none failure category');
  const blindState = compactText(blind.state, 40).toLowerCase();
  const codeHash = compactText(blind.codeHash, 160);
  const allocationHash = compactText(blind.allocationHash, 160);
  if (!['sealed', 'revealed'].includes(blindState) || !SHA256_PATTERN.test(codeHash) || !SHA256_PATTERN.test(allocationHash)) {
    throw new TypeError('outcome requires sealed or revealed blinding with codeHash and allocationHash');
  }
  const revealedAt = compactText(blind.revealedAt, 64) || null;
  if (blindState === 'sealed' && revealedAt) throw new TypeError('sealed outcomes cannot include revealedAt');
  if (blindState === 'revealed' && !Number.isFinite(Date.parse(revealedAt))) throw new TypeError('revealed outcomes require revealedAt');
  const normalizedObservations = (Array.isArray(observations) ? observations : []).slice(0, 128).map((entry, index) => {
    const readout = compactText(entry.readout, 500);
    if (!readout) throw new TypeError(`observation ${index + 1} requires a readout`);
    const value = Number(entry.value);
    const normalizedValue = Number(entry.normalizedValue);
    if (!Number.isFinite(value) || !Number.isFinite(normalizedValue)) {
      throw new TypeError(`observation ${index + 1} requires numeric raw and normalized values`);
    }
    return {
      readout,
      value,
      unit: compactText(entry.unit, 120),
      normalizedValue,
      normalizedUnit: compactText(entry.normalizedUnit || entry.unit, 120),
      uncertainty: normalizeUncertainty(entry.uncertainty)
    };
  });
  if (normalizedObservations.length === 0) throw new TypeError('at least one experimental observation is required');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.outcome,
    signatureDomain: SIGNATURE_DOMAINS.researchOutcome,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: requireHash(questionHash, 'questionHash'),
    workOrderHash: requireHash(workOrderHash, 'workOrderHash'),
    workClaimHash: requireHash(workClaimHash, 'workClaimHash'),
    hypothesisHashes: normalizeHashList(hypothesisHashes, 'outcome hypotheses', { min: 1, max: 32 }),
    replicationOfHash: replicationOfHash ? requireHash(replicationOfHash, 'replicationOfHash') : null,
    outcome: {
      classification: normalizedClass,
      summary: normalizedSummary,
      attempt: {
        status: attemptStatus,
        failureCategory,
        failureDetail: compactText(attempt.failureDetail, 2000),
        startedAt: compactText(attempt.startedAt, 64),
        completedAt: compactText(attempt.completedAt, 64) || createdAt
      },
      observations: normalizedObservations,
      protocol: await normalizeAssayProtocol(protocol),
      analysis: await normalizeAnalysisIdentity(analysis),
      executionContext: normalizeExperimentalExecutionContext(executionContext),
      uncertainty: normalizeUncertainty(uncertainty),
      blind: { state: blindState, codeHash, allocationHash, revealedAt }
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchOutcome);
}

export async function createSignedEvaluationCohort({
  identity,
  roomId,
  label,
  questionHashes,
  predictionHashes,
  workOrderHashes,
  metrics,
  frozenAt = new Date().toISOString(),
  blindingRequired = true,
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['verifier', 'researcher', 'reviewer']);
  const normalizedLabel = compactText(label, 500);
  if (!normalizedLabel) throw new TypeError('cohort label is required');
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('cohort frozenAt must be an ISO timestamp');
  const normalizedMetrics = (Array.isArray(metrics) ? metrics : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const normalized = {
      id: compactText(metric.id, 120),
      label: compactText(metric.label, 500),
      direction,
      unit: compactText(metric.unit, 120)
    };
    if (!normalized.id || !normalized.label || !['higher_is_better', 'lower_is_better'].includes(direction)) {
      throw new TypeError(`cohort metric ${index + 1} requires id, label, and direction`);
    }
    return normalized;
  });
  if (normalizedMetrics.length === 0) throw new TypeError('cohort requires at least one metric');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.cohort,
    signatureDomain: SIGNATURE_DOMAINS.researchCohort,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    cohort: {
      label: normalizedLabel,
      questionHashes: normalizeHashList(questionHashes, 'cohort questions', { min: 1, max: 128 }),
      predictionHashes: normalizeHashList(predictionHashes, 'cohort predictions', { min: 1, max: 512 }),
      workOrderHashes: normalizeHashList(workOrderHashes, 'cohort work orders', { min: 1, max: 256 }),
      metrics: normalizedMetrics,
      frozenAt,
      blindingRequired: blindingRequired !== false,
      state: 'frozen'
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchCohort);
}

export async function createSignedCohortEvaluation({
  identity,
  roomId,
  cohortHash,
  outcomeHashes,
  metricResults,
  disagreementSummary,
  failureAnalysis,
  nextCohortQuestionHashes = [],
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['verifier', 'reviewer']);
  const normalizedMetrics = (Array.isArray(metricResults) ? metricResults : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const baselineValue = Number(metric.baselineValue);
    const currentValue = Number(metric.currentValue);
    if (!compactText(metric.metricId, 120) || !['higher_is_better', 'lower_is_better'].includes(direction)
      || !Number.isFinite(baselineValue) || !Number.isFinite(currentValue)) {
      throw new TypeError(`evaluation metric ${index + 1} is invalid`);
    }
    const absoluteDelta = currentValue - baselineValue;
    return {
      metricId: compactText(metric.metricId, 120),
      direction,
      baselineValue,
      currentValue,
      absoluteDelta,
      relativeDelta: baselineValue === 0 ? null : absoluteDelta / Math.abs(baselineValue),
      improved: direction === 'higher_is_better' ? currentValue > baselineValue : currentValue < baselineValue
    };
  });
  if (normalizedMetrics.length === 0) throw new TypeError('evaluation requires at least one measured metric');
  const disagreement = compactText(disagreementSummary, 4000);
  const failures = compactText(failureAnalysis, 4000);
  if (!disagreement || !failures) throw new TypeError('evaluation requires disagreement summary and failure analysis');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.evaluation,
    signatureDomain: SIGNATURE_DOMAINS.researchEvaluation,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    cohortHash: requireHash(cohortHash, 'cohortHash'),
    evaluation: {
      outcomeHashes: normalizeHashList(outcomeHashes, 'evaluation outcomes', { min: 1, max: 512 }),
      metricResults: normalizedMetrics,
      disagreementSummary: disagreement,
      failureAnalysis: failures,
      nextCohortQuestionHashes: normalizeHashList(nextCohortQuestionHashes, 'next cohort questions', { max: 128 }),
      acceptedOutcomePolicy: 'independent_review_required'
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchEvaluation);
}

export async function createSignedRealizedActionValue({
  identity,
  roomId,
  questionHash,
  candidateActionHash,
  actionContractHash,
  candidateActionApprovalHashes,
  evaluationHash,
  evaluationReviewDecisionHashes,
  reviewedOutcomes,
  contributions,
  metricResults,
  decisionEffect,
  summary,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['verifier', 'reviewer']);
  const realizedValue = await normalizeRealizedActionValue({
    questionHash,
    candidateActionHash,
    actionContractHash,
    candidateActionApprovalHashes,
    evaluationHash,
    evaluationReviewDecisionHashes,
    reviewedOutcomes,
    contributions,
    metricResults,
    decisionEffect,
    summary
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.realizedActionValue,
    signatureDomain: SIGNATURE_DOMAINS.researchRealizedActionValue,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: realizedValue.questionHash,
    realizedValue
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchRealizedActionValue);
}

export async function createSignedAdjudicationExperiment({
  identity,
  roomId,
  target,
  baseline,
  candidate,
  cohort,
  outcomeBoundary,
  comparison,
  evaluator,
  metrics,
  measurementPlan,
  northStarPolicy,
  successPolicy,
  resolution,
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'verifier']);
  if (createdAt !== frozenAt) {
    throw new TypeError('adjudication experiment record creation and policy freeze timestamps must match');
  }
  const experiment = await normalizeAdjudicationExperimentContract({
    schema: ADJUDICATION_EXPERIMENT_VERSION,
    target,
    baseline,
    candidate,
    cohort,
    outcomeBoundary,
    comparison,
    evaluator,
    metrics,
    measurementPlan,
    northStarPolicy,
    successPolicy,
    resolution,
    frozenAt
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.adjudicationExperiment,
    signatureDomain: SIGNATURE_DOMAINS.researchAdjudicationExperiment,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    experiment
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchAdjudicationExperiment);
}

export async function createSignedAdjudicationEvaluation({
  identity,
  roomId,
  experiment,
  resultManifest,
  metricResults,
  northStarEvidence,
  regressionCount = 0,
  missingCaseCount = 0,
  disagreementSummary,
  failureAnalysis,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['verifier', 'reviewer']);
  if (experiment?.kind !== RESEARCH_RECORD_KINDS.adjudicationExperiment
    || !SHA256_PATTERN.test(String(experiment.recordHash || ''))) {
    throw new TypeError('adjudication evaluation requires a signed experiment contract');
  }
  if (experiment.experiment?.schema !== ADJUDICATION_EXPERIMENT_VERSION) {
    throw new TypeError('adjudication evaluation requires the current baseline-policy freeze contract');
  }
  if (author.identityRootId !== experiment.experiment?.evaluator?.identityRootId) {
    throw new TypeError('adjudication evaluation signer does not match the frozen evaluator identity root');
  }
  if (Date.parse(createdAt) < Date.parse(experiment.experiment?.frozenAt || '')) {
    throw new TypeError('adjudication evaluation cannot predate its frozen experiment');
  }
  const definitions = new Map(experiment.experiment?.metrics?.map((metric) => [metric.id, metric]) || []);
  const provided = (Array.isArray(metricResults) ? metricResults : []).slice(0, 32);
  if (!sameStringSet(provided.map((metric) => metric.metricId), [...definitions.keys()])) {
    throw new TypeError('adjudication evaluation must report every frozen metric exactly once');
  }
  const normalizedMetrics = provided.map((result, index) => {
    const definition = definitions.get(compactText(result.metricId, 120));
    if (!definition) throw new TypeError(`adjudication metric result ${index + 1} is outside the frozen contract`);
    return adjudicationMetricResult(definition, result, index);
  });
  if (new Set(normalizedMetrics.map((metric) => metric.pairedSampleCount)).size !== 1) {
    throw new TypeError('adjudication metrics must use the same paired sample count');
  }
  const normalizedManifest = normalizeReferenceIdentity(resultManifest, 'adjudication result manifest');
  if (!normalizedManifest.contentHash) throw new TypeError('adjudication result manifest requires a content hash');
  if (experiment.experiment?.outcomeBoundary?.mode === 'historical_hidden'
    && normalizedManifest.contentHash !== experiment.experiment.outcomeBoundary.outcomeManifestCommitmentHash) {
    throw new TypeError('historical adjudication result manifest does not match the frozen outcome commitment');
  }
  const regressions = requiredInteger(regressionCount, 'adjudication regression count');
  const missingCases = requiredInteger(missingCaseCount, 'adjudication missing case count');
  if (regressions < 0 || missingCases < 0) throw new TypeError('adjudication regression and missing case counts cannot be negative');
  const pairedSampleCount = normalizedMetrics[0].pairedSampleCount;
  if (pairedSampleCount + missingCases !== experiment.experiment.cohort.caseCount) {
    throw new TypeError('adjudication paired and missing case counts must account for the frozen cohort');
  }
  if (regressions > pairedSampleCount) throw new TypeError('adjudication regressions cannot exceed paired cases');
  const disagreement = compactText(disagreementSummary, 4000);
  const failures = compactText(failureAnalysis, 4000);
  if (!disagreement || !failures) throw new TypeError('adjudication evaluation requires disagreement and failure analysis');
  const normalizedNorthStarEvidence = await normalizeAdjudicationNorthStarEvidence(northStarEvidence, {
    policy: experiment.experiment.northStarPolicy,
    pairedSampleCount,
    cohortCaseCount: experiment.experiment.cohort.caseCount,
    missingCaseCount: missingCases
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.adjudicationEvaluation,
    signatureDomain: SIGNATURE_DOMAINS.researchAdjudicationEvaluation,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    experimentHash: experiment.recordHash,
    evaluation: {
      schema: ADJUDICATION_EVALUATION_VERSION,
      resultManifest: normalizedManifest,
      metricResults: normalizedMetrics,
      northStarEvidence: normalizedNorthStarEvidence,
      assessment: assessAdjudicationExperiment(
        experiment.experiment,
        normalizedMetrics,
        normalizedNorthStarEvidence
      ),
      regressionCount: regressions,
      missingCaseCount: missingCases,
      disagreementSummary: disagreement,
      failureAnalysis: failures,
      evaluator: clone(experiment.experiment.evaluator)
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchAdjudicationEvaluation);
}

export async function createSignedCandidateAction({
  identity,
  roomId,
  questionHash,
  action,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher', 'reviewer', 'agent']);
  const normalizedAction = await normalizeDiscoveryCandidateAction({
    ...(action || {}),
    questionHash
  });
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.candidateAction,
    signatureDomain: SIGNATURE_DOMAINS.researchCandidateAction,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    questionHash: normalizedAction.questionHash,
    action: normalizedAction
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchCandidateAction);
}

export async function createSignedDiscoveryCheckpoint({
  identity,
  roomId,
  checkpoint,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'verifier']);
  const normalizedRoomId = normalizeRoomId(roomId);
  const normalizedCheckpoint = await normalizeDiscoveryCheckpoint(checkpoint, normalizedRoomId);
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.discoveryCheckpoint,
    signatureDomain: SIGNATURE_DOMAINS.researchDiscoveryCheckpoint,
    roomId: normalizedRoomId,
    createdAt,
    author,
    checkpoint: normalizedCheckpoint
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchDiscoveryCheckpoint);
}

export async function createSignedSequenceEvidenceLink({
  identity,
  roomId,
  nucleotideSubmissionHash,
  proteinSubmissionHash,
  reference,
  coordinates,
  transcript,
  translation,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['researcher', 'reviewer', 'verifier']);
  const coordinateSystem = compactText(coordinates?.coordinateSystem, 80).toLowerCase();
  const strand = compactText(coordinates?.strand, 20).toLowerCase();
  const start = Number(coordinates?.start);
  const end = Number(coordinates?.end);
  if (!['zero_based_half_open', 'one_based_closed'].includes(coordinateSystem)) {
    throw new TypeError('DNA-to-protein linkage requires an explicit coordinate system');
  }
  if (!['forward', 'reverse'].includes(strand)) {
    throw new TypeError('DNA-to-protein linkage strand must be forward or reverse');
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    throw new TypeError('DNA-to-protein linkage coordinates are invalid');
  }
  const readingFrame = Number(translation?.readingFrame);
  if (![0, 1, 2].includes(readingFrame)) throw new TypeError('translation reading frame must be 0, 1, or 2');
  const normalizedReference = {
    assemblyAccession: compactText(reference?.assemblyAccession, 240),
    assemblyVersion: compactText(reference?.assemblyVersion, 120),
    assemblyHash: requireHash(reference?.assemblyHash, 'assemblyHash'),
    sequenceAccession: compactText(reference?.sequenceAccession, 240),
    sequenceVersion: compactText(reference?.sequenceVersion, 120),
    referenceHash: requireHash(reference?.referenceHash, 'referenceHash')
  };
  if (!normalizedReference.assemblyAccession || !normalizedReference.assemblyVersion
    || !normalizedReference.sequenceAccession || !normalizedReference.sequenceVersion) {
    throw new TypeError('assembly and reference accession versions are required');
  }
  const normalizedTranscript = {
    accession: compactText(transcript?.accession, 240),
    version: compactText(transcript?.version, 120),
    transcriptHash: requireHash(transcript?.transcriptHash, 'transcriptHash')
  };
  if (!normalizedTranscript.accession || !normalizedTranscript.version) {
    throw new TypeError('transcript accession and version are required');
  }
  const normalizedTranslation = {
    readingFrame,
    geneticCode: compactText(translation?.geneticCode, 120),
    methodId: compactText(translation?.methodId, 240),
    methodVersion: compactText(translation?.methodVersion, 120),
    nucleotideSequenceHash: requireHash(translation?.nucleotideSequenceHash, 'nucleotideSequenceHash'),
    proteinSequenceHash: requireHash(translation?.proteinSequenceHash, 'proteinSequenceHash'),
    translationHash: requireHash(translation?.translationHash, 'translationHash')
  };
  if (!normalizedTranslation.geneticCode || !normalizedTranslation.methodId || !normalizedTranslation.methodVersion) {
    throw new TypeError('translation genetic code, method id, and method version are required');
  }
  const link = {
    nucleotideSubmissionHash: requireHash(nucleotideSubmissionHash, 'nucleotideSubmissionHash'),
    proteinSubmissionHash: requireHash(proteinSubmissionHash, 'proteinSubmissionHash'),
    reference: normalizedReference,
    coordinates: {
      coordinateSystem,
      start,
      end,
      strand
    },
    transcript: normalizedTranscript,
    translation: normalizedTranslation
  };
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.sequenceLink,
    signatureDomain: SIGNATURE_DOMAINS.researchSequenceLink,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    link: {
      ...link,
      linkHash: await hashJson(link)
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchSequenceLink);
}

export async function createSignedResearchRevocation({
  identity,
  roomId,
  targetHash,
  reason,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, ['requester', 'researcher', 'reviewer', 'verifier']);
  const normalizedReason = compactText(reason, 2000);
  if (!normalizedReason) throw new TypeError('revocation reason is required');
  const payload = {
    version: RESEARCH_RECORD_VERSION,
    kind: RESEARCH_RECORD_KINDS.revocation,
    signatureDomain: SIGNATURE_DOMAINS.researchRevocation,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author,
    targetHash: requireHash(targetHash, 'targetHash'),
    revocation: {
      scope: 'future_use',
      reason: normalizedReason,
      effectiveAt: createdAt
    }
  };
  return signRecord(payload, privateKey, SIGNATURE_DOMAINS.researchRevocation);
}
