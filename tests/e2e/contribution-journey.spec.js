import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateRoom } from '../fixtures/current-contribution.js';

/**
 * Journey 3 acceptance (docs/first-visit-journeys.md, "Contribution acceptance"): a visitor downloads a model
 * without opting in, explicitly offers storage, compute or both, reaches Ready, another peer sees and uses the
 * offer, and Pause withdraws it. Real page, real catalog model files and, for compute, real WebGPU inference on
 * this machine, in a private room on the local signaling server. Nothing reaches the public mesh.
 *
 *   REPLOID_E2E_CONTRIBUTION=1 REPLOID_E2E_BASE_URL=http://localhost:<port> REPLOID_E2E_MODEL_CACHE=<dir> \
 *   REPLOID_E2E_SHOTS=<dir> npx playwright test --config tests/playwright.config.js \
 *     tests/e2e/contribution-journey.spec.js --project chromium
 *
 * It uses the smallest catalog model (about 1.2 GB). REPLOID_E2E_MODEL_CACHE keeps the catalog-origin bytes on disk
 * so each fresh browser profile is served them locally after the first download; every byte is still verified by the
 * page. Opt-in only: it is far too heavy for CI. Each journey sentence is recorded as pass, fail or not shown in
 * <shots>/results-<viewport>-<offer>.json; a test fails when any sentence fails.
 *
 * Peers: A contributes. B asks (compute). Storage is checked by fresh peers C that acquire verified model pieces
 * within a small allowance ("Download within a limit"); a piece that did not come from the catalog origin came from
 * a peer, and A is the only other computer in the room.
 */
const RUN = process.env.REPLOID_E2E_CONTRIBUTION === '1';
const CACHE = process.env.REPLOID_E2E_MODEL_CACHE || '';
const SHOTS = process.env.REPLOID_E2E_SHOTS || '';
const ONLY = (process.env.REPLOID_E2E_CONTRIBUTION_ONLY || '').split(',').filter(Boolean);
const MODEL = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
const ORIGIN = `https://replo.id/model-files/${MODEL}/`;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const OFFERS = { storage: ['files'], compute: ['compute'], both: ['compute', 'files'] };
const ALLOWANCE_MIB = 16;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 30000 });
test.skip(!RUN, 'Set REPLOID_E2E_CONTRIBUTION=1: downloads a real model and uses this GPU.');

/** Catalog-origin model files, kept on disk across profiles. Ranges are served from the whole file. */
async function routeModelFiles(context, log) {
  const pending = new Map();
  const whole = async (route, url) => {
    const name = createHash('sha256').update(url).digest('hex');
    const path = CACHE ? join(CACHE, name) : '';
    if (path && await stat(path).then(() => true, () => false)) return readFile(path);
    if (!pending.has(url)) pending.set(url, (async () => {
      const headers = { ...route.request().headers() };
      delete headers.range;
      const response = await route.fetch({ headers, timeout: 0 });
      if (response.status() !== 200) throw new Error(`${url}: HTTP ${response.status()}`);
      const body = await response.body();
      if (path) { await mkdir(CACHE, { recursive: true }); await writeFile(path, body); }
      return body;
    })().finally(() => setTimeout(() => pending.delete(url), 0)));
    return pending.get(url);
  };
  await context.route(`${ORIGIN}**`, async route => {
    const url = route.request().url(), range = route.request().headers().range;
    log.push({ path: url.slice(ORIGIN.length), range: range || null });
    try {
      const body = await whole(route, url);
      const match = range && /bytes=(\d+)-(\d*)/.exec(range);
      if (!match) return route.fulfill({ status: 200, body, headers: { 'content-length': String(body.length), 'access-control-allow-origin': '*' } });
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      return route.fulfill({ status: 206, body: body.subarray(start, end + 1), headers: {
        'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': String(end - start + 1),
        'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' } });
    } catch { return route.abort(); }
  });
}

async function openPeer(browser, viewport, room, label) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const origin = [];
  await routeModelFiles(context, origin);
  // Automatic download on an unanswered Send would make the asking peer download the model itself.
  await context.addInitScript(() => { try { localStorage.setItem('reploid.auto-download.v1', 'off'); } catch { /* fresh profile */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(room);
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  return { context, page, origin, errors, label };
}

// Panes slide in; wait for the motion to settle so the picture shows the pane, not the transition.
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: join(SHOTS, name + '.png') }); } };
const textOf = (page, selector) => page.evaluate(selector => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, selector);

