// Shared runner plumbing. Every selector below is the application's own markup in self/ui;
// the cited line renders it or binds its action. Unit tests (harness.test.mjs) import only the
// pure helpers and drive the UI helpers through a fake page; they never launch a browser.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { loadConfig, loadRoom, redactPrivateAddresses } from './config.mjs';
import { classifyRequest, rangeBytes, observeChat } from './observe.mjs';

export const SELECTORS = Object.freeze({
  composerInput: '[data-composer-input]',            // conversation-workspace.js:51
  send: '[data-composer-send]',                      // conversation-workspace.js:54, submit at :324-355
  stop: '[data-composer-stop]',                      // conversation-workspace.js:55, session.cancel(selectedId) at :359
  // One-time contributor permission (self/ui/pool-home/remote-permission.js:24-29), shown before the first
  // request that would leave a fresh profile (conversation-workspace.js:336, :371) or one held at dispatch (:247).
  // Allow stores it (self/host/chat-session.js:293 grantRemotePermission); later requests never ask.
  permission: '[data-remote-permission]',
  permissionTitle: '[data-remote-permission-title]', permissionWhat: '[data-remote-permission-what]',
  permissionWho: '[data-remote-permission-who]', permissionScope: '[data-remote-permission-scope]',
  permissionAllow: '[data-remote-permission] [data-remote-permission-allow]',
  openModel: '[data-open-model]',                    // "Choose model", conversation-workspace.js:22; opens the thread rail at :105
  modelSelect: '[data-active-model-select]',         // in the thread rail, conversation-workspace.js:18-28; change at :289
  modelReady: '[data-model-control][data-activity="ready"]', // conversation-workspace.js:226
  threadRail: '[data-toggle-thread-rail]',           // shell-view.js:41
  threadItem: id => `[data-thread-item-id="${id}"]`, // conversation-list.js:12, select at conversation-workspace.js:323
  messageBody: id => `[data-message-id="${id}"] .chat-message-content`, // message-list.js:36-38
  copy: id => `[data-message-id="${id}"] [data-copy-message]`,         // message-list.js:66, clipboard at conversation-workspace.js:361-367
  retry: id => `[data-retry-attempt="${id}"]:not([disabled])`,          // message-list.js:65, session.retry at conversation-workspace.js:368-372
  failureStatus: id => `[data-message-id="${id}"] .chat-message-actions [role="status"]`, // message-list.js:63
  failureTechnical: id => `[data-message-id="${id}"] .chat-message-actions details pre`, // message-list.js:63
  inspectorToggle: '[data-toggle-inspector]',        // network-inspector.js:12, opens at :95
  inspectorDialog: '[data-contextual-inspector]',    // network-inspector.js:13
  deviceSection: '[data-inspector-section="device"]', // network-inspector.js:18
  contributionModel: '[data-contribution-model]',    // network-controls.js:15
  fileMode: '[data-file-mode]',                      // network-controls.js:26-28
  fileDownload: '[data-file-download]',              // network-controls.js:30, MiB at :178
  fileToggle: '[data-toggle-file-contribution]'      // network-controls.js:33, setFileSharing at :172-180
});

export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const now = () => new Date().toISOString();
export const attemptIds = observed => new Set(observed.threads.flatMap(thread => thread.attempts.map(attempt => attempt.id)));

export async function startRun(name, fixtureName) {
  const configPath = process.argv[2];
  const { config, bytes } = await loadConfig(configPath);
  const room = await loadRoom(config);
  const fixtureBytes = await fs.readFile(new URL(fixtureName, import.meta.url));
  await fs.mkdir(config.reportDirectory, { recursive: true });
  const reportPath = path.join(config.reportDirectory, `${name}-${now().replace(/[:.]/g, '-')}.json`);
  const report = { schema: 'reploid.signed-completion-journey-report/v1', harness: name, startedAt: now(),
    configSha256: createHash('sha256').update(bytes).digest('hex'), fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
    freeze: config.freeze, ok: false, errors: [] };
  let created = false;
  const save = async () => {
    const text = redactPrivateAddresses(JSON.stringify(report, null, 2).replaceAll(room.token, '[REDACTED]'));
    await fs.writeFile(reportPath, text, { flag: created ? 'w' : 'wx' }); created = true;
  };
  await save();
  return { config, room, fixture: JSON.parse(fixtureBytes), report, save, reportPath };
}

