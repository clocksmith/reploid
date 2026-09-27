import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createPartitionStepReceiver } from '../../packages/reploid/src/mesh/partitions/partition-step-receiver.js';

function fixture() {
  const executeStep = vi.fn(async request => ({ token: request.payload + 1 }));
  const authorize = vi.fn(async () => true);
  const settleAttempt = vi.fn(async () => {});
  const fingerprint = async request => 'sha256:' + createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const receiver = createPartitionStepReceiver({ executeStep, authorize, fingerprint, settleAttempt,
    limits: { maxAttempts: 8, maxSteps: 8 } });
  const request = { identity: { modelId: 'model', modelIdentity: 'hash', planId: 'plan', threadId: 'thread',
    attemptId: 'attempt', participantA: 'a', participantB: 'b' },
  step: 0, tokenPosition: 0, inputTokenCount: 3, payload: 5, grant: { id: 'grant' } };
  return { receiver, request, executeStep, authorize, settleAttempt };
}

describe('partition receiver ordering (injected computation)', () => {
  it('coalesces simultaneous duplicate deliveries and returns independently copied output', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.receiver.receive(f.request), f.receiver.receive(f.request)]);
    expect(a).toEqual({ token: 6 }); expect(b).toEqual(a);
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    a.token = 0;
    expect(await f.receiver.receive(f.request)).toEqual({ token: 6 });
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    await f.receiver.close();
  });

  it('rejects changed bytes, identity collisions and old delivery without advancing state', async () => {
    const f = fixture();
    await f.receiver.receive(f.request);
    await expect(f.receiver.receive({ ...f.request, payload: 10 })).rejects.toThrow('payload collision');
    await expect(f.receiver.receive({ ...f.request, identity: { ...f.request.identity, threadId: 'other' } }))
      .rejects.toThrow('identity collision');
    await f.receiver.receive({ ...f.request, step: 1, tokenPosition: 3, inputTokenCount: 1 });
    await expect(f.receiver.receive(f.request)).rejects.toThrow('Out-of-order');
    expect(f.executeStep).toHaveBeenCalledTimes(2);
    await f.receiver.close();
  });

  it('requires prefill before decode and exact token positions', async () => {
    const f = fixture();
    await expect(f.receiver.receive({ ...f.request, step: 1 })).rejects.toThrow('start with prefill');
    await f.receiver.receive(f.request);
    await expect(f.receiver.receive({ ...f.request, step: 1, tokenPosition: 2, inputTokenCount: 1 }))
      .rejects.toThrow('Out-of-order');
    await expect(f.receiver.receive({ ...f.request, step: 1, tokenPosition: 3, inputTokenCount: 2 }))
      .rejects.toThrow('one token');
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    await f.receiver.close();
  });

  it('rechecks authorization for cached output', async () => {
    const f = fixture();
    await f.receiver.receive(f.request);
    f.authorize.mockResolvedValue(false);
    await expect(f.receiver.receive(f.request)).rejects.toThrow('authorization declined');
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    await f.receiver.close();
  });

  it('retires failed state instead of retrying potentially mutated KV', async () => {
    const f = fixture();
    f.executeStep.mockRejectedValue(new Error('device lost'));
    await expect(f.receiver.receive(f.request)).rejects.toThrow('device lost');
    await expect(f.receiver.receive(f.request)).rejects.toThrow('retired');
    expect(f.executeStep).toHaveBeenCalledTimes(1);
    await f.receiver.close();
    expect(f.settleAttempt).toHaveBeenCalledTimes(1);
  });

  it('waits for late GPU settlement after close and does not disclose its output', async () => {
    const f = fixture();
    let release, enter;
    const entered = new Promise(resolve => { enter = resolve; });
    f.executeStep.mockImplementation(() => { enter(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.receiver.receive(f.request);
    const rejection = expect(pending).rejects.toThrow('closed');
    await entered;
    let closed = false;
    const closing = f.receiver.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release({ token: 6 });
    await rejection; await closing;
    expect(f.settleAttempt).toHaveBeenCalledTimes(1);
  });

  it('closing one attempt leaves an unrelated thread live', async () => {
    const f = fixture();
    await f.receiver.receive(f.request);
    await f.receiver.closeAttempt(f.request.identity);
    const other = { ...f.request, identity: { ...f.request.identity, threadId: 'two', attemptId: 'two' } };
    expect(await f.receiver.receive(other)).toEqual({ token: 6 });
    await expect(f.receiver.receive(f.request)).rejects.toThrow('retired');
    await f.receiver.close();
    expect(f.settleAttempt).toHaveBeenCalledTimes(2);
  });
});
