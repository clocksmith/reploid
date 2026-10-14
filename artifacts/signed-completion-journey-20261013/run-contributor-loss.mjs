// Contributor loss while an ordered answer streams.
// Usage: node run-contributor-loss.mjs /absolute/config.json
// The harness never reaches a machine itself: it calls the configured stop/restore exports
// with the frozen stage description and records what they report.
import { pathToFileURL } from 'node:url';
import { orderedSelectionId } from './config.mjs';
import { compilePatterns, observeChat, observeCustody, observeNetwork } from './observe.mjs';
import { assessContributorLoss } from './loss-checks.mjs';
import { buildTimingRecord } from './timing.mjs';
import { SELECTORS, TERMINAL, startRun, openBrowser, findPage, appUrl, servedDescriptor, trackRequests, waitFor, openApp,
  chooseOrderedModel, send, selectThread, followAttempt, waitForAttempt, attemptIds, sleep, now } from './harness.mjs';

const { config, room, fixture, report, save } = await startRun('contributor-loss', './contributor-loss.json');
const { freeze, timeouts } = config, poll = config.observation.pollMs, selectionId = orderedSelectionId(freeze);
const origin = config.browsers.requester.origin, url = appUrl(origin, room, config.application.signalingUrl);
const target = freeze.route.find(stage => stage.machine === config.contributorControl.lossTarget);
const control = await import(pathToFileURL(config.contributorControl.module).href);
const stopContributor = control[config.contributorControl.stopExport], restoreContributor = control[config.contributorControl.restoreExport];
if (typeof stopContributor !== 'function' || typeof restoreContributor !== 'function') throw Error('Configured contributor control exports are not functions');
const stage = Object.freeze({ machine: target.machine, stage: target.index, participantId: target.participantId,
  orderedConfig: target.orderedConfig, nativeArtifact: freeze.nativeArtifacts[target.machine] });
Object.assign(report, { scope: fixture.scope, lossTarget: { machine: target.machine, stage: target.index, participantId: target.participantId },
  modelFileRequests: [], streamSamples: [], terminalSamples: [], postFailureSamples: [], preRetrySamples: [], timing: [] });

async function callControl(name, fn, timeKey) {
  const result = await fn(stage);
  if (!result || typeof result.method !== 'string' || !result.method || !Number.isFinite(Date.parse(result[timeKey]))) {
    throw Error(`${name} must resolve { method, ${timeKey} }`);
  }
  return { method: result.method, [timeKey]: result[timeKey], detail: result.detail ?? null, calledAt: now() };
}
const sample = async (page, threadId) => {
  const observed = await observeChat(page), thread = observed.threads.find(item => item.id === threadId);
  const attempt = thread?.attempts.find(item => item.id === report.failedAttemptId);
  return { at: now(), status: attempt?.status ?? null, attemptIds: thread?.attempts.map(item => item.id) ?? [], runningIds: observed.runningIds,
    content: thread?.messages.find(message => message.id === attempt?.responseId)?.content ?? null };
};

