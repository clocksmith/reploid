import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateRoom } from '../fixtures/current-contribution.js';

/**
 * A slow catalog origin on a first visit: "Download within a limit" (bounded piece acquisition), weight-supply dev
 * flag on, a fresh profile whose model-file cache is asserted empty, and every catalog-origin byte fetched live from
 * the real origin (no pre-download).
 *
 *   REPLOID_E2E_SLOW_ORIGIN=1 [REPLOID_E2E_SHOTS=<dir>] npx playwright test --config tests/playwright.config.js \
 *     tests/e2e/weight-supply-slow-origin.spec.js --project chromium --grep desktop   (then --grep mobile)
 *
 * The page's fetch is paced in the page (the real response body re-emitted at a fixed rate), since a fulfilled route
 * cannot stream; the route only adds the CORS headers the origin's redirect lacks. Pieces are 4 MiB; the allowance
 * (9 MiB) covers the manifest, the piece index and two pieces of shard_00000.
 *   - steady: 100 KiB/s throughout, so each piece takes about 41 s and a 64 MiB shard would take about 11 minutes.
 *     The transfer keeps making progress and must complete: the switch reaches Sharing with both pieces.
 *   - stall: 1 MiB/s, and the second piece's response stops after 1 MiB. The fetch must fail once no byte has arrived
 *     for the no-progress limit, with a clear error; the first verified piece stays stored; switching on again
 *     fetches only the missing piece (no second request for the first) and reaches Sharing.
 */
const RUN = process.env.REPLOID_E2E_SLOW_ORIGIN === '1';
const SHOTS = process.env.REPLOID_E2E_SHOTS || '';
const MODEL = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
const ORIGIN = `https://replo.id/model-files/${MODEL}/`;
const FLAG = 'reploid.dev.weight-supply';
const ALLOWANCE_MIB = 9;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const INDEX = JSON.parse(readFileSync(new URL('../../shared/config/model-pieces/qwen-0-8b-pieces.json', import.meta.url), 'utf8'));
const PIECES = INDEX.files.find(row => row.path === 'shard_00000.bin').pieces.slice(0, 2)
  .map(piece => ({ pieceId: piece.identity, range: `bytes=${piece.offset}-${piece.offset + piece.size - 1}` }));
const FAILED = /error|fail|cannot|No verified|unavailable|HTTP|abort|stopped|timed out|stalled/i;

test.use({ actionTimeout: 30000 });
test.skip(!RUN, 'Set REPLOID_E2E_SLOW_ORIGIN=1: fetches about 10 MiB from the real catalog origin per case.');

/** In-page pacing of catalog-origin response bodies (window.__reploidPace = { rate, stall: { range, after } | null }). */
const pacer = origin => {
  const original = window.fetch.bind(window);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const response = await original(input, init);
    const pace = window.__reploidPace;
    if (!pace || !url.startsWith(origin) || !response.body) return response;
    const range = new Headers(init.headers || {}).get('range');
    const stallAt = pace.stall && pace.stall.range === range ? pace.stall.after : Infinity;
    const reader = response.body.getReader(), signal = init.signal;
    let pending = null, sent = 0;
    const body = new ReadableStream({
      start(controller) { signal?.addEventListener('abort', () => { controller.error(signal.reason); reader.cancel().catch(() => {}); }, { once: true }); },
      async pull(controller) {
        if (!pending?.byteLength) {
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          pending = value;
        }
        const size = Math.min(pending.byteLength, 16384);
        if (sent + size > stallAt) { window.__reploidStalled = (window.__reploidStalled || 0) + 1; await new Promise(() => {}); }
        await sleep(size / pace.rate * 1000);
        controller.enqueue(pending.slice(0, size)); pending = pending.subarray(size); sent += size;
      },
      cancel(reason) { return reader.cancel(reason); }
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
};

async function openPage(browser, viewport, room, pace) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const log = [];
  await context.route(`${ORIGIN}**`, async route => {
    const request = route.request(), range = request.headers().range || null;
    log.push({ at: Date.now(), path: request.url().slice(ORIGIN.length), range });
    try {
      const response = await route.fetch({ timeout: 0 });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
    } catch { await route.abort().catch(() => {}); }
  });
  await context.addInitScript(({ flag, pace }) => {
    try { localStorage.setItem('reploid.auto-download.v1', 'off'); localStorage.setItem(flag, '1'); } catch { /* fresh profile */ }
    window.__reploidPace = pace;
  }, { flag: FLAG, pace });
  await context.addInitScript(pacer, ORIGIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(room);
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  return { context, page, log, errors };
}

/** Piece and model files in this profile's model-file cache, and the download allowance state. */
const storedFiles = page => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const names = [];
  for await (const [name] of root.entries()) {
    if (name !== 'reploid-chat-artifacts-v1') { names.push('(root) ' + name); continue; }
    for await (const [file] of (await root.getDirectoryHandle(name)).entries()) names.push(file);
  }
  return names;
});

