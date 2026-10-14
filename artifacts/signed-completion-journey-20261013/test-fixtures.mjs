// Synthetic fixtures in the ordered shapes the application emits:
// summary v2 (packages/reploid/src/mesh/partitions/partition-summary.js:16-18), route stages
// (partition-contract.js:72-92), cleanup rows {partitionIndex,status,error} (partition-route-execution.js:57-77),
// ordered Send authorization (packages/reploid/src/chat/workspace.js:198-199, thread-grants.js:23-24).
import { buildTimingRecord } from './timing.mjs';
import { orderedSelectionId } from './config.mjs';
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };

const hash = digit => 'sha256:' + String(digit).repeat(64);
export const PEERS = Object.freeze({ mac: 'peer:' + 'a'.repeat(24), amd: 'peer:' + 'b'.repeat(24), intel: 'peer:' + 'c'.repeat(24),
  requester: 'peer:' + 'd'.repeat(24), tabA: 'peer:' + 'e'.repeat(24), tabB: 'peer:' + 'f'.repeat(24), tabR: 'peer:' + '9'.repeat(24) });
export const freeze = Object.freeze({
  browserBundle: hash(1), runtimeArchive: hash(2), modelId: 'qwen-3-5-0-8b-q4k-ehaf16', modelIdentity: hash(3), planId: hash(4),
  planSchema: 'doppler.layer-partition-contract/v3', splitLayers: [8, 16],
  nativeArtifacts: { 'amd-host': hash(5), 'intel-host': hash(6) },
  route: [
    { index: 0, machine: 'mac-host', host: 'browser', participantId: PEERS.mac },
    { index: 1, machine: 'amd-host', host: 'native', participantId: PEERS.amd, orderedConfig: '/srv/reploid/stage-1.json' },
    { index: 2, machine: 'intel-host', host: 'native', participantId: PEERS.intel, orderedConfig: '/srv/reploid/stage-2.json' }
  ]
});
export const selectionId = orderedSelectionId(freeze);
export const THREE = [PEERS.mac, PEERS.amd, PEERS.intel];

export function routeOf(participants = THREE) {
  return { schema: 'reploid.partition-route/v1', modelId: freeze.modelId, modelIdentity: freeze.modelIdentity, planId: freeze.planId,
    stages: participants.map((participantId, index) => ({ index, participantId, transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `execution-${index}` })),
    activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 1024, precision: 'f32', components: 1, elementStrideBytes: 4 } };
}
export function receipt({ attemptId, participants = THREE, phase = 'completed', rows = null }) {
  return { identity: { attemptId }, phase, failure: phase === 'completed' ? null : 'failure recorded',
    reservations: participants.map((_, partitionIndex) => ({ partitionIndex, status: 'reserved' })),
    cleanup: rows ?? participants.map((_, partitionIndex) => ({ partitionIndex, status: 'settled', error: null })),
    cleanupSettledAt: rows?.some(row => row.status !== 'settled') ? null : 1760000000000 };
}
export function summary({ attemptId, threadId, requester = PEERS.requester, participants = THREE, steps = 4 }) {
  const route = routeOf(participants);
  return { schema: 'reploid.mesh.partition-summary/v2',
    identity: { schema: 'reploid.partition-attempt/v2', threadId, attemptId, requesterId: requester, placementGeneration: 0, route },
    activationBytes: 98304, stopReason: 'eos-token', settlement: receipt({ attemptId, participants }),
    stepSummary: { count: steps, stages: participants.map((_, partitionIndex) => ({ partitionIndex, steps, stepMs: { count: steps, total: 12.5 * (partitionIndex + 1) } })),
      detail: 'aggregate; no per-step trace transferred' }, selection: { transportId: 'transport-0' } };
}
export function authorization(route, requester) {
  return { kind: 'once', grantId: null, peerId: route.stages[0].participantId, recipientIdentity: route.stages[0].participantId,
    disclosure: 'ordered-partition-activations-and-tokens', planId: route.planId, route: structuredClone(route), requesterIdentity: requester,
    modelId: freeze.modelId, modelIdentity: freeze.modelIdentity, adapterIdentities: [], sharingScope: 'mesh', source: 'send', expiresAt: 1760000900000 };
}
export function attempt({ id, threadId, requester = PEERS.requester, status = 'completed', retryOf = null, error = null, request = undefined }) {
  const execution = summary({ attemptId: id, threadId, requester });
  return { id, threadId, userMessageId: `u-${id}`, responseId: `r-${id}`, retryOf, status, createdAt: 1760000000000, finishedAt: 1760000004000,
    error, approval: null, execution, authorization: authorization(execution.identity.route, requester), ...(request ? { request } : {}) };
}
export const model = Object.freeze({ id: freeze.modelId, name: 'Qwen 3.5 0.8B', identity: freeze.modelIdentity,
  partition: { schema: 'reploid.partition-selection/v2', planId: freeze.planId, coordinatorId: PEERS.mac, route: routeOf() } });
