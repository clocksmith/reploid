import { describe, expect, it } from 'vitest';

import {
  createSignedHumanClaim,
  createSignedRealizedActionValue,
  projectResearchRewards,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const roomId = 'realized-value-room';
const at = (minute) => `2026-08-15T18:${String(minute).padStart(2, '0')}:00.000Z`;

const identity = async (kind, id) => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: `root_${id}`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const author = (role, id) => ({
  role,
  roleId: `${role}_${id}`,
  identityRootId: `root_${id}`
});

const fixture = async () => {
  const actionApprover = await identity('reviewer', 'action-approver');
  const outcomeReviewer = await identity('reviewer', 'outcome-reviewer');
  const evaluationReviewer = await identity('reviewer', 'evaluation-reviewer');
  const assessor = await identity('verifier', 'value-assessor');
  const valueReviewer = await identity('reviewer', 'value-reviewer');
  const question = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_submission',
    recordHash: fakeHash('1'),
    roomId,
    createdAt: at(0),
    author: author('requester', 'question')
  };
  const candidate = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_candidate_action',
    recordHash: fakeHash('2'),
    roomId,
    createdAt: at(1),
    questionHash: question.recordHash,
    author: author('researcher', 'action-proposer'),
    action: {
      contractHash: fakeHash('3'),
      affectedHypothesisHashes: [],
      expectedValue: { calibrationEvidenceHashes: [] }
    }
  };
  const candidateApproval = await createSignedHumanClaim({
    identity: actionApprover,
    roomId,
    targetHash: candidate.recordHash,
    claimKind: 'candidate_action_approval',
    relation: 'approves',
    text: 'Approve the exact candidate action contract for bounded execution.',
    confidence: 0.95,
    decision: 'approved',
    actionContractHash: candidate.action.contractHash,
    createdAt: at(2)
  });
  const cohort = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_cohort',
    recordHash: fakeHash('4'),
    roomId,
    createdAt: at(2),
    author: author('reviewer', 'cohort'),
    cohort: {
      questionHashes: [question.recordHash],
      predictionHashes: [],
      workOrderHashes: []
    }
  };
  const order = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_work_order',
    recordHash: fakeHash('5'),
    roomId,
    createdAt: at(3),
    questionHash: question.recordHash,
    author: author('researcher', 'order')
  };
  const workClaim = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_work_claim',
    recordHash: fakeHash('6'),
    roomId,
    createdAt: at(4),
    workOrderHash: order.recordHash,
    author: author('researcher', 'laboratory')
  };
  const outcome = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_outcome',
    recordHash: fakeHash('7'),
    roomId,
    createdAt: at(5),
    questionHash: question.recordHash,
    workOrderHash: order.recordHash,
    workClaimHash: workClaim.recordHash,
    hypothesisHashes: [],
    replicationOfHash: null,
    author: author('researcher', 'laboratory')
  };
  const outcomeReview = await createSignedHumanClaim({
    identity: outcomeReviewer,
    roomId,
    targetHash: outcome.recordHash,
    claimKind: 'review_decision',
    relation: 'reviews',
    text: 'The outcome satisfies the frozen protocol and analysis contract.',
    confidence: 0.95,
    decision: 'accepted',
    createdAt: at(6)
  });
  const baselineValue = 0.5;
  const currentValue = 0.7;
  const absoluteDelta = currentValue - baselineValue;
  const evaluation = {
    version: 'poolday.research_evidence/v2',
    kind: 'research_evaluation',
    recordHash: fakeHash('8'),
    roomId,
    createdAt: at(7),
    cohortHash: cohort.recordHash,
    author: author('verifier', 'evaluator'),
    evaluation: {
      outcomeHashes: [outcome.recordHash],
      metricResults: [{
        metricId: 'decision_quality',
        direction: 'higher_is_better',
        baselineValue,
        currentValue,
        absoluteDelta,
        relativeDelta: absoluteDelta / baselineValue,
        improved: true
      }],
      nextCohortQuestionHashes: []
    }
  };
  const evaluationReview = await createSignedHumanClaim({
    identity: evaluationReviewer,
    roomId,
    targetHash: evaluation.recordHash,
    claimKind: 'review_decision',
    relation: 'reviews',
    text: 'The evaluation matches the frozen cohort and reviewed outcome.',
    confidence: 0.95,
    decision: 'accepted',
    createdAt: at(8)
  });
  const contributions = [
    [candidate, 'action_proposal', 'Proposed the exact action later measured.'],
    [candidateApproval, 'independent_review', 'Approved the exact candidate action contract.'],
    [evaluation, 'evaluation', 'Measured the frozen baseline and current result.'],
    [evaluationReview, 'independent_review', 'Accepted the measured evaluation independently.'],
    [outcome, 'outcome_execution', 'Produced the reviewed downstream observation.'],
    [outcomeReview, 'independent_review', 'Accepted the outcome against its frozen contract.']
  ].map(([record, role, causalRationale]) => ({ recordHash: record.recordHash, role, causalRationale }));
  const value = await createSignedRealizedActionValue({
    identity: assessor,
    roomId,
    questionHash: question.recordHash,
    candidateActionHash: candidate.recordHash,
    actionContractHash: candidate.action.contractHash,
    candidateActionApprovalHashes: [candidateApproval.recordHash],
    evaluationHash: evaluation.recordHash,
    evaluationReviewDecisionHashes: [evaluationReview.recordHash],
    reviewedOutcomes: [{
      outcomeHash: outcome.recordHash,
      reviewDecisionHashes: [outcomeReview.recordHash]
    }],
    contributions,
    metricResults: evaluation.evaluation.metricResults,
    decisionEffect: 'narrowed_uncertainty',
    summary: 'The reviewed action narrowed the bounded decision and improved the frozen quality metric without regression.',
    createdAt: at(9)
  });
  const records = [
    question,
    candidate,
    candidateApproval,
    cohort,
    order,
    workClaim,
    outcome,
    outcomeReview,
    evaluation,
    evaluationReview,
    value
  ];
  const valueReview = await createSignedHumanClaim({
    identity: valueReviewer,
    roomId,
    targetHash: value.recordHash,
    claimKind: 'review_decision',
    relation: 'reviews',
    text: 'The causal contribution set and measured vector are complete.',
    confidence: 0.95,
    decision: 'accepted',
    createdAt: at(10)
  });
  return { records, value, valueReview, assessor, candidate, evaluation, contributions };
};