/** The persistent download allowance: { maxBytes, reservedBytes }, or null before one exists. */
const allowance = page => page.evaluate(() => new Promise(resolve => {
  const opening = indexedDB.open('reploid-custody-acquisition-budget-v1');
  opening.onerror = () => resolve(null);
  opening.onsuccess = () => {
    const db = opening.result;
    if (!db.objectStoreNames.contains('allowance')) { db.close(); resolve(null); return; }
    const read = db.transaction('allowance').objectStore('allowance').get('acquisition');
    read.onsuccess = () => { db.close(); resolve(read.result ? { maxBytes: read.result.maxBytes, reservedBytes: read.result.reservedBytes } : null); };
    read.onerror = () => { db.close(); resolve(null); };
  };
}));

async function openPane(page, section) {
  const pane = page.locator(`[data-inspector-pane="${section}"]`);
  if (!await pane.isVisible()) await page.locator(`[data-inspector-section="${section}"]`).first().click();
  await expect(pane).toBeVisible();
}

const fileStatus = page => page.evaluate(() => ({
  status: document.querySelector('[data-file-sharing-row] [id$="-status"]')?.textContent?.trim() ?? '',
  progress: document.querySelector('[data-file-progress]')?.textContent?.trim() ?? '',
  on: document.querySelector('[data-toggle-file-contribution]')?.getAttribute('aria-checked') ?? null }));

async function chooseLimit(page) {
  await openPane(page, 'settings');
  const options = page.locator('[data-model-sharing-limits]');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
  await page.locator(`[data-contribution-model="${MODEL}"] input, [data-contribution-model="${MODEL}"]`).first().click();
  await page.locator('input[data-file-mode="bounded-acquisition"]').check();
  await page.locator('[data-file-download] input, input[data-file-download]').first().fill(String(ALLOWANCE_MIB));
}

/** Switches file sharing on and waits for Sharing, a failure, or the switch back off. Returns a timeline. */
async function runToEnd(page, timeout) {
  const started = Date.now(), timeline = [], stale = (await fileStatus(page)).status;
  await page.locator('[data-toggle-file-contribution]').click();
  let last = null, idle = 0, fresh = false;
  await expect.poll(async () => {
    last = await fileStatus(page);
    const key = last.status + ' | ' + last.progress.replace(/\d+%/, '%');
    if (timeline.at(-1)?.key !== key) timeline.push({ s: Math.round((Date.now() - started) / 1000), key, status: last.status, progress: last.progress });
    // A retry starts from the previous failure's text: wait for the new attempt before reading an outcome.
    fresh ||= last.status !== stale || Date.now() - started > 5000;
    idle = last.on === 'false' && !last.progress ? idle + 1 : 0;
    return fresh && (last.status === 'Sharing' || FAILED.test(last.status) || idle >= 5);
  }, { timeout, intervals: [1000] }).toBe(true).catch(() => {});
  return { ...last, seconds: Math.round((Date.now() - started) / 1000), timeline: timeline.map(({ key, ...row }) => row) };
}

