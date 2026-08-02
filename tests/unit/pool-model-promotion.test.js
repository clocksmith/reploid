import { describe, expect, it } from 'vitest';

import {
  BROWSER_QUALIFICATION_CHECKS,
  BROWSER_QUALIFICATION_SCHEMA,
  buildBrowserQualificationCheckEvidence,
  buildBrowserQualificationPlan
} from '../../self/pool/browser-qualification.js';
import { MODEL_CATALOG, exactModelContractKey, getPoolModelContract } from '../../self/pool/model-contract.js';
import { validateModelPromotionEvidence } from '../../self/pool/model-promotion.js';
import { SCIENTIFIC_FITNESS_SCHEMA, buildScientificFitnessPlan } from '../../self/pool/scientific-fitness.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const candidate = getPoolModelContract('amplify-120m-f16-af32');
const baseline = getPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
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
    { reproductionId: 'run-one', participantId: 'browser-one', browserIdentity: 'Chromium/123', outputHash: fakeHash('2') },
    { reproductionId: 'run-two', participantId: 'browser-two', browserIdentity: 'Chromium/123', outputHash: fakeHash('2') }
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
      baselineValue: 0.5, candidateValue: 0.7, improved: true
    }],
    decision: 'qualified',
    claimBoundary: candidate.admission.claimBoundary
  };
};

const qualifiedCandidate = () => ({
  ...candidate,
  admission: { ...candidate.admission, browserWebGpu: 'qualified', scientificFitness: 'qualified' }
});

describe('Poolday persisted model-promotion evidence', () => {
  it('accepts exact browser and family-disjoint scientific evidence against the enabled ESM-2 baseline', () => {
    expect(validateModelPromotionEvidence({
      model: qualifiedCandidate(),
      modelCatalog: MODEL_CATALOG,
      launchModel: baseline,
      browserQualificationRecord: browserRecord(),
      scientificFitnessRecord: scientificRecord()
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
});
