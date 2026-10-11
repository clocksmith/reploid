import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { physicalEmbeddingAssets } from '../fixtures/physical-embedding-assets.js';

let server, origin, physicalConfig;
test.beforeAll(async () => {
  const root = path.resolve('.');
  const installedRoot = process.env.REPLOID_UNITS_INSTALLED_ROOT ? path.resolve(process.env.REPLOID_UNITS_INSTALLED_ROOT) : null;
  const assets = await physicalEmbeddingAssets(process.env.REPLOID_UNITS_PHYSICAL_CONFIG);
  physicalConfig = assets.configuration;
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (assets.serve(pathname, response)) return;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Independent units</title><script type="importmap">{"imports":{"reploid/jobs":"/packages/reploid/src/mesh/jobs/index.js"}}</script>');
        return;
      }
      const installed = installedRoot && pathname.startsWith('/packages/reploid/src/');
      const file = installed ? path.resolve(installedRoot, pathname.slice('/packages/reploid/'.length))
        : path.resolve(root, pathname.startsWith('/core/') ? `self${pathname}` : pathname.slice(1));
      const allowed = installed ? file.startsWith(path.join(installedRoot, 'src') + path.sep)
        : ['self', 'tests/fixtures', 'packages/reploid/src'].some(directory => file.startsWith(path.join(root, directory) + path.sep));
      if (!allowed) {
        response.writeHead(403).end(); return;
      }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test('physical signed embedding units retain independent source agreement across requester restart', async ({}, testInfo) => {
  test.skip(!physicalConfig, 'Set REPLOID_UNITS_PHYSICAL_CONFIG to a currently eligible signed embedding qualification configuration.');
  test.setTimeout(physicalConfig.config.timeoutMs);
  const profile = await mkdtemp(path.join(tmpdir(), 'reploid-physical-independent-units-'));
  let context;
  let currentPage;
  const open = async saved => {
    context = await chromium.launchPersistentContext(profile, { headless: true, args: physicalConfig.config.launchArgs });
    const page = await context.newPage();
    currentPage = page;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin);
    await page.evaluate(async seed => {
      const fixture = await import('/tests/fixtures/independent-units-physical.js');
      window.units = await fixture.startPhysical(seed);
    }, saved);
    return page;
  };
  try {
    let page = await open(null);
    const first = await page.evaluate(async () => {
      const state = await units.create('physical');
      await units.current.runUnit('physical', state.pendingUnitIds.at(-1));
      const lost = units.dropUntilCompletion();
      window.lostDelivery = units.current.runUnit('physical', state.pendingUnitIds.at(-2)).catch(error => error.message);
      await lost;
      return { seed: await units.seed(), state: await units.current.get('physical'), calls: units.calls(),
        gpu: units.gpu, semantics: units.semantics, releaseCheckpoint: units.releaseCheckpoint, buffers: units.buffers() };
    });
    expect(first.state.committedUnitIds).toHaveLength(1);
    expect(first.calls).toEqual([2, 0]);
    await context.close(); context = null;
    page = await open(first.seed);
    const final = await page.evaluate(async () => {
      const restored = await units.current.get('physical');
      units.select(1);
      for (const unitId of restored.pendingUnitIds.toReversed()) await units.current.runUnit('physical', unitId);
      const state = await units.current.get('physical');
      await units.current.runUnit('physical', state.committedUnitIds.at(-1));
      const evaluation = await units.evaluate('physical');
      const completedCalls = units.calls();
      const cancelledParent = await units.create('physical-cancel');
      await units.current.runUnit('physical-cancel', cancelledParent.pendingUnitIds[0]);
      const gate = units.holdNextPartial();
      const submitted = units.current.runUnit('physical-cancel', cancelledParent.pendingUnitIds[1])
        .then(() => 'accepted', error => error.message);
      await gate.ready;
      await units.current.cancel('physical-cancel');
      gate.release();
      const cancellationError = await submitted;
      await units.closeProvider(1);
      const cancellation = await units.current.get('physical-cancel');
      units.select(0);
      const recovery = await units.create('physical-recovery');
      const recovered = await units.current.runUnit('physical-recovery', recovery.pendingUnitIds[0]);
      const result = { restored, state, evaluation, calls: completedCalls, releaseCheckpoint: units.releaseCheckpoint,
        cancellationError, cancellation, recovered, buffers: units.buffers() };
      await units.close();
      return result;
    });
    expect(final.restored.committedUnitIds).toEqual(first.state.committedUnitIds);
    expect(final.state.status).toBe('completed');
    expect(final.calls).toEqual([0, 4]);
    expect(final.evaluation.comparison.passed).toBe(true);
    expect(final.cancellationError).toContain('cancelled');
    expect(final.cancellation).toMatchObject({ status: 'cancelled', output: null });
    expect(final.cancellation.committedUnitIds).toHaveLength(1);
    expect(final.recovered.committedUnitIds).toHaveLength(1);
    expect(final.evaluation.record.units.every(unit => unit.outcome.result.execution.request.assignment !== null)).toBe(true);
    const { seed: _ephemeralKeys, ...firstObservation } = first;
    const report = { executionClass: 'physical-amd-signed-capsule-native-indexeddb',
      operatorCount: 1, independentMachines: false, deployed: false, runtimePackage: physicalConfig.runtimePackage,
      referenceDigest: physicalConfig.expectedReferenceDigest, first: firstObservation, final };
    const reportPath = testInfo.outputPath('physical-independent-units.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach('physical-independent-units', { path: reportPath, contentType: 'application/json' });
  } catch (error) {
    const status = await currentPage?.evaluate(() => window.units?.status()).catch(() => null);
    await testInfo.attach('physical-failure', { body: JSON.stringify({ error: error.message, status }, null, 2), contentType: 'application/json' });
    console.error(JSON.stringify({ physicalFailure: error.message, status }));
    throw error;
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
test.afterAll(async () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

async function start(page, saved = null) {
  await page.goto(origin);
  await page.evaluate(async seed => {
    const fixture = await import('/tests/fixtures/independent-units-browser.js');
    window.units = await fixture.start(seed);
  }, saved);
}

test('requester aggregate survives browser restart and commits out of order only once', async ({}, testInfo) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'reploid-independent-units-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true });
    let page = await context.newPage(); await start(page);
    const first = await page.evaluate(async () => {
      const state = await units.create();
      // Lose the whole first delivery, then replay the provider's committed stream.
      units.dropResponses(2);
      await units.current.runUnit('batch', state.pendingUnitIds[2]);
      return { seed: await units.seed(), state: await units.current.get('batch'), calls: units.calls() };
    });
    expect(first.state.committedUnitIds).toHaveLength(1);
    expect(first.calls).toEqual([1, 0]);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { headless: true });
    page = await context.newPage(); await start(page, first.seed);
    const completed = await page.evaluate(async () => {
      const restored = await units.current.get('batch');
      units.select(1);
      for (const unitId of restored.pendingUnitIds.toReversed()) await units.current.runUnit('batch', unitId);
      const state = await units.current.get('batch');
      const before = units.calls();
      await units.current.runUnit('batch', state.committedUnitIds[2]);
      const record = await units.journal.get('batch');
      const unit = record.units[2];
      const redelivery = structuredClone(unit.outcome);
      redelivery.result.accounting.deliveries++;
      await units.journal.commit('batch', unit.unitId, unit.attempts.at(-1).jobHash, redelivery);
      return { restored, state, before, after: units.calls(), record };
    });
    expect(completed.restored.committedUnitIds).toEqual(first.state.committedUnitIds);
    expect(completed.state).toMatchObject({ status: 'completed', pendingUnitIds: [],
      output: { embeddings: [{ embedding: [1, 97] }, { embedding: [3, 98] }, { embedding: [2, 99] }] } });
    expect(completed.before).toEqual([0, 2]);
    expect(completed.after).toEqual(completed.before);
    expect(completed.record.units.every(unit => unit.outcome.location.startsWith('indexeddb:'))).toBe(true);
    await testInfo.attach('independent-units-restart', { body: JSON.stringify({ executionClass: 'synthetic-vectors-real-signatures-native-indexeddb', first, completed }, null, 2), contentType: 'application/json' });
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('replacement fences an old execution and cancellation rejects late outcomes', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const state = await units.create('replacement', ['first']);
    const id = state.pendingUnitIds[0];
    const gate = units.hold('first');
    const stale = units.current.runUnit('replacement', id).then(() => 'accepted', error => error.message);
    await gate.ready;
    units.select(1);
    const newer = units.coordinator().runUnit('replacement', id, { replace: true });
    while ((await units.journal.get('replacement')).units[0].attempts.length !== 2) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    // Both producers may execute; only the latest retained assignment may commit.
    gate.release();
    const complete = await newer;
    const staleError = await stale;
    const cancelledState = await units.create('cancelled', ['stop']);
    const cancelGate = units.hold('stop');
    const cancelled = units.current.runUnit('cancelled', cancelledState.pendingUnitIds[0]).then(() => 'accepted', error => error.message);
    await cancelGate.ready;
    await units.current.cancel('cancelled');
    cancelGate.release();
    const cancellation = await cancelled;
    const final = await units.current.get('cancelled');
    units.allow(false);
    const unauthorized = await units.current.get('replacement').then(() => 'accepted', error => error.message);
    return { complete, staleError, cancellation, final, unauthorized };
  });
  expect(result.complete.status).toBe('completed');
  expect(result.staleError).toContain('superseded');
  expect(result.cancellation).toContain('cancelled');
  expect(result.final).toMatchObject({ status: 'cancelled', committedUnitIds: [], output: null });
  expect(result.unauthorized).toContain('authorization denied');
});

test('aggregate binding collisions, conflicting duplicates and storage exhaustion reject atomically', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const state = await units.create();
    await units.current.runUnit('batch', state.pendingUnitIds[0]);
    const record = await units.journal.get('batch');
    const changed = structuredClone(record.manifest); changed.binding.input.texts[0] = 'altered';
    const collision = await units.journal.create(changed).then(() => 'accepted', error => error.message);
    const unit = record.units[0], outcome = structuredClone(unit.outcome);
    outcome.result.execution.output.embeddings[0].embedding[0]++;
    const duplicate = await units.journal.commit('batch', unit.unitId, unit.attempts[0].jobHash, outcome).then(() => 'accepted', error => error.message);
    const { openIndependentUnitJournal } = await import('/packages/reploid/src/artifacts/independent-unit-journal.js');
    const { storagePolicy } = await import('/tests/fixtures/independent-units-browser.js');
    const limited = await openIndependentUnitJournal({ requesterId: record.requesterId, name: 'limited', policy: { ...storagePolicy, maxBytes: 1 } });
    const budget = await limited.create(record.manifest).then(() => 'accepted', error => error.message);
    const missing = await limited.get('batch').then(() => 'found', error => error.message);
    limited.close();
    return { collision, duplicate, budget, missing };
  });
  expect(result.collision).toContain('identity collision');
  expect(result.duplicate).toContain('conflicting duplicate');
  expect(result.budget).toContain('storage budget exhausted');
  expect(result.missing).toContain('not found');
});

