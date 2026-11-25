/**
 * `reploid.protected-generation/v1`: confidential (`requester-only`) generation on a peer that computes on
 * ciphertext. RESEARCH ONLY: unavailable until the protocol passes independent security review.
 *
 * It sits beside peer-generation.js and shares no handler, journal, log or recovery path with plaintext
 * generation. The requester holds the only secret key and no weights; the evaluator holds public weights,
 * public evaluation keys and ciphertexts.
 *
 *   advertisement   evaluator-signed backend descriptor (protocol, scheme, parameter-set digest, circuit,
 *                   evaluator identity, key-epoch policy). Eligibility is decided by the requester's own
 *                   allowlist, never by the descriptor's claims.
 *   binding         plan id, route id, descriptor digest, key epoch, requester nonce, evaluator nonce, schedule
 *                   and expiry, signed by both sides before any key or ciphertext is uploaded.
 *   frames          every later frame carries the binding digest, a per-direction sequence number and the
 *                   digest of each blob, signed by its sender.
 *   traps           every session runs K lanes: one real, the rest known-answer traps from a publisher-signed
 *                   trap set. All lanes are fresh encryptions with the same schedule. Each step's trap results
 *                   are checked within the pinned tolerance BEFORE the real lane is decrypted.
 *
 * See docs/confidential-execution.md for the threat model and the limits of trap verification.
 */
import { canonicalize } from '../artifacts/canonical-json.js';
import { hashJson, sha256Hex } from '../artifacts/signatures.js';
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  fromBase64Url, toBase64Url } from '../artifacts/identity.js';
import { executionError, CONFIDENTIAL_EXECUTION_REVIEW_REASON } from '../chat/execution-policy.js';

export const PROTECTED_PROTOCOL = 'reploid.protected-generation/v1';
export const PROTECTED_BACKEND = 'doppler-protected-ckks/v1';
export const PROTECTED_REVIEW_REASON = CONFIDENTIAL_EXECUTION_REVIEW_REASON;
export const PROTECTED_DESCRIPTOR_SCHEMA = 'reploid.protected-backend/v1';
export const PROTECTED_ADVERTISEMENT_SCHEMA = 'reploid.protected-advertisement/v1';
export const PROTECTED_BINDING_SCHEMA = 'reploid.protected-binding/v1';
export const TRAP_SET_SCHEMA = 'doppler.protected-trapset/v1';
export const TRAP_SET_ENVELOPE_SCHEMA = 'doppler.protected-trapset-envelope/v1';

const FRAME_DOMAIN = 'reploid.protected-frame/v1';
const ADVERTISEMENT_DOMAIN = 'reploid.protected-advertisement/v1';
const MAX_HEADER_BYTES = 64 << 10;
const MAX_LANES = 8;
const MAX_BINDING_MS = 30 * 60 * 1000;
/** Blob byte ceilings per frame kind, enforced from the header before any blob byte is buffered. */
export const PROTECTED_FRAME_CEILINGS = Object.freeze({
  'advertise-request': 0, advertisement: 0, 'bind-offer': 0, 'bind-accept': 0, 'bind-confirm': 0,
  key: 1 << 30, 'keys-held': 0, ready: 0, step: MAX_LANES * 8 * (64 << 20), result: MAX_LANES * (32 << 20), bye: 0, abort: 0,
  // Never accepted by a requester; listed so the decoder can hand it up and the session can refuse it by name.
  'decrypt-request': 64 << 20
});
const REQUESTER_KINDS = ['advertise-request', 'bind-offer', 'bind-confirm', 'key', 'keys-held', 'step', 'bye'];

const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes = 32) => hex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const nonce = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const freeze = value => {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** A protected-route failure. Stable inference codes where they apply; PROTECTED_* codes for the session itself. */
export function protectedError(code, message, details = {}) {
  const error = code.startsWith('PROTECTED_') ? Object.assign(new Error(message), { code }) : executionError(code, message);
  return Object.assign(error, { protected: details });
}

const signingBytes = (domain, value) => encoder.encode(`${domain}\n${canonicalize(value)}`);
async function sign(identity, domain, value) {
  const key = await importSigningKey(identity);
  return toBase64Url(await globalThis.crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, signingBytes(domain, value)));
}
async function verify(publicJwk, domain, value, signature) {
  if (typeof signature !== 'string') return false;
  try {
    const key = await importVerificationKey(publicJwk);
    return await globalThis.crypto.subtle.verify(getIdentitySignAlgorithm(publicJwk), key, fromBase64Url(signature), signingBytes(domain, value));
  } catch { return false; }
}
const bytesDigest = async bytes => sha256Hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

// ---------------------------------------------------------------------------------------------------------------
// Backend descriptor and advertisement

/** The descriptor an evaluator advertises. Shape only: nothing in it can make the backend eligible. */
export function validateProtectedDescriptor(input) {
  const value = structuredClone(input);
  const ok = exact(value, ['schema', 'protocol', 'backend', 'engine', 'scheme', 'parameterSet', 'circuit', 'evaluator', 'keyEpochs', 'lanes', 'issuedAt'])
    && value.schema === PROTECTED_DESCRIPTOR_SCHEMA && label(value.protocol) && label(value.backend)
    && exact(value.engine, ['protocol', 'implementation']) && label(value.engine.protocol) && label(value.engine.implementation)
    && label(value.scheme)
    && exact(value.parameterSet, ['id', 'digest']) && label(value.parameterSet.id) && digest(value.parameterSet.digest)
    && exact(value.circuit, ['identity', 'modelIdentity', 'vocab', 'context', 'inputLevel', 'logSlots', 'rotations'])
    && digest(value.circuit.identity) && digest(value.circuit.modelIdentity)
    && [value.circuit.vocab, value.circuit.context, value.circuit.inputLevel, value.circuit.logSlots].every(Number.isSafeInteger)
    && Array.isArray(value.circuit.rotations) && value.circuit.rotations.length <= 64 && value.circuit.rotations.every(Number.isSafeInteger)
    && exact(value.evaluator, ['participantId', 'publicJwk']) && /^peer:[a-f0-9]{24}$/.test(value.evaluator.participantId) && object(value.evaluator.publicJwk)
    && exact(value.keyEpochs, ['maxTtlSeconds', 'reuse']) && Number.isSafeInteger(value.keyEpochs.maxTtlSeconds) && value.keyEpochs.maxTtlSeconds > 0
    && typeof value.keyEpochs.reuse === 'boolean'
    && exact(value.lanes, ['max']) && Number.isSafeInteger(value.lanes.max) && value.lanes.max >= 1 && value.lanes.max <= MAX_LANES
    && Number.isSafeInteger(value.issuedAt);
  if (!ok) throw protectedError('EXECUTION_ROUTE_UNAVAILABLE', 'The protected backend descriptor is malformed. Nothing was sent.');
  return freeze(value);
}

