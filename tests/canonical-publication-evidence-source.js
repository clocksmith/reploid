// CPU source integration: real target transitions/signatures, transactional store
// fault injection. No physical GPU, IndexedDB browser, or application claim.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createConversationPublication } from '../packages/reploid/src/chat/workspace-publication.js';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { createPartitionStageCommitAuthority, verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
const root = process.env.DOPPLER_SOURCE_ROOT;
assert(root, 'Explicit source checkout required');
const runtime = await import(pathToFileURL(root + '/src/partitions.js'));
const { createResidentTargetState } = await import(pathToFileURL(root + '/src/inference/resident-target-state.js'));
const { createResidentOutputState } = await import(pathToFileURL(root + '/src/inference/resident-output-state.js'));
const { createBundledIncrementalDecoder } = await import(pathToFileURL(root + '/src/inference/tokenizers/bundled/incremental-decoder.js'));
const policy = JSON.parse(await readFile(root + '/tests/fixtures/canonical-generation-policy.json', 'utf8'));
const hash = 'sha256:' + 'a'.repeat(64), epoch = '0'.repeat(32);
const keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
const stages = keys.map((key, i) => ({ stageId: 'sha256:' + String(i).repeat(64), participantId: key.peerId,
  participantEpoch: epoch, deviceEpoch: epoch, residentId: 'resident' + i, partitionIndex: i, executionId: hash }));
const generation = runtime.canonicalGenerationIdentity(policy, hash, 100);
const attempt = { schema: 'doppler.resident-attempt/v2', attemptId: 'attempt', requesterId: 'requester',
  inputDigest: runtime.tokenDigest([1, 2], 100, 64), authorizationScope: hash, routeId: hash,
  generationId: generation.generationId, coordinatorEpoch: epoch, publisherEpoch: epoch, routeKind: 'two-stage-layer', stages };
const decoder = () => createBundledIncrementalDecoder({ tokenForId: id => String(id), byteLevel: false,
  byteDecoder: new Map(), wordPiece: false, splitEveryCharacter: false, wordPiecePrefix: '##' });
const target = createResidentTargetState([1, 2], policy, 100, generation.generationId,
  createResidentOutputState(decoder(), decoder(), policy, 100));
const logits = new Float32Array(100).fill(-Infinity); logits[3] = 0;
const transition = target.bootstrap(logits);
const authorities = keys.map((identity, i) => createPartitionStageCommitAuthority({ runtime, identity, stage: stages[i] }));
const commits = await Promise.all(authorities.map(a => a.sign({ attempt, sequence: 0, baseCursorId: null, transition })));
const body = { schema: 'doppler.execution-publication/v2', attemptId: attempt.attemptId, coordinatorEpoch: epoch,
  attemptDigest: runtime.residentAttemptDigest(attempt), sequence: 0, expectedRevision: null, previousPublicationDigest: null,
  baseCursorId: null, decisionId: commits[0].acknowledgment.decisionId, acceptedTokenIds: transition.acceptedTokenIds,
  tokenRange: transition.tokenRange, successor: transition.successor, delta: { text: transition.delta, outputDigest: transition.outputDigest },
  stoppingOutcome: transition.successor.stopReason, acknowledgments: commits.map(c => c.acknowledgment) };
