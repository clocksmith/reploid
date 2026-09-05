/** Physical-browser proof plumbing. All identities here have one internal operator. */
import { createSigningKeyPair, exportPublicKey } from '../../self/pool/inference-receipt.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { assertPackSession, assertPackReceipt } from '../../self/pool/executable-pack.js';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';

let key;
let supplier;
let ownId;
let transportLimits;
let faultMode = false;
const connections = new Map();
const injectedFaults = [];
const chunks = new Map();
let store;

export async function identity(peerId) {
  ownId = peerId;
  key = await createSigningKeyPair();
  return { peerId, publicKey: await exportPublicKey(key.publicKey) };
}

export async function configure({ authorization, index, inventory, limits, faulty }) {
  transportLimits = limits;
  faultMode = faulty === true;
  if (!inventory) return;
  for (const artifact of inventory.artifacts) {
    for (const chunkIndex of artifact.chunkIndexes) {
      const response = await fetch(`/bootstrap/${encodeURIComponent(ownId)}/${encodeURIComponent(artifact.artifactId)}/${chunkIndex}`);
      if (!response.ok) throw new Error(`Supplier bootstrap failed: ${response.status}`);
      chunks.set(`${artifact.artifactId}:${chunkIndex}`, new Uint8Array(await response.arrayBuffer()));
    }
  }
  supplier = await createPeerPackSupplier({ authorization, index, inventory, peerId: ownId, privateKey: key.privateKey,
    readChunk: async (id, chunk) => {
      const value = chunks.get(`${id}:${chunk.index}`);
      if (!value) throw new Error('Supplier does not hold this chunk');
      return value;
    } });
  return { inventory: supplier.inventory, heldChunks: chunks.size,
    heldBytes: [...chunks.values()].reduce((sum, bytes) => sum + bytes.length, 0) };
}

function installChannel(peerId, channel, pc) {
  const entry = connections.get(peerId);
  const install = () => {
    entry.transport = createPeerPackDataChannel({ channel, limits: transportLimits,
      serve: supplier ? async (request) => {
        if (faultMode && request.artifactId.startsWith('weight-shard:') && request.chunkIndex === 1) {
          injectedFaults.push({ type: 'supplier-departure', artifactId: request.artifactId, chunkIndex: 1 });
          pc.close();
          entry.transport.close('injected supplier departure');
          throw new Error('injected supplier departure');
        }
        const response = await supplier.serve(request);
        if (faultMode && request.artifactId.startsWith('weight-shard:') && request.chunkIndex === 0) {
          response.bytes[0] ^= 255;
          injectedFaults.push({ type: 'corrupt-contribution', artifactId: request.artifactId, chunkIndex: 0 });
        }
        return response;
      } : null });
  };
  if (channel.readyState === 'open') install();
  else channel.addEventListener('open', install, { once: true });
}

function connection(peerId) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const entry = { pc, transport: null };
  connections.set(peerId, entry);
  pc.addEventListener('datachannel', ({ channel }) => installChannel(peerId, channel, pc));
  return pc;
}

async function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return pc.localDescription.toJSON();
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', change);
      error ? reject(error) : resolve();
    };
    const change = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(() => finish(new Error('ICE gathering timeout')), transportLimits.timeoutMs);
    pc.addEventListener('icegatheringstatechange', change);
    change();
  });
  return pc.localDescription.toJSON();
}

export async function offer(peerId) {
  const pc = connection(peerId);
  installChannel(peerId, pc.createDataChannel('pack-custody', { ordered: true }), pc);
  await pc.setLocalDescription(await pc.createOffer());
  return gathered(pc);
}

export async function answer(peerId, description) {
  const pc = connection(peerId);
  await pc.setRemoteDescription(description);
  await pc.setLocalDescription(await pc.createAnswer());
  return gathered(pc);
}

export async function accept(peerId, description) {
  await connections.get(peerId).pc.setRemoteDescription(description);
}

export function ready() { return [...connections.values()].every((entry) => entry.transport !== null); }

export async function execute({ authorization, index, inventories, trustedSigners, sequence, options, dopplerVersion }) {
  const module = await import('/doppler/src/index-browser.js');
  const service = createReploidDopplerRuntimeService({ loadModule: async () => module, expectedVersion: dopplerVersion });
  const report = { passed: false, stage: 'peer-reconstruction', binding: authorization.pack };
  store = await createPeerPackArtifactStore({ authorization, index, inventories, requesterPrivateKey: key.privateKey,
    requestChunk: (peerId, request, limits) => connections.get(peerId).transport.requestChunk(request, limits) });
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter || adapter.isFallbackAdapter !== false) throw new Error('A confirmed non-fallback WebGPU adapter is required');
    report.isFallbackAdapter = adapter.isFallbackAdapter;
    const bytes = await store.readEnvelope();
    const pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    report.stage = 'public-pack-open';
    const session = await service.openPack({ scope: 'peer-proof', source: pack,
      options: { artifactStore: store, trustedSigners, acceptedTargetPlanDigests: authorization.pack.acceptedTargetPlanDigests } });
    await assertPackSession(authorization.pack, session);
    report.stage = 'complete-model-execution';
    const result = await session.encodeSequence(sequence, options);
    await assertPackReceipt(authorization.pack, result.receipt, { assignment: options.assignment, sequence, options, result });
    report.result = { ...result, tokens: Array.from(result.tokens), tokenMask: Array.from(result.tokenMask),
      tokenEmbeddings: Array.from(result.tokenEmbeddings), pooledEmbedding: Array.from(result.pooledEmbedding) };
    report.runtime = { device: session.deviceProfile, initialExecutionIdentity: session.observedInitialExecutionIdentity };
    report.manifest = session.manifest;
    report.stage = 'complete';
    report.passed = true;
  } catch (error) { report.error = error.message; }
  finally {
    await service.closeAll();
    report.custody = store.getReceipt();
    store.close();
  }
  return report;
}

export async function observations() {
  const peers = [];
  for (const [peerId, { pc, transport }] of connections) {
    const stats = await pc.getStats();
    peers.push({ peerId, transport: transport?.getReceipt(), connectionState: pc.connectionState,
      dataChannels: [...stats.values()].filter((row) => row.type === 'data-channel').map(({ bytesSent, bytesReceived, messagesSent, messagesReceived, state }) =>
        ({ bytesSent, bytesReceived, messagesSent, messagesReceived, state })) });
  }
  return { peerId: ownId, injectedFaults, peers };
}
