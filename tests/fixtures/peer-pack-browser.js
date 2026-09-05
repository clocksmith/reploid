/** Physical-browser proof plumbing. All identities here have one internal operator. */
import { createSigningKeyPair, exportPublicKey } from '../../self/pool/inference-receipt.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../../self/pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { assertPackSession } from '../../self/pool/executable-pack.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
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

export function assertPhysicalAdapter(adapter) {
  const fallback = adapter?.info?.isFallbackAdapter ?? adapter?.isFallbackAdapter;
  if (fallback !== false || adapter?.isFallbackAdapter === true) {
    throw new Error('A confirmed non-fallback WebGPU adapter is required');
  }
  return fallback;
}

export async function execute({ authorization, index, inventories, trustedSigners, sequence, options, dopplerVersion, operationLimits }) {
  const module = await import('/doppler/src/index-browser.js');
  const service = createReploidDopplerRuntimeService({ loadModule: async () => module, expectedVersion: dopplerVersion });
  const report = { passed: false, stage: 'peer-reconstruction', binding: authorization.pack };
  store = await createPeerPackArtifactStore({ authorization, index, inventories, requesterPrivateKey: key.privateKey,
    requestChunk: (peerId, request, limits) => connections.get(peerId).transport.requestChunk(request, limits) });
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    report.isFallbackAdapter = assertPhysicalAdapter(adapter);
    const bytes = await store.readEnvelope();
    const pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // Retain every declared artifact, including distinct paths with identical
    // bytes. Runtime content deduplication alone does not reconstruct a full Pack.
    const materialized = new Map();
    for (const artifact of pack.artifacts) materialized.set(artifact.artifactId, await store.readArtifact(artifact));
    const artifactStore = { async readArtifact(artifact) {
      const bytes = materialized.get(artifact.artifactId);
      if (!bytes) throw new Error('Artifact is absent from the reconstructed Pack');
      return bytes.slice();
    } };
    report.stage = 'public-pack-open';
    const session = await service.openPack({ scope: 'peer-proof', source: pack,
      options: { artifactStore, trustedSigners, acceptedTargetPlanDigests: authorization.pack.acceptedTargetPlanDigests } });
    await assertPackSession(authorization.pack, session);
    report.stage = 'complete-model-execution';
    const { assignment, ...operationOptions } = options;
    report.operationExecution = await runPackOperation({ binding: authorization.pack, session, runtimeVersion: dopplerVersion,
      request: { schema: 'doppler.pack-operation-request/v1', operation: { name: 'encodeSequence', version: 1 },
        input: { sequence }, options: operationOptions, assignment,
        limits: { ...operationLimits, deadlineAt: authorization.expiresAt } } });
    report.result = { ...report.operationExecution.output, receipt: report.operationExecution.receipt };
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
