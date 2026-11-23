#!/usr/bin/env node
/**
 * A real whole-model provider for a requester written in any language, with the
 * data channel replaced by standard input and output.
 *
 * What is real: the provider mesh (createPeerGenerationMesh), the identity
 * proof, admission, receipts, recovery and the swarm transport's envelope
 * handling. What is a stand-in: the model (a fixed answer in fixed chunks) and
 * the WebRTC connection (see scripts/requester-contract/harness.js).
 *
 * Framing: one envelope per line, as JSON text, in both directions. The first
 * line this program writes is not an envelope: it is {"ready":true,...} and
 * describes the room, the two connection names, the two DTLS fingerprints, the
 * provider identity and the model. Diagnostics go to standard error only.
 *
 * The requester must behave as if a "reploid" data channel just opened to the
 * provider: use requester.transportId as its own connection name, and
 * { local: requester.fingerprint, remote: provider.fingerprint } as its DTLS
 * binding. The provider drops a peer that sends nothing for 60 seconds, so
 * answer each ping with a pong.
 *
 *   node tests/fixtures/requester-conformance/stdio-provider.js [options]
 *     --room <roomId>                    default reploid-swarm-contract-vectors
 *     --provider-transport-id <name>     default c0ffee00-0000-4000-8000-000000000002
 *     --requester-transport-id <name>    default c0ffee00-0000-4000-8000-000000000001
 *     --provider-fingerprint "sha-256 aa:.."   provider certificate fingerprint
 *     --requester-fingerprint "sha-256 aa:.."  requester certificate fingerprint
 *     --identity ed25519|ecdsa           fixed test key the provider signs with (default ed25519)
 *     --decline                          the provider host refuses every admission
 *     --fail-after-chunks <n>            the model fails after n chunks
 *     --chunk-delay-ms <n>               pause before each chunk (default 20)
 */
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import bootstrap from '../../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { PEER_ID_PATTERN, ROOM_ID_PATTERN } from '../../../server/swarm-protocol.js';
import { FIXED, fixedIdentity, fixedModel } from '../../../scripts/requester-contract/fixed-inputs.js';
import { createFakeNetwork, createInProcessSignaling, createProviderStack, createStubWholeModel,
  offerFromExternalPeer } from '../../../scripts/requester-contract/harness.js';