export async function openBrowser(spec) {
  const browser = spec.connect.kind === 'launch'
    ? await chromium.launch({ channel: spec.connect.channel, headless: spec.connect.headless,
      args: ['--disable-gpu', `--remote-debugging-port=${spec.connect.remoteDebuggingPort}`] })
    : await chromium.connectOverCDP(spec.connect.endpoint);
  // For a CDP connection close() releases only this harness's contexts and connection.
  return { browser, close: () => browser.close() };
}

/** One independent requester: its own browser process and new user data directory, so its own
 * storage, Web Lock manager and stored peer identity. The product route connects one tab per
 * profile (self/host/work-swarm.js:165, work-peer-offers.js:16-21), so independent requesters are
 * separate profiles, never tabs of one profile. close() removes the directory. */
export async function openRequesterProfile(spec, label, { debuggingPort = null } = {}) {
  if (spec?.connect?.kind !== 'launch') throw Error('Independent requester profiles require browsers.requester.connect.kind "launch"');
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-journey-profile-'));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, { channel: spec.connect.channel, headless: spec.connect.headless,
      viewport: { width: 1440, height: 1000 }, args: ['--disable-gpu', ...(debuggingPort ? [`--remote-debugging-port=${debuggingPort}`] : [])] });
    let closing = null;
    const close = () => closing ||= context.close().catch(() => {}).finally(() => fs.rm(userDataDir, { recursive: true, force: true }));
    return { label, profileDirectory: path.basename(userDataDir), context, close };
  } catch (error) { await fs.rm(userDataDir, { recursive: true, force: true }); throw error; }
}

/** Resolves with the promise's value or rejects at the deadline; the timer never outlives it. */
export async function withDeadline(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} deadline`)), timeout); })]);
  } finally { clearTimeout(timer); }
}

export function findPage(browser, origin) {
  const page = browser.contexts().flatMap(context => context.pages()).find(item => item.url().startsWith(origin));
  if (!page) throw Error('Configured coordinator page is not open at its origin');
  return page;
}

export function appUrl(origin, room, signalingUrl) {
  const url = new URL(origin);
  url.searchParams.set('swarm', room.roomId.replace(/^reploid-swarm-/, ''));
  url.searchParams.set('swarmToken', room.token);
  if (signalingUrl) url.searchParams.set('signaling', signalingUrl);
  return url.href;
}

export async function servedDescriptor(context, origin, descriptorPath) {
  const response = await context.request.get(new URL(descriptorPath, origin).href);
  if (!response.ok()) throw Error('Browser descriptor unavailable');
  return (await response.json()).bundleHash;
}

/** Records every model-file request in a context; weights separately, as the precedent did.
 * next(test) resolves with the first later row matching test, synchronously from the request
 * event, so a caller can act while that transfer is still in flight. */
export function trackRequests(context, patterns, sink, label) {
  const rows = new Map(), pages = new WeakMap(), watchers = new Set();
  const pageOf = request => { try { return pages.get(request.frame().page()) ?? null; } catch { return null; } };
  context.on('request', request => {
    const kind = classifyRequest(request.url(), patterns);
    if (!kind.modelFile) return;
    const range = request.headers().range ?? null;
    const row = { label, page: pageOf(request), at: now(), url: request.url().split('?')[0], weight: kind.weight, range,
      declaredBytes: rangeBytes(range), responseBytes: null, finished: false, failed: false, finishedAt: null };
    rows.set(request, row); sink.push(row);
    for (const watcher of [...watchers]) if (watcher.test(row)) { watchers.delete(watcher); watcher.resolve(row); }
  });
  context.on('requestfinished', async request => {
    const row = rows.get(request); if (!row) return;
    row.finished = true; row.finishedAt = now();
    try { row.responseBytes = (await request.sizes()).responseBodySize; } catch { row.responseBytes = null; }
  });
  context.on('requestfailed', request => {
    const row = rows.get(request); if (!row) return;
    row.failed = true; row.finishedAt = now(); row.failure = request.failure()?.errorText ?? null;
  });
  return { name: (page, value) => pages.set(page, value), next: test => new Promise(resolve => watchers.add({ test, resolve })) };
}
export const transferBytes = row => Math.max(row.declaredBytes ?? 0, row.responseBytes ?? 0);
export const transferKey = row => `${row.url}#${row.range ?? 'whole'}`;

