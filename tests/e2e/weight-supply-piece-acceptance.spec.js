import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateRoom } from '../fixtures/current-contribution.js';

/**
 * INTERIM piece-supply acceptance check for weight supply (the "Contribute this computer" weight-supply block).
 *
 * It is not the full-model acceptance test. Only "Download within a limit" (bounded piece acquisition) and the split
 * path fetch individual pieces from peers; a full model load fetches whole files, which a new device's pieces cannot
 * supply, and the owner has not decided whether it should. So the consumer here fetches verified pieces under a small
 * allowance; it does not load the model for inference.
 *
 *   REPLOID_E2E_WEIGHT_SUPPLY=1 REPLOID_E2E_BASE_URL=http://localhost:<port> [REPLOID_E2E_MODEL_CACHE=<dir>] \
 *   [REPLOID_E2E_SHOTS=<dir>] npx playwright test --config tests/playwright.config.js \
 *     tests/e2e/weight-supply-piece-acceptance.spec.js --project chromium --grep desktop   (then --grep mobile)
 *
 * Real page, private room on the local signaling server, real catalog-origin bytes for the first 64 MiB shard and the
 * tokenizer only (cached on disk with REPLOID_E2E_MODEL_CACHE). No GPU work.
 *
 * Pieces are 4 MiB. A fresh profile's allowance also pays for the manifest and piece index (about 263 KB), so:
 *   - Source S, allowance 9 MiB, catalog origin allowed: holds shard_00000 #0, #1 and tokenizer #2, and shares them.
 *   - Consumer, allowance 13 MiB, every catalog-origin request blocked: wants those plus shard_00000 #2 (the gap).
 *   - New device N: weight supply (dev flag on), catalog origin allowed; it fills the gap.
 * Runs: a cold control consumer fails at the gap; a demand consumer's gap request is held at the origin (blocked,
 * never answered) while N refreshes, is offered the gap piece and approves it with a cap it chose; a cold acceptance
 * consumer then gets every piece from peers with no catalog-origin request, and N's served-transfer record names the
 * gap piece; N reloads with its approval and piece; N pauses and a further cold consumer fails at the gap again.
 * Each sentence is recorded pass or fail in <shots>/weight-supply-<viewport>.json; the test fails when any fails.
 */
const RUN = process.env.REPLOID_E2E_WEIGHT_SUPPLY === '1';
const CACHE = process.env.REPLOID_E2E_MODEL_CACHE || '';
const SHOTS = process.env.REPLOID_E2E_SHOTS || '';
const MODEL = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
const ORIGIN = `https://replo.id/model-files/${MODEL}/`;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const SOURCE_MIB = 9, CONSUMER_MIB = 13;
const FLAG = 'reploid.dev.weight-supply';
const INDEX = JSON.parse(readFileSync(new URL('../../shared/config/model-pieces/qwen-0-8b-pieces.json', import.meta.url), 'utf8'));
const GAP = (() => {
  const shard = INDEX.files.find(row => row.path === 'shard_00000.bin'), piece = shard.pieces[2];
  return { path: shard.path, offset: piece.offset, size: piece.size, pieceId: piece.identity, range: `bytes=${piece.offset}-${piece.offset + piece.size - 1}` };
})();

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 30000 });
test.skip(!RUN, 'Set REPLOID_E2E_WEIGHT_SUPPLY=1: opens several browser profiles and fetches 64 MiB of catalog files.');

/**
 * Catalog-origin model files. `serve`: the real bytes (kept on disk across profiles; ranges cut from the whole file).
 * `block`: every request refused. `hold`: every request left unanswered until `release()`, then refused.
 */
