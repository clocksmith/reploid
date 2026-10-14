// Launch 2 storage contribution alongside ordered chat, through the existing file controls.
// Usage: node run-contribution.mjs /absolute/config.json
// Each step is recorded separately; a failed step leaves its later dependants unobserved,
// and their checks then fail closed. Steps that need a fresh acquisition ledger use a fresh
// browser context, because a ledger's cap is immutable once created (work-model-files.js:355).
import { orderedSelectionId } from './config.mjs';
import { classifyRequest, compilePatterns, observeChat, observeConnectionOwner, observeCustody, observeNetwork, observeOffer, observeSupplierOffers, rangeBytes } from './observe.mjs';
import { assessContribution, SINGLE_OWNER_REFUSAL, MIN_INTERRUPTED_PIECE_BYTES } from './contribution-checks.mjs';
import { TERMINAL, startRun, openBrowser, appUrl, trackRequests, transferBytes, transferKey, waitFor, withDeadline, openApp, chooseOrderedModel,
  send, followAttempt, waitForAttempt, attemptIds, startFileContribution, stopFileContribution, readLedger, classifyInterruption, closeOtherTabs, sleep, now } from './harness.mjs';

const { config, room, fixture, report, save } = await startRun('storage-contribution', './contribution.json');
const { freeze, timeouts, storage } = config, poll = config.observation.pollMs, selectionId = orderedSelectionId(freeze);
const patterns = compilePatterns(config.modelFiles.pathPatterns), mib = value => value * 1048576;
Object.assign(report, { scope: fixture.scope, modelFileRequests: [], stepErrors: {}, permissions: [] });
const supplierBrowser = await openBrowser(config.browsers.storageSupplier);
const acquirerBrowser = await openBrowser(config.browsers.storageAcquirer);
const contexts = [], tabNames = new Map();
const supplierOrigin = config.browsers.storageSupplier.origin, acquirerOrigin = config.browsers.storageAcquirer.origin;

async function freshContext(handle, label) {
  const context = await handle.browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  return { context, tracker: trackRequests(context, patterns, report.modelFileRequests, label) };
}
// Every tab of every context this run created, named or not.
const harnessTabs = () => contexts.flatMap(context => context.pages()).map(page => ({ name: tabNames.get(page) ?? 'unnamed', page }));
async function openTab(owner, name, origin) {
  const page = await owner.context.newPage(); owner.tracker.name(page, name); tabNames.set(page, name);
  page.on('pageerror', error => report.stepErrors[`${name}:pageerror`] = error.message);
  await openApp(page, appUrl(origin, room, config.application.signalingUrl), timeouts.readyMs);
  return page;
}
const rowsOf = (name, since = '') => report.modelFileRequests.filter(row => row.page === name && row.at >= since);
// Every model-file request of one context, including requests without a page (workers).
const contextRows = label => report.modelFileRequests.filter(row => row.label === label);
// Samples which connected peers offer files to `page` for at least windowMs (fixture supplierObservationMs).
async function observeSuppliers(page, windowMs) {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw Error('Fixture supplierObservationMs required');
  const samples = [], started = Date.now();
  do { samples.push({ at: now(), ...await observeSupplierOffers(page) }); await sleep(poll); } while (Date.now() - started < windowMs);
  return { samples, observationMs: Date.now() - started };
}
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
  const { permission } = await send(page, fixture.chatPrompt, timeouts.readyMs);
  if (permission) report.permissions.push(permission);
  return { oldIds, ...await waitForAttempt(page, { oldIds, timeout: timeouts.answerMs, poll, label: 'Chat streaming',
    predicate: ({ attempt, response }) => attempt.status === 'executing' && response.content.length >= fixture.chatStartedAfterCharacters }) };
}
const chatStatus = async (page, attemptId) => (await observeChat(page)).threads.flatMap(thread => thread.attempts).find(item => item.id === attemptId)?.status ?? null;

