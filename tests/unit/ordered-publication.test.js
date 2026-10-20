import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionEntry } from '../../packages/reploid/src/mesh/partitions/partition-entry.js';
import { canonicalPartitionJson } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { orderedPublicationAttempt, orderedGenerationBounds, orderedPublicationRecord }
  from '../../packages/reploid/src/mesh/partitions/partition-ordered-publication.js';
import { createChatWorkspace, openCanonicalWorkspaceHistory, createConversationPublication } from '../../packages/reploid/src/chat/index.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';

// Requester-owned transactional publication of a three-stage ordinary ordered
// route. Stage computation is injected; this proves coordination, durable
// ordering and recovery, not GPU execution or numerical acceptance.
const metadataDigest = (schema, body) => 'sha256:' + createHash('sha256')
  .update(schema + '\0' + canonicalPartitionJson(body)).digest('hex');
const requesterId = 'peer:' + 'e'.repeat(24);
const [epochA, epochB, epochC] = ['1', '2', '3'].map(c => c.repeat(32));
const channelLimits = { maxFrameBytes: 65536, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384,
  maxPendingRequests: 8, maxRequestsPerChannel: 256, maxBufferedBytes: 262144, maxTransferBytes: 4194304, timeoutMs: 10000 };
const inputLimits = { maxInputCharacters: 4096, maxOutputCharacters: 100, maxAttempts: 20, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 };

it('persists whole-model streams alongside ordered history without inventing publication records', async () => {
  const store = memoryStore();
  const options = { store, key: 'workspace', meshId: 'mesh', participantId: requesterId,
    writerEpoch: epochA, expectedWriterEpoch: null, legacy: { workspace: null, drafts: null },
    maxWorkspaceBytes: 1048576, maxThreads: 8, allowWholeModel: true,
    publicationOptions: () => { throw Error('Whole model must not open partition publication'); } };
  const history = await openCanonicalWorkspaceHistory(options);
  const model = { id: 'whole', name: 'Whole model', identity: 'sha256:' + 'a'.repeat(64) };
  const execute = async (request, controls) => {
    const envelope = { threadId: request.threadId, attemptId: request.attemptId };
    expect(controls.publication).toBeUndefined();
    controls.onDelta({ ...envelope, sequence: 0, text: 'Forty ' });
    controls.onDelta({ ...envelope, sequence: 1, text: 'two' });
    if (request.messages.at(-1).content === 'Cancel this') await new Promise((resolve, reject) => {
      controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true });
    });
    return { ...envelope, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Forty two' };
  };
  const workspace = createChatWorkspace({ meshId: 'mesh', participantId: requesterId, store: history, execute });
  const id = await workspace.createThread({ model, permissions: { sharingScope: 'local' } });
  expect((await workspace.send(id, 'Question')).status).toBe('completed');
  expect((await workspace.send(id, 'Follow up')).status).toBe('completed');
  const cancellation = workspace.send(id, 'Cancel this');
  await vi.waitFor(() => {
    expect(workspace.getState().threads[0].attempts).toHaveLength(3);
    expect(workspace.getState().threads[0].messages.at(-1).content).toBe('Forty two');
  });
  await workspace.cancel(id);
  expect((await cancellation).status).toBe('cancelled');
  const snapshot = workspace.getState().threads;
  expect(snapshot[0].attempts.every(attempt => attempt.publicationMode === 'whole-model')).toBe(true);
  expect(store.durable.get('workspace').publications).toEqual({});
  // Inspect current durable metadata for rejection tests.
  const invalid = structuredClone(store.durable.get('workspace').workspace);
  invalid.threads[0].model.partition = { schema: 'reploid.partition-selection/v2' };
  await expect(history.save(invalid)).rejects.toThrow('New attempts require canonical publication');
  const downgrade = structuredClone(store.durable.get('workspace').workspace);
  downgrade.threads[0].attempts[0].publicationMode = 'canonical';
  await expect(history.save(downgrade)).rejects.toThrow('Attempt publication mode cannot change');
  await workspace.close(); await history.close();
  const reopened = await openCanonicalWorkspaceHistory({ ...options, writerEpoch: epochB, expectedWriterEpoch: epochA });
  expect(reopened.load().threads).toEqual(snapshot);
  await reopened.close();
});

function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
    maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); } }));
  return pair;
}

