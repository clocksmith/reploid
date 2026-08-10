/**
 * @fileoverview Deterministic governed feedback cycle for a Poolday Research Room.
 *
 * This module is a projection only. It does not sign, persist, approve, execute,
 * or allocate work. Every proposed next question names the accepted evidence
 * that supports it and leaves execution authority with a human reviewer.
 */

import {
  RESEARCH_RECORD_KINDS,
  activeResearchRecords,
  buildPredictionDisagreementMap,
  projectAcceptedResearchMemory,
  projectResearchExecutionIndependence,
  projectResearchQuestionClarity,
  projectResearchReviewStates,
  proposeDiscoveryTasks,
  rankProposedDiscoveryActions,
  researchRecordTargetHashes
} from './evidence-network.js';

export const RESEARCH_CYCLE_POLICY = Object.freeze({
  schema: 'poolday.governed_research_cycle/v1',
  policyId: 'poolday.accepted-memory-feedback/v1',
  humanDecisionAuthority: 'required',
  executionAuthority: 'none',
  memoryAdmission: 'independent_acceptance_fail_closed',
  uncertaintyPolicy: 'preserve_and_expose'
});

const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values.filter(Boolean).map(String))].sort();
const time = (record) => {
  const value = Date.parse(record?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
};
const byTime = (left, right) => time(left) - time(right)
  || text(left?.recordHash).localeCompare(text(right?.recordHash));

const latestQuestion = (records, questionHash = null) => {
  const questions = records
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)
    .sort(byTime);
  return (questionHash ? questions.find((record) => record.recordHash === questionHash) : questions.at(-1)) || null;
};

const recordsForQuestion = (records, question) => {
  if (!question) return [];
  const included = new Set([question.recordHash]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (included.has(record.recordHash)) continue;
      if (researchRecordTargetHashes(record).some((targetHash) => included.has(targetHash))) {
        included.add(record.recordHash);
        changed = true;
      }
    }
  }
  return records.filter((record) => included.has(record.recordHash)).sort(byTime);
};

const projectExecution = (records, reviewStates) => records
  .filter((record) => record.kind === RESEARCH_RECORD_KINDS.result)
  .map((record) => {
    const independence = projectResearchExecutionIndependence(record);
    const agreementStatus = text(record.compute?.agreement?.status).toLowerCase() || 'not_assessed';
    return {
      recordHash: record.recordHash,
      modelContract: record.modelContract || null,
      primaryReceiptHash: record.compute?.receiptHash || null,
      receiptHashes: independence.receiptHashes,
      providerIds: independence.providerIds,
      independentReceiptCount: independence.independentReceiptCount,
      independentProviderCount: independence.independentProviderCount,
      reproducibility: independence.status,
      agreement: ['accepted', 'agreed'].includes(agreementStatus) && !independence.independentlyExecuted
        ? 'invalid_independence_claim'
        : agreementStatus,
      reviewState: reviewStates.get(record.recordHash)?.state || 'unresolved'
    };
  });

const projectReview = (cycleRecords, reviewStates) => {
  const states = cycleRecords.map((record) => reviewStates.get(record.recordHash)).filter(Boolean);
  return {
    accepted: states.filter((entry) => entry.state === 'accepted').map((entry) => entry.recordHash).sort(),
    rejected: states.filter((entry) => entry.state === 'rejected').map((entry) => entry.recordHash).sort(),
    needsRevision: states.filter((entry) => entry.state === 'needs_revision').map((entry) => entry.recordHash).sort(),
    replicationRequested: states.filter((entry) => entry.state === 'replication_requested').map((entry) => entry.recordHash).sort(),
    disputed: states.filter((entry) => entry.state === 'disputed').map((entry) => entry.recordHash).sort(),
    unresolved: states.filter((entry) => entry.state === 'unresolved').map((entry) => entry.recordHash).sort(),
    decisions: states.flatMap((entry) => entry.decisions.map((decision) => ({
      recordHash: decision.recordHash,
      targetHash: entry.recordHash,
      decision: decision.claim?.decision || null,
      reviewerIdentityRootId: decision.author?.identityRootId || null
    })))
  };
};

