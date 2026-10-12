// @vitest-environment node
import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { openNativeReleaseCheckpoints } from '../../server/native-release-storage.js';

const directories = [], stores = [];
const digest = char => 'sha256:' + char.repeat(64);
const namespace = digest('a'), zero = { sequence: 0, digest: null };
async function directory() { const value = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-releases-')); directories.push(value); return value; }
async function open(root) { const store = await openNativeReleaseCheckpoints({ directory: root }); stores.push(store); return store; }
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

it('persists a monotonic checkpoint across reopen and rejects rollback or forks', async () => {
  const root = await directory(), first = await open(root), next = { sequence: 1, digest: digest('b') };
  expect(await first.read(namespace)).toEqual(zero);
  expect(await first.advance(namespace, zero, next)).toEqual(next); first.close();
  const second = await open(root);
  expect(await second.read(namespace)).toEqual(next);
  expect(await second.advance(namespace, zero, next)).toEqual(next);
  await expect(second.advance(namespace, next, { sequence: 1, digest: digest('c') })).rejects.toThrow('rollback or fork');
  expect(await second.advance(namespace, next, { sequence: 2, digest: digest('d') })).toMatchObject({ sequence: 2 });
  await expect(second.advance(namespace, { sequence: 2, digest: digest('d') }, next)).rejects.toThrow('rollback or fork');
  await expect(second.read('../escape')).rejects.toThrow('namespace');
});

it('allows only one conflicting concurrent compare-and-swap across independent handles', async () => {
  const root = await directory(), a = await open(root), b = await open(root);
  const nextA = { sequence: 1, digest: digest('b') }, nextB = { sequence: 1, digest: digest('c') };
  const outcomes = await Promise.allSettled([a.advance(namespace, zero, nextA), b.advance(namespace, zero, nextB)]);
  expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'rejected']);
  expect(outcomes[1].reason.message).toContain('checkpoint changed');
  expect(await b.read(namespace)).toEqual(nextA);
  expect(await b.advance(namespace, nextA, { sequence: 2, digest: digest('d') })).toMatchObject({ sequence: 2 });
});

it('serializes competing writers in separate workers without accepting a fork', async () => {
  const root = await directory(), initial = await open(root); await initial.read(namespace);
  const workers = [digest('b'), digest('c')].map(value => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { openNativeReleaseCheckpoints } = await import(workerData.module);
      const store = await openNativeReleaseCheckpoints({ directory: workerData.directory });
      parentPort.once('message', async () => {
        let result;
        try { result = { ok: true, checkpoint: await store.advance(workerData.namespace,
          { sequence: 0, digest: null }, { sequence: 1, digest: workerData.digest }) }; }
        catch (error) { result = { ok: false, error: error.message }; }
        finally { store.close(); }
        parentPort.postMessage(result); parentPort.close();
      });
      parentPort.postMessage('ready');
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { module: new URL('../../server/native-release-storage.js', import.meta.url).href,
    directory: root, namespace, digest: value } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
      worker.once('error', reject); worker.once('message', resolve);
    })));
    const outcomes = workers.map(worker => new Promise((resolve, reject) => {
      worker.once('error', reject); worker.once('message', resolve);
    }));
    workers.forEach(worker => worker.postMessage('advance'));
    const results = await Promise.all(outcomes);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok).error).toMatch(/checkpoint changed|locked/);
    expect(await initial.read(namespace)).toEqual(results.find(result => result.ok).checkpoint);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});

it('fails closed for corrupt storage and symlink targets', async () => {
  const root = await directory(), file = path.join(root, 'release-checkpoints.sqlite');
  await fs.writeFile(file, 'not a checkpoint database');
  await expect(openNativeReleaseCheckpoints({ directory: root })).rejects.toThrow();
  await fs.unlink(file); await fs.symlink('/etc/passwd', file);
  await expect(openNativeReleaseCheckpoints({ directory: root })).rejects.toThrow();
});

it('rejects invalid persisted records without resetting their history', async () => {
  const root = await directory(), store = await open(root);
  await store.read(namespace); store.close();
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path.join(root, 'release-checkpoints.sqlite'));
  database.prepare('UPDATE checkpoints SET sequence = -1 WHERE namespace = ?').run(namespace); database.close();
  const reopened = await open(root);
  await expect(reopened.read(namespace)).rejects.toThrow('stored checkpoint');
  reopened.close(); await expect(reopened.read(namespace)).rejects.toThrow('store closed');
});
