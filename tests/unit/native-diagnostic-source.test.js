// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as installed from 'doppler-gpu/partitions';
import { openDiagnosticModelSource } from '../fixtures/native-diagnostic-source.js';
import { inspectDiagnosticModel, openDiagnosticWholeModel } from '../fixtures/native-diagnostic-whole.js';

const roots = [], owners = [];
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const encode = value => new TextEncoder().encode(JSON.stringify(value));
afterEach(async () => {
  await Promise.allSettled(owners.splice(0).map(owner => owner.storage.close()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-source-')); roots.push(root);
  const metadata = path.join(root, 'metadata'), cache = path.join(root, 'pieces');
  await fs.mkdir(metadata); await fs.mkdir(cache);
  const filename = path.join(root, 'approved.bin'), alias = path.join(root, 'selected.gguf');
  const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), tokenizer = encode({ model: { type: 'BPE', vocab: {} } });
  await fs.writeFile(filename, bytes); await fs.symlink(filename, alias);
  const manifestBytes = encode({ modelId: 'mapped-fixture', hashAlgorithm: 'sha256',
    shards: [{ filename: 'weights.bin', size: bytes.length, hash: sha(bytes).slice(7) }] });
  const pieces = (value, chunk) => Array.from({ length: Math.ceil(value.length / chunk) }, (_, i) => {
    const offset = i * chunk, part = value.subarray(offset, offset + chunk);
    return { offset, size: part.length, identity: sha(part) };
  });
  const tokenizerPieces = pieces(tokenizer, 16);
  const indexBytes = encode({ schema: 'doppler.verified-pieces/v1', manifestIdentity: sha(manifestBytes), maxPieceBytes: 16,
    files: [{ path: 'weights.bin', size: bytes.length, pieces: pieces(bytes, 4) },
      { path: 'tokenizer.json', size: tokenizer.length, pieces: tokenizerPieces }] });
  await fs.writeFile(path.join(metadata, 'manifest.json'), manifestBytes);
  await fs.writeFile(path.join(metadata, 'pieces.json'), indexBytes);
  await Promise.all(tokenizerPieces.map(piece => fs.writeFile(path.join(cache, 'tokenizer.json.' + piece.offset),
    tokenizer.subarray(piece.offset, piece.offset + piece.size))));
  const config = { manifestPath: path.join(metadata, 'manifest.json'), manifestSha256: sha(manifestBytes).slice(7),
    pieceIndex: { role: 'model-piece-index', path: 'pieces.json', hashAlgorithm: 'sha256', hash: sha(indexBytes).slice(7) },
    sourceMap: { schema: 'reploid.diagnostic-source-map/v1', manifestIdentity: sha(manifestBytes), indexIdentity: sha(indexBytes),
      files: { 'weights.bin': alias }, tokenizerPiecesDirectory: cache } };
  const admissions = [], runtime = { async createVerifiedPieceStorage(options) {
    admissions.push(options); return installed.createVerifiedPieceStorage({ ...options, nodeGather: undefined });
  } };
  return { root, metadata, cache, filename, alias, bytes, tokenizer, manifestBytes, config, runtime, admissions,
    model: { id: 'mapped-fixture', identity: sha(manifestBytes) } };
}
async function own(f) { const source = await openDiagnosticModelSource(f); owners.push(source); return source; }

it('pins approved symlink targets and uses authenticated tokenizer pieces without canonical copies', async () => {
  const f = await fixture(), selected = f.config.sourceMap.files;
  const opening = own(f); selected['weights.bin'] = '/not-approved';
  const source = await opening;
  expect((await inspectDiagnosticModel({ ...f.config, sourceMap: { ...f.config.sourceMap, files: { 'weights.bin': f.alias } } })).readyForWholeModel).toBe(true);
  await fs.unlink(f.alias); await fs.writeFile(f.alias, Uint8Array.of(9, 9, 9, 9, 9, 9, 9, 9));
  expect([...new Uint8Array(await source.storage.loadShardRange(0, 0, 8))]).toEqual([...f.bytes]);
  expect([...new Uint8Array(await source.storage.loadAuxiliaryFile('tokenizer.json'))]).toEqual([...f.tokenizer]);
  expect(source.getReceipt().verifiedBytes).toBe(8 + f.tokenizer.length);
  await expect(fs.stat(path.join(f.metadata, 'weights.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  await source.storage.close();
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed/);
});

it('binds maps to the exact manifest/index and rejects undeclared files before runtime admission', async () => {
  const f = await fixture();
  for (const field of ['manifestIdentity', 'indexIdentity']) {
    await expect(own({ ...f, config: { ...f.config, sourceMap: { ...f.config.sourceMap, [field]: 'sha256:' + '0'.repeat(64) } } })).rejects.toThrow('binding mismatch');
  }
  await expect(own({ ...f, model: { ...f.model, id: 'different' } })).rejects.toThrow('selected unsigned model');
  await expect(own({ ...f, config: { ...f.config, sourceMap: { ...f.config.sourceMap,
    files: { ...f.config.sourceMap.files, unknown: f.filename } } } })).rejects.toThrow('Undeclared');
  await expect(own({ ...f, config: { ...f.config, sourceMap: { ...f.config.sourceMap, files: {} } } })).rejects.toThrow('select every');
  expect(f.admissions).toHaveLength(0);
});

it('rejects canonical inode swaps and in-place corruption, preserving recovery', async () => {
  const f = await fixture(), source = await own(f), retained = path.join(f.root, 'retained');
  await fs.rename(f.filename, retained); await fs.writeFile(f.filename, f.bytes);
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow('identity changed');
  await fs.unlink(f.filename); await fs.rename(retained, f.filename);
  await source.storage.loadShardRange(0, 0, 4);
  await fs.writeFile(f.filename, Uint8Array.of(9, 2, 3, 4, 5, 6, 7, 8));
  await expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow('integrity mismatch');
  await fs.writeFile(f.filename, f.bytes);
  expect([...new Uint8Array(await source.storage.loadShardRange(0, 0, 4))]).toEqual([1, 2, 3, 4]);
});

it('rejects tokenizer cache symlinks and wrong-size mapped files', async () => {
  const f = await fixture(), piece = path.join(f.cache, 'tokenizer.json.0');
  await fs.unlink(piece); await fs.symlink(f.filename, piece);
  await expect(own(f)).rejects.toThrow('regular exact-size');
  await fs.unlink(piece); await fs.writeFile(piece, f.tokenizer.subarray(0, 16));
  await fs.writeFile(f.filename, Uint8Array.of(1));
  await expect(own(f)).rejects.toThrow('declared size');
  expect(f.admissions).toHaveLength(0);
});

it('settles cancelled in-flight I/O before descriptor close and retains failed close for retry', async () => {
  const f = await fixture(), source = await own(f);
  let entered, release, handle;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const original = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    handle = await original(...args); const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...values) => { entered(); await gate; return read(...values); });
    return handle;
  });
  const pending = expect(source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed/);
  await started;
  const close = vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('descriptor close pending'));
  let finished = false;
  const closing = expect(source.storage.close()).rejects.toThrow('cleanup failed').then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(finished).toBe(false); expect(close).not.toHaveBeenCalled();
  release(); await pending; await closing;
  await source.storage.close(); expect(close).toHaveBeenCalledTimes(2);
});

