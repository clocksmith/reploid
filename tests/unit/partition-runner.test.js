import { describe, it, expect, vi } from 'vitest';
import * as runtime from 'doppler-gpu/partitions';
import { createLayerPartitionRunner, verifySplitParity } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';

// These ports deliberately simulate computation. This suite proves orchestration,
// not Doppler execution, WebRTC, partial residency or physical distribution.
function fixture() {
  const plan = runtime.createLayerPartitionPlan({
    modelId: 'test-model', numLayers: 4, hiddenSize: 8, vocabSize: 128, splitLayer: 2
  });
  const calls = [];
  const deviceA = {
    id: 'a', closeAttempt: vi.fn(async () => {}),
    executeGroup0: vi.fn(async ({ tokenIds, step, tokenPosition, identity }) => {
      calls.push([identity.threadId, 'A', step, [...tokenIds]]);
      return { continuation: { position: tokenPosition + tokenIds.length },
        activationTensor: { shape: [1, tokenIds.length, 8], dtype: 'f32',
          data: new Float32Array(tokenIds.length * 8).fill(tokenIds[0]), seqOffset: tokenPosition, step } };
    })
  };
  const deviceB = {
    id: 'b', closeAttempt: vi.fn(async () => {}),
    executeGroup1: vi.fn(async ({ identity, step, tokenPosition }) => {
      calls.push([identity.threadId, 'B', step]);
      return { identity, step, tokenPosition, tokenId: 10 + step,
        done: step === 2, delta: step === 2 ? '' : String(step), stopReason: 'eos',
        continuation: { position: tokenPosition }, logits: new Float32Array([0.1, 0.9]) };
    })
  };
  const transport = { transferActivation: vi.fn(async frame => structuredClone(frame)) };
  const authorize = vi.fn(async () => true);
  const limits = { maxTokens: 8, maxPromptTokens: 32, maxActivationBytes: 1024, maxOutputCharacters: 128, maxAttempts: 16,
    maxConcurrentAttempts: 2 };
  const identity = { modelIdentity: 'sha256:' + 'a'.repeat(64), planId: 'plan', threadId: 'thread', attemptId: 'attempt' };
  const grants = { executionA: { id: 'exec-a' }, executionB: { id: 'exec-b' },
    activation: { id: 'activation' }, tokenContext: { id: 'tokens' }, output: { id: 'output' } };
  const options = { runtime, plan, deviceA, deviceB, transport, authorize, limits };
  return { ...options, calls, request: { tokenIds: [1, 2, 3], identity, grants, generation: { maxTokens: 8 }, maxTokens: 8 },
    runner: createLayerPartitionRunner(options) };
}

