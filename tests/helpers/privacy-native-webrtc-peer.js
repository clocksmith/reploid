/** Isolated native WebRTC qualification peer. stdin/stdout carry negotiation and control only. */
import { createInterface } from 'node:readline';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import rtcModule from '@roamhq/wrtc';
const rtc = rtcModule.default ?? rtcModule;
const role = process.argv[2], roomId = process.argv[3];
if (!['provider', 'requester'].includes(role) || !roomId) throw Error('Explicit qualification role and room required');
const identity = await createSigningIdentity({ algorithm: role === 'provider' ? 'ECDSA' : 'Ed25519' });
let model = process.argv[4] ? JSON.parse(process.argv[4]) : { id: 'privacy-native-fixture', identity: 'sha256:' + 'a'.repeat(64) };
let whole = null, gpu = null;
if (role === 'provider' && process.env.REPLOID_PRIVACY_LIVE_MODEL_DIR) {
  const fs = await import('node:fs/promises'), { createHash } = await import('node:crypto');
  const { createNativeWholeModel } = await import('../../server/native-whole-model.js');
  const { createNativeGpuHost } = await import('../../server/native-participant.js');
  const directory = process.env.REPLOID_PRIVACY_LIVE_MODEL_DIR, bytes = await fs.readFile(directory + '/manifest.json'), manifest = JSON.parse(bytes);
  model = { id: manifest.modelId, provider: 'doppler', identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    generation: { maxTokens: 4, maxSeqLen: 512, temperature: 0, topP: 1, topK: 1, repetitionPenalty: 1,
      repetitionPenaltyWindow: 0, stopSequences: [], useChatTemplate: true },
    loadOptions: { runtimeConfig: { inference: { session: { kvcache: { maxSeqLen: 512 } } } } } };
  gpu = createNativeGpuHost(() => import('webgpu'));
  whole = createNativeWholeModel({ model, modelDirectory: directory, nativeGpu: () => gpu.open() });
  await whole.contribute(true);
}
const send = value => new Promise(resolve => process.stdout.write('REPLOID_PRIVACY_QUALIFICATION ' + JSON.stringify(value) + '\n', resolve));
let listener, transport, currentController, revokeDuringApproval = false, offering = role === 'provider', executions = 0, requestFrames = 0;
const handlers = new Map();
const events = { on(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); return () => handlers.get(name).delete(fn); },
  emit(name, value) { for (const fn of handlers.get(name) || []) fn(value); } };
const config = resolveConfig({ overrides: { mesh: { enabled: true, executeJobs: true, roomId, generationTimeoutMs: 1500 }, webrtc: { rtcConfig: { iceServers: [] } } } });
const logger = Object.fromEntries(['info', 'debug', 'warn', 'error'].map(key => [key, () => {}]));
const mesh = createPeerGenerationMesh({ config, ports: {
  instanceId: 'qualification-' + role, modelConfig: role === 'provider' ? { id: model.id } : null,
  getExecutionState: () => ({ ...(whole?.getExecutionState() ?? {}), phase: offering ? 'ready' : 'idle', modelIdentity: model.identity, adapterIdentities: [] }),
  async authorize(request) {
    if (request.action === 'mesh.dispatch' && revokeDuringApproval) {
      await Promise.resolve(); currentController.abort(Error('Qualification disclosure revoked')); return true;
    }
    return true;
  }, identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} }, events, eventBus: events,
  utils: { generateId: prefix => prefix + ':' + crypto.randomUUID() },
  generate: async (messages, update, control) => { executions++; if (whole) return whole.generate(messages, update, control); return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Fixture answer',
    completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: 2, stopReason: 'eos-token' },
    qualificationPolicy: control.privacyBinding?.policyId ?? null }; },
  createTransport() {
    transport = createWebRTCSwarm({ config, Utils: { logger, generateId: prefix => prefix + ':' + crypto.randomUUID() }, EventBus: events,
      peerId: role + ':' + crypto.randomUUID(), getSessionId: () => roomId, getRoomCredentials: () => ({ roomId, token: '' }),
      ...rtc, signalingAdapter: { subscribe(fn) { listener = fn; return () => { listener = null; }; }, publish(message) { send({ event: 'signal', message }); } } });
    return { ...transport, sendToPeer(peerId, type, payload) { if (type === 'reploid:generation-request') requestFrames++; return transport.sendToPeer(peerId, type, payload); } };
  }
} });
const stats = () => ({ executions, requestFrames, relayMessagesSent: transport?.getStats().relayMessagesSent ?? 0,
  peers: transport?.getPeerStates().filter(row => row.channelState === 'open').map(row => ({ transport: row.transport, phase: row.phase,
    fingerprintBound: !!transport.getPeerBinding(row.id) })) ?? [] });
async function waitForProvider() {
  const end = Date.now() + 15000;
  while (!mesh.getSwarmSnapshot().peers.some(peer => peer.readiness === 'ready' && peer.identityVerified)) {
    if (Date.now() > end) throw Error('Authenticated WebRTC provider did not become ready');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function command(input) {
  if (input.command === 'close') { await mesh.close(); await whole?.close(); await gpu?.close(); await send({ event: 'closed', id: input.id, stats: stats() }); process.exit(0); }
  if (input.command === 'state') return send({ event: 'result', id: input.id, stats: stats() });
  if (input.command === 'offering') { offering = input.value === true; mesh.refreshAdvertisement(); return send({ event: 'result', id: input.id, stats: stats() }); }
  if (input.command !== 'run' || role !== 'requester') throw Error('Unknown qualification command');
  if (!['disappeared', 'unsupported'].includes(input.mode)) await waitForProvider();
  const peer = mesh.getSwarmSnapshot().peers.find(peer => peer.identityVerified), recipient = peer?.participantId;
  if (input.mode !== 'unsupported' && !recipient) throw Error('Verified recipient required');
  const privacy = input.mode === 'unsupported' ? createExecutionPolicy('cryptographic', { protocol: 'unqualified', keyContext: 'client-key' })
    : input.mode === 'visible' ? createExecutionPolicy() : createExecutionPolicy('restricted', { placement: 'network-allowed',
      allowedRecipients: input.mode === 'denied' ? ['sha256:' + 'f'.repeat(64)] : [recipient] });
  currentController = new AbortController(); revokeDuringApproval = input.mode === 'revoked';
  const before = requestFrames;
  try {
    const result = await mesh.generate([{ role: 'user', content: 'Public privacy qualification fixture.' }], null, { signal: currentController.signal,
      modelId: model.id, modelIdentity: model.identity, privacy });
    send({ event: 'result', id: input.id, succeeded: true, modelIdentity: result.modelIdentity, deltaRequests: requestFrames - before, stats: stats() });
  } catch (error) { send({ event: 'result', id: input.id, succeeded: false, error: error.message, deltaRequests: requestFrames - before, stats: stats() }); }
  finally { currentController = null; revokeDuringApproval = false; }
}
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  if (line.length > 1048576) throw Error('Qualification control frame too large');
  const value = JSON.parse(line);
  if (value.signal) { Promise.resolve(listener?.(value.signal)).catch(error => send({ event: 'failure', error: error.message })); return; }
  Promise.resolve(command(value)).catch(error => send({ event: 'failure', id: value.id, error: error.message }));
});
input.on('close', () => { void command({ command: 'close', id: 'stdin-closed' }); });
await mesh.connect(); send({ event: 'ready', role, identity: identity.peerId, model: { id: model.id, identity: model.identity }, numericalPort: whole ? 'real-cached-model' : 'fixture' });
