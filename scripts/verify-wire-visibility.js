#!/usr/bin/env node
/**
 * Reproducible wire-visibility verification across Reploid's coordinator,
 * WebSocket signaling server, UDP packet relay (TURN equivalent), and Fleet
 * credit ledger.
 *
 * Sends a unique canary prompt and returns a unique canary answer between two
 * WebRTC peers forced through a local UDP packet-capturing relay while settling
 * signed non-cash service credits at the Fleet coordinator and testing
 * fail-closed prompt rejection on `/pool/peer/rooms` and `/pool/jobs`.
 */
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket } from 'ws';
import wrtc from '@roamhq/wrtc';

import SignalingServer from '../server/signaling-server.js';
import createPoolRouter from '../server/pool/routes.js';
import { createPoolStore } from '../server/pool/store.js';
import { createSigningIdentity } from '../shared/vendor/reploid/artifacts/identity.js';
import { hashJson } from '../shared/vendor/reploid/artifacts/signatures.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../shared/vendor/reploid/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../shared/vendor/reploid/artifacts/whole-model-receipt.js';
import { openFleetCredits } from '../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../server/fleet/service.js';

function countBufferOccurrences(haystackBuffer, needleUtf8) {
  const needle = Buffer.from(needleUtf8, 'utf8');
  let count = 0;
  let offset = 0;
  while (offset <= haystackBuffer.length - needle.length) {
    const idx = haystackBuffer.indexOf(needle, offset);
    if (idx === -1) break;
    count += 1;
    offset = idx + needle.length;
  }
  return count;
}

