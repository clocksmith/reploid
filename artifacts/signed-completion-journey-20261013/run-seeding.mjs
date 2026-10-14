// Launch 2 explicit full-model seeding, through the existing file controls, alongside ordered chat.
// Usage: node run-seeding.mjs /absolute/config.json
// Bounded sharing is covered by run-contribution.mjs; this harness covers only the separately
// authorized full-model mode (REP-5 "Explicit full-model seeding"). Each step uses a fresh browser
// context, because an acquisition ledger's cap is immutable once created (work-model-files.js:355).
import { orderedSelectionId } from './config.mjs';
import { compilePatterns, observeChat, observeCustody, observeNetwork, observeOffer } from './observe.mjs';
import { assessSeeding } from './seeding-checks.mjs';
import { TERMINAL, startRun, openBrowser, appUrl, trackRequests, waitFor, openApp, chooseOrderedModel, send, followAttempt,
  waitForAttempt, attemptIds, startFileContribution, stopFileContribution, readLedger, openDevicePane, SELECTORS, sleep, now } from './harness.mjs';

const { config, room, fixture, report, save } = await startRun('full-seeding', './seeding.json');
const { freeze, timeouts, storage } = config, poll = config.observation.pollMs, selectionId = orderedSelectionId(freeze);
const patterns = compilePatterns(config.modelFiles.pathPatterns), mib = value => value * 1048576;
Object.assign(report, { scope: fixture.scope, modelFileRequests: [], stepErrors: {}, sends: [] });
const seederBrowser = await openBrowser(config.browsers.storageSupplier);
const acquirerBrowser = await openBrowser(config.browsers.storageAcquirer);
const contexts = [];
const seederOrigin = config.browsers.storageSupplier.origin, acquirerOrigin = config.browsers.storageAcquirer.origin;

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
const contextRows = label => report.modelFileRequests.filter(row => row.label === label);
const filesOf = async page => (await observeNetwork(page)).files;
async function step(name, run) {
  try { await run(); } catch (error) { report.stepErrors[name] = String(error.stack || error); } finally { await save(); }
}
// Wait until a started file contribution settles into sharing or an error.
async function outcome(page, timeout = timeouts.transferMs) {
  let started = false;
  return waitFor(async () => {
    const files = await filesOf(page).catch(() => null);
    started ||= !!(files?.preparing || files?.sharing || files?.error);
    return started && files && !files.preparing && !files.stopping && (files.sharing || files.error) ? files : null;
  }, { timeout, poll, label: 'File contribution outcome' });
}
async function stopped(page) {
  return waitFor(async () => { const files = await filesOf(page); return files && !files.preparing && !files.stopping && !files.sharing ? files : null; },
    { timeout: timeouts.settlementMs, poll, label: 'File contribution stop' });
}
// What the person sees in the file controls, before and after choosing a mode (network-controls.js:26-33,119-133).
async function visibleFileScope(page) {
  await openDevicePane(page);
  return page.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() ?? null;
    return { mode: document.querySelector('[data-file-mode]')?.value ?? null, limits: text('[data-file-limits]'),
      policy: text('[data-file-download-policy]'), progress: text('[data-file-progress]'),
      allowanceMiB: Number(document.querySelector('[data-file-download]')?.value || 0) || null };
  });
}
// Expected file set, fetched by the harness itself (not a page, so no tracked transfer is added): the
// served catalog entry's files plus the manifest's weight shards (work-model-files.js:198-213).
async function catalogFiles(origin) {
  const get = async url => { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw Error(`${url}: ${response.status}`); return response; };
  const catalog = await (await get(new URL('/config/chat-models.json', origin))).json();
  const model = catalog.find(item => item.id === freeze.modelId);
  if (!model?.source?.files?.length) throw Error('Served catalog lacks the frozen model source');
  const files = model.source.files.map(file => ({ path: file.path, role: file.role, sizeBytes: file.sizeBytes, hash: file.hash }));
  const entry = model.source.files.find(file => file.path === 'manifest.json');
  const manifest = await (await get(new URL(entry.url ?? entry.path, entry.url ? origin : model.source.baseUrl))).json();
  if ('sha256:' + entry.hash !== freeze.modelIdentity) throw Error('Served catalog manifest differs from the frozen model identity');
  for (const shard of manifest.shards) files.push({ path: shard.filename, role: 'model-weights', sizeBytes: shard.size, hash: shard.hash });
  return files;
}
const peerTransfers = custody => (custody?.receipts || []).map(receipt => ({ transferId: receipt.transferId, bytes: receipt.reservedBytes,
  finished: !receipt.failure, hashes: (receipt.completed || []).map(item => item.hash) }));
