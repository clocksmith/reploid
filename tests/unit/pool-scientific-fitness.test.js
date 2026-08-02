import { describe, expect, it } from 'vitest';

import { exactModelContractKey, getPoolModelContract } from '../../self/pool/model-contract.js';
import {
  SCIENTIFIC_FITNESS_SCHEMA,
  buildScientificFitnessPlan,
  validateScientificFitnessRecord
} from '../../self/pool/scientific-fitness.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const candidate = getPoolModelContract('amplify-120m-f16-af32');
const baseline = getPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
const candidateKey = exactModelContractKey(candidate);
const baselineKey = exactModelContractKey(baseline);

const qualifiedRecord = () => {
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
    frozenCohortHash: fakeHash('1'),
    familyPartition: {
      methodId: 'protein-family-clusters',
      version: '1',
      definitionHash: fakeHash('2'),
      holdoutFamilyHashes: [fakeHash('3'), fakeHash('4')],
      developmentFamilyHashes: [fakeHash('5')]
    },
    adjudication: {
      protocolId: 'protein-evaluation-adjudication',
      version: '1',
      protocolHash: fakeHash('6'),
      outcomeHash: fakeHash('7'),
      evaluatorIdentity: 'independent-evaluator-one'
    },
    metricResults: [{
      metricId: 'residue_plausibility_decision_value',
      direction: 'higher_is_better',
      baselineValue: 0.5,
      candidateValue: 0.7,
      improved: true
    }],
    decision: 'qualified',
    claimBoundary: candidate.admission.claimBoundary
  };
};

describe('Poolday model scientific-fitness contract', () => {
  it('binds candidate value evidence to exact models, a frozen cohort, and a family-disjoint partition', () => {
    expect(validateScientificFitnessRecord(qualifiedRecord(), {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey]
    })).toEqual({ ok: true, reasons: [] });
  });

  it('rejects overlapping family partitions and a decision without measured improvement', () => {
    const record = qualifiedRecord();
    record.familyPartition.developmentFamilyHashes = [record.familyPartition.holdoutFamilyHashes[0]];
    record.metricResults[0].improved = false;

    expect(validateScientificFitnessRecord(record, {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey]
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'scientific fitness family partition is not frozen and disjoint',
        'scientific fitness does not demonstrate measured candidate value'
      ])
    });
  });

  it('rejects a claimed improvement that contradicts the frozen metric values or claim boundary', () => {
    const record = qualifiedRecord();
    record.metricResults[0].candidateValue = 0.4;
    record.claimBoundary = 'This unsupported claim would be a mutation-fitness assertion.';

    expect(validateScientificFitnessRecord(record, {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey]
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'scientific fitness metric improvement flag does not match measured values: residue_plausibility_decision_value',
        'scientific fitness claim boundary does not match the exact candidate contract'
      ])
    });
  });

  it('rejects an evaluation that uses the candidate as its own baseline', () => {
    const record = qualifiedRecord();

    expect(validateScientificFitnessRecord(record, {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [candidate],
      baselineContractKeys: [candidateKey]
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'scientific fitness candidate cannot be its own baseline',
        'scientific fitness baseline 1 modelId does not match the exact model contract'
      ])
    });
  });
});
