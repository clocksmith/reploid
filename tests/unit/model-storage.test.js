import { expect, it, vi } from 'vitest';
import { createModelStorage } from '../../apps/poolday/host/model-storage.js';
import { retainModelStorage, withUnusedModelStorage } from '../../apps/poolday/infrastructure/model-storage-lock.js';
import { bindModelStorage, renderModelStorage } from '../../apps/poolday/ui/pool-home/model-storage-view.js';

function lockManager() {
  const held = new Map();
  return { async request(name, options, callback) {
    if (held.has(name) && (options.mode !== 'shared' || held.get(name).exclusive)) {
      if (options.ifAvailable) return callback(null);
      throw Error('Contended fixture lock');
    }
    const current = held.get(name) || { exclusive: options.mode !== 'shared', count: 0 };
    current.count++; held.set(name, current);
    try { return await callback({ name }); }
    finally { if (!--current.count) held.delete(name); }
  } };
}

it('refuses deletion while another tab owns storage, including acquisitions and custody writes', async () => {
  const locks = lockManager(), operation = vi.fn();
  const release = await retainModelStorage({ locks });
  await expect(withUnusedModelStorage(operation, locks)).rejects.toThrow('in use');
  expect(operation).not.toHaveBeenCalled(); await release();
  await withUnusedModelStorage(operation, locks); expect(operation).toHaveBeenCalledOnce();
  for (const name of ['reploid:model-acquisition', 'reploid-chat-artifacts-v1:write']) {
    let free;
    const active = locks.request(name, {}, () => new Promise(resolve => { free = resolve; }));
    await expect(withUnusedModelStorage(operation, locks)).rejects.toThrow('in use');
    free(); await active;
  }
  expect(() => withUnusedModelStorage(operation, null)).toThrow('unavailable');
});

async function fixture({ firstShards, firstManifestModelId } = {}) {
  const files = new Map(), shared = 'b'.repeat(64), unique = 'c'.repeat(64);
  const models = await Promise.all(['first', 'second'].map(async (id, i) => {
    const manifest = new TextEncoder().encode(JSON.stringify({ modelId: !i ? firstManifestModelId ?? id : id, hashAlgorithm: 'sha256',
      shards: !i ? firstShards ?? [{ hash: unique }] : [{ hash: shared }] }));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', manifest))].map(b => b.toString(16).padStart(2, '0')).join('');
    files.set('sha256-' + hash, manifest); files.set('sha256-' + shared, new Uint8Array(17)); files.set('sha256-' + unique, new Uint8Array(29));
    return { id, name: id, identity: 'sha256:' + hash, source: { files: [
      { role: 'model-manifest', hashAlgorithm: 'sha256', hash }, { role: 'tokenizer', hashAlgorithm: 'sha256', hash: shared }
    ] } };
  }));
  const missing = () => { throw new DOMException('Missing', 'NotFoundError'); };
  const directory = { async getFileHandle(name) { const bytes = files.get(name); if (!bytes) return missing();
    return { async getFile() { return { size: bytes.byteLength, async arrayBuffer() { return bytes.buffer; } }; } }; },
  removeEntry: vi.fn(async name => files.delete(name)) };
  const storage = { async getDirectory() { return { async getDirectoryHandle() { return directory; } }; } };
  const tools = { listStorageInventory: vi.fn(async () => ({ entries: [{ modelId: 'first', root: 'first-store', totalBytes: 41 },
    { modelId: 'unrelated', root: 'preserve', totalBytes: 99 }] })), deleteStorageEntry: vi.fn() };
  const state = {}, onRemoved = vi.fn(), announce = vi.fn(), unload = vi.fn();
  const port = createModelStorage({ models, storage, locks: lockManager(), loadTooling: async () => tools,
    getState: () => state, unload, onRemoved, announce });
  return { port, files, models, tools, directory, shared, unique, state, onRemoved, announce, unload };
}

