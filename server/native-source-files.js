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
 * One lazy descriptor per declared name is owned until the caller awaits read.close().
 * Path identity is checked on every read; bytes still require the caller's pinned
 * piece verification before use or supply. */
export async function createNativeSourceFileReader(sourceFilePaths) {
  const approved = snapshotNativeSourceFiles(sourceFilePaths);
  const sources = new Map();
  for (const [name, filename] of Object.entries(approved)) {
    const canonical = await fs.realpath(filename);
    const stat = await fs.lstat(canonical);
    if (!stat.isFile()) throw new Error('Native mapped source must be a regular file');
    sources.set(name, { filename: canonical, device: stat.dev, inode: stat.ino, size: stat.size });
  }
  const handles = new Map(), operations = new Set(), failedAdmissionHandles = new Set(), lifetime = new AbortController();
  let closed = false, closing = null;
  const unchanged = (stat, source) => stat.isFile() && stat.dev === source.device
    && stat.ino === source.inode && stat.size === source.size;
  const handleFor = (name, source) => {
    if (!handles.has(name)) {
      const opening = (async () => {
        const handle = await fs.open(source.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (!unchanged(await handle.stat(), source)) throw new Error('Native mapped source changed after local approval');
          return handle;
        } catch (error) {
          try { await handle.close(); }
          catch (cleanup) {
            failedAdmissionHandles.add(handle);
            closed = true;
            lifetime.abort(error);
            throw new AggregateError([error, cleanup], 'Mapped source admission and cleanup failed');
          }
          throw error;
        }
      })().catch(error => {
        if (handles.get(name) === opening) handles.delete(name);
        throw error;
      });
      handles.set(name, opening);
    }
    return handles.get(name);
  };
  const readApproved = async (name, { offset, size, signal, maxBytes }) => {
    if (closed) throw new Error('Native mapped source reader closed');
    signal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    signal?.throwIfAborted();
    const source = sources.get(name);
    if (!source) return null;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 1
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || size > maxBytes
      || !Number.isSafeInteger(offset + size) || offset + size > source.size) {
      throw new Error('Invalid mapped source piece range');
    }
    // Retaining the approved descriptor does not grant a replaced pathname or
    // a new leaf symlink. Check its current identity before every positioned read.
    if (!unchanged(await fs.lstat(source.filename), source)) {
      throw new Error('Native mapped source changed after local approval');
    }
    const handle = await handleFor(name, source);
    const bytes = new Uint8Array(size);
    let received = 0;
    while (received < size) {
      signal.throwIfAborted();
      const part = await handle.read(bytes, received, size - received, offset + received);
      if (part.bytesRead < 1) throw new Error('Truncated mapped source piece');
      received += part.bytesRead;
    }
    signal.throwIfAborted();
    return bytes;
  };
  const read = (name, options) => {
    const operation = readApproved(name, options);
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  read.close = () => {
    if (closing) return closing;
    closed = true;
    lifetime.abort(new Error('Native mapped source reader closed'));
    const operation = (async () => {
      // Even a cancelled read owns its file handle until the actual I/O settles.
      await Promise.allSettled([...operations]);
      const entries = [...handles.entries(), ...[...failedAdmissionHandles].map(handle => [null, Promise.resolve(handle)])];
      const results = await Promise.allSettled(entries.map(async ([, handle]) => (await handle).close()));
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          const [name, handle] = entries[index];
          if (name !== null) handles.delete(name);
          else failedAdmissionHandles.delete(await handle);
        }
      }
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Native mapped source cleanup failed');
    })();
    closing = operation;
    operation.catch(() => { if (closing === operation) closing = null; });
    return operation;
  };
  return Object.freeze(read);
}
