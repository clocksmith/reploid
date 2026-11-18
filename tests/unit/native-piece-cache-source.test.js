// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as runtime from 'doppler-gpu/partitions';
import { openDiagnosticModelSource } from '../fixtures/native-diagnostic-source.js';

const roots = [], owners = [];
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const encode = value => new TextEncoder().encode(JSON.stringify(value));
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(owners.splice(0).map(owner => owner.storage.close()));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-piece-cache-')); roots.push(root);
  const cache = path.join(root, 'cache'); await fs.mkdir(cache);
  const data = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  const manifestBytes = encode({ modelId: 'partial-cache-test', hashAlgorithm: 'sha256',
    shards: [{ filename: 'weights.bin', size: data.length, hash: hash(data).slice(7) }] });
  const indexBytes = encode({ schema: 'doppler.verified-pieces/v1', manifestIdentity: hash(manifestBytes), maxPieceBytes: 4,
    files: [{ path: 'weights.bin', size: 8, pieces: [0, 4].map(offset => ({ offset, size: 4,
      identity: hash(data.subarray(offset, offset + 4)) })) }] });
  await fs.writeFile(path.join(root, 'manifest.json'), manifestBytes);
  await fs.writeFile(path.join(root, 'pieces.json'), indexBytes);
  const piece = path.join(cache, 'weights.bin.0'); await fs.writeFile(piece, data.subarray(0, 4));
  const config = { manifestPath: path.join(root, 'manifest.json'), manifestSha256: hash(manifestBytes).slice(7),
    pieceIndex: { role: 'model-piece-index', path: 'pieces.json', hashAlgorithm: 'sha256', hash: hash(indexBytes).slice(7) },
    pieceCache: { schema: 'reploid.diagnostic-piece-cache/v1', manifestIdentity: hash(manifestBytes),
      indexIdentity: hash(indexBytes), directory: cache, maxPieceBytes: 4, maxActiveReadBytes: 8 } };
  return { root, cache, data, piece, config, model: { id: 'partial-cache-test', identity: hash(manifestBytes) }, runtime,
    onSource(source) { owners.push(source); } };
}

it('authenticates available pieces without claiming a complete source or adding a fallback', async () => {
  const f = await fixture(), source = await openDiagnosticModelSource(f);
  expect([...new Uint8Array(await source.storage.loadShardRange(0, 0, 4))]).toEqual([1, 2, 3, 4]);
  await expect(source.storage.loadShardRange(0, 4, 4)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(source.getReceipt()).toMatchObject({ verifiedBytes: 4,
    pieceCache: { reads: 1, activeReadBytes: 0, missingPieces: 1 } });
  expect(source.storage.rangeLease).toBeUndefined();
  await source.storage.close();
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed/u);
});

it('rejects corrupted bytes, symlinks and incomplete cached pieces', async () => {
  for (const mode of ['corrupt', 'symlink', 'truncated']) {
    const f = await fixture(), source = await openDiagnosticModelSource(f);
    if (mode === 'corrupt') await fs.writeFile(f.piece, Uint8Array.of(9, 2, 3, 4));
    if (mode === 'truncated') await fs.writeFile(f.piece, Uint8Array.of(1));
    if (mode === 'symlink') {
      const other = path.join(f.root, 'unapproved'); await fs.writeFile(other, f.data.subarray(0, 4));
      await fs.unlink(f.piece); await fs.symlink(other, f.piece);
    }
    await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow();
    expect(source.getReceipt().pieceCache.activeReadBytes).toBe(0);
  }
});

it('rejects mismatched bindings, whole-part gather and conflicting source maps before runtime admission', async () => {
  const f = await fixture(), create = vi.fn();
  const selected = { ...f, runtime: { createVerifiedPieceStorage: create } };
  for (const config of [
    { ...f.config, pieceCache: { ...f.config.pieceCache, manifestIdentity: 'sha256:' + '0'.repeat(64) } },
    { ...f.config, pieceCache: { ...f.config.pieceCache, indexIdentity: 'sha256:' + '0'.repeat(64) } },
    { ...f.config, pieceCache: { ...f.config.pieceCache, maxPieceBytes: 3 } },
    { ...f.config, workerGather: { maxPartBytes: 4 } }, { ...f.config, sourceMap: {} },
  ]) await expect(openDiagnosticModelSource({ ...selected, config })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

it('waits for a cancelled real file read before closing its descriptor', async () => {
  const f = await fixture(), source = await openDiagnosticModelSource(f);
  let entered, release, descriptor;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    descriptor = await original(...args); const read = descriptor.read.bind(descriptor);
    vi.spyOn(descriptor, 'read').mockImplementation(async (...values) => { entered(); await gate; return read(...values); });
    return descriptor;
  });
  const pending = expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed/u);
  await started;
  const close = vi.spyOn(descriptor, 'close');
  let finished = false;
  const closing = source.storage.close().then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(finished).toBe(false); expect(close).not.toHaveBeenCalled();
  release(); await pending; await closing;
  expect(close).toHaveBeenCalledOnce();
  expect(source.getReceipt().pieceCache.activeReadBytes).toBe(0);
});

it('bounds concurrent reads instead of allocating past the configured cache budget', async () => {
  const f = await fixture(); f.config.pieceCache.maxActiveReadBytes = 4;
  let acquire;
  const selectedRuntime = { async createVerifiedPieceStorage(options) {
    acquire = options.acquire;
    return { storage: { async close() {} }, getReceipt: () => ({}) };
  } };
  await openDiagnosticModelSource({ ...f, runtime: selectedRuntime });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const descriptor = await original(...args), read = descriptor.read.bind(descriptor);
    vi.spyOn(descriptor, 'read').mockImplementation(async (...values) => { entered(); await gate; return read(...values); });
    return descriptor;
  });
  const piece = { path: 'weights.bin', offset: 0, size: 4 };
  const first = acquire(piece); await started;
  await expect(acquire(piece)).rejects.toThrow('active-read budget');
  release(); expect([...await first]).toEqual([1, 2, 3, 4]);
});

it('retains failed descriptor closes for an explicit cleanup retry', async () => {
  const f = await fixture(), source = await openDiagnosticModelSource(f);
  const original = fs.open.bind(fs);
  let close;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const descriptor = await original(...args), finish = descriptor.close.bind(descriptor);
    close = vi.spyOn(descriptor, 'close')
      .mockRejectedValueOnce(new Error('descriptor close pending'))
      .mockRejectedValueOnce(new Error('descriptor close still pending'))
      .mockImplementation(finish);
    return descriptor;
  });
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow('descriptor close pending');
  expect(source.getReceipt().pieceCache.pendingDescriptorCloses).toBe(1);
  await expect(source.storage.close()).rejects.toThrow('cleanup failed');
  await source.storage.close();
  expect(close).toHaveBeenCalledTimes(3);
  expect(source.getReceipt().pieceCache.pendingDescriptorCloses).toBe(0);
});


it.skipIf(process.platform === 'win32')('rejects a FIFO and settles cleanup without waiting for a writer', async () => {
  const f = await fixture();
  await fs.unlink(f.piece);
  execFileSync('mkfifo', [f.piece]);
  const source = await openDiagnosticModelSource(f);
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/regular file/u);
  await source.storage.close();
  expect(source.getReceipt().pieceCache.activeReadBytes).toBe(0);
}, 2000);