describe('Poolday realized action value', () => {
  it('binds reviewed outcomes and a frozen evaluation before issuing usefulness credit', async () => {
    const { records, value, valueReview } = await fixture();

    expect(await verifyResearchRecord(value)).toEqual({ ok: true, reasons: [], recordHash: value.recordHash });
    expect(validateResearchRecordLinks(value, records)).toEqual({ ok: true, reasons: [], targetHashes: expect.any(Array) });
    expect(value.realizedValue).toMatchObject({
      schema: 'poolday.realized_action_value/v1',
      assessment: { status: 'demonstrated_useful', decisionEffect: 'narrowed_uncertainty' },
      reward: { eligibility: 'requires_independent_acceptance' }
    });

    expect(projectResearchRewards(records).find((entry) => entry.authorId === 'researcher_action-proposer')).toBeUndefined();
    const rewards = projectResearchRewards([...records, valueReview]);
    expect(rewards).toContainEqual(expect.objectContaining({
      authorId: 'researcher_action-proposer',
      realizedActionValues: 1,
      realizedUsefulnessCredits: 1,
      realizedValuePoints: 10,
      points: 10
    }));
    expect(rewards).toContainEqual(expect.objectContaining({
      authorId: 'researcher_laboratory',
      realizedUsefulnessCredits: 1,
      realizedValuePoints: 10
    }));
  });

  it('rejects self-credit and a value vector that differs from its evaluation', async () => {
    const { records, value } = await fixture();
    const selfCrediting = structuredClone(value);
    selfCrediting.author.identityRootId = records.find((record) => record.kind === 'research_candidate_action').author.identityRootId;
    expect(validateResearchRecordLinks(selfCrediting, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining([expect.stringContaining('assessor cannot credit itself')])
    }));

    const mismatched = structuredClone(value);
    mismatched.realizedValue.metricResults[0].currentValue = 0.8;
    expect(validateResearchRecordLinks(mismatched, records)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining([expect.stringContaining('metric differs from its evaluation')])
    }));
  });
});