/** Build and sign an evaluator's descriptor from its engine manifest (for example Doppler's `evaluator --describe`). */
export async function createProtectedAdvertisement({ identity, manifest, keyEpochMaxTtlSeconds = 86400, maxLanes = MAX_LANES, now = Date.now }) {
  const descriptor = validateProtectedDescriptor({
    schema: PROTECTED_DESCRIPTOR_SCHEMA, protocol: PROTECTED_PROTOCOL, backend: PROTECTED_BACKEND,
    engine: { protocol: manifest.protocol, implementation: manifest.implementation }, scheme: manifest.scheme,
    parameterSet: { id: manifest.profile, digest: manifest.profileDigest },
    circuit: { identity: manifest.circuit, modelIdentity: manifest.model, vocab: manifest.vocab, context: manifest.context,
      inputLevel: manifest.inputLevel, logSlots: manifest.logSlots, rotations: [...manifest.rotations] },
    evaluator: { participantId: identity.peerId, publicJwk: identity.publicJwk },
    keyEpochs: { maxTtlSeconds: keyEpochMaxTtlSeconds, reuse: true },
    lanes: { max: Math.min(maxLanes, manifest.maxLanes ?? MAX_LANES) }, issuedAt: now()
  });
  return freeze({ schema: PROTECTED_ADVERTISEMENT_SCHEMA, descriptor, signature: await sign(identity, ADVERTISEMENT_DOMAIN, descriptor) });
}

/** Check an advertisement's signature and that its key is the identity it names. Returns the descriptor and digest. */
export async function verifyProtectedAdvertisement(input) {
  if (!exact(input, ['schema', 'descriptor', 'signature']) || input.schema !== PROTECTED_ADVERTISEMENT_SCHEMA) {
    throw protectedError('EXECUTION_ROUTE_UNAVAILABLE', 'The protected backend advertisement is malformed. Nothing was sent.');
  }
  const descriptor = validateProtectedDescriptor(input.descriptor);
  if (await createPeerIdFromPublicJwk(descriptor.evaluator.publicJwk) !== descriptor.evaluator.participantId
    || !await verify(descriptor.evaluator.publicJwk, ADVERTISEMENT_DOMAIN, descriptor, input.signature)) {
    throw protectedError('EXECUTION_ROUTE_UNAVAILABLE', 'The protected backend advertisement is not signed by the identity it names. Nothing was sent.');
  }
  return freeze({ descriptor, descriptorDigest: await hashJson(descriptor) });
}

// ---------------------------------------------------------------------------------------------------------------
// Requester policy and eligibility

/**
 * The requester's own allowlist. Every field a descriptor states is checked against this, never trusted.
 * `parameterSets[].insecureDevelopment` is the requester's own knowledge of a parameter set, not the evaluator's.
 */
export function validateProtectedPolicy(input) {
  const value = structuredClone(input);
  const ok = object(value) && Array.isArray(value.protocols) && value.protocols.every(label)
    && Array.isArray(value.engines) && value.engines.every(label)
    && Array.isArray(value.parameterSets) && value.parameterSets.length > 0 && value.parameterSets.every(item =>
      exact(item, ['id', 'digest', 'insecureDevelopment']) && label(item.id) && digest(item.digest) && typeof item.insecureDevelopment === 'boolean')
    && typeof value.allowInsecureDevelopment === 'boolean'
    && Array.isArray(value.circuits) && value.circuits.length > 0 && value.circuits.every(item =>
      exact(item, ['identity', 'modelIdentity', 'tokenizer', 'vocab', 'context', 'inputLevel', 'logSlots', 'rotations', 'trapSet', 'trapPublisherKeys'])
      && digest(item.identity) && digest(item.modelIdentity) && exact(item.tokenizer, ['alphabet']) && label(item.tokenizer.alphabet)
      && [item.vocab, item.context, item.inputLevel, item.logSlots].every(Number.isSafeInteger) && Array.isArray(item.rotations)
      && object(item.trapSet) && Array.isArray(item.trapPublisherKeys) && item.trapPublisherKeys.length > 0 && item.trapPublisherKeys.every(label))
    && Number.isSafeInteger(value.trapLanes) && value.trapLanes >= 1 && value.trapLanes < MAX_LANES
    && typeof value.maxTrapTolerance === 'number' && value.maxTrapTolerance > 0
    && Number.isSafeInteger(value.maxKeyEpochSeconds) && value.maxKeyEpochSeconds > 0;
  if (!ok) throw protectedError('EXECUTION_REQUEST_INVALID', 'Protected execution policy is malformed');
  return freeze(value);
}

/**
 * Decide eligibility in `prepare`, from the requester's allowlist and a verified advertisement. No prompt, no
 * prompt length and no content is involved. Returns the pinned circuit and parameter set, or the reasons it is not.
 */