const evidenceGaps = ({ clarity, executions, review, tasks }) => {
  const gaps = clarity.gaps.map((gap) => ({
    kind: 'question_clarity',
    field: gap.field,
    detail: gap.reason,
    targetHash: null
  }));
  if (!executions.length) gaps.push({
    kind: 'execution',
    field: 'receipt_backed_result',
    detail: 'No signed receipt-backed result exists for this question.',
    targetHash: null
  });
  for (const execution of executions.filter((entry) => entry.reproducibility !== 'independently_reproduced')) gaps.push({
    kind: 'reproducibility',
    field: 'independent_receipts',
    detail: 'The result lacks two distinct receipt and provider identities.',
    targetHash: execution.recordHash
  });
  for (const targetHash of review.replicationRequested) gaps.push({
    kind: 'review',
    field: 'replication_requested',
    detail: 'An independent reviewer requested replication before memory admission.',
    targetHash
  });
  for (const targetHash of review.disputed) gaps.push({
    kind: 'review',
    field: 'disputed_review',
    detail: 'Independent reviewers reached conflicting decisions.',
    targetHash
  });
  for (const task of tasks.filter((entry) => entry.basis === 'accepted_memory')) gaps.push({
    kind: 'accepted_memory',
    field: task.kind,
    detail: task.reason,
    targetHash: task.targetHash
  });
  return gaps;
};

const nextQuestionPrompt = (action) => ({
  clarify_question: 'Which conditions, decision boundary, and observable result must be stated before this question can guide evidence?',
  compute: 'What exact receipt-backed output does the declared model contract produce for this signed sequence and question?',
  independent_review: 'Does the targeted evidence satisfy its provenance, independence, uncertainty, and claim-boundary requirements?',
  revise_evidence: 'What correction or missing context would resolve the reviewer request without editing prior evidence in place?',
  reproduce: 'Does an independent execution reproduce the committed result under the same exact model and workload contract?',
  retrieve_prior_evidence: 'Which version-pinned prior evidence changes the competing explanations supported by accepted memory?',
  add_competing_hypothesis: 'What condition-specific alternative hypothesis would make a different observable prediction from the accepted evidence?',
  run_diverse_predictor: 'Does a distinct exact method produce a discriminating frozen prediction for this accepted hypothesis?',
  design_discriminating_assay: 'Which bounded protocol and observation would distinguish the accepted competing hypotheses?',
  adjudicate_contradiction: 'Which additional evidence would resolve the preserved disagreement without hiding either reviewer or source?',
  claim_experimental_work: 'Which qualified and consenting laboratory can execute the accepted bounded work order?',
  perform_assay: 'What outcome does the accepted protocol produce under its frozen controls, conditions, and analysis contract?',
  replicate_assay: 'Does an independent laboratory reproduce the accepted outcome under the declared independence conditions?',
  freeze_prospective_cohort: 'Which accepted predictions and work orders should be frozen before outcomes become available?',
  evaluate_frozen_cohort: 'Did the frozen accepted evidence improve the predeclared metric against its baseline?',
  analyze_cohort_failure: 'Which recorded failure or dependency explains why the accepted cohort did not improve its frozen metric?',
  define_next_cohort: 'Which bounded next question follows from the accepted cohort evaluation and its remaining uncertainty?'
}[action?.actionKind || action?.kind] || 'What bounded observation would most directly reduce the uncertainty preserved by accepted room memory?');

const projectNextQuestion = ({ question, clarity, memory, tasks, rankedCandidates, disagreements, gaps }) => {
  if (!question) return {
    status: 'needs_human_question',
    prompt: null,
    actionKind: null,
    basisHashes: [],
    uncertainty: ['No signed question and sequence anchor exists.'],
    humanApprovalRequired: true,
    executionAuthority: 'none'
  };
  const rankedById = new Map(rankedCandidates.map((entry) => [entry.actionId, entry]));
  const candidates = tasks.map((task) => ({
    ...task,
    ...(rankedById.get(task.taskId) || {})
  }))
    .sort((left, right) => Number(right.heuristicPriority || 0) - Number(left.heuristicPriority || 0)
      || left.taskId.localeCompare(right.taskId));
  const action = clarity.status !== 'bounded'
    ? candidates.find((candidate) => (candidate.actionKind || candidate.kind) === 'clarify_question') || candidates[0] || null
    : candidates[0] || null;
  const acceptedBasis = action?.basis === 'accepted_memory'
    ? unique((action.basisHashes || []).filter((hash) => memory.acceptedHashes.includes(hash)))
    : [];
  const approvalRecordHashes = unique(action?.approvalRecordHashes || []);
  const status = clarity.status !== 'bounded'
    ? 'needs_clarification'
    : !memory.acceptedHashes.length
      ? 'awaiting_accepted_evidence'
      : action
        ? approvalRecordHashes.length
          ? 'approved_proposal_requires_allocation'
          : 'proposal_ready_for_human_review'
        : 'cycle_review_required';
  return {
    status,
    prompt: action
      ? nextQuestionPrompt(action)
      : 'What uncertainty should the room test next using only accepted evidence?',
    rationale: action?.reason || null,
    actionKind: action?.actionKind || action?.kind || null,
    targetHash: action?.targetHash || question.recordHash,
    basis: action?.basis || 'question_anchor',
    basisHashes: acceptedBasis,
    approvalRecordHashes,
    uncertainty: unique([
      ...gaps.slice(0, 8).map((gap) => gap.detail),
      ...disagreements.map((entry) => entry.detail)
    ]),
    humanApprovalRequired: approvalRecordHashes.length === 0,
    humanApprovalStatus: approvalRecordHashes.length ? 'approved' : 'required',
    executionAuthority: 'none'
  };
};

