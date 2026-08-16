/**
 * @fileoverview Signed, immutable evidence records and local discovery for Poolday.
 */

import {
  SIGNATURE_DOMAINS,
  exportPublicKey,
  hashJson,
  receiptSigningPayload,
  sha256Hex,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  MAX_SEQUENCE_POSITIONS,
  SEQUENCE_ALPHABETS,
  getMaxPublicSequenceLength,
  normalizeSequenceInput
} from './sequence-workload.js';
import { exactModelContractKey, validateEnabledPoolModelContract } from './model-contract.js';
import { buildExactModelEvidenceView } from './model-evidence-view.js';
import {
  DISCOVERY_ACTION_VALUE_POLICY,
  rankDiscoveryActions
} from './discovery-action-value.js';
import {
  DISCOVERY_CANDIDATE_ACTION_KINDS,
  DISCOVERY_CANDIDATE_ACTION_VERSION,
  normalizeDiscoveryCandidateAction,
  rankSignedCandidateActions
} from './discovery-candidate-action.js';
import {
  REALIZED_ACTION_VALUE_REWARD_POLICY,
  REALIZED_ACTION_VALUE_VERSION,
  normalizeRealizedActionValue
} from './realized-action-value.js';
import {
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION,
  ADJUDICATION_NORTH_STAR_POLICY_VERSION,
  normalizeAdjudicationNorthStarEvidence,
  normalizeAdjudicationNorthStarPolicy
} from './adjudication-north-star.js';
import {
  hashSequenceFloat32Values,
  validateSequenceOutputIntegrity
} from './sequence-result.js';

