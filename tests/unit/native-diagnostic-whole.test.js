// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import * as installed from 'doppler-gpu/partitions';
import { openDiagnosticWholeModel, closeDiagnosticSources } from '../fixtures/native-diagnostic-whole.js';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => new TextEncoder().encode(JSON.stringify(value));
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-whole-')); roots.push(directory);
  const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  const manifestBytes = encode({ modelId: 'whole-fixture', hashAlgorithm: 'sha256',
    shards: [{ filename: 'weights.bin', size: bytes.length, hash: sha(bytes) }] });
  const indexBytes = encode({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + sha(manifestBytes), maxPieceBytes: 4,
    files: [{ path: 'weights.bin', size: 8, pieces: [0, 4].map(offset => ({ offset, size: 4, identity: 'sha256:' + sha(bytes.subarray(offset, offset + 4)) })) }] });
  const manifestPath = path.join(directory, 'manifest.json');
  await Promise.all([['manifest.json', manifestBytes], ['pieces.json', indexBytes], ['weights.bin', bytes]]
    .map(([name, value]) => fs.writeFile(path.join(directory, name), value)));
  const config = { manifestPath, manifestSha256: sha(manifestBytes), modelUrl: 'https://must-not-fetch.invalid/',
    pieceIndex: { path: 'pieces.json', role: 'model-piece-index', hashAlgorithm: 'sha256', hash: sha(indexBytes) },
    runtimeConfig: { loading: { expertCache: { qwen35Routed: { sourceReadMode: 'lease-parallel' } } } },
    workerGather: { maxPartBytes: 8, memoryBudgetBytes: 32, concurrency: 2 } };
  const sources = [], admissions = [];
  const runtime = { async createVerifiedPieceStorage(options) {
    admissions.push(options);
    // Real installed complete-piece authentication backs this adapter test.
    // The port below tests handoff/ownership, not new-worker performance.
    const source = await installed.createVerifiedPieceStorage({ ...options, nodeGather: undefined });
    source.storage.rangeLease = { ...config.workerGather, memoryBytes: 32, async read(shard, offset, length) {
      const buffer = await source.storage.loadShardRange(shard, offset, length);
      return { bytes: new Uint8Array(buffer), release() { structuredClone(buffer, { transfer: [buffer] }); } };
    } };
    source.getGatherReceipt = async () => ({ scope: 'generic-backed test lease', ...source.getReceipt() });
    return source;
  } };
  return { directory, bytes, manifestBytes, config, runtime, sources, admissions,
    model: { id: 'whole-fixture', identity: 'sha256:' + sha(manifestBytes) }, onSource: source => sources.push(source) };
}

it('loads the exact inline manifest through owned authenticated storage without URL fallback', async () => {
  const f = await fixture(), signal = new AbortController().signal, model = { unload: vi.fn() };
  const load = vi.fn(async (input, options) => {
    expect(input).not.toHaveProperty('url');
    expect(input.manifestText).toBe(new TextDecoder().decode(f.manifestBytes));
    expect(input.manifestHash).toBe(f.config.manifestSha256);
    expect(input.manifest.modelId).toBe(f.model.id);
    expect(options).toEqual({ runtimeConfig: f.config.runtimeConfig, isolatedLoader: true, signal });
    const lease = await input.storageContext.rangeLease.read(0, 4, 4, signal);
    expect([...lease.bytes]).toEqual([5, 6, 7, 8]); lease.release(); expect(lease.bytes.byteLength).toBe(0);
    return model;
  });
  const opened = await openDiagnosticWholeModel({ ...f, load, signal });
  expect(opened.model).toBe(model); expect(opened.source).toBe(f.sources[0]);
  expect(f.admissions[0].nodeGather).toMatchObject(f.config.workerGather);
  expect(f.sources[0].getReceipt().verifiedBytes).toBe(4);
  expect(model.unload).not.toHaveBeenCalled();
  await model.unload(); await closeDiagnosticSources(f.sources);
  await expect(opened.source.storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed|outside/);
});

it('rejects changed captured manifest bytes and model labels before storage admission', async () => {
  const f = await fixture(), load = vi.fn();
  await expect(openDiagnosticWholeModel({ ...f, manifestBytes: encode({ modelId: 'other' }), load })).rejects.toThrow('bytes changed');
  await expect(openDiagnosticWholeModel({ ...f, model: { ...f.model, id: 'other' }, load })).rejects.toThrow('model id mismatch');
  await expect(openDiagnosticWholeModel({ ...f, config: { ...f.config, pieceIndex: null }, load })).rejects.toThrow('pinned pieceIndex');
  expect(f.admissions).toHaveLength(0); expect(load).not.toHaveBeenCalled();
});

it('retains failed load owners, closes them and allows an independent retry', async () => {
  const f = await fixture(), failure = new Error('load rejected');
  await expect(openDiagnosticWholeModel({ ...f, load: async () => { throw failure; } })).rejects.toBe(failure);
  expect(f.sources).toHaveLength(1);
  await expect(f.sources[0].storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed|outside/);
  const retry = await openDiagnosticWholeModel({ ...f, load: async () => ({ unload() {} }) });
  expect(f.sources).toHaveLength(2);
  expect([...new Uint8Array(await retry.source.storage.loadShardRange(0, 0, 4))]).toEqual([1, 2, 3, 4]);
  await closeDiagnosticSources(f.sources);
});

it('stops after cancellation between source admission and model loading', async () => {
  const f = await fixture(), abort = new AbortController(), load = vi.fn();
  await expect(openDiagnosticWholeModel({ ...f, signal: abort.signal, load, onSource(source) {
    f.onSource(source); source.storage.close = vi.fn(source.storage.close);
    abort.abort(new Error('whole admission cancelled'));
  } })).rejects.toThrow('whole admission cancelled');
  expect(load).not.toHaveBeenCalled();
  expect(f.sources[0].storage.close).toHaveBeenCalledOnce();
  await expect(f.sources[0].storage.loadShardRange(0, 0, 4)).rejects.toThrow('whole admission cancelled');
});

it('preserves load and cleanup errors and retries the retained owner', async () => {
  const f = await fixture(), loadFailure = new Error('load failed'), cleanupFailure = new Error('close failed');
  let attempts = 0;
  await expect(openDiagnosticWholeModel({ ...f, onSource(source) {
    f.onSource(source); const close = source.storage.close;
    source.storage.close = async () => { if (++attempts === 1) throw cleanupFailure; await close(); };
  }, load: async () => { throw loadFailure; } })).rejects.toMatchObject({ errors: [loadFailure, cleanupFailure] });
  await closeDiagnosticSources(f.sources); expect(attempts).toBe(2);
  await expect(f.sources[0].storage.loadShardRange(0, 0, 4)).rejects.toThrow(/closed|outside/);
});

it('attempts every retained source even when one cleanup throws synchronously', async () => {
  let fail = true;
  const first = vi.fn(() => { if (fail) { fail = false; throw new Error('first close failed'); } });
  const second = vi.fn(async () => {});
  const sources = [{ storage: { close: first } }, { storage: { close: second } }];
  await expect(closeDiagnosticSources(sources)).rejects.toThrow('Diagnostic source cleanup failed');
  expect(second).toHaveBeenCalledOnce();
  await closeDiagnosticSources(sources);
  expect(first).toHaveBeenCalledTimes(2);
});
