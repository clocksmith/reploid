/** Same-profile integration fixture. Test bytes and responses are not model/LoRA qualification. */
import { createChatWorkspace, createChatScheduler } from '../../self/vendor/reploid/chat/index.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { openPeerPackCheckpoints } from '../../self/infrastructure/pack-transfer-storage.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const links = new Map(), buffers = new Map(), pending = new Map(), executing = new Map();
const limits = { maxFrameBytes: 16384, maxControlBytes: 32768, maxChunkBytes: 64,
  maxBufferedBytes: 65536, maxPendingRequests: 4, maxTransferBytes: 1048576, timeoutMs: 5000 };
let role, pair, identity, supplier, custody, scheduler, workspace, model, namespace;
let opens = 0, applied = [], generationState = [];
const observations = [], calls = [], errors = [];
let release;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const envelope = request => ({ threadId: request.threadId, attemptId: request.attemptId });

export async function start(options) {
  role = options.role; namespace = options.namespace;
  pair = await createSigningKeyPair();
  identity = { peerId: role, publicKey: await exportPublicKey(pair.publicKey) };
  return identity;
}

export async function provision(receiver) {
  assert(role === 'C', 'Only the storage tab holds bootstrap bytes');
  const artifacts = [];
  for (const [artifactId, content, kind] of [
    ['model', 'SYNTHETIC MODEL FILE '.repeat(12), 'weight-shard'],
    ['adapter', 'SYNTHETIC ADAPTER FILE '.repeat(7), 'lora-weights']
  ]) {
    const bytes = new TextEncoder().encode(content); buffers.set(artifactId, bytes);
    artifacts.push({ artifactId, path: artifactId + '.bin', role: kind, hash: await sha256Hex(bytes), sizeBytes: bytes.length });
  }
  const artifactSet = { schema: 'reploid.pool.artifact-set/v1', identity: await hashDopplerEvidence(artifacts), artifacts };
  const index = { schema: 'reploid.pool.pack-custody-index/v2', artifactSetIdentity: artifactSet.identity, artifacts: [] };
  for (const artifact of artifacts) {
    const bytes = buffers.get(artifact.artifactId), chunks = [];
    for (let offset = 0; offset < bytes.length; offset += limits.maxChunkBytes) {
      const chunk = bytes.slice(offset, offset + limits.maxChunkBytes);
      chunks.push({ index: chunks.length, offset, sizeBytes: chunk.length, hash: await sha256Hex(chunk) });
    }
    index.artifacts.push({ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: artifact.sizeBytes, chunks });
  }
  const authorization = { schema: 'reploid.pool.pack-custody-authorization/v2', artifactSet,
    transferId: crypto.randomUUID(), attempt: 1, expiresAt: Date.now() + 120000,
    requester: receiver, suppliers: [identity], indexDigest: await hashDopplerEvidence(index),
    limits: { maxArtifactBytes: 1024, maxChunkBytes: 64, maxTransferBytes: 4096, requestTimeoutMs: 5000 } };
  supplier = await createPeerPackSupplier({ authorization, index, peerId: role, privateKey: pair.privateKey,
    inventory: { expiresAt: authorization.expiresAt, maxBytes: 4096,
      artifacts: index.artifacts.map(artifact => ({ artifactId: artifact.artifactId, chunkIndexes: artifact.chunks.map(chunk => chunk.index) })) },
    readChunk: async (id, chunk) => buffers.get(id).slice(chunk.offset, chunk.offset + chunk.sizeBytes) });
  return { authorization, index, inventories: [supplier.inventory] };
}

export function configure(value) {
  custody = value;
  const artifacts = value.authorization.artifactSet.artifacts;
  model = { id: 'synthetic-chat-model', name: 'Injected test model', identity: artifacts[0].hash,
    adapters: [{ identity: artifacts[1].hash }] };
}

