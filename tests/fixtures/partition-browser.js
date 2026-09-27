import * as runtime from '/vendor/doppler/0.6.3-dev.split.1/src/inference/pipelines/text/layer-partition-contract.js';
import { createSigningIdentity } from '/vendor/reploid/artifacts/identity.js';
import { createMeshPeerIdentity } from '/vendor/reploid/mesh/peer-identity.js';
import { createResidentPartition, createPartitionGrantAuthority, createPartitionPeer,
  createPartitionNetwork, createPartitionChat, partitionFingerprint } from '/vendor/reploid/mesh/index.js';
import { createChatSession } from '/host/chat-session.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '/ui/pool-home/conversation-workspace.js';
import { createPartitionRuntimeFixture } from '/partition-runtime-fixture.js';

export async function start(index) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const policy = { maxTokens: 4, maxPromptTokens: 64, maxActivationBytes: 4096, maxOutputCharacters: 1024,
    maxAttempts: 64, maxConcurrentAttempts: 4 };
  const model = { id: 'partition-fixture', name: 'Injected partition model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), adapters: [] };
  const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128, splitLayer: 2 });
  const planId = await partitionFingerprint(plan);
  const state = { index, identity, model, plan, planId, session: null, chat: null, endpoint: null,
    held: false, entered: false, release: null, proofs: [] };
  const factory = state.factory = createPartitionRuntimeFixture({ beforeStep: async (_request, group) => {
    if (state.held && group === 1) { state.entered = true; await new Promise(resolve => { state.release = resolve; }); state.held = false; }
  } });
  const resident = state.resident = createResidentPartition({ runtime: factory, model, plan, planId, index,
    participantId: identity.peerId, limits: policy });
  await resident.prepare({ approved: true });
  const authority = state.authority = createPartitionGrantAuthority({ identity, meshId: 'browser-split', maxGrants: 64, maxTtlMs: 60000 });
  const pc = state.pc = new RTCPeerConnection({ iceServers: [] });
  const main = state.main = pc.createDataChannel('reploid', { negotiated: true, id: 0, ordered: true });
  const handlers = new Map(), auxiliary = new Map();
  const fingerprint = description => description.sdp.split(/\r?\n/).find(line => line.startsWith('a=fingerprint:sha-256 ')).slice(14);
  const transport = {
    _getPeerId: () => identity.peerId,
    getPeerBinding: () => main.readyState === 'open' ? { local: fingerprint(pc.localDescription), remote: fingerprint(pc.remoteDescription) } : null,
    sendToPeer: (_peerId, type, payload) => { if (main.readyState !== 'open') return false; main.send(JSON.stringify({ type, payload })); return true; },
    onMessage: (type, handler) => handlers.set(type, handler),
    onDataChannel(label, handler) { auxiliary.set(label, handler); return () => auxiliary.delete(label); },
    openDataChannel: (_peerId, label) => pc.createDataChannel(label, { ordered: true }),
  };
  main.addEventListener('message', ({ data }) => { const message = JSON.parse(data); handlers.get(message.type)?.(state.remoteId, message.payload); });
  pc.addEventListener('datachannel', ({ channel }) => {
    const handler = auxiliary.get(channel.label);
    if (handler) handler(state.remoteId, channel); else channel.close();
  });
  state.peerIdentity = createMeshPeerIdentity({ transport, getIdentity: () => identity,
    roomId: 'browser-split', timeoutMs: 10000, maxPending: 8 });
  state.network = createPartitionNetwork({ transport, maxPeers: 2, timeoutMs: 10000,
    verifyPeer: async (peerId, signal) => { const result = await state.peerIdentity.verify(peerId, signal); state.proofs.push(result); return result; },
    createEndpoint: ({ channel, remoteParticipantId }) => createPartitionPeer({ channel,
      localParticipantId: identity.peerId, remoteParticipantId, runtime, plan, planId, modelIdentity: model.identity,
      authority, contributor: index === 1 ? resident : null,
      limits: { maxFrameBytes: 64, maxControlBytes: 8192, maxPayloadBytes: 4096, maxPendingBytes: 32768,
        maxPendingRequests: 8, maxRequestsPerChannel: 512, maxBufferedBytes: 16384, maxTransferBytes: 1048576, timeoutMs: 10000 },
      receiverLimits: { maxAttempts: 64, maxSteps: 8 } }),
    onPeer: (_peerId, endpoint) => { state.endpoint = endpoint; },
  });
  state.describe = async type => {
    await pc.setLocalDescription(type === 'offer' ? await pc.createOffer() : await pc.createAnswer());
    if (pc.iceGatheringState !== 'complete') await new Promise(resolve => {
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
    });
    return pc.localDescription.toJSON();
  };
  state.mount = () => {
    state.disposeView?.();
    state.session = createChatSession({ partitions: state.chat, meshId: 'browser-split', participantId: identity.peerId,
      models: [model], service: { open() { throw new Error('Whole-model fallback forbidden'); } } });
    document.body.innerHTML = renderConversationWorkspace();
    state.disposeView = bindConversationWorkspace(document, state.session);
  };
  state.connect = async () => {
    const endpoint = await state.network.connect(state.remoteId);
    state.chat = createPartitionChat({ runtime, local: resident, remote: endpoint, authority, model, plan, planId, limits: policy, grantTtlMs: 60000 });
    await state.chat.refresh(); state.mount();
  };
  state.send = (content, threadId) => {
    const thread = threadId || state.session.createThread({ model: state.chat.getModels()[0] });
    state.session.send(thread, content).catch(() => {}); return thread;
  };
  state.approve = (threadId, remember = true) => {
    const attempt = state.session.getState().threads.find(thread => thread.id === threadId).attempts.at(-1);
    state.session.approve(threadId, attempt.id, attempt.approval.id, true, { remember });
  };
  state.snapshot = () => ({ log: structuredClone(factory.log), proofs: state.proofs,
    workspace: state.session?.getState(), peer: state.endpoint?.getState() });
  state.close = async () => {
    state.release?.(); state.disposeView?.();
    await state.session?.close(); await state.chat?.close(); await state.network.close();
    state.peerIdentity.close(); await resident.close(); authority.close(); pc.close();
  };
  return state;
}
