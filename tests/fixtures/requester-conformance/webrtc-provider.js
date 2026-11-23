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
import { FIXED, fixedIdentity, fixedModel } from '../../../scripts/requester-contract/fixed-inputs.js';
import { createStubWholeModel } from '../../../scripts/requester-contract/harness.js';

const log = text => process.stderr.write(`webrtc-provider: ${text}\n`);
const { values } = parseArgs({ strict: true, options: { port: { type: 'string' }, host: { type: 'string' }, room: { type: 'string' },
  token: { type: 'string' }, identity: { type: 'string' }, 'fail-after-chunks': { type: 'string' }, 'chunk-delay-ms': { type: 'string' } } });
const need = (ok, message) => { if (!ok) { log(message); process.exit(1); } };
const port = values.port === undefined ? 0 : Number(values.port);
const host = values.host ?? '127.0.0.1';
const roomId = values.room ?? `reploid-swarm-${randomUUID()}`;
const token = values.token ?? `${randomUUID()}${randomUUID()}`;
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
let provider = null, stopping = false;
const stop = async code => {
  if (stopping) return;
  stopping = true;
  try { await provider?.close(); } catch (error) { log(`Provider close failed: ${error.message}`); }
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
  const generate = createStubWholeModel({ model, chunks: FIXED.answerChunks, completion: FIXED.completion, failAfterChunks,
    pause: () => new Promise(resolve => setTimeout(resolve, chunkDelayMs)),
    onCall: messages => log(`Request ${++requests}: generating for ${messages.length} message(s).`) });
  class HostWebSocket extends Socket { constructor(url) { super(url, { origin }); } }
  provider = await createNativeParticipant({ model, modelDirectory: home, identity, rtc: createNativeRtcAdapter(rtcModule),
    WebSocket: HostWebSocket, signalingUrl, roomId, roomToken: token, logger, executionMode: 'whole-model',
    getRtcConfig: async () => rtcConfig,
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
    mode: { failAfterChunks, chunkDelayMs } })}\n`);
  log(`Serving ${model.id} in ${roomId}. Stop with SIGTERM.`);
} catch (error) {
  log(error.stack || error.message);
  await stop(1);
}
