/** Two-browser-context WebRTC protocol fixture. Model outputs are synthetic. */
import { operationFixture, operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createPackPeerJob } from '../../self/pool/peer-pack-job.js';
import { runPeerOperationJob } from '../../self/pool/peer-room.js';

let pc, bus, provider, requester, fixture, identity, ready;
const errors = [];
const limits = { maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024,
  maxStreamBytes: 8 * 1024 * 1024, maxEvents: 128, maxJobMs: 30000 };
export async function start({ role, operation, large = false }) {
  fixture = await operationFixture(operation);
  identity = await packPeerIdentity();
  if (large) {
    fixture.input.texts[0] = 'public test text '.repeat(20000);
    fixture.output.embeddings[0].embedding = Array(70000).fill(0.5);
    fixture.policy.referenceDigest = await hashDopplerEvidence(fixture.output);
  }
  pc = new RTCPeerConnection({ iceServers: [] });
  let resolve;
  ready = new Promise(done => { resolve = done; });
  const install = channel => {
    const opened = () => {
      bus = createPackJobDataChannel({ channel });
      if (role === 'provider') provider = createPackPeerProvider({ identity, bus, models: [fixture.model],
        executor: fixture.executor, authorize: () => true, onError: error => errors.push(error.message) });
      else requester = createPackPeerRequester({ identity, bus, models: [fixture.model],
        onError: error => errors.push(error.message) });
      resolve();
    };
    if (channel.readyState === 'open') opened(); else channel.addEventListener('open', opened, { once: true });
  };
  pc.addEventListener('datachannel', event => install(event.channel));
  if (role === 'requester') install(pc.createDataChannel('pack-jobs', { ordered: true }));
  return { keyId: identity.keyId };
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
export async function advert() { await ready; return provider.createAdvert({ limits, capabilities: await operationCapabilities(fixture.model), expiresAt: Date.now() + 30000 }); }
export async function run(advert) {
  const request = { model: fixture.model, input: fixture.input, options: fixture.options,
    limits: { ...limits, deadlineAt: Date.now() + 30000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [advert.fromPeerId] },
    resources: operationResources, comparisonPolicy: fixture.policy, reference: fixture.output };
  const result = await runPeerOperationJob({ request, providerAdverts: [advert],
    requesterClient: { createPeerOperationJob: options => createPackPeerJob({ ...options, identity }),
      createPeerPackRequester: () => requester },
    connectTransport: async ({ providerId }) => {
      if (providerId !== advert.fromPeerId) throw new Error('Wrong planned provider');
      return { bus, close() { bus.close(); pc.close(); } };
    } });
  return { accepted: result.assessment.accepted, receiptDigest: result.execution.receipt.receiptDigest,
    operation: result.execution.request.operation, accounting: result.accounting, transport: bus.getState(), errors };
}
export function state() { return { calls: fixture.calls(), transport: bus.getState(), errors }; }
export async function close() { requester?.close(); await provider?.close(); bus?.close(); pc?.close(); }
