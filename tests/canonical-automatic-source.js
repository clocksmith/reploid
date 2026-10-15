// Ordinary host -> automatic discovery/approval -> authenticated entry duplex ->
// canonical runner -> signatures -> requester transactions -> host projection.
// Numerical operators and tokenization are injected, not physical qualification.
import assert from './fixtures/canonical-assert.js';
import { openChatHistory } from '../self/host/chat-history.js';
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createPartitionChat } from '../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionEntry } from '../packages/reploid/src/mesh/partitions/partition-entry.js';
import { createPartitionDataChannel } from '../packages/reploid/src/transport/partition-data-channel.js';
import { verifyPartitionStageCommit } from '../packages/reploid/src/mesh/partitions/partition-stage-commit.js';
import { openCanonicalWorkspaceHistory } from '../packages/reploid/src/chat/workspace-history.js';
import { createChatSession } from '../self/host/chat-session.js';
import { remotePermissionWording } from '../self/ui/pool-home/remote-permission.js';
import { fixture, runtime, plan, planId, limits, hash, epoch } from './canonical-runner-fixture.js';
const requester = await createSigningIdentity({ algorithm: 'ECDSA' });
let root = null, tail = Promise.resolve(), authorize = () => false;
const f = await fixture({ requesterId: requester.peerId, observedPublications: () => root?.publications['thread-a']?.records ?? [] });
await f.runner.close();
f.devices.forEach((device, index) => Object.assign(device, { index, subscribe: () => () => {}, refresh: async () => {},
  getState: () => ({ ready: true, phase: 'ready', receipt: {} }), tokenize: async () => ({ tokenIds: [1, 2], modelIdentity: hash }) }));
const chat = createPartitionChat({ runtime, local: f.devices[0], remote: f.devices[1], authority: f.grantAuthority,
  model: { id: plan.modelId, identity: hash, name: 'fixture', provider: 'doppler', adapters: [] }, plan, planId,
  limits, grantTtlMs: 60000, canonical: { coordinatorEpoch: epoch }, authorizeRequester: async () => true });
let changed = false;
const getModels = () => chat.getModels().map(model => changed ? { ...model, canonical: { ...model.canonical, routeId: 'sha256:' + 'b'.repeat(64) } } : model);
const advertised = chat.getModels()[0]; f.input.canonical.attempt.routeId = advertised.canonical.routeId;
const channelLimits = { maxFrameBytes: 16384, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384,
  maxPendingRequests: 16, maxRequestsPerChannel: 128, maxBufferedBytes: 131072, maxTransferBytes: 4194304, timeoutMs: 3000 };
const policy = { pollMs: 20, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 60000, limits,
  inputChannel: channelLimits, executionChannel: channelLimits, controlChannel: channelLimits,
  receiver: { maxAttempts: 8, maxSteps: 16 }, inputLimits: { maxInputCharacters: 8192, maxOutputCharacters: 8192,
    maxAttempts: 8, maxConcurrentAttempts: 2, descriptorTtlMs: 10000 } };
const channels = () => {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, i) => Object.assign(channel, { readyState: 'open', ordered: true, maxRetransmits: null,
    maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => pair[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close'));
      queueMicrotask(() => pair[1 - i].close()); } })); return pair;
};
const endpoints = [];
const mesh = createAutomaticPartitions({ identity: requester, meshId: 'mesh', models: [advertised], policy,
  canonical: { runtime, coordinatorEpoch: epoch, participantEpoch: epoch },
  peers: () => [{ id: '1', localTransportId: '0' }], loadProgram() { throw Error('Requester must not acquire weights'); },
  createNetwork(options) {
    let endpoint;
    return { async close() { await endpoint?.close(); }, async connect() {
      if (endpoint) return endpoint;
      const [local, remote] = channels();
      endpoint = options.createEndpoint({ channel: local, remoteParticipantId: f.devices[0].id });
      let opposite;
      if (options.label === 'reploid-partitions-control') opposite = createPartitionDataChannel({ channel: remote,
        localParticipantId: f.devices[0].id, remoteParticipantId: requester.peerId, limits: channelLimits,
        authorize: async () => true, serve: async () => ({ participantId: f.devices[0].id, phase: 'ready', index: 0,
          models: getModels(), offer: { id: plan.modelId, identity: hash }, planId, placement: f.devices.map(d => d.id) }) });
      else opposite = createPartitionEntry({ channel: remote, canonical: true, localParticipantId: f.devices[0].id,
        remoteParticipantId: requester.peerId, service: { ...chat, getModels }, authorize: async () => true,
        limits: channelLimits, inputLimits: policy.inputLimits });
      endpoints.push(opposite); options.onPeer?.('1', endpoint); return endpoint;
    } };
  } });
