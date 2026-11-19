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

// Readers can use a read-only model directory. In writable directories the
// verified index becomes visible atomically, without replacing another writer.
export async function retainPieceIndex(directory, bytes, signal) {
  const temporary = path.join(directory, '.pieces-' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes, { signal });
    await handle.close();
    signal?.throwIfAborted();
    await fs.link(temporary, path.join(directory, 'pieces.json'));
  } catch (error) {
    if (!['EEXIST', 'EROFS', 'EACCES', 'EPERM'].includes(error.code)) throw error;
  } finally {
    if (handle) {
      await handle.close();
      await fs.unlink(temporary);
    }
  }
}
