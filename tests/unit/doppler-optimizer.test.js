import { afterEach, describe, expect, it, vi } from 'vitest';

import DopplerOptimizerModule from '../../self/capabilities/system/doppler-optimizer.js';
import UtilsModule from '../../self/core/utils.js';
import { promoteShadowCandidate } from '../../self/tools/Promote.js';

const createMemoryVfs = (entries = {}) => {
  const files = new Map(Object.entries(entries));
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
    }),
    delete: vi.fn(async (path) => files.delete(path)),
    list: vi.fn(async (root) => {
      const prefix = root.endsWith('/') ? root : `${root}/`;
      return [...files.keys()].filter((path) => path.startsWith(prefix));
    })
  };
};

const sha256Text = async (content) => {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
};

const buildContract = () => ({
  schema: 'doppler.runtime-optimization-contract/v1',
  contractId: 'reploid-test',
  kind: 'runtime_profile',
  model: {
    modelId: 'qwen-test',
    modelUrl: null,
    expectedExecutionContractHash: null
  },
  baseline: {
    runtimeProfile: null,
    runtimeConfig: { shared: { kernelWarmup: { enabled: false } } }
  },
  workload: {
    type: 'inference',
    request: { inferenceInput: { prompt: 'test', maxTokens: 4 } }
  },
  mutationPolicy: {
    dimensions: [{ path: '/shared/kernelWarmup/enabled', values: [true, false] }],
    maxCandidates: 2
  },
  verification: {
    comparisons: [{ path: 'result.output', mode: 'canonical_exact' }]
  },
  measurement: {
    metricPath: 'result.metrics.decodeTokensPerSec',
    direction: 'maximize',
    pairCount: 2,
    minValidPairs: 2,
    minImprovementPercent: 1,
    requirePositiveConfidence: false,
    maxRelativeStdDevPercent: 10
  }
});

const acceptedReceipt = (candidateId, improvement = 5) => {
  const identityHex = candidateId.endsWith('a') ? 'a' : 'b';
  return {
    schema: 'doppler.runtime-optimization-receipt/v1',
    receiptHash: `sha256:${identityHex.repeat(64)}`,
    contractHash: `sha256:${'c'.repeat(64)}`,
    candidateId,
    candidateHash: `sha256:${identityHex.repeat(64)}`,
    verification: { passed: true },
    measurement: {
      improvementPercent: { median: improvement, confidence95: { low: 1, high: 8 } },
      candidate: { relativeStdDevPercent: 1.5 }
    },
    decision: { accepted: true, reasons: [] }
  };
};

const createHarness = ({ evaluateCandidate } = {}) => {
  const VFS = createMemoryVfs();
  const Utils = UtilsModule.factory();
  Utils.logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const candidates = [
    {
      schema: 'doppler.runtime-optimization-candidate/v1',
      candidateId: 'candidate-a',
      patch: [{ path: '/shared/kernelWarmup/enabled', value: true }]
    },
    {
      schema: 'doppler.runtime-optimization-candidate/v1',
      candidateId: 'candidate-b',
      patch: [{ path: '/shared/kernelWarmup/enabled', value: false }]
    }
  ];
  const DopplerToolbox = {
    resetProvider: vi.fn(async () => true),
    tooling: {
      optimization: {
        validateContract: vi.fn(async (contract) => contract),
        hashContract: vi.fn(async () => `sha256:${'c'.repeat(64)}`),
        enumerateCandidates: vi.fn(async () => candidates),
        materializeCandidate: vi.fn(async (_contract, candidate) => ({
          runtimeConfig: {
            shared: { kernelWarmup: { enabled: candidate.patch?.[0]?.value === true } }
          }
        })),
        evaluateCandidate: evaluateCandidate || vi.fn(async (_contract, candidate) => (
          acceptedReceipt(candidate.candidateId, candidate.candidateId === 'candidate-a' ? 5 : 2)
        ))
      }
    }
  };
  const EventBus = { emit: vi.fn() };
  const AuditLogger = { logEvent: vi.fn(async () => {}) };
  const optimizer = DopplerOptimizerModule.factory({
    Utils,
    VFS,
    EventBus,
    DopplerToolbox,
    AuditLogger
  });
  return { optimizer, VFS, DopplerToolbox, EventBus, candidates };
};

