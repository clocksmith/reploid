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
