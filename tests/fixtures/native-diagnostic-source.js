// Offline operator-local composition. Model metadata never grants physical paths.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveServedFile } from '../../server/browser-roots.js';
import { openNativeModelSource } from '../../server/native-model-source.js';
import { snapshotNativeSourceFiles, createNativeSourceFileReader } from '../../server/native-source-files.js';
import { openDiagnosticPieceCache } from './native-piece-cache-source.js';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const plain = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/u.test(name) && !['.', '..'].includes(name);
const identityOf = stat => ({ device: stat.dev.toString(), inode: stat.ino.toString(), size: stat.size.toString() });

export async function readDiagnosticMetadata(config) {
  const manifestBytes = new Uint8Array(await fs.readFile(config.manifestPath));
  assert.equal(sha(manifestBytes), 'sha256:' + config.manifestSha256, 'Diagnostic manifest identity mismatch');
  const descriptor = config.pieceIndex;
  assert(descriptor?.role === 'model-piece-index' && descriptor.hashAlgorithm === 'sha256'
    && /^[a-f0-9]{64}$/u.test(descriptor.hash), 'Diagnostic requires pinned pieceIndex');
  const root = await fs.realpath(path.dirname(config.manifestPath));
  assert(descriptor.url?.startsWith('/config/model-pieces/') || plain(descriptor.path), 'Invalid diagnostic index path');
  const indexPath = descriptor.url?.startsWith('/config/model-pieces/')
    ? resolveServedFile(descriptor.url) : path.join(root, descriptor.path);
  const indexBytes = new Uint8Array(await fs.readFile(indexPath)), index = JSON.parse(new TextDecoder().decode(indexBytes));
  assert.equal(sha(indexBytes), 'sha256:' + descriptor.hash, 'Diagnostic piece index identity mismatch');
  assert(index.schema === 'doppler.verified-pieces/v1' && Array.isArray(index.files)
    && index.manifestIdentity === sha(manifestBytes), 'Diagnostic index manifest binding mismatch');
  assert(index.files.every(file => plain(file.path) && Number.isSafeInteger(file.size) && file.size >= 0)
    && new Set(index.files.map(file => file.path)).size === index.files.length, 'Invalid diagnostic source filename or size');
  return { root, manifestBytes, indexBytes, index, manifest: JSON.parse(new TextDecoder().decode(manifestBytes)) };
}

/** Resolve only an explicit operator map, never paths embedded in the manifest.
 * Snapshots are passed into workers, so a pathname race cannot relabel a new FD. */
export async function inspectDiagnosticSourceMap(config, metadata) {
  const policy = config.sourceMap;
  assert(policy?.schema === 'reploid.diagnostic-source-map/v1'
    && Object.keys(policy).every(key => ['schema', 'manifestIdentity', 'indexIdentity', 'files', 'tokenizerPiecesDirectory'].includes(key)),
  'Invalid diagnostic source map');
  assert.equal(policy.manifestIdentity, sha(metadata.manifestBytes), 'Diagnostic source map manifest binding mismatch');
  assert.equal(policy.indexIdentity, sha(metadata.indexBytes), 'Diagnostic source map index binding mismatch');
  const selected = snapshotNativeSourceFiles(policy.files), cacheDirectory = policy.tokenizerPiecesDirectory;
  assert(Object.keys(selected).every(name => metadata.index.files.some(file => file.path === name)), 'Undeclared diagnostic source map file');
  assert(cacheDirectory === undefined || typeof cacheDirectory === 'string' && path.isAbsolute(cacheDirectory)
    && !Object.hasOwn(selected, 'tokenizer.json'), 'Tokenizer cache requires an explicit absolute directory and no competing full-file map');
  const fullFiles = {}, readFiles = {}, identities = {}, rows = [];
  for (const file of metadata.index.files) {
    const filename = selected[file.path];
    assert(filename || file.path === 'tokenizer.json' && cacheDirectory, 'Diagnostic source map must select every indexed source');
    const row = { path: file.path, expectedBytes: file.size, available: false, reason: null };
    try {
      if (filename) {
        const canonical = await fs.realpath(filename), stat = await fs.lstat(canonical, { bigint: true });
        assert(stat.isFile() && stat.size === BigInt(file.size), 'Mapped source must be a regular file of the declared size');
        fullFiles[file.path] = canonical; readFiles[file.path] = canonical; identities[file.path] = identityOf(stat);
        row.canonicalPath = canonical;
      } else {
        const cacheRoot = await fs.realpath(cacheDirectory);
        for (const piece of file.pieces) {
          assert(Number.isSafeInteger(piece.offset) && piece.offset >= 0 && Number.isSafeInteger(piece.size) && piece.size > 0,
            'Invalid tokenizer piece range');
          const name = file.path + '.' + piece.offset, target = path.join(cacheRoot, name);
          const stat = await fs.lstat(target, { bigint: true });
          assert(stat.isFile() && stat.size === BigInt(piece.size), 'Tokenizer cache pieces must be regular exact-size files');
          readFiles[name] = target; identities[name] = identityOf(stat);
        }
        row.tokenizerPiecesDirectory = cacheRoot; row.pieceCount = file.pieces.length;
      }
      row.available = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      row.reason = 'missing approved mapped source or tokenizer piece';
    }
    rows.push(row);
  }
  return { fullFiles, readFiles, identities, rows };
}