const pieceRequests = (log, range) => log.filter(row => row.path === 'shard_00000.bin' && row.range === range).length;
const pieceName = pieceId => 'sha256-' + pieceId.slice(7);

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const kind of ['steady', 'stall']) {
    test(`slow catalog origin, ${kind}: ${viewportName}`, async ({ browser, baseURL }) => {
      test.setTimeout(10 * 60000);
      const pace = kind === 'steady' ? { rate: 100 * 1024, stall: null } : { rate: 1024 * 1024, stall: { range: PIECES[1].range, after: 1 << 20 } };
      const peer = await openPage(browser, viewport, baseURL + privateRoom(`slow-origin-${kind}-${viewportName}`), pace);
      const report = { kind, viewport: viewportName, pace };
      try {
        report.storedBefore = await storedFiles(peer.page);
        expect(report.storedBefore.filter(name => !name.startsWith('(root)')), 'fresh profile: model-file cache empty').toEqual([]);
        await chooseLimit(peer.page);
        report.first = await runToEnd(peer.page, 6 * 60000);
        report.storedAfterFirst = await storedFiles(peer.page);
        report.firstRequests = peer.log.map(row => row.path + (row.range ? ' ' + row.range : ''));
        report.stalled = await peer.page.evaluate(() => window.__reploidStalled || 0);
        report.allowanceAfterFirst = await allowance(peer.page);
        if (kind === 'steady') {
          expect(report.first.status, JSON.stringify(report)).toBe('Sharing');
          for (const piece of PIECES) expect(report.storedAfterFirst).toContain(pieceName(piece.pieceId));
        } else {
          expect(report.stalled, 'the second piece stalled').toBeGreaterThan(0);
          expect(report.first.status, JSON.stringify(report)).not.toBe('Sharing');
          expect(report.storedAfterFirst, 'the verified first piece survives the failure').toContain(pieceName(PIECES[0].pieceId));
          // Retry with the origin no longer stalling.
          await peer.page.evaluate(() => { window.__reploidPace = { ...window.__reploidPace, stall: null }; });
          if (await peer.page.locator('[data-toggle-file-contribution]').getAttribute('aria-checked') === 'true') {
            await peer.page.locator('[data-toggle-file-contribution]').click();
            await expect(peer.page.locator('[data-toggle-file-contribution]')).toHaveAttribute('aria-checked', 'false');
          }
          const before = peer.log.length;
          report.retry = await runToEnd(peer.page, 3 * 60000);
          report.retryRequests = peer.log.slice(before).map(row => row.path + (row.range ? ' ' + row.range : ''));
          report.storedAfterRetry = await storedFiles(peer.page);
          report.allowanceAfterRetry = await allowance(peer.page);
          expect(pieceRequests(peer.log.slice(before), PIECES[0].range), 'retry does not download the verified piece again').toBe(0);
          expect(report.retry.status, JSON.stringify(report)).toBe('Sharing');
          for (const piece of PIECES) expect(report.storedAfterRetry).toContain(pieceName(piece.pieceId));
        }
        report.pageErrors = peer.errors;
        // The Settings switch drops the rejected toggle (`void services.toggleFileSharing(...)`), so the failure the
        // status line shows also surfaces as an unhandled rejection. Nothing else may.
        expect(peer.errors.filter(message => kind !== 'stall' || message !== report.first.status)).toEqual([]);
      } finally {
        console.log(`[slow-origin ${kind} ${viewportName}] ${JSON.stringify(report)}`);
        if (SHOTS) {
          await writeFile(join(SHOTS, `slow-origin-${kind}-${viewportName}.json`), JSON.stringify(report, null, 2));
          await peer.page.screenshot({ path: join(SHOTS, `slow-origin-${kind}-${viewportName}.png`) }).catch(() => {});
        }
        await peer.context.close();
      }
    });
  }
}
