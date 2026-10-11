/** Existing signed job protocol carried by an authenticated introduced channel. */
import { swarm } from './peer-introductions-browser.js';
import { packPeerIdentity, operationCapabilities } from './peer-pack-operation.js';
import { createPackJobDataChannel } from '../../self/pool/peer-pack-job-channel.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerRequester } from '../../self/pool/peer-pack-requester.js';
import { packPeerModel } from '../../self/pool/peer-pack-job.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

let identity, physical, provider, requester, bus, execution, unregister;
let permitted = false, calls = 0;
const errors = [];
const positions = [0, 1, 2];
const limits = { maxInputBytes: 1048576, maxOutputBytes: 1048576,
  maxStreamBytes: 4194304, maxEvents: 32, maxJobMs: 180000 };
const wireLimits = { maxTransferBytes: 4194304, timeoutMs: 10000 };
const subset = value => positions.map(index => value[index]);
const openChannel = channel => new Promise((resolve, reject) => {
  if (channel.readyState === 'open') { resolve(); return; }
  const finish = error => {
    clearTimeout(timer); channel.removeEventListener('open', opened); channel.removeEventListener('close', closed);
    error ? reject(error) : resolve();
  };
  const opened = () => finish(), closed = () => finish(new Error('Introduced job channel closed'));
  const timer = setTimeout(() => finish(new Error('Introduced job channel opening timed out')), wireLimits.timeoutMs);
  channel.addEventListener('open', opened, { once: true }); channel.addEventListener('close', closed, { once: true });
});
export async function prepareRequester() { identity = await packPeerIdentity(); return { keyId: identity.keyId }; }
export async function prepareProvider({ requesterId, remotePeerId, approveModelOpening }) {
  if (approveModelOpening !== true) throw new Error('Explicit model opening grant required');
  identity = await packPeerIdentity();
  const { startPhysical } = await import('./independent-units-physical.js');
  physical = await startPhysical(null, async (_saved, qualified) => {
    execution = qualified;
    const input = { texts: subset(execution.texts), application: execution.inputApplication };
    const inputDigest = await hashDopplerEvidence(input);
    unregister = swarm.onDataChannel('reploid-jobs', (remote, channel) => {
      if (remote !== remotePeerId || bus) { channel.close(); return; }
      bus = createPackJobDataChannel({ channel, ...wireLimits });
      provider = createPackPeerProvider({ identity, bus, models: [execution.model],
        authorize: async job => permitted && job.fromPeerId === requesterId
          && await hashDopplerEvidence(job.body.request.input) === inputDigest,
        executor: { async run(request) {
          calls++;
          await execution.validateApplication(execution.application, {
            model: packPeerModel(execution.model), input: request.input });
          return execution.run(request);
        }, async close() {} }, onError: error => errors.push(error.message) });
    });
    return { async close() { unregister?.(); await provider?.close(); } };
  });
  return { model: execution.model, resources: execution.resources,
    gpu: physical.gpu, semantics: physical.semantics, positions, releaseCheckpoint: physical.releaseCheckpoint };
}
export async function connectRequester({ remotePeerId, model }) {
  const channel = swarm.openDataChannel(remotePeerId, 'reploid-jobs');
  await openChannel(channel);
  bus = createPackJobDataChannel({ channel, ...wireLimits });
  requester = createPackPeerRequester({ identity, bus, models: [model],
    onError: error => errors.push(error.message) });
}
export const ready = () => !!provider || !!requester;
export const allowComputation = value => { permitted = value === true; };
export async function advert() {
  const capabilities = await operationCapabilities(packPeerModel(execution.model));
  Object.assign(capabilities.resources, { gpuBudgetBytes: execution.resources.gpuBytes,
    storageBudgetBytes: execution.resources.storageBytes });
  return provider.createAdvert({ limits, capabilities, expiresAt: Date.now() + 180000 });
}
export async function run(advert, descriptor, approved, signal) {
  const { reference, config } = await (await fetch('/physical/config.json')).json();
  const output = { embeddings: subset(reference.outputs).map(row => ({ embedding: row.embedding, tokens: row.tokenIds })) };
  const result = await requester.run({ advert, model: descriptor.model, resources: descriptor.resources, signal,
    input: { texts: subset(reference.input.texts), application: config.application }, options: {},
    limits: { ...limits, deadlineAt: Date.now() + 180000 },
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: approved === true,
      providerIds: [advert.fromPeerId] }, reference: output,
    comparisonPolicy: { schema: 'poolday.operation-comparison/v1', operation: { name: 'embed', version: 1 },
      referenceDigest: await hashDopplerEvidence(output), rule: 'numerical-tolerance',
      absoluteTolerance: reference.tolerances.embeddingMaxAbs, relativeTolerance: 0 } });
  const { evaluateEmbeddingReference } = await import('/src/config/embedding-reference.js');
  const selected = { ...reference, input: { ...reference.input, texts: subset(reference.input.texts) }, outputs: subset(reference.outputs) };
  const outputs = result.execution.output.embeddings.map((row, index) => ({ text: selected.input.texts[index],
    tokenIds: row.tokens, embedding: row.embedding }));
  return { result, comparison: evaluateEmbeddingReference(selected, { input: selected.input,
    embeddingContract: selected.embeddingContract, outputs }), originalReferenceDigest: config.application.oracle.digest,
    positions, transport: bus.getState() };
}
export const status = () => ({ calls, permitted, errors, transport: bus?.getState(),
  buffers: physical?.buffers(), releaseCheckpoint: physical?.releaseCheckpoint });
export async function close() { requester?.close(); await physical?.close(); bus?.close(); }
