import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let server, origin;
test.beforeAll(async () => {
  const root = path.resolve('.');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Operation contract</title>'); return; }
      const file = path.resolve(root, pathname.startsWith('/core/') ? `self${pathname}` : pathname.slice(1));
      if (![path.join(root, 'self') + path.sep, path.join(root, 'tests/fixtures') + path.sep].some(prefix => file.startsWith(prefix))) {
        response.writeHead(403).end(); return;
      }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });

test('common operations cross real WebRTC between browser contexts, with bounded large-message framing', async ({ browser }, testInfo) => {
  const observations = [];
  for (const operation of ['generate', 'embed', 'rerank', 'encodeSequence']) {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const [requester, provider] = await Promise.all(contexts.map(context => context.newPage()));
    try {
      for (const page of [requester, provider]) {
        page.on('pageerror', error => console.error(error.message));
        page.on('response', response => { if (response.status() >= 400) console.error(`${response.status()} ${response.url()}`); });
      }
      await Promise.all([requester, provider].map(page => page.goto(origin)));
      await Promise.all([requester, provider].map((page, index) => page.evaluate(async data => {
        window.fixture = await import('/tests/fixtures/peer-pack-job-browser.js');
        return window.fixture.start(data);
      }, { role: index === 0 ? 'requester' : 'provider', operation, large: operation === 'embed' })));
      const offer = await requester.evaluate(() => window.fixture.offer());
      const answer = await provider.evaluate(offer => window.fixture.answer(offer), offer);
      await requester.evaluate(answer => window.fixture.accept(answer), answer);
      const advert = await provider.evaluate(() => window.fixture.advert());
      const result = await requester.evaluate(advert => window.fixture.run(advert), advert);
      const providerState = await provider.evaluate(() => window.fixture.state());
      expect(result.accepted).toBe(true);
      expect(result.operation.name).toBe(operation);
      expect(result.errors).toEqual([]); expect(providerState.errors).toEqual([]);
      expect(providerState.calls).toBe(1);
      expect(providerState.transport.sentFrameBytes).toBe(result.transport.receivedFrameBytes);
      if (operation === 'embed') expect(result.accounting.receivedBytes).toBeGreaterThan(256 * 1024);
      observations.push({ result, providerState });
    } finally {
      await Promise.all([requester, provider].map(page => page.evaluate(() => window.fixture?.close()).catch(() => {})));
      await Promise.all(contexts.map(context => context.close()));
    }
  }
  await testInfo.attach('webrtc-operation-contract', { body: JSON.stringify({ executionClass: 'synthetic-models-real-webrtc',
    operatorCount: 1, observations }, null, 2), contentType: 'application/json' });
});

test('Verification Worker accepts complete-job modules and modified execution boundaries', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const snapshot = {};
    for (const file of ['peer-pack-job.js', 'peer-pack-job-policy.js', 'peer-pack-provider.js', 'peer-pack-requester.js', 'peer-pack-job-channel.js',
      'peer-pack-episode.js', 'peer-pack-session.js', 'pack-operation.js', 'pack-operation-adapters.js', 'pack-operation-policy.js', 'config-contract.js', 'operation-model.js', 'local-pack-executor.js', 'provider-client.js', 'requester-client.js']) {
      snapshot[`/pool/${file}`] = await (await fetch(`/self/pool/${file}`)).text();
    }
    snapshot['/infrastructure/pack-job-storage.js'] = await (await fetch('/self/infrastructure/pack-job-storage.js')).text();
    for (const file of ['peer-pack-operation.js', 'peer-pack-job-browser.js', 'peer-pack-browser.js', 'peer-pack-remote-execution.js', 'peer-pack-journal-browser.js']) snapshot[`/tests/fixtures/${file}`] = await (await fetch(`/tests/fixtures/${file}`)).text();
    const worker = new Worker('/core/verification-worker.js');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
  });
  expect(result.passed, JSON.stringify(result.errors)).toBe(true);
});

