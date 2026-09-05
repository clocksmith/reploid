/** Cryptographic and structural record verification; verification is not review. */
import {
  ADJUDICATION_EVALUATION_VERSION,
  ADJUDICATION_EXPERIMENT_VERSION,
  BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION,
  DOMAIN_BY_KIND,
  EVIDENCE_RELATIONS,
  HUMAN_CLAIM_KINDS,
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  LEGACY_ADJUDICATION_EVALUATION_VERSION,
  LEGACY_RESEARCH_RECORD_VERSION,
  MAX_EMBEDDING_DIMENSIONS,
  PRIOR_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_ATTEMPT_STATUSES,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_OUTCOME_CLASSES,
  RESEARCH_RECORD_KINDS,
  RESEARCH_RECORD_VERSION,
  RESEARCH_REVIEW_DECISIONS,
  RESEARCH_WORK_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION,
  SHA256_PATTERN,
  compactText,
  normalizeIntent,
  projectResearchExecutionIndependence,
  withoutIdentity,
  withoutSignature
} from './evidence-record-contract.js';
import {
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
} from './adjudication-north-star.js';
import {
  MAX_SEQUENCE_POSITIONS,
  getMaxPublicSequenceLength,
  normalizeSequenceInput
} from './sequence-workload.js';
import {
  REALIZED_ACTION_VALUE_VERSION,
  normalizeRealizedActionValue
} from './realized-action-value.js';
import {
  conditionsHaveContent,
  normalizeAdjudicationExperimentContract,
  normalizeConsent,
  normalizeContextualReuseReview,
  normalizeCrossRoomReuseContext,
  normalizeDiscoveryCheckpoint,
  normalizeExperimentalExecutionContext,
  normalizeLaboratoryCapabilityClaim,
  normalizeModelContract,
  normalizeProteinAnnotationIdentity,
  normalizePublicProteinEvidenceProfile,
  normalizeReferenceIdentity,
  normalizeResearchResolutionPolicy,
  normalizeResearchWorkOrderContract,
  normalizeTaskApprovalContract,
  normalizeTransformations,
  normalizeVerifiedReceiptEvidence
} from './evidence-normalization.js';
import {
  exactModelContractKey
} from './model-contract.js';
import {
  hashJson,
  sha256Hex,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  hashSequenceFloat32Values
} from './sequence-result.js';
import {
  normalizeDiscoveryCandidateAction
} from './discovery-candidate-action.js';
const verifyProtocolEvidence = async (protocol, reasons, label = 'protocol') => {
  if (!protocol || typeof protocol !== 'object') {
    reasons.push(`${label} is required`);
    return;
  }
  const { protocolHash, ...identity } = protocol;
  if (!SHA256_PATTERN.test(String(protocolHash || ''))) reasons.push(`${label} hash is invalid`);
  else if (await hashJson(identity) !== protocolHash) reasons.push(`${label} hash mismatch`);
  if (!protocol.protocolId || !protocol.version || !protocol.assayType) reasons.push(`${label} identity is incomplete`);
  if (!conditionsHaveContent(protocol.conditions)) reasons.push(`${label} conditions are required`);
  if (!Array.isArray(protocol.controls) || protocol.controls.length === 0) reasons.push(`${label} controls are required`);
  if (!Array.isArray(protocol.readouts) || protocol.readouts.length === 0) reasons.push(`${label} readouts are required`);
  if (!protocol.normalization?.method || !protocol.normalization?.version) reasons.push(`${label} normalization identity is required`);
  if (!protocol.uncertaintyPlan || !protocol.acceptanceCriteria) reasons.push(`${label} uncertainty and acceptance criteria are required`);
};

const verifyAnalysisEvidence = async (analysis, reasons, label = 'analysis') => {
  if (!analysis || typeof analysis !== 'object') {
    reasons.push(`${label} identity is required`);
    return;
  }
  const { analysisHash, ...identity } = analysis;
  if (!SHA256_PATTERN.test(String(analysisHash || ''))) reasons.push(`${label} hash is invalid`);
  else if (await hashJson(identity) !== analysisHash) reasons.push(`${label} hash mismatch`);
  if (!analysis.methodId || !analysis.version) reasons.push(`${label} method id and version are required`);
  if (analysis.artifactHash && !SHA256_PATTERN.test(analysis.artifactHash)) reasons.push(`${label} artifact hash is invalid`);
  if (analysis.parametersHash && !SHA256_PATTERN.test(analysis.parametersHash)) reasons.push(`${label} parameters hash is invalid`);
  if (!Array.isArray(analysis.lineageHashes) || analysis.lineageHashes.some((hash) => !SHA256_PATTERN.test(hash))) {
    reasons.push(`${label} lineage hashes are invalid`);
  }
};

