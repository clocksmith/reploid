/**
 * @fileoverview Replayable, non-calibrated action ranking for Poolday evidence.
 *
 * The ranking helps researchers inspect a bounded next action. It does not
 * allocate work, estimate biological truth, or expose a calibrated probability.
 */

export const DISCOVERY_ACTION_VALUE_POLICY = Object.freeze({
  policyId: 'poolday.heuristic_action_value/v1',
  version: '1.0.0',
  status: 'heuristic_not_calibrated',
  method: 'missing-evidence-and-uncertainty-priority',
  units: 'relative planning units',
  calibrationEvidence: []
});

const DEFAULT_PROFILE = Object.freeze({
  uncertaintyReduction: 3,
  decisionRelevance: 3,
  duplicateWorkAvoidance: 2,
  scientificCost: Object.freeze({ compute: 1, money: 0, labor: 1, instrument: 0, sample: 0, elapsedTime: 1 }),
  humanApprovalRequired: true
});

const ACTION_PROFILES = Object.freeze({
  clarify_question: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 1, instrument: 0, sample: 0, elapsedTime: 1 } },
  compute: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 4, scientificCost: { compute: 3, money: 0, labor: 0.5, instrument: 0, sample: 0, elapsedTime: 1 } },
  independent_review: { uncertaintyReduction: 5, decisionRelevance: 4, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 1 } },
  revise_evidence: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 1 } },
  reproduce: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 4, scientificCost: { compute: 3, money: 0, labor: 0.5, instrument: 0, sample: 0, elapsedTime: 2 } },
  retrieve_prior_evidence: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 5, scientificCost: { compute: 1, money: 0, labor: 1, instrument: 0, sample: 0, elapsedTime: 1 } },
  add_competing_hypothesis: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 4, scientificCost: { compute: 0, money: 0, labor: 1, instrument: 0, sample: 0, elapsedTime: 1 } },
  run_diverse_predictor: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 4, scientificCost: { compute: 3, money: 0, labor: 0.5, instrument: 0, sample: 0, elapsedTime: 2 } },
  design_discriminating_assay: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 4, scientificCost: { compute: 0, money: 0, labor: 3, instrument: 1, sample: 1, elapsedTime: 3 } },
  expert_refine_assay: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 3, instrument: 0, sample: 0, elapsedTime: 2 } },
  claim_experimental_work: { uncertaintyReduction: 2, decisionRelevance: 3, duplicateWorkAvoidance: 3, scientificCost: { compute: 0, money: 0, labor: 1, instrument: 1, sample: 1, elapsedTime: 2 } },
  perform_assay: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 3, scientificCost: { compute: 0, money: 4, labor: 4, instrument: 4, sample: 4, elapsedTime: 5 } },
  replicate_assay: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 4, labor: 4, instrument: 4, sample: 4, elapsedTime: 5 } },
  review_outcome: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 1 } },
  freeze_prospective_cohort: { uncertaintyReduction: 4, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 1, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 2 } },
  evaluate_frozen_cohort: { uncertaintyReduction: 4, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 2, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 2 } },
  analyze_cohort_failure: { uncertaintyReduction: 4, decisionRelevance: 4, duplicateWorkAvoidance: 5, scientificCost: { compute: 1, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 2 } },
  define_next_cohort: { uncertaintyReduction: 3, decisionRelevance: 4, duplicateWorkAvoidance: 4, scientificCost: { compute: 0, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 1 } },
  resolve_uncertainty: { uncertaintyReduction: 5, decisionRelevance: 4, duplicateWorkAvoidance: 4, scientificCost: { compute: 0, money: 0, labor: 2, instrument: 0, sample: 0, elapsedTime: 1 } },
  adjudicate_contradiction: { uncertaintyReduction: 5, decisionRelevance: 5, duplicateWorkAvoidance: 5, scientificCost: { compute: 0, money: 0, labor: 3, instrument: 0, sample: 0, elapsedTime: 2 } },
  follow_up: { uncertaintyReduction: 3, decisionRelevance: 3, duplicateWorkAvoidance: 3, scientificCost: { compute: 0, money: 0, labor: 1, instrument: 0, sample: 0, elapsedTime: 1 } }
});

export const ADMITTED_DISCOVERY_ACTION_KINDS = Object.freeze(Object.keys(ACTION_PROFILES));

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RANKABLE_ACTION_STATUSES = new Set(['proposed', 'approved']);
const ACTION_BASIS_KINDS = new Set(['question_anchor', 'governance', 'accepted_memory']);
const stableUnique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && SHA256_PATTERN.test(value)))].sort();
const compactText = (value, max = 8000) => typeof value === 'string' ? value.trim().slice(0, max) : '';

const profileFor = (kind) => ({
  ...DEFAULT_PROFILE,
  ...(ACTION_PROFILES[kind] || {}),
  scientificCost: {
    ...DEFAULT_PROFILE.scientificCost,
    ...(ACTION_PROFILES[kind]?.scientificCost || {})
  }
});

const totalCost = (cost) => Object.values(cost).reduce((total, value) => total + Number(value || 0), 0);

