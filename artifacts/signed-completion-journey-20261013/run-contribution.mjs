// Launch 2 storage contribution alongside ordered chat, through the existing file controls.
// Usage: node run-contribution.mjs /absolute/config.json
// Each step is recorded separately; a failed step leaves its later dependants unobserved,
// and their checks then fail closed. Steps that need a fresh acquisition ledger use a fresh
// browser context, because a ledger's cap is immutable once created (work-model-files.js:355).
import { orderedSelectionId } from './config.mjs';
import { compilePatterns, observeChat, observeCustody, observeNetwork, observeOffer } from './observe.mjs';
import { assessContribution } from './contribution-checks.mjs';
import { TERMINAL, startRun, openBrowser, appUrl, trackRequests, transferBytes, transferKey, waitFor, openApp, chooseOrderedModel,
  send, followAttempt, waitForAttempt, attemptIds, startFileContribution, stopFileContribution, readLedger, now } from './harness.mjs';

const { config, room, fixture, report, save } = await startRun('storage-contribution', './contribution.json');
const { freeze, timeouts, storage } = config, poll = config.observation.pollMs, selectionId = orderedSelectionId(freeze);
const patterns = compilePatterns(config.modelFiles.pathPatterns), mib = value => value * 1048576;
Object.assign(report, { scope: fixture.scope, modelFileRequests: [], stepErrors: {} });
const supplierBrowser = await openBrowser(config.browsers.storageSupplier);
const acquirerBrowser = await openBrowser(config.browsers.storageAcquirer);
const contexts = [];
const supplierOrigin = config.browsers.storageSupplier.origin, acquirerOrigin = config.browsers.storageAcquirer.origin;

async function freshContext(handle, label) {
  const context = await handle.browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  return { context, tracker: trackRequests(context, patterns, report.modelFileRequests, label) };
}
async function openTab(owner, name, origin) {
  const page = await owner.context.newPage(); owner.tracker.name(page, name);
  page.on('pageerror', error => report.stepErrors[`${name}:pageerror`] = error.message);
  await openApp(page, appUrl(origin, room, config.application.signalingUrl), timeouts.readyMs);
  return page;
}
const rowsOf = (name, since = '') => report.modelFileRequests.filter(row => row.page === name && row.at >= since);
const filesOf = async page => (await observeNetwork(page)).files;
async function shareOutcome(page) {
  let started = false;
  return waitFor(async () => {
    const files = await filesOf(page).catch(() => null);
    started ||= !!(files?.preparing || files?.sharing);
    return started && files && !files.preparing && !files.stopping && (files.sharing || files.error) ? files : null;
  }, { timeout: timeouts.transferMs, poll, label: 'File contribution outcome' });
}
async function custodyReady(page) {
  return waitFor(() => observeCustody(page).catch(() => null), { timeout: timeouts.readyMs, poll, label: 'Custody owner' });
}
const peerTransfers = custody => (custody?.receipts || []).map(receipt => ({ key: `peer:${receipt.transferId}`, bytes: receipt.reservedBytes,
  finished: !receipt.failure, hashes: (receipt.completed || []).map(item => item.hash) }));
async function step(name, run) {
  try { await run(); } catch (error) { report.stepErrors[name] = String(error.stack || error); } finally { await save(); }
}
async function startChat(page) {
  await chooseOrderedModel(page, selectionId, timeouts.readyMs);
  const oldIds = attemptIds(await observeChat(page));
  await send(page, fixture.chatPrompt, timeouts.readyMs);
  return { oldIds, ...await waitForAttempt(page, { oldIds, timeout: timeouts.answerMs, poll, label: 'Chat streaming',
    predicate: ({ attempt, response }) => attempt.status === 'executing' && response.content.length >= fixture.chatStartedAfterCharacters }) };
}
const chatStatus = async (page, attemptId) => (await observeChat(page)).threads.flatMap(thread => thread.attempts).find(item => item.id === attemptId)?.status ?? null;