export async function runWireVisibilityVerification() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-wire-vis-'));
  const promptCanary = `REPLOID_CANARY_PROMPT_${randomBytes(16).toString('hex')}`;
  const answerCanary = `REPLOID_CANARY_ANSWER_${randomBytes(16).toString('hex')}`;

  // 1. Instrument SignalingServer + Express Pool Coordinator (matching server/proxy-app.js production flags).
  const poolStore = createPoolStore();
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/pool', createPoolRouter({
    store: poolStore,
    allowUnauthenticatedLocal: true,
    allowCanaryCreation: false,
    allowPlaintextJobPrompts: false,
  }));

  const coordinatorHttpBodies = [];
  const coordServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length > 0) coordinatorHttpBodies.push(Buffer.concat(chunks));
    });
    app(req, res);
  });

  const signalingFrames = [];
  const signaling = new SignalingServer();
  coordServer.on('upgrade', (req, sock, head) => {
    if (signaling.shouldHandle(req)) signaling.handleUpgrade(req, sock, head);
    else sock.destroy();
  });
  // Capture every WebSocket message broadcast or received on signaling sockets.
  signaling.wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      signalingFrames.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    });
  });

  coordServer.listen(0, '127.0.0.1');
  await once(coordServer, 'listening');
  const coordPort = coordServer.address().port;
  const coordUrl = `http://127.0.0.1:${coordPort}`;
  const wsUrl = `ws://127.0.0.1:${coordPort}/signaling?scope=private&roomId=reploid-swarm-wirecheck`;

  // 2. Instrument UDP Relay Socket (simulates an untrusted TURN / packet relay between requester and provider).
  const relayPackets = [];
  const relaySock = dgram.createSocket('udp4');
  let targetEndpoint = null;
  let callerEndpoint = null;
  relaySock.on('message', (msg, rinfo) => {
    relayPackets.push(Buffer.from(msg));
    if (targetEndpoint && (rinfo.address !== targetEndpoint.address || rinfo.port !== targetEndpoint.port)) {
      callerEndpoint = { address: rinfo.address, port: rinfo.port };
      relaySock.send(msg, targetEndpoint.port, targetEndpoint.address);
    } else if (callerEndpoint) {
      relaySock.send(msg, callerEndpoint.port, callerEndpoint.address);
    }
  });
  relaySock.bind(0, '127.0.0.1');
  await once(relaySock, 'listening');
  const relayPort = relaySock.address().port;

  // 3. Instrument Fleet Credit Coordinator + SQLite Ledger.
  const [reqIdentity, provIdentity] = await Promise.all([
    createSigningIdentity({ algorithm: 'Ed25519' }),
    createSigningIdentity({ algorithm: 'Ed25519' }),
  ]);
  const model = {
    id: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16',
    identity: 'sha256:cdda7ddc748f581e3c79b5067fc8647a20d43c7030644e0c48b1560a1ac30d7d',
  };
  const sqlitePath = path.join(root, 'credits.sqlite');
  const credits = await openFleetCredits({
    file: sqlitePath,
    computers: [
      { id: 'requester-pc', name: 'Requester', ownerId: 'owner-1', providers: [{ participantId: reqIdentity.peerId, publicJwk: reqIdentity.publicJwk }] },
      { id: 'serving-pc', name: 'Serving PC', ownerId: 'owner-2', providers: [{ participantId: provIdentity.peerId, publicJwk: provIdentity.publicJwk }] },
    ],
    policy: {
      schema: 'reploid.service-credit-policy/v1',
      version: 'wire-audit/1',
      unit: 'noncash-service-credit',
      creditsPerOutputToken: 1,
      maxDebt: 100,
      maxOutputTokens: 32,
      maxPendingPerComputer: 4,
      maxClockSkewMs: 30_000,
      maxRequestMs: 60_000,
      allowSameOwner: true,
      wholeModelTerminalCharge: 0,
    },
  });
  const fleetService = await startFleetService({
    credits,
    models: [model],
    placementPolicy: {
      maxMeasurementAgeMs: 60_000,
      maxObservationAgeMs: 15_000,
      minResidencyMs: 500,
      maxRouteCandidates: 8,
      queuedRequestsPerReplica: 2,
    },
  });

  const RTCPeerConnection = wrtc.RTCPeerConnection || wrtc.default?.RTCPeerConnection;
  const pcRequester = new RTCPeerConnection({ iceServers: [] });
  const pcProvider = new RTCPeerConnection({ iceServers: [] });
  let wsReq = null;
  let wsProv = null;
  let dc = null;

  try {
    // Connect both signaling WebSockets so real SDP/ICE frames traverse SignalingServer.
    wsReq = new WebSocket(wsUrl, { origin: 'http://localhost:8000' });
    wsProv = new WebSocket(wsUrl, { origin: 'http://localhost:8000' });
    await Promise.all([once(wsReq, 'open'), once(wsProv, 'open')]);

    // Rewrite provider's UDP host candidate port to relayPort so EVERY WebRTC packet traverses relaySock!
    pcProvider.onicecandidate = ({ candidate }) => {
      if (!candidate || !candidate.candidate) return;
      const m = candidate.candidate.match(/candidate:\S+\s+\d+\s+udp\s+\d+\s+(127\.0\.0\.1)\s+(\d+)\s+typ\s+host/i);
      if (!m) return;
      if (!targetEndpoint) {
        targetEndpoint = { address: m[1], port: Number(m[2]) };
      }
      const rewritten = candidate.candidate.replace(`${m[1]} ${m[2]} typ host`, `127.0.0.1 ${relayPort} typ host`);
      wsProv.send(JSON.stringify({ type: 'ice-candidate', candidate: { ...candidate.toJSON(), candidate: rewritten } }));
      pcRequester.addIceCandidate({ ...candidate.toJSON(), candidate: rewritten }).catch(() => {});
    };

    let providerReceivedPrompt = null;
    pcProvider.ondatachannel = ({ channel }) => {
      channel.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        providerReceivedPrompt = msg.messages[0].content;
        channel.send(JSON.stringify({ requestId: msg.requestId, content: answerCanary, outputTokens: 5 }));
      };
    };

    dc = pcRequester.createDataChannel('reploid-inference');
    const offer = await pcRequester.createOffer();
    await pcRequester.setLocalDescription(offer);
    wsReq.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
    await pcProvider.setRemoteDescription(offer);
    const answer = await pcProvider.createAnswer();
    await pcProvider.setLocalDescription(answer);
    wsProv.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
    await pcRequester.setRemoteDescription(answer);

    if (dc.readyState !== 'open') {
      await once(dc, 'open');
    }

    // Reserve, dispatch, admit, exchange canary prompt/answer over relayed DTLS DataChannel, and settle credits!
    const fleetWireChunks = [];
    const capturingFetch = async (url, options = {}) => {
      if (options.body) {
        fleetWireChunks.push(Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8'));
      }
      const res = await fetch(url, options);
      const textBody = await res.text();
      fleetWireChunks.push(Buffer.from(textBody, 'utf8'));
      return {
        ok: res.ok,
        status: res.status,
        json: async () => JSON.parse(textBody),
      };
    };
    const reqFleet = createFleetClient({ url: fleetService.url, identity: reqIdentity, fetchImpl: capturingFetch });
    const provFleet = createFleetClient({ url: fleetService.url, identity: provIdentity, fetchImpl: capturingFetch });

    const attemptId = randomUUID();
    const reservationId = `service:${reqIdentity.peerId}:${attemptId}`;
    const messages = [{ role: 'user', content: promptCanary }];
    const promptDigest = await hashJson(messages);
    const salt = randomBytes(32).toString('hex');
    const commitment = await hashJson({ salt, messages, settings: null });
    const modelSpec = { id: model.id, identity: model.identity, adapterIdentities: [] };

    await reqFleet.call('reserve', {
      id: reservationId,
      executionId: attemptId,
      mode: 'whole-model',
      consumer: reqIdentity.peerId,
      model: modelSpec,
      inputDigest: promptDigest,
      maxOutputTokens: 16,
      providers: [{ participantId: provIdentity.peerId, weight: 1 }],
      admission: { schema: 'reploid.credit-preadmission/v1', commitment },
    });
    await reqFleet.call('dispatch', { id: reservationId });
    await provFleet.call('preadmit', {
      id: reservationId,
      executionId: attemptId,
      mode: 'whole-model',
      consumer: reqIdentity.peerId,
      model: modelSpec,
      commitment,
    });
    await provFleet.call('admit', {
      id: reservationId,
      executionId: attemptId,
      mode: 'whole-model',
      consumer: reqIdentity.peerId,
      model: modelSpec,
      inputDigest: promptDigest,
      outputLimit: 16,
    });

    // Send canary prompt over WebRTC DataChannel (through our UDP packet-capturing relay!) and await canary answer.
    const replyPromise = new Promise((resolve) => {
      dc.onmessage = (ev) => resolve(JSON.parse(String(ev.data)));
    });
    dc.send(JSON.stringify({ requestId: attemptId, messages }));
    const providerReply = await replyPromise;

    assert.equal(providerReceivedPrompt, promptCanary, 'Serving computer must receive the prompt');
    assert.equal(providerReply.content, answerCanary, 'Requester must receive the streamed answer');

    // Sign and countersign whole-model execution receipt (binds digests only, never raw text!) and settle at FleetService.
    const measured = await measureWholeModelReceipt(messages, {
      content: providerReply.content,
      modelIdentity: model.identity,
      adapterIdentities: [],
      completion: {
        schema: 'doppler.generation-completion/v1',
        promptTokenCount: 9,
        generatedTokenCount: providerReply.outputTokens,
        stopReason: 'eos-token',
      },
    });
    const draft = await createReceiptDraft({
      ...measured,
      provider: provIdentity.peerId,
      consumer: reqIdentity.peerId,
      jobHash: `request:${attemptId}`,
      model: model.id,
      timestamp: Date.now(),
    });
    const providerSigned = await signReceiptDraft(draft, provIdentity);
    const fullySigned = await countersignReceipt(providerSigned, reqIdentity);
    await provFleet.call('settle', { id: reservationId, evidence: fullySigned });

    const snap = credits.snapshot();
    assert.equal(snap.accounts.find((a) => a.id === 'serving-pc').balance, 5);
    assert.equal(snap.accounts.every((a) => a.held === 0), true);

    // 4. Probe Coordinator HTTP endpoints (`/pool/peer/rooms` and `/pool/jobs` and `/pool/audits/canary`) with canary injection attempts!
    const roomRejectRes = await fetch(`${coordUrl}/pool/peer/rooms/room-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: 'peer-a',
        type: 'webrtc-signal',
        payload: { prompt: promptCanary, outputText: answerCanary },
      }),
    });
    assert.equal(roomRejectRes.status, 400, 'Peer room relay must reject prompt/output payloads with HTTP 400');

    const jobRejectRes = await fetch(`${coordUrl}/pool/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requesterId: 'req-1',
        prompt: promptCanary,
      }),
    });
    assert.equal(jobRejectRes.status, 400, 'Production coordinator /pool/jobs must reject plaintext prompt submission with HTTP 400');

    const auditRejectRes = await fetch(`${coordUrl}/pool/audits/canary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'prov-1',
        prompt: promptCanary,
        expectedOutputText: answerCanary,
      }),
    });
    assert.equal(auditRejectRes.status, 403, 'Production coordinator /pool/audits/canary must reject unprivileged canary creation with HTTP 403');

    // 5. Inspect captured bytes at every boundary!
    const allSignalingBytes = Buffer.concat(signalingFrames);
    const allRelayBytes = Buffer.concat(relayPackets);
    const allFleetHttpWireBytes = Buffer.concat(fleetWireChunks);
    const sqliteFiles = await fs.readdir(root);
    const sqliteBuffers = await Promise.all(
      sqliteFiles.filter((f) => f.startsWith('credits.sqlite')).map((f) => fs.readFile(path.join(root, f)))
    );
    const allFleetSqliteBytes = Buffer.concat(sqliteBuffers);
    const allPoolStoreBytes = Buffer.from(JSON.stringify({
      jobs: await poolStore.listJobs(),
      roomMessages: await poolStore.listPeerRoomMessages('room-1'),
    }), 'utf8');

    assert.ok(signalingFrames.length > 0, 'Signaling capture must observe WebSocket handshake frames');
    assert.ok(relayPackets.length > 0 && allRelayBytes.length > 0, 'UDP relay capture must observe real WebRTC packets');
    assert.ok(allFleetHttpWireBytes.length > 0, 'Fleet HTTP wire capture must observe /v1/fleet envelopes');
    assert.ok(allFleetSqliteBytes.length > 0, 'Fleet SQLite capture must inspect persisted ledger bytes');

    const checks = {
      signalingFramesObserved: signalingFrames.length,
      signalingBytesObserved: allSignalingBytes.length,
      signalingPromptCanaryMatches: countBufferOccurrences(allSignalingBytes, promptCanary),
      signalingAnswerCanaryMatches: countBufferOccurrences(allSignalingBytes, answerCanary),
      udpRelayPacketsObserved: relayPackets.length,
      udpRelayBytesObserved: allRelayBytes.length,
      udpRelayPromptCanaryMatches: countBufferOccurrences(allRelayBytes, promptCanary),
      udpRelayAnswerCanaryMatches: countBufferOccurrences(allRelayBytes, answerCanary),
      fleetHttpWireBytesObserved: allFleetHttpWireBytes.length,
      fleetHttpPromptCanaryMatches: countBufferOccurrences(allFleetHttpWireBytes, promptCanary),
      fleetHttpAnswerCanaryMatches: countBufferOccurrences(allFleetHttpWireBytes, answerCanary),
      fleetSqliteBytesInspected: allFleetSqliteBytes.length,
      fleetSqlitePromptCanaryMatches: countBufferOccurrences(allFleetSqliteBytes, promptCanary),
      fleetSqliteAnswerCanaryMatches: countBufferOccurrences(allFleetSqliteBytes, answerCanary),
      coordinatorStorePromptCanaryMatches: countBufferOccurrences(allPoolStoreBytes, promptCanary),
      coordinatorStoreAnswerCanaryMatches: countBufferOccurrences(allPoolStoreBytes, answerCanary),
      peerRoomPromptInjectionHttpStatus: roomRejectRes.status,
      coordinatorPlaintextJobHttpStatus: jobRejectRes.status,
      coordinatorUnprivilegedCanaryHttpStatus: auditRejectRes.status,
      servingComputerReadPrompt: providerReceivedPrompt === promptCanary,
      requesterBrowserReadAnswer: providerReply.content === answerCanary,
    };

    assert.equal(checks.signalingPromptCanaryMatches, 0, 'Signaling server must see 0 prompt bytes');
    assert.equal(checks.signalingAnswerCanaryMatches, 0, 'Signaling server must see 0 answer bytes');
    assert.equal(checks.udpRelayPromptCanaryMatches, 0, 'UDP/TURN relay must see 0 plaintext prompt bytes (DTLS encrypted)');
    assert.equal(checks.udpRelayAnswerCanaryMatches, 0, 'UDP/TURN relay must see 0 plaintext answer bytes (DTLS encrypted)');
    assert.equal(checks.fleetHttpPromptCanaryMatches, 0, 'Fleet /v1/fleet HTTP wire must see 0 prompt bytes');
    assert.equal(checks.fleetHttpAnswerCanaryMatches, 0, 'Fleet /v1/fleet HTTP wire must see 0 answer bytes');
    assert.equal(checks.fleetSqlitePromptCanaryMatches, 0, 'Fleet credit ledger must store 0 prompt bytes');
    assert.equal(checks.fleetSqliteAnswerCanaryMatches, 0, 'Fleet credit ledger must store 0 answer bytes');
    assert.equal(checks.coordinatorStorePromptCanaryMatches, 0, 'Pool coordinator store must retain 0 prompt bytes');
    assert.equal(checks.coordinatorStoreAnswerCanaryMatches, 0, 'Pool coordinator store must retain 0 answer bytes');

    return {
      schema: 'reploid.wire-visibility-audit/v1',
      verifiedUtc: new Date().toISOString(),
      checks,
      visibilityMatrix: [
        { party: 'your-device', prompt: 'plaintext', answer: 'plaintext', metadata: 'model, recipient Ed25519 key, timing, receipt' },
        { party: 'coordinator', prompt: 'none (SHA-256 commitment/digest only on credited routes)', answer: 'none (SHA-256 digest & token count only on credited routes)', metadata: 'room rendezvous, SDP/ICE signaling, enrolled public keys, credit balances' },
        { party: 'udp-turn-relay', prompt: 'none (DTLS-encrypted WebRTC DataChannel)', answer: 'none (DTLS-encrypted WebRTC DataChannel)', metadata: 'endpoint IP/port, packet sizes, timing' },
        { party: 'serving-computer', prompt: 'plaintext (required to execute model weights today)', answer: 'plaintext', metadata: 'requester peer identity, model, token limits' },
      ],
    };
  } finally {
    dc?.close();
    pcRequester.close();
    pcProvider.close();
    wsReq?.close();
    wsProv?.close();
    await fleetService.close();
    credits.close();
    relaySock.close();
    await signaling.close();
    coordServer.closeAllConnections();
    await new Promise((resolve) => coordServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

const isDirectEntry = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectEntry) {
  const [, , argument, scenario, checkout, fixtureOut] = process.argv;
  let receipt, outFile = argument;
  if (argument === '--circle-fixture') {
    assert.ok(scenario && checkout, 'Usage: --circle-fixture invite|reconnect /absolute/review-checkout [receipt.json]');
    const { runCircleWireFixture } = await import('./verify-wire-circle-fixtures.js');
    receipt = await runCircleWireFixture({ scenario, checkout });
    outFile = fixtureOut;
  } else {
    receipt = await runWireVisibilityVerification();
  }
  if (outFile) {
    await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
    await fs.writeFile(path.resolve(outFile), JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify(receipt, null, 2));
}