export function conversation(id, turns) {
  const thread = { id, model: structuredClone(model), attempts: [], messages: [] };
  for (const turn of turns) {
    thread.attempts.push(turn.attempt);
    thread.messages.push({ id: turn.attempt.userMessageId, role: 'user', content: turn.question, status: 'completed' },
      { id: turn.attempt.responseId, attemptId: turn.attempt.id, role: 'assistant', status: turn.responseStatus ?? turn.attempt.status, content: turn.answer });
  }
  return thread;
}
export const custody = () => ({ state: { receivedBytes: 0, verifiedFiles: [], pending: 0, preparing: false, sharing: false }, receipts: [] });
const count = n => Array.from({ length: n }, (_, index) => index + 1).join('\n');
const sample = (attemptId, content, status = 'executing') => ({ at: '2026-10-13T12:00:01.000Z', attemptId, messageId: `r-${attemptId}`, status, content, renderedText: content });
const SENT = '2026-10-13T12:00:00.000Z';

export function journeyReport(fixture) {
  const firstAnswer = 'function doubleEvens(numbers) { return numbers.filter(n => n % 2 === 0).map(n => n * 2); }\n[4, 8]';
  const a1 = attempt({ id: 'a1', threadId: 't1' });
  const a2 = attempt({ id: 'a2', threadId: 't1', request: { messages: [{ role: 'user', content: fixture.questions[0] },
    { role: 'assistant', content: firstAnswer }, { role: 'user', content: fixture.questions[1] }] } });
  const first = conversation('t1', [{ attempt: a1, question: fixture.questions[0], answer: firstAnswer }]);
  const second = conversation('t1', [{ attempt: a1, question: fixture.questions[0], answer: firstAnswer }, { attempt: a2, question: fixture.questions[1], answer: '[-4, 12]' }]);
  const observed = { threads: [second], runningIds: [] };
  const projection = [{ id: 't1', modelIdentity: freeze.modelIdentity, messages: second.messages, attempts: second.attempts }];
  const stopped = { ...attempt({ id: 'ac', threadId: 'tc', requester: PEERS.tabA, status: 'cancelled', error: 'Response stopped' }) };
  stopped.execution = { placement: 'ordered-layer-partition', identity: stopped.execution.identity, stepSummary: stopped.execution.stepSummary };
  const cancelThread = conversation('tc', [{ attempt: stopped, question: fixture.concurrency.cancelPrompt, answer: count(11) }]);
  const survivor = attempt({ id: 'as', threadId: 'ts', requester: PEERS.tabB });
  const survivorThread = conversation('ts', [{ attempt: survivor, question: fixture.concurrency.survivorPrompt, answer: count(20) }]);
  const interrupted = { ...attempt({ id: 'af', threadId: 'tr', requester: PEERS.tabR, status: 'interrupted', error: 'Connection interrupted. Retry starts a new attempt.' }) };
  const failedThread = conversation('tr', [{ attempt: interrupted, question: fixture.retry.prompt, answer: count(9) }]);
  const retried = attempt({ id: 'ar', threadId: 'tr', requester: PEERS.tabR, retryOf: 'af' });
  const finalRetry = structuredClone(failedThread);
  finalRetry.attempts.push(retried);
  finalRetry.messages.push({ id: 'r-ar', attemptId: 'ar', role: 'assistant', status: 'completed', content: count(60) });
  const streamSamples = [sample('a1', 'function double'), sample('a2', '[-4, 12]', 'completed'), sample('ar', count(3))];
  const tabSamples = [sample('as', count(20), 'completed')];
  const timing = [
    buildTimingRecord({ thread: first, attemptId: 'a1', samples: streamSamples, sentAt: SENT, pollMs: 100 }),
    buildTimingRecord({ thread: second, attemptId: 'a2', samples: streamSamples, sentAt: SENT, pollMs: 100 }),
    buildTimingRecord({ thread: survivorThread, attemptId: 'as', samples: tabSamples, sentAt: SENT, pollMs: 100 }),
    buildTimingRecord({ thread: finalRetry, attemptId: 'ar', samples: streamSamples, sentAt: SENT, pollMs: 100 })
  ];
  return {
    open: { servedDescriptor: freeze.browserBundle, ready: true, initialState: { threads: [] }, orderedParticipation: { stage: null },
      network: { sharing: false, contribution: { phase: 'idle', offering: false } } },
    modelChoice: { selectedValue: selectionId },
    turns: [first, second], weights: [], custodyBefore: custody(), custodyAfter: custody(), custodyAfterReload: custody(),
    streamSamples, copy: { messageId: 'r-a1', clipboardText: firstAnswer },
    beforeReload: observed, restoredState: structuredClone(observed), restoration: { draft: fixture.draft },
    returnSamples: [0, 1].map(() => ({ runningIds: [], history: structuredClone(projection) })), returnObservationMs: 3000,
    // Independent requesters are separate browser profiles (README, "Contract decision").
    concurrency: { servedLimit: 2, pairedSamples: [{ at: SENT, statuses: ['executing', 'queued'] }, { at: SENT, statuses: ['executing', 'executing'] }], tabs: [
      { role: 'cancel', profile: 'concurrent-0', profileDirectory: 'reploid-journey-profile-aaaaaa', requesterPeerId: PEERS.tabA, attemptId: 'ac', threadId: 'tc',
        contentAtStop: count(7), final: cancelThread, samples: [{ status: 'executing' }, { status: 'cancelling' }, { status: 'cancelled' }], custodyAfter: custody() },
      { role: 'survivor', profile: 'concurrent-1', profileDirectory: 'reploid-journey-profile-bbbbbb', requesterPeerId: PEERS.tabB, attemptId: 'as', threadId: 'ts',
        final: survivorThread, samples: [{ status: 'executing' }, { status: 'completed' }], streamSamples: tabSamples, custodyAfter: custody() }] },
    retry: { failedAttemptId: 'af', contentBeforeFailure: count(8), failed: failedThread, final: finalRetry, custodyAfter: custody(),
      returnSamples: [0, 1].map(() => ({ runningIds: [], attemptCount: 1 })) },
    coordinator: { receipts: [receipt({ attemptId: 'ac', phase: 'cancelled' }), receipt({ attemptId: 'af', phase: 'cancelled' }), receipt({ attemptId: 'a1' })] },
    timing
  };
}

