// Requester-owned transactional history ON for ordered sessions in the shipped product composition.
// The product session, work swarm, chat session, workspace, history writer and automatic partition
// owners are the shipped modules. Injected: signaling mesh, WebRTC transport, identity storage,
// model-file IO, the peer-offer tab lock, the browser store (IndexedDB is unavailable here), Web Locks
// and the Doppler partitions module. Numerical outputs are fixture data, never physical inference.
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as runtime from 'doppler-gpu/partitions';
import { canonicalPartitionJson } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };

const ports = vi.hoisted(() => ({ identity: null, partitions: null }));
vi.mock('../../self/identity.js', async original => ({ ...await original(), ensureIdentityBundle: async () => ports.identity }));
vi.mock('../../self/vendor/reploid/mesh/index.js', async original => ({ ...await original(),
  createLegacyGenerationMesh: ({ ports: input }) => {
    let identity = null;
    return { async connect() { identity = await input.identity.ensure({}); input.createTransport(); }, async close() {},
      getSwarmSnapshot: () => ({ peerId: identity?.peerId ?? null, connectionState: identity ? 'connected' : 'disconnected', peers: [] }) };
  },
  createAutomaticPartitions: () => ports.partitions
}));
vi.mock('../../self/vendor/reploid/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ disconnect() {}, _getPeerId: () => 'transport-requester', getConnectedPeers: () => [] }) }));
vi.mock('../../self/host/work-model-files.js', async original => ({ ...await original(),
  createWorkModelFiles: () => ({ async attach() {}, async close() {}, announce() {}, getState: () => ({ sharing: false, preparing: false }) }) }));
vi.mock('../../self/host/work-peer-offers.js', () => ({ createWorkPeerOffers: () => ({
  acquire: async () => 'transport-requester', attach: async () => {}, close() {}, getState: () => null }) }));
import { createProductSession } from '../../self/host/product-session.js';
import { LOCAL_HISTORY_IDENTITY } from '../../self/host/chat-session.js';
import { remotePermissionWording } from '../../self/ui/pool-home/remote-permission.js';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';

const metadataDigest = (schema, body) => 'sha256:' + createHash('sha256').update(schema + '\0' + canonicalPartitionJson(body)).digest('hex');
const LEGACY_KEY = 'reploid.chat-workspace:v1';
const weightlessRequester = { stage: null, ...orderedPolicy.limits };
const cleanups = [];
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(close => close()));
  Object.assign(ports, { identity: null, partitions: null });
  const failures = results.filter(row => row.status === 'rejected').map(row => row.reason);
  if (failures.length) throw new AggregateError(failures, 'Product session cleanup failed');
});
const memoryStorage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
/** One browser profile's durable store and Web Locks; each product session opens a new handle. */
function profileHistory(partitions = { ...runtime, metadataDigest }) {
  const durable = new Map(), held = new Set(), opened = [];
  let tail = Promise.resolve();
  const entry = key => orderedPolicy.requesterHistory.database + '/' + key;
  return { durable, held, opened, runtime: partitions,
    workspace: () => durable.get(entry('workspace')) ?? null,
    records: threadId => durable.get(entry('workspace'))?.publications?.[threadId]?.records ?? [],
    locks: { async request(name, options, callback) {
      if (held.has(name)) { if (options.ifAvailable) return callback(null); throw Error('Blocking lock waits are not modeled'); }
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    } },
    async openStore({ name, maxConversationBytes }) {
      opened.push(name);
      return { schema: 'reploid.transactional-chat-store/v1',
        async read(key) { await tail; return structuredClone(durable.get(entry(key)) ?? null); },
        transact(key, reducer) {
          const task = tail.then(() => {
            const next = reducer(structuredClone(durable.get(entry(key)) ?? null)), text = JSON.stringify(next.state);
            if (new TextEncoder().encode(text).byteLength > maxConversationBytes) throw Error('Entry exceeds its byte admission');
            durable.set(entry(key), JSON.parse(text)); return structuredClone(next.result);
          });
          tail = task.catch(() => {}); return task;
        },
        async close() {} };
    } };
}
// The arguments initPoolHome passes (self/ui/pool-home/index.js:36), plus injected history ports.
async function openProduct(storage, history, { autoConnect = true } = {}) {
  const host = await createProductSession({ storage, operationNetwork: null, canonical: null, ordered: weightlessRequester,
    historyPorts: { loadRuntime: async () => history.runtime, locks: history.locks, openStore: history.openStore },
    networkOptions: () => ({}),
    swarmNetworkOptions: () => ({ autoConnect, discoveryScope: 'public', config: resolveConfig({ overrides: { mesh: { roomId: 'mesh' } } }) }) });
  cleanups.push(() => host.close());
  return host;
}
// A fresh profile holds its first remote request until the one-time contributor permission is granted;
// later requests proceed on that stored permission.
async function send(chat, threadId, text) {
  const completion = chat.send(threadId, text), approved = new Set();
  let settled = false;
  completion.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) {
    const attempt = chat.getState().threads.find(row => row.id === threadId)?.attempts.at(-1);
    if (attempt?.status === 'approval' && attempt.approval && !approved.has(attempt.approval.id)) {
      approved.add(attempt.approval.id);
      await chat.grantRemotePermission(attempt.approval.permissionNeed, { wording: remotePermissionWording(attempt.approval.permissionNeed) });
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return completion;
}
async function orderedRoute() {
  const f = await automaticOrderedMesh({ modelFields: { provider: 'doppler' } }); cleanups.push(() => f.close());
  f.runtime.metadataDigest = metadataDigest; // The coordinator's stage-zero runtime.
  ports.identity = f.identities[5]; ports.partitions = f.meshes[5];
  await f.prepare(); await vi.waitFor(() => expect(f.select(5, 0)).toBeTruthy(), { timeout: 5000 });
  return f;
}
async function publishedSend(storage, history) {
  const f = await orderedRoute(), host = await openProduct(storage, history), visible = [];
  const model = await vi.waitFor(() => {
    const row = host.chat.getState().models.find(item => item.partition?.coordinatorId === f.identities[0].peerId && item.availability === 'ready');
    expect(row).toBeTruthy(); return row;
  }, { timeout: 5000 });
  const threadId = await host.chat.createThread({ model });
  host.chat.subscribe(state => {
    const message = state.threads.find(row => row.id === threadId)?.messages.at(-1);
    if (message?.role === 'assistant') visible.push([message.content, history.records(threadId)
      .filter(row => row.publication.attemptId === message.attemptId).map(row => row.publication.delta.text).join('')]);
  });
  const attempt = await send(host.chat, threadId, tasks[0].prompt);
  return { f, host, model, threadId, attempt, visible };
}

it('opens requester-owned history for an ordered catalog and publishes the three-stage Send before showing it', async () => {
  const history = profileHistory(), { host, model, threadId, attempt, visible } = await publishedSend(memoryStorage(), history);
  const state = host.chat.getState();
  expect(state.history).toMatchObject({ mode: 'transactional', publication: 'ordered' });
  expect(Object.hasOwn(state, 'ephemeralExecutions')).toBe(true);
  expect(history.opened).toEqual([orderedPolicy.requesterHistory.database]);
  // Models whose output this history cannot publish are not offered as ready.
  expect(state.models.filter(row => !row.partition).every(row => row.availability === 'unavailable')).toBe(true);
  expect(attempt.error).toBeNull(); expect(attempt.status).toBe('completed');
  expect(model.partition.route.stages).toHaveLength(3);
  const records = history.records(threadId);
  expect(records.map(row => row.publication.sequence)).toEqual([0, 1, 2]);
  expect(records.every(row => row.publication.schema === 'reploid.ordered-publication/v1' && row.publication.acknowledgments.length === 0)).toBe(true);
  expect(records.map(row => row.publication.delta.text).join('')).toBe(tasks[0].chunks.join(''));
  expect(state.activeThread.messages.at(-1).content).toBe(tasks[0].chunks.join(''));
  // Saved metadata carries no answer text; it exists only in committed records.
  expect(history.workspace().workspace.threads[0].messages.at(-1).content).toBe('');
  expect(visible.length).toBeGreaterThan(0);
  expect(visible.every(([shown, committed]) => committed.startsWith(shown))).toBe(true);
  expect(state.participantId).toBe(LOCAL_HISTORY_IDENTITY.participantId);
}, 20000);

it('reload restores the published ordered attempt from verified records under a different requester peer', async () => {
  const storage = memoryStorage(), history = profileHistory(), { f, host, threadId, attempt } = await publishedSend(storage, history);
  const digests = history.records(threadId).map(row => row.publication.publicationDigest);
  const dispatched = () => f.states.filter(state => state.resident).reduce((total, state) => total + state.resident.tokenize.mock.calls.length, 0);
  await host.close();
  expect(history.held.size).toBe(0);
  const before = dispatched();
  // Reload: a fresh session; even another peer identity keeps the same local history owner.
  ports.identity = f.identities[6]; ports.partitions = f.meshes[6];
  const reloaded = await openProduct(storage, history);
  const thread = reloaded.chat.getState().threads.find(row => row.id === threadId);
  expect(thread.attempts.at(-1)).toMatchObject({ id: attempt.id, status: 'completed' });
  expect(thread.messages.at(-1)).toMatchObject({ content: tasks[0].chunks.join(''), publicationDigests: digests });
  expect(dispatched()).toBe(before);
}, 20000);

it('migrates the existing localStorage workspace and drafts once', async () => {
  const storage = memoryStorage(), history = profileHistory();
  const legacyThread = { id: 'old-thread', model: { id: 'model', name: 'Earlier', identity: 'sha256:' + 'a'.repeat(64) }, purpose: '',
    members: [LOCAL_HISTORY_IDENTITY.participantId], permissions: {}, grants: [], closed: false, createdAt: 1,
    messages: [{ id: 'q', role: 'user', content: 'Earlier question', status: 'completed' },
      { id: 'r', role: 'assistant', attemptId: 'x', content: 'Earlier answer', status: 'completed' }],
    attempts: [{ id: 'x', threadId: 'old-thread', userMessageId: 'q', responseId: 'r', retryOf: null, status: 'completed',
      createdAt: 1, finishedAt: 2, error: null, approval: null, execution: null, authorization: null, request: { messages: [] } }] };
  const legacy = JSON.stringify({ schema: 'reploid.chat-workspace/v1', ...LOCAL_HISTORY_IDENTITY, threads: [legacyThread] });
  const drafts = JSON.stringify({ 'old-thread': { text: 'unsent follow-up', files: [] } });
  storage.setItem(LEGACY_KEY, legacy); storage.setItem(LEGACY_KEY + ':drafts', drafts);
  const first = await openProduct(storage, history, { autoConnect: false });
  expect(first.chat.getState().history.mode).toBe('transactional');
  expect(first.chat.getState().threads.map(row => row.messages.map(item => item.content))).toEqual([['Earlier question', 'Earlier answer']]);
  expect(first.chat.getDraft('old-thread').text).toBe('unsent follow-up');
  expect(history.workspace().legacy).toEqual({ workspace: legacy, drafts });
  await first.close();
  // The original bytes stay untouched; later local changes are never imported again.
  expect(storage.getItem(LEGACY_KEY)).toBe(legacy); expect(storage.getItem(LEGACY_KEY + ':drafts')).toBe(drafts);
  storage.setItem(LEGACY_KEY, JSON.stringify({ schema: 'reploid.chat-workspace/v1', ...LOCAL_HISTORY_IDENTITY, threads: [] }));
  storage.setItem(LEGACY_KEY + ':drafts', JSON.stringify({ 'old-thread': { text: 'changed later', files: [] } }));
  const second = await openProduct(storage, history, { autoConnect: false });
  expect(second.chat.getState().threads.map(row => row.id)).toEqual(['old-thread']);
  expect(second.chat.getDraft('old-thread').text).toBe('unsent follow-up');
  expect(history.workspace().legacy).toEqual({ workspace: legacy, drafts });
});

it('keeps ordinary history, and says so in state, when the installed runtime lacks metadataDigest', async () => {
  const storage = memoryStorage(), history = profileHistory({ ...runtime, metadataDigest: undefined });
  const host = await openProduct(storage, history, { autoConnect: false });
  const state = host.chat.getState();
  expect(state.history).toEqual({ mode: 'ordinary', publication: null,
    reason: expect.stringContaining('the installed Doppler runtime exposes no metadataDigest') });
  expect(Object.hasOwn(state, 'ephemeralExecutions')).toBe(false); expect(state.storageError).toBeNull();
  expect(history.opened).toEqual([]); expect(history.held.size).toBe(0);
  host.chat.createThread({ model: state.models[0] });
  expect(JSON.parse(storage.getItem(LEGACY_KEY)).threads).toHaveLength(1);
});

it('refuses history ownership to a second tab of the profile without fencing the owner', async () => {
  const storage = memoryStorage(), history = profileHistory();
  const owner = await openProduct(storage, history, { autoConnect: false });
  const second = await openProduct(storage, history, { autoConnect: false });
  const refused = second.chat.getState();
  expect(refused.history).toEqual({ mode: 'refused', publication: 'ordered', reason: 'Another tab owns this conversation history' });
  await vi.waitFor(() => expect(second.chat.getState().storageError).toBe('Another tab owns this conversation history'));
  expect(refused.threads).toEqual([]);
  expect(history.opened).toHaveLength(1);
  // The owner's writer was not taken over; it keeps saving.
  const threadId = await owner.chat.createThread({ model: owner.chat.getState().models[0] });
  expect(history.workspace().workspace.threads.map(row => row.id)).toEqual([threadId]);
  await owner.close(); expect(history.held.size).toBe(0);
});