function install(link, channel, kind) {
  const ready = () => {
    if (kind === 'files') {
      link.bus = createPeerPackDataChannel({ channel, limits, serve: supplier ? request => supplier.serve(request) : null });
    } else {
      link.bus = createPackJobDataChannel({ channel });
      // Test-only request envelopes exercise workspace ports, not the signed complete-job protocol.
      link.bus.subscribe(message => { void receive(message, link.bus).catch(error => errors.push(error.message)); });
      link.bus.onDisconnect(() => {
        for (const operation of pending.values()) operation.reject(new Error('Execution peer disconnected. Retry starts a new attempt.'));
        pending.clear();
        for (const controller of executing.values()) controller.abort(new Error('Requester disconnected'));
      });
    }
  };
  if (channel.readyState === 'open') ready(); else channel.addEventListener('open', ready, { once: true });
}

async function gathered(pc) {
  if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); error ? reject(error) : resolve(); };
    const changed = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(() => finish(new Error('ICE gathering timeout')), 5000);
    pc.addEventListener('icegatheringstatechange', changed); changed();
  });
  return pc.localDescription.toJSON();
}

function connect(peerId, kind) {
  links.get(peerId)?.bus?.close(); links.get(peerId)?.pc.close();
  const pc = new RTCPeerConnection({ iceServers: [] }), link = { pc, bus: null };
  links.set(peerId, link);
  pc.addEventListener('datachannel', event => install(link, event.channel, kind));
  return link;
}
export async function offer(peerId, kind) {
  const link = connect(peerId, kind);
  install(link, link.pc.createDataChannel(kind, { ordered: true }), kind);
  await link.pc.setLocalDescription(await link.pc.createOffer()); return gathered(link.pc);
}
export async function answer(peerId, kind, description) {
  const link = connect(peerId, kind);
  await link.pc.setRemoteDescription(description); await link.pc.setLocalDescription(await link.pc.createAnswer());
  return gathered(link.pc);
}
export async function accept(peerId, description) { await links.get(peerId).pc.setRemoteDescription(description); }
export function ready(peerId) { return !!links.get(peerId)?.bus; }

export async function acquire(interrupt = false) {
  assert(role === 'B', 'Only the execution tab acquires weights');
  const controller = new AbortController();
  const checkpoints = await openPeerPackCheckpoints({ name: namespace + '-B-files', maxBytes: 4096 });
  let requests = 0, failure = null;
  const store = await createPeerPackArtifactStore({ ...custody, requesterPrivateKey: pair.privateKey,
    checkpoints, maxConcurrentChunks: 1, signal: controller.signal,
    requestChunk: async (peerId, request, controls) => {
      if (interrupt && requests === 1) { controller.abort(new Error('Injected transfer interruption')); throw controller.signal.reason; }
      requests++; return links.get(peerId).bus.requestChunk(request, controls);
    } });
  try {
    for (const artifact of custody.authorization.artifactSet.artifacts) buffers.set(artifact.artifactId, await store.readArtifact(artifact));
  } catch (error) { failure = error.message; }
  const receipt = store.getReceipt(), storage = await checkpoints.getStats();
  store.close(); checkpoints.close();
  return { failure, requests, receipt, storage, heldFiles: [...buffers.keys()] };
}

export function serve() {
  assert(role === 'B' && buffers.has('model') && buffers.has('adapter'), 'Verified acquisition must precede execution');
  scheduler = createChatScheduler({ observe: value => observations.push(value),
    async open(selected) {
      opens++;
      assert(await sha256Hex(buffers.get('model')) === selected.identity, 'Wrong base bytes');
      return {
        reset() { generationState = []; },
        async setAdapters(adapters) {
          for (const adapter of adapters) assert(await sha256Hex(buffers.get('adapter')) === adapter.identity, 'Wrong adapter bytes');
          applied = structuredClone(adapters);
        },
        async run(request, controls) {
          assert(!generationState.length, 'Conversation state leaked'); generationState.push(request.threadId);
          assert(JSON.stringify(applied) === JSON.stringify(request.model.adapters), 'Adapter state leaked');
          calls.push(structuredClone(request));
          controls.onDelta('Injected answer: ');
          if (calls.length === 1 || calls.length === 4 && request.messages.at(-1).content === 'Disconnect this request') {
            await new Promise(resolve => { release = resolve; });
          }
          controls.signal.throwIfAborted();
          const last = request.messages.at(-1).content; controls.onDelta(last);
          return { ...envelope(request), modelId: model.id, modelIdentity: model.identity,
            adapterIdentities: model.adapters.map(adapter => adapter.identity), content: 'Injected answer: ' + last };
        }, close() { generationState = []; applied = []; }
      };
    } });
}

