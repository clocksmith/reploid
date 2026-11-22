// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createNativeWholeModel } from '../../server/native-whole-model.js';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture({ prepare, owner, adapter = false, omitBudget = false, fill = null, gpu = undefined } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-whole-')); roots.push(root);
  const bytes = JSON.stringify({ modelId: 'model' }); await fs.writeFile(path.join(root, 'manifest.json'), bytes);
  const model = { id: 'model', identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    loadOptions: { runtimeConfig: { shared: { bufferPool: { budget: { maxTotalBytes: 1000 } } } } } };
  if (omitBudget) delete model.loadOptions;
  if (adapter) {
    model.adapters = [{ id: 'adapter', identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: model.identity }];
    model.availableAdapters = structuredClone(model.adapters);
  }
  let ready = false;
  const resident = { getState: () => ({ phase: ready ? 'ready' : 'loading', ready, modelIdentity: model.identity, adapterIdentities: ready ? (model.adapters || []).map(item => item.identity) : [] }),
    prepare: vi.fn(async () => { await prepare?.(); ready = true; }),
    close: vi.fn(async () => { ready = false; }), generate: vi.fn(async () => ({ content: 'answer' })) };
  const nativeGpu = vi.fn(async () => gpu), createResident = vi.fn(() => resident), configureMemory = vi.fn();
  const participant = createNativeWholeModel({ model, modelDirectory: root, nativeGpu, createResident, configureMemory, owner, fill });
  return { participant, model, nativeGpu, resident, createResident, configureMemory, root };
}
it('requires consent, validates identity before GPU work, and advertises only a prepared model', async () => {
  const f = await fixture();
  expect(f.participant.getState().ready).toBe(false);
  await expect(f.participant.contribute(false)).rejects.toThrow('Approve');
  expect(f.nativeGpu).not.toHaveBeenCalled();
  await fs.writeFile(path.join(f.root, 'manifest.json'), '{}');
  await expect(f.participant.contribute(true)).rejects.toThrow('differs');
  expect(f.nativeGpu).not.toHaveBeenCalled();
});
it('reuses the prepared model, enforces owner admission, and never substitutes another mode', async () => {
  let action = 'admit';
  const ownerPolicyDigest = 'sha256:' + 'd'.repeat(64);
  const f = await fixture({ owner: { digest: ownerPolicyDigest, decide: () => ({ action }), gpuBufferBytes: () => 700 } });
  await f.participant.contribute(true); await f.participant.contribute(true);
  expect(f.resident.prepare).toHaveBeenCalledTimes(1);
  expect(f.createResident.mock.calls[0][0].source).toMatchObject({ manifest: { modelId: 'model' }, manifestHash: f.model.identity.slice(7) });
  expect(f.participant.getState().ready).toBe(true);
  expect(f.createResident.mock.calls[0][0].loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes).toBe(700);
  expect(f.model.loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes).toBe(1000);
  await expect(f.participant.generate([], () => {}, {})).resolves.toEqual({ content: 'answer', ownerPolicyDigest });
  action = 'defer'; expect(f.participant.getState().ready).toBe(false);
  expect(() => f.participant.generate([], () => {}, {})).toThrow('unavailable');
  await f.participant.close();
  expect(f.resident.close).toHaveBeenCalled();
  expect(() => f.participant.generate([], () => {}, {})).toThrow('unavailable');
});
it('stopping during preparation waits for ownership settlement and never advertises ready', async () => {
  const gate = Promise.withResolvers(), began = Promise.withResolvers();
  const f = await fixture({ prepare: async () => { began.resolve(); await gate.promise; } });
  const opening = f.participant.contribute(true); await began.promise;
  let stopped = false; const stopping = f.participant.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false); expect(f.participant.getState().ready).toBe(false);
  gate.resolve(); await Promise.all([opening, stopping]);
  expect(f.participant.getState().ready).toBe(false);
});
it('enforces the owner GPU ceiling even when the model has no explicit budget', async () => {
  const f = await fixture({ omitBudget: true, owner: { decide: () => ({ action: 'admit' }), gpuBufferBytes: limit => Math.min(limit, 700) } });
  await f.participant.contribute(true);
  expect(f.createResident.mock.calls[0][0].loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes).toBe(700);
  expect(f.model.loadOptions).toBeUndefined();
  expect(f.configureMemory).toHaveBeenCalledExactlyOnceWith(700);
  await f.participant.close();
});
it('keeps prepared capacity discoverable during execution without overriding owner withdrawal', async () => {
  let action = 'admit';
  const f = await fixture({ owner: { decide: () => ({ action }), gpuBufferBytes: () => 700 } });
  await f.participant.contribute(true);
  f.resident.getState = () => ({ phase: 'executing', ready: true, completed: 3, modelIdentity: f.model.identity });
  expect(f.participant.getExecutionState()).toMatchObject({ phase: 'ready', ready: true,
    modelIdentity: f.model.identity, activity: { phase: 'executing', completed: 3, error: null } });
  action = 'defer';
  expect(f.participant.getExecutionState()).toMatchObject({ phase: 'idle', ready: false,
    activity: { phase: 'executing' } });
  expect(() => f.participant.generate([], () => {}, {})).toThrow('unavailable');
  action = 'admit';
  await f.participant.stop();
  expect(f.participant.getExecutionState()).toMatchObject({ phase: 'idle', ready: false });
});
it('rejects an approved-directory escape before opening the GPU', async () => {
  const f = await fixture(), external = await fixture();
  await fs.unlink(path.join(f.root, 'manifest.json'));
  await fs.symlink(path.join(external.root, 'manifest.json'), path.join(f.root, 'manifest.json'));
  await expect(f.participant.contribute(true)).rejects.toThrow('escapes');
  expect(f.nativeGpu).not.toHaveBeenCalled();
});