test('execution and idempotent calls cannot disclose committed outputs without read permission', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const state = await units.create('disclosure', ['private']);
    units.allow(action => action !== 'read');
    const id = state.pendingUnitIds[0];
    const committed = await units.current.runUnit('disclosure', id).then(() => 'disclosed', error => error.message);
    const record = await units.journal.get('disclosure');
    const manifest = record.manifest;
    const duplicateCreate = await units.current.create({ parentId: manifest.parentId, application: manifest.application,
      ...manifest.binding, unitSize: 1, expiresAt: manifest.expiresAt }).then(() => 'disclosed', error => error.message);
    const duplicateRun = await units.current.runUnit('disclosure', id).then(() => 'disclosed', error => error.message);
    const cancellation = await units.current.cancel('disclosure').then(() => 'disclosed', error => error.message);
    units.allow(true);
    return { committed, duplicateCreate, duplicateRun, cancellation, final: await units.current.get('disclosure'), calls: units.calls() };
  });
  for (const key of ['committed', 'duplicateCreate', 'duplicateRun', 'cancellation']) expect(result[key]).toContain('authorization denied');
  expect(result.final.status).toBe('completed');
  expect(result.final.output.embeddings).toHaveLength(1);
  expect(result.calls).toEqual([1, 0]);
});

