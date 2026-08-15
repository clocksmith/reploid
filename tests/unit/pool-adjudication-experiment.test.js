import { describe, expect, it } from 'vitest';

import {
  createSignedAdjudicationEvaluation,
  createSignedAdjudicationExperiment,
  createSignedHumanClaim,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

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

const experimentInput = () => ({
  roomId: 'adjudication-proof-room',
  target: {
    catalogId: 'DECLARED-CATALOG',
    catalogVersion: '2026.08',
    curatorRole: 'protein family annotation curator',
    decision: 'retain, revise, or reject one disputed family or domain annotation',
    disputedEvidencePattern: 'catalog sources, exact-model retrieval, and reviewer judgment disagree',
    actionableOutput: 'a signed retain, revise, reject, or unresolved decision with rationale',
    adopterOrPayer: 'declared public catalog governance owner'
  },
  baseline: {
    workflowId: 'catalog-current-workflow',
    version: '2026.08',
    revisionHash: hash('1'),
    description: 'The frozen existing adjudication process.',
    toolsAndHandoffs: ['catalog search', 'local analysis', 'curator spreadsheet handoff']
  },
  candidate: {
    policyId: 'reploid-research-room',
    version: '1',
    revisionHash: hash('2')
  },
  cohort: {
    manifest: { accession: 'COHORT:PUBLIC-ANNOTATION-1', version: '1', contentHash: hash('3') },
    caseCount: 24,
    familySplitHash: hash('4'),
    allocationHash: hash('5'),
    familyDisjoint: true
  },
  evaluator: {
    authority: 'independent catalog adjudication evaluator',
    identityRootId: 'root_experiment-evaluator',
    methodId: 'paired-adjudication-comparison',
    version: '1',
    artifactHash: hash('6'),
    blinded: true
  },
  metrics: [{
    id: 'adjudication_quality',
    label: 'Adjudication quality against the frozen reference decision',
    unit: 'fraction',
    direction: 'higher_is_better',
    measurementSource: 'blinded independent adjudication rubric',
    aggregationRule: 'paired mean across the frozen cohort',
    validityConditions: ['same cases and evidence cutoff', 'evaluator remains blinded'],
    noiseModel: 'paired bootstrap over protein-family-disjoint cases',
    minimumSampleSize: 20,
    confidenceLevel: 0.95
  }, {
    id: 'curator_effort',
    label: 'Active curator effort per completed decision',
    unit: 'minutes per decision',
    direction: 'lower_is_better',
    measurementSource: 'task-active interaction log',
    aggregationRule: 'paired median across completed cases',
    validityConditions: ['same start and stop rule', 'unresolved cases remain counted'],
    noiseModel: 'paired bootstrap over protein-family-disjoint cases',
    minimumSampleSize: 20,
    confidenceLevel: 0.95
  }],
  successPolicy: {
    qualityMetricId: 'adjudication_quality',
    effortMetricId: 'curator_effort',
    qualityImprovementThreshold: 0.02,
    qualityNonInferiorityMargin: 0.01,
    effortImprovementThreshold: 2,
    effortComparabilityMargin: 2
  },
  resolution: {
    acceptanceRule: 'Accept only a predeclared success path whose lower paired confidence bound clears its threshold.',
    rejectionRule: 'Reject when the adequately sampled comparison clears neither success path.',
    reopeningRule: 'Reopen after evaluator drift, benchmark contamination, or a material catalog workflow revision.'
  },
  frozenAt: '2026-08-15T12:00:00.000Z',
  createdAt: '2026-08-15T12:00:00.000Z'
});

describe('Poolday annotation-adjudication product proof', () => {
  it('binds a frozen paired comparison and computes its success path under independent authority', async () => {
    const author = await identity('researcher', 'experiment-author');
    const experiment = await createSignedAdjudicationExperiment({ identity: author, ...experimentInput() });
    expect(await verifyResearchRecord(experiment)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(experiment, [])).toMatchObject({ ok: true });
    expect(experiment.experiment).toMatchObject({
      schema: 'poolday.annotation_adjudication_experiment/v1',
      state: 'frozen',
      target: { catalogId: 'DECLARED-CATALOG', curatorRole: 'protein family annotation curator' },
      successPolicy: { mode: 'quality_or_effort' }
    });
    expect(experiment.experiment.contractHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const acceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'experiment-reviewer'),
      roomId: experiment.roomId,
      targetHash: experiment.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The catalog, baseline, cohort, metrics, and evaluator were frozen before comparison.',
      confidence: 1,
      decision: 'accepted',
      createdAt: '2026-08-15T12:01:00.000Z'
    });
    await expect(createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'unfrozen-evaluator'),
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:WRONG-AUTHORITY', version: '1', contentHash: hash('9') },
      metricResults: []
    })).rejects.toThrow('frozen evaluator identity root');
    const evaluation = await createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'experiment-evaluator'),
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:PUBLIC-ANNOTATION-1', version: '1', contentHash: hash('7') },
      metricResults: [{
        metricId: 'adjudication_quality',
        baselineValue: 0.75,
        candidateValue: 0.82,
        effectInterval: { lower: 0.03, upper: 0.11 },
        pairedSampleCount: 24
      }, {
        metricId: 'curator_effort',
        baselineValue: 30,
        candidateValue: 29,
        effectInterval: { lower: -1, upper: 3 },
        pairedSampleCount: 24
      }],
      regressionCount: 1,
      missingCaseCount: 0,
      disagreementSummary: 'One case remained disputed by the independent evaluator.',
      failureAnalysis: 'The retained regression is bound in the result manifest.',
      createdAt: '2026-08-15T13:00:00.000Z'
    });

    expect(await verifyResearchRecord(evaluation)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(evaluation, [experiment, acceptance])).toMatchObject({ ok: true });
    expect(evaluation.evaluation.assessment).toEqual({
      mode: 'quality_or_effort',
      conclusion: 'passes',
      qualityImproved: true,
      qualityNonInferior: true,
      effortImproved: false,
      effortComparable: true,
      qualityPathPassed: true,
      effortPathPassed: false
    });
  });

  it('fails closed for inadequate samples and self-evaluation', async () => {
    const author = await identity('reviewer', 'shared-author');
    const input = experimentInput();
    input.evaluator.identityRootId = 'root_shared-author';
    const experiment = await createSignedAdjudicationExperiment({ identity: author, ...input });
    const acceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'independent-reviewer'),
      roomId: experiment.roomId,
      targetHash: experiment.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Freeze the comparison.',
      confidence: 1,
      decision: 'accepted'
    });
    const evaluation = await createSignedAdjudicationEvaluation({
      identity: author,
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:UNDERPOWERED', version: '1', contentHash: hash('8') },
      metricResults: [{
        metricId: 'adjudication_quality', baselineValue: 0.75, candidateValue: 0.8,
        effectInterval: { lower: 0, upper: 0.1 }, pairedSampleCount: 8
      }, {
        metricId: 'curator_effort', baselineValue: 30, candidateValue: 25,
        effectInterval: { lower: 1, upper: 9 }, pairedSampleCount: 8
      }],
      disagreementSummary: 'The sample is below the frozen minimum.',
      failureAnalysis: 'The comparison is underpowered.',
      missingCaseCount: 16,
      createdAt: '2026-08-15T13:00:00.000Z'
    });

    expect(evaluation.evaluation.assessment.conclusion).toBe('inconclusive');
    expect(validateResearchRecordLinks(evaluation, [experiment, acceptance])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['adjudication evaluation must be independently authored'])
    });
  });

  it('refuses to invent an unnamed catalog or movable cohort', async () => {
    const input = experimentInput();
    input.target.catalogId = '';
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'invalid-author'),
      ...input
    })).rejects.toThrow('adjudication target requires catalog');

    const movable = experimentInput();
    movable.cohort.familyDisjoint = false;
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'movable-author'),
      ...movable
    })).rejects.toThrow('family-disjoint');
  });
});