const requester = await openBrowser(config.browsers.requester);
const coordinatorBrowser = await openBrowser(config.browsers.coordinator);
let context, page;
try {
  context = await requester.browser.newContext({ viewport: { width: 1440, height: 1000 } });
  trackRequests(context, compilePatterns(config.modelFiles.pathPatterns), report.modelFileRequests, 'requester');
  const coordinator = findPage(coordinatorBrowser.browser, config.browsers.coordinator.origin);
  report.servedDescriptor = await servedDescriptor(context, origin, config.application.descriptorPath);
  if (report.servedDescriptor !== freeze.browserBundle) throw Error('Served bundle differs from freeze');
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await openApp(page, url, timeouts.readyMs);
  report.modelChoice = { selectedValue: await chooseOrderedModel(page, selectionId, timeouts.readyMs) };
  report.custodyBefore = await observeCustody(page);

  // A conversation in progress: wait for a visible streamed prefix, then stop the stage.
  const oldIds = attemptIds(await observeChat(page)), sentAt = now();
  await send(page, fixture.prompt, timeouts.readyMs);
  const streaming = await waitForAttempt(page, { oldIds, timeout: timeouts.answerMs, poll, label: 'Streaming before loss',
    predicate: ({ attempt, response }) => attempt.status === 'executing' && response.content.length >= fixture.lossAfterCharacters });
  report.failedAttemptId = streaming.attempt.id; report.beforeLoss = streaming.thread; report.sentAt = sentAt;
  report.stop = await callControl('stop', stopContributor, 'stoppedAt'); await save();

  // The attempt must reach a terminal status on its own; nothing is cancelled by the harness.
  const failureStart = Date.now();
  for (;;) {
    const row = await sample(page, streaming.thread.id);
    report.terminalSamples.push(row);
    if (TERMINAL.has(row.status)) break;
    if (Date.now() - failureStart > timeouts.lossReportMs) throw Error('Contributor loss report deadline');
    await sleep(poll);
  }
  report.terminalSamples = report.terminalSamples.filter(row => TERMINAL.has(row.status));
  const quietStart = Date.now();
  do { report.postFailureSamples.push(await sample(page, streaming.thread.id)); await sleep(250); }
  while (Date.now() - quietStart < fixture.postFailureObservationMs);
  report.postFailureObservationMs = Date.now() - quietStart;
  report.failed = (await observeChat(page)).threads.find(item => item.id === streaming.thread.id);
  const responseId = report.failed.attempts.find(item => item.id === report.failedAttemptId).responseId;
  await selectThread(page, streaming.thread.id);
  report.renderedFailure = await page.evaluate(id => {
    const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"] .chat-message-actions`);
    return { status: row?.querySelector('[role="status"]')?.textContent ?? null, technical: row?.querySelector('details pre')?.textContent ?? null };
  }, responseId);
  // A live route lists its attempts; once the coordinator retires the broken route, a receipt whose
  // cleanup stayed unknown moves to unknownAttempts (automatic-ordered-partitions.js, closeChat).
  report.coordinatorReceipt = await waitFor(async () => {
    const contribution = (await observeNetwork(coordinator)).contribution;
    for (const source of ['attempts', 'unknownAttempts']) {
      const receipt = (contribution?.[source] || []).find(row => row?.identity?.attemptId === report.failedAttemptId);
      if (receipt && !['admitting', 'executing', 'settling'].includes(receipt.phase)) { report.coordinatorReceiptSource = source; return receipt; }
    }
    return null;
  }, { timeout: timeouts.settlementMs, poll, label: 'Coordinator failure receipt' });
  await save();

  // Capacity returns only through the configured restore; the retry is an explicit click.
  report.restore = await callControl('restore', restoreContributor, 'restoredAt');
  const capacityStart = Date.now();
  try {
    await waitFor(async () => {
      report.preRetrySamples.push(await sample(page, streaming.thread.id));
      const ready = await page.locator(SELECTORS.modelReady).count() > 0;
      return ready && await page.locator(SELECTORS.retry(report.failedAttemptId)).count() > 0;
    }, { timeout: timeouts.capacityReturnMs, poll, label: 'Capacity return' });
    report.capacityReturned = true; report.capacityReturnedAt = now();
  } catch (error) {
    report.capacityReturned = false; report.capacityWaitMs = Date.now() - capacityStart;
    report.coordinatorAfterRestore = await observeNetwork(coordinator).catch(cause => ({ error: cause.message }));
    throw error;
  }
  const retryOldIds = new Set(report.failed.attempts.map(item => item.id));
  report.retry = { clickedAt: now(), samples: [] };
  await page.locator(SELECTORS.retry(report.failedAttemptId)).click();
  const retried = await followAttempt(page, { oldIds: retryOldIds, timeout: timeouts.answerMs, poll, samples: report.retry.samples, modelIdentity: freeze.modelIdentity });
  report.retry.final = retried.thread;
  report.timing.push(buildTimingRecord({ thread: retried.thread, attemptId: retried.attempt.id, samples: report.retry.samples, sentAt: report.retry.clickedAt, pollMs: poll }));
  report.custodyAfter = await observeCustody(page);
} catch (error) {
  report.failure = String(error.stack || error);
  report.body = page ? (await page.locator('body').innerText().catch(() => '')).slice(-5000) : null;
  report.finalState = page ? await observeChat(page).catch(() => null) : null;
} finally {
  // Custody after the loss is evidence of its own; a failed retry must not discard it.
  report.custodyAfter ??= page ? await observeCustody(page).catch(() => null) : null;
  report.weights = report.modelFileRequests.filter(row => row.weight).map(row => row.url);
  if (report.failed) report.timing.push(buildTimingRecord({ thread: report.failed, attemptId: report.failedAttemptId, samples: [], pollMs: poll }));
  report.assessment = assessContributorLoss(report, fixture, freeze);
  report.ok = !report.failure && report.assessment.automatedPass;
  report.status = report.ok ? 'automated checks passed; retried answer awaits manual review' : 'automated acceptance failed';
  report.requesterClosedWhileActive = page ? await observeChat(page).then(state => state.runningIds.length > 0).catch(() => false) : false;
  report.finishedAt = now(); await save();
  await context?.close().catch(() => {}); await requester.close(); await coordinatorBrowser.close();
  console.log(JSON.stringify({ ok: report.ok, observedErrorCode: report.assessment.observedErrorCode, failure: report.failure?.split('\n')[0] }));
  process.exitCode = report.ok ? 0 : 1;
}
