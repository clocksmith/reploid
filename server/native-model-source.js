import { fetchPieceIndex, isExternalPieceIndex, retainPieceIndex } from './native-piece-index.js';
import { sha256Digest as hash } from './hashing.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveServedFile } from './browser-roots.js';
import { requireValue } from './native-host-utils.js';

/** Read only complete authenticated pieces requested by Doppler's public reader. */
export async function openNativeModelSource({ model, modelDirectory, signal, runtime, files, resolveSource = null, gather = null }) {
  gather = gather === null ? null : { ...gather };
  const maxRanges = gather?.maxRanges === undefined ? 3 : gather.maxRanges;
  requireValue(gather === null || (!files && resolveSource === null),
    'Local worker gather cannot replace custody or an explicit source resolver');
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
      return { manifest, storage: source.storage, getReceipt: () => source.getReceipt(),
        ...(typeof source.getGatherReceipt === 'function' ? { getGatherReceipt: () => source.getGatherReceipt() } : {}) };
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
  requireValue(JSON.parse(new TextDecoder().decode(manifestBytes)).modelId === model.id,
    'Native manifest differs from the selected model id');
  const descriptor = model.source.files.find(row => row.role === 'model-piece-index');
  requireValue(descriptor?.hashAlgorithm === 'sha256', 'Native model requires a pinned piece index');
  const fetchExternal = async () => {
    const bytes = await fetchPieceIndex(model.id, descriptor, signal);
    await retainPieceIndex(root, bytes, signal);
    return bytes;
  };
  let indexBytes = descriptor.url?.startsWith('/config/model-pieces/')
    ? new Uint8Array(await fs.readFile(resolveServedFile(descriptor.url)))
    : await read(descriptor.path).catch(async error => {
      if (error.code !== 'ENOENT') throw error;
      if (!isExternalPieceIndex(model.id, descriptor)) {
        throw new Error(`Native piece index ${descriptor.path} is not in the model directory`
          + (/^https:/.test(descriptor.url || '') ? `; place the pinned file from ${descriptor.url} there` : ''), { cause: error });
      }
      return fetchExternal();
    });
  // A directory kept across a model rename can still hold the earlier name's external index beside the new
  // manifest; reading it as this model's index refused every start. The pinned copy replaces it (the old one
  // is kept as pieces.json.superseded-*) and is checked against the catalog below like any other.
  if (hash(indexBytes) !== 'sha256:' + descriptor.hash && isExternalPieceIndex(model.id, descriptor)) indexBytes = await fetchExternal();
  requireValue(hash(indexBytes) === 'sha256:' + descriptor.hash, 'Native piece index differs from the approved catalog');
  let nodeGather;
  if (gather !== null) {
    requireValue(Number.isSafeInteger(gather.maxPartBytes) && gather.maxPartBytes > 0
      && Number.isSafeInteger(gather.memoryBudgetBytes) && gather.memoryBudgetBytes > 0
      && Number.isSafeInteger(gather.concurrency ?? 1) && (gather.concurrency ?? 1) > 0
      && Number.isSafeInteger(maxRanges) && maxRanges > 0 && maxRanges <= 32,
    'Local worker gather requires explicit part and memory bounds and a range limit from 1 to 32');
    const approvedFiles = {}, identities = {};
    for (const file of JSON.parse(new TextDecoder().decode(indexBytes)).files) {
      requireValue(/^[a-zA-Z0-9_.-]+$/.test(file.path), 'Gather file must be a plain filename');
      let filename;
      try { filename = await fs.realpath(path.join(root, file.path)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const stat = await fs.stat(filename, { bigint: true });
      requireValue(path.dirname(filename) === root && stat.isFile(),
        'Gather file escapes its approved directory or is not regular');
      approvedFiles[file.path] = filename;
      identities[file.path] = { device: stat.dev.toString(), inode: stat.ino.toString(), size: stat.size.toString() };
    }
    // A verification cache remembers which pieces were hashed for a file's exact state, so it is given
    // only together with the admitted identity of every file it will be asked about.
    nodeGather = { files: approvedFiles, maxPartBytes: gather.maxPartBytes, memoryBudgetBytes: gather.memoryBudgetBytes,
      ...(gather.concurrency === undefined ? {} : { concurrency: gather.concurrency }),
      ...(gather.maxRanges === undefined ? {} : { maxRanges: gather.maxRanges }),
      ...(gather.verificationCache === undefined ? {}
        : { fileIdentities: identities, verificationCache: { directory: gather.verificationCache.directory } }) };
  }
  const opened = await runtime.createVerifiedPieceStorage({ manifestBytes, indexBytes, indexIdentity: 'sha256:' + descriptor.hash,
    signal, nodeGather, acquire: piece => read(piece.path, piece.offset, piece.size) });
  if (nodeGather && (typeof opened.storage?.rangeLease?.read !== 'function' || typeof opened.getGatherReceipt !== 'function'
    || (opened.storage.rangeLease.concurrency ?? 1) !== (gather.concurrency ?? 1)
    || (opened.storage.rangeLease.maxRanges === undefined ? 3 : opened.storage.rangeLease.maxRanges) !== maxRanges
    || (maxRanges > 3 && typeof opened.storage.rangeLease.readMany !== 'function'))) {
    await opened.storage?.close?.();
    throw new Error('Installed Doppler does not support the requested authenticated worker gather');
  }
  return opened;
}
