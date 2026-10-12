// Cross-repository source contract integration. This never loads or changes the
// accepted application archive, and is not package or physical qualification.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createConversationPublication } from '../packages/reploid/src/chat/workspace-publication.js';
const root = process.env.DOPPLER_SOURCE_ROOT;
assert(root, 'Set DOPPLER_SOURCE_ROOT to the explicitly selected development checkout');
const doppler = await import(pathToFileURL(root + '/src/partitions.js'));
const generationPolicy = JSON.parse(await readFile(root + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
const hash = 'sha256:' + 'a'.repeat(64), other = 'sha256:' + 'b'.repeat(64), epoch = '0'.repeat(32);
const generation = doppler.canonicalGenerationIdentity(generationPolicy, hash, 100);
const stage = { stageId: hash, participantId: 'p', participantEpoch: epoch, deviceEpoch: epoch, residentId: 'r', partitionIndex: 0, executionId: hash };
const identity = { schema: 'doppler.resident-attempt/v2', attemptId: 'a', requesterId: 'q', inputDigest: hash, authorizationScope: hash,
  routeId: hash, generationId: generation.generationId, coordinatorEpoch: epoch, publisherEpoch: epoch,
  routeKind: 'two-stage-layer', stages: [stage, { ...stage, stageId: other, partitionIndex: 1 }] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  let durable = null, queue = Promise.resolve(), failure = null, allowed = true;
  const store = { schema: 'reploid.transactional-chat-store/v1',
    async read() { await queue; return structuredClone(durable); },
    transact(key, reducer) {
      const task = queue.then(() => {
        const { state, result } = reducer(structuredClone(durable));
        const fail = failure; failure = null;
        if (fail === 'before') throw Error('injected storage failure');
        durable = structuredClone(state);
        if (fail === 'after') throw Error('unknown storage completion');
        return structuredClone(result);
      });
      queue = task.catch(() => {}); return task;
    } };
  const options = { conversationId: 'thread', writerEpoch: epoch, store, doppler,
    authenticateCommit: async () => true, authorize: () => allowed, now: () => 10, ...overrides };
  const owner = createConversationPublication(options);
  return { owner, options, store, fail: value => { failure = value; }, revoke: () => { allowed = false; },
    async start(attempt = identity) {
      await owner.claimWriter(null);
      await owner.admitAttempt({ identity: attempt, generationPolicy, executionIdentity: hash, vocabSize: 100, deadlineAt: 1000 });
    } };
}
function publication(attempt = identity, previous = null) {
  const base = previous?.successor ?? null;
  const decision = base ? doppler.decideResidentBlock(base, [1, 2], [], [4], [false], generationPolicy, 100) : {
    acceptedTokenIds: [3], tokenRange: { start: 0, end: 1 }, successor: doppler.bootstrapResidentCursor([1, 2], 3, generationPolicy, 100, generation.generationId) };
  const value = { schema: 'doppler.execution-publication/v2', attemptId: attempt.attemptId,
    coordinatorEpoch: attempt.coordinatorEpoch, attemptDigest: doppler.residentAttemptDigest(attempt), sequence: base ? 1 : 0,
    expectedRevision: base?.revision ?? null, baseCursorId: base?.cursorId ?? null, previousPublicationDigest: previous?.publicationDigest ?? null,
    acceptedTokenIds: decision.acceptedTokenIds, tokenRange: decision.tokenRange, successor: decision.successor,
    delta: { text: 'x', outputDigest: hash }, stoppingOutcome: decision.successor.stopReason };
  value.decisionId = doppler.residentPublicationDecisionDigest(value);
  value.acknowledgments = attempt.stages.map(item => ({ schema: 'doppler.stage-commit/v1', stageId: item.stageId,
    attemptDigest: value.attemptDigest, sequence: value.sequence, baseCursorId: value.baseCursorId,
    decisionId: value.decisionId, successorCursorId: value.successor.cursorId, participantEpoch: item.participantEpoch,
    deviceEpoch: item.deviceEpoch, residentId: item.residentId, authenticationDigest: hash }));
  return seal(value);
}
function seal(value) {
  const { publicationDigest, ...body } = value;
  return { ...body, publicationDigest: doppler.metadataDigest(body.schema, body) };
}
for (const attempt of [identity, { ...identity, routeKind: 'whole-request', stages: [stage] }]) {
  const f = fixture(); await f.start(attempt);
  const first = publication(attempt), receipt = await f.owner.publish(first);
  assert.deepEqual(await f.owner.publish(first), receipt);
  const changed = structuredClone(first); changed.delta.text = 'forged';
  await assert.rejects(f.owner.publish(seal(changed)), /collision/);
  const second = publication(attempt, first);
  await f.owner.publish(second);
  assert.equal((await f.owner.readPublished(-1)).length, 2);
  assert.equal((await f.owner.readPublished(0)).length, 1);
  await f.owner.cancel(attempt.attemptId, epoch);
  assert.deepEqual(await f.owner.publish(first), receipt, 'committed output survives later cancellation');
  f.revoke(); await assert.rejects(f.owner.publish(first), /revoked/);
  await assert.rejects(f.owner.readPublished(-1), /revoked/);
}
{
  const auth = deferred(), entered = deferred();
  const f = fixture({ authenticateCommit: async () => { entered.resolve(); await auth.promise; return true; } });
  await f.start();
  const publish = f.owner.publish(publication()); await entered.promise;
  await f.owner.cancel('a', epoch); auth.resolve();
  await assert.rejects(publish, /cancelled/);
  assert.equal((await f.owner.readPublished(-1)).length, 0);
}
for (const failure of ['before', 'after']) {
  const f = fixture(); await f.start(); const first = publication(); f.fail(failure);
  await assert.rejects(f.owner.publish(first), /storage/);
  await assert.rejects(f.owner.readPublished(-1), /fenced/);
  await assert.rejects(f.owner.publish(first), /fenced/);
  const history = await f.owner.reconcile();
  assert.equal(history.records.length, failure === 'after' ? 1 : 0);
  const receipt = await f.owner.publish(first);
  assert.equal(receipt.index, 0);
  assert.equal((await f.owner.readPublished(-1)).length, 1, 'reconciliation never regenerates or duplicates');
}
{
  let replay = true;
  const f = fixture({ authorize: ({ action }) => action !== 'replay' || replay }); await f.start();
  await f.owner.publish(publication()); replay = false;
  await assert.rejects(f.owner.readPublished(-1), /revoked/);
  await assert.rejects(f.owner.reconcile(), /revoked/, 'reconciliation cannot bypass output replay permission');
}
{
  const f = fixture({ authenticateCommit: async () => false }); await f.start();
  await assert.rejects(f.owner.publish(publication()), /Unauthenticated/);
  assert.equal((await f.owner.reconcile()).records.length, 0);
}
{
  const f = fixture(); await f.start();
  const secondOwner = createConversationPublication({ ...f.options, writerEpoch: '1'.repeat(32) });
  await secondOwner.claimWriter(epoch);
  await assert.rejects(f.owner.publish(publication()), /Stale/);
  const state = await secondOwner.reconcile(); assert.equal(state.attempts[0].status, 'interrupted');
}
{
  const f = fixture({ policy: { maxAttempts: 1, maxPublications: 1 } }); await f.start();
  await f.owner.publish(publication());
  await assert.rejects(f.owner.publish(publication(identity, publication())), /full/);
  await f.owner.cancel('a', epoch);
  await assert.rejects(f.owner.admitAttempt({ identity: { ...identity, attemptId: 'new' }, generationPolicy,
    executionIdentity: hash, vocabSize: 100, deadlineAt: 1000 }), /full/);
}
for (const policy of [{ ...generationPolicy, maxGeneratedTokens: 0 }, { ...generationPolicy, totalAcceptedTokenLimit: 2 }]) {
  const f = fixture({ authenticateCommit: async () => { throw Error('Admission has no execution acknowledgments'); } });
  const { generationId } = doppler.canonicalGenerationIdentity(policy, hash, 100);
  const attempt = { ...identity, generationId };
  await f.owner.claimWriter(null);
  await f.owner.admitAttempt({ identity: attempt, generationPolicy: policy, executionIdentity: hash, vocabSize: 100, deadlineAt: 1000 });
  const value = seal({ schema: 'doppler.admission-publication/v1', attemptId: attempt.attemptId, coordinatorEpoch: epoch,
    attemptDigest: doppler.residentAttemptDigest(attempt), sequence: 0, expectedRevision: null, previousPublicationDigest: null,
    result: doppler.admitResidentPrompt([1, 2], policy, 100, generationId) });
  const receipt = await f.owner.publish(value);
  assert.deepEqual(await f.owner.publish(value), receipt);
  const saved = await f.owner.reconcile();
  assert.equal(saved.attempts[0].status, 'completed'); assert.equal(saved.attempts[0].cursor, null);
  assert.equal(saved.records[0].publication.result.acceptedTokenIds.length, 0);
}
console.log('canonical publication source integration: route/empty outcomes, duplicates, cancellation, unknown writes, takeover, revocation and retention passed');
