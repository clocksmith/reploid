#!/usr/bin/env node
/**
 * One host process of the scoring-rollout runs (run.js).
 *
 *   node tests/fixtures/scoring-rollout/host.js REPO_ROOT HOST_JSON FRAME_LOG
 *
 * REPO_ROOT is the checkout whose code this host runs: the current one, or an older release checked out beside it with
 * its own `npm ci`. The host is that checkout's real fleet native host (server/fleet/native-host.js) with its own key
 * file, its real mesh over WebRTC, its real credit client against the ledger service process, and its own production
 * transport codec and frame registry. One thing is replaced: the model (scripted-model.js), by a resolve hook on that
 * checkout's native participant, so no weights are read and no GPU is opened.
 *
 * Every frame this process RECEIVES, on a WebRTC data channel or relayed by the signaling server, is appended to
 * FRAME_LOG as one JSON line: when, how, the frame type, its size and whether it carries a payload (a prompt, a target
 * or an operation's input). Only the advertisement and the scoring frames are written whole (scripted text, keys made
 * for the run); a generation request is written as its field names.
 *
 * Commands, one JSON object per line on standard input, answered on standard output with the same `id`:
 *   { op: 'wait-route', providerId }                     until this requester sees the named provider ready and verified
 *   { op: 'daily', prompt, target, providerId }          server/daily/fleet.js runDailyFleet of this checkout
 *   { op: 'operation', operation, payload, providerId }  textParticipant.executeMeshOperation (current checkout only)
 *   { op: 'peers' } | { op: 'balances' } | { op: 'trades' } | { op: 'trade', reservationId } | { op: 'state' }
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire, registerHooks } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [root, configFile, frameFile] = process.argv.slice(2).map(value => path.resolve(value));
if (!root || !configFile || !frameFile) throw new Error('usage: host.js REPO_ROOT HOST_JSON FRAME_LOG');
const at = file => pathToFileURL(path.join(root, file)).href;
const runtimeUrl = at('server/native-participant-runtime.js'), wholeUrl = at('server/native-whole-model.js');
const scripted = new URL('./scripted-model.js', import.meta.url).href;
// Only the native participant's import of its whole model is redirected; nothing else in that checkout changes.
registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return resolved.url === wholeUrl && context.parentURL === runtimeUrl ? { url: scripted, format: 'module', shortCircuit: true } : resolved;
  }
});

const frames = fs.openSync(frameFile, 'a');
const RECORDED = new Set(['reploid:peer-advertisement', 'reploid:target-score-request', 'reploid:target-score-result',
  'reploid:mesh-operation-request', 'reploid:mesh-operation-result', 'reploid:mesh-operation-receipt', 'reploid:mesh-operation-cancel']);
/** What a frame carries that only an admitted provider should see. */
const carriesPayload = (type, payload) => {
  if (type === 'reploid:mesh-operation-request') return Boolean(payload?.envelope && Object.hasOwn(payload.envelope, 'payload'));
  if (type === 'reploid:target-score-request') return typeof payload?.target === 'string' || Array.isArray(payload?.messages);
  if (type === 'reploid:generation-request') return Array.isArray(payload?.request?.messages) || Array.isArray(payload?.messages);
  return false;
};
const logFrame = (via, envelope, bytes) => {
  const type = typeof envelope?.type === 'string' ? envelope.type : null;
  if (!type || type === 'ping' || type === 'pong') return;
  const payload = envelope.payload;
  const row = { at: new Date().toISOString(), via, from: envelope.peerId ?? null, type, bytes,
    requestId: payload?.requestId ?? payload?.envelope?.requestId ?? null, carriesPayload: carriesPayload(type, payload),
    ...(type === 'reploid:peer-advertisement' ? { advertised: { role: payload?.role ?? null, admissionProtocol: payload?.admissionProtocol ?? null,
      supportedOperations: Object.hasOwn(payload ?? {}, 'supportedOperations') ? payload.supportedOperations : '(absent)' } } : {}),
    ...(type === 'reploid:mesh-operation-result' || type === 'reploid:target-score-result'
      ? { answer: payload?.error ? { error: payload.error, code: payload.code ?? null } : Object.keys(payload ?? {}).sort() } : {}),
    payloadKeys: Object.keys(payload ?? {}).sort(),
    // The whole frame for the scoring protocols and the advertisement, which carry only scripted text and keys made for
    // the run: the recorded old-peer transcript the CI tests replay is cut from these (old-peer-transcript.json).
    ...(RECORDED.has(type) ? { frame: payload } : {}) };
  fs.writeSync(frames, JSON.stringify(row) + '\n');
};
const parse = data => { try { return JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return null; } };

const require = createRequire(path.join(root, 'package.json'));
const loadRtc = async () => {
  const module = await import(pathToFileURL(require.resolve('@roamhq/wrtc')).href);
  const base = module.default ?? module;
  const tap = channel => channel.addEventListener('message', event => logFrame('datachannel', parse(event.data), String(event.data?.length ?? 0)));
  class TappedPeerConnection extends base.RTCPeerConnection {
    constructor(...args) { super(...args); this.addEventListener('datachannel', event => tap(event.channel)); }
    createDataChannel(...args) { const channel = super.createDataChannel(...args); tap(channel); return channel; }
  }
  return { ...base, RTCPeerConnection: TappedPeerConnection };
};
const loadSocket = async () => {
  const module = await import(pathToFileURL(require.resolve('ws')).href);
  const Base = module.default ?? module.WebSocket;
  class TappedSocket extends Base {
    constructor(...args) {
      super(...args);
      this.on('message', data => { const message = parse(data); if (message?.type === 'relay-message') logFrame('signaling-relay', message.envelope, data.length); });
    }
  }
  return { ...module, default: TappedSocket, WebSocket: TappedSocket };
};