async function assertFileCurrent(layout, name) {
  const filename = layout.readFiles[name], expected = layout.identities[name];
  assert(filename && expected, 'Undeclared diagnostic source read');
  const stat = await fs.lstat(filename, { bigint: true });
  assert(stat.isFile() && JSON.stringify(identityOf(stat)) === JSON.stringify(expected), 'Diagnostic mapped source identity changed');
}

// A batch has at most the explicitly admitted number of distinct sources.
// Dispatch independent metadata checks together and retain them until settled.
async function assertFilesCurrent(layout, names) {
  const checks = await Promise.allSettled(names.map(name => assertFileCurrent(layout, name)));
  const failed = checks.find(check => check.status === 'rejected');
  if (failed) throw failed.reason;
}

export async function openDiagnosticModelSource({ config, model, runtime, signal, onSource = () => {} }) {
  config = { ...config, pieceIndex: { ...config.pieceIndex }, workerGather: config.workerGather && { ...config.workerGather },
    ...(config.pieceCache === undefined ? {} : { pieceCache: structuredClone(config.pieceCache) }),
    ...(config.sourceMap === undefined ? {} : { sourceMap: structuredClone(config.sourceMap) }) };
  if (config.workerGather) {
    const maxRanges = config.workerGather.maxRanges === undefined ? 3 : config.workerGather.maxRanges;
    assert(Number.isSafeInteger(maxRanges) && maxRanges > 0 && maxRanges <= 32,
      'Diagnostic worker gather maxRanges must be a positive safe integer no greater than 32');
  }
  if (config.pieceCache !== undefined) {
    assert(config.sourceMap === undefined && !config.workerGather, 'Partial piece cache cannot claim full mapped sources or worker gather');
    return openDiagnosticPieceCache({ metadata: await readDiagnosticMetadata(config), model, runtime,
      policy: config.pieceCache, signal, onSource });
  }
  if (config.sourceMap === undefined) {
    const source = await openNativeModelSource({ model: { ...model, source: { files: [config.pieceIndex] } },
      modelDirectory: path.dirname(config.manifestPath), runtime, gather: config.workerGather ?? null, signal });
    try { onSource(source); signal?.throwIfAborted(); return source; }
    catch (error) {
      try { await source.storage.close(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Diagnostic source admission and cleanup failed'); }
      throw error;
    }
  }
  signal?.throwIfAborted();
  const metadata = await readDiagnosticMetadata(config);
  assert(model.capsule === undefined && model.id === metadata.manifest.modelId && model.identity === sha(metadata.manifestBytes),
    'Diagnostic mapped source must match the selected unsigned model');
  const layout = await inspectDiagnosticSourceMap(config, metadata);
  assert(layout.rows.every(row => row.available), 'Diagnostic mapped source files are unavailable');
  const read = await createNativeSourceFileReader(layout.readFiles);
  let opened, retained, closed = false, closing;
  const operations = new Set();
  const close = () => {
    closed = true;
    if (!closing) {
      const operation = (async () => {
        const owners = [() => opened?.storage.close(), () => read.close()];
        const outcomes = await Promise.allSettled(owners.map(async owner => owner()));
        await Promise.allSettled([...operations]);
        const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Diagnostic mapped source cleanup failed');
      })();
      closing = operation;
      operation.catch(() => { if (closing === operation) closing = null; });
    }
    return closing;
  };
  try {
    for (const name of Object.keys(layout.readFiles)) await assertFileCurrent(layout, name);
    signal?.throwIfAborted();
    const nodeGather = config.workerGather ? { ...config.workerGather, files: layout.fullFiles,
      fileIdentities: Object.fromEntries(Object.keys(layout.fullFiles).map(name => [name, layout.identities[name]])) } : undefined;
    opened = await runtime.createVerifiedPieceStorage({ manifestBytes: metadata.manifestBytes, indexBytes: metadata.indexBytes,
      indexIdentity: sha(metadata.indexBytes), signal, nodeGather, acquire: async (piece, control) => {
        if (closed) throw new Error('Diagnostic mapped source closed');
        const full = Object.hasOwn(layout.fullFiles, piece.path), name = full ? piece.path : piece.path + '.' + piece.offset;
        await assertFileCurrent(layout, name);
        const bytes = await read(name, { offset: full ? piece.offset : 0, size: piece.size, maxBytes: piece.size, signal: control.signal });
        await assertFileCurrent(layout, name);
        return bytes;
      } });
    const storageClose = opened.storage.close;
    // Capture the original owner: close must never recurse through the facade.
    opened = { ...opened, storage: { ...opened.storage, close: storageClose } };
    const storage = { ...opened.storage, close };
    if (nodeGather) delete storage.rangeLease;
    // Register before capability/cancellation checks so failed close has an owner
    // that the enclosing diagnostic can explicitly retry.
    retained = { ...opened, storage };
    onSource(retained);
    if (nodeGather) {
      const port = opened.storage.rangeLease;
      const maxRanges = port?.maxRanges === undefined ? 3 : port.maxRanges;
      assert(port?.fileIdentitiesBound === true && port.concurrency === (nodeGather.concurrency ?? 1)
        && Number.isSafeInteger(maxRanges) && maxRanges > 0 && maxRanges <= 32
        && maxRanges === (nodeGather.maxRanges === undefined ? 3 : nodeGather.maxRanges)
        && (maxRanges <= 3 || typeof port.readMany === 'function')
        && typeof opened.getGatherReceipt === 'function', 'Selected Doppler lacks identity-bound worker gathering');
      const guardLease = (ranges, readSignal, load, batch = false) => {
        const operation = (async () => {
          const active = signal && readSignal ? AbortSignal.any([signal, readSignal]) : signal ?? readSignal;
          active?.throwIfAborted();
          if (closed) throw new Error('Diagnostic mapped source closed');
          assert(Array.isArray(ranges) && ranges.length > 0 && ranges.length <= maxRanges,
            'Diagnostic batch exceeds its admitted ranges bound');
          const selected = ranges.map(range => {
            assert(Number.isSafeInteger(range?.shard) && range.shard >= 0 && Number.isSafeInteger(range.offset)
              && range.offset >= 0 && Number.isSafeInteger(range.length) && range.length >= (batch ? 1 : 0), 'Invalid diagnostic lease range');
            return { shard: range.shard, offset: range.offset, length: range.length };
          });
          const total = selected.reduce((sum, range) => sum + range.length, 0);
          assert(Number.isSafeInteger(total) && total <= port.maxPartBytes, 'Diagnostic lease exceeds part bound');
          const names = [...new Set(selected.map(range => metadata.manifest.shards[range.shard]?.filename))];
          assert(names.every(name => typeof name === 'string' && layout.readFiles[name] && layout.identities[name]),
            'Undeclared diagnostic source read');
          // Only this explicit identity-bound worker contract covers both job
          // boundaries, including partial-piece batches, before owned transfer.
          // Legacy readers retain their independent host-side guards.
          const workerIdentity = batch && port.fileIdentitiesBound === true
            && port.batchFileIdentityChecks === 'before-read-after-auth/v1';
          if (!workerIdentity) await assertFilesCurrent(layout, names);
          active?.throwIfAborted();
          if (closed) throw new Error('Diagnostic mapped source closed');
          const lease = await load(selected, active);
          try {
            if (!workerIdentity) await assertFilesCurrent(layout, names);
            active?.throwIfAborted();
            if (closed) throw new Error('Diagnostic mapped source closed');
            return lease;
          } catch (error) { lease.release(); throw error; }
        })();
        operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {});
        return operation;
      };
      const { readMany, ...basePort } = port;
      storage.rangeLease = { ...basePort,
        read: (shard, offset, length, readSignal) => guardLease([{ shard, offset, length }], readSignal,
          ([range], active) => port.read(range.shard, range.offset, range.length, active)),
        ...(typeof readMany === 'function' ? {
          readMany: (ranges, readSignal) => guardLease(ranges, readSignal,
            (selected, active) => readMany.call(port, selected, active), true),
        } : {}),
      };
    }
    signal?.throwIfAborted();
    assert(!closed, 'Diagnostic mapped source closed during admission');
    return retained;
  } catch (error) {
    try { await (retained ? retained.storage.close() : close()); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Diagnostic source admission and cleanup failed'); }
    throw error;
  }
}