let supplierPage, acquirerPage, supplier;
try {
  // (a) Share a small verified subset while this participant's own conversation streams.
  await step('sharedWhileChatting', async () => {
    supplier = await freshContext(supplierBrowser, 'supplier');
    supplierPage = await openTab(supplier, 'supplier-main', supplierOrigin);
    const chat = await startChat(supplierPage), samples = [];
    const startedAt = await startFileContribution(supplierPage, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.sharingAllowanceMiB });
    let files;
    await waitFor(async () => {
      const attemptStatus = await chatStatus(supplierPage, chat.attempt.id); files = await filesOf(supplierPage);
      samples.push({ at: now(), attemptStatus, filesPreparing: !!files?.preparing, filesSharing: !!files?.sharing });
      return TERMINAL.has(attemptStatus) && files && !files.preparing && (files.sharing || files.error);
    }, { timeout: timeouts.answerMs, poll, label: 'Sharing and chat outcome' });
    const final = (await observeChat(supplierPage)).threads.find(thread => thread.id === chat.thread.id);
    report.share = { machine: config.browsers.storageSupplier.machine, mode: 'bounded-acquisition', allowanceBytes: mib(storage.sharingAllowanceMiB),
      startedAt, samples, files, ...await observeOffer(supplierPage), chat: { attemptId: chat.attempt.id, final } };
  });

  // (b) Another computer acquires the offered pieces from the sharer.
  await step('peerAcquisition', async () => {
    if (!report.share?.files?.sharing) throw Error('Prerequisite sharing step did not share');
    const acquirer = await freshContext(acquirerBrowser, 'acquirer');
    acquirerPage = await openTab(acquirer, 'acquirer-main', acquirerOrigin);
    const sharer = await observeOffer(supplierPage);
    await waitFor(async () => (await filesOf(acquirerPage))?.peers?.includes(sharer.transportId), { timeout: timeouts.transferMs, poll, label: 'Sharer offer discovery' });
    const suppliedBytesBefore = (await filesOf(supplierPage)).suppliedBytes, since = now();
    await startFileContribution(acquirerPage, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.sharingAllowanceMiB });
    const files = await shareOutcome(acquirerPage), custody = await observeCustody(acquirerPage);
    report.peer = { supplier: { machine: config.browsers.storageSupplier.machine, transportId: sharer.transportId, suppliedBytesBefore,
      suppliedBytesAfter: (await filesOf(supplierPage)).suppliedBytes },
    acquirer: { machine: config.browsers.storageAcquirer.machine, files, receipts: custody.receipts,
      weightRequests: rowsOf('acquirer-main', since).filter(row => row.weight) } };
  });

  // (e) Cached-only mode in another tab of the sharer's origin: zero acquisition.
  await step('cachedOnly', async () => {
    if (!supplier) throw Error('Prerequisite sharer origin unavailable');
    const page = await openTab(supplier, 'supplier-cached', supplierOrigin);
    const custodyBefore = await custodyReady(page), budgetBefore = await readLedger(page), since = now();
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'cached-only' });
    const files = await shareOutcome(page);
    report.cachedOnly = { mode: 'cached-only', files, requests: rowsOf('supplier-cached', since), receiptsBefore: custodyBefore.receipts.length,
      receiptsAfter: (await observeCustody(page)).receipts.length, budgetBefore, budgetAfter: await readLedger(page) };
    await stopFileContribution(page); await shareSettled(page); await page.close();
  });

  // (c) Reload the sharer; rebuild inventory from cache and read the persisted ledger.
  await step('reloadPreserved', async () => {
    if (!report.share?.files?.sharing) throw Error('Prerequisite sharing step did not share');
    const before = { offered: (await observeOffer(supplierPage)).offered, budget: await readLedger(supplierPage) };
    await supplierPage.reload({ waitUntil: 'domcontentloaded' });
    await custodyReady(supplierPage);
    const since = now();
    await startFileContribution(supplierPage, { modelId: freeze.modelId, mode: 'cached-only' });
    await shareOutcome(supplierPage);
    report.reload = { before, after: { mode: 'cached-only', offered: (await observeOffer(supplierPage)).offered,
      budget: await readLedger(supplierPage), requests: rowsOf('supplier-main', since) } };
  });

  // Later steps acquire into fresh ledgers; withdraw this run's offers so their transfers are observable.
  await step('withdrawOffers', async () => {
    for (const page of [supplierPage, acquirerPage].filter(Boolean)) { await stopFileContribution(page); await shareSettled(page); }
  });

  // (f) Stop file contribution while a transfer is in flight and a conversation streams.
  await step('stopSettles', async () => {
    const owner = await freshContext(supplierBrowser, 'stop'), page = await openTab(owner, 'stop-main', supplierOrigin);
    const chat = await startChat(page), samples = [];
    const record = async () => samples.push({ at: now(), attemptStatus: await chatStatus(page, chat.attempt.id) });
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.stopAllowanceMiB });
    const inFlightAtStop = await waitFor(async () => {
      await record();
      const files = await filesOf(page), pendingHttp = rowsOf('stop-main').filter(row => !row.finished && !row.failed).length;
      return files?.preparing && pendingHttp + (files.pending || 0) > 0 ? { filesPreparing: true, pendingRequests: pendingHttp + (files.pending || 0), progress: files.progress } : null;
    }, { timeout: timeouts.transferMs, poll, label: 'In-flight acquisition' });
    const budgetBefore = await readLedger(page);
    await record();
    const stopClickedAt = await stopFileContribution(page);
    const filesAfter = await waitFor(async () => { await record(); const files = await filesOf(page);
      return files && !files.preparing && !files.stopping && !files.sharing ? files : null; }, { timeout: timeouts.settlementMs, poll, label: 'Stop settlement' });
    const settledAt = now();
    const { thread } = await followAttempt(page, { oldIds: chat.oldIds, timeout: timeouts.answerMs, poll, samples: [],
      onSample: ({ attempt }) => { samples.push({ at: now(), attemptStatus: attempt.status }); } });
    report.stop = { inFlightAtStop, budgetBefore, budgetAfter: await readLedger(page), filesAfter, stopClickedAt, settledAt,
      requestsAfterSettled: rowsOf('stop-main', settledAt).length, chat: { attemptId: chat.attempt.id, final: thread, samples } };
  });

  // (d) Two tabs of one fresh origin compete for one allowance.
  await step('competingTabs', async () => {
    const owner = await freshContext(supplierBrowser, 'contention');
    const names = ['contention-0', 'contention-1'], pages = [];
    for (const name of names) { pages.push(await openTab(owner, name, supplierOrigin)); await custodyReady(pages.at(-1)); }
    const ledgerBefore = await readLedger(pages[0]);
    await Promise.all(pages.map(page => startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.contentionAllowanceMiB })));
    const outcomes = await Promise.all(pages.map(shareOutcome));
    const tabs = [];
    for (const [index, page] of pages.entries()) {
      const custody = await observeCustody(page);
      tabs.push({ instanceId: (await observeChat(page)).instanceId, budget: outcomes[index].acquisitionBudget, outcome: { sharing: outcomes[index].sharing, error: outcomes[index].error },
        transfers: [...rowsOf(names[index]).map(row => ({ key: transferKey(row), bytes: transferBytes(row) })), ...peerTransfers(custody)] });
    }
    report.contention = { allowanceBytes: mib(storage.contentionAllowanceMiB), ledgerBefore, ledgerAfter: await readLedger(pages[0]), tabs };
  });

  // (d) Interrupt an acquisition by reloading mid-transfer, then resume it.
  await step('interruptedResume', async () => {
    const owner = await freshContext(supplierBrowser, 'interrupt'), page = await openTab(owner, 'interrupt-main', supplierOrigin);
    await custodyReady(page);
    const ledgerBefore = await readLedger(page);
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.interruptionAllowanceMiB });
    // Pieces are acquired one at a time and persisted before the next starts (work-model-files.js:399-431),
    // so a second weight request in flight proves the earlier ones were verified and retained.
    const inflight = await waitFor(() => {
      const weights = rowsOf('interrupt-main').filter(row => row.weight);
      return weights.some(row => row.finished && !row.failed) ? weights.find(row => !row.finished && !row.failed) : null;
    }, { timeout: timeouts.transferMs, poll, label: 'Second piece in flight' });
    const completedBefore = rowsOf('interrupt-main').filter(row => row.finished && !row.failed && row.finishedAt <= inflight.at)
      .map(row => ({ key: transferKey(row), bytes: transferBytes(row) }));
    const custodyBefore = await observeCustody(page), interruptedAt = now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    const interrupted = rowsOf('interrupt-main').filter(row => row.at <= interruptedAt && !(row.finished && !row.failed && row.finishedAt <= interruptedAt))
      .map(row => ({ key: transferKey(row), bytes: row.declaredBytes }));
    await custodyReady(page);
    const since = now();
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.interruptionAllowanceMiB });
    const files = await shareOutcome(page);
    report.interruption = { ledgerBefore, completedBefore: [...completedBefore, ...peerTransfers(custodyBefore).filter(row => row.finished)], interrupted,
      resumed: [...rowsOf('interrupt-main', since).map(row => ({ key: transferKey(row), bytes: transferBytes(row), finished: row.finished && !row.failed })),
        ...peerTransfers(await observeCustody(page))],
      ledgerFinal: await readLedger(page), final: { sharing: files.sharing, error: files.error, offered: (await observeOffer(page)).offered } };
  });
} finally {
  report.assessment = assessContribution(report, freeze);
  report.ok = Object.keys(report.stepErrors).length === 0 && report.assessment.automatedPass;
  report.status = report.ok ? 'automated contribution checks passed' : 'automated contribution acceptance failed';
  report.finishedAt = now(); await save();
  for (const context of contexts) await context.close().catch(() => {});
  await supplierBrowser.close(); await acquirerBrowser.close();
  console.log(JSON.stringify({ ok: report.ok, checks: Object.fromEntries(Object.entries(report.assessment.checks).map(([name, check]) => [name, check.pass])) }));
  process.exitCode = report.ok ? 0 : 1;
}

async function shareSettled(page) {
  return waitFor(async () => { const files = await filesOf(page); return files && !files.preparing && !files.stopping && !files.sharing ? files : null; },
    { timeout: timeouts.settlementMs, poll, label: 'File contribution stop' });
}
