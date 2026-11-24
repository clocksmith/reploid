// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { claimsMemory, classifySoloFailure, failedBufferBytesFrom } from '../../scripts/stage1/solo-failure.js';
import { classifySoloControl } from '../../scripts/stage1/receipt-check.js';

const requiredBytes = 16941875200, budgetBytes = 25769803776;
const midLoad = (extra = {}) => Object.assign(Error('This computer\'s GPU ran out of memory while loading the model'),
  { code: 'GPU_OUT_OF_MEMORY', detail: 'Allocation failed', stage1During: 'whole-model-load', liveBytesAtFailure: 12884901888, ...extra });
const settings = { modelId: 'm', modelIdentity: 'i', quantization: 'q4k', messagesDigest: 'd', maxOutputTokens: 4, decoding: { temperature: 0 } };
const expectations = { workload: settings, minimumSoloLoadBytes: requiredBytes, totalWeight: { bytes: 16994352128 } };
const verdict = failure => classifySoloControl({ outcome: 'failed', settings, failure, claimedFailure: claimsMemory(failure) ? 'memory' : null }, expectations);
const map = (error, context = {}) => classifySoloFailure(error, { requiredBytes, budgetBytes, ...context });

describe('a real device refusal', () => {
  class GPUOutOfMemoryError extends Error {}
  it.each([
    ['the host error from the GPU watcher', midLoad()],
    ['a GPUOutOfMemoryError', Object.assign(new GPUOutOfMemoryError('Out of memory'), { stage1During: 'whole-model-load', stage1Memory: { peakBytes: 12884901888 } })],
    ['VK_ERROR_OUT_OF_DEVICE_MEMORY', Object.assign(Error('vkAllocateMemory failed: VK_ERROR_OUT_OF_DEVICE_MEMORY'), { stage1During: 'whole-model-load', stage1Memory: { peakBytes: 12884901888 } })],
    ['a refusal wrapped as a cause', Object.assign(Error('Load failed', { cause: Error('VK_ERROR_OUT_OF_DEVICE_MEMORY') }), { stage1During: 'whole-model-load', stage1Memory: { peakBytes: 12884901888 } })],
    ['a refusal inside an aggregate', Object.assign(new AggregateError([Error('VK_ERROR_OUT_OF_DEVICE_MEMORY')], 'Native opening and cleanup failed'), { stage1During: 'whole-model-load', stage1Memory: { peakBytes: 12884901888 } })]
  ])('maps %s to device-out-of-memory', (_name, error) => {
    const failure = map(error);
    expect(failure).toMatchObject({ kind: 'out-of-memory', evidence: 'device-out-of-memory', operatorCapped: false, requiredBytes });
    expect(claimsMemory(failure)).toBe(true);
    expect(verdict(failure)).toEqual({ outcome: 'memory', why: 'device-out-of-memory' });
  });

  it('reports the whole model as required when the device refused partway through', () => {
    const failure = map(midLoad({ detail: 'Failed to allocate buffer of size 536870912 bytes', liveBytesAtFailure: 12348030976 }));
    expect(failure).toMatchObject({ requiredBytes, failedBufferBytes: 536870912, allocatedBeforeFailureBytes: 11811160064 });
    expect(verdict(failure).outcome).toBe('memory');
  });

  it('keeps a small refusal with nothing loaded inconclusive', () => {
    const failure = map(midLoad({ detail: 'size 4096 bytes', liveBytesAtFailure: 4096 }));
    expect(failure.requiredBytes).toBe(requiredBytes);
    expect(claimsMemory(failure)).toBe(false);
    expect(verdict(failure)).toEqual({ outcome: 'inconclusive', why: 'small-allocation' });
  });

  it('keeps a refusal during generation inconclusive', () => {
    const failure = map(midLoad({ stage1During: 'generation' }));
    expect(claimsMemory(failure)).toBe(false);
    expect(verdict(failure)).toEqual({ outcome: 'inconclusive', why: 'outside-model-load' });
  });

  it('keeps a refusal with no memory record inconclusive', () => {
    const failure = map(midLoad({ liveBytesAtFailure: null }));
    expect(claimsMemory(failure)).toBe(false);
    expect(verdict(failure)).toEqual({ outcome: 'inconclusive', why: 'load-progress-unknown' });
  });

  it('uses the bytes latched at the first refusal, not the later peak of a load that kept allocating', () => {
    const detail = 'Out of memory\n - While calling [Device].CreateBuffer([BufferDescriptor "weights"] size: 536870912)';
    const failure = map(midLoad({ detail, liveBytesAtFailure: 1610612736, stage1Memory: { peakBytes: requiredBytes } }));
    expect(failure).toMatchObject({ failedBufferBytes: 536870912, allocatedBeforeFailureBytes: 1073741824 });
    // A watcher refusal without a latched figure does not fall back to the peak.
    const unknown = map(midLoad({ liveBytesAtFailure: undefined, stage1Memory: { peakBytes: requiredBytes } }));
    expect(unknown.allocatedBeforeFailureBytes).toBeNull();
    expect(verdict(unknown)).toEqual({ outcome: 'inconclusive', why: 'load-progress-unknown' });
  });

  it('keeps a watcher refusal on the device when Dawn names host memory inside it', () => {
    const failure = map(midLoad({ detail: 'vkAllocateMemory failed with VK_ERROR_OUT_OF_HOST_MEMORY' }));
    expect(failure).toMatchObject({ kind: 'out-of-memory', evidence: 'device-out-of-memory' });
    expect(verdict(failure)).toEqual({ outcome: 'memory', why: 'device-out-of-memory' });
    // Without the watcher's code, host-memory text stays host memory even next to a device error name.
    expect(map(Object.assign(Error('GPUOutOfMemoryError: VK_ERROR_OUT_OF_HOST_MEMORY'), { stage1During: 'whole-model-load' })).kind)
      .toBe('host-out-of-memory');
  });

  it('counts a budget below the model as an operator cap', () => {
    const failure = map(midLoad(), { budgetBytes: 6442450944 });
    expect(failure.operatorCapped).toBe(true);
    expect(verdict(failure)).toEqual({ outcome: 'inconclusive', why: 'operator-budget' });
  });
});

