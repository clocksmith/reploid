import { sha256Digest as hash } from './hashing.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveServedFile } from './browser-roots.js';
import { requireValue } from './native-host-utils.js';

/** Read only complete authenticated pieces requested by Doppler's public reader. */
export async function openNativeModelSource({ model, modelDirectory, signal, runtime, files, resolveSource = null }) {
  // Trusted native composition only: the resolver owns authenticated range reads and lifetime.
  // Bind the parsed manifest to the approved bytes; never accept a separate mutable manifest.
  if (resolveSource !== null) {
    requireValue(typeof resolveSource === 'function' && model.capsule === undefined,
      'Explicit source resolver requires an unsigned native manifest model');
    signal?.throwIfAborted();
    const source = await resolveSource({ model: structuredClone(model), modelDirectory, signal });
    try {
      signal?.throwIfAborted();
      requireValue(source?.manifestBytes instanceof Uint8Array && hash(source.manifestBytes) === model.identity,
        'Native resolved manifest differs from the approved catalog');
      const manifest = JSON.parse(new TextDecoder().decode(source.manifestBytes));
      requireValue(manifest.modelId === model.id && source.storage && typeof source.storage.close === 'function'
        && typeof source.getReceipt === 'function',
        'Native resolved source requires the selected model, owned storage and acquisition receipt');
      return { manifest, storage: source.storage, getReceipt: () => source.getReceipt() };
    } catch (error) {
      try { await source?.storage?.close?.(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Native resolved source admission and cleanup failed'); }
      throw error;
    }
  }
  if (files) return files.preparePartitionSource(model, { signal });
  const root = await fs.realpath(modelDirectory);
  const read = async (name, offset, size) => {
    signal?.throwIfAborted();
    requireValue(/^[a-zA-Z0-9_.-]+$/.test(name), 'Model file must be a plain filename');
    const filename = await fs.realpath(path.join(root, name));
    requireValue(path.dirname(filename) === root, 'Model file escapes its approved directory');
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      requireValue(stat.isFile(), 'Model source must be a regular file');
      if (offset === undefined) return new Uint8Array(await handle.readFile());
      requireValue(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(size) && size > 0
        && offset + size <= stat.size, 'Model piece exceeds its file');
      const bytes = new Uint8Array(size);
      let received = 0;
      while (received < size) {
        signal?.throwIfAborted();
        const result = await handle.read(bytes, received, size - received, offset + received);
        requireValue(result.bytesRead > 0, 'Model piece read was truncated'); received += result.bytesRead;
      }
      signal?.throwIfAborted(); return bytes;
    } finally { await handle.close(); }
  };
  const manifestBytes = await read('manifest.json');
  requireValue(hash(manifestBytes) === model.identity, 'Native manifest differs from the approved catalog');
  const descriptor = model.source.files.find(row => row.role === 'model-piece-index');
  requireValue(descriptor?.hashAlgorithm === 'sha256', 'Native model requires a pinned piece index');
  // Catalog metadata is bundled with the application; the weight directory need
  // not contain a second hand-maintained copy of it.
  const indexBytes = descriptor.url?.startsWith('/config/model-pieces/')
    ? new Uint8Array(await fs.readFile(resolveServedFile(descriptor.url)))
    : await read(descriptor.path);
  requireValue(hash(indexBytes) === 'sha256:' + descriptor.hash, 'Native piece index differs from the approved catalog');
  return runtime.createVerifiedPieceStorage({ manifestBytes, indexBytes, indexIdentity: 'sha256:' + descriptor.hash,
    signal, acquire: piece => read(piece.path, piece.offset, piece.size) });
}