/** Serialized transactional store. `hook(prior, next)` sees each transaction's
 * would-be state first and returns: 'before' (fail, nothing written), 'after'
 * (written, acknowledgment lost) or a function run after the write, before the
 * acknowledgment. A reducer that throws writes nothing, as in IndexedDB. */
function memoryStore() {
  const durable = new Map();
  let tail = Promise.resolve();
  const store = { schema: 'reploid.transactional-chat-store/v1', durable, hook: null,
    async read(key) { await tail; return structuredClone(durable.get(key) ?? null); },
    transact(key, reducer) {
      const task = tail.then(async () => {
        let peek = null;
        try { peek = reducer(structuredClone(durable.get(key) ?? null)).state; } catch {}
        const mode = store.hook ? await store.hook(structuredClone(durable.get(key) ?? null), peek) : undefined;
        const next = reducer(structuredClone(durable.get(key) ?? null));
        if (mode === 'before') throw Error('injected storage failure before commit');
        durable.set(key, structuredClone(next.state));
        if (mode === 'after') throw Error('storage acknowledgment lost after commit');
        if (typeof mode === 'function') await mode();
        return structuredClone(next.result);
      });
      tail = task.catch(() => {}); return task;
    } };
  return store;
}
const publications = (state, threadId) => state?.publications?.[threadId] ?? { records: [], attempts: [] };
const records = (store, threadId, attemptId) => publications(store.durable.get('workspace'), threadId).records
  .filter(record => attemptId === undefined || record.publication.attemptId === attemptId);
const text = rows => rows.map(row => row.publication.delta.text).join('');
const added = (prior, next, threadId) => {
  const before = publications(prior, threadId).records.length, after = publications(next, threadId).records;
  return after.length > before ? after.at(-1).publication : null;
};

async function coordinator() {
  const f = routeFixture(3), signer = await createSigningIdentity({ algorithm: 'ECDSA' });
  const ids = [signer.peerId, 'peer:' + 'a'.repeat(24), 'peer:' + 'b'.repeat(24)];
  ids.forEach((id, index) => { f.route.stages[index].participantId = id; f.stages[index].id = id; });
  f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }),
    subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: f.route.modelIdentity, tokenIds: [1, 2], generation: f.request.generation }));
  f.runtime.metadataDigest = metadataDigest;
  const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 50, maxTtlMs: 60000 });
  const chat = createPartitionChat({ runtime: f.runtime, model: { id: 'model', name: 'Fixture', identity: f.route.modelIdentity },
    authority, plan: f.plan, planId: f.route.planId, limits: f.limits, grantTtlMs: 60000,
    ordered: { route: f.route, stages: f.stages }, authorizeRequester: async () => true });
  return { f, signer, authority, chat, async close() { await Promise.allSettled([chat.close(), f.runner.close()]); authority.close(); } };
}

/** One requester application lifetime: transactional history, workspace and a
 * fresh authenticated entry channel to the coordinator. Reopening is a reload. */
