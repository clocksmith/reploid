import { describe, expect, it, vi } from 'vitest';

import {
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedPublicProteinEvidence,
  createSignedResearchHypothesis,
  createSignedResearchResult,
  createSignedResearchSubmission,
  projectAcceptedResearchMemory,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';
import { hashSequenceFloat32Values } from '../../self/pool/sequence-result.js';
import {
  bindResearchWorkspace,
  createContextualReviewRecord,
  createCurrentRoomPriorEvidence,
  createLifecycleRecordFromForm,
  hydrateAndBindResearchWorkspace,
  renderResearchWorkspace
} from '../../self/ui/pool-home/research-view.js';
import {
  appendResearchRecord,
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord,
  resetResearchStore
} from '../../self/ui/pool-home/research-store.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const model = {
  id: 'esm2-record-view',
  hash: fakeHash('1'),
  manifestHash: fakeHash('2'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
};

const identity = async (kind = 'requester') => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_record_view`,
      userId: `user_${kind}_record_view`,
      deviceId: `device_${kind}_record_view`,
      identityRootId: `root_${kind}_record_view`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

describe('Poolday research Records model evidence view', () => {
  it('creates qualified non-supporting public evidence from the Research Room form', async () => {
    localStorage.clear();
    const question = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'public-evidence-form-room',
      sequence: 'MPEPTIDESEQ',
      intent: { kind: 'question', text: 'Does the public assay support this disputed annotation?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const values = new FormData();
    values.set('questionHash', question.recordHash);
    values.set('evidenceKind', 'negative_result');
    values.set('summary', 'The version-pinned public assay did not detect the declared activity.');
    values.set('accession', 'PUBLIC:NEGATIVE:123');
    values.set('version', '4');
    values.set('sourceLicense', 'CC BY 4.0');
    values.set('conditions', 'Public assay conditions reported by the source.');
    values.set('transformationId', 'verbatim-public-assay-import');
    values.set('transformationVersion', '1.0.0');
    values.set('transformationDescription', 'Preserve the reported negative result without reinterpretation.');
    values.set('retrievalMethod', 'version-pinned public API');
    values.set('uncertainty', 'Detection limit remains source-reported.');

    const record = await createLifecycleRecordFromForm(
      'prior-evidence',
      values,
      question.roomId,
      [question]
    );

    expect(record).toMatchObject({
      kind: 'research_prior_evidence',
      evidence: {
        schema: 'poolday.public_protein_evidence/v1',
        access: 'public',
        kind: 'negative_result',
        finding: {
          classification: 'negative',
          attempt: { status: 'completed', failureCategory: 'none' }
        },
        transformations: [{ id: 'verbatim-public-assay-import', version: '1.0.0' }],
        provenance: { license: 'CC BY 4.0', sourceIdentity: 'PUBLIC:NEGATIVE:123' }
      }
    });
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(record, [question])).toMatchObject({ ok: true });
  });

  it('creates the canonical signed candidate-action record from the Research Room form contract', async () => {
    localStorage.clear();
    const requester = await identity('requester');
    const researcher = await identity('researcher');
    const question = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'candidate-form-room',
      sequence: 'MPEPTIDESEQ',
      intent: { kind: 'question', text: 'Which public family annotation is best supported?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const hypothesis = await createSignedResearchHypothesis({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      statement: 'The protein belongs to public family A.',
      conditions: { biologicalSystem: 'public catalog release' },
      discriminatingObservations: ['An independent source assigns family A.']
    });
    const values = new FormData();
    const set = (name, value) => values.set(name, String(value));
    set('questionHash', question.recordHash);
    set('candidateKind', 'retrieval');
    values.append('affectedHypothesisHashes', hypothesis.recordHash);
    set('candidateTitle', 'Retrieve a pinned independent annotation');
    set('candidateRationale', 'Resolve a public cross-source disagreement.');
    set('predictedObservation', 'The independent source assigns family A.');
    set('falsifyingObservation', 'The independent source assigns an incompatible family.');
    set('contractKind', 'workload');
    set('contractId', 'catalog-retrieval');
    set('contractVersion', '1.0.0');
    set('contractArtifactHash', fakeHash('3'));
    set('contractParametersHash', fakeHash('4'));
    values.append('uncertaintySources', 'cross_source_disagreement');
    set('uncertaintyRepresentation', 'ordinal');
    set('uncertaintyRationale', 'The sources disagree.');
    set('ordinalLevel', 'high');
    set('ordinalScaleId', 'poolday.uncertainty.v1');
    set('ordinalScaleVersion', '1.0.0');
    set('feasibilityStatus', 'feasible');
    set('requiredCapabilities', 'version-pinned HTTP retrieval');
    set('availability', 'The public release is available.');
    set('failureRisks', 'Historical release may be unavailable');
    set('independenceDimensions', 'source organization, curation process');
    set('minimumIndependentExecutions', 1);
    set('safetyClassification', 'public-data-only');
    set('safetyRequirements', 'Use only the public sequence');
    set('candidatePublicConsent', 'on');
    set('candidateSafetyReview', 'on');
    for (const component of ['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime']) {
      set(`${component}Amount`, component === 'money' ? 25 : 1);
      set(`${component}Unit`, `${component}-unit`);
      set(`${component}Burden`, 1);
    }
    set('costAssumptions', 'Public source access remains available');
    set('valueStatus', 'heuristic_not_calibrated');
    set('valueMethodId', 'curator-declared-ordinal-value');
    set('valueMethodVersion', '1.0.0');
    set('uncertaintyReduction', 4);
    set('decisionRelevance', 5);
    set('duplicateWorkAvoidance', 3);

    const candidate = await createLifecycleRecordFromForm(
      'candidate-action',
      values,
      question.roomId,
      [question, hypothesis]
    );
    expect(await verifyResearchRecord(candidate)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(candidate, [question, hypothesis])).toMatchObject({ ok: true });
    expect(candidate).toMatchObject({
      kind: 'research_candidate_action',
      questionHash: question.recordHash,
      action: {
        kind: 'retrieval',
        allocationAuthority: 'none',
        executionAuthority: 'none',
        scientificCost: { money: { amount: 25, unit: 'money-unit', burden: 1 } },
        uncertainty: [{ source: 'cross_source_disagreement', representation: 'ordinal' }]
      }
    });
  });

  it('creates a governed unallocated work order with a frozen replication plan from the room form', async () => {
    localStorage.clear();
    const requester = await identity('requester');
    const researcher = await identity('researcher');
    const question = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'work-order-form-room',
      sequence: 'MPEPTIDESEQ',
      intent: { kind: 'question', text: 'Which public family annotation survives the assay?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const hypotheses = await Promise.all(['family A', 'family B'].map((family) => createSignedResearchHypothesis({
      identity: researcher,
      roomId: question.roomId,
      questionHash: question.recordHash,
      statement: `The protein belongs to ${family}.`,
      conditions: { biologicalSystem: 'public cell-free assay' },
      discriminatingObservations: [`The frozen assay supports ${family}.`]
    })));
    const values = new FormData();
    for (const hypothesis of hypotheses) values.append('hypothesisHashes', hypothesis.recordHash);
    const fields = {
      title: 'Frozen public reporter assay',
      protocolId: 'public-reporter-v1',
      protocolVersion: '1.0.0',
      assayType: 'cell-free-reporter',
      executableUri: 'https://example.org/protocols/public-reporter-v1',
      referenceAccession: 'PROTOCOL:PUBLIC:1',
      referenceVersion: '1.0.0',
      replicaTarget: '2',
      conditions: 'Public non-pathogenic cell-free system at 30 C.',
      controls: 'positive control, negative control',
      readouts: 'normalized reporter ratio',
      normalizationMethod: 'control-ratio',
      normalizationVersion: '1.0.0',
      workAnalysisMethodId: 'reporter-analysis',
      workAnalysisVersion: '1.0.0',
      workAnalysisArtifactHash: fakeHash('3'),
      workAnalysisParametersHash: fakeHash('4'),
      allowedFailureCategories: 'protocol_failure, analysis_failure, inconclusive',
      custodyPlanId: 'public-custody',
      custodyPlanVersion: '1.0.0',
      custodyArtifactHash: fakeHash('5'),
      custodyRequiredRoles: 'operator',
      replicationIndependentDimensions: 'operator_identity, institution, instrument',
      materialsPolicy: 'Record public material lots.',
      samplesPolicy: 'Public synthetic samples only.',
      instrumentsPolicy: 'Record instrument and calibration identities.',
      workResources: 'Public cell-free reporter kit.',
      workBiosafety: 'Public, non-pathogenic, non-clinical protocol only.',
      workLimitations: 'The reporter does not establish native biological function.',
      uncertaintyPlan: 'Retain raw replicas and standard error.',
      acceptanceCriteria: 'Controls pass under the frozen threshold.',
      allocationHash: fakeHash('6'),
      workPublicationLicense: 'CC-BY-4.0',
      publishLaboratoryIdentity: 'on',
      publishQualification: 'on',
      publishProtocol: 'on',
      publishRawObservations: 'on',
      publishFailures: 'on'
    };
    for (const [name, value] of Object.entries(fields)) values.set(name, value);

    const order = await createLifecycleRecordFromForm('work-order', values, question.roomId, [question, ...hypotheses]);

    expect(await verifyResearchRecord(order)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(order, [question, ...hypotheses])).toMatchObject({ ok: true });
    expect(order.work).toMatchObject({
      schema: 'poolday.research_work_order/v1',
      allocationState: 'unallocated',
      plannedAnalysis: { methodId: 'reporter-analysis', artifactHash: fakeHash('3') },
      custody: { planId: 'public-custody', requiredRoles: ['operator'] },
      replication: {
        requiredIndependentDimensions: ['operator_identity', 'institution', 'instrument'],
        comparisonRule: 'all_declared_dimensions_must_differ'
      },
      publication: { publishFailures: true },
      scopeBoundary: { medicalUse: 'prohibited', privateSamples: 'prohibited', laboratoryAuthority: 'none' }
    });
  });

  it('freezes criteria-only resolution policy from the room form without granting closure authority', async () => {
    localStorage.clear();
    const question = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'resolution-form-room',
      sequence: 'MPEPTIDESEQ',
      intent: { kind: 'question', text: 'Does the bounded assay support family A?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const hypothesis = await createSignedResearchHypothesis({
      identity: await identity('researcher'),
      roomId: question.roomId,
      questionHash: question.recordHash,
      statement: 'The protein belongs to public family A under the declared assay.',
      conditions: { biologicalSystem: 'public cell-free assay' },
      discriminatingObservations: ['The frozen reporter exceeds its threshold.']
    });
    const values = new FormData();
    const fields = {
      resolutionTargetHypothesisHash: hypothesis.recordHash,
      resolutionConclusionLabel: 'Family A under the bounded public assay',
      resolutionDecisionScope: 'Only this public sequence and exact assay contract.',
      acceptanceClassification: 'positive',
      acceptanceMinimumOutcomes: '2',
      acceptanceMinimumReplications: '1',
      acceptanceMaximumAmbiguous: '0',
      acceptanceMinimumReviewers: '1',
      acceptanceUncertaintyMethodId: 'standard-error',
      acceptanceUncertaintyVersion: '1.0.0',
      acceptanceUncertaintyMetricId: 'reporter-se',
      acceptanceMaximumUncertainty: '0.1',
      acceptanceUncertaintyUnit: 'ratio',
      rejectionClassification: 'negative',
      rejectionMinimumOutcomes: '2',
      rejectionMinimumReplications: '1',
      rejectionMaximumAmbiguous: '0',
      rejectionMinimumReviewers: '1',
      rejectionUncertaintyMethodId: 'standard-error',
      rejectionUncertaintyVersion: '1.0.0',
      rejectionUncertaintyMetricId: 'reporter-se',
      rejectionMaximumUncertainty: '0.1',
      rejectionUncertaintyUnit: 'ratio',
      uncertaintyTriggers: 'insufficient_accepted_outcomes, ambiguous_outcome, disputed_review',
      reopeningTriggers: 'contradiction, correction, revocation, failed_replication, policy_invalidation',
      closureMinimumOutcomes: '3',
      closureMinimumReplications: '2',
      closureMaximumAmbiguous: '0',
      closureMinimumReviewers: '2',
      closureControlsPassed: 'on',
      closureNoDisputedReviews: 'on',
      closureNoContradictions: 'on'
    };
    for (const [name, value] of Object.entries(fields)) values.set(name, value);

    const policy = await createLifecycleRecordFromForm('resolution-policy', values, question.roomId, [question, hypothesis]);

    expect(await verifyResearchRecord(policy)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(policy, [question, hypothesis])).toMatchObject({ ok: true });
    expect(policy).toMatchObject({
      kind: 'research_resolution_policy',
      questionHash: question.recordHash,
      policy: {
        schema: 'poolday.research_resolution_policy/v1',
        state: 'frozen_criteria',
        targetHypothesisHash: hypothesis.recordHash,
        continuedUncertainty: { state: 'continue_investigation' },
        closure: {
          authority: 'separate_human_closure_checkpoint_required',
          implementationStatus: 'criteria_only_closure_not_implemented'
        }
      }
    });
  });

  it('maps each contextual review action to a signed evidence record', async () => {
    const reviewer = await identity('reviewer');
    const targetHash = fakeHash('f');
    const cases = [
      ['accept', 'review_decision', 'reviews', 'accepted'],
      ['reject', 'review_decision', 'reviews', 'rejected'],
      ['correct', 'correction', 'corrects', null],
      ['replicate', 'review_decision', 'reviews', 'replication_requested']
    ];

    for (const [action, kind, relation, decision] of cases) {
      const record = await createContextualReviewRecord({
        action,
        identity: reviewer,
        roomId: 'contextual-review-room',
        targetHash,
        text: `${action} with attributable context.`,
        confidence: 0.8
      });
      expect(record).toMatchObject({
        kind: 'human_claim',
        roomId: 'contextual-review-room',
        targetHash,
        claim: { kind, relation, decision }
      });
      expect(record.recordHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(record.signature).toBeTruthy();
    }
  });

  it('executes a contextual acceptance and rehydrates its signed record after reload', async () => {
    localStorage.clear();
    resetResearchStore();
    const requester = await identity();
    const admittedModel = buildLaunchProviderModel();
    const embedding = Array.from({ length: admittedModel.embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
    const submission = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'contextual-execution-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Should this result enter room memory?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const result = await createSignedResearchResult({
      identity: requester,
      submission,
      receiptRecord: {
        receiptHash: fakeHash('d'),
        verifierDecision: { accepted: true },
        receipt: {
          model: admittedModel,
          providerId: 'provider_contextual_execution',
          assignmentId: 'assignment_contextual_execution',
          jobId: 'job_contextual_execution',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values(embedding)
        }
      },
      embedding
    });
    await appendResearchRecord(submission);
    await appendResearchRecord(result);
    document.body.innerHTML = `<div>${renderResearchWorkspace(submission.roomId, [submission, result], { reviewTarget: result.recordHash })}</div>`;
    const workspace = document.querySelector('[data-pool-research-workspace]');
    bindResearchWorkspace(workspace, {
      publishRecord: (record, options) => publishResearchRecord(record, {
        ...options,
        sdk: { publishResearchRecord: vi.fn().mockResolvedValue({ ok: true }) }
      })
    });
    const form = workspace.querySelector('[data-research-review-form]');
    form.elements.text.value = 'The receipt and declared limits support accepting this evidence.';
    form.dispatchEvent(new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: form.querySelector('[data-research-review-action="accept"]')
    }));

    await vi.waitFor(() => expect(loadResearchRecords(submission.roomId)).toHaveLength(3));
    const accepted = loadResearchRecords(submission.roomId).at(-1);
    expect(accepted).toMatchObject({
      kind: 'human_claim',
      targetHash: result.recordHash,
      claim: { kind: 'review_decision', relation: 'reviews', decision: 'accepted' }
    });
    expect(accepted.signature).toBeTruthy();

    resetResearchStore();
    const hydrated = await hydrateResearchRecords(submission.roomId, {
      sdk: { listResearchRecords: vi.fn().mockRejectedValue(new Error('offline')) }
    });
    expect(hydrated.remote).toBe(false);
    expect(loadResearchRecords(submission.roomId).map((record) => record.recordHash)).toContain(accepted.recordHash);
    resetResearchStore();
    localStorage.clear();
  });

  it('freezes the baseline action policy and outcome boundary from the adjudication form', async () => {
    const values = new FormData();
    const set = (name, value) => values.set(name, String(value));
    set('catalogId', 'PUBLIC-CATALOG');
    set('catalogVersion', '2026.08');
    set('curatorRole', 'family annotation curator');
    set('adjudicationDecision', 'retain, revise, reject, or leave unresolved');
    set('disputedEvidencePattern', 'public annotations and reviewers disagree');
    set('actionableOutput', 'signed bounded curator decision');
    set('adopterOrPayer', 'public catalog governance owner');
    set('baselineWorkflowId', 'current-catalog-workflow');
    set('baselineVersion', '2026.08');
    set('baselineRevisionHash', fakeHash('1'));
    set('baselineDescription', 'Frozen current curator workflow.');
    set('baselineTools', 'catalog search, curator review');
    set('baselinePolicyId', 'current-action-policy');
    set('baselinePolicyVersion', '1.0.0');
    set('baselinePolicyArtifactHash', fakeHash('2'));
    set('baselineInputContractHash', fakeHash('3'));
    set('baselineBudgetContractHash', fakeHash('4'));
    set('baselineRankingMethod', 'Apply the pinned curator triage rubric.');
    set('baselineRankingStatus', 'heuristic_not_calibrated');
    set('baselineEligibleActionKinds', 'retrieval, review');
    set('baselineTieBreak', 'catalog accession ascending');
    set('baselineStopRule', 'Stop after one signed bounded decision.');
    set('candidatePolicyId', 'reploid-research-room');
    set('candidateVersion', '1.0.0');
    set('candidateRevisionHash', fakeHash('5'));
    set('cohortAccession', 'PUBLIC:COHORT:1');
    set('cohortVersion', '1');
    set('cohortContentHash', fakeHash('6'));
    set('cohortCaseCount', 20);
    set('familySplitHash', fakeHash('7'));
    set('allocationHash', fakeHash('8'));
    set('familyDisjoint', 'on');
    set('outcomeBoundaryMode', 'prospective_future');
    set('outcomeEvidenceCutoffAt', '2026-08-15T00:00:00.000Z');
    set('outcomeRevealRule', 'Reveal after both policies lock every action.');
    set('contaminationAuditMethod', 'Compare access logs with the cutoff.');
    set('contaminationAuditArtifactHash', fakeHash('9'));
    set('pairedTasks', 'on');
    set('sameInputOrder', 'on');
    set('sameEvidenceCutoff', 'on');
    set('comparisonResourceBudgetHash', fakeHash('a'));
    set('comparisonFailurePolicyHash', fakeHash('b'));
    set('comparisonTimeoutPolicyHash', fakeHash('c'));
    set('comparisonSeedManifestHash', fakeHash('d'));
    set('evaluatorAuthority', 'independent catalog evaluator');
    set('evaluatorIdentityRootId', 'root_independent_catalog_evaluator');
    set('evaluatorMethodId', 'paired-catalog-evaluation');
    set('evaluatorVersion', '1.0.0');
    set('evaluatorArtifactHash', fakeHash('e'));
    set('evaluatorBlinded', 'on');
    for (const [prefix, direction, unit] of [
      ['quality', 'higher_is_better', 'fraction'],
      ['effort', 'lower_is_better', 'minutes'],
      ['informationGain', 'higher_is_better', 'bits per action'],
      ['contradictionCost', 'lower_is_better', 'resource units'],
      ['duplicateWork', 'higher_is_better', 'actions'],
      ['uncertaintyCalibration', 'lower_is_better', 'Brier score'],
      ['heldOutFamily', 'higher_is_better', 'fraction'],
      ['northStar', 'lower_is_better', 'normalized 2026 USD']
    ]) {
      set(`${prefix}MetricId`, `${prefix}_metric`);
      set(`${prefix}MetricLabel`, `${prefix} metric`);
      set(`${prefix}MetricUnit`, unit);
      set(`${prefix}Direction`, direction);
      set(`${prefix}MeasurementSource`, 'blinded paired evaluation');
      set(`${prefix}AggregationRule`, 'paired mean');
      set(`${prefix}ValidityConditions`, 'same cases, same cutoff');
      set(`${prefix}NoiseModel`, 'paired bootstrap');
      set(`${prefix}MinimumSample`, 20);
      set(`${prefix}ConfidenceLevel`, 0.95);
    }
    set('costConversionPolicyId', 'catalog-real-cost-normalization');
    set('costConversionPolicyVersion', '2026.08');
    set('costConversionArtifactHash', fakeHash('f'));
    set('northStarCostStopRule', 'Stop at independently replicated conclusion or frozen budget exhaustion.');
    set('rawCostUnitsPreserved', 'on');
    set('failedAttemptsIncluded', 'on');
    set('unresolvedCasesIncluded', 'on');
    set('conclusionPolicyId', 'catalog-resolution-criteria');
    set('conclusionPolicyVersion', '2026.08');
    set('conclusionPolicyArtifactHash', fakeHash('0'));
    set('minimumIndependentReplications', 1);
    set('conclusionFrozenBeforeActions', 'on');
    set('conclusionIndependentAcceptance', 'on');
    set('conclusionIndependentReplication', 'on');
    set('independencePolicyId', 'catalog-replication-independence');
    set('independencePolicyVersion', '2026.08');
    set('independencePolicyArtifactHash', fakeHash('1'));
    set('northStarIndependenceDimensions', 'reviewer_identity, evidence_source');
    set('evaluatorExcludedFromCaseEvidence', 'on');
    set('northStarIntervalMethod', 'paired bootstrap over frozen family-disjoint cases');
    set('northStarMinimumPairedCases', 20);
    set('northStarAggregationConfidence', 0.95);
    set('northStarMinimumImprovement', 0);
    set('qualityImprovementThreshold', 0.02);
    set('qualityNonInferiorityMargin', 0.01);
    set('effortImprovementThreshold', 2);
    set('effortComparabilityMargin', 2);
    set('experimentAcceptanceRule', 'Accept only when a frozen path passes.');
    set('experimentRejectionRule', 'Reject when neither path passes.');
    set('experimentReopeningRule', 'Reopen after contamination or policy drift.');

    const record = await createLifecycleRecordFromForm('adjudication-experiment', values, 'baseline-form-room', []);

    expect(record.experiment).toMatchObject({
      schema: 'poolday.annotation_adjudication_experiment/v3',
      baseline: { actionSelection: { policyId: 'current-action-policy', eligibleActionKinds: ['retrieval', 'review'] } },
      outcomeBoundary: { mode: 'prospective_future', accessAtFreeze: 'not_available' },
      comparison: { pairedTasks: true, sameInputOrder: true, sameEvidenceCutoff: true },
      measurementPlan: {
        informationGainPerActionMetricId: 'informationGain_metric',
        contradictionResolutionCostMetricId: 'contradictionCost_metric',
        duplicateWorkAvoidedMetricId: 'duplicateWork_metric',
        uncertaintyCalibrationErrorMetricId: 'uncertaintyCalibration_metric',
        heldOutFamilyPerformanceMetricId: 'heldOutFamily_metric'
      },
      northStarPolicy: {
        schema: 'poolday.adjudication_north_star_policy/v1',
        costToReplicatedConclusionMetricId: 'northStar_metric',
        operationalMetrics: ['peers', 'jobs', 'receipts', 'records', 'claims', 'total_compute']
      }
    });
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
  });

  it('hydrates the active room even when the technical workspace is not mounted', async () => {
    const hydrate = vi.fn(async (roomId) => ({
      roomId,
      remote: true,
      records: [],
      rejectedRecords: []
    }));
    const hydrateCampaign = vi.fn().mockResolvedValue({ phase: 'synchronized', projection: { entries: [] } });

    const result = await hydrateAndBindResearchWorkspace(null, 'home-room', { hydrate, hydrateCampaign });

    expect(hydrate).toHaveBeenCalledWith('home-room');
    expect(hydrateCampaign).toHaveBeenCalledWith('home-room');
    expect(result).toMatchObject({ roomId: 'home-room', remote: true });
  });

  it('reprojects remotely hydrated evidence into a cold review workspace', async () => {
    localStorage.clear();
    resetResearchStore();
    const roomId = 'cold-review-room';
    const submission = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId,
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Can a second curator review synchronized evidence?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: buildLaunchProviderModel(),
      policyId: 'redundant_agreement'
    });
    document.body.innerHTML = `<div>${renderResearchWorkspace(roomId, [])}</div>`;
    const workspace = document.querySelector('[data-pool-research-workspace]');
    const hydrate = vi.fn(async () => {
      await appendResearchRecord(submission);
      return { roomId, remote: true, records: [submission], rejectedRecords: [] };
    });

    await hydrateAndBindResearchWorkspace(workspace, roomId, {
      hydrate,
      hydrateCrossRoom: vi.fn().mockResolvedValue(null),
      hydrateCampaign: vi.fn().mockResolvedValue({ phase: 'synchronized', projection: { entries: [] } })
    });

    expect(document.querySelector('[data-research-review-form] select[name="targetHash"]')?.value)
      .toBe(submission.recordHash);
    expect(document.querySelector('[data-pool-research-sync]')?.textContent)
      .toBe('Coordinator evidence synchronized');
    resetResearchStore();
    localStorage.clear();
  });

  it('attaches qualified origin evidence as a new provisional current-room record', async () => {
    const admittedModel = buildLaunchProviderModel();
    const question = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'current-reuse-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Can this prior annotation evidence be reused here?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const priorQuestion = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'origin-reuse-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'What does the versioned catalog say?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const source = await createSignedPublicProteinEvidence({
      identity: await identity('researcher'),
      roomId: priorQuestion.roomId,
      questionHash: priorQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'The versioned public catalog assigns a bounded domain.',
      reference: { accession: 'PUBLIC:123', version: '7' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:123', version: '7', label: 'Bounded domain' },
        sequence: { hash: priorQuestion.sequence.hash, length: priorQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      },
      conditions: { biologicalSystem: 'public catalog annotation' },
      transformations: [{ id: 'catalog-normalization', version: '1.0.0' }],
      provenance: {
        retrievalMethod: 'catalog API',
        sourceIdentity: 'PUBLIC:123',
        license: 'CC BY 4.0'
      }
    });
    const candidate = {
      recordHash: source.recordHash,
      originRoomId: priorQuestion.roomId,
      qualification: { status: 'source_metadata_complete', reasons: [] }
    };

    const attached = await createCurrentRoomPriorEvidence({
      identity: await identity('researcher'),
      roomId: question.roomId,
      question,
      originQuestion: priorQuestion,
      candidate,
      sourceRecord: source,
      createdAt: '2026-08-15T12:00:00.000Z'
    });

    expect(attached).toMatchObject({
      kind: 'research_prior_evidence',
      roomId: question.roomId,
      questionHash: question.recordHash,
      evidence: {
        schema: 'poolday.public_protein_evidence/v1',
        access: 'public',
        kind: 'annotation',
        finding: {
          classification: 'not_applicable',
          attempt: { status: 'not_applicable', failureCategory: 'none' }
        },
        reuseContext: {
          schema: 'poolday.cross_room_reuse_context/v1',
          originRecordHash: source.recordHash,
          originSource: {
            schema: 'poolday.cross_room_source_identity/v1',
            evidenceKind: 'annotation',
            reference: { accession: 'PUBLIC:123', version: '7' },
            identityHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
          },
          origin: { questionHash: priorQuestion.recordHash, roomId: priorQuestion.roomId },
          current: { questionHash: question.recordHash, roomId: question.roomId },
          comparison: { status: 'declared_context_differences' },
          admission: 'requires_explicit_current_room_context_review'
        },
        annotation: {
          schema: 'poolday.protein_annotation_identity/v1',
          scope: 'domain',
          ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:123', version: '7', label: 'Bounded domain' },
          coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start: 2, end: 12 }
        },
        reference: {
          accession: 'reploid:origin-reuse-room:PUBLIC:123',
          contentHash: source.recordHash
        },
        provenance: {
          retrievalMethod: 'Reploid exact-sequence prior-room lookup',
          sourceIdentity: `origin-reuse-room:${source.recordHash}`,
          license: 'CC BY 4.0'
        }
      }
    });
    expect(await verifyResearchRecord(attached)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(attached, [question])).toMatchObject({ ok: true });
    const unsafeAcceptance = await createSignedHumanClaim({
      identity: await identity('reviewer'),
      roomId: question.roomId,
      targetHash: attached.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Generic acceptance must not silently establish contextual relevance.',
      confidence: 0.8,
      decision: 'accepted'
    });
    expect(validateResearchRecordLinks(unsafeAcceptance, [question, attached])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['accepted cross-room evidence requires an explicit relevant context determination'])
    });
    expect(projectAcceptedResearchMemory([question, attached, unsafeAcceptance]).excluded).toContainEqual({
      recordHash: attached.recordHash,
      reason: 'contextual_relevance_review_missing',
      supersededByHash: null
    });
    const missingContextReviewer = await identity('reviewer');
    expect(() => createContextualReviewRecord({
      action: 'accept',
      identity: missingContextReviewer,
      roomId: question.roomId,
      targetHash: attached.recordHash,
      targetRecord: attached,
      text: 'The source may inform this different current decision context.',
      confidence: 0.8
    })).toThrow('explicit relevant context determination');
    const contextualAcceptance = await createContextualReviewRecord({
      action: 'accept',
      identity: await identity('reviewer'),
      roomId: question.roomId,
      targetHash: attached.recordHash,
      targetRecord: attached,
      contextDetermination: 'relevant',
      text: 'The bounded domain evidence remains relevant despite the declared question difference.',
      confidence: 0.8
    });
    expect(contextualAcceptance.claim.contextAssessment).toMatchObject({
      schema: 'poolday.contextual_reuse_review/v1',
      determination: 'relevant',
      originRecordHash: source.recordHash,
      originQuestionHash: priorQuestion.recordHash,
      currentQuestionHash: question.recordHash,
      comparisonHash: attached.evidence.reuseContext.comparisonHash
    });
    expect(validateResearchRecordLinks(contextualAcceptance, [question, attached])).toMatchObject({ ok: true });
    expect(projectAcceptedResearchMemory([question, attached, contextualAcceptance]).acceptedHashes)
      .toContain(attached.recordHash);
    expect(renderResearchWorkspace(question.roomId, [question, attached]))
      .toContain('Declared source identity');
  });

  it('renders exact-model evidence and explicit non-comparison boundaries', async () => {
    const requester = await identity();
    const submission = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'record-view-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'What is the next justified protein evidence action?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const result = await createSignedResearchResult({
      identity: requester,
      submission,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: 'provider_record_view',
          assignmentId: 'assignment_record_view',
          jobId: 'job_record_view',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values([1, 0, 0])
        }
      },
      embedding: [1, 0, 0]
    });

    const html = renderResearchWorkspace(submission.roomId, [submission, result], { reviewTarget: result.recordHash });
    expect(html).toContain('Exact-model evidence, not vector averaging');
    expect(html).toContain('esm2-record-view');
    expect(html).toContain('No cross-model agreement is asserted because only one or no exact model contract has published evidence.');
    expect(html).toContain('Embedding vectors and tokenizer-local masked-token IDs remain in separate exact-model coordinate systems.');
    expect(html).toContain('non-calibrated heuristic');
    expect(html).toContain('does not estimate biological truth, mutation fitness, or a decision-change probability');
    expect(html).toContain(`<option value="${result.recordHash}" selected>`);
    expect(html).not.toContain('[1,0,0]');
  });
});
