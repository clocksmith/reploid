import { describe, expect, it } from 'vitest';

import {
  BROWSER_QUALIFICATION_CHECKS,
  BROWSER_QUALIFICATION_SCHEMA,
  buildBrowserQualificationCheckEvidence,
  buildBrowserQualificationPlan
} from '../../self/pool/browser-qualification.js';
import { MODEL_CATALOG, exactModelContractKey, getPoolModelContract } from '../../self/pool/model-contract.js';
import { validateModelPromotionEvidence } from '../../self/pool/model-promotion.js';
import { DNA_LANE_ADMISSION_SCHEMA } from '../../self/pool/dna-lane-admission.js';
import { SCIENTIFIC_FITNESS_SCHEMA, buildScientificFitnessPlan } from '../../self/pool/scientific-fitness.js';
import { SCIENTIFIC_EVALUATION_SCHEMA, buildScientificEvaluationPlan } from '../../self/pool/scientific-evaluation.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const candidate = getPoolModelContract('amplify-120m-f16-af32');
const baseline = getPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
const nucleotide = getPoolModelContract('nucleotide-transformer-v2-50m-f32-af32');
const candidateKey = exactModelContractKey(candidate);
const baselineKey = exactModelContractKey(baseline);
const browserCheckEvidence = (check, record) => buildBrowserQualificationCheckEvidence(record, {
  check,
  browserRunId: `browser-run-${check}`,
  observedAt: '2026-08-01T00:00:00.000Z',
  resultHash: fakeHash('b'),
  artifactHash: fakeHash('c')
});

const browserRecord = () => {
  const record = {
  schema: BROWSER_QUALIFICATION_SCHEMA,
  status: 'qualified',
  identity: buildBrowserQualificationPlan(candidate, candidateKey).identity,
  release: {
    sourceRevision: 'test-release-source',
    sourceTreeHash: fakeHash('d'),
    browserBundleHash: fakeHash('e')
  },
  browser: { family: 'Chromium', version: '123.0', userAgentHash: fakeHash('f') },
  gpu: { adapterIdentity: 'test-adapter' },
  policyHash: fakeHash('1'),
  outputHash: fakeHash('2'),
  receiptHash: fakeHash('3'),
  artifacts: {
    manifestHash: candidate.manifestHash,
    tokenizerHash: candidate.tokenizerHash,
    shardSetHash: candidate.artifactIdentity.shardSetHash
  },
  requiredChecks: [...BROWSER_QUALIFICATION_CHECKS],
  checks: Object.fromEntries(BROWSER_QUALIFICATION_CHECKS.map((check) => [check, 'passed'])),
  checkEvidence: {},
  independentReproductions: [
    {
      reproductionId: 'run-one', participantId: 'browser-one', browserRunId: 'browser-run-one',
      browserIdentity: 'Chromium/123', observedAt: '2026-08-01T00:00:00.000Z',
      userAgentHash: fakeHash('a'), gpuAdapterIdentity: 'test-adapter-one', resultHash: fakeHash('b'),
      outputHash: fakeHash('2'), receiptHash: fakeHash('3'),
      bindings: {
        modelHash: candidate.modelHash, manifestHash: candidate.manifestHash, tokenizerHash: candidate.tokenizerHash,
        shardSetHash: candidate.artifactIdentity.shardSetHash, runtime: candidate.runtime, backend: candidate.backend,
        exactModelContractKey: candidateKey, sourceTreeHash: fakeHash('d'), browserBundleHash: fakeHash('e'), policyHash: fakeHash('1')
      }
    },
    {
      reproductionId: 'run-two', participantId: 'browser-two', browserRunId: 'browser-run-two',
      browserIdentity: 'Firefox/124', observedAt: '2026-08-01T00:00:01.000Z',
      userAgentHash: fakeHash('c'), gpuAdapterIdentity: 'test-adapter-two', resultHash: fakeHash('d'),
      outputHash: fakeHash('2'), receiptHash: fakeHash('3'),
      bindings: {
        modelHash: candidate.modelHash, manifestHash: candidate.manifestHash, tokenizerHash: candidate.tokenizerHash,
        shardSetHash: candidate.artifactIdentity.shardSetHash, runtime: candidate.runtime, backend: candidate.backend,
        exactModelContractKey: candidateKey, sourceTreeHash: fakeHash('d'), browserBundleHash: fakeHash('e'), policyHash: fakeHash('1')
      }
    }
  ]
  };
  record.checkEvidence = Object.fromEntries(BROWSER_QUALIFICATION_CHECKS.map((check) => [check, browserCheckEvidence(check, record)]));
  return record;
};