export function protectedEligibility(policy, verified, model) {
  const { descriptor } = verified;
  const reasons = [];
  if (!policy.protocols.includes(descriptor.protocol) || descriptor.backend !== PROTECTED_BACKEND) reasons.push('protocol not allowed');
  if (!policy.engines.includes(descriptor.engine.protocol)) reasons.push('engine protocol not allowed');
  const parameterSet = policy.parameterSets.find(item => item.digest === descriptor.parameterSet.digest && item.id === descriptor.parameterSet.id);
  if (!parameterSet) reasons.push('parameter set not allowed');
  else if (parameterSet.insecureDevelopment && !policy.allowInsecureDevelopment) reasons.push('insecure development parameter set');
  const circuit = policy.circuits.find(item => item.identity === descriptor.circuit.identity);
  if (!circuit) reasons.push('circuit not pinned');
  else {
    if (circuit.modelIdentity !== model.identity || descriptor.circuit.modelIdentity !== model.identity) reasons.push('model not pinned to this circuit');
    if (['vocab', 'context', 'inputLevel', 'logSlots'].some(key => circuit[key] !== descriptor.circuit[key])
      || canonicalize(circuit.rotations) !== canonicalize(descriptor.circuit.rotations)) reasons.push('circuit layout differs from the pin');
  }
  if (model.adapterIdentities?.length) reasons.push('adapters are not supported');
  if (descriptor.lanes.max < policy.trapLanes + 1) reasons.push('too few lanes for the trap policy');
  return reasons.length ? { eligible: false, reasons } : { eligible: true, circuit, parameterSet };
}

// ---------------------------------------------------------------------------------------------------------------
// Trap sets

/** Verify a publisher-signed trap set against a pinned publisher key and a pinned circuit. */
export async function verifyTrapSet(envelope, { publisherKeys, circuit, maxTolerance }) {
  const unverified = message => protectedError('EXECUTION_ROUTE_UNAVAILABLE', `Trap set: ${message}. Nothing was sent.`);
  if (!exact(envelope, ['schema', 'body', 'bodyDigest', 'publicKey', 'signature']) || envelope.schema !== TRAP_SET_ENVELOPE_SCHEMA
    || typeof envelope.body !== 'string') throw unverified('malformed envelope');
  if (!publisherKeys.includes(envelope.publicKey)) throw unverified('publisher key is not pinned');
  const bodyBytes = encoder.encode(envelope.body);
  const key = await globalThis.crypto.subtle.importKey('raw', fromBase64Url(envelope.publicKey), { name: 'Ed25519' }, false, ['verify']);
  const signed = new Uint8Array([...encoder.encode(`${TRAP_SET_SCHEMA}\x00`), ...bodyBytes]);
  if (!await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64Url(envelope.signature), signed)) throw unverified('signature does not verify');
  const bodyDigest = await bytesDigest(bodyBytes);
  if (bodyDigest !== envelope.bodyDigest) throw unverified('body digest differs');
  let body;
  try { body = JSON.parse(envelope.body); } catch { throw unverified('body is not JSON'); }
  const tolerance = body?.tolerance;
  if (body?.schema !== TRAP_SET_SCHEMA || body.circuit !== circuit.identity || body.model !== circuit.modelIdentity
    || body.vocab !== circuit.vocab || body.context !== circuit.context || body.tokenizer?.alphabet !== circuit.tokenizer.alphabet) {
    throw unverified('it is not for the pinned circuit');
  }
  if (!(typeof tolerance?.maxAbsLogitError === 'number' && tolerance.maxAbsLogitError > 0 && tolerance.maxAbsLogitError <= maxTolerance
    && tolerance.requireArgmax === true)) throw unverified('its tolerance exceeds this requester\'s limit');
  const traps = Array.isArray(body.traps) ? body.traps : [];
  const token = value => Number.isSafeInteger(value) && value >= 0 && value < circuit.vocab;
  for (const trap of traps) {
    const length = trap?.prompt?.length;
    if (!label(trap?.id) || !Array.isArray(trap.prompt) || !trap.prompt.every(token) || !Array.isArray(trap.continuation)
      || !trap.continuation.every(token) || length < 1 || length + trap.continuation.length !== circuit.context
      || !Array.isArray(trap.expectedLogits) || trap.expectedLogits.length !== circuit.context - length + 1
      || !trap.expectedLogits.every(row => Array.isArray(row) && row.length === circuit.vocab && row.every(Number.isFinite))) {
      throw unverified('a trap is malformed');
    }
  }
  if (!traps.length) throw unverified('it has no traps');
  return freeze({ digest: bodyDigest, publisherKey: envelope.publicKey, tolerance: { maxAbsLogitError: tolerance.maxAbsLogitError },
    traps, circuit: circuit.identity });
}

/** Uniform integer in [0, n) from the platform CSPRNG (rejection sampling, no modulo bias). */
export function secureRandomInt(n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError('random range');
  const limit = Math.floor(2 ** 32 / n) * n;
  const word = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(word); while (word[0] >= limit);
  return word[0] % n;
}

/**
 * Lay out one session's lanes: one real lane at a uniformly random index and `trapLanes` distinct traps of the
 * same prompt length. Every lane has the same schedule, so lanes differ only inside their fresh encryptions.
 */
