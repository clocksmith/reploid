// Installed agent and Doppler, injected model programs, native WebRTC and IndexedDB.
import * as doppler from 'doppler-gpu';
import { createReploid } from 'reploid';
import { resolveConfig } from 'reploid/config';
import { createDopplerProvider } from 'reploid/doppler';
import { createIndexedDbStore } from 'reploid/browser';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackPeerJob } from '../../self/pool/peer-pack-job.js';
import { runPeerOperationJob, resumePeerOperationJob } from '../../self/pool/peer-room.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';
import { exportPrivateKey, importPrivateKey } from '../../self/pool/inference-receipt.js';
import { createP2PTransport } from '../../self/pool/p2p-transport.js';
import { SIGNAL_TYPES } from '../../self/pool/p2p-signaling.js';

const registry = createPackOperationRegistry();
const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 500000, maxEvents: 32, maxJobMs: 120000 };
const options = { maxTokens: 3, maxSeqLen: 16, temperature: 0, topP: 1, topK: 0,
  repetitionPenalty: 1, repetitionPenaltyWindow: 1, presencePenalty: 0, useChatTemplate: false, seed: 0 };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let role, store, identity, service, session, binding, model, provider, agent, language;
let pc, transport, bus, signal, ready, description, resolveDescription, channelReady;
let calls = 0, signed = 0, dropped = false, recovered = false, resumed = false, text = '';
let completed = null;
const reconnect = deferred(), errors = [], progress = [], order = [], displayed = new Map();

export async function start(value) {
  role = value;
  store = createIndexedDbStore({ databaseName: `agent-peer-${role}`, storeName: 'host', version: 1, openTimeoutMs: 5000 });
  const keys = await store.get('identity');
  if (keys) identity = { ...keys, privateKey: await importPrivateKey(keys.privateKey) };
  else {
    identity = await packPeerIdentity();
    // Test credentials stay in this disposable browser profile, outside evidence.
    await store.set('identity', { ...identity, privateKey: await exportPrivateKey(identity.privateKey) });
  }
  recovered = await store.get('completion-dropped') === true;
  const fixture = await (await fetch('/installed/generation-fixture.json')).json();
  const artifacts = new Map(fixture.artifacts.map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  let chunks = ['Saved ', 'peer ', 'answer.'];
  service = createReploidDopplerRuntimeService({ loadModule: async () => doppler, expectedVersion: doppler.DOPPLER_VERSION });
  session = await service.openCapsule({ scope: role, source: fixture.capsule, options: {
    device: { getDevice: () => ({ limits: { maxBufferSize: 1024 }, createBuffer: () => ({ destroy() {} }),
      createCommandEncoder() {}, queue: { writeBuffer() {} } }),
      getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
    artifactStore: { readArtifact: async artifact => artifacts.get(artifact.artifactId) }, trustedSigners: fixture.trustedSigners,
    programFactory: async () => ({ executionGraphHash: fixture.capsule.program.executionGraphHash,
      tokenize(prompt) {
        if (role === 'requester') chunks = String(prompt).includes('Saved peer answer.')
          ? ['REPLOID/0\n', 'IDLE: Used verified ', 'Saved peer answer.']
          : ['REPLOID/0\n', 'TOOL: AskPeer\n', 'taskId: approved'];
        return [0, 2];
      },
      decodeTokens: ids => chunks.slice(0, ids.length).join(''), getTokenContract: () => ({}),
      createIncrementalDecoder() { let index = 0; return {
        push() { return chunks[index++] || ''; }, pendingText: () => '', finish: () => '' }; },
      reset() {}, getActiveAdapterIdentity: () => null,
      executePhase: async () => ({ logits: new Float32Array([3, 2, 1]) }), releaseStepResult() {}, close() {}
    })
  } });
  binding = { ...session.capsuleIdentity, artifacts: fixture.capsule.artifacts, requiredOperation: 'generate',
    acceptedTargetPlanDigests: [session.selectedTargetPlanDigest] };
  model = { modelId: session.modelId, modelHash: binding.semanticRoot, manifestHash: binding.envelopeDigest,
    runtime: 'doppler', backend: 'browser-webgpu', executionMode: 'complete_pack_browser',
    workload: registry.generate.workload, runtimeVersion: doppler.DOPPLER_VERSION, executablePack: binding };
  openConnection();
}

export function openConnection() {
  channelReady = deferred();
  description = new Promise(resolve => { resolveDescription = resolve; });
  transport = createP2PTransport({ initiator: role === 'requester', rtcConfig: { iceServers: [] },
    dataChannelLabel: 'agent-durable-peer', dataChannelOptions: { ordered: true },
    onPeerConnection: connection => { pc = connection; },
    onDataChannel(channel) {
      const opened = () => {
        bus = createPackJobDataChannel({ channel });
        if (role === 'provider') provider = createPackPeerProvider({ identity, models: [model], registry,
          runtimeService: service, authorize: job => job.body.request.input.prompt === 'Approved public task.',
          onError: error => errors.push(error.message),
          bus: { subscribe: listener => bus.subscribe(listener), async send(message) {
            if (!recovered && !dropped && message.body.status === 'completed') {
              await store.set('completion-dropped', true); dropped = true; return;
            }
            return bus.send(message);
          } },
          executor: { async run({ input, options, assignment, limits, requestSchema, signal, onPartial, beforeExecute }) {
            calls++;
            return runPackOperation({ binding, session, runtimeVersion: doppler.DOPPLER_VERSION, runtimeService: service,
              request: { schema: requestSchema, operation: { name: 'generate', version: 1 }, input, options, assignment, limits },
              signal, onPartial, beforeExecute });
          }, async close() {} }
        });
        channelReady.resolve();
      };
      if (channel.readyState === 'open') opened(); else channel.addEventListener('open', opened, { once: true });
    },
    signaling: { subscribe: listener => { signal = listener; return () => { signal = null; }; },
      sendOffer: value => resolveDescription(value), sendAnswer: value => resolveDescription(value),
      sendIceCandidate() {}, sendClose() {} }
  });
  ready = Promise.all([transport.connect(), channelReady.promise]);
  ready.catch(error => errors.push(error.message));
}
async function gathered() {
  if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', changed); reject(new Error('ICE timeout')); }, 10000);
    const changed = () => { if (pc.iceGatheringState === 'complete') {
      clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); resolve();
    } };
    pc.addEventListener('icegatheringstatechange', changed); changed();
  });
  return pc.localDescription.toJSON();
}
export async function offer() { await description; return gathered(); }
export async function answer(value) { signal({ type: SIGNAL_TYPES.OFFER, payload: value }); await description; return gathered(); }
export async function accept(value, recovery = false) {
  signal({ type: SIGNAL_TYPES.ANSWER, payload: value }); await ready;
  if (recovery) reconnect.resolve();
}
export async function advert() { await ready; return provider.createAdvert({ limits,
  capabilities: await operationCapabilities(model), expiresAt: Date.now() + limits.maxJobMs }); }

