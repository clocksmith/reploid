import { describe, it, expect, vi } from 'vitest';
import { createWorkSession, DEFAULT_WORK_MODELS } from '../../self/host/work-session.js';
import { createWorkNetworkProvider, withWorkDevice } from '../../self/providers/work-network-provider.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const store = () => {
  let value = null, tail = Promise.resolve();
  return { storage: { getItem: () => value, setItem: (_, next) => { value = next; } },
    locks: { request: (_, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } } };
};

describe('independent work threads', () => {
  it('runs two network threads without local GPU, isolates approval, selection and stop, and retains both records', async () => {
    const controls = [], pending = [], ports = store();
    const service = { isSupported: () => false, open: vi.fn(), close: vi.fn() };
    const swarm = { connect: vi.fn(), hasProvider: () => true,
      async generate(messages, control) {
        const step = deferred(); pending.push(step); controls.push(control);
        const accepted = await control.approve({ id: crypto.randomUUID(), input: messages,
          providerId: 'peer-' + controls.length, modelId: control.modelId, expiresAt: Date.now() + 30000 });
        control.signal.throwIfAborted();
        if (!accepted) throw new Error('Disclosure declined');
        const text = await step.promise;
        control.signal.throwIfAborted();
        return { content: text, model: control.modelId, provider: 'doppler', execution: 'peer-whole-request' };
      } };
    const app = createWorkSession({ ...ports, service, swarm });
    const first = app.start({ goal: 'First objective' }), firstId = app.getState().selectedId;
    const second = app.start({ goal: 'Second objective' }), secondId = app.getState().selectedId;
    await vi.waitFor(() => expect(app.getState().approvalThreadIds).toHaveLength(2));
    expect(app.getState().runningIds).toEqual([firstId, secondId]);
    const secondApproval = app.getState().pendingApproval.id;
    app.select(firstId);
    expect(app.getState().pendingApproval.id).not.toBe(secondApproval);
    app.approvePeer(app.getState().pendingApproval.id, true);
    app.select(null);
    expect(app.getState()).toMatchObject({ busy: false, anyBusy: true, pendingApproval: null });
    app.cancel(firstId);
    expect(controls[0].signal.aborted).toBe(true);
    expect(controls[1].signal.aborted).toBe(false);
    pending[0].resolve('late');
    expect((await first).status).toBe('paused');
    expect(app.getState().runningIds).toEqual([secondId]);
    app.select(secondId); app.approvePeer(secondApproval, true);
    pending[1].resolve('TOOL: RecordOutcome\ntext: Second result');
    await vi.waitFor(() => expect(controls).toHaveLength(3));
    app.approvePeer(app.getState().pendingApproval.id, true);
    pending[2].resolve('IDLE: Done');
    expect(await second).toMatchObject({ status: 'review', output: 'Second result' });
    expect(service.open).not.toHaveBeenCalled();
    await app.close();
    const restored = createWorkSession({ ...ports, service });
    expect(restored.getState().records.map(row => [row.goal, row.status])).toEqual([
      ['First objective', 'paused'], ['Second objective', 'review']
    ]);
    await restored.close();
  });

  it('keeps GPU ownership until settlement and removes cancelled queued work', async () => {
    const service = {}, first = new AbortController(), second = new AbortController(), third = new AbortController();
    const gate = deferred(), started = deferred(), called = vi.fn();
    const a = withWorkDevice(service, first.signal, async () => { started.resolve(); await gate.promise; });
    await started.promise;
    const b = withWorkDevice(service, second.signal, called);
    const rejected = expect(b).rejects.toThrow('Stopped queued thread');
    const c = withWorkDevice(service, third.signal, called);
    first.abort(); second.abort(new Error('Stopped queued thread'));
    await rejected;
    expect(called).not.toHaveBeenCalled();
    gate.resolve(); await Promise.all([a, c]);
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('never falls back to another execution after peer refusal or failure', async () => {
    const service = { open: vi.fn(), isSupported: () => true };
    const swarm = { connect: vi.fn(), hasProvider: () => true, generate: vi.fn().mockRejectedValue(new Error('Denied')) };
    const provider = createWorkNetworkProvider({ model: DEFAULT_WORK_MODELS[0], service, swarm,
      signal: new AbortController().signal, controls: {} });
    await expect(provider.generate([])).rejects.toThrow('Denied');
    expect(service.open).not.toHaveBeenCalled();
    expect(DEFAULT_WORK_MODELS.every(model => model.provider === 'doppler')).toBe(true);
  });

  it('does not load on the requester when discovery fails', async () => {
    const service = { isSupported: () => true, close: vi.fn(),
      open: async () => ({ async *stream() { yield { type: 'text-delta', text: 'device answer' }; } }) };
    const swarm = { connect: async () => { throw new Error('Signaling unavailable'); }, generate: vi.fn(), hasProvider: () => false };
    const provider = createWorkNetworkProvider({ model: DEFAULT_WORK_MODELS[0], service, swarm, scope: 'test',
      signal: new AbortController().signal, generation: {}, maxOutcomeCharacters: 100 });
    await expect(provider.generate([], () => {})).rejects.toThrow('Signaling unavailable');
    expect(swarm.generate).not.toHaveBeenCalled();
    expect(service.close).not.toHaveBeenCalled();
  });
});