it('stops aborted admission and fails closed when the runtime lacks identity-bound gather', async () => {
  const f = await fixture(), abort = new AbortController(); abort.abort(new Error('cancel admission'));
  await expect(own({ ...f, signal: abort.signal })).rejects.toThrow('cancel admission');
  expect(f.admissions).toHaveLength(0);
  f.config.workerGather = { concurrency: 2, maxPartBytes: 16, memoryBudgetBytes: 96 };
  await expect(own(f)).rejects.toThrow('identity-bound worker');
  expect(f.admissions[0].nodeGather.files['weights.bin']).toBe(await fs.realpath(f.filename));
  expect(f.admissions[0].nodeGather.fileIdentities['weights.bin'].size).toBe('8');
});

it('retains an admitted source when capability rejection and immediate cleanup both fail', async () => {
  const f = await fixture(), create = f.runtime.createVerifiedPieceStorage, closeFailure = new Error('source close pending');
  let attempts = 0, retained;
  f.config.workerGather = { concurrency: 2, maxPartBytes: 16, memoryBudgetBytes: 96 };
  f.runtime.createVerifiedPieceStorage = async options => {
    const source = await create(options), close = source.storage.close;
    source.storage.close = async () => { if (++attempts === 1) throw closeFailure; await close(); };
    return source;
  };
  await expect(openDiagnosticModelSource({ ...f, onSource(source) { retained = source; owners.push(source); } }))
    .rejects.toMatchObject({ errors: [expect.any(Error), expect.any(AggregateError)] });
  expect(retained).toBeDefined();
  await retained.storage.close(); expect(attempts).toBe(2);
  await expect(retained.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed/);
});

it('uses mapped storage through the whole loader and retains normal unload/close ownership', async () => {
  const f = await fixture(), sources = [], unload = vi.fn();
  const opened = await openDiagnosticWholeModel({ ...f, onSource: source => { sources.push(source); owners.push(source); },
    load: async input => {
      expect(input).not.toHaveProperty('url');
      expect([...new Uint8Array(await input.storageContext.loadShardRange(0, 4, 4))]).toEqual([5, 6, 7, 8]);
      return { unload };
    } });
  expect(opened.source).toBe(sources[0]); expect(unload).not.toHaveBeenCalled();
  await opened.model.unload(); await opened.source.storage.close();
  expect(unload).toHaveBeenCalledOnce();
});