// These controls pin per-step commit (a declared window of zero steps); the coalesced window is covered below.
const perStep = { maxAttempts: 64, maxPublications: 4096, persistence: { maxUnsavedSteps: 0, maxUnsavedMs: 0 } };
async function requester(c, store, { writerEpoch = epochA, expectedWriterEpoch = null, service = c.chat, policy = perStep } = {}) {
  let authorizeExecution = () => false;
  const history = await openCanonicalWorkspaceHistory({ store, key: 'workspace', meshId: 'mesh', participantId: requesterId,
    writerEpoch, expectedWriterEpoch, legacy: { workspace: null, drafts: null }, maxWorkspaceBytes: 1000000, maxThreads: 8,
    // Only a digest port: ordered publication needs no canonical Doppler validators,
    // and an ordered record carries no stage commitment to authenticate.
    publicationOptions: () => ({ doppler: { metadataDigest }, authenticateCommit: async () => false, policy,
      authorize: scope => ['writer', 'read', 'replay'].includes(scope.action) || authorizeExecution(scope) === true }) });
  const pair = channels();
  const server = createPartitionEntry({ channel: pair[1], localParticipantId: c.signer.peerId, remoteParticipantId: requesterId,
    service, ordered: true, authorize: async () => true, limits: channelLimits, inputLimits });
  const client = createPartitionEntry({ channel: pair[0], localParticipantId: requesterId, remoteParticipantId: c.signer.peerId,
    ordered: true, authorize: async () => true, limits: channelLimits, inputLimits });
  const projected = [], deltas = [], writerErrors = [];
  // Records the requester writer's own rejection reasons; the coordinator only
  // sees the channel's generic refusal.
  const observed = owner => Object.freeze(Object.fromEntries(Object.entries(owner).map(([key, value]) => [key,
    typeof value !== 'function' ? value : async (...args) => {
      try { return await value(...args); } catch (error) { writerErrors.push(`${key}: ${error.message}`); throw error; }
    }])));
  // Requester side of the ordered route, as the automatic requester composes it.
  const execute = vi.fn(async (request, controls) => {
    const route = request.model.partition.route, coordinatorId = route.stages[0].participantId;
    const binding = { schema: 'reploid.partition-attempt/v2', route, requesterId, threadId: request.threadId,
      attemptId: request.attemptId, placementGeneration: 0 };
    const disclosure = orderedPartitionDisclosure(binding), expiresAt = Date.now() + 60000;
    const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
      operation: 'generate-partition', peerId: coordinatorId, recipientIdentity: coordinatorId, ...structuredClone(request.model.partition),
      modelId: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [], disclosure, expiresAt,
      input: { messages: request.messages, recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
    if (approved !== true) throw Error('Ordered disclosure declined');
    await client.refresh({ signal: controls.signal });
    controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing',
      execution: { placement: 'ordered-layer-partition', identity: binding } });
    const result = await client.generate({ meshId: 'mesh', modelId: request.model.id, modelIdentity: request.model.identity,
      planId: route.planId, route, coordinatorId, threadId: request.threadId, attemptId: request.attemptId, placementGeneration: 0,
      disclosureExpiresAt: expiresAt, messages: request.messages,
      publication: { schema: 'reploid.ordered-publication-context/v1', publisherEpoch: controls.publisherEpoch, deadlineAt: expiresAt } },
    { signal: controls.signal, publication: observed(controls.publication), onDelta: delta => deltas.push(delta),
      onPublished: async record => { projected.push(record.receipt.publicationDigest); return controls.onPublished(record); } });
    return { ...result, threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
      modelIdentity: request.model.identity, adapterIdentities: [] };
  });
  const workspace = createChatWorkspace({ meshId: 'mesh', participantId: requesterId, requesterIdentity: () => requesterId,
    store: history, execute });
  authorizeExecution = workspace.authorizePublication;
  const thread = () => workspace.getState().threads[0];
  // Transactional state shows only durable history: wait for the restore save
  // that marks unfinished attempts interrupted.
  await vi.waitFor(() => expect(workspace.getState().threads.flatMap(row => row.attempts)
    .some(row => ['queued', 'loading', 'executing', 'approval', 'cancelling'].includes(row.status))).toBe(false));
  return { history, workspace, client, server, execute, projected, deltas, writerErrors, thread,
    attempt: () => thread().attempts.at(-1), response: () => thread().messages.at(-1),
    send: (threadId, content = 'Hello') => workspace.send(threadId, content, { authorizeDisclosure: () => true }),
    async newThread() {
      return workspace.createThread({ model: c.chat.getModels()[0], permissions: { sharingScope: 'approved-partition-path' } });
    },
    async close() {
      await Promise.allSettled([workspace.close(), client.close(), server.close()]);
      await history.close();
    } };
}

async function opened(policy = perStep) {
  const c = await coordinator(), store = memoryStore(), r = await requester(c, store, { policy });
  const threadId = await r.newThread();
  const owners = [r];
  return { c, store, r, threadId, owners,
    async reload(options = {}) {
      const next = await requester(c, store, { policy, ...options }); owners.push(next); return next;
    },
    async close() { for (const owner of owners) await owner.close(); await c.close(); } };
}