export function planProtectedLanes({ trapSet, promptLength, generate, trapLanes, randomInt = secureRandomInt }) {
  const pool = trapSet.traps.filter(trap => trap.prompt.length === promptLength && trap.continuation.length >= generate - 1);
  if (pool.length < trapLanes) {
    throw protectedError('EXECUTION_REQUEST_INVALID', `The pinned trap set has ${pool.length} traps for a ${promptLength}-token prompt; ${trapLanes} are needed. Nothing was sent.`);
  }
  const chosen = [...pool];
  for (let i = chosen.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  const lanes = chosen.slice(0, trapLanes).map(trap => ({ kind: 'trap', trap }));
  lanes.splice(randomInt(trapLanes + 1), 0, { kind: 'real', trap: null });
  return lanes;
}

/** Compare one decrypted trap result with its expected logits. Non-finite values fail. */
export function checkTrapResult(expected, logits, tolerance) {
  let maxAbsError = 0;
  for (let i = 0; i < expected.length; i++) {
    const error = Math.abs(logits[i] - expected[i]);
    maxAbsError = Number.isFinite(error) ? Math.max(maxAbsError, error) : Infinity;
  }
  const argmaxOk = totalArgmax(logits) === totalArgmax(expected);
  return { pass: maxAbsError <= tolerance.maxAbsLogitError && argmaxOk, maxAbsError, argmaxOk };
}

/**
 * Argmax that cannot fail on any input: NaN counts as -Infinity, ties take the lowest index. The real lane's
 * decrypted values must never decide whether a session continues, or an evaluator could learn a predicate of the
 * prompt from whether it aborted.
 */
export function totalArgmax(values) {
  let best = 0, bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = Number.isNaN(values[i]) ? -Infinity : values[i];
    if (value > bestValue) { best = i; bestValue = value; }
  }
  return best;
}

/**
 * Probability that one session catches an evaluator that tampers `tampered` of its K lanes, chosen without being
 * able to tell them apart: 1 - C(K - T, m) / C(K, m). With one real lane, tampering one lane is caught with
 * probability T / K, and tampering two or more is always caught.
 */
export function trapDetectionProbability({ lanes, trapLanes, tampered = 1 }) {
  const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  return 1 - choose(lanes - trapLanes, tampered) / choose(lanes, tampered);
}

// ---------------------------------------------------------------------------------------------------------------
// Framing: u32 little-endian header length | header JSON | blobs. Transport-neutral; host adapters move bytes.

/** Encode a frame into byte chunks for any byte transport. */
export function encodeProtectedFrame(header, blobs = []) {
  const raw = encoder.encode(JSON.stringify(header));
  if (raw.length === 0 || raw.length > MAX_HEADER_BYTES) throw new RangeError('Protected frame header too large');
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, raw.length, true);
  return [prefix, raw, ...blobs];
}

/**
 * Incremental decoder. `inspect(header)` returns the blob sizes the header announces, or throws; it runs before
 * any blob byte is kept, so a ceiling violation never buffers its payload.
 */
export function createFrameDecoder({ inspect, onFrame, maxHeaderBytes = MAX_HEADER_BYTES }) {
  let chunks = [], buffered = 0, need = 4, stage = 'length', header = null, sizes = null;
  const take = n => {
    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const chunk = chunks[0], count = Math.min(chunk.length, n - offset);
      out.set(chunk.subarray(0, count), offset);
      offset += count;
      if (count === chunk.length) chunks.shift(); else chunks[0] = chunk.subarray(count);
    }
    buffered -= n;
    return out;
  };
  return {
    push(chunk) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      buffered += chunk.length;
      while (buffered >= need) {
        if (stage === 'length') {
          const n = new DataView(take(4).buffer).getUint32(0, true);
          if (n === 0 || n > maxHeaderBytes) throw new RangeError(`Frame header length ${n} out of range`);
          stage = 'header'; need = n;
        } else if (stage === 'header') {
          header = JSON.parse(new TextDecoder().decode(take(need)));
          sizes = inspect(header);
          stage = 'blobs'; need = sizes.reduce((a, b) => a + b, 0);
        } else {
          const blobs = sizes.map(size => take(size));
          const frame = { header, blobs };
          stage = 'length'; need = 4; header = null; sizes = null;
          onFrame(frame);
        }
      }
    }
  };
}

/** Header inspection for the protected wire: known kind, announced sizes, and the kind's ceiling. */
export function inspectProtectedHeader(header) {
  if (!object(header) || header.schema !== PROTECTED_PROTOCOL || !Object.hasOwn(PROTECTED_FRAME_CEILINGS, header.kind)
    || !Array.isArray(header.blobs) || header.blobs.length > MAX_LANES * 8) throw new RangeError('Unrecognized protected frame');
  const sizes = header.blobs.map(blob => blob?.bytes);
  if (!sizes.every(size => Number.isSafeInteger(size) && size >= 0)) throw new RangeError('Invalid blob size');
  if (sizes.reduce((a, b) => a + b, 0) > PROTECTED_FRAME_CEILINGS[header.kind]) throw new RangeError(`${header.kind} exceeds its ceiling`);
  return sizes;
}

/** An in-process frame channel pair (tests and same-process hosts). */
export function createMemoryFrameChannelPair() {
  const make = () => ({ queue: [], waiters: [], closed: false });
  const a = make(), b = make();
  const channel = (self, peer) => ({
    async send(frame) {
      if (self.closed || peer.closed) throw protectedError('PROTECTED_SESSION_CLOSED', 'The protected channel is closed');
      const copy = { header: structuredClone(frame.header), blobs: frame.blobs.map(blob => new Uint8Array(blob)) };
      const waiter = peer.waiters.shift();
      if (waiter) waiter.resolve(copy); else peer.queue.push(copy);
    },
    receive({ timeoutMs = 60000 } = {}) {
      if (self.queue.length) return Promise.resolve(self.queue.shift());
      if (self.closed) return Promise.reject(protectedError('PROTECTED_SESSION_CLOSED', 'The protected channel closed'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { self.waiters.splice(self.waiters.indexOf(waiter), 1); reject(protectedError('PROTECTED_SESSION_CLOSED', 'The protected peer did not answer in time')); }, timeoutMs);
        const waiter = { resolve: frame => { clearTimeout(timer); resolve(frame); }, reject: error => { clearTimeout(timer); reject(error); } };
        self.waiters.push(waiter);
      });
    },
    close() {
      for (const side of [self, peer]) {
        side.closed = true;
        for (const waiter of side.waiters.splice(0)) waiter.reject(protectedError('PROTECTED_SESSION_CLOSED', 'The protected channel closed'));
      }
    }
  });
  return [channel(a, b), channel(b, a)];
}

