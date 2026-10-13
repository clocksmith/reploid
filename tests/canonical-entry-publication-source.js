// CPU entry-protocol control: real data-channel framing over in-memory channels;
// publication store is injected here (real signed/IndexedDB owner tested separately).
import assert from 'node:assert/strict';
import { createPartitionEntry } from '../packages/reploid/src/mesh/partitions/partition-entry.js';
import { createEntryPublicationScope } from '../packages/reploid/src/mesh/partitions/partition-entry-publication.js';
const epoch = '0'.repeat(32), hash = 'sha256:' + 'a'.repeat(64);
const request = { schema: 'reploid.partition-input/v2', operation: 'generate', meshId: 'mesh', requesterId: 'q', participantA: 'a', participantB: 'b',
  modelId: 'm', modelIdentity: hash, planId: hash, threadId: 'thread', attemptId: 'attempt', placementGeneration: 0,
  messages: [{ role: 'user', content: 'question' }] };
const context = { schema: 'reploid.partition-publication-context/v1', publisherEpoch: epoch, coordinatorEpoch: epoch, routeId: hash,
  generation: { generationId: hash, executionIdentity: hash, policy: { maxGeneratedTokens: 2 } }, vocabSize: 100, deadlineAt: Date.now() + 60000,
  stages: [0, 1].map(i => ({ stageId: 'sha256:' + String(i).repeat(64), participantId: i ? 'b' : 'a', participantEpoch: epoch,
    deviceEpoch: epoch, residentId: 'r' + i, partitionIndex: i, executionId: hash })) };
request.canonical = context;
const identity = { schema: 'doppler.resident-attempt/v2', attemptId: request.attemptId, requesterId: 'q', inputDigest: hash,
  authorizationScope: hash, routeId: hash, generationId: hash, coordinatorEpoch: epoch, publisherEpoch: epoch, routeKind: 'two-stage-layer', stages: context.stages };
const admission = { identity, generationPolicy: context.generation.policy, executionIdentity: hash, vocabSize: 100, deadlineAt: context.deadlineAt };
const publication = { schema: 'doppler.execution-publication/v2', attemptId: 'attempt', coordinatorEpoch: epoch, sequence: 0,
  successor: { terminal: true }, delta: { text: 'saved' }, publicationDigest: hash };
const receipt = { schema: 'reploid.publication-receipt/v1', conversationId: 'thread', writerEpoch: epoch, index: 0,
  coordinatorEpoch: epoch, attemptId: 'attempt', sequence: 0, publicationDigest: hash, receiptDigest: hash };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function owner() {
  const events = [], records = []; let allowed = true;
  const port = { requiresCommitEvidence: true,
    async reconcile() { events.push('head'); return { head: records.at(-1)?.publication.publicationDigest ?? null,
      attempts: [{ identity: { attemptId: 'unrelated', coordinatorEpoch: epoch } }], records: ['private unrelated history'] }; },
    async admitAttempt(value) { events.push('admit'); return { identity: value.identity, status: 'live' }; },
    async publish(value, options) { events.push('stored'); records.push(structuredClone({ publication: value, evidence: options.evidence, receipt })); return receipt; },
    async cancel() { events.push('cancel'); return { status: 'cancelled', head: hash }; } };
  return { port, records, events, revoke() { allowed = false; }, authorize: () => allowed };
}
{
  const f = owner(), scope = createEntryPublicationScope({ request, owner: f.port, authorize: f.authorize, maxControlBytes: 65536, maxOutputCharacters: 8192,
    onPublished: async record => { assert.equal(f.records.length, 1); f.events.push('visible'); assert.deepEqual(record.receipt, receipt); } });
  assert.deepEqual(await scope.call('head', {}), { head: null, attempts: [] });
  await scope.call('admit', admission);
  assert.deepEqual(await scope.call('publish', { publication, evidence: [] }), receipt);
  assert.deepEqual(f.events, ['head', 'admit', 'stored', 'visible']);
  const changed = structuredClone(admission); changed.identity.publisherEpoch = '1'.repeat(32);
  await assert.rejects(scope.call('admit', changed));
  await assert.rejects(scope.call('cancel', { attemptId: 'unrelated', coordinatorEpoch: epoch }));
  f.revoke(); await assert.rejects(scope.call('publish', { publication, evidence: [] }));
}
const scopeOptions = f => ({ request, owner: f.port, authorize: f.authorize, onPublished: async () => {},
  maxControlBytes: 65536, maxOutputCharacters: 8192 });
{
  const f = owner(), entered = deferred(), gate = deferred();
  let visible = 0;
  const scope = createEntryPublicationScope({ ...scopeOptions(f), onPublished: async () => { visible++; },
    authorize: async method => { if (method === 'admit') { entered.resolve(); await gate.promise; } return true; } });
  const mutable = structuredClone(admission), operation = scope.call('admit', mutable);
  await entered.promise; mutable.identity.publisherEpoch = '1'.repeat(32); gate.resolve(); await operation;
  await Promise.all([scope.call('publish', { publication, evidence: [] }), scope.call('publish', { publication, evidence: [] })]);
  assert.equal(visible, 1, 'Same durable record projected once even if RPC is duplicated');
  assert.equal(scope.getProjection().content, 'saved');
  await scope.close(); await assert.rejects(scope.call('head', {}), /closed or revoked/);
}
{
  const f = owner(), entered = deferred(), gate = deferred();
  let cancelled = 0;
  f.port.admitAttempt = async value => { entered.resolve(); await gate.promise; return { identity: value.identity }; };
  f.port.cancel = async () => { if (++cancelled === 1) throw Error('storage unavailable'); return { status: 'cancelled' }; };
  const scope = createEntryPublicationScope(scopeOptions(f));
  const admitting = scope.call('admit', admission); await entered.promise;
  const rejected = assert.rejects(admitting, /closed or revoked/);
  const closing = scope.close({ cancel: true }); gate.resolve();
  await rejected; await assert.rejects(closing, /storage unavailable/);
  await scope.close({ cancel: true }); assert.equal(cancelled, 2, 'Failed cleanup retains explicit retry');
}
{
  const f = owner(), scope = createEntryPublicationScope(scopeOptions(f));
  await scope.call('admit', admission);
  f.port.publish = async () => { throw Error('unknown transaction outcome'); };
  await assert.rejects(scope.call('publish', { publication, evidence: [] }), /unknown transaction/);
  assert.deepEqual(scope.getProjection(), { content: '', count: 0, terminal: false });
  await scope.close({ cancel: true }); assert(f.events.includes('cancel'));
}
{
  const f = owner(), entered = deferred(), gate = deferred();
  let visible = false;
  f.port.publish = async () => { entered.resolve(); await gate.promise; return receipt; };
  const scope = createEntryPublicationScope({ ...scopeOptions(f), onPublished: () => { visible = true; } });
  await scope.call('admit', admission);
  const operation = scope.call('publish', { publication, evidence: [] }); await entered.promise;
  const rejected = assert.rejects(operation, /closed or revoked/);
  f.revoke(); gate.resolve(); await rejected; assert.equal(visible, false);
  await scope.close({ cancel: true });
}
async function roundtrip({ corruptFinal = false, missingCapability = false, failCancel = false, nonterminal = false } = {}) {
const channels = [new EventTarget(), new EventTarget()];
channels.forEach((channel, i) => Object.assign(channel, { readyState: 'open', ordered: true, maxRetransmits: null,
  maxPacketLifeTime: null, bufferedAmount: 0, send(data) { queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => channels[1 - i].close()); } }));