async function receive(message, bus) {
  if (role === 'B') {
    if (message.type === 'cancel') { executing.get(message.attemptId)?.abort(new Error('Response stopped')); return; }
    assert(message.type === 'request' && message.request.participantId === 'A', 'Unexpected fixture sender');
    const request = message.request, controller = new AbortController();
    executing.set(request.attemptId, controller);
    let sequence = 0;
    try {
      const result = await scheduler.schedule({ ...request, maxOutputTokens: 100 }, { signal: controller.signal,
        onDelta: text => { void bus.send({ type: 'delta', ...envelope(request), sequence: sequence++, text }).catch(error => errors.push(error.message)); } });
      await bus.send({ type: 'result', ...result });
    } catch (error) {
      if (!bus.getState().closed) await bus.send({ type: 'error', ...envelope(request), error: error.message });
    } finally { executing.delete(request.attemptId); }
    return;
  }
  const operation = pending.get(message.attemptId);
  if (!operation || operation.threadId !== message.threadId) return;
  if (message.type === 'delta') operation.controls.onDelta(message);
  else {
    pending.delete(message.attemptId);
    if (message.type === 'result') operation.resolve(message);
    else operation.reject(new Error(message.error));
  }
}

export function chat() {
  assert(role === 'A', 'Only A owns the conversation history');
  workspace = createChatWorkspace({ meshId: namespace, participantId: role,
    store: { load: () => JSON.parse(localStorage.getItem(namespace + '-A-history') || 'null'),
      save: value => localStorage.setItem(namespace + '-A-history', JSON.stringify(value)) },
    async execute(request, controls) {
      const bus = links.get('B')?.bus;
      assert(bus && !bus.getState().closed, 'Execution peer is unavailable');
      const approved = await controls.requestApproval({ ...envelope(request), id: crypto.randomUUID(), peerId: 'B',
        input: request.messages, expiresAt: Date.now() + 30000 });
      assert(approved, 'Disclosure declined'); controls.signal.throwIfAborted();
      const cancel = () => { void bus.send({ type: 'cancel', ...envelope(request) }).catch(() => {}); };
      controls.signal.addEventListener('abort', cancel, { once: true });
      try {
        return await new Promise((resolve, reject) => {
          pending.set(request.attemptId, { threadId: request.threadId, controls, resolve, reject });
          bus.send({ type: 'request', request }).catch(reject);
        });
      } finally { controls.signal.removeEventListener('abort', cancel); pending.delete(request.attemptId); }
    } });
}

export function send(text, threadId = null) {
  threadId ||= workspace.createThread({ model, members: ['B'] });
  void workspace.send(threadId, text).catch(error => errors.push(error.message)); return threadId;
}
export function approve(threadId) {
  const attempt = workspace.getState().threads.find(thread => thread.id === threadId).attempts.at(-1);
  workspace.approve(threadId, attempt.id, attempt.approval.id, true);
}
export function cancel(threadId) { void workspace.cancel(threadId); }
export function retry(threadId) {
  const attempt = workspace.getState().threads.find(thread => thread.id === threadId).attempts.at(-1);
  void workspace.retry(threadId, attempt.id).catch(error => errors.push(error.message));
}
export function releaseExecution() { release?.(); release = null; }
export function disconnect(peerId) { links.get(peerId)?.bus.close(); links.get(peerId)?.pc.close(); }
export function state() {
  return { role, heldFiles: [...buffers.keys()], opens, calls, applied, observations, errors,
    workspace: workspace?.getState(), scheduler: scheduler?.getState() };
}
export async function close() {
  releaseExecution(); for (const controller of executing.values()) controller.abort(new Error('Fixture closed'));
  for (const link of links.values()) { link.bus?.close(); link.pc.close(); }
  await workspace?.close(); await scheduler?.close(); supplier?.close();
}
