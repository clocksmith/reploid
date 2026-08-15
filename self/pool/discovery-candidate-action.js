/**
 * @fileoverview Canonical uncertainty and candidate-action contracts.
 *
 * Candidate actions are signed proposals. Ranking never allocates work and a
 * numeric probability is admissible only with a versioned calibration method
 * and an accepted frozen evaluation cohort.
 */

import { hashJson } from './inference-receipt.js';

export const DISCOVERY_CANDIDATE_ACTION_VERSION = 'poolday.discovery_candidate_action/v1';
export const DISCOVERY_CANDIDATE_ACTION_KINDS = Object.freeze([
  'computation',
  'retrieval',
  'review',
  'assay',
  'replication'
]);
export const DISCOVERY_UNCERTAINTY_SOURCES = Object.freeze([
  'measurement_variance',
  'model_uncertainty',
  'cross_source_disagreement',
  'missing_alternatives',
  'protocol_risk',
  'decision_change_uncertainty'
]);
export const DISCOVERY_UNCERTAINTY_REPRESENTATIONS = Object.freeze([
  'probability',
  'ordinal',
  'set_valued'
]);
export const DISCOVERY_COST_COMPONENTS = Object.freeze([
  'compute',
  'money',
  'labor',
  'instrument',
  'sample',
  'elapsedTime'
]);
export const DISCOVERY_CANDIDATE_ACTION_RANKING_POLICY = Object.freeze({
  schema: 'poolday.discovery_candidate_action_ranking_policy/v1',
  policyId: 'poolday.signed_candidate_action_heuristic/v1',
  version: '1.0.0',
  status: 'heuristic_not_calibrated',
  method: 'weighted_declared_value_minus_cost_burden',
  parameters: Object.freeze({
    uncertaintyReductionWeight: 10,
    decisionRelevanceWeight: 8,
    duplicateWorkAvoidanceWeight: 6,
    costBurdenWeight: 1
  }),
  costAssumptions: Object.freeze({
    aggregation: 'sum_declared_component_burden',
    componentBurdenScale: 'ordinal_0_to_5',
    rawAmountsRemainInOriginalUnits: true
  }),
  calibrationEvidenceHashes: Object.freeze([])
});

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const text = (value, max = 8000) => String(value ?? '').trim().slice(0, max);
const requireText = (value, label, max = 8000) => {
  const normalized = text(value, max);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};
const requireHash = (value, label) => {
  const normalized = text(value, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};
const hashList = (values, label, { min = 0, max = 128 } = {}) => {
  const normalized = [...new Set((Array.isArray(values) ? values : []).map((value) => requireHash(value, label)))].sort();
  if (normalized.length < min || normalized.length > max) {
    throw new TypeError(`${label} requires between ${min} and ${max} identities`);
  }
  return normalized;
};
const textList = (values, label, { min = 0, max = 64, itemMax = 1000 } = {}) => {
  const normalized = [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, itemMax)).filter(Boolean))].sort();
  if (normalized.length < min || normalized.length > max) {
    throw new TypeError(`${label} requires between ${min} and ${max} entries`);
  }
  return normalized;
};
const finite = (value, label, { min = -Infinity, max = Infinity, integer = false } = {}) => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max || (integer && !Number.isInteger(normalized))) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
};

