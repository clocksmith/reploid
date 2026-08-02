import { describe, expect, it } from 'vitest';

import { exactModelContractKey, getPoolModelContract } from '../../self/pool/model-contract.js';
import {
  SCIENTIFIC_FITNESS_SCHEMA,
  buildScientificFitnessPlan,
  validateScientificFitnessRecord
} from '../../self/pool/scientific-fitness.js';
import {
  SCIENTIFIC_EVALUATION_SCHEMA,
  buildScientificEvaluationPlan,
  validateScientificEvaluationRecord,
  validateScientificFitnessEvaluationBinding
} from '../../self/pool/scientific-evaluation.js';

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
    evaluation: {
      evaluationId: 'protein-family-disjoint-evaluation', protocolHash: fakeHash('a'),
      runHash: fakeHash('b'), resultSetHash: fakeHash('c'),
      receiptPath: 'docs/status/amplify-scientific-evaluation.json', receiptHash: fakeHash('f')
    },
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
      definitionHash: fakeHash('d'), resultHash: fakeHash('e'),
      evaluationRunHash: fakeHash('b'), baselineExactModelContractKey: baselineKey,
      improved: true
    }],
    decision: 'qualified',
    claimBoundary: candidate.admission.claimBoundary
  };
};

const evaluationRecord = () => {
  const fitness = qualifiedRecord();
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
      cohortId: 'public-protein-family-disjoint-v1',
      cohortHash: fitness.frozenCohortHash,
      sourceManifestHash: fakeHash('8'),
      publicOnly: true,
      members: [
        { sampleHash: fakeHash('9'), familyHash: fakeHash('3'), inputHash: fakeHash('a'), observationHash: fakeHash('b') },
        { sampleHash: fakeHash('c'), familyHash: fakeHash('4'), inputHash: fakeHash('d'), observationHash: fakeHash('e') },
        { sampleHash: fakeHash('f'), familyHash: fakeHash('5'), inputHash: fakeHash('6'), observationHash: fakeHash('7') }
      ]
    },
    familyPartition: fitness.familyPartition,
    adjudication: fitness.adjudication,
    modelRuns: [
      { exactModelContractKey: candidateKey, evaluationRunHash: fitness.evaluation.runHash, resultHash: fakeHash('0'), outputSetHash: fakeHash('1') },
      { exactModelContractKey: baselineKey, evaluationRunHash: fitness.evaluation.runHash, resultHash: fakeHash('2'), outputSetHash: fakeHash('3') }
    ],
    metricResults: fitness.metricResults
  };
};

describe('Poolday model scientific-fitness contract', () => {
  it('binds candidate value evidence to exact models, a frozen cohort, and a family-disjoint partition', () => {
    expect(validateScientificFitnessRecord(qualifiedRecord(), {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey],
      scientificEvaluationRecord: evaluationRecord()
    })).toEqual({ ok: true, reasons: [] });
  });

  it('requires a valid frozen evaluation manifest whose metrics exactly match the fitness claim', () => {
    const evaluation = evaluationRecord();
    expect(validateScientificEvaluationRecord(evaluation, {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey]
    })).toEqual({ ok: true, reasons: [] });
    evaluation.metricResults[0].candidateValue = 0.6;
    expect(validateScientificFitnessEvaluationBinding(qualifiedRecord(), evaluation)).toMatchObject({
      ok: false,
      reasons: ['scientific fitness does not exactly bind the frozen evaluation evidence']
    });
  });

  it('rejects a partition that declares holdout families absent from the frozen cohort', () => {
    const evaluation = evaluationRecord();
    evaluation.frozenCohort.members[1].familyHash = fakeHash('5');
    expect(validateScientificEvaluationRecord(evaluation, {
      candidate, candidateContractKey: candidateKey, baselines: [baseline], baselineContractKeys: [baselineKey]
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['scientific evaluation frozen cohort lacks a declared holdout family'])
    });
  });

  it('rejects overlapping family partitions and a decision without measured improvement', () => {
    const record = qualifiedRecord();
    record.familyPartition.developmentFamilyHashes = [record.familyPartition.holdoutFamilyHashes[0]];
    record.metricResults[0].improved = false;

    expect(validateScientificFitnessRecord(record, {
      candidate,
      candidateContractKey: candidateKey,
      baselines: [baseline],
      baselineContractKeys: [baselineKey],
      scientificEvaluationRecord: evaluationRecord()
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
      baselineContractKeys: [baselineKey],
      scientificEvaluationRecord: evaluationRecord()
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
      baselineContractKeys: [candidateKey],
      scientificEvaluationRecord: evaluationRecord()
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'scientific fitness candidate cannot be its own baseline',
        'scientific fitness baseline 1 modelId does not match the exact model contract'
      ])
    });
  });
});
