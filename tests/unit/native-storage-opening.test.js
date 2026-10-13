// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { openNativeSupplyBudget } from '../../server/native-supply-budget.js';
import { openNativeReleaseCheckpoints } from '../../server/native-release-storage.js';
import { openNativeCanonicalEpochs } from '../../server/native-canonical-epochs.js';
const roots = [], stores = [], workers = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.terminate()));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
const digest = 'sha256:' + 'a'.repeat(64);
const cases = [
  { name: 'supply', file: 'custody-budget.sqlite', open: directory => openNativeSupplyBudget({ directory, maxBytes: 10 }),
    prepare: store => store.reserve(10), verify: async store => { expect(store.getState().reservedBytes).toBe(10); await expect(store.reserve(1)).rejects.toMatchObject({ code: 'CUSTODY_BUDGET_LIMIT' }); } },
  { name: 'release', file: 'release-checkpoints.sqlite', open: directory => openNativeReleaseCheckpoints({ directory }),
    prepare: store => store.advance(digest, { sequence: 0, digest: null }, { sequence: 1, digest }),
    verify: async store => expect(await store.read(digest)).toEqual({ sequence: 1, digest }) },
  { name: 'epochs', file: 'canonical-epochs.sqlite', open: directory => openNativeCanonicalEpochs({ directory, participantId: 'participant', meshId: 'mesh' }),
    prepare: () => {}, verify: store => store.assertCurrent() }
];
async function lock(filename, delay) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.filename); db.exec('BEGIN EXCLUSIVE');
    parentPort.postMessage('locked');
    setTimeout(() => { db.exec('COMMIT'); db.close(); parentPort.close(); }, workerData.delay);
  `, { eval: true, workerData: { filename, delay } });
  workers.push(worker);
  await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', resolve); });
}
it.each(cases)('opens $name after a competing startup lock without renewing state', async fixture => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-startup-lock-')); roots.push(root);
  const original = await fixture.open(root); await fixture.prepare(original); original.close();
  await lock(path.join(root, fixture.file), 100);
  const reopened = await fixture.open(root); stores.push(reopened); await fixture.verify(reopened);
});
it('surfaces exhausted opening wait and preserves already-spent allowance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-startup-timeout-')); roots.push(root);
  const initial = await cases[0].open(root); await initial.reserve(10); initial.close();
  await lock(path.join(root, cases[0].file), 10000);
  await expect(cases[0].open(root)).rejects.toMatchObject({ code: 'CUSTODY_BUDGET_STORAGE', cause: { errcode: 5 } });
  await workers.pop().terminate();
  const reopened = await cases[0].open(root); stores.push(reopened); await cases[0].verify(reopened);
});