/** Partitions one page's model-file rows around a reload issued while `target` (a piece of at least
 * MIN_INTERRUPTED_PIECE_BYTES) was transferring. Pieces are reserved and acquired one at a time
 * (self/host/work-model-files.js:155-158,403-431), so rows finished before the target started were
 * verified and persisted. Every row lands in exactly one list, so the ledger can be compared with
 * the sum of all observed transfers. The target's outcome is `aborted` (failed by the navigation),
 * `unsettled` (no terminal event) or `completed` (the reload lost the race). */
export function classifyInterruption(rows, { target, reloadAt, resumedSince }) {
  const ok = row => row.finished && !row.failed, item = row => ({ key: transferKey(row), bytes: transferBytes(row) });
  const before = rows.filter(row => row.at <= reloadAt);
  return {
    reloadAt,
    inFlightAtReload: target ? { key: transferKey(target), bytes: target.declaredBytes, weight: target.weight, startedAt: target.at,
      outcome: ok(target) ? 'completed' : target.failed ? 'aborted' : 'unsettled', failure: target.failure ?? null, finishedAt: target.finishedAt } : null,
    completedBefore: before.filter(row => ok(row) && target && row.finishedAt <= target.at).map(item),
    completedDuringInterruption: before.filter(row => ok(row) && !(target && row.finishedAt <= target.at)).map(item),
    interrupted: before.filter(row => !ok(row)).map(row => ({ key: transferKey(row), bytes: row.declaredBytes })),
    unattributed: rows.filter(row => row.at > reloadAt && row.at < resumedSince).map(item),
    resumed: rows.filter(row => row.at >= resumedSince).map(row => ({ ...item(row), finished: ok(row) }))
  };
}

/** Closes every open harness tab except the named intended suppliers, so no other tab can supply pieces
 * to a later acquisition. Each tab's file state is read first (`observe`); an unreadable tab is closed
 * anyway. Returns what was closed and every non-kept tab still open, which must be none. */
export async function closeOtherTabs(tabs, { keep = [], observe = async () => null } = {}) {
  const closed = [];
  for (const { name, page } of tabs) {
    if (keep.includes(name) || page.isClosed()) continue;
    const files = await observe(page).catch(() => null);
    await page.close().catch(() => {});
    closed.push({ name, sharing: files ? files.sharing === true : null, closedAt: now() });
  }
  return { keep: [...keep], closed, remainingOpen: tabs.filter(({ name, page }) => !keep.includes(name) && !page.isClosed()).map(({ name }) => name) };
}

export async function waitFor(probe, { timeout, poll, label }) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await probe();
    if (value) return value;
    await sleep(poll);
  }
  throw Error(`${label} deadline`);
}

export async function openApp(page, url, timeout) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator(SELECTORS.composerInput).waitFor({ timeout });
}

/** The requester chooses the frozen ordered selection; it never assigns a stage. The model select
 * lives in the thread rail, which starts closed (conversation-workspace.js:105), so the rail is
 * opened through the application's own "Choose model" control (:106) first. */
export async function chooseOrderedModel(page, selectionId, timeout) {
  const control = page.locator(SELECTORS.openModel), select = page.locator(SELECTORS.modelSelect);
  const controls = await control.count();
  if (controls !== 1) {
    throw Error(`Choose model control ${SELECTORS.openModel} ${controls ? `is ambiguous (${controls} found)` : 'is absent'}; `
      + 'the model select in the closed thread rail cannot be reached through the application');
  }
  await control.click({ timeout });
  try { await select.waitFor({ state: 'visible', timeout }); }
  catch (cause) { throw Error(`Model select ${SELECTORS.modelSelect} stayed hidden after Choose model opened the thread rail: ${cause.message}`); }
  await page.locator(`${SELECTORS.modelSelect} option[value="${selectionId}"]`).waitFor({ state: 'attached', timeout });
  await select.selectOption(selectionId);
  await page.locator(SELECTORS.modelReady).waitFor({ state: 'attached', timeout });
  return select.inputValue();
}