const scientificRecord = () => {
  const plan = buildScientificFitnessPlan({
    candidate,
    candidateContractKey: candidateKey,
    baselines: [baseline],
    baselineContractKeys: [baselineKey]
  });
  return {
    schema: SCIENTIFIC_FITNESS_SCHEMA,
    candidate: plan.candidate,
    baselines: plan.baselines,
    frozenCohortHash: fakeHash('4'),
    evaluation: {
      evaluationId: 'protein-family-disjoint-evaluation', protocolHash: fakeHash('b'),
      runHash: fakeHash('c'), resultSetHash: fakeHash('d'),
      receiptPath: 'docs/status/amplify-scientific-evaluation.json', receiptHash: fakeHash('0')
    },
    familyPartition: {
      methodId: 'protein-family-clusters', version: '1', definitionHash: fakeHash('5'),
      holdoutFamilyHashes: [fakeHash('6'), fakeHash('7')], developmentFamilyHashes: [fakeHash('8')]
    },
    adjudication: {
      protocolId: 'protein-evaluation-adjudication', version: '1', protocolHash: fakeHash('9'),
      outcomeHash: fakeHash('a'), evaluatorIdentity: 'independent-evaluator-one'
    },
    metricResults: [{
      metricId: 'residue_plausibility_decision_value', direction: 'higher_is_better',
      baselineValue: 0.5, candidateValue: 0.7, improved: true,
      definitionHash: fakeHash('e'), resultHash: fakeHash('f'),
      evaluationRunHash: fakeHash('c'), baselineExactModelContractKey: baselineKey
    }],
    decision: 'qualified',
    claimBoundary: candidate.admission.claimBoundary
  };
};

const scientificEvaluationRecord = () => {
  const fitness = scientificRecord();
  const plan = buildScientificEvaluationPlan({
    candidate,
    candidateContractKey: candidateKey,
    baselines: [baseline],
    baselineContractKeys: [baselineKey]
  });
  return {
    schema: SCIENTIFIC_EVALUATION_SCHEMA,
    candidate: plan.candidate,
    baselines: plan.baselines,
    evaluation: {
      evaluationId: fitness.evaluation.evaluationId,
      protocolHash: fitness.evaluation.protocolHash,
      runHash: fitness.evaluation.runHash,
      resultSetHash: fitness.evaluation.resultSetHash
    },
    frozenCohort: {
      cohortId: 'public-protein-family-disjoint-v1', cohortHash: fitness.frozenCohortHash,
      sourceManifestHash: fakeHash('1'), publicOnly: true,
      members: [
        { sampleHash: fakeHash('2'), familyHash: fakeHash('6'), inputHash: fakeHash('3'), observationHash: fakeHash('4') },
        { sampleHash: fakeHash('5'), familyHash: fakeHash('7'), inputHash: fakeHash('8'), observationHash: fakeHash('9') },
        { sampleHash: fakeHash('a'), familyHash: fakeHash('8'), inputHash: fakeHash('b'), observationHash: fakeHash('c') }
      ]
    },
    familyPartition: fitness.familyPartition,
    adjudication: fitness.adjudication,
    modelRuns: [
      { exactModelContractKey: candidateKey, evaluationRunHash: fitness.evaluation.runHash, resultHash: fakeHash('d'), outputSetHash: fakeHash('e') },
      { exactModelContractKey: baselineKey, evaluationRunHash: fitness.evaluation.runHash, resultHash: fakeHash('f'), outputSetHash: fakeHash('0') }
    ],
    metricResults: fitness.metricResults
  };
};

