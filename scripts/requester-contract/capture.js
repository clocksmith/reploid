/**
 * Captures real requester and provider exchanges for the requester contract.
 * See harness.js for what is real and what is a stand-in.
 */
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';
import { FIXED, fixedIdentity, fixedModel } from './fixed-inputs.js';
import { createScheduler, withDeterministicRuntime, createFakeNetwork, createInProcessSignaling, quietLogger,
  createStubWholeModel, createProviderStack, createRequesterStack, offerFromExternalPeer } from './harness.js';

const describeError = error => error ? { message: error.message ?? String(error), name: error.name ?? null,
  ...(error.code !== undefined ? { code: error.code } : {}),
  ...(error.generationTerminal ? { generationTerminal: error.generationTerminal } : {}) } : null;

const parseFrames = recorded => recorded.map(({ direction, data }) => {
  const envelope = JSON.parse(data);
  if (JSON.stringify(envelope) !== data) throw new Error('A captured frame does not round-trip through JSON');
  return { direction, envelope };
});

export const SCENARIOS = Object.freeze(['complete', 'decline', 'provider-failure', 'cancel', 'recovery']);

/**
 * One whole-model exchange between the real requester and the real provider.
 *
 * scenario:
 *   complete          the request is answered and the receipt is countersigned
 *   decline           the provider host refuses admission; the prompt is never sent
 *   provider-failure  the model fails after one chunk; signed terminal evidence follows
 *   cancel            the requester stops after the first chunk
 *   recovery          a completed request is read back with generation-recover
 */
