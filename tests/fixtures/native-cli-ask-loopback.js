// Smoke the installed CLI with a real private WebRTC peer, without weights or a GPU.
// node tests/fixtures/native-cli-ask-loopback.js [path/to/installed/reploid]
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import Socket from 'ws';
import rtcModule from '@roamhq/wrtc';
import { createNativeParticipant, createNativeRtcAdapter } from '../../server/native-participant.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

const exec = promisify(execFile);
const model = catalog.find(row => row.id === 'qwen-3-5-2b-q4k-ehaf16');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-cli-ask-'));
const roomId = 'reploid-swarm-' + randomUUID(), roomToken = randomUUID();
const prompt = 'Local CLI transport check.', answer = 'The loopback provider answered.';
const logger = { debug() {}, info() {}, log() {}, warn: console.error, error: console.error };
const swarm = new PublicSwarmServer({ logger });
const server = http.createServer();
server.on('upgrade', (req, socket, head) => swarm.handleUpgrade(req, socket, head));
let provider;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const signalingUrl = `ws://127.0.0.1:${server.address().port}/swarm`;
  const tokenFile = path.join(home, 'room-token'), configFile = path.join(home, 'rtc.json');
  const rtcConfig = { iceTransportPolicy: 'all', iceServers: [{ urls: ['turn:127.0.0.1:9'], username: 'test', credential: 'test' }] };
  await fs.writeFile(tokenFile, roomToken, { mode: 0o600 });
  await fs.writeFile(configFile, JSON.stringify({ schema: 'reploid.pool.turn_credentials/v1',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), rtcConfig }), { mode: 0o600 });
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  let ready = false, calls = 0;
  const getState = () => ({ ready, phase: ready ? 'ready' : 'idle', modelIdentity: model.identity, adapterIdentities: [] });
  class HostWebSocket extends Socket {
    constructor(url) { super(url, { origin: 'http://localhost:8000' }); }
  }
  provider = await createNativeParticipant({ model, modelDirectory: home, identity, rtc: createNativeRtcAdapter(rtcModule),
    WebSocket: HostWebSocket, signalingUrl, roomId, roomToken, logger, executionMode: 'whole-model',
    generationJournalFile: path.join(home, 'journal.sqlite'), getRtcConfig: async () => rtcConfig,
    nativeGpu: async () => { throw Error('Fixture must use no GPU'); },
    createWholeModel: ({ onChange }) => ({
      getState, getExecutionState: getState,
      contribute() { ready = true; onChange(getState()); return getState(); },
      stop() { ready = false; }, close() { ready = false; },
      generate(messages) {
        assert.deepEqual(messages, [{ role: 'user', content: prompt }]); calls++;
        return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: answer,
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 6, generatedTokenCount: 5, stopReason: 'eos-token' } };
      },
    }) });
  await provider.contribute(true);
  const entry = process.argv[2] || path.resolve(import.meta.dirname, '../../server/native-node.js');
  const { stdout, stderr } = await exec(process.execPath, [entry, 'ask', '2b', prompt, '--room', roomId,
    '--room-token-file', tokenFile, '--rtc-config-file', configFile, '--signaling-url', signalingUrl],
    { cwd: home, env: { ...process.env, HOME: home }, timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(stdout.trim(), answer);
  assert.match(stderr, /can read this request/);
  assert.equal(calls, 1);
  const weightEntries = await fs.readdir(path.join(home, '.reploid', 'weights'),
    { recursive: true, withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.equal(weightEntries.some(entry => entry.isFile()), false, 'Requester downloaded weights');
  console.log('One private WebRTC request returned the exact stand-in answer on stdout.');
} finally {
  await provider?.close();
  swarm.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(home, { recursive: true, force: true });
}
