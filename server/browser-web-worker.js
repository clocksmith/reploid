/** Operator-owned unsigned-in search profile. Only Google receives browser cookies;
 * result documents use the existing public, DNS-guarded, cookie-free reader. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicWebWorker } from './public-web-worker.js';

const GOOGLE = 'https://www.google.com';
const MARKER = '.reploid-search-profile';

export async function openBrowserWebWorker({ profileDirectory, launch, pageFetch } = {}) {
  if (!path.isAbsolute(profileDirectory || '')) throw new Error('Browser search needs an absolute dedicated profile directory');
  await fs.mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(profileDirectory);
  if (entries.length && !entries.includes(MARKER)) throw new Error('Refusing a browser profile not created for Reploid search');
  await fs.writeFile(path.join(profileDirectory, MARKER), 'Dedicated Reploid public search profile; do not sign in.\n', { mode: 0o600 });
  if (!launch) {
    const { chromium } = await import('playwright').catch(() => { throw new Error('Browser search requires Playwright and Chrome; see docs/native-participant.md'); });
    launch = chromium.launchPersistentContext.bind(chromium);
  }
  const context = await launch(profileDirectory, { channel: 'chrome', headless: false, serviceWorkers: 'block' });
  const worker = createBrowserWebWorker({ context, pageFetch });
  return Object.freeze({ ...worker, async close() { await worker.close(); await context.close(); } });
}

export function createBrowserWebWorker({ context, pageFetch }) {
  let closed = false, active = null, verificationPage = null;
  context.on?.('close', () => { closed = true; active?.controller.abort(new Error('Contributor browser closed')); });
  const searchResults = async ({ query, maxResults, signal }) => {
    signal?.throwIfAborted();
    if (closed) throw new Error('Browser search is closed');
    if (active) throw new Error('Browser search is busy');
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', forward, { once: true });
    const job = { controller, settled: null }; active = job;
    job.settled = (async () => {
      const page = await context.newPage();
      const stop = () => { void page.close().catch(() => {}); };
      controller.signal.addEventListener('abort', stop, { once: true });
      try {
        controller.signal.throwIfAborted();
        // Search never follows result links in the browser. Block unrelated subresources.
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          const allowed = url.protocol === 'https:' && /(^|\.)(google\.com|gstatic\.com|googleusercontent\.com)$/.test(url.hostname);
          return allowed ? route.continue() : route.abort();
        });
        const url = new URL('/search', GOOGLE); url.searchParams.set('q', query);
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 8000 });
        if (new URL(page.url()).pathname.startsWith('/sorry')) {
          const operatorPage = context.pages().find(tab => tab !== page);
          verificationPage = operatorPage;
          await operatorPage?.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {});
          throw new Error('Google needs human verification in the contributor browser');
        }
        await page.locator('a:has(h3)').first().waitFor({ state: 'visible', timeout: 4000 });
        const rows = await page.locator('a:has(h3)').evaluateAll((anchors, limit) => anchors.filter(a => a.getClientRects().length).slice(0, limit).map(a => ({
          url: a.href, title: a.querySelector('h3').innerText,
          excerpt: (a.closest('div.MjjYud')?.innerText || a.innerText).slice(0, 1500)
        })), maxResults);
        const settled = await Promise.allSettled(rows.map(async row => {
          let target = new URL(row.url);
          if (target.origin === GOOGLE && ['/goto', '/url'].includes(target.pathname)) {
            // Resolve only the search engine hop with its own session; never forward cookies to a result.
            const response = await context.request.get(target.href, { maxRedirects: 0, timeout: 4000 });
            try {
              if (![301, 302, 303, 307, 308].includes(response.status()) || !response.headers().location) return null;
              target = new URL(response.headers().location, target);
            } finally { await response.dispose(); }
          }
          if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || /(^|\.)google\.com$/.test(target.hostname)) return null;
          return { ...row, url: target.href };
        }));
        controller.signal.throwIfAborted();
        const failed = settled.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        const results = settled.map(result => result.value).filter(Boolean);
        if (!results.length) throw new Error('Browser search returned no usable public results');
        return results;
      } finally {
        controller.signal.removeEventListener('abort', stop);
        await page.close().catch(() => {});
      }
    })();
    try { return await job.settled; }
    finally { signal?.removeEventListener('abort', forward); if (active === job) active = null; }
  };
  const worker = createPublicWebWorker({ service: 'google-browser', searchResults, pageFetch });
  return Object.freeze({ ...worker,
    isAvailable: () => !closed && (!verificationPage || verificationPage.isClosed() || !new URL(verificationPage.url()).pathname.startsWith('/sorry')),
    extract(args, owner) { if (closed) return Promise.reject(new Error('Browser search is closed')); return worker.extract(args, owner); },
    async close() { closed = true; active?.controller.abort(new Error('Browser search closed')); await active?.settled.catch(() => {}); }
  });
}