export const normalizeDiscoveryUncertainty = (entry = {}) => {
  const source = text(entry.source, 80).toLowerCase();
  const representation = text(entry.representation, 40).toLowerCase();
  if (!DISCOVERY_UNCERTAINTY_SOURCES.includes(source)) throw new TypeError('uncertainty source is not admitted');
  if (!DISCOVERY_UNCERTAINTY_REPRESENTATIONS.includes(representation)) {
    throw new TypeError('uncertainty representation is not admitted');
  }
  const normalized = {
    source,
    representation,
    rationale: requireText(entry.rationale, 'uncertainty rationale', 2000),
    probability: null,
    ordinal: null,
    possibleValues: [],
    calibration: null
  };
  if (representation === 'probability') {
    normalized.probability = finite(entry.probability, 'uncertainty probability', { min: 0, max: 1 });
    normalized.calibration = {
      methodId: requireText(entry.calibration?.methodId, 'probability calibration method id', 240),
      version: requireText(entry.calibration?.version, 'probability calibration method version', 120),
      cohortHash: requireHash(entry.calibration?.cohortHash, 'probability calibration cohort'),
      metricId: requireText(entry.calibration?.metricId, 'probability calibration metric id', 240)
    };
  } else if (representation === 'ordinal') {
    normalized.ordinal = {
      level: requireText(entry.ordinal?.level ?? entry.level, 'ordinal uncertainty level', 120),
      scaleId: requireText(entry.ordinal?.scaleId ?? entry.scaleId, 'ordinal uncertainty scale id', 240),
      scaleVersion: requireText(entry.ordinal?.scaleVersion ?? entry.scaleVersion, 'ordinal uncertainty scale version', 120)
    };
  } else {
    normalized.possibleValues = textList(entry.possibleValues, 'set-valued uncertainty', { min: 2, max: 64, itemMax: 500 });
  }
  return normalized;
};

const normalizeCostComponent = (entry = {}, label) => ({
  amount: finite(entry.amount, `${label} cost amount`, { min: 0 }),
  unit: requireText(entry.unit, `${label} cost unit`, 120),
  burden: finite(entry.burden, `${label} cost burden`, { min: 0, max: 5, integer: true })
});

const normalizeScientificCost = (cost = {}) => ({
  ...Object.fromEntries(DISCOVERY_COST_COMPONENTS.map((component) => [
    component,
    normalizeCostComponent(cost[component], component)
  ])),
  assumptions: textList(cost.assumptions, 'scientific cost assumptions', { min: 1, max: 32, itemMax: 1000 })
});

const normalizeExecutionContract = (contract = {}) => {
  const contractKind = text(contract.contractKind, 40).toLowerCase();
  if (!['workload', 'protocol'].includes(contractKind)) throw new TypeError('execution contract kind must be workload or protocol');
  return {
    contractKind,
    contractId: requireText(contract.contractId, 'execution contract id', 240),
    version: requireText(contract.version, 'execution contract version', 120),
    artifactHash: requireHash(contract.artifactHash, 'execution contract artifact'),
    parametersHash: requireHash(contract.parametersHash, 'execution contract parameters')
  };
};

const normalizeExpectedValue = (value = {}) => {
  const status = text(value.status, 64) || 'heuristic_not_calibrated';
  if (!['heuristic_not_calibrated', 'calibrated'].includes(status)) throw new TypeError('candidate value status is invalid');
  const calibrationEvidenceHashes = hashList(value.calibrationEvidenceHashes, 'candidate value calibration evidence', {
    min: status === 'calibrated' ? 1 : 0,
    max: 64
  });
  return {
    status,
    method: {
      id: requireText(value.method?.id, 'candidate value method id', 240),
      version: requireText(value.method?.version, 'candidate value method version', 120)
    },
    uncertaintyReduction: finite(value.uncertaintyReduction, 'uncertainty-reduction value', { min: 0, max: 5, integer: true }),
    decisionRelevance: finite(value.decisionRelevance, 'decision-relevance value', { min: 0, max: 5, integer: true }),
    duplicateWorkAvoidance: finite(value.duplicateWorkAvoidance, 'duplicate-work-avoidance value', { min: 0, max: 5, integer: true }),
    calibrationEvidenceHashes
  };
};

