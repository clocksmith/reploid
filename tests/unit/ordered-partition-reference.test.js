import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { validateOrderedCaptureConfiguration, executeOrderedPhysicalStage, captureOrderedReferenceRuns } from '../fixtures/ordered-partition-reference.js';

function environment(count = 3) {
  const expected = { schema: 'doppler.physical-resident-producer-input/v2', deliveryMode: 'direct-fixture',
    deadlines: { stageMs: 300000, cleanupMs: 10000, observationMs: 2000 }, maxGpuBufferBytes: 1420000000,
    logicalStageCount: count, physicalHostCount: count, manifestHash: 'manifest', requesterId: 'requester', placementGeneration: 1,
    partitionPlan: { modelId: 'model', stageCount: count }, orderedContract: { partitionPlanHash: 'plan' },
    placements: Array.from({ length: count }, (_, index) => ({ partitionIndex: index, executorId: `executor-${index}`, platform: `host-${index}`,
      participantId: `peer-${index}`, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })) };
  const config = { schema: 'reploid.ordered-qualification-capture/v1', outputPath: '/tmp/synthetic.json',
    gpuReservation: { approved: true, id: 'test-no-gpu', observedAt: 'synthetic', sharedMachineNotes: 'synthetic only' },
    executors: expected.placements.map(p => ({ kind: 'browser-cdp', executorId: p.executorId, endpoint: `http://${p.executorId}`, modelSource: 'http://model/' })) };
  return { expected, config };
}
function fixture(count = 3, failure = null) {
  const { expected } = environment(count), closed = [], calls = [];
  const encode = data => Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength).toString('base64');
  const pages = Array.from({ length: count }, (_, index) => ({ index, scope: {
    crypto: webcrypto, atob, Uint8Array, Float32Array, AbortController, encodeBytes: encode,
    resident: {
      tokenize: async () => ({ tokenIds: [1, 2] }),
      closeAttempt: async ({ identity }) => { closed.push([index, identity.attemptId]); },
      executeStage: async request => {
        calls.push({ index, request }); if (index === failure) throw Error('injected stage failure');
        expect(request.partitionIndex).toBe(index); expect(request.inputTokenIds).toEqual([1, 2]);
        if (index === 0) expect(request.activation).toBeUndefined();
        else expect(request.activation.tensorData).toBeInstanceOf(Float32Array);
        const common = { identity: request.identity, partitionIndex: index, step: request.step, tokenPosition: request.tokenPosition, continuation: `continuation-${index}` };
        return index + 1 < count ? { ...common, activationTensor: { shape: [1, 2, 4], dtype: 'f32', precision: 'two-f32', components: 2,
          elementStrideBytes: 8, step: 0, seqOffset: 0, data: new ArrayBuffer(64) } }
          : { ...common, logits: new Float32Array([0.125, -0.5]), tokenId: 3, delta: 'answer', done: true, stopReason: 'eos-token' };
      },
    },
  } }));
  const evaluate = async (page, label, callback, argument) => vm.runInNewContext(`(${callback.toString()})`, page.scope)(argument);
  const f64 = Buffer.alloc(16); f64.writeDoubleLE(0.125); f64.writeDoubleLE(-0.5, 8);
  const reference = { generation: { maxTokens: 1 }, prompts: [[{ role: 'user', content: 'synthetic' }]],
    expected: [{ text: 'answer', steps: [{ tokenId: 3, stopReason: 'eos-token', logitsDtype: 'f64', logits: f64.toString('base64') }] }] };
  const evidence = { runs: [], descriptors: pages.map(() => ({ openingObservation: { initialExecutionIdentity: {} } })) };
  return { pages, expected, reference, evidence, evaluate, runtime: { hashPartitionGeneration: () => 'generation', computeCanonicalSha256: () => 'execution' },
    persist: async () => {}, requestContracts: [{ inputIds: [1, 2], prefixLengths: [2] }], calls, closed };
}
describe('ordered physical fixture CPU controls (numerical execution injected)', () => {
  it.each([2, 3, 4, 7])('records %i ordered stages and closes each actual attempt', async count => {
    const f = fixture(count); await captureOrderedReferenceRuns(f);
    expect(f.evidence.runs[0].completed).toBe(true); expect(f.calls).toHaveLength(count); expect(f.closed).toHaveLength(count);
    const rows = f.evidence.runs[0].numerical[0].stageExecutions;
    expect(rows[0].activationInput).toBeNull(); expect(rows.at(-1).activationOutput).toBeNull();
    for (let i = 1; i < count; i++) expect(rows[i].activationInput).toEqual(rows[i - 1].activationOutput);
    expect(rows.slice(0, -1).every(r => r.logitsHash === null)).toBe(true);
  });
  it('retains first stage failure and closes all prepared attempts', async () => {
    const f = fixture(3, 1); await expect(captureOrderedReferenceRuns(f)).rejects.toThrow('injected stage failure');
    expect(f.calls).toHaveLength(2); expect(f.closed).toHaveLength(3);
    expect(f.evidence.runs[0].completed).toBe(false); expect(f.evidence.runs[0].error.message).toMatch(/injected/);
  });
  it('rejects changed prompt before executing kernels', async () => {
    const f = fixture(); f.requestContracts[0].inputIds = [9, 2];
    await expect(captureOrderedReferenceRuns(f)).rejects.toThrow('Tokenized'); expect(f.calls).toHaveLength(0); expect(f.closed).toHaveLength(3);
  });
  it('requires explicit reservation, independent contexts and unchanged bounds', () => {
    const { config, expected } = environment(); expect(() => validateOrderedCaptureConfiguration(config, expected)).not.toThrow();
    for (const change of [c => c.gpuReservation.approved = false, c => c.executors.pop(), c => c.executors[1].endpoint = c.executors[0].endpoint,
      c => c.executors[1].executorId = 'other', c => c.executors[0].kind = 'fallback']) {
      const bad = structuredClone(config); change(bad); expect(() => validateOrderedCaptureConfiguration(bad, expected)).toThrow();
    }
    expect(() => validateOrderedCaptureConfiguration(config, { ...expected, physicalHostCount: 2 })).toThrow();
    expect(() => validateOrderedCaptureConfiguration(config, { ...expected, maxGpuBufferBytes: 2000000000 })).toThrow();
  });
  it('serializable stage callback preserves actual returned identity', async () => {
    const f = fixture(); const identity = { marker: 'actual' };
    const output = await f.evaluate(f.pages[0], 'test', executeOrderedPhysicalStage, {
      parameters: { identity, partitionIndex: 0, step: 0, tokenPosition: 0, inputTokenIds: [1, 2] }, activationInput: null, continuation: null });
    expect(output.identity).toEqual(identity); expect(output.activationOutput.byteLength).toBe(64); expect(output.activationOutput.storageHash).toMatch(/^sha256:/);
  });
});