const verifyPublishedSequenceEvidence = async (evidence, record, reasons) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    reasons.push('published sequence evidence is invalid');
    return;
  }
  if (evidence.schema !== 'poolday.model_sequence_evidence/v1') {
    reasons.push('published sequence evidence schema is invalid');
  }
  const { evidenceHash, ...identity } = evidence;
  if (!SHA256_PATTERN.test(String(evidenceHash || ''))) reasons.push('sequence evidence hash is invalid');
  else if (await hashJson(identity) !== evidenceHash) reasons.push('sequence evidence hash mismatch');
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
      } else if (!SHA256_PATTERN.test(String(entry.vectorHash || ''))
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

export async function verifyResearchRecord(record = {}) {
  const reasons = [];
  const legacyRecord = record.version === LEGACY_RESEARCH_RECORD_VERSION;
  const domain = DOMAIN_BY_KIND[record.kind];
  if (![RESEARCH_RECORD_VERSION, LEGACY_RESEARCH_RECORD_VERSION].includes(record.version)) {
    reasons.push('research record version mismatch');
  }
  if (legacyRecord && [
    RESEARCH_RECORD_KINDS.adjudicationExperiment,
    RESEARCH_RECORD_KINDS.adjudicationEvaluation,
    RESEARCH_RECORD_KINDS.discoveryCheckpoint,
    RESEARCH_RECORD_KINDS.resolutionPolicy,
    RESEARCH_RECORD_KINDS.realizedActionValue
  ].includes(record.kind)) reasons.push('governed proof records require research evidence v2');
  if (!domain) reasons.push('research record kind is not supported');
  if (domain && record.signatureDomain !== domain) reasons.push('research signature domain mismatch');
  if (!record.author?.roleId || !record.author?.publicKey) reasons.push('attributable author is required');
  if (!SHA256_PATTERN.test(String(record.recordHash || ''))) reasons.push('recordHash must be a SHA-256 identity');
  if (record.recordHash && await hashJson(withoutIdentity(record)) !== record.recordHash) reasons.push('record hash mismatch');
  if (!record.signature) reasons.push('record signature is required');
  if (domain && record.signature && record.author?.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        withoutSignature(record),
        record.author.publicKey,
        record.signature,
        { domain }
      );
      if (!ok) reasons.push('record signature invalid');
    } catch (error) {
      reasons.push(`record signature verification failed: ${error.message}`);
    }
  }
  if (!record.roomId) reasons.push('roomId is required');
  if (!record.createdAt || !Number.isFinite(Date.parse(record.createdAt))) reasons.push('createdAt must be an ISO timestamp');
  if (record.kind === RESEARCH_RECORD_KINDS.submission) {
    if (!['requester', 'researcher'].includes(record.author?.role)) reasons.push('submission author role is invalid');
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
  }
  if (record.kind === RESEARCH_RECORD_KINDS.result) {
    if (!['requester', 'researcher'].includes(record.author?.role)) reasons.push('result author role is invalid');
    if (!SHA256_PATTERN.test(String(record.submissionHash || ''))) reasons.push('result submissionHash is invalid');
    if (!SHA256_PATTERN.test(String(record.sequenceHash || ''))) reasons.push('result sequenceHash is invalid');
    if (!Number.isInteger(record.sequenceLength) || record.sequenceLength <= 0) reasons.push('result sequenceLength is invalid');
    if (!SHA256_PATTERN.test(String(record.compute?.receiptHash || ''))) reasons.push('result receiptHash is invalid');
    if (!compactText(record.compute?.providerId, 240)) reasons.push('result providerId is required');
    if (legacyRecord) {
      if (record.compute?.verifierDecision?.accepted !== true) reasons.push('legacy result requires an explicitly accepted verifier decision');
    } else if (record.compute?.receiptAdmission?.accepted !== true) {
      reasons.push('result requires an accepted receipt admission decision');
    }
    if (!Array.isArray(record.compute?.receiptHashes) || record.compute.receiptHashes.some((hash) => !SHA256_PATTERN.test(String(hash || '')))) {
      reasons.push('result receiptHashes are invalid');
    } else if (!record.compute.receiptHashes.includes(record.compute.receiptHash)) {
      reasons.push('result receiptHashes must include the primary receiptHash');
    } else if (!legacyRecord
      && ['accepted', 'agreed'].includes(compactText(record.compute?.agreement?.status, 64).toLowerCase())
      && projectResearchExecutionIndependence(record).independentReceiptCount < 2) {
      reasons.push('accepted compute agreement requires at least two distinct receipt identities');
    }
    const declaredAgreementProviders = record.compute?.agreement?.providerIds
      ?? record.compute?.agreement?.acceptedProviderIds
      ?? null;
    if (!legacyRecord && declaredAgreementProviders != null && !Array.isArray(declaredAgreementProviders)) {
      reasons.push('accepted compute agreement provider identities must be an array');
    } else if (Array.isArray(declaredAgreementProviders)
      && declaredAgreementProviders.some((providerId) => typeof providerId !== 'string' || !providerId.trim())) {
      reasons.push('accepted compute agreement provider identities must be non-empty strings');
    }
    if (!legacyRecord
      && ['accepted', 'agreed'].includes(compactText(record.compute?.agreement?.status, 64).toLowerCase())
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
      if (!SHA256_PATTERN.test(String(record.embedding.vectorHash || ''))) reasons.push('embedding vectorHash is invalid');
      else if (Array.isArray(values) && await hashSequenceFloat32Values(values) !== record.embedding.vectorHash) {
        reasons.push('published embedding vectorHash does not match its float32 values');
      }
      if (record.compute?.vectorHash && record.compute.vectorHash !== record.embedding.vectorHash) {
        reasons.push('published embedding vectorHash does not match the receipt vector commitment');
      }
      if (record.modelContract?.dimensions && record.modelContract.dimensions !== record.embedding.dimensions) reasons.push('embedding dimensions do not match the exact model contract');
    }
    if (record.sequenceEvidence) await verifyPublishedSequenceEvidence(record.sequenceEvidence, record, reasons);
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim) {
    if (!['reviewer', 'verifier', 'researcher'].includes(record.author?.role)) reasons.push('human claim author role is invalid');
    if (!SHA256_PATTERN.test(String(record.targetHash || ''))) reasons.push('claim targetHash is invalid');
    if (!HUMAN_CLAIM_KINDS.includes(record.claim?.kind)) reasons.push('human claim kind is invalid');
    if (!EVIDENCE_RELATIONS.includes(record.claim?.relation)) reasons.push('human claim relation is invalid');
    if (!record.claim?.text) reasons.push('human claim text is required');
    if (!Number.isFinite(record.claim?.confidence) || record.claim.confidence < 0 || record.claim.confidence > 1) reasons.push('human claim confidence is invalid');
    if (!Array.isArray(record.claim?.evidenceLinks)) reasons.push('human claim evidenceLinks must be an array');
    for (const link of record.claim?.evidenceLinks || []) {
      try {
        const url = new URL(link?.url);
        if (!['http:', 'https:'].includes(url.protocol)) reasons.push('human claim evidence link protocol is invalid');
      } catch {
        reasons.push('human claim evidence link is invalid');
      }
    }
    if (record.claim?.kind === 'review_decision'
      && (!RESEARCH_REVIEW_DECISIONS.includes(record.claim?.decision) || record.claim?.relation !== 'reviews')) {
      reasons.push('human review decision is invalid');
    }
    if (record.claim?.kind === 'task_approval'
      && (record.claim?.decision !== 'approved' || record.claim?.relation !== 'approves' || !record.claim?.taskId)) {
      reasons.push('human task approval is invalid');
    } else if (record.claim?.kind === 'task_approval' && (!legacyRecord || record.claim?.taskContract)) {
      try {
        const normalizedTaskContract = normalizeTaskApprovalContract(
          record.claim?.taskContract,
          record.claim?.taskId,
          record.targetHash
        );
        if (JSON.stringify(normalizedTaskContract) !== JSON.stringify(record.claim.taskContract)) {
          reasons.push('human task approval contract is not canonical');
        }
      } catch (error) {
        reasons.push(error.message);
      }
    }
    if (record.claim?.kind === 'candidate_action_approval'
      && (record.claim?.decision !== 'approved'
        || record.claim?.relation !== 'approves'
        || !SHA256_PATTERN.test(String(record.claim?.actionContractHash || '')))) {
      reasons.push('human candidate action approval is invalid');
    }
    if (record.claim?.contextAssessment) {
      if (record.claim?.kind !== 'review_decision') reasons.push('contextual reuse assessment requires a review decision');
      try {
        const normalizedAssessment = await normalizeContextualReuseReview(record.claim.contextAssessment);
        if (JSON.stringify(normalizedAssessment) !== JSON.stringify(record.claim.contextAssessment)) {
          reasons.push('contextual reuse review is not canonical');
        }
      } catch (error) {
        reasons.push(error.message);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) {
    if (!['requester', 'researcher', 'reviewer', 'agent'].includes(record.author?.role)) {
      reasons.push('candidate action author role is invalid');
    }
    if (!SHA256_PATTERN.test(String(record.questionHash || ''))) reasons.push('candidate action questionHash is invalid');
    try {
      const normalized = await normalizeDiscoveryCandidateAction(record.action);
      if (normalized.questionHash !== record.questionHash) reasons.push('candidate action question identity does not match its record');
      if (JSON.stringify(normalized) !== JSON.stringify(record.action)) reasons.push('candidate action contract is not canonical');
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.hypothesis) {
    if (!['requester', 'researcher', 'reviewer', 'agent'].includes(record.author?.role)) reasons.push('hypothesis author role is invalid');
    if (!SHA256_PATTERN.test(String(record.questionHash || ''))) reasons.push('hypothesis questionHash is invalid');
    if (!record.hypothesis?.statement) reasons.push('hypothesis statement is required');
    if (!conditionsHaveContent(record.hypothesis?.conditions)) reasons.push('hypothesis conditions are required');
    if (!Array.isArray(record.hypothesis?.discriminatingObservations) || record.hypothesis.discriminatingObservations.length === 0) {
      reasons.push('hypothesis discriminating observations are required');
    }
    for (const hash of [...(record.hypothesis?.priorEvidenceHashes || []), ...(record.hypothesis?.alternativeToHashes || [])]) {
      if (!SHA256_PATTERN.test(String(hash || ''))) reasons.push('hypothesis linked record hash is invalid');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    if (!['researcher', 'reviewer', 'verifier', 'agent'].includes(record.author?.role)) reasons.push('prior evidence author role is invalid');
    if (!SHA256_PATTERN.test(String(record.questionHash || ''))) reasons.push('prior evidence questionHash is invalid');
    if (!PRIOR_EVIDENCE_KINDS.includes(record.evidence?.kind)) reasons.push('prior evidence kind is invalid');
    if (!record.evidence?.summary) reasons.push('prior evidence summary is required');
    try {
      normalizeReferenceIdentity(record.evidence?.reference);
      const transformations = normalizeTransformations(record.evidence?.transformations);
      if (['assay', 'negative_result', 'failed_attempt'].includes(record.evidence?.kind)
        && record.evidence?.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        reasons.push('assay, negative-result, and failed-attempt evidence requires the public protein evidence contract');
      }
      if (record.evidence?.schema) {
        if (record.evidence.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
          reasons.push('public protein evidence schema is unsupported');
        } else {
          const normalizedProfile = normalizePublicProteinEvidenceProfile({
            evidenceKind: record.evidence.kind,
            conditions: record.evidence.conditions,
            transformations,
            provenance: record.evidence.provenance,
            finding: record.evidence.finding
          });
          const declaredProfile = {
            schema: record.evidence.schema,
            access: record.evidence.access,
            finding: record.evidence.finding
          };
          if (JSON.stringify(normalizedProfile) !== JSON.stringify(declaredProfile)) {
            reasons.push('public protein evidence profile is not canonical');
          }
          if (['annotation', 'domain'].includes(record.evidence.kind) && !record.evidence.annotation) {
            reasons.push('public annotation and domain evidence requires a normalized annotation identity');
          }
        }
      }
      if (record.evidence?.annotation) {
        const normalizedAnnotation = await normalizeProteinAnnotationIdentity(record.evidence.annotation);
        if (JSON.stringify(normalizedAnnotation) !== JSON.stringify(record.evidence.annotation)) {
          reasons.push('prior evidence protein annotation identity is not canonical');
        }
        if (record.evidence.kind === 'domain' && normalizedAnnotation.scope !== 'domain') {
          reasons.push('domain evidence requires a domain annotation scope');
        }
      }
      if (record.evidence?.reuseContext) {
        const normalizedReuseContext = await normalizeCrossRoomReuseContext(record.evidence.reuseContext);
        if (JSON.stringify(normalizedReuseContext) !== JSON.stringify(record.evidence.reuseContext)) {
          reasons.push('cross-room reuse context is not canonical');
        }
        if (record.evidence.reference?.contentHash !== normalizedReuseContext.originRecordHash) {
          reasons.push('cross-room reuse reference does not match its origin record');
        }
      }
    } catch (error) {
      reasons.push(error.message);
    }
    if (!record.evidence?.provenance?.retrievalMethod || !Number.isFinite(Date.parse(record.evidence?.provenance?.retrievedAt || ''))) {
      reasons.push('prior evidence provenance is incomplete');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.prediction) {
    if (!['researcher', 'requester', 'verifier', 'agent'].includes(record.author?.role)) reasons.push('prediction author role is invalid');
    if (!SHA256_PATTERN.test(String(record.questionHash || '')) || !SHA256_PATTERN.test(String(record.hypothesisHash || ''))) {
      reasons.push('prediction question or hypothesis identity is invalid');
    }
    if (!record.prediction?.expectedObservation || !record.prediction?.normalizedLabel) reasons.push('prediction observation and label are required');
    if (!Number.isFinite(record.prediction?.confidence) || record.prediction.confidence < 0 || record.prediction.confidence > 1) reasons.push('prediction confidence is invalid');
    if (!['blinded', 'not_available'].includes(record.prediction?.outcomeAccess)) reasons.push('prediction outcome access is invalid');
    if (!Number.isFinite(Date.parse(record.prediction?.frozenAt || ''))) reasons.push('prediction frozenAt is invalid');
    if (!Array.isArray(record.prediction?.receiptHashes) || record.prediction.receiptHashes.some((hash) => !SHA256_PATTERN.test(hash))) {
      reasons.push('prediction receipt hashes are invalid');
    }
    await verifyAnalysisEvidence(record.prediction?.method, reasons, 'prediction method');
    if (!record.prediction?.method?.artifactHash && record.prediction?.receiptHashes?.length === 0) {
      reasons.push('prediction exact method artifact or receipt evidence is required');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) {
    if (!['researcher', 'reviewer', 'requester'].includes(record.author?.role)) {
      reasons.push('resolution policy author role is invalid');
    }
    if (!SHA256_PATTERN.test(String(record.questionHash || ''))) {
      reasons.push('resolution policy questionHash is invalid');
    }
    try {
      const normalizedPolicy = await normalizeResearchResolutionPolicy(record.policy);
      if (JSON.stringify(normalizedPolicy) !== JSON.stringify(record.policy)) {
        reasons.push('research resolution policy is not canonical');
      }
      if (record.createdAt !== record.policy?.frozenAt) {
        reasons.push('resolution policy creation and freeze timestamps do not match');
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workOrder) {
    if (!['researcher', 'reviewer', 'requester', 'agent'].includes(record.author?.role)) reasons.push('work order author role is invalid');
    if (!SHA256_PATTERN.test(String(record.questionHash || ''))) reasons.push('work order questionHash is invalid');
    if (!Array.isArray(record.hypothesisHashes) || record.hypothesisHashes.length === 0
      || record.hypothesisHashes.some((hash) => !SHA256_PATTERN.test(hash))) reasons.push('work order hypothesis hashes are invalid');
    if (!RESEARCH_WORK_KINDS.includes(record.work?.kind) || record.work?.status !== 'proposed' || !record.work?.title) {
      reasons.push('work order identity is invalid');
    }
    if (!Number.isInteger(record.work?.replicaTarget) || record.work.replicaTarget < 1 || record.work.replicaTarget > 100) {
      reasons.push('work order replicaTarget is invalid');
    }
    if (record.work?.blindness?.required !== false && !SHA256_PATTERN.test(String(record.work?.blindness?.allocationHash || ''))) {
      reasons.push('work order blinded allocation identity is invalid');
    }
    await verifyProtocolEvidence(record.work?.protocol, reasons, 'work order protocol');
    if (record.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
      try {
        const normalizedWork = await normalizeResearchWorkOrderContract({
          workKind: record.work.kind,
          title: record.work.title,
          protocol: record.work.protocol,
          replicaTarget: record.work.replicaTarget,
          blindness: record.work.blindness,
          feasibility: record.work.feasibility,
          analysis: record.work.plannedAnalysis,
          failureCategories: record.work.allowedFailureCategories,
          custody: record.work.custody,
          publication: record.work.publication,
          replication: record.work.replication,
          scopeBoundary: record.work.scopeBoundary
        });
        if (JSON.stringify(normalizedWork) !== JSON.stringify(record.work)) {
          reasons.push('research work order contract is not canonical');
        }
      } catch (error) {
        reasons.push(error.message);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workClaim) {
    if (!['researcher', 'verifier'].includes(record.author?.role)) reasons.push('work claim author role is invalid');
    if (!SHA256_PATTERN.test(String(record.workOrderHash || ''))) reasons.push('work claim workOrderHash is invalid');
    if (record.workClaim?.status !== 'claimed' || !record.workClaim?.laboratory?.id || !record.workClaim?.laboratory?.name) {
      reasons.push('work claim laboratory identity is incomplete');
    }
    if (!Array.isArray(record.workClaim?.capabilities) || record.workClaim.capabilities.length === 0) reasons.push('work claim capabilities are required');
    if (record.workClaim?.consent?.publicLaboratoryIdentity !== true || record.workClaim?.consent?.publishOutcome !== true) {
      reasons.push('work claim publication consent is invalid');
    }
    if (record.workClaim?.schema === LABORATORY_CAPABILITY_CLAIM_VERSION) {
      try {
        const normalizedClaim = await normalizeLaboratoryCapabilityClaim({
          laboratory: record.workClaim.laboratory,
          capabilityClaims: record.workClaim.capabilityClaims,
          protocolCustody: record.workClaim.protocolCustody,
          safety: record.workClaim.safety,
          availability: record.workClaim.availability,
          consent: record.workClaim.consent,
          conflictDisclosure: record.workClaim.conflictDisclosure,
          createdAt: record.createdAt
        });
        if (JSON.stringify(normalizedClaim) !== JSON.stringify(record.workClaim)) {
          reasons.push('laboratory capability claim is not canonical');
        }
      } catch (error) {
        reasons.push(error.message);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.outcome) {
    if (!['researcher', 'verifier'].includes(record.author?.role)) reasons.push('outcome author role is invalid');
    for (const hash of [record.questionHash, record.workOrderHash, record.workClaimHash, ...(record.hypothesisHashes || [])]) {
      if (!SHA256_PATTERN.test(String(hash || ''))) reasons.push('outcome linked record hash is invalid');
    }
    if (record.replicationOfHash && !SHA256_PATTERN.test(record.replicationOfHash)) reasons.push('outcome replication identity is invalid');
    if (!RESEARCH_OUTCOME_CLASSES.includes(record.outcome?.classification)) reasons.push('outcome classification is invalid');
    if (!record.outcome?.summary || !RESEARCH_ATTEMPT_STATUSES.includes(record.outcome?.attempt?.status)
      || !RESEARCH_FAILURE_CATEGORIES.includes(record.outcome?.attempt?.failureCategory)) reasons.push('outcome attempt is invalid');
    if (record.outcome?.attempt?.status === 'failed' && record.outcome?.attempt?.failureCategory === 'none') reasons.push('failed outcome attempt lacks a failure category');
    if (!Array.isArray(record.outcome?.observations) || record.outcome.observations.length === 0
      || record.outcome.observations.some((entry) => !entry.readout || !Number.isFinite(entry.value) || !Number.isFinite(entry.normalizedValue))) {
      reasons.push('outcome observations are invalid');
    }
    if (!['sealed', 'revealed'].includes(record.outcome?.blind?.state)
      || !SHA256_PATTERN.test(String(record.outcome?.blind?.codeHash || ''))
      || !SHA256_PATTERN.test(String(record.outcome?.blind?.allocationHash || ''))) reasons.push('outcome blinding evidence is invalid');
    if (record.outcome?.blind?.state === 'sealed' && record.outcome?.blind?.revealedAt) reasons.push('sealed outcome includes reveal evidence');
    if (record.outcome?.blind?.state === 'revealed' && !Number.isFinite(Date.parse(record.outcome?.blind?.revealedAt || ''))) reasons.push('revealed outcome timestamp is invalid');
    await verifyProtocolEvidence(record.outcome?.protocol, reasons, 'outcome protocol');
    await verifyAnalysisEvidence(record.outcome?.analysis, reasons, 'outcome analysis');
    if (record.outcome?.executionContext) {
      try {
        const normalizedContext = normalizeExperimentalExecutionContext(record.outcome.executionContext);
        if (JSON.stringify(normalizedContext) !== JSON.stringify(record.outcome.executionContext)) {
          reasons.push('experimental execution context is not canonical');
        }
      } catch (error) {
        reasons.push(error.message);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.cohort) {
    if (!['verifier', 'researcher', 'reviewer'].includes(record.author?.role)) reasons.push('cohort author role is invalid');
    if (!record.cohort?.label || record.cohort?.state !== 'frozen' || !Number.isFinite(Date.parse(record.cohort?.frozenAt || ''))) {
      reasons.push('frozen cohort identity is invalid');
    }
    for (const values of [record.cohort?.questionHashes, record.cohort?.predictionHashes, record.cohort?.workOrderHashes]) {
      if (!Array.isArray(values) || values.length === 0 || values.some((hash) => !SHA256_PATTERN.test(hash))) reasons.push('cohort linked record hashes are invalid');
    }
    if (!Array.isArray(record.cohort?.metrics) || record.cohort.metrics.length === 0
      || record.cohort.metrics.some((metric) => !metric.id || !metric.label || !['higher_is_better', 'lower_is_better'].includes(metric.direction))) {
      reasons.push('cohort metric definitions are invalid');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.evaluation) {
    if (!['verifier', 'reviewer'].includes(record.author?.role)) reasons.push('evaluation author role is invalid');
    if (!SHA256_PATTERN.test(String(record.cohortHash || ''))) reasons.push('evaluation cohortHash is invalid');
    if (!Array.isArray(record.evaluation?.outcomeHashes) || record.evaluation.outcomeHashes.length === 0
      || record.evaluation.outcomeHashes.some((hash) => !SHA256_PATTERN.test(hash))) reasons.push('evaluation outcome hashes are invalid');
    if (!Array.isArray(record.evaluation?.metricResults) || record.evaluation.metricResults.length === 0
      || record.evaluation.metricResults.some((metric) => !metric.metricId || !Number.isFinite(metric.baselineValue)
        || !Number.isFinite(metric.currentValue) || !Number.isFinite(metric.absoluteDelta) || typeof metric.improved !== 'boolean')) {
      reasons.push('evaluation metric results are invalid');
    }
    if (!record.evaluation?.disagreementSummary || !record.evaluation?.failureAnalysis
      || record.evaluation?.acceptedOutcomePolicy !== 'independent_review_required') reasons.push('evaluation evidence policy is incomplete');
  }
  if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) {
    if (!['verifier', 'reviewer'].includes(record.author?.role)) reasons.push('realized action-value author role is invalid');
    if (record.realizedValue?.schema !== REALIZED_ACTION_VALUE_VERSION) reasons.push('realized action-value schema is invalid');
    try {
      const normalizedValue = await normalizeRealizedActionValue(record.realizedValue);
      if (JSON.stringify(normalizedValue) !== JSON.stringify(record.realizedValue)) {
        reasons.push('realized action-value contract is not canonical');
      }
      if (record.questionHash !== normalizedValue.questionHash) {
        reasons.push('realized action-value question identity mismatch');
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationExperiment) {
    if (!['researcher', 'reviewer', 'verifier'].includes(record.author?.role)) reasons.push('adjudication experiment author role is invalid');
    try {
      const normalizedExperiment = await normalizeAdjudicationExperimentContract(record.experiment);
      if (JSON.stringify(normalizedExperiment) !== JSON.stringify(record.experiment)) {
        reasons.push('adjudication experiment contract is not canonical');
      }
      if (record.experiment?.schema === ADJUDICATION_EXPERIMENT_VERSION
        && record.createdAt !== record.experiment.frozenAt) {
        reasons.push('adjudication experiment creation and policy freeze timestamps do not match');
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationEvaluation) {
    if (!['verifier', 'reviewer'].includes(record.author?.role)) reasons.push('adjudication evaluation author role is invalid');
    if (!SHA256_PATTERN.test(String(record.experimentHash || ''))) reasons.push('adjudication evaluation experimentHash is invalid');
    if (![
      LEGACY_ADJUDICATION_EVALUATION_VERSION,
      BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION,
      ADJUDICATION_EVALUATION_VERSION
    ]
      .includes(record.evaluation?.schema)) reasons.push('adjudication evaluation schema is invalid');
    try {
      const manifest = normalizeReferenceIdentity(record.evaluation?.resultManifest, 'adjudication result manifest');
      if (!manifest.contentHash) reasons.push('adjudication result manifest requires a content hash');
      if (JSON.stringify(manifest) !== JSON.stringify(record.evaluation?.resultManifest)) {
        reasons.push('adjudication result manifest is not canonical');
      }
    } catch (error) {
      reasons.push(error.message);
    }
    if (!Array.isArray(record.evaluation?.metricResults) || record.evaluation.metricResults.length < 2
      || record.evaluation.metricResults.some((metric) => !metric.metricId
        || !['higher_is_better', 'lower_is_better'].includes(metric.direction)
        || !Number.isFinite(metric.baselineValue)
        || !Number.isFinite(metric.candidateValue)
        || !Number.isFinite(metric.orientedEffect)
        || !Number.isFinite(metric.effectInterval?.lower)
        || !Number.isFinite(metric.effectInterval?.upper)
        || metric.effectInterval.lower > metric.effectInterval.upper
        || !Number.isInteger(metric.pairedSampleCount)
        || !Number.isInteger(metric.minimumSampleSize)
        || !Number.isFinite(metric.confidenceLevel)
        || metric.confidenceLevel <= 0
        || metric.confidenceLevel > 1
        || typeof metric.sampleAdequate !== 'boolean')) {
      reasons.push('adjudication evaluation metric results are invalid');
    }
    if (!['passes', 'fails', 'inconclusive'].includes(record.evaluation?.assessment?.conclusion)
      || record.evaluation?.assessment?.mode !== 'quality_or_effort') {
      reasons.push('adjudication evaluation assessment is invalid');
    }
    if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION) {
      const northStarEvidence = record.evaluation?.northStarEvidence || {};
      const northStarHashes = [
        northStarEvidence.policyHash,
        northStarEvidence.evidenceHash,
        northStarEvidence.caseEvidenceManifestHash,
        northStarEvidence.rawCostObservationManifestHash,
        northStarEvidence.conclusionAuditManifestHash,
        northStarEvidence.independenceAuditManifestHash,
        northStarEvidence.conversionAuditArtifactHash
      ];
      if (northStarEvidence.schema !== ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
        || northStarHashes.some((hash) => !SHA256_PATTERN.test(String(hash || '')))
        || !['reportable', 'incomplete'].includes(northStarEvidence.reportingStatus)
        || !['signed_evaluator_report_not_biological_truth', 'north_star_improvement_claim_prohibited']
          .includes(northStarEvidence.reportingBoundary)
        || !Number.isInteger(northStarEvidence.baseline?.observedCaseCount)
        || !Number.isInteger(northStarEvidence.baseline?.independentlyReplicatedConclusionCount)
        || !Number.isInteger(northStarEvidence.candidate?.observedCaseCount)
        || !Number.isInteger(northStarEvidence.candidate?.independentlyReplicatedConclusionCount)
        || record.evaluation?.assessment?.operationalMetricsAffectSuccess !== false) {
        reasons.push('adjudication north-star evidence or assessment is invalid');
      }
    }
    if (!Number.isInteger(record.evaluation?.regressionCount) || record.evaluation.regressionCount < 0
      || !Number.isInteger(record.evaluation?.missingCaseCount) || record.evaluation.missingCaseCount < 0) {
      reasons.push('adjudication evaluation case accounting is invalid');
    }
    if (!record.evaluation?.disagreementSummary || !record.evaluation?.failureAnalysis
      || !record.evaluation?.evaluator?.authority
      || !record.evaluation?.evaluator?.identityRootId
      || !record.evaluation?.evaluator?.methodId
      || !record.evaluation?.evaluator?.version
      || !SHA256_PATTERN.test(String(record.evaluation?.evaluator?.artifactHash || ''))
      || record.evaluation?.evaluator?.blinded !== true) {
      reasons.push('adjudication evaluation evidence policy is incomplete');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    if (!['researcher', 'reviewer', 'verifier'].includes(record.author?.role)) {
      reasons.push('discovery checkpoint author role is invalid');
    }
    try {
      const normalizedCheckpoint = await normalizeDiscoveryCheckpoint(record.checkpoint, record.roomId);
      if (JSON.stringify(normalizedCheckpoint) !== JSON.stringify(record.checkpoint)) {
        reasons.push('discovery checkpoint is not canonical');
      }
    } catch (error) {
      reasons.push(error.message);
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.sequenceLink) {
    if (!['researcher', 'reviewer', 'verifier'].includes(record.author?.role)) reasons.push('sequence link author role is invalid');
    const { linkHash, ...identity } = record.link || {};
    if (!SHA256_PATTERN.test(String(linkHash || ''))) reasons.push('sequence link hash is invalid');
    else if (await hashJson(identity) !== linkHash) reasons.push('sequence link hash mismatch');
    for (const hash of [
      record.link?.nucleotideSubmissionHash,
      record.link?.proteinSubmissionHash,
      record.link?.reference?.assemblyHash,
      record.link?.reference?.referenceHash,
      record.link?.transcript?.transcriptHash,
      record.link?.translation?.nucleotideSequenceHash,
      record.link?.translation?.proteinSequenceHash,
      record.link?.translation?.translationHash
    ]) {
      if (!SHA256_PATTERN.test(String(hash || ''))) reasons.push('sequence link contains an invalid identity hash');
    }
    if (!['zero_based_half_open', 'one_based_closed'].includes(record.link?.coordinates?.coordinateSystem)
      || !['forward', 'reverse'].includes(record.link?.coordinates?.strand)
      || !Number.isInteger(record.link?.coordinates?.start)
      || !Number.isInteger(record.link?.coordinates?.end)
      || record.link.coordinates.end <= record.link.coordinates.start) reasons.push('sequence link coordinates are invalid');
    if (![0, 1, 2].includes(record.link?.translation?.readingFrame)) reasons.push('sequence link reading frame is invalid');
  }
  if (record.kind === RESEARCH_RECORD_KINDS.revocation) {
    if (!['requester', 'researcher', 'reviewer', 'verifier'].includes(record.author?.role)) reasons.push('revocation author role is invalid');
    if (!SHA256_PATTERN.test(String(record.targetHash || ''))) reasons.push('revocation targetHash is invalid');
    if (record.revocation?.scope !== 'future_use' || !record.revocation?.reason
      || !Number.isFinite(Date.parse(record.revocation?.effectiveAt || ''))) reasons.push('revocation evidence is invalid');
  }
  return { ok: reasons.length === 0, reasons, recordHash: record.recordHash || null };
}
