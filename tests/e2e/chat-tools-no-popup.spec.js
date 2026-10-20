import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real browser presentation with an injected session; no network search or model execution.
const origin = 'http://127.0.0.1:8131';
const root = path.resolve('self');
test.beforeEach(async ({ page }) => {
  await page.route(origin + '/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') {
      const layers = JSON.parse(await readFile('self/styles/poolday/layers.json', 'utf8'));
      const files = Object.values(layers).flat();
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Tool activity fixture</title>'
        + '<link rel="stylesheet" href="/styles/rd.css">' + files.map(file => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('')
        + '<main class="pool-home" id="fixture"></main>' });
    }
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { return route.fulfill({ contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream', body: await readFile(file) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto(origin);
});

test('Send, search progress, cancellation and Retry have no permission popups', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async () => {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const model = { id: 'fixture', name: 'Fixture model', availability: 'ready', identity: 'sha256:' + 'a'.repeat(64) };
    const thread = { id: 'fixture-thread', model, messages: [], attempts: [], grants: [], permissions: { sharingScope: 'mesh', executionLocation: 'network' } };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: [], network: {}, remoteAnswersEnabled: true };
    const listeners = new Set(), notify = () => listeners.forEach(fn => fn(state));
    let complete;
    const run = search => {
      const id = 'attempt-' + thread.attempts.length;
      thread.attempts.push({ id, status: 'queued', request: { retrieval: { route: search.route, query: search.query } }, retrieval: { outcome: 'pending' } });
      thread.messages.push({ id: 'reply-' + id, role: 'assistant', attemptId: id, content: '' });
      state.runningIds = [thread.id]; notify();
      return new Promise(resolve => { complete = resolve; });
    };
    const finish = status => {
      const attempt = thread.attempts.at(-1); attempt.status = status;
      state.runningIds = []; notify(); complete(attempt);
    };
    const session = {
      getState: () => state, subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
      preferredSearchRoute: () => 'contributor-search',
      searchPermissionRequest: async () => ({ route: 'contributor-search', recipients: ['fixture-peer'], wording: { id: 'fixture', version: '1', text: 'Fixture only' } }),
      send(id, content, attachments, { search }) { window.sent.push(search); thread.messages.push({ id: 'question', role: 'user', content }); return run(search); },
      searchRetryNeedsPermission: () => true,
      retry(id, attempt, { search }) { window.sent.push(search); return run(search); },
      cancel() { finish('cancelled'); }
    };
    window.sent = []; window.finish = finish;
    window.progress = progress => { thread.attempts.at(-1).retrieval.progress = progress; notify(); };
    const root = document.querySelector('#fixture'); root.innerHTML = renderConversationWorkspace();
    bindConversationWorkspace(root, session, { search: { available: () => true, state: () => ({ state: 'ready' }), subscribe(fn) { fn(); return () => {}; } } });
  });
  await expect(page.locator('[data-search-permission], [data-remote-permission]')).toHaveCount(0);
  await page.locator('[data-search-toggle]').click();
  await page.locator('[data-composer-input]').fill('Find movie recommendations');
  await page.locator('[data-composer-send]').click();
  const tool = page.locator('.is-assistant [data-tool-status]').last();
  await expect(tool).toBeVisible(); await expect(tool).toHaveText('Searching the web…');
  await page.evaluate(() => window.progress({ stage: 'extraction', completed: 2, total: 4, available: 1 }));
  await expect(tool).toHaveText('Reading search results · 2 of 4 pages');
  await page.screenshot({ path: info.outputPath('tool-loader.png'), fullPage: true });
  await page.locator('[data-composer-stop]').click();
  await expect(tool).toBeHidden();
  await page.locator('[data-retry-attempt]').click();
  await expect(page.locator('.is-assistant [data-tool-status]').last()).toHaveText('Searching the web…');
  expect(await page.evaluate(() => window.sent.map(item => ({ query: item.query, source: item.source })))).toEqual([
    { query: 'Find movie recommendations', source: 'send' }, { query: 'Find movie recommendations', source: 'send' }
  ]);
  await page.locator('[data-composer-stop]').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('changed runtime passes the actual browser Verification Worker', async ({ page }, info) => {
  const paths = ['host/chat-session.js', 'ui/pool-home/conversation-workspace.js', 'ui/pool-home/execution-activity.js',
    'ui/pool-home/message-list.js', 'ui/pool-home/remote-permission.js', 'vendor/reploid/chat/search-permission.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async name => ['/' + name, await readFile('self/' + name, 'utf8')])));
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timeout')); }, 15000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  await info.attach('verification-worker.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});
