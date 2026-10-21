// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { findCachedModels, watchModelCache, MODEL_CACHE_EVENT } from '../../self/host/work-model-cache.js';

afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const manifest = { modelId: 'cached-test', hashAlgorithm: 'sha256', tokenizer: { file: 'tokenizer.json' },
    shards: [{ filename: 'weights.bin', hash: 'b'.repeat(64), size: 8 }] };
  const blob = new Blob([JSON.stringify(manifest)]);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
  const model = { id: manifest.modelId, identity: `sha256:${hash}`, source: { files: [
    { role: 'model-manifest', path: 'manifest.json', hashAlgorithm: 'sha256', hash, sizeBytes: blob.size },
    { role: 'tokenizer', path: 'tokenizer.json', hashAlgorithm: 'sha256', hash: 'a'.repeat(64), sizeBytes: 4 }
  ] } };
  const files = new Map([[`sha256-${hash}`, blob], [`sha256-${'a'.repeat(64)}`, new Blob(['text'])]]);
  const storage = { getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async name => {
    if (!files.has(name)) throw new Error('Missing');
    return { getFile: async () => files.get(name) };
  } }) }) };
  return { model, files, scan: () => findCachedModels({ models: [model], storage }) };
}

it('offers a complete same-origin cache without fetching; missing or truncated shards are unavailable', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const f = await fixture(), weights = `sha256-${'b'.repeat(64)}`;
  expect(await f.scan()).toEqual([]);
  f.files.set(weights, new Blob(['partial'])); expect(await f.scan()).toEqual([]);
  f.files.set(weights, new Blob(['12345678'])); expect(await f.scan()).toEqual([{ id: f.model.id, identity: f.model.identity }]);
  f.files.delete(weights); expect(await f.scan()).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects changed manifest bytes even with unchanged size', async () => {
  const f = await fixture();
  f.files.set(`sha256-${'b'.repeat(64)}`, new Blob(['12345678']));
  const name = f.model.identity.replace(':', '-'), blob = f.files.get(name);
  f.files.set(name, new Blob([(await blob.text()).replace('cached-test', 'cached-evil')]));
  expect(await f.scan()).toEqual([]);
});

it('refreshes another open tab on cache notification and stops observing after close', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const target = new EventTarget(), onChange = vi.fn();
  let models = [];
  const watcher = watchModelCache({ eventTarget: target, scan: async () => models, onChange });
  await watcher.refresh(); expect(onChange).toHaveBeenLastCalledWith([]);
  models = [{ id: 'model', identity: 'sha256:cache' }];
  target.dispatchEvent(new Event(MODEL_CACHE_EVENT));
  await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith(models));
  watcher.close(); onChange.mockClear(); target.dispatchEvent(new Event('focus'));
  await Promise.resolve(); expect(onChange).not.toHaveBeenCalled();
});

it('inspects a model-bound Doppler cache and refuses partial files after reload without acquiring bytes', async () => {
  const f = await fixture(), file = f.model.source.files[0];
  const text = await f.files.get(`sha256-${file.hash}`).text();
  let shardBytes = 7;
  const close = vi.fn(async () => {}), readManifest = vi.fn(async () => text);
  const tools = { listModels: async () => [f.model.id], openModelReadSession: vi.fn(async id => {
    expect(id).toBe(f.model.id);
    return { readManifest, getFileSize: async path => path === 'tokenizer.json' ? 4 : shardBytes, close };
  }) };
  const scan = () => findCachedModels({ models: [f.model], storage: { getDirectory: async () => { throw Error('No custody cache'); } }, loadTooling: async () => tools });
  expect(await scan()).toEqual([]);
  shardBytes = 8; expect(await scan()).toEqual([{ id: f.model.id, identity: f.model.identity }]);
  expect(close).toHaveBeenCalledTimes(2);
  readManifest.mockResolvedValue(text.replace('cached-test', 'cached-evil'));
  expect(await scan()).toEqual([]); expect(close).toHaveBeenCalledTimes(3);
});
