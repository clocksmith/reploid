/** Fills a whole-model directory from verified pieces so one machine can hold the complete
 * model. Every piece is checked against the pinned piece index, every assembled file against
 * its pinned whole-file hash (the manifest's shard hash or the catalog's file hash), and a
 * file appears under its final name only after that check (temporary `.partial` + rename).
 * An interrupted fill resumes: pieces already written and still matching their identity are
 * reused. The manifest is written last, so a directory with a matching manifest was either
 * placed by its owner or completed here. Where the bytes come from is the caller's port. */
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const assert = (ok, message, code) => { if (!ok) throw Object.assign(new Error(message), code ? { code } : {}); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plainName = name => typeof name === 'string' && /^[A-Za-z0-9_.-]+$/.test(name) && !/^\.\.?$/.test(name);
const isMetadataSource = file => plainName(file.path) && file.role !== 'model-piece-index';

async function regularSize(filename) {
  try { const info = await fs.lstat(filename); return info.isFile() ? info.size : -1; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function hashFile(filename, signal) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename, { signal })) digest.update(chunk);
  return digest.digest('hex');
}

/** True when the directory already holds the catalog manifest and every file it needs at its
 * pinned size. Reads only the local manifest, so an owner-provided directory never needs peers. */
export async function wholeModelDirectoryComplete(root, model) {
  let manifestBytes;
  try { manifestBytes = await fs.readFile(path.join(root, 'manifest.json')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if ('sha256:' + sha256(manifestBytes) !== model.identity) return false;
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const required = [...(manifest.shards || []).map(shard => ({ path: shard.filename, size: shard.size })),
    ...(model.source?.files || []).filter(file => isMetadataSource(file) && file.path !== 'manifest.json')
      .map(file => ({ path: file.path, size: file.sizeBytes }))];
  for (const file of required) if (await regularSize(path.join(root, file.path)) !== file.size) return false;
  return true;
}

/** The files a complete directory holds: every file of the piece index with its pinned whole
 * hash, then catalog metadata outside the index, the manifest last. */
export function wholeModelFillPlan({ model, manifest, index }) {
  assert(manifest.hashAlgorithm === 'sha256', 'Whole-model fill requires SHA-256 shard hashes');
  const pinned = new Map((model.source?.files || []).map(file => [file.path, file]));
  const assembled = index.files.map(file => {
    assert(plainName(file.path), 'Piece index names a file outside the model directory: ' + file.path);
    const shard = manifest.shards.find(row => row.filename === file.path), source = pinned.get(file.path);
    const hash = shard ? shard.hash : source?.hashAlgorithm === 'sha256' ? source.hash : null;
    assert(/^[a-f0-9]{64}$/.test(hash || ''), 'Piece index names an unpinned file: ' + file.path);
    assert(file.size === (shard ? shard.size : source.sizeBytes), 'Piece index size differs from the pinned file: ' + file.path);
    let offset = 0;
    for (const piece of file.pieces) { assert(piece.offset === offset && piece.size > 0, 'Pieces do not cover ' + file.path); offset += piece.size; }
    assert(offset === file.size, 'Pieces do not cover ' + file.path);
    return { path: file.path, size: file.size, hash, pieces: file.pieces };
  });
  for (const shard of manifest.shards) assert(assembled.some(file => file.path === shard.filename), 'Piece index omits shard ' + shard.filename);
  const metadata = (model.source?.files || []).filter(file => isMetadataSource(file) && !assembled.some(row => row.path === file.path))
    .sort((a, b) => (a.path === 'manifest.json') - (b.path === 'manifest.json'));
  assert(metadata.at(-1)?.path === 'manifest.json', 'Catalog source files must pin manifest.json');
  return { assembled, metadata };
}

async function writeAtomically(root, name, bytes, signal) {
  const temporary = path.join(root, name + '.' + crypto.randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    signal?.throwIfAborted(); await fs.rename(temporary, path.join(root, name));
  } finally { await handle?.close(); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function readRange(handle, offset, size) {
  const bytes = new Uint8Array(size); let received = 0;
  while (received < size) {
    const part = await handle.read(bytes, received, size - received, offset + received);
    if (part.bytesRead === 0) return null;
    received += part.bytesRead;
  }
  return bytes;
}

async function syncDirectory(root) {
  let handle;
  try { handle = await fs.open(root, constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (!['EISDIR', 'EINVAL', 'EPERM', 'EBADF'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}

/**
 * `acquire(piece, {signal})` returns a piece's bytes, or `{bytes, source}` naming the source,
 * from an authorized source; they are verified here regardless. `readMetadata(file, signal)` returns a pinned catalog file.
 * `release(file)` lets the caller drop duplicate piece copies once `file` is in place.
 * `freeBytes(root)` reports writable space. `onProgress` receives `start`, `piece`, `file`
 * and `complete` events with cumulative counts.
 */
export async function fillWholeModelDirectory({ root, model, manifest, index, acquire, readMetadata,
  release = async () => {}, freeBytes, concurrency = 1, signal = AbortSignal.timeout(2 ** 31 - 1), onProgress = () => {} }) {
  assert(Number.isSafeInteger(concurrency) && concurrency > 0, 'Explicit fill concurrency required');
  const started = Date.now(), plan = wholeModelFillPlan({ model, manifest, index });
  // Never overwrite a directory that holds another model.
  try {
    const present = await fs.readFile(path.join(root, 'manifest.json'));
    assert('sha256:' + sha256(present) === model.identity, 'Model directory holds a different manifest', 'WHOLE_MODEL_DIRECTORY_CONFLICT');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // A file already under its final name is used only after its whole hash matches; one that
  // does not becomes the partial file, so its matching pieces are still reused.
  const missing = [];
  for (const file of plan.assembled) {
    const filename = path.join(root, file.path);
    if (await regularSize(filename) === file.size && await hashFile(filename, signal) === file.hash) continue;
    if (await regularSize(filename) !== null) await fs.rename(filename, filename + '.partial');
    missing.push(file);
  }
  const metadata = [];
  for (const file of plan.metadata) {
    const filename = path.join(root, file.path);
    if (file.path !== 'manifest.json' && await regularSize(filename) === file.sizeBytes && await hashFile(filename, signal) === file.hash) continue;
    metadata.push(file);
  }
  const totals = { files: missing.length + metadata.length, pieces: missing.reduce((sum, file) => sum + file.pieces.length, 0),
    bytes: missing.reduce((sum, file) => sum + file.size, 0) + metadata.reduce((sum, file) => sum + file.sizeBytes, 0) };
  const progress = { fetchedPieces: 0, fetchedBytes: 0, reusedPieces: 0, reusedBytes: 0, completedFiles: 0, sources: {} };
  const count = (source, bytes) => { const row = progress.sources[source] ||= { pieces: 0, bytes: 0 }; row.pieces++; row.bytes += bytes; };
  const emit = (phase, extra = {}) => onProgress(structuredClone({ phase, ...totals, ...progress, elapsedMs: Date.now() - started, ...extra }));
  const available = await freeBytes(root);
  assert(available >= totals.bytes, `Model directory needs ${totals.bytes} bytes; ${available} are free`, 'WHOLE_MODEL_STORAGE');
  emit('start');
  for (const file of missing) {
    signal.throwIfAborted();
    const partial = path.join(root, file.path + '.partial');
    const handle = await fs.open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const info = await handle.stat(); assert(info.isFile(), 'Partial model file must be a regular file');
      if (info.size > file.size) await handle.truncate(file.size);
      const queue = file.pieces.slice();
      const worker = async () => {
        for (let piece = queue.shift(); piece; piece = queue.shift()) {
          signal.throwIfAborted();
          const present = await readRange(handle, piece.offset, piece.size);
          if (present && 'sha256:' + sha256(present) === piece.identity) {
            progress.reusedPieces++; progress.reusedBytes += piece.size; count('partial-file', piece.size);
            emit('piece', { path: file.path, reused: true, source: 'partial-file' }); continue;
          }
          const acquired = await acquire({ ...piece, path: file.path }, { signal });
          const bytes = acquired instanceof Uint8Array ? acquired : acquired?.bytes;
          const source = acquired instanceof Uint8Array ? 'acquired' : String(acquired?.source || 'acquired');
          signal.throwIfAborted();
          assert(bytes instanceof Uint8Array && bytes.byteLength === piece.size && 'sha256:' + sha256(bytes) === piece.identity,
            `Rejected unverified bytes for piece ${piece.identity} of ${file.path}`, 'WHOLE_MODEL_PIECE_REJECTED');
          let written = 0;
          while (written < bytes.byteLength) written += (await handle.write(bytes, written, bytes.byteLength - written, piece.offset + written)).bytesWritten;
          progress.fetchedPieces++; progress.fetchedBytes += piece.size; count(source, piece.size);
          emit('piece', { path: file.path, reused: false, source });
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, file.pieces.length) }, worker));
      await handle.sync();
    } finally { await handle.close(); }
    const actual = await hashFile(partial, signal);
    if (actual !== file.hash) {
      await fs.unlink(partial);
      assert(false, `Assembled ${file.path} differs from its pinned hash`, 'WHOLE_MODEL_FILE_REJECTED');
    }
    await fs.rename(partial, path.join(root, file.path)); await syncDirectory(root);
    progress.completedFiles++; emit('file', { path: file.path });
    await release(file);
  }
  for (const file of metadata) {
    const read = await readMetadata(file, signal);
    const bytes = read instanceof Uint8Array ? read : read?.bytes;
    assert(bytes instanceof Uint8Array && bytes.byteLength === file.sizeBytes && sha256(bytes) === file.hash,
      'Rejected unverified bytes for ' + file.path, 'WHOLE_MODEL_FILE_REJECTED');
    await writeAtomically(root, file.path, bytes, signal); await syncDirectory(root);
    progress.completedFiles++; emit('file', { path: file.path, ...(read instanceof Uint8Array ? {} : { source: read?.source }) });
  }
  emit('complete');
  return { ...totals, ...progress, elapsedMs: Date.now() - started };
}