const files = new Map();
/** One catalog file, whole: from REPLOID_E2E_MODEL_CACHE when kept there, else fetched once (and kept). */
const catalogFile = url => {
  if (!files.has(url)) files.set(url, (async () => {
    const path = CACHE ? join(CACHE, createHash('sha256').update(url).digest('hex')) : '';
    if (path && await stat(path).then(() => true, () => false)) return readFile(path);
    const response = await fetch(url);
    if (response.status !== 200) throw new Error(`${url}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (path) { await mkdir(CACHE, { recursive: true }); await writeFile(path, body); }
    return body;
  })().catch(cause => { files.delete(url); throw cause; }));
  return files.get(url);
};
// The page times a piece fetch out after 30 s; a first download of a 64 MiB file must not count against it.
const warmCatalog = () => Promise.all(['shard_00000.bin', 'tokenizer.json'].map(path => catalogFile(ORIGIN + path)));

async function routeOrigin(context, mode) {
  const log = [], held = [];
  await context.route(`${ORIGIN}**`, async route => {
    const url = route.request().url(), range = route.request().headers().range || null;
    log.push({ path: url.slice(ORIGIN.length), range });
    if (mode === 'block') return route.abort();
    if (mode === 'hold') return new Promise(resolve => held.push(() => resolve(route.abort().catch(() => {}))));
    try {
      const body = await catalogFile(url);
      const match = range && /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) return route.fulfill({ status: 200, body, headers: { 'content-length': String(body.length), 'access-control-allow-origin': '*' } });
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      return route.fulfill({ status: 206, body: body.subarray(start, end + 1), headers: {
        'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': String(end - start + 1),
        'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
    } catch { return route.abort(); }
  });
  return { log, release: () => { for (const answer of held.splice(0)) answer(); } };
}

async function openPeer(browser, viewport, room, label, { origin, weightSupply = false }) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const routes = await routeOrigin(context, origin);
  await context.addInitScript(flag => {
    try {
      localStorage.setItem('reploid.auto-download.v1', 'off');
      if (flag) localStorage.setItem(flag, '1');
    } catch { /* fresh profile */ }
  }, weightSupply ? FLAG : null);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(room);
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  return { context, page, routes, errors, label };
}

const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: join(SHOTS, name + '.png') }); } };

async function openPane(page, section) {
  const pane = page.locator(`[data-inspector-pane="${section}"]`);
  if (!await pane.isVisible()) await page.locator(`[data-inspector-section="${section}"]`).first().click();
  await expect(pane).toBeVisible();
  return pane;
}

async function openThisComputer(page) {
  await openPane(page, 'participants');
  const device = page.locator('[data-production-device]');
  if (!await device.evaluate(node => node.open)) await device.locator(':scope > summary').click();
  await expect(page.locator('[data-this-computer]')).toBeVisible();
}

const fileStatus = page => page.evaluate(() => ({
  status: document.querySelector('[data-file-sharing-row] [id$="-status"]')?.textContent?.trim() ?? '',
  progress: document.querySelector('[data-file-progress]')?.textContent?.trim() ?? '',
  on: document.querySelector('[data-toggle-file-contribution]')?.getAttribute('aria-checked') ?? null }));
const FAILED = /error|fail|cannot|No verified|unavailable|HTTP|abort|stopped|timed out/i;

/** Settings → Share model files → Download within a limit → `mib` → on. Returns once the acquisition has started. */
async function startPieces(peer, mib) {
  const { page } = peer;
  await openPane(page, 'settings');
  const options = page.locator('[data-model-sharing-limits]');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
  await page.locator(`[data-contribution-model="${MODEL}"] input, [data-contribution-model="${MODEL}"]`).first().click();
  await page.locator('input[data-file-mode="bounded-acquisition"]').check();
  await page.locator('[data-file-download] input, input[data-file-download]').first().fill(String(mib));
  // Peer discovery first: a piece another computer offers is taken from it.
  await page.waitForTimeout(8000);
  await page.locator('[data-toggle-file-contribution]').click();
}

/** Waits for the acquisition to end: Sharing, a failure, or the switch back off with no progress line. */
async function piecesResult(peer, timeout = 3 * 60000) {
  let last = null, idle = 0;
  const progress = new Set();
  await expect.poll(async () => {
    last = await fileStatus(peer.page);
    if (last.progress) progress.add(last.progress);
    idle = last.on === 'false' && !last.progress ? idle + 1 : 0;
    return last.status === 'Sharing' || FAILED.test(last.status) || idle >= 5;
  }, { timeout, intervals: [1000] }).toBe(true).catch(() => {});
  return { ...last, progress: [...progress], originRequests: peer.routes.log.map(row => row.path + (row.range ? ' ' + row.range : '')) };
}

/** N's weight-supply block as the page shows it. */
async function supplyState(page) {
  await openThisComputer(page);
  return page.evaluate(() => {
    const block = document.querySelector('[data-weight-supply]');
    if (!block) return { shown: false };
    return { shown: true, state: block.getAttribute('data-weight-supply-state'), paused: block.getAttribute('data-weight-supply-paused'),
      verifiedBytes: Number(block.getAttribute('data-weight-supply-verified-bytes')),
      offer: block.querySelector('[data-weight-supply-offer]')?.getAttribute('data-weight-supply-offer') ?? null,
      noOffer: block.querySelector('[data-weight-supply-no-offer]')?.getAttribute('data-weight-supply-no-offer') ?? null,
      caps: [...block.querySelectorAll('[data-weight-supply-cap] input[type="radio"]')].map(input => ({ bytes: Number(input.value), disabled: input.disabled, checked: input.checked })),
      transfers: [...block.querySelectorAll('[data-weight-supply-transfer]')].map(row => ({ id: row.getAttribute('data-weight-supply-transfer'),
        pieceId: row.getAttribute('data-piece'), deliveredBytes: Number(row.getAttribute('data-delivered-bytes')), consumer: row.getAttribute('data-consumer') })),
      error: block.querySelector('[data-weight-supply-error]')?.textContent?.trim() ?? '',
      text: block.textContent.replace(/\s+/g, ' ').trim().slice(0, 400),
      answerRequests: document.querySelector('[data-toggle-contribution]')?.getAttribute('aria-checked') ?? null };
  });
}

async function waitSupply(page, test, timeout) {
  let last = null;
  await expect.poll(async () => { last = await supplyState(page); return test(last); }, { timeout, intervals: [1000] }).toBe(true).catch(() => {});
  return last;
}

/** A cold consumer with every catalog-origin request blocked, run to its end. */
async function coldConsumer(browser, viewport, room, label) {
  const c = await openPeer(browser, viewport, room, label, { origin: 'block' });
  try {
    await startPieces(c, CONSUMER_MIB);
    const result = await piecesResult(c);
    await shot(c.page, label);
    return result;
  } finally { await c.context.close(); }
}

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  test(`interim piece-supply acceptance check: ${viewportName}`, async ({ browser, baseURL }) => {
    test.setTimeout(30 * 60000);
    const id = `weight-supply-${viewportName}`, results = [];
    const record = (step, sentence, pass, detail) => {
      const status = pass ? 'pass' : 'fail';
      results.push({ step, sentence, status, detail });
      console.log(`[${id}] ${step} ${status}: ${sentence} ${JSON.stringify(detail).slice(0, 400)}`);
    };
    const save = () => SHOTS ? writeFile(join(SHOTS, `${id}.json`), JSON.stringify({ id, check: 'interim piece-supply acceptance (Download within a limit)',
      at: new Date().toISOString(), gap: GAP, results }, null, 2)) : null;
    await warmCatalog();
    const room = baseURL + privateRoom(`wsupply-${viewportName}`);
    const gapRequest = row => row.path === GAP.path && row.range === GAP.range;
    const s = await openPeer(browser, viewport, room, `${id}-S`, { origin: 'serve' });
    let n = null;
    try {
      // 1. The source shares a subset of pieces.
      await startPieces(s, SOURCE_MIB);
      const source = await piecesResult(s);
      await shot(s.page, `${id}-S-sharing`);
      record(1, 'Source: Download within a limit reaches Sharing', source.status === 'Sharing', source);
      record(1, 'Source never fetches the gap piece', !s.routes.log.some(gapRequest), { originRequests: source.originRequests });

      // 2. Cold control: without the new device the consumer stops at the gap, fetching nothing from the origin.
      const control = await coldConsumer(browser, viewport, room, `${id}-C1-control`);
      record(2, 'Control consumer does not reach Sharing', control.status !== 'Sharing', control);
      record(2, 'Control consumer: its only catalog-origin request is the gap piece (blocked)',
        control.originRequests.length > 0 && control.originRequests.every(line => line === `${GAP.path} ${GAP.range}`), { originRequests: control.originRequests });
      await save();

      // 3. The new device: opening asks once, with no demand yet there is no offer.
      n = await openPeer(browser, viewport, room, `${id}-N`, { origin: 'serve', weightSupply: true });
      const opened = await waitSupply(n.page, value => value.shown && value.state !== 'asking', 60000);
      await shot(n.page, `${id}-N-opened`);
      record(3, 'New device: the weight-supply block shows with the dev flag and makes no offer before any demand',
        opened.shown && opened.state === 'no-offer' && !opened.offer, opened);
      record(3, 'New device: Answer requests stays off', opened.answerRequests === 'false', { answerRequests: opened.answerRequests });

      // 4. Demand: a consumer's gap request is held at the origin; Refresh offers the gap piece; the person picks a cap.
      const c2 = await openPeer(browser, viewport, room, `${id}-C2-demand`, { origin: 'hold' });
      let offered = null, approved = null;
      try {
        await startPieces(c2, CONSUMER_MIB);
        await expect.poll(() => c2.routes.log.some(gapRequest), { timeout: 2 * 60000, intervals: [500] }).toBe(true).catch(() => {});
        record(4, 'Demand consumer reaches the gap piece (its origin request is held, unanswered)', c2.routes.log.some(gapRequest), { originRequests: c2.routes.log });
        await openThisComputer(n.page);
        await n.page.locator('[data-weight-supply-refresh]').click();
        offered = await waitSupply(n.page, value => value.state === 'offer', 20000);
        await shot(n.page, `${id}-N-offer`);
        record(4, 'New device: Refresh while the consumer fetches offers a recommendation', offered.state === 'offer' && !!offered.offer, offered);
        record(4, 'The offer is the gap piece only (4 MiB, one piece)', /OWNER: Download\s*4\.0 MiB/.test(offered.text ?? '') && /OWNER: Pieces\s*1/.test(offered.text ?? ''), { text: offered.text });
        // Every cap option exceeds a 4 MiB offer here; the unit test covers disabling smaller ones.
        record(4, 'No cap is chosen by default, and an option is disabled exactly when it is smaller than the download',
          offered.caps.length > 0 && offered.caps.every(cap => !cap.checked && cap.disabled === cap.bytes < GAP.size), { caps: offered.caps });
        const cap = offered.caps.find(row => !row.disabled);
        if (cap) {
          await n.page.locator(`[data-weight-supply-cap] input[value="${cap.bytes}"]`).check();
          await n.page.locator('[data-weight-supply-approve]').click();
        }
        approved = await waitSupply(n.page, value => value.state === 'approved' && value.verifiedBytes === GAP.size, 2 * 60000);
        await shot(n.page, `${id}-N-approved`);
        record(4, 'New device: Approve with the chosen cap fetches and verifies the gap piece', approved.state === 'approved' && approved.verifiedBytes === GAP.size,
          { ...approved, cap: cap?.bytes ?? null });
      } finally {
        c2.routes.release();
        await c2.context.close();
      }
      await save();

      // 5. Acceptance: a cold consumer gets every piece from peers; the new device's transfer record names the gap piece.
      const before = (await supplyState(n.page)).transfers.length;
      const accepted = await coldConsumer(browser, viewport, room, `${id}-C3-accept`);
      const served = await waitSupply(n.page, value => value.transfers.length > before, 30000);
      const fresh = served.transfers.slice(before);
      record(5, 'Acceptance consumer reaches Sharing', accepted.status === 'Sharing', accepted);
      record(5, 'Acceptance consumer makes no catalog-origin request', accepted.originRequests.length === 0, { originRequests: accepted.originRequests });
      record(5, 'Provider of the gap piece is the new device, per its served-transfer record (completed, verified, all bytes, one consumer)',
        fresh.length === 1 && fresh[0].pieceId === GAP.pieceId && fresh[0].deliveredBytes === GAP.size && !!fresh[0].consumer, { transfers: fresh });
      record(5, 'Provider of the other pieces is the source: no origin request, not in the new device\'s records, and the source is the only other holder',
        accepted.status === 'Sharing' && accepted.originRequests.length === 0 && fresh.every(row => row.pieceId === GAP.pieceId), { transfers: fresh });
      await shot(n.page, `${id}-N-served`);
      await save();

      // 6. Reload restores the approval and the verified piece without a new approval.
      await n.page.reload();
      await expect(n.page.locator('[data-chat-workspace]')).toBeVisible();
      const restored = await waitSupply(n.page, value => value.state === 'approved' && value.verifiedBytes === GAP.size, 60000);
      record(6, 'New device: reload restores the approval and the verified gap piece', restored.state === 'approved' && restored.verifiedBytes === GAP.size, restored);

      // 7. Pause withdraws the piece; Answer requests is untouched.
      await n.page.locator('[data-weight-supply-pause]').click();
      const paused = await waitSupply(n.page, value => value.paused === 'true', 20000);
      await shot(n.page, `${id}-N-paused`);
      record(7, 'New device: Pause shows paused and leaves Answer requests as it was', paused.paused === 'true' && paused.answerRequests === 'false', paused);
      const afterPause = await coldConsumer(browser, viewport, room, `${id}-C4-paused`);
      const still = await supplyState(n.page);
      record(7, 'After Pause a cold consumer stops at the gap again', afterPause.status !== 'Sharing', afterPause);
      record(7, 'After Pause the new device serves nothing more', still.transfers.length === served.transfers.length, { before: served.transfers.length, after: still.transfers.length });
      record(7, 'No page error on the source or the new device', s.errors.length === 0 && n.errors.length === 0, { source: s.errors, device: n.errors });
    } finally {
      await save();
      await n?.context.close();
      await s.context.close();
    }
    expect(results.filter(row => row.status === 'fail'), JSON.stringify(results, null, 1)).toEqual([]);
  });
}