const validateAction = (task, inputRecordHashes, seenActionIds) => {
  const actionKind = compactText(task?.kind, 120);
  const targetHash = compactText(task?.targetHash, 160);
  const status = compactText(task?.status, 64) || 'proposed';
  const reason = compactText(task?.reason);
  const actionId = compactText(task?.taskId, 320) || `task:${actionKind}:${targetHash}`;
  const basis = compactText(task?.basis, 64) || 'governance';
  const basisHashes = stableUnique(Array.isArray(task?.basisHashes) && task.basisHashes.length
    ? task.basisHashes
    : [targetHash]);
  const reasons = [];
  if (!ADMITTED_DISCOVERY_ACTION_KINDS.includes(actionKind)) reasons.push('action_kind_is_not_admitted');
  if (!SHA256_PATTERN.test(targetHash)) reasons.push('target_hash_is_not_a_sha256_identity');
  else if (!inputRecordHashes.includes(targetHash)) reasons.push('target_hash_is_not_in_the_input_evidence_set');
  if (!RANKABLE_ACTION_STATUSES.has(status)) reasons.push('action_status_is_not_rankable');
  if (!reason) reasons.push('action_reason_is_required');
  if (!actionId) reasons.push('action_id_is_required');
  if (seenActionIds.has(actionId)) reasons.push('action_id_is_not_unique');
  if (!ACTION_BASIS_KINDS.has(basis)) reasons.push('action_basis_is_not_admitted');
  if (basisHashes.some((hash) => !inputRecordHashes.includes(hash))) reasons.push('action_basis_is_not_in_the_input_evidence_set');
  return { actionId, actionKind, targetHash, status, reason, basis, basisHashes, reasons };
};

/**
 * Ranks already-admitted task proposals. Every result exposes its exact input
 * record set and method. Scores are only an ordinal planning heuristic.
 */
export function rankDiscoveryActions(records = [], tasks = []) {
  const sourceRecords = Array.isArray(records) ? records : [];
  const sourceTasks = Array.isArray(tasks) ? tasks : [];
  const invalidInputRecords = sourceRecords
    .map((record, index) => ({ index, recordHash: record?.recordHash }))
    .filter(({ recordHash }) => typeof recordHash !== 'string' || !SHA256_PATTERN.test(recordHash));
  const inputRecordHashes = stableUnique(sourceRecords.map((record) => record?.recordHash));
  const base = {
    schema: 'poolday.discovery_action_ranking/v1',
    policy: DISCOVERY_ACTION_VALUE_POLICY,
    inputRecordHashes,
    inputValidation: invalidInputRecords.length
      ? { status: 'rejected_invalid_input_evidence', invalidInputRecords }
      : { status: 'accepted' },
    allocation: 'not_authorized_by_heuristic_projection',
    executionAuthority: 'none'
  };
  if (invalidInputRecords.length) {
    return {
      ...base,
      candidateActionIds: [],
      rejectedActions: [],
      rankedCandidates: [],
      selectedAction: null
    };
  }

  const seenActionIds = new Set();
  const rejectedActions = [];
  const admittedTasks = [];
  for (const task of sourceTasks) {
    const candidate = validateAction(task, inputRecordHashes, seenActionIds);
    seenActionIds.add(candidate.actionId);
    if (candidate.reasons.length) {
      rejectedActions.push({
        actionId: candidate.actionId,
        actionKind: candidate.actionKind || null,
        targetHash: candidate.targetHash || null,
        reasons: candidate.reasons
      });
    } else {
      admittedTasks.push(candidate);
    }
  }
  const candidates = admittedTasks.map((task) => {
    const profile = profileFor(task.actionKind);
    const cost = profile.scientificCost;
    const rawScore = (profile.uncertaintyReduction * 10)
      + (profile.decisionRelevance * 8)
      + (profile.duplicateWorkAvoidance * 6)
      - totalCost(cost);
    return {
      actionId: task.actionId,
      actionKind: task.actionKind,
      targetHash: task.targetHash,
      status: task.status,
      reason: task.reason,
      basis: task.basis,
      basisHashes: task.basisHashes,
      humanApprovalRequired: profile.humanApprovalRequired !== false,
      expectedInformationGain: {
        estimate: profile.uncertaintyReduction,
        units: 'ordinal heuristic uncertainty-reduction units',
        method: DISCOVERY_ACTION_VALUE_POLICY.method,
        calibrationEvidence: []
      },
      decisionChangeProbability: {
        status: 'unassessed_not_calibrated',
        value: null
      },
      scientificCost: {
        units: DISCOVERY_ACTION_VALUE_POLICY.units,
        ...cost
      },
      valueComponents: {
        uncertaintyReduction: profile.uncertaintyReduction,
        decisionRelevance: profile.decisionRelevance,
        duplicateWorkAvoidance: profile.duplicateWorkAvoidance,
        totalCost: totalCost(cost)
      },
      heuristicPriority: rawScore
    };
  }).sort((left, right) => right.heuristicPriority - left.heuristicPriority
    || left.actionId.localeCompare(right.actionId));
  return {
    ...base,
    candidateActionIds: candidates.map((candidate) => candidate.actionId),
    rejectedActions: rejectedActions.sort((left, right) => left.actionId.localeCompare(right.actionId)),
    rankedCandidates: candidates,
    selectedAction: candidates[0] || null
  };
}

export default { ADMITTED_DISCOVERY_ACTION_KINDS, DISCOVERY_ACTION_VALUE_POLICY, rankDiscoveryActions };
