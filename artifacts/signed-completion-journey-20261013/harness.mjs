// Shared runner plumbing. Every selector below is the application's own markup in self/ui;
// the cited line renders it or binds its action. Nothing here is imported by the unit tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { loadConfig, loadRoom, redactPrivateAddresses } from './config.mjs';
import { classifyRequest, rangeBytes, observeChat } from './observe.mjs';

export const SELECTORS = Object.freeze({
  composerInput: '[data-composer-input]',            // conversation-workspace.js:50
  send: '[data-composer-send]',                      // conversation-workspace.js:53, submit at :305-333
  stop: '[data-composer-stop]',                      // conversation-workspace.js:54, session.cancel(selectedId) at :337
  modelSelect: '[data-active-model-select]',         // conversation-workspace.js:27, change at :270
  modelReady: '[data-model-control][data-activity="ready"]', // conversation-workspace.js:217
  threadRail: '[data-toggle-thread-rail]',           // shell-view.js:41
  threadItem: id => `[data-thread-item-id="${id}"]`, // conversation-list.js:12, select at conversation-workspace.js:304
  messageBody: id => `[data-message-id="${id}"] .chat-message-content`, // message-list.js:36-38
  copy: id => `[data-message-id="${id}"] [data-copy-message]`,         // message-list.js:66, clipboard at conversation-workspace.js:338-345
  retry: id => `[data-retry-attempt="${id}"]:not([disabled])`,          // message-list.js:65, session.retry at conversation-workspace.js:346-347
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

/** Records every model-file request in a context; weights separately, as the precedent did. */
export function trackRequests(context, patterns, sink, label) {
  const rows = new Map(), pages = new WeakMap();
  const pageOf = request => { try { return pages.get(request.frame().page()) ?? null; } catch { return null; } };
  context.on('request', request => {
    const kind = classifyRequest(request.url(), patterns);
    if (!kind.modelFile) return;
    const range = request.headers().range ?? null;
    const row = { label, page: pageOf(request), at: now(), url: request.url().split('?')[0], weight: kind.weight, range,
      declaredBytes: rangeBytes(range), responseBytes: null, finished: false, failed: false, finishedAt: null };
    rows.set(request, row); sink.push(row);
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
  return { name: (page, value) => pages.set(page, value) };
}
export const transferBytes = row => Math.max(row.declaredBytes ?? 0, row.responseBytes ?? 0);
export const transferKey = row => `${row.url}#${row.range ?? 'whole'}`;

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

/** The requester chooses the frozen ordered selection; it never assigns a stage. */
export async function chooseOrderedModel(page, selectionId, timeout) {
  const option = page.locator(`${SELECTORS.modelSelect} option[value="${selectionId}"]`);
  await option.waitFor({ state: 'attached', timeout });
  await page.locator(SELECTORS.modelSelect).selectOption(selectionId);
  await page.locator(SELECTORS.modelReady).waitFor({ state: 'attached', timeout });
  return page.locator(SELECTORS.modelSelect).inputValue();
}

export async function send(page, text, timeout) {
  await page.locator(SELECTORS.composerInput).fill(text);
  await page.locator(`${SELECTORS.send}:not([disabled])`).waitFor({ timeout });
  await page.locator(SELECTORS.send).click();
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
