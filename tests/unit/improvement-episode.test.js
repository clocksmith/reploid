import { describe, expect, it, vi } from 'vitest';

import ImprovementEpisodeLedgerModule, {
  ALGORITHM_MANIFEST_SCHEMA,
  IMPROVEMENT_EPISODE_SCHEMA,
  hashImprovementValue
} from '../../self/core/improvement-episode.js';

const createMemoryVfs = () => {
  const files = new Map();
  return {
    files,
    exists: vi.fn(async (path) => files.has(path)),
    read: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path);
    }),
    write: vi.fn(async (path, content) => {
      files.set(path, content);
      return true;
    })
  };
};

const digest = (character) => `sha256:${character.repeat(64)}`;

const algorithm = () => ({
  schema: ALGORITHM_MANIFEST_SCHEMA,
  algorithmId: 'doppler.runtime-profile-search',
  version: '1.0.0',
  sourceModules: ['/self/capabilities/system/doppler-optimizer.js'],
  inputs: ['Frozen runtime optimization contract'],
  outputs: ['Paired candidate receipt'],
  invariants: ['Candidate and baseline use the same frozen workload'],
  complexity: 'Linear in candidate count and paired sample count.',
  resourceAssumptions: ['Browser WebGPU runtime is available'],
  knownFailureModes: ['Thermal drift can bias unpaired measurements'],
  evaluationSuites: ['doppler.runtime-optimization-contract/v1'],
  dependencies: ['doppler-gpu@0.5.1'],
  status: 'shadow',
  historicalRevisions: [],
  candidateAlternatives: []
});

const startRecord = () => ({
  episodeId: 'episode:test:1',
  parentEpisodeId: null,
  groupId: 'run:test',
  surface: 'x',
  objective: {
    objectiveId: 'decode-throughput',
    statement: 'Increase decode throughput without changing canonical output.',
    successMetricId: 'decode-improvement-percent'
  },
  baseline: {
    generationId: 'generation:12',
    hashes: {
      code: digest('1'),
      config: digest('2'),
      model: digest('3'),
      prompt: digest('4'),
      artifacts: digest('5'),
      contract: digest('6')
    },
    hashSemantics: {
      code: 'Doppler package identity',
      artifacts: 'Pinned model and runtime identities'
    },
    snapshotPath: '/artifacts/baselines/generation-12.json'
  },
  proposer: { authorityId: 'reploid:x:optimizer' },
  evaluator: {
    evaluatorId: 'doppler.runtime-optimization',
    authorityId: 'doppler:tooling:evaluator',
    version: '0.5.1',
    evaluatorHash: digest('7'),
    testSuiteDigest: digest('8'),
    protectedPaths: [
      '/self/core/improvement-episode.js',
      '/self/core/promotion-policy.js',
      '/self/infrastructure/audit-logger.js'
    ],
    heldOut: true,
    frozenBeforeCandidate: true
  },
  metrics: [{
    metricId: 'decode-improvement-percent',
    unit: 'percent',
    direction: 'maximize',
    measurementSource: 'result.metrics.decodeTokensPerSec',
    aggregationRule: 'Median paired percentage improvement.',
    validityConditions: ['Canonical output parity passes', 'At least five valid pairs'],
    noiseModel: 'Paired browser observations with a 95% confidence interval.',
    minimumSampleSize: 5,
    promotionThreshold: { operator: '>=', value: 1 },
    operational: false
  }],
  algorithm: algorithm(),
  environment: { runtime: 'browser', provider: 'doppler' },
  corpus: { evaluationSplitHash: digest('9'), heldOut: true },
  resourceBudget: { calls: 12, elapsedMs: 60000, memoryBytes: 2147483648 }
});

const candidate = () => ({
  candidateId: 'candidate:a',
  candidateHash: digest('a'),
  patchHash: digest('b'),
  generationId: 'generation:13',
  parentGenerationId: 'generation:12',
  changedFiles: ['/shadow/doppler/candidate-a.json'],
  semanticScope: ['decode loop batch size'],
  expectedBehavior: 'Increase throughput while preserving exact output.',
  affectedInvariants: ['Canonical output parity'],
  falsifier: 'Output parity fails or paired improvement is below one percent.'
});