test('durable provider responses survive a complete browser-process replacement', async ({}, testInfo) => {
  const observations = [];
  for (const mode of ['normal', 'send-failure', 'accepted', 'pending', 'cancel-before-job', 'persistence']) {
    const profile = await mkdtemp(path.join(tmpdir(), 'reploid-job-restart-'));
    let context;
    const launch = async (saved = null) => {
      context = await chromium.launchPersistentContext(profile, { headless: true });
      const page = await context.newPage();
      await page.goto(origin);
      if (!saved && mode === 'persistence') await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, ...args) {
          const result = put.call(this, value, ...args);
          if (this.name === 'attempts' && value.status === 'accepted') {
            window.blockedAcceptance = true;
            const keepAlive = () => { const pending = this.get(value.key); pending.onsuccess = keepAlive; };
            keepAlive();
          }
          return result;
        };
      });
      const seed = await page.evaluate(async args => {
        window.journalFixture = await import('/tests/fixtures/peer-pack-journal-browser.js');
        return window.journalFixture.start(args);
      }, { saved, mode: saved ? 'normal' : mode });
      return { page, seed };
    };
    try {
      const first = await launch();
      await first.page.evaluate(kind => window.journalFixture.deliver(kind), mode === 'cancel-before-job' ? 'cancel' : 'job');
      await expect.poll(async () => {
        if (mode === 'persistence') return first.page.evaluate(() => window.blockedAcceptance === true);
        const state = await first.page.evaluate(() => window.journalFixture.state());
        if (mode === 'cancel-before-job') return state.queued === 0 && state.journal.attempts === 1;
        if (mode === 'pending') return state.responses.length === 1 && state.active;
        if (mode === 'accepted') return state.journal.states.accepted === 1 && state.calls === 0;
        return state.calls === 1 && !state.active;
      }).toBe(true);
      const before = await first.page.evaluate(include => window.journalFixture.state(include), mode !== 'persistence');
      if (mode === 'persistence') expect(before.calls).toBe(0);
      // No provider.close(): replace the process while its module state still exists.
      await context.close(); context = null;
      const second = await launch(first.seed);
      const restored = await second.page.evaluate(() => window.journalFixture.state());
      const expectedCalls = mode === 'persistence' && restored.journal.attempts === 0 ? 1 : 0;
      await second.page.evaluate(() => window.journalFixture.deliver());
      await expect.poll(async () => {
        const state = await second.page.evaluate(() => window.journalFixture.state());
        return state.queued === 0 && !state.active && state.responses.length > 0 && state.responses.at(-1).body.status !== 'partial';
      }).toBe(true);
      const after = await second.page.evaluate(() => window.journalFixture.state());
      expect(after.calls).toBe(expectedCalls);
      expect(after.errors).toEqual([]);
      expect(after.journal.attempts).toBe(1);
      expect(after.journal.storedBytes).toBeGreaterThan(0);
      const statuses = after.responses.map(message => message.body.status);
      expect(statuses).toEqual(mode === 'pending' ? ['partial', 'failed']
        : mode === 'cancel-before-job' ? ['cancelled'] : mode === 'accepted' || (mode === 'persistence' && !expectedCalls)
          ? ['failed'] : ['partial', 'completed']);
      expect(after.responses.slice(0, before.responses.length)).toEqual(before.responses);
      for (let index = 0; index < after.responses.length; index++) {
        expect(after.responses[index].body.updateIndex).toBe(index);
        expect(after.responses[index].body.previousUpdateHash).toBe(after.responses[index - 1]?.messageHash ?? null);
      }
      await second.page.evaluate(() => window.journalFixture.deliver());
      await expect.poll(async () => (await second.page.evaluate(() => window.journalFixture.state())).queued).toBe(0);
      const repeated = await second.page.evaluate(() => window.journalFixture.state());
      expect(repeated.calls).toBe(expectedCalls);
      expect(repeated.responses).toEqual([...after.responses, ...after.responses]);
      observations.push({ mode, before, restored, after, repeated });
      await second.page.evaluate(() => window.journalFixture.close());
    } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
  }
  await testInfo.attach('durable-job-process-restart', { body: JSON.stringify({ executionClass: 'synthetic-models-native-indexeddb',
    operatorCount: 1, processReplacements: observations.length, observations }, null, 2), contentType: 'application/json' });
});

