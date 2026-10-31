import { describe, it, expect, vi } from 'vitest';
import { createChatScheduler } from '../../packages/reploid/src/chat/scheduler.js';
import policy from '../../packages/reploid/src/chat/policy.json' with { type: 'json' };

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const model = { identity: 'sha256:' + 'a'.repeat(64), id: 'model', name: 'Model' };
const request = (participantId, attemptId, adapters = []) => ({ participantId, attemptId, threadId: attemptId,
  model: { ...model, adapters }, maxOutputTokens: 100, messages: [], permissions: {}, members: [] });

describe('conversation device scheduler', () => {
  it('shares a single resident model and resets adapter and conversation state around each request', async () => {
    let adapter = [], context = [], opens = 0; const observed = [];
    const session = { reset: vi.fn(() => { context = []; }), setAdapters: vi.fn(next => { adapter = next; }), close: vi.fn(),
      run: vi.fn(async value => { expect(context).toEqual([]); context.push(value.threadId);
        expect(adapter).toEqual(value.model.adapters); return value.threadId; }) };
    const scheduler = createChatScheduler({ open: async () => { opens++; return session; }, observe: value => observed.push(value) });
    const signal = new AbortController().signal;
    await Promise.all([scheduler.schedule(request('alice', 'one', [{ identity: 'adapter-a' }]), { signal }),
      scheduler.schedule(request('bob', 'two'), { signal })]);
    expect(opens).toBe(1); expect(session.reset).toHaveBeenCalledTimes(4); expect(adapter).toEqual([]);
    expect(new Set(observed.map(value => value.id)).size).toBe(2);
    expect(observed.every(value => value.status === 'completed')).toBe(true);
    await scheduler.close(); expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('round-robins participant queues, and thread IDs cannot bypass participant allowances', async () => {
    const gate = deferred(), order = [];
    const scheduler = createChatScheduler({ policy: { ...policy, maxRequestsPerParticipant: 4 }, observe() {},
      open: async () => ({ reset() {}, setAdapters() {}, close() {}, async run(value) {
        order.push(value.attemptId); if (value.attemptId === 'a1') await gate.promise;
      } }) });
    const signal = new AbortController().signal;
    const first = scheduler.schedule(request('alice', 'a1'), { signal });
    await vi.waitFor(() => expect(order).toEqual(['a1']));
    const pending = ['a2', 'a3', 'a4'].map(name => scheduler.schedule(request('alice', name), { signal }));
    expect(() => scheduler.schedule(request('alice', 'a5'), { signal })).toThrow('allowance');
    pending.push(scheduler.schedule(request('bob', 'b1'), { signal }));
    gate.resolve(); await Promise.all([first, ...pending]);
    expect(order).toEqual(['a1', 'a2', 'b1', 'a3', 'a4']); await scheduler.close();
  });

  it('retains the slot after active cancellation, removes queued cancellation, and rejects replay', async () => {
    const gate = deferred(), order = [];
    const scheduler = createChatScheduler({ observe() {}, open: async () => ({ reset() {}, setAdapters() {}, close() {},
      async run(value) { order.push(value.attemptId); if (value.attemptId === 'first') await gate.promise; } }) });
    const a = new AbortController(), b = new AbortController(), c = new AbortController();
    const first = scheduler.schedule(request('alice', 'first'), { signal: a.signal });
    const firstRejected = expect(first).rejects.toThrow('Stopped');
    await vi.waitFor(() => expect(order).toHaveLength(1));
    const second = scheduler.schedule(request('bob', 'second'), { signal: b.signal });
    const secondRejected = expect(second).rejects.toThrow('Queued stop');
    const third = scheduler.schedule(request('carol', 'third'), { signal: c.signal });
    a.abort(new Error('Stopped')); b.abort(new Error('Queued stop'));
    await secondRejected; expect(order).toEqual(['first']); gate.resolve();
    await firstRejected; await third; expect(order).toEqual(['first', 'third']);
    expect(() => scheduler.schedule(request('carol', 'third'), { signal: c.signal })).toThrow('already scheduled');
    await scheduler.close();
  });

  it('evicts a session that fails cleanup before admitting another conversation', async () => {
    let opens = 0, resets = 0; const close = vi.fn();
    const scheduler = createChatScheduler({ observe() {}, open: async () => {
      const number = ++opens;
      return { setAdapters() {}, run: async () => 'ok', close,
        reset() { if (number === 1 && ++resets === 2) throw new Error('Dirty state'); } };
    } });
    const signal = new AbortController().signal;
    await expect(scheduler.schedule(request('alice', 'one'), { signal })).rejects.toThrow('Dirty state');
    await scheduler.schedule(request('bob', 'two'), { signal });
    expect(opens).toBe(2); expect(close).toHaveBeenCalledTimes(1); await scheduler.close();
  });

  it('applies participant token budgets across their different conversations', async () => {
    let time = 1;
    const scheduler = createChatScheduler({ policy: { ...policy, participantTokenBudget: 100 }, now: () => time,
      observe() {}, open: async () => ({ reset() {}, setAdapters() {}, close() {}, run: async () => 'ok' }) });
    const signal = new AbortController().signal;
    await scheduler.schedule(request('alice', 'first'), { signal });
    expect(() => scheduler.schedule(request('alice', 'second'), { signal })).toThrow('budget exhausted');
    await scheduler.schedule(request('bob', 'third'), { signal });
    time += policy.budgetWindowMs; await scheduler.schedule(request('alice', 'second'), { signal });
    await scheduler.close();
  });
});

it('prepares once, queues requests behind preparation, and closes the prepared session', async () => {
  const gate = deferred(), close = vi.fn(), run = vi.fn(async () => 'answer');
  const open = vi.fn(async () => { await gate.promise; return { run, reset() {}, setAdapters() {}, close }; });
  const scheduler = createChatScheduler({ open, observe() {} });
  const preparing = scheduler.prepare(model);
  expect(scheduler.prepare(model)).toBe(preparing);
  const pending = scheduler.schedule(request('alice', 'prepared'), { signal: new AbortController().signal });
  expect(run).not.toHaveBeenCalled();
  gate.resolve(); await preparing;
  expect(await pending).toBe('answer');
  expect(open).toHaveBeenCalledTimes(1);
  await scheduler.close(); expect(close).toHaveBeenCalledTimes(1);
});
it('closing during preparation settles cleanup and never publishes the resident', async () => {
  const gate = deferred(), close = vi.fn();
  const open = vi.fn(async () => { await gate.promise; return { run() {}, reset() {}, setAdapters() {}, close }; });
  const scheduler = createChatScheduler({ open, observe() {} });
  const preparing = scheduler.prepare(model);
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  const rejected = expect(preparing).rejects.toThrow('Scheduler closed');
  const closing = scheduler.close(); gate.resolve();
  await rejected; await closing;
  expect(close).toHaveBeenCalledTimes(1);
  expect(scheduler.getState().residentIdentity).toBe(null);
});

it('retains failed cleanup, rejects queued replacements, and retries the same owner on close', async () => {
  const gate = deferred();
  let resets = 0;
  const close = vi.fn().mockRejectedValueOnce(new Error('GPU cleanup failed')).mockResolvedValue(undefined);
  const open = vi.fn(async () => ({
    reset() { if (++resets === 2) throw new Error('Dirty state'); },
    setAdapters() {}, close,
    async run() { await gate.promise; return 'answer'; }
  }));
  const observed = [];
  const scheduler = createChatScheduler({ open, observe: value => observed.push(value) });
  const signal = new AbortController().signal;
  const first = scheduler.schedule(request('alice', 'first'), { signal });
  const firstRejected = expect(first).rejects.toBeInstanceOf(AggregateError);
  await vi.waitFor(() => expect(resets).toBe(1));
  const queued = scheduler.schedule(request('bob', 'second'), { signal });
  const queuedRejected = expect(queued).rejects.toThrow('cleanup remains unsettled');
  gate.resolve();
  await firstRejected;
  await queuedRejected;
  expect(scheduler.getState()).toMatchObject({ residentIdentity: model.identity,
    cleanup: { status: 'failed', modelIdentity: model.identity, error: 'GPU cleanup failed' } });
  expect(() => scheduler.schedule(request('carol', 'third'), { signal })).toThrow('cleanup remains unsettled');
  expect(() => scheduler.prepare(model)).toThrow('cleanup remains unsettled');
  expect(open).toHaveBeenCalledTimes(1);
  expect(observed.at(-1).status).toBe('failed');
  await scheduler.close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(scheduler.getState()).toMatchObject({ residentIdentity: null, cleanup: null, closed: true });
});

it('shares concurrent close, retains failure state, then retries rather than forgetting the resident', async () => {
  const cleanupGate = deferred();
  const close = vi.fn().mockImplementationOnce(async () => { await cleanupGate.promise; throw new Error('Release failed'); })
    .mockResolvedValue(undefined);
  const scheduler = createChatScheduler({ observe() {}, open: async () => ({ run() {}, reset() {}, setAdapters() {}, close }) });
  await scheduler.prepare(model);
  const first = scheduler.close();
  expect(scheduler.close()).toBe(first);
  const rejected = expect(first).rejects.toThrow('Release failed');
  await vi.waitFor(() => expect(scheduler.getState().cleanup?.status).toBe('pending'));
  expect(scheduler.getState().residentIdentity).toBe(model.identity);
  cleanupGate.resolve();
  await rejected;
  expect(scheduler.getState().cleanup.status).toBe('failed');
  await scheduler.close();
  await scheduler.close();
  expect(close).toHaveBeenCalledTimes(2);
});

it('retains an owner whose preparation was cancelled and whose cleanup still fails', async () => {
  const opening = deferred();
  const close = vi.fn().mockRejectedValue(new Error('Preparation cleanup failed'));
  const open = vi.fn(async () => { await opening.promise; return { run() {}, reset() {}, setAdapters() {}, close }; });
  const scheduler = createChatScheduler({ open, observe() {} });
  const preparation = scheduler.prepare(model);
  const preparationRejected = expect(preparation).rejects.toThrow('Preparation and cleanup failed');
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  const stopping = scheduler.close();
  const stopRejected = expect(stopping).rejects.toThrow('Preparation cleanup failed');
  opening.resolve();
  await preparationRejected;
  await stopRejected;
  expect(scheduler.getState()).toMatchObject({ residentIdentity: model.identity, cleanup: { status: 'failed' } });
  close.mockResolvedValue(undefined);
  await scheduler.close();
  expect(scheduler.getState().cleanup).toBe(null);
});

it('shares preparation while the previous model retires and snapshots the replacement', async () => {
  const retired = deferred();
  const close = vi.fn().mockImplementationOnce(() => retired.promise).mockResolvedValue(undefined);
  const open = vi.fn(async () => ({ run() {}, reset() {}, setAdapters() {}, close }));
  const scheduler = createChatScheduler({ open, observe() {} });
  await scheduler.prepare(model);
  const next = { id: 'next', identity: 'sha256:' + 'b'.repeat(64) };
  const preparation = scheduler.prepare(next);
  expect(scheduler.prepare(next)).toBe(preparation);
  next.identity = 'sha256:' + 'c'.repeat(64);
  retired.resolve();
  await preparation;
  expect(open.mock.calls[1][0].identity).toBe('sha256:' + 'b'.repeat(64));
  await scheduler.close();
});