test('bounds, expiry, revoked commit authority and the Verification Worker reject unsafe progress', async ({ page }) => {
  await start(page);
  const result = await page.evaluate(async () => {
    const oversized = await units.create('oversized', Array(17).fill('text')).then(() => 'accepted', error => error.message);
    const state = await units.create('revoked', ['wait']);
    const gate = units.hold('wait');
    const execution = units.current.runUnit('revoked', state.pendingUnitIds[0]).then(() => 'accepted', error => error.message);
    await gate.ready; units.allow(false); gate.release();
    const denied = await execution;
    units.allow(true);
    const retained = await units.journal.get('revoked');
    const { openIndependentUnitJournal } = await import('/packages/reploid/src/artifacts/independent-unit-journal.js');
    const { storagePolicy } = await import('/tests/fixtures/independent-units-browser.js');
    const manifest = structuredClone(retained.manifest);
    const clock = Date.now, now = clock();
    const journal = await openIndependentUnitJournal({ requesterId: retained.requesterId,
      name: 'expiry-test', policy: storagePolicy });
    manifest.expiresAt = now + 100;
    await journal.create(manifest);
    let expired, deleted;
    try {
      Date.now = () => now + 101;
      expired = await journal.assign('revoked', state.pendingUnitIds[0], 1, {
        ...retained.units[0].attempts[0], attemptNumber: 2,
        attemptId: 'replacement', jobHash: `sha256:${'f'.repeat(64)}`,
      }).then(() => 'accepted', error => error.message);
      Date.now = () => now + 100 + storagePolicy.retentionMs;
      deleted = await journal.get('revoked').then(() => 'found', error => error.message);
    } finally { Date.now = clock; journal.close(); }
    const files = ['/packages/reploid/src/mesh/jobs/independent-units.js', '/packages/reploid/src/artifacts/independent-unit-journal.js'];
    const snapshot = Object.fromEntries(await Promise.all(files.map(async file => [file.replace('/packages/reploid/src/', '/vendor/reploid/'), await (await fetch(file)).text()])));
    const verify = snapshot => new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
    const verification = await verify(snapshot);
    const unauthorizedStorage = await verify({ '/vendor/reploid/artifacts/unapproved.js': 'indexedDB.open("unbounded");' });
    return { oversized, denied, committed: retained.units.filter(unit => unit.outcome).length, expired, deleted, verification, unauthorizedStorage };
  });
  expect(result.oversized).toContain('unit budget exhausted');
  expect(result.denied).toContain('authorization denied');
  expect(result.committed).toBe(0);
  expect(result.expired).toContain('expired');
  expect(result.deleted).toContain('not found');
  expect(result.verification.passed, JSON.stringify(result.verification)).toBe(true);
  expect(result.unauthorizedStorage.passed).toBe(false);
  expect(result.unauthorizedStorage.errors.join(' ')).toContain('IndexedDB');
});
