import { describe, it, expect } from 'vitest';
import { summarizePartitionExecution } from '../../packages/reploid/src/mesh/partitions/partition-summary.js';
import policy from '../../self/config/partition-policy.json' with { type: 'json' };

describe('bounded partition completion receipt', () => {
  it('fits a maximum-length generation without raising channel limits or losing aggregate measurements', () => {
    const execution = { schema: 'reploid.mesh.partition-execution/v2', attemptId: 'attempt',
      participantA: 'a', participantB: 'b', activationBytes: 1024 * 4096, stopReason: 'max-tokens',
      settlement: { phase: 'completed', cleanupSettledAt: 42 },
      transport: { sentFrameBytes: 50000, lastFailure: { message: 'private local failure' } },
      steps: Array.from({ length: policy.limits.maxTokens }, (_, step) => ({ step,
        tokenPosition: step, inputTokenCount: 1, generationDigest: 'sha256:' + 'a'.repeat(64),
        leaseWaitMs: 3, outputDeliveryMs: 5,
        localStepMs: step + 1, serializationMs: 0.2, remoteStepMs: 12.4,
        elapsedMs: 14.6, computationA: { inputUploadMs: 0, encodeMs: 3, gpuKernelsMs: null },
        computationB: { encodeMs: 2, gpuKernelsMs: 1 }, transportTiming: { responseWaitMs: 10 } })) };
    expect(JSON.stringify(execution).length).toBeGreaterThan(policy.inputChannel.maxControlBytes);
    const summary = summarizePartitionExecution(execution);
    const frame = { schema: 'reploid.partition-channel/v1', type: 'result', id: 1,
      result: { content: '字'.repeat(policy.inputLimits.maxOutputCharacters), execution: summary } };
    expect(new TextEncoder().encode(JSON.stringify(frame)).byteLength).toBeLessThan(policy.inputChannel.maxControlBytes);
    expect(summary.stepSummary.count).toBe(policy.limits.maxTokens);
    const count = policy.limits.maxTokens;
    expect(summary.stepSummary.metrics.localStepMs).toEqual({ count, total: count * (count + 1) / 2, min: 1, max: count });
    expect(summary.stepSummary.metrics.leaseWaitMs).toEqual({ count, total: count * 3, min: 3, max: 3 });
    expect(summary.stepSummary.metrics.outputDeliveryMs).toEqual({ count, total: count * 5, min: 5, max: 5 });
    expect(summary.stepSummary.metrics['computationA.gpuKernelsMs']).toBeUndefined();
    expect(summary.stopReason).toBe('max-tokens');
    expect(summary.settlement).toEqual(execution.settlement);
    expect(summary.transport.lastFailure).toBeUndefined();
    expect(execution.steps).toHaveLength(count);
  });
});

it('bounds N-stage receipts while retaining complete and missing timing coverage honestly', () => {
  const count = policy.limits.maxTokens;
  const execution = { schema: 'reploid.mesh.partition-execution/v3', identity: { route: 'unchanged' },
    steps: Array.from({ length: count }, () => ({ stages: Array.from({ length: 7 }, (_, partitionIndex) => ({ partitionIndex, elapsedMs: partitionIndex === 6 ? undefined : 10 })) })) };
  const summary = summarizePartitionExecution(execution);
  expect(summary.identity).toEqual(execution.identity);
  expect(summary.stepSummary.count).toBe(count);
  expect(summary.stepSummary.stages).toHaveLength(7);
  expect(summary.stepSummary.stages[0]).toEqual({ partitionIndex: 0, steps: count, stepMs: { count, total: count * 10 } });
  expect(summary.stepSummary.stages[6].stepMs).toEqual({ count: 0, total: 0 });
  // Phase timing is fixed-size per stage and independent of answer length.
  expect(new TextEncoder().encode(JSON.stringify(summary)).byteLength).toBeLessThan(8192);
  const frame = { schema: 'reploid.partition-channel/v1', type: 'result', id: 1,
    result: { content: '字'.repeat(policy.inputLimits.maxOutputCharacters), execution: summary } };
  expect(new TextEncoder().encode(JSON.stringify(frame)).byteLength).toBeLessThan(policy.inputChannel.maxControlBytes);
  expect(execution.steps).toHaveLength(count);
});

it('separates prompt prefill from decode per stage and keeps contributor runtime metrics', () => {
  const stage = (partitionIndex, elapsedMs, metrics) => ({ partitionIndex, elapsedMs, metrics });
  const execution = { schema: 'reploid.mesh.partition-execution/v3', identity: { route: 'unchanged' },
    steps: [
      { step: 0, inputTokenCount: 37, stages: [stage(0, 900, { executionMs: 850, submitWaitMs: 700 }),
        stage(1, 4000, { executionMs: 3900, logitsMs: 2500, gpuKernelsMs: null })] },
      { step: 1, inputTokenCount: 1, stages: [stage(0, 400, { executionMs: 380 }), stage(1, 2000, { executionMs: 1900, logitsMs: 1200 })] },
      { step: 2, inputTokenCount: 1, stages: [stage(0, 600, { executionMs: 560 }), stage(1, 3000, { executionMs: 2900, logitsMs: 1800 })] }
    ] };
  const { phases } = summarizePartitionExecution(execution).stepSummary;
  expect(phases.prompt.inputTokens).toBe(37);
  expect(phases.prompt.stages[1]).toMatchObject({ partitionIndex: 1, elapsedMs: 4000 });
  expect(phases.prompt.stages[1].runtime).toMatchObject({ executionMs: 3900, logitsMs: 2500, gpuKernelsMs: null, samplingMs: null });
  expect(phases.decode.steps).toBe(2);
  expect(phases.decode.stages[0].elapsedMs).toEqual({ count: 2, total: 1000, min: 400, max: 600 });
  expect(phases.decode.stages[1].runtime.logitsMs).toEqual({ count: 2, total: 3000, min: 1200, max: 1800 });
  // Unreported metrics stay visibly unmeasured instead of becoming zeros.
  expect(phases.decode.stages[1].runtime.gpuKernelsMs).toEqual({ count: 0, total: 0, min: null, max: null });
});

it('ignores contributor timing values that are not finite non-negative numbers', () => {
  const execution = { schema: 'reploid.mesh.partition-execution/v3', identity: { route: 'unchanged' },
    steps: [{ step: 0, inputTokenCount: 2.5, stages: [{ partitionIndex: 0, elapsedMs: 5,
      metrics: { executionMs: -1, encodeMs: 'fast', submitWaitMs: Infinity, logitsMs: 3 } }] }] };
  const { phases } = summarizePartitionExecution(execution).stepSummary;
  expect(phases.prompt.inputTokens).toBeNull();
  expect(phases.prompt.stages[0].runtime).toMatchObject({ executionMs: null, encodeMs: null, submitWaitMs: null, logitsMs: 3 });
  expect(phases.decode).toEqual({ steps: 0, stages: [] });
});
