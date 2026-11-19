// Operator-owned partial replica. Missing pieces fail; no full-file or network fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

export async function openDiagnosticPieceCache({ metadata, model, runtime, policy, signal, onSource = () => {} }) {
  policy = structuredClone(policy);
  assert(policy?.schema === 'reploid.diagnostic-piece-cache/v1'
    && Object.keys(policy).every(key => ['schema', 'manifestIdentity', 'indexIdentity', 'directory',
      'maxPieceBytes', 'maxActiveReadBytes', 'verificationCache'].includes(key)), 'Invalid diagnostic piece cache policy');
  assert(policy.verificationCache === undefined
    || (policy.verificationCache && typeof policy.verificationCache === 'object' && !Array.isArray(policy.verificationCache)
      && typeof policy.verificationCache.directory === 'string' && path.isAbsolute(policy.verificationCache.directory)),
  'Diagnostic piece cache verificationCache requires an explicit absolute directory');
  assert.equal(policy.manifestIdentity, hash(metadata.manifestBytes), 'Piece cache manifest binding mismatch');
  assert.equal(policy.indexIdentity, hash(metadata.indexBytes), 'Piece cache index binding mismatch');
  assert(model.capsule === undefined && model.id === metadata.manifest.modelId
    && model.identity === policy.manifestIdentity, 'Piece cache requires the selected unsigned model');
  assert(typeof policy.directory === 'string' && path.isAbsolute(policy.directory), 'Explicit absolute piece cache directory required');
  assert(Number.isSafeInteger(policy.maxPieceBytes) && policy.maxPieceBytes > 0
    && policy.maxPieceBytes >= metadata.index.maxPieceBytes
    && Number.isSafeInteger(policy.maxActiveReadBytes) && policy.maxActiveReadBytes >= policy.maxPieceBytes,
  'Explicit complete-piece and active-read bounds required');
  assert(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK),
    'Piece cache requires O_NOFOLLOW and O_NONBLOCK support');
  signal?.throwIfAborted();
  const directory = await fs.realpath(policy.directory);
  const directoryStat = await fs.stat(directory, { bigint: true });
  assert(directoryStat.isDirectory(), 'Piece cache must be a directory');
  const lifetime = new AbortController(), operations = new Set(), failedHandles = new Set();
  const stats = { reads: 0, activeReadBytes: 0, peakReadBytes: 0, missingPieces: 0 };
  let opened, closed = false, closing;
  const acquire = async (piece, control) => {
    const active = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : []), ...(control?.signal ? [control.signal] : [])]);
    active.throwIfAborted();
    assert(!closed, 'Diagnostic piece cache closed');
    assert(/^[a-zA-Z0-9_.-]+$/u.test(piece.path) && !['.', '..'].includes(piece.path)
      && Number.isSafeInteger(piece.offset) && piece.offset >= 0 && Number.isSafeInteger(piece.size)
      && piece.size > 0 && piece.size <= policy.maxPieceBytes, 'Invalid authenticated cache piece');
    assert(stats.activeReadBytes + piece.size <= policy.maxActiveReadBytes, 'Piece cache active-read budget exceeded');
    stats.activeReadBytes += piece.size;
    stats.peakReadBytes = Math.max(stats.peakReadBytes, stats.activeReadBytes);
    let handle;
    try {
      const currentDirectory = await fs.lstat(directory, { bigint: true });
      assert(currentDirectory.isDirectory() && currentDirectory.dev === directoryStat.dev
        && currentDirectory.ino === directoryStat.ino, 'Piece cache directory changed');
      const filename = path.join(directory, `${piece.path}.${piece.offset}`);
      handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat({ bigint: true });
      assert(before.isFile() && before.size === BigInt(piece.size), 'Cached piece must be a complete regular file');
      const bytes = new Uint8Array(piece.size);
      let received = 0;
      while (received < bytes.length) {
        active.throwIfAborted();
        const part = await handle.read(bytes, received, bytes.length - received, received);
        assert(part.bytesRead > 0, 'Cached piece read truncated');
        received += part.bytesRead;
      }
      const after = await handle.stat({ bigint: true }), current = await fs.lstat(filename, { bigint: true });
      assert(current.isFile() && current.dev === before.dev && current.ino === before.ino
        && current.size === before.size && after.size === before.size
        && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs, 'Cached piece changed during read');
      active.throwIfAborted();
      stats.reads++;
      // Doppler authenticates these complete bytes against the exact pinned piece.
      return bytes;
    } catch (error) {
      if (error.code === 'ENOENT') stats.missingPieces++;
      throw error;
    } finally {
      try {
        if (handle) {
          try { await handle.close(); }
          catch (error) { failedHandles.add(handle); closed = true; lifetime.abort(error); throw error; }
        }
      } finally { stats.activeReadBytes -= piece.size; }
    }
  };
  const read = (piece, control) => {
    const operation = acquire(piece, control);
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  const close = () => {
    if (closing) return closing;
    closed = true;
    lifetime.abort(new Error('Diagnostic piece cache closed'));
    const operation = (async () => {
      const outcomes = await Promise.allSettled([Promise.resolve().then(() => opened?.storage.close()), ...operations]);
      const failures = outcomes.slice(0, 1).filter(row => row.status === 'rejected').map(row => row.reason);
      for (const handle of [...failedHandles]) {
        try { await handle.close(); failedHandles.delete(handle); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Diagnostic piece cache cleanup failed');
    })();
    closing = operation;
    operation.catch(() => { if (closing === operation) closing = null; });
    return operation;
  };
  try {
    opened = await runtime.createVerifiedPieceStorage({ manifestBytes: metadata.manifestBytes, indexBytes: metadata.indexBytes,
      indexIdentity: policy.indexIdentity, signal,
      ...(policy.verificationCache ? {
        nodePieceDirectory: {
          directory,
          maxPieceBytes: policy.maxPieceBytes,
          maxActiveReadBytes: policy.maxActiveReadBytes,
          verificationCache: { directory: policy.verificationCache.directory },
        },
      } : { acquire: read }) });
    const source = { ...opened, storage: { ...opened.storage, close },
      getReceipt: () => {
        const ownedReceipt = opened.getPieceDirectoryReceipt?.();
        return { ...opened.getReceipt(), pieceCache: {
          ...(ownedReceipt ?? { ...stats, pendingDescriptorCloses: failedHandles.size }),
          scope: 'Partial authenticated pieces only; no complete local model claim or whole-part gather' } };
      } };
    onSource(source);
    signal?.throwIfAborted();
    return source;
  } catch (error) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Piece cache admission and cleanup failed'); }
    throw error;
  }
}
