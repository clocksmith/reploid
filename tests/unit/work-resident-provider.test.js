import { expect, it, vi } from 'vitest';
import { createWorkResidentProvider } from '../../apps/poolday/providers/work-resident-provider.js';
import { withWorkDevice } from '../../apps/poolday/providers/work-device.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const signal = () => new AbortController().signal;
const fixture = (overrides = {}, options = {}) => {
  const model = { id: 'fixture', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64) };
  const session = { loaded: true, modelId: model.id, manifestHash: 'a'.repeat(64),
    advanced: { createIncrementalDecoder: () => ({ push: token => token, finish: () => '' }) },
    async generate(messages, options) {
      let outputText = '';
      for await (const event of this.stream(messages)) { if (event.type === 'text-delta') { outputText += event.text; options.onToken?.(event.text); } }
      return { outputText, evidence: { runtimeProfile: { model: { modelId: this.modelId,
        manifestHash: this.manifestHash, activeAdapterDigest: this.adapterDigest?.() || null } } } };
    },
    resetGenerationState: vi.fn(), async *stream(messages) { yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: messages[0].content }; yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: messages[0].content }; }, ...overrides };
  const service = { open: vi.fn(async () => session), close: vi.fn(async () => {}) };
  const owner = createWorkResidentProvider({ service, model, generation: {}, maxOutcomeCharacters: 100, ...options });
  return { owner, service, session };
};

it('passes a bounded isolated context to each conversation and releases every context on close', async () => {
  const seen = [], contexts = [];
  const f = fixture({ supports: capability => capability === 'generationContext',
    createGenerationContext: vi.fn(() => {
      const context = { close: vi.fn(), getStats: () => ({ reusedTokens: 0 }) }; contexts.push(context); return context;
    }),
    async *stream(messages, options) {
      seen.push(options.generationContext);
      yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: messages[0].content };
      yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: messages[0].content };
    },
  });
  await f.owner.prepare();
  for (const contextOwner of ['alice', 'bob', 'alice']) {
    await f.owner.generate([{ content: 'hello' }], () => {}, { signal: signal(), contextOwner, contextId: 'same-thread-id' });
  }
  expect(seen[0]).toBe(seen[2]); expect(seen[0]).not.toBe(seen[1]);
  await f.owner.close();
  expect(contexts.every(context => context.close.mock.calls.length === 1)).toBe(true);
});

it('reports the loaded session GPU without opening another device and clears it on retirement', async () => {
  const f = fixture({ deviceInfo: { vendor: 'AMD', description: 'Reported GPU', hostname: 'private-host' } });
  expect(f.owner.getState().hardware).toBeNull();
  await f.owner.prepare();
  expect(f.owner.getState().hardware).toEqual({ vendor: 'AMD', description: 'Reported GPU' });
  const result = await f.owner.generate([{ content: 'hello' }], () => {}, { signal: signal() });
  expect(result.hardware).toEqual(f.owner.getState().hardware);
  expect(f.service.open).toHaveBeenCalledOnce();
  await f.owner.close();
  expect(f.owner.getState().hardware).toBeNull();
});

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

it('applies a verified adapter per request and restores the base model without another model load', async () => {
  const selected = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64) };
  let active = null;
  const resolveAdapter = vi.fn(async () => ({ manifest: { baseModel: 'fixture' }, options: {} }));
  const f = fixture({
    loadLoRA: vi.fn(async () => { active = { digest: selected.identity }; }),
    unloadLoRA: vi.fn(async () => { active = null; }),
    async *stream(messages) { yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: (active ? 'adapted ' : 'base ') + messages[0].content }; yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: (active ? 'adapted ' : 'base ') + messages[0].content }; }
  }, { resolveAdapter });
  Object.defineProperties(f.session, {
    activeLoRA: { get: () => active ? 'fixture-adapter' : null },
    adapterDigest: { value: () => active?.digest }
  });
  await f.owner.prepare();
  const [adapted, base] = await Promise.all([
    f.owner.generate([{ content: 'A' }], () => {}, { signal: signal(), adapters: [selected] }),
    f.owner.generate([{ content: 'B' }], () => {}, { signal: signal() })
  ]);
  expect(adapted).toMatchObject({ content: 'adapted A', adapterIdentities: [selected.identity] });
  expect(base).toMatchObject({ content: 'base B', adapterIdentities: [] });
  expect(f.service.open).toHaveBeenCalledOnce(); expect(active).toBeNull();
  await f.owner.close();
});

