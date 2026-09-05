/** Record kinds, shared primitives, and execution/context identity. */
import {
  SIGNATURE_DOMAINS
} from './inference-receipt.js';
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

export const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_TEXT_LENGTH = 8000;
export const MAX_EMBEDDING_DIMENSIONS = 4096;
export const DOMAIN_BY_KIND = Object.freeze({
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

export const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
};
export const compactText = (value, max = MAX_TEXT_LENGTH) => String(value || '').trim().slice(0, max);
export const unique = (values) => [...new Set(values.filter(Boolean))];
export const providerIdentities = (values) => unique((Array.isArray(values) ? values : [])
  .filter((value) => typeof value === 'string')
  .map((value) => compactText(value, 240))
  .filter(Boolean))
  .sort();
export const sameStringSet = (left = [], right = []) => {
  const normalizedLeft = unique(left.map(String)).sort();
  const normalizedRight = unique(right.map(String)).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};
export const stableTaskId = (kind, targetHash) => `task:${kind}:${targetHash}`;
export const withoutSignature = (record = {}) => {
  const { signature, ...payload } = record;
  return payload;
};
export const withoutIdentity = (record = {}) => {
  const { recordHash, signature, ...payload } = record;
  return payload;
};

export const normalizeRoomId = (roomId) => {
  const normalized = compactText(roomId, 160).replace(/[^a-z0-9_.:-]/gi, '_');
  if (!normalized) throw new TypeError('roomId is required');
  return normalized;
};

export const normalizeIntent = (intent = {}) => {
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

export const decisionContextIntent = (intent = {}) => ({
  question: compactText(intent.question || intent.text, 2000),
  decisionContext: compactText(intent.decisionContext, 2000),
  conditions: compactText(intent.conditions || intent.context, 2000),
  scope: compactText(intent.scope, 2000),
  exclusions: compactText(intent.exclusions, 2000),
  desiredObservation: compactText(intent.desiredObservation, 2000)
});

export const decisionContextSnapshot = (submission = {}) => ({
  questionHash: compactText(submission.recordHash, 160),
  roomId: compactText(submission.roomId, 160),
  sequenceHash: compactText(submission.sequence?.hash, 160),
  consent: {
    publicSequence: submission.consent?.publicSequence === true,
    publicEvidenceNetwork: submission.consent?.publicEvidenceNetwork === true
  },
  intent: decisionContextIntent(submission.requesterIntent)
});

export const compareDecisionContextSnapshots = (origin = {}, current = {}) => {
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
