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
    expect(summary.stepSummary.metrics['computationA.gpuKernelsMs']).toBeUndefined();
    expect(summary.stopReason).toBe('max-tokens');
    expect(summary.settlement).toEqual(execution.settlement);
    expect(summary.transport.lastFailure).toBeUndefined();
    expect(execution.steps).toHaveLength(count);
  });
});
