// Requester journey through the installed signed application on the frozen ordered route.
// Usage: node run-requester.mjs /absolute/config.json
// Phases: open, model choice, two turns with Copy, reload, concurrent independent tabs with
// one isolated cancellation, reload-interrupted answer with explicit retry. No automatic retry.
import { orderedSelectionId } from './config.mjs';
import { compilePatterns, observeChat, observeCustody, observeNetwork, observeOrderedParticipation, servedPartitionLimit } from './observe.mjs';
import { assessJourney, projectHistory } from './checks.mjs';
import { buildTimingRecord } from './timing.mjs';
import { SELECTORS, startRun, openBrowser, findPage, appUrl, servedDescriptor, trackRequests, waitFor, openApp,
  chooseOrderedModel, send, selectThread, followAttempt, waitForAttempt, attemptIds, sleep, now } from './harness.mjs';

const { config, room, fixture, report, save } = await startRun('requester-journey', './journey.json');
const { freeze, timeouts } = config, poll = config.observation.pollMs, selectionId = orderedSelectionId(freeze);
const origin = config.browsers.requester.origin, url = appUrl(origin, room, config.application.signalingUrl);
Object.assign(report, { scope: fixture.scope, questions: fixture.questions, weights: [], modelFileRequests: [], turns: [],
  streamSamples: [], returnSamples: [], timing: [], sends: [] });
