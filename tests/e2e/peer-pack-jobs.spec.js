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
    for (const file of ['peer-pack-job.js', 'peer-pack-provider.js', 'peer-pack-requester.js', 'peer-pack-job-channel.js',
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
  for (const mode of ['normal', 'send-failure', 'pending', 'cancel-before-job']) {
    const profile = await mkdtemp(path.join(tmpdir(), 'reploid-job-restart-'));
    let context;
    const launch = async (saved = null) => {
      context = await chromium.launchPersistentContext(profile, { headless: true });
      const page = await context.newPage();
      await page.goto(origin);
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
        const state = await first.page.evaluate(() => window.journalFixture.state());
        if (mode === 'cancel-before-job') return state.queued === 0 && state.journal.attempts === 1;
        if (mode === 'pending') return state.responses.length === 1 && state.active;
        return state.calls === 1 && !state.active;
      }).toBe(true);
      const before = await first.page.evaluate(() => window.journalFixture.state());
      // No provider.close(): replace the process while its module state still exists.
      await context.close(); context = null;
      const second = await launch(first.seed);
      await second.page.evaluate(() => window.journalFixture.deliver());
      await expect.poll(async () => (await second.page.evaluate(() => window.journalFixture.state())).queued).toBe(0);
      const after = await second.page.evaluate(() => window.journalFixture.state());
      expect(after.calls).toBe(0);
      expect(after.errors).toEqual([]);
      expect(after.journal.attempts).toBe(1);
      expect(after.journal.storedBytes).toBeGreaterThan(0);
      const statuses = after.responses.map(message => message.body.status);
      expect(statuses).toEqual(mode === 'pending' ? ['partial', 'failed']
        : mode === 'cancel-before-job' ? ['cancelled'] : ['partial', 'completed']);
      expect(after.responses.slice(0, before.responses.length)).toEqual(before.responses);
      for (let index = 0; index < after.responses.length; index++) {
        expect(after.responses[index].body.updateIndex).toBe(index);
        expect(after.responses[index].body.previousUpdateHash).toBe(after.responses[index - 1]?.messageHash ?? null);
      }
      await second.page.evaluate(() => window.journalFixture.deliver());
      await expect.poll(async () => (await second.page.evaluate(() => window.journalFixture.state())).queued).toBe(0);
      const repeated = await second.page.evaluate(() => window.journalFixture.state());
      expect(repeated.calls).toBe(0);
      expect(repeated.responses).toEqual([...after.responses, ...after.responses]);
      observations.push({ mode, before, after, repeated });
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
    const providerId = `sha256:${'a'.repeat(64)}`, jobHash = `sha256:${'b'.repeat(64)}`;
    const options = { providerId, name: crypto.randomUUID(), maxAttempts: 1, maxBytes: 2000 };
    const journals = await Promise.all([openPackJobJournal(options), openPackJobJournal(options)]);
    const value = { requesterId: providerId, jobId: 'job', attemptId: 'attempt', jobHash, expiresAt: Date.now() + 30000 };
    const failure = async action => { try { await action(); return null; } catch (error) { return error.message; } };
    try {
      const claims = await Promise.all(journals.map((journal, index) => journal.claim(value, `writer-${index}`)));
      const first = claims.findIndex(claim => claim.created), replacement = 1 - first;
      const message = { messageHash: jobHash, body: { jobHash, updateIndex: 0, previousUpdateHash: null, status: 'completed' } };
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
  expect(result.terminal).toBe('failed'); expect(result.updates).toBe(1);
  expect(result.stats.attempts).toBe(1);
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
