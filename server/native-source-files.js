import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

/** Local host configuration only. Never derive physical paths from model metadata. */
export function snapshotNativeSourceFiles(sourceFilePaths = {}) {
  if (!sourceFilePaths || typeof sourceFilePaths !== 'object' || Array.isArray(sourceFilePaths)) {
    throw new Error('Native source file paths require an explicit local filename map');
  }
  const entries = Object.entries(sourceFilePaths);
  for (const [name, filename] of entries) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..'
      || typeof filename !== 'string' || !path.isAbsolute(filename)) {
      throw new Error('Native source mapping requires plain filenames and absolute local paths');
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

/** Reads only exact owner-selected files; containing directories are not granted.
 * Bytes still require the caller's pinned piece verification before use or supply. */
export async function createNativeSourceFileReader(sourceFilePaths) {
  const approved = snapshotNativeSourceFiles(sourceFilePaths);
  const sources = new Map();
  for (const [name, filename] of Object.entries(approved)) {
    const canonical = await fs.realpath(filename);
    const stat = await fs.lstat(canonical);
    if (!stat.isFile()) throw new Error('Native mapped source must be a regular file');
    sources.set(name, { filename: canonical, device: stat.dev, inode: stat.ino, size: stat.size });
  }
  return async (name, { offset, size, signal, maxBytes }) => {
    signal?.throwIfAborted();
    const source = sources.get(name);
    if (!source) return null;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 1
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || size > maxBytes
      || !Number.isSafeInteger(offset + size) || offset + size > source.size) {
      throw new Error('Invalid mapped source piece range');
    }
    let handle;
    try {
      handle = await fs.open(source.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== source.device || stat.ino !== source.inode || stat.size !== source.size) {
        throw new Error('Native mapped source changed after local approval');
      }
      const bytes = new Uint8Array(size);
      let received = 0;
      while (received < size) {
        signal?.throwIfAborted();
        const part = await handle.read(bytes, received, size - received, offset + received);
        if (part.bytesRead < 1) throw new Error('Truncated mapped source piece');
        received += part.bytesRead;
      }
      signal?.throwIfAborted();
      return bytes;
    } finally { await handle?.close(); }
  };
}