const requester = await openBrowser(config.browsers.requester);
const coordinatorBrowser = await openBrowser(config.browsers.coordinator);
let context;
const pages = [];
const answerTiming = (thread, attemptId, samples) => {
  const sent = report.sends.find(row => row.attemptId === attemptId);
  report.timing.push(buildTimingRecord({ thread, attemptId, samples, sentAt: sent?.sentAt ?? null, pollMs: poll }));
};
async function sendTracked(page, text) {
  const oldIds = attemptIds(await observeChat(page)), sentAt = now();
  await send(page, text, timeouts.readyMs);
  return { oldIds, sentAt };
}
async function newTab(label) {
  const page = await context.newPage(); pages.push(page); tracker.name(page, label);
  page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
  await openApp(page, url, timeouts.readyMs);
  await chooseOrderedModel(page, selectionId, timeouts.readyMs);
  return page;
}
let tracker;
try {
  context = await requester.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(origin).origin });
  // Context-wide: every requester tab, not only the first page as in the precedent.
  tracker = trackRequests(context, compilePatterns(config.modelFiles.pathPatterns), report.modelFileRequests, 'requester');
  const coordinator = findPage(coordinatorBrowser.browser, config.browsers.coordinator.origin);

  // Open and model choice. The requester never writes the ordered-stage key.
  report.open = { servedDescriptor: await servedDescriptor(context, origin, config.application.descriptorPath) };
  if (report.open.servedDescriptor !== freeze.browserBundle) throw Error('Served bundle differs from freeze');
  const page = await context.newPage(); pages.push(page); tracker.name(page, 'turns');
  page.on('pageerror', error => report.errors.push(`turns: ${error.message}`));
  await openApp(page, url, timeouts.readyMs);
  report.modelChoice = { selectedValue: await chooseOrderedModel(page, selectionId, timeouts.readyMs) };
  report.open.ready = true; report.readyAt = now();
  report.open.initialState = await observeChat(page);
  report.open.orderedParticipation = await observeOrderedParticipation(page);
  report.open.network = await observeNetwork(page);
  report.custodyBefore = await observeCustody(page);
  if (report.open.initialState.threads.some(thread => thread.attempts.length)) throw Error('Fresh requester unexpectedly contains attempts');
  await save();

  // Two turns in one thread; the first answer is copied through the real control.
  for (const question of fixture.questions) {
    const { oldIds, sentAt } = await sendTracked(page, question);
    const { thread, attempt, response } = await followAttempt(page, { oldIds, timeout: timeouts.answerMs, poll, samples: report.streamSamples,
      modelIdentity: freeze.modelIdentity });
    report.sends.push({ attemptId: attempt.id, sentAt }); report.turns.push(thread); await save();
    if (attempt.status !== 'completed') throw Error(attempt.error || attempt.status);
    if (report.turns.length === 1) {
      await page.locator(SELECTORS.copy(response.id)).click();
      const clipboardText = await waitFor(async () => {
        const value = await page.evaluate(() => navigator.clipboard.readText());
        return value === response.content ? value : null;
      }, { timeout: 5000, poll: 50, label: 'Clipboard observation' });
      report.copy = { messageId: response.id, clipboardText }; await save();
    }
  }
  report.custodyAfter = await observeCustody(page);

  // Reload with an unsent draft; return by selecting the existing thread (precedent run.mjs:97-115).
  const threadId = report.turns[0].id;
  await page.locator(SELECTORS.composerInput).fill(fixture.draft);
  report.beforeReload = await waitFor(async () => { const observed = await observeChat(page); return observed.drafts[threadId]?.text === fixture.draft ? observed : null; },
    { timeout: 30000, poll, label: 'Draft persistence' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(SELECTORS.composerInput).waitFor();
  await selectThread(page, threadId);
  await page.locator(SELECTORS.modelReady).waitFor({ state: 'attached', timeout: timeouts.readyMs });
  await waitFor(async () => { const observed = await observeChat(page); return observed.selectedId === threadId && observed.drafts[threadId]?.text === fixture.draft; },
    { timeout: 30000, poll, label: 'Restored thread selection' });
  const returnStart = Date.now();
  do {
    const observed = await observeChat(page);
    report.returnSamples.push({ at: now(), runningIds: observed.runningIds, history: projectHistory(observed) });
    await sleep(250);
  } while (Date.now() - returnStart < fixture.postRediscoveryObservationMs);
  report.returnObservationMs = Date.now() - returnStart;
  report.restoredState = await observeChat(page); report.custodyAfterReload = await observeCustody(page);
  report.restoration = { draft: await page.locator(SELECTORS.composerInput).inputValue() };
  await save();

  // Concurrent independent tabs: each tab is its own application instance and requester identity.
  report.concurrency = { servedLimit: await servedPartitionLimit(context, origin, config.application.partitionPolicyPath), tabs: [], pairedSamples: [] };
  const tabs = [];
  for (let index = 0; index < config.concurrency.tabs; index++) {
    const role = index === 0 ? 'cancel' : 'survivor';
    tabs.push({ role, page: await newTab(`concurrent-${index}`), prompt: role === 'cancel' ? fixture.concurrency.cancelPrompt : fixture.concurrency.survivorPrompt,
      samples: [], streamSamples: [] });
  }
  for (const tab of tabs) Object.assign(tab, await sendTracked(tab.page, tab.prompt));
  await waitFor(async () => {
    const states = await Promise.all(tabs.map(async tab => {
      const observed = await observeChat(tab.page);
      const thread = observed.threads.find(item => item.attempts.some(attempt => !tab.oldIds.has(attempt.id)));
      const attempt = thread?.attempts.at(-1);
      Object.assign(tab, { instanceId: observed.instanceId, requesterPeerId: observed.requesterPeerId, attemptId: attempt?.id, threadId: thread?.id,
        content: thread?.messages.find(message => message.id === attempt?.responseId)?.content ?? '' });
      if (attempt && ['completed', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw Error(`Concurrent attempt ended ${attempt.status} before overlap`);
      return attempt?.status ?? null;
    }));
    report.concurrency.pairedSamples.push({ at: now(), statuses: states });
    return states.every(status => status === 'executing') && tabs[0].content.length >= fixture.concurrency.cancelAfterCharacters;
  }, { timeout: timeouts.answerMs, poll, label: 'Simultaneous execution' });
  const target = tabs[0];
  target.contentAtStop = (await observeChat(target.page)).threads.find(thread => thread.id === target.threadId)
    .messages.find(message => message.role === 'assistant' && message.attemptId === target.attemptId).content;
  target.stopClickedAt = now();
  await target.page.locator(SELECTORS.stop).click();
  await Promise.all(tabs.map(async tab => {
    const { thread } = await followAttempt(tab.page, { oldIds: tab.oldIds, timeout: timeouts.answerMs, poll, samples: tab.streamSamples,
      modelIdentity: freeze.modelIdentity, onSample: ({ attempt }) => { tab.samples.push({ at: now(), status: attempt.status }); } });
    tab.final = thread; tab.custodyAfter = await observeCustody(tab.page);
    report.sends.push({ attemptId: tab.attemptId, sentAt: tab.sentAt });
  }));
  report.concurrency.tabs = tabs.map(({ page: _page, oldIds: _old, ...tab }) => tab);
  await save();

  // Explicit retry after a failure: reload the tab while its answer streams.
  const retryPage = await newTab('retry');
  const sent = await sendTracked(retryPage, fixture.retry.prompt);
  const streaming = await waitForAttempt(retryPage, { oldIds: sent.oldIds, timeout: timeouts.answerMs, poll, label: 'Retry prefix',
    predicate: ({ attempt, response }) => attempt.status === 'executing' && response.content.length >= fixture.retry.interruptAfterCharacters });
  report.retry = { failedAttemptId: streaming.attempt.id, contentBeforeFailure: streaming.response.content, reloadedAt: now(), returnSamples: [] };
  await retryPage.reload({ waitUntil: 'domcontentloaded' });
  await retryPage.locator(SELECTORS.composerInput).waitFor();
  await selectThread(retryPage, streaming.thread.id);
  report.retry.failed = await waitFor(async () => {
    const thread = (await observeChat(retryPage)).threads.find(item => item.id === streaming.thread.id);
    const attempt = thread?.attempts.find(item => item.id === streaming.attempt.id);
    return attempt && ['interrupted', 'failed', 'cancelled'].includes(attempt.status) ? thread : null;
  }, { timeout: timeouts.settlementMs, poll, label: 'Interrupted attempt' });
  await retryPage.locator(SELECTORS.modelReady).waitFor({ state: 'attached', timeout: timeouts.readyMs });
  const quietStart = Date.now();
  do {
    const observed = await observeChat(retryPage);
    report.retry.returnSamples.push({ at: now(), runningIds: observed.runningIds,
      attemptCount: observed.threads.find(item => item.id === streaming.thread.id)?.attempts.length ?? null });
    await sleep(250);
  } while (Date.now() - quietStart < fixture.postRediscoveryObservationMs);
  await retryPage.locator(SELECTORS.retry(streaming.attempt.id)).waitFor({ timeout: timeouts.capacityReturnMs });
  const retryOldIds = new Set(report.retry.failed.attempts.map(attempt => attempt.id)), retrySentAt = now();
  await retryPage.locator(SELECTORS.retry(streaming.attempt.id)).click();
  const retried = await followAttempt(retryPage, { oldIds: retryOldIds, timeout: timeouts.answerMs, poll, samples: report.streamSamples, modelIdentity: freeze.modelIdentity });
  report.retry.final = retried.thread; report.sends.push({ attemptId: retried.attempt.id, sentAt: retrySentAt });
  report.retry.custodyAfter = await observeCustody(retryPage);
  await save();

  // Settlement of stopped and failed attempts is reported only by the stage 0 coordinator.
  report.coordinator = { receipts: await waitFor(async () => {
    const receipts = (await observeNetwork(coordinator)).contribution?.attempts;
    const ids = [target.attemptId, report.retry.failedAttemptId];
    return Array.isArray(receipts) && ids.every(id => receipts.some(row => row?.identity?.attemptId === id && !['admitting', 'executing', 'settling'].includes(row.phase))) ? receipts : null;
  }, { timeout: timeouts.settlementMs, poll, label: 'Coordinator settlement' }) };
} catch (error) {
  report.failure = String(error.stack || error);
  const last = pages.at(-1);
  report.body = last ? (await last.locator('body').innerText().catch(() => '')).slice(-5000) : null;
  report.finalState = last ? await observeChat(last).catch(() => null) : null;
} finally {
  report.weights = report.modelFileRequests.filter(row => row.weight).map(row => row.url);
  for (const thread of report.turns) answerTiming(thread, thread.attempts.at(-1).id, report.streamSamples);
  for (const tab of report.concurrency?.tabs || []) if (tab.final) answerTiming(tab.final, tab.attemptId, tab.streamSamples);
  if (report.retry?.final) answerTiming(report.retry.final, report.retry.final.attempts.at(-1).id, report.streamSamples);
  report.assessment = assessJourney(report, fixture, freeze, { selectionId, concurrencyTabs: config.concurrency.tabs });
  report.ok = !report.failure && report.assessment.automatedPass;
  report.status = report.ok ? 'automated checks passed; answer usefulness awaits independent manual review' : 'automated acceptance failed';
  const active = await Promise.all(pages.map(page => observeChat(page).then(state => state.runningIds.length > 0).catch(() => false)));
  report.requesterClosedWhileActive = active.some(Boolean);
  report.remoteSettlementAfterRequesterClose = report.requesterClosedWhileActive ? 'unknown; controller closure is not cleanup evidence' : 'no active attempt observed before close';
  report.finishedAt = now(); await save();
  await context?.close().catch(() => {}); await requester.close(); await coordinatorBrowser.close();
  console.log(JSON.stringify({ ok: report.ok, failures: report.assessment.failures.length, weights: report.weights.length, failure: report.failure?.split('\n')[0] }));
  process.exitCode = report.ok ? 0 : 1;
}