export async function runAgent(advert) {
  const contract = Object.fromEntries(['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].map(key => [key, session[key]]));
  contract.runtimeVersion = doppler.DOPPLER_VERSION;
  const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract }, tools: { allowed: ['AskPeer'] },
    agent: { maxCycles: 3 } } });
  language = createDopplerProvider({ config, session, ownership: 'borrowed', runtime: doppler,
    toOperationRequest: messages => ({ schema: 'doppler.capsule-operation-request/v2', operation: { name: 'generate', version: 1 },
      input: { prompt: JSON.stringify(messages) }, options, assignment: { id: 'local-agent', attempt: 1 },
      limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt: Date.now() + limits.maxJobMs } }) });
  const requesterClient = {
    createPeerOperationJob(value) { signed++; return createPackPeerJob({ ...value, identity }); },
    createPeerPackRequester: value => createPackPeerRequester({ ...value, identity, runtimeService: service })
  };
  const connectTransport = async () => { await ready; order.push('connected');
    const connection = transport, channel = bus;
    return { bus: channel, close() { channel.close(); connection.close(); } }; };
  const onPartial = async event => {
    if (displayed.has(event.eventIndex)) {
      if (displayed.get(event.eventIndex) !== event.eventDigest) throw new Error('Conflicting display replay');
      return;
    }
    displayed.set(event.eventIndex, event.eventDigest);
    const addition = event.delta.text || '';
    text += addition; progress.push(addition); order.push('progress');
    document.querySelector('#progress').append(document.createTextNode(addition));
    // Await display completion to exercise producer backpressure.
    await new Promise(resolve => setTimeout(resolve, 5));
  };
  const approve = job => {
    if (job.toPeerId !== advert.fromPeerId || job.body.request.input.prompt !== 'Approved public task.') {
      throw new Error('Host denied recipient or payload');
    }
    order.push('approved');
  };
  agent = createReploid({ config, ports: { instanceId: 'installed-peer-agent', providers: { doppler: language },
    authorize: request => request.action === 'agent.execute' || (request.action === 'tool.execute'
      && request.name === 'AskPeer' && request.args.taskId === 'approved'),
    tools: { async AskPeer(args, { signal }) {
      if (args.taskId !== 'approved') throw new Error('Unknown task');
      const request = { model, input: { prompt: 'Approved public task.' }, options, requestSchema: 'doppler.capsule-operation-request/v2',
        limits: { ...limits, deadlineAt: Date.now() + limits.maxJobMs }, resources: operationResources,
        consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [advert.fromPeerId] },
        acceptanceMode: 'execution', comparisonPolicy: null, reference: null };
      try {
        const saved = await store.get('prepared');
        if (saved) {
          approve(saved);
          completed = await resumePeerOperationJob({ requesterClient, job: saved, model, reference: null, connectTransport, signal, onPartial });
        } else {
          completed = await runPeerOperationJob({ requesterClient, request, providerAdverts: [advert], connectTransport, signal, onPartial,
            async onPrepared(job) { approve(job); await store.set('prepared', job); order.push('persisted'); } });
        }
      } catch (error) {
        if (error.code !== 'PACK_TRANSPORT_DISCONNECTED' || signal.aborted) throw error;
        order.push('disconnected');
        await reconnect.promise;
        signal.throwIfAborted();
        const job = await store.get('prepared'); approve(job);
        order.push('resuming');
        completed = await resumePeerOperationJob({ requesterClient, job, model, reference: null, connectTransport, signal, onPartial });
        resumed = true;
      }
      await verifyPackPeerEpisode({ ...completed, reference: null, models: [model], runtimeService: service });
      await store.set('accepted', completed); order.push('accepted');
      return { text: completed.execution.output.text, outputHash: completed.execution.receipt.outputHash };
    } }
  } });
  await agent.execute({ goal: 'Use the approved peer task, then report its saved answer.' });
  return { state: agent.getSnapshot(), result: completed, text, progress, order, resumed, signed };
}
export function state() { return { calls, dropped, recovered, errors, active: provider?.getState().active,
  text, progress, order, resumed, signed, providerId: identity.keyId, model, agent: agent?.getSnapshot(), channel: bus?.getState() }; }
export async function close() { await agent?.close(); await language?.close(); await provider?.close();
  bus?.close(); transport?.close(); await service?.closeAll(); await store?.close(); }
