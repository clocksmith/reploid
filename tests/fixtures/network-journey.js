/**
 * The whole-request journey as one runnable scenario, with one receipt.
 *
 *   node tests/fixtures/network-journey.js [receipt.json]
 *
 * A requester that holds no model files selects a model, a provider that lacks the model completes it from
 * peers, and the requester streams an answer with a settlement record. Then a provider is stopped after its
 * first streamed token, a fresh attempt finishes on another route, and a completion whose result is lost in
 * transit is reconciled from the provider's journal without a second generation or a second charge.
 *
 * Providers are test-owned (see tests/helpers/journey-network.js). This is not GPU inference, a physical
 * network or a performance result; its timings describe the test generator's declared rates.
 */
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createJourneyNetwork, waitFor, JOURNEY_ANSWER } from '../helpers/journey-network.js';

const ANSWER = JOURNEY_ANSWER.join('');
const PROVIDERS = [
  // Connection-id order. With ranking off the mesh breaks ties by connection id, which knows nothing of speed.
  { name: 'provider-1-slow', tokensPerSecond: 40, holdsModel: true },
  { name: 'provider-2-fast', tokensPerSecond: 400, holdsModel: true },
  { name: 'provider-3-medium', tokensPerSecond: 120, holdsModel: false }
];

export async function runNetworkJourney({ providers = PROVIDERS } = {}) {
  const network = await createJourneyNetwork({ providers });
  const { model, hub, credits, requester, outcomes } = network;
  const messages = [{ role: 'user', content: 'Send one answer across the network.' }];
  const name = value => network.seatOf(value)?.name ?? value;
  let peakRss = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const balances = () => Object.fromEntries(credits.snapshot().accounts.map(row => [row.id, { balance: row.balance, held: row.held }]));
  const journalEntries = () => credits.snapshot().journal.length;
  const routeDigest = route => route ? hashJson({ schema: 'reploid.whole-model-route/v1', modelIdentity: model.identity,
    providerIdentity: route.providerIdentity, offerId: null }) : null;

  /** One attempt through the real requester. Never throws: the failure is part of the record. */
  async function attempt({ attemptId, threadId, ranked, signal = new AbortController().signal, onFirstDelta = null, onDelta = null }) {
    const ranking = await network.rank(messages, ranked);
    const mark = hub.mark(), entriesBefore = journalEntries(), started = performance.now();
    const record = { attemptId, threadId, ranking: ranked ? 'coordinator-measured-order' : 'off', text: '', deltaCount: 0,
      timeToFirstTokenMs: null, approvals: 0 };
    let route = null, result = null, failure = null;
    try {
      result = await requester.generate({ model, messages, threadId, attemptId }, {
        signal,
        requestApproval: async disclosure => {
          record.approvals += 1;
          record.disclosed = { requestId: disclosure.requestId, recipient: name(disclosure.recipientIdentity),
            quoteMaximum: disclosure.serviceCreditQuote.maximum };
          return true;
        },
        onRoute: value => { route = value; },
        onReservation: id => { record.reservationId = id; },
        onDelta: async delta => {
          record.deltaCount += 1; record.text += delta.text;
          if (record.timeToFirstTokenMs === null) {
            record.timeToFirstTokenMs = Math.round(performance.now() - started);
            await onFirstDelta?.(route);
          }
          await onDelta?.(record);
        }
      });
    } catch (error) { failure = error; }
    record.completionMs = Math.round(performance.now() - started);
    record.modelDigest = model.identity;
    record.routeDigest = await routeDigest(route);
    record.route = route ? { requestId: route.requestId, provider: name(route.providerIdentity),
      reason: route.placement?.reason ?? null,
      candidates: (route.placement?.candidates || []).map(candidate => ({ provider: name(candidate.verifiedIdentity ?? candidate.peerId),
        contributionScore: candidate.contributionScore, availableSlots: candidate.availableSlots })),
      ...(ranking ? { coordinatorEstimatesMs: Object.fromEntries(ranking.providers.map(row => [name(row.computerId), Math.round(row.estimatedMs)])) } : {}) } : null;
    record.requesterSaw = failure ? { error: failure.message } : { content: result.content, correct: result.content === ANSWER,
      outputTokens: result.usage.outputTokens };
    record.partialOutputRetained = failure ? record.text : null;
    record.terminalReceipt = outcomes.findLast(outcome => outcome.attemptId === attemptId) ?? null;
    record.charge = result?.serviceCredit?.charge ?? failure?.serviceCredit?.charge ?? null;
    record.settlementStatus = result?.serviceCredit?.status ?? failure?.serviceCredit?.status ?? null;
    record.ledgerEntriesAdded = journalEntries() - entriesBefore;
    record.bytesMoved = hub.summarize(mark);
    record.balancesAfter = balances();
    return record;
  }

  const receipt = { schema: 'reploid.network-journey-receipt/v1', recordedAt: new Date().toISOString(),
    scope: {
      real: ['signing identities and peer identity proofs', 'peer generation mesh', 'custody exchange and verified piece fill',
        'provider generation journal', 'fleet credit service over HTTP with a SQLite ledger', 'provider admission',
        'whole-model and fleet requester wrappers', 'coordinator placement estimates'],
      testOwned: ['in-memory transport hub (not WebRTC, not a physical network)',
        'generator: a fixed answer emitted at each provider\'s declared rate (not GPU inference)',
        'provider measurements are the declared rates, not observed hardware'],
      notEstablished: ['real inference', 'hardware speed', 'GPU buffer release', 'physical peer recovery', 'four-GPU fleet qualification']
    },
    identifiers: { attemptId: 'request.attemptId, chosen by the requester', modelDigest: 'model.identity (SHA-256 of the manifest)',
      routeDigest: 'SHA-256 of {schema, modelIdentity, providerIdentity, offerId}', terminalReceipt: 'reploid.request-outcome/v1' },
    model: { id: model.id, modelDigest: model.identity, weightBytes: network.fixture.weightBytes, pieces: network.fixture.pieceCount },
    providers: providers.map(row => ({ name: row.name, declaredTokensPerSecond: row.tokensPerSecond, startedWithModel: row.holdsModel })),
    requester: { modelBytesHeld: 0, selected: model.id } };
  try {
    // 1. Discovery before the third provider can serve.
    receipt.discovery = { beforeFill: network.readyPeers().map(peer => name(peer.peerId)) };

    // 2. Model distribution: the provider without the model completes it from peers and verifies it.
    const filled = await network.fill('provider-3-medium');
    await network.expectReady(3);
    const pieceEvents = filled.progress.filter(event => event.phase === 'piece' && event.reused === false);
    receipt.distribution = { provider: 'provider-3-medium', holders: providers.filter(row => row.holdsModel).map(row => row.name),
      pieces: pieceEvents.map(event => ({ file: event.path, source: event.source, supplier: name(event.supplier ?? null) })),
      bytesBySupplier: Object.fromEntries(Object.entries(filled.result.suppliers ?? {}).map(([key, value]) => [name(key), value])),
      fetchedPieces: filled.result.fetchedPieces, fetchedBytes: filled.result.fetchedBytes, verifiedAfterFill: filled.verified,
      elapsedMs: filled.elapsedMs, bytesMoved: filled.traffic };
    receipt.discovery.afterFill = network.readyPeers().map(peer => name(peer.peerId));
    receipt.discovery.catalog = network.whole.getModels().map(row => ({ id: row.id, availability: row.availability, providers: row.providerIds.map(name) }));

    // 3. Healthy route, twice on the same providers: ranking off, then on.
    receipt.healthyRankingOff = await attempt({ attemptId: 'healthy-ranking-off', threadId: 'thread-ranking-off', ranked: false });
    receipt.healthyRankingOn = await attempt({ attemptId: 'healthy-ranking-on', threadId: 'thread-ranking-on', ranked: true });
    receipt.placementComparison = { rankingOff: { provider: receipt.healthyRankingOff.route?.provider, reason: receipt.healthyRankingOff.route?.reason,
      timeToFirstTokenMs: receipt.healthyRankingOff.timeToFirstTokenMs, completionMs: receipt.healthyRankingOff.completionMs },
    rankingOn: { provider: receipt.healthyRankingOn.route?.provider, reason: receipt.healthyRankingOn.route?.reason,
      timeToFirstTokenMs: receipt.healthyRankingOn.timeToFirstTokenMs, completionMs: receipt.healthyRankingOn.completionMs },
    note: 'With ranking off the order is self-reported contribution score, then connection id; neither measures speed.' };

    // 4. Interrupted route: the chosen provider stops right after its first streamed token.
    let stoppedAt = null, stoppedProvider = null;
    const interrupted = await attempt({ attemptId: 'interrupted', threadId: 'thread-recovery', ranked: true,
      onFirstDelta: async route => {
        stoppedProvider = name(route.providerIdentity);
        stoppedAt = await network.stop(stoppedProvider);
      } });
    interrupted.stoppedProvider = stoppedProvider;
    interrupted.requesterNoticedAfterMs = interrupted.completionMs - interrupted.timeToFirstTokenMs;
    interrupted.holdAfterFailure = balances()['computer-requester'].held;
    receipt.interrupted = interrupted;

    // 5. Recovered outcome: a fresh attempt, with fresh approval, on another route.
    const executionsBefore = Object.fromEntries(network.seats.map(seat => [seat.name, seat.executions]));
    const recovered = await attempt({ attemptId: 'recovered', threadId: 'thread-recovery', ranked: true });
    recovered.recovery = recovered.deltaCount === JOURNEY_ANSWER.length && recovered.text === ANSWER ? 'restarted-generation' : 'unknown';
    recovered.tokensResumedFromInterruptedAttempt = 0;
    recovered.executionsAdded = Object.fromEntries(network.seats.map(seat => [seat.name, seat.executions - executionsBefore[seat.name]]));
    receipt.recovered = recovered;

    // 6. When the interrupted attempt's hold is released: not until its provider returns and signs.
    const heldWhileProviderAway = balances()['computer-requester'].held, awayMs = Date.now() - stoppedAt;
    const restarted = await network.restart(stoppedProvider);
    await waitFor(() => balances()['computer-requester'].held === 0, { label: 'hold release after provider restart' });
    const releasedAt = Date.now();
    await network.expectReady(3);
    const reconciled = await requester.recover({ reservationId: interrupted.reservationId, messages }, { signal: new AbortController().signal });
    receipt.interruptedRelease = { heldWhileProviderAway, providerAwayMs: awayMs, releasedBy: 'provider restart signed failed-execution evidence',
      releasedMsAfterStop: releasedAt - stoppedAt, reconciledByProvider: restarted.reconciled.map(row => row.requestId),
      finalStatus: reconciled.status, finalCharge: reconciled.serviceCredit?.charge ?? null,
      cleanupRecords: network.seatOf(stoppedProvider).cleanups,
      gpuBuffers: 'not exercised: test-owned providers hold no GPU buffers' };

    // 7. Lost acknowledgment: the provider completes and journals; its result never reaches the requester.
    const abort = new AbortController();
    let lostResults = 0;
    const restore = hub.lose(entry => entry.type === 'reploid:generation-result' && entry.to === 'requester' && ++lostResults > 0);
    const executionsBeforeLoss = Object.fromEntries(network.seats.map(seat => [seat.name, seat.executions]));
    const lostRun = attempt({ attemptId: 'lost-acknowledgment', threadId: 'thread-lost-ack', ranked: true, signal: abort.signal });
    await waitFor(() => lostResults > 0, { label: 'the completed result to be lost in transit' });
    abort.abort(Error('No result arrived; the connection is assumed lost'));
    const lost = await lostRun;
    restore();
    lost.holdAfterFailure = balances()['computer-requester'].held;
    const entriesBeforeRecovery = journalEntries();
    const first = await requester.recover({ reservationId: lost.reservationId, messages }, { signal: new AbortController().signal });
    const entriesAfterFirst = journalEntries();
    const second = await requester.recover({ reservationId: lost.reservationId, messages }, { signal: new AbortController().signal });
    await waitFor(() => balances()['computer-requester'].held === 0, { label: 'hold release after reconciliation' });
    receipt.lostAcknowledgment = { ...lost,
      reconciliation: { queried: 'provider generation journal, by the original request identity',
        first: { status: first.status, content: first.content ?? null, correct: first.content === ANSWER, charge: first.serviceCredit?.charge ?? null },
        second: { status: second.status, charge: second.serviceCredit?.charge ?? null },
        ledgerEntriesAddedByFirst: entriesAfterFirst - entriesBeforeRecovery, ledgerEntriesAddedBySecond: journalEntries() - entriesAfterFirst,
        executionsAdded: Object.fromEntries(network.seats.map(seat => [seat.name, seat.executions - executionsBeforeLoss[seat.name]])),
        generatedTwice: network.seats.some(seat => seat.executions - executionsBeforeLoss[seat.name] > 1),
        chargedTwice: journalEntries() - entriesAfterFirst !== 0 } };

    // 8. A provider that never returns: stopped after its first token and not restarted. The hold stays through the
    // request deadline and the claim window, then is released with no charge. Last, because the ledger clock moves.
    let abandonedProvider = null;
    const abandoned = await attempt({ attemptId: 'provider-never-returns', threadId: 'thread-abandoned', ranked: true,
      onFirstDelta: async route => { abandonedProvider = name(route.providerIdentity); await network.stop(abandonedProvider); } });
    abandoned.stoppedProvider = abandonedProvider;
    abandoned.holdBeforeWindow = balances()['computer-requester'].held;
    const movedMs = network.passClaimWindow();
    abandoned.holdAfterWindow = balances()['computer-requester'].held;
    const expired = await requester.recover({ reservationId: abandoned.reservationId, messages }, { signal: new AbortController().signal });
    abandoned.afterWindow = { ledgerClockMovedMs: movedMs, claimWindowMs: credits.policy.wholeModelUnclaimedReleaseMs,
      status: expired.status, charge: expired.serviceCredit?.charge ?? null, reason: expired.serviceCredit?.reason ?? null };
    receipt.providerNeverReturns = abandoned;

    // 9. The ledger, and what still fails.
    const snapshot = credits.snapshot();
    receipt.ledger = { balances: balances(), journalEntries: snapshot.journal.length,
      sumOfBalances: snapshot.accounts.reduce((sum, row) => sum + row.balance, 0), openHolds: snapshot.accounts.reduce((sum, row) => sum + row.held, 0) };
    receipt.outcome = { wholeRequestAndRecoveryWorkTogether: receipt.distribution.verifiedAfterFill
      && receipt.healthyRankingOn.requesterSaw.correct === true && receipt.recovered.requesterSaw.correct === true
      && receipt.lostAcknowledgment.reconciliation.first.correct === true && !receipt.lostAcknowledgment.reconciliation.generatedTwice
      && !receipt.lostAcknowledgment.reconciliation.chargedTwice && receipt.ledger.openHolds === 0
      && receipt.providerNeverReturns.afterWindow.status === 'expired',
    recoveryMode: recovered.recovery };
    receipt.remaining = [
      'A provider that stops mid-answer keeps the requester\'s credit hold until it returns and signs failure evidence, or until the request deadline plus the policy\'s claim window passes. That window is opt-in: a ledger whose policy omits it still holds such credit indefinitely. A provider that finished the work but returns after the window is not paid for it.',
      'Recovery restarts generation on another provider after a fresh approval. It does not resume tokens, and nothing retries automatically.',
      'The requester notices a lost completion only when it gives up waiting (the mesh deadline is a fixed 300 s); this scenario gives up at once.',
      'The native fleet host does not yet pass coordinator ranking to the mesh, and cannot fill a missing model from peers; both are wired here only in the test network.',
      'Not established here: real inference, hardware speed, GPU buffer release, a physical network, the four-GPU qualification.'
    ];
    receipt.transportErrors = hub.errors().map(error => error.message);
  } finally {
    clearInterval(sampler);
    receipt.peakRssBytes = Math.max(peakRss, process.memoryUsage().rss);
    receipt.peakRssNote = 'One process hosts the coordinator, the requester and every provider.';
    await network.close();
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = await runNetworkJourney();
  const text = JSON.stringify(receipt, null, 2) + '\n';
  if (process.argv[2]) await fs.writeFile(process.argv[2], text); else process.stdout.write(text);
  process.exit(receipt.outcome?.wholeRequestAndRecoveryWorkTogether ? 0 : 1);
}
