// @vitest-environment node
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import readline from 'node:readline';
import { describe, expect, it } from 'vitest';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { verifyRequesterContract, CONTRACT_FILE } from '../../scripts/verify-requester-contract.js';
import { buildVectorsText, VECTORS_FILE } from '../../scripts/build-requester-contract-vectors.js';
import { FIXED, fixedIdentity, fixedModel } from '../../scripts/requester-contract/fixed-inputs.js';
import { createFakeNetwork, createInProcessSignaling, createRequesterStack, offerFromExternalPeer, quietLogger } from '../../scripts/requester-contract/harness.js';
import { validate } from '../../scripts/requester-contract/schema-validator.js';
import { parseStdioProviderArgs, startStdioProvider } from '../fixtures/requester-conformance/stdio-provider.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { createBrowserOwnerPairing, parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';

const contract = JSON.parse(await fs.readFile(CONTRACT_FILE, 'utf8'));
const committedVectors = await fs.readFile(VECTORS_FILE, 'utf8');
const failuresAfter = async change => {
  const altered = structuredClone(contract);
  change(altered);
  return (await verifyRequesterContract({ contract: altered })).failures;
};

describe('requester contract', () => {
  it('matches the code the web and native clients run, and the committed vectors are current', async () => {
    const { checks, failures } = await verifyRequesterContract();
    expect(failures).toEqual([]);
    expect(checks).toBeGreaterThan(500);
  });

  it('builds the same vector bytes every time', async () => {
    const first = await buildVectorsText();
    expect(await buildVectorsText()).toBe(first);
    expect(first).toBe(committedVectors);
    // ASCII only, so no tool can re-encode the file.
    expect(/^[\x00-\x7e]*$/.test(first)).toBe(true);
  });

  it('notices a constant that differs from the code', async () => {
    // Both the configuration file and the configuration the web client resolves disagree.
    expect(await failuresAfter(c => { c.constants.rtc.maxPayloadSize = 65536; })).toEqual([
      expect.stringContaining('constants.rtc.maxPayloadSize is 65536 but shared/config/reploid-library.json'),
      expect.stringContaining('constants.rtc.maxPayloadSize is 65536 but the resolved web configuration')]);
    expect((await failuresAfter(c => { c.constants.signaling.maxPeers = 128; })).join('\n')).toContain('constants.signaling.maxPeers is 128');
    expect((await failuresAfter(c => { c.constants.generation.schemaIds.identityProofDomain = 'reploid.mesh-recipient/v2'; })).join('\n'))
      .toContain('constants.generation.schemaIds.identityProofDomain');
    expect((await failuresAfter(c => { c.constants.rtc.channelLabel = 'reploid-pool'; })).join('\n')).toContain('constants.rtc.channelLabel');
  });

  it('notices a channel message the transport does not know, and a missing one', async () => {
    expect(await failuresAfter(c => { c.channelMessages['reploid:made-up'] = { sentBy: 'requester', payload: { type: 'object' } }; }))
      .toContainEqual('channelMessages.reploid:made-up is not in RTC_MESSAGE_TYPES');
    expect((await failuresAfter(c => { delete c.channelMessages['reploid:generation-update']; })).join('\n')).toContain('reploid:generation-update');
    expect((await failuresAfter(c => { delete c.signalingMessages['peer-joined']; })).join('\n')).toContain('no signalingMessages entry for this type');
  });

  it('notices a real frame that fails its schema or carries a member the contract does not describe', async () => {
    expect((await failuresAfter(c => { c.channelMessages['reploid:generation-admitted'].payload.required.push('grant'); })).join('\n'))
      .toContain('reploid:generation-admitted: payload $: missing "grant"');
    expect((await failuresAfter(c => { delete c.objects.peerAdvertisement.properties.availableSlots; })).join('\n'))
      .toContain('payload member $.availableSlots is not described by the contract');
    expect((await failuresAfter(c => { c.objects.receiptV2['x-signedPayloadFields'].pop(); })).join('\n')).toContain('x-signedPayloadFields');
  });

  it('notices vectors that differ from a fresh build', async () => {
    const edited = committedVectors.replace('"The capital of France is Paris."', '"The capital of France is Lyon."');
    expect(edited).not.toBe(committedVectors);
    expect((await verifyRequesterContract({ vectorsText: edited })).failures).toEqual(
      ['vectors.json differs from a fresh build. Run: npm run build:requester-vectors']);
  });

  it('notices drift in the owner-pairing code', async () => {
    expect((await failuresAfter(c => { c.constants.pairing.codeTtlMs = 300000; })).join('\n')).toContain('constants.pairing.codeTtlMs is 300000');
    expect((await failuresAfter(c => { c.constants.pairing.codePattern = '^[A-Za-z0-9_-]{22}$'; })).join('\n')).toContain('constants.pairing.codePattern');
    expect((await failuresAfter(c => { c.constants.pairing.roomTokenPrefix = 'reploid-pairing-route:'; })).join('\n')).toContain('constants.pairing.roomTokenPrefix');
    expect((await failuresAfter(c => { delete c.channelMessages['reploid:owner-pairing-result'].payload.properties.approved; })).join('\n'))
      .toContain('reploid:owner-pairing-result: payload $: "approved" is not allowed');
    expect((await failuresAfter(c => { c.objects.pairingRecord.required.push('token'); })).join('\n')).toContain('objects.pairingRecord rejects the record the real pairing code stored');
    expect((await failuresAfter(c => { delete c.channelMessages['reploid:owner-pairing-request']; })).join('\n')).toContain('reploid:owner-pairing-request');
  });

  it('notices an error text that left the source', async () => {
    expect((await failuresAfter(c => { c.failures[0].text = 'The provider said no.'; })).join('\n')).toContain('no longer contains "The provider said no."');
  });
});