it('advertises only probed adapters, serves base requests, and refuses unprepared substitutions', async () => {
  const f = await fixture({ adapter: true });
  expect(f.participant.getState().adapterIdentities).toEqual(undefined);
  await f.participant.contribute(true);
  const identity = f.model.adapters[0].identity;
  expect(f.participant.getState().adapterIdentities).toEqual([identity]);
  expect(f.createResident.mock.calls[0][0].resolveAdapter).toBeTypeOf('function');
  await f.participant.generate([], () => {}, { adapterIdentities: [identity] });
  expect(f.resident.generate.mock.calls.at(-1)[2].adapters).toEqual(f.model.adapters);
  await f.participant.generate([], () => {}, { adapterIdentities: [] });
  expect(f.resident.generate.mock.calls.at(-1)[2].adapters).toEqual([]);
  expect(() => f.participant.generate([], () => {}, { adapterIdentities: ['sha256:' + 'c'.repeat(64)] })).toThrow('not prepared');
  expect(f.resident.generate).toHaveBeenCalledTimes(2);
  await f.participant.close();
});
it('fills the model directory before reading its manifest, and stop aborts the fill before any GPU work', async () => {
  const order = [];
  const f = await fixture({ fill: async () => { order.push('fill'); } });
  f.nativeGpu.mockImplementation(() => { order.push('gpu'); });
  await f.participant.contribute(true);
  expect(order).toEqual(['fill', 'gpu']);
  const began = Promise.withResolvers(); let aborted = null;
  const g = await fixture({ fill: ({ signal }) => new Promise((_, reject) => {
    began.resolve(); signal.addEventListener('abort', () => { aborted = signal.reason; reject(signal.reason); }, { once: true }); }) });
  const opening = g.participant.contribute(true); await began.promise;
  expect(g.participant.getState()).toMatchObject({ phase: 'acquiring-model', ready: false });
  await g.participant.stop();
  await expect(opening).rejects.toThrow('stopped');
  expect(aborted?.message).toMatch('stopped'); expect(g.nativeGpu).not.toHaveBeenCalled();
});
it('runs a catalog model without explicit generation under its partition route policy and context', async () => {
  const f = await fixture({ omitBudget: true });
  await f.participant.contribute(true);
  const options = f.createResident.mock.calls[0][0];
  const { resolvePartitionGeneration } = await import('../../apps/poolday/config/partition-generation.js');
  const expected = resolvePartitionGeneration(f.model);
  expect(options.generation).toEqual(expected);
  expect(options.generation.maxSeqLen).toBeGreaterThan(options.generation.maxTokens);
  expect(options.loadOptions.runtimeConfig.inference.session.kvcache.maxSeqLen).toBe(expected.maxSeqLen);
  const g = await fixture();
  g.model.generation = { maxTokens: 8 };
  const explicit = createNativeWholeModel({ model: g.model, modelDirectory: g.root, nativeGpu: g.nativeGpu, createResident: g.createResident, configureMemory: g.configureMemory });
  await explicit.contribute(true);
  expect(g.createResident.mock.calls.at(-1)[0].generation).toEqual({ maxTokens: 8 });
  expect(g.createResident.mock.calls.at(-1)[0].loadOptions.runtimeConfig.inference?.session?.kvcache).toBeUndefined();
});