describe('three-stage ordered route publishing through the requester-owned transactional writer', () => {
  it('commits every final-stage step durably before its text is visible and before the next step runs', async () => {
    const t = await opened(), log = [], visible = [];
    try {
      t.c.f.stages.forEach((stage, index) => {
        const run = stage.executeStage.getMockImplementation();
        stage.executeStage.mockImplementation(async args => { log.push(['execute', index, args.step]); return run(args); });
      });
      t.store.hook = (prior, next) => {
        const record = added(prior, next, t.threadId);
        return record ? () => log.push(['commit', record.sequence]) : undefined;
      };
      t.r.workspace.subscribe(state => {
        const message = state.threads[0]?.messages.at(-1);
        if (message?.role === 'assistant') visible.push([message.content, text(records(t.store, t.threadId, message.attemptId))]);
      });
      const attempt = await t.r.send(t.threadId);
      expect(attempt.error).toBeNull();
      expect(attempt.status).toBe('completed');
      expect(t.r.response()).toMatchObject({ content: '012', status: 'completed' });
      const rows = records(t.store, t.threadId, attempt.id);
      expect(rows.map(row => row.publication.sequence)).toEqual([0, 1, 2]);
      expect(rows.every(row => row.publication.schema === 'reploid.ordered-publication/v1'
        && row.publication.acknowledgments.length === 0 && row.evidence.length === 0)).toBe(true);
      expect(rows.at(-1).publication.successor).toMatchObject({ terminal: true, stopReason: 'eos', outputCharacters: 3 });
      expect(rows[0].publication.previousPublicationDigest).toBeNull();
      expect(rows.slice(1).map(row => row.publication.previousPublicationDigest)).toEqual(rows.slice(0, 2).map(row => row.publication.publicationDigest));
      const saved = t.store.durable.get('workspace');
      expect(saved.workspace.threads[0].messages.at(-1).content).toBe('');
      expect(publications(saved, t.threadId).attempts[0]).toMatchObject({ status: 'completed', nextSequence: 3,
        identity: { schema: 'reploid.ordered-publication-attempt/v1', requesterId, route: t.c.f.route } });
      expect(t.r.response().publicationDigests).toEqual(rows.map(row => row.publication.publicationDigest));
      // Visible text never exceeds what the requester's store has committed.
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every(([shown, committed]) => committed.startsWith(shown))).toBe(true);
      for (const step of [0, 1]) {
        expect(log.findIndex(row => row[0] === 'commit' && row[1] === step))
          .toBeLessThan(log.findIndex(row => row[0] === 'execute' && row[1] === 0 && row[2] === step + 1));
      }
      expect(t.r.deltas).toEqual([]);
      expect(t.r.projected).toHaveLength(3);
      expect(t.c.f.stages.every(stage => stage.closeAttempt.mock.calls.length === 1)).toBe(true);
    } finally { await t.close(); }
  });

  it.each([['before', '0'], ['after', '01']])('a storage failure %s committing a step leaves no partial or duplicate history and retries after reload',
    async (mode, retained) => {
      const t = await opened();
      try {
        t.store.hook = (prior, next) => added(prior, next, t.threadId)?.sequence === 1 ? mode : undefined;
        await expect(t.r.send(t.threadId)).rejects.toThrow(/History storage failed|outcome is unknown/);
        expect(t.r.workspace.getState().storageError).toBeTruthy();
        const failed = t.r.attempt().id;
        expect(records(t.store, t.threadId, failed).map(row => row.publication.sequence)).toEqual(mode === 'before' ? [0] : [0, 1]);
        expect(t.c.f.stages.every(stage => stage.closeAttempt.mock.calls.length === 1)).toBe(true);
        t.store.hook = null;
        const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
        expect(reloaded.attempt()).toMatchObject({ id: failed, status: 'interrupted' });
        expect(reloaded.response().content).toBe(retained);
        expect(reloaded.execute).not.toHaveBeenCalled();
        const retry = await reloaded.workspace.retry(t.threadId, failed, { authorizeDisclosure: () => true });
        expect(retry).toMatchObject({ status: 'completed', retryOf: failed });
        expect(reloaded.response().content).toBe('012');
        expect(records(t.store, t.threadId, failed).map(row => row.publication.sequence)).toEqual(mode === 'before' ? [0] : [0, 1]);
        expect(records(t.store, t.threadId, retry.id).map(row => row.publication.sequence)).toEqual([0, 1, 2]);
        const keys = records(t.store, t.threadId).map(row => row.publication.attemptId + ':' + row.publication.sequence);
        expect(new Set(keys).size).toBe(keys.length);
        expect(publications(t.store.durable.get('workspace'), t.threadId).attempts.map(row => row.status)).toEqual(['interrupted', 'completed']);
      } finally { await t.close(); }
    });

  it('cancel arriving before the final commit rejects that record inside its transaction without fencing history', async () => {
    const t = await opened();
    try {
      t.store.hook = (prior, next) => {
        if (added(prior, next, t.threadId)?.sequence === 2) { t.store.hook = null; void t.r.workspace.cancel(t.threadId); }
      };
      const attempt = await t.r.send(t.threadId);
      expect(attempt.status).toBe('cancelled');
      expect(t.r.workspace.getState().storageError).toBeNull();
      expect(records(t.store, t.threadId, attempt.id).map(row => row.publication.sequence)).toEqual([0, 1]);
      expect(t.r.response()).toMatchObject({ content: '01', status: 'cancelled' });
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('cancelled');
      // Same session, no reload: the rejected transaction was a known outcome.
      const retry = await t.r.workspace.retry(t.threadId, attempt.id, { authorizeDisclosure: () => true });
      expect(retry.status).toBe('completed'); expect(t.r.response().content).toBe('012');
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.thread().attempts.map(row => row.status)).toEqual(['cancelled', 'completed']);
      expect(reloaded.thread().messages.filter(row => row.role === 'assistant').map(row => row.content)).toEqual(['01', '012']);
    } finally { await t.close(); }
  });

  it('cancel arriving during the final commit keeps the committed record once and settles the live view to it', async () => {
    const t = await opened();
    try {
      t.store.hook = (prior, next) => {
        if (added(prior, next, t.threadId)?.sequence !== 2) return undefined;
        t.store.hook = null;
        return () => { void t.r.workspace.cancel(t.threadId); };
      };
      const attempt = await t.r.send(t.threadId);
      // The stop request won the race against completion, but the writer never
      // rewrites a committed terminal record: the attempt is stopped, not cancelled.
      expect(attempt).toMatchObject({ status: 'failed', error: 'Response stopped' });
      expect(t.r.workspace.getState().storageError).toBeNull();
      const rows = records(t.store, t.threadId, attempt.id);
      expect(rows.map(row => row.publication.sequence)).toEqual([0, 1, 2]);
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('completed');
      expect(t.r.response()).toMatchObject({ content: '012', publicationDigests: rows.map(row => row.publication.publicationDigest) });
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.response().content).toBe('012'); expect(reloaded.attempt().status).toBe('failed');
      expect(records(t.store, t.threadId)).toHaveLength(3);
    } finally { await t.close(); }
  });

  it('cancel arriving after the final commit, while cleanup settles, changes no durable history', async () => {
    const t = await opened(), last = t.c.f.stages[2], close = last.closeAttempt.getMockImplementation();
    try {
      last.closeAttempt.mockImplementationOnce(async args => { void t.r.workspace.cancel(t.threadId); return close(args); });
      const attempt = await t.r.send(t.threadId);
      expect(attempt.status).toBe('failed');
      expect(records(t.store, t.threadId, attempt.id).map(row => row.publication.sequence)).toEqual([0, 1, 2]);
      expect(t.r.response().content).toBe('012');
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('completed');
      expect(t.r.workspace.getState().storageError).toBeNull();
      // After completion a stop request is a no-op.
      const second = await t.r.workspace.retry(t.threadId, attempt.id, { authorizeDisclosure: () => true });
      expect(second.status).toBe('completed');
      await t.r.workspace.cancel(t.threadId);
      expect(t.r.attempt().status).toBe('completed');
      expect(records(t.store, t.threadId)).toHaveLength(6);
    } finally { await t.close(); }
  });

  it('duplicate delivery of steps and of the final result publishes each record once and projects it once', async () => {
    const c = await coordinator(), store = memoryStore(), outcomes = [];
    const service = { getModels: () => c.chat.getModels(), refresh: options => c.chat.refresh(options),
      generate: (request, controls) => c.chat.generate(request, { ...controls, publication: { ...controls.publication,
        // A coordinator resending after an unacknowledged reply, plus a forged
        // record that reuses the final sequence with different output.
        async publish(value, options) {
          const first = await controls.publication.publish(value, options);
          const again = await controls.publication.publish(structuredClone(value), options);
          outcomes.push(canonicalPartitionJson(first) === canonicalPartitionJson(again));
          if (value.successor.terminal) {
            const { publicationDigest: _, ...body } = structuredClone(value);
            body.tokenId = 99; body.successor.pendingTokenId = 99; body.delta = { text: 'X' };
            await expect(controls.publication.publish({ ...body, publicationDigest: metadataDigest(body.schema, body) }, options))
              .rejects.toThrow();
          }
          return again;
        } } }) };
    const r = await requester(c, store, { service });
    try {
      const threadId = await r.newThread(), attempt = await r.send(threadId);
      expect(attempt.status).toBe('completed'); expect(r.response().content).toBe('012');
      expect(outcomes).toEqual([true, true, true]);
      expect(r.writerErrors).toEqual(['publish: Publication key collision']);
      expect(records(store, threadId).map(row => row.publication.sequence)).toEqual([0, 1, 2]);
      expect(records(store, threadId).at(-1).publication.delta.text).toBe('2');
      expect(r.projected).toHaveLength(3);
      expect(new Set(r.projected).size).toBe(3);
      // A late replay of the final record after completion has no publication authority.
      const final = records(store, threadId).at(-1);
      const owner = await r.history.publication(threadId);
      await expect(owner.publish(final.publication, { evidence: [] })).rejects.toThrow('authority revoked');
      expect(records(store, threadId)).toHaveLength(3);
    } finally { await r.close(); await c.close(); }
  });

  it('reload restores a committed attempt from verified records without dispatching execution', async () => {
    const t = await opened();
    try {
      const attempt = await t.r.send(t.threadId);
      await t.r.close();
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.attempt()).toMatchObject({ id: attempt.id, status: 'completed' });
      expect(reloaded.response()).toMatchObject({ content: '012',
        publicationDigests: records(t.store, t.threadId, attempt.id).map(row => row.publication.publicationDigest) });
      expect(reloaded.execute).not.toHaveBeenCalled();
      const followup = await reloaded.send(t.threadId, 'Continue');
      expect(followup.status).toBe('completed');
      expect(reloaded.execute.mock.calls[0][0].messages.map(row => row.content)).toEqual(['Hello', '012', 'Continue']);
    } finally { await t.close(); }
  });

  it.each([[0, ''], [1, '0']])('reload restores an uncommitted attempt held at step %i as interrupted, and its old writer cannot publish',
    async (held, retained) => {
      const t = await opened(), last = t.c.f.stages[2], run = last.executeStage.getMockImplementation();
      const gate = Promise.withResolvers(), reached = Promise.withResolvers();
      last.executeStage.mockImplementation(async args => {
        if (args.step === held) { reached.resolve(); await gate.promise; }
        return run(args);
      });
      try {
        const pending = t.r.send(t.threadId);
        await reached.promise;
        const interrupted = t.r.attempt().id;
        const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
        expect(reloaded.attempt()).toMatchObject({ id: interrupted, status: 'interrupted' });
        expect(reloaded.response()).toMatchObject({ content: retained, status: 'interrupted' });
        gate.resolve();
        await expect(pending).rejects.toThrow();
        expect(text(records(t.store, t.threadId, interrupted))).toBe(retained);
        expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('interrupted');
        last.executeStage.mockImplementation(run);
        const retry = await reloaded.workspace.retry(t.threadId, interrupted, { authorizeDisclosure: () => true });
        expect(retry.status).toBe('completed'); expect(reloaded.response().content).toBe('012');
        const third = await t.reload({ writerEpoch: epochC, expectedWriterEpoch: epochB });
        expect(third.thread().attempts.map(row => row.status)).toEqual(['interrupted', 'completed']);
      } finally { gate.resolve(); await t.close(); }
    });
});

