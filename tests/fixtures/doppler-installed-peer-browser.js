// Installed public Doppler with injected logits, real WebRTC, signatures and IndexedDB.
import * as api from 'doppler-gpu';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';

let pc, channelBus, provider, requester, session, service, model, identity, ready, replacement;
let calls = 0, replacements = 0, dropped = false;
const errors = [];
const registry = createPackOperationRegistry();
const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000,
  maxEvents: 32, maxJobMs: 30000 };

export async function start(role) {
  const fixture = await (await fetch('/installed/generation-fixture.json')).json();
  const artifacts = new Map(fixture.artifacts.map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  const device = { limits: { maxBufferSize: 1024 }, createBuffer: () => ({ destroy() {} }),
    createCommandEncoder() {}, queue: { writeBuffer() {} } };
  service = createReploidDopplerRuntimeService({ loadModule: async () => api, expectedVersion: api.DOPPLER_VERSION });
  session = await service.openCapsule({ scope: 'browser-stream', source: fixture.capsule, options: {
    device: { getDevice: () => device,
      getProfile: () => ({ surface: 'test-webgpu', hasF16: false, hasSubgroups: false, maxBufferSize: 1024 }) },
    artifactStore: { readArtifact: async artifact => artifacts.get(artifact.artifactId) },
    trustedSigners: fixture.trustedSigners,
    programFactory: async () => ({ executionGraphHash: fixture.capsule.program.executionGraphHash,
      tokenize: () => [0, 2], decodeTokens: ids => ids.join(','), getTokenContract: () => ({}),
      createIncrementalDecoder() { let first = true; return {
        push(id) { const text = `${first ? '' : ','}${id}`; first = false; return text; },
        pendingText: () => '', finish: () => '' }; },
      reset() {}, getActiveAdapterIdentity: () => null,
      executePhase: async () => ({ logits: new Float32Array([3, 2, 1]) }),
      releaseStepResult() {}, close() {},
    }),
  } });
  const binding = { ...session.capsuleIdentity, artifacts: fixture.capsule.artifacts,
    requiredOperation: 'generate', acceptedTargetPlanDigests: [session.selectedTargetPlanDigest] };
  model = { modelId: session.modelId, modelHash: binding.semanticRoot, manifestHash: binding.envelopeDigest,
    runtime: 'doppler', backend: 'browser-webgpu', executionMode: 'complete_pack_browser',
    workload: registry.generate.workload, runtimeVersion: api.DOPPLER_VERSION, executablePack: binding };
  identity = await packPeerIdentity();
  pc = new RTCPeerConnection({ iceServers: [] });
  let resolve;
  ready = new Promise(done => { resolve = done; });
  const install = channel => {
    const opened = () => {
      channelBus = createPackJobDataChannel({ channel });
      if (role === 'provider') {
        const executor = { async run({ input, options, assignment, limits, requestSchema, signal, onPartial, beforeExecute }) {
          calls++;
          return runPackOperation({ binding, session, runtimeVersion: api.DOPPLER_VERSION, runtimeService: service,
            request: { schema: requestSchema, operation: { name: 'generate', version: 1 }, input, options, assignment, limits },
            signal, onPartial, beforeExecute });
        }, async close() {} };
        const bus = { subscribe: listener => channelBus.subscribe(listener), async send(message) {
          if (!dropped && message.body.status === 'completed') {
            dropped = true;
            // Let the active operation settle before replacing its provider owner.
            replacement = (async () => {
              await new Promise(resolve => setTimeout(resolve, 0));
              await provider.close(); provider = createProvider(); replacements++;
            })();
            replacement.catch(error => errors.push(error.message));
            return;
          }
          await channelBus.send(message);
        } };
        const createProvider = () => createPackPeerProvider({ identity, bus, models: [model], registry,
          executor, runtimeService: service, authorize: () => true, onError: error => errors.push(error.message) });
        provider = createProvider();
      } else requester = createPackPeerRequester({ identity, bus: channelBus, models: [model], registry,
        runtimeService: service, onError: error => errors.push(error.message) });
      resolve();
    };
    if (channel.readyState === 'open') opened(); else channel.addEventListener('open', opened, { once: true });
  };
  pc.addEventListener('datachannel', event => install(event.channel));
  if (role === 'requester') install(pc.createDataChannel('installed-stream', { ordered: true }));
}

async function gathered() {
  if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ICE gathering timeout')), 10000);
    const change = () => { if (pc.iceGatheringState === 'complete') {
      clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); resolve();
    } };
    pc.addEventListener('icegatheringstatechange', change); change();
  });
  return pc.localDescription.toJSON();
}
export async function offer() { await pc.setLocalDescription(await pc.createOffer()); return gathered(); }
export async function answer(offer) { await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); return gathered(); }
export async function accept(answer) { await pc.setRemoteDescription(answer); await ready; }
export async function advert() { await ready; return provider.createAdvert({ limits,
  capabilities: await operationCapabilities(model), expiresAt: Date.now() + 30000 }); }
export async function run(advert) {
  const partials = [];
  const result = await requester.run({ advert, model, input: { promptTokens: [0, 2] },
    options: { maxTokens: 3, maxSeqLen: 16, temperature: 0, topP: 1, topK: 0,
      repetitionPenalty: 1, repetitionPenaltyWindow: 1, presencePenalty: 2, useChatTemplate: false, seed: 0 },
    requestSchema: 'doppler.capsule-operation-request/v2', limits: { ...limits, deadlineAt: Date.now() + 30000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [advert.fromPeerId] },
    acceptanceMode: 'execution', comparisonPolicy: null, reference: null, resources: operationResources,
    onPartial: event => partials.push(event.delta) });
  const replay = await verifyPackPeerEpisode({ job: result.job, updates: result.updates, acceptance: result.acceptance,
    reference: null, models: [model], registry, runtimeService: service });
  return { execution: result.execution, partials, accounting: result.accounting, replay,
    transport: channelBus.getState(), errors };
}
export async function state() { await replacement; return { calls, replacements, dropped,
  journal: await provider.getJournalStats(), transport: channelBus.getState(), errors }; }
export async function close() { await replacement; requester?.close(); await provider?.close();
  channelBus?.close(); pc?.close(); await service?.closeAll(); }
