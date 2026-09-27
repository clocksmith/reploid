import { it, expect, vi } from 'vitest';
import { createWorkAdapterResolver } from '../../self/providers/work-adapter.js';

const signal = () => new AbortController().signal;
async function fixture(acquire) {
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const adapter = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: 'sha256:' + 'a'.repeat(64),
    weightsLayout: 'peft', artifact: { hash, sizeBytes: 3 }, manifest: { baseModel: 'base', weightsPath: 'weights' } };
  const source = vi.fn(acquire || (async () => bytes));
  return { bytes, adapter, source, resolve: createWorkAdapterResolver({ models: [{ availableAdapters: [adapter] }], acquire: source }) };
}
it('verifies bytes, caches them and never lends its cached buffer to the runtime', async () => {
  const f = await fixture();
  const first = await f.resolve(f.adapter, { signal: signal() });
  new Uint8Array(await first.options.fetchUrl('weights')).fill(0); f.bytes.fill(0);
  const next = await f.resolve(f.adapter, { signal: signal() });
  expect([...new Uint8Array(await next.options.fetchUrl('weights'))]).toEqual([1, 2, 3]);
  expect(f.source).toHaveBeenCalledOnce();
  await expect(next.options.fetchUrl('undeclared')).rejects.toThrow('undeclared');
});
it('rejects corrupt files and selections for another exact base model', async () => {
  const f = await fixture(async () => new Uint8Array([0, 0, 0]));
  await expect(f.resolve(f.adapter, { signal: signal() })).rejects.toThrow('identity mismatch');
  await expect(f.resolve({ ...f.adapter, baseModelIdentity: 'wrong' }, { signal: signal() })).rejects.toThrow('authorized catalog');
});
it('checks cancellation after asynchronous acquisition before caching or application', async () => {
  const controller = new AbortController();
  const f = await fixture(async () => { controller.abort(new Error('revoked')); return new Uint8Array([1, 2, 3]); });
  await expect(f.resolve(f.adapter, { signal: controller.signal })).rejects.toThrow('revoked');
});
