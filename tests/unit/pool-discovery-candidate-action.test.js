import { describe, expect, it } from 'vitest';

import {
  createSignedCandidateAction,
  createSignedHumanClaim,
  createSignedResearchHypothesis,
  createSignedResearchSubmission,
  projectAcceptedResearchMemory,
  rankProposedCandidateActions,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import {
  DISCOVERY_COST_COMPONENTS,
  normalizeDiscoveryCandidateAction,
  rankSignedCandidateActions
} from '../../self/pool/discovery-candidate-action.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const at = (minute) => `2026-08-15T12:${String(minute).padStart(2, '0')}:00.000Z`;
const modelContract = {
  id: 'esm2-candidate-action',
  hash: fakeHash('1'),
  manifestHash: fakeHash('2'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
};

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

const scientificCost = (burden = 1) => Object.fromEntries([
  ...DISCOVERY_COST_COMPONENTS.map((component) => [component, {
    amount: component === 'money' ? 25 : 1,
    unit: {
      compute: 'gpu-second',
      money: 'USD',
      labor: 'person-hour',
      instrument: 'instrument-hour',
      sample: 'sample',
      elapsedTime: 'hour'
    }[component],
    burden
  }]),
  ['assumptions', ['Public catalog access is available.', 'Declared amounts are estimates, not allocation commitments.']]
]);

const action = ({ questionHash, hypothesisHash, uncertainty, burden = 1, title = 'Retrieve a second pinned annotation' }) => ({
  questionHash,
  kind: 'retrieval',
  title,
  rationale: 'A version-pinned independent source could discriminate the competing annotation.',
  affectedHypothesisHashes: [hypothesisHash],
  predictedObservations: [{
    observation: 'The independent catalog assigns the declared family under its current release.',
    affectedHypothesisHashes: [hypothesisHash]
  }],
  falsifiers: [{
    hypothesisHash,
    observation: 'The independent catalog assigns an incompatible family with stronger source evidence.'
  }],
  execution: {
    contractKind: 'workload',
    contractId: 'public-catalog-retrieval',
    version: '1.0.0',
    artifactHash: fakeHash('3'),
    parametersHash: fakeHash('4')
  },
  uncertainty: uncertainty || [{
    source: 'cross_source_disagreement',
    representation: 'ordinal',
    rationale: 'The two catalog sources currently disagree.',
    ordinal: { level: 'high', scaleId: 'poolday.disagreement.v1', scaleVersion: '1.0.0' }
  }],
  feasibility: {
    status: 'feasible',
    requiredCapabilities: ['version-pinned public HTTP retrieval'],
    availability: 'The public source and release identifier are available.',
    materials: [],
    failureRisks: ['The public endpoint may omit historical releases.']
  },
  independence: {
    dimensions: ['source organization', 'curation process'],
    exclusions: ['Do not use a mirror of the first catalog.'],
    minimumIndependentExecutions: 1
  },
  safety: {
    classification: 'public-data-only',
    requirements: ['Retrieve only the explicitly public protein record.'],
    reviewRequired: true
  },
  consent: {
    publicSequenceRequired: true,
    publicEvidencePublicationRequired: true,
    additionalRequirements: []
  },
  scientificCost: scientificCost(burden),
  expectedValue: {
    status: 'heuristic_not_calibrated',
    method: { id: 'curator-declared-ordinal-value', version: '1.0.0' },
    uncertaintyReduction: 4,
    decisionRelevance: 5,
    duplicateWorkAvoidance: 3,
    calibrationEvidenceHashes: []
  }
});

const createQuestionFixture = async () => {
  const requester = await identity('requester', 'requester');
  const researcher = await identity('researcher', 'researcher');
  const reviewer = await identity('reviewer', 'reviewer');
  const question = await createSignedResearchSubmission({
    identity: requester,
    roomId: 'candidate-action-room',
    sequence: 'MPEPTIDESEQ',
    intent: { kind: 'question', label: 'Disputed family', text: 'Which public family annotation is best supported?' },
    consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
    modelContract,
    policyId: 'redundant_agreement',
    createdAt: at(0)
  });
  const hypothesis = await createSignedResearchHypothesis({
    identity: researcher,
    roomId: question.roomId,
    questionHash: question.recordHash,
    statement: 'The protein belongs to public family A.',
    rationale: 'One version-pinned annotation assigns family A.',
    conditions: { biologicalSystem: 'public catalog release 2026.08' },
    discriminatingObservations: ['An independent catalog assigns family A.'],
    createdAt: at(1)
  });
  return { requester, researcher, reviewer, question, hypothesis, records: [question, hypothesis] };
};

describe('Poolday governed candidate actions', () => {
  it('signs, verifies, links, ranks, and independently approves a proposal without granting allocation authority', async () => {
    const fixture = await createQuestionFixture();
    const candidate = await createSignedCandidateAction({
      identity: fixture.researcher,
      roomId: fixture.question.roomId,
      questionHash: fixture.question.recordHash,
      action: action({ questionHash: fixture.question.recordHash, hypothesisHash: fixture.hypothesis.recordHash }),
      createdAt: at(2)
    });
    expect(await verifyResearchRecord(candidate)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(candidate, fixture.records)).toMatchObject({ ok: true });
    expect(candidate.action).toMatchObject({
      schema: 'poolday.discovery_candidate_action/v1',
      status: 'proposed',
      allocationAuthority: 'none',
      executionAuthority: 'none',
      humanApprovalRequired: true
    });

    const selfApproval = await createSignedHumanClaim({
      identity: fixture.researcher,
      roomId: candidate.roomId,
      targetHash: candidate.recordHash,
      claimKind: 'candidate_action_approval',
      relation: 'approves',
      decision: 'approved',
      actionContractHash: candidate.action.contractHash,
      text: 'Approve this candidate action.',
      confidence: 1,
      createdAt: at(3)
    });
    expect(validateResearchRecordLinks(selfApproval, [...fixture.records, candidate])).toMatchObject({ ok: false });

    const approval = await createSignedHumanClaim({
      identity: fixture.reviewer,
      roomId: candidate.roomId,
      targetHash: candidate.recordHash,
      claimKind: 'candidate_action_approval',
      relation: 'approves',
      decision: 'approved',
      actionContractHash: candidate.action.contractHash,
      text: 'Approve this bounded public retrieval action under its exact contract.',
      confidence: 0.95,
      createdAt: at(4)
    });
    expect(await verifyResearchRecord(approval)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(approval, [...fixture.records, candidate])).toMatchObject({ ok: true });

    const records = [...fixture.records, candidate, approval];
    const ranking = rankProposedCandidateActions(records);
    expect(ranking).toMatchObject({
      schema: 'poolday.discovery_candidate_action_ranking/v1',
      selectionAuthority: 'ranking_projection_only',
      allocationAuthority: 'none',
      executionAuthority: 'none',
      selectedAction: {
        recordHash: candidate.recordHash,
        actionId: candidate.action.contractHash,
        humanApprovalState: 'approved',
        allocationAuthority: 'none',
        executionAuthority: 'none'
      }
    });
    expect(ranking.selectedAction.rawValueComponents).toEqual({
      uncertaintyReduction: 4,
      decisionRelevance: 5,
      duplicateWorkAvoidance: 3,
      costBurden: 6
    });
    const memory = projectAcceptedResearchMemory(records);
    expect(memory.acceptedHashes).not.toContain(candidate.recordHash);
    expect(memory.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordHash: candidate.recordHash, reason: 'candidate_action_is_a_governance_proposal' }),
      expect.objectContaining({ recordHash: approval.recordHash, reason: 'candidate_action_approval_is_governance_not_scientific_evidence' })
    ]));
  });

  it('rejects numeric probability without a named calibration method and frozen cohort identity', async () => {
    const fixture = await createQuestionFixture();
    await expect(normalizeDiscoveryCandidateAction(action({
      questionHash: fixture.question.recordHash,
      hypothesisHash: fixture.hypothesis.recordHash,
      uncertainty: [{
        source: 'model_uncertainty',
        representation: 'probability',
        rationale: 'The model estimate is stochastic.',
        probability: 0.4
      }]
    }))).rejects.toThrow('probability calibration method id is required');
  });

  it('requires a probability calibration cohort to be frozen and independently accepted', async () => {
    const fixture = await createQuestionFixture();
    const cohortHash = fakeHash('a');
    const candidate = await createSignedCandidateAction({
      identity: fixture.researcher,
      roomId: fixture.question.roomId,
      questionHash: fixture.question.recordHash,
      action: action({
        questionHash: fixture.question.recordHash,
        hypothesisHash: fixture.hypothesis.recordHash,
        uncertainty: [{
          source: 'model_uncertainty',
          representation: 'probability',
          rationale: 'A frozen cohort calibrated this estimate.',
          probability: 0.4,
          calibration: {
            methodId: 'isotonic-protein-family',
            version: '2.0.0',
            cohortHash,
            metricId: 'expected_calibration_error'
          }
        }]
      }),
      createdAt: at(2)
    });
    const missing = validateResearchRecordLinks(candidate, fixture.records);
    expect(missing.ok).toBe(false);
    expect(missing.reasons).toContain(`linked research record does not exist: ${cohortHash}`);

    const cohort = {
      recordHash: cohortHash,
      roomId: fixture.question.roomId,
      kind: 'research_cohort',
      author: { identityRootId: 'root_evaluator' },
      cohort: { state: 'frozen' }
    };
    const cohortApproval = await createSignedHumanClaim({
      identity: fixture.reviewer,
      roomId: fixture.question.roomId,
      targetHash: cohortHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      decision: 'accepted',
      text: 'The frozen calibration cohort is independently accepted.',
      confidence: 0.95,
      createdAt: at(3)
    });
    expect(validateResearchRecordLinks(candidate, [...fixture.records, cohort, cohortApproval])).toMatchObject({ ok: true });
  });

  it('retains exact ranking inputs, raw costs, deterministic selection, and rejected candidates', async () => {
    const fixture = await createQuestionFixture();
    const lowCost = await createSignedCandidateAction({
      identity: fixture.researcher,
      roomId: fixture.question.roomId,
      questionHash: fixture.question.recordHash,
      action: action({ questionHash: fixture.question.recordHash, hypothesisHash: fixture.hypothesis.recordHash, burden: 0, title: 'Low-cost retrieval' }),
      createdAt: at(2)
    });
    const highCost = await createSignedCandidateAction({
      identity: fixture.researcher,
      roomId: fixture.question.roomId,
      questionHash: fixture.question.recordHash,
      action: action({ questionHash: fixture.question.recordHash, hypothesisHash: fixture.hypothesis.recordHash, burden: 5, title: 'High-cost retrieval' }),
      createdAt: at(3)
    });
    const ranking = rankSignedCandidateActions({
      inputRecords: [...fixture.records, lowCost, highCost],
      candidates: [lowCost, { record: highCost, rejectionReasons: ['policy_rejected'] }]
    });
    expect(ranking.inputRecordHashes).toEqual([...fixture.records, lowCost, highCost].map((record) => record.recordHash).sort());
    expect(ranking.policy).toMatchObject({
      policyId: 'poolday.signed_candidate_action_heuristic/v1',
      version: '1.0.0',
      status: 'heuristic_not_calibrated',
      calibrationEvidenceHashes: []
    });
    expect(ranking.selectedAction.recordHash).toBe(lowCost.recordHash);
    expect(ranking.selectedAction.scientificCost.money).toEqual({ amount: 25, unit: 'USD', burden: 0 });
    expect(ranking.rejectedActions).toEqual([
      expect.objectContaining({ recordHash: highCost.recordHash, reasons: ['policy_rejected'] })
    ]);
  });
});