describe('stdio conformance provider', () => {
  /** The real requester joined to the stdio provider through two in-memory line streams. */
  async function withProvider(argv, run) {
    const toProvider = new PassThrough(), fromProvider = new PassThrough();
    const settings = parseStdioProviderArgs(argv);
    const lines = readline.createInterface({ input: fromProvider, crlfDelay: Infinity })[Symbol.asyncIterator]();
    const starting = startStdioProvider({ settings, input: toProvider, output: fromProvider });
    const ready = JSON.parse((await lines.next()).value);
    const provider = await starting;
    const post = deliver => setImmediate(deliver), logger = quietLogger();
    let link = null;
    const sent = [];
    const external = { write: data => { sent.push(JSON.parse(data)); toProvider.write(`${data}\n`); }, attach: attached => { link = attached; } };
    const signaling = createInProcessSignaling({ post, logger });
    const rtc = createFakeNetwork({ post }).createRtc({ name: 'requester', fingerprint: ready.requester.fingerprint, external });
    const roomToken = 'stdio-provider-test-room-capability-0123456789';
    const stack = createRequesterStack({ signalingUrl: FIXED.signalingUrl, roomId: ready.roomId, roomToken, publicRoomId: bootstrap.publicRoomId,
      identity: fixedIdentity('requesterEd25519'), transportId: ready.requester.transportId, model: fixedModel(), logger,
      WebSocket: signaling.webSocketFor({ name: 'requester', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
      generateId: () => crypto.randomUUID() });
    try {
      await stack.mesh.connect();
      offerFromExternalPeer({ signaling, signalingUrl: FIXED.signalingUrl, roomId: ready.roomId, roomToken, origin: FIXED.origin,
        localTransportId: ready.requester.transportId, remoteTransportId: ready.provider.transportId, remoteFingerprint: ready.provider.fingerprint });
      await expect.poll(() => link !== null).toBe(true);
      const received = [];
      (async () => { for (;;) { const next = await lines.next(); if (next.done) return; received.push(JSON.parse(next.value)); link.deliver(next.value); } })();
      await expect.poll(() => stack.requester.getModels().some(model => model.availability === 'ready')).toBe(true);
      const ask = (extra = {}) => stack.ask({ messages: structuredClone(FIXED.messages), threadId: crypto.randomUUID(), attemptId: crypto.randomUUID(),
        signal: new AbortController().signal, ...extra });
      return await run({ ready, ask, sent, received, stack });
    } finally {
      await stack.mesh.close();
      signaling.close();
      await provider.close();
    }
  }

  it('describes itself on its first line and answers several requests in a row', async () => {
    await withProvider(['--chunk-delay-ms', '0'], async ({ ready, ask, sent, received }) => {
      expect(ready).toMatchObject({ ready: true, roomId: FIXED.roomId,
        provider: { transportId: FIXED.providerTransportId, fingerprint: FIXED.providerFingerprint, participantId: fixedIdentity('providerEd25519').peerId },
        requester: { transportId: FIXED.requesterTransportId, fingerprint: FIXED.requesterFingerprint }, model: { id: fixedModel().id } });
      for (let round = 0; round < 2; round++) {
        const { result, observed } = await ask();
        expect(result.content).toBe(ready.answer.content);
        expect(observed.deltas.map(delta => delta.text)).toEqual(ready.answer.chunks);
        expect(await verifyReceipt(result.execution.receipt)).toEqual({ providerValid: true, consumerValid: true, valid: true });
      }
      // Every line in both directions is an envelope the contract accepts.
      for (const envelope of [...sent, ...received]) {
        expect(validate(contract.envelope, envelope, contract)).toEqual([]);
        expect(validate(contract.channelMessages[envelope.type].payload, envelope.payload, contract)).toEqual([]);
      }
    });
  });

  it('refuses admission with --decline before the prompt is sent', async () => {
    await withProvider(['--decline', '--chunk-delay-ms', '0'], async ({ ask, sent }) => {
      await expect(ask()).rejects.toThrow('The provider declined this request. The prompt was not sent.');
      expect(sent.some(envelope => envelope.type === 'reploid:generation-admit')).toBe(true);
      expect(sent.some(envelope => envelope.type === 'reploid:generation-request')).toBe(false);
    });
  });

  it('fails after the given chunks with --fail-after-chunks and honours a cancel', async () => {
    await withProvider(['--fail-after-chunks', '2', '--chunk-delay-ms', '0'], async ({ ask }) => {
      const failure = await ask().then(() => null, error => error);
      expect(failure.message).toBe('Stub model failed after 2 chunks');
      expect(failure.observed.deltas.map(delta => delta.text)).toEqual(FIXED.answerChunks.slice(0, 2));
      expect(failure.generationTerminal).toMatchObject({ status: 'failed', cleanup: 'settled' });
    });
    await withProvider(['--chunk-delay-ms', '5'], async ({ ready, ask, sent, received }) => {
      const controller = new AbortController();
      await expect(ask({ signal: controller.signal, onDelta: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
      await expect.poll(() => sent.some(envelope => envelope.type === 'reploid:generation-cancel')).toBe(true);
      // The provider confirms the stop and then serves the next request.
      await expect.poll(() => received.some(envelope => envelope.type === 'reploid:generation-error' && envelope.payload.terminal?.status === 'cancelled')).toBe(true);
      await expect.poll(async () => (await ask().then(answer => answer.result.content, () => null))).toBe(ready.answer.content);
    });
  });

  it('acts as an owner desktop with --pairing: one pairing with the code, then only the paired phone is answered', async () => {
    await withProvider(['--pairing', '--chunk-delay-ms', '0'], async ({ ready, ask, sent, stack }) => {
      const target = parseOwnerPairingUrl(ready.pairing.link);
      expect(target).toEqual({ code: ready.pairing.code, hostParticipantId: ready.provider.participantId, roomId: ready.roomId });
      // The link names no computer: a desktop's name is private to its owner.
      expect(ready.pairing.link).not.toContain('name=');
      expect(validate(contract.objects.pairingLink, target, contract)).toEqual([]);
      const toDesktop = { recipients: { kind: 'named', ids: [target.hostParticipantId] } };
      // Unpaired: refused before the prompt.
      await expect(ask(toDesktop)).rejects.toThrow('The provider declined this request. The prompt was not sent.');
      expect(sent.some(envelope => envelope.type === 'reploid:generation-request')).toBe(false);
      const data = new Map();
      const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); }, removeItem: key => { data.delete(key); } };
      const phone = createBrowserOwnerPairing({ storage, getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
      try {
        await phone.pair(target);
        expect(validate(contract.objects.pairingRecord, JSON.parse(data.get(contract.constants.pairing.storageKey)), contract)).toEqual([]);
        expect(phone.state()).toMatchObject({ status: 'online', hostParticipantId: ready.provider.participantId, hostPeer: ready.provider.transportId });
        const { result, privacy } = await ask(toDesktop);
        expect(result.content).toBe(ready.answer.content);
        expect(validate(contract.objects.pairedDesktopPolicy, privacy, contract)).toEqual([]);
        // The code was single use: the desktop stays silent.
        await expect(phone.pair({ ...target, signal: AbortSignal.timeout(150) })).rejects.toMatchObject({ name: 'TimeoutError' });
      } finally { phone.close(); }
    });
  });

  it('gives an expired code no answer and reports the owner saying no', async () => {
    await withProvider(['--pairing', '--pairing-expired'], async ({ ready, stack }) => {
      const phone = createBrowserOwnerPairing({ storage: null, getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
      await expect(phone.pair({ ...parseOwnerPairingUrl(ready.pairing.link), signal: AbortSignal.timeout(150) })).rejects.toMatchObject({ name: 'TimeoutError' });
      phone.close();
    });
    await withProvider(['--pairing', '--pairing-decline'], async ({ ready, stack }) => {
      const phone = createBrowserOwnerPairing({ storage: null, getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 2000 });
      await expect(phone.pair(parseOwnerPairingUrl(ready.pairing.link))).rejects.toThrow('Desktop declined owner pairing');
      phone.close();
    });
  });

  it('rejects arguments it cannot serve', () => {
    expect(() => parseStdioProviderArgs(['--pairing-expired'])).toThrow('need --pairing');
    expect(() => parseStdioProviderArgs(['--room', bootstrap.publicRoomId])).toThrow('private room');
    expect(() => parseStdioProviderArgs(['--provider-fingerprint', 'sha-256 AA'])).toThrow('fingerprints');
    expect(() => parseStdioProviderArgs(['--requester-transport-id', FIXED.providerTransportId])).toThrow('two different');
  });
});
