import fs from 'node:fs/promises';
import policy from '../apps/poolday/config/chat-files.json' with { type: 'json' };
import { resolveServedFile } from './browser-roots.js';
import { sha256Hex } from './hashing.js';
import { readPinnedOrigin } from './native-model-origin.js';

const bundled = /^\/config\/model-(manifests|pieces|artifacts)\/[a-zA-Z0-9_.-]+$/;

function checkMetadata(file, bytes) {
  if (file.hashAlgorithm !== 'sha256' || bytes.byteLength !== file.sizeBytes || sha256Hex(bytes) !== file.hash) {
    throw new Error(`Model metadata differs from the pinned catalog (${file.path})`);
  }
  return bytes;
}

export async function readBundledModelMetadata(file) {
  if (!bundled.test(file?.url || '')) return null;
  let bytes;
  try { bytes = await fs.readFile(resolveServedFile(file.url)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return checkMetadata(file, new Uint8Array(bytes));
}

/** Origin metadata must match the exact same size and identity as a local or peer copy. */
export async function readOriginModelMetadata(origin, file, signal) {
  if (!file || file.hashAlgorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(file.hash)
    || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > policy.maxArtifactBytes) {
    throw new Error('Remote model metadata needs a bounded SHA-256 catalog pin');
  }
  return checkMetadata(file, await readPinnedOrigin(origin, file.path, { size: file.sizeBytes, whole: true, signal }));
}