export async function normalizeDiscoveryCandidateAction(action = {}) {
  const kind = text(action.kind, 40).toLowerCase();
  if (!DISCOVERY_CANDIDATE_ACTION_KINDS.includes(kind)) throw new TypeError('candidate action kind is not admitted');
  const affectedHypothesisHashes = hashList(action.affectedHypothesisHashes, 'affected hypotheses', { min: 1, max: 64 });
  const predictedObservations = (Array.isArray(action.predictedObservations) ? action.predictedObservations : []).map((entry) => ({
    observation: requireText(entry.observation, 'predicted observation', 2000),
    affectedHypothesisHashes: hashList(entry.affectedHypothesisHashes, 'predicted-observation hypotheses', { min: 1, max: 64 })
  }));
  if (!predictedObservations.length) throw new TypeError('candidate action predicted observations are required');
  const falsifiers = (Array.isArray(action.falsifiers) ? action.falsifiers : []).map((entry) => ({
    hypothesisHash: requireHash(entry.hypothesisHash, 'falsifier hypothesis'),
    observation: requireText(entry.observation, 'falsifying observation', 2000)
  }));
  if (!falsifiers.length) throw new TypeError('candidate action falsifiers are required');
  for (const hash of predictedObservations.flatMap((entry) => entry.affectedHypothesisHashes)) {
    if (!affectedHypothesisHashes.includes(hash)) throw new TypeError('predicted observation targets an unaffected hypothesis');
  }
  for (const falsifier of falsifiers) {
    if (!affectedHypothesisHashes.includes(falsifier.hypothesisHash)) throw new TypeError('falsifier targets an unaffected hypothesis');
  }
  const uncertainty = (Array.isArray(action.uncertainty) ? action.uncertainty : []).map(normalizeDiscoveryUncertainty);
  if (!uncertainty.length) throw new TypeError('candidate action uncertainty is required');
  if (new Set(uncertainty.map((entry) => entry.source)).size !== uncertainty.length) {
    throw new TypeError('candidate action uncertainty sources must be unique');
  }
  const normalized = {
    schema: DISCOVERY_CANDIDATE_ACTION_VERSION,
    questionHash: requireHash(action.questionHash, 'candidate action question'),
    kind,
    title: requireText(action.title, 'candidate action title', 500),
    rationale: requireText(action.rationale, 'candidate action rationale', 4000),
    affectedHypothesisHashes,
    predictedObservations,
    falsifiers,
    execution: normalizeExecutionContract(action.execution),
    uncertainty,
    feasibility: {
      status: requireText(action.feasibility?.status, 'feasibility status', 80),
      requiredCapabilities: textList(action.feasibility?.requiredCapabilities, 'required capabilities', { min: 1, max: 64, itemMax: 500 }),
      availability: requireText(action.feasibility?.availability, 'feasibility availability', 1000),
      materials: textList(action.feasibility?.materials, 'feasibility materials', { max: 64, itemMax: 500 }),
      failureRisks: textList(action.feasibility?.failureRisks, 'feasibility failure risks', { min: 1, max: 64, itemMax: 1000 })
    },
    independence: {
      dimensions: textList(action.independence?.dimensions, 'independence dimensions', { min: 1, max: 32, itemMax: 240 }),
      exclusions: textList(action.independence?.exclusions, 'independence exclusions', { max: 32, itemMax: 500 }),
      minimumIndependentExecutions: finite(action.independence?.minimumIndependentExecutions, 'minimum independent executions', { min: 1, max: 100, integer: true })
    },
    safety: {
      classification: requireText(action.safety?.classification, 'safety classification', 120),
      requirements: textList(action.safety?.requirements, 'safety requirements', { min: 1, max: 64, itemMax: 1000 }),
      reviewRequired: action.safety?.reviewRequired === true
    },
    consent: {
      publicSequenceRequired: action.consent?.publicSequenceRequired === true,
      publicEvidencePublicationRequired: action.consent?.publicEvidencePublicationRequired === true,
      additionalRequirements: textList(action.consent?.additionalRequirements, 'additional consent requirements', { max: 32, itemMax: 1000 })
    },
    scientificCost: normalizeScientificCost(action.scientificCost),
    expectedValue: normalizeExpectedValue(action.expectedValue),
    status: 'proposed',
    allocationAuthority: 'none',
    executionAuthority: 'none',
    humanApprovalRequired: true
  };
  if (!normalized.safety.reviewRequired) throw new TypeError('candidate action safety review must be required');
  if (!normalized.consent.publicSequenceRequired || !normalized.consent.publicEvidencePublicationRequired) {
    throw new TypeError('candidate actions require explicit public sequence and evidence consent');
  }
  return { ...normalized, contractHash: await hashJson(normalized) };
}

const costBurden = (action) => DISCOVERY_COST_COMPONENTS.reduce((sum, component) => (
  sum + Number(action.scientificCost?.[component]?.burden || 0)
), 0);