describe('partition autoregressive orchestration (injected execution)', () => {
  it('requires explicit runtime, authorizer and limits', () => {
    const f = fixture();
    expect(() => createLayerPartitionRunner({ ...f, runtime: undefined })).toThrow('Doppler partition runtime');
    expect(() => createLayerPartitionRunner({ ...f, authorize: undefined })).toThrow('verifying host');
    expect(() => createLayerPartitionRunner({ ...f, limits: undefined })).toThrow('allocation limits');
  });

  it('routes prompt and every selected token through both partitions until Doppler stops', async () => {
    const f = fixture(), deltas = [];
    const result = await f.runner.execute({ ...f.request, onDelta: delta => deltas.push(delta) });
    expect(f.calls).toEqual([
      ['thread', 'A', 0, [1, 2, 3]], ['thread', 'B', 0],
      ['thread', 'A', 1, [10]], ['thread', 'B', 1],
      ['thread', 'A', 2, [11]], ['thread', 'B', 2]
    ]);
    expect(result.content).toBe('01');
    expect(deltas).toEqual(['0', '1']);
    expect(result.tokenIds).toEqual([10, 11, 12]);
    expect(result.stopReason).toBe('eos');
    expect(result.execution.steps.map(s => s.tokenPosition)).toEqual([0, 3, 4]);
    expect(result.execution.activationBytes).toBe(160);
    expect(f.deviceA.executeGroup0.mock.calls[1][0].continuation).toEqual({ position: 3 });
    expect(f.deviceA.closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.deviceB.closeAttempt).toHaveBeenCalledTimes(1);
  });

  it('does not accept the old B-generates-independently contract', async () => {
    const f = fixture();
    f.deviceB.executeGroup1.mockResolvedValue({ content: 'fake generation', tokenIds: [10, 11] });
    await expect(f.runner.execute(f.request)).rejects.toThrow('response identity mismatch');
  });

  it('requires all grants and rejects a named but unverified grant before computing', async () => {
    const f = fixture();
    await expect(f.runner.execute({ ...f.request, grants: {} })).rejects.toThrow('grants are required');
    f.authorize.mockResolvedValue(false);
    await expect(f.runner.execute(f.request)).rejects.toThrow('authorization declined');
    expect(f.deviceA.executeGroup0).not.toHaveBeenCalled();
    expect(f.transport.transferActivation).not.toHaveBeenCalled();
  });

  it('rechecks revocation after A finishes and before intermediate disclosure', async () => {
    const f = fixture();
    let revoked = false;
    const impl = f.deviceA.executeGroup0.getMockImplementation();
    f.deviceA.executeGroup0.mockImplementation(async args => {
      const result = await impl(args); revoked = true; return result;
    });
    f.authorize.mockImplementation(async () => !revoked);
    await expect(f.runner.execute(f.request)).rejects.toThrow('authorization declined');
    expect(f.transport.transferActivation).not.toHaveBeenCalled();
    expect(f.deviceB.executeGroup1).not.toHaveBeenCalled();
  });

  it.each(['metadata', 'bytes', 'shape', 'step'])('rejects changed %s before B executes', async kind => {
    const f = fixture();
    f.transport.transferActivation.mockImplementation(async frame => {
      const received = structuredClone(frame);
      if (kind === 'metadata') received.metadata.threadId = 'other-thread';
      if (kind === 'bytes') new Uint8Array(received.buffer)[0] ^= 1;
      if (kind === 'shape') received.shape[1] = 1;
      if (kind === 'step') received.step = 10;
      return received;
    });
    await expect(f.runner.execute(f.request)).rejects.toThrow(/Received activation/);
    expect(f.deviceB.executeGroup1).not.toHaveBeenCalled();
  });

  it('cannot retry an already used attempt and append another generation', async () => {
    const f = fixture();
    await f.runner.execute(f.request);
    await expect(f.runner.execute(f.request)).rejects.toThrow('Attempt already used');
    expect(f.deviceA.executeGroup0).toHaveBeenCalledTimes(3);
  });

  it('rejects unfinalized output at the token budget instead of losing pending decoder text', async () => {
    const f = fixture();
    await expect(f.runner.execute({ ...f.request, generation: { maxTokens: 1 }, maxTokens: 1 })).rejects.toThrow('finalize decoding');
    expect(f.deviceA.executeGroup0).toHaveBeenCalledTimes(1);
    expect(f.deviceB.executeGroup1).toHaveBeenCalledTimes(1);
    expect(f.deviceA.closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.deviceB.closeAttempt).toHaveBeenCalledTimes(1);
  });

  it('carries the request limit through both stages so Doppler flushes its final text', async () => {
    const f = fixture(), deltas = [];
    f.deviceB.executeGroup1.mockImplementation(async ({ identity, step, tokenPosition, maxTokens }) => ({
      identity, step, tokenPosition, tokenId: 10 + step,
      done: step + 1 === maxTokens, delta: step + 1 === maxTokens ? 'final buffered text' : '',
      stopReason: 'max-tokens', continuation: { position: tokenPosition }
    }));
    const result = await f.runner.execute({ ...f.request, generation: { maxTokens: 2 }, maxTokens: 2, onDelta: delta => deltas.push(delta) });
    expect(result.content).toBe('final buffered text');
    expect(result.stopReason).toBe('max-tokens');
    expect(deltas).toEqual(['final buffered text']);
    for (const device of [f.deviceA.executeGroup0, f.deviceB.executeGroup1]) {
      expect(device.mock.calls.map(([request]) => request.maxTokens)).toEqual([2, 2]);
    }
    expect(f.transport.transferActivation.mock.calls.map(([frame]) => frame.metadata.maxTokens)).toEqual([2, 2]);
  });

  it('rejects activation allocations before transport', async () => {
    const f = fixture();
    const runner = createLayerPartitionRunner({ ...f, limits: { ...f.limits, maxActivationBytes: 16 } });
    await expect(runner.execute(f.request)).rejects.toThrow('transfer allocation');
    expect(f.transport.transferActivation).not.toHaveBeenCalled();
  });

  it('interleaves token leases and cancelling one thread leaves the other intact', async () => {
    const f = fixture(), abort = new AbortController();
    const first = f.runner.execute({ ...f.request, signal: abort.signal, onDelta: () => abort.abort() });
    const second = f.runner.execute({ ...f.request,
      identity: { ...f.request.identity, attemptId: 'other-attempt', threadId: 'other-thread' } });
    await expect(first).rejects.toThrow();
    expect((await second).content).toBe('01');
    expect(f.calls.filter(call => call[1] === 'A').map(call => call[0])).toEqual([
      'thread', 'other-thread', 'other-thread', 'other-thread'
    ]);
    expect(f.deviceA.closeAttempt).toHaveBeenCalledTimes(2);
    expect(f.runner.getState().attempts.map(attempt => attempt.phase)).toEqual(['cancelled', 'completed']);
    expect(f.runner.getState().attempts.every(attempt => attempt.cleanupSettledAt !== null)).toBe(true);
  });

  it('fairly interleaves two complete generations instead of monopolizing resident weights', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.runner.execute(f.request),
      f.runner.execute({ ...f.request,
        identity: { ...f.request.identity, attemptId: 'two', threadId: 'two' } })
    ]);
    expect([first.content, second.content]).toEqual(['01', '01']);
    expect(f.calls.filter(call => call[1] === 'A').map(call => call[0]))
      .toEqual(['thread', 'two', 'thread', 'two', 'thread', 'two']);
  });

  it('does not trust a result object mutated while disclosure authorization is pending', async () => {
    const f = fixture();
    let returned;
    const impl = f.deviceB.executeGroup1.getMockImplementation();
    f.deviceB.executeGroup1.mockImplementation(async args => { returned = await impl(args); return returned; });
    f.authorize.mockImplementation(async ({ action }) => {
      if (returned && action === 'mesh.transfer_partition_output') {
        returned.delta = 'poison'; returned.tokenId = 99;
      }
      return true;
    });
    const result = await f.runner.execute(f.request);
    expect(result.content).toBe('01');
    expect(result.tokenIds).toEqual([10, 11, 12]);
  });

  it('close waits for an in-flight device to settle, suppresses late output and denies new attempts', async () => {
    const f = fixture();
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const impl = f.deviceA.executeGroup0.getMockImplementation();
    f.deviceA.executeGroup0.mockImplementation(async args => { entered(); await waiting; return impl(args); });
    const attempt = f.runner.execute(f.request);
    const rejected = expect(attempt).rejects.toThrow('closed');
    await started;
    let closed = false;
    const closing = f.runner.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await rejected;
    await closing;
    expect(f.transport.transferActivation).not.toHaveBeenCalled();
    expect(f.deviceA.closeAttempt).toHaveBeenCalledTimes(1);
    await expect(f.runner.execute(f.request)).rejects.toThrow('closed');
  });

  it('settles both devices if one cleanup throws', async () => {
    const f = fixture();
    f.deviceA.closeAttempt.mockRejectedValue(new Error('failed cleanup'));
    await expect(f.runner.execute(f.request)).rejects.toThrow('settlement failed');
    expect(f.deviceB.closeAttempt).toHaveBeenCalledTimes(1);
    expect(f.runner.getState().attempts[0]).toMatchObject({ phase: 'cleanup-failed', cleanupSettledAt: null,
      cleanup: expect.arrayContaining([{ participantId: 'a', status: 'failed', settledAt: null, error: 'failed cleanup' }]) });
  });

  it('snapshots caller grants, identities and prompt before asynchronous authorization', async () => {
    const f = fixture();
    const promise = f.runner.execute(f.request);
    f.request.identity.threadId = 'changed';
    f.request.grants.activation.id = 'changed';
    f.request.tokenIds[0] = 100;
    const result = await promise;
    expect(result.execution.threadId).toBe('thread');
    expect(f.calls[0][3]).toEqual([1, 2, 3]);
    expect(f.authorize.mock.calls.find(([call]) => call.action === 'mesh.transfer_intermediate_activation')[0].grant.id)
      .toBe('activation');
  });

  it('numerical parity also requires identical selected token sequences', async () => {
    const result = { logits: new Float32Array([0.1, 0.9]), tokenIds: [1] };
    const splitRunner = { execute: vi.fn(async () => result) };
    const referenceRunner = { execute: vi.fn(async () => ({ ...result, tokenIds: [2] })) };
    const parity = await verifySplitParity({ runtime, splitRunner, referenceRunner, tolerance: 1e-4 });
    expect(parity.matches).toBe(false);
    expect(parity.tokensMatch).toBe(false);
  });

  it('does not accept empty or non-finite parity outputs', async () => {
    const runner = { execute: vi.fn(async () => ({ logits: [NaN], tokenIds: [1] })) };
    await expect(verifySplitParity({ runtime, splitRunner: runner, referenceRunner: runner, tolerance: 1e-4 }))
      .rejects.toThrow('Finite non-empty logits');
  });
});