const diagnosis = () => ({
  diagnosis: 'The decode loop may be under-batched for this frozen workload.',
  hypothesis: {
    observation: 'Baseline decode throughput is below the declared target.',
    suspectedCause: 'Decode batch size is too small.',
    alternativeExplanations: ['Thermal throttling', 'Measurement noise'],
    proposedDiagnostic: 'Run paired baseline and candidate samples in alternating order.',
    candidateIntervention: 'Increase decode batch size from four to eight.',
    expectedResult: 'Median paired throughput improves by at least one percent.',
    falsifyingResult: 'Parity fails or the confidence interval includes the rejection region.',
    followUpHypothesis: null
  }
});

const createLedger = () => {
  const VFS = createMemoryVfs();
  const EventBus = { emit: vi.fn() };
  const AuditLogger = { logEvent: vi.fn(async () => {}) };
  const ledger = ImprovementEpisodeLedgerModule.factory({
    Utils: { logger: { warn: vi.fn(), info: vi.fn() } },
    VFS,
    EventBus,
    AuditLogger
  });
  return { ledger, VFS, EventBus, AuditLogger };
};

const recordSuccessfulEvaluation = async (ledger, episodeId = 'episode:test:1') => {
  await ledger.recordDiagnosis(episodeId, diagnosis());
  await ledger.proposeCandidate(episodeId, candidate());
  await ledger.recordExecution(episodeId, {
    isolated: true,
    sandboxId: 'sandbox:candidate-a',
    runtimeIdentity: 'browser:test / doppler-gpu@0.5.1',
    resourceUse: { calls: 12, elapsedMs: 48000 }
  });
  await ledger.recordVerification(episodeId, {
    passed: true,
    verifierId: 'doppler:parity-verifier',
    evidencePaths: ['/artifacts/doppler/receipts/candidate-a.json'],
    checks: [{ id: 'canonical-output', passed: true }]
  });
  await ledger.recordEvaluation(episodeId, {
    baselineContractHash: digest('6'),
    candidateContractHash: digest('6'),
    evaluatorHash: digest('7'),
    sampleCount: 5,
    rawObservations: [1, 2, 3, 4, 5].map((index) => ({
      index,
      baseline: 10 + index,
      candidate: 11 + index,
      valid: true
    })),
    metrics: [{
      metricId: 'decode-improvement-percent',
      value: 5,
      valid: true,
      confidenceInterval: { low: 2, high: 8 }
    }]
  });
  await ledger.recordComparison(episodeId, {
    primaryMetricId: 'decode-improvement-percent',
    tradeoffs: [{ metricId: 'decode-improvement-percent', baseline: 12, candidate: 13 }],
    regressions: [],
    conclusion: 'improved'
  });
};