// Plain strings only: Playwright serializes evaluate arguments, and SELECTORS holds functions.
const PERMISSION_TEXT_SELECTORS = Object.freeze(Object.fromEntries(['permissionTitle', 'permissionWhat', 'permissionWho', 'permissionScope']
  .map(key => [key, SELECTORS[key]])));

/** Records what the one-time contributor permission shows (its need, title and three explanations) and the
 * permission the application stored after Allow (observeChat remotePermissions). JSON-serializable. */
export async function allowPermission(page, timeout, { observe = observeChat } = {}) {
  const dialog = page.locator(SELECTORS.permission);
  await dialog.waitFor({ state: 'visible', timeout });
  const shown = await dialog.evaluate((node, selectors) => {
    const text = selector => node.querySelector(selector)?.textContent ?? null;
    let need = null;
    try { need = JSON.parse(node.dataset.need); } catch { need = null; }
    return { need, title: text(selectors.permissionTitle), what: text(selectors.permissionWhat),
      who: text(selectors.permissionWho), scope: text(selectors.permissionScope) };
  }, PERMISSION_TEXT_SELECTORS);
  const shownAt = now();
  await page.locator(SELECTORS.permissionAllow).click({ timeout });
  const allowedAt = now();
  const stored = await waitFor(async () => {
    const rows = (await observe(page)).remotePermissions || [];
    return rows.find(row => row.revokedAt === null && row.disclosure === shown.need?.disclosure
      && row.sharingScope === shown.need?.sharingScope && row.modelIdentities.includes(shown.need?.modelIdentity)) ?? null;
  }, { timeout, poll: 100, label: 'Stored contributor permission' });
  return { ...shown, shownAt, allowedAt, stored };
}

/** The permission screen if it opens within `wait` ms (a Retry after revocation), otherwise null. */
export async function allowPermissionIfAsked(page, timeout, { wait = 1000, observe } = {}) {
  try { await page.locator(SELECTORS.permission).waitFor({ state: 'visible', timeout: wait }); } catch { return null; }
  return allowPermission(page, timeout, { observe });
}

/** Clicks Send. A fresh profile's first remote request shows the one-time permission, which is recorded and
 * allowed; an already permitted profile sends at once. Returns { sentAt, permission } (permission null when
 * none was shown). */
export async function send(page, text, timeout, { observe } = {}) {
  await page.locator(SELECTORS.composerInput).fill(text);
  await page.locator(`${SELECTORS.send}:not([disabled])`).waitFor({ timeout });
  const sentAt = now();
  await page.locator(SELECTORS.send).click();
  // Either the permission opens (nothing sent yet) or the permitted request was sent and the composer cleared.
  const outcome = await (await page.waitForFunction(selectors => document.querySelector(selectors.permission)?.open ? 'asked'
    : document.querySelector(selectors.composerInput)?.value === '' ? 'sent' : null,
  { permission: SELECTORS.permission, composerInput: SELECTORS.composerInput }, { timeout })).jsonValue();
  return { sentAt, permission: outcome === 'asked' ? await allowPermission(page, timeout, { observe }) : null };
}

export async function selectThread(page, threadId) {
  const item = page.locator(SELECTORS.threadItem(threadId));
  if (!await item.isVisible()) await page.locator(SELECTORS.threadRail).click();
  await item.click();
}

export const renderedText = (page, messageId) => page.evaluate(id =>
  document.querySelector(`[data-message-id="${CSS.escape(id)}"] .chat-message-content`)?.innerText ?? null, messageId);

