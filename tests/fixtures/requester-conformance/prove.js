#!/usr/bin/env node
/**
 * Shows that both conformance providers work, from Node, with the real
 * JavaScript requester:
 *
 *   stdio   stdio-provider.js is started as a child process. The real requester
 *           (server/whole-model-requester.js over the mesh and the swarm
 *           transport) talks to it over the same line framing a client in
 *           another language uses. Every line in both directions is checked
 *           against the contract schemas. Covers several requests in a row,
 *           cancel, --decline and --fail-after-chunks.
 *   webrtc  webrtc-provider.js is started as a child process. The installed
 *           command path (server/native-node.js ask, which is
 *           server/native-node-ask.js over server/whole-model-requester.js)
 *           joins its room through real signaling and real WebRTC.
 *
 *   minimal minimal-requester.js, a requester written from the contract alone
 *           with no Reploid module, completes requests against both providers:
 *           over the line framing, and over real signaling and real WebRTC
 *           using only ws and @roamhq/wrtc.
 *
 *   pairing owner pairing against both providers in --pairing mode: the real
 *           phone-side code (apps/poolday/host/owner-pairing.js) and
 *           minimal-requester.js each read the link, are refused while
 *           unpaired, pair, and then ask the desktop by name; plus an expired
 *           code, an owner who says no, a used code and a desktop that drops
 *           the phone.
 *
 *   node tests/fixtures/requester-conformance/prove.js [stdio|webrtc|minimal|pairing]
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import bootstrap from '../../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { verifyReceipt } from '../../../packages/reploid/src/artifacts/receipt.js';
import { fixedIdentity, fixedModel, FIXED } from '../../../scripts/requester-contract/fixed-inputs.js';
import { createFakeNetwork, createInProcessSignaling, createRequesterStack, offerFromExternalPeer, quietLogger } from '../../../scripts/requester-contract/harness.js';
import { validate } from '../../../scripts/requester-contract/schema-validator.js';
import { createMinimalRequester, sdpFingerprint, parsePairingLink, pairingRoomToken } from './minimal-requester.js';
import { createBrowserOwnerPairing, parseOwnerPairingUrl } from '../../../apps/poolday/host/owner-pairing.js';

const here = import.meta.dirname, root = path.resolve(here, '../../..');
const contract = JSON.parse(await fs.readFile(path.join(root, 'packages/reploid/contracts/requester/requester-contract.json'), 'utf8'));
const exec = promisify(execFile);
const waitFor = async (probe, message, ms = 10000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

/** Start a provider child and return its ready line and its line streams. */
async function startChild(script, args) {
  const child = spawn(process.execPath, [path.join(here, script), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const diagnostics = [];
  child.stderr.setEncoding('utf8').on('data', text => diagnostics.push(text));
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  const first = await Promise.race([iterator.next(), once(child, 'exit').then(() => { throw new Error(`${script} exited early: ${diagnostics.join('')}`); })]);
  const ready = JSON.parse(first.value);
  assert.equal(ready.ready, true);
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } };
  return { child, ready, iterator, diagnostics, stop };
}

/** Check one envelope line against the contract; returns the envelope. */
function checkedEnvelope(line, sender) {
  const envelope = JSON.parse(line);
  assert.deepEqual(validate(contract.envelope, envelope, contract), [], `envelope from ${sender}`);
  const entry = contract.channelMessages[envelope.type];
  assert.ok(entry, `the contract has no entry for ${envelope.type}`);
  assert.ok(entry.sentBy === 'either' || entry.sentBy === sender, `${envelope.type} sent by ${sender}`);
  assert.deepEqual(validate(entry.payload, envelope.payload, contract), [], `${envelope.type} payload from ${sender}`);
  return envelope;
}