/**
 * Projects one complete question-to-next-question cycle from signed records.
 */
export function projectGovernedResearchCycle(records = [], { questionHash = null } = {}) {
  const active = activeResearchRecords(Array.isArray(records) ? records : []);
  const question = latestQuestion(active, questionHash);
  const cycleRecords = recordsForQuestion(active, question);
  const reviewStates = new Map(projectResearchReviewStates(cycleRecords).map((entry) => [entry.recordHash, entry]));
  const clarity = projectResearchQuestionClarity(question);
  const execution = projectExecution(cycleRecords, reviewStates);
  const review = projectReview(cycleRecords, reviewStates);
  const memory = projectAcceptedResearchMemory(cycleRecords);
  const tasks = proposeDiscoveryTasks(cycleRecords);
  const ranking = rankProposedDiscoveryActions(cycleRecords);
  const predictionDisagreements = question
    ? buildPredictionDisagreementMap(cycleRecords, question.recordHash)
      .filter((entry) => entry.disagreement)
      .map((entry) => ({
        kind: 'prediction_disagreement',
        targetHash: question.recordHash,
        detail: `${entry.predictionCount} accepted or provisional predictions disagree under the same conditions.`
      }))
    : [];
  const disagreements = [
    ...review.disputed.map((targetHash) => ({
      kind: 'review_disagreement',
      targetHash,
      detail: 'Independent reviewer decisions conflict and remain outside memory.'
    })),
    ...execution.filter((entry) => ['rejected', 'disagreement', 'redundant_disagreement'].includes(entry.agreement)).map((entry) => ({
      kind: 'execution_disagreement',
      targetHash: entry.recordHash,
      detail: 'Independent execution evidence records disagreement.'
    })),
    ...predictionDisagreements
  ];
  const gaps = evidenceGaps({ clarity, executions: execution, review, tasks });
  const nextQuestion = projectNextQuestion({
    question,
    clarity,
    memory,
    tasks,
    rankedCandidates: ranking.rankedCandidates || [],
    disagreements,
    gaps
  });
  return {
    ...RESEARCH_CYCLE_POLICY,
    question: question ? {
      recordHash: question.recordHash,
      sequenceHash: question.sequence?.hash || null,
      sequenceLength: question.sequence?.length || null,
      intent: question.requesterIntent || null
    } : null,
    clarity,
    execution,
    evidence: {
      signedRecordHashes: cycleRecords.map((record) => record.recordHash),
      agreement: execution.map((entry) => ({ recordHash: entry.recordHash, status: entry.agreement })),
      disagreements,
      gaps
    },
    review,
    memory: {
      ...memory,
      records: memory.records.map((record) => ({
        recordHash: record.recordHash,
        kind: record.kind,
        reviewDecisionHashes: reviewStates.get(record.recordHash)?.decisions.map((decision) => decision.recordHash) || []
      }))
    },
    actions: tasks.map((task) => ({ ...task })),
    ranking,
    nextQuestion,
    stages: [
      { id: 'question', status: clarity.status },
      { id: 'independent_execution', status: execution.length ? execution.every((entry) => entry.reproducibility === 'independently_reproduced') ? 'complete' : 'partial' : 'missing' },
      { id: 'signed_provenance', status: execution.length ? 'recorded' : 'missing' },
      { id: 'agreement_and_gaps', status: disagreements.length || gaps.length ? 'open' : 'clear' },
      { id: 'human_review', status: review.disputed.length ? 'disputed' : review.replicationRequested.length ? 'replication_requested' : review.accepted.length ? 'active' : 'pending' },
      { id: 'accepted_memory', status: memory.acceptedHashes.length ? 'available' : 'empty' },
      { id: 'next_question', status: nextQuestion.status }
    ]
  };
}

export default { RESEARCH_CYCLE_POLICY, projectGovernedResearchCycle };
