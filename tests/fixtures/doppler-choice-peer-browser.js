// Real signed decisions through the existing complete-request WebRTC protocol.
import * as api from 'doppler-gpu';
import { createDopplerChoiceScoringAdapter } from 'reploid/doppler';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { createPackPeerJob } from '../../self/pool/peer-pack-job.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { createPackOperationRegistry, PACK_OPERATION_IMPLEMENTATIONS } from '../../self/pool/pack-operation-adapters.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { packPeerIdentity } from './peer-pack-operation.js';
import poolConfig from '../../self/pool/pool-config.json' with { type: 'json' };

const scoring = createDopplerChoiceScoringAdapter(api);
const registry = createPackOperationRegistry({ definitions: { ...poolConfig.operations, scoreChoices: scoring.definition },
  implementations: { ...PACK_OPERATION_IMPLEMENTATIONS, [scoring.definition.adapterId]: scoring.implementation } });
const service = createReploidDopplerRuntimeService({ loadModule: async () => api, expectedVersion: api.DOPPLER_VERSION });
const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
let pc, bus, provider, requester, session, model, identity, ready;
let calls = 0;
const errors = [];

export async function start({ role, selectedModel, capsuleUrl, publicKey }) {
  if (role === 'provider') {
    const host = await import('doppler-gpu/host');
    session = await host.openCapsule(capsuleUrl, { trustedSigners: { 'local-choice-acceptance': publicKey }, requiredOperations: ['scoreChoices'] });
    const binding = { ...session.capsuleIdentity, artifacts: session.verification.capsule.artifacts,
      requiredOperation: 'scoreChoices', acceptedTargetPlanDigests: [session.selectedTargetPlanDigest] };
    model = { modelId: session.modelId, modelHash: binding.semanticRoot, manifestHash: binding.envelopeDigest,
      runtime: 'doppler', backend: 'browser-webgpu', executionMode: 'complete_pack_browser',
      workload: registry.scoreChoices.workload, runtimeVersion: api.DOPPLER_VERSION, executablePack: binding };
  } else model = selectedModel;
  identity = await packPeerIdentity();
  pc = new RTCPeerConnection({ iceServers: [] });
  let resolveReady;
  ready = new Promise(resolve => { resolveReady = resolve; });
  const install = channel => {
    const opened = () => {
      bus = createPackJobDataChannel({ channel });
      if (role === 'provider') {
        const executor = { async run({ input, options, assignment, limits, requestSchema, signal, onPartial, beforeExecute }) {
          calls++;
          return runPackOperation({ binding: model.executablePack, session, runtimeVersion: api.DOPPLER_VERSION,
            runtimeService: service, registry, signal, onPartial, beforeExecute,
            request: { schema: requestSchema, operation: { name: 'scoreChoices', version: 1 }, input, options, assignment, limits } });
        }, async close() {} };
        provider = createPackPeerProvider({ identity, bus, models: [model], registry, runtimeService: service,
          executor, authorize: () => true, onError: error => errors.push(error.message) });
      } else requester = createPackPeerRequester({ identity, bus, models: [model], registry,
        runtimeService: service, onError: error => errors.push(error.message) });
      resolveReady();
    };
    if (channel.readyState === 'open') opened(); else channel.addEventListener('open', opened, { once: true });
  };
  pc.addEventListener('datachannel', event => install(event.channel));
  if (role === 'requester') install(pc.createDataChannel('real-choice-jobs', { ordered: true }));
  return { model, deviceProfile: session?.deviceProfile ?? null, hasModelSession: !!session };
}
async function gathered() {
  if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ICE timeout')), 10000);
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
export async function advert() {
  await ready;
  return provider.createAdvert({ limits, expiresAt: Date.now() + 30000, capabilities: {
    schema: 'reploid.peer.capabilities/v1', observedAt: Date.now(), gpuIdentity: null,
    models: [{ identity: await hashDopplerEvidence(model), availability: 'resident' }], adapters: [], experts: [],
    operations: [{ name: 'scoreChoices', version: 1 }], inputClasses: ['public_text'],
    resources: { gpuBudgetBytes: 1420000000, gpuFreeBytes: null,
      storageBudgetBytes: model.executablePack.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
      storageFreeBytes: null, bandwidthBytesPerSecond: 1048576, concurrency: 1, activeJobs: 0, queuedJobs: 0 } } });
}
export async function run({ advert, row, tolerance }) {
  const reference = row.output;
  const request = { model, input: { prompt: row.input.prompt, choices: row.input.choices }, options: { maxSeqLen: row.input.maxSeqLen },
    limits: { ...limits, deadlineAt: Date.now() + 30000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [advert.fromPeerId] },
    resources: { gpuBytes: 1420000000, storageBytes: model.executablePack.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0), bandwidthBytesPerSecond: 0 },
    comparisonPolicy: { schema: 'poolday.operation-comparison/v1', operation: { name: 'scoreChoices', version: 1 },
      rule: 'numerical-tolerance', absoluteTolerance: tolerance, relativeTolerance: 0, referenceDigest: await hashDopplerEvidence(reference) }, reference };
  const job = await createPackPeerJob({ ...request, identity, adverts: [advert], registry });
  const result = await requester.runPrepared({ job, reference });
  return { accepted: result.assessment.accepted, execution: result.execution, accounting: result.accounting };
}
export function state() { return { calls, hasModelSession: !!session, errors, transport: bus?.getState(), requester: requester?.getState() }; }
export async function close() { requester?.close(); await provider?.close(); bus?.close(); pc?.close(); await session?.close(); await service.closeAll(); }