/** The real requester joined to a stdio provider child. */
async function withStdioProvider(args, run) {
  const provider = await startChild('stdio-provider.js', args);
  const { ready } = provider;
  const post = deliver => setImmediate(deliver);
  const logger = quietLogger(), seen = { requester: [], provider: [] };
  let link = null;
  const external = {
    write: data => { seen.requester.push(checkedEnvelope(data, 'requester').type); provider.child.stdin.write(`${data}\n`); },
    attach: attached => { link = attached; }
  };
  const signaling = createInProcessSignaling({ post, logger });
  const rtc = createFakeNetwork({ post }).createRtc({ name: 'requester', fingerprint: ready.requester.fingerprint, external });
  const roomToken = `prove-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const stack = createRequesterStack({ signalingUrl: FIXED.signalingUrl, roomId: ready.roomId, roomToken, publicRoomId: bootstrap.publicRoomId,
    identity: fixedIdentity('requesterEd25519'), transportId: ready.requester.transportId, model: fixedModel(), logger,
    WebSocket: signaling.webSocketFor({ name: 'requester', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
    generateId: () => crypto.randomUUID() });
  try {
    await stack.mesh.connect();
    offerFromExternalPeer({ signaling, signalingUrl: FIXED.signalingUrl, roomId: ready.roomId, roomToken, origin: FIXED.origin,
      localTransportId: ready.requester.transportId, remoteTransportId: ready.provider.transportId, remoteFingerprint: ready.provider.fingerprint });
    await waitFor(() => link, 'the requester got no data channel');
    (async () => { for (;;) { const next = await provider.iterator.next(); if (next.done) return; seen.provider.push(checkedEnvelope(next.value, 'provider').type); link.deliver(next.value); } })()
      .catch(error => { console.error(error); process.exitCode = 1; });
    await waitFor(() => stack.requester.getModels().some(model => model.availability === 'ready'), 'the provider never became ready');
    return await run({ stack, ready, seen });
  } finally {
    await stack.mesh.close();
    signaling.close();
    await provider.stop();
  }
}

const ask = (stack, extra = {}) => stack.ask({ messages: [{ role: 'user', content: 'What is the capital of France?' }],
  threadId: crypto.randomUUID(), attemptId: crypto.randomUUID(), signal: new AbortController().signal, ...extra });

async function proveStdio() {
  await withStdioProvider([], async ({ stack, ready, seen }) => {
    for (let round = 1; round <= 3; round++) {
      const { result, observed } = await ask(stack);
      assert.equal(result.content, ready.answer.content);
      assert.deepEqual(observed.deltas.map(delta => delta.text), ready.answer.chunks);
      assert.equal(result.execution.providerIdentity, ready.provider.participantId);
      assert.deepEqual(await verifyReceipt(result.execution.receipt), { providerValid: true, consumerValid: true, valid: true });
    }
    // Cancel after the first chunk, then show the provider serves the next request.
    const controller = new AbortController();
    await assert.rejects(ask(stack, { signal: controller.signal, onDelta: () => controller.abort() }), { name: 'AbortError' });
    await waitFor(() => stack.requester.getModels().some(model => model.availability === 'ready'), 'the provider did not free its slot after a cancel');
    assert.equal((await ask(stack)).result.content, ready.answer.content);
    assert.ok(seen.requester.includes('reploid:generation-cancel'), 'a cancel frame was sent');
    // The last receipt leaves on the next turn of the event loop, after the request has settled.
    await waitFor(() => seen.requester.filter(type => type === 'reploid:receipt').length === 4, 'four countersigned receipts were not sent');
    console.log(`stdio: 4 requests answered and countersigned, 1 cancelled. Provider frame types: ${[...new Set(seen.provider)].join(', ')}`);
  });
  await withStdioProvider(['--identity', 'ecdsa'], async ({ stack, ready }) => {
    const { result } = await ask(stack);
    assert.equal(result.execution.providerIdentity, ready.provider.participantId);
    assert.equal(ready.provider.algorithm, 'ECDSA');
    assert.deepEqual(await verifyReceipt(result.execution.receipt), { providerValid: true, consumerValid: true, valid: true });
    console.log('stdio --identity ecdsa: answered; ECDSA provider signature and Ed25519 countersignature verify.');
  });
  await withStdioProvider(['--decline'], async ({ stack, seen }) => {
    await assert.rejects(ask(stack), /The provider declined this request\. The prompt was not sent\./);
    assert.ok(!seen.requester.includes('reploid:generation-request'), 'the prompt must not be sent after a decline');
    console.log('stdio --decline: refused before the prompt was sent.');
  });
  await withStdioProvider(['--fail-after-chunks', '1'], async ({ stack, seen }) => {
    const failure = await ask(stack).then(() => null, error => error);
    assert.match(failure?.message ?? '', /Stub model failed after 1 chunks/);
    assert.equal(failure.generationTerminal?.status, 'failed');
    assert.deepEqual(failure.observed.deltas.map(delta => delta.text), [FIXED.answerChunks[0]]);
    assert.ok(seen.provider.includes('reploid:generation-error'));
    console.log('stdio --fail-after-chunks 1: one chunk, then an error with verified terminal evidence.');
  });
}

async function proveWebrtc() {
  const provider = await startChild('webrtc-provider.js', []);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-conformance-ask-'));
  try {
    const { ready } = provider;
    assert.match(ready.wsUrl, /^ws:\/\/127\.0\.0\.1:\d+\/swarm\?scope=private&roomId=reploid-swarm-/);
    assert.ok(ready.token.length >= 32 && ready.origin && ready.model.id && ready.provider.participantId);
    const tokenFile = path.join(home, 'room-token'), configFile = path.join(home, 'rtc.json');
    // The command requires a relay entry in its credential file; this one is never reachable, so the path is direct.
    const rtcConfig = { iceTransportPolicy: 'all', iceServers: [{ urls: ['turn:127.0.0.1:9'], username: 'test', credential: 'test' }] };
    await fs.writeFile(tokenFile, ready.token, { mode: 0o600 });
    await fs.writeFile(configFile, JSON.stringify({ schema: contract.constants.turn.responseSchemaId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), rtcConfig }), { mode: 0o600 });
    const prompt = 'What is the capital of France?';
    const { stdout, stderr } = await exec(process.execPath, [path.join(root, 'server/native-node.js'), 'ask', '2b', prompt, '--room', ready.roomId,
      '--room-token-file', tokenFile, '--rtc-config-file', configFile, '--signaling-url', ready.signalingUrl, '--origin', ready.origin],
    { cwd: home, env: { ...process.env, HOME: home }, timeout: 60000, killSignal: 'SIGKILL' });
    assert.equal(stdout.trim(), ready.answer.content);
    assert.match(stderr, new RegExp(`Sending to ${ready.provider.participantId}`));
    console.log(`webrtc: the installed ask command got "${stdout.trim()}" from ${ready.provider.participantId} over real signaling and WebRTC.`);
  } finally {
    await provider.stop();
    await fs.rm(home, { recursive: true, force: true });
  }
}

const question = [{ role: 'user', content: 'What is the capital of France?' }];

/** minimal-requester.js against a stdio provider child. */
async function withMinimalOverStdio(args, run) {
  const provider = await startChild('stdio-provider.js', args);
  const { ready } = provider;
  try {
    const handlers = [];
    (async () => { for (;;) { const next = await provider.iterator.next(); if (next.done) return; checkedEnvelope(next.value, 'provider'); for (const handler of handlers) handler(next.value); } })()
      .catch(error => { console.error(error); process.exitCode = 1; });
    const requester = createMinimalRequester({ identity: fixedIdentity('requesterEd25519'), timeoutMs: 10000, link: {
      roomId: ready.roomId, selfId: ready.requester.transportId, peerId: ready.provider.transportId,
      binding: { local: ready.requester.fingerprint, remote: ready.provider.fingerprint },
      send: text => { checkedEnvelope(text, 'requester'); provider.child.stdin.write(`${text}\n`); }, onText: handler => handlers.push(handler) } });
    await requester.waitUntilReady(ready.model);
    return await run({ requester, ready });
  } finally { await provider.stop(); }
}

/** minimal-requester.js over real signaling and real WebRTC, written from the contract's signaling section. */
async function withMinimalOverWebrtc(run, args = []) {
  const [{ default: WebSocket }, { default: wrtc }] = await Promise.all([import('ws'), import('@roamhq/wrtc')]);
  const provider = await startChild('webrtc-provider.js', args);
  const { ready } = provider;
  const selfId = crypto.randomUUID();
  const socket = new WebSocket(ready.wsUrl, { origin: ready.origin });
  let connection = null;
  try {
    const signal = frame => socket.send(JSON.stringify(frame));
    const opened = Promise.withResolvers();
    socket.on('open', () => signal({ type: 'join', peerId: selfId, roomId: ready.roomId, token: ready.token, metadata: { capabilities: [] } }));
    socket.on('error', opened.reject);
    socket.on('message', async data => {
      try {
        const frame = JSON.parse(String(data));
        const entry = contract.signalingMessages[frame.type];
        assert.ok(entry, `the contract has no signaling entry for ${frame.type}`);
        assert.deepEqual(validate(entry.schema, frame, contract), [], `signaling ${frame.type}`);
        if (frame.type === 'error') throw new Error(frame.error);
        if (frame.type === 'joined') {
          assert.equal(frame.peers.length, 1, 'the provider is the only other peer');
          const [peerId] = frame.peers;
          connection = new wrtc.RTCPeerConnection({ iceServers: ready.iceServers });
          const channel = connection.createDataChannel(contract.constants.rtc.channelLabel, { ordered: contract.constants.rtc.ordered });
          connection.onicecandidate = event => { if (event.candidate) signal({ type: 'ice-candidate', peerId: selfId, targetPeer: peerId, candidate: event.candidate.toJSON() }); };
          channel.onopen = () => opened.resolve({ channel, peerId });
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          signal({ type: 'offer', peerId: selfId, targetPeer: peerId, offer: { type: offer.type, sdp: offer.sdp } });
        }
        if (frame.type === 'answer') await connection.setRemoteDescription(frame.answer);
        if (frame.type === 'ice-candidate') await connection.addIceCandidate(frame.candidate);
      } catch (error) { opened.reject(error); }
    });
    const { channel, peerId } = await opened.promise;
    const binding = { local: sdpFingerprint(connection.localDescription), remote: sdpFingerprint(connection.remoteDescription) };
    assert.ok(binding.local && binding.remote, 'both DTLS fingerprints are readable from the session descriptions');
    const handlers = [];
    channel.onmessage = event => { for (const handler of handlers) handler(String(event.data)); };
    const requester = createMinimalRequester({ identity: fixedIdentity('requesterEd25519'), timeoutMs: 15000,
      link: { roomId: ready.roomId, selfId, peerId, binding, send: text => channel.send(text), onText: handler => handlers.push(handler) } });
    await requester.waitUntilReady(ready.model);
    return await run({ requester, ready });
  } finally {
    try { socket.send(JSON.stringify({ type: 'leave', peerId: selfId, roomId: ready.roomId })); } catch { /* The socket may already be closed. */ }
    connection?.close(); socket.close();
    await provider.stop();
  }
}

async function proveMinimal() {
  await withMinimalOverStdio([], async ({ requester, ready }) => {
    for (let round = 1; round <= 2; round++) {
      const answer = await requester.ask({ model: ready.model, messages: question });
      assert.equal(answer.content, ready.answer.content);
      assert.deepEqual(answer.chunks, ready.answer.chunks);
      assert.equal(answer.providerId, ready.provider.participantId);
      assert.deepEqual(await verifyReceipt(answer.receipt), { providerValid: true, consumerValid: true, valid: true });
    }
    const controller = new AbortController();
    const stopped = await requester.ask({ model: ready.model, messages: question, signal: controller.signal, onChunk: () => controller.abort() }).then(() => null, error => error);
    assert.ok(stopped?.cancelled && stopped.promptSent === true);
    await requester.waitUntilReady(ready.model, 5000);
    assert.equal((await requester.ask({ model: ready.model, messages: question })).content, ready.answer.content);
    console.log('minimal over stdio: 3 requests answered, verified and countersigned from the contract alone; 1 cancelled.');
  });
  await withMinimalOverStdio(['--identity', 'ecdsa'], async ({ requester, ready }) => {
    const answer = await requester.ask({ model: ready.model, messages: question });
    assert.equal(answer.providerId, ready.provider.participantId);
    assert.deepEqual(await verifyReceipt(answer.receipt), { providerValid: true, consumerValid: true, valid: true });
    console.log('minimal over stdio --identity ecdsa: ECDSA identity proof and receipt verified from the contract alone.');
  });
  await withMinimalOverStdio(['--decline'], async ({ requester, ready }) => {
    const refused = await requester.ask({ model: ready.model, messages: question }).then(() => null, error => error);
    assert.match(refused?.message ?? '', /The provider declined this request\. The prompt was not sent\./);
    assert.equal(refused.promptSent, false);
    console.log('minimal over stdio --decline: refused, prompt not sent.');
  });
  await withMinimalOverStdio(['--fail-after-chunks', '2'], async ({ requester, ready }) => {
    const chunks = [];
    const failed = await requester.ask({ model: ready.model, messages: question, onChunk: chunk => chunks.push(chunk) }).then(() => null, error => error);
    assert.match(failed?.message ?? '', /Stub model failed after 2 chunks/);
    assert.equal(failed.promptSent, true);
    assert.deepEqual(chunks, ready.answer.chunks.slice(0, 2));
    console.log('minimal over stdio --fail-after-chunks 2: two chunks, then the provider error; prompt was sent.');
  });
  await withMinimalOverWebrtc(async ({ requester, ready }) => {
    const answer = await requester.ask({ model: ready.model, messages: question });
    assert.equal(answer.content, ready.answer.content);
    assert.equal(answer.providerId, ready.provider.participantId);
    assert.deepEqual(await verifyReceipt(answer.receipt), { providerValid: true, consumerValid: true, valid: true });
    const second = await requester.ask({ model: ready.model, messages: [{ role: 'system', content: 'Be brief.' }, ...question] });
    assert.equal(second.content, ready.answer.content);
    const ignored = [...new Set(requester.seenTypes)].filter(type => !Object.hasOwn(contract.channelMessages, type));
    console.log(`minimal over webrtc: 2 requests answered over real signaling and WebRTC. Frame types from the native provider: ${[...new Set(requester.seenTypes)].join(', ')}. Ignored as the contract says: ${ignored.join(', ') || 'none'}.`);
  });
}

const DECLINED = /The provider declined this request\. The prompt was not sent\./;
const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); }, removeItem: key => { data.delete(key); }, size: () => data.size };
};
const named = id => ({ kind: 'named', ids: [id] });

async function provePairing() {
  const vectors = JSON.parse(await fs.readFile(path.join(here, 'vectors.json'), 'utf8'));
  for (const item of vectors.pairing.link.cases) assert.deepEqual(parsePairingLink(item.url), item.parsed, `link case "${item.name}"`);
  for (const item of vectors.pairing.roomToken.cases) if (item.token) assert.equal(pairingRoomToken(item.roomId), item.token);
  console.log(`pairing links: the from-the-contract parser agrees with the real one on ${vectors.pairing.link.cases.length} cases.`);

  // The real phone-side code against the line provider.
  await withStdioProvider(['--pairing'], async ({ stack, ready, seen }) => {
    const storage = memoryStorage();
    const phone = createBrowserOwnerPairing({ storage, getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
    const target = parseOwnerPairingUrl(ready.pairing.link);
    assert.deepEqual(target, { code: ready.pairing.code, hostParticipantId: ready.provider.participantId, hostLabel: ready.pairing.hostLabel, roomId: ready.roomId });
    await assert.rejects(ask(stack, { recipients: named(target.hostParticipantId) }), DECLINED);
    assert.ok(!seen.requester.includes('reploid:generation-request'), 'an unpaired phone must not have sent its prompt');
    const record = await phone.pair(target);
    assert.deepEqual(validate(contract.objects.pairingRecord, JSON.parse(storage.getItem(contract.constants.pairing.storageKey)), contract), []);
    assert.equal(record.hostParticipantId, ready.provider.participantId);
    assert.equal(phone.state().status, 'online');
    for (let round = 0; round < 2; round++) {
      const { result, privacy } = await ask(stack, { recipients: named(record.hostParticipantId) });
      assert.equal(result.content, ready.answer.content);
      assert.deepEqual(privacy.recipients, named(ready.provider.participantId));
    }
    // The code was single use.
    await assert.rejects(phone.pair({ ...target, signal: AbortSignal.timeout(400) }), { name: 'TimeoutError' });
    phone.unpair();
    assert.equal(storage.size(), 0);
    phone.close();
    console.log('pairing over stdio (real phone-side code): refused while unpaired, paired, 2 named-recipient requests answered, used code got no answer.');
  });
  await withStdioProvider(['--pairing', '--pairing-expired'], async ({ stack, ready }) => {
    const phone = createBrowserOwnerPairing({ storage: memoryStorage(), getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
    assert.equal(ready.pairing.expired, true);
    await assert.rejects(phone.pair({ ...parseOwnerPairingUrl(ready.pairing.link), signal: AbortSignal.timeout(400) }), { name: 'TimeoutError' });
    assert.equal(phone.state().status, 'unpaired');
    phone.close();
    console.log('pairing over stdio --pairing-expired: no answer, nothing stored.');
  });
  await withStdioProvider(['--pairing', '--pairing-decline'], async ({ stack, ready }) => {
    const phone = createBrowserOwnerPairing({ storage: memoryStorage(), getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
    await assert.rejects(phone.pair(parseOwnerPairingUrl(ready.pairing.link)), /Desktop declined owner pairing/);
    await assert.rejects(ask(stack, { recipients: named(ready.provider.participantId) }), DECLINED);
    phone.close();
    console.log('pairing over stdio --pairing-decline: declined, and requests stay refused.');
  });
  await withStdioProvider(['--pairing', '--pairing-forget-after-requests', '1'], async ({ stack, ready }) => {
    const phone = createBrowserOwnerPairing({ storage: memoryStorage(), getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
    const record = await phone.pair(parseOwnerPairingUrl(ready.pairing.link));
    assert.equal((await ask(stack, { recipients: named(record.hostParticipantId) })).result.content, ready.answer.content);
    await assert.rejects(ask(stack, { recipients: named(record.hostParticipantId) }), DECLINED);
    assert.equal(phone.state().status, 'online', 'the phone still recognises the desktop that dropped it');
    phone.close();
    console.log('pairing over stdio --pairing-forget-after-requests 1: one answer, then refused before the prompt while the desktop still shows online.');
  });

  // The from-the-contract requester against both providers.
  const minimalFlow = async ({ requester, ready }, where) => {
    const link = parsePairingLink(ready.pairing.link);
    assert.equal(link.hostParticipantId, ready.provider.participantId);
    const refused = await requester.ask({ model: ready.model, messages: question, recipient: link.hostParticipantId }).then(() => null, error => error);
    assert.match(refused?.message ?? '', DECLINED);
    assert.equal(refused.promptSent, false);
    // A link naming another desktop: the code must not leave.
    await assert.rejects(requester.pair({ ...link, hostParticipantId: 'peer:000000000000000000000000' }), /Could not find the verified desktop/);
    const record = await requester.pair(link);
    assert.deepEqual(validate(contract.objects.pairingRecord, record, contract), []);
    assert.equal(await requester.desktopStatus(record), 'online');
    assert.equal(await requester.desktopStatus({ ...record, hostParticipantId: 'peer:000000000000000000000000' }), 'offline');
    await requester.waitUntilReady(ready.model, 5000);
    for (let round = 0; round < 2; round++) {
      const answer = await requester.ask({ model: ready.model, messages: question, recipient: record.hostParticipantId });
      assert.equal(answer.content, ready.answer.content);
      assert.equal(answer.providerId, record.hostParticipantId);
      assert.deepEqual(await verifyReceipt(answer.receipt), { providerValid: true, consumerValid: true, valid: true });
      await requester.waitUntilReady(ready.model, 5000);
    }
    // A request pinned to another identity sends nothing.
    const pinnedElsewhere = await requester.ask({ model: ready.model, messages: question, recipient: 'peer:000000000000000000000000' }).then(() => null, error => error);
    assert.equal(pinnedElsewhere?.promptSent, false);
    // The code was single use.
    const replay = await requester.pair(link, { waitMs: 400 }).then(() => null, error => error);
    assert.equal(replay?.noAnswer, true);
    console.log(`pairing, minimal requester over ${where}: refused while unpaired, paired from the link, 2 named-recipient requests answered and countersigned, used code got no answer.`);
  };
  await withMinimalOverStdio(['--pairing'], context => minimalFlow(context, 'stdio'));
  await withMinimalOverStdio(['--pairing', '--pairing-expired'], async ({ requester, ready }) => {
    const expired = await requester.pair(parsePairingLink(ready.pairing.link), { waitMs: 400 }).then(() => null, error => error);
    assert.equal(expired?.noAnswer, true);
    console.log('pairing, minimal requester over stdio --pairing-expired: no answer.');
  });
  await withMinimalOverStdio(['--pairing', '--pairing-decline'], async ({ requester, ready }) => {
    await assert.rejects(requester.pair(parsePairingLink(ready.pairing.link)), /Desktop declined owner pairing/);
    console.log('pairing, minimal requester over stdio --pairing-decline: declined.');
  });
  await withMinimalOverWebrtc(async context => {
    const { ready } = context;
    assert.equal(ready.token, pairingRoomToken(ready.pairing.roomId), 'the room token is the routing marker the contract describes');
    assert.equal(ready.pairing.roomId, ready.roomId);
    await minimalFlow(context, 'webrtc');
  }, ['--pairing']);
  await withMinimalOverWebrtc(async ({ requester, ready }) => {
    const record = await requester.pair(parsePairingLink(ready.pairing.link));
    assert.equal((await requester.ask({ model: ready.model, messages: question, recipient: record.hostParticipantId })).content, ready.answer.content);
    await requester.waitUntilReady(ready.model, 5000);
    const dropped = await requester.ask({ model: ready.model, messages: question, recipient: record.hostParticipantId }).then(() => null, error => error);
    assert.match(dropped?.message ?? '', DECLINED);
    assert.equal(dropped.promptSent, false);
    assert.equal(await requester.desktopStatus(record), 'online');
    console.log('pairing, minimal requester over webrtc --pairing-forget-after-requests 1: one answer, then refused before the prompt; the desktop still proves its identity.');
  }, ['--pairing', '--pairing-forget-after-requests', '1']);
}

const which = process.argv[2] ?? 'all';
if (!['all', 'stdio', 'webrtc', 'minimal', 'pairing'].includes(which)) throw new Error('Usage: prove.js [stdio|webrtc|minimal|pairing]');
if (['all', 'stdio'].includes(which)) await proveStdio();
if (['all', 'webrtc'].includes(which)) await proveWebrtc();
if (['all', 'minimal'].includes(which)) await proveMinimal();
if (['all', 'pairing'].includes(which)) await provePairing();
console.log(which === 'all' ? 'Both conformance providers work with the real JavaScript requester and with a requester written from the contract alone, for public requests and for owner pairing.' : `The ${which} proof passed.`);
// The WebRTC library keeps its own threads alive; everything this script started has been stopped.
process.exit(process.exitCode ?? 0);