describe('stays inconclusive', () => {
  it.each([
    ['a guard, even with a device error', midLoad(), { stop: 'guard' }, 'guard'],
    ['a timeout, even with a device error', midLoad(), { stop: 'timeout' }, 'timeout'],
    ['a memory-pressure stop', midLoad(), { stop: 'memory-pressure' }, 'guard'],
    ['missing weights', Object.assign(Error('no shard'), { code: 'MISSING_WEIGHTS' }), {}, 'missing-weights'],
    ['a missing file', Object.assign(Error('ENOENT'), { code: 'ENOENT' }), {}, 'missing-weights'],
    ['a wrong manifest', Object.assign(Error('other model'), { code: 'WRONG_WEIGHTS' }), {}, 'wrong-weights'],
    ['the Doppler budget', Object.assign(Error('GPU memory budget exceeded: weights requires 4 bytes'), { code: 'RESOURCE_EXHAUSTED' }), {}, 'no-device-memory-evidence'],
    ['host memory', Error('VK_ERROR_OUT_OF_HOST_MEMORY'), {}, 'host-out-of-memory'],
    ['any other load error', Error('shader compilation failed'), {}, 'load-failed']
  ])('for %s', (_name, error, context, why) => {
    const failure = map(error, context);
    expect(claimsMemory(failure)).toBe(false);
    expect(verdict(failure)).toEqual({ outcome: 'inconclusive', why });
  });

  it('survives a cyclic cause', () => {
    const error = Error('loop'); error.cause = error;
    expect(map(error).kind).toBe('load-failed');
  });
});

it('reads a refused size only when the message states one', () => {
  expect(failedBufferBytesFrom('Failed to allocate buffer of size 1024 bytes')).toBe(1024);
  expect(failedBufferBytesFrom('requested 2048 bytes')).toBe(2048);
  expect(failedBufferBytesFrom('Out of memory')).toBeNull();
});
