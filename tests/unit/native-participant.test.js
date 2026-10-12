// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as runtime from 'doppler-gpu/partitions';
import { normalizeNativeDataChannel, openNativeModelSource, createNativeGpuHost, createNativeShutdown } from '../../server/native-participant.js';

const gpu = vi.hoisted(() => ({ device: null, order: [] }));
vi.mock('doppler-gpu/tooling', () => ({ getDevice: () => gpu.device, destroyBufferPool: () => gpu.order.push('pool') }));

it('settles the provider after failed participant cleanup and shares overlapping stops', async () => {
  const order = [];
  const stop = createNativeShutdown({ async close() { order.push('participant'); throw new Error('participant failed'); } },
    { async close() { order.push('provider'); throw new Error('provider failed'); } });
  const first = stop(); expect(stop()).toBe(first);
  const failure = await first.catch(error => error);
  expect(order).toEqual(['participant', 'provider']);
  expect(failure.errors.map(error => error.message)).toEqual(['participant failed', 'provider failed']);
});

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-native-')); roots.push(directory);
  const chunks = [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8])];
  const manifest = Buffer.from(JSON.stringify({ modelId: 'test', hashAlgorithm: 'sha256', shards: [{ filename: 'weights.bin', size: 8, hash: 'a'.repeat(64) }] }));
  const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: hash(manifest), maxPieceBytes: 4,
    files: [{ path: 'weights.bin', size: 8, pieces: chunks.map((chunk, i) => ({ offset: i * 4, size: 4, identity: hash(chunk) })) }] }));
  await Promise.all([fs.writeFile(path.join(directory, 'manifest.json'), manifest), fs.writeFile(path.join(directory, 'pieces.json'), index),
    fs.writeFile(path.join(directory, 'weights.bin'), Buffer.concat(chunks))]);
  return { directory, model: { id: 'test', identity: hash(manifest), source: { files: [{ role: 'model-piece-index', path: 'pieces.json', hashAlgorithm: 'sha256', hash: hash(index).slice(7) }] } } };
}

describe('native host boundary', () => {
  it('retries provider initialization and restores owned globals only after queue settlement', async () => {
    const navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const marker = Object.getOwnPropertyDescriptor(globalThis, '__nativeGpuTestBinding');
    gpu.order = [];
    gpu.device = { queue: { onSubmittedWorkDone: async () => { gpu.order.push('settled'); } }, destroy: () => gpu.order.push('device') };
    let attempts = 0;
    const host = createNativeGpuHost(async () => {
      if (++attempts === 1) throw new Error('provider temporarily unavailable');
      return { globals: { __nativeGpuTestBinding: 17 }, create: () => ({ requestAdapter() {} }) };
    });
    try {
      await expect(host.open()).rejects.toThrow('temporarily unavailable');
      await Promise.all([host.open(), host.open()]);
      expect(attempts).toBe(2); expect(globalThis.__nativeGpuTestBinding).toBe(17);
      await Promise.all([host.close(), host.close()]);
      expect(gpu.order).toEqual(['settled', 'pool', 'device']);
      expect(Object.getOwnPropertyDescriptor(globalThis, 'navigator')).toEqual(navigator);
      expect(Object.getOwnPropertyDescriptor(globalThis, '__nativeGpuTestBinding')).toEqual(marker);
      expect(() => host.open()).toThrow('closing');
    } finally { await host.close(); gpu.device = null; }
  });

  it('normalizes native unlimited values without weakening explicitly unreliable channels', () => {
    const reliable = { maxRetransmits: 65535, maxPacketLifeTime: 65535, ordered: true };
    expect(normalizeNativeDataChannel(reliable)).toBe(reliable);
    expect(reliable.maxRetransmits).toBeNull(); expect(reliable.maxPacketLifeTime).toBeNull();
    const unreliable = { maxRetransmits: 0, maxPacketLifeTime: 100, ordered: false };
    normalizeNativeDataChannel(unreliable);
    expect(unreliable).toEqual({ maxRetransmits: 0, maxPacketLifeTime: 100, ordered: false });
  });
  it('reads the required verified piece and never opens an unrelated corrupt piece', async () => {
    const { directory, model } = await fixture();
    await fs.writeFile(path.join(directory, 'weights.bin'), Buffer.from([1, 2, 3, 4, 99, 99, 99, 99]));
    const source = await openNativeModelSource({ model, modelDirectory: directory, runtime });
    try {
      await source.storage.preflight();
      expect(source.getReceipt().verifiedBytes).toBe(0);
      expect([...new Uint8Array(await source.storage.loadShardRange(0, 1, 2))]).toEqual([2, 3]);
      expect(source.getReceipt().verifiedBytes).toBe(4);
      await expect(source.storage.loadShardRange(0, 4, 2)).rejects.toThrow(/integrity/);
    } finally { await source.storage.close(); }
    await expect(source.storage.loadShardRange(0, 0, 1)).rejects.toThrow(/closed|outside/);
  });
  it('rejects changed manifest and index before weight acquisition', async () => {
    const { directory, model } = await fixture();
    await expect(openNativeModelSource({ model: { ...model, identity: 'sha256:' + '0'.repeat(64) }, modelDirectory: directory, runtime })).rejects.toThrow(/manifest/);
    await fs.writeFile(path.join(directory, 'pieces.json'), '{}');
    await expect(openNativeModelSource({ model, modelDirectory: directory, runtime })).rejects.toThrow(/index/);
  });
  it('rejects a weight symlink escaping the approved model directory', async () => {
    const { directory, model } = await fixture();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-native-external-')); roots.push(external);
    await fs.writeFile(path.join(external, 'weights.bin'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    await fs.unlink(path.join(directory, 'weights.bin'));
    await fs.symlink(path.join(external, 'weights.bin'), path.join(directory, 'weights.bin'));
    const source = await openNativeModelSource({ model, modelDirectory: directory, runtime });
    try { await expect(source.storage.loadShardRange(0, 0, 1)).rejects.toThrow(/escapes/); }
    finally { await source.storage.close(); }
  });
  it('honors cancellation before local metadata or weight reads', async () => {
    const { directory, model } = await fixture(), controller = new AbortController(); controller.abort(new Error('Stopped'));
    await expect(openNativeModelSource({ model, modelDirectory: directory, runtime, signal: controller.signal })).rejects.toThrow('Stopped');
  });
});
