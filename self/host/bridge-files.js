/** Bounded file operations for a bridge; the caller supplies writable-path authority. */
import { getTextBytes, getOpfsFileHandle, OPFS_PREFIX } from './file-access.js';
import { FILE_TEXT_LIMIT_BYTES as TEXT_LIMIT_BYTES, FILE_BINARY_LIMIT_BYTES as BINARY_LIMIT_BYTES } from '../config/vfs-policy.js';
import { bytesToBase64 as toBase64, base64ToBytes as fromBase64 } from '../../shared/vendor/reploid/artifacts/binary.js';

export function createBridgeFileTools({ vfs, normalizePath, isModelWritableVfsPath, isWritableOpfsPath }) {
const readFile = async (args = {}) => {
    const { backend, path } = normalizePath(args.path || args.file, args.backend);
    const mode = String(args.mode || 'text').toLowerCase();
    if (mode !== 'text' && mode !== 'binary') {
      throw new Error('Invalid mode. Use "text" or "binary".');
    }

    if (backend === 'vfs') {
      if (mode !== 'text') {
        throw new Error('VFS supports text mode only');
      }
      const content = await vfs.read(path);
      return {
        path,
        backend,
        encoding: 'utf-8',
        content,
        bytes: getTextBytes(content)
      };
    }

    const handle = await getOpfsFileHandle(path, { createDirs: false, createFile: false });
    const file = await handle.getFile();

    if (mode === 'text') {
      if (file.size > TEXT_LIMIT_BYTES) {
        throw new Error(`File too large (${file.size} bytes)`);
      }
      const content = await file.text();
      return {
        path,
        backend,
        encoding: 'utf-8',
        content,
        bytes: getTextBytes(content)
      };
    }

    const offset = Math.max(0, Number(args.offset || 0));
    const length = args.length === undefined ? file.size - offset : Number(args.length);
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('Invalid length');
    }
    if (length > BINARY_LIMIT_BYTES) {
      throw new Error(`Read length exceeds limit (${BINARY_LIMIT_BYTES} bytes)`);
    }
    const buffer = await file.slice(offset, offset + length).arrayBuffer();
    return {
      path,
      backend,
      encoding: 'base64',
      data: toBase64(buffer),
      bytes: buffer.byteLength
    };
  };

const writeFile = async (args = {}) => {
    const { backend, path } = normalizePath(args.path || args.file, args.backend);
    const mode = String(args.mode || 'text').toLowerCase();
    if (mode !== 'text' && mode !== 'binary') {
      throw new Error('Invalid mode. Use "text" or "binary".');
    }

    if (backend === 'vfs') {
      if (mode !== 'text') {
        throw new Error('VFS supports text mode only');
      }
      if (!isModelWritableVfsPath(path)) {
        throw new Error(`Path is not writable: ${path}`);
      }
      if (args.content === undefined) {
        throw new Error('Missing content argument');
      }
      if (args.autoLoad === true) {
        throw new Error('autoLoad is not available on direct writes. Use CreateTool for new Zero runtime tools, or LoadModule for an installed /self tool on broader surfaces.');
      }
      const content = String(args.content);
      if (getTextBytes(content) > TEXT_LIMIT_BYTES) {
        throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
      }
      await vfs.write(path, content);
      return {
        path,
        backend,
        bytesWritten: getTextBytes(content)
      };
    }

    if (!isWritableOpfsPath(path)) {
      throw new Error(`Path is not writable: ${OPFS_PREFIX}${path}`);
    }
    // Validate the entire payload before creating files or acquiring a writer.
    let payload;
    if (mode === 'text') {
      if (args.content === undefined) throw new Error('Missing content argument');
      payload = String(args.content);
      if (getTextBytes(payload) > TEXT_LIMIT_BYTES) throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
    } else {
      if (args.data === undefined) throw new Error('Missing data argument');
      payload = fromBase64(args.data);
      if (payload.byteLength > BINARY_LIMIT_BYTES) throw new Error(`Data exceeds limit (${BINARY_LIMIT_BYTES} bytes)`);
    }
    const handle = await getOpfsFileHandle(path, { createDirs: true, createFile: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(payload);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'File write failed and its writer could not be aborted'); }
      throw error;
    }
    return { path, backend, bytesWritten: mode === 'text' ? getTextBytes(payload) : payload.byteLength };
  };
  return { readFile, writeFile };
}