/** Build and sign a frame. Blob digests are part of the signed header. */
export async function signProtectedFrame(identity, fields, blobs = []) {
  const header = { schema: PROTECTED_PROTOCOL, kind: fields.kind, session: fields.session, binding: fields.binding ?? null,
    seq: fields.seq, sender: identity.peerId, fields: fields.fields ?? {},
    blobs: await Promise.all(blobs.map(async blob => ({ bytes: blob.length, digest: await bytesDigest(blob) }))) };
  return { header: { ...header, signature: await sign(identity, FRAME_DOMAIN, header) }, blobs };
}

/**
 * Check a received frame: allowed kind, session, binding digest, the exact next sequence number, sender, the
 * sender's signature over the header, and every blob's digest. Any mismatch is a protocol violation.
 */
export async function verifyProtectedFrame(frame, { kinds, session, binding, seq, sender, publicJwk }) {
  const { header, blobs } = frame;
  if (!kinds.includes(header?.kind)) {
    throw Object.assign(new Error(`refused unsolicited "${header?.kind}" frame while waiting for ${kinds.join(' or ')}`), { violation: 'kind', kind: header?.kind });
  }
  const { signature, ...signed } = header;
  if (header.session !== session || header.binding !== binding) throw Object.assign(new Error('frame is not bound to this session'), { violation: 'binding' });
  if (header.seq !== seq) throw Object.assign(new Error(`frame sequence ${header.seq}, expected ${seq}`), { violation: 'sequence' });
  if (header.sender !== sender || !await verify(publicJwk, FRAME_DOMAIN, signed, signature)) {
    throw Object.assign(new Error('frame is not signed by the bound peer'), { violation: 'signature' });
  }
  if (!Array.isArray(header.blobs) || header.blobs.length !== blobs.length) throw Object.assign(new Error('frame blob count differs'), { violation: 'blobs' });
  for (let i = 0; i < blobs.length; i++) {
    if (blobs[i].length !== header.blobs[i].bytes || await bytesDigest(blobs[i]) !== header.blobs[i].digest) {
      throw Object.assign(new Error('frame blob does not match its signed digest'), { violation: 'blob-digest' });
    }
  }
  return header;
}

// ---------------------------------------------------------------------------------------------------------------
// Session binding

export async function bindingDigest(offer, evaluatorNonce) {
  return hashJson({ schema: PROTECTED_BINDING_SCHEMA, offer, evaluatorNonce });
}

/** Ask an endpoint for its signed advertisement. Sends no content, no model pin and no identity. */
export async function requestProtectedAdvertisement(channel, { timeoutMs = 30000 } = {}) {
  await channel.send({ header: { schema: PROTECTED_PROTOCOL, kind: 'advertise-request', session: null, binding: null, seq: 0, sender: null, fields: {}, blobs: [] }, blobs: [] });
  const frame = await channel.receive({ timeoutMs });
  if (frame.header?.kind !== 'advertisement') throw protectedError('EXECUTION_ROUTE_UNAVAILABLE', 'The endpoint did not answer with an advertisement. Nothing was sent.');
  return frame.header.fields.advertisement;
}

// ---------------------------------------------------------------------------------------------------------------
// Protected journal: session ids, binding digests, sequence numbers, trap verdicts and result digests only.

const JOURNAL_KEYS = new Set(['role', 'session', 'state', 'at', 'planId', 'bindingDigest', 'descriptorDigest', 'evaluator', 'requester',
  'keyEpoch', 'lanes', 'trapLanes', 'step', 'trapChecks', 'resultDigests', 'code', 'reason', 'frames', 'bytes', 'computeSeconds', 'keysUploaded', 'keyHolder']);

/**
 * In-memory protected journal, separate from the plaintext generation journal. Records are checked against an
 * allowlist of field names; tokens, logits, text and ciphertexts have no field to go in.
 */
