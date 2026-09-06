import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
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
      'peer-pack-episode.js', 'peer-pack-session.js', 'pack-operation.js', 'pack-operation-adapters.js', 'operation-model.js', 'local-pack-executor.js', 'provider-client.js', 'requester-client.js']) {
      snapshot[`/pool/${file}`] = await (await fetch(`/self/pool/${file}`)).text();
    }
    for (const file of ['peer-pack-operation.js', 'peer-pack-job-browser.js', 'peer-pack-browser.js', 'peer-pack-remote-execution.js']) snapshot[`/tests/fixtures/${file}`] = await (await fetch(`/tests/fixtures/${file}`)).text();
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