it('rejects mismatched Doppler execution evidence and retires the session', async () => {
  const selected = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64) };
  let active = null; const streamed = vi.fn();
  const f = fixture({ loadLoRA: async () => { active = { digest: 'sha256:' + 'c'.repeat(64) }; },
    unloadLoRA: async () => { active = null; },
    async *stream() { streamed(); yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'must not run' }; }
  }, { resolveAdapter: async () => ({ manifest: { baseModel: 'fixture' }, options: {} }) });
  Object.defineProperties(f.session, { activeLoRA: { get: () => active && 'wrong' }, adapterDigest: { value: () => active?.digest } });
  await f.owner.prepare();
  await expect(f.owner.generate([], () => {}, { signal: signal(), adapters: [selected] })).rejects.toThrow('different adapter');
  expect(streamed).toHaveBeenCalledOnce(); expect(active).toBeNull();
  expect(f.owner.getState().ready).toBe(false); await f.owner.close();
});

it('qualifies adapter readiness through the pinned scoped API evidence without an identity getter', async () => {
  const selected = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64) };
  let active = null;
  const f = fixture({ loadLoRA: async () => { active = selected.identity; }, unloadLoRA: async () => { active = null; } }, {
    model: { id: 'fixture', provider: 'doppler', identity: selected.baseModelIdentity, adapters: [selected] },
    resolveAdapter: async () => ({ manifest: { baseModel: 'fixture' }, options: {} })
  });
  Object.defineProperties(f.session, { activeLoRA: { get: () => active && 'adapter' }, adapterDigest: { value: () => active } });
  expect(f.session.activeLoRAIdentity).toBeUndefined();
  await f.owner.prepare();
  expect(f.owner.getState()).toMatchObject({ ready: true, adapterIdentities: [selected.identity] });
  expect(active).toBeNull(); await f.owner.close();
});

it('does not reuse a session when adapter removal fails', async () => {
  const selected = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64) };
  let active = null;
  const f = fixture({ loadLoRA: async () => { active = { digest: selected.identity }; },
    unloadLoRA: async () => { throw new Error('adapter removal failed'); }
  }, { resolveAdapter: async () => ({ manifest: { baseModel: 'fixture' }, options: {} }) });
  Object.defineProperties(f.session, { activeLoRA: { get: () => active && 'adapter' }, adapterDigest: { value: () => active?.digest } });
  await f.owner.prepare();
  await expect(f.owner.generate([{ content: 'A' }], () => {}, { signal: signal(), adapters: [selected] })).rejects.toThrow('adapter removal failed');
  expect(f.owner.getState().ready).toBe(false); expect(f.service.close).toHaveBeenCalledOnce();
  await f.owner.close();
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
  const f = fixture({ async *stream() { entered.resolve(); await gate.promise; yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'late' }; } });
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

it('captures runtime timing before cleanup resets it, without counting text chunks as tokens', async () => {
  let stats = null;
  const f = fixture({
    advanced: { getStats: () => stats },
    resetGenerationState() { stats = null; },
    async *stream() {
      yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'One chunk, several tokens 🌍' };
      stats = { totalTimeMs: 400, prefillTimeMs: 100, decodeTimeMs: 300, ttftMs: 110, tokensGenerated: 7 };
      yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: 'One chunk, several tokens 🌍' };
    }
  });
  await f.owner.prepare();
  const result = await f.owner.generate([], () => {}, { signal: signal() });
  expect(stats).toBeNull();
  expect(result.timing).toEqual({ totalMs: 400, prefillMs: 100, decodeMs: 300, firstTokenMs: 110, generatedTokenCount: 7 });
  expect(f.owner.getState().production).toEqual({ outputTokens: 7, missingTokenCounts: 0 });
  await f.owner.close();
});

