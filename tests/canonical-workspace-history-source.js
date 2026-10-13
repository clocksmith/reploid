// CPU transaction-owner integration with actual Doppler publications and stage
// signatures. Inference is injected by the shared source fixture, never claimed.
import assert from 'node:assert/strict';
import { openCanonicalWorkspaceHistory } from '../packages/reploid/src/chat/workspace-history.js';
import { verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
import { fixture, runtime, hash, epoch } from './canonical-runner-fixture.js';
const f = await fixture(); await f.runner.executeCanonical(f.input); await f.runner.close();
const generated = f.state();
const oldThread = { id: 'old-thread', messages: [{ id: 'old-response', role: 'assistant', content: 'unchanged legacy answer', status: 'completed' }], attempts: [] };
const legacy = { workspace: JSON.stringify({ schema: 'reploid.chat-workspace/v1', meshId: 'mesh', participantId: 'requester', threads: [oldThread] }),
  drafts: '{ "old-thread": { "text": "unsent", "files": [] } }' };
let state = null, tail = Promise.resolve(), unknown = false, holdAuth = null, disclosureGranted = true;
const store = { schema: 'reploid.transactional-chat-store/v1', async read() { await tail; return structuredClone(state); },
  transact(key, reducer) {
    const next = tail.then(() => { const reduced = reducer(structuredClone(state)); state = structuredClone(reduced.state);
      if (unknown) { unknown = false; throw Error('lost transaction receipt'); } return structuredClone(reduced.result); });
    tail = next.catch(() => {}); return next;
  } };
const options = { store, key: 'workspace', meshId: 'mesh', participantId: 'requester', writerEpoch: epoch, expectedWriterEpoch: null,
  legacy, maxWorkspaceBytes: 1000000, maxThreads: 8, publicationOptions: () => ({ doppler: runtime,
    // Reading saved, authenticated local history is independent of current
    // permission to disclose another request or accept another publication.
    authorize: ({ action }) => ['writer', 'read', 'replay'].includes(action) || disclosureGranted,
    authenticateCommit: async (acknowledgment, stage, attempt, evidence) => {
      const gate = holdAuth; if (gate && acknowledgment.sequence === 0) { gate.enter(); await gate.promise; }
      return verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence });
    } }) };
const owner = await openCanonicalWorkspaceHistory(options);
assert.equal(owner.legacyDrafts, legacy.drafts); assert.deepEqual(owner.load().threads, [oldThread]);
assert.equal(state.legacy.workspace, legacy.workspace);
const snapshot = owner.load();
snapshot.threads.push({ id: f.input.identity.threadId, messages: [{ id: 'response', role: 'assistant', content: '', status: 'queued' }],
  attempts: [{ id: f.input.identity.attemptId, responseId: 'response', publicationMode: 'canonical', status: 'queued' }] });
await owner.save(snapshot);
const publisher = await owner.publication(f.input.identity.threadId);
await publisher.admitAttempt({ identity: f.input.canonical.attempt, generationPolicy: f.input.canonical.generation.policy,
  executionIdentity: hash, vocabSize: 100, deadlineAt: Date.now() + 60000 });
const first = generated.records[0], second = generated.records[1];
const receipt = await publisher.publish(first.publication, { evidence: first.evidence });
const projection = await owner.project(f.input.identity.threadId, f.input.identity.attemptId, { ...first, receipt });
assert.equal(projection.content, '3');
snapshot.threads[1].messages[0].content = projection.content;
await owner.save(snapshot);
assert.equal(state.workspace.threads[1].messages[0].content, '', 'Metadata cannot become a second authoritative output writer');
assert.equal(state.publications[f.input.identity.threadId].records[0].publication.delta.text, '3');
let release, enter;
const gatePromise = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
holdAuth = { promise: gatePromise, enter };
const oldProjection = owner.project(f.input.identity.threadId, f.input.identity.attemptId, { ...first, receipt });
await entered; holdAuth = null;
const secondReceipt = await publisher.publish(second.publication, { evidence: second.evidence });
assert.equal((await owner.project(f.input.identity.threadId, f.input.identity.attemptId, { ...second, receipt: secondReceipt })).content, '34');
const staleProjection = assert.rejects(oldProjection, /head changed/); release(); await staleProjection;
snapshot.threads[1].closed = true; await owner.save(snapshot);
assert.equal(state.workspace.threads[1].closed, true);
assert.equal((await owner.project(f.input.identity.threadId, f.input.identity.attemptId, { ...second, receipt: secondReceipt })).content, '34', 'Archive preserves published references');
unknown = true;
await assert.rejects(owner.save(snapshot), /lost transaction receipt/);
await assert.rejects(owner.project(f.input.identity.threadId, f.input.identity.attemptId, second), /unknown/);
assert.equal(state.publications[f.input.identity.threadId].records.length, 2, 'Unknown response does not erase actual durable output');
disclosureGranted = false;
const nextEpoch = '1'.repeat(32);
const reopened = await openCanonicalWorkspaceHistory({ ...options, writerEpoch: nextEpoch, expectedWriterEpoch: epoch,
  legacy: { workspace: null, drafts: 'changed source must not replace imported bytes' } });
assert.equal(reopened.legacyDrafts, legacy.drafts);
assert.equal(reopened.load().threads[1].messages[0].content, '34', 'Reopen hydrates exact verified records without execution');
await assert.rejects((await reopened.publication(f.input.identity.threadId)).publish(second.publication, { evidence: second.evidence }), /authority revoked/);
assert.deepEqual(reopened.load().threads[0], oldThread); assert.equal(state.legacy.workspace, legacy.workspace);
await assert.rejects(owner.assertCurrentWriter());
await assert.rejects(openCanonicalWorkspaceHistory({ ...options, writerEpoch: '2'.repeat(32), expectedWriterEpoch: epoch }), /raced/);
const bad = reopened.load(); bad.threads.splice(1, 1);
await assert.rejects(reopened.save(bad), /removed or downgraded/);
await owner.close(); await reopened.close();
console.log('workspace history: exact legacy import, shared writer CAS, signed record hydration, single output authority, unknown-commit fencing and stale-writer refusal pass');
