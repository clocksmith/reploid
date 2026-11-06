/** Measured, catalog-scoped browser storage. Inventories grant no execution readiness. */
import { DOPPLER_STORAGE_TOOLING_URL, LOCAL_DOPPLER_MODELS } from '../../../shared/config/doppler-local-models.js';
import { withUnusedModelStorage } from '../infrastructure/model-storage-lock.js';
import { announceModelCacheChange } from './work-model-cache.js';

const key = file => ['sha256', 'blake3'].includes(file.hashAlgorithm) && /^[a-f0-9]{64}$/.test(file.hash)
  ? `${file.hashAlgorithm}-${file.hash}` : null;
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');

export function createModelStorage({ models = LOCAL_DOPPLER_MODELS, storage = globalThis.navigator?.storage,
  locks = globalThis.navigator?.locks, loadTooling = () => import(globalThis.REPLOID_DOPPLER_STORAGE_MODULE_URL || DOPPLER_STORAGE_TOOLING_URL),
  getState = () => ({}), unload = async () => {}, onRemoved = () => {}, announce = announceModelCacheChange } = {}) {
  const catalog = [...new Map(models.filter(m => !m.partition && !m.adapters?.length).map(m => [m.id, m])).values()];
  let tools;
  const inventory = async () => {
    tools ||= await loadTooling();
    const entries = (await tools.listStorageInventory()).entries;
    let directory = null;
    try { directory = await (await storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1'); }
    catch (error) { if (error.name !== 'NotFoundError' && storage?.getDirectory) throw error; }
    const rows = [];
    for (const model of catalog) {
      const files = [...(model.source?.files || [])];
      const descriptor = files.find(f => f.role === 'model-manifest');
      if (directory && descriptor && key(descriptor)) {
        try {
          const bytes = await (await (await directory.getFileHandle(key(descriptor))).getFile()).arrayBuffer();
          if ('sha256:' + await hash(bytes) === model.identity) {
            const manifest = JSON.parse(new TextDecoder().decode(bytes));
            if (manifest.modelId === model.id) files.push(...(manifest.shards || []).map(s => ({ hashAlgorithm: manifest.hashAlgorithm, hash: s.hash })));
          }
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      const custody = new Map();
      for (const file of files) {
        const name = key(file); if (!name || !directory || custody.has(name)) continue;
        try { custody.set(name, (await (await directory.getFileHandle(name)).getFile()).size); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      const stores = entries.filter(e => e.modelId === model.id);
      const sizeBytes = stores.reduce((sum, e) => sum + e.totalBytes, 0) + [...custody.values()].reduce((sum, size) => sum + size, 0);
      if (stores.length || custody.size) rows.push({ id: model.id, name: model.name || model.id, sizeBytes, stores, custody });
    }
    return { rows, directory };
  };
  const idle = () => {
    const state = getState(), network = state.network || {};
    if (state.runningIds?.length || state.scheduler?.activeAttemptId || state.scheduler?.queued || state.acquisition?.phase === 'downloading'
      || network.sharing || network.stopping || network.contribution?.unsettledOwners || network.files?.sharing || network.files?.preparing || network.files?.stopping) {
      throw new Error('Finish local work and turn off contribution and file sharing before removing downloads.');
    }
  };
  return {
    async list() { return (await inventory()).rows.map(({ id, name, sizeBytes }) => ({ id, name, sizeBytes })); },
    async remove(id) {
      if (!catalog.some(model => model.id === id)) throw new Error('Unknown downloaded model.');
      idle();
      if (getState().localModel?.modelId === id) await unload();
      return withUnusedModelStorage(async () => {
        idle();
        const { rows, directory } = await inventory(), row = rows.find(r => r.id === id);
        if (!row) return;
        const retained = new Set(rows.filter(r => r.id !== id).flatMap(r => [...r.custody.keys()]));
        // Re-read the inventory under all locks; never accept paths from the caller.
        try {
          for (const entry of row.stores) await tools.deleteStorageEntry(entry);
          for (const name of row.custody.keys()) if (!retained.has(name)) await directory.removeEntry(name);
        } finally { onRemoved(id); announce(); }
      }, locks);
    }
  };
}