export const FAILURE = failureMessages;

export function lossReport(fixture) {
  const partial = count(12);
  const failed = { ...attempt({ id: 'al', threadId: 'tl', status: 'failed', error: FAILURE.CONNECTION_LOST }) };
  failed.execution = { placement: 'ordered-layer-partition', identity: failed.execution.identity, stepSummary: failed.execution.stepSummary };
  const beforeLoss = conversation('tl', [{ attempt: { ...structuredClone(failed), status: 'executing', error: null }, question: fixture.prompt, answer: count(6), responseStatus: 'streaming' }]);
  const failedThread = conversation('tl', [{ attempt: failed, question: fixture.prompt, answer: partial }]);
  const retried = attempt({ id: 'ar2', threadId: 'tl', retryOf: 'al' });
  const final = structuredClone(failedThread);
  final.attempts.push(retried);
  final.messages.push({ id: 'r-ar2', attemptId: 'ar2', role: 'assistant', status: 'completed', content: count(500) });
  const still = { status: 'failed', content: partial, attemptIds: ['al'], runningIds: [] };
  return {
    lossTarget: { machine: 'amd-host', stage: 1, participantId: PEERS.amd }, failedAttemptId: 'al', beforeLoss, failed: failedThread,
    stop: { method: 'operator callback: stop native participant', stoppedAt: '2026-10-13T12:00:05.000Z', detail: null },
    terminalSamples: [{ at: '2026-10-13T12:00:09.000Z', ...still }],
    postFailureSamples: [0, 1, 2].map(index => ({ at: `2026-10-13T12:00:1${index}.000Z`, ...still })), postFailureObservationMs: 5000,
    renderedFailure: { status: fixture.expectedLossLabel, technical: FAILURE.CONNECTION_LOST },
    coordinatorReceipt: receipt({ attemptId: 'al', phase: 'cleanup-failed', rows: [{ partitionIndex: 0, status: 'settled', error: null },
      { partitionIndex: 1, status: 'unknown', error: FAILURE.CONNECTION_LOST }, { partitionIndex: 2, status: 'settled', error: null }] }),
    restore: { method: 'operator callback: restart native participant', restoredAt: '2026-10-13T12:01:00.000Z', detail: null },
    preRetrySamples: [0, 1].map(() => ({ ...still })), capacityReturned: true, capacityReturnedAt: '2026-10-13T12:02:00.000Z',
    retry: { clickedAt: '2026-10-13T12:02:01.000Z', final, samples: [] },
    weights: [], custodyBefore: custody(), custodyAfter: custody(),
    timing: [buildTimingRecord({ thread: final, attemptId: 'ar2', samples: [sample('ar2', count(2))], sentAt: SENT, pollMs: 100 })]
  };
}