describe('coalesced publication under the requester\'s declared persistence window', () => {
  const windowed = (maxUnsavedSteps, maxUnsavedMs) => ({ maxAttempts: 64, maxPublications: 4096, persistence: { maxUnsavedSteps, maxUnsavedMs } });
  // Each transaction that adds records, as the sequences it commits together.
  const commits = (t, log = []) => {
    t.store.hook = (prior, next) => {
      const before = publications(prior, t.threadId).records.length, after = publications(next, t.threadId).records;
      const batch = after.slice(before).map(row => row.publication.sequence);
      return batch.length ? () => log.push(['commit', batch]) : undefined;
    };
    t.c.f.stages.forEach((stage, index) => {
      const run = stage.executeStage.getMockImplementation();
      stage.executeStage.mockImplementation(async args => { if (index === 0) log.push(['execute', args.step]); return run(args); });
    });
    return log;
  };
  it('commits steps in one transaction off the step path, shows only committed text and marks the window on the attempt', async () => {
    const t = await opened(windowed(8, 60000)), visible = [];
    try {
      const log = commits(t);
      t.r.workspace.subscribe(state => {
        const message = state.threads[0]?.messages.at(-1);
        if (message?.role === 'assistant') visible.push([message.content, text(records(t.store, t.threadId, message.attemptId))]);
      });
      const attempt = await t.r.send(t.threadId);
      expect([attempt.error, t.r.writerErrors]).toEqual([null, []]);
      expect(attempt.status).toBe('completed'); expect(t.r.response().content).toBe('012');
      // Steps 1 and 2 ran before anything was committed; the terminal step committed all three at once.
      expect(log).toEqual([['execute', 0], ['execute', 1], ['execute', 2], ['commit', [0, 1, 2]]]);
      expect(visible.every(([shown, committed]) => committed.startsWith(shown))).toBe(true);
      expect(t.r.projected).toHaveLength(1);
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0])
        .toMatchObject({ status: 'completed', persistence: { maxUnsavedSteps: 8, maxUnsavedMs: 60000 } });
    } finally { await t.close(); }
  });
  it('never leaves more than the declared steps uncommitted while computing the next one', async () => {
    const t = await opened(windowed(1, 60000));
    try {
      const log = commits(t);
      expect((await t.r.send(t.threadId)).status).toBe('completed');
      expect(log).toEqual([['execute', 0], ['execute', 1], ['commit', [0, 1]], ['execute', 2], ['commit', [2]]]);
    } finally { await t.close(); }
  });
  it('starts a commit after the declared delay without waiting for the next step', async () => {
    const t = await opened(windowed(8, 0)), last = t.c.f.stages[2], run = last.executeStage.getMockImplementation();
    try {
      const log = commits(t);
      last.executeStage.mockImplementation(async args => { if (args.step === 1) await new Promise(resolve => setTimeout(resolve, 30)); return run(args); });
      expect((await t.r.send(t.threadId)).status).toBe('completed');
      expect(log.findIndex(row => row[0] === 'commit' && row[1].includes(0))).toBeLessThan(log.findIndex(row => row[0] === 'execute' && row[1] === 2));
    } finally { await t.close(); }
  });
  it('a crash loses at most the declared window: reload restores the committed prefix as interrupted, with its window marked', async () => {
    const t = await opened(windowed(8, 60000)), last = t.c.f.stages[2], run = last.executeStage.getMockImplementation();
    const gate = Promise.withResolvers(), reached = Promise.withResolvers();
    last.executeStage.mockImplementation(async args => { if (args.step === 2) { reached.resolve(); await gate.promise; } return run(args); });
    try {
      const pending = t.r.send(t.threadId);
      await reached.promise;
      const interrupted = t.r.attempt().id;
      // Two computed steps were uncommitted when this writer stopped: within the window of eight.
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.attempt()).toMatchObject({ id: interrupted, status: 'interrupted' });
      expect(reloaded.response().content).toBe('');
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0])
        .toMatchObject({ status: 'interrupted', persistence: { maxUnsavedSteps: 8, maxUnsavedMs: 60000 } });
      gate.resolve();
      await expect(pending).rejects.toThrow();
      // The superseded writer could not commit the window afterwards.
      expect(records(t.store, t.threadId, interrupted)).toEqual([]);
    } finally { gate.resolve(); await t.close(); }
  });
  it('a failed attempt commits every step it computed before the writer records its end', async () => {
    const t = await opened(windowed(8, 60000)), last = t.c.f.stages[2], run = last.executeStage.getMockImplementation();
    last.executeStage.mockImplementation(async args => { if (args.step === 2) throw Error('stage failed'); return run(args); });
    try {
      const attempt = await t.r.send(t.threadId);
      expect(attempt.status).toBe('failed');
      expect(records(t.store, t.threadId, attempt.id).map(row => row.publication.sequence)).toEqual([0, 1]);
      expect(t.r.response()).toMatchObject({ content: '01', status: 'failed' });
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('cancelled');
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.response().content).toBe('01');
    } finally { await t.close(); }
  });
  it('a stop keeps exactly the committed text as the final state', async () => {
    const t = await opened(windowed(8, 60000)), last = t.c.f.stages[2], run = last.executeStage.getMockImplementation();
    const reached = Promise.withResolvers(), gate = Promise.withResolvers();
    last.executeStage.mockImplementation(async args => { if (args.step === 2) { reached.resolve(); await gate.promise; } return run(args); });
    try {
      const pending = t.r.send(t.threadId);
      await reached.promise; void t.r.workspace.cancel(t.threadId); gate.resolve();
      const attempt = await pending;
      expect(attempt.status).toBe('cancelled');
      const durable = text(records(t.store, t.threadId, attempt.id));
      expect(t.r.response().content).toBe(durable);
      expect(publications(t.store.durable.get('workspace'), t.threadId).attempts[0].status).toBe('cancelled');
      const reloaded = await t.reload({ writerEpoch: epochB, expectedWriterEpoch: epochA });
      expect(reloaded.response().content).toBe(durable);
    } finally { gate.resolve(); await t.close(); }
  });
});