describe('DopplerOptimizer', () => {
  afterEach(() => {
    delete globalThis.REPLOID_DOPPLER_LOAD_OPTIONS;
  });

  it('records every candidate and selects the strongest accepted receipt', async () => {
    const { optimizer, VFS } = createHarness();

    const result = await optimizer.run(buildContract(), { runId: 'run-a' });
    const run = await optimizer.getRun('run-a');

    expect(result.decision).toMatchObject({
      candidateCount: 2,
      acceptedCandidateCount: 2,
      selectedCandidateId: 'candidate-a'
    });
    expect(run.status).toMatchObject({
      state: 'complete',
      completedCandidates: 2,
      acceptedCandidates: 2
    });
    expect(run.receipts.map((receipt) => receipt.candidateId)).toEqual([
      'candidate-a',
      'candidate-b'
    ]);
    expect(VFS.files.has('/shadow/doppler/runs/run-a/candidates/candidate-a.json')).toBe(true);
    expect(VFS.files.has('/artifacts/doppler/runs/run-a/receipts/candidate-b.json')).toBe(true);
  });

  it('keeps searching after a candidate evaluation fails', async () => {
    const evaluateCandidate = vi.fn()
      .mockRejectedValueOnce(new Error('GPU device lost'))
      .mockResolvedValueOnce(acceptedReceipt('candidate-b', 3));
    const { optimizer } = createHarness({ evaluateCandidate });

    const result = await optimizer.run(buildContract(), { runId: 'run-failure' });
    const run = await optimizer.getRun('run-failure');

    expect(result.decision).toMatchObject({
      candidateCount: 2,
      acceptedCandidateCount: 1,
      selectedCandidateId: 'candidate-b'
    });
    expect(run.receipts[0]).toMatchObject({
      schema: 'reploid.doppler-optimization-attempt/v1',
      candidateId: 'candidate-a',
      decision: { accepted: false }
    });
    expect(run.receipts[0].decision.reasons[0]).toContain('GPU device lost');
  });

  it('activates only the exact profile accepted by Promote and a canary rerun', async () => {
    const { optimizer, VFS, DopplerToolbox } = createHarness();
    await optimizer.run(buildContract(), { runId: 'run-promote' });
    const prepared = await optimizer.preparePromotion('run-promote', 'candidate-a');
    const promotion = await promoteShadowCandidate(prepared.promoteArgs, { VFS });
    prepared.profile.runtimeConfig.shared.kernelWarmup.enabled = false;

    const activation = await optimizer.activatePromotedProfile(prepared, promotion);
    const active = await optimizer.getActiveProfile();

    expect(promotion.promoted).toBe(true);
    expect(activation).toMatchObject({ ok: true, activated: true });
    expect(active).toMatchObject({
      state: 'active',
      modelId: 'qwen-test',
      profileHash: prepared.profileHash,
      candidateId: 'candidate-a'
    });
    expect(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS).toEqual({
      scopeModelId: 'qwen-test',
      runtimeConfig: { shared: { kernelWarmup: { enabled: true } } },
      isolatedLoader: true,
      optimizationProfileHash: prepared.profileHash
    });
    expect(DopplerToolbox.resetProvider).toHaveBeenCalledOnce();
    expect(VFS.files.has(activation.pointer.canaryReceiptPath)).toBe(true);
  });

  it('rolls back activation when the canary rejects the promoted profile', async () => {
    const evaluateCandidate = vi.fn()
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 5))
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 2))
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 5))
      .mockImplementationOnce(async (_contract, candidate) => ({
        ...acceptedReceipt(candidate.candidateId, -4),
        decision: { accepted: false, reasons: ['regression'] }
      }));
    const { optimizer, VFS } = createHarness({ evaluateCandidate });
    await optimizer.run(buildContract(), { runId: 'run-rollback' });
    const prepared = await optimizer.preparePromotion('run-rollback', 'candidate-a');
    const promotion = await promoteShadowCandidate(prepared.promoteArgs, { VFS });

    const activation = await optimizer.activatePromotedProfile(prepared, promotion);

    expect(activation).toMatchObject({
      ok: false,
      activated: false,
      rollback: { restored: true, reason: 'Canary evaluation rejected the promoted profile' }
    });
    expect(await optimizer.getActiveProfile()).toBeNull();
    expect(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS).toBeUndefined();
    expect(VFS.files.has(activation.rollbackPath)).toBe(true);
  });

  it('rolls back an accepted canary receipt for a different candidate identity', async () => {
    const evaluateCandidate = vi.fn()
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 5))
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 2))
      .mockImplementationOnce(async (_contract, candidate) => acceptedReceipt(candidate.candidateId, 5))
      .mockImplementationOnce(async (_contract, candidate) => ({
        ...acceptedReceipt(candidate.candidateId, 5),
        candidateHash: `sha256:${'f'.repeat(64)}`
      }));
    const { optimizer, VFS } = createHarness({ evaluateCandidate });
    await optimizer.run(buildContract(), { runId: 'run-wrong-canary' });
    const prepared = await optimizer.preparePromotion('run-wrong-canary', 'candidate-a');
    const promotion = await promoteShadowCandidate(prepared.promoteArgs, { VFS });

    const activation = await optimizer.activatePromotedProfile(prepared, promotion);

    expect(activation).toMatchObject({
      ok: false,
      activated: false,
      rollback: {
        restored: true,
        reason: 'Canary receipt identity does not match promoted profile'
      }
    });
    expect(await optimizer.getActiveProfile()).toBeNull();
  });

  it('rejects an active profile whose runtime config no longer matches its embedded hash', async () => {
    const { optimizer, VFS } = createHarness();
    await optimizer.run(buildContract(), { runId: 'run-restore-tamper' });
    const prepared = await optimizer.preparePromotion('run-restore-tamper', 'candidate-a');
    const promotion = await promoteShadowCandidate(prepared.promoteArgs, { VFS });
    const activation = await optimizer.activatePromotedProfile(prepared, promotion);
    const pointerPath = '/self/config/doppler/active-profile.json';
    const pointer = JSON.parse(VFS.files.get(pointerPath));
    const profile = JSON.parse(VFS.files.get(pointer.targetPath));
    profile.runtimeConfig.shared.kernelWarmup.enabled = false;
    const tamperedContent = `${JSON.stringify(profile, null, 2)}\n`;
    VFS.files.set(pointer.targetPath, tamperedContent);
    pointer.profileHash = await sha256Text(tamperedContent);
    VFS.files.set(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
    delete globalThis.REPLOID_DOPPLER_LOAD_OPTIONS;

    await expect(optimizer.restoreActiveProfile()).rejects.toThrow(
      'Active Doppler runtime config hash mismatch'
    );
    expect(activation.activated).toBe(true);
    expect(globalThis.REPLOID_DOPPLER_LOAD_OPTIONS).toBeUndefined();
  });

  it('rejects a Shadow candidate changed after promotion preparation', async () => {
    const { optimizer, VFS } = createHarness();
    await optimizer.run(buildContract(), { runId: 'run-tamper' });
    const prepared = await optimizer.preparePromotion('run-tamper', 'candidate-a');
    const promotion = await promoteShadowCandidate(prepared.promoteArgs, { VFS });
    const candidatePath = '/shadow/doppler/runs/run-tamper/candidates/candidate-a.json';
    const candidate = JSON.parse(VFS.files.get(candidatePath));
    candidate.patch[0].value = false;
    VFS.files.set(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

    const activation = await optimizer.activatePromotedProfile(prepared, promotion);

    expect(activation).toMatchObject({
      ok: false,
      activated: false,
      rollback: {
        restored: true,
        reason: 'Canary candidate runtime config does not match promoted profile bytes'
      }
    });
    expect(await optimizer.getActiveProfile()).toBeNull();
  });
});