const limits = { maxFrameBytes: 1024, maxControlBytes: 65536, maxPayloadBytes: 4096, maxPendingBytes: 16384,
  maxPendingRequests: 16, maxRequestsPerChannel: 128, maxBufferedBytes: 131072, maxTransferBytes: 1048576, timeoutMs: 3000 };
const inputLimits = { maxInputCharacters: 8192, maxOutputCharacters: 8192, maxAttempts: 8, maxConcurrentAttempts: 2, descriptorTtlMs: 10000 };
const f = owner(), projected = [], model = { id: 'm', identity: hash, availability: 'ready', partition: { planId: hash, participantA: 'a', participantB: 'b' }, canonical: context };
let cancelCalls = 0;
if (failCancel) f.port.cancel = async () => { f.events.push('cancel'); if (++cancelCalls === 1) throw Error('cancel storage failure'); return { status: 'cancelled' }; };
const service = { getModels: () => [model], async refresh() {}, async generate(input, controls) {
  assert(controls.publication.requiresCommitEvidence);
  assert.deepEqual(await controls.publication.reconcile(), { head: null, attempts: [] });
  await controls.publication.admitAttempt(admission);
  await controls.publication.publish(nonterminal ? { ...publication, successor: { terminal: false } } : publication, { evidence: [] });
  return { content: corruptFinal ? 'invented' : 'saved', execution: { ...request, schema: 'reploid.mesh.canonical-partition-execution/v1', publications: [{ publication, receipt }], settlement: { phase: 'completed' } } };
} };
const entries = [createPartitionEntry({ channel: channels[0], localParticipantId: 'q', remoteParticipantId: 'a', canonical: !missingCapability, authorize: async () => true, limits, inputLimits }),
  createPartitionEntry({ channel: channels[1], localParticipantId: 'a', remoteParticipantId: 'q', canonical: true, service, authorize: async () => true, limits, inputLimits })];
try {
  await entries[0].refresh();
  const running = entries[0].generate(request, { publication: f.port, onPublished: async record => projected.push(record),
    onDelta: () => { throw Error('Canonical route must never emit an unbound raw delta'); } });
  if (corruptFinal || nonterminal || missingCapability) {
    await assert.rejects(running, failCancel ? /publication cancellation failed/ : (corruptFinal || nonterminal) ? /differs from durable publication/ : /capability unavailable/);
    assert.equal(f.records.length, (corruptFinal || nonterminal) ? 1 : 0);
    if (corruptFinal) assert(f.events.includes('cancel'));
    if (failCancel) assert.equal(entries[0].getState().ready, false, 'Unsettled storage ownership fences entry');
    return;
  }
  const result = await running;
  assert.equal(result.execution.publications, undefined, 'Final control frame must not retransmit signed history');
  assert.equal(result.content, 'saved'); assert.equal(projected.length, 1);
  assert.deepEqual(projected[0].publication, publication); assert.deepEqual(projected[0].receipt, receipt);
  assert.equal(f.records.length, 1);
} finally {
  const settled = await Promise.allSettled(entries.map(entry => entry.close()));
  assert(settled.every(row => row.status === 'fulfilled'));
  if (failCancel) assert.equal(cancelCalls, 2, 'Entry retains failed transaction cleanup for explicit retry');
}
}
await roundtrip(); await roundtrip({ corruptFinal: true }); await roundtrip({ corruptFinal: true, failCancel: true }); await roundtrip({ missingCapability: true }); await roundtrip({ nonterminal: true });
console.log('entry publication: existing duplex framing, requester-owned storage before projection, exact attempt scope and no unrelated history disclosure pass');