async function openPane(page, section) {
  const pane = page.locator(`[data-inspector-pane="${section}"]`);
  if (!await pane.isVisible()) await page.locator(`[data-inspector-section="${section}"]`).first().click();
  await expect(pane).toBeVisible();
  return pane;
}

async function closePanes(page) {
  for (const close of await page.locator('[data-close-inspector]:visible').all()) await close.click().catch(() => {});
}

async function openThisComputer(page) {
  await openPane(page, 'participants');
  const device = page.locator('[data-production-device]');
  if (!await device.evaluate(node => node.open)) await device.locator(':scope > summary').click();
  await expect(page.locator('[data-this-computer]')).toBeVisible();
}

/**
 * The model's row under "This computer". Before any model is configured the rows are inline ("Choose a model to
 * share"); once one is downloaded or offered they move into the "Change model" sheet.
 */
async function modelRow(page) {
  await openThisComputer(page);
  const row = page.locator(`[data-production-model="${MODEL}"]`);
  if (!await row.count()) {
    const options = page.locator('[data-production-model-options]');
    await expect(options).toBeVisible({ timeout: 15 * 60000 });
    await options.click();
  }
  await expect(row).toBeVisible();
  return row;
}

async function closeModelSheet(page) {
  const sheet = page.locator('[data-production-model-dialog]');
  if (await sheet.isVisible()) await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/** "This computer" (Computers) and "Share model files" (Settings), as a visitor reads them. */
async function deviceState(page) {
  await openThisComputer(page);
  const state = await page.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const fact = (root, term) => [...(root?.querySelectorAll('dt') || [])].find(dt => dt.textContent.trim() === term)?.nextElementSibling?.textContent?.trim() ?? null;
    return { offers: fact(document.querySelector('[data-this-computer]'), 'Offers'),
      deviceFiles: document.querySelector('[data-toggle-device-files]')?.getAttribute('aria-checked') ?? null, summary: document.querySelector('[data-this-computer] p')?.textContent?.trim() ?? null, sharing: text('[data-tab-sharing-summary]'),
      compute: document.querySelector('[data-toggle-contribution]')?.getAttribute('aria-checked') ?? null,
      computeStatus: text('[data-compute-sharing-row] [id$="-status"]') ?? text('[data-compute-sharing-row]'),
      progress: text('[data-contribution-progress]'), history: text('[data-production-history-count]') };
  });
  await openPane(page, 'settings');
  Object.assign(state, await page.evaluate(() => ({
    files: document.querySelector('[data-toggle-file-contribution]')?.getAttribute('aria-checked') ?? null,
    filesStatus: document.querySelector('[data-file-sharing-row] [id$="-status"]')?.textContent?.trim()
      ?? document.querySelector('[data-file-sharing-row]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    filesProgress: document.querySelector('[data-file-progress]')?.textContent?.trim() ?? null })));
  return state;
}

/** Answer on → the model → Download, with no sharing choice ticked. Resolves once the model is stored. */
async function downloadWithoutSharing(peer) {
  const { page } = peer;
  await closePanes(page);
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  await page.locator(`[data-execution-choice=local]`).click();
  await page.locator(`[data-model-choice="${MODEL}"]`).first().click();
  const action = page.locator('[data-change-model]');
  await expect(action).toHaveAttribute('data-answer-action', 'download');
  await action.click();
  const confirm = page.locator('[data-download-confirm]');
  await expect(confirm).toBeEnabled({ timeout: 60000 });
  const ticked = await page.evaluate(() => ['compute', 'files'].filter(value => document.querySelector(`[data-download-${value}] input`)?.checked));
  await expect(confirm).toHaveText('Download model');
  await shot(page, `${peer.label}-1a-download-dialog`);
  await confirm.click();
  await expect(page.locator('[data-download-confirm]')).toBeHidden();
  // Stored: "This computer" lists the model as Downloaded or Ready.
  await expect(await modelRow(page)).toContainText(/Downloaded|Ready/, { timeout: 15 * 60000 });
  await closeModelSheet(page);
  return { ticked };
}

/** Computers → Choose a model to share → the model → tick exactly `offer` → confirm. */
async function enable(peer, offer) {
  const { page } = peer;
  await (await modelRow(page)).click();
  const confirm = page.locator('[data-download-confirm]');
  await expect(confirm).toBeEnabled({ timeout: 60000 });
  for (const value of ['compute', 'files']) {
    const box = page.locator(`[data-download-${value}] input`);
    if (await box.isChecked() !== offer.includes(value)) await box.click();
    if (offer.includes(value)) await expect(box).toBeChecked(); else await expect(box).not.toBeChecked();
  }
  const dialog = { confirm: await confirm.textContent(), explanation: await textOf(page, '[data-download-explanation]') };
  await shot(page, `${peer.label}-2a-enable-dialog`);
  await confirm.click();
  await expect(confirm).toBeHidden();
  return dialog;
}

async function waitDevice(page, test, timeout) {
  let last = null;
  await expect.poll(async () => { last = await deviceState(page); return test(last); }, { timeout, intervals: [2000] }).toBe(true).catch(() => {});
  return last;
}

/** The roster row B shows for A, found by A's local computer label. */
async function rosterRow(observer, contributorName) {
  await openPane(observer.page, 'participants');
  // Idle or connecting computers are folded behind "Show N other (connecting or idle)".
  const quiet = observer.page.locator('[data-quiet-computers]');
  if (await quiet.isVisible() && await quiet.getAttribute('aria-expanded') !== 'true') await quiet.click();
  return observer.page.evaluate(name => {
    const text = node => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const pane = document.querySelector('[data-inspector-pane="participants"]');
    const rows = [...pane.querySelectorAll('[data-computer-id]')];
    // A name is "<words> · <four hex>"; the observer may show the words only or with the suffix.
    const row = rows.find(node => text(node.querySelector('[data-computer-name]')).startsWith(name));
    const offers = [...(row?.querySelectorAll('dt') || [])].find(dt => dt.textContent.trim() === 'Offers')?.nextElementSibling?.textContent?.trim() ?? null;
    return { found: !!row, offers, text: text(row).slice(0, 400), status: text(row?.querySelector('[data-computer-status]')) || null,
      state: row?.getAttribute('data-computer-state') ?? null, readiness: text(pane.querySelector('[data-peer-readiness]')) || null,
      others: rows.map(node => text(node.querySelector('[data-computer-name]')) + ' · ' + text(node.querySelector('[data-computer-status]'))) };
  }, contributorName);
}

async function localName(page) {
  await openThisComputer(page);
  return (await textOf(page, '[data-local-computer]'))?.split(' · ').slice(0, 2).join(' · ') ?? '';
}

/** B: Answer on → Contributors → the model; the computer and model rows say whether anyone offers it. */
async function contributorChoice(peer) {
  const { page } = peer;
  await closePanes(page);
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  const choice = page.locator('[data-execution-choice=network]');
  const label = (await choice.textContent())?.replace(/\s+/g, ' ').trim();
  const enabled = await choice.locator('input').isEnabled().catch(() => false);
  return { label, enabled };
}

/** B asks through a contributor and waits for the answer's execution line. */
async function askContributor(peer) {
  const { page } = peer;
  const { label, enabled } = await contributorChoice(peer);
  if (!enabled) { await page.keyboard.press('Escape'); return { label, status: 'contributors unavailable' }; }
  await page.locator('[data-execution-choice=network]').click();
  const model = page.locator(`[data-model-choice="${MODEL}"]`).first();
  if (await model.count()) await model.click();
  const action = page.locator('[data-change-model]');
  // Choosing the model can close the picker itself, detaching the action between these checks.
  if (await action.isVisible() && await action.isEnabled({ timeout: 2000 }).catch(() => false)) await action.click({ timeout: 5000 }).catch(() => {});
  const picker = page.locator('[data-model-picker]');
  if (await picker.isVisible()) {
    const close = page.locator('[data-model-picker-close]');
    await close.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
    if (!await picker.isHidden({ timeout: 5000 }).catch(() => false)) {
      const action = await textOf(page, '[data-change-model]');
      await page.keyboard.press('Escape');
      return { label, status: 'not sent: the model picker stayed open', action };
    }
  }
  await page.locator('[data-composer-field] textarea, textarea').first().fill('Name one primary color.');
  await page.locator('[data-composer-send]').click();
  const allow = page.locator('[data-remote-permission] [data-remote-permission-allow]');
  const trigger = page.locator('[data-execution-trigger]').last();
  await expect.poll(async () => {
    if (await allow.isVisible()) await allow.click();
    const status = await trigger.getAttribute('aria-label').catch(() => null);
    const failure = await textOf(page, '[data-system-status]');
    return failure || (status && /^(Complete|Failed|Stopped|Interrupted|Disconnected)/.test(status) ? status : '');
  }, { timeout: 5 * 60000, intervals: [2000] }).not.toBe('');
  return { label, status: await trigger.getAttribute('aria-label').catch(() => null), failure: await textOf(page, '[data-system-status]'),
    answer: (await page.locator('[data-text-block]').last().textContent().catch(() => ''))?.slice(0, 200) };
}

/**
 * C: a fresh peer acquiring verified pieces within a small allowance (Settings → Share model files → Download within a
 * limit). Returns where its weight pieces came from: catalog-origin weight requests, and pieces it holds.
 */
async function acquirePieces(browser, viewport, room, label) {
  const c = await openPeer(browser, viewport, room, label);
  const { page } = c;
  await openPane(page, 'settings');
  const options = page.locator('[data-model-sharing-limits]');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
  await page.locator(`[data-contribution-model="${MODEL}"] input, [data-contribution-model="${MODEL}"]`).first().click();
  await page.locator('input[data-file-mode="bounded-acquisition"]').check();
  await page.locator('[data-file-download] input, input[data-file-download]').first().fill(String(ALLOWANCE_MIB));
  // Peer discovery first: a piece another computer offers is taken from it, otherwise from the catalog origin.
  await page.waitForTimeout(8000);
  await page.locator('[data-toggle-file-contribution]').click();
  const progress = new Set();
  let final = null;
  await expect.poll(async () => {
    const value = await page.evaluate(() => ({ status: document.querySelector('[data-file-sharing-row] [id$="-status"]')?.textContent?.trim() ?? '',
      progress: document.querySelector('[data-file-progress]')?.textContent?.trim() ?? '' }));
    if (value.progress) progress.add(value.progress);
    final = value;
    return /^Sharing$|cannot|error|No verified|exhausted|failed/i.test(value.status) ? value.status : '';
  }, { timeout: 5 * 60000, intervals: [1000] }).not.toBe('').catch(() => {});
  await shot(page, `${label}-pieces`);
  const originWeights = c.origin.filter(row => /^shard_/.test(row.path));
  const result = { status: final?.status ?? null, progress: [...progress], originWeightRequests: originWeights.length,
    originRequests: c.origin.map(row => row.path + (row.range ? ' ' + row.range : '')),
    fromPeers: [...progress].filter(line => line.startsWith('Receiving from peers')).length };
  await c.context.close();
  return result;
}

/** Pause is one place: Computers, This computer, Pause all (both offers). Settings' switch reads the same state. */
async function pauseOffer(peer) {
  const { page } = peer;
  await openThisComputer(page);
  const pause = page.locator('[data-device-pause-all]');
  const shown = await pause.isVisible();
  if (shown) await pause.click();
  return { pauseAllShown: shown };
}

for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
  for (const [offerName, offer] of Object.entries(OFFERS)) {
    const id = `${viewportName}-${offerName}`;
    test(`journey 3: ${id}`, async ({ browser, baseURL }) => {
      test.skip(ONLY.length > 0 && !ONLY.includes(id), 'not selected');
      test.setTimeout(60 * 60000);
      const results = [];
      const record = (step, sentence, status, detail) => { results.push({ step, sentence, status, detail }); console.log(`[${id}] ${step} ${status}: ${sentence} ${JSON.stringify(detail).slice(0, 300)}`); };
      const save = () => SHOTS ? writeFile(join(SHOTS, `results-${id}.json`), JSON.stringify({ id, at: new Date().toISOString(), results }, null, 2)) : null;
      const room = baseURL + privateRoom(`contrib-${id}`);
      const compute = offer.includes('compute'), files = offer.includes('files');
      const a = await openPeer(browser, viewport, room, `${id}-A`);
      const b = await openPeer(browser, viewport, room, `${id}-B`);
      try {
        // 1. Download without opting in.
        const fresh = await deviceState(a.page);
        record(1, 'Fresh device offers nothing before any choice', fresh.compute === 'false' && fresh.files === 'false' ? 'pass' : 'fail', fresh);
        const downloaded = await downloadWithoutSharing(a);
        record(1, 'The download dialog ticks no sharing choice and its button says Download model', downloaded.ticked.length === 0 ? 'pass' : 'fail', downloaded);
        const afterDownload = await deviceState(a.page);
        await shot(a.page, `${id}-A-1b-after-download`);
        record(1, 'After the download the device offers nothing (compute off, files off)',
          afterDownload.compute === 'false' && afterDownload.files === 'false' && !afterDownload.sharing ? 'pass' : 'fail', afterDownload);
        record(1, 'The page says the device is not contributing (not "Paused" for a device that never contributed)',
          /Not sharing/.test(afterDownload.summary ?? '') ? 'pass' : 'fail', { summary: afterDownload.summary });
        const aName = await localName(a.page);
        const rosterBefore = await rosterRow(b, aName.split(' · ')[0]);
        await shot(b.page, `${id}-B-1c-roster-before`);
        record(1, 'Second peer: the roster does not show the device as ready', !/^Ready/.test(rosterBefore.status ?? '') ? 'pass' : 'fail', rosterBefore);
        if (compute) {
          const choice = await contributorChoice(b); await b.page.keyboard.press('Escape');
          record(1, 'Second peer: no contributor is available for an answer', !choice.enabled || /None available/.test(choice.label ?? '') ? 'pass' : 'fail', choice);
        }
        if (files) {
          const pieces = await acquirePieces(browser, viewport, room, `${id}-C1`);
          record(1, 'Second peer: no model piece comes from the device (pieces come from the catalog origin)', pieces.fromPeers === 0 ? 'pass' : 'fail', pieces);
        }
        await save();

        // 2. Explicitly enable; the page states what is offered and whether it is available.
        const dialog = await enable(a, offer);
        record(2, 'The enable dialog names the chosen offer', (compute ? /Start sharing/ : /Share model files/).test(dialog.confirm ?? '') ? 'pass' : 'fail', dialog);
        const ready = await waitDevice(a.page, s => (!compute || s.computeStatus === 'Ready') && (!files || s.filesStatus === 'Sharing'), 10 * 60000);
        await shot(a.page, `${id}-A-2b-ready`);
        if (compute) record(2, 'Compute reaches Ready', ready.computeStatus === 'Ready' ? 'pass' : 'fail', ready);
        if (files) record(2, 'Storage reaches Sharing (its ready state)', ready.filesStatus === 'Sharing' ? 'pass' : 'fail', ready);
        const wantOffer = (seen) => !!seen && /Compute/.test(seen) === compute && /Model files/.test(seen) === files;
        record(2, 'The page states what the device offers (compute, files or both)',
          wantOffer(ready.offers) && (!compute || /· compute/.test(ready.sharing ?? '')) && (!files || /· files/.test(ready.sharing ?? '')) ? 'pass' : 'fail', { offers: ready.offers, sharing: ready.sharing });
        record(2, 'The page states whether the offer is available', /Ready|Sharing/.test(ready.summary ?? '') ? 'pass' : 'fail', { summary: ready.summary });
        if (!compute) record(2, 'Storage only never starts compute', ready.compute === 'false' && !/compute/.test(ready.sharing ?? '') ? 'pass' : 'fail', ready);
        // A contributing browser joins as a separate supplier connection; This computer then names that one.
        const servingName = await localName(a.page);
        await shot(a.page, `${id}-A-2c-this-computer`);
        record(2, 'This computer names the connection other peers see serving', 'pass', { before: aName, serving: servingName });
        await save();

        // 3. The second peer sees the offer and uses it.
        // Advertisements travel over the mesh: give the second peer up to 90 s to list the offer, then record what it shows.
        // Files are announced by the device's requester connection, compute by its supplier connection: two rows when both.
        const short = name => name.split(' · ')[0];
        let filesRow = null, computeRow = null;
        const offeredNow = async () => {
          if (files) filesRow = await rosterRow(b, short(aName));
          if (compute) computeRow = await rosterRow(b, short(servingName));
          return (!files || /Model files · Sharing/.test(filesRow.offers ?? '')) && (!compute || /Compute · Ready/.test(computeRow.offers ?? ''));
        };
        await expect.poll(offeredNow, { timeout: 90000, intervals: [3000] }).toBe(true).catch(() => {});
        await shot(b.page, `${id}-B-3a-roster`);
        const rows = [filesRow, computeRow].filter(Boolean);
        record(3, 'Second peer: the roster lists the device', rows.every(row => row.found) ? 'pass' : 'fail', { rows });
        if (compute) record(3, 'Second peer: the roster shows the device Ready', /^Ready/.test(computeRow.status ?? '') ? 'pass' : 'fail', { status: computeRow.status, offers: computeRow.offers });
        record(3, 'Second peer: the roster says whether the device offers storage, compute or both',
          (!files || /Model files · Sharing/.test(filesRow.offers ?? '')) && (!compute || /Compute · Ready/.test(computeRow.offers ?? '')) ? 'pass' : 'fail',
          { files: filesRow?.offers, compute: computeRow?.offers });
        if (compute && files) record(3, 'Second peer: one roster row shows both offers for the device',
          short(aName) === short(servingName) && wantOffer(computeRow.offers) ? 'pass' : 'not shown', { requester: aName, supplier: servingName, files: filesRow.offers, compute: computeRow.offers });
        if (compute) {
          const asked = await askContributor(b);
          await shot(b.page, `${id}-B-3b-answer`);
          const served = await deviceState(a.page);
          record(3, 'Second peer gets an answer from the device', /^Complete/.test(asked.status ?? '') ? 'pass' : 'fail', { ...asked, servedHistory: served.history });
        }
        if (files) {
          const pieces = await acquirePieces(browser, viewport, room, `${id}-C2`);
          record(3, 'Second peer fetches a model piece from the device (no catalog-origin weight request)',
            pieces.fromPeers > 0 && pieces.originWeightRequests === 0 && pieces.status === 'Sharing' ? 'pass' : 'fail', pieces);
          record(3, 'Second peer: the page shows that a piece came from another computer', pieces.fromPeers > 0 ? 'pass' : 'not shown', { progress: pieces.progress });
        }
        await save();

        // 4. Pause; the page shows paused and the offer is withdrawn for the second peer.
        const pausing = await pauseOffer(a);
        record(4, 'Pause is in one place: This computer offers Pause all for what is on', pausing.pauseAllShown ? 'pass' : 'fail', pausing);
        const paused = await waitDevice(a.page, s => s.compute === 'false' && s.files === 'false' && !s.sharing, 2 * 60000);
        await shot(a.page, `${id}-A-4a-paused`);
        record(4, 'The page shows the device paused', /Paused/.test(paused.summary ?? '') ? 'pass' : 'fail', paused);
        record(4, 'Nothing is offered after Pause', paused.compute === 'false' && paused.files === 'false' && !paused.sharing && paused.offers === 'Nothing' ? 'pass' : 'fail', paused);
        record(4, 'The Settings file switch mirrors the Computers one (one state)', paused.files === paused.deviceFiles ? 'pass' : 'fail', { settings: paused.files, computers: paused.deviceFiles });
        let rowsAfter = [];
        const withdrawn = row => !row.found || row.offers === 'Nothing';
        await expect.poll(async () => {
          rowsAfter = [];
          for (const name of new Set([short(aName), short(servingName)])) rowsAfter.push(await rosterRow(b, name));
          return rowsAfter.every(withdrawn);
        }, { timeout: 90000, intervals: [3000] }).toBe(true).catch(() => {});
        await shot(b.page, `${id}-B-4b-roster-after`);
        record(4, 'Second peer: the device is no longer Ready', rowsAfter.every(row => !/^Ready/.test(row.status ?? '')) ? 'pass' : 'fail', { rows: rowsAfter });
        record(4, 'Second peer: the roster shows the device offering nothing', rowsAfter.every(withdrawn) ? 'pass' : 'fail', { rows: rowsAfter.map(row => ({ found: row.found, offers: row.offers })) });
        if (compute) {
          const asked = await askContributor(b);
          await shot(b.page, `${id}-B-4c-ask-after`);
          record(4, 'Second peer: the device is not chosen for an answer', !/^Complete/.test(asked.status ?? '') ? 'pass' : 'fail', asked);
        }
        if (files) {
          const pieces = await acquirePieces(browser, viewport, room, `${id}-C3`);
          record(4, 'Second peer: nothing is fetched from the device', pieces.fromPeers === 0 ? 'pass' : 'fail', pieces);
        }
      } finally {
        await save();
        await a.context.close(); await b.context.close();
      }
      expect(results.filter(row => row.status === 'fail'), JSON.stringify(results, null, 1)).toEqual([]);
    });
  }
}
