/** Physical-browser proof plumbing. All identities here have one internal operator. */
import { createSigningKeyPair, exportPublicKey, exportPrivateKey, importSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { createPeerPackSupplier } from '../../self/pool/peer-pack-custody.js';
import { openPeerPack } from '../../self/pool/peer-pack-session.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';

let key;
let supplier;
let ownId;
let transportLimits;
let faultMode = false;
let firstWeightArtifact = null;
const connections = new Map();
const injectedFaults = [];
const chunks = new Map();

export async function identity(peerId, restored = null) {
  ownId = peerId;
  key = restored ? await importSigningKeyPair(restored) : await createSigningKeyPair();
  return { peerId, publicKey: await exportPublicKey(key.publicKey) };
}

// Internal fixture keys cross the process boundary in coordinator memory only.
// They are never written to the episode, a configuration, or an evidence archive.
export async function retainIdentityForRestart() {
  return { privateKey: await exportPrivateKey(key.privateKey), publicKey: await exportPublicKey(key.publicKey) };
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
        if (faultMode && request.artifactId.startsWith('weight-shard:')) firstWeightArtifact ??= request.artifactId;
        // Finish the first artifact before disconnecting on the next one, so
        // parallel requests cannot erase the earlier corrupt-contribution test.
        if (faultMode && request.artifactId.startsWith('weight-shard:')
          && request.artifactId !== firstWeightArtifact && request.chunkIndex === 1) {
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
  const previous = connections.get(peerId);
  previous?.transport?.close('requester reconnected');
  previous?.pc.close();
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

export async function execute({ authorization, index, inventories, trustedSigners, sequence, options, dopplerVersion, operationLimits,
  interruptAfterWeightResponses = null }) {
  const api = await import('/doppler/src/client/doppler-api.browser.js');
  const { DOPPLER_VERSION } = await import('/doppler/src/version.js');
  const module = { ...api, DOPPLER_VERSION };
  const service = createReploidDopplerRuntimeService({ loadModule: async () => module, expectedVersion: dopplerVersion });
  const report = { passed: false, stage: 'peer-reconstruction', binding: authorization.pack };
  let peer;
  let weightResponses = 0;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    report.isFallbackAdapter = assertPhysicalAdapter(adapter);
    report.stage = 'public-pack-open';
    peer = await openPeerPack({ authorization, index, inventories, requesterPrivateKey: key.privateKey,
      requestChunk: async (peerId, request, limits) => {
        if (interruptAfterWeightResponses !== null && weightResponses >= interruptAfterWeightResponses) {
          report.injectedDisconnection = { weightResponses };
          throw new Error('injected requester connection interruption');
        }
        const response = await connections.get(peerId).transport.requestChunk(request, limits);
        if (request.artifactId.startsWith('weight-shard:')) weightResponses++;
        return response;
      },
      trustedSigners, runtimeVersion: dopplerVersion, service, scope: 'peer-proof',
      maxCacheBytes: authorization.limits.maxTransferBytes,
      maxConcurrentChunks: authorization.limits.maxConcurrentChunks ?? 1 });
    const session = peer.session;
    report.stage = 'complete-model-execution';
    const { assignment, ...operationOptions } = options;
    report.operationExecution = await peer.run({ schema: 'doppler.pack-operation-request/v1', operation: { name: 'encodeSequence', version: 1 },
        input: { sequence }, options: operationOptions, assignment,
        limits: { ...operationLimits, deadlineAt: authorization.expiresAt } });
    report.result = { ...report.operationExecution.output, receipt: report.operationExecution.receipt };
    report.runtime = { device: session.deviceProfile, initialExecutionIdentity: session.observedInitialExecutionIdentity };
    report.manifest = session.manifest;
    report.stage = 'complete';
    report.passed = true;
  } catch (error) { report.error = error.message; report.custody = error.acquisitionReceipt ?? null; }
  finally {
    try { if (peer) report.custody = await peer.getAcquisitionReceipt(); }
    finally { await peer?.close(); await service.closeAll(); }
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
