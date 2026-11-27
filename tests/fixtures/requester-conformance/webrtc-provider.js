#!/usr/bin/env node
/**
 * A real whole-model provider over real signaling and real WebRTC, for testing
 * a requester written in any language. No model weights and no GPU: the model
 * is a stand-in that streams a fixed answer in fixed chunks.
 *
 * It starts the signaling server (server/public-swarm-server.js) on a local
 * port, opens a private room, and joins it with the native participant
 * (server/native-participant-runtime.js) through @roamhq/wrtc and ws, as
 * tests/fixtures/native-cli-ask-loopback.js does. Everything on the wire is
 * what a real native provider sends, including frames a requester ignores.
 *
 * It prints one line of JSON when it is ready and stays up until SIGTERM or SIGINT:
 *   { "ready": true, "wsUrl", "signalingUrl", "roomId", "token", "origin", "iceServers",
 *     "model": { "id", "identity", "name" }, "provider": { "participantId", "algorithm", "publicJwk" },
 *     "answer": { "chunks", "content", "completion" } }
 * Connect a WebSocket to wsUrl with the header "Origin: <origin>", then join
 * with roomId and token. Diagnostics go to standard error only.
 *
 *   node tests/fixtures/requester-conformance/webrtc-provider.js [options]
 *     --port <n>                 signaling port (default: any free port)
 *     --host <address>           address to listen on (default 127.0.0.1)
 *     --room <roomId>            private room id (default: generated)
 *     --token <text>             room token, at least 32 characters (default: generated)
 *     --identity ed25519|ecdsa   fixed test key the provider signs with (default ed25519)
 *     --fail-after-chunks <n>    the model fails after n chunks
 *     --chunk-delay-ms <n>       pause before each chunk (default 20)
 *
 * Owner-desktop mode (the contract's owner pairing), as the native host runs with --owner-pairing:
 *     --pairing                  issue one pairing code and add "pairing" (link, code, hostParticipantId, hostLabel,
 *                                roomId, roomToken, expiresAt) to the ready line; pair the phone that sends the code;
 *                                answer only requests from a paired phone. The room token is the pairing routing
 *                                marker, so --token is not allowed with it.
 *     --pairing-name <label>     accepted for older callers; links carry no name
 *     --pairing-expired          the code in the link has already expired
 *     --pairing-decline          the desktop owner answers no
 *     --pairing-forget-after-requests <n>  after n answered requests the desktop's pairing state is deleted
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Socket from 'ws';
import rtcModule from '@roamhq/wrtc';
import bootstrap from '../../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { createNativeParticipant, createNativeRtcAdapter } from '../../../server/native-participant.js';
import { PublicSwarmServer } from '../../../server/public-swarm-server.js';
import { ROOM_ID_PATTERN } from '../../../server/swarm-protocol.js';
import { FIXED, FIXED_PAIRING, fixedIdentity, fixedModel } from '../../../scripts/requester-contract/fixed-inputs.js';
import { createStubWholeModel } from '../../../scripts/requester-contract/harness.js';
import { openPairingDesktop } from '../../../scripts/requester-contract/pairing-desktop.js';

const log = text => process.stderr.write(`webrtc-provider: ${text}\n`);
const { values } = parseArgs({ strict: true, options: { port: { type: 'string' }, host: { type: 'string' }, room: { type: 'string' },
  token: { type: 'string' }, identity: { type: 'string' }, 'fail-after-chunks': { type: 'string' }, 'chunk-delay-ms': { type: 'string' },
  pairing: { type: 'boolean' }, 'pairing-name': { type: 'string' }, 'pairing-expired': { type: 'boolean' },
  'pairing-decline': { type: 'boolean' }, 'pairing-forget-after-requests': { type: 'string' } } });
const need = (ok, message) => { if (!ok) { log(message); process.exit(1); } };
const port = values.port === undefined ? 0 : Number(values.port);
const host = values.host ?? '127.0.0.1';
const roomId = values.room ?? `reploid-swarm-${randomUUID()}`;
const pairingMode = values.pairing === true;
const pairingName = (values['pairing-name'] ?? FIXED_PAIRING.desktopLabel).trim();
const forgetAfterRequests = values['pairing-forget-after-requests'] === undefined ? null : Number(values['pairing-forget-after-requests']);
need(pairingMode || !values['pairing-expired'] && !values['pairing-decline'] && forgetAfterRequests === null && values['pairing-name'] === undefined, 'the --pairing-... options need --pairing');
need(!pairingMode || values.token === undefined, '--pairing uses the pairing routing marker as room token; do not pass --token');
need(pairingName.length > 0 && pairingName.length <= 128, '--pairing-name must be 1 to 128 characters');
need(forgetAfterRequests === null || Number.isSafeInteger(forgetAfterRequests) && forgetAfterRequests > 0, '--pairing-forget-after-requests must be a whole number above zero');
let token = values.token ?? `${randomUUID()}${randomUUID()}`;
const failAfterChunks = values['fail-after-chunks'] === undefined ? null : Number(values['fail-after-chunks']);
const chunkDelayMs = values['chunk-delay-ms'] === undefined ? 20 : Number(values['chunk-delay-ms']);
need(Number.isInteger(port) && port >= 0 && port <= 65535, '--port must be a port number');
need(ROOM_ID_PATTERN.test(roomId) && roomId !== bootstrap.publicRoomId, '--room must be a private room id starting with reploid-swarm-');
need(token.length >= 32 && token.length <= 1024 && token !== bootstrap.publicJoinMarker, '--token must be 32 to 1024 characters');
need(['ed25519', 'ecdsa', undefined].includes(values.identity), '--identity must be ed25519 or ecdsa');
need(failAfterChunks === null || Number.isSafeInteger(failAfterChunks) && failAfterChunks >= 0, '--fail-after-chunks must be a whole number');
need(Number.isSafeInteger(chunkDelayMs) && chunkDelayMs >= 0, '--chunk-delay-ms must be a whole number');

const origin = FIXED.origin;
const model = fixedModel(), identity = fixedIdentity(values.identity === 'ecdsa' ? 'providerEcdsa' : 'providerEd25519');
const logger = { debug() {}, info() {}, log() {}, warn: (...parts) => log(parts.map(String).join(' ')), error: (...parts) => log(parts.map(String).join(' ')) };
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-conformance-provider-'));
const swarm = new PublicSwarmServer({ logger });
const server = http.createServer();
server.on('upgrade', (request, socket, head) => swarm.handleUpgrade(request, socket, head));
let provider = null, desktop = null, stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  try { await provider?.close(); } catch (error) { log(`Provider close failed: ${error.message}`); }
  try { await desktop?.close(); } catch (error) { log(`Pairing close failed: ${error.message}`); }
  swarm.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(home, { recursive: true, force: true });
  process.exit(code);
};
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stop(0); });

try {
  server.listen(port, host);
  await once(server, 'listening');
  const signalingUrl = `ws://${host.includes(':') ? `[${host}]` : host}:${server.address().port}${bootstrap.path}`;
  // Host candidates only: nothing outside this computer or its network is contacted.
  const rtcConfig = { iceTransportPolicy: 'all', iceServers: [] };
  let ready = false, requests = 0;
  const getState = () => ({ ready, phase: ready ? 'ready' : 'idle', modelIdentity: model.identity, adapterIdentities: [] });
  const answer = createStubWholeModel({ model, chunks: FIXED.answerChunks, completion: FIXED.completion, failAfterChunks,
    pause: () => new Promise(resolve => setTimeout(resolve, chunkDelayMs)),
    onCall: messages => log(`Request ${++requests}: generating for ${messages.length} message(s).`) });
  if (pairingMode) {
    desktop = await openPairingDesktop({ identity, roomId, label: pairingName, expired: values['pairing-expired'] === true,
      decline: values['pairing-decline'] === true, forgetAfterRequests, log });
    // As the native command does for a pairing room: the token is the routing marker, not a secret.
    token = desktop.roomToken;
  }
  const generate = async (...args) => { const result = await answer(...args); desktop?.requestAnswered(); return result; };
  class HostWebSocket extends Socket { constructor(url) { super(url, { origin }); } }
  provider = await createNativeParticipant({ model, modelDirectory: home, identity, rtc: createNativeRtcAdapter(rtcModule),
    WebSocket: HostWebSocket, signalingUrl, roomId, roomToken: token, logger, executionMode: 'whole-model',
    getRtcConfig: async () => rtcConfig,
    ...(desktop ? { ownerPairing: desktop.ownerPairing } : {}),
    nativeGpu: async () => { throw new Error('The conformance provider uses no GPU'); },
    createWholeModel: ({ onChange }) => ({
      getState, getExecutionState: getState,
      contribute() { ready = true; onChange(getState()); return getState(); },
      stop() { ready = false; }, close() { ready = false; },
      generate
    }) });
  await provider.contribute(true);
  process.stdout.write(`${JSON.stringify({ ready: true, wsUrl: `${signalingUrl}?scope=private&roomId=${roomId}`, signalingUrl, roomId, token, origin,
    iceServers: rtcConfig.iceServers,
    model: { id: model.id, identity: model.identity, name: model.name },
    provider: { participantId: identity.peerId, algorithm: identity.algorithm, publicJwk: identity.publicJwk },
    answer: { chunks: [...FIXED.answerChunks], content: FIXED.answerChunks.join(''), completion: { ...FIXED.completion } },
    mode: { failAfterChunks, chunkDelayMs },
    ...(desktop ? { pairing: desktop.issue() } : {}) })}\n`);
  log(`Serving ${model.id} in ${roomId}. Stop with SIGTERM.`);
} catch (error) {
  log(error.stack || error.message);
  await stop(1);
}
