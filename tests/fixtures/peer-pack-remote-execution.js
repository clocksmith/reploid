/** Internal physical-model episode plumbing; no substituted model outputs. */
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';

let pc, bus, provider, requester, identity, model, fixture, ready, release, completed;
let calls = 0, dropped = 0, providerReplacements = 0, replacing = Promise.resolve();
const errors = [];
const limits = { maxInputBytes: 65536, maxOutputBytes: 4194304, maxStreamBytes: 16 * 1024 * 1024, maxEvents: 256, maxJobMs: 120000 };

async function start(role, pin, options = {}) {
  model = pin; fixture = options;
  const keys = await createSigningKeyPair();
  const publicKey = await exportPublicKey(keys.publicKey);
  identity = { publicKey, privateKey: keys.privateKey,
    keyId: await sha256Hex(Uint8Array.from(atob(publicKey), value => value.charCodeAt(0))) };
  pc = new RTCPeerConnection({ iceServers: [] });
  let resolve;
  ready = new Promise(done => { resolve = done; });
  const install = channel => {
    let installed = false;
    const opened = () => {
      if (installed) return;
      installed = true;
      bus = createPackJobDataChannel({ channel });
      if (role === 'provider') {
        const providerBus = { ...bus, async send(message) {
          if (fixture.dropFirstCompletion && message.body?.status === 'completed' && dropped === 0) {
            dropped++;
            // Discard the provider's memory replay map after the committed result.
            // The model stays open; retry must restore the native durable journal.
            replacing = Promise.resolve().then(async () => {
              await provider.close();
              installProvider(); providerReplacements++;
            });
            replacing.catch(error => errors.push(error.message));
            return;
          }
          return bus.send(message);
        } };
        const installProvider = () => { provider = createPackPeerProvider({ identity, bus: providerBus, models: [model],
          authorize: job => job.body.request.input.sequence === fixture.sequence
            && job.body.request.options.includeTokenEmbeddings === true && job.body.request.options.includeLogits === false,
          executor: { async run(request) {
            calls++;
            const result = await fixture.peer.run({ schema: 'doppler.pack-operation-request/v1',
              operation: { name: 'encodeSequence', version: 1 }, input: request.input, options: request.options,
              assignment: request.assignment, limits: request.limits }, { signal: request.signal, onPartial: request.onPartial, beforeExecute: request.beforeExecute });
            completed = result;
            return result;
          }, async close() {} }, onError: error => errors.push(error.message) }); };
        installProvider();
      } else requester = createPackPeerRequester({ identity, bus, models: [model], onError: error => errors.push(error.message) });
      resolve();
    };
    if (channel.readyState === 'open') opened();
    else channel.addEventListener('open', opened, { once: true });
  };
  pc.addEventListener('datachannel', event => install(event.channel));
  if (role === 'requester') install(pc.createDataChannel('actual-pack-job', { ordered: true }));
}
export async function startProvider(pin, options) {
  await start('provider', pin, options);
  return new Promise(resolve => { release = resolve; });
}
export async function startRequester(pin, options) { await start('requester', pin, options); }
export function isReady() { return !!pc; }
async function gathered() {
  if (pc.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('remote operation ICE timeout')), 10000);
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
  const capabilities = { schema: 'reploid.peer.capabilities/v1', observedAt: Date.now(), gpuIdentity: fixture.gpuIdentity,
    models: [{ identity: await hashDopplerEvidence(model), availability: 'resident' }], adapters: [], experts: [],
    operations: [{ name: model.executablePack.requiredOperation, version: 1 }], inputClasses: ['public_biological_sequence'],
    resources: fixture.resources.provider };
  return provider.createAdvert({ limits, capabilities, expiresAt: Date.now() + 120000 });
}
export async function run(advert) {
  const started = performance.now();
  const result = await requester.run({ advert, model, resources: fixture.resources.request, input: { sequence: fixture.sequence },
    options: { includeTokenEmbeddings: true, includeLogits: false }, limits: { ...limits, deadlineAt: Date.now() + 120000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [advert.fromPeerId] },
    reference: fixture.reference, comparisonPolicy: { schema: 'poolday.operation-comparison/v1',
      operation: { name: 'encodeSequence', version: 1 }, referenceDigest: await hashDopplerEvidence(fixture.reference),
      rule: 'numerical-tolerance', absoluteTolerance: 0.001, relativeTolerance: 0 } });
  return { ...result, elapsedMs: performance.now() - started, transport: bus.getState(), errors };
}
export async function finish() {
  await replacing;
  const journal = await provider?.getJournalStats();
  requester?.close(); await provider?.close();
  const state = { calls, droppedCompletions: dropped, providerReplacements, journal, transport: bus?.getState(), errors,
    executionReceiptDigest: completed?.receipt.receiptDigest ?? null };
  bus?.close(); pc?.close(); release?.(state);
  return state;
}
