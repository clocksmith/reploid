import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultDopplerOptimizationContract,
  createDopplerOptimizationManager
} from '../../self/ui/proto/optimization.js';
import { renderProtoTemplate } from '../../self/ui/proto/template.js';

const flush = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const receipt = (candidateId, accepted, improvement) => ({
  candidateId,
  candidateHash: `sha256:${candidateId}`,
  receiptHash: `sha256:receipt-${candidateId}`,
  receiptPath: `/artifacts/doppler/runs/run-a/receipts/${candidateId}.json`,
  candidate: {
    patch: [{ path: '/inference/session/decodeLoop/batchSize', value: candidateId === 'a' ? 4 : 8 }]
  },
  verification: { passed: accepted },
  measurement: {
    improvementPercent: {
      median: improvement,
      confidence95: { low: improvement - 1, high: improvement + 1 }
    },
    candidate: { relativeStdDevPercent: 1.25 }
  },
  decision: {
    accepted,
    reasons: accepted ? [] : ['candidate_parity_failed']
  }
});

describe('Doppler optimization UI', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows accepted and rejected receipts and promotes through ToolRunner', async () => {
    document.body.innerHTML = `<div id="root">${renderProtoTemplate((value) => value, 'test')}</div>`;
    const root = document.getElementById('root');
    const accepted = receipt('a', true, 5);
    const rejected = receipt('b', false, -2);
    const prepared = {
      runId: 'run-a',
      candidateId: 'a',
      promoteArgs: {
        candidatePath: '/shadow/doppler/profiles/a.json',
        targetPath: '/self/config/doppler/profiles/a.json',
        evidencePath: '/artifacts/doppler/promotions/a/evidence.json'
      }
    };
    const DopplerOptimizer = {
      getState: vi.fn(() => ({ running: false })),
      listRuns: vi.fn(async () => [{ runId: 'run-a', state: 'complete' }]),
      getActiveProfile: vi.fn(async () => null),
      getRun: vi.fn(async () => ({
        runId: 'run-a',
        status: { state: 'complete', candidateCount: 2, completedCandidates: 2 },
        decision: { selectedCandidateId: 'a' },
        receipts: [accepted, rejected]
      })),
      preparePromotion: vi.fn(async () => prepared),
      activatePromotedProfile: vi.fn(async () => ({ activated: true })),
      cancel: vi.fn(() => false),
      run: vi.fn()
    };
    const ToolRunner = {
      execute: vi.fn(async () => ({
        promoted: true,
        targetPath: prepared.promoteArgs.targetPath
      }))
    };
    const EventBus = { on: vi.fn(() => vi.fn()) };
    const Toast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    };
    const manager = createDopplerOptimizationManager({
      DopplerOptimizer,
      ToolRunner,
      EventBus,
      Toast,
      logger: { warn: vi.fn() }
    });

    await manager.mount(root);

    const rows = [...root.querySelectorAll('[data-optimization-candidate]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('ACCEPT');
    expect(rows[0].textContent).toContain('+5.00%');
    expect(rows[1].textContent).toContain('REJECT');
    expect(root.querySelector('#optimization-promote').disabled).toBe(false);

    root.querySelector('#optimization-promote').click();
    await vi.waitFor(() => expect(DopplerOptimizer.activatePromotedProfile).toHaveBeenCalledOnce());

    expect(DopplerOptimizer.preparePromotion).toHaveBeenCalledWith('run-a', 'a');
    expect(ToolRunner.execute).toHaveBeenCalledWith('Promote', prepared.promoteArgs);
    expect(DopplerOptimizer.activatePromotedProfile).toHaveBeenCalledWith(
      prepared,
      expect.objectContaining({ promoted: true })
    );
    expect(Toast.success).toHaveBeenCalledWith('Profile Active', 'a');
    manager.cleanup();
  });

  it('loads a valid explicit contract and rejects malformed JSON before running', async () => {
    document.body.innerHTML = `<div id="root">${renderProtoTemplate((value) => value, 'test')}</div>`;
    const root = document.getElementById('root');
    const DopplerOptimizer = {
      getState: vi.fn(() => ({ running: false })),
      listRuns: vi.fn(async () => []),
      getActiveProfile: vi.fn(async () => null),
      getRun: vi.fn(),
      cancel: vi.fn(() => false),
      run: vi.fn()
    };
    const manager = createDopplerOptimizationManager({
      DopplerOptimizer,
      ToolRunner: { execute: vi.fn() },
      EventBus: { on: vi.fn(() => vi.fn()) },
      Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
      logger: { warn: vi.fn() }
    });

    await manager.mount(root);
    const textarea = root.querySelector('#optimization-contract');
    expect(JSON.parse(textarea.value)).toEqual(createDefaultDopplerOptimizationContract());

    textarea.value = '{';
    root.querySelector('#optimization-run').click();
    await flush();

    expect(DopplerOptimizer.run).not.toHaveBeenCalled();
    expect(root.querySelector('#optimization-contract-error').textContent).toContain('Invalid JSON');
    manager.cleanup();
  });
});
