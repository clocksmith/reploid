import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import policy from '../apps/poolday/config/chat-files.json' with { type: 'json' };
import { sha256Hex } from './hashing.js';
import { readPinnedOrigin } from './native-model-origin.js';

// Release tooling and native fetch use the same immutable metadata contract.
export function isExternalPieceIndex(modelId, file) {
  if (file?.role !== 'model-piece-index' || file.path !== 'pieces.json'
    || typeof modelId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(modelId) || file.hashAlgorithm !== 'sha256'
    || !/^[0-9a-f]{64}$/.test(file.hash) || !Number.isSafeInteger(file.sizeBytes)
    || file.sizeBytes <= 0 || file.sizeBytes > policy.maxArtifactBytes) return false;
  const revision = typeof file.url === 'string' && file.url.split('/')[6];
  return /^[0-9a-f]{40}$/.test(revision)
    && file.url === `https://huggingface.co/clocksmith/rdrr/resolve/${revision}/models/${modelId}/indexes/${file.hash}/pieces.json`;
}

export async function fetchPieceIndex(modelId, file, signal, fetch = globalThis.fetch) {
  if (!isExternalPieceIndex(modelId, file)) throw new Error('Invalid external model piece index pin');
  const bytes = await readPinnedOrigin({ url: () => file.url, fetch }, file.path,
    { size: file.sizeBytes, whole: true, signal });
  if (sha256Hex(bytes) !== file.hash) throw new Error('Native piece index differs from the approved catalog');
  signal?.throwIfAborted();
  return bytes;
}

/** Keeps the current `name` in `directory` as `name.superseded-<first 12 hex of its SHA-256>` before it is
 * replaced, so a rename upgrade can be inspected or rolled back. The current file stays in place (a hard link
 * holds the old bytes), so a crash before the replacement leaves the directory as it was. Returns the kept name,
 * or null when there is no regular file to keep. */
export async function keepSupersededFile(directory, name) {
  const filename = path.join(directory, name);
  let bytes;
  try {
    if (!(await fs.lstat(filename)).isFile()) return null;
    bytes = await fs.readFile(filename);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const kept = `${name}.superseded-${sha256Hex(bytes).slice(0, 12)}`;
  try { await fs.link(filename, path.join(directory, kept)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return kept;
}

// Readers can use a read-only model directory. In writable directories the verified index becomes visible
// atomically. An index already there with the same bytes is another writer's and stays; one that differs is
// stale (a directory kept across a model rename still holds the earlier name's index) and is replaced, the old
// one kept as `pieces.json.superseded-*`.
export async function retainPieceIndex(directory, bytes, signal) {
  const target = path.join(directory, 'pieces.json');
  const temporary = path.join(directory, '.pieces-' + randomUUID() + '.tmp');
  let handle, written = false;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    written = true;
    await handle.writeFile(bytes, { signal });
    await handle.close(); handle = null;
    signal?.throwIfAborted();
    try { await fs.link(temporary, target); return; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const present = await fs.readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present && Buffer.from(present).equals(Buffer.from(bytes))) return;
    await keepSupersededFile(directory, 'pieces.json');
    signal?.throwIfAborted();
    await fs.rename(temporary, target); written = false;
  } catch (error) {
    if (!['EEXIST', 'EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  } finally {
    await handle?.close();
    if (written) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