const FINGERPRINT = /^sha-256 (?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/;
const options = {
  room: { type: 'string' }, 'provider-transport-id': { type: 'string' }, 'requester-transport-id': { type: 'string' },
  'provider-fingerprint': { type: 'string' }, 'requester-fingerprint': { type: 'string' }, identity: { type: 'string' },
  decline: { type: 'boolean' }, 'fail-after-chunks': { type: 'string' }, 'chunk-delay-ms': { type: 'string' }
};

export function parseStdioProviderArgs(argv) {
  const { values } = parseArgs({ args: argv, options, strict: true });
  const settings = {
    roomId: values.room ?? FIXED.roomId,
    providerTransportId: values['provider-transport-id'] ?? FIXED.providerTransportId,
    requesterTransportId: values['requester-transport-id'] ?? FIXED.requesterTransportId,
    providerFingerprint: values['provider-fingerprint'] ?? FIXED.providerFingerprint,
    requesterFingerprint: values['requester-fingerprint'] ?? FIXED.requesterFingerprint,
    identity: values.identity ?? 'ed25519',
    decline: values.decline === true,
    failAfterChunks: values['fail-after-chunks'] === undefined ? null : Number(values['fail-after-chunks']),
    chunkDelayMs: values['chunk-delay-ms'] === undefined ? 20 : Number(values['chunk-delay-ms'])
  };
  const need = (ok, message) => { if (!ok) throw new Error(message); };
  need(ROOM_ID_PATTERN.test(settings.roomId) && settings.roomId !== bootstrap.publicRoomId, '--room must be a private room id starting with reploid-swarm-');
  need(PEER_ID_PATTERN.test(settings.providerTransportId) && PEER_ID_PATTERN.test(settings.requesterTransportId)
    && settings.providerTransportId !== settings.requesterTransportId, 'transport ids must be two different valid connection names');
  need(FINGERPRINT.test(settings.providerFingerprint) && FINGERPRINT.test(settings.requesterFingerprint), 'fingerprints must look like "sha-256 " followed by 32 lower-case hex pairs');
  need(['ed25519', 'ecdsa'].includes(settings.identity), '--identity must be ed25519 or ecdsa');
  need(settings.failAfterChunks === null || Number.isSafeInteger(settings.failAfterChunks) && settings.failAfterChunks >= 0, '--fail-after-chunks must be a whole number');
  need(Number.isSafeInteger(settings.chunkDelayMs) && settings.chunkDelayMs >= 0, '--chunk-delay-ms must be a whole number');
  return settings;
}

/**
 * Start the provider. `input` and `output` are line streams (standard input and
 * output for the command). Resolves to { ready, close } once the first line was written.
 */
export async function startStdioProvider({ settings, input, output, log = () => {} }) {
  const post = deliver => setImmediate(deliver);
  const logger = { debug() {}, info() {}, log() {}, warn: (...parts) => log(parts.join(' ')), error: (...parts) => log(parts.join(' ')) };
  const model = fixedModel(), identity = fixedIdentity(settings.identity === 'ecdsa' ? 'providerEcdsa' : 'providerEd25519');
  // A local room capability; the requester never sees signaling in this fixture.
  const roomToken = `stdio-provider-${crypto.randomUUID()}`;
  let attached = null, closed = false;
  const opened = Promise.withResolvers();
  const external = {
    write: data => { if (!closed) output.write(`${data}\n`); },
    attach: link => { attached = link; opened.resolve(); },
    closed: () => log('The provider closed the data channel.')
  };
  const signaling = createInProcessSignaling({ post, logger });
  const network = createFakeNetwork({ post });
  const rtc = network.createRtc({ name: 'provider', fingerprint: settings.providerFingerprint, external });
  let requests = 0;
  const provider = createProviderStack({ signalingUrl: FIXED.signalingUrl, roomId: settings.roomId, roomToken, publicRoomId: bootstrap.publicRoomId,
    identity, transportId: settings.providerTransportId, model, logger, generateId: () => crypto.randomUUID(),
    WebSocket: signaling.webSocketFor({ name: 'provider', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
    decline: request => { if (settings.decline) log(`Declining admission of ${request.request?.requestId}.`); return settings.decline; },
    generate: createStubWholeModel({ model, chunks: FIXED.answerChunks, completion: FIXED.completion, failAfterChunks: settings.failAfterChunks,
      pause: () => new Promise(resolve => setTimeout(resolve, settings.chunkDelayMs)),
      onCall: messages => log(`Request ${++requests}: generating for ${messages.length} message(s).`) }) });
  await provider.mesh.connect();
  const ready = { ready: true, framing: 'one envelope as JSON text per line, both directions', roomId: settings.roomId,
    provider: { transportId: settings.providerTransportId, fingerprint: settings.providerFingerprint, participantId: identity.peerId,
      algorithm: identity.algorithm, publicJwk: identity.publicJwk },
    requester: { transportId: settings.requesterTransportId, fingerprint: settings.requesterFingerprint },
    model: { id: model.id, identity: model.identity, name: model.name },
    answer: { chunks: [...FIXED.answerChunks], content: FIXED.answerChunks.join(''), completion: { ...FIXED.completion } },
    mode: { decline: settings.decline, failAfterChunks: settings.failAfterChunks, chunkDelayMs: settings.chunkDelayMs } };
  // The first line must precede every envelope, so it is written before the channel opens.
  output.write(`${JSON.stringify(ready)}\n`);
  offerFromExternalPeer({ signaling, signalingUrl: FIXED.signalingUrl, roomId: settings.roomId, roomToken, origin: FIXED.origin,
    localTransportId: settings.providerTransportId, remoteTransportId: settings.requesterTransportId, remoteFingerprint: settings.requesterFingerprint });
  await opened.promise;

  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => { if (line.trim() && !closed) attached.deliver(line); });
  const close = async () => {
    if (closed) return;
    closed = true;
    lines.close();
    await provider.mesh.close();
    signaling.close();
  };
  lines.on('close', () => { close().catch(error => log(`Close failed: ${error.message}`)); });
  return { ready, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const log = text => process.stderr.write(`stdio-provider: ${text}\n`);
  try {
    const settings = parseStdioProviderArgs(process.argv.slice(2));
    const running = await startStdioProvider({ settings, input: process.stdin, output: process.stdout, log });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => running.close().finally(() => process.exit(0)));
  } catch (error) { log(error.message); process.exitCode = 1; }
}