test('native attempt claims fence concurrent writers and enforce retention limits', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { openPackJobJournal } = await import('/self/infrastructure/pack-job-storage.js');
    const { PACK_JOB_POLICY } = await import('/self/pool/peer-pack-job-policy.js');
    const providerId = `sha256:${'a'.repeat(64)}`, jobHash = `sha256:${'b'.repeat(64)}`;
    const options = { providerId, policy: PACK_JOB_POLICY.persistence, name: crypto.randomUUID(), maxAttempts: 1, maxBytes: 2000 };
    const journals = await Promise.all([openPackJobJournal(options), openPackJobJournal(options)]);
    const value = { requesterId: providerId, jobId: 'job', attemptId: 'attempt', jobHash, expiresAt: Date.now() + 30000,
      binding: { requestHash: jobHash, assignmentId: 'assignment', operation: { name: 'embed', version: 1 }, model: {}, adapterSet: [], attemptNumber: 1 } };
    const failure = async action => { try { await action(); return null; } catch (error) { return error.message; } };
    try {
      const claims = await Promise.all(journals.map((journal, index) => journal.claim(value, `writer-${index}`)));
      const first = claims.findIndex(claim => claim.created), replacement = 1 - first;
      const message = { messageHash: jobHash, body: { jobHash, requestHash: jobHash, updateIndex: 0, previousUpdateHash: null, status: 'completed' } };
      const fenced = await failure(() => journals[first].append(value, `writer-${first}`, message));
      const abandoned = await failure(() => journals[replacement].append(value, `writer-${replacement}`, message));
      const count = await failure(() => journals[0].claim({ ...value, jobId: 'other' }, 'other'));
      const bytes = await failure(() => journals[replacement].append(value, `writer-${replacement}`,
        { ...message, body: { ...message.body, status: 'failed', padding: 'x'.repeat(2000) } }));
      const rewrapped = await failure(() => journals[0].claim({ ...value, jobHash: providerId }, 'other'));
      await journals[replacement].append(value, `writer-${replacement}`, { ...message, body: { ...message.body, status: 'failed' } });
      await journals[0].cancel(value, 'cancel');
      const retained = await journals[0].claim(value, 'reopened');
      return { created: claims.filter(claim => claim.created).length, fenced, abandoned, count, bytes, rewrapped,
        terminal: retained.record.status, updates: retained.record.updates.length, stats: await journals[0].getStats() };
    } finally { journals.forEach(journal => journal.close()); }
  });
  expect(result.created).toBe(1);
  expect(result.fenced).toContain('superseded');
  expect(result.abandoned).toContain('cannot publish completion');
  expect(result.count).toContain('budget exhausted');
  expect(result.bytes).toContain('budget exhausted');
  expect(result.rewrapped).toContain('different signed envelope');
  expect(result.terminal).toBe('interrupted'); expect(result.updates).toBe(1);
  expect(result.stats.attempts).toBe(1);
});

