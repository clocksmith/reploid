import { expect, it, vi } from 'vitest';
import { createWorkResidentProvider } from '../../self/providers/work-resident-provider.js';
import { withWorkDevice } from '../../self/providers/work-device.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const signal = () => new AbortController().signal;
const fixture = (overrides = {}) => {
  const model = { id: 'fixture', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64) };
  const session = { loaded: true, modelId: model.id, manifestHash: 'a'.repeat(64),
    resetGenerationState: vi.fn(), async *stream(messages) { yield { type: 'text-delta', text: messages[0].content }; }, ...overrides };
  const service = { open: vi.fn(async () => session), close: vi.fn(async () => {}) };
  const owner = createWorkResidentProvider({ service, model, generation: {}, maxOutcomeCharacters: 100 });
  return { owner, service, session };
};

it('coalesces preparation and retirement while preserving a resident between requests', async () => {
  const f = fixture(); await Promise.all([f.owner.prepare(), f.owner.prepare()]);
  const results = await Promise.all(['A', 'B'].map(content => f.owner.generate([{ role: 'user', content }], () => {}, { signal: signal() })));
  expect(results.map(result => result.content)).toEqual(['A', 'B']);
  expect(f.service.open).toHaveBeenCalledOnce(); expect(f.service.close).not.toHaveBeenCalled();
  expect(f.session.resetGenerationState).toHaveBeenCalledTimes(5);
  expect(f.owner.close()).toBe(f.owner.close()); await f.owner.close();
  expect(f.service.close).toHaveBeenCalledOnce(); expect(f.owner.getState().ready).toBe(false);
  await expect(f.owner.prepare()).rejects.toThrow('stopped');
});

it('retires a failed resident and prevents queued work from borrowing the retired handle', async () => {
  const gate = deferred(), entered = deferred(), calls = [];
  const f = fixture({ async *stream(messages) { calls.push(messages); entered.resolve(); await gate.promise; throw new Error('GPU lost'); } });
  await f.owner.prepare();
  const first = f.owner.generate([{ content: 'A' }], () => {}, { signal: signal() });
  const failed = expect(first).rejects.toThrow('GPU lost'); await entered.promise;
  const second = f.owner.generate([{ content: 'B' }], () => {}, { signal: signal() });
  const retired = expect(second).rejects.toThrow('retired'); gate.resolve(); await failed; await retired;
  expect(calls).toHaveLength(1); expect(f.owner.getState()).toMatchObject({ ready: false, phase: 'failed' });
  await f.owner.close(); expect(f.service.close).toHaveBeenCalledOnce();
});

it('close keeps ownership through running execution and a failed cleanup stays observable', async () => {
  const gate = deferred(), entered = deferred();
  const f = fixture({ async *stream() { entered.resolve(); await gate.promise; yield { type: 'text-delta', text: 'late' }; } });
  await f.owner.prepare();
  const request = f.owner.generate([{ content: 'A' }], () => {}, { signal: signal() });
  const cancelled = expect(request).rejects.toThrow('stopped'); await entered.promise;
  f.service.close.mockRejectedValue(new Error('cleanup failed'));
  const close = f.owner.close(), failure = expect(close).rejects.toThrow('cleanup failed');
  expect(f.service.close).not.toHaveBeenCalled(); expect(f.owner.getState().ready).toBe(false);
  gate.resolve(); await cancelled; await failure;
  expect(f.owner.getState()).toMatchObject({ phase: 'failed', error: 'cleanup failed', ready: false });
  expect(f.service.close).toHaveBeenCalledOnce();
});

it('removes a waiter whose progress observer throws without wedging the device', async () => {
  const service = {}, gate = deferred(), started = deferred(), called = vi.fn();
  const first = withWorkDevice(service, signal(), async () => { started.resolve(); await gate.promise; });
  await started.promise;
  await expect(withWorkDevice(service, signal(), called, () => { throw new Error('observer'); })).rejects.toThrow('observer');
  const next = withWorkDevice(service, signal(), called); gate.resolve(); await first; await next;
  expect(called).toHaveBeenCalledOnce();
});

it('installs single-flight promises before notifying reentrant lifecycle observers', async () => {
  const f = fixture(); let owner, reenteredPrepare, reenteredClose;
  owner = createWorkResidentProvider({ service: f.service,
    model: { id: 'fixture', provider: 'doppler' }, generation: {}, maxOutcomeCharacters: 100,
    onChange(state) {
      if (state.phase === 'loading') reenteredPrepare = owner.prepare();
      if (state.phase === 'stopping') reenteredClose = owner.close();
    } });
  const preparing = owner.prepare(); expect(reenteredPrepare).toBe(preparing); await preparing;
  const closing = owner.close(); expect(reenteredClose).toBe(closing); await closing;
  expect(f.service.open).toHaveBeenCalledOnce(); expect(f.service.close).toHaveBeenCalledOnce();
});

it('snapshots queued conversation input before the caller can mutate it', async () => {
  const gate = deferred(), started = deferred();
  const f = fixture(); await f.owner.prepare();
  const held = withWorkDevice(f.service, signal(), async () => { started.resolve(); await gate.promise; });
  await started.promise;
  const messages = [{ role: 'user', content: 'original' }];
  const request = f.owner.generate(messages, () => {}, { signal: signal() });
  messages[0].content = 'mutated'; gate.resolve(); await held;
  expect((await request).content).toBe('original'); await f.owner.close();
});
