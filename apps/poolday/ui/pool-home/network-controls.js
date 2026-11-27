import { preparationStatus } from './model-preparation.js';
import { publicPreparationProgress } from '../../../../shared/vendor/reploid/mesh/preparation-progress.js';

/** Only what this browser's connection statistics established; anything else stays unlabelled. */
const connectionPath = connection => ['relayed', 'direct'].includes(connection?.path) ? connection.path : null;

/** Peer-advertised scoring counters, not device-wide traffic or independently verified work. */
function reportedContribution(peer) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const source = peer.contribution;
  return {
    inputTokens: count(source?.providedInputTokens), outputTokens: count(source?.providedOutputTokens),
    served: count(source?.receiptsServed), consumed: count(source?.receiptsConsumed)
  };
}

export function projectNetworkPeers(state) {
  const network = state.network || {};
  const own = new Set([network.consumer?.peerId, network.supplier?.peerId]);
  const privateRoom = network.discoveryScope === 'private';
  const peers = new Map(), connections = new Map();
  const connectionLabels = {
    preparing: ['Preparing connection', 'Waiting for connection configuration.'],
    negotiating: ['Connecting', 'Finding a network path to this computer.'],
    connecting: ['Connecting', 'Finding a network path to this computer.'],
    'awaiting-answer': ['Waiting for computer', 'Waiting for this computer to accept the connection.'],
    'opening-channel': ['Opening connection', 'Computer answered. Waiting for the data channel.'],
    interrupted: ['Connection interrupted', 'Trying to recover the network path. Requests cannot rely on this computer yet.'],
    failed: ['Connection failed', privateRoom ? 'Check the private invitation and retry.' : 'Public peer unreachable. Search again to discover other computers.'],
    disconnected: ['Disconnected', 'Connection closed. Remote execution and cleanup state are unknown.'],
    connected: ['Connected', 'Waiting for this computer to report its model status.']
  };
  for (const snapshot of [network, network.consumer, network.supplier]) for (const peer of snapshot?.connections || []) {
    if (own.has(peer.id)) continue;
    if (connections.get(peer.id)?.phase === 'connected') continue;
    connections.set(peer.id, peer);
  }
  if (network.connectionFailure?.peerId && !connections.has(network.connectionFailure.peerId)) {
    connections.set(network.connectionFailure.peerId, { id: network.connectionFailure.peerId, phase: 'failed' });
  }
  for (const peer of connections.values()) {
    const [status, detail] = connectionLabels[peer.phase] || connectionLabels.connecting;
    peers.set(peer.id, { id: peer.id, model: 'Model status pending', phase: peer.phase, attemptId: peer.attemptId || null, authenticated: peer.authenticated === true,
      state: peer.phase === 'connected' ? 'awaiting-advertisement' : ['disconnected', 'failed'].includes(peer.phase) ? peer.phase : 'connecting',
      connectionPhase: peer.phase, connectionPath: peer.phase === 'connected' ? connectionPath(peer) : null, partitionIndex: null, status, detail: !privateRoom && /invit/i.test(peer.failure || '') ? detail : peer.failure || detail });
  }
  const advertisements = new Map();
  for (const snapshot of [network.consumer, network.supplier]) for (const peer of snapshot?.peers || []) advertisements.set(peer.peerId, peer);
  for (const peer of network.partitionPeers || []) if (peer.available && !advertisements.has(peer.transportId)) {
    advertisements.set(peer.transportId, { peerId: peer.transportId });
  }
  for (const peer of advertisements.values()) {
    if (own.has(peer.peerId)) continue;
    const connection = connections.get(peer.peerId);
    if (connection && (connection.phase !== 'connected' || peer.attemptId && peer.attemptId !== connection.attemptId)) continue;
    const capability = network.partitionPeers?.find(item => item.transportId === peer.peerId);
    const description = capability?.available ? capability.description : null;
    const partition = description && (description.offer || description.assignment || description.models?.length || description.phase !== 'idle') ? description : null;
    const offered = partition?.offer || partition?.assignment || partition?.models?.[0];
    const modelId = offered?.id || offered?.modelId || peer.model;
    const model = state.models?.find(item => item.id === modelId)?.name || modelId || 'No model offered';
    const index = partition?.index ?? offered?.index ?? null;
    let phase = partition?.phase || peer.activity?.phase || peer.readiness || null;
    const capacity = partition?.capacity;
    if (phase === 'ready' && capacity?.active > 0) phase = 'executing';
    else if (phase === 'ready' && (capacity?.availableSlots ?? peer.availableSlots) === 0) phase = 'busy';
    let status = 'Connected', detail = 'Connected to the network; not offering model execution.';
    let progress = null;
    if (phase === 'loading') ({ status, detail, progress } = preparationStatus(partition?.preparation || peer.preparation));
    else if (phase === 'waiting') {
      status = index === null ? 'Needs contributor' : 'Awaiting route';
      detail = index === null ? 'Connected. Waiting for another contributor before assigning a model stage.'
        : 'Connected. Waiting for the other model stages to form a complete route.';
    } else if (phase === 'ready') {
      const unreported = !partition && peer.availableSlots === null;
      status = unreported ? 'Capacity not reported' : 'Ready';
      detail = partition ? 'Model stage prepared; a complete route is required to answer.'
        : unreported ? 'Model loaded, but this computer has not reported a free slot, so no request is sent to it.' : 'Model loaded and ready to answer.';
    } else if (phase === 'executing') { status = 'Working'; detail = 'Answering a request.'; }
    else if (phase === 'busy') { status = 'At capacity'; detail = 'Model loaded; all request slots are occupied.'; }
    else if (phase === 'failed') { status = 'Failed'; detail = 'Model preparation or execution failed on this computer.'; }
    else if (phase === 'stopping') { status = 'Stopping'; detail = 'Finishing cleanup before releasing resources.'; }
    else if (modelId) { status = 'Status unknown'; detail = 'Connected, but model readiness has not been reported.'; }
    const prep = publicPreparationProgress(partition?.preparation || peer.preparation);
    const observedState = phase === 'loading' ? (['receiving', 'downloading', 'cached'].includes(prep?.kind) ? 'acquiring-files' : 'preparing-model')
      : phase || 'awaiting-advertisement';
    peers.set(peer.peerId, { id: peer.peerId, model, modelId, executionType: partition ? 'partition' : 'whole-model',
      adapterIdentities: peer.adapterIdentities || [], hardware: peer.hardware || null, contribution: reportedContribution(peer),
      phase, state: observedState, attemptId: connection?.attemptId || null,
      authenticated: peer.identityVerified === true || connection?.authenticated === true || !!capability?.available, modelIdentity: offered?.identity || peer.modelIdentity || null, connectionPhase: 'connected', connectionPath: connectionPath(connection), partitionIndex: index, status, detail, progress });
  }
  // Blocked on this device: the requester never chooses it, so it counts as neither ready nor working.
  const blocked = state.blockedComputers, identities = state.computerIdentities;
  const isBlocked = id => advertisements.get(id)?.blocked === true || !!blocked?.size && (blocked.has(id) || blocked.has(identities?.get(id)));
  return [...peers.values()].map(peer => isBlocked(peer.id) ? { ...peer, blocked: true, phase: 'blocked', state: 'blocked',
    status: 'Blocked', detail: 'Blocked on this device. Your requests are not sent to it.', progress: null } : peer);
}
