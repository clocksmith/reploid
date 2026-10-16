import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { attachBrowserWebBridge } from '../../server/browser-web-bridge.js';

const origin = 'http://127.0.0.1:5198';
test('explicit browser bridge supplies only its top-level page and forwards cancellation', async ({ page, context }) => {
  await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Bridge fixture</title>' }));
  let calls = 0, cancelled = false;
  const bridge = await attachBrowserWebBridge({ page, origin, worker: {
    service: 'bing', version: '1',
    search: async ({ query }, { signal, requester }) => {
      calls++;
      expect(requester).toBe('verified-requester');
      if (query === 'wait') return new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true }));
      return { results: [{ title: 'Fixture result' }] };
    }
  } });
  try {
    await page.goto(origin);
    expect(await page.evaluate(() => globalThis.REPLOID_WEB_CONTRIBUTION.search({ query: 'question' }, { requester: 'verified-requester' })))
      .toEqual({ results: [{ title: 'Fixture result' }] });
    await page.evaluate(origin => { const frame = document.createElement('iframe'); frame.src = origin + '/frame'; document.body.append(frame); }, origin);
    await expect.poll(() => page.frames().length).toBe(2);
    expect(await page.frames()[1].evaluate(() => typeof globalThis.REPLOID_WEB_CONTRIBUTION)).toBe('undefined');
    expect(await page.frames()[1].evaluate(async () => {
      const binding = Object.keys(globalThis).find(key => key.startsWith('reploidWeb_'));
      try { await globalThis[binding]({ id: 'frame', operation: 'search', args: {}, requester: 'verified-requester' }); return 'unexpected'; }
      catch { return 'refused'; }
    })).toBe('refused');
    const other = await context.newPage(); await other.goto(origin);
    expect(await other.evaluate(() => typeof globalThis.REPLOID_WEB_CONTRIBUTION)).toBe('undefined');
    await other.close();
    await page.evaluate(() => {
      const controller = new AbortController(); globalThis.stopWeb = () => controller.abort();
      globalThis.pendingWeb = globalThis.REPLOID_WEB_CONTRIBUTION.search({ query: 'wait' }, { requester: 'verified-requester', signal: controller.signal })
        .then(() => 'unexpected', () => 'cancelled');
    });
    await expect.poll(() => calls).toBe(2);
    await page.evaluate(() => globalThis.stopWeb());
    expect(await page.evaluate(() => globalThis.pendingWeb)).toBe('cancelled');
    expect(cancelled).toBe(true);
  } finally { bridge.close(); }
});

test('new web execution modules pass the browser Verification Worker', async ({ page }) => {
  await page.route(`${origin}/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Verification</title>' });
    const filename = path.resolve('self', '.' + pathname);
    if (!filename.startsWith(path.resolve('self') + '/')) return route.abort();
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(filename) });
  });
  const files = ['packages/reploid/src/mesh/web-access-network.js', 'self/host/contributor-search.js',
    'server/public-web-worker.js', 'server/browser-web-bridge.js'];
  const snapshot = Object.fromEntries(await Promise.all(files.map(async file => ['/' + file.replace(/^self\//, ''), await readFile(file, 'utf8')])));
  await page.goto(origin);
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    worker.onerror = error => { worker.terminate(); reject(new Error(error.message)); };
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
});