it('reads a gathered whole model through owned authenticated storage and closes it only after the resident', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-whole-')); roots.push(root);
  const bytes = JSON.stringify({ modelId: 'model' }); await fs.writeFile(path.join(root, 'manifest.json'), bytes);
  const gather = { maxPartBytes: 4096, memoryBudgetBytes: 65536, concurrency: 2, verificationCache: { directory: path.join(root, 'state') } };
  const model = { id: 'model', identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), wholeRuntime: { gather } };
  const order = [];
  const storage = { close: vi.fn(async () => { order.push('storage-closed'); }) };
  const openSource = vi.fn(async () => ({ manifest: { modelId: 'model' }, storage }));
  const runtime = { createVerifiedPieceStorage() {} };
  let ready = false;
  const resident = { getState: () => ({ phase: ready ? 'ready' : 'loading', ready, modelIdentity: model.identity, adapterIdentities: [] }),
    prepare: vi.fn(async () => { ready = true; }), close: vi.fn(async () => { ready = false; order.push('resident-closed'); }), generate: vi.fn() };
  const createResident = vi.fn(() => resident);
  const participant = createNativeWholeModel({ model, modelDirectory: root, nativeGpu: vi.fn(), createResident, configureMemory: vi.fn(),
    openSource, loadGatherRuntime: async () => runtime });
  await participant.contribute(true);
  expect(participant.getState().ready).toBe(true);
  // The source opener gets the approved directory, the gather policy and the runtime that hashes pieces.
  expect(openSource).toHaveBeenCalledWith(expect.objectContaining({ modelDirectory: await fs.realpath(root), runtime, gather }));
  // The resident loads from that storage, never from a URL, with a loader of its own.
  const options = createResident.mock.calls[0][0];
  expect(options.source.storageContext).toBe(storage);
  expect(options.source.baseUrl).toBeUndefined();
  expect(options.source.manifestHash).toBe(model.identity.slice(7));
  expect(options.loadOptions.isolatedLoader).toBe(true);
  await participant.close();
  expect(order).toEqual(['resident-closed', 'storage-closed']);

  // A failed preparation closes the storage it opened.
  const failing = createNativeWholeModel({ model, modelDirectory: root, nativeGpu: vi.fn(), configureMemory: vi.fn(), openSource,
    loadGatherRuntime: async () => runtime,
    createResident: () => ({ getState: () => ({ phase: 'failed', ready: false }), prepare: async () => { throw new Error('load failed'); }, close: async () => {} }) });
  storage.close.mockClear();
  await expect(failing.contribute(true)).rejects.toThrow('load failed');
  expect(storage.close).toHaveBeenCalledTimes(1);
});

it('keeps the plain file loader for a model with no gather policy', async () => {
  const f = await fixture();
  await f.participant.contribute(true);
  const options = f.createResident.mock.calls[0][0];
  expect(options.source.baseUrl).toMatch(/^file:/);
  expect(options.source.storageContext).toBeUndefined();
  expect(options.loadOptions.isolatedLoader).toBeUndefined();
});

it('fails the load and offers nothing when the GPU refused an allocation while the runtime still reports ready', async () => {
  // Recorded on an integrated GPU: the driver refused the last weight buffers, and the runtime finished its load as ready.
  const memory = { count: 0, message: null }, settle = vi.fn(async () => {});
  const gpu = { outOfMemory: () => ({ ...memory }), settle };
  const f = await fixture({ gpu, prepare: () => { memory.count += 2; memory.message = 'vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY'; } });
  const failure = await f.participant.contribute(true).catch(error => error);
  expect(failure).toMatchObject({ code: 'GPU_OUT_OF_MEMORY', detail: 'vkAllocateMemory failed with VK_ERROR_OUT_OF_DEVICE_MEMORY' });
  expect(failure.message).toBe("This computer's GPU ran out of memory while loading the model");
  expect(settle).toHaveBeenCalledOnce();
  expect(f.resident.close).toHaveBeenCalledOnce();
  expect(f.participant.getState()).toMatchObject({ ready: false, offering: false });
  // An earlier refusal on the same device does not fail a later load that fits.
  const later = await fixture({ gpu });
  await later.participant.contribute(true);
  expect(later.participant.getState().ready).toBe(true);
});
