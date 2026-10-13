// The actual host session uses transactional history and real signed publication.
// Numerical steps are injected; this is not a GPU acceptance claim.
import assert from 'node:assert/strict';
import { createChatSession } from '../self/host/chat-session.js';
import { openCanonicalWorkspaceHistory } from '../packages/reploid/src/chat/workspace-history.js';
import { verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
import { fixture, runtime, plan, planId, hash, epoch } from './canonical-runner-fixture.js';
let state = null, tail = Promise.resolve(), authorize = () => false;
const f = await fixture({ observedPublications: () => state?.publications['thread-a']?.records ?? [] });
const store = { schema: 'reploid.transactional-chat-store/v1', async read() { await tail; return structuredClone(state); },
  transact(key, reducer) {
    const operation = tail.then(() => { const result = reducer(structuredClone(state)); state = structuredClone(result.state); return result.result; });
    tail = operation.catch(() => {}); return operation;
  } };
const options = { store, key: 'workspace', meshId: 'mesh', participantId: 'requester', writerEpoch: epoch, expectedWriterEpoch: null,
  legacy: { workspace: null, drafts: '{"new":{"text":"old unsent draft","files":[]}}' }, maxWorkspaceBytes: 1000000, maxThreads: 8,
  publicationOptions: () => ({ doppler: runtime,
    authorize: scope => ['writer', 'read', 'replay'].includes(scope.action) || authorize(scope),
    authenticateCommit: (acknowledgment, stage, attempt, evidence) => verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) }) };
const history = await openCanonicalWorkspaceHistory(options);
const model = { id: plan.modelId, identity: hash, name: 'fixture', provider: 'doppler', adapters: [],
  canonical: true, partition: { planId, participantA: f.devices[0].id, participantB: f.devices[1].id } };
let calls = 0;
const partitions = { getModels: () => [model], subscribe: () => () => {},
  async generate(request, controls) {
    calls++;
    assert(!authorize({ conversationId: request.threadId, writerEpoch: epoch, action: 'admit', attempt: f.input.canonical.attempt }), 'Send alone does not bypass exact disclosure');
    assert(await controls.requestApproval({ id: 'preview', peerId: f.devices[0].id, recipientIdentity: f.devices[0].id,
      threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity,
      adapterIdentities: [], operation: 'generate-partition', disclosure: 'partition-activations-and-tokens', planId,
      participantA: f.devices[0].id, participantB: f.devices[1].id,
      input: { recipients: [f.devices[0].id, f.devices[1].id] }, expiresAt: Date.now() + 60000 }));
    assert(authorize({ conversationId: request.threadId, writerEpoch: epoch, action: 'admit', attempt: f.input.canonical.attempt }));
    assert(!authorize({ conversationId: request.threadId, writerEpoch: epoch, action: 'admit',
      attempt: { ...f.input.canonical.attempt, stages: [...f.input.canonical.attempt.stages].reverse() } }));
    const publication = { ...controls.publication, async publish(value, { evidence }) {
      const receipt = await controls.publication.publish(value, { evidence });
      await controls.onPublished({ publication: value, receipt, evidence }); return receipt;
    } };
    const result = await f.runner.executeCanonical({ ...f.input, canonical: { ...f.input.canonical, publication },
      signal: controls.signal, onDelta: () => {} });
    return { ...result, threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: hash, adapterIdentities: [] };
  } };
const ids = ['thread-a', 'user', 'a', 'response', 'grant'];
const session = createChatSession({ storage: { getItem() { throw Error('legacy storage must not be read/written'); } },
  meshId: 'mesh', participantId: 'requester', models: [model], partitions, canonicalHistory: history,
  bindPublicationAuthorization: fn => { authorize = fn; }, id: () => ids.shift() });
assert.equal(session.getDraft(null).text, 'old unsent draft');
await session.saveDraft(null, { text: 'new unsent draft', files: [] });
assert.equal(JSON.parse(state.drafts).new.text, 'new unsent draft'); assert.equal(state.legacy.drafts, options.legacy.drafts);
const thread = await session.createThread({ model });
let approval;
const entered = new Promise(resolve => { approval = resolve; });
const unsubscribe = session.subscribe(value => { if (value.activeThread?.attempts.at(-1)?.status === 'approval') approval(value.activeThread.attempts.at(-1)); });
const completing = session.send(thread, 'question');
const pending = await entered;
assert.equal(pending.ephemeral, true); assert.equal(pending.persistedStatus, 'queued');
await session.approve(thread, pending.id, pending.approval.id, true, { remember: true });
assert.equal((await completing).status, 'completed');
assert.equal(session.getState().activeThread.messages.at(-1).content, '34');
await session.revokeGrant(thread, 'grant'); unsubscribe();
await session.close();
assert.equal(calls, 1);
authorize = () => false;
const reopenedHistory = await openCanonicalWorkspaceHistory({ ...options, writerEpoch: '1'.repeat(32), expectedWriterEpoch: epoch });
const reopened = createChatSession({ storage: null, meshId: 'mesh', participantId: 'requester', models: [model], partitions,
  canonicalHistory: reopenedHistory, bindPublicationAuthorization: fn => { authorize = fn; } });
assert.equal(reopened.getState().threads[0].messages.at(-1).content, '34'); assert.equal(calls, 1);
assert.equal(reopened.getDraft(null).text, 'new unsent draft');
assert.equal(reopened.getState().threads[0].grants[0].revokedAt !== null, true);
await reopened.close(); await f.runner.close();
console.log('actual host session: saved approval, stage recipient binding, durable drafts, actual signed output, revoked-grant history reopen without dispatch pass');
