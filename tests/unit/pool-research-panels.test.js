import { describe, expect, it } from 'vitest';

import {
  renderDiscoveryPanel,
  renderNextWorkPanel,
  renderParticipationQualityPanel,
  recordLabel,
  renderReviewPanel
} from '../../self/ui/pool-home/research-panels.js';
import { renderLifecycleForms } from '../../self/ui/pool-home/research-lifecycle-panel.js';
import { renderSequenceDisclosure, renderTechnicalEvidencePanel } from '../../self/ui/pool-home/research-technical-panel.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

describe('Research Room reusable panels', () => {
  it('keeps review and discovery targets contextual and compatible with existing bindings', () => {
    const question = {
      kind: 'research_submission',
      recordHash: hash('q'),
      requesterIntent: { label: 'Inspect the public sequence', text: 'Which evidence should be reviewed next?' },
      sequence: { hash: hash('s'), length: 15 },
      consent: { publicSequence: false }
    };
    const target = {
      kind: 'research_result',
      recordHash: hash('a'),
      submissionHash: question.recordHash,
      modelContract: { id: 'room-model', dimensions: 3 },
      compute: { receiptHash: hash('b'), agreement: null }
    };
    const review = renderReviewPanel({
      reviewTargets: [target],
      reviewTarget: target.recordHash,
      submissionsByHash: new Map([[question.recordHash, question]]),
      reviewStates: new Map([[target.recordHash, { state: 'unresolved' }]])
    });
    const discovery = renderDiscoveryPanel({ results: [target], target: target.recordHash });

    expect(review).toContain('id="pool-room-review"');
    expect(review).toContain('data-research-review-form');
    expect(review).toContain(`value="${target.recordHash}"`);
    expect(review).toContain('Which evidence should be reviewed next?');
    expect(review).toContain('room-model');
    expect(review).toContain('Agreement</dt><dd>Not assessed');
    expect(review).toContain('Sequence value withheld');
    expect(review).toContain('Similarity and retrieval ranking do not establish agreement.');
    expect(review).toContain('data-research-review-action="accept"');
    expect(review).toContain('data-research-review-action="reject"');
    expect(review).toContain('data-research-review-action="correct"');
    expect(review).toContain('data-research-review-action="replicate"');
    expect(review).not.toContain('Claim type');
    expect(review).not.toContain('Relationship');
    expect(discovery).toContain('id="pool-room-discovery"');
    expect(discovery).toContain('data-research-similarity-target');
    expect(discovery).toContain('room-model');
  });

  it('keeps next work approval gated and explicit', () => {
    const task = {
      actionId: 'task:review:target',
      actionKind: 'independent_review',
      targetHash: hash('c'),
      reason: 'A reviewer is still needed.',
      heuristicPriority: 5,
      expectedInformationGain: { estimate: 4 },
      valueComponents: { totalCost: 1 },
      status: 'proposed'
    };
    const html = renderNextWorkPanel({
      rankedTasks: [task],
      actionRanking: { policy: { policyId: 'test-policy' } }
    });

    expect(html).toContain('data-research-approve-task="task:review:target"');
    expect(html).toContain('A reviewer is still needed.');
    expect(html).toContain('test-policy');
  });

  it('renders admitted, selected, rejected, and raw candidate-action evidence without implying execution', () => {
    const costs = Object.fromEntries(['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime']
      .map((component) => [component, { amount: 1, unit: `${component}-unit`, burden: 1 }]));
    costs.assumptions = ['Declared planning estimate.'];
    const candidate = {
      recordHash: hash('a'),
      actionId: hash('b'),
      actionKind: 'retrieval',
      title: 'Retrieve a pinned independent annotation',
      rationale: 'Resolve cross-source disagreement.',
      rankingStatus: 'heuristic_not_calibrated',
      rankingScore: 42,
      humanApprovalState: 'approval_required',
      rawValueComponents: { uncertaintyReduction: 4, decisionRelevance: 5, duplicateWorkAvoidance: 3, costBurden: 6 },
      scientificCost: costs,
      execution: { contractKind: 'workload', contractId: 'catalog-retrieval', version: '1.0.0', artifactHash: hash('c'), parametersHash: hash('d') },
      uncertainty: [{ source: 'cross_source_disagreement', representation: 'ordinal', calibration: null }],
      affectedHypothesisHashes: [hash('e')],
      independence: { dimensions: ['source'], minimumIndependentExecutions: 1 },
      safety: { classification: 'public-data-only' },
      predictedObservations: [{ observation: 'The pinned source assigns family A.' }],
      falsifiers: [{ observation: 'The pinned source assigns an incompatible family.' }]
    };
    const html = renderNextWorkPanel({
      candidateRanking: {
        policy: {
          policyId: 'candidate-policy',
          version: '1.0.0',
          status: 'heuristic_not_calibrated',
          method: 'declared-value-minus-cost',
          parameters: { valueWeight: 1 },
          costAssumptions: { aggregation: 'sum' },
          calibrationEvidenceHashes: []
        },
        admittedCandidates: [candidate],
        rejectedActions: [{ recordHash: hash('f'), title: 'Rejected assay', reasons: ['candidate_was_rejected_by_independent_review'] }],
        selectedAction: candidate
      }
    });

    expect(html).toContain('Highest-ranked admitted candidate');
    expect(html).toContain(`data-research-approve-candidate="${candidate.recordHash}"`);
    expect(html).toContain(`data-research-candidate-contract="${candidate.actionId}"`);
    expect(html).toContain('Uncertainty reduction</dt><dd>4/5');
    expect(html).toContain('money-unit · burden 1/5');
    expect(html).toContain('cross source disagreement: ordinal');
    expect(html).toContain('Rejected assay');
    expect(html).toContain('None; ranking is explicitly not calibrated.');
    expect(html).toContain('cannot allocate or execute work');
  });

  it('requires a visible contextual-relevance determination for cross-room review targets', () => {
    const reused = {
      kind: 'research_prior_evidence',
      recordHash: hash('r'),
      questionHash: hash('q'),
      evidence: {
        summary: 'Prior-room annotation attached for current-room review.',
        reuseContext: {
          origin: { roomId: 'origin-room', questionHash: hash('o') },
          current: { roomId: 'current-room', questionHash: hash('q') },
          comparison: {
            status: 'declared_context_differences',
            differences: ['question', 'decisionContext'],
            missing: ['conditions']
          }
        }
      }
    };
    const html = renderReviewPanel({ reviewTargets: [reused], reviewTarget: reused.recordHash });

    expect(html).toContain('Declared-context comparison');
    expect(html).toContain('differs: question, decisionContext');
    expect(html).toContain('missing: conditions');
    expect(html).toContain('data-research-context-assessment-fields');
    expect(html).toContain('name="contextDetermination" required');
    expect(html).toContain('Relevant to this decision context');
  });

  it('keeps the full lifecycle form vocabulary reusable without owning signing', () => {
    const question = { kind: 'research_submission', recordHash: hash('q') };
    const hypothesis = { kind: 'research_hypothesis', recordHash: hash('h') };
    const html = renderLifecycleForms({
      questions: [question],
      hypotheses: [hypothesis],
      predictions: [{ kind: 'research_prediction', recordHash: hash('p') }],
      workOrders: [{ kind: 'research_work_order', recordHash: hash('w') }],
      active: [question]
    });

    expect((html.match(/data-research-lifecycle-form/g) || []).length).toBe(14);
    expect(html).toContain('data-research-action="prior-evidence"');
    expect(html).toContain('data-research-action="candidate-action"');
    expect(html).toContain('data-research-action="realized-action-value"');
    expect(html).toContain('Governed candidate action');
    expect(html).toContain('name="uncertaintySources"');
    expect(html).toContain('Scientific cost vector');
    expect(html).toContain('cannot allocate or execute work');
    expect(html).toContain('data-protein-annotation-fields');
    expect(html).toContain('data-public-evidence-finding');
    expect(html).toContain('data-public-evidence-failure');
    expect(html).toContain('<option value="negative_result">Negative result</option>');
    expect(html).toContain('<option value="failed_attempt">Failed attempt</option>');
    expect(html).toContain('name="sourceLicense" required');
    expect(html).toContain('name="conditions" required');
    expect(html).toContain('name="transformationId" required');
    expect(html).toContain('name="transformationVersion" required');
    expect(html).toContain('protein_residue_zero_based_half_open');
    expect(html).toContain('data-research-action="hypothesis"');
    expect(html).toContain('data-research-action="prediction"');
    expect(html).toContain('data-research-action="resolution-policy"');
    expect(html).toContain('name="acceptanceMinimumOutcomes"');
    expect(html).toContain('name="uncertaintyTriggers"');
    expect(html).toContain('name="reopeningTriggers"');
    expect(html).toContain('name="closureMinimumReviewers"');
    expect(html).toContain('It cannot accept, reject, or close a scientific question.');
    expect(html).toContain('data-research-action="work-order"');
    expect(html).toContain('name="workAnalysisArtifactHash"');
    expect(html).toContain('name="allowedFailureCategories"');
    expect(html).toContain('name="custodyArtifactHash"');
    expect(html).toContain('name="custodyRequiredRoles"');
    expect(html).toContain('name="replicationIndependentDimensions"');
    expect(html).toContain('name="workBiosafety"');
    expect(html).toContain('name="scopePublicNonClinical"');
    expect(html).toContain('name="scopeNoAuthority"');
    expect(html).toContain('grants no biological-interpretation, medical-use, execution, or laboratory authority');
    expect(html).toContain('name="workPublicationLicense"');
    expect(html).toContain('name="publishRawObservations"');
    expect(html).toContain('data-research-action="work-claim"');
    expect(html).toContain('name="institutionIdentityHash"');
    expect(html).toContain('name="capabilityEvidenceHash"');
    expect(html).toContain('name="protocolCustodyRole"');
    expect(html).toContain('name="safetyApprovalHash"');
    expect(html).toContain('value="public_non_pathogenic_non_clinical" readonly');
    expect(html).toContain('name="laboratoryAvailabilityStatus"');
    expect(html).toContain('name="laboratoryConflictDisclosure"');
    expect(html).toContain('Publish laboratory attribution, qualification profile');
    expect(html).toContain('data-research-action="outcome"');
    expect(html).toContain('name="analysisParametersHash"');
    expect(html).toContain('name="instrumentIdentityHash"');
    expect(html).toContain('name="sampleBatchHash"');
    expect(html).toContain('name="preparationBatchHash"');
    expect(html).toContain('name="analysisExecutionHash"');
    expect(html).toContain('every independence dimension frozen by the work order differs');
    expect(html).toContain('data-research-action="cohort"');
    expect(html).toContain('data-research-action="evaluation"');
    expect(html).toContain('data-research-action="adjudication-experiment"');
    expect(html).toContain('data-research-action="adjudication-evaluation"');
    expect(html).toContain('name="baselinePolicyArtifactHash"');
    expect(html).toContain('name="outcomeBoundaryMode"');
    expect(html).toContain('name="sameEvidenceCutoff"');
    expect(html).toContain('Historical hidden outcomes — blinded at freeze');
    expect(html).toContain('name="informationGainMetricId"');
    expect(html).toContain('name="uncertaintyCalibrationBaselineValue"');
    expect(html).toContain('five-dimensional tradeoff vector');
    expect(html).toContain('name="northStarMetricId"');
    expect(html).toContain('name="northStarIndependenceDimensions"');
    expect(html).toContain('name="northStarCaseEvidenceManifestHash"');
    expect(html).toContain('Peer and activity counters cannot satisfy it.');
    expect(html).toContain('This contract must name the real catalog and curator workflow.');
    expect(html).toContain('data-research-action="revocation"');
    expect(html).toContain('data-research-lifecycle-status');
  });

  it('withholds unpublished sequence values while retaining technical provenance', () => {
    const record = {
      kind: 'research_submission',
      recordHash: hash('s'),
      roomId: 'technical-room',
      sequence: { value: 'SECRETSEQUENCE', hash: hash('t'), length: 14 },
      consent: { publicSequence: false }
    };
    const withheld = renderSequenceDisclosure(record);
    const published = renderSequenceDisclosure({ ...record, consent: { publicSequence: true } });
    const technical = renderTechnicalEvidencePanel({ record, reviewState: 'unresolved' });

    expect(withheld).not.toContain('SECRETSEQUENCE');
    expect(withheld).toContain('Sequence value withheld');
    expect(published).toContain('SECRETSEQUENCE');
    expect(technical).toContain('Technical evidence');
    expect(technical).toContain('Sequence publication');
    expect(technical).toContain('withheld');
    expect(technical).not.toContain('SECRETSEQUENCE');
  });

  it('withholds non-consented participant labels in reusable evidence panels', () => {
    const privateWorkClaim = {
      kind: 'research_work_claim',
      recordHash: hash('w'),
      author: { identityRootId: 'identity-root-that-must-be-shortened' },
      workClaim: {
        laboratory: { name: 'Private Laboratory' },
        consent: { publicLaboratoryIdentity: false }
      }
    };
    const publicWorkClaim = {
      ...privateWorkClaim,
      workClaim: {
        ...privateWorkClaim.workClaim,
        consent: { publicLaboratoryIdentity: true }
      }
    };
    const rewards = renderParticipationQualityPanel({ rewards: [{
      authorId: 'provider-identity-root-that-must-be-shortened',
      points: 2,
      verifiedCompute: 1,
      acceptedEvidence: 0,
      acceptedReviews: 0,
      quality: 0
    }] });

    expect(recordLabel(privateWorkClaim)).not.toContain('Private Laboratory');
    expect(recordLabel(privateWorkClaim)).toContain('identity-root');
    expect(recordLabel(publicWorkClaim)).toContain('Private Laboratory');
    expect(rewards).not.toContain('provider-identity-root-that-must-be-shortened');
  });
});