export async function captureExchange({ scenario = 'complete', messages = FIXED.messages, saltBytes = FIXED.saltBytes,
  direct = false, transform = null } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario ${scenario}`);
  const scheduler = createScheduler();
  const recorded = { transcript: [], keepalive: [], recovery: [] }, signalingFrames = [], warnings = [];
  let section = 'transcript';
  const logger = quietLogger(warnings);
  const network = createFakeNetwork({ post: scheduler.post, transform,
    tap: ({ from, data }) => recorded[section].push({ direction: from === 'requester' ? 'requester->provider' : 'provider->requester', data }) });
  const model = fixedModel(), identities = { requester: fixedIdentity('requesterEd25519'), provider: fixedIdentity('providerEd25519') };
  const outcome = { scenario, result: null, error: null, observed: null, recovered: null, providerCalls: [] };
  let requesterRtc, providerRtc, dispatches;

  const { used } = await withDeterministicRuntime({ now: FIXED.now, uuids: FIXED.uuids, randomValues: [saltBytes], scheduler }, async () => {
    const signaling = createInProcessSignaling({ post: scheduler.post, tap: frame => signalingFrames.push(frame), logger });
    providerRtc = network.createRtc({ name: 'provider', fingerprint: FIXED.providerFingerprint });
    requesterRtc = network.createRtc({ name: 'requester', fingerprint: FIXED.requesterFingerprint });
    const shared = { signalingUrl: FIXED.signalingUrl, roomId: FIXED.roomId, roomToken: FIXED.roomToken, publicRoomId: bootstrap.publicRoomId, model, logger };
    let issued = 0;
    const provider = createProviderStack({ ...shared, identity: identities.provider, transportId: FIXED.providerTransportId,
      WebSocket: signaling.webSocketFor({ name: 'provider', origin: FIXED.origin }), RTCPeerConnection: providerRtc.RTCPeerConnection,
      generateId: () => { throw new Error('The provider issues no identifiers in this capture'); },
      decline: () => scenario === 'decline',
      generate: createStubWholeModel({ model, chunks: FIXED.answerChunks, completion: FIXED.completion, pause: () => scheduler.barrier(),
        failAfterChunks: scenario === 'provider-failure' ? 1 : null,
        onCall: messages => outcome.providerCalls.push(structuredClone(messages)) }) });
    const requester = createRequesterStack({ ...shared, identity: identities.requester, transportId: FIXED.requesterTransportId,
      WebSocket: signaling.webSocketFor({ name: 'requester', origin: FIXED.origin }), RTCPeerConnection: requesterRtc.RTCPeerConnection,
      generateId: () => { if (issued++) throw new Error('One request identifier is fixed for this capture'); return FIXED.requestId; } });
    dispatches = requester.dispatches;
    try {
      // The provider is in the room first, as a serving computer is. The requester joins and offers.
      await scheduler.until(provider.mesh.connect());
      await scheduler.drain();
      await scheduler.until(requester.mesh.connect());
      await scheduler.drain();

      const controller = new AbortController();
      const onDelta = () => { if (scenario === 'cancel') controller.abort(); };
      const asking = direct
        ? requester.askDirect({ messages: structuredClone(messages), signal: controller.signal, onDelta })
        : requester.ask({ messages: structuredClone(messages), threadId: FIXED.threadId, attemptId: FIXED.attemptId, signal: controller.signal, onDelta });
      try {
        const asked = await scheduler.until(asking);
        outcome.result = asked.result; outcome.observed = asked.observed ?? null; outcome.privacy = asked.privacy;
        outcome.route = asked.route ?? null;
      } catch (error) {
        outcome.error = describeError(error); outcome.observed = error.observed ?? null;
      }
      await scheduler.drain();

      if (scenario === 'complete') {
        // The transport sends this from its heartbeat timer every pingIntervalMs. It is sent here by hand.
        section = 'keepalive';
        requester.transport.sendToPeer(FIXED.providerTransportId, 'ping', { ts: Date.now() });
        await scheduler.drain();
      }
      if (scenario === 'recovery') {
        section = 'recovery';
        const reference = { requestId: outcome.observed.route.requestId, providerId: outcome.observed.route.providerId,
          providerIdentity: outcome.observed.route.providerIdentity };
        outcome.recoveryReference = reference;
        outcome.recovered = await scheduler.until(requester.requester.recover(
          { model: outcome.route, threadId: FIXED.threadId, attemptId: FIXED.attemptId, privacy: outcome.privacy, messages: structuredClone(messages) },
          reference, { signal: new AbortController().signal }));
        await scheduler.drain();
      }
      outcome.models = requester.requester.getModels();
      outcome.providerSnapshot = requester.mesh.getSwarmSnapshot();
    } finally {
      section = 'closing'; recorded.closing = [];
      await scheduler.until(Promise.all([requester.mesh.close(), provider.mesh.close()]));
      await scheduler.drain();
      signaling.close();
      await scheduler.drain();
    }
  });

  return {
    scenario,
    inputs: {
      roomId: FIXED.roomId, roomToken: FIXED.roomToken, origin: FIXED.origin, now: FIXED.now,
      requester: { transportId: FIXED.requesterTransportId, fingerprint: FIXED.requesterFingerprint, identity: 'requesterEd25519', participantId: identities.requester.peerId },
      provider: { transportId: FIXED.providerTransportId, fingerprint: FIXED.providerFingerprint, identity: 'providerEd25519', participantId: identities.provider.peerId },
      uuidsInOrder: used.uuids, saltHex: used.randomValues[0] ? used.randomValues[0].map(byte => byte.toString(16).padStart(2, '0')).join('') : null,
      requestId: FIXED.requestId, threadId: FIXED.threadId, attemptId: FIXED.attemptId,
      model, messages: structuredClone(messages),
      providerAnswer: { chunks: [...FIXED.answerChunks], completion: { ...FIXED.completion } }
    },
    dataChannels: { requesterCreated: requesterRtc.created.channels, providerCreated: providerRtc.created.channels },
    signaling: signalingFrames,
    frames: parseFrames(recorded.transcript),
    keepalive: parseFrames(recorded.keepalive),
    recovery: parseFrames(recorded.recovery),
    dispatches, warnings, ...outcome
  };
}

/**
 * One real swarm transport (and, for `requester: true`, the real requester mesh)
 * joined by a peer that exists only as text frames. Returns controls to push
 * frames in and to read what the real code did with them.
 */
async function withExternalPeer({ uuids = FIXED.uuids }, run) {
  const scheduler = createScheduler(), warnings = [], outbound = [];
  const logger = quietLogger(warnings);
  const externalId = FIXED.providerTransportId, localId = FIXED.requesterTransportId;
  let link = null;
  const external = { write: data => outbound.push(data), attach: attached => { link = attached; } };
  const network = createFakeNetwork({ post: scheduler.post });
  const { value } = await withDeterministicRuntime({ now: FIXED.now, uuids, randomValues: [], scheduler }, async () => {
    const signaling = createInProcessSignaling({ post: scheduler.post, logger });
    const rtc = network.createRtc({ name: 'requester', fingerprint: FIXED.requesterFingerprint, external });
    const stack = createRequesterStack({ signalingUrl: FIXED.signalingUrl, roomId: FIXED.roomId, roomToken: FIXED.roomToken,
      publicRoomId: bootstrap.publicRoomId, model: fixedModel(), logger, identity: fixedIdentity('requesterEd25519'), transportId: localId,
      WebSocket: signaling.webSocketFor({ name: 'requester', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
      generateId: () => FIXED.requestId });
    try {
      await scheduler.until(stack.mesh.connect());
      await scheduler.drain();
      // The outside peer joins through the real signaling server and offers.
      offerFromExternalPeer({ signaling, signalingUrl: FIXED.signalingUrl, roomId: FIXED.roomId, roomToken: FIXED.roomToken, origin: FIXED.origin,
        localTransportId: localId, remoteTransportId: externalId, remoteFingerprint: FIXED.providerFingerprint });
      await scheduler.drain();
      if (!link) throw new Error('The outside peer did not get a data channel');
      return await run({ stack, scheduler, warnings, outbound, externalId, localId,
        deliver: async data => { link.deliver(data); await scheduler.drain(); } });
    } finally {
      await scheduler.until(stack.mesh.close());
      await scheduler.drain();
      signaling.close();
      await scheduler.drain();
    }
  });
  return value;
}

/**
 * What the real transport does with each inbound text frame: accepted (counted
 * and routed) or rejected, with the transport's own reason.
 */
export async function probeInboundFrames(cases) {
  return withExternalPeer({}, async ({ stack, warnings, deliver }) => {
    const results = [];
    for (const item of cases) {
      const before = stack.transport.getStats(), seen = warnings.length;
      await deliver(item.data);
      const after = stack.transport.getStats();
      const accepted = after.messagesReceived === before.messagesReceived + 1 && after.rejected === before.rejected;
      const line = warnings.slice(seen).find(text => /Invalid message from|Message too large from|Failed to parse message from/.test(text)) || null;
      let reason = null;
      if (!accepted) {
        const invalid = /Invalid message from \S+: (.*)$/.exec(line || '');
        reason = invalid ? (invalid[1] === 'undefined' ? 'peerId differs from the connection the frame arrived on' : invalid[1])
          : /Message too large/.test(line || '') ? 'Frame text is longer than twice maxPayloadSize'
          : /Failed to parse/.test(line || '') ? 'Frame is not JSON' : 'Rejected';
      }
      results.push({ name: item.name, accepted, reason });
    }
    return results;
  });
}

/**
 * What the real requester concludes from one advertisement received over an
 * open channel: the mesh's stored peer record, the catalog projection used to
 * pick a ready provider, and whether the mesh would select this provider.
 */
export async function probeAdvertisement(advertisement, { connectionOverrides = null } = {}) {
  return withExternalPeer({}, async ({ stack, deliver, externalId }) => {
    const clock = stack.transport.getClock() + 1;
    const payload = JSON.stringify(advertisement);
    await deliver(JSON.stringify({ protocolVersion: 1, type: 'reploid:peer-advertisement', peerId: externalId, timestamp: clock,
      payload: advertisement, payloadSize: payload.length }));
    const snapshot = stack.mesh.getSwarmSnapshot();
    const peer = snapshot.peers.find(candidate => candidate.peerId === externalId) || null;
    const connections = snapshot.connections.map(link => link.id === externalId && connectionOverrides ? { ...link, ...connectionOverrides } : link);
    const [row] = projectChatCatalog({ models: [fixedModel()], peers: snapshot.peers, connections });
    const connection = connections.find(link => link.id === externalId) || null;
    return {
      storedPeer: peer,
      connection: connection && { phase: connection.phase, channelState: connection.channelState, iceState: connection.iceState, attemptId: connection.attemptId },
      availability: row.availability, providerIds: row.providerIds, reachableProviderIds: row.reachableProviderIds,
      meshSelectable: stack.mesh.hasAvailableProvider(fixedModel().id)
    };
  });
}
