// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runNativeCompleteLifecycle } from '../fixtures/native-complete-lifecycle.js';

function fixture() {
  let successful = 0, reuses = 0;
  const state = { sourceBytes: 0, activeBytes: 16, rejected: 0, reuse: true };
  const generate = vi.fn(async (prompt, options) => {
    if (state.reuse) reuses++;
    for (const tokenId of [5, 6]) options.onEvent({ type: 'token', tokenId });
    successful++;
    return { inputTokenIds: options.inputTokenIds, generatedTokenIds: [5, 6], outputText: 'result',
      policy: { id: 'demo/always-on', modifiesExecution: false }, performanceRepresentative: true, wallTimingMs: 1,
      generationEvidence: { stats: { reusedPrefixTokens: 0, stopReason: 'max-tokens' } } };
  });
  const ports = { model: { resetGenerationState: vi.fn(), inspect: { generate } },
    workload: { prompt: 'prompt', promptIds: [1, 2], maxNew: 2, stopIds: [9] },
    generation: { maxTokens: 2 }, timeoutMs: 1000, gpuCapBytes: 1000,
    settle: vi.fn(async () => {}),
    memory: () => ({ device: { maxBytes: 1000, peakBytes: 900, rejected: state.rejected },
      pool: { reuses, resources: { active: { bytes: state.activeBytes }, deferredCleanup: { bytes: 0 } } } }),
    sourceReceipts: async () => [{ generic: { activeReadBytes: state.sourceBytes }, gather: { activeReadBytes: 0 } }] };
  return { ports, state, successful: () => successful };
}

it('cancels a loaded model after its first token and verifies identical recovery with settled ownership', async () => {
  const f = fixture(), report = await runNativeCompleteLifecycle(f.ports);
  expect(report.observedTokens).toBe(1);
  expect(report.first.sampledIds).toEqual(report.recovered.sampledIds);
  expect(f.successful()).toBe(3);
  expect(f.ports.model.resetGenerationState).toHaveBeenCalledTimes(4);
  expect(report.phases.map(phase => phase.name)).toContain('active-cancellation-settled');
  expect(f.ports.settle).toHaveBeenCalledTimes(5);
});

it('rejects a changed answer after cancellation instead of qualifying recovery', async () => {
  const f = fixture(), original = f.ports.model.inspect.generate;
  f.ports.model.inspect.generate = async (...args) => {
    const value = await original(...args);
    if (f.successful() === 3) value.outputText = 'changed';
    return value;
  };
  await expect(runNativeCompleteLifecycle(f.ports)).rejects.toThrow('Output changed after active cancellation');
});

it('rejects unsettled source reads or active-buffer growth after cancellation', async () => {
  for (const mutate of [state => { state.sourceBytes = 1; }, state => { state.activeBytes = 32; }]) {
    const f = fixture(), original = f.ports.model.inspect.generate;
    f.ports.model.inspect.generate = async (...args) => {
      try { return await original(...args); }
      catch (error) { mutate(f.state); throw error; }
    };
    await expect(runNativeCompleteLifecycle(f.ports)).rejects.toThrow(/did not settle|additional active buffers/u);
  }
});

it('does not confuse an unrelated runtime error with successful cancellation', async () => {
  const f = fixture(), original = f.ports.model.inspect.generate;
  f.ports.model.inspect.generate = async (...args) => {
    try { return await original(...args); }
    catch { throw new Error('device lost'); }
  };
  await expect(runNativeCompleteLifecycle(f.ports)).rejects.toThrow();
});

it('requires measured buffer reuse and rejects GPU budget failures', async () => {
  const noReuse = fixture(); noReuse.state.reuse = false;
  await expect(runNativeCompleteLifecycle(noReuse.ports)).rejects.toThrow('No buffer reuse observed');
  const rejected = fixture(); rejected.state.rejected = 1;
  await expect(runNativeCompleteLifecycle(rejected.ports)).rejects.toThrow('allocation cap');
});

it('does not qualify cancellation using an already terminated one-token answer', async () => {
  const f = fixture(); f.ports.workload.maxNew = f.ports.generation.maxTokens = 1;
  await expect(runNativeCompleteLifecycle(f.ports)).rejects.toThrow('multi-token lifecycle workload');
  expect(f.ports.model.inspect.generate).not.toHaveBeenCalled();
});

it('bounds repeated lifecycle witnesses while retaining exact list hashes and all settlement observations', async () => {
  const f = fixture();
  const pieces = Array.from({ length: 40000 }, (_, i) => 'sha256:' + i.toString(16).padStart(64, '0'));
  const ranges = pieces.map((identity, i) => ({ path: 'source.bin', offset: i * 1048576, size: 1048576, identity }));
  const receipt = { indexIdentity: 'sha256:index', manifestIdentity: 'sha256:model', activeReadBytes: 0,
    verifiedBytes: pieces.length * 1048576, pieces, ranges };
  f.ports.sourceReceipts = async () => [{ sourceIndex: 0, generic: receipt, gather: receipt }];
  expect(Buffer.byteLength(JSON.stringify(receipt)) * 5).toBeGreaterThan(16 * 1024 ** 2);
  const report = await runNativeCompleteLifecycle(f.ports);
  expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(65536);
  expect(report.phases).toHaveLength(5);
  for (const phase of report.phases) {
    expect(phase.sources[0].generic).toMatchObject({ activeReadBytes: 0, verifiedBytes: receipt.verifiedBytes,
      indexIdentity: receipt.indexIdentity, manifestIdentity: receipt.manifestIdentity,
      rangeWitness: { count: ranges.length,
        sha256: createHash('sha256').update(JSON.stringify(ranges)).digest('hex'), encoding: 'ordered-json-array/v1' } });
    expect(phase.sources[0].generic.pieces).toBeUndefined();
    expect(phase.sources[0].gather.activeReadBytes).toBe(0);
  }
  expect(receipt.pieces).toBe(pieces); expect(receipt.ranges).toBe(ranges);
  expect(report.recovered.sampledIds).toEqual(report.first.sampledIds);
});