const database = globalThis.CANONICAL_TEST_SOURCE ? await openChatHistory({ name: 'canonical-automatic-' + crypto.randomUUID(),
  maxConversations: 1, maxConversationBytes: 1000000, openTimeoutMs: 1000 }) : null;
const store = { schema: 'reploid.transactional-chat-store/v1', async read() { await tail; return structuredClone(root); },
  transact(key, reducer) { const operation = tail.then(async () => {
    if (database) { const value = await database.transact(key, reducer); root = await database.read(key); return value; }
    const next = reducer(structuredClone(root)); root = structuredClone(next.state); return next.result; });
    tail = operation.catch(() => {}); return operation; } };
const history = await openCanonicalWorkspaceHistory({ store, key: 'workspace', meshId: 'mesh', participantId: requester.peerId,
  writerEpoch: epoch, expectedWriterEpoch: null, legacy: { workspace: null, drafts: null }, maxWorkspaceBytes: 1000000, maxThreads: 8,
  publicationOptions: () => ({ doppler: runtime, authorize: scope => ['writer', 'read', 'replay'].includes(scope.action) || authorize(scope),
    authenticateCommit: (acknowledgment, stage, attempt, evidence) => verifyPartitionStageCommit({ runtime, acknowledgment, stage, attempt, evidence }) }) });
const ids = ['thread-a', 'user', 'a', 'response'];
const session = createChatSession({ storage: null, meshId: 'mesh', participantId: requester.peerId, models: [advertised],
  partitions: mesh, canonicalHistory: history, bindPublicationAuthorization: fn => { authorize = fn; }, id: () => ids.shift() });
let disposeView = null;
export let browserResult = null;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(Error('discovery timeout')); }, 3000);
    const unsubscribe = mesh.subscribe(models => { if (models.length) { clearTimeout(timer); unsubscribe(); resolve(); } });
  });
  await assert.rejects(mesh.generate({}, {}), /durable publication/);
  await assert.rejects(mesh.generate({ model: mesh.getModels()[0], threadId: 'review', attemptId: 'review', messages: [{ role: 'user', content: 'reviewed' }] }, {
    signal: new AbortController().signal, publication: {}, publisherEpoch: epoch, onPublished() {},
    requestApproval: async () => { changed = true; return true; } }), /placement changed/);
  assert.equal(f.counters.a, 0); assert.equal(f.counters.b, 0); changed = false;
  const thread = await session.createThread({ model: mesh.getModels()[0] });
  let result;
  if (database) {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('../self/ui/pool-home/conversation-workspace.js');
    document.body.innerHTML = renderConversationWorkspace();
    let resolve, reject;
    const completion = new Promise((done, failed) => { resolve = done; reject = failed; });
    disposeView = bindConversationWorkspace(document.body, { ...session, send(...args) {
      const operation = session.send(...args); operation.then(resolve, reject); return operation;
    } });
    const input = document.querySelector('[data-composer-input]'); input.value = 'actual requester message';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-composer-form]').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    // The first remote request asks once for the contributor permission; Allow sends it.
    await new Promise((resolve, reject) => {
      const started = Date.now(), poll = () => {
        const dialog = document.querySelector('[data-remote-permission]');
        if (dialog?.open) { dialog.querySelector('[data-remote-permission-allow]').click(); resolve(); }
        else if (Date.now() - started > 5000) reject(Error('permission timeout')); else setTimeout(poll, 10);
      };
      poll();
    });
    result = await completion;
    const saved = await database.read('workspace');
    browserResult = { status: result.status, output: session.getState().activeThread.messages.at(-1).content,
      visible: document.querySelector('[data-message-stream]').textContent.includes('34'),
      records: saved.publications[thread].records.length, metadataText: saved.workspace.threads[0].messages.at(-1).content,
      draftCleared: input.value === '', a: f.counters.a, b: f.counters.b };
  } else {
    const completing = session.send(thread, 'actual requester message');
    const pending = await new Promise(resolve => { const stop = session.subscribe(value => {
      const attempt = value.activeThread?.attempts.at(-1);
      if (attempt?.status === 'approval') { queueMicrotask(() => stop()); resolve(attempt); } }); });
    await session.grantRemotePermission(pending.approval.permissionNeed, { wording: remotePermissionWording(pending.approval.permissionNeed) });
    result = await completing;
  }
  assert.equal(result.status, 'completed', result.error);
  assert.equal(session.getState().activeThread.messages.at(-1).content, '34');
  assert.equal(root.publications[thread].records.length, 2);
  assert.equal(root.workspace.threads[0].messages.at(-1).content, '');
  assert.equal(f.counters.a, 2); assert.equal(f.counters.b, 2);
  console.log('ordinary automatic path: source canonical capability, real duplex publication, saved host approval and verified UI projection pass');
} finally { disposeView?.(); await session.close(); await database?.close(); await mesh.close(); await Promise.all(endpoints.map(e => e.close())); await chat.close(); }