describe('ordered publication record contract inside the existing writer', () => {
  const route = routeFixture(3).route;
  function writer() {
    const store = memoryStore();
    const owner = createConversationPublication({ conversationId: 'thread', writerEpoch: epochA, store,
      doppler: { metadataDigest }, authenticateCommit: async () => false, authorize: () => true });
    const attempt = orderedPublicationAttempt({ binding: { schema: 'reploid.partition-attempt/v2', route, requesterId,
      threadId: 'thread', attemptId: 'attempt', placementGeneration: 0 }, coordinatorEpoch: epochB, publisherEpoch: epochA,
    generationDigest: 'sha256:' + 'c'.repeat(64) });
    const bounds = orderedGenerationBounds({ maxTokens: 3, maxOutputCharacters: 4 });
    const record = (base, previous, step) => orderedPublicationRecord({ attempt, bounds, vocabSize: 128, base,
      previousPublicationDigest: previous, metadataDigest, step: { inputTokenCount: 1, done: false, stopReason: null, ...step } });
    return { store, owner, attempt, bounds, record, async admit() {
      await owner.claimWriter(null);
      await owner.admitAttempt({ identity: attempt, generationPolicy: bounds, executionIdentity: attempt.generationDigest,
        vocabSize: 128, deadlineAt: Date.now() + 60000 });
    } };
  }
  const resign = value => { const { publicationDigest: _, ...body } = value; return { ...body, publicationDigest: metadataDigest(body.schema, body) }; };

  it('admits an N-stage route with only the digest port and rejects canonical attempts without Doppler validators', async () => {
    const w = writer();
    await w.admit();
    const first = w.record(null, null, { sequence: 0, tokenPosition: 0, inputTokenCount: 2, tokenId: 10, delta: 'a' });
    await w.owner.publish(first, { evidence: [] });
    await expect(w.owner.admitAttempt({ identity: { schema: 'doppler.resident-attempt/v2' }, generationPolicy: {},
      executionIdentity: 'x', vocabSize: 1, deadlineAt: Date.now() + 1000 })).rejects.toThrow('Canonical Doppler contract required');
    expect((await w.owner.reconcile()).attempts[0].identity.route.stages).toHaveLength(3);
  });

  it('rejects skipped, rechained, acknowledged, oversized and unterminated records without writing them', async () => {
    const w = writer();
    await w.admit();
    const first = w.record(null, null, { sequence: 0, tokenPosition: 0, inputTokenCount: 2, tokenId: 10, delta: 'a' });
    await w.owner.publish(first, { evidence: [] });
    const second = w.record(first.successor, first.publicationDigest, { sequence: 1, tokenPosition: 2, tokenId: 11, delta: 'b' });
    const skipped = resign({ ...second, sequence: 2, successor: { ...second.successor, revision: 2, generatedTokenCount: 3 } });
    const rechained = resign({ ...second, previousPublicationDigest: null });
    const acknowledged = resign({ ...second, acknowledgments: [{ stageId: 'x' }] });
    const oversized = resign({ ...second, delta: { text: 'bcde' }, successor: { ...second.successor, outputCharacters: 5 } });
    for (const value of [skipped, rechained, acknowledged, oversized]) {
      await expect(w.owner.publish(value, { evidence: [] })).rejects.toThrow();
    }
    expect(w.store.durable.get('thread').records).toHaveLength(1);
    await w.owner.publish(second, { evidence: [] });
    const final = w.record(second.successor, second.publicationDigest, { sequence: 2, tokenPosition: 3, tokenId: 12, delta: 'c', done: true, stopReason: 'eos' });
    // The last allowed step must terminate; a non-terminal record at the limit is invalid.
    const unterminated = resign({ ...final, successor: { ...final.successor, terminal: false, stopReason: null } });
    await expect(w.owner.publish(unterminated, { evidence: [] })).rejects.toThrow('cursor');
    await w.owner.publish(final, { evidence: [] });
    expect((await w.owner.reconcile()).attempts[0]).toMatchObject({ status: 'completed', nextSequence: 3 });
  });
});
