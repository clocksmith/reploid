/** Read-only, origin-wide inventory. Cached bytes are not a prepared GPU session.
 * The execution loader verifies every file again and refuses missing bytes. */
import { DOPPLER_STORAGE_TOOLING_URL, LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';

export const MODEL_CACHE_EVENT = 'reploid:model-cache-changed';
const namespace = 'reploid-chat-artifacts-v1';
const key = file => `${file.hashAlgorithm}-${file.hash}`;

export async function findCachedModels({ models = LOCAL_DOPPLER_MODELS, storage = globalThis.navigator?.storage,
  loadTooling = () => import(globalThis.REPLOID_DOPPLER_STORAGE_MODULE_URL || DOPPLER_STORAGE_TOOLING_URL) } = {}) {
  if (!storage?.getDirectory) return [];
  const doppler = [];
  try {
    const tools = await loadTooling();
    const inventory = await tools.listModels();
    for (const model of models) {
      if (!inventory.some(item => (typeof item === 'string' ? item : item.modelId) === model.id)) continue;
      let reader;
      try {
        reader = await tools.openModelReadSession(model.id);
        const text = await reader.readManifest();
        if (typeof text !== 'string') continue;
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
        if ('sha256:' + hash !== model.identity) continue;
        const manifest = JSON.parse(text);
        if (manifest.modelId !== model.id || manifest.weightsRef || !manifest.shards?.length) continue;
        const tokenizer = model.source.files.find(file => file.path === manifest.tokenizer?.file);
        if (!tokenizer) continue;
        const files = [tokenizer, ...manifest.shards.map(shard => ({ path: shard.filename, sizeBytes: shard.size }))];
        for (const file of files) {
          if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0
            || await reader.getFileSize(file.path) !== file.sizeBytes) throw Error('Incomplete model cache');
        }
        doppler.push({ id: model.id, identity: model.identity });
      } catch { /* Partial or evicted caches require an explicit download retry. */ }
      finally { await reader?.close(); }
    }
  } catch { /* An unavailable Doppler cache does not hide the existing custody cache. */ }
  let directory;
  try { directory = await (await storage.getDirectory()).getDirectoryHandle(namespace); }
  catch { return doppler; }
  const found = [...doppler];
  for (const model of models) {
    try {
      const descriptor = model.source?.files.find(file => file.role === 'model-manifest');
      if (!descriptor || descriptor.hashAlgorithm !== 'sha256' || model.identity !== `sha256:${descriptor.hash}`) continue;
      const blob = await (await directory.getFileHandle(key(descriptor))).getFile();
      if (blob.size !== descriptor.sizeBytes) continue;
      const bytes = await blob.arrayBuffer();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== descriptor.hash) continue;
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      if (manifest.modelId !== model.id || manifest.weightsRef || !manifest.shards?.length) continue;
      const tokenizer = model.source.files.find(file => file.path === manifest.tokenizer?.file);
      if (!tokenizer) continue;
      const files = [tokenizer, ...manifest.shards.map(shard => ({
        hashAlgorithm: manifest.hashAlgorithm, hash: shard.hash, sizeBytes: shard.size
      }))];
      // Stat large shards without allocating or hashing the entire model during UI startup.
      // This is an inventory hint only; prepareSource(cacheOnly) performs integrity checks.
      for (const file of files) {
        if (!['sha256', 'blake3'].includes(file.hashAlgorithm) || !/^[a-f0-9]{64}$/.test(file.hash)
          || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0) throw new Error('Invalid cached file');
        if ((await (await directory.getFileHandle(key(file))).getFile()).size !== file.sizeBytes) throw new Error('Incomplete cached file');
      }
      if (!found.some(item => item.id === model.id && item.identity === model.identity)) found.push({ id: model.id, identity: model.identity });
    } catch { /* Missing, evicted, partial or invalid files never offer local execution. */ }
  }
  return found;
}

export function announceModelCacheChange() {
  globalThis.dispatchEvent?.(new Event(MODEL_CACHE_EVENT));
  if (typeof BroadcastChannel === 'function') {
    const channel = new BroadcastChannel(MODEL_CACHE_EVENT);
    channel.postMessage(null); channel.close();
  }
}

export function watchModelCache({ onChange, eventTarget = globalThis, scan = findCachedModels }) {
  let closed = false, pending = null, dirty = false;
  const refresh = () => {
    dirty = true;
    pending ||= (async () => {
      while (dirty && !closed) {
        dirty = false;
        const models = await scan().catch(() => []);
        if (!closed) onChange(models);
      }
    })().finally(() => { pending = null; });
    return pending;
  };
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(MODEL_CACHE_EVENT) : null;
  if (channel) channel.onmessage = refresh;
  for (const name of [MODEL_CACHE_EVENT, 'focus', 'pageshow']) eventTarget.addEventListener?.(name, refresh);
  void refresh();
  return { refresh, close() {
    closed = true; channel?.close();
    for (const name of [MODEL_CACHE_EVENT, 'focus', 'pageshow']) eventTarget.removeEventListener?.(name, refresh);
  } };
}
