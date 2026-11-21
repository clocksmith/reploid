/** Direct, same-host native RTC fixture. The signed transport and host stores are real. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import rtcModule from '@roamhq/wrtc';
import SignalingServer from '../server/signaling-server.js';

const rtc = rtcModule.default ?? rtcModule;
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
const model = { id: 'wire-circle-fixture', identity: 'sha256:' + 'a'.repeat(64) };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, reason) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(20);
  }
  throw Error(reason);
}
const count = (records, value) => records.reduce((sum, bytes) => sum + bytes.toString('latin1').split(value).length - 1, 0);
const tally = (records, prompt, answer) => ({ frames: records.length, bytes: records.reduce((n, frame) => n + frame.length, 0),
  promptMatches: count(records, prompt), answerMatches: count(records, answer) });

/** @param {{scenario:'invite'|'reconnect', checkout:string}} options */
export async function runCircleWireFixture({ scenario, checkout }) {
  assert(['invite', 'reconnect'].includes(scenario) && path.isAbsolute(checkout), 'Explicit scenario and isolated checkout path required');
  const importFrom = file => import(pathToFileURL(path.join(checkout, file)).href);
  const [{ createSigningIdentity }, { createWebRTCSwarm }, { createPeerGenerationMesh }, { resolveConfig }, { createExecutionPolicy }, { classifyConnectionPath }] = await Promise.all([
    importFrom('packages/reploid/src/artifacts/identity.js'), importFrom('packages/reploid/src/transport/swarm.js'),
    importFrom('packages/reploid/src/mesh/peer-generation.js'), importFrom('packages/reploid/src/config/index.js'),
    importFrom('packages/reploid/src/chat/execution-policy.js'), importFrom('packages/reploid/src/transport/connection-path.js')
  ]);
  const invitePorts = scenario === 'invite' ? await Promise.all([importFrom('server/circles/invites.js'), importFrom('server/circles/admission.js')]) : null;
  const pairingPorts = scenario === 'reconnect' ? await Promise.all([importFrom('server/circles/owner-pairing.js'),
    importFrom('packages/reploid/src/transport/owner-pairing.js')]) : null;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-circle-wire-'));
  const file = path.join(root, 'host.sqlite'), roomId = 'reploid-swarm-wire-' + randomUUID();
  const marker = () => randomBytes(16).toString('hex');
  const roomToken = randomBytes(32).toString('base64url');
  const prompt = 'fixture-prompt-' + marker(), answer = 'fixture-answer-' + marker();
  const blockedPrompt = 'fixture-blocked-' + marker();
  const signaling = new SignalingServer({ logger }), server = http.createServer();
  const receivedFrames = [], sentFrames = [], endpointFrames = [], endpoints = [], providerPrompts = [];
  const signalingFrames = () => [...receivedFrames, ...sentFrames];
  let invites, admissions, pairing;
  const [desktop, guest] = await Promise.all(Array.from({ length: 2 }, () => createSigningIdentity({ algorithm: 'Ed25519' })));
  const config = resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId, generationTimeoutMs: 4000 },
    webrtc: { rtcConfig: { iceServers: [] } } } });
  const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [desktop.peerId] } });
  const offerCodeMaterial = [];
  let lease = null, inviteGrant, preadmissions = 0, admitted = 0, acceptedScope = null;

  server.on('upgrade', (req, socket, head) => signaling.handleUpgrade(req, socket, head));
  signaling.wss.on('connection', ws => {
    ws.on('message', data => receivedFrames.push(Buffer.from(data)));
    const send = ws.send.bind(ws);
    ws.send = (data, ...args) => { sentFrames.push(Buffer.from(data)); return send(data, ...args); };
  });
  const changedScope = (a, b) => a !== null && b !== null && JSON.stringify(a) !== JSON.stringify(b);
  async function connect(label, identity, provider = false) {
    const url = 'ws://127.0.0.1:' + server.address().port + '/signaling';
    const socket = new WebSocket(url);
    const id = label + '-' + randomUUID();
    const connections = [];
    function RTCPeerConnection(...args) {
      const pc = new rtc.RTCPeerConnection(...args);
      connections.push(pc);
      return pc;
    }
    let listener, closed = false, transport;
    const hub = new EventEmitter();
    const events = { emit: hub.emit.bind(hub), on(name, fn) { hub.on(name, fn); return () => hub.off(name, fn); } };
    const mesh = createPeerGenerationMesh({ config, ports: { instanceId: id,
      modelConfig: provider ? { id: model.id } : null, admitsBeforeDisclosure: true,
      getExecutionState: () => ({ phase: 'ready', modelIdentity: model.identity, adapterIdentities: [] }),
      identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
      events, eventBus: events, utils: { generateId: prefix => prefix + ':' + randomUUID() },
      async authorize(control) {
        if (control.action === 'mesh.dispatch') {
          return control.recipientIdentity === desktop.peerId && JSON.stringify(transport.getPeerBinding(control.peerId)) === JSON.stringify(acceptedScope);
        }
        if (provider && control.action === 'mesh.admit') {
          preadmissions++;
          const request = control.request;
          assert.equal(request.messages, undefined, 'preadmission is metadata-only');
          assert.equal(request.settings, undefined);
          const verified = await mesh.verifyPeerIdentity(control.peerId, AbortSignal.timeout(2500));
          assert.equal(verified, request.consumer);
          if (scenario === 'invite') {
            lease = await admissions.acquire({ requestId: request.requestId, modelIdentity: request.modelIdentity, maxOutputTokens: 8,
              inviteId: inviteGrant.inviteId }, { authenticatedPeerId: verified });
          } else if (!pairing.isOwner(verified)) {
            return false;
          }
          admitted++;
        }
        return true;
      },
      async generate(messages) {
        providerPrompts.push(messages[0].content);
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: answer, completion: {
          schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 5, stopReason: 'eos-token' } };
      },
      createTransport() {
        transport = createWebRTCSwarm({ config, Utils: { logger, generateId: () => randomUUID() }, EventBus: events,
          peerId: id, getSessionId: () => roomId, getRoomCredentials: () => ({ roomId, token: roomToken }), ...rtc, RTCPeerConnection,
          signalingAdapter: {
            subscribe(fn) { listener = fn; return () => { listener = null; }; },
            publish(message) {
              socket.send(JSON.stringify(message.type === 'join' ? { ...message, token: roomToken } : message));
            }
          } });
        return { ...transport,
          sendToPeer(peer, type, value) {
            endpointFrames.push(Buffer.from(JSON.stringify({ type, value })));
            return transport.sendToPeer(peer, type, value);
          }
        };
      }
    } });
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'welcome') void listener?.(message);
    });
    const endpoint = { id, mesh, get transport() { return transport; }, async selectedPair() {
      const active = connections.filter(pc => pc.connectionState === 'connected');
      if (active.length !== 1) return null;
      const report = await active[0].getStats();
      const icePath = classifyConnectionPath(report);
      if (!icePath) return null;
      const values = [...report.values()];
      const ids = [...new Set(values.filter(row => row.type === 'transport' && row.selectedCandidatePairId)
        .map(row => row.selectedCandidatePairId))];
      const pair = ids.length === 1 ? report.get(ids[0]) : values.find(row => row.type === 'candidate-pair' && row.selected === true);
      return pair && { icePath, pairId: pair.id, bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived };
    }, async close() {
      if (closed) return;
      closed = true;
      try { await mesh.close(); } finally { socket.terminate(); }
    } };
    endpoints.push(endpoint);
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
    await mesh.connect();
    return endpoint;
  }
  async function prove(client, host) {
    try {
      await until(() => client.mesh.getSwarmSnapshot().peers.some(peer => peer.peerId === host.id && peer.readiness === 'ready'
        && peer.identityVerified), 'Verified RTC provider did not become ready');
    } catch (error) {
      const frames = signalingFrames().map(bytes => JSON.parse(bytes.toString())).map(({type,error:detail}) => detail ? [type,detail] : type);
      const peers = client.transport.getPeerStates().map(({phase,channelState,transport}) => ({phase,channelState,transport}));
      throw Error(error.message + ': ' + JSON.stringify({ frames, peers }));
    }
    assert.equal(await client.mesh.verifyPeerIdentity(host.id, AbortSignal.timeout(3000)), desktop.peerId);
    const binding = client.transport.getPeerBinding(host.id);
    assert.ok(binding?.local && binding?.remote, 'Fresh DTLS fingerprint scope required');
    assert.equal(client.transport.getStats().relayMessagesSent, 0, 'Application signaling relay was not used');
    return binding;
  }
  const run = async (client, content) => {
    try {
      return await client.mesh.generate([{ role: 'user', content }], null, { modelId: model.id, modelIdentity: model.identity,
        privacy: policy, signal: AbortSignal.timeout(6000) });
    } finally { lease?.release(); lease = null; }
  };
  const stablePair = client => until(async () => {
    const pair = await client.selectedPair();
    if (pair?.icePath !== 'direct') return null;
    // Let the initial trickle candidates settle before attributing byte deltas.
    await sleep(150);
    const settled = await client.selectedPair();
    return settled?.pairId === pair.pairId && settled.icePath === pair.icePath ? settled : null;
  }, 'No stable selected direct ICE pair');
  const sampleAfter = (client, before) => until(async () => {
    const pair = await client.selectedPair();
    return before && pair && pair.pairId === before.pairId && pair.bytesSent > before.bytesSent && pair.bytesReceived > before.bytesReceived ? pair : null;
  }, 'Selected pair did not report bidirectional traffic for the request');
  let positiveResult, selectedBefore, selectedAfter, freshScope = false, staleRefused = false, revokedRefused = false, hostMetadata;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
    let host = await connect('desktop-initial', desktop, true);
    let client = await connect('client-initial', guest);
    acceptedScope = await prove(client, host);
    if (scenario === 'invite') {
      invites = await invitePorts[0].openCircleInvites({ file, hostPeerId: desktop.peerId });
      admissions = invitePorts[1].createCircleAdmission({ hostPeerId: desktop.peerId, modelIdentity: model.identity,
        isReady: () => true, invites, maxQueuedRequests: 2, maxQueuedPerGuest: 1, maxWaitMs: 1000 });
      const issued = invites.issue({ expiresAt: Date.now() + 60000, maxRequests: 2, maxOutputTokens: 8 });
      offerCodeMaterial.push(issued.token);
      const verifiedGuest = await host.mesh.verifyPeerIdentity(client.id, AbortSignal.timeout(3000));
      inviteGrant = invites.redeem({ token: issued.token, guestPeerId: verifiedGuest });
      assert.equal(inviteGrant.hostPeerId, desktop.peerId);
      hostMetadata = inviteGrant.inviteId;
      selectedBefore = await stablePair(client);
      positiveResult = await run(client, prompt);
      selectedAfter = await sampleAfter(client, selectedBefore);
      invites.revoke(inviteGrant.inviteId);
      await assert.rejects(run(client, blockedPrompt), /declined/);
      revokedRefused = true;
      assert.equal(preadmissions, 2);
      assert.equal(admitted, 1);
      assert.equal(invites.list()[0].usedRequests, 1);
    } else {
      let observed;
      pairing = await pairingPorts[0].openOwnerPairing({ file, hostParticipantId: desktop.peerId, onRequest: value => { observed = value; } });
      pairing.attach({ transport: host.transport, verifyPeer: host.mesh.verifyPeerIdentity, currentPeer: host.mesh.getVerifiedPeerIdentity });
      const offer = pairing.issue();
      offerCodeMaterial.push(offer.code);
      const request = pairingPorts[1].requestOwnerPairing({ transport: client.transport, verifyPeer: client.mesh.verifyPeerIdentity,
        currentPeer: client.mesh.getVerifiedPeerIdentity, hostPeer: host.id, ...offer, signal: AbortSignal.timeout(5000) });
      const reviewed = await Promise.race([
        until(() => observed, 'Desktop did not receive the verified pairing request'),
        request.then(() => { throw Error('Pairing finished before desktop approval'); })
      ]);
      assert.equal(reviewed.participantId, guest.peerId);
      assert.equal(pairing.isOwner(guest.peerId), false);
      assert.equal(pairing.decide(reviewed.requestId, true), true);
      assert.deepEqual(await request, { hostParticipantId: desktop.peerId });
      const stale = acceptedScope;
      await client.close(); await host.close(); pairing.close();
      host = await connect('desktop-returned', desktop, true);
      client = await connect('client-returned', guest);
      pairing = await pairingPorts[0].openOwnerPairing({ file, hostParticipantId: desktop.peerId });
      pairing.attach({ transport: host.transport, verifyPeer: host.mesh.verifyPeerIdentity, currentPeer: host.mesh.getVerifiedPeerIdentity });
      const current = await prove(client, host);
      assert.ok(changedScope(stale, current), 'Returning signing key must use a fresh channel scope');
      freshScope = true;
      assert.equal(pairing.isOwner(await host.mesh.verifyPeerIdentity(client.id, AbortSignal.timeout(3000))), true);
      await assert.rejects(run(client, blockedPrompt), /denied remote prompt disclosure/);
      staleRefused = true;
      assert.equal(preadmissions, 0, 'Old channel consent must not reach provider admission');
      acceptedScope = current;
      selectedBefore = await stablePair(client);
      positiveResult = await run(client, prompt);
      selectedAfter = await sampleAfter(client, selectedBefore);
      hostMetadata = guest.peerId;
      assert.equal(preadmissions, 1);
      assert.equal(admitted, 1);
    }
    assert.deepEqual(providerPrompts, [prompt]);
    assert.equal(positiveResult.content, answer);
    const persistent = await Promise.all((await fs.readdir(root)).filter(name => name.startsWith('host.sqlite'))
      .map(name => fs.readFile(path.join(root, name))));
    const socketFrames = signalingFrames();
    for (const frames of [receivedFrames, sentFrames]) {
      assert.ok(count(frames, roomId) > 0, 'Each WebSocket direction must contain actual room metadata');
    }
    assert.ok(socketFrames.some(frame => /"type":"(?:offer|answer|ice-candidate)"/.test(frame.toString())), 'WebSocket capture must include live negotiation');
    assert.ok(count(persistent, hostMetadata) > 0, 'SQLite capture must contain persisted room-side metadata');
    assert.equal(selectedBefore?.icePath, 'direct');
    assert.equal(selectedAfter?.icePath, 'direct');
    assert.equal(selectedBefore.pairId, selectedAfter.pairId, 'Request pair changed during the positive sample');
    const selectedPairTraffic = { bytesSent: selectedAfter.bytesSent - selectedBefore.bytesSent,
      bytesReceived: selectedAfter.bytesReceived - selectedBefore.bytesReceived };
    assert.ok(selectedPairTraffic.bytesSent > 0 && selectedPairTraffic.bytesReceived > 0, 'Selected pair must report transferred bytes');
    const checks = { signaling: tally(socketFrames, prompt, answer),
      signalingDirections: { inbound: tally(receivedFrames, prompt, answer), outbound: tally(sentFrames, prompt, answer) },
      desktopControlStore: tally(persistent, prompt, answer),
      endpointDataChannels: tally(endpointFrames, prompt, answer), preadmissions, admitted, revokedRefused, freshScope, staleRefused,
      selectedTransport: client.transport.getPeerStates().find(peer => peer.id === host.id)?.transport ?? null,
      selectedIcePath: selectedAfter.icePath, selectedPairTraffic, iceServersConfigured: 0, cellularTested: false };
    assert.equal(checks.selectedTransport, 'webrtc');
    assert.ok(checks.endpointDataChannels.promptMatches > 0 && checks.endpointDataChannels.answerMatches > 0, 'Endpoint canaries must be visible');
    for (const boundary of [checks.signaling, checks.desktopControlStore]) {
      assert.equal(boundary.promptMatches, 0); assert.equal(boundary.answerMatches, 0);
    }
    assert.equal(count([...socketFrames, ...endpointFrames, ...persistent], blockedPrompt), 0, 'Rejected prompt must not enter any frame or control store');
    for (const code of offerCodeMaterial) {
      assert.equal(count(socketFrames, code), 0, 'Codes must not reach signaling');
      assert.equal(count(persistent, code), 0, 'No bearer material in SQLite');
    }
    return { schema: 'reploid.circle-wire-fixture/v1', scenario, checkedAtUtc: new Date().toISOString(),
      scope: 'same-host native direct RTC, loopback WebSocket, synthetic inference; no TURN, cellular, TLS proxy, or public service',
      fixtureAdmission: scenario === 'invite' ? 'verified invite grant applied by test host port; guest dispatch is not wired in the application' : null,
      checks };
  } finally {
    for (const endpoint of endpoints.reverse()) await endpoint.close();
    admissions?.close();
    invites?.close();
    pairing?.close();
    await signaling.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}