const qualifiedCandidate = () => ({
  ...candidate,
  admission: { ...candidate.admission, browserWebGpu: 'qualified', scientificFitness: 'qualified' }
});

const dnaAdmissionRecord = (gate) => ({
  schema: DNA_LANE_ADMISSION_SCHEMA,
  gate,
  exactModelContractKey: exactModelContractKey(nucleotide),
  decision: 'qualified',
  evaluatorIdentity: `independent-${gate}-reviewer`,
  policyHash: fakeHash('1'), evidenceHash: fakeHash('2'), recordHash: fakeHash('3')
});

describe('Poolday persisted model-promotion evidence', () => {
  it('accepts exact browser and family-disjoint scientific evidence against the enabled ESM-2 baseline', () => {
    expect(validateModelPromotionEvidence({
      model: qualifiedCandidate(),
      modelCatalog: MODEL_CATALOG,
      launchModel: baseline,
      browserQualificationRecord: browserRecord(),
      scientificFitnessRecord: scientificRecord(),
      scientificEvaluationRecord: scientificEvaluationRecord()
    })).toEqual({ ok: true, reasons: [] });
  });

  it('rejects missing receipt content and a scientific record that omits the ESM-2 baseline', () => {
    const record = scientificRecord();
    record.baselines = [];
    expect(validateModelPromotionEvidence({
      model: qualifiedCandidate(),
      modelCatalog: MODEL_CATALOG,
      launchModel: baseline,
      scientificFitnessRecord: record
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'qualified browser admission is missing its persisted qualification record',
        'scientific fitness must include the enabled ESM-2 baseline contract'
      ])
    });
  });

  it('rejects a qualified scientific-fitness receipt without its frozen evaluation manifest', () => {
    expect(validateModelPromotionEvidence({
      model: qualifiedCandidate(),
      modelCatalog: MODEL_CATALOG,
      launchModel: baseline,
      browserQualificationRecord: browserRecord(),
      scientificFitnessRecord: scientificRecord()
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'scientific fitness: scientific fitness requires a valid frozen evaluation record'
      ])
    });
  });

  it('rejects direct DNA promotion until every independent DNA-lane gate is qualified', () => {
    const model = {
      ...nucleotide,
      admission: {
        ...nucleotide.admission,
        browserWebGpu: 'qualified',
        scientificFitness: 'qualified'
      }
    };
    expect(validateModelPromotionEvidence({
      model,
      modelCatalog: MODEL_CATALOG,
      launchModel: baseline
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'DNA promotion requires qualified privacy admission',
        'DNA promotion requires qualified reference-coordinate admission',
        'DNA promotion requires qualified DNA scientific-fitness admission',
        'DNA promotion requires approved licensing admission',
        'DNA promotion requires admitted product use'
      ])
    });
  });

  it('requires hash-addressed, exact-contract records for every qualified DNA gate', () => {
    const model = {
      ...nucleotide,
      admission: {
        ...nucleotide.admission,
        browserWebGpu: 'missing', scientificFitness: 'missing',
        dnaLane: {
          privacy: 'qualified', referenceCoordinates: 'qualified', scientificFitness: 'qualified',
          licensing: 'approved', productUse: 'admitted',
          privacyReceipt: 'privacy.json', referenceCoordinateReceipt: 'coordinates.json',
          scientificFitnessReceipt: 'fitness.json', licensingReceipt: 'license.json', productUseReceipt: 'product-use.json'
        }
      }
    };
    expect(validateModelPromotionEvidence({ model })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['DNA promotion requires a valid persisted privacy admission record'])
    });
    expect(validateModelPromotionEvidence({
      model,
      dnaAdmissionRecords: Object.fromEntries(['privacy', 'referenceCoordinates', 'scientificFitness', 'licensing', 'productUse']
        .map((gate) => [gate, dnaAdmissionRecord(gate)]))
    })).toEqual({ ok: true, reasons: [] });
  });
});
