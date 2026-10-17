// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createNativeWholeModel } from '../../server/native-whole-model.js';

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture({ prepare, owner, adapter = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-whole-')); roots.push(root);
  const bytes = JSON.stringify({ modelId: 'model' }); await fs.writeFile(path.join(root, 'manifest.json'), bytes);
  const model = { id: 'model', identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    loadOptions: { runtimeConfig: { shared: { bufferPool: { budget: { maxTotalBytes: 1000 } } } } } };
  if (adapter) {
    model.adapters = [{ id: 'adapter', identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: model.identity }];
    model.availableAdapters = structuredClone(model.adapters);
  }
  let ready = false;
  const resident = { getState: () => ({ phase: ready ? 'ready' : 'loading', ready, modelIdentity: model.identity, adapterIdentities: ready ? (model.adapters || []).map(item => item.identity) : [] }),
    prepare: vi.fn(async () => { await prepare?.(); ready = true; }),
    close: vi.fn(async () => { ready = false; }), generate: vi.fn(async () => ({ content: 'answer' })) };
  const nativeGpu = vi.fn(), createResident = vi.fn(() => resident);
  const participant = createNativeWholeModel({ model, modelDirectory: root, nativeGpu, createResident, owner });
  return { participant, model, nativeGpu, resident, createResident, root };
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
  const f = await fixture({ owner: { decide: () => ({ action }), gpuBufferBytes: () => 700 } });
  await f.participant.contribute(true); await f.participant.contribute(true);
  expect(f.resident.prepare).toHaveBeenCalledTimes(1);
  expect(f.createResident.mock.calls[0][0].source).toMatchObject({ manifest: { modelId: 'model' }, manifestHash: f.model.identity.slice(7) });
  expect(f.participant.getState().ready).toBe(true);
  expect(f.createResident.mock.calls[0][0].loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes).toBe(700);
  expect(f.model.loadOptions.runtimeConfig.shared.bufferPool.budget.maxTotalBytes).toBe(1000);
  await expect(f.participant.generate([], () => {}, {})).resolves.toEqual({ content: 'answer' });
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