// The sharer profile has one open tab at a time; supplierName follows it from (a) through (e) and (c).
let supplierPage, acquirerPage, supplier, supplierName = 'supplier-main';
const openPages = owner => owner.context.pages().filter(page => !page.isClosed()).length;
try {
  // (a) Share a small verified subset while this participant's own conversation streams.
  await step('sharedWhileChatting', async () => {
    supplier = await freshContext(supplierBrowser, 'supplier');
    supplierPage = await openTab(supplier, supplierName, supplierOrigin);
    const chat = await startChat(supplierPage), samples = [];
    const startedAt = await startFileContribution(supplierPage, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.sharingAllowanceMiB });
    // Sharing evidence is recorded as soon as sharing settles, so a slow or failed
    // conversation fails only its own requirement, not the steps that need the offer.
    report.share = { machine: config.browsers.storageSupplier.machine, mode: 'bounded-acquisition', allowanceBytes: mib(storage.sharingAllowanceMiB),
      startedAt, samples, files: null, chat: { attemptId: chat.attempt.id, final: null } };
    const sample = async () => {
      const attemptStatus = await chatStatus(supplierPage, chat.attempt.id), files = await filesOf(supplierPage);
      samples.push({ at: now(), attemptStatus, filesPreparing: !!files?.preparing, filesSharing: !!files?.sharing });
      return { attemptStatus, files };
    };
    try {
      report.share.files = await waitFor(async () => { const { files } = await sample();
        return files && !files.preparing && (files.sharing || files.error) ? files : null; }, { timeout: timeouts.transferMs, poll, label: 'Sharing outcome' });
      Object.assign(report.share, await observeOffer(supplierPage)); await save();
      await waitFor(async () => TERMINAL.has((await sample()).attemptStatus), { timeout: timeouts.answerMs, poll, label: 'Sharer conversation outcome' });
    } finally {
      report.share.chat.final = (await observeChat(supplierPage).catch(() => null))?.threads.find(thread => thread.id === chat.thread.id) ?? null;
    }
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

  // (e) Cached-only mode in the sharer's own profile, one tab at a time (README, "Contract decision"):
  // close the sharer tab, confirm the next tab of the profile connects normally (the single-owner lock
  // was released), then use only that tab. Every model-file request of its lifetime counts.
  await step('cachedOnly', async () => {
    if (!report.share?.files?.sharing) throw Error('Prerequisite sharing step did not share');
    const sharer = { name: supplierName, peerId: (await observeNetwork(supplierPage)).consumerPeerId,
      offered: (await observeOffer(supplierPage)).offered, budget: await readLedger(supplierPage) };
    await supplierPage.close(); sharer.closedAt = now();
    const tab = { name: 'supplier-cached', openedAt: now(), lockSamples: [] };
    report.cachedOnly = { mode: 'cached-only', sharer, tab, budgetBefore: sharer.budget };
    const page = await openTab(supplier, tab.name, supplierOrigin);
    supplierPage = page; supplierName = tab.name;
    tab.profilePages = openPages(supplier);
    const lock = await waitFor(async () => {
      const row = await observeConnectionOwner(page).catch(() => null);
      if (row) tab.lockSamples.push({ at: now(), ...row });
      return row && (row.error === SINGLE_OWNER_REFUSAL || (row.consumerPeerId && row.custodyOwner)) ? row : null;
    }, { timeout: timeouts.readyMs, poll, label: 'Next sharer-profile tab connection' });
    if (lock.error === SINGLE_OWNER_REFUSAL) throw Error('Next tab of the sharer profile was refused: the single-owner lock was not released');
    const custodyBefore = await custodyReady(page);
    const startedAt = await startFileContribution(page, { modelId: freeze.modelId, mode: 'cached-only' });
    const files = await shareOutcome(page), outcomeAt = now(), samples = [], quietStart = Date.now();
    do {
      const state = await filesOf(page);
      samples.push({ at: now(), pending: state?.pending ?? null, preparing: !!state?.preparing, sharing: !!state?.sharing });
      await sleep(250);
    } while (Date.now() - quietStart < fixture.cachedOnlyObservationMs);
    const observationMs = Date.now() - quietStart;
    Object.assign(report.cachedOnly, { files, offered: (await observeOffer(page)).offered, samples, observationMs,
      receiptsBefore: custodyBefore.receipts.length, receiptsAfter: (await observeCustody(page)).receipts.length, budgetAfter: await readLedger(page),
      window: { openedAt: tab.openedAt, startedAt, outcomeAt, endedAt: now() }, requests: rowsOf(tab.name) });
    // Cached-only sharing stays on: this tab is the sharer profile's only tab for (c).
  });

  // (c) Reload the sharer profile's only tab; rebuild inventory from cache and read the persisted ledger.
  await step('reloadPreserved', async () => {
    if (!report.share?.files?.sharing) throw Error('Prerequisite sharing step did not share');
    if (!supplierPage || supplierPage.isClosed()) throw Error('Prerequisite sharer profile tab unavailable');
    const before = { offered: (await observeOffer(supplierPage)).offered, budget: await readLedger(supplierPage) };
    const profilePages = openPages(supplier);
    await supplierPage.reload({ waitUntil: 'domcontentloaded' });
    await custodyReady(supplierPage);
    const since = now();
    await startFileContribution(supplierPage, { modelId: freeze.modelId, mode: 'cached-only' });
    await shareOutcome(supplierPage);
    report.reload = { tab: supplierName, profilePages, before, after: { mode: 'cached-only', offered: (await observeOffer(supplierPage)).offered,
      budget: await readLedger(supplierPage), requests: rowsOf(supplierName, since) } };
  });

  // Later steps acquire into fresh ledgers; withdraw this run's offers so their transfers are observable.
  await step('withdrawOffers', async () => {
    for (const page of [supplierPage, acquirerPage].filter(Boolean)) { await stopFileContribution(page); await shareSettled(page); }
  });

  // (f) Stop file contribution while a transfer is in flight and a conversation streams. The local origin
  // delivers the whole 64 MiB allowance in about 3 s, which page-state polling missed in run 7 attempt e (and
  // the step then left its tab offering pieces to the later steps). Network throttling (attempts h to j)
  // slowed every page observation and click in step with the download, so instead the harness holds the
  // first piece request of at least MIN_INTERRUPTED_PIECE_BYTES at the browser (a slow origin, harness only)
  // until Stop has been clicked, then releases it. In flight means that held request, pending at the click;
  // the stop must abort it. A failed step still stops this tab's contribution.
  await step('stopSettles', async () => {
    const owner = await freshContext(supplierBrowser, 'stop'), page = await openTab(owner, 'stop-main', supplierOrigin);
    let release, heldUrl = null;
    const released = new Promise(resolve => { release = resolve; });
    await owner.context.route(url => classifyRequest(url.href, patterns).weight, async (route, request) => {
      if (!heldUrl && rangeBytes(request.headers().range ?? null) >= MIN_INTERRUPTED_PIECE_BYTES) {
        heldUrl = request.url(); await released;
      }
      await route.continue().catch(() => {});
    });
    const chat = await startChat(page), samples = [];
    const record = async () => samples.push({ at: now(), attemptStatus: await chatStatus(page, chat.attempt.id) });
    const large = owner.tracker.next(row => row.page === 'stop-main' && row.weight && row.declaredBytes >= MIN_INTERRUPTED_PIECE_BYTES);
    let stopClickedAt = null, timer;
    try {
      await record();
      await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.stopAllowanceMiB });
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('In-flight acquisition deadline')), timeouts.transferMs); });
      deadline.catch(() => {});
      const largeRow = await Promise.race([large, deadline]);
      const budgetBefore = await readLedger(page), files = await filesOf(page);
      await record();
      const clickStartedAt = now();
      stopClickedAt = await stopFileContribution(page);
      const pendingRows = rowsOf('stop-main').filter(row => row.at <= stopClickedAt
        && (!(row.finishedAt && row.finishedAt < stopClickedAt) || (row.failed && row.finishedAt >= clickStartedAt)));
      const inFlightAtStop = { filesPreparing: !!files?.preparing, pendingRequests: pendingRows.length + (files?.pending || 0),
        custodyPending: files?.pending || 0, progress: files?.progress ?? null, heldLargePiece: { url: heldUrl, at: largeRow.at },
        clickStartedAt, pending: pendingRows.map(row => ({ url: row.url, range: row.range, at: row.at })) };
      report.stop = { inFlightAtStop, budgetBefore, stopClickedAt, chat: { attemptId: chat.attempt.id, final: null, samples } };
    } finally {
      clearTimeout(timer);
      if (!stopClickedAt) await stopFileContribution(page).catch(() => null);
      release();
    }
    // The held request's outcome after release: the stop must have aborted it.
    await sleep(500);
    report.stop && (report.stop.heldOutcome = rowsOf('stop-main').filter(row => row.url === heldUrl?.split('?')[0] && row.declaredBytes >= MIN_INTERRUPTED_PIECE_BYTES)
      .map(row => ({ at: row.at, finished: row.finished, failed: row.failed, failure: row.failure ?? null, finishedAt: row.finishedAt })));
    const filesAfter = await waitFor(async () => { await record(); const files = await filesOf(page);
      return files && !files.preparing && !files.stopping && !files.sharing ? files : null; }, { timeout: timeouts.settlementMs, poll, label: 'Stop settlement' });
    const settledAt = now();
    // Settlement evidence is recorded before waiting for the conversation; a chat
    // deadline must not discard what the stop itself observed.
    Object.assign(report.stop, { budgetAfter: await readLedger(page), filesAfter, settledAt, requestsAfterSettled: rowsOf('stop-main', settledAt).length });
    await save();
    try {
      const { thread } = await followAttempt(page, { oldIds: chat.oldIds, timeout: timeouts.answerMs, poll, samples: [],
        onSample: ({ attempt }) => { samples.push({ at: now(), attemptStatus: attempt.status }); } });
      report.stop.chat.final = thread;
    } finally {
      report.stop.chat.final ??= (await observeChat(page).catch(() => null))?.threads.flatMap(thread => thread.attempts.some(item => item.id === chat.attempt.id) ? [thread] : [])[0] ?? null;
      // Requests are counted over the whole conversation wait, as before.
      report.stop.requestsAfterSettled = rowsOf('stop-main', settledAt).length;
    }
  });

  // (d) Two tabs of ONE fresh profile compete for its one allowance. Contract: one connected tab per
  // profile (README, "Contract decision"), so the second tab must be refused by the single-owner lock
  // (self/host/work-peer-offers.js:20-21) and can never acquire; the owner's acquisition is charged once.
  await step('competingTabs', async () => {
    const owner = await freshContext(supplierBrowser, 'contention'), profile = 'contention', allowanceMiB = storage.contentionAllowanceMiB;
    const first = await openTab(owner, 'contention-0', supplierOrigin);
    await custodyReady(first);
    const second = await openTab(owner, 'contention-1', supplierOrigin), samples = [], ledgerSamples = [];
    const sample = async phase => { const row = { at: now(), phase, ...await observeConnectionOwner(second) }; samples.push(row); return row; };
    // Wait for the refusal, or record the connection that must fail the check.
    await waitFor(async () => { const row = await sample('opened').catch(() => null); return row && (row.error === SINGLE_OWNER_REFUSAL || row.consumerPeerId || row.custodyOwner); },
      { timeout: timeouts.readyMs, poll, label: 'Second tab refusal or connection' });
    const ledgerBefore = await readLedger(first);
    // Both tabs press the real file control at once; the refused tab's attempt reconnects and is refused again.
    const [ownerStart, secondStart] = await Promise.allSettled([first, second].map(page =>
      startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB })));
    if (ownerStart.status === 'rejected') throw ownerStart.reason;
    await sample('after-start'); ledgerSamples.push(await readLedger(first));
    const outcome = await shareOutcome(first);
    await sample('after-acquisition'); ledgerSamples.push(await readLedger(first));
    const custody = await observeCustody(first);
    const http = name => rowsOf(name).map(row => ({ key: transferKey(row), bytes: transferBytes(row), finished: row.finished && !row.failed }));
    report.contention = { allowanceBytes: mib(allowanceMiB), ledgerBefore, ledgerSamples, ledgerAfter: await readLedger(first),
      owner: { name: 'contention-0', profile, consumerPeerId: (await observeNetwork(first)).consumerPeerId, budget: outcome.acquisitionBudget,
        outcome: { sharing: outcome.sharing, error: outcome.error }, transfers: [...http('contention-0'), ...peerTransfers(custody)] },
      second: { name: 'contention-1', profile, samples, refusal: samples.find(row => row.error)?.error ?? null,
        fileAttempt: secondStart.status === 'fulfilled' ? { clickedAt: secondStart.value, harnessError: null }
          : { clickedAt: null, harnessError: String(secondStart.reason?.message || secondStart.reason) },
        ledgerAfter: await readLedger(second), transfers: http('contention-1') } };
  });

  // (d) Interrupt an acquisition by reloading while a piece of at least 1 MiB transfers, then resume it.
  // Origin is this step's only intended supplier. Peer transfers before the reload end with the page
  // and cannot be observed (run 3: the competing-tabs owner still offered its subset and served the
  // metadata and small pieces unobserved). So every earlier tab of this run is closed first, and no
  // connected peer may offer files before the acquisition starts or after it resumes.
  await step('interruptedResume', async () => {
    const isolation = await closeOtherTabs(harnessTabs(), { observe: filesOf });
    report.interruption = { minimumInFlightBytes: MIN_INTERRUPTED_PIECE_BYTES, isolation };
    if (isolation.remainingOpen.length) throw Error(`Tabs that could supply pieces remain open: ${isolation.remainingOpen.join(', ')}`);
    const owner = await freshContext(supplierBrowser, 'interrupt'), page = await openTab(owner, 'interrupt-main', supplierOrigin);
    await custodyReady(page);
    const before = await observeSuppliers(page, fixture.supplierObservationMs);
    report.interruption.suppliers = { observationMs: before.observationMs, before: before.samples, after: [] };
    if (before.samples.some(sample => sample.offering.length)) throw Error('Another supplier is offering model files to the interrupt tab');
    const ledgerBefore = await readLedger(page);
    // The first indexed pieces (64 and 512 bytes) finish over loopback before any poll. Each piece is
    // reserved right before its own request and pieces are acquired one at a time (work-model-files.js:155-158,
    // 403-431). The reload is issued from the request event of the first piece of at least 1 MiB, with no
    // observation round trip in between, while that piece is still transferring.
    const large = owner.tracker.next(row => row.page === 'interrupt-main' && row.weight && row.declaredBytes >= MIN_INTERRUPTED_PIECE_BYTES);
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.interruptionAllowanceMiB });
    const target = await withDeadline(large, timeouts.transferMs, 'Piece of at least 1 MiB in flight');
    const reloadAt = now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Navigation aborts the request (requestfailed); a requestfinished means the reload lost the race.
    await waitFor(() => target.finished || target.failed, { timeout: timeouts.settlementMs, poll, label: 'Interrupted piece settlement' }).catch(() => null);
    await custodyReady(page);
    const resumedSince = now();
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.interruptionAllowanceMiB });
    const files = await shareOutcome(page);
    // Every transfer of the interrupt context, from any source: all its HTTP rows, and the custody
    // receipts after the resume, counted once with the resume. Pre-reload custody is not read: that
    // round trip would delay the reload. No supplier was offering, so no peer transfer is expected;
    // any receipt fails the check, and an unobserved one leaves the ledger above the observed sum.
    const shape = classifyInterruption(contextRows('interrupt'), { target, reloadAt, resumedSince });
    const peer = peerTransfers(await observeCustody(page));
    report.interruption.suppliers.after.push({ at: now(), ...await observeSupplierOffers(page) });
    Object.assign(report.interruption, { ledgerBefore, ...shape, peerTransfers: peer, resumed: [...shape.resumed, ...peer],
      ledgerFinal: await readLedger(page), final: { sharing: files.sharing, error: files.error, offered: (await observeOffer(page)).offered } });
  });
} finally {
  report.assessment = assessContribution(report, freeze, fixture);
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