/** Follows the newest attempt not in oldIds to a terminal status, sampling the stored and rendered text. */
export async function followAttempt(page, { oldIds, timeout, poll, samples, modelIdentity, onSample = () => {} }) {
  const started = Date.now(); let previous = '';
  while (Date.now() - started < timeout) {
    const observed = await observeChat(page);
    const thread = observed.threads.find(item => item.attempts.some(attempt => !oldIds.has(attempt.id)));
    const attempt = thread?.attempts.at(-1), response = thread?.messages.find(message => message.id === attempt?.responseId);
    if (attempt && response) {
      if (modelIdentity && thread.model.identity !== modelIdentity) throw Error('Discovered model identity differs from freeze');
      const key = JSON.stringify([attempt.id, attempt.status, response.content]);
      if (key !== previous) {
        previous = key;
        samples.push({ at: now(), attemptId: attempt.id, messageId: response.id, status: attempt.status, content: response.content,
          renderedText: await renderedText(page, response.id) });
      }
      await onSample({ observed, thread, attempt, response });
      if (TERMINAL.has(attempt.status)) return { thread, attempt, response, observed };
    }
    await sleep(poll);
  }
  throw Error('Request completion deadline; no automatic cancellation/retry or classification as model failure');
}

/** Waits for the newest new attempt to reach a predicate while still active. */
export async function waitForAttempt(page, { oldIds, predicate, timeout, poll, label }) {
  return waitFor(async () => {
    const observed = await observeChat(page);
    const thread = observed.threads.find(item => item.attempts.some(attempt => !oldIds.has(attempt.id)));
    const attempt = thread?.attempts.at(-1), response = thread?.messages.find(message => message.id === attempt?.responseId);
    if (attempt && TERMINAL.has(attempt.status) && !predicate({ thread, attempt, response })) throw Error(`${label}: attempt ended ${attempt.status}: ${attempt.error}`);
    return attempt && response && predicate({ thread, attempt, response }) ? { thread, attempt, response, observed } : null;
  }, { timeout, poll, label });
}

/** Opens the device pane holding the existing contribution controls. */
export async function openDevicePane(page) {
  if (!await page.locator(SELECTORS.inspectorDialog).evaluate(node => node.open)) {
    if (!await page.locator(SELECTORS.inspectorToggle).isVisible()) await page.locator(SELECTORS.threadRail).click();
    await page.locator(SELECTORS.inspectorToggle).click();
  }
  await page.locator(SELECTORS.deviceSection).click();
}

/** Starts file contribution through the existing controls; an existing ledger's cap cannot be changed. */
export async function startFileContribution(page, { modelId, mode, allowanceMiB }) {
  await openDevicePane(page);
  await page.locator(SELECTORS.contributionModel).selectOption(modelId);
  await page.locator(SELECTORS.fileMode).selectOption(mode);
  if (mode !== 'cached-only') {
    const input = page.locator(SELECTORS.fileDownload);
    if (await input.isDisabled()) {
      if (Number(await input.inputValue()) !== allowanceMiB) throw Error('Existing acquisition ledger has a different allowance');
    } else await input.fill(String(allowanceMiB));
  }
  if (await page.locator(SELECTORS.fileToggle).getAttribute('aria-checked') === 'true') throw Error('File contribution already active');
  await page.locator(SELECTORS.fileToggle).click();
  return now();
}

export async function stopFileContribution(page) {
  await openDevicePane(page);
  if (await page.locator(SELECTORS.fileToggle).getAttribute('aria-checked') !== 'true') return null;
  await page.locator(SELECTORS.fileToggle).click();
  return now();
}

/** Stop while the controls are re-rendering: a real mouse click on the already open toggle without
 * waiting for layout stability. A transfer's progress text moves the toggle on every update, so the
 * actionability wait otherwise lasts until the transfer ends (run 7 attempts e and f). */
export async function stopFileContributionNow(page) {
  if (await page.locator(SELECTORS.fileToggle).getAttribute('aria-checked') !== 'true') return null;
  await page.locator(SELECTORS.fileToggle).click({ force: true });
  return now();
}

/** The application's own ledger reader (self/infrastructure/custody-supply-budget.js:49), existing ledgers only. */
export function readLedger(page) {
  return page.evaluate(async () => {
    const { openBrowserAcquisitionBudget } = await import('/infrastructure/custody-supply-budget.js');
    let ledger;
    try { ledger = await openBrowserAcquisitionBudget({ existingOnly: true, allowInitialize: false }); }
    catch (error) { if (/MISSING/.test(String(error?.code))) return null; throw error; }
    try { const { maxBytes, reservedBytes } = ledger.getState(); return { maxBytes, reservedBytes }; } finally { ledger.close(); }
  });
}