describe('ImprovementEpisodeLedger', () => {
  it('binds a signed causal episode from frozen baseline through promotion and rollback', async () => {
    const { ledger } = createLedger();

    await ledger.begin(startRecord());
    await recordSuccessfulEvaluation(ledger);
    const beforePromotion = await ledger.getEpisode('episode:test:1');

    expect(beforePromotion).toMatchObject({
      schema: IMPROVEMENT_EPISODE_SCHEMA,
      status: 'compared',
      integrity: { valid: true, validSignatures: 7 },
      generation: {
        baseline: 'generation:12',
        candidate: 'generation:13',
        current: 'generation:12'
      }
    });
    expect(ledger.assessPromotionReadiness(beforePromotion)).toEqual({ ready: true, reasons: [] });

    await ledger.requestPromotion('episode:test:1', {
      evidencePath: '/artifacts/doppler/promotion/evidence.json'
    });
    await ledger.recordDecision('episode:test:1', {
      state: 'promoted',
      reasons: [],
      promotionId: 'promotion:13'
    });
    expect((await ledger.getEpisode('episode:test:1')).generation.current).toBe('generation:13');

    await ledger.recordRollback('episode:test:1', {
      rollbackPointer: '/artifacts/doppler/promotion/rollback.json',
      restoredGenerationId: 'generation:12',
      reason: 'Prospective canary regressed.'
    });
    await ledger.recordReflection('episode:test:1', diagnosis().hypothesis);

    const rolledBack = await ledger.getEpisode('episode:test:1');
    expect(rolledBack).toMatchObject({
      status: 'rolled_back',
      generation: { current: 'generation:12' },
      rollback: { reason: 'Prospective canary regressed.' }
    });
    expect(rolledBack.reflections).toHaveLength(1);
    await expect(ledger.verifyEpisode('episode:test:1')).resolves.toMatchObject({ valid: true });
  });

  it('fails promotion readiness when paired samples do not meet the frozen metric definition', async () => {
    const { ledger } = createLedger();
    await ledger.begin(startRecord());
    await ledger.recordDiagnosis('episode:test:1', diagnosis());
    await ledger.proposeCandidate('episode:test:1', candidate());
    await ledger.recordExecution('episode:test:1', {
      isolated: true,
      sandboxId: 'sandbox:candidate-a',
      runtimeIdentity: 'browser:test'
    });
    await ledger.recordVerification('episode:test:1', {
      passed: true,
      verifierId: 'doppler:parity-verifier',
      evidencePaths: ['/artifacts/verification.json']
    });
    await ledger.recordEvaluation('episode:test:1', {
      baselineContractHash: digest('6'),
      candidateContractHash: digest('6'),
      evaluatorHash: digest('7'),
      sampleCount: 2,
      rawObservations: [{ valid: true }, { valid: true }],
      metrics: [{ metricId: 'decode-improvement-percent', value: 4, valid: true }]
    });
    await ledger.recordComparison('episode:test:1', {
      primaryMetricId: 'decode-improvement-percent',
      tradeoffs: [],
      regressions: [],
      conclusion: 'improved'
    });

    await expect(ledger.requestPromotion('episode:test:1', {})).rejects.toThrow(
      'requires at least 5 paired samples'
    );
  });

  it('rejects candidates that overlap evaluator, audit, promotion, or rollback authority', async () => {
    const { ledger } = createLedger();
    await ledger.begin(startRecord());
    await ledger.recordDiagnosis('episode:test:1', diagnosis());

    await expect(ledger.proposeCandidate('episode:test:1', {
      ...candidate(),
      changedFiles: ['/self/core/promotion-policy.js']
    })).rejects.toThrow('overlaps protected evaluator authority');
  });

  it('does not promote against a task set frozen after candidate creation', async () => {
    const { ledger } = createLedger();
    const start = startRecord();
    start.evaluator.frozenBeforeCandidate = false;
    await ledger.begin(start);
    await recordSuccessfulEvaluation(ledger);

    await expect(ledger.requestPromotion('episode:test:1', {})).rejects.toThrow(
      'evaluator and task set were not frozen before the candidate'
    );
  });

  it('requires child episodes to descend from the parent current generation', async () => {
    const { ledger } = createLedger();
    await ledger.begin(startRecord());
    await recordSuccessfulEvaluation(ledger);
    await ledger.requestPromotion('episode:test:1', {});
    await ledger.recordDecision('episode:test:1', {
      state: 'promoted',
      reasons: []
    });

    const child = startRecord();
    child.episodeId = 'episode:test:2';
    child.parentEpisodeId = 'episode:test:1';
    child.baseline.generationId = 'generation:13';
    await expect(ledger.begin(child)).resolves.toMatchObject({
      episodeId: 'episode:test:2',
      parentEpisodeId: 'episode:test:1',
      generation: { baseline: 'generation:13' }
    });

    const invalidChild = startRecord();
    invalidChild.episodeId = 'episode:test:3';
    invalidChild.parentEpisodeId = 'episode:test:1';
    await expect(ledger.begin(invalidChild)).rejects.toThrow(
      'Child baseline generation does not match the parent current generation'
    );
  });

  it('detects event mutation and keeps algorithm versions immutable', async () => {
    const { ledger, VFS } = createLedger();
    await ledger.begin(startRecord());
    const eventPath = ledger.pathsForEpisode('episode:test:1').events;
    const events = VFS.files.get(eventPath).replace(
      'Increase decode throughput',
      'Decrease decode throughput'
    );
    VFS.files.set(eventPath, events);

    await expect(ledger.verifyEpisode('episode:test:1')).resolves.toMatchObject({
      valid: false,
      reasons: expect.arrayContaining(['event 0 hash mismatch'])
    });

    await expect(ledger.registerAlgorithm({
      ...algorithm(),
      invariants: ['Mutated invariant under the same version']
    })).rejects.toThrow('Algorithm version is immutable');
  });

  it('hashes object keys canonically', async () => {
    await expect(Promise.all([
      hashImprovementValue({ b: 2, a: 1 }),
      hashImprovementValue({ a: 1, b: 2 })
    ])).resolves.toEqual([expect.any(String), expect.any(String)]);
    expect(await hashImprovementValue({ b: 2, a: 1 })).toBe(
      await hashImprovementValue({ a: 1, b: 2 })
    );
  });
});
