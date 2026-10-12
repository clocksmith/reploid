// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createContext, runInContext } from 'node:vm';
import { runConcurrentPartitionMemory, createConcurrentOperationObserver } from '../fixtures/concurrent-partition-memory.js';

function fixture({ corruptSurvivor = false, rejectClose = false, ignoreAbort = false, deviceEvents = [], observationErrors = [], stallInput = false, stallClose = false } = {}) {
  const events = [], runs = [], live = [new Set(), new Set()];
  const pages = [0, 1].map(index => {
    let context;
    const resident = {
      tokenize: async () => ({ tokenIds: Array(1588).fill(7) }),
      executeGroup0: async ({ identity, step, signal }) => {
        live[index].add(identity.attemptId);
        events.push(['input', identity.attemptId, step]);
        if (stallInput) return new Promise(() => {});
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
        if (stallClose && index === 0) return new Promise(() => {});
        if (rejectClose && identity.attemptId.endsWith('cancelled') && index === 0) throw Error('cleanup failed');
        live[index].delete(identity.attemptId);
      }
    };
    context = createContext({ resident, AbortController, DOMException, Uint8Array, Float32Array, atob,
      abortOnSubmit: null, observePrefill: false,
      rejectOversizedAllocation: async () => ({ code: 'RESOURCE_EXHAUSTED', synthetic: true }),
      encodeBytes: data => Buffer.from(data.buffer).toString('base64'),
      settleMemory: async () => ({ gpuValidationErrors: [], deviceEvents, observationErrors, device: { liveBytes: 100 + live[index].size,
        peakBytes: 102, maxBytes: 1420000000, categories: { weights: 100 } },
        liveAttempts: [...live[index]] }) });
    return { evaluate: async (fn, arg) => {
      context.args = structuredClone(arg);
      return structuredClone(await runInContext(`(${fn.toString()})(args)`, context));
    } };
  });
  return { events, runs, live, run: () => runConcurrentPartitionMemory({ pages, pageA: pages[0], pageB: pages[1],
    request: { model: { id: 'synthetic', identity: 'synthetic' }, messages: [] },
    generation: { maxTokens: 8 }, planId: 'synthetic', runs, persist: async () => {},
    operation: createConcurrentOperationObserver({ evidence: {}, persist: async () => {},
      deadlines: { operationMs: 30, cleanupMs: 10, observationMs: 5, sampleMs: 2 } }) }) };
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
  it.each([
    [{ deviceEvents: [{ type: 'device-lost' }] }, 'Executor device event'],
    [{ observationErrors: [{ operation: 'device' }] }, 'Executor memory observation'],
    [{ deviceEvents: null }, 'Executor device event']
  ])('rejects missing or failed device observations %j', async (options, message) => {
    await expect(fixture(options).run()).rejects.toThrow(message);
  });
  it('keeps the primary execution timeout while attempting both independent closes', async () => {
    const test = fixture({ stallInput: true, stallClose: true });
    await expect(test.run()).rejects.toThrow('step-0:group-0 exceeded 30ms');
    expect(test.runs[0].closed).toBe(false);
    expect(test.runs[0].closeResults.map(result => result.settled)).toEqual([false, true]);
    expect(test.live[0].size).toBe(1);
    expect(test.events.some(([kind, , index]) => kind === 'close' && index === 1)).toBe(true);
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

describe('bounded physical observations (synthetic unresolved providers)', () => {
  it('retains the last submitted operation and returns unknown ownership on a stalled execution', async () => {
    const { createConcurrentOperationObserver } = await import('../fixtures/concurrent-partition-memory.js');
    const evidence = {}, saved = [];
    const operation = createConcurrentOperationObserver({ evidence,
      persist: async () => saved.push(structuredClone(evidence)),
      deadlines: { operationMs: 25, cleanupMs: 10, observationMs: 5, sampleMs: 2 } });
    const page = { evaluate: fn => fn.toString().includes('memorySnapshot')
      ? Promise.resolve({ submissions: [{ label: 'last-submitted' }],
        pendingPipelinePreparation: [{ operation: 'createComputePipelineAsync' }] })
      : new Promise(() => {}) };
    await expect(operation(page, 'group-0', () => resident.executeGroup0())).rejects.toThrow('ownership unknown');
    expect(evidence.operations[0].status).toBe('timed-out');
    expect(evidence.operations[0].samples.at(-1).snapshot.submissions[0].label).toBe('last-submitted');
    expect(saved.some(item => item.operations[0].status === 'pending')).toBe(true);
    expect(evidence.operations[0].ownership).toBe('unknown');
  });
  it('bounds an unresolved queue barrier and an unresponsive observation independently', async () => {
    const { createConcurrentOperationObserver } = await import('../fixtures/concurrent-partition-memory.js');
    const evidence = {};
    const operation = createConcurrentOperationObserver({ evidence, persist: async () => {},
      deadlines: { operationMs: 50, cleanupMs: 15, observationMs: 3, sampleMs: 2 } });
    await expect(operation({ evaluate: () => new Promise(() => {}) }, 'queue-close',
      () => settleMemory(), undefined, true)).rejects.toThrow('exceeded 15ms');
    expect(evidence.operations[0].samples.some(item => item.error?.includes('observation'))).toBe(true);
    expect(evidence.operations[0].status).toBe('timed-out');
  });
  it('preserves original rejection and does not observe or duplicate process close', async () => {
    const { createConcurrentOperationObserver } = await import('../fixtures/concurrent-partition-memory.js');
    const evidence = {};
    const operation = createConcurrentOperationObserver({ evidence, persist: async () => {} });
    const primary = Error('original queue rejection');
    let calls = 0;
    await expect(operation({ evaluate: () => { calls++; return Promise.reject(primary); } },
      'browser-close', () => {}, undefined, true, false)).rejects.toBe(primary);
    expect(calls).toBe(1);
    expect(evidence.operations[0].status).toBe('rejected');
    expect(evidence.operations[0].samples).toEqual([]);
  });
  it('retains sampling persistence failure without masking the primary timeout', async () => {
    const evidence = {};
    let writes = 0;
    const operation = createConcurrentOperationObserver({ evidence,
      persist: async () => { if (++writes > 1) throw Error('disk unavailable'); },
      deadlines: { operationMs: 20, cleanupMs: 10, observationMs: 3, sampleMs: 2 } });
    const page = { evaluate: fn => fn.toString().includes('memorySnapshot')
      ? Promise.resolve({ pendingPipelinePreparation: ['pending'] }) : new Promise(() => {}) };
    await expect(operation(page, 'execution', () => resident.executeGroup0())).rejects.toThrow('exceeded 20ms');
    expect(evidence.operations[0].status).toBe('timed-out');
    expect(evidence.operations[0].persistenceFailures.some(item => item.phase === 'sample')).toBe(true);
    expect(evidence.operations[0].persistenceFailures.at(-1)).toEqual({ phase: 'final', message: 'disk unavailable' });
  });
  it('rejects successful execution when its pending evidence could not be persisted', async () => {
    const evidence = {};
    let writes = 0;
    const operation = createConcurrentOperationObserver({ evidence,
      persist: async () => { if (++writes === 2) throw Error('sample write rejected'); } });
    const page = { evaluate: fn => fn.toString().includes('memorySnapshot')
      ? Promise.resolve({}) : new Promise(resolve => setTimeout(() => resolve('done'), 5)) };
    await expect(operation(page, 'execution', () => 'done')).rejects.toThrow('Observation persistence failed');
    expect(evidence.operations[0].status).toBe('observation-failed');
  });
  it('does not accept a timeout expansion or invalid bound', async () => {
    const { createConcurrentOperationObserver, CONCURRENT_DEADLINES } = await import('../fixtures/concurrent-partition-memory.js');
    expect(() => createConcurrentOperationObserver({ evidence: {}, persist: async () => {},
      deadlines: { ...CONCURRENT_DEADLINES, operationMs: 300001 } })).toThrow('cannot expand');
    expect(() => createConcurrentOperationObserver({ evidence: {}, persist: async () => {},
      deadlines: { ...CONCURRENT_DEADLINES, cleanupMs: 0 } })).toThrow('Invalid');
  });
});