it('measures actual partial files and removes only the selected catalog model, preserving shared files', async () => {
  const f = await fixture(), rows = await f.port.list();
  const manifestBytes = f.files.get('sha256-' + f.models[0].identity.slice(7)).byteLength;
  expect(rows.find(r => r.id === 'first').sizeBytes).toBe(41 + 17 + 29 + manifestBytes);
  await expect(f.port.remove('../unrelated')).rejects.toThrow('Unknown');
  await f.port.remove('first');
  expect(f.tools.deleteStorageEntry).toHaveBeenCalledExactlyOnceWith({ modelId: 'first', root: 'first-store', totalBytes: 41 });
  expect(f.files.has('sha256-' + f.unique)).toBe(false);
  expect(f.files.has('sha256-' + f.shared)).toBe(true);
  expect(f.files.has('sha256-' + f.models[1].identity.slice(7))).toBe(true);
  expect(f.onRemoved).toHaveBeenCalledWith('first'); expect(f.announce).toHaveBeenCalledOnce();
});

it('refuses active work and stops an idle resident before removal; failed cleanup preserves every file', async () => {
  const f = await fixture();
  for (const network of [{ sharing: true }, { contribution: { unsettledOwners: 1 } }, { files: { preparing: true } }]) {
    f.state.network = network; await expect(f.port.remove('first')).rejects.toThrow('Finish local work');
  }
  f.state.network = {}; f.state.localModel = { modelId: 'first' };
  f.unload.mockRejectedValueOnce(Error('Cleanup failed'));
  await expect(f.port.remove('first')).rejects.toThrow('Cleanup failed');
  expect(f.tools.deleteStorageEntry).not.toHaveBeenCalled(); expect(f.directory.removeEntry).not.toHaveBeenCalled();
  await f.port.remove('first'); expect(f.unload).toHaveBeenCalledTimes(2);
});

it('invalidates cached availability even after a partial deletion fails', async () => {
  const f = await fixture(); f.directory.removeEntry.mockRejectedValueOnce(Error('Storage refused removal'));
  await expect(f.port.remove('first')).rejects.toThrow('Storage refused removal');
  expect(f.onRemoved).toHaveBeenCalledWith('first'); expect(f.announce).toHaveBeenCalledOnce();
});

async function withDefaultTooling(f, run) {
  globalThis.__modelStorageTestTools = f.tools;
  vi.stubGlobal('REPLOID_DOPPLER_STORAGE_MODULE_URL',
    'data:text/javascript,export const listStorageInventory = (...a) => globalThis.__modelStorageTestTools.listStorageInventory(...a);export const deleteStorageEntry = (...a) => globalThis.__modelStorageTestTools.deleteStorageEntry(...a);');
  try {
    const port = createModelStorage({
      models: f.models,
      storage: { async getDirectory() { return { async getDirectoryHandle() { return f.directory; } }; } },
      locks: lockManager(), getState: () => f.state, unload: f.unload, onRemoved: f.onRemoved, announce: f.announce
    });
    return await run(port);
  } finally {
    delete globalThis.__modelStorageTestTools;
    vi.unstubAllGlobals();
  }
}

it('uses host-selected tooling and strips injected inventory fields on every deletion re-read', async () => {
  const f = await fixture(), executeInjected = vi.fn();
  const moduleUrl = 'data:text/javascript,globalThis.__modelStorageInjected();';
  vi.stubGlobal('__modelStorageInjected', executeInjected);
  f.tools.listStorageInventory.mockResolvedValue({ entries: [
    { modelId: 'first', backend: 'opfs', root: 'first-store', totalBytes: 41, moduleUrl, path: '../escape' },
    { modelId: 'peer-injected', backend: 'opfs', root: 'peer-store', totalBytes: 999, moduleUrl }
  ] });
  await withDefaultTooling(f, async port => {
    const rows = await port.list();
    expect(rows.map(row => row.id)).toEqual(['first', 'second']);
    await expect(port.remove('peer-injected')).rejects.toThrow('Unknown');
    await port.remove('first');
    expect(f.tools.listStorageInventory).toHaveBeenCalledTimes(2);
    expect(f.tools.deleteStorageEntry).toHaveBeenCalledExactlyOnceWith({
      modelId: 'first', backend: 'opfs', root: 'first-store', totalBytes: 41
    });
    expect(executeInjected).not.toHaveBeenCalled();
    expect(f.files.has('sha256-' + f.shared)).toBe(true);
  });
});