it('marks output counts missing when a completed result carries no token measurement', async () => {
  const onComplete = vi.fn(), f = fixture({}, { onComplete }); await f.owner.prepare();
  await f.owner.generate([{ content: 'not a token count' }], () => {}, { signal: signal() });
  expect(f.owner.getState()).toMatchObject({ completed: 1, production: { outputTokens: 0, missingTokenCounts: 1 } });
  expect(onComplete).toHaveBeenCalledExactlyOnceWith({ modelId: 'fixture', modelIdentity: 'sha256:' + 'a'.repeat(64), outputTokens: null });
  await f.owner.close();
});

it('does not record failed or cancelled execution as completed contribution', async () => {
  const onComplete = vi.fn();
  const f = fixture({ async *stream() { throw Error('execution failed'); } }, { onComplete });
  await f.owner.prepare();
  await expect(f.owner.generate([], () => {}, { signal: signal() })).rejects.toThrow('execution failed');
  expect(onComplete).not.toHaveBeenCalled(); await f.owner.close();
  const cancelled = fixture({}, { onComplete }); await cancelled.owner.prepare();
  await expect(cancelled.owner.generate([], () => {}, { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(onComplete).not.toHaveBeenCalled(); await cancelled.owner.close();
});


it('rejects loader callbacks after preparation settles without altering ready execution', async () => {
  const gate = deferred(), f = fixture();
  f.service.open.mockImplementation(() => gate.promise);
  const preparing = f.owner.prepare();
  await vi.waitFor(() => expect(f.service.open).toHaveBeenCalledOnce());
  const report = f.service.open.mock.calls[0][0].options.onProgress;
  report({ kind: 'receiving', receivedBytes: 60, totalBytes: 100, path: 'one' });
  report({ kind: 'receiving', receivedBytes: 10, totalBytes: 100, path: 'one' });
  expect(f.owner.getState().progress.receivedBytes).toBe(60);
  gate.resolve(f.session); await preparing;
  const before = f.owner.getState();
  report({ kind: 'receiving', receivedBytes: 1, totalBytes: 100, path: 'late' });
  expect(f.owner.getState()).toEqual(before);
  expect((await f.owner.generate([{ content: 'Still usable' }], () => {}, { signal: signal() })).content).toBe('Still usable');
  await f.owner.close();
});

it('keeps the cache lease through failed GPU cleanup and releases it only after successful retirement', async () => {
  const { withUnusedModelStorage, MODEL_STORAGE_LOCK } = await import('../../apps/poolday/infrastructure/model-storage-lock.js');
  let held = false;
  const locks = { async request(name, options, operation) {
    if (name !== MODEL_STORAGE_LOCK) return operation({ name });
    if (held && options.ifAvailable) return operation(null);
    held = true; try { return await operation({ name }); } finally { held = false; }
  } };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  const f = fixture();
  try {
    await f.owner.prepare();
    await expect(withUnusedModelStorage(() => 'remove', locks)).rejects.toThrow('in use');
    f.service.close.mockRejectedValueOnce(Error('GPU cleanup incomplete'));
    await expect(f.owner.close()).rejects.toThrow('GPU cleanup incomplete');
    await expect(withUnusedModelStorage(() => 'remove', locks)).rejects.toThrow('in use');
    await f.owner.close();
    expect(await withUnusedModelStorage(() => 'remove', locks)).toBe('remove');
  } finally {
    await f.owner.close();
    if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else delete navigator.locks;
  }
});