const REFUSAL = 'Another tab owns this peer connection'; // self/host/work-peer-offers.js:21
const piece = digit => ({ path: `piece-${String(digit).repeat(64)}.bin`, role: 'model-weights', sizeBytes: 4194304, hashAlgorithm: 'sha256', hash: String(digit).repeat(64) });
const metadata = [{ path: 'manifest.json', role: 'model-manifest', sizeBytes: 214203, hashAlgorithm: 'sha256', hash: '7'.repeat(64) }];
const MiB = 1048576;
export function contributionReport() {
  const chatAttempt = attempt({ id: 'aw', threadId: 'tw' });
  const chat = conversation('tw', [{ attempt: chatAttempt, question: 'count', answer: count(200) }]);
  const stopAttempt = attempt({ id: 'ax', threadId: 'tx' });
  const stopChat = conversation('tx', [{ attempt: stopAttempt, question: 'count', answer: count(200) }]);
  const budget = (reservedBytes, maxBytes = 5 * MiB) => ({ maxBytes, reservedBytes });
  return {
    share: { machine: 'mac-host', mode: 'bounded-acquisition', allowanceBytes: 5 * MiB, transportId: 'transport-sharer',
      offered: [...metadata, piece(8)],
      files: { mode: 'bounded-acquisition', sharing: true, error: '', preparing: false, stopping: false, pending: 0,
        acquisitionBudget: budget(4442765), limits: { subsetBytes: 64 * MiB } },
      samples: [{ attemptStatus: 'executing', filesPreparing: true, filesSharing: false }, { attemptStatus: 'executing', filesPreparing: false, filesSharing: true },
        { attemptStatus: 'completed', filesPreparing: false, filesSharing: true }],
      chat: { attemptId: 'aw', final: chat } },
    peer: { supplier: { machine: 'mac-host', transportId: 'transport-sharer', suppliedBytesBefore: 0, suppliedBytesAfter: 4194304 },
      acquirer: { machine: 'intel-host', weightRequests: [], receipts: [{ transferId: 'x1', source: 'peer', receivedBytes: 4194304, reservedBytes: 4194304,
        attempts: [{ peerId: 'transport-sharer', status: 'accepted' }], completed: [{ artifactId: piece(8).path, hash: 'sha256:' + piece(8).hash, sizeBytes: 4194304 }] }] } },
    reload: { tab: 'supplier-cached', profilePages: 1, before: { offered: [piece(8)], budget: budget(4442765) },
      after: { mode: 'cached-only', offered: [piece(8)], budget: budget(4442765), requests: [] } },
    // Two tabs of one profile: the owner acquires, the second is refused by the single-owner lock.
    contention: { allowanceBytes: 5 * MiB, ledgerBefore: null, ledgerSamples: [budget(214203), budget(4442765)], ledgerAfter: budget(4442765),
      owner: { name: 'contention-0', profile: 'contention', consumerPeerId: PEERS.tabA, budget: budget(4442765), outcome: { sharing: true, error: '' },
        transfers: [{ key: 'manifest', bytes: 214203, finished: true }, { key: 'index', bytes: 34258, finished: true }, { key: 'piece-0', bytes: 4194304, finished: true }] },
      second: { name: 'contention-1', profile: 'contention', refusal: REFUSAL, ledgerAfter: budget(4442765), transfers: [],
        fileAttempt: { clickedAt: '2026-10-13T12:00:02.000Z', harnessError: null },
        samples: [{ phase: 'opened', error: null }, { phase: 'opened', error: REFUSAL }, { phase: 'after-start', error: REFUSAL }, { phase: 'after-acquisition', error: REFUSAL }]
          .map(row => ({ at: '2026-10-13T12:00:01.000Z', consumerPeerId: null, custodyOwner: false, filesSharing: false, filesPreparing: false, ...row })) } },
    // A 4 MiB piece aborted by the reload, charged when interrupted and again when resumed.
    interruption: { minimumInFlightBytes: MiB, ledgerBefore: null, ledgerFinal: budget(12831373, 13 * MiB), reloadAt: '2026-10-13T12:00:03.010Z',
      inFlightAtReload: { key: 'piece-1', bytes: 4194304, weight: true, startedAt: '2026-10-13T12:00:03.000Z', outcome: 'aborted',
        failure: 'net::ERR_ABORTED', finishedAt: '2026-10-13T12:00:03.020Z' },
      completedBefore: [{ key: 'manifest', bytes: 214203 }, { key: 'index', bytes: 34258 }, { key: 'piece-0', bytes: 4194304 }],
      completedDuringInterruption: [], unattributed: [],
      interrupted: [{ key: 'piece-1', bytes: 4194304 }], resumed: [{ key: 'piece-1', bytes: 4194304, finished: true }],
      final: { sharing: true, error: '', offered: [piece(8), piece(9)] } },
    // One tab of the sharer profile at a time: the sharer tab closed, then the next tab connected normally.
    cachedOnly: { mode: 'cached-only',
      sharer: { name: 'supplier-main', peerId: PEERS.tabA, offered: [...metadata, piece(8)], budget: budget(4442765), closedAt: '2026-10-13T12:01:00.000Z' },
      tab: { name: 'supplier-cached', openedAt: '2026-10-13T12:01:00.100Z', profilePages: 1, lockSamples: [
        { at: '2026-10-13T12:01:01.000Z', consumerPeerId: null, error: null, custodyOwner: false, filesSharing: false, filesPreparing: false },
        { at: '2026-10-13T12:01:02.000Z', consumerPeerId: PEERS.tabA, error: null, custodyOwner: true, filesSharing: false, filesPreparing: false }] },
      files: { mode: 'cached-only', sharing: true, pending: 0 }, offered: [...metadata, piece(8)], requests: [], receiptsBefore: 0, receiptsAfter: 0,
      budgetBefore: budget(4442765), budgetAfter: budget(4442765), observationMs: 3000,
      samples: [0, 1, 2].map(index => ({ at: `2026-10-13T12:01:0${5 + index}.000Z`, pending: 0, preparing: false, sharing: true })),
      window: { openedAt: '2026-10-13T12:01:00.100Z', startedAt: '2026-10-13T12:01:03.000Z', outcomeAt: '2026-10-13T12:01:04.000Z', endedAt: '2026-10-13T12:01:07.100Z' } },
    stop: { inFlightAtStop: { filesPreparing: true, pendingRequests: 1 }, budgetBefore: budget(4442765), budgetAfter: budget(4442765),
      filesAfter: { sharing: false, preparing: false, stopping: false, pending: 0 }, requestsAfterSettled: 0,
      stopClickedAt: '2026-10-13T12:00:05.000Z', chat: { attemptId: 'ax', final: stopChat,
        samples: [{ at: '2026-10-13T12:00:04.000Z', attemptStatus: 'executing' }, { at: '2026-10-13T12:00:09.000Z', attemptStatus: 'completed' }] } }
  };
}