const publication = { ...body, publicationDigest: runtime.metadataDigest(body.schema, body) };
const evidence = commits.map(c => c.evidence);
const authenticate = (acknowledgment, stage, attempt, evidence) =>
  verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(extra = {}) {
  let durable = null, queue = Promise.resolve(), fail = null, allowed = true;
  const store = { schema: 'reploid.transactional-chat-store/v1',
    async read() { await queue; return structuredClone(durable); },
    transact(key, reduce) {
      const result = queue.then(() => {
        const next = reduce(structuredClone(durable)), fault = fail; fail = null;
        if (fault === 'before') throw Error('storage before commit');
        durable = structuredClone(next.state);
        if (fault === 'after') throw Error('storage completion unknown');
        return structuredClone(next.result);
      }); queue = result.catch(() => {}); return result;
    } };
  const options = { conversationId: 'thread', writerEpoch: epoch, store, doppler: runtime,
    requireCommitEvidence: true, authenticateCommit: authenticate, authorize: () => allowed, now: () => 1, ...extra };
  const owner = createConversationPublication(options);
  return { owner, options, store, fail: value => { fail = value; }, revoke: () => { allowed = false; },
    corrupt: mutate => mutate(durable),
    async start() { await owner.claimWriter(null); await owner.admitAttempt({ identity: attempt, generationPolicy: policy,
      executionIdentity: hash, vocabSize: 100, deadlineAt: 100 }); } };
}
{
  const f = fixture(); await f.start();
  await assert.rejects(f.owner.publish(publication), /evidence/i, 'first publication needs durable signed evidence');
  assert.equal((await f.owner.readPublished(-1)).length, 0);
  const receipt = await f.owner.publish(publication, { evidence });
  const records = await f.owner.readPublished(-1);
  assert.deepEqual(records[0].evidence, evidence);
  assert.equal(records[0].evidenceDigest, runtime.metadataDigest('reploid.publication-evidence/v1', evidence));
  const restarted = createConversationPublication({ ...f.options, requireCommitEvidence: false });
  assert.deepEqual(await restarted.publish(publication), receipt, 'restart authenticates retained evidence without an ephemeral lookup');
  assert.deepEqual((await restarted.reconcile()).records[0].evidence, evidence);
  await assert.rejects(restarted.publish(publication, { evidence: [evidence[1], evidence[1]] }), /evidence/i);
  f.revoke(); await assert.rejects(restarted.readPublished(-1), /revoked/);
}
for (const invalid of [null, {}, [], [evidence[0]], [evidence[1], evidence[1]], [evidence[0], { ...evidence[1], signature: 'bad' }]]) {
  const f = fixture(); await f.start();
  await assert.rejects(f.owner.publish(publication, { evidence: invalid }), /evidence|Unauthenticated/i);
  assert.equal((await f.owner.readPublished(-1)).length, 0);
}
{
  const entered = deferred(), release = deferred();
  const f = fixture({ authenticateCommit: async (...args) => { entered.resolve(); await release.promise; return authenticate(...args); } });
  await f.start(); const input = structuredClone(publication), proofs = structuredClone(evidence);
  const pending = f.owner.publish(input, { evidence: proofs }); await entered.promise;
  input.delta.text = 'mutated'; proofs[0].signature = 'mutated'; release.resolve();
  await pending; const [saved] = await f.owner.readPublished(-1);
  assert.deepEqual(saved.publication, publication); assert.deepEqual(saved.evidence, evidence);
}
for (const fault of ['before', 'after']) {
  const f = fixture(); await f.start(); f.fail(fault);
  await assert.rejects(f.owner.publish(publication, { evidence }), /storage/);
  await assert.rejects(f.owner.readPublished(-1), /fenced/);
  const restored = await f.owner.reconcile(); assert.equal(restored.records.length, fault === 'after' ? 1 : 0);
  const receipt = await f.owner.publish(publication, fault === 'after' ? undefined : { evidence });
  assert.equal(receipt.index, 0); assert.deepEqual((await f.owner.readPublished(-1))[0].evidence, evidence);
}
for (const mutate of [h => { delete h.records[0].evidence; }, h => { h.records[0].evidence[0].signature = 'bad'; },
  h => { h.records[0].evidenceDigest = hash; }, h => { h.records[0].publication.delta.text = 'corrupt'; }]) {
  const f = fixture(); await f.start(); await f.owner.publish(publication, { evidence }); f.corrupt(mutate);
  const restarted = createConversationPublication({ ...f.options, requireCommitEvidence: false });
  await assert.rejects(restarted.readPublished(-1)); await assert.rejects(restarted.reconcile());
}
for (const action of ['cancel', 'takeover', 'revoke']) {
  const entered = deferred(), release = deferred();
  const f = fixture({ authenticateCommit: async (...args) => { entered.resolve(); await release.promise; return authenticate(...args); } });
  await f.start(); const pending = f.owner.publish(publication, { evidence }); await entered.promise;
  if (action === 'cancel') await f.owner.cancel(attempt.attemptId, epoch);
  if (action === 'takeover') await createConversationPublication({ ...f.options, writerEpoch: '1'.repeat(32) }).claimWriter(epoch);
  if (action === 'revoke') f.revoke();
  release.resolve(); await assert.rejects(pending, /cancelled|Stale|revoked/);
  assert.equal((await f.store.read()).records.length, 0);
}
{
  const f = fixture(); await f.start();
  const [a, b] = await Promise.all([f.owner.publish(publication, { evidence }),
    f.owner.publish(publication, { evidence: [...evidence].reverse() })]);
  assert.deepEqual(a, b); assert.equal((await f.owner.readPublished(-1)).length, 1);
}
{
  const f = fixture(); await f.start();
  const forged = structuredClone(publication), proofs = structuredClone(evidence);
  proofs[0].signature = 'AAAA';
  forged.acknowledgments[0].authenticationDigest = runtime.metadataDigest(proofs[0].schema, proofs[0]);
  const { publicationDigest, ...changed } = forged;
  forged.publicationDigest = runtime.metadataDigest(forged.schema, changed);
  await assert.rejects(f.owner.publish(forged, { evidence: proofs }), /Unauthenticated/,
    'matching evidence and publication hashes cannot replace genuine signature verification');
}
{
  const zeroPolicy = { ...policy, maxGeneratedTokens: 0 };
  const zero = runtime.canonicalGenerationIdentity(zeroPolicy, hash, 100);
  const identity = { ...attempt, generationId: zero.generationId };
  const f = fixture({ authenticateCommit: async () => { throw Error('No fake GPU acknowledgment'); } });
  await f.owner.claimWriter(null);
  await f.owner.admitAttempt({ identity, generationPolicy: zeroPolicy, executionIdentity: hash, vocabSize: 100, deadlineAt: 100 });
  const body = { schema: 'doppler.admission-publication/v1', attemptId: identity.attemptId, coordinatorEpoch: epoch,
    attemptDigest: runtime.residentAttemptDigest(identity), sequence: 0, expectedRevision: null, previousPublicationDigest: null,
    result: runtime.admitResidentPrompt([1, 2], zeroPolicy, 100, zero.generationId) };
  const admitted = { ...body, publicationDigest: runtime.metadataDigest(body.schema, body) };
  await assert.rejects(f.owner.publish(admitted, { evidence }), /evidence/i);
  await f.owner.publish(admitted, { evidence: [] });
  const [record] = await f.owner.readPublished(-1); assert.deepEqual(record.evidence, []);
  assert.equal((await f.owner.reconcile()).attempts[0].status, 'completed');
}
console.log('durable evidence: actual transition/signatures, restart, corruption, snapshot races, cancellation/takeover/revocation, unknown commits pass');
