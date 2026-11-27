/**
 * A requester written from requester-contract.json alone.
 *
 * It imports no Reploid module: only the contract (for constants) and Web
 * Crypto. prove.js runs it against both conformance providers. If it works, the
 * contract tells a new client enough to complete a request; if the protocol
 * changes and this file was not updated from the contract, prove.js fails.
 *
 * It is a check of the contract, not a client to ship: one provider, one
 * request at a time, no reconnection.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const contract = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../../../packages/reploid/contracts/requester/requester-contract.json'), 'utf8'));
const { constants } = contract;
const ids = constants.generation.schemaIds;
const utf8 = text => new TextEncoder().encode(text);

// procedures.canonicalJson
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
// procedures.sha256Hex
const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async text => `sha256:${await hex(utf8(text))}`;
export const hashJson = value => sha256Hex(canonicalJson(value));
// procedures.base64url
const toBase64url = bytes => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = text => new Uint8Array(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
// procedures.peerIdFromPublicJwk
export async function peerIdFromPublicJwk(jwk) {
  const shape = Object.fromEntries(['kty', 'crv', 'x', 'y', 'n', 'e'].map(key => [key, jwk[key] || null]));
  return `peer:${(await hex(utf8(canonicalJson(shape)))).slice(0, 24)}`;
}
// procedures.signatureAlgorithms
const algorithms = jwk => jwk.crv === 'Ed25519' ? [{ name: 'Ed25519' }, { name: 'Ed25519' }] : [{ name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }];
async function sign(privateJwk, text) {
  const [importAs, signAs] = algorithms(privateJwk);
  return toBase64url(await crypto.subtle.sign(signAs, await crypto.subtle.importKey('jwk', privateJwk, importAs, false, ['sign']), utf8(text)));
}
async function verify(publicJwk, signature, text) {
  const [importAs, verifyAs] = algorithms(publicJwk);
  return crypto.subtle.verify(verifyAs, await crypto.subtle.importKey('jwk', publicJwk, importAs, false, ['verify']), fromBase64url(signature), utf8(text));
}
// procedures.identityProofSignedBytes
const proofText = (challenge, participantId) => JSON.stringify([ids.identityProofDomain, challenge.roomId, challenge.nonce,
  challenge.requester, challenge.provider, challenge.local, challenge.remote, participantId]);
// procedures.sdpFingerprint
export function sdpFingerprint(description) {
  const values = [...new Set((description?.sdp || '').split(/\r?\n/).filter(line => /^a=fingerprint:sha-256 /i.test(line)).map(line => line.slice(14).trim().toLowerCase()))];
  return values.length === 1 && /^sha-256 (?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/.test(values[0]) ? values[0] : null;
}
// procedures.pairingLinkParse
export function parsePairingLink(text) {
  const pairing = constants.pairing;
  if (typeof text !== 'string' || !text.trim()) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  const pairs = new URLSearchParams(url.hash.slice(1));
  if (pairs.getAll('pair').length !== 1 || pairs.getAll('host').length !== 1 || pairs.getAll('name').length > 1 || pairs.getAll('room').length > 1) return null;
  const code = pairs.get('pair'), hostParticipantId = pairs.get('host'), name = pairs.get('name'), room = pairs.get('room');
  if (!new RegExp(pairing.codePattern).test(code) || !new RegExp(pairing.participantIdPattern).test(hostParticipantId)) return null;
  if (name !== null && (name.trim().length < 1 || name.trim().length > pairing.labelMaxLength)) return null;
  if (room !== null && !new RegExp(pairing.roomIdPattern.source, pairing.roomIdPattern.flags).test(room.trim())) return null;
  return { code, hostParticipantId, ...(name !== null ? { hostLabel: name.trim() } : {}), ...(room !== null ? { roomId: room.trim() } : {}) };
}
// procedures.pairingRoom
export const pairingRoomToken = roomId => constants.pairing.roomTokenPrefix + roomId;

const isDigest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => { throw new Error(message); };

/**
 * `link` is an open "reploid" data channel seen as text:
 *   { roomId, selfId, peerId, binding: { local, remote }, send(text), onText(handler) }
 * `identity` is { peerId, publicJwk, privateJwk }.
 */
