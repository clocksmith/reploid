// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import { runConcurrentPartitionMemory } from '../fixtures/concurrent-partition-memory.js';

function fixture({ corruptSurvivor = false, rejectClose = false, ignoreAbort = false } = {}) {
  const events = [], runs = [], live = [new Set(), new Set()];
  const pages = [0, 1].map(index => {
    let context;
    const resident = {
      tokenize: async () => ({ tokenIds: Array(1588).fill(7) }),
      executeGroup0: async ({ identity, step, signal }) => {
        live[index].add(identity.attemptId);
        events.push(['input', identity.attemptId, step]);
        if (context.abortOnSubmit) {
          const controller = context.abortOnSubmit;
          context.abortOnSubmit = null;
          controller.abort(new DOMException('diagnostic prefill cancellation', 'AbortError'));
        }
        if (signal.aborted && !ignoreAbort) throw signal.reason;
        return { activationTensor: { data: new Float32Array([step]) }, continuation: { step } };
      },
      executeGroup1: async ({ identity, step }) => {
        live[index].add(identity.attemptId);
        events.push(['output', identity.attemptId, step]);
        const corrupt = corruptSurvivor && identity.attemptId.endsWith('survivor') && step === 2;
        return { tokenId: corrupt ? 99 : step + 10, delta: corrupt ? 'wrong' : String(step),
          done: step === 3, stopReason: step === 3 ? 'eos-token' : null, continuation: { step } };
      },
      closeAttempt: async ({ identity }) => {
        events.push(['close', identity.attemptId, index]);
        if (rejectClose && identity.attemptId.endsWith('cancelled') && index === 0) throw Error('cleanup failed');
        live[index].delete(identity.attemptId);
      }
    };
    context = createContext({ resident, AbortController, DOMException, Uint8Array, Float32Array, atob,
      abortOnSubmit: null, observePrefill: false,
      rejectOversizedAllocation: async () => ({ code: 'RESOURCE_EXHAUSTED', synthetic: true }),
      encodeBytes: data => Buffer.from(data.buffer).toString('base64'),
      settleMemory: async () => ({ gpuValidationErrors: [], device: { liveBytes: 100 + live[index].size,
        peakBytes: 102, maxBytes: 1420000000, lost: false, categories: { weights: 100 } },
        liveAttempts: [...live[index]] }) });
    return { evaluate: async (fn, arg) => {
      context.args = structuredClone(arg);
      return structuredClone(await runInContext(`(${fn.toString()})(args)`, context));
    } };
  });
  return { events, runs, live, run: () => runConcurrentPartitionMemory({ pages, pageA: pages[0], pageB: pages[1],
    request: { model: { id: 'synthetic', identity: 'synthetic' }, messages: [] },
    generation: { maxTokens: 8 }, planId: 'synthetic', runs, persist: async () => {} }) };
}

describe('long concurrent physical-controller assertions (synthetic GPU only)', () => {
  it('keeps two actual attempt states live, cancels one, verifies survivor and fresh retry', async () => {
    const test = fixture();
    await test.run();
    expect(test.runs).toHaveLength(4);
    const [, cancelled, survivor, retry] = test.runs;
    expect(survivor.duringOverlap.every(item => item.liveAttempts.length === 2)).toBe(true);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.text).toBe('01');
    expect(survivor.text).toBe('0123');
    expect(retry.text).toBe('0123');
    expect(survivor.afterOtherCancellation.every(item => item.liveAttempts.length === 1)).toBe(true);
    expect(test.live.every(item => item.size === 0)).toBe(true);
  });
  it('rejects a changed surviving answer and still closes every attempt', async () => {
    const test = fixture({ corruptSurvivor: true });
    await expect(test.run()).rejects.toThrow('Surviving answer changed');
    expect(test.live.every(item => item.size === 0)).toBe(true);
  });
  it('does not accept completed work as successful cancellation', async () => {
    const test = fixture({ ignoreAbort: true });
    await expect(test.run()).rejects.toThrow('Submitted cancellation must reject');
    expect(test.live.every(item => item.size === 0)).toBe(true);
  });
  it('records failed ownership and closes the unrelated survivor despite a failed close', async () => {
    const test = fixture({ rejectClose: true });
    await expect(test.run()).rejects.toThrow('Attempt close failed');
    expect(test.events.some(([kind, id]) => kind === 'close' && id.endsWith('survivor'))).toBe(true);
    expect(test.runs[1].closed).toBe(false);
    expect(test.live[0].size).toBe(1);
    expect(test.live[1].size).toBe(0);
  });
});