export const RESEARCH_RECORD_VERSION = 'poolday.research_evidence/v2';
export const LEGACY_RESEARCH_RECORD_VERSION = 'poolday.research_evidence/v1';
export const RESEARCH_RECORD_KINDS = Object.freeze({
  submission: 'research_submission',
  result: 'research_result',
  claim: 'human_claim',
  hypothesis: 'research_hypothesis',
  priorEvidence: 'research_prior_evidence',
  prediction: 'research_prediction',
  resolutionPolicy: 'research_resolution_policy',
  workOrder: 'research_work_order',
  workClaim: 'research_work_claim',
  outcome: 'research_outcome',
  cohort: 'research_cohort',
  evaluation: 'research_evaluation',
  realizedActionValue: 'research_realized_action_value',
  adjudicationExperiment: 'research_adjudication_experiment',
  adjudicationEvaluation: 'research_adjudication_evaluation',
  discoveryCheckpoint: 'research_discovery_checkpoint',
  candidateAction: 'research_candidate_action',
  sequenceLink: 'research_sequence_link',
  revocation: 'research_revocation'
});
export const RESEARCH_INTENT_KINDS = Object.freeze([
  'question',
  'hypothesis',
  'label',
  'task_context'
]);
export const HUMAN_CLAIM_KINDS = Object.freeze([
  'annotation',
  'evidence_link',
  'correction',
  'experiment_context',
  'follow_up',
  'review_decision',
  'task_approval',
  'candidate_action_approval'
]);
export const EVIDENCE_RELATIONS = Object.freeze([
  'supports',
  'contradicts',
  'corrects',
  'reviews',
  'derived_from',
  'proposes',
  'approves'
]);
export const PRIOR_EVIDENCE_KINDS = Object.freeze([
  'sequence',
  'structure',
  'domain',
  'annotation',
  'experiment',
  'publication',
  'assay',
  'negative_result',
  'failed_attempt'
]);
export const PUBLIC_PROTEIN_EVIDENCE_VERSION = 'poolday.public_protein_evidence/v1';
export const PUBLIC_PROTEIN_EVIDENCE_KINDS = Object.freeze([
  'sequence',
  'structure',
  'domain',
  'annotation',
  'publication',
  'assay',
  'negative_result',
  'failed_attempt'
]);
export const PUBLIC_PROTEIN_EVIDENCE_FINDINGS = Object.freeze([
  'not_applicable',
  'positive',
  'negative',
  'ambiguous',
  'not_observed'
]);
export const PROTEIN_ANNOTATION_IDENTITY_VERSION = 'poolday.protein_annotation_identity/v1';
export const PROTEIN_ANNOTATION_SCOPES = Object.freeze(['family', 'domain']);
export const PROTEIN_ANNOTATION_COORDINATE_SYSTEMS = Object.freeze([
  'protein_residue_one_based_closed',
  'protein_residue_zero_based_half_open'
]);
export const CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM = 'protein_residue_one_based_closed';
export const CROSS_ROOM_SOURCE_IDENTITY_VERSION = 'poolday.cross_room_source_identity/v1';
export const CROSS_ROOM_REUSE_CONTEXT_VERSION = 'poolday.cross_room_reuse_context/v1';
export const CONTEXTUAL_REUSE_REVIEW_VERSION = 'poolday.contextual_reuse_review/v1';
export const LEGACY_ADJUDICATION_EXPERIMENT_VERSION = 'poolday.annotation_adjudication_experiment/v1';
export const BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION = 'poolday.annotation_adjudication_experiment/v2';
export const ADJUDICATION_EXPERIMENT_VERSION = 'poolday.annotation_adjudication_experiment/v3';
export const LEGACY_ADJUDICATION_EVALUATION_VERSION = 'poolday.annotation_adjudication_evaluation/v1';
export const BASELINE_FREEZE_ADJUDICATION_EVALUATION_VERSION = 'poolday.annotation_adjudication_evaluation/v2';
export const ADJUDICATION_EVALUATION_VERSION = 'poolday.annotation_adjudication_evaluation/v3';
export const ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION = 'poolday.adjudication_campaign_measurement_plan/v1';
export const ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES = Object.freeze({
  informationGainPerActionMetricId: 'higher_is_better',
  contradictionResolutionCostMetricId: 'lower_is_better',
  duplicateWorkAvoidedMetricId: 'higher_is_better',
  uncertaintyCalibrationErrorMetricId: 'lower_is_better',
  heldOutFamilyPerformanceMetricId: 'higher_is_better'
});
export const DISCOVERY_CHECKPOINT_VERSION = 'poolday.discovery_contract_checkpoint/v1';
export const LEGACY_DISCOVERY_CONTRACT_STATE_VERSION = 'poolday.discovery_contract_state/v1';
export const LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID = 'poolday.discovery_contract_projection/v1';
export const DISCOVERY_CONTRACT_STATE_VERSION = 'poolday.discovery_contract_state/v2';
export const DISCOVERY_CONTRACT_PROJECTION_ID = 'poolday.discovery_contract_projection/v2';
export const RESEARCH_WORK_KINDS = Object.freeze([
  'human_review',
  'experimental_assay',
  'computational_replication'
]);
export const RESEARCH_OUTCOME_CLASSES = Object.freeze(['positive', 'negative', 'ambiguous']);
export const RESEARCH_ATTEMPT_STATUSES = Object.freeze(['completed', 'failed']);
export const RESEARCH_RESOLUTION_POLICY_VERSION = 'poolday.research_resolution_policy/v1';
export const RESOLUTION_UNCERTAINTY_TRIGGERS = Object.freeze([
  'insufficient_accepted_outcomes',
  'insufficient_independent_replications',
  'ambiguous_outcome',
  'failed_attempt',
  'disputed_review',
  'active_contradiction',
  'uncertainty_above_threshold',
  'control_failure'
]);
export const RESOLUTION_REOPEN_TRIGGERS = Object.freeze([
  'contradiction',
  'correction',
  'revocation',
  'failed_replication',
  'policy_invalidation'
]);
export const RESEARCH_WORK_ORDER_CONTRACT_VERSION = 'poolday.research_work_order/v1';
export const LABORATORY_CAPABILITY_CLAIM_VERSION = 'poolday.laboratory_capability_claim/v1';
export const EXPERIMENTAL_EXECUTION_CONTEXT_VERSION = 'poolday.experimental_execution_context/v1';
export const REPLICATION_INDEPENDENCE_DIMENSIONS = Object.freeze([
  'operator_identity',
  'institution',
  'instrument',
  'sample_batch',
  'preparation_batch',
  'analysis_execution'
]);
export const LABORATORY_PROTOCOL_CUSTODY_ROLES = Object.freeze(['owner', 'operator', 'licensed_user', 'contracted_executor']);
export const LABORATORY_AVAILABILITY_STATUSES = Object.freeze(['available', 'limited']);
export const RESEARCH_FAILURE_CATEGORIES = Object.freeze([
  'none',
  'expression_failure',
  'folding_failure',
  'solubility_failure',
  'binding_failure',
  'selectivity_failure',
  'environment_failure',
  'protocol_failure',
  'analysis_failure',
  'inconclusive'
]);
export const RESEARCH_REVIEW_DECISIONS = Object.freeze([
  'accepted',
  'rejected',
  'needs_revision',
  'replication_requested'
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_TEXT_LENGTH = 8000;
const MAX_EMBEDDING_DIMENSIONS = 4096;
const DOMAIN_BY_KIND = Object.freeze({
  [RESEARCH_RECORD_KINDS.submission]: SIGNATURE_DOMAINS.researchSubmission,
  [RESEARCH_RECORD_KINDS.result]: SIGNATURE_DOMAINS.researchResult,
  [RESEARCH_RECORD_KINDS.claim]: SIGNATURE_DOMAINS.humanClaim,
  [RESEARCH_RECORD_KINDS.hypothesis]: SIGNATURE_DOMAINS.researchHypothesis,
  [RESEARCH_RECORD_KINDS.priorEvidence]: SIGNATURE_DOMAINS.researchPriorEvidence,
  [RESEARCH_RECORD_KINDS.prediction]: SIGNATURE_DOMAINS.researchPrediction,
  [RESEARCH_RECORD_KINDS.resolutionPolicy]: SIGNATURE_DOMAINS.researchResolutionPolicy,
  [RESEARCH_RECORD_KINDS.workOrder]: SIGNATURE_DOMAINS.researchWorkOrder,
  [RESEARCH_RECORD_KINDS.workClaim]: SIGNATURE_DOMAINS.researchWorkClaim,
  [RESEARCH_RECORD_KINDS.outcome]: SIGNATURE_DOMAINS.researchOutcome,
  [RESEARCH_RECORD_KINDS.cohort]: SIGNATURE_DOMAINS.researchCohort,
  [RESEARCH_RECORD_KINDS.evaluation]: SIGNATURE_DOMAINS.researchEvaluation,
  [RESEARCH_RECORD_KINDS.realizedActionValue]: SIGNATURE_DOMAINS.researchRealizedActionValue,
  [RESEARCH_RECORD_KINDS.adjudicationExperiment]: SIGNATURE_DOMAINS.researchAdjudicationExperiment,
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: SIGNATURE_DOMAINS.researchAdjudicationEvaluation,
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: SIGNATURE_DOMAINS.researchDiscoveryCheckpoint,
  [RESEARCH_RECORD_KINDS.candidateAction]: SIGNATURE_DOMAINS.researchCandidateAction,
  [RESEARCH_RECORD_KINDS.sequenceLink]: SIGNATURE_DOMAINS.researchSequenceLink,
  [RESEARCH_RECORD_KINDS.revocation]: SIGNATURE_DOMAINS.researchRevocation
});

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
};
const compactText = (value, max = MAX_TEXT_LENGTH) => String(value || '').trim().slice(0, max);
const unique = (values) => [...new Set(values.filter(Boolean))];
const providerIdentities = (values) => unique((Array.isArray(values) ? values : [])
  .filter((value) => typeof value === 'string')
  .map((value) => compactText(value, 240))
  .filter(Boolean))
  .sort();
const sameStringSet = (left = [], right = []) => {
  const normalizedLeft = unique(left.map(String)).sort();
  const normalizedRight = unique(right.map(String)).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};
const stableTaskId = (kind, targetHash) => `task:${kind}:${targetHash}`;
const withoutSignature = (record = {}) => {
  const { signature, ...payload } = record;
  return payload;
};
const withoutIdentity = (record = {}) => {
  const { recordHash, signature, ...payload } = record;
  return payload;
};

const normalizeRoomId = (roomId) => {
  const normalized = compactText(roomId, 160).replace(/[^a-z0-9_.:-]/gi, '_');
  if (!normalized) throw new TypeError('roomId is required');
  return normalized;
};

const normalizeIntent = (intent = {}) => {
  const kind = compactText(intent.kind, 32).toLowerCase();
  if (!RESEARCH_INTENT_KINDS.includes(kind)) throw new TypeError('requester intent kind is not supported');
  const text = compactText(intent.text);
  const label = compactText(intent.label, 240);
  const context = compactText(intent.context);
  const decisionContext = compactText(intent.decisionContext, 2000);
  const conditions = compactText(intent.conditions, 2000);
  const scope = compactText(intent.scope, 2000);
  const exclusions = compactText(intent.exclusions, 2000);
  const desiredObservation = compactText(intent.desiredObservation, 2000);
  const knownUnknowns = compactText(intent.knownUnknowns, 2000);
  // A sequence and its signed provenance are sufficient to enter the evidence
  // network. Intent is optional context for reviewers, never an admission
  // requirement for a public protein proposal.
  return {
    kind,
    text,
    label,
    context,
    decisionContext,
    conditions,
    scope,
    exclusions,
    desiredObservation,
    knownUnknowns
  };
};

const DECISION_CONTEXT_FIELDS = Object.freeze([
  ['question', 'Question'],
  ['decisionContext', 'Decision context'],
  ['conditions', 'Conditions'],
  ['scope', 'Scope'],
  ['exclusions', 'Exclusions'],
  ['desiredObservation', 'Desired observation']
]);

const contextComparisonText = (value) => compactText(value, 2000)
  .replace(/\s+/g, ' ')
  .toLowerCase();

const decisionContextIntent = (intent = {}) => ({
  question: compactText(intent.question || intent.text, 2000),
  decisionContext: compactText(intent.decisionContext, 2000),
  conditions: compactText(intent.conditions || intent.context, 2000),
  scope: compactText(intent.scope, 2000),
  exclusions: compactText(intent.exclusions, 2000),
  desiredObservation: compactText(intent.desiredObservation, 2000)
});

const decisionContextSnapshot = (submission = {}) => ({
  questionHash: compactText(submission.recordHash, 160),
  roomId: compactText(submission.roomId, 160),
  sequenceHash: compactText(submission.sequence?.hash, 160),
  consent: {
    publicSequence: submission.consent?.publicSequence === true,
    publicEvidenceNetwork: submission.consent?.publicEvidenceNetwork === true
  },
  intent: decisionContextIntent(submission.requesterIntent)
});

const compareDecisionContextSnapshots = (origin = {}, current = {}) => {
  const fields = DECISION_CONTEXT_FIELDS.map(([field, label]) => {
    const originValue = compactText(origin.intent?.[field], 2000);
    const currentValue = compactText(current.intent?.[field], 2000);
    let status = 'match';
    if (!originValue && !currentValue) status = 'missing_both';
    else if (!originValue) status = 'missing_origin';
    else if (!currentValue) status = 'missing_current';
    else if (contextComparisonText(originValue) !== contextComparisonText(currentValue)) status = 'different';
    return { field, label, originValue, currentValue, status };
  });
  const differences = fields.filter((entry) => entry.status === 'different').map((entry) => entry.field);
  const missing = fields.filter((entry) => entry.status.startsWith('missing_')).map((entry) => entry.field);
  return {
    status: differences.length ? 'declared_context_differences'
      : missing.length ? 'declared_context_incomplete'
        : 'exact_declared_context_match',
    fields,
    differences,
    missing
  };
};

export function compareResearchDecisionContexts(originSubmission = null, currentSubmission = null) {
  if (originSubmission?.kind !== RESEARCH_RECORD_KINDS.submission
    || currentSubmission?.kind !== RESEARCH_RECORD_KINDS.submission) {
    return {
      status: 'context_unavailable',
      fields: [],
      differences: [],
      missing: DECISION_CONTEXT_FIELDS.map(([field]) => field)
    };
  }
  return compareDecisionContextSnapshots(
    decisionContextSnapshot(originSubmission),
    decisionContextSnapshot(currentSubmission)
  );
}

/**
 * Projects how well a signed submission bounds the question it asks. Missing
 * structure does not invalidate older evidence records; it remains visible as
 * an explicit clarification gap before the room proposes scientific work.
 */
export function projectResearchQuestionClarity(submission = null) {
  if (!submission || submission.kind !== RESEARCH_RECORD_KINDS.submission) {
    return {
      status: 'question_missing',
      minimumReady: false,
      score: 0,
      presentFields: [],
      gaps: [{ field: 'question', reason: 'No signed question and sequence anchor exists.' }]
    };
  }
  const intent = submission.requesterIntent || {};
  const fields = {
    sequence: Boolean(submission.sequence?.hash && submission.sequence?.length > 0),
    question: Boolean(compactText(intent.text)),
    conditions: Boolean(compactText(intent.conditions || intent.context)),
    desired_observation: Boolean(compactText(intent.desiredObservation)),
    decision_context: Boolean(compactText(intent.decisionContext)),
    scope: Boolean(compactText(intent.scope)),
    exclusions: Boolean(compactText(intent.exclusions)),
    known_unknowns: Boolean(compactText(intent.knownUnknowns))
  };
  const gapReasons = {
    sequence: 'A public sequence identity is required.',
    question: 'State the exact question reviewers should answer.',
    conditions: 'State the biological or experimental conditions that bound the question.',
    desired_observation: 'State what observation would change or resolve the question.',
    decision_context: 'State which human decision this evidence may inform.',
    scope: 'State what the investigation includes.',
    exclusions: 'State what the investigation does not claim.',
    known_unknowns: 'State the uncertainty or evidence gaps already known.'
  };
  const presentFields = Object.entries(fields).filter(([, present]) => present).map(([field]) => field);
  const gaps = Object.entries(fields)
    .filter(([, present]) => !present)
    .map(([field]) => ({ field, reason: gapReasons[field] }));
  const minimumReady = fields.sequence && fields.question;
  const bounded = minimumReady && fields.conditions && fields.desired_observation;
  return {
    status: bounded ? 'bounded' : minimumReady ? 'needs_clarification' : 'incomplete',
    minimumReady,
    score: Number((presentFields.length / Object.keys(fields).length).toFixed(3)),
    presentFields,
    gaps
  };
}

/**
 * Projects the minimum independent-execution evidence required before a
 * receipt-backed result can enter reusable room memory. Receipt and provider
 * identities are separate constraints: two hashes from one provider do not
 * establish independent execution.
 */
export function projectResearchExecutionIndependence(record = {}) {
  const agreement = record.compute?.agreement || null;
  const declaredReceiptHashes = Array.isArray(agreement?.receiptHashes) ? agreement.receiptHashes : [];
  const declaredProviderIds = agreement?.providerIds ?? agreement?.acceptedProviderIds ?? [];
  const receiptEvidence = Array.isArray(record.compute?.receiptEvidence)
    ? record.compute.receiptEvidence
    : [];
  const structurallyBoundEvidence = receiptEvidence.filter((entry) => (
    SHA256_PATTERN.test(String(entry?.receiptHash || ''))
    && compactText(entry?.providerId, 240)
    && compactText(entry?.providerPublicKey, 12000)
    && entry?.receipt?.providerId === entry.providerId
    && entry?.receipt?.providerSignature
  ));
  const receiptHashes = unique(structurallyBoundEvidence.map((entry) => entry.receiptHash)).map(String).sort();
  const providerIds = providerIdentities(structurallyBoundEvidence.map((entry) => entry.providerId));
  const providerPublicKeys = unique(structurallyBoundEvidence.map((entry) => compactText(entry.providerPublicKey, 12000))).sort();
  const independentReceiptCount = receiptHashes.length;
  const independentProviderCount = providerIds.length;
  const independentProviderKeyCount = providerPublicKeys.length;
  const agreementAccepted = ['accepted', 'agreed'].includes(compactText(agreement?.status, 64).toLowerCase());
  const primaryReceiptBound = receiptHashes.includes(record.compute?.receiptHash);
  const agreementEvidenceBound = agreementAccepted
    && sameStringSet(receiptHashes, declaredReceiptHashes)
    && Array.isArray(declaredProviderIds)
    && sameStringSet(providerIds, declaredProviderIds);
  const independentlyExecuted = agreementEvidenceBound
    && primaryReceiptBound
    && structurallyBoundEvidence.length === receiptEvidence.length
    && independentReceiptCount >= 2
    && independentProviderCount >= 2
    && independentProviderKeyCount >= 2;
  return {
    schema: 'poolday.research_execution_independence/v1',
    receiptHashes,
    providerIds,
    providerPublicKeys,
    independentReceiptCount,
    independentProviderCount,
    independentProviderKeyCount,
    primaryReceiptBound,
    agreementEvidenceBound,
    independentlyExecuted,
    status: independentlyExecuted
      ? 'independently_reproduced'
      : structurallyBoundEvidence.length !== receiptEvidence.length
        ? 'receipt_evidence_invalid'
        : independentReceiptCount < 2
          ? 'single_verified_receipt'
          : !agreementEvidenceBound || !primaryReceiptBound
            ? 'agreement_evidence_mismatch'
            : 'provider_independence_missing'
  };
}

const normalizeVerifiedReceiptEvidence = async ({
  receiptEvidence = null,
  receiptRecord,
  receiptHash,
  agreement,
  modelContract,
  sequenceHash
}) => {
  const agreementStatus = compactText(agreement?.status, 64).toLowerCase();
  const agreementAccepted = ['accepted', 'agreed'].includes(agreementStatus);
  const supplied = Array.isArray(receiptEvidence) ? receiptEvidence : [];
  const primaryCandidate = receiptRecord?.receipt && receiptRecord?.providerPublicKey
    ? [{
      receiptHash,
      providerId: receiptRecord.providerId || receiptRecord.receipt.providerId,
      providerPublicKey: receiptRecord.providerPublicKey,
      receipt: receiptRecord.receipt
    }]
    : [];
  const candidates = supplied.length > 0 ? supplied : primaryCandidate;
  if (agreementAccepted && candidates.length < 2) {
    throw new TypeError('accepted compute agreement requires two verified receipt evidence records');
  }
  const normalized = [];
  for (const candidate of candidates) {
    const receipt = clone(candidate?.receipt || null);
    if (!receipt) throw new TypeError('compute receipt evidence requires the signed receipt');
    const computedReceiptHash = await hashJson(receipt);
    const evidenceReceiptHash = requireHash(candidate?.receiptHash, 'compute receipt evidence');
    if (computedReceiptHash !== evidenceReceiptHash) throw new TypeError('compute receipt evidence hash mismatch');
    const providerId = compactText(candidate?.providerId, 240);
    const providerPublicKey = compactText(candidate?.providerPublicKey, 12000);
    if (!providerId || receipt.providerId !== providerId) throw new TypeError('compute receipt evidence provider identity mismatch');
    if (!providerPublicKey || !receipt.providerSignature) throw new TypeError('compute receipt evidence signature material is required');
    if (receipt.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) {
      throw new TypeError('compute receipt evidence signature domain mismatch');
    }
    const signatureOk = await verifyCanonicalSignature(
      receiptSigningPayload(receipt),
      providerPublicKey,
      receipt.providerSignature,
      { domain: SIGNATURE_DOMAINS.providerReceipt }
    );
    if (!signatureOk) throw new TypeError('compute receipt evidence provider signature is invalid');
    if (exactModelContractKey(normalizeModelContract(receipt.model)) !== exactModelContractKey(modelContract)) {
      throw new TypeError('compute receipt evidence model contract mismatch');
    }
    if (receipt.inputHash !== sequenceHash) throw new TypeError('compute receipt evidence input identity mismatch');
    if (agreement?.jobId && receipt.jobId !== agreement.jobId) {
      throw new TypeError('compute receipt evidence job identity mismatch');
    }
    if (agreementAccepted) {
      const agreementField = compactText(agreement?.agreementField, 120);
      if (!agreementField || agreement?.agreementValue == null || receipt[agreementField] !== agreement.agreementValue) {
        throw new TypeError('compute receipt evidence does not match the accepted agreement value');
      }
    }
    normalized.push({ receiptHash: evidenceReceiptHash, providerId, providerPublicKey, receipt });
  }
  const evidenceReceiptHashes = normalized.map((entry) => entry.receiptHash);
  const evidenceProviderIds = normalized.map((entry) => entry.providerId);
  const evidenceProviderKeys = normalized.map((entry) => entry.providerPublicKey);
  if (agreementAccepted) {
    const declaredProviderIds = agreement?.providerIds ?? agreement?.acceptedProviderIds;
    if (!sameStringSet(evidenceReceiptHashes, agreement?.receiptHashes || [])) {
      throw new TypeError('compute agreement receipt identities do not match verified receipt evidence');
    }
    if (!Array.isArray(declaredProviderIds) || !sameStringSet(evidenceProviderIds, declaredProviderIds)) {
      throw new TypeError('compute agreement provider identities do not match verified receipt evidence');
    }
    if (unique(evidenceProviderIds).length < 2 || unique(evidenceProviderKeys).length < 2) {
      throw new TypeError('accepted compute agreement requires distinct verified provider identities and keys');
    }
  }
  if (normalized.length > 0 && !evidenceReceiptHashes.includes(receiptHash)) {
    throw new TypeError('verified receipt evidence does not include the primary receipt');
  }
  return normalized.sort((left, right) => left.receiptHash.localeCompare(right.receiptHash));
};

const normalizeConsent = (consent = {}, alphabet = SEQUENCE_ALPHABETS.aminoAcid) => {
  if (consent.publicSequence !== true) throw new TypeError('public sequence consent is required');
  if (consent.publicEvidenceNetwork !== true) throw new TypeError('public evidence-network consent is required');
  return {
    scope: alphabet === SEQUENCE_ALPHABETS.nucleotide
      ? 'public_dna_evidence_network'
      : 'public_protein_evidence_network',
    publicSequence: true,
    publicEvidenceNetwork: true,
    publishEmbedding: consent.publishEmbedding === true,
    publishResidueEvidence: consent.publishResidueEvidence === true,
    acknowledgedAt: compactText(consent.acknowledgedAt, 64) || new Date().toISOString()
  };
};

const normalizeModelContract = (model = {}) => {
  const sequence = model.sequence || model.requirements?.sequence || null;
  const contract = {
    id: compactText(model.id || model.modelId, 240),
    hash: compactText(model.hash || model.modelHash, 160),
    manifestHash: compactText(model.manifestHash, 160),
    tokenizerHash: compactText(model.tokenizerHash || model.requirements?.tokenizerHash, 160) || null,
    runtime: compactText(model.runtime, 120),
    backend: compactText(model.backend, 120),
    workload: compactText(model.workload || model.requirements?.workload, 120),
    executionMode: compactText(model.executionMode || model.requirements?.executionMode, 120),
    dimensions: Number(model.dimensions || model.embeddingDimensions || model.requirements?.embeddingDimensions || 0) || null,
    quantization: compactText(model.quantization || model.requirements?.quantization, 80) || null,
    contextLength: Number(model.contextLength || model.requirements?.contextLength || 0) || null,
    sequence: sequence ? clone(sequence) : null,
    outputs: clone(model.outputs || model.requirements?.outputs || null),
    runtimeCompatibility: clone(model.runtimeCompatibility || model.requirements?.runtimeCompatibility || null),
    runtimeContract: clone(model.runtimeContract || model.requirements?.runtimeContract || null),
    artifactIdentity: clone(model.artifactIdentity || model.requirements?.artifactIdentity || null),
    license: clone(model.license || model.requirements?.license || null),
    admission: clone(model.admission || model.requirements?.admission || null)
  };
  if (!contract.id || !contract.hash || !contract.manifestHash || !contract.runtime || !contract.workload) {
    throw new TypeError('exact model id, hash, manifest hash, runtime, and workload are required');
  }
  return contract;
};

const requireHash = (value, label) => {
  const normalized = compactText(value, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};

const normalizeHashList = (values, label, { min = 0, max = 128 } = {}) => {
  const hashes = unique(Array.isArray(values) ? values : []).slice(0, max);
  if (hashes.length < min) throw new TypeError(`${label} requires at least ${min} record ${min === 1 ? 'identity' : 'identities'}`);
  return hashes.map((value) => requireHash(value, label));
};

const normalizeTextList = (values, { min = 0, max = 64, itemMax = 1000, label = 'values' } = {}) => {
  const normalized = unique((Array.isArray(values) ? values : []).map((value) => compactText(value, itemMax))).slice(0, max);
  if (normalized.length < min) throw new TypeError(`${label} requires at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
  return normalized;
};

const normalizeDecisionContextSnapshot = async (snapshot = {}, label) => {
  const normalized = {
    questionHash: requireHash(snapshot.questionHash, `${label} questionHash`),
    roomId: normalizeRoomId(snapshot.roomId),
    sequenceHash: requireHash(snapshot.sequenceHash, `${label} sequenceHash`),
    consent: {
      publicSequence: snapshot.consent?.publicSequence === true,
      publicEvidenceNetwork: snapshot.consent?.publicEvidenceNetwork === true
    },
    intent: decisionContextIntent(snapshot.intent)
  };
  normalized.snapshotHash = await hashJson(normalized);
  return normalized;
};

const crossRoomSourceIdentityFields = (source = {}) => {
  const reference = source.reference || source.evidence?.reference || {};
  const annotation = source.annotation || source.evidence?.annotation || {};
  return {
    schema: CROSS_ROOM_SOURCE_IDENTITY_VERSION,
    evidenceKind: compactText(source.evidenceKind || source.evidence?.kind, 40).toLowerCase(),
    reference: {
      uri: compactText(reference.uri, 2000),
      accession: compactText(reference.accession, 240),
      version: compactText(reference.version, 240),
      contentHash: compactText(reference.contentHash, 160).toLowerCase()
    },
    annotationIdentityHash: compactText(source.annotationIdentityHash || annotation.identityHash, 160).toLowerCase() || null
  };
};

const crossRoomSourceIdentityKey = (source = {}) => JSON.stringify(crossRoomSourceIdentityFields(source));

const normalizeCrossRoomSourceIdentity = async (source = {}) => {
  const normalized = crossRoomSourceIdentityFields(source);
  if (!PRIOR_EVIDENCE_KINDS.includes(normalized.evidenceKind)) {
    throw new TypeError('cross-room source evidence kind is not supported');
  }
  if (!normalized.reference.uri && !normalized.reference.accession) {
    throw new TypeError('cross-room source identity requires a URI or accession');
  }
  if (!normalized.reference.version && !normalized.reference.contentHash) {
    throw new TypeError('cross-room source identity requires a version or content hash');
  }
  if (normalized.reference.contentHash && !SHA256_PATTERN.test(normalized.reference.contentHash)) {
    throw new TypeError('cross-room source content hash must be a SHA-256 identity');
  }
  if (normalized.annotationIdentityHash && !SHA256_PATTERN.test(normalized.annotationIdentityHash)) {
    throw new TypeError('cross-room annotation identity hash must be a SHA-256 identity');
  }
  if (['annotation', 'domain'].includes(normalized.evidenceKind) && !normalized.annotationIdentityHash) {
    throw new TypeError('cross-room annotation source requires a normalized annotation identity');
  }
  normalized.identityHash = await hashJson(normalized);
  return normalized;
};

const normalizeCrossRoomReuseContext = async (reuseContext = {}) => {
  const originRecordHash = requireHash(reuseContext.originRecordHash, 'cross-room origin record hash');
  const originSource = await normalizeCrossRoomSourceIdentity(reuseContext.originSource);
  const origin = await normalizeDecisionContextSnapshot(reuseContext.origin, 'cross-room origin context');
  const current = await normalizeDecisionContextSnapshot(reuseContext.current, 'cross-room current context');
  if (origin.roomId === current.roomId) throw new TypeError('cross-room reuse context requires distinct rooms');
  if (origin.sequenceHash !== current.sequenceHash) throw new TypeError('cross-room reuse context requires exact sequence identity');
  if (!origin.consent.publicSequence || !origin.consent.publicEvidenceNetwork
    || !current.consent.publicSequence || !current.consent.publicEvidenceNetwork) {
    throw new TypeError('cross-room reuse context requires public sequence and evidence-network consent');
  }
  const comparison = compareDecisionContextSnapshots(origin, current);
  const normalized = {
    schema: CROSS_ROOM_REUSE_CONTEXT_VERSION,
    originRecordHash,
    originSource,
    origin,
    current,
    comparison,
    admission: 'requires_explicit_current_room_context_review'
  };
  normalized.comparisonHash = await hashJson({
    originRecordHash,
    originSnapshotHash: origin.snapshotHash,
    currentSnapshotHash: current.snapshotHash,
    comparison
  });
  return normalized;
};

export async function createCrossRoomReuseContext({
  originRecord,
  originQuestion,
  currentQuestion
} = {}) {
  if (originRecord?.kind !== RESEARCH_RECORD_KINDS.priorEvidence) {
    throw new TypeError('cross-room reuse requires a prior-evidence origin record');
  }
  if (originQuestion?.kind !== RESEARCH_RECORD_KINDS.submission
    || currentQuestion?.kind !== RESEARCH_RECORD_KINDS.submission) {
    throw new TypeError('cross-room reuse requires origin and current question records');
  }
  if (originRecord.questionHash !== originQuestion.recordHash) {
    throw new TypeError('cross-room origin evidence does not belong to its declared question');
  }
  if (originRecord.roomId !== originQuestion.roomId) {
    throw new TypeError('cross-room origin evidence and question do not share a room');
  }
  for (const [question, label] of [[originQuestion, 'origin'], [currentQuestion, 'current']]) {
    if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
      throw new TypeError(`cross-room ${label} question did not consent to public evidence reuse`);
    }
  }
  return normalizeCrossRoomReuseContext({
    originRecordHash: originRecord.recordHash,
    originSource: crossRoomSourceIdentityFields(originRecord),
    origin: decisionContextSnapshot(originQuestion),
    current: decisionContextSnapshot(currentQuestion)
  });
}

const normalizeContextualReuseReview = async (assessment = {}) => {
  const determination = compactText(assessment.determination, 40).toLowerCase();
  if (!['relevant', 'not_relevant', 'uncertain'].includes(determination)) {
    throw new TypeError('contextual reuse determination must be relevant, not_relevant, or uncertain');
  }
  const normalized = {
    schema: CONTEXTUAL_REUSE_REVIEW_VERSION,
    determination,
    originRecordHash: requireHash(assessment.originRecordHash, 'contextual reuse originRecordHash'),
    originQuestionHash: requireHash(assessment.originQuestionHash, 'contextual reuse originQuestionHash'),
    currentQuestionHash: requireHash(assessment.currentQuestionHash, 'contextual reuse currentQuestionHash'),
    comparisonHash: requireHash(assessment.comparisonHash, 'contextual reuse comparisonHash'),
    rationale: compactText(assessment.rationale, 2000)
  };
  if (!normalized.rationale) throw new TypeError('contextual reuse review rationale is required');
  normalized.assessmentHash = await hashJson(normalized);
  return normalized;
};

export const projectDiscoveryTaskContract = (task = {}) => {
  const kind = compactText(task.kind || task.actionKind, 120);
  const targetHash = requireHash(task.targetHash, 'discovery task target');
  const reason = compactText(task.reason);
  const basis = compactText(task.basis, 64) || 'governance';
  const basisHashes = normalizeHashList(task.basisHashes?.length ? task.basisHashes : [targetHash], 'discovery task basis', { min: 1, max: 128 });
  if (!kind || !reason) throw new TypeError('discovery task kind and reason are required');
  if (!['question_anchor', 'governance', 'accepted_memory'].includes(basis)) {
    throw new TypeError('discovery task basis is invalid');
  }
  return {
    schema: 'poolday.discovery_task_contract/v1',
    taskId: stableTaskId(kind, targetHash),
    kind,
    targetHash,
    reason,
    basis,
    basisHashes: [...basisHashes].sort(),
    rankingPolicyId: DISCOVERY_ACTION_VALUE_POLICY.policyId,
    rankingPolicyVersion: DISCOVERY_ACTION_VALUE_POLICY.version,
    rankingMethod: DISCOVERY_ACTION_VALUE_POLICY.method,
    rankingStatus: DISCOVERY_ACTION_VALUE_POLICY.status
  };
};

const normalizeTaskApprovalContract = (taskContract, taskId, targetHash) => {
  const normalized = projectDiscoveryTaskContract(taskContract);
  if (normalized.taskId !== taskId || normalized.targetHash !== targetHash) {
    throw new TypeError('task approval contract does not match its task or target identity');
  }
  if (taskContract?.schema !== normalized.schema
    || taskContract?.rankingPolicyId !== normalized.rankingPolicyId
    || taskContract?.rankingPolicyVersion !== normalized.rankingPolicyVersion
    || taskContract?.rankingMethod !== normalized.rankingMethod
    || taskContract?.rankingStatus !== normalized.rankingStatus) {
    throw new TypeError('task approval contract schema or ranking policy is invalid');
  }
  return normalized;
};

const normalizeConditions = (conditions = {}) => {
  const normalized = {
    organism: compactText(conditions.organism, 240),
    biologicalSystem: compactText(conditions.biologicalSystem || conditions.system, 500),
    cellType: compactText(conditions.cellType, 240),
    compartment: compactText(conditions.compartment, 240),
    background: compactText(conditions.background, 500),
    variant: compactText(conditions.variant, 500),
    partners: normalizeTextList(conditions.partners, { max: 32, itemMax: 240 }),
    ligands: normalizeTextList(conditions.ligands, { max: 32, itemMax: 240 }),
    modifications: normalizeTextList(conditions.modifications, { max: 32, itemMax: 240 }),
    concentration: compactText(conditions.concentration, 240),
    temperature: compactText(conditions.temperature, 120),
    pH: compactText(conditions.pH, 120),
    timepoint: compactText(conditions.timepoint, 240),
    notes: compactText(conditions.notes, 2000)
  };
  return normalized;
};

const conditionsHaveContent = (conditions = {}) => Object.values(conditions).some((value) => (
  Array.isArray(value) ? value.length > 0 : Boolean(value)
));

const normalizeUncertainty = (uncertainty = {}) => ({
  method: compactText(uncertainty.method, 240),
  value: Number.isFinite(Number(uncertainty.value)) ? Number(uncertainty.value) : null,
  unit: compactText(uncertainty.unit, 120),
  interval: compactText(uncertainty.interval, 240),
  description: compactText(uncertainty.description, 2000)
});

const normalizeReferenceIdentity = (reference = {}, label = 'reference') => {
  const normalized = {
    uri: compactText(reference.uri || reference.url, 2000),
    accession: compactText(reference.accession, 240),
    version: compactText(reference.version, 240),
    contentHash: compactText(reference.contentHash, 160)
  };
  if (normalized.uri) {
    const url = new URL(normalized.uri);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`${label} URI must use http or https`);
    normalized.uri = url.href;
  }
  if (!normalized.uri && !normalized.accession) throw new TypeError(`${label} URI or accession is required`);
  if (!normalized.version && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} requires a version or content hash`);
  }
  if (normalized.contentHash && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} content hash must be a SHA-256 identity`);
  }
  return normalized;
};

const requiredInteger = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) throw new TypeError(`${label} must be an integer`);
  return normalized;
};

const normalizeProteinAnnotationIdentity = async (annotation = {}) => {
  const scope = compactText(annotation.scope || annotation.type, 40).toLowerCase();
  if (!PROTEIN_ANNOTATION_SCOPES.includes(scope)) {
    throw new TypeError('protein annotation scope must be family or domain');
  }
  const ontology = {
    namespace: compactText(annotation.ontology?.namespace, 240),
    termId: compactText(annotation.ontology?.termId || annotation.ontology?.accession, 240),
    version: compactText(annotation.ontology?.version, 240),
    label: compactText(annotation.ontology?.label, 500)
  };
  if (!ontology.namespace || !ontology.termId || !ontology.version) {
    throw new TypeError('protein annotation ontology namespace, term id, and version are required');
  }
  const sequence = {
    hash: compactText(annotation.sequence?.hash || annotation.sequenceHash, 160).toLowerCase(),
    length: requiredInteger(annotation.sequence?.length ?? annotation.sequenceLength, 'protein annotation sequence length')
  };
  if (!SHA256_PATTERN.test(sequence.hash)) throw new TypeError('protein annotation sequence hash must be a SHA-256 identity');
  if (sequence.length < 1) throw new TypeError('protein annotation sequence length must be positive');

  const sourceSystem = compactText(
    annotation.coordinates?.sourceSystem || annotation.coordinates?.system || annotation.coordinateSystem,
    80
  ).toLowerCase();
  if (!PROTEIN_ANNOTATION_COORDINATE_SYSTEMS.includes(sourceSystem)) {
    throw new TypeError('protein annotation source coordinate system is invalid');
  }
  const sourceStart = requiredInteger(
    annotation.coordinates?.sourceStart ?? annotation.coordinates?.start ?? annotation.start,
    'protein annotation coordinate start'
  );
  const sourceEnd = requiredInteger(
    annotation.coordinates?.sourceEnd ?? annotation.coordinates?.end ?? annotation.end,
    'protein annotation coordinate end'
  );
  const start = sourceSystem === 'protein_residue_zero_based_half_open' ? sourceStart + 1 : sourceStart;
  const end = sourceEnd;
  if (sourceSystem === 'protein_residue_zero_based_half_open' && (sourceStart < 0 || sourceEnd <= sourceStart)) {
    throw new TypeError('zero-based half-open protein annotation coordinates are invalid');
  }
  if (sourceSystem === 'protein_residue_one_based_closed' && (sourceStart < 1 || sourceEnd < sourceStart)) {
    throw new TypeError('one-based closed protein annotation coordinates are invalid');
  }
  if (end > sequence.length) throw new TypeError('protein annotation coordinates exceed the bound sequence');
  const normalized = {
    schema: PROTEIN_ANNOTATION_IDENTITY_VERSION,
    scope,
    ontology,
    sequence,
    coordinates: {
      sourceSystem,
      sourceStart,
      sourceEnd,
      canonicalSystem: CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
      start,
      end
    }
  };
  normalized.identityHash = await hashJson(normalized);
  return normalized;
};

const nonNegativeNumber = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new TypeError(`${label} must be a non-negative number`);
  return normalized;
};

const normalizeAdjudicationMetricDefinitions = (metrics = []) => {
  const normalized = (Array.isArray(metrics) ? metrics : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const confidenceLevel = Number(metric.confidenceLevel);
    const definition = {
      id: compactText(metric.id, 120),
      label: compactText(metric.label, 500),
      unit: compactText(metric.unit, 120),
      direction,
      measurementSource: compactText(metric.measurementSource, 1000),
      aggregationRule: compactText(metric.aggregationRule, 1000),
      validityConditions: normalizeTextList(metric.validityConditions, {
        min: 1,
        max: 32,
        itemMax: 1000,
        label: `adjudication metric ${index + 1} validity conditions`
      }),
      noiseModel: compactText(metric.noiseModel, 1000),
      minimumSampleSize: requiredInteger(metric.minimumSampleSize, `adjudication metric ${index + 1} minimum sample size`),
      confidenceLevel
    };
    if (!definition.id || !definition.label || !definition.unit
      || !['higher_is_better', 'lower_is_better'].includes(direction)
      || !definition.measurementSource || !definition.aggregationRule || !definition.noiseModel
      || !Number.isFinite(confidenceLevel) || confidenceLevel <= 0 || confidenceLevel > 1) {
      throw new TypeError(`adjudication metric ${index + 1} definition is incomplete`);
    }
    if (definition.minimumSampleSize < 2) throw new TypeError(`adjudication metric ${index + 1} minimum sample size must be at least 2`);
    return definition;
  });
  if (normalized.length < 2) throw new TypeError('adjudication experiment requires quality and effort metrics');
  if (new Set(normalized.map((metric) => metric.id)).size !== normalized.length) {
    throw new TypeError('adjudication metric ids must be unique');
  }
  return normalized;
};

const normalizeAdjudicationExperimentContract = async (experiment = {}) => {
  const declaredSchema = compactText(experiment.schema, 120);
  if (declaredSchema
    && ![
      LEGACY_ADJUDICATION_EXPERIMENT_VERSION,
      BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION,
      ADJUDICATION_EXPERIMENT_VERSION
    ].includes(declaredSchema)) {
    throw new TypeError('adjudication experiment schema is not supported');
  }
  const schema = declaredSchema || ADJUDICATION_EXPERIMENT_VERSION;
  const legacy = schema === LEGACY_ADJUDICATION_EXPERIMENT_VERSION;
  const northStarRequired = schema === ADJUDICATION_EXPERIMENT_VERSION;
  const target = {
    catalogId: compactText(experiment.target?.catalogId, 240),
    catalogVersion: compactText(experiment.target?.catalogVersion, 240),
    curatorRole: compactText(experiment.target?.curatorRole, 500),
    decision: compactText(experiment.target?.decision, 2000),
    disputedEvidencePattern: compactText(experiment.target?.disputedEvidencePattern, 2000),
    actionableOutput: compactText(experiment.target?.actionableOutput, 2000),
    adopterOrPayer: compactText(experiment.target?.adopterOrPayer, 1000)
  };
  if (Object.values(target).some((value) => !value)) {
    throw new TypeError('adjudication target requires catalog, curator role, decision, disputed evidence, output, and adopter or payer');
  }
  const baseline = {
    workflowId: compactText(experiment.baseline?.workflowId, 240),
    version: compactText(experiment.baseline?.version, 240),
    revisionHash: requireHash(experiment.baseline?.revisionHash, 'baseline workflow revisionHash'),
    description: compactText(experiment.baseline?.description, 2000),
    toolsAndHandoffs: normalizeTextList(experiment.baseline?.toolsAndHandoffs, {
      min: 1,
      max: 32,
      itemMax: 1000,
      label: 'baseline tools and handoffs'
    })
  };
  if (!baseline.workflowId || !baseline.version || !baseline.description) {
    throw new TypeError('adjudication baseline workflow id, version, and description are required');
  }
  if (!legacy) {
    const actionSelection = {
      policyId: compactText(experiment.baseline?.actionSelection?.policyId, 240),
      version: compactText(experiment.baseline?.actionSelection?.version, 240),
      artifactHash: requireHash(experiment.baseline?.actionSelection?.artifactHash, 'baseline action-selection artifactHash'),
      inputContractHash: requireHash(experiment.baseline?.actionSelection?.inputContractHash, 'baseline action-selection inputContractHash'),
      budgetContractHash: requireHash(experiment.baseline?.actionSelection?.budgetContractHash, 'baseline action-selection budgetContractHash'),
      rankingMethod: compactText(experiment.baseline?.actionSelection?.rankingMethod, 1000),
      rankingStatus: compactText(experiment.baseline?.actionSelection?.rankingStatus, 80).toLowerCase(),
      eligibleActionKinds: unique(normalizeTextList(experiment.baseline?.actionSelection?.eligibleActionKinds, {
        min: 1,
        max: DISCOVERY_CANDIDATE_ACTION_KINDS.length,
        itemMax: 80,
        label: 'baseline eligible action kinds'
      }).map((kind) => kind.toLowerCase())),
      tieBreak: normalizeTextList(experiment.baseline?.actionSelection?.tieBreak, {
        min: 1,
        max: 16,
        itemMax: 240,
        label: 'baseline action-selection tie break'
      }),
      stopRule: compactText(experiment.baseline?.actionSelection?.stopRule, 2000)
    };
    if (!actionSelection.policyId || !actionSelection.version || !actionSelection.rankingMethod
      || !['heuristic_not_calibrated', 'calibrated'].includes(actionSelection.rankingStatus)
      || !actionSelection.stopRule) {
      throw new TypeError('baseline action-selection policy identity, ranking, status, and stop rule are required');
    }
    if (actionSelection.eligibleActionKinds.some((kind) => !DISCOVERY_CANDIDATE_ACTION_KINDS.includes(kind))) {
      throw new TypeError('baseline action-selection policy contains an unsupported action kind');
    }
    baseline.actionSelection = actionSelection;
  }
  const candidate = {
    policyId: compactText(experiment.candidate?.policyId, 240),
    version: compactText(experiment.candidate?.version, 240),
    revisionHash: requireHash(experiment.candidate?.revisionHash, 'candidate policy revisionHash')
  };
  if (!candidate.policyId || !candidate.version) throw new TypeError('candidate policy id and version are required');
  const manifest = normalizeReferenceIdentity(experiment.cohort?.manifest, 'adjudication cohort manifest');
  if (!manifest.contentHash) throw new TypeError('adjudication cohort manifest requires a content hash');
  const cohort = {
    manifest,
    caseCount: requiredInteger(experiment.cohort?.caseCount, 'adjudication cohort case count'),
    familySplitHash: requireHash(experiment.cohort?.familySplitHash, 'adjudication cohort family split hash'),
    allocationHash: requireHash(experiment.cohort?.allocationHash, 'adjudication cohort allocation hash'),
    familyDisjoint: experiment.cohort?.familyDisjoint === true
  };
  if (cohort.caseCount < 2) throw new TypeError('adjudication cohort requires at least two cases');
  if (!cohort.familyDisjoint) throw new TypeError('adjudication cohort must declare a family-disjoint evaluation split');
  const evaluator = {
    authority: compactText(experiment.evaluator?.authority, 500),
    identityRootId: compactText(experiment.evaluator?.identityRootId, 500),
    methodId: compactText(experiment.evaluator?.methodId, 240),
    version: compactText(experiment.evaluator?.version, 240),
    artifactHash: requireHash(experiment.evaluator?.artifactHash, 'adjudication evaluator artifactHash'),
    blinded: experiment.evaluator?.blinded === true
  };
  if (!evaluator.authority || !evaluator.identityRootId || !evaluator.methodId || !evaluator.version || !evaluator.blinded) {
    throw new TypeError('adjudication evaluator authority, identity root, method, version, and blinding are required');
  }
  const metrics = normalizeAdjudicationMetricDefinitions(experiment.metrics);
  if (metrics.some((metric) => metric.minimumSampleSize > cohort.caseCount)) {
    throw new TypeError('adjudication metric minimum sample size exceeds the frozen cohort');
  }
  const metricIds = new Set(metrics.map((metric) => metric.id));
  let measurementPlan;
  if (!legacy) {
    measurementPlan = {
      schema: ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION,
      ...Object.fromEntries(Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).map((role) => [
        role,
        compactText(experiment.measurementPlan?.[role], 120)
      ]))
    };
    const campaignMetricIds = Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES)
      .map((role) => measurementPlan[role]);
    if (campaignMetricIds.some((metricId) => !metricIds.has(metricId))) {
      throw new TypeError('campaign measurement plan must map every role to a frozen metric');
    }
    if (new Set(campaignMetricIds).size !== campaignMetricIds.length) {
      throw new TypeError('campaign measurement roles must use distinct metrics');
    }
    const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
    for (const [role, direction] of Object.entries(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES)) {
      if (metricsById.get(measurementPlan[role])?.direction !== direction) {
        throw new TypeError(`campaign measurement ${role} must be ${direction}`);
      }
    }
  }
  const successPolicy = {
    mode: 'quality_or_effort',
    qualityMetricId: compactText(experiment.successPolicy?.qualityMetricId, 120),
    effortMetricId: compactText(experiment.successPolicy?.effortMetricId, 120),
    qualityImprovementThreshold: nonNegativeNumber(experiment.successPolicy?.qualityImprovementThreshold, 'quality improvement threshold'),
    qualityNonInferiorityMargin: nonNegativeNumber(experiment.successPolicy?.qualityNonInferiorityMargin, 'quality non-inferiority margin'),
    effortImprovementThreshold: nonNegativeNumber(experiment.successPolicy?.effortImprovementThreshold, 'effort improvement threshold'),
    effortComparabilityMargin: nonNegativeNumber(experiment.successPolicy?.effortComparabilityMargin, 'effort comparability margin')
  };
  if (successPolicy.qualityMetricId === successPolicy.effortMetricId
    || !metricIds.has(successPolicy.qualityMetricId)
    || !metricIds.has(successPolicy.effortMetricId)) {
    throw new TypeError('adjudication success policy requires distinct declared quality and effort metrics');
  }
  if (!legacy) {
    const distinctTradeoffIds = new Set([
      successPolicy.qualityMetricId,
      successPolicy.effortMetricId,
      ...Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).map((role) => measurementPlan[role]),
      ...(northStarRequired ? [compactText(experiment.northStarPolicy?.costToReplicatedConclusionMetricId, 120)] : [])
    ]);
    const requiredDistinctMetrics = 2 + Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).length
      + (northStarRequired ? 1 : 0);
    if (distinctTradeoffIds.size !== requiredDistinctMetrics) {
      throw new TypeError('quality, effort, campaign, and north-star measurement roles must remain a distinct tradeoff vector');
    }
  }
  const northStarPolicy = northStarRequired
    ? await normalizeAdjudicationNorthStarPolicy(experiment.northStarPolicy, {
      metricDefinitions: metrics,
      cohortCaseCount: cohort.caseCount
    })
    : null;
  const resolution = {
    acceptanceRule: compactText(experiment.resolution?.acceptanceRule, 2000),
    rejectionRule: compactText(experiment.resolution?.rejectionRule, 2000),
    reopeningRule: compactText(experiment.resolution?.reopeningRule, 2000)
  };
  if (Object.values(resolution).some((value) => !value)) {
    throw new TypeError('adjudication acceptance, rejection, and reopening rules are required');
  }
  const frozenAt = compactText(experiment.frozenAt, 64);
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('adjudication experiment frozenAt must be an ISO timestamp');
  let outcomeBoundary;
  let comparison;
  if (!legacy) {
    const mode = compactText(experiment.outcomeBoundary?.mode, 80).toLowerCase();
    const accessAtFreeze = compactText(experiment.outcomeBoundary?.accessAtFreeze, 80).toLowerCase();
    const evidenceCutoffAt = compactText(experiment.outcomeBoundary?.evidenceCutoffAt, 64);
    const commitment = compactText(experiment.outcomeBoundary?.outcomeManifestCommitmentHash, 160);
    if (!['historical_hidden', 'prospective_future'].includes(mode)) {
      throw new TypeError('outcome boundary mode must be historical_hidden or prospective_future');
    }
    if ((mode === 'historical_hidden' && accessAtFreeze !== 'blinded')
      || (mode === 'prospective_future' && accessAtFreeze !== 'not_available')) {
      throw new TypeError('outcome access at freeze does not match the declared boundary mode');
    }
    if (!Number.isFinite(Date.parse(evidenceCutoffAt)) || Date.parse(evidenceCutoffAt) > Date.parse(frozenAt)) {
      throw new TypeError('outcome evidence cutoff must be an ISO timestamp no later than the freeze');
    }
    if (mode === 'historical_hidden' && !SHA256_PATTERN.test(commitment)) {
      throw new TypeError('historical hidden outcomes require a committed outcome manifest hash');
    }
    if (mode === 'prospective_future' && commitment) {
      throw new TypeError('prospective future outcomes cannot declare an existing outcome manifest commitment');
    }
    outcomeBoundary = {
      mode,
      accessAtFreeze,
      evidenceCutoffAt,
      outcomeManifestCommitmentHash: commitment || null,
      revealRule: compactText(experiment.outcomeBoundary?.revealRule, 2000),
      contaminationAuditMethod: compactText(experiment.outcomeBoundary?.contaminationAuditMethod, 1000),
      contaminationAuditArtifactHash: requireHash(
        experiment.outcomeBoundary?.contaminationAuditArtifactHash,
        'outcome contamination-audit artifactHash'
      )
    };
    if (!outcomeBoundary.revealRule || !outcomeBoundary.contaminationAuditMethod) {
      throw new TypeError('outcome reveal rule and contamination audit method are required');
    }
    comparison = {
      pairedTasks: experiment.comparison?.pairedTasks === true,
      sameInputOrder: experiment.comparison?.sameInputOrder === true,
      sameEvidenceCutoff: experiment.comparison?.sameEvidenceCutoff === true,
      resourceBudgetHash: requireHash(experiment.comparison?.resourceBudgetHash, 'comparison resourceBudgetHash'),
      failurePolicyHash: requireHash(experiment.comparison?.failurePolicyHash, 'comparison failurePolicyHash'),
      timeoutPolicyHash: requireHash(experiment.comparison?.timeoutPolicyHash, 'comparison timeoutPolicyHash'),
      seedManifestHash: requireHash(experiment.comparison?.seedManifestHash, 'comparison seedManifestHash')
    };
    if (!comparison.pairedTasks || !comparison.sameInputOrder || !comparison.sameEvidenceCutoff) {
      throw new TypeError('adjudication comparison must pair tasks, input order, and evidence cutoff');
    }
  }
  const normalized = {
    schema,
    state: 'frozen',
    target,
    baseline,
    candidate,
    cohort,
    ...(!legacy ? { outcomeBoundary, comparison } : {}),
    evaluator,
    metrics,
    ...(!legacy ? { measurementPlan } : {}),
    ...(northStarPolicy ? { northStarPolicy } : {}),
    successPolicy,
    resolution,
    frozenAt
  };
  normalized.contractHash = await hashJson(normalized);
  return normalized;
};

const adjudicationMetricResult = (definition, result = {}, index = 0) => {
  for (const [value, label] of [
    [result.baselineValue, 'baseline value'],
    [result.candidateValue, 'candidate value'],
    [result.effectInterval?.lower, 'effect interval lower bound'],
    [result.effectInterval?.upper, 'effect interval upper bound']
  ]) {
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new TypeError(`adjudication metric result ${index + 1} ${label} is required`);
    }
  }
  const baselineValue = Number(result.baselineValue);
  const candidateValue = Number(result.candidateValue);
  const pairedSampleCount = requiredInteger(result.pairedSampleCount, `adjudication metric result ${index + 1} paired sample count`);
  const lower = Number(result.effectInterval?.lower);
  const upper = Number(result.effectInterval?.upper);
  if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)
    || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    throw new TypeError(`adjudication metric result ${index + 1} values or effect interval are invalid`);
  }
  const effect = definition.direction === 'higher_is_better'
    ? candidateValue - baselineValue
    : baselineValue - candidateValue;
  if (effect < lower || effect > upper) throw new TypeError(`adjudication metric result ${index + 1} effect is outside its interval`);
  return {
    metricId: definition.id,
    direction: definition.direction,
    baselineValue,
    candidateValue,
    orientedEffect: effect,
    effectInterval: { lower, upper },
    pairedSampleCount,
    minimumSampleSize: definition.minimumSampleSize,
    confidenceLevel: definition.confidenceLevel,
    sampleAdequate: pairedSampleCount >= definition.minimumSampleSize
  };
};

const assessAdjudicationExperiment = (experiment, metricResults, northStarEvidence = null) => {
  const byId = new Map(metricResults.map((metric) => [metric.metricId, metric]));
  const policy = experiment.successPolicy;
  const quality = byId.get(policy.qualityMetricId);
  const effort = byId.get(policy.effortMetricId);
  const evaluable = Boolean(quality?.sampleAdequate && effort?.sampleAdequate);
  const qualityImproved = evaluable && quality.effectInterval.lower >= policy.qualityImprovementThreshold;
  const qualityNonInferior = evaluable && quality.effectInterval.lower >= -policy.qualityNonInferiorityMargin;
  const effortImproved = evaluable && effort.effectInterval.lower >= policy.effortImprovementThreshold;
  const effortComparable = evaluable && effort.effectInterval.lower >= -policy.effortComparabilityMargin;
  const qualityPathPassed = qualityImproved && effortComparable;
  const effortPathPassed = effortImproved && qualityNonInferior;
  const baseAssessment = {
    mode: policy.mode,
    conclusion: !evaluable ? 'inconclusive' : qualityPathPassed || effortPathPassed ? 'passes' : 'fails',
    qualityImproved,
    qualityNonInferior,
    effortImproved,
    effortComparable,
    qualityPathPassed,
    effortPathPassed
  };
  if (experiment.northStarPolicy?.schema !== ADJUDICATION_NORTH_STAR_POLICY_VERSION) {
    return baseAssessment;
  }
  const northStarMetric = byId.get(experiment.northStarPolicy.costToReplicatedConclusionMetricId);
  const northStarReportable = northStarEvidence?.schema === ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
    && northStarEvidence.reportingStatus === 'reportable';
  const northStarImproved = northStarReportable
    && northStarMetric?.sampleAdequate === true
    && northStarMetric.effectInterval.lower
      >= experiment.northStarPolicy.aggregation.minimumImprovementThreshold;
  const qualityOrEffortPassed = qualityPathPassed || effortPathPassed;
  return {
    ...baseAssessment,
    conclusion: !evaluable || !northStarReportable || !northStarMetric?.sampleAdequate
      ? 'inconclusive'
      : qualityOrEffortPassed && northStarImproved ? 'passes' : 'fails',
    qualityOrEffortPassed,
    northStarReportable,
    northStarImproved,
    northStarMetricId: experiment.northStarPolicy.costToReplicatedConclusionMetricId,
    operationalMetricsAffectSuccess: false
  };
};

const normalizeDiscoveryCheckpoint = async (checkpoint = {}, roomId) => {
  const questionHash = requireHash(checkpoint.questionHash, 'discovery checkpoint questionHash');
  const policyId = compactText(checkpoint.policyId, 240);
  if (!policyId) throw new TypeError('discovery checkpoint policyId is required');
  const projection = {
    id: compactText(checkpoint.projection?.id, 240),
    artifactHash: requireHash(checkpoint.projection?.artifactHash, 'discovery checkpoint projection artifactHash')
  };
  const stateSchemaByProjection = {
    [LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID]: LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
    [DISCOVERY_CONTRACT_PROJECTION_ID]: DISCOVERY_CONTRACT_STATE_VERSION
  };
  if (!stateSchemaByProjection[projection.id]) {
    throw new TypeError('discovery checkpoint projection id is unsupported');
  }
  const inputRecordHashes = normalizeHashList(checkpoint.inputRecordHashes, 'discovery checkpoint inputs', {
    min: 1,
    max: 1000
  });
  const activeInputRecordHashes = normalizeHashList(
    checkpoint.activeInputRecordHashes,
    'discovery checkpoint active inputs',
    { min: 1, max: 1000 }
  );
  if (!activeInputRecordHashes.every((hash) => inputRecordHashes.includes(hash))) {
    throw new TypeError('discovery checkpoint active inputs must be part of the complete input set');
  }
  if (!activeInputRecordHashes.includes(questionHash)) {
    throw new TypeError('discovery checkpoint question must remain an active input');
  }
  const parentCheckpointHashes = normalizeHashList(
    checkpoint.parentCheckpointHashes,
    'discovery checkpoint parents',
    { max: 32 }
  );
  const contractIdentity = {
    schema: 'poolday.discovery_contract_identity/v1',
    roomId: normalizeRoomId(roomId),
    questionHash,
    policyId
  };
  const contractId = await hashJson(contractIdentity);
  if (checkpoint.contractId && checkpoint.contractId !== contractId) {
    throw new TypeError('discovery checkpoint contractId does not match its question, room, and policy');
  }
  const state = clone(checkpoint.state);
  if (!state || state.schema !== stateSchemaByProjection[projection.id]
    || !['open', 'reopened'].includes(state.status)
    || state.contractId !== contractId
    || state.questionHash !== questionHash
    || state.policyId !== policyId) {
    throw new TypeError('discovery checkpoint state identity or status is invalid');
  }
  const normalized = {
    schema: DISCOVERY_CHECKPOINT_VERSION,
    contractId,
    questionHash,
    policyId,
    parentCheckpointHashes,
    projection,
    inputRecordHashes,
    inputSetHash: await hashJson(inputRecordHashes),
    activeInputRecordHashes,
    activeInputSetHash: await hashJson(activeInputRecordHashes),
    state,
    stateHash: await hashJson(state)
  };
  return normalized;
};

const normalizeTransformations = (values = []) => (Array.isArray(values) ? values : []).slice(0, 32).map((value, index) => {
  const normalized = {
    id: compactText(value.id || value.name, 240),
    version: compactText(value.version, 120),
    parametersHash: compactText(value.parametersHash, 160),
    description: compactText(value.description, 1000)
  };
  if (!normalized.id || !normalized.version) throw new TypeError(`transformation ${index + 1} requires id and version`);
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) {
    throw new TypeError(`transformation ${index + 1} parametersHash must be a SHA-256 identity`);
  }
  return normalized;
});

const normalizePublicProteinEvidenceFinding = (evidenceKind, finding = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  const defaults = kind === 'negative_result'
    ? { classification: 'negative', status: 'completed', failureCategory: 'none' }
    : kind === 'failed_attempt'
      ? { classification: 'not_observed', status: 'failed', failureCategory: '' }
      : ['assay'].includes(kind)
        ? { classification: '', status: 'completed', failureCategory: 'none' }
        : { classification: 'not_applicable', status: 'not_applicable', failureCategory: 'none' };
  const normalized = {
    classification: compactText(finding.classification, 40).toLowerCase() || defaults.classification,
    attempt: {
      status: compactText(finding.attempt?.status || finding.attemptStatus, 40).toLowerCase() || defaults.status,
      failureCategory: compactText(
        finding.attempt?.failureCategory || finding.failureCategory,
        80
      ).toLowerCase() || defaults.failureCategory
    }
  };
  if (!PUBLIC_PROTEIN_EVIDENCE_FINDINGS.includes(normalized.classification)) {
    throw new TypeError('public protein evidence finding classification is invalid');
  }
  if (!['not_applicable', 'completed', 'failed'].includes(normalized.attempt.status)) {
    throw new TypeError('public protein evidence attempt status is invalid');
  }
  if (!RESEARCH_FAILURE_CATEGORIES.includes(normalized.attempt.failureCategory)) {
    throw new TypeError('public protein evidence failure category is invalid');
  }
  if (kind === 'assay'
    && (!['positive', 'negative', 'ambiguous'].includes(normalized.classification)
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('assay evidence requires a completed positive, negative, or ambiguous finding');
  }
  if (kind === 'negative_result'
    && (normalized.classification !== 'negative'
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('negative-result evidence requires a completed negative finding');
  }
  if (kind === 'failed_attempt'
    && (normalized.classification !== 'not_observed'
      || normalized.attempt.status !== 'failed'
      || normalized.attempt.failureCategory === 'none')) {
    throw new TypeError('failed-attempt evidence requires a named failure category and no claimed observation');
  }
  if (!['assay', 'negative_result', 'failed_attempt'].includes(kind)
    && (normalized.classification !== 'not_applicable'
      || normalized.attempt.status !== 'not_applicable'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('non-assay public evidence cannot claim an assay finding');
  }
  return normalized;
};

const normalizePublicProteinEvidenceProfile = ({
  evidenceKind,
  conditions,
  transformations,
  provenance,
  finding
} = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  if (!PUBLIC_PROTEIN_EVIDENCE_KINDS.includes(kind)) {
    throw new TypeError('public protein evidence kind is not supported');
  }
  if (!conditionsHaveContent(conditions)) {
    throw new TypeError('public protein evidence requires an explicit condition declaration');
  }
  if (!Array.isArray(transformations) || transformations.length === 0) {
    throw new TypeError('public protein evidence requires at least one versioned transformation');
  }
  if (!compactText(provenance?.sourceIdentity, 500)) {
    throw new TypeError('public protein evidence source identity is required');
  }
  if (!compactText(provenance?.license, 240)) {
    throw new TypeError('public protein evidence license is required');
  }
  if (!compactText(provenance?.retrievalMethod, 500)
    || !Number.isFinite(Date.parse(provenance?.retrievedAt || ''))) {
    throw new TypeError('public protein evidence retrieval provenance is incomplete');
  }
  return {
    schema: PUBLIC_PROTEIN_EVIDENCE_VERSION,
    access: 'public',
    finding: normalizePublicProteinEvidenceFinding(kind, finding)
  };
};

const normalizeAnalysisIdentity = async (analysis = {}) => {
  const normalized = {
    methodId: compactText(analysis.methodId || analysis.id, 240),
    version: compactText(analysis.version, 120),
    artifactHash: compactText(analysis.artifactHash, 160),
    parametersHash: compactText(analysis.parametersHash, 160),
    runtimeIdentity: compactText(analysis.runtimeIdentity, 500),
    lineageHashes: normalizeHashList(analysis.lineageHashes || [], 'analysis lineage', { max: 64 })
  };
  if (!normalized.methodId || !normalized.version) throw new TypeError('analysis method id and version are required');
  if (normalized.artifactHash && !SHA256_PATTERN.test(normalized.artifactHash)) throw new TypeError('analysis artifactHash must be a SHA-256 identity');
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) throw new TypeError('analysis parametersHash must be a SHA-256 identity');
  normalized.analysisHash = await hashJson(normalized);
  return normalized;
};

const resolutionCount = (value, label, { min = 0, max = 100 } = {}) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new TypeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return count;
};

const normalizeResolutionOutcomeRule = (rule = {}, label) => {
  const outcomeClassifications = normalizeTextList(rule.outcomeClassifications, {
    min: 1, max: 2, itemMax: 40, label: `${label} outcome classifications`
  }).map((entry) => entry.toLowerCase());
  if (new Set(outcomeClassifications).size !== outcomeClassifications.length
    || outcomeClassifications.some((entry) => !['positive', 'negative'].includes(entry))) {
    throw new TypeError(`${label} outcome classifications must be unique positive or negative values`);
  }
  const uncertainty = {
    methodId: compactText(rule.uncertainty?.methodId, 240),
    version: compactText(rule.uncertainty?.version, 120),
    metricId: compactText(rule.uncertainty?.metricId, 240),
    maximumValue: Number(rule.uncertainty?.maximumValue),
    unit: compactText(rule.uncertainty?.unit, 120)
  };
  if (!uncertainty.methodId || !uncertainty.version || !uncertainty.metricId
    || !Number.isFinite(uncertainty.maximumValue) || uncertainty.maximumValue < 0 || !uncertainty.unit) {
    throw new TypeError(`${label} requires a versioned non-negative uncertainty threshold`);
  }
  return {
    outcomeClassifications,
    minimumAcceptedCompletedOutcomes: resolutionCount(
      rule.minimumAcceptedCompletedOutcomes,
      `${label} minimum accepted completed outcomes`,
      { min: 1 }
    ),
    minimumIndependentReplications: resolutionCount(
      rule.minimumIndependentReplications,
      `${label} minimum independent replications`
    ),
    maximumAmbiguousOutcomes: resolutionCount(
      rule.maximumAmbiguousOutcomes,
      `${label} maximum ambiguous outcomes`
    ),
    requiredDistinctReviewerIdentities: resolutionCount(
      rule.requiredDistinctReviewerIdentities,
      `${label} required distinct reviewer identities`,
      { min: 1 }
    ),
    requiredControlStatus: 'passed',
    uncertainty
  };
};

const normalizeResearchResolutionPolicy = async (policy = {}) => {
  const provisionalAcceptance = normalizeResolutionOutcomeRule(policy.provisionalAcceptance, 'provisional acceptance');
  const rejection = normalizeResolutionOutcomeRule(policy.rejection, 'rejection');
  if (provisionalAcceptance.outcomeClassifications.some((value) => rejection.outcomeClassifications.includes(value))) {
    throw new TypeError('provisional acceptance and rejection outcome classifications must be disjoint');
  }
  const continuedUncertaintyTriggers = normalizeTextList(policy.continuedUncertainty?.triggers, {
    min: 1,
    max: RESOLUTION_UNCERTAINTY_TRIGGERS.length,
    itemMax: 80,
    label: 'continued uncertainty triggers'
  }).map((entry) => entry.toLowerCase());
  if (new Set(continuedUncertaintyTriggers).size !== continuedUncertaintyTriggers.length
    || continuedUncertaintyTriggers.some((trigger) => !RESOLUTION_UNCERTAINTY_TRIGGERS.includes(trigger))) {
    throw new TypeError('continued uncertainty triggers must be unique supported values');
  }
  const reopeningTriggers = normalizeTextList(policy.reopening?.triggers, {
    min: RESOLUTION_REOPEN_TRIGGERS.length,
    max: RESOLUTION_REOPEN_TRIGGERS.length,
    itemMax: 80,
    label: 'resolution reopening triggers'
  }).map((entry) => entry.toLowerCase());
  if (!sameStringSet(reopeningTriggers, RESOLUTION_REOPEN_TRIGGERS)) {
    throw new TypeError('resolution reopening criteria must include every mandatory trigger');
  }
  const closure = {
    minimumAcceptedCompletedOutcomes: resolutionCount(
      policy.closure?.minimumAcceptedCompletedOutcomes,
      'closure minimum accepted completed outcomes',
      { min: provisionalAcceptance.minimumAcceptedCompletedOutcomes }
    ),
    minimumIndependentReplications: resolutionCount(
      policy.closure?.minimumIndependentReplications,
      'closure minimum independent replications',
      { min: provisionalAcceptance.minimumIndependentReplications }
    ),
    maximumAmbiguousOutcomes: resolutionCount(
      policy.closure?.maximumAmbiguousOutcomes,
      'closure maximum ambiguous outcomes'
    ),
    requiredDistinctReviewerIdentities: resolutionCount(
      policy.closure?.requiredDistinctReviewerIdentities,
      'closure required distinct reviewer identities',
      { min: Math.max(2, provisionalAcceptance.requiredDistinctReviewerIdentities) }
    ),
    requireAllControlsPassed: policy.closure?.requireAllControlsPassed === true,
    requireNoDisputedReviews: policy.closure?.requireNoDisputedReviews === true,
    requireNoActiveContradictions: policy.closure?.requireNoActiveContradictions === true,
    authority: 'separate_human_closure_checkpoint_required',
    implementationStatus: 'criteria_only_closure_not_implemented'
  };
  if (!closure.requireAllControlsPassed || !closure.requireNoDisputedReviews || !closure.requireNoActiveContradictions) {
    throw new TypeError('closure criteria must require passed controls and no disputed reviews or active contradictions');
  }
  const normalized = {
    schema: RESEARCH_RESOLUTION_POLICY_VERSION,
    state: 'frozen_criteria',
    targetHypothesisHash: requireHash(policy.targetHypothesisHash, 'resolution targetHypothesisHash'),
    conclusionLabel: compactText(policy.conclusionLabel, 500),
    decisionScope: compactText(policy.decisionScope, 2000),
    frozenAt: compactText(policy.frozenAt, 64),
    provisionalAcceptance,
    continuedUncertainty: { triggers: continuedUncertaintyTriggers, state: 'continue_investigation' },
    rejection,
    reopening: { triggers: reopeningTriggers, effect: 'reopen_without_erasing_prior_decision' },
    closure
  };
  if (!normalized.conclusionLabel || !normalized.decisionScope || !Number.isFinite(Date.parse(normalized.frozenAt))) {
    throw new TypeError('resolution conclusion label, decision scope, and frozenAt are required');
  }
  return { ...normalized, criteriaHash: await hashJson(normalized) };
};

const normalizeAssayProtocol = async (protocol = {}) => {
  const normalized = {
    protocolId: compactText(protocol.protocolId || protocol.id, 240),
    version: compactText(protocol.version, 120),
    assayType: compactText(protocol.assayType, 240),
    executableUri: compactText(protocol.executableUri, 2000),
    referenceIdentities: (Array.isArray(protocol.referenceIdentities) ? protocol.referenceIdentities : [])
      .slice(0, 32)
      .map((entry, index) => normalizeReferenceIdentity(entry, `protocol reference ${index + 1}`)),
    conditions: normalizeConditions(protocol.conditions),
    controls: normalizeTextList(protocol.controls, { min: 1, max: 32, itemMax: 500, label: 'assay controls' }),
    readouts: normalizeTextList(protocol.readouts, { min: 1, max: 32, itemMax: 500, label: 'assay readouts' }),
    normalization: {
      method: compactText(protocol.normalization?.method, 240),
      version: compactText(protocol.normalization?.version, 120),
      reference: compactText(protocol.normalization?.reference, 500)
    },
    transformations: normalizeTransformations(protocol.transformations),
    uncertaintyPlan: compactText(protocol.uncertaintyPlan, 2000),
    acceptanceCriteria: compactText(protocol.acceptanceCriteria, 2000)
  };
  if (!normalized.protocolId || !normalized.version || !normalized.assayType) {
    throw new TypeError('protocol id, version, and assay type are required');
  }
  if (!conditionsHaveContent(normalized.conditions)) throw new TypeError('protocol conditions are required');
  if (!normalized.normalization.method || !normalized.normalization.version) {
    throw new TypeError('protocol normalization method and version are required');
  }
  if (!normalized.uncertaintyPlan || !normalized.acceptanceCriteria) {
    throw new TypeError('protocol uncertainty plan and acceptance criteria are required');
  }
  if (normalized.executableUri) {
    const url = new URL(normalized.executableUri);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('protocol executable URI must use http or https');
    normalized.executableUri = url.href;
  }
  return { ...normalized, protocolHash: await hashJson(normalized) };
};

const normalizeResearchWorkOrderContract = async ({
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
} = {}) => {
  const kind = compactText(workKind, 40).toLowerCase();
  if (!RESEARCH_WORK_KINDS.includes(kind)) throw new TypeError('research work kind is not supported');
  const normalizedTitle = compactText(title, 500);
  if (!normalizedTitle) throw new TypeError('work order title is required');
  const replicas = Number(replicaTarget);
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 100) {
    throw new TypeError('replicaTarget must be an integer from 1 to 100');
  }
  const allocationHash = compactText(blindness?.allocationHash, 160);
  if (blindness?.required !== false && !SHA256_PATTERN.test(allocationHash)) {
    throw new TypeError('blinded work requires an allocationHash');
  }
  const normalizedProtocol = await normalizeAssayProtocol(protocol);
  const plannedAnalysis = await normalizeAnalysisIdentity(analysis);
  if (!plannedAnalysis.artifactHash || !plannedAnalysis.parametersHash) {
    throw new TypeError('work order analysis requires exact artifactHash and parametersHash identities');
  }
  const allowedFailureCategories = normalizeTextList(failureCategories, {
    min: 1, max: RESEARCH_FAILURE_CATEGORIES.length - 1, itemMax: 80, label: 'work order failure categories'
  }).map((entry) => entry.toLowerCase());
  if (allowedFailureCategories.includes('none')
    || allowedFailureCategories.some((entry) => !RESEARCH_FAILURE_CATEGORIES.includes(entry))) {
    throw new TypeError('work order failure categories must be supported named failures');
  }
  const custodyPlan = {
    planId: compactText(custody?.planId, 240),
    version: compactText(custody?.version, 120),
    artifactHash: requireHash(custody?.artifactHash, 'work order custody artifactHash'),
    protocolHash: normalizedProtocol.protocolHash,
    requiredRoles: normalizeTextList(custody?.requiredRoles, {
      min: 1, max: LABORATORY_PROTOCOL_CUSTODY_ROLES.length, itemMax: 80, label: 'work order custody roles'
    }).map((entry) => entry.toLowerCase()),
    materialsPolicy: compactText(custody?.materialsPolicy, 1000),
    samplesPolicy: compactText(custody?.samplesPolicy, 1000),
    instrumentsPolicy: compactText(custody?.instrumentsPolicy, 1000)
  };
  if (!custodyPlan.planId || !custodyPlan.version
    || custodyPlan.requiredRoles.some((role) => !LABORATORY_PROTOCOL_CUSTODY_ROLES.includes(role))
    || !custodyPlan.materialsPolicy || !custodyPlan.samplesPolicy || !custodyPlan.instrumentsPolicy) {
    throw new TypeError('work order custody plan, roles, and material, sample, and instrument policies are required');
  }
  const publicationScope = {
    scope: compactText(publication?.scope, 80).toLowerCase(),
    license: compactText(publication?.license, 240),
    publishLaboratoryIdentity: publication?.publishLaboratoryIdentity === true,
    publishQualification: publication?.publishQualification === true,
    publishProtocol: publication?.publishProtocol === true,
    publishRawObservations: publication?.publishRawObservations === true,
    publishFailures: publication?.publishFailures === true
  };
  if (publicationScope.scope !== 'public_complete_record'
    || !publicationScope.license
    || Object.entries(publicationScope).some(([key, value]) => key.startsWith('publish') && value !== true)) {
    throw new TypeError('work order publication must cover the public laboratory, qualification, protocol, raw observations, and failures');
  }
  const requiredDimensions = normalizeTextList(replication?.requiredIndependentDimensions, {
    min: 2,
    max: REPLICATION_INDEPENDENCE_DIMENSIONS.length,
    itemMax: 80,
    label: 'replication independence dimensions'
  }).map((entry) => entry.toLowerCase());
  if (new Set(requiredDimensions).size !== requiredDimensions.length
    || !requiredDimensions.includes('operator_identity')
    || requiredDimensions.some((dimension) => !REPLICATION_INDEPENDENCE_DIMENSIONS.includes(dimension))) {
    throw new TypeError('replication plan requires unique supported dimensions including operator_identity and at least one additional dimension');
  }
  const replicationPlan = {
    requiredIndependentDimensions: requiredDimensions,
    comparisonRule: 'all_declared_dimensions_must_differ',
    sameProtocolRequired: true,
    sameAnalysisRequired: true
  };
  const boundedScope = {
    biologicalInterpretation: compactText(scopeBoundary?.biologicalInterpretation, 120).toLowerCase(),
    medicalUse: compactText(scopeBoundary?.medicalUse, 80).toLowerCase(),
    protocolSafetyClassification: compactText(scopeBoundary?.protocolSafetyClassification, 160).toLowerCase(),
    sampleScope: compactText(scopeBoundary?.sampleScope, 160).toLowerCase(),
    privateSamples: compactText(scopeBoundary?.privateSamples, 80).toLowerCase(),
    laboratoryAuthority: compactText(scopeBoundary?.laboratoryAuthority, 80).toLowerCase(),
    safetyReview: compactText(scopeBoundary?.safetyReview, 120).toLowerCase()
  };
  const requiredScope = {
    biologicalInterpretation: 'evidence_only_no_interpretation_authority',
    medicalUse: 'prohibited',
    protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
    sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
    privateSamples: 'prohibited',
    laboratoryAuthority: 'none',
    safetyReview: 'independent_human_required_before_execution'
  };
  if (JSON.stringify(boundedScope) !== JSON.stringify(requiredScope)) {
    throw new TypeError('work order scope must prohibit biological interpretation authority, medical use, unsafe protocols, private samples, and laboratory authority');
  }
  const normalizedFeasibility = {
    resources: compactText(feasibility?.resources, 2000),
    biosafety: compactText(feasibility?.biosafety, 1000),
    limitations: compactText(feasibility?.limitations, 2000)
  };
  if (!normalizedFeasibility.resources || !normalizedFeasibility.biosafety || !normalizedFeasibility.limitations) {
    throw new TypeError('work order resources, public non-clinical biosafety declaration, and limitations are required');
  }
  const normalized = {
    schema: RESEARCH_WORK_ORDER_CONTRACT_VERSION,
    kind,
    title: normalizedTitle,
    status: 'proposed',
    allocationState: 'unallocated',
    allocationGate: 'independent_acceptance_and_qualified_claim',
    protocol: normalizedProtocol,
    replicaTarget: replicas,
    blindness: {
      required: blindness?.required !== false,
      allocationHash: allocationHash || null,
      revealRule: compactText(blindness?.revealRule, 1000) || 'Reveal only after all planned outcomes are signed.'
    },
    feasibility: normalizedFeasibility,
    plannedAnalysis,
    allowedFailureCategories,
    custody: custodyPlan,
    publication: publicationScope,
    replication: replicationPlan,
    scopeBoundary: boundedScope
  };
  return { ...normalized, contractHash: await hashJson(normalized) };
};

const normalizeExperimentalExecutionContext = (executionContext = {}) => ({
  schema: EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  institutionIdentityHash: requireHash(executionContext.institutionIdentityHash, 'outcome institutionIdentityHash'),
  instrumentIdentityHash: requireHash(executionContext.instrumentIdentityHash, 'outcome instrumentIdentityHash'),
  sampleBatchHash: requireHash(executionContext.sampleBatchHash, 'outcome sampleBatchHash'),
  preparationBatchHash: requireHash(executionContext.preparationBatchHash, 'outcome preparationBatchHash'),
  analysisExecutionHash: requireHash(executionContext.analysisExecutionHash, 'outcome analysisExecutionHash')
});

const normalizeLaboratoryCapabilityClaim = async ({
  laboratory,
  capabilityClaims,
  protocolCustody,
  safety,
  availability,
  consent,
  conflictDisclosure,
  createdAt
} = {}) => {
  const lab = {
    id: compactText(laboratory?.id, 240),
    name: compactText(laboratory?.name, 500),
    institution: compactText(laboratory?.institution, 500),
    institutionIdentityHash: requireHash(laboratory?.institutionIdentityHash, 'laboratory institutionIdentityHash'),
    ror: compactText(laboratory?.ror, 500)
  };
  if (!lab.id || !lab.name || !lab.institution) {
    throw new TypeError('laboratory id, name, and institution are required');
  }
  const capabilities = (Array.isArray(capabilityClaims) ? capabilityClaims : []).slice(0, 32).map((entry, index) => {
    const capability = {
      id: compactText(entry?.id, 240),
      version: compactText(entry?.version, 120),
      evidenceHash: requireHash(entry?.evidenceHash, `laboratory capability ${index + 1} evidenceHash`),
      description: compactText(entry?.description, 1000)
    };
    if (!capability.id || !capability.version || !capability.description) {
      throw new TypeError(`laboratory capability ${index + 1} id, version, and description are required`);
    }
    return capability;
  });
  if (!capabilities.length) throw new TypeError('at least one versioned laboratory capability claim is required');
  const custody = {
    protocolHash: requireHash(protocolCustody?.protocolHash, 'laboratory protocol custody protocolHash'),
    role: compactText(protocolCustody?.role, 80).toLowerCase(),
    evidenceHash: requireHash(protocolCustody?.evidenceHash, 'laboratory protocol custody evidenceHash')
  };
  if (!LABORATORY_PROTOCOL_CUSTODY_ROLES.includes(custody.role)) {
    throw new TypeError('laboratory protocol custody role is invalid');
  }
  const safetyProfile = {
    classification: compactText(safety?.classification, 240),
    oversightAuthority: compactText(safety?.oversightAuthority, 500),
    approvalHash: requireHash(safety?.approvalHash, 'laboratory safety approvalHash'),
    limitations: normalizeTextList(safety?.limitations, {
      min: 1, max: 32, itemMax: 1000, label: 'laboratory safety limitations'
    })
  };
  if (!safetyProfile.classification || !safetyProfile.oversightAuthority) {
    throw new TypeError('laboratory safety classification and oversight authority are required');
  }
  const validFrom = compactText(availability?.validFrom, 64);
  const validUntil = compactText(availability?.validUntil, 64);
  const availabilityProfile = {
    status: compactText(availability?.status, 80).toLowerCase(),
    capacity: compactText(availability?.capacity, 1000),
    validFrom,
    validUntil
  };
  if (!LABORATORY_AVAILABILITY_STATUSES.includes(availabilityProfile.status)
    || !availabilityProfile.capacity
    || !Number.isFinite(Date.parse(validFrom))
    || !Number.isFinite(Date.parse(validUntil))
    || Date.parse(validUntil) < Date.parse(validFrom)
    || !Number.isFinite(Date.parse(createdAt || ''))
    || Date.parse(createdAt) < Date.parse(validFrom)
    || Date.parse(createdAt) > Date.parse(validUntil)) {
    throw new TypeError('laboratory availability status, capacity, and validity interval are required');
  }
  if (consent?.publicLaboratoryIdentity !== true
    || consent?.publishOutcome !== true
    || consent?.publishQualification !== true) {
    throw new TypeError('laboratory identity, qualification, and outcome publication consent are required');
  }
  const normalized = {
    schema: LABORATORY_CAPABILITY_CLAIM_VERSION,
    status: 'claimed',
    laboratory: lab,
    capabilities: capabilities.map((entry) => entry.id),
    capabilityClaims: capabilities,
    protocolCustody: custody,
    safety: safetyProfile,
    availability: availabilityProfile,
    consent: {
      publicLaboratoryIdentity: true,
      publishQualification: true,
      publishOutcome: true,
      acknowledgedAt: compactText(consent?.acknowledgedAt, 64) || createdAt
    },
    conflictDisclosure: compactText(conflictDisclosure, 2000) || 'none declared'
  };
  if (!Number.isFinite(Date.parse(normalized.consent.acknowledgedAt))) {
    throw new TypeError('laboratory consent acknowledgement must be an ISO timestamp');
  }
  return { ...normalized, profileHash: await hashJson(normalized) };
};

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

/**
 * Verify the publication boundary separately from signature and link checks.
 * Historical fixtures may be structurally valid with an unavailable contract,
 * but a new Poolday submission or model result may cite only an enabled exact
 * catalog contract.
 */
export function validateResearchRecordModelAdmission(record = {}) {
  if (![RESEARCH_RECORD_KINDS.submission, RESEARCH_RECORD_KINDS.result].includes(record?.kind)) {
    return { ok: true, reasons: [] };
  }
  return validateEnabledPoolModelContract(record.modelContract);
}

export function researchRecordTargetHashes(record = {}) {
  const targets = [];
  if (record.kind === RESEARCH_RECORD_KINDS.result) targets.push(record.submissionHash);
  if ([RESEARCH_RECORD_KINDS.claim, RESEARCH_RECORD_KINDS.revocation].includes(record.kind)) targets.push(record.targetHash);
  if ([RESEARCH_RECORD_KINDS.hypothesis, RESEARCH_RECORD_KINDS.priorEvidence, RESEARCH_RECORD_KINDS.prediction, RESEARCH_RECORD_KINDS.resolutionPolicy, RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.outcome, RESEARCH_RECORD_KINDS.candidateAction, RESEARCH_RECORD_KINDS.realizedActionValue].includes(record.kind)) {
    targets.push(record.questionHash);
  }
  if (record.kind === RESEARCH_RECORD_KINDS.hypothesis) {
    targets.push(...(record.hypothesis?.priorEvidenceHashes || []), ...(record.hypothesis?.alternativeToHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.prediction) targets.push(record.hypothesisHash);
  if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) targets.push(record.policy?.targetHypothesisHash);
  if ([RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.outcome].includes(record.kind)) targets.push(...(record.hypothesisHashes || []));
  if (record.kind === RESEARCH_RECORD_KINDS.workClaim) targets.push(record.workOrderHash);
  if (record.kind === RESEARCH_RECORD_KINDS.outcome) {
    targets.push(record.workOrderHash, record.workClaimHash, record.replicationOfHash);
  }
  if (record.kind === RESEARCH_RECORD_KINDS.cohort) {
    targets.push(...(record.cohort?.questionHashes || []), ...(record.cohort?.predictionHashes || []), ...(record.cohort?.workOrderHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.evaluation) {
    targets.push(record.cohortHash, ...(record.evaluation?.outcomeHashes || []), ...(record.evaluation?.nextCohortQuestionHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) {
    targets.push(
      record.realizedValue?.candidateActionHash,
      ...(record.realizedValue?.candidateActionApprovalHashes || []),
      record.realizedValue?.evaluationHash,
      ...(record.realizedValue?.evaluationReviewDecisionHashes || []),
      ...(record.realizedValue?.reviewedOutcomes || []).flatMap((entry) => [
        entry.outcomeHash,
        ...(entry.reviewDecisionHashes || [])
      ]),
      ...(record.realizedValue?.contributions || []).map((entry) => entry.recordHash)
    );
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationEvaluation) targets.push(record.experimentHash);
  if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) {
    targets.push(
      ...(record.action?.affectedHypothesisHashes || []),
      ...(record.action?.uncertainty || [])
        .map((entry) => entry.calibration?.cohortHash)
        .filter(Boolean),
      ...(record.action?.expectedValue?.calibrationEvidenceHashes || [])
    );
  }
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    targets.push(record.checkpoint?.questionHash, ...(record.checkpoint?.activeInputRecordHashes || []));
  }
  if (record.kind === RESEARCH_RECORD_KINDS.sequenceLink) {
    targets.push(record.link?.nucleotideSubmissionHash, record.link?.proteinSubmissionHash);
  }
  return unique(targets);
}

export function revokedResearchHashes(records = []) {
  return new Set(records
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.revocation)
    .map((record) => record.targetHash));
}

export function invalidatedResearchHashes(records = []) {
  const invalidated = revokedResearchHashes(records);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (record.kind === RESEARCH_RECORD_KINDS.revocation || invalidated.has(record.recordHash)) continue;
      if (researchRecordTargetHashes(record).some((targetHash) => invalidated.has(targetHash))) {
        invalidated.add(record.recordHash);
        changed = true;
      }
    }
  }
  return invalidated;
}

export function activeResearchRecords(records = []) {
  const invalidated = invalidatedResearchHashes(records);
  return records.filter((record) => record.kind !== RESEARCH_RECORD_KINDS.revocation && !invalidated.has(record.recordHash));
}

const independentReviewDecisions = (records, target) => {
  const invalidated = invalidatedResearchHashes(records);
  return records.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim
    && record.claim?.kind === 'review_decision'
    && record.targetHash === target?.recordHash
    && record.author?.identityRootId !== target?.author?.identityRootId
    && !invalidated.has(record.recordHash));
};

const latestDecisionPerReviewer = (decisions) => {
  const latest = new Map();
  for (const decision of decisions) {
    const reviewerId = decision.author?.identityRootId || decision.author?.roleId || decision.recordHash;
    const previous = latest.get(reviewerId);
    if (!previous
      || String(previous.createdAt || '').localeCompare(String(decision.createdAt || '')) < 0
      || (previous.createdAt === decision.createdAt && previous.recordHash.localeCompare(decision.recordHash) < 0)) {
      latest.set(reviewerId, decision);
    }
  }
  return [...latest.values()].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
    || left.recordHash.localeCompare(right.recordHash));
};

export function projectResearchReviewStates(records = []) {
  const active = activeResearchRecords(records);
  return active.map((record) => {
    const decisions = latestDecisionPerReviewer(independentReviewDecisions(records, record));
    const decisionStates = unique(decisions.map((decision) => decision.claim?.decision).filter(Boolean));
    const state = decisionStates.length === 1 ? decisionStates[0] : decisionStates.length > 1 ? 'disputed' : 'unresolved';
    return {
      recordHash: record.recordHash,
      state,
      disagreement: decisionStates.length > 1,
      replicationRequested: decisionStates.includes('replication_requested'),
      decisionStates,
      decisions
    };
  });
}

/**
 * Returns the only record set eligible for reuse as room memory. Review
 * decisions are independent, revocations propagate, and an accepted
 * correction supersedes its target without erasing immutable history.
 */
export function projectAcceptedResearchMemory(records = []) {
  const invalidated = invalidatedResearchHashes(records);
  const active = activeResearchRecords(records);
  const activeByHash = new Map(active.map((record) => [record.recordHash, record]));
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedCorrections = new Map(active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim)
    .filter((record) => record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')
    .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted')
    .map((record) => [record.targetHash, record.recordHash]));
  const baseMemoryBlockReason = (record) => {
    if (invalidated.has(record.recordHash)) return 'invalidated';
    if (acceptedCorrections.has(record.recordHash)) return 'superseded_by_accepted_correction';
    if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) return 'projection_checkpoint_not_scientific_evidence';
    if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) return 'resolution_policy_is_governance_not_scientific_evidence';
    if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) return 'candidate_action_is_a_governance_proposal';
    if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) return 'realized_action_value_is_evaluation_governance';
    if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.kind === 'candidate_action_approval') {
      return 'candidate_action_approval_is_governance_not_scientific_evidence';
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
      if (['assay', 'negative_result', 'failed_attempt'].includes(record.evidence?.kind)
        && record.evidence?.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        return 'public_evidence_contract_missing';
      }
      if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        try {
          normalizePublicProteinEvidenceProfile({
            evidenceKind: record.evidence.kind,
            conditions: record.evidence.conditions,
            transformations: record.evidence.transformations,
            provenance: record.evidence.provenance,
            finding: record.evidence.finding
          });
        } catch {
          return 'public_evidence_contract_invalid';
        }
        if (['annotation', 'domain'].includes(record.evidence.kind) && !record.evidence.annotation) {
          return 'public_annotation_identity_missing';
        }
        const question = activeByHash.get(record.questionHash);
        if (question?.kind !== RESEARCH_RECORD_KINDS.submission
          || question.consent?.publicSequence !== true
          || question.consent?.publicEvidenceNetwork !== true) {
          return 'public_evidence_consent_missing';
        }
      }
    }
    const reviewState = reviewStates.get(record.recordHash)?.state || 'unreviewed';
    if (reviewState !== 'accepted') return reviewState;
    if (record.kind === RESEARCH_RECORD_KINDS.result
      && !projectResearchExecutionIndependence(record).independentlyExecuted) {
      return 'independent_execution_missing';
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.evidence?.reuseContext) {
      const reuseContext = record.evidence.reuseContext;
      const contextAccepted = (reviewStates.get(record.recordHash)?.decisions || []).some((decision) => (
        decision.claim?.decision === 'accepted'
        && decision.claim?.contextAssessment?.determination === 'relevant'
        && decision.claim.contextAssessment.originRecordHash === reuseContext.originRecordHash
        && decision.claim.contextAssessment.originQuestionHash === reuseContext.origin.questionHash
        && decision.claim.contextAssessment.currentQuestionHash === reuseContext.current.questionHash
        && decision.claim.contextAssessment.comparisonHash === reuseContext.comparisonHash
      ));
      if (!contextAccepted) return 'contextual_relevance_review_missing';
    }
    return null;
  };
  const duplicateSources = new Map();
  const duplicateOf = new Map();
  for (const record of active.filter((entry) => baseMemoryBlockReason(entry) === null)) {
    const sourceHash = record.kind === RESEARCH_RECORD_KINDS.priorEvidence
      ? record.evidence?.reuseContext?.originSource?.identityHash
      : null;
    if (!sourceHash) continue;
    const group = duplicateSources.get(sourceHash) || [];
    group.push(record);
    duplicateSources.set(sourceHash, group);
  }
  for (const group of duplicateSources.values()) {
    if (group.length < 2) continue;
    const ordered = group.slice().sort((left, right) => (
      String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.recordHash || '').localeCompare(String(right.recordHash || ''))
    ));
    for (const duplicate of ordered.slice(1)) duplicateOf.set(duplicate.recordHash, ordered[0].recordHash);
  }
  const memoryBlockReason = (record) => (
    duplicateOf.has(record.recordHash)
      ? 'duplicate_cross_room_source'
      : baseMemoryBlockReason(record)
  );
  const acceptedRecords = active.filter((record) => memoryBlockReason(record) === null);
  const acceptedHashes = acceptedRecords.map((record) => record.recordHash).sort();
  const excluded = records
    .filter((record) => record.kind !== RESEARCH_RECORD_KINDS.revocation)
    .filter((record) => !acceptedHashes.includes(record.recordHash))
    .map((record) => ({
      recordHash: record.recordHash,
      reason: memoryBlockReason(record),
      supersededByHash: acceptedCorrections.get(record.recordHash) || null,
      ...(duplicateOf.has(record.recordHash) ? { duplicateOfHash: duplicateOf.get(record.recordHash) } : {})
    }))
    .sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  return {
    schema: 'poolday.accepted_research_memory/v1',
    policy: 'independent_review_fail_closed',
    acceptedHashes,
    records: acceptedRecords,
    excluded
  };
}

const independentlyAccepted = (records, target) => projectResearchReviewStates(records)
  .some((entry) => entry.recordHash === target?.recordHash && entry.state === 'accepted');

const realizedContributionRole = (record, candidateHash, evaluationHash) => {
  if (record?.recordHash === candidateHash) return 'action_proposal';
  if (record?.recordHash === evaluationHash
    || [RESEARCH_RECORD_KINDS.evaluation, RESEARCH_RECORD_KINDS.adjudicationEvaluation].includes(record?.kind)) {
    return 'evaluation';
  }
  if (record?.kind === RESEARCH_RECORD_KINDS.outcome) return 'outcome_execution';
  if (record?.kind === RESEARCH_RECORD_KINDS.claim
    && ['review_decision', 'candidate_action_approval'].includes(record.claim?.kind)) return 'independent_review';
  if ([
    RESEARCH_RECORD_KINDS.submission,
    RESEARCH_RECORD_KINDS.hypothesis,
    RESEARCH_RECORD_KINDS.priorEvidence,
    RESEARCH_RECORD_KINDS.prediction,
    RESEARCH_RECORD_KINDS.workOrder,
    RESEARCH_RECORD_KINDS.workClaim,
    RESEARCH_RECORD_KINDS.cohort
  ].includes(record?.kind)) return 'evidence_input';
  return null;
};

const realizedContributionCandidates = (value, recordsByHash) => {
  const hashes = new Set([
    value.questionHash,
    value.candidateActionHash,
    value.evaluationHash
  ]);
  for (const hash of value.evaluationReviewDecisionHashes || []) hashes.add(hash);
  const candidate = recordsByHash.get(value.candidateActionHash);
  for (const hash of value.candidateActionApprovalHashes || []) hashes.add(hash);
  for (const hash of candidate?.action?.affectedHypothesisHashes || []) {
    hashes.add(hash);
    const hypothesis = recordsByHash.get(hash);
    for (const priorHash of hypothesis?.hypothesis?.priorEvidenceHashes || []) hashes.add(priorHash);
  }
  for (const hash of candidate?.action?.expectedValue?.calibrationEvidenceHashes || []) hashes.add(hash);
  const evaluation = recordsByHash.get(value.evaluationHash);
  hashes.add(evaluation?.cohortHash);
  const cohort = recordsByHash.get(evaluation?.cohortHash);
  for (const hash of [
    ...(cohort?.cohort?.predictionHashes || []),
    ...(cohort?.cohort?.workOrderHashes || [])
  ]) hashes.add(hash);
  for (const reviewed of value.reviewedOutcomes || []) {
    hashes.add(reviewed.outcomeHash);
    for (const reviewHash of reviewed.reviewDecisionHashes || []) hashes.add(reviewHash);
    const outcome = recordsByHash.get(reviewed.outcomeHash);
    for (const hash of [
      outcome?.workOrderHash,
      outcome?.workClaimHash,
      outcome?.replicationOfHash,
      ...(outcome?.hypothesisHashes || [])
    ]) hashes.add(hash);
  }
  return new Set([...hashes].filter(Boolean));
};

export function validateCrossRoomReuseOrigin(record = {}, originRecord = null, originQuestion = null) {
  const reasons = [];
  const reuseContext = record.kind === RESEARCH_RECORD_KINDS.priorEvidence
    ? record.evidence?.reuseContext
    : null;
  if (!reuseContext) return { ok: true, reasons };
  if (originRecord?.kind !== RESEARCH_RECORD_KINDS.priorEvidence
    || originRecord.recordHash !== reuseContext.originRecordHash) {
    reasons.push('cross-room origin record is missing or has the wrong kind');
  } else {
    if (originRecord.roomId !== reuseContext.origin.roomId
      || originRecord.questionHash !== reuseContext.origin.questionHash) {
      reasons.push('cross-room origin record does not match its declared room and question');
    }
    if (crossRoomSourceIdentityKey(originRecord) !== crossRoomSourceIdentityKey(reuseContext.originSource)) {
      reasons.push('cross-room declared source identity does not match the origin record');
    }
  }
  if (originQuestion?.kind !== RESEARCH_RECORD_KINDS.submission
    || originQuestion.recordHash !== reuseContext.origin.questionHash) {
    reasons.push('cross-room origin question is missing or has the wrong kind');
  } else {
    const expected = decisionContextSnapshot(originQuestion);
    if (expected.roomId !== reuseContext.origin.roomId
      || expected.sequenceHash !== reuseContext.origin.sequenceHash
      || JSON.stringify(expected.consent) !== JSON.stringify(reuseContext.origin.consent)
      || JSON.stringify(expected.intent) !== JSON.stringify(reuseContext.origin.intent)) {
      reasons.push('cross-room origin context does not match the signed origin question');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function validateResearchRecordLinks(record = {}, records = []) {
  const reasons = [];
  const recordsByHash = new Map(records.map((entry) => [entry.recordHash, entry]));
  const targets = researchRecordTargetHashes(record);
  const revoked = revokedResearchHashes(records);
  const invalidated = invalidatedResearchHashes(records);
  for (const targetHash of targets) {
    const target = recordsByHash.get(targetHash);
    if (!target) reasons.push(`linked research record does not exist: ${targetHash}`);
    else if (target.roomId !== record.roomId) reasons.push(`linked research record belongs to a different room: ${targetHash}`);
    else if (record.kind !== RESEARCH_RECORD_KINDS.revocation && invalidated.has(targetHash)) reasons.push(`linked research record is revoked or invalidated: ${targetHash}`);
  }
  const target = (hash) => recordsByHash.get(hash);
  if (record.kind === RESEARCH_RECORD_KINDS.result) {
    const submission = target(record.submissionHash);
    if (submission && submission.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('research result must target a submission');
    if (submission && record.sequenceHash !== submission.sequence?.hash) reasons.push('research result sequence does not match its submission');
    if (submission && record.sequenceLength !== submission.sequence?.length) reasons.push('research result sequence length does not match its submission');
    if (submission && record.compute?.submissionModelContractKey !== exactModelContractKey(submission.modelContract)) {
      reasons.push('research result submission model contract identity does not match its submission');
    }
    if (record.compute?.receiptModelContractKey !== exactModelContractKey(record.modelContract)) {
      reasons.push('research result receipt model contract identity does not match its published exact model contract');
    }
    if (submission && record.modelContract?.sequence?.alphabet
      && record.modelContract.sequence.alphabet !== submission.sequence?.alphabet) {
      reasons.push('research result model contract alphabet does not match its submission');
    }
    if (record.sequenceEvidence && record.sequenceEvidence.sequenceLength !== submission?.sequence?.length) {
      reasons.push('research result sequence evidence length does not match its submission');
    }
    if (record.embedding && submission?.consent?.publishEmbedding !== true) reasons.push('research submission did not consent to embedding publication');
    if ((record.sequenceEvidence?.residueEmbeddings?.length > 0
      || record.sequenceEvidence?.maskedResidueProposals?.length > 0)
      && submission?.consent?.publishResidueEvidence !== true) {
      reasons.push('research submission did not consent to residue evidence publication');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.sequenceLink) {
    const nucleotide = target(record.link?.nucleotideSubmissionHash);
    const protein = target(record.link?.proteinSubmissionHash);
    if (nucleotide?.kind !== RESEARCH_RECORD_KINDS.submission
      || nucleotide?.sequence?.alphabet !== SEQUENCE_ALPHABETS.nucleotide) {
      reasons.push('sequence link must target a nucleotide submission');
    }
    if (protein?.kind !== RESEARCH_RECORD_KINDS.submission
      || protein?.sequence?.alphabet !== SEQUENCE_ALPHABETS.aminoAcid) {
      reasons.push('sequence link must target a protein submission');
    }
    if (nucleotide && record.link?.translation?.nucleotideSequenceHash !== nucleotide.sequence?.hash) {
      reasons.push('sequence link nucleotide identity does not match its submission');
    }
    if (protein && record.link?.translation?.proteinSequenceHash !== protein.sequence?.hash) {
      reasons.push('sequence link protein identity does not match its submission');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim) {
    const reviewed = target(record.targetHash);
    if (record.claim?.kind === 'review_decision' && reviewed?.author?.identityRootId === record.author?.identityRootId) {
      reasons.push('review decisions must be independently authored');
    }
    const reuseContext = reviewed?.kind === RESEARCH_RECORD_KINDS.priorEvidence
      ? reviewed.evidence?.reuseContext
      : null;
    const assessment = record.claim?.contextAssessment;
    if (assessment && !reuseContext) reasons.push('contextual reuse review must target cross-room prior evidence');
    if (reuseContext && assessment) {
      if (assessment.originRecordHash !== reuseContext.originRecordHash
        || assessment.originQuestionHash !== reuseContext.origin.questionHash
        || assessment.currentQuestionHash !== reuseContext.current.questionHash
        || assessment.comparisonHash !== reuseContext.comparisonHash) {
        reasons.push('contextual reuse review does not match the attached context comparison');
      }
    }
    if (reuseContext && record.claim?.kind === 'review_decision'
      && record.claim?.decision === 'accepted'
      && assessment?.determination !== 'relevant') {
      reasons.push('accepted cross-room evidence requires an explicit relevant context determination');
    }
    if (record.claim?.kind === 'candidate_action_approval') {
      if (reviewed?.kind !== RESEARCH_RECORD_KINDS.candidateAction) {
        reasons.push('candidate action approval must target a candidate action');
      } else {
        if (reviewed.author?.identityRootId === record.author?.identityRootId) {
          reasons.push('candidate actions cannot be self-approved');
        }
        if (record.claim?.actionContractHash !== reviewed.action?.contractHash) {
          reasons.push('candidate action approval contract hash does not match its target');
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.candidateAction) {
    const question = target(record.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('candidate action must target a research question submission');
    } else if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
      reasons.push('candidate action requires public sequence and evidence-network consent');
    }
    for (const hash of record.action?.affectedHypothesisHashes || []) {
      const hypothesis = target(hash);
      if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
        reasons.push(`candidate action hypothesis does not belong to its question: ${hash}`);
      }
    }
    for (const uncertainty of record.action?.uncertainty || []) {
      if (uncertainty.representation !== 'probability') continue;
      const cohort = target(uncertainty.calibration?.cohortHash);
      if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort || cohort.cohort?.state !== 'frozen') {
        reasons.push(`probability calibration does not target a frozen evaluation cohort: ${uncertainty.calibration?.cohortHash}`);
      } else if (!independentlyAccepted(records, cohort)) {
        reasons.push(`probability calibration cohort lacks independent acceptance: ${cohort.recordHash}`);
      }
    }
    for (const hash of record.action?.expectedValue?.calibrationEvidenceHashes || []) {
      const calibration = target(hash);
      if (![RESEARCH_RECORD_KINDS.evaluation, RESEARCH_RECORD_KINDS.adjudicationEvaluation].includes(calibration?.kind)) {
        reasons.push(`candidate value calibration evidence kind mismatch: ${hash}`);
      } else if (!independentlyAccepted(records, calibration)) {
        reasons.push(`candidate value calibration evidence lacks independent acceptance: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.hypothesis) {
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('hypothesis must target a research question submission');
    for (const hash of record.hypothesis?.priorEvidenceHashes || []) {
      if (target(hash)?.kind !== RESEARCH_RECORD_KINDS.priorEvidence) reasons.push(`hypothesis prior evidence kind mismatch: ${hash}`);
    }
    for (const hash of record.hypothesis?.alternativeToHashes || []) {
      const alternative = target(hash);
      if (alternative?.kind !== RESEARCH_RECORD_KINDS.hypothesis || alternative.questionHash !== record.questionHash) {
        reasons.push(`competing hypothesis does not share the question: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    const question = target(record.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('prior evidence must target a research question submission');
    }
    if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
      && question?.kind === RESEARCH_RECORD_KINDS.submission
      && (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true)) {
      reasons.push('public protein evidence requires public sequence and evidence-network consent');
    }
    if (record.evidence?.annotation && question?.kind === RESEARCH_RECORD_KINDS.submission) {
      if (record.evidence.annotation.sequence?.hash !== question.sequence?.hash) {
        reasons.push('protein annotation sequence identity does not match its question');
      }
      if (record.evidence.annotation.sequence?.length !== question.sequence?.length) {
        reasons.push('protein annotation sequence length does not match its question');
      }
    }
    if (record.evidence?.reuseContext && question?.kind === RESEARCH_RECORD_KINDS.submission) {
      const reuseContext = record.evidence.reuseContext;
      const currentSnapshot = decisionContextSnapshot(question);
      if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
        reasons.push('cross-room reuse requires current-question public evidence consent');
      }
      if (reuseContext.current?.questionHash !== currentSnapshot.questionHash
        || reuseContext.current?.roomId !== currentSnapshot.roomId
        || reuseContext.current?.sequenceHash !== currentSnapshot.sequenceHash
        || JSON.stringify(reuseContext.current?.consent) !== JSON.stringify(currentSnapshot.consent)
        || JSON.stringify(reuseContext.current?.intent) !== JSON.stringify(currentSnapshot.intent)) {
        reasons.push('cross-room reuse context does not match the current question');
      }
      if (reuseContext.originRecordHash !== record.evidence.reference?.contentHash) {
        reasons.push('cross-room reuse origin does not match the attached record reference');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.prediction) {
    const hypothesis = target(record.hypothesisHash);
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('prediction must target a research question submission');
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push('prediction hypothesis does not belong to its question');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy) {
    const question = target(record.questionHash);
    const hypothesis = target(record.policy?.targetHypothesisHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('resolution policy must target a research question submission');
    }
    if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
      reasons.push('resolution policy target hypothesis does not belong to its question');
    }
    const priorExecutionPlanning = records.filter((entry) => (
      [RESEARCH_RECORD_KINDS.workOrder, RESEARCH_RECORD_KINDS.workClaim, RESEARCH_RECORD_KINDS.outcome]
        .includes(entry.kind)
      && (entry.questionHash === record.questionHash
        || target(entry.workOrderHash)?.questionHash === record.questionHash)
      && Date.parse(entry.createdAt || '') <= Date.parse(record.createdAt || '')
    ));
    if (priorExecutionPlanning.length) {
      reasons.push('resolution policy must be frozen before work orders, claims, or outcomes for its question');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workOrder) {
    if (target(record.questionHash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push('work order must target a research question submission');
    for (const hash of record.hypothesisHashes || []) {
      const hypothesis = target(hash);
      if (hypothesis?.kind !== RESEARCH_RECORD_KINDS.hypothesis || hypothesis.questionHash !== record.questionHash) {
        reasons.push(`work order hypothesis does not belong to its question: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.workClaim) {
    const order = target(record.workOrderHash);
    if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder) reasons.push('work claim must target a work order');
    else {
      if (!independentlyAccepted(records, order)) reasons.push('work order requires independent acceptance before laboratory claiming');
      if (record.workClaim?.schema === LABORATORY_CAPABILITY_CLAIM_VERSION) {
        const acceptedResolutionPolicies = records.filter((entry) => (
          entry.kind === RESEARCH_RECORD_KINDS.resolutionPolicy
          && entry.questionHash === order.questionHash
          && Date.parse(entry.createdAt || '') <= Date.parse(order.createdAt || '')
          && independentlyAccepted(records, entry)
        ));
        if (!acceptedResolutionPolicies.length) {
          reasons.push('qualified laboratory claims require an independently accepted pre-work-order resolution policy');
        }
        if (order.work?.schema !== RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
          reasons.push('qualified laboratory claims require a current governed work order contract');
        }
        if (record.workClaim.protocolCustody?.protocolHash !== order.work?.protocol?.protocolHash) {
          reasons.push('laboratory protocol custody does not match the accepted work order');
        }
        if (!order.work?.custody?.requiredRoles?.includes(record.workClaim.protocolCustody?.role)) {
          reasons.push('laboratory protocol custody role is outside the accepted work order');
        }
        if (record.workClaim?.safety?.classification !== order.work?.scopeBoundary?.protocolSafetyClassification) {
          reasons.push('laboratory safety classification does not match the accepted public non-clinical work order scope');
        }
        if (record.workClaim?.consent?.publishQualification !== order.work?.publication?.publishQualification
          || record.workClaim?.consent?.publishOutcome !== order.work?.publication?.publishRawObservations
          || record.workClaim?.consent?.publicLaboratoryIdentity !== order.work?.publication?.publishLaboratoryIdentity) {
          reasons.push('laboratory publication consent does not match the accepted work order scope');
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.outcome) {
    const order = target(record.workOrderHash);
    const claim = target(record.workClaimHash);
    if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder || claim?.kind !== RESEARCH_RECORD_KINDS.workClaim) {
      reasons.push('outcome requires a work order and laboratory work claim');
    } else {
      if (claim.workOrderHash !== order.recordHash) reasons.push('outcome work claim does not belong to its work order');
      if (claim.author?.identityRootId !== record.author?.identityRootId) reasons.push('outcome author does not own its laboratory work claim');
      if (order.questionHash !== record.questionHash) reasons.push('outcome question does not match its work order');
      if (order.work?.protocol?.protocolHash !== record.outcome?.protocol?.protocolHash) reasons.push('outcome protocol does not match its accepted work order');
      if (order.work?.blindness?.allocationHash !== record.outcome?.blind?.allocationHash) reasons.push('outcome blind allocation does not match its work order');
      if (order.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
        if (record.outcome?.executionContext?.schema !== EXPERIMENTAL_EXECUTION_CONTEXT_VERSION) {
          reasons.push('current work order outcomes require a signed execution context');
        }
        if (record.outcome?.executionContext?.institutionIdentityHash !== claim.workClaim?.laboratory?.institutionIdentityHash) {
          reasons.push('outcome institution identity does not match its laboratory claim');
        }
        const plannedAnalysisIdentity = (({ methodId, version, artifactHash, parametersHash, runtimeIdentity }) => ({
          methodId, version, artifactHash, parametersHash, runtimeIdentity
        }))(order.work.plannedAnalysis || {});
        const outcomeAnalysisIdentity = (({ methodId, version, artifactHash, parametersHash, runtimeIdentity }) => ({
          methodId, version, artifactHash, parametersHash, runtimeIdentity
        }))(record.outcome?.analysis || {});
        if (JSON.stringify(plannedAnalysisIdentity) !== JSON.stringify(outcomeAnalysisIdentity)) {
          reasons.push('outcome analysis does not match its accepted work order');
        }
        if (record.outcome?.attempt?.status === 'failed'
          && !order.work.allowedFailureCategories?.includes(record.outcome?.attempt?.failureCategory)) {
          reasons.push('outcome failure category is outside its accepted work order');
        }
      }
      for (const hash of record.hypothesisHashes || []) {
        if (!order.hypothesisHashes.includes(hash)) reasons.push(`outcome hypothesis is outside its work order: ${hash}`);
      }
    }
    if (record.replicationOfHash) {
      const original = target(record.replicationOfHash);
      if (original?.kind !== RESEARCH_RECORD_KINDS.outcome) reasons.push('replication must target an experimental outcome');
      else if (order?.work?.schema === RESEARCH_WORK_ORDER_CONTRACT_VERSION) {
        const originalClaim = target(original.workClaimHash);
        if (original.questionHash !== record.questionHash) reasons.push('replication must target an outcome for the same question');
        if (original.outcome?.protocol?.protocolHash !== record.outcome?.protocol?.protocolHash) {
          reasons.push('replication must use the same exact protocol');
        }
        const dimensionValues = {
          operator_identity: [original.author?.identityRootId, record.author?.identityRootId],
          institution: [originalClaim?.workClaim?.laboratory?.institutionIdentityHash, claim?.workClaim?.laboratory?.institutionIdentityHash],
          instrument: [original.outcome?.executionContext?.instrumentIdentityHash, record.outcome?.executionContext?.instrumentIdentityHash],
          sample_batch: [original.outcome?.executionContext?.sampleBatchHash, record.outcome?.executionContext?.sampleBatchHash],
          preparation_batch: [original.outcome?.executionContext?.preparationBatchHash, record.outcome?.executionContext?.preparationBatchHash],
          analysis_execution: [original.outcome?.executionContext?.analysisExecutionHash, record.outcome?.executionContext?.analysisExecutionHash]
        };
        for (const dimension of order.work.replication?.requiredIndependentDimensions || []) {
          const [originalValue, replicaValue] = dimensionValues[dimension] || [];
          if (!originalValue || !replicaValue) reasons.push(`replication independence dimension is missing: ${dimension}`);
          else if (originalValue === replicaValue) reasons.push(`replication is not independent across declared dimension: ${dimension}`);
        }
      } else if (original.author?.identityRootId === record.author?.identityRootId) {
        reasons.push('legacy replication must be independently authored');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.cohort) {
    const frozenAt = Date.parse(record.cohort?.frozenAt || '');
    for (const hash of record.cohort?.questionHashes || []) {
      if (target(hash)?.kind !== RESEARCH_RECORD_KINDS.submission) reasons.push(`cohort question kind mismatch: ${hash}`);
    }
    for (const hash of record.cohort?.predictionHashes || []) {
      const prediction = target(hash);
      if (prediction?.kind !== RESEARCH_RECORD_KINDS.prediction) reasons.push(`cohort prediction kind mismatch: ${hash}`);
      else {
        if (!record.cohort.questionHashes.includes(prediction.questionHash)) reasons.push(`cohort prediction belongs to an excluded question: ${hash}`);
        if (Date.parse(prediction.prediction?.frozenAt || prediction.createdAt) > frozenAt) reasons.push(`cohort prediction was not frozen before cohort activation: ${hash}`);
        if (!independentlyAccepted(records, prediction)) reasons.push(`cohort prediction lacks independent acceptance: ${hash}`);
      }
    }
    for (const hash of record.cohort?.workOrderHashes || []) {
      const order = target(hash);
      if (order?.kind !== RESEARCH_RECORD_KINDS.workOrder) reasons.push(`cohort work order kind mismatch: ${hash}`);
      else {
        if (!record.cohort.questionHashes.includes(order.questionHash)) reasons.push(`cohort work order belongs to an excluded question: ${hash}`);
        if (!independentlyAccepted(records, order)) reasons.push(`cohort work order lacks independent acceptance: ${hash}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.evaluation) {
    const cohort = target(record.cohortHash);
    if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort) reasons.push('evaluation must target a frozen cohort');
    else if (!independentlyAccepted(records, cohort)) reasons.push('evaluation cohort requires independent acceptance');
    for (const hash of record.evaluation?.outcomeHashes || []) {
      const outcome = target(hash);
      if (outcome?.kind !== RESEARCH_RECORD_KINDS.outcome) reasons.push(`evaluation outcome kind mismatch: ${hash}`);
      else if (cohort) {
        if (!cohort.cohort.workOrderHashes.includes(outcome.workOrderHash)) reasons.push(`evaluation outcome is outside the frozen cohort: ${hash}`);
        if (Date.parse(outcome.createdAt) < Date.parse(cohort.cohort.frozenAt)) reasons.push(`evaluation outcome predates the frozen cohort: ${hash}`);
        if (!independentlyAccepted(records, outcome)) reasons.push(`evaluation outcome lacks independent acceptance: ${hash}`);
        if (outcome.author?.identityRootId === record.author?.identityRootId) reasons.push(`evaluation outcome is not independent from the evaluator: ${hash}`);
      }
    }
    if (cohort) {
      const metricDefinitions = new Map(cohort.cohort.metrics.map((metric) => [metric.id, metric]));
      for (const metric of record.evaluation?.metricResults || []) {
        const definition = metricDefinitions.get(metric.metricId);
        if (!definition || definition.direction !== metric.direction) reasons.push(`evaluation metric is outside the frozen definition: ${metric.metricId}`);
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.realizedActionValue) {
    const value = record.realizedValue || {};
    const reviewStateByHash = new Map(projectResearchReviewStates(records)
      .map((entry) => [entry.recordHash, entry]));
    const question = target(value.questionHash);
    const candidate = target(value.candidateActionHash);
    const evaluation = target(value.evaluationHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('realized action value must target a research question submission');
    }
    if (candidate?.kind !== RESEARCH_RECORD_KINDS.candidateAction) {
      reasons.push('realized action value must target a candidate action');
    } else {
      if (candidate.questionHash !== value.questionHash || record.questionHash !== value.questionHash) {
        reasons.push('realized action-value question does not match its candidate action');
      }
      if (candidate.action?.contractHash !== value.actionContractHash) {
        reasons.push('realized action value does not bind the exact candidate action contract');
      }
      for (const approvalHash of value.candidateActionApprovalHashes || []) {
        const approval = target(approvalHash);
        if (approval?.kind !== RESEARCH_RECORD_KINDS.claim
          || approval.claim?.kind !== 'candidate_action_approval'
          || approval.claim?.decision !== 'approved'
          || approval.claim?.actionContractHash !== value.actionContractHash
          || approval.targetHash !== value.candidateActionHash
          || approval.author?.identityRootId === candidate.author?.identityRootId) {
          reasons.push(`realized action value lacks an independent exact-contract candidate approval: ${approvalHash}`);
        }
      }
    }
    if (evaluation?.kind !== RESEARCH_RECORD_KINDS.evaluation) {
      reasons.push('realized action value must target a frozen cohort evaluation');
    } else {
      const cohort = target(evaluation.cohortHash);
      if (cohort?.kind !== RESEARCH_RECORD_KINDS.cohort
        || !cohort.cohort?.questionHashes?.includes(value.questionHash)) {
        reasons.push('realized action-value evaluation cohort does not include its question');
      }
      if (!independentlyAccepted(records, evaluation)) {
        reasons.push('realized action-value evaluation requires independent acceptance');
      }
      const activeEvaluationReviews = new Set((reviewStateByHash.get(value.evaluationHash)?.decisions || [])
        .filter((decision) => decision.claim?.decision === 'accepted')
        .map((decision) => decision.recordHash));
      for (const reviewHash of value.evaluationReviewDecisionHashes || []) {
        const review = target(reviewHash);
        if (review?.kind !== RESEARCH_RECORD_KINDS.claim
          || review.claim?.kind !== 'review_decision'
          || review.claim?.decision !== 'accepted'
          || review.targetHash !== value.evaluationHash
          || !activeEvaluationReviews.has(reviewHash)) {
          reasons.push(`realized action-value review does not currently accept its evaluation: ${reviewHash}`);
        }
      }
      const measuredOutcomeHashes = (value.reviewedOutcomes || []).map((entry) => entry.outcomeHash);
      if (!sameStringSet(measuredOutcomeHashes, evaluation.evaluation?.outcomeHashes || [])) {
        reasons.push('realized action value must bind every evaluated outcome');
      }
      const measuredMetrics = new Map((value.metricResults || []).map((metric) => [metric.metricId, metric]));
      const evaluationMetrics = evaluation.evaluation?.metricResults || [];
      if (!sameStringSet([...measuredMetrics.keys()], evaluationMetrics.map((metric) => metric.metricId))) {
        reasons.push('realized action-value metrics do not match the frozen evaluation');
      } else {
        for (const metric of evaluationMetrics) {
          const measured = measuredMetrics.get(metric.metricId);
          const regressed = metric.direction === 'higher_is_better'
            ? metric.currentValue < metric.baselineValue
            : metric.currentValue > metric.baselineValue;
          if (measured.direction !== metric.direction
            || measured.baselineValue !== metric.baselineValue
            || measured.currentValue !== metric.currentValue
            || measured.absoluteDelta !== metric.absoluteDelta
            || measured.relativeDelta !== metric.relativeDelta
            || measured.improved !== metric.improved
            || measured.regressed !== regressed) {
            reasons.push(`realized action-value metric differs from its evaluation: ${metric.metricId}`);
          }
        }
      }
    }
    for (const reviewed of value.reviewedOutcomes || []) {
      const outcome = target(reviewed.outcomeHash);
      if (outcome?.kind !== RESEARCH_RECORD_KINDS.outcome) {
        reasons.push(`realized action-value outcome kind mismatch: ${reviewed.outcomeHash}`);
        continue;
      }
      if (!independentlyAccepted(records, outcome)) {
        reasons.push(`realized action-value outcome lacks independent acceptance: ${reviewed.outcomeHash}`);
      }
      const activeAcceptedDecisions = new Set((reviewStateByHash.get(reviewed.outcomeHash)?.decisions || [])
        .filter((decision) => decision.claim?.decision === 'accepted')
        .map((decision) => decision.recordHash));
      for (const reviewHash of reviewed.reviewDecisionHashes || []) {
        const review = target(reviewHash);
        if (review?.kind !== RESEARCH_RECORD_KINDS.claim
          || review.claim?.kind !== 'review_decision'
          || review.claim?.decision !== 'accepted'
          || review.targetHash !== reviewed.outcomeHash
          || !activeAcceptedDecisions.has(reviewHash)) {
          reasons.push(`realized action-value review does not currently accept its outcome: ${reviewHash}`);
        }
      }
    }
    const eligibleContributions = realizedContributionCandidates(value, recordsByHash);
    const suppliedContributions = new Set((value.contributions || []).map((entry) => entry.recordHash));
    const requiredContributions = new Set([
      value.candidateActionHash,
      ...(value.candidateActionApprovalHashes || []),
      value.evaluationHash,
      ...(value.evaluationReviewDecisionHashes || []),
      ...(value.reviewedOutcomes || []).flatMap((entry) => [
        entry.outcomeHash,
        ...(entry.reviewDecisionHashes || [])
      ])
    ]);
    for (const hash of requiredContributions) {
      if (!suppliedContributions.has(hash)) reasons.push(`realized action value omits a required causal contribution: ${hash}`);
    }
    for (const contribution of value.contributions || []) {
      const linked = target(contribution.recordHash);
      if (!eligibleContributions.has(contribution.recordHash)) {
        reasons.push(`realized action-value contribution is outside the causal record graph: ${contribution.recordHash}`);
      }
      const expectedRole = realizedContributionRole(linked, value.candidateActionHash, value.evaluationHash);
      if (!expectedRole || contribution.role !== expectedRole) {
        reasons.push(`realized action-value contribution role mismatch: ${contribution.recordHash}`);
      }
      if (linked?.author?.identityRootId === record.author?.identityRootId) {
        reasons.push(`realized action-value assessor cannot credit itself: ${contribution.recordHash}`);
      }
    }
    if (Date.parse(record.createdAt || '') < Date.parse(evaluation?.createdAt || '')) {
      reasons.push('realized action value predates its evaluation');
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.adjudicationEvaluation) {
    const experiment = target(record.experimentHash);
    if (experiment?.kind !== RESEARCH_RECORD_KINDS.adjudicationExperiment) {
      reasons.push('adjudication evaluation must target a frozen adjudication experiment');
    } else {
      if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION
        && experiment.experiment?.schema !== ADJUDICATION_EXPERIMENT_VERSION) {
        reasons.push('adjudication evaluation requires the current baseline-policy freeze contract');
      }
      if (!independentlyAccepted(records, experiment)) reasons.push('adjudication experiment requires independent acceptance before evaluation');
      if (experiment.author?.identityRootId === record.author?.identityRootId) {
        reasons.push('adjudication evaluation must be independently authored');
      }
      if (experiment.experiment?.evaluator?.identityRootId !== record.author?.identityRootId) {
        reasons.push('adjudication evaluation signer does not match the frozen evaluator identity root');
      }
      if (Date.parse(record.createdAt) < Date.parse(experiment.experiment?.frozenAt || '')) {
        reasons.push('adjudication evaluation predates its frozen experiment');
      }
      if (experiment.experiment?.outcomeBoundary?.mode === 'historical_hidden'
        && record.evaluation?.resultManifest?.contentHash
          !== experiment.experiment.outcomeBoundary.outcomeManifestCommitmentHash) {
        reasons.push('historical adjudication result manifest does not match the frozen outcome commitment');
      }
      if (JSON.stringify(record.evaluation?.evaluator) !== JSON.stringify(experiment.experiment?.evaluator)) {
        reasons.push('adjudication evaluation evaluator does not match the frozen contract');
      }
      const definitions = new Map((experiment.experiment?.metrics || []).map((metric) => [metric.id, metric]));
      const metricResults = record.evaluation?.metricResults || [];
      if (!sameStringSet(metricResults.map((metric) => metric.metricId), [...definitions.keys()])) {
        reasons.push('adjudication evaluation metrics do not match the frozen contract');
      } else {
        for (const [index, metric] of metricResults.entries()) {
          const definition = definitions.get(metric.metricId);
          try {
            if (JSON.stringify(adjudicationMetricResult(definition, metric, index)) !== JSON.stringify(metric)) {
              reasons.push(`adjudication metric result is not canonical: ${metric.metricId}`);
            }
          } catch (error) {
            reasons.push(error.message);
          }
          if (metric.pairedSampleCount > Number(experiment.experiment?.cohort?.caseCount || 0)) {
            reasons.push(`adjudication metric sample exceeds the frozen cohort: ${metric.metricId}`);
          }
        }
        if (new Set(metricResults.map((metric) => metric.pairedSampleCount)).size !== 1) {
          reasons.push('adjudication metrics do not share one paired sample count');
        }
        const pairedSampleCount = metricResults[0]?.pairedSampleCount || 0;
        if (pairedSampleCount + Number(record.evaluation?.missingCaseCount || 0) !== experiment.experiment.cohort.caseCount) {
          reasons.push('adjudication paired and missing case counts do not account for the frozen cohort');
        }
        if (Number(record.evaluation?.regressionCount || 0) > pairedSampleCount) {
          reasons.push('adjudication regression count exceeds paired cases');
        }
        if (record.evaluation?.schema === ADJUDICATION_EVALUATION_VERSION) {
          const evidence = record.evaluation.northStarEvidence || {};
          const cohortCaseCount = experiment.experiment.cohort.caseCount;
          if (evidence.policyHash !== experiment.experiment.northStarPolicy?.policyHash) {
            reasons.push('adjudication north-star evidence does not bind the frozen policy');
          }
          const complete = record.evaluation.missingCaseCount === 0
            && evidence.allFrozenCasesIncluded === true
            && evidence.realWorldObserved === true
            && evidence.criteriaAppliedBeforeOutcomeAccess === true
            && evidence.operationalMetricsExcludedFromSuccess === true
            && evidence.baseline?.observedCaseCount === cohortCaseCount
            && evidence.candidate?.observedCaseCount === cohortCaseCount
            && evidence.baseline?.independentlyReplicatedConclusionCount === cohortCaseCount
            && evidence.candidate?.independentlyReplicatedConclusionCount === cohortCaseCount
            && pairedSampleCount === cohortCaseCount;
          if (evidence.reportingStatus !== (complete ? 'reportable' : 'incomplete')) {
            reasons.push('adjudication north-star reporting status does not follow the frozen completeness rule');
          }
        }
        const expectedAssessment = assessAdjudicationExperiment(
          experiment.experiment,
          metricResults,
          record.evaluation?.northStarEvidence || null
        );
        if (JSON.stringify(expectedAssessment) !== JSON.stringify(record.evaluation?.assessment)) {
          reasons.push('adjudication evaluation assessment does not follow the frozen success policy');
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    const checkpoint = record.checkpoint || {};
    const question = target(checkpoint.questionHash);
    if (question?.kind !== RESEARCH_RECORD_KINDS.submission) {
      reasons.push('discovery checkpoint must target a research question submission');
    }
    const orderedInputs = (checkpoint.inputRecordHashes || []).map((hash) => target(hash)).filter(Boolean);
    const expectedOrder = orderedInputs.slice().sort((left, right) => (
      String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
      || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
    ));
    if (orderedInputs.length === checkpoint.inputRecordHashes?.length
      && expectedOrder.some((entry, index) => entry.recordHash !== orderedInputs[index]?.recordHash)) {
      reasons.push('discovery checkpoint input records are not in deterministic order');
    }
    const activeInputs = new Set(checkpoint.activeInputRecordHashes || []);
    for (const hash of checkpoint.inputRecordHashes || []) {
      const input = target(hash);
      if (!input) {
        reasons.push(`discovery checkpoint input does not exist: ${hash}`);
        continue;
      }
      if (input.roomId !== record.roomId) reasons.push(`discovery checkpoint input belongs to a different room: ${hash}`);
      if (input.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
        reasons.push(`discovery checkpoint input cannot be another checkpoint: ${hash}`);
      }
      if (Date.parse(input.createdAt || '') > Date.parse(record.createdAt || '')) {
        reasons.push(`discovery checkpoint predates its input: ${hash}`);
      }
      const shouldBeActive = input.kind !== RESEARCH_RECORD_KINDS.revocation && !invalidated.has(hash);
      if (activeInputs.has(hash) !== shouldBeActive) {
        reasons.push(`discovery checkpoint active input classification mismatch: ${hash}`);
      }
    }
    for (const parentHash of checkpoint.parentCheckpointHashes || []) {
      const parent = target(parentHash);
      if (!parent) reasons.push(`discovery checkpoint parent does not exist: ${parentHash}`);
      else if (parent.roomId !== record.roomId) reasons.push(`discovery checkpoint parent belongs to a different room: ${parentHash}`);
      else if (parent.kind !== RESEARCH_RECORD_KINDS.discoveryCheckpoint) reasons.push(`discovery checkpoint parent kind mismatch: ${parentHash}`);
      else if (parent.checkpoint?.contractId !== checkpoint.contractId) reasons.push(`discovery checkpoint parent contract mismatch: ${parentHash}`);
      else {
        if (Date.parse(parent.createdAt || '') >= Date.parse(record.createdAt || '')) {
          reasons.push(`discovery checkpoint must follow its parent: ${parentHash}`);
        }
        const missingParentInputs = (parent.checkpoint?.inputRecordHashes || [])
          .filter((hash) => !checkpoint.inputRecordHashes?.includes(hash));
        for (const hash of missingParentInputs) {
          reasons.push(`discovery checkpoint must retain parent archive input: ${hash}`);
        }
        if (parent.checkpoint?.projection?.id === checkpoint.projection?.id
          && JSON.stringify(parent.checkpoint?.inputRecordHashes || []) === JSON.stringify(checkpoint.inputRecordHashes || [])) {
          reasons.push(`discovery checkpoint child input set is unchanged from parent: ${parentHash}`);
        }
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.revocation) {
    const revokedTarget = target(record.targetHash);
    if (revokedTarget?.author?.identityRootId !== record.author?.identityRootId) reasons.push('only the original identity root may revoke its evidence');
    if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.revocation) reasons.push('revocation records cannot be revoked');
    if (revokedTarget?.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      reasons.push('Discovery Contract checkpoints cannot be revoked; append a child checkpoint');
    }
    if (revoked.has(record.targetHash)) reasons.push('research record is already revoked');
  }
  return { ok: reasons.length === 0, reasons, targetHashes: targets };
}

export function buildPredictionDisagreementMap(records = [], questionHash = null) {
  const active = activeResearchRecords(records);
  const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction
    && (!questionHash || record.questionHash === questionHash));
  const conditions = new Map();
  for (const prediction of predictions) {
    const conditionKey = JSON.stringify(prediction.prediction.conditions || {});
    if (!conditions.has(conditionKey)) conditions.set(conditionKey, {
      conditionKey,
      conditions: prediction.prediction.conditions,
      predictions: [],
      labels: new Map()
    });
    const group = conditions.get(conditionKey);
    group.predictions.push(prediction);
    const label = prediction.prediction.normalizedLabel;
    group.labels.set(label, [...(group.labels.get(label) || []), prediction]);
  }
  return [...conditions.values()].map((group) => {
    const labels = [...group.labels.entries()].map(([label, entries]) => ({
      label,
      count: entries.length,
      meanConfidence: entries.reduce((sum, entry) => sum + entry.prediction.confidence, 0) / entries.length,
      methodIds: unique(entries.map((entry) => entry.prediction.method.methodId)),
      predictionHashes: entries.map((entry) => entry.recordHash)
    }));
    return {
      conditionKey: group.conditionKey,
      conditions: group.conditions,
      predictionCount: group.predictions.length,
      labels,
      disagreement: labels.length > 1,
      unresolved: labels.length !== 1
    };
  });
}

export function buildModelEvidenceView(records = [], submissionHash) {
  return buildExactModelEvidenceView(activeResearchRecords(records), submissionHash);
}

export function buildQuestionLifecycles(records = []) {
  const active = activeResearchRecords(records);
  const reviews = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  return active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)
    .map((question) => {
      const matchesQuestion = (record) => record.questionHash === question.recordHash;
      const hypotheses = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && matchesQuestion(record));
      const priorEvidence = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && matchesQuestion(record));
      const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && matchesQuestion(record));
      const resolutionPolicies = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && matchesQuestion(record));
      const workOrders = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && matchesQuestion(record));
      const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
      const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
      const outcomes = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && matchesQuestion(record));
      const cohorts = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(question.recordHash));
      const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
      const evaluations = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
      const realizedActionValues = active.filter((record) => (
        record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
        && record.questionHash === question.recordHash
      ));
      return {
        question,
        modelEvidence: buildModelEvidenceView(active, question.recordHash),
        hypotheses,
        priorEvidence,
        predictions,
        resolutionPolicies,
        disagreementMap: buildPredictionDisagreementMap(active, question.recordHash),
        workOrders,
        workClaims,
        outcomes,
        claimStates: [...hypotheses, ...priorEvidence, ...predictions, ...workOrders, ...outcomes]
          .map((record) => reviews.get(record.recordHash) || { recordHash: record.recordHash, state: 'unresolved', decisions: [] }),
        cohorts,
        evaluations,
        realizedActionValues,
        measuredEffects: evaluations.flatMap((record) => record.evaluation.metricResults.map((metric) => ({
          evaluationHash: record.recordHash,
          cohortHash: record.cohortHash,
          ...metric
        })))
      };
    });
}

export function projectResearchResolutionCriteria(records = [], questionHash) {
  const active = activeResearchRecords(records);
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const policies = active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && record.questionHash === questionHash)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.recordHash || '').localeCompare(String(right.recordHash || '')));
  const accepted = policies.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const policy = accepted.at(-1) || policies.at(-1) || null;
  return {
    schema: 'poolday.research_resolution_projection/v1',
    questionHash,
    status: !policy ? 'policy_missing' : accepted.includes(policy) ? 'criteria_frozen' : 'awaiting_independent_review',
    policyHash: policy?.recordHash || null,
    policy: policy?.policy || null,
    reviewState: policy ? reviewStates.get(policy.recordHash)?.state || 'unresolved' : 'missing',
    closureAuthority: 'none',
    closureState: 'not_evaluated',
    boundary: 'Criteria define future eligibility only; this projection cannot accept, reject, or close a scientific question.'
  };
}

const researchRecordLabel = (record = {}) => ({
  [RESEARCH_RECORD_KINDS.submission]: record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash,
  [RESEARCH_RECORD_KINDS.result]: record.modelContract?.id,
  [RESEARCH_RECORD_KINDS.claim]: record.claim?.text,
  [RESEARCH_RECORD_KINDS.hypothesis]: record.hypothesis?.statement,
  [RESEARCH_RECORD_KINDS.priorEvidence]: record.evidence?.summary,
  [RESEARCH_RECORD_KINDS.prediction]: record.prediction?.expectedObservation,
  [RESEARCH_RECORD_KINDS.resolutionPolicy]: `${record.policy?.conclusionLabel || 'Resolution'} criteria`,
  [RESEARCH_RECORD_KINDS.workOrder]: record.work?.title,
  [RESEARCH_RECORD_KINDS.workClaim]: record.workClaim?.laboratory?.name,
  [RESEARCH_RECORD_KINDS.outcome]: record.outcome?.summary,
  [RESEARCH_RECORD_KINDS.cohort]: record.cohort?.label,
  [RESEARCH_RECORD_KINDS.evaluation]: record.evaluation?.metricResults?.map((metric) => metric.metricId).join(', '),
  [RESEARCH_RECORD_KINDS.realizedActionValue]: `${record.realizedValue?.assessment?.status || 'Pending'} realized action value`,
  [RESEARCH_RECORD_KINDS.adjudicationExperiment]: `${record.experiment?.target?.catalogId || 'Catalog'} adjudication experiment`,
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: `${record.evaluation?.assessment?.conclusion || 'Pending'} adjudication evaluation`,
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: `${record.checkpoint?.state?.status || 'Open'} Discovery Contract checkpoint`,
  [RESEARCH_RECORD_KINDS.candidateAction]: record.action?.title,
  [RESEARCH_RECORD_KINDS.sequenceLink]: 'DNA-to-protein linkage',
  [RESEARCH_RECORD_KINDS.revocation]: record.revocation?.reason
}[record.kind] || record.recordHash);

export function buildEvidenceGraph(records = []) {
  const nodes = records.map((record) => ({
    id: record.recordHash,
    kind: record.kind,
    label: researchRecordLabel(record),
    record
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const addNode = (node) => {
    if (!node?.id || nodeIds.has(node.id)) return;
    nodes.push(node);
    nodeIds.add(node.id);
  };
  for (const record of records) {
    if (record.author?.roleId) {
      const authorNodeId = `identity:${record.author.roleId}`;
      addNode({
        id: authorNodeId,
        kind: 'participant_identity',
        label: record.author.roleId,
        author: record.author
      });
      edges.push({ from: record.recordHash, to: authorNodeId, relation: 'authored_by' });
    }
    const contract = record.modelContract;
    if (contract?.hash && contract?.manifestHash) {
      // A graph node represents an exact model contract, not a broad checkpoint
      // family. Two tokenizer or execution contracts can share weights and a
      // manifest while still producing incomparable representations.
      const modelNodeId = `model:${exactModelContractKey(contract)}`;
      addNode({
        id: modelNodeId,
        kind: 'model_artifact',
        label: contract.id,
        modelContract: contract
      });
      edges.push({
        from: record.recordHash,
        to: modelNodeId,
        relation: record.kind === RESEARCH_RECORD_KINDS.submission ? 'requests' : 'generated_by'
      });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.submission && record.sequence?.hash) {
      const sequenceNodeId = `sequence:${record.sequence.hash}`;
      addNode({
        id: sequenceNodeId,
        kind: record.sequence.alphabet === SEQUENCE_ALPHABETS.nucleotide ? 'dna_sequence' : 'protein_sequence',
        label: record.sequence.hash,
        sequenceHash: record.sequence.hash,
        sequence: record.sequence.value
      });
      edges.push({ from: record.recordHash, to: sequenceNodeId, relation: 'describes' });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.result && nodeIds.has(record.submissionHash)) {
      edges.push({ from: record.recordHash, to: record.submissionHash, relation: 'derived_from' });
      for (const receiptHash of unique(record.compute?.receiptHashes || [record.compute?.receiptHash])) {
        const receiptNodeId = `receipt:${receiptHash}`;
        addNode({ id: receiptNodeId, kind: 'compute_receipt', label: receiptHash, receiptHash });
        edges.push({ from: record.recordHash, to: receiptNodeId, relation: 'backed_by' });
      }
      if (record.compute?.providerId) {
        const providerNodeId = `provider:${record.compute.providerId}`;
        addNode({ id: providerNodeId, kind: 'compute_provider', label: record.compute.providerId });
        edges.push({ from: record.recordHash, to: providerNodeId, relation: 'produced_by' });
      }
      if (record.compute?.routeDecisionHash) {
        const routeNodeId = `route:${record.compute.routeDecisionHash}`;
        addNode({ id: routeNodeId, kind: 'route_decision', label: record.compute.routeDecisionHash });
        edges.push({ from: record.recordHash, to: routeNodeId, relation: 'routed_by' });
      }
      if (record.compute?.runtimeProfileHash) {
        const runtimeNodeId = `runtime:${record.compute.runtimeProfileHash}`;
        addNode({ id: runtimeNodeId, kind: 'runtime_profile', label: record.compute.runtimeProfileHash });
        edges.push({ from: record.recordHash, to: runtimeNodeId, relation: 'ran_on' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.claim && nodeIds.has(record.targetHash)) {
      edges.push({ from: record.recordHash, to: record.targetHash, relation: record.claim.relation });
    }
    const lifecycleRelation = {
      [RESEARCH_RECORD_KINDS.hypothesis]: 'frames',
      [RESEARCH_RECORD_KINDS.priorEvidence]: 'retrieved_for',
      [RESEARCH_RECORD_KINDS.prediction]: 'predicts',
      [RESEARCH_RECORD_KINDS.resolutionPolicy]: 'governs_resolution_for',
      [RESEARCH_RECORD_KINDS.workOrder]: 'orders',
      [RESEARCH_RECORD_KINDS.workClaim]: 'claims',
      [RESEARCH_RECORD_KINDS.outcome]: record.replicationOfHash ? 'replicates' : 'reports',
      [RESEARCH_RECORD_KINDS.cohort]: 'freezes',
      [RESEARCH_RECORD_KINDS.evaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.realizedActionValue]: 'measures_realized_value_from',
      [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: 'freezes_contract_input',
      [RESEARCH_RECORD_KINDS.candidateAction]: 'proposes_action_for',
      [RESEARCH_RECORD_KINDS.sequenceLink]: 'links_translation',
      [RESEARCH_RECORD_KINDS.revocation]: 'revokes'
    }[record.kind];
    if (lifecycleRelation) {
      for (const targetHash of researchRecordTargetHashes(record)) {
        if (nodeIds.has(targetHash)) edges.push({ from: record.recordHash, to: targetHash, relation: lifecycleRelation });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      for (const inputHash of record.checkpoint?.inputRecordHashes || []) {
        if (nodeIds.has(inputHash)) edges.push({ from: record.recordHash, to: inputHash, relation: 'freezes_contract_archive' });
      }
      for (const parentHash of record.checkpoint?.parentCheckpointHashes || []) {
        if (nodeIds.has(parentHash)) edges.push({ from: record.recordHash, to: parentHash, relation: 'supersedes_checkpoint' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.evidence?.reference) {
      const reference = record.evidence.reference;
      const sourceIdentity = reference.uri || `${reference.accession}@${reference.version}`;
      const sourceNodeId = `source:${sourceIdentity}`;
      addNode({ id: sourceNodeId, kind: 'evidence_source', label: sourceIdentity, ...reference });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'retrieved_from' });
    }
    for (const source of record.claim?.evidenceLinks || []) {
      const sourceNodeId = `source:${source.url}`;
      addNode({
        id: sourceNodeId,
        kind: 'evidence_source',
        label: source.label || source.url,
        url: source.url
      });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'cites' });
    }
  }
  return { nodes, edges };
}

const modelCompatibilityKey = (record = {}) => {
  const model = record.modelContract || {};
  // Vectors have meaning only within the complete model contract. A model id,
  // manifest, and dimension match is insufficient when tokenizer, artifacts,
  // execution graph, runtime policy, license, or claim boundary differs.
  return exactModelContractKey(model);
};

export const embeddingsAreCompatible = (left, right) => Boolean(
  left?.embedding?.values && right?.embedding?.values
  && left.embedding.dimensions === right.embedding.dimensions
  && modelCompatibilityKey(left) === modelCompatibilityKey(right)
);

export function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : null;
}

const acceptedClaimHashes = (records) => {
  return new Set(projectResearchReviewStates(records)
    .filter((entry) => entry.state === 'accepted')
    .map((entry) => entry.recordHash));
};

const claimsForTarget = (records, targetHash) => records.filter((record) => (
  record.kind === RESEARCH_RECORD_KINDS.claim && record.targetHash === targetHash
));

export function searchEvidence(records = [], query = '') {
  const needle = compactText(query).toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) => JSON.stringify({
    sequence: record.sequence?.value,
    intent: record.requesterIntent,
    model: record.modelContract?.id,
    claim: record.claim,
    hypothesis: record.hypothesis,
    evidence: record.evidence,
    prediction: record.prediction,
    work: record.work,
    workClaim: record.workClaim,
    outcome: record.outcome,
    cohort: record.cohort,
    evaluation: record.evaluation,
    action: record.action,
    revocation: record.revocation,
    author: record.author?.roleId
  }).toLowerCase().includes(needle));
}

const compareResearchRecords = (left, right) => (
  String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
  || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
);

const connectedSequenceRoomRecords = (records, roomId, questionHashes) => {
  const roomRecords = records.filter((record) => record.roomId === roomId);
  const roomByHash = new Map(roomRecords.map((record) => [record.recordHash, record]));
  const included = new Set(questionHashes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of roomRecords) {
      const targets = researchRecordTargetHashes(record);
      if (!included.has(record.recordHash) && targets.some((targetHash) => included.has(targetHash))) {
        included.add(record.recordHash);
        changed = true;
      }
      if (!included.has(record.recordHash)) continue;
      for (const targetHash of targets) {
        if (!roomByHash.has(targetHash) || included.has(targetHash)) continue;
        included.add(targetHash);
        changed = true;
      }
    }
  }
  return roomRecords.filter((record) => included.has(record.recordHash)).sort(compareResearchRecords);
};

const sourceVersionProjection = (record) => {
  const reference = record.evidence?.reference || {};
  const provenance = record.evidence?.provenance || {};
  return {
    recordHash: record.recordHash,
    evidenceSchema: record.evidence?.schema || null,
    access: record.evidence?.access || null,
    kind: record.evidence?.kind || null,
    uri: reference.uri || null,
    accession: reference.accession || null,
    version: reference.version || null,
    contentHash: reference.contentHash || null,
    license: provenance.license || null,
    retrievedAt: provenance.retrievedAt || null,
    retrievalMethod: provenance.retrievalMethod || null,
    annotation: record.evidence?.annotation || null,
    finding: record.evidence?.finding || null,
    conditions: record.evidence?.conditions || null,
    transformations: record.evidence?.transformations || []
  };
};

const crossRoomQualification = (record) => {
  const reasons = [];
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    const source = sourceVersionProjection(record);
    if (!source.uri && !source.accession) reasons.push('source_identity_missing');
    if (!source.version && !source.contentHash) reasons.push('source_version_missing');
    if (!source.license) reasons.push('source_license_missing');
    if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
      try {
        normalizePublicProteinEvidenceProfile({
          evidenceKind: record.evidence.kind,
          conditions: record.evidence.conditions,
          transformations: record.evidence.transformations,
          provenance: record.evidence.provenance,
          finding: record.evidence.finding
        });
      } catch {
        reasons.push('public_evidence_contract_invalid');
      }
    }
    if (['annotation', 'domain'].includes(record.evidence?.kind)) {
      const annotation = record.evidence?.annotation;
      if (!annotation) reasons.push('annotation_identity_missing');
      else {
        if (!PROTEIN_ANNOTATION_SCOPES.includes(annotation.scope)) reasons.push('annotation_scope_missing');
        if (!annotation.ontology?.namespace || !annotation.ontology?.termId) reasons.push('annotation_ontology_identity_missing');
        if (!annotation.ontology?.version) reasons.push('annotation_ontology_version_missing');
        if (!SHA256_PATTERN.test(String(annotation.sequence?.hash || '')) || !Number.isInteger(annotation.sequence?.length)) {
          reasons.push('annotation_sequence_identity_missing');
        }
        if (annotation.coordinates?.canonicalSystem !== CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM
          || !Number.isInteger(annotation.coordinates?.start)
          || !Number.isInteger(annotation.coordinates?.end)) reasons.push('annotation_coordinates_missing');
        if (!SHA256_PATTERN.test(String(annotation.identityHash || ''))) reasons.push('annotation_identity_hash_missing');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.evidenceLinks?.length) {
    reasons.push('linked_source_license_not_declared');
  }
  if (![RESEARCH_RECORD_KINDS.priorEvidence, RESEARCH_RECORD_KINDS.result].includes(record.kind)) {
    reasons.push('contextual_source_qualification_required');
  }
  return {
    status: reasons.length ? 'needs_source_qualification' : 'source_metadata_complete',
    reasons: unique(reasons)
  };
};

/**
 * Project public evidence connected to one exact sequence across room
 * boundaries. Original-room acceptance is preserved as provenance only: no
 * candidate enters another room's decision memory without a new local review.
 */
export function projectCrossRoomSequenceEvidence(records = [], sequenceHash, {
  currentRoomId = null,
  limit = 1000
} = {}) {
  const normalizedHash = compactText(sequenceHash, 160).toLowerCase();
  if (!SHA256_PATTERN.test(normalizedHash)) throw new TypeError('sequenceHash must be a SHA-256 identity');
  const requestedLimit = Number(limit || 1000);
  if (!Number.isFinite(requestedLimit)) throw new TypeError('limit must be a finite number');
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
  const normalizedCurrentRoomId = compactText(currentRoomId, 160) || null;
  const byHash = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.recordHash) continue;
    byHash.set(record.recordHash, record);
  }
  const snapshot = [...byHash.values()].sort(compareResearchRecords).slice(-boundedLimit);
  const submissions = snapshot.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.submission
    && record.sequence?.hash === normalizedHash
    && record.consent?.publicSequence === true
    && record.consent?.publicEvidenceNetwork === true
  ));
  const questionsByRoom = new Map();
  for (const submission of submissions) {
    const questions = questionsByRoom.get(submission.roomId) || [];
    questions.push(submission.recordHash);
    questionsByRoom.set(submission.roomId, questions);
  }
  const includedRecords = new Map();
  const rooms = [...questionsByRoom.entries()].map(([roomId, questionHashes]) => {
    const roomRecords = connectedSequenceRoomRecords(snapshot, roomId, questionHashes);
    for (const record of roomRecords) includedRecords.set(record.recordHash, record);
    const active = activeResearchRecords(roomRecords);
    const invalidated = invalidatedResearchHashes(roomRecords);
    const memory = projectAcceptedResearchMemory(roomRecords);
    const sources = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence)
      .map(sourceVersionProjection);
    const sequenceLinks = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.sequenceLink)
      .map((record) => ({
        recordHash: record.recordHash,
        nucleotideSubmissionHash: record.link?.nucleotideSubmissionHash || null,
        proteinSubmissionHash: record.link?.proteinSubmissionHash || null,
        coordinates: record.link?.coordinates || null,
        translation: record.link?.translation || null
      }));
    return {
      roomId,
      currentRoom: Boolean(normalizedCurrentRoomId && roomId === normalizedCurrentRoomId),
      questionHashes: [...questionHashes].sort(),
      archiveRecordHashes: roomRecords.map((record) => record.recordHash),
      activeRecordHashes: active.map((record) => record.recordHash).sort(),
      invalidatedRecordHashes: [...invalidated].sort(),
      acceptedMemoryHashes: [...memory.acceptedHashes],
      memoryExclusions: memory.excluded,
      sourceVersions: sources,
      sequenceLinks
    };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId));
  const roomByAcceptedHash = new Map(rooms.flatMap((room) => (
    room.currentRoom
      ? []
      : room.acceptedMemoryHashes.map((recordHash) => [recordHash, room])
  )));
  const rawCandidates = [...roomByAcceptedHash.entries()].map(([recordHash, room]) => {
    const record = includedRecords.get(recordHash);
    return {
      recordHash,
      originRoomId: room.roomId,
      originQuestionHashes: room.questionHashes,
      kind: record?.kind || null,
      originalRoomAccepted: true,
      qualification: crossRoomQualification(record || {}),
      admission: 'requires_current_room_review'
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const candidateGroups = new Map();
  for (const candidate of rawCandidates) {
    const record = includedRecords.get(candidate.recordHash);
    const groupKey = record?.kind === RESEARCH_RECORD_KINDS.priorEvidence
      && candidate.qualification.status === 'source_metadata_complete'
      ? `source:${crossRoomSourceIdentityKey(record)}`
      : `record:${candidate.recordHash}`;
    const group = candidateGroups.get(groupKey) || [];
    group.push(candidate);
    candidateGroups.set(groupKey, group);
  }
  const candidates = [...candidateGroups.values()].map((group) => {
    const ordered = group.slice().sort((left, right) => compareResearchRecords(
      includedRecords.get(left.recordHash),
      includedRecords.get(right.recordHash)
    ));
    const representative = ordered[0];
    return {
      ...representative,
      deduplication: ordered.length > 1 ? 'same_declared_versioned_source' : 'unique_source_record',
      duplicateRecordHashes: ordered.map((candidate) => candidate.recordHash),
      duplicateOriginRoomIds: unique(ordered.map((candidate) => candidate.originRoomId)).sort(),
      duplicateOrigins: ordered.map((candidate) => ({
        recordHash: candidate.recordHash,
        roomId: candidate.originRoomId,
        questionHashes: candidate.originQuestionHashes
      }))
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const anchor = submissions[0] || null;
  return {
    schema: 'poolday.cross_room_sequence_evidence/v1',
    sequence: {
      hash: normalizedHash,
      alphabet: anchor?.sequence?.alphabet || null,
      length: anchor?.sequence?.length || null,
      value: anchor?.consent?.publicSequence === true ? anchor.sequence?.value || null : null
    },
    currentRoomId: normalizedCurrentRoomId,
    boundary: byHash.size >= boundedLimit ? 'bounded_input_snapshot' : 'input_snapshot',
    complete: byHash.size < boundedLimit,
    inputRecordCount: Array.isArray(records) ? records.length : 0,
    uniqueRecordCount: byHash.size,
    scannedRecordCount: snapshot.length,
    deduplicatedRecordCount: includedRecords.size,
    candidateRecordCount: rawCandidates.length,
    candidateSourceCount: candidates.length,
    rooms,
    candidates,
    records: [...includedRecords.values()].sort(compareResearchRecords)
  };
}

export function findSimilarSequences(records = [], targetHash, { limit = 12 } = {}) {
  const active = activeResearchRecords(records);
  const target = active.find((record) => record.recordHash === targetHash && record.embedding);
  if (!target) return [];
  const accepted = acceptedClaimHashes(records);
  return active
    .filter((record) => record.recordHash !== targetHash && embeddingsAreCompatible(target, record))
    .map((record) => {
      const annotations = [
        ...claimsForTarget(records, record.recordHash),
        ...claimsForTarget(records, record.submissionHash)
      ]
        .filter((claim) => claim.claim.kind !== 'review_decision');
      const acceptedAnnotations = annotations.filter((claim) => accepted.has(claim.recordHash));
      const score = cosineSimilarity(target.embedding.values, record.embedding.values);
      const evidenceBoost = acceptedAnnotations.reduce((sum, claim) => sum + claim.claim.confidence, 0) * 0.002;
      return {
        record,
        similarity: score,
        score: Math.min(1, score + evidenceBoost),
        supportingAnnotations: acceptedAnnotations,
        provenance: record.compute
      };
    })
    .filter((entry) => entry.similarity !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function clusterCompatibleResults(records = [], { threshold = 0.8 } = {}) {
  const results = activeResearchRecords(records).filter((record) => record.kind === RESEARCH_RECORD_KINDS.result && record.embedding?.values);
  const remaining = new Set(results.map((record) => record.recordHash));
  const byHash = new Map(results.map((record) => [record.recordHash, record]));
  const clusters = [];
  while (remaining.size) {
    const seedHash = remaining.values().next().value;
    const queue = [seedHash];
    const members = [];
    remaining.delete(seedHash);
    while (queue.length) {
      const current = byHash.get(queue.shift());
      members.push(current);
      for (const candidateHash of [...remaining]) {
        const candidate = byHash.get(candidateHash);
        if (!embeddingsAreCompatible(current, candidate)) continue;
        if ((cosineSimilarity(current.embedding.values, candidate.embedding.values) || -1) < threshold) continue;
        remaining.delete(candidateHash);
        queue.push(candidateHash);
      }
    }
    clusters.push({
      clusterId: `cluster:${modelCompatibilityKey(members[0])}:${clusters.length + 1}`,
      modelCompatibilityKey: modelCompatibilityKey(members[0]),
      members
    });
  }
  return clusters.sort((left, right) => right.members.length - left.members.length);
}

export function proposeDiscoveryTasks(records = []) {
  const tasks = [];
  const active = activeResearchRecords(records);
  const results = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const approvals = claims.filter((record) => record.claim.kind === 'task_approval');
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedMemory = projectAcceptedResearchMemory(records);
  const acceptedHashes = new Set(acceptedMemory.acceptedHashes);
  const addTask = (kind, targetHash, reason, {
    basis = 'governance',
    basisHashes = [targetHash]
  } = {}) => tasks.push({ kind, targetHash, reason, basis, basisHashes: unique(basisHashes).sort() });
  const requireReview = (record, label) => {
    const review = reviewStates.get(record.recordHash) || { state: 'unresolved' };
    if (review.state === 'unresolved') {
      addTask('independent_review', record.recordHash, `${label} has no independent reviewer decision.`);
    } else if (review.state === 'needs_revision') {
      addTask('revise_evidence', record.recordHash, `${label} needs the correction or context requested by its reviewer.`);
    } else if (review.state === 'replication_requested') {
      addTask('reproduce', record.recordHash, `${label} has an explicit independent replication request.`);
    } else if (review.state === 'disputed') {
      addTask('adjudicate_contradiction', record.recordHash, `${label} has conflicting independent reviewer decisions.`);
      if (review.replicationRequested) {
        addTask('reproduce', record.recordHash, `${label} has a replication request within its disputed review set.`);
      }
    } else if (review.state === 'rejected') {
      addTask('reproduce', record.recordHash, `${label} was rejected; new corrected or independently reproduced evidence is required.`);
    }
  };
  for (const submission of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)) {
    const clarity = projectResearchQuestionClarity(submission);
    if (clarity.status !== 'bounded') {
      addTask(
        'clarify_question',
        submission.recordHash,
        clarity.minimumReady
          ? `Bound the question before deriving scientific work: ${clarity.gaps.slice(0, 3).map((gap) => gap.reason).join(' ')}`
          : clarity.gaps.map((gap) => gap.reason).join(' '),
        { basis: 'question_anchor' }
      );
    }
    const linkedResults = results.filter((record) => record.submissionHash === submission.recordHash);
    if (linkedResults.length === 0 && clarity.minimumReady) {
      addTask('compute', submission.recordHash, 'No receipt-backed result exists for this signed question.', { basis: 'question_anchor' });
    }
    for (const result of linkedResults) {
      requireReview(result, 'The receipt-backed result');
      if (!projectResearchExecutionIndependence(result).independentlyExecuted) {
        addTask('reproduce', result.recordHash, 'The result lacks two distinct receipt and provider identities.');
      }
    }
    const priorEvidenceAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.questionHash === submission.recordHash);
    const hypothesesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && record.questionHash === submission.recordHash);
    const predictionsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && record.questionHash === submission.recordHash);
    const workOrdersAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && record.questionHash === submission.recordHash);
    const outcomesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && record.questionHash === submission.recordHash);
    const cohortsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(submission.recordHash));
    for (const record of [...priorEvidenceAll, ...hypothesesAll, ...predictionsAll, ...workOrdersAll, ...outcomesAll, ...cohortsAll]) {
      if (!acceptedHashes.has(record.recordHash)) requireReview(record, 'This proposed evidence');
    }
    const acceptedResults = linkedResults.filter((record) => acceptedHashes.has(record.recordHash));
    const priorEvidence = priorEvidenceAll.filter((record) => acceptedHashes.has(record.recordHash));
    const hypotheses = hypothesesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const predictions = predictionsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrders = workOrdersAll.filter((record) => acceptedHashes.has(record.recordHash));
    const outcomes = outcomesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const cohorts = cohortsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
    const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
    const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
    const evaluationsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
    for (const evaluation of evaluationsAll) if (!acceptedHashes.has(evaluation.recordHash)) requireReview(evaluation, 'This cohort evaluation');
    const evaluations = evaluationsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const acceptedEvidenceBasis = [...acceptedResults, ...priorEvidence].map((record) => record.recordHash);
    if (acceptedResults.length > 0 && priorEvidence.length === 0) {
      addTask('retrieve_prior_evidence', submission.recordHash, 'Accepted model evidence has no independently accepted versioned prior evidence.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    if (acceptedEvidenceBasis.length > 0 && hypotheses.length < 2) {
      addTask('add_competing_hypothesis', submission.recordHash, 'Accepted memory does not yet contain two condition-specific hypotheses that expose competing explanations.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    for (const hypothesis of hypotheses) {
      const methods = new Set(predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash)
        .map((prediction) => prediction.prediction.method.analysisHash));
      if (methods.size < 2) addTask('run_diverse_predictor', hypothesis.recordHash, 'This accepted hypothesis needs accepted frozen predictions from another exact method identity.', {
        basis: 'accepted_memory', basisHashes: [hypothesis.recordHash, ...predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash).map((record) => record.recordHash)]
      });
    }
    if (hypotheses.length >= 2 && workOrders.length === 0) addTask('design_discriminating_assay', submission.recordHash, 'Accepted competing hypotheses have no accepted machine-verifiable work order.', {
      basis: 'accepted_memory', basisHashes: hypotheses.map((record) => record.recordHash)
    });
    for (const order of workOrders) {
      if (!workClaims.some((claim) => claim.workOrderHash === order.recordHash)) {
        addTask('claim_experimental_work', order.recordHash, 'The accepted work order has not been claimed by a laboratory.', {
          basis: 'accepted_memory', basisHashes: [order.recordHash]
        });
      }
      const orderOutcomes = outcomes.filter((outcome) => outcome.workOrderHash === order.recordHash);
      const completedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'completed');
      const failedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'failed');
      for (const failed of failedOutcomes) {
        addTask(
          'diagnose_failed_attempt',
          failed.recordHash,
          `The accepted ${failed.outcome?.attempt?.failureCategory?.replace(/_/g, ' ') || 'failed'} attempt remains evidence but does not satisfy the planned replica target.`,
          { basis: 'accepted_memory', basisHashes: [order.recordHash, failed.recordHash] }
        );
      }
      if (workClaims.some((claim) => claim.workOrderHash === order.recordHash)
        && completedOutcomes.length < order.work.replicaTarget) {
        const classifications = ['positive', 'negative', 'ambiguous']
          .map((classification) => `${classification} ${completedOutcomes.filter((outcome) => outcome.outcome?.classification === classification).length}`)
          .join(', ');
        addTask(completedOutcomes.length ? 'replicate_assay' : 'perform_assay', order.recordHash, `${completedOutcomes.length} completed of ${order.work.replicaTarget} planned replicas (${classifications}; failed ${failedOutcomes.length}). Failed attempts remain in the basis but do not count as completed replicas.`, {
          basis: 'accepted_memory', basisHashes: [order.recordHash, ...orderOutcomes.map((record) => record.recordHash)]
        });
      }
    }
    if (predictions.length > 0 && workOrders.length > 0 && cohorts.length === 0) {
      addTask('freeze_prospective_cohort', submission.recordHash, 'Accepted predictions and work orders are not yet frozen into a blinded prospective cohort.', {
        basis: 'accepted_memory', basisHashes: [...predictions, ...workOrders].map((record) => record.recordHash)
      });
    }
    for (const cohort of cohorts) {
      const eligible = outcomes.filter((outcome) => cohort.cohort.workOrderHashes.includes(outcome.workOrderHash)
        && reviewStates.get(outcome.recordHash)?.state === 'accepted');
      if (eligible.length > 0 && !evaluations.some((evaluation) => evaluation.cohortHash === cohort.recordHash)) {
        addTask('evaluate_frozen_cohort', cohort.recordHash, 'The accepted frozen cohort has accepted blinded outcomes but no accepted measured evaluation.', {
          basis: 'accepted_memory', basisHashes: [cohort.recordHash, ...eligible.map((record) => record.recordHash)]
        });
      }
    }
    for (const evaluation of evaluations) {
      if (!evaluation.evaluation.metricResults.some((metric) => metric.improved)) {
        addTask('analyze_cohort_failure', evaluation.recordHash, 'The accepted measured cohort did not improve its frozen metric.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
      if (evaluation.evaluation.nextCohortQuestionHashes.length === 0) {
        addTask('define_next_cohort', evaluation.recordHash, 'The accepted evaluation does not yet bind its effect to a next-cohort question set.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
    }
  }
  for (const claim of claims) {
    if (claim.claim.kind === 'follow_up') addTask('follow_up', claim.recordHash, claim.claim.text);
    if (claim.claim.confidence < 0.5 && claim.claim.kind !== 'task_approval') addTask('resolve_uncertainty', claim.recordHash, 'The contributor marked this claim low confidence.');
    if (claim.claim.relation === 'contradicts') addTask('adjudicate_contradiction', claim.recordHash, 'A signed claim contradicts prior evidence.');
  }
  const uniqueTasks = [...new Map(tasks.map((task) => [`${task.kind}:${task.targetHash}`, task])).values()];
  return uniqueTasks.map((task) => {
    const taskId = stableTaskId(task.kind, task.targetHash);
    const taskContract = projectDiscoveryTaskContract({ ...task, taskId });
    const matchingApprovals = approvals.filter((approval) => (
      approval.claim.taskId === taskId
      && JSON.stringify(approval.claim.taskContract) === JSON.stringify(taskContract)
    ));
    return {
      ...task,
      taskId,
      taskContract,
      status: matchingApprovals.length ? 'approved' : 'proposed',
      approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash).sort()
    };
  });
}

export function rankProposedDiscoveryActions(records = []) {
  return rankDiscoveryActions(records, proposeDiscoveryTasks(records));
}

export function rankProposedCandidateActions(records = []) {
  const source = Array.isArray(records) ? records : [];
  const active = activeResearchRecords(source);
  const activeHashes = new Set(active.map((record) => record.recordHash));
  const reviewStates = new Map(projectResearchReviewStates(source).map((entry) => [entry.recordHash, entry]));
  const approvals = active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.claim
    && record.claim?.kind === 'candidate_action_approval'
  ));
  const candidates = source
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.candidateAction)
    .map((record) => {
      const matchingApprovals = approvals.filter((approval) => (
        approval.targetHash === record.recordHash
        && approval.claim?.actionContractHash === record.action?.contractHash
      ));
      const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
      const rejectionReasons = [];
      if (!activeHashes.has(record.recordHash)) rejectionReasons.push('candidate_is_revoked_or_downstream_invalidated');
      if (reviewState === 'rejected') rejectionReasons.push('candidate_was_rejected_by_independent_review');
      if (reviewState === 'disputed') rejectionReasons.push('candidate_has_disputed_independent_review');
      return {
        record,
        rejectionReasons,
        humanApprovalState: matchingApprovals.length
          ? 'approved'
          : ['rejected', 'disputed'].includes(reviewState) ? reviewState : 'approval_required',
        approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash)
      };
    });
  return rankSignedCandidateActions({ inputRecords: source, candidates });
}

export function projectResearchRewards(records = []) {
  const active = activeResearchRecords(records);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const accepted = acceptedClaimHashes(records);
  const contradicted = new Set(claims.filter((record) => ['contradicts', 'corrects'].includes(record.claim.relation)).map((record) => record.targetHash));
  const state = new Map();
  const ensure = (author = {}) => {
    const id = author.roleId || 'unknown';
    if (!state.has(id)) state.set(id, {
      authorId: id,
      verifiedCompute: 0,
      acceptedEvidence: 0,
      durableEvidence: 0,
      acceptedReviews: 0,
      durableReviews: 0,
      experimentalOutcomes: 0,
      independentReplications: 0,
      prospectiveEvaluations: 0,
      realizedActionValues: 0,
      realizedUsefulnessCredits: 0,
      realizedValuePoints: 0,
      points: 0
    });
    return state.get(id);
  };
  for (const result of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result)) {
    const contributor = ensure({ roleId: result.compute?.providerId });
    const independence = projectResearchExecutionIndependence(result);
    const admittedPrimary = result.compute?.receiptAdmission?.accepted === true
      || result.compute?.verifierDecision?.accepted === true;
    const receiptCount = Math.max(admittedPrimary ? 1 : 0, independence.independentReceiptCount);
    contributor.verifiedCompute += receiptCount;
    contributor.points += receiptCount * 2;
  }
  for (const outcome of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome)) {
    if (!accepted.has(outcome.recordHash)) continue;
    const contributor = ensure(outcome.author);
    contributor.experimentalOutcomes += 1;
    contributor.points += 8;
    if (outcome.replicationOfHash) {
      contributor.independentReplications += 1;
      contributor.points += 5;
    }
  }
  for (const evaluation of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation)) {
    const contributor = ensure(evaluation.author);
    contributor.prospectiveEvaluations += 1;
    contributor.points += 3 + evaluation.evaluation.metricResults.filter((metric) => metric.improved).length * 2;
  }
  const rewardRecordsByHash = new Map(active.map((record) => [record.recordHash, record]));
  const creditedActionContributions = new Set();
  for (const valueRecord of active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
    && record.realizedValue?.assessment?.status === 'demonstrated_useful'
    && accepted.has(record.recordHash)
  ))) {
    for (const contribution of valueRecord.realizedValue.contributions || []) {
      const creditKey = `${valueRecord.realizedValue.candidateActionHash}:${contribution.recordHash}`;
      if (creditedActionContributions.has(creditKey)) continue;
      const source = rewardRecordsByHash.get(contribution.recordHash);
      if (!source?.author) continue;
      creditedActionContributions.add(creditKey);
      const contributor = ensure(source.author);
      contributor.realizedActionValues += 1;
      contributor.realizedUsefulnessCredits += 1;
      contributor.realizedValuePoints += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
      contributor.points += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
    }
  }
  for (const claim of claims.filter((record) => !['review_decision', 'task_approval'].includes(record.claim.kind))) {
    if (!accepted.has(claim.recordHash)) continue;
    const contributor = ensure(claim.author);
    contributor.acceptedEvidence += 1;
    contributor.points += 5;
    if (!contradicted.has(claim.recordHash)) {
      contributor.durableEvidence += 1;
      contributor.points += 3;
    }
  }
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record]));
  for (const review of claims.filter((record) => record.claim.kind === 'review_decision' && record.claim.decision === 'accepted')) {
    const target = recordsByHash.get(review.targetHash);
    if (!target || target.author?.identityRootId === review.author?.identityRootId) continue;
    const reviewer = ensure(review.author);
    reviewer.acceptedReviews += 1;
    reviewer.points += 2;
    if (!contradicted.has(review.recordHash) && !contradicted.has(review.targetHash)) {
      reviewer.durableReviews += 1;
      reviewer.points += 1;
    }
  }
  return [...state.values()].map((entry) => ({
    ...entry,
    quality: (entry.acceptedEvidence + entry.acceptedReviews)
      ? (entry.durableEvidence + entry.durableReviews) / (entry.acceptedEvidence + entry.acceptedReviews)
      : 0
  })).sort((left, right) => right.points - left.points);
}

export default {
  createSignedResearchSubmission,
  createSignedResearchResult,
  createSignedHumanClaim,
  createSignedResearchHypothesis,
  createSignedPriorEvidence,
  createSignedPublicProteinEvidence,
  createCrossRoomReuseContext,
  compareResearchDecisionContexts,
  createSignedResearchPrediction,
  createSignedResearchWorkOrder,
  createSignedResearchWorkClaim,
  createSignedExperimentalOutcome,
  createSignedEvaluationCohort,
  createSignedCohortEvaluation,
  createSignedRealizedActionValue,
  createSignedAdjudicationExperiment,
  createSignedAdjudicationEvaluation,
  createSignedCandidateAction,
  createSignedDiscoveryCheckpoint,
  createSignedResearchRevocation,
  verifyResearchRecord,
  validateResearchRecordModelAdmission,
  validateResearchRecordLinks,
  validateCrossRoomReuseOrigin,
  researchRecordTargetHashes,
  activeResearchRecords,
  invalidatedResearchHashes,
  buildEvidenceGraph,
  buildPredictionDisagreementMap,
  buildModelEvidenceView,
  buildQuestionLifecycles,
  projectResearchQuestionClarity,
  projectResearchExecutionIndependence,
  projectResearchReviewStates,
  projectAcceptedResearchMemory,
  projectCrossRoomSequenceEvidence,
  projectDiscoveryTaskContract,
  searchEvidence,
  findSimilarSequences,
  clusterCompatibleResults,
  proposeDiscoveryTasks,
  rankProposedDiscoveryActions,
  rankProposedCandidateActions,
  projectResearchRewards
};
