import assert from 'node:assert/strict';
import { createChatWorkspace } from '../packages/reploid/src/chat/workspace.js';
import { openCanonicalWorkspaceHistory } from '../packages/reploid/src/chat/workspace-history.js';
import { verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
import { fixture, runtime, plan, hash, epoch } from './canonical-runner-fixture.js';
async function check({ unknown = false, stale = false } = {}) {
  let state = null, tail = Promise.resolve(), fail = unknown, calls = 0;
  const f = await fixture({ observedPublications: () => state?.publications['thread-a']?.records ?? [] });
  const store = { schema: 'reploid.transactional-chat-store/v1', async read() { await tail; return structuredClone(state); },
    transact(key, reducer) {
      const pending = tail.then(() => { const next = reducer(structuredClone(state)); state = structuredClone(next.state);
        if (fail && Object.values(state.publications).some(history => history.records.length)) { fail = false; throw Error('unknown publication receipt'); }
        return structuredClone(next.result); }); tail = pending.catch(() => {}); return pending;
    } };
  const options = { store, key: 'workspace', meshId: 'mesh', participantId: 'requester', writerEpoch: epoch, expectedWriterEpoch: null,
    legacy: { workspace: null, drafts: null }, maxWorkspaceBytes: 1000000, maxThreads: 8,
    publicationOptions: () => ({ doppler: runtime, authorize: () => true,
      authenticateCommit: (acknowledgment, stage, attempt, evidence) => verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) }) };
  const history = await openCanonicalWorkspaceHistory(options), ids = [f.input.identity.threadId, 'user', f.input.identity.attemptId, 'response'];
  let controls;
  const workspace = createChatWorkspace({ meshId: 'mesh', participantId: 'requester', store: history,
    id: () => ids.shift(), async execute(request, actual) {
      calls++; controls = actual;
      const publication = { ...actual.publication, async publish(value, { evidence }) {
        const receipt = await actual.publication.publish(value, { evidence });
        await actual.onPublished({ publication: value, receipt, evidence }); return receipt;
      } };
      const result = await f.runner.executeCanonical({ ...f.input, canonical: { ...f.input.canonical, publication },
        signal: actual.signal, onDelta: () => {} });
      return { threadId: request.threadId, attemptId: request.attemptId, modelId: plan.modelId, modelIdentity: hash,
        adapterIdentities: [], content: result.content, execution: result.execution };
    } });
  const visible = []; workspace.subscribe(value => visible.push(value.threads[0]?.messages.at(-1)?.content ?? ''));
  const threadId = await workspace.createThread({ model: { id: plan.modelId, identity: hash, name: 'fixture' } });
  let replacement;
  if (stale) replacement = await openCanonicalWorkspaceHistory({ ...options, writerEpoch: '1'.repeat(32), expectedWriterEpoch: epoch });
  if (stale || unknown) {
    await assert.rejects(workspace.send(threadId, 'question'));
    assert(!visible.includes('3') && !visible.includes('34'), 'Unacknowledged or stale output never reaches UI');
    if (stale) assert.equal(calls, 0, 'Stale metadata writer cannot dispatch');
    await assert.rejects(workspace.close());
  } else {
    const attempt = await workspace.send(threadId, 'question');
    assert.equal(attempt.status, 'completed'); assert.equal(workspace.getState().threads[0].messages.at(-1).content, '34');
    assert.equal(state.workspace.threads[0].messages.at(-1).content, ''); await workspace.close();
  }
  await history.close(); await replacement?.close(); await f.runner.close();
}
await check(); await check({ unknown: true }); await check({ stale: true });
console.log('workspace: awaited transaction admission and saved-record projection, no raw output authority, stale writer and unknown-write refusal pass');