export function createMinimalRequester({ link, identity, timeoutMs = constants.generation.timeoutMs }) {
  let clock = 0;
  const waiting = new Map(), seenTypes = [];
  let advertisement = null;
  const send = (type, payload = {}) => {
    const text = JSON.stringify(payload);
    if (text.length > constants.rtc.maxPayloadSize) fail('payload exceeds maxPayloadSize');
    link.send(JSON.stringify({ protocolVersion: constants.rtc.envelopeProtocolVersion, type, peerId: link.selfId, timestamp: ++clock, payload, payloadSize: text.length }));
  };
  /** Wait for the next frame that `match` accepts; frames it does not accept are left to other handlers. */
  const expect = (label, match) => new Promise((resolve, reject) => {
    const entry = { match, resolve, reject, timer: setTimeout(() => { waiting.delete(entry); reject(new Error(`timed out waiting for ${label}`)); }, timeoutMs) };
    waiting.set(entry, entry);
  });

  // procedures.identityChallengeAnswer
  async function answerChallenge(challenge) {
    if (challenge.roomId !== link.roomId || challenge.requester !== link.peerId || challenge.provider !== link.selfId
      || !/^[a-f0-9-]{36}$/.test(challenge.nonce || '') || challenge.local !== link.binding.remote || challenge.remote !== link.binding.local) return;
    send('reploid:identity-proof', { nonce: challenge.nonce, participantId: identity.peerId, publicJwk: identity.publicJwk,
      signature: await sign(identity.privateJwk, proofText(challenge, identity.peerId)) });
  }

  // procedures.envelopeValidation, receiving side
  link.onText(text => {
    if (text.length > 2 * constants.rtc.maxPayloadSize) return;
    let envelope;
    try { envelope = JSON.parse(text); } catch { return; }
    if (!envelope || typeof envelope !== 'object' || envelope.protocolVersion !== constants.rtc.envelopeProtocolVersion || typeof envelope.type !== 'string'
      || envelope.peerId !== link.peerId || typeof envelope.timestamp !== 'number' || envelope.payloadSize > constants.rtc.maxPayloadSize) return;
    clock = Math.max(clock, envelope.timestamp) + 1;
    seenTypes.push(envelope.type);
    const payload = envelope.payload ?? {};
    if (envelope.type === 'ping') return send('pong', { ts: payload.ts, received: Date.now() });
    if (envelope.type === 'reploid:identity-challenge') return void answerChallenge(payload).catch(() => {});
    if (envelope.type === 'reploid:peer-advertisement' && Number.isFinite(payload.updatedAt)) advertisement = payload;
    for (const entry of [...waiting.values()]) {
      let outcome;
      try { outcome = entry.match(envelope.type, payload); } catch (error) { outcome = { error }; }
      if (outcome === undefined) continue;
      waiting.delete(entry); clearTimeout(entry.timer);
      if (outcome?.error) entry.reject(outcome.error); else entry.resolve(outcome);
    }
    // Every other known type is ignored.
  });
  send('sync-request', {});

  // procedures.identityProofVerification
  async function proveProvider() {
    const challenge = { roomId: link.roomId, nonce: crypto.randomUUID(), requester: link.selfId, provider: link.peerId, ...link.binding };
    const answered = expect('identity proof', (type, payload) => type === 'reploid:identity-proof' && payload.nonce === challenge.nonce ? payload : undefined);
    send('reploid:identity-challenge', challenge);
    const proof = await answered;
    if (await peerIdFromPublicJwk(proof.publicJwk) !== proof.participantId) fail('Recipient signing identity mismatch');
    if (!await verify(proof.publicJwk, proof.signature, proofText(challenge, proof.participantId))) fail('Invalid recipient identity proof');
    return proof.participantId;
  }

  // procedures.readyPeerRule and procedures.providerSelectionRule, for the one connected provider
  const usable = model => advertisement && advertisement.identityProtocol === constants.generation.identityProtocol
    && advertisement.admissionProtocol === constants.generation.admissionProtocol && advertisement.hasInference === true
    && advertisement.readiness === 'ready' && advertisement.availableSlots > 0
    && advertisement.model === model.id && advertisement.modelIdentity === model.identity;
  const offerFor = model => (advertisement.executionOffers || []).filter(offer => offer.operation === 'generate' && offer.kind === 'plaintext'
    && offer.protocol === null && offer.backend === constants.generation.backend && offer.modelIdentities.includes(model.identity))
    .sort((a, b) => a.id.localeCompare(b.id))[0];

  // procedures.receiptVerification
  async function verifyResult({ requestId, model, messages, provenProvider, earlyInputTokens }, { response, receipt }) {
    delete response.executionReceipt;
    if (response.model !== model.id || response.modelIdentity !== model.identity) fail('Remote response substituted the requested model');
    if (JSON.stringify(response.adapterIdentities || []) !== '[]') fail('Remote response substituted the requested adapter');
    if (earlyInputTokens !== null && (response.completion?.promptTokenCount !== earlyInputTokens || receipt?.inputTokens !== earlyInputTokens)) {
      fail('Provider input token count differs from its early observation');
    }
    if (!receipt || receipt.version !== 2) fail('A version 2 receipt is required');
    const fields = contract.objects.receiptV2['x-signedPayloadFields'];
    const payload = Object.fromEntries(fields.map(key => [key, receipt[key]]));
    const wellFormed = payload.status === 'completed' && payload.usage === ids.tokenUsage && payload.cleanup === 'settled'
      && isDigest(payload.modelIdentity) && isDigest(payload.inputDigest) && isDigest(payload.outputDigest) && count(payload.inputTokens) && count(payload.outputTokens)
      && Array.isArray(payload.adapterIdentities) && payload.adapterIdentities.length <= 1 && payload.adapterIdentities.every(isDigest)
      && (payload.ownerPolicyDigest === null || isDigest(payload.ownerPolicyDigest))
      && typeof payload.stopReason === 'string' && payload.stopReason.length > 0 && payload.stopReason.length <= 64
      && receipt.settingsDigest === undefined && receipt.constraintIdentity === undefined;
    if (!wellFormed || await peerIdFromPublicJwk(receipt.providerKey) !== receipt.provider
      || !await verify(receipt.providerKey, receipt.providerSignature, canonicalJson(payload))
      || receipt.jobHash !== `request:${requestId}` || receipt.consumer !== identity.peerId || receipt.model !== response.model) {
      fail('Remote receipt is invalid or does not bind this request');
    }
    const completion = response.completion;
    if (!completion || completion.schema !== ids.generationCompletion || !count(completion.promptTokenCount) || !count(completion.generatedTokenCount)
      || typeof response.content !== 'string') fail('Measured receipt differs from the admitted request or provider output');
    const expected = { version: 2, status: 'completed', modelIdentity: response.modelIdentity, adapterIdentities: response.adapterIdentities || [],
      inputDigest: await hashJson(messages), outputDigest: await sha256Hex(response.content), inputTokens: completion.promptTokenCount,
      outputTokens: completion.generatedTokenCount, usage: ids.tokenUsage, stopReason: completion.stopReason, cleanup: 'settled',
      ownerPolicyDigest: response.ownerPolicyDigest ?? null };
    if (receipt.provider !== provenProvider || Object.keys(expected).some(key => canonicalJson(receipt[key]) !== canonicalJson(expected[key]))) {
      fail('Measured receipt differs from the admitted request or provider output');
    }
    // procedures.receiptCountersign
    return { ...payload, providerSignature: receipt.providerSignature, providerKey: receipt.providerKey,
      consumerSignature: await sign(identity.privateJwk, canonicalJson(payload)), consumerKey: identity.publicJwk };
  }

  return {
    seenTypes,
    /**
     * procedures.pairingExchange steps 4 to 10 on this one connection. `link` is a parsed pairing link.
     * Returns the objects.pairingRecord to store. `waitMs` bounds the wait for the owner's answer.
     */
    async pair(link, { waitMs = constants.pairing.approvalWaitMs } = {}) {
      const pairing = constants.pairing;
      if (!new RegExp(pairing.codePattern).test(link?.code ?? '') || !new RegExp(pairing.participantIdPattern).test(link?.hostParticipantId ?? '')) {
        fail('Enter a valid desktop ID and 24-character pairing code');
      }
      if (link.roomId !== undefined && link.roomId !== this.roomId) fail('Could not reach the desktop room specified in the pairing link');
      // Steps 4 and 5: the code goes only to a connection that has just proven to be the link's host.
      if (await proveProvider() !== link.hostParticipantId) fail('Could not find the verified desktop on this connection. Confirm it is online and retry.');
      const requestId = crypto.randomUUID();
      const answered = expect('owner pairing result', (type, payload) => type === pairing.resultType && payload.requestId === requestId ? payload : undefined);
      const limit = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Open a new pairing link from your desktop.'), { noAnswer: true })), waitMs).unref());
      answered.catch(() => {});
      send(pairing.requestType, { requestId, code: link.code });
      const result = await Promise.race([answered, limit]);
      if (result.approved !== true) fail('Desktop declined owner pairing');
      return { hostParticipantId: link.hostParticipantId, hostLabel: link.hostLabel ?? link.hostParticipantId, roomId: link.roomId ?? this.roomId ?? null, pairedAt: Date.now() };
    },
    roomId: link.roomId,
    /** procedures.pairedDesktopRecognition for this one connection: "online" only when it proves to be the pinned desktop. */
    async desktopStatus(record) {
      try { return await proveProvider() === record.hostParticipantId ? 'online' : 'offline'; } catch { return 'offline'; }
    },
    /** Resolves when the connected provider is ready for `model` (procedures.readyPeerRule). */
    async waitUntilReady(model, ms = constants.generation.discoveryTimeoutMs) {
      for (const deadline = Date.now() + ms; !usable(model);) {
        if (Date.now() > deadline) fail('No ready provider');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
    /**
     * One whole-model request (contract.sequence steps 7 to 15). Returns { content, chunks, receipt, providerId, promptSent }.
     * With `recipient` (a pairingRecord's hostParticipantId) it is procedures.pairedDesktopRequest: named
     * recipients, and nothing is sent unless this connection proves to be that desktop.
     */
    async ask({ model, messages, onChunk = () => {}, signal = null, recipient = null }) {
      const state = { promptSent: false };
      try {
        if (!usable(model)) fail('No remote host slot available');
        const provenProvider = await proveProvider();
        // procedures.pairedDesktopOffline: never substitute another recipient.
        if (recipient !== null && provenProvider !== recipient) fail('The paired desktop is offline. Nothing was sent.');
        const offer = offerFor(model) ?? fail('Selected execution offer is unavailable');
        // procedures.privacyBinding
        const privacy = { schema: ids.executionPolicy, placement: 'network-allowed',
          recipients: recipient === null ? { kind: 'open', ids: [] } : { kind: 'named', ids: [recipient] }, computation: 'plaintext', collusion: 'none',
          leakage: ['model-id', 'timing', 'length', 'access-patterns', 'plaintext'], protocol: null, attestation: null, keyContext: null,
          retention: 'execution-and-recovery', publication: false, reuse: false, allowDowngrade: false };
        const route = { schema: ids.executionRoute, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], backend: constants.generation.backend, protocol: null,
          route: { schema: ids.meshRoute, providerId: provenProvider, offerId: offer.id, backend: offer.backend },
          hops: [{ recipient: provenProvider, placement: 'remote', disclosure: 'plaintext' }] };
        const privacyBinding = { schema: ids.executionBinding, policy: privacy, route, policyId: await hashJson(privacy), routeId: await hashJson(route) };
        // procedures.promptCommitment and procedures.admitPayloadFromRequest
        const requestId = crypto.randomUUID();
        const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        const promptCommitment = await hashJson({ schema: ids.promptCommitment, salt, messages, settings: null });
        const details = { requestId, consumer: identity.peerId, provider: link.peerId, model: model.id, modelIdentity: model.identity, adapterIdentities: [],
          modelContract: null, admissionProtocol: constants.generation.admissionProtocol, privacy, privacyBinding, offerId: offer.id };
        const request = { ...details, messages, admission: { salt } };
        if (utf8(JSON.stringify(request)).length > constants.rtc.maxPayloadSize) fail('Conversation exceeds transport payload limit');

        const terminal = (type, payload) => type === 'reploid:generation-error' && payload.requestId === requestId
          ? { error: Object.assign(new Error(payload.error), { code: payload.code, terminal: payload.terminal }) } : undefined;
        const admitted = expect('admission', (type, payload) => terminal(type, payload)
          ?? (type === 'reploid:generation-admitted' && payload.requestId === requestId ? payload : undefined));
        send('reploid:generation-admit', { ...details, promptCommitment });
        const admission = await admitted;
        if (admission.admissionProtocol !== constants.generation.admissionProtocol || admission.promptCommitment !== promptCommitment) {
          send('reploid:generation-cancel', { requestId });
          fail('The provider admitted a different request. The prompt was not sent.');
        }
        if (!usable(model)) { send('reploid:generation-cancel', { requestId }); fail('Selected contributor is no longer ready; retry requires new placement'); }

        const chunks = [];
        let earlyInputTokens = null;
        const finished = expect('result', (type, payload) => {
          if (payload.requestId !== requestId) return undefined;
          if (type === 'reploid:generation-update') {
            if (payload.chunk) { chunks.push(payload.chunk); onChunk(payload.chunk); }
            else if (!chunks.length && earlyInputTokens === null && Number.isSafeInteger(payload.usage?.inputTokens) && payload.usage.inputTokens > 0) earlyInputTokens = payload.usage.inputTokens;
            return undefined;
          }
          return terminal(type, payload) ?? (type === 'reploid:generation-result' ? payload : undefined);
        });
        const cancelled = new Promise((_, reject) => signal?.addEventListener('abort', () => {
          send('reploid:generation-cancel', { requestId }); reject(Object.assign(new Error('Cancelled by the user'), { cancelled: true })); }, { once: true }));
        send('reploid:generation-request', request);
        state.promptSent = true;
        finished.catch(() => {});
        const result = await Promise.race([finished, cancelled]);
        const receipt = await verifyResult({ requestId, model, messages, provenProvider, earlyInputTokens }, result);
        send('reploid:receipt', { receipt });
        return { content: result.response.content, chunks, receipt, providerId: provenProvider, promptSent: true, requestId };
      } catch (error) { throw Object.assign(error, { promptSent: state.promptSent }); }
    }
  };
}