it('rejects invalid shard digests inside an identity-matching manifest before file access or deletion', async () => {
  const validShard = 'c'.repeat(64), invalidDigests = ['../escape', 'not-a-digest'];
  const f = await fixture({ firstShards: [{ hash: validShard }, ...invalidDigests.map(hash => ({ hash }))] });
  const getFile = vi.spyOn(f.directory, 'getFileHandle');
  for (const digest of invalidDigests)f.files.set('sha256-' + digest, new Uint8Array(53));
  await withDefaultTooling(f, async port => {
    const rows = await port.list();
    expect(getFile).toHaveBeenCalledWith('sha256-' + validShard);
    for (const digest of invalidDigests)expect(getFile).not.toHaveBeenCalledWith('sha256-' + digest);
    const manifestKey = 'sha256-' + f.models[0].identity.slice(7);
    expect(rows.find(row => row.id === 'first').sizeBytes).toBe(41 + 17 + 29 + f.files.get(manifestKey).byteLength);
    await port.remove('first');
    expect(f.files.has('sha256-' + validShard)).toBe(false);
    for (const digest of invalidDigests) {
      expect(getFile).not.toHaveBeenCalledWith('sha256-' + digest);
      expect(f.directory.removeEntry).not.toHaveBeenCalledWith('sha256-' + digest);
      expect(f.files.has('sha256-' + digest)).toBe(true);
    }
  });
});

it.each(['tampered identity', 'different model'])('does not trust manifest shard lists with %s', async kind => {
  const untrustedShard = 'd'.repeat(64);
  const f = await fixture(kind === 'different model'
    ? { firstManifestModelId: 'peer-injected', firstShards: [{ hash: untrustedShard }] } : {});
  const manifestKey = 'sha256-' + f.models[0].identity.slice(7);
  if (kind === 'tampered identity')f.files.set(manifestKey, new TextEncoder().encode(JSON.stringify({
    modelId: 'first', hashAlgorithm: 'sha256', shards: [{ hash: untrustedShard }]
  })));
  f.files.set('sha256-' + untrustedShard, new Uint8Array(53));
  const getFile = vi.spyOn(f.directory, 'getFileHandle');
  await withDefaultTooling(f, async port => {
    const rows = await port.list();
    expect(rows.find(row => row.id === 'first').sizeBytes).toBe(41 + 17 + f.files.get(manifestKey).byteLength);
    await port.remove('first');
    expect(getFile).not.toHaveBeenCalledWith('sha256-' + untrustedShard);
    expect(f.directory.removeEntry).not.toHaveBeenCalledWith('sha256-' + untrustedShard);
    expect(f.files.has('sha256-' + untrustedShard)).toBe(true);
  });
});

it('requires a bounded confirmation and keeps removal failures visible', async () => {
  document.body.innerHTML = renderModelStorage();
  const storage = { list: vi.fn(async () => [{ id: 'one', name: 'Model one', sizeBytes: 1048576 }]), remove: vi.fn(async () => { throw Error('In use by another tab'); }) };
  const panel = bindModelStorage(document.body, storage); await panel.refresh();
  document.querySelector('[aria-label="Remove Model one download"]').click();
  expect(document.querySelector('[data-storage-dialog]').open).toBe(true); expect(storage.remove).not.toHaveBeenCalled();
  document.querySelector('[data-storage-confirm]').click();
  await vi.waitFor(() => expect(document.querySelector('[data-storage-remove-error]').textContent).toBe('In use by another tab'));
  expect(document.querySelector('[data-storage-dialog]').open).toBe(true);
  expect(storage.remove).toHaveBeenCalledWith('one'); panel.dispose();
});