const { openFleetNativeHost } = await import(at('server/fleet/native-host.js'));
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const host = await openFleetNativeHost({ configuration: config, loadRtc, loadSocket,
  loadGpu: async () => { throw new Error('The scoring-rollout host opens no GPU'); },
  onChange: value => { if (value?.warning || value?.error) process.stderr.write(JSON.stringify({ event: 'fleet-state', warning: value.warning, error: value.error }) + '\n'); } });
if (Number.isSafeInteger(config.initialModel)) await host.select(config.initialModel, config.initialContribution === true);
await host.reconcileCredits?.().catch(error => process.stderr.write(JSON.stringify({ event: 'fleet-error', error: error.message }) + '\n'));
const commit = (() => { try { return fs.readFileSync(path.join(root, '.git'), 'utf8').trim(); } catch { return null; } })();
console.log(JSON.stringify({ ready: true, root, gitFile: commit, participantId: host.identity.peerId, scripted: 'no weights, no GPU' }));

const model = config.models[config.initialModel ?? 0].model;
// The settings a Daily turn pins, normalized by this checkout as openDailyFleet does (without the reverse prompt of the real model).
const { normalizeGenerationSettings } = await import(at('shared/vendor/reploid/mesh/generation-settings.js'));
const pinsFor = providerId => ({ modelId: model.id, modelIdentity: model.identity, providerId, settings: normalizeGenerationSettings({ maxOutputTokens: 16 }) });
const routeTo = providerId => host.textParticipant.getState().models?.find(row => !row.partition && row.id === model.id && row.identity === model.identity
  && ['ready', 'busy'].includes(row.availability) && Object.values(row.verifiedProviderIdentities ?? {}).includes(providerId));
const peers = () => (host.textParticipant.getNetworkState().peers ?? []).map(peer => ({ participantId: peer.participantId ?? null,
  identityVerified: peer.identityVerified === true, admissionProtocol: peer.admissionProtocol ?? null, readiness: peer.readiness ?? null,
  supportedOperations: Object.hasOwn(peer, 'supportedOperations') ? peer.supportedOperations : '(absent)' }));
const errorOf = error => ({ message: error?.message ?? String(error), code: error?.code ?? null, cause: error?.cause?.message ?? null,
  payloadSent: error?.payloadSent ?? null });

const commands = {
  async 'wait-route'({ providerId }) {
    const signal = AbortSignal.timeout(60_000);
    while (!routeTo(providerId)) {
      await host.textParticipant.verifyProviders(signal).catch(() => {});
      if (routeTo(providerId)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
      signal.throwIfAborted();
    }
    return { route: true, peers: peers() };
  },
  async daily({ prompt, target, providerId }) {
    const { runDailyFleet } = await import(at('server/daily/fleet.js'));
    const startedAt = Date.now();
    try {
      const result = await runDailyFleet(host, pinsFor(providerId), { prompt, target, signal: AbortSignal.timeout(60_000) });
      return { completed: true, ms: Date.now() - startedAt, output: result.output, answerReservation: `service:${host.identity.peerId}:${result.receipt.jobHash.slice('request:'.length)}`,
        receiptProvider: result.receipt.provider, score: result.score };
    } catch (error) { return { completed: false, ms: Date.now() - startedAt, error: errorOf(error) }; }
  },
  async operation({ operation, payload, providerId }) {
    const { createMeshOperationEnvelope, MESH_OPERATION_GRANT_SCHEMA } = await import(at('shared/vendor/reploid/mesh/operation-envelope.js'));
    const envelope = await createMeshOperationEnvelope({ requestId: randomUUID(), operation, modelId: model.id, manifestDigest: model.identity,
      execution: { protection: 'plaintext', route: 'remote', participants: { kind: 'named', ids: [providerId] } }, maxCostUnits: 1, payload,
      recipientGrant: { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: providerId, grantedAt: Date.now(), revokedAt: null } });
    const reservationId = `service:${host.identity.peerId}:${envelope.requestId}`;
    try {
      const result = await host.textParticipant.executeMeshOperation(envelope, { signal: AbortSignal.timeout(30_000) });
      return { completed: true, reservationId, output: result.output, acknowledgedUnits: result.acknowledgedUnits,
        settlement: result.settlement ?? null, records: (result.settlementRecords?.records ?? []).map(record => record.schema) };
    } catch (error) { return { completed: false, reservationId, error: errorOf(error) }; }
  },
  peers: async () => peers(),
  state: async () => host.state(),
  balances: async () => host.balances(),
  trades: async () => host.trades(),
  trade: async ({ reservationId }) => host.tradeRecords(reservationId, { format: 'records' })
};

const lines = createInterface({ input: process.stdin });
let closing = null;
const close = () => closing ||= host.close().finally(() => process.exit(0));
process.once('SIGTERM', close); process.once('SIGINT', close);
for await (const line of lines) {
  void (async () => {
    let command = null;
    try {
      command = JSON.parse(line);
      const run = commands[command.op];
      if (!run) throw new Error(`Unknown command ${command.op}`);
      console.log(JSON.stringify({ id: command.id, result: await run(command) }));
    } catch (error) { console.log(JSON.stringify({ id: command?.id, error: error.message })); }
  })();
}
await close();
