import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:5199/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>History transactions</title>' });
    if (!['/host/chat-history.js', '/core/verification-worker.js', '/core/vendor/acorn.js'].includes(name)
      && !name.startsWith('/vendor/reploid/')) return route.abort();
    return route.fulfill({ contentType: name.endsWith('.json') ? 'application/json' : 'text/javascript', body: await readFile('self' + name) });
  });
  await page.goto('http://127.0.0.1:5199/');
});

test('two connections serialize atomic history updates, retain aborted heads and enforce admission', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { openChatHistory } = await import('/host/chat-history.js');
    const options = { name: 'canonical-history-' + crypto.randomUUID(), maxConversations: 1, maxConversationBytes: 1000, openTimeoutMs: 1000 };
    const a = await openChatHistory(options), b = await openChatHistory(options);
    await a.transact('thread', () => ({ state: { count: 0, events: [] }, result: null }));
    const committed = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? a : b).transact('thread', state => {
      state.count++; state.events.push(index);
      return { state, result: state.count };
    })));
    const before = await b.read('thread');
    let rejected = 0;
    for (const reducer of [
      state => { state.count = 100; throw Error('injected reducer failure'); },
      async state => ({ state: { count: 100 }, result: null }),
      state => ({ state: { content: 'x'.repeat(2000) }, result: null }),
    ]) {
      try { await a.transact('thread', reducer); } catch { rejected++; }
    }
    const after = await b.read('thread');
    try { await b.transact('extra', () => ({ state: {}, result: null })); } catch { rejected++; }
    const last = a.transact('thread', state => { state.count++; return { state, result: state.count }; });
    await a.close();
    const closedCommit = await last;
    await b.close();
    const restored = await openChatHistory(options), durable = await restored.read('thread');
    await restored.close();
    return { committed, before, after, rejected, closedCommit, durable };
  });
  expect(results.committed.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(results.before.count).toBe(12);
  expect(results.after).toEqual(results.before);
  expect(results.rejected).toBe(4);
  expect(results.closedCommit).toBe(13);
  expect(results.durable.count).toBe(13);
});

test('Verification Worker accepts the transactional adapter', async ({ page }) => {
  const snapshot = { '/host/chat-history.js': await readFile('self/host/chat-history.js', 'utf8'),
    '/vendor/reploid/adapters/browser.js': await readFile('packages/reploid/src/adapters/browser.js', 'utf8'),
    '/vendor/reploid/chat/workspace-publication.js': await readFile('packages/reploid/src/chat/workspace-publication.js', 'utf8') };
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timeout')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
});