export function rankSignedCandidateActions({ inputRecords = [], candidates = [] } = {}) {
  const inputRecordHashes = [...new Set(inputRecords.map((record) => record?.recordHash).filter((hash) => SHA256_PATTERN.test(hash)))].sort();
  const rejectedActions = [];
  const admittedCandidates = [];
  for (const entry of candidates) {
    const record = entry.record || entry;
    const reasons = [...(entry.rejectionReasons || [])];
    if (!SHA256_PATTERN.test(record?.recordHash || '')) reasons.push('candidate_record_hash_is_invalid');
    if (record?.action?.schema !== DISCOVERY_CANDIDATE_ACTION_VERSION) reasons.push('candidate_contract_schema_is_invalid');
    if (record?.action?.status !== 'proposed') reasons.push('candidate_status_is_not_proposed');
    if (reasons.length) {
      rejectedActions.push({
        recordHash: record?.recordHash || null,
        actionId: record?.action?.contractHash || null,
        title: record?.action?.title || 'Rejected candidate',
        reasons: [...new Set(reasons)].sort()
      });
      continue;
    }
    const value = record.action.expectedValue;
    const burden = costBurden(record.action);
    const policy = DISCOVERY_CANDIDATE_ACTION_RANKING_POLICY;
    const rawScore = (value.uncertaintyReduction * policy.parameters.uncertaintyReductionWeight)
      + (value.decisionRelevance * policy.parameters.decisionRelevanceWeight)
      + (value.duplicateWorkAvoidance * policy.parameters.duplicateWorkAvoidanceWeight)
      - (burden * policy.parameters.costBurdenWeight);
    admittedCandidates.push({
      recordHash: record.recordHash,
      actionId: record.action.contractHash,
      actionKind: record.action.kind,
      title: record.action.title,
      rationale: record.action.rationale,
      questionHash: record.action.questionHash,
      affectedHypothesisHashes: [...record.action.affectedHypothesisHashes],
      predictedObservations: record.action.predictedObservations,
      falsifiers: record.action.falsifiers,
      execution: record.action.execution,
      uncertainty: record.action.uncertainty,
      feasibility: record.action.feasibility,
      independence: record.action.independence,
      safety: record.action.safety,
      consent: record.action.consent,
      scientificCost: record.action.scientificCost,
      expectedValue: value,
      rawValueComponents: {
        uncertaintyReduction: value.uncertaintyReduction,
        decisionRelevance: value.decisionRelevance,
        duplicateWorkAvoidance: value.duplicateWorkAvoidance,
        costBurden: burden
      },
      rankingScore: rawScore,
      rankingStatus: policy.status,
      humanApprovalState: entry.humanApprovalState || 'approval_required',
      approvalRecordHashes: [...(entry.approvalRecordHashes || [])].sort(),
      allocationAuthority: 'none',
      executionAuthority: 'none'
    });
  }
  admittedCandidates.sort((left, right) => right.rankingScore - left.rankingScore
    || left.actionId.localeCompare(right.actionId));
  return {
    schema: 'poolday.discovery_candidate_action_ranking/v1',
    policy: DISCOVERY_CANDIDATE_ACTION_RANKING_POLICY,
    inputRecordHashes,
    candidateActionRecordHashes: admittedCandidates.map((entry) => entry.recordHash).sort(),
    admittedCandidates,
    rejectedActions: rejectedActions.sort((left, right) => String(left.actionId).localeCompare(String(right.actionId))),
    selectedAction: admittedCandidates[0] || null,
    selectionAuthority: 'ranking_projection_only',
    allocationAuthority: 'none',
    executionAuthority: 'none'
  };
}

export default {
  DISCOVERY_CANDIDATE_ACTION_KINDS,
  DISCOVERY_CANDIDATE_ACTION_RANKING_POLICY,
  DISCOVERY_CANDIDATE_ACTION_VERSION,
  DISCOVERY_COST_COMPONENTS,
  DISCOVERY_UNCERTAINTY_REPRESENTATIONS,
  DISCOVERY_UNCERTAINTY_SOURCES,
  normalizeDiscoveryCandidateAction,
  normalizeDiscoveryUncertainty,
  rankSignedCandidateActions
};