test('native attempt states bind numbered requests and retain expiry before cleanup', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { openPackJobJournal } = await import('/self/infrastructure/pack-job-storage.js');
    const { PACK_JOB_POLICY } = await import('/self/pool/peer-pack-job-policy.js');
    const policy = PACK_JOB_POLICY.persistence, hash = `sha256:${'a'.repeat(64)}`;
    const realNow = Date.now; let clock = realNow(); Date.now = () => clock;
    const journal = await openPackJobJournal({ providerId: hash, policy, name: crypto.randomUUID() });
    const value = { requesterId: hash, jobId: 'one-job', attemptId: 'first', jobHash: hash, expiresAt: clock + 1000,
      binding: { requestHash: hash, assignmentId: 'first-assignment', operation: { name: 'generate', version: 1 },
        model: { modelId: 'exact-model' }, adapterSet: [], attemptNumber: 1 } };
    const failure = async action => { try { await action(); return null; } catch (error) { return error.message; } };
    try {
      const accepted = await journal.claim(value, 'original');
      const changed = await failure(() => journal.claim({ ...value, binding: { ...value.binding, attemptNumber: 2 } }, 'original'));
      const running = await journal.markRunning(value, 'original');
      const interrupted = await journal.claim(value, 'replacement');
      const restart = await failure(() => journal.markRunning(value, 'replacement'));
      const next = { ...value, attemptId: 'second', jobHash: `sha256:${'b'.repeat(64)}`,
        binding: { ...value.binding, assignmentId: 'second-assignment', attemptNumber: 2 } };
      await journal.claim(next, 'replacement');
      const nextRunning = await journal.markRunning(next, 'replacement');
      const cancelled = await journal.cancel(next, 'replacement');
      const cancelledRestart = await failure(() => journal.markRunning(next, 'replacement'));
      clock = value.expiresAt + 1;
      const expired = await journal.getStats();
      clock = value.expiresAt + policy.retentionMs + 1;
      const cleaned = await journal.getStats();
      return { accepted: accepted.record.status, changed, running: running.status, interrupted: interrupted.record.status,
        restart, nextRunning: nextRunning.status, cancelled: cancelled.status, cancelledRestart, expired, cleaned };
    } finally { journal.close(); Date.now = realNow; }
  });
  expect(result.accepted).toBe('accepted'); expect(result.running).toBe('running');
  expect(result.changed).toContain('immutable attempt binding');
  expect(result.interrupted).toBe('interrupted'); expect(result.restart).toContain('only accepted');
  expect(result.nextRunning).toBe('running'); expect(result.cancelled).toBe('cancelled');
  expect(result.cancelledRestart).toContain('only accepted');
  expect(result.expired.attempts).toBe(2); expect(result.expired.states.expired).toBe(2);
  expect(result.cleaned.attempts).toBe(0);
});

test('legacy unfinished records migrate as interrupted and never become runnable', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { openPackJobJournal } = await import('/self/infrastructure/pack-job-storage.js');
    const { PACK_JOB_POLICY } = await import('/self/pool/peer-pack-job-policy.js');
    const policy = PACK_JOB_POLICY.persistence, hash = `sha256:${'a'.repeat(64)}`, name = crypto.randomUUID();
    const value = { requesterId: hash, jobId: 'legacy-job', attemptId: 'legacy-attempt', jobHash: hash, expiresAt: Date.now() + 30000 };
    const opening = indexedDB.open(`${name}:${hash}`, policy.databaseVersion);
    opening.onupgradeneeded = () => opening.result.createObjectStore(policy.storeName, { keyPath: 'key' });
    const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    const tx = db.transaction(policy.storeName, 'readwrite');
    tx.objectStore(policy.storeName).put({ schema: policy.legacyRecordSchema, key: JSON.stringify([hash, value.jobId, value.attemptId]),
      ...value, owner: 'previous-process', status: 'running', updates: [] });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    const journal = await openPackJobJournal({ providerId: hash, policy, name });
    try {
      const claimed = await journal.claim({ ...value, binding: { requestHash: hash, assignmentId: 'exact-assignment',
        operation: { name: 'embed', version: 1 }, model: {}, adapterSet: [], attemptNumber: 1 } }, 'new-process');
      return { created: claimed.created, schema: claimed.record.schema, status: claimed.record.status,
        outcome: claimed.record.outcome, retainUntil: claimed.record.retainUntil, expectedRetention: value.expiresAt + policy.retentionMs };
    } finally { journal.close(); }
  });
  expect(result.created).toBe(false); expect(result.schema).toBe('reploid.pack-job-journal/v2');
  expect(result.status).toBe('interrupted'); expect(result.outcome).toBe('legacy-interrupted');
  expect(result.retainUntil).toBe(result.expectedRetention);
});