export function createProtectedJournal({ limit = 256 } = {}) {
  const records = [];
  return Object.freeze({
    record(entry) {
      for (const key of Object.keys(entry)) if (!JOURNAL_KEYS.has(key)) throw new Error(`Protected journal does not record ${key}`);
      records.push(freeze(structuredClone(entry)));
      while (records.length > limit) records.shift();
    },
    entries: () => records.slice(),
    /** Recovery never resumes a protected session: every unfinished one is marked abandoned for a fresh start. */
    recover(now = Date.now()) {
      const last = new Map();
      for (const entry of records) last.set(`${entry.role}:${entry.session}`, entry);
      const abandoned = [...last.values()].filter(entry => !['completed', 'failed', 'abandoned'].includes(entry.state));
      for (const entry of abandoned) this.record({ role: entry.role, session: entry.session, state: 'abandoned', at: now, reason: 'no resume' });
      return abandoned.map(entry => entry.session);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Requester session

/**
 * Run one protected session on a connected channel. `crypto` is the requester's key holder (it alone holds the
 * secret key); `onToken` receives each real token after that step's traps passed. Returns tokens and evidence.
 * On any failure the error carries `protected` details: stage, decryptions, and what was uploaded.
 */
export async function runProtectedRequesterSession({
  channel, crypto, identity, verified, planId, routeId, expiresAt, trapSet, trapLanes, promptTokens, generate,
  journal = createProtectedJournal(), onToken = () => {}, onBound = () => {}, randomInt = secureRandomInt,
  now = Date.now, timeoutMs = 30 * 60 * 1000, signal
}) {
  const { descriptor, descriptorDigest } = verified;
  const evaluator = descriptor.evaluator;
  const context = descriptor.circuit.context;
  const L = promptTokens.length;
  if (L < 1 || generate < 1 || L + generate - 1 > context) {
    throw protectedError('EXECUTION_REQUEST_INVALID', `A ${L}-token prompt with ${generate} generated tokens exceeds the ${context}-position context. Nothing was sent.`);
  }
  const lanes = planProtectedLanes({ trapSet, promptLength: L, generate, trapLanes, randomInt });
  const K = lanes.length, realLane = lanes.findIndex(lane => lane.kind === 'real');
  const session = 'ps_' + randomHex(16);
  const stats = { stage: 'binding', decryptions: { trap: 0, real: 0 }, uploaded: { keyFrames: 0, stepFrames: 0, bytes: 0 },
    frames: { sent: 0, received: 0 }, bytes: { sent: 0, received: 0 } };
  const fail = (code, message) => protectedError(code, message, structuredClone(stats));
  const epoch = crypto.epoch;
  const nowSeconds = Math.floor(now() / 1000);
  if (!(epoch.expiresAt > nowSeconds && epoch.expiresAt <= nowSeconds + descriptor.keyEpochs.maxTtlSeconds)) {
    throw fail('EXECUTION_ROUTE_UNAVAILABLE', 'The key epoch outlives what the evaluator keeps keys for. Nothing was sent.');
  }
  const offer = { schema: PROTECTED_BINDING_SCHEMA, protocol: PROTECTED_PROTOCOL, session, planId, routeId, descriptorDigest,
    evaluator: evaluator.participantId, requester: { participantId: identity.peerId, publicJwk: identity.publicJwk },
    keyEpoch: { id: epoch.id, expiresAt: epoch.expiresAt }, requesterNonce: randomHex(32), expiresAt,
    schedule: { lanes: K, promptTokens: L, generatedTokens: generate } };
  let sendSeq = 0, recvSeq = 0, binding = null;
  const send = async (kind, fields = {}, blobs = []) => {
    signal?.throwIfAborted();
    const frame = await signProtectedFrame(identity, { kind, session, binding, seq: sendSeq++, fields }, blobs);
    await channel.send(frame);
    const bytes = blobs.reduce((total, blob) => total + blob.length, 0);
    stats.frames.sent++; stats.bytes.sent += bytes;
    if (kind === 'key') { stats.uploaded.keyFrames++; stats.uploaded.bytes += bytes; }
    if (kind === 'step') { stats.uploaded.stepFrames++; stats.uploaded.bytes += bytes; }
  };
  const receive = async (kinds, extra = {}) => {
    signal?.throwIfAborted();
    if (now() > expiresAt) throw fail('PROTECTED_SESSION_EXPIRED', `The session binding expired at ${stats.stage}; nothing more was decrypted.`);
    let frame;
    try { frame = await channel.receive({ timeoutMs, signal }); } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw fail('PROTECTED_SESSION_CLOSED', `The evaluator dropped the session at ${stats.stage}: ${error.message}`);
    }
    stats.frames.received++; stats.bytes.received += frame.blobs.reduce((total, blob) => total + blob.length, 0);
    if (frame.header?.kind === 'abort' && kinds.includes('abort') === false) {
      throw fail(binding ? 'PROTECTED_SESSION_CLOSED' : 'EXECUTION_PLAN_CHANGED', `The evaluator ended the session at ${stats.stage}. ${binding ? '' : 'Nothing was uploaded.'}`.trim());
    }
    try {
      await verifyProtectedFrame(frame, { kinds, session, binding, seq: recvSeq, sender: evaluator.participantId, publicJwk: evaluator.publicJwk, ...extra });
    } catch (error) {
      // Before the binding exists, nothing has been uploaded: the plan's evaluator could not be bound.
      throw fail(binding ? 'RESULT_UNVERIFIED' : 'EXECUTION_PLAN_CHANGED',
        binding ? `Protocol violation at ${stats.stage}: ${error.message}. Nothing more was decrypted.`
          : `The evaluator could not be bound as the planned identity: ${error.message}. Nothing was uploaded.`);
    }
    recvSeq++;
    return frame;
  };
  const record = entry => journal.record({ role: 'requester', session, at: now(), ...entry });
  try {
    record({ state: 'binding', planId, descriptorDigest, evaluator: evaluator.participantId, keyEpoch: epoch.id, lanes: K, trapLanes });
    await send('bind-offer', { offer });
    const accept = await receive(['bind-accept']);
    const offerDigest = await hashJson(offer);
    if (accept.header.fields.offerDigest !== offerDigest || !nonce(accept.header.fields.evaluatorNonce)) {
      throw fail('EXECUTION_PLAN_CHANGED', 'The evaluator accepted a different session offer. Nothing was uploaded.');
    }
    binding = await bindingDigest(offer, accept.header.fields.evaluatorNonce);
    await send('bind-confirm', { bindingDigest: binding });
    record({ state: 'bound', bindingDigest: binding });
    onBound({ bindingDigest: binding, session });

    stats.stage = 'keys';
    const held = accept.header.fields.heldKeysDigest;
    let keysDigest, keysUploaded = false;
    if (descriptor.keyEpochs.reuse && epoch.keysDigest && held === epoch.keysDigest) {
      await send('keys-held', { keysDigest: epoch.keysDigest });
      keysDigest = epoch.keysDigest;
    } else {
      let index = 0;
      keysDigest = await crypto.generateKeys(blob => send('key', { index: index++ }, [blob]));
      keysUploaded = true;
    }
    const ready = await receive(['ready']);
    if (ready.header.fields.keysDigest !== keysDigest) throw fail('RESULT_UNVERIFIED', 'The evaluator acknowledged different evaluation keys. Nothing was decrypted.');
    if (keysUploaded) await crypto.commitKeys(keysDigest);
    record({ state: 'keys-ready', keysUploaded });

    const tokens = [], trapChecks = [];
    let maxAbsError = 0;
    for (let step = 1; step <= generate; step++) {
      stats.stage = `step ${step}`;
      const inputs = lanes.map(lane => lane.kind === 'real'
        ? (step === 1 ? promptTokens : [tokens[step - 2]])
        : (step === 1 ? lane.trap.prompt : [lane.trap.continuation[step - 2]]));
      const blobs = await crypto.encrypt(inputs.flat());
      await send('step', { step, phase: step === 1 ? 'prefill' : 'decode', lanes: K, tokensPerLane: inputs[0].length }, blobs);
      const result = await receive(['result']);
      if (result.header.fields.step !== step || result.blobs.length !== K) {
        throw fail('RESULT_UNVERIFIED', `The result is not for step ${step} of ${K} lanes. Nothing more was decrypted.`);
      }
      // Every trap lane first. Rejection depends only on trap results, never on the real lane's values.
      for (let lane = 0; lane < K; lane++) {
        if (lanes[lane].kind !== 'trap') continue;
        const logits = await crypto.decrypt(result.blobs[lane]);
        stats.decryptions.trap++;
        const check = logits ? checkTrapResult(lanes[lane].trap.expectedLogits[step - 1], logits, trapSet.tolerance)
          : { pass: false, maxAbsError: Infinity, argmaxOk: false };
        trapChecks.push({ step, trap: lanes[lane].trap.id, pass: check.pass, maxAbsError: check.maxAbsError });
        maxAbsError = Math.max(maxAbsError, check.maxAbsError);
        if (!check.pass) {
          record({ state: 'failed', step, code: 'RESULT_UNVERIFIED', reason: 'trap', trapChecks: trapChecks.slice(-K) });
          throw fail('RESULT_UNVERIFIED', `A known-answer trap failed at step ${step}; the real result was not decrypted.`);
        }
      }
      const logits = await crypto.decrypt(result.blobs[realLane]);
      if (!logits) throw fail('RESULT_UNVERIFIED', `The result at step ${step} does not have the pinned ciphertext shape.`);
      stats.decryptions.real++;
      const token = totalArgmax(logits);
      tokens.push(token);
      record({ state: 'step', step, resultDigests: result.header.blobs.map(blob => blob.digest) });
      await onToken(token, step);
    }
    stats.stage = 'closing';
    await send('bye');
    record({ state: 'completed', frames: structuredClone(stats.frames), bytes: structuredClone(stats.bytes) });
    return freeze({
      tokens,
      evidence: { session, bindingDigest: binding, descriptorDigest, evaluator: evaluator.participantId, keyEpoch: epoch.id, keysUploaded,
        lanes: K, trapLanes, trapSet: trapSet.digest, publisherKey: trapSet.publisherKey, tolerance: trapSet.tolerance.maxAbsLogitError,
        trapChecks: trapChecks.length, trapsPassed: trapChecks.filter(check => check.pass).length, maxTrapError: maxAbsError,
        detectionProbability: trapDetectionProbability({ lanes: K, trapLanes }), decryptions: { ...stats.decryptions }, uploaded: { ...stats.uploaded },
        frames: { ...stats.frames }, bytes: { ...stats.bytes } }
    });
  } catch (error) {
    if (!error.protected) Object.assign(error, { protected: structuredClone(stats) });
    try { record({ state: 'failed', code: typeof error.code === 'string' ? error.code : null, reason: stats.stage }); } catch { /* journal full or closed */ }
    throw error;
  } finally {
    channel.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluator session

/**
 * Serve one connection as an evaluator. `backend` computes on ciphertext (Doppler's Go evaluator today, a GPU
 * evaluator later): `open(schedule) -> { manifest, sendKey, keysHeld, ready, step, close }`. `seenNonces` is shared
 * across sessions so a replayed offer is refused. `misbehave` is for tests only.
 */
export async function serveProtectedEvaluatorSession({
  channel, identity, advertisement, backend, seenNonces, journal = createProtectedJournal(), now = Date.now,
  timeoutMs = 30 * 60 * 1000, misbehave = null, signingIdentity = identity
}) {
  const descriptor = advertisement.descriptor;
  const descriptorDigest = await hashJson(descriptor);
  let session = null, binding = null, recvSeq = 0, sendSeq = 0, requester = null, engine = null;
  const frames = {}, bytes = { received: 0, sent: 0 };
  const record = entry => journal.record({ role: 'evaluator', session, at: now(), ...entry });
  const send = async (kind, fields = {}, blobs = []) => {
    const frame = await signProtectedFrame(signingIdentity, { kind, session, binding, seq: sendSeq++, fields }, blobs);
    await channel.send(frame);
    bytes.sent += blobs.reduce((total, blob) => total + blob.length, 0);
    return frame;
  };
  let bindingExpiresAt = Infinity;
  const receive = async kinds => {
    if (now() > bindingExpiresAt) throw new Error('session binding expired');
    const frame = await channel.receive({ timeoutMs });
    frames[frame.header?.kind] = (frames[frame.header?.kind] ?? 0) + 1;
    bytes.received += frame.blobs.reduce((total, blob) => total + blob.length, 0);
    await verifyProtectedFrame(frame, { kinds, session, binding, seq: recvSeq, sender: requester.participantId, publicJwk: requester.publicJwk });
    recvSeq++;
    return frame;
  };
  try {
    const first = await channel.receive({ timeoutMs });
    frames[first.header?.kind] = 1;
    if (first.header?.kind === 'advertise-request') {
      await channel.send({ header: { schema: PROTECTED_PROTOCOL, kind: 'advertisement', session: null, binding: null, seq: 0,
        sender: identity.peerId, fields: { advertisement }, blobs: [] }, blobs: [] });
      return { outcome: 'advertised' };
    }
    if (first.header?.kind !== 'bind-offer') throw new Error('first frame must be an advertisement request or a bind offer');
    const offer = first.header.fields?.offer;
    const t = now();
    session = offer?.session;
    const schedule = offer?.schedule;
    const valid = object(offer) && offer.schema === PROTECTED_BINDING_SCHEMA && offer.protocol === PROTECTED_PROTOCOL
      && typeof session === 'string' && /^ps_[a-f0-9]{32}$/.test(session) && first.header.session === session
      && offer.evaluator === identity.peerId && offer.descriptorDigest === descriptorDigest
      && label(offer.planId) && digest(offer.routeId) && nonce(offer.requesterNonce)
      && Number.isSafeInteger(offer.expiresAt) && offer.expiresAt > t && offer.expiresAt <= t + MAX_BINDING_MS
      && object(offer.keyEpoch) && /^[a-f0-9]{32}$/.test(offer.keyEpoch.id) && Number.isSafeInteger(offer.keyEpoch.expiresAt)
      && offer.keyEpoch.expiresAt > t / 1000 && offer.keyEpoch.expiresAt <= t / 1000 + descriptor.keyEpochs.maxTtlSeconds
      && object(schedule) && Number.isSafeInteger(schedule.lanes) && schedule.lanes >= 2 && schedule.lanes <= descriptor.lanes.max
      && Number.isSafeInteger(schedule.promptTokens) && schedule.promptTokens >= 1 && Number.isSafeInteger(schedule.generatedTokens)
      && schedule.generatedTokens >= 1 && schedule.promptTokens + schedule.generatedTokens - 1 <= descriptor.circuit.context
      && object(offer.requester) && object(offer.requester.publicJwk);
    if (!valid) throw new Error('bind offer is invalid, expired or not for this evaluator and descriptor');
    for (const [seen, expiry] of seenNonces) if (expiry <= t) seenNonces.delete(seen);
    if (seenNonces.has(offer.requesterNonce)) throw new Error('bind offer replayed');
    if (await createPeerIdFromPublicJwk(offer.requester.publicJwk) !== offer.requester.participantId) throw new Error('requester key does not match its identity');
    requester = offer.requester;
    await verifyProtectedFrame(first, { kinds: ['bind-offer'], session, binding: null, seq: 0, sender: requester.participantId, publicJwk: requester.publicJwk });
    recvSeq = 1;
    seenNonces.set(offer.requesterNonce, offer.expiresAt);
    bindingExpiresAt = offer.expiresAt;
    engine = await backend.open({ profile: descriptor.parameterSet.id, modelIdentity: descriptor.circuit.modelIdentity, lanes: schedule.lanes,
      promptTokens: schedule.promptTokens, generatedTokens: schedule.generatedTokens, keyEpoch: offer.keyEpoch });
    if (engine.manifest.profileDigest !== descriptor.parameterSet.digest || engine.manifest.circuit !== descriptor.circuit.identity) {
      throw new Error('engine manifest differs from the advertised descriptor');
    }
    const evaluatorNonce = randomHex(32);
    await send('bind-accept', { offerDigest: await hashJson(offer), evaluatorNonce, heldKeysDigest: engine.manifest.heldKeysDigest || '' });
    binding = await bindingDigest(offer, evaluatorNonce);
    record({ state: 'binding', planId: offer.planId, requester: requester.participantId, keyEpoch: offer.keyEpoch.id, lanes: schedule.lanes });
    const confirm = await receive(['bind-confirm']);
    if (confirm.header.fields.bindingDigest !== binding) throw new Error('requester confirmed a different binding');
    record({ state: 'bound', bindingDigest: binding });

    const keys = await receive(['key', 'keys-held']);
    if (keys.header.kind === 'keys-held') await engine.keysHeld();
    else {
      await engine.sendKey(keys.blobs[0]);
      for (let i = 1; i < engine.keyCount; i++) await engine.sendKey((await receive(['key'])).blobs[0]);
    }
    const keysDigest = await engine.ready();
    await send('ready', { keysDigest });
    let previous = null;
    for (let step = 1; ; step++) {
      const frame = await receive(['step', 'bye']);
      if (frame.header.kind === 'bye') {
        record({ state: 'completed', frames: { ...frames }, bytes: { ...bytes } });
        return { outcome: 'completed', session, bindingDigest: binding, frames, bytes };
      }
      const { fields } = frame.header;
      if (fields.step !== step || fields.lanes !== schedule.lanes || frame.blobs.length !== schedule.lanes * fields.tokensPerLane
        || fields.phase !== (step === 1 ? 'prefill' : 'decode') || step > schedule.generatedTokens) throw new Error('step does not follow the bound schedule');
      const started = now();
      const out = await engine.step({ phase: fields.phase, seq: step, blobs: frame.blobs });
      const computeSeconds = (now() - started) / 1000;
      if (misbehave === 'ask-decrypt') {
        await send('decrypt-request', { step }, [frame.blobs[0]]);
        return { outcome: 'misbehaved' };
      }
      if (misbehave === 'replay-result' && step === 2 && previous) {
        await channel.send(previous);
        continue;
      }
      const sent = await send('result', { step, lanes: schedule.lanes, computeSeconds }, out);
      previous = sent;
      record({ state: 'step', step, computeSeconds, resultDigests: sent.header.blobs.map(blob => blob.digest) });
    }
  } catch (error) {
    try { record({ state: 'failed', reason: String(error.message).slice(0, 256), frames: { ...frames }, bytes: { ...bytes } }); } catch { /* bounded */ }
    return { outcome: 'failed', error: error.message, frames, bytes };
  } finally {
    await engine?.close().catch?.(() => {});
    channel.close();
  }
}

export { REQUESTER_KINDS as PROTECTED_REQUESTER_FRAME_KINDS };