async function startChat(page) {
  await chooseOrderedModel(page, selectionId, timeouts.readyMs);
  const oldIds = attemptIds(await observeChat(page));
  report.sends.push(await send(page, fixture.chatPrompt, timeouts.readyMs));
  return { oldIds, ...await waitForAttempt(page, { oldIds, timeout: timeouts.answerMs, poll, label: 'Chat streaming',
    predicate: ({ attempt, response }) => attempt.status === 'executing' && response.content.length >= fixture.chatStartedAfterCharacters }) };
}

let seederPage, seeder;
try {
  // (r) Full-model seeding is refused without a sufficient separate allowance; nothing heavy downloads.
  await step('refusedWithoutAllowance', async () => {
    const owner = await freshContext(seederBrowser, 'refusal'), page = await openTab(owner, 'refusal-main', seederOrigin);
    const since = now();
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'full-model', allowanceMiB: storage.seedingRefusalAllowanceMiB });
    const files = await outcome(page);
    report.refusal = { allowanceBytes: mib(storage.seedingRefusalAllowanceMiB), files, offered: (await observeOffer(page)).offered,
      ledger: await readLedger(page), requests: rowsOf('refusal-main', since), visible: await visibleFileScope(page) };
  });

  // (v, s) Show the scope, then seed the whole model while this participant's conversation streams.
  await step('seeded', async () => {
    seeder = await freshContext(seederBrowser, 'seeder');
    seederPage = await openTab(seeder, 'seeder-main', seederOrigin);
    report.catalog = await catalogFiles(seederOrigin);
    await openDevicePane(seederPage);
    await seederPage.locator(SELECTORS.contributionModel).selectOption(freeze.modelId);
    await seederPage.locator(SELECTORS.fileMode).selectOption('full-model');
    await seederPage.locator(SELECTORS.fileDownload).fill(String(storage.seedingAllowanceMiB));
    // The scope the person sees before switching seeding on.
    report.scopeBeforeApproval = { at: now(), ...await visibleFileScope(seederPage) };
    const chat = await startChat(seederPage), samples = [];
    const startedAt = await startFileContribution(seederPage, { modelId: freeze.modelId, mode: 'full-model', allowanceMiB: storage.seedingAllowanceMiB });
    report.seed = { allowanceBytes: mib(storage.seedingAllowanceMiB), startedAt, samples, chat: { attemptId: chat.attempt.id, final: null } };
    const files = await waitFor(async () => {
      const state = await filesOf(seederPage), attempt = (await observeChat(seederPage)).threads.flatMap(thread => thread.attempts)
        .find(item => item.id === chat.attempt.id);
      samples.push({ at: now(), attemptStatus: attempt?.status ?? null, preparing: !!state?.preparing, sharing: !!state?.sharing });
      return state && !state.preparing && (state.sharing || state.error) ? state : null;
    }, { timeout: timeouts.seedingMs, poll, label: 'Seeding outcome' });
    Object.assign(report.seed, { files, finishedAt: now(), offered: (await observeOffer(seederPage)).offered,
      transportId: (await observeOffer(seederPage)).transportId, ledger: await readLedger(seederPage),
      requests: contextRows('seeder'), receipts: peerTransfers(await observeCustody(seederPage)), scopeWhileSharing: await visibleFileScope(seederPage) });
    await save();
    try {
      const { thread } = await followAttempt(seederPage, { oldIds: chat.oldIds, timeout: timeouts.answerMs, poll, samples: [] });
      report.seed.chat.final = thread;
    } finally {
      report.seed.chat.final ??= (await observeChat(seederPage).catch(() => null))?.threads
        .find(thread => thread.attempts.some(item => item.id === chat.attempt.id)) ?? null;
    }
  });

  // (b) Another computer acquires every model file from the seeder; origin serves it no weights.
  await step('peerAcquiresWholeModel', async () => {
    if (!report.seed?.files?.sharing) throw Error('Prerequisite seeding step did not share');
    const acquirer = await freshContext(acquirerBrowser, 'whole-acquirer'), page = await openTab(acquirer, 'whole-acquirer-main', acquirerOrigin);
    await waitFor(async () => (await filesOf(page))?.peers?.includes(report.seed.transportId), { timeout: timeouts.transferMs, poll, label: 'Seeder offer discovery' });
    const suppliedBefore = (await filesOf(seederPage)).suppliedBytes, since = now();
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'full-model', allowanceMiB: storage.seedingAllowanceMiB });
    const files = await outcome(page, timeouts.seedingMs);
    report.peer = { seeder: { machine: config.browsers.storageSupplier.machine, transportId: report.seed.transportId, suppliedBefore,
      suppliedAfter: (await filesOf(seederPage)).suppliedBytes },
    acquirer: { machine: config.browsers.storageAcquirer.machine, files, offered: (await observeOffer(page)).offered,
      receipts: peerTransfers(await observeCustody(page)), ledger: await readLedger(page), requests: rowsOf('whole-acquirer-main', since) } };
    await stopFileContribution(page); await stopped(page);
  });

  // (c) Reload the seeder's only tab; cached-only rebuilds the whole inventory with no download.
  await step('reloadRebuildsWhole', async () => {
    if (!report.seed?.files?.sharing) throw Error('Prerequisite seeding step did not share');
    const before = { offered: (await observeOffer(seederPage)).offered, ledger: await readLedger(seederPage) };
    await stopFileContribution(seederPage); await stopped(seederPage);
    await seederPage.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => observeCustody(seederPage).catch(() => null), { timeout: timeouts.readyMs, poll, label: 'Custody owner' });
    const since = now();
    await startFileContribution(seederPage, { modelId: freeze.modelId, mode: 'cached-only' });
    const files = await outcome(seederPage);
    const quiet = Date.now(); while (Date.now() - quiet < fixture.cachedOnlyObservationMs) await sleep(250);
    report.reload = { before, after: { files, offered: (await observeOffer(seederPage)).offered, ledger: await readLedger(seederPage),
      requests: rowsOf('seeder-main', since) } };
    await stopFileContribution(seederPage); await stopped(seederPage);
  });

  // (n) A bounded grant cannot become seeding by changing modes: the cap is immutable.
  await step('boundedDoesNotImplySeeding', async () => {
    const owner = await freshContext(seederBrowser, 'bounded'), page = await openTab(owner, 'bounded-main', seederOrigin);
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'bounded-acquisition', allowanceMiB: storage.sharingAllowanceMiB });
    const bounded = await outcome(page);
    const boundedOffer = (await observeOffer(page)).offered;
    await stopFileContribution(page); await stopped(page);
    const since = now();
    // The existing ledger keeps its cap; the control shows it and the full-model start must be refused.
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'full-model', allowanceMiB: storage.sharingAllowanceMiB });
    const seeding = await outcome(page);
    report.bounded = { allowanceBytes: mib(storage.sharingAllowanceMiB), bounded, boundedOffer, seeding,
      seedingOffer: (await observeOffer(page)).offered, ledger: await readLedger(page), requests: rowsOf('bounded-main', since) };
    await stopFileContribution(page).catch(() => null);
  });

  // (f) Stop a seed while whole files transfer and the person's conversation streams.
  await step('stopSettlesSeeding', async () => {
    const owner = await freshContext(seederBrowser, 'seed-stop'), page = await openTab(owner, 'seed-stop-main', seederOrigin);
    const chat = await startChat(page), samples = [];
    const record = async () => samples.push({ at: now(), attemptStatus: (await observeChat(page)).threads.flatMap(thread => thread.attempts)
      .find(item => item.id === chat.attempt.id)?.status ?? null });
    await startFileContribution(page, { modelId: freeze.modelId, mode: 'full-model', allowanceMiB: storage.seedingAllowanceMiB });
    const inFlight = await waitFor(async () => {
      await record();
      const files = await filesOf(page), pending = rowsOf('seed-stop-main').filter(row => row.weight && !row.finished && !row.failed).length;
      return files?.preparing && pending > 0 ? { pendingWeightRequests: pending, progress: files.progress } : null;
    }, { timeout: timeouts.transferMs, poll, label: 'Whole file in flight' });
    const ledgerBefore = await readLedger(page), stopClickedAt = await stopFileContribution(page);
    const filesAfter = await stopped(page), settledAt = now();
    report.stop = { inFlight, ledgerBefore, stopClickedAt, filesAfter, settledAt, ledgerAfter: await readLedger(page),
      chat: { attemptId: chat.attempt.id, samples, final: null } };
    await save();
    try {
      const { thread } = await followAttempt(page, { oldIds: chat.oldIds, timeout: timeouts.answerMs, poll, samples: [],
        onSample: ({ attempt }) => { samples.push({ at: now(), attemptStatus: attempt.status }); } });
      report.stop.chat.final = thread;
    } finally {
      report.stop.chat.final ??= (await observeChat(page).catch(() => null))?.threads
        .find(thread => thread.attempts.some(item => item.id === chat.attempt.id)) ?? null;
      report.stop.requestsAfterSettled = rowsOf('seed-stop-main', settledAt).length;
    }
  });
} finally {
  report.assessment = assessSeeding(report, freeze, fixture);
  report.ok = Object.keys(report.stepErrors).length === 0 && report.assessment.automatedPass;
  report.status = report.ok ? 'automated full-seeding checks passed' : 'automated full-seeding acceptance failed';
  report.finishedAt = now(); await save();
  for (const context of contexts) await context.close().catch(() => {});
  await seederBrowser.close(); await acquirerBrowser.close();
  console.log(JSON.stringify({ ok: report.ok, checks: Object.fromEntries(Object.entries(report.assessment.checks).map(([name, check]) => [name, check.pass])) }));
  process.exitCode = report.ok ? 0 : 1;
}