test('a stalled native transaction aborts within configured storage bounds', async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { openPackJobJournal } = await import('/self/infrastructure/pack-job-storage.js');
    const { PACK_JOB_POLICY } = await import('/self/pool/peer-pack-job-policy.js');
    const policy = { ...PACK_JOB_POLICY.persistence, storageTimeoutMs: 50 }, hash = `sha256:${'a'.repeat(64)}`;
    const journal = await openPackJobJournal({ providerId: hash, policy, name: crypto.randomUUID() });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      const operation = put.call(this, value, ...args);
      const hold = () => { const read = this.get(value.key); read.onsuccess = hold; };
      hold(); return operation;
    };
    let failure;
    try {
      await journal.claim({ requesterId: hash, jobId: 'stalled', attemptId: 'first', jobHash: hash, expiresAt: Date.now() + 30000,
        binding: { requestHash: hash, assignmentId: 'assignment', operation: { name: 'embed', version: 1 }, model: {}, adapterSet: [], attemptNumber: 1 } }, 'writer');
    } catch (error) { failure = error.message; }
    finally { IDBObjectStore.prototype.put = put; }
    try { return { failure, stats: await journal.getStats() }; } finally { journal.close(); }
  });
  expect(result.failure).toContain('transaction aborted');
  expect(result.stats.attempts).toBe(0);
});

test('a replacement provider prevents the still-running writer from publishing completion', async ({ context }) => {
  const original = await context.newPage(), replacement = await context.newPage();
  await Promise.all([original.goto(origin), replacement.goto(origin)]);
  const seed = await original.evaluate(async () => {
    window.journalFixture = await import('/tests/fixtures/peer-pack-journal-browser.js');
    const saved = await window.journalFixture.start({ mode: 'pending' });
    window.journalFixture.deliver();
    return saved;
  });
  await expect.poll(async () => (await original.evaluate(() => window.journalFixture.state())).responses.length).toBe(1);
  await replacement.evaluate(async saved => {
    window.journalFixture = await import('/tests/fixtures/peer-pack-journal-browser.js');
    await window.journalFixture.start({ saved });
    window.journalFixture.deliver();
  }, seed);
  await expect.poll(async () => (await replacement.evaluate(() => window.journalFixture.state())).queued).toBe(0);
  const recovered = await replacement.evaluate(() => window.journalFixture.state());
  expect(recovered.calls).toBe(0);
  expect(recovered.responses.map(message => message.body.status)).toEqual(['partial', 'failed']);
  await original.evaluate(() => window.journalFixture.releasePending());
  await expect.poll(async () => (await original.evaluate(() => window.journalFixture.state())).active).toBe(false);
  const stale = await original.evaluate(() => window.journalFixture.state());
  expect(stale.calls).toBe(1);
  expect(stale.responses.map(message => message.body.status)).toEqual(['partial']);
  expect(stale.errors.some(error => error.includes('superseded'))).toBe(true);
  await Promise.all([original, replacement].map(page => page.evaluate(() => window.journalFixture.close())));
});

test('a corrupted durable response cannot enter provider replay even after another delivery', async ({ page }) => {
  await page.goto(origin);
  const seed = await page.evaluate(async () => {
    window.journalFixture = await import('/tests/fixtures/peer-pack-journal-browser.js');
    const saved = await window.journalFixture.start();
    window.journalFixture.deliver();
    return saved;
  });
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.journalFixture.state());
    return state.calls === 1 && !state.active;
  }).toBe(true);
  await page.evaluate(async providerId => {
    await window.journalFixture.close();
    const opening = indexedDB.open(`reploid-pack-jobs-v1:${providerId}`, 1);
    const db = await new Promise((resolve, reject) => { opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('attempts', 'readwrite');
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        const store = tx.objectStore('attempts'), read = store.getAll();
        read.onsuccess = () => {
          const record = read.result[0];
          record.updates.at(-1).body.event.output.embeddings[0].embedding[0] = 999;
          store.put(record);
        };
      });
    } finally { db.close(); }
  }, seed.identity.keyId);
  await page.evaluate(saved => window.journalFixture.start({ saved }), seed);
  for (let index = 0; index < 2; index++) {
    await page.evaluate(() => window.journalFixture.deliver());
    await expect.poll(async () => (await page.evaluate(() => window.journalFixture.state())).queued).toBe(0);
  }
  const state = await page.evaluate(() => window.journalFixture.state());
  expect(state.responses).toEqual([]);
  expect(state.calls).toBe(0);
  expect(state.errors).toHaveLength(2);
  expect(state.attempts).toBe(0);
  await page.evaluate(() => window.journalFixture.close());
});
