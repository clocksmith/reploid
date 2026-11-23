#!/usr/bin/env node
/**
 * Builds packages/reploid/src/contracts/requester/vectors.json.
 *
 * Every expected value comes from the real modules: canonical JSON, hashing,
 * identities, signatures, the identity proof, the SDP fingerprint, the execution
 * policy, receipts, the swarm transport and the mesh. Nothing is re-implemented
 * here; this file only chooses inputs and records what the real code returns.
 *
 * The output is deterministic. Keys, nonces, salts, ids and the clock are fixed
 * (scripts/requester-contract/fixed-inputs.js). ECDSA signatures are random by
 * nature, so the ones below were made once and are stored here; the build checks
 * that each still verifies with the real code.
 *
 *   node scripts/build-requester-contract-vectors.js              write vectors.json
 *   node scripts/build-requester-contract-vectors.js --check      fail when vectors.json is stale
 *   node scripts/build-requester-contract-vectors.js --mint-ecdsa print fresh ECDSA signatures to paste below
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { canonicalize } from '../packages/reploid/src/artifacts/canonical-json.js';
import { hashJson, sha256Hex } from '../packages/reploid/src/artifacts/signatures.js';
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  encodeBytes, toBase64Url, fromBase64Url } from '../packages/reploid/src/artifacts/identity.js';
import { fingerprint } from '../packages/reploid/src/transport/sdp-fingerprint.js';
import { createMeshPeerIdentity } from '../packages/reploid/src/mesh/peer-identity.js';
import { createExecutionPolicy, plaintextExecutionRoute, bindExecutionRoute } from '../packages/reploid/src/chat/execution-policy.js';
import { eligibleExecutionOffers } from '../packages/reploid/src/chat/execution-offers.js';
import { createReceiptDraft, getReceiptPayload, canonicalizeReceiptPayload, signReceiptDraft, countersignReceipt, verifyReceipt } from '../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt, matchesWholeModelReceipt } from '../packages/reploid/src/artifacts/whole-model-receipt.js';
import { verifyGenerationTerminal } from '../packages/reploid/src/artifacts/generation-terminal.js';
import { allowsSwarmOrigin, discoveryNamespace, joinIdentityError, discoveryJoinError } from '../server/swarm-protocol.js';
import { FIXED, FIXED_IDENTITIES, fixedIdentity, fixedModel } from './requester-contract/fixed-inputs.js';
import { createScheduler, withDeterministicRuntime, sessionDescription } from './requester-contract/harness.js';
import { captureExchange, probeInboundFrames, probeAdvertisement } from './requester-contract/capture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VECTORS_FILE = path.join(root, 'packages/reploid/src/contracts/requester/vectors.json');

/**
 * Pre-generated ECDSA P-256 signatures by the fixed providerEcdsa test key, base64url of r||s.
 * The build verifies each one with the real code. If a signed message changes, run with
 * --mint-ecdsa and replace the entries it prints.
 */
const ECDSA_SIGNATURES = {
  'signature:empty': '7cP_5nv9R28Q3bz9gkkkUYwfAFlHFSlyNDpQxWdDMkbTVmcdpP1e0gKUP9lstvuzcynGKuNlUqNULZOs9aixww',
  'signature:hello': 'H2Y93OjuYgtyKw8Jvkc7EUpfff1r1P20geiLvjHBCekhgUaoL4ilQJTFgV0Dt-J-Vz_ADx15D3lKms0TAsoiaQ',
  'signature:unicode': 'q_j3fWLctXm-NZ-fpJK-Hv1mUEKygLKhAgUS2QRVc52ic63X_lY9BbuE69oO6PkEigbogph72EAedSIWxNcahA',
  'signature:canonical-json': 'TKVy5hW0BXJWVN0W4UIo3KYg6wzPWvspy5Bx7PN_9aaCRmwdddG1Ih3MU9SGWtJyBHdf-4IkxgDSj5_zVIGMzg',
  'identity-proof': '9-9cQHg2V9wSNqZy595H04J-R8FW2cHOXq5f6tzZfG3CibJwKUw4LW28dbJ5Cvb7vpFqLr29cM5AXkIW0kQ6VA',
  'receipt': 'HrWawDnT8bj_s5JiDhcW55NdxQ0ZEgEZb53rBJ0H8f9lZMm59CMnOPWYoCR43DMcR-SunUoNeT2VG5fV364Ftw'
};

const assert = (condition, message) => { if (!condition) throw new Error(`Vector build: ${message}`); };
const minted = {};
let minting = false;

async function sign(identity, text) {
  const key = await importSigningKey(identity);
  return toBase64Url(await crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, encodeBytes(text)));
}
async function verifies(publicJwk, signature, text) {
  try {
    const key = await importVerificationKey(publicJwk);
    return await crypto.subtle.verify(getIdentitySignAlgorithm(publicJwk), key, fromBase64Url(signature), encodeBytes(text));
  } catch { return false; }
}
/** The stored ECDSA signature for `label`, checked against the message it must cover. */
async function storedEcdsa(label, text) {
  const identity = FIXED_IDENTITIES.providerEcdsa, stored = ECDSA_SIGNATURES[label];
  if (stored && await verifies(identity.publicJwk, stored, text)) return stored;
  if (!minting) throw new Error(`The stored ECDSA signature "${label}" does not verify for its message. Run: node scripts/build-requester-contract-vectors.js --mint-ecdsa`);
  return minted[label] ??= await sign(identity, text);
}

// ------------------------------------------------------------ canonical JSON
const CANONICAL_CASES = [
  ['null', 'null'], ['true', 'true'], ['false', 'false'],
  ['zero', '0'], ['negative zero', '-0', 'JavaScript reads -0 and writes it as 0.'],
  ['integer', '42'], ['negative integer', '-17'], ['integer written with a fraction', '1.0', 'An integer-valued number has no fraction in canonical form.'],
  ['integer written with an exponent', '1E2'], ['one tenth', '0.1'], ['float', '3.14159'], ['negative small float', '-2.5e-10'],
  ['float with rounding noise', '0.30000000000000004'], ['smallest exponent without e-notation', '0.000001'],
  ['first e-notation small number', '1e-7'], ['largest integer without e-notation', '100000000000000000000'],
  ['first e-notation large number', '1e21'], ['large integer past exact range', '123456789012345680000'],
  ['largest exact integer', '9007199254740991'],
  ['integer beyond exact range', '9007199254740993', 'JavaScript reads this as the double 9007199254740992. A language with 64-bit integers must round the same way or refuse the value. The protocol never sends such numbers.'],
  ['large float', '1.5e300'], ['smallest positive double', '5e-324'],
  ['empty string', '""'], ['ascii string', '"hello world"'], ['quote and backslash', '"say \\"hi\\" \\\\ now"'],
  ['solidus is not escaped', '"a/b"'], ['short control escapes', '"\\b\\t\\n\\f\\r"'], ['other control characters', '"\\u0000\\u0001\\u001f"'],
  ['delete character is literal', '"\\u007f"'], ['line and paragraph separators are literal', '"\\u2028\\u2029"'],
  ['latin and cjk text', '"h\\u00e9llo \\u65e5\\u672c\\u8a9e"'], ['character outside the basic plane', '"\\ud800\\udf48 gothic"'],
  ['lone high surrogate', '"\\ud800"', 'Written as the escape \\ud800 with lower-case hex.'], ['lone low surrogate', '"x\\udc00y"'],
  ['empty array', '[]'], ['empty object', '{}'], ['array keeps order', '[3,1,2,"b","a",null,true]'],
  ['nested empty containers', '{"b":[],"a":{}}'],
  ['keys sorted', '{"b":1,"a":2,"c":3}'],
  ['upper case sorts before lower case', '{"a":1,"B":2,"A":3,"b":4,"Z":5,"_":6}'],
  ['prefix sorts first', '{"aa":1,"a":2,"a1":3,"":4}'],
  ['digit keys sort as text', '{"10":"ten","9":"nine","1":"one","01":"zero-one"}'],
  ['keys compare by utf-16 code units', '{"\\uff5e":"fullwidth tilde U+FF5E","\\ud800\\udf48":"U+10348","\\u00e9":"e acute","z":"z"}',
    'U+10348 is the surrogate pair D800 DF48, so it sorts before U+FF5E. Sorting by code point would put it last.'],
  ['key needing escapes', '{"a\\"b":1,"a\\nb":2,"a\\\\b":3}'],
  ['nested objects', '{"outer":{"z":[{"y":1,"x":2}],"a":{"c":null,"b":false}},"list":[{"b":1,"a":[]}]}'],
  ['mixed numbers in an array', '[1,-1,1.5,1e21,1e-7,0,-0,100]'],
  ['prompt commitment shape', '{"schema":"reploid.prompt-commitment/v1","salt":"00","messages":[{"role":"user","content":"hi"}],"settings":null}'],
  ['whitespace in source is dropped', ' { "a" : [ 1 , 2 ] , "b" : "x y" } ']
];

async function canonicalJsonSection() {
  const cases = [];
  for (const [name, jsonText, note] of CANONICAL_CASES) {
    const value = JSON.parse(jsonText);
    cases.push({ name, jsonText, value, canonical: canonicalize(value), hashJson: await hashJson(value), ...(note ? { note } : {}) });
  }
  assert(cases.length >= 25, 'at least 25 canonical JSON cases');
  return { description: 'value is JSON.parse(jsonText). Read jsonText when the exact source number matters (negative zero, exponents). canonical is procedures.canonicalJson(value); hashJson is procedures.sha256Hex hashJson(value).', cases };
}

// ------------------------------------------------------------------ identity
/** The exact text the real createPeerIdFromPublicJwk hashes, observed through its crypto parameter. */
async function peerIdWithInput(publicJwk) {
  const inputs = [];
  const api = { subtle: { digest: (algorithm, data) => { inputs.push(new TextDecoder().decode(data)); return crypto.subtle.digest(algorithm, data); } } };
  const peerId = await createPeerIdFromPublicJwk(publicJwk, api);
  assert(inputs.length === 1, 'one digest per peer id');
  return { peerId, peerIdCanonicalInput: inputs[0] };
}

async function identitySection() {
  const keys = [];
  for (const [name, identity] of Object.entries(FIXED_IDENTITIES)) {
    const derived = await peerIdWithInput(identity.publicJwk);
    assert(derived.peerId === identity.peerId, `${name} peer id`);
    keys.push({ name, algorithm: identity.algorithm, publicJwk: identity.publicJwk, privateJwk: identity.privateJwk, ...derived });
  }
  // What the real key import accepts as a public key on the wire, and the id it gives.
  const ed = FIXED_IDENTITIES.providerEd25519.publicJwk, ec = FIXED_IDENTITIES.providerEcdsa.publicJwk;
  const shapes = [
    ['Ed25519 with only kty, crv, x', { kty: 'OKP', crv: 'Ed25519', x: ed.x }],
    ['Ed25519 as Web Crypto exports it', ed],
    ['Ed25519 with alg EdDSA', { kty: 'OKP', crv: 'Ed25519', x: ed.x, alg: 'EdDSA' }],
    ['Ed25519 with key_ops sign only', { kty: 'OKP', crv: 'Ed25519', x: ed.x, key_ops: ['sign'] }],
    ['Ed25519 carrying the private member d', FIXED_IDENTITIES.providerEd25519.privateJwk],
    ['Ed25519 with a wrong alg', { kty: 'OKP', crv: 'Ed25519', x: ed.x, alg: 'ES256' }],
    ['P-256 with only kty, crv, x, y', { kty: 'EC', crv: 'P-256', x: ec.x, y: ec.y }],
    ['P-256 as Web Crypto exports it', ec],
    ['P-256 with alg ES256', { kty: 'EC', crv: 'P-256', x: ec.x, y: ec.y, alg: 'ES256' }],
    ['P-256 with alg ES384', { kty: 'EC', crv: 'P-256', x: ec.x, y: ec.y, alg: 'ES384' }],
    ['P-256 with key_ops sign only', { kty: 'EC', crv: 'P-256', x: ec.x, y: ec.y, key_ops: ['sign'] }],
    ['Ed25519 with use enc', { kty: 'OKP', crv: 'Ed25519', x: ed.x, use: 'enc' }],
    ['Ed25519 with use sig', { kty: 'OKP', crv: 'Ed25519', x: ed.x, use: 'sig' }],
    ['P-256 without y', { kty: 'EC', crv: 'P-256', x: ec.x }]
  ];
  const publicJwkAcceptance = [];
  for (const [name, publicJwk] of shapes) {
    let importable = true;
    try { await importVerificationKey(publicJwk); } catch { importable = false; }
    publicJwkAcceptance.push({ name, publicJwk, importable, ...(await peerIdWithInput(publicJwk)) });
  }
  return { description: 'TEST KEYS ONLY. peerIdCanonicalInput is the exact text whose SHA-256 gives the peer id (procedures.peerIdFromPublicJwk). publicJwkAcceptance shows which public key shapes the receiving code can import; the peer id ignores every member except kty, crv, x, y, n, e.',
    keys, publicJwkAcceptance };
}

// ---------------------------------------------------------------- signatures
async function signaturesSection() {
  const messages = { empty: '', hello: 'hello', unicode: 'h\u00e9llo \u65e5\u672c\u8a9e \ud800\udf48',
    'canonical-json': canonicalize({ b: [1, 2], a: 'x' }) };
  const cases = [];
  for (const name of ['requesterEd25519', 'providerEd25519']) {
    const identity = FIXED_IDENTITIES[name];
    for (const [label, messageUtf8] of Object.entries(messages)) {
      const signatureBase64url = await sign(identity, messageUtf8);
      assert(signatureBase64url === await sign(identity, messageUtf8), 'Ed25519 signing is deterministic');
      cases.push({ name: `${name} signs ${label}`, key: name, algorithm: 'Ed25519', publicJwk: identity.publicJwk, messageUtf8, signatureBase64url,
        valid: await verifies(identity.publicJwk, signatureBase64url, messageUtf8), deterministic: true });
    }
  }
  const ecdsa = FIXED_IDENTITIES.providerEcdsa;
  for (const [label, messageUtf8] of Object.entries(messages)) {
    const signatureBase64url = await storedEcdsa(`signature:${label}`, messageUtf8);
    cases.push({ name: `providerEcdsa signs ${label}`, key: 'providerEcdsa', algorithm: 'ECDSA', publicJwk: ecdsa.publicJwk, messageUtf8, signatureBase64url,
      valid: await verifies(ecdsa.publicJwk, signatureBase64url, messageUtf8), deterministic: false });
  }
  assert(cases.every(item => item.valid), 'every genuine signature verifies');
  const flip = text => (text[10] === 'A' ? text.slice(0, 10) + 'B' : text.slice(0, 10) + 'A') + text.slice(11);
  const tampered = [];
  const edCase = cases.find(item => item.name === 'providerEd25519 signs hello'), ecCase = cases.find(item => item.name === 'providerEcdsa signs hello');
  const raw = fromBase64Url(ecCase.signatureBase64url);
  const derInteger = bytes => { let body = [...bytes]; while (body.length > 1 && body[0] === 0 && body[1] < 0x80) body.shift(); if (body[0] >= 0x80) body.unshift(0); return [0x02, body.length, ...body]; };
  const der = [...derInteger(raw.subarray(0, 32)), ...derInteger(raw.subarray(32))];
  const variants = [
    ['Ed25519: message changed', edCase, { messageUtf8: 'hellp' }],
    ['Ed25519: signature changed', edCase, { signatureBase64url: flip(edCase.signatureBase64url) }],
    ['Ed25519: signature by the other Ed25519 key', edCase, { publicJwk: FIXED_IDENTITIES.requesterEd25519.publicJwk }],
    ['Ed25519: signature truncated', edCase, { signatureBase64url: edCase.signatureBase64url.slice(0, 60) }],
    ['ECDSA: message changed', ecCase, { messageUtf8: 'hellp' }],
    ['ECDSA: signature changed', ecCase, { signatureBase64url: flip(ecCase.signatureBase64url) }],
    ['ECDSA: signature in DER form instead of r||s', ecCase, { signatureBase64url: toBase64Url(new Uint8Array([0x30, der.length, ...der])) }],
    ['ECDSA: r and s swapped', ecCase, { signatureBase64url: toBase64Url(new Uint8Array([...raw.subarray(32), ...raw.subarray(0, 32)])) }]
  ];
  for (const [name, base, change] of variants) {
    const item = { name, key: base.key, algorithm: base.algorithm, publicJwk: base.publicJwk, messageUtf8: base.messageUtf8, signatureBase64url: base.signatureBase64url, ...change };
    item.valid = await verifies(item.publicJwk, item.signatureBase64url, item.messageUtf8);
    assert(item.valid === false, `${name} must not verify`);
    tampered.push(item);
  }
  return { description: 'The message bytes are UTF-8(messageUtf8). signatureBase64url is base64url without padding of the 64-byte signature. Ed25519 cases are deterministic: a signer in another language must produce the same text. ECDSA cases are fixed examples to verify; a new ECDSA signature of the same message will differ.',
    cases: [...cases, ...tampered] };
}

// ------------------------------------------------------------ identity proof
async function identityProofSection() {
  const scheduler = createScheduler();
  const room = FIXED.roomId, challengerId = FIXED.requesterTransportId, answererId = FIXED.providerTransportId;
  // The challenger's binding; the answerer sees the same two certificates the other way round.
  const challengerBinding = { local: FIXED.requesterFingerprint, remote: FIXED.providerFingerprint };
  const answererBinding = { local: FIXED.providerFingerprint, remote: FIXED.requesterFingerprint };
  const nonces = Array.from({ length: 12 }, (_, index) => `bbbbbbbb-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const signedTexts = [];
  const subtle = crypto.subtle, originalSign = subtle.sign;
  Object.defineProperty(subtle, 'sign', { configurable: true, writable: true, value(algorithm, key, data) {
    signedTexts.push(new TextDecoder().decode(data)); return originalSign.call(subtle, algorithm, key, data); } });
  const party = ({ identity, selfId, remoteId, binding, roomId = room }) => {
    const handlers = new Map(), sent = [];
    const transport = { getPeerId: () => selfId, getPeerBinding: id => id === remoteId ? binding : null,
      getPeerStates: () => [{ id: remoteId, attemptId: 'attempt-1' }], observePeerAuthentication() {},
      sendToPeer: (to, type, payload) => { sent.push({ to, type, payload: structuredClone(payload) }); return true; },
      onMessage: (type, handler) => handlers.set(type, handler) };
    const proofs = createMeshPeerIdentity({ transport, getIdentity: () => identity, roomId, timeoutMs: 60000, maxPending: 8 });
    return { proofs, handlers, sent };
  };
  const flipFirst = text => (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
  try {
    const { value } = await withDeterministicRuntime({ now: FIXED.now, uuids: nonces, randomValues: [], scheduler }, async () => {
      const cases = [], answerCases = [];
      const challenger = party({ identity: fixedIdentity('requesterEd25519'), selfId: challengerId, remoteId: answererId, binding: challengerBinding });
      /** Run one real challenge and hand `makeProof(challenge)` to the real verifier. */
      const judge = async (name, makeProof, note) => {
        const before = challenger.sent.length;
        const outcome = { settled: false, participantId: null, error: null };
        const pending = challenger.proofs.verify(answererId).then(id => { outcome.settled = true; outcome.participantId = id; },
          error => { outcome.settled = true; outcome.error = error.message; });
        await scheduler.settle();
        const challenge = challenger.sent[before].payload;
        const made = await makeProof(challenge);
        challenger.handlers.get('reploid:identity-proof')(answererId, structuredClone(made.proof));
        await scheduler.settle();
        if (!outcome.settled) { challenger.proofs.retirePeer(answererId); await pending; outcome.error = null; }
        const valid = outcome.participantId === made.proof.participantId && outcome.error === null && outcome.participantId !== null;
        cases.push({ name, challenge, participantId: made.proof.participantId, signedBytesUtf8: made.signedBytesUtf8,
          signatureBase64url: made.proof.signature, publicJwk: made.proof.publicJwk, proof: made.proof, valid,
          ...(valid ? {} : { reason: outcome.participantId === null && made.ignored ? 'Ignored: no challenge is pending for this nonce.' : outcome.error }),
          ...(note ? { note } : {}) });
        return valid;
      };
      /** The proof the real answering code sends for `challenge`, and the text it signed. */
      const answerWith = async (identityName, challenge, binding = answererBinding) => {
        const answerer = party({ identity: fixedIdentity(identityName), selfId: challenge.provider, remoteId: challenge.requester, binding, roomId: challenge.roomId });
        const seen = signedTexts.length;
        answerer.handlers.get('reploid:identity-challenge')(challenge.requester, structuredClone(challenge));
        await scheduler.settle();
        answerer.proofs.close();
        return answerer.sent.length ? { proof: answerer.sent[0].payload, signedBytesUtf8: signedTexts[seen] } : null;
      };

      assert(await judge('Ed25519 provider proves itself', challenge => answerWith('providerEd25519', challenge)), 'Ed25519 proof accepted');
      assert(await judge('ECDSA provider proves itself', async challenge => {
        const real = await answerWith('providerEcdsa', challenge);
        // The real answer carries a random signature; the stored one covers the same bytes.
        return { signedBytesUtf8: real.signedBytesUtf8, proof: { ...real.proof, signature: await storedEcdsa('identity-proof', real.signedBytesUtf8) } };
      }, 'ECDSA signing is random. This signature is a stored example over signedBytesUtf8.'), 'ECDSA proof accepted');
      assert(!await judge('signature covers swapped fingerprints', async challenge => {
        // A proof made for the same two certificates but the opposite orientation.
        const swapped = { ...challenge, local: challenge.remote, remote: challenge.local };
        return answerWith('providerEd25519', swapped, { local: swapped.remote, remote: swapped.local });
      }, 'The signer signed local and remote the wrong way round. The verifier signs nothing itself: it checks the bytes built from its own challenge.'), 'swapped orientation refused');
      assert(!await judge('participantId does not match the key', async challenge => {
        const made = await answerWith('providerEd25519', challenge);
        return { ...made, proof: { ...made.proof, participantId: FIXED_IDENTITIES.providerEcdsa.peerId } };
      }), 'identity mismatch refused');
      assert(!await judge('another key under the claimed participantId', async challenge => {
        const made = await answerWith('providerEd25519', challenge);
        return { ...made, proof: { ...made.proof, publicJwk: FIXED_IDENTITIES.requesterEd25519.publicJwk } };
      }), 'substituted key refused');
      assert(!await judge('signature altered', async challenge => {
        const made = await answerWith('providerEd25519', challenge);
        return { ...made, proof: { ...made.proof, signature: flipFirst(made.proof.signature) } };
      }), 'altered signature refused');
      assert(!await judge('proof made for another room', challenge =>
        // Signed by the real answering code of a peer that is in another room, for that room.
        answerWith('providerEd25519', { ...challenge, roomId: 'reploid-swarm-another-room' })), 'other room refused');
      assert(!await judge('proof names another nonce', async challenge => {
        const made = await answerWith('providerEd25519', challenge);
        return { ...made, ignored: true, proof: { ...made.proof, nonce: 'bbbbbbbb-0000-4000-8000-ffffffffffff' } };
      }), 'unknown nonce ignored');
      challenger.proofs.close();

      // Which challenges the real answering side answers at all.
      const good = { roomId: room, nonce: 'cccccccc-0000-4000-8000-000000000001', requester: challengerId, provider: answererId, ...challengerBinding };
      const variants = [
        ['correct challenge', good, true],
        ['fingerprints not mirrored (challenger sent the answerer\'s orientation)', { ...good, local: challengerBinding.remote, remote: challengerBinding.local }, false],
        ['another room', { ...good, roomId: 'reploid-swarm-another-room' }, false],
        ['requester is not the connection it arrived on', { ...good, requester: 'c0ffee00-0000-4000-8000-00000000000f' }, false],
        ['provider is not this peer', { ...good, provider: 'c0ffee00-0000-4000-8000-00000000000f' }, false],
        ['nonce with upper-case hex', { ...good, nonce: good.nonce.toUpperCase() }, false],
        ['nonce too short', { ...good, nonce: 'cccccccc' }, false],
        ['remote fingerprint of another certificate', { ...good, remote: `sha-256 ${Array.from({ length: 32 }, () => 'ff').join(':')}` }, false]
      ];
      for (const [name, challenge, expected] of variants) {
        // The frame arrives on the connection named challengerId, whatever the challenge claims.
        const answerer = party({ identity: fixedIdentity('providerEd25519'), selfId: answererId, remoteId: challengerId, binding: answererBinding });
        answerer.handlers.get('reploid:identity-challenge')(challengerId, structuredClone(challenge));
        await scheduler.settle();
        answerer.proofs.close();
        const answered = answerer.sent.length === 1;
        assert(answered === expected, `answer case "${name}"`);
        answerCases.push({ name, arrivedOnConnection: challengerId, answererConnectionName: answererId, answererRoomId: room, answererBinding, challenge, answered,
          ...(answered ? { proof: answerer.sent[0].payload } : {}) });
      }
      return { cases, answerCases };
    });
    return { description: 'cases: a proof handed to the real verifier for the given challenge. signedBytesUtf8 is the exact text the signer signed (procedures.identityProofSignedBytes); for an invalid case it is what the faulty signer signed, not what the verifier checks. answerCases: whether the real answering side answers a challenge at all (procedures.identityChallengeAnswer); it never sends an error.',
      challengerBinding, answererBinding, ...value };
  } finally { delete subtle.sign; }
}

// ------------------------------------------------------------ SDP fingerprint
function sdpFingerprintSection() {
  const fp = FIXED.providerFingerprint, upper = fp.slice(8).toUpperCase();
  const other = Array.from({ length: 32 }, (_, index) => (index + 1).toString(16).padStart(2, '0')).join(':').toUpperCase();
  const crlf = sessionDescription('offer', fp, 1).sdp;
  const cases = [
    ['data-channel offer with CRLF line ends', crlf],
    ['the same with LF line ends', crlf.replace(/\r\n/g, '\n')],
    ['algorithm label in upper case', `v=0\r\na=fingerprint:SHA-256 ${upper}\r\n`],
    ['attribute name in upper case', `v=0\r\nA=FINGERPRINT:sha-256 ${upper}\r\n`],
    ['fingerprint already lower case with trailing spaces', `v=0\r\na=fingerprint:sha-256 ${upper.toLowerCase()}  \r\n`],
    ['same fingerprint at session and media level', `v=0\r\na=fingerprint:sha-256 ${upper}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${upper}\r\n`],
    ['two different fingerprints', `v=0\r\na=fingerprint:sha-256 ${upper}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${other}\r\n`],
    ['only a sha-1 fingerprint', 'v=0\r\na=fingerprint:sha-1 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB\r\n'],
    ['no fingerprint line', 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n'],
    ['31 byte fingerprint', `v=0\r\na=fingerprint:sha-256 ${upper.slice(0, -3)}\r\n`],
    ['33 byte fingerprint', `v=0\r\na=fingerprint:sha-256 ${upper}:AB\r\n`],
    ['non-hex digits', `v=0\r\na=fingerprint:sha-256 ${upper.replace(/^../, 'ZZ')}\r\n`],
    ['two spaces after the algorithm', `v=0\r\na=fingerprint:sha-256  ${upper}\r\n`],
    ['fingerprint line indented', `v=0\r\n a=fingerprint:sha-256 ${upper}\r\n`],
    ['empty text', '']
  ].map(([name, sdp]) => ({ name, sdp, fingerprint: fingerprint({ type: 'offer', sdp }) }));
  cases.push({ name: 'no description at all', sdp: null, fingerprint: fingerprint(null) });
  assert(cases[0].fingerprint === fp && cases.some(item => item.fingerprint === null), 'fingerprint cases');
  return { description: 'fingerprint is procedures.sdpFingerprint of a description whose sdp member is the given text; null means no usable fingerprint (no binding, so no identity proof).', cases };
}

// ------------------------------------------------------------ privacy binding
async function privacyBindingSection(transcriptAdmit, advertisedOffer) {
  const model = fixedModel();
  const build = async ({ name, modelRow = model, adapterIdentities = [], providerParticipantId, recipients }) => {
    // The same three calls the mesh makes in generate().
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients });
    const request = { model: { id: modelRow.id, identity: modelRow.identity, adapters: adapterIdentities.map(identity => ({ identity })) }, privacy };
    // The offer a real provider advertises, for the model in question.
    const offers = [{ ...structuredClone(advertisedOffer), modelIdentities: [modelRow.identity] }];
    const [offer] = eligibleExecutionOffers(request, offers, [providerParticipantId]).sort((a, b) => a.id.localeCompare(b.id));
    const route = plaintextExecutionRoute(request, { recipients: [providerParticipantId],
      route: { schema: 'reploid.mesh-route/v1', providerId: providerParticipantId, offerId: offer.id, backend: offer.backend } });
    const binding = await bindExecutionRoute(request, route);
    return { name, modelId: modelRow.id, modelIdentity: modelRow.identity, adapterIdentities, providerParticipantId, privacy, route, binding,
      policyCanonical: canonicalize(privacy), routeCanonical: canonicalize(route) };
  };
  const other = structuredClone(catalog.find(row => row.id !== model.id));
  const cases = [
    await build({ name: 'open recipients, Ed25519 provider (the transcript request)', providerParticipantId: FIXED_IDENTITIES.providerEd25519.peerId, recipients: { kind: 'open', ids: [] } }),
    await build({ name: 'open recipients, ECDSA provider', providerParticipantId: FIXED_IDENTITIES.providerEcdsa.peerId, recipients: { kind: 'open', ids: [] } }),
    await build({ name: 'named recipient', providerParticipantId: FIXED_IDENTITIES.providerEd25519.peerId, recipients: { kind: 'named', ids: [FIXED_IDENTITIES.providerEd25519.peerId] } }),
    await build({ name: 'another catalog model', modelRow: other, providerParticipantId: FIXED_IDENTITIES.providerEd25519.peerId, recipients: { kind: 'open', ids: [] } })
  ];
  assert(canonicalize(cases[0].binding) === canonicalize(transcriptAdmit.privacyBinding), 'the first binding is the one the real requester sent');
  for (const item of cases) assert(item.binding.policyId === await hashJson(item.privacy) && item.binding.routeId === await hashJson(item.route), 'binding digests');
  return { description: 'privacy is sent as "privacy" and binding as "privacyBinding". policyId = sha256Hex(policyCanonical); routeId = sha256Hex(routeCanonical).', cases };
}

// --------------------------------------------------------------------- envelope
async function envelopeSection() {
  const from = FIXED.providerTransportId;
  const env = (change = {}, payload = { ts: FIXED.now }) => ({ protocolVersion: 1, type: 'ping', peerId: from, timestamp: 50, payload, payloadSize: JSON.stringify(payload).length, ...change });
  const drop = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };
  const big = 'x'.repeat(2 * 262144);
  const cases = [
    ['ping', JSON.stringify(env())],
    ['sync-request with an empty payload', JSON.stringify(env({ type: 'sync-request' }, {}))],
    ['a known type the requester does not implement', JSON.stringify(env({ type: 'raft:request-vote' }, { term: 1 }))],
    ['extra envelope member', JSON.stringify({ ...env(), extra: true })],
    ['payloadSize missing', JSON.stringify(drop(env(), 'payloadSize'))],
    ['payloadSize smaller than the payload', JSON.stringify(env({ payloadSize: 1 }))],
    ['payloadSize at the limit', JSON.stringify(env({ payloadSize: 262144 }))],
    ['timestamp is a fraction', JSON.stringify(env({ timestamp: 50.5 }))],
    ['payload missing', JSON.stringify(drop(env({ type: 'sync-request' }), 'payload'))],
    ['not JSON', 'ping'],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['JSON string', '"ping"'],
    ['protocolVersion 2', JSON.stringify(env({ protocolVersion: 2 }))],
    ['protocolVersion as text', JSON.stringify(env({ protocolVersion: '1' }))],
    ['protocolVersion missing', JSON.stringify(drop(env(), 'protocolVersion'))],
    ['unknown type', JSON.stringify(env({ type: 'reploid:unknown' }))],
    ['type missing', JSON.stringify(drop(env(), 'type'))],
    ['peerId missing', JSON.stringify(drop(env(), 'peerId'))],
    ['peerId empty', JSON.stringify(env({ peerId: '' }))],
    ['peerId of another peer', JSON.stringify(env({ peerId: 'c0ffee00-0000-4000-8000-00000000000f' }))],
    ['peerId is the receiver\'s own name', JSON.stringify(env({ peerId: FIXED.requesterTransportId }))],
    ['timestamp as text', JSON.stringify(env({ timestamp: '50' }))],
    ['timestamp missing', JSON.stringify(drop(env(), 'timestamp'))],
    ['payloadSize over the limit', JSON.stringify(env({ payloadSize: 262145 }))],
    ['frame longer than twice maxPayloadSize', JSON.stringify(env({}, { pad: big }))]
  ];
  const verdicts = await probeInboundFrames(cases.map(([name, data]) => ({ name, data })));
  const out = cases.map(([name, data], index) => {
    assert(verdicts[index].name === name, 'envelope verdict order');
    const long = data.length > 4096;
    return { name, ...(long ? { frame: null, frameLength: data.length,
      construct: 'JSON text of a valid ping envelope whose payload is {"pad": "<2 * 262144 times the letter x>"}' } : { frame: data }),
    valid: verdicts[index].accepted, ...(verdicts[index].accepted ? {} : { reason: verdicts[index].reason }) };
  });
  assert(out.filter(item => item.valid).length >= 5 && out.filter(item => !item.valid).length >= 10, 'envelope verdict spread');
  return { description: 'frame is one data-channel text message arriving on the connection named receivedFrom. valid is what the real transport does: true = accepted and routed by type, false = dropped silently for reason (procedures.envelopeValidation).',
    receivedFrom: from, receiverConnectionName: FIXED.requesterTransportId, maxPayloadSize: 262144, cases: out };
}

// -------------------------------------------------------------------- ready peer
async function readyPeerSection(baseAdvertisement) {
  const model = fixedModel(), base = structuredClone(baseAdvertisement);
  const without = (object, key) => { const copy = structuredClone(object); delete copy[key]; return copy; };
  const otherDigest = `sha256:${'0'.repeat(64)}`;
  const cases = [
    ['ready provider with a free slot', base, null, 'ready', 'Ready: serves this model, has a free slot, and the channel is open.'],
    ['ready provider with no free slot', { ...base, availableSlots: 0 }, null, 'busy', 'Busy: availableSlots is 0.'],
    ['provider still loading the model', { ...base, readiness: 'loading', availableSlots: 0 }, null, 'loading', 'Not ready: readiness is "loading".'],
    ['provider reports readiness executing', { ...base, readiness: 'executing' }, null, 'unavailable', 'Not ready: readiness is not "ready".'],
    ['unknown readiness value', { ...base, readiness: 'warming-up' }, null, 'unavailable', 'Not ready: an unknown readiness is stored as "unavailable".'],
    ['no admission protocol', without(base, 'admissionProtocol'), null, 'unavailable', 'Not usable: the provider does not answer reploid:generation-admit.'],
    ['admission protocol 1', { ...base, admissionProtocol: 1 }, null, 'unavailable', 'Not usable: only admissionProtocol 2 counts.'],
    ['no identity protocol', without(base, 'identityProtocol'), null, 'unavailable', 'Not usable: the provider cannot prove an identity.'],
    ['serves another model id', { ...base, model: 'another-model' }, null, 'unavailable', 'Not compatible: model differs from the catalog row.'],
    ['serves another model identity', { ...base, modelIdentity: otherDigest, executionOffers: [{ ...base.executionOffers[0], modelIdentities: [otherDigest] }] }, null, 'unavailable', 'Not compatible: modelIdentity differs from the catalog row.'],
    ['says ready without a model', { ...base, hasInference: false, role: 'consumer' }, null, 'unavailable', 'Not a provider: hasInference is false.'],
    ['no execution offers', { ...base, executionOffers: [] }, null, 'ready', 'Shown as ready by the catalog rule, but no offer is eligible, so the mesh never selects it for a request (eligibleOfferIds is empty).'],
    ['advertisement without updatedAt', without(base, 'updatedAt'), null, 'unavailable', 'Dropped: updatedAt is not a finite number, so nothing is stored.'],
    ['malformed adapter list', { ...base, adapterIdentities: ['not-a-digest'] }, null, 'unavailable', 'Dropped: adapterIdentities is malformed, so nothing is stored.'],
    ['channel closing', base, { channelState: 'closing' }, 'unavailable', 'Not reachable: the data channel is not open.'],
    ['ice disconnected', base, { iceState: 'disconnected' }, 'unavailable', 'Not reachable: ICE is disconnected.'],
    ['advertisement from an earlier connection attempt', base, { attemptId: 'an-earlier-attempt' }, 'unavailable', 'Not reachable: the stored advertisement belongs to another connection attempt.']
  ];
  const out = [];
  for (const [name, advertisement, connectionOverrides, expected, reason] of cases) {
    const probed = await probeAdvertisement(advertisement, { connectionOverrides });
    assert(probed.availability === expected, `ready peer case "${name}" gave ${probed.availability}`);
    let eligibleOfferIds = [];
    if (probed.storedPeer) {
      try {
        eligibleOfferIds = eligibleExecutionOffers({ model: { id: model.id, identity: model.identity },
          privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) },
        probed.storedPeer.executionOffers ?? [], [probed.storedPeer.peerId]).map(offer => offer.id);
      } catch { eligibleOfferIds = []; }
    }
    out.push({ name, advertisement, connection: probed.connection, stored: probed.storedPeer !== null,
      result: { ready: probed.availability === 'ready', busy: probed.availability === 'busy', availability: probed.availability,
        providerIds: probed.providerIds, reachableProviderIds: probed.reachableProviderIds, eligibleOfferIds,
        selectableForRequest: probed.availability === 'ready' && eligibleOfferIds.length > 0 },
      reason });
  }
  return { description: 'advertisement arrives on an open connection named providerConnectionName; connection is that connection\'s state. result is the real catalog projection for catalogRow (procedures.readyPeerRule): ready and busy follow availability. eligibleOfferIds is the real offer filter for an open-recipients request; selectableForRequest needs both.',
    providerConnectionName: FIXED.providerTransportId, catalogRow: { id: model.id, identity: model.identity, name: model.name }, cases: out };
}

// --------------------------------------------------------------------- signaling
function signalingSection(captured) {
  const origins = ['https://replo.id', 'https://reploid.web.app', 'http://localhost:8000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'https://localhost', 'http://[::1]:8000',
    'https://replo.id/', 'https://example.com', 'http://localhost.example.com', 'http://192.0.2.10:8000', 'capacitor://localhost', 'file://', 'null', '']
    .map(origin => ({ origin, allowed: allowsSwarmOrigin(origin, bootstrap) }));
  origins.push({ origin: null, allowed: allowsSwarmOrigin(undefined, bootstrap), note: 'No Origin header.' });
  const queries = ['scope=public', `scope=public&roomId=${bootstrap.publicRoomId}`, 'scope=private&roomId=reploid-swarm-my-room', 'scope=private', '',
    'scope=public&roomId=reploid-swarm-my-room', `scope=private&roomId=${bootstrap.publicRoomId}`, 'scope=private&roomId=my-room', 'scope=other&roomId=reploid-swarm-my-room']
    .map(query => ({ query, namespace: discoveryNamespace(new URLSearchParams(query), bootstrap) }));
  const privateRoom = 'reploid-swarm-my-room', token = 'a-private-room-capability-of-32-chars-or-more';
  const joins = [
    ['public join', { scope: 'public', roomId: bootstrap.publicRoomId }, { peerId: FIXED.requesterTransportId, roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }],
    ['private join', { scope: 'private', roomId: privateRoom }, { peerId: FIXED.requesterTransportId, roomId: privateRoom, token }],
    ['public scope with a private room', { scope: 'public', roomId: bootstrap.publicRoomId }, { peerId: FIXED.requesterTransportId, roomId: privateRoom, token }],
    ['private scope with the public token', { scope: 'private', roomId: privateRoom }, { peerId: FIXED.requesterTransportId, roomId: privateRoom, token: bootstrap.publicJoinMarker }],
    ['join names another room than the URL', { scope: 'private', roomId: privateRoom }, { peerId: FIXED.requesterTransportId, roomId: 'reploid-swarm-other', token }],
    ['token too short', { scope: 'private', roomId: privateRoom }, { peerId: FIXED.requesterTransportId, roomId: privateRoom, token: 'short' }],
    ['peerId with a colon', { scope: 'private', roomId: privateRoom }, { peerId: 'peer:97fc1d680c3eebc54160106e', roomId: privateRoom, token }],
    ['peerId too short', { scope: 'private', roomId: privateRoom }, { peerId: 'ab', roomId: privateRoom, token }],
    ['roomId without the prefix', { scope: 'private', roomId: privateRoom }, { peerId: FIXED.requesterTransportId, roomId: 'my-room', token }],
    ['peerId missing', { scope: 'private', roomId: privateRoom }, { roomId: privateRoom, token }]
  ].map(([name, namespace, join]) => ({ name, urlNamespace: namespace, join: { type: 'join', ...join, metadata: { capabilities: [] } },
    error: joinIdentityError(join) || discoveryJoinError(namespace, join, bootstrap) }));
  return { description: 'origins: whether the upgrade accepts an Origin header. queries: the URL query read as a namespace, null = HTTP 400. joins: the error text a join frame gets, null = accepted (the room token is then compared with the room\'s first token). frames: the signaling frames of the transcript exchange, in order, as the two clients and the local Node server exchanged them; the hosted service adds a timestamp member to every server frame and never forwards join metadata.',
    publicUrl: `${bootstrap.signalingUrl}?scope=public&roomId=${bootstrap.publicRoomId}`,
    origins, queries, joins, frames: captured.signaling };
}

// ------------------------------------------------------------------- receipts
async function rewriteResult({ from, data }, mutate, { dropUsage = false } = {}) {
  if (from !== 'provider') return data;
  const envelope = JSON.parse(data);
  if (dropUsage && envelope.type === 'reploid:generation-update' && envelope.payload.usage) return null;
  if (envelope.type !== 'reploid:generation-result') return data;
  envelope.payload = await mutate(structuredClone(envelope.payload));
  envelope.payloadSize = JSON.stringify(envelope.payload).length;
  return JSON.stringify(envelope);
}

async function receiptSection(complete) {
  const provider = FIXED_IDENTITIES.providerEd25519, requester = FIXED_IDENTITIES.requesterEd25519, ecdsa = FIXED_IDENTITIES.providerEcdsa;
  const resultFrame = complete.frames.find(frame => frame.envelope.type === 'reploid:generation-result').envelope.payload;
  const receiptFrame = complete.frames.find(frame => frame.envelope.type === 'reploid:receipt').envelope.payload;
  const messages = complete.inputs.messages, requestId = complete.inputs.requestId;
  const describe = async (name, receipt, response, extra = {}) => {
    const verified = await verifyReceipt(receipt);
    return { name, requestId, consumer: requester.peerId, provenProviderId: receipt.provider, messages, content: response.content, response, receipt,
      payload: getReceiptPayload(receipt), payloadCanonical: canonicalizeReceiptPayload(receipt),
      inputDigestInput: canonicalize(messages), valid: verified.providerValid && await matchesWholeModelReceipt(receipt, messages, response), ...extra };
  };
  const valid = [await describe('Ed25519 provider, from the transcript', resultFrame.receipt, resultFrame.response)];

  // An ECDSA provider: the same real calls the provider makes, with the stored signature in place of a random one.
  const response = structuredClone(resultFrame.response);
  const measured = await measureWholeModelReceipt(messages, response);
  const draft = await createReceiptDraft({ provider: ecdsa.peerId, consumer: requester.peerId, jobHash: `request:${requestId}`, model: response.model,
    inputTokens: 0, outputTokens: 0, status: 'unmetered', timestamp: FIXED.now, ...measured });
  const shape = await signReceiptDraft(draft, ecdsa);
  const ecdsaReceipt = { ...getReceiptPayload(draft), providerSignature: await storedEcdsa('receipt', canonicalizeReceiptPayload(draft)), providerKey: ecdsa.publicJwk };
  assert(canonicalize(Object.keys(shape)) === canonicalize(Object.keys(ecdsaReceipt)), 'stored ECDSA receipt has the shape signReceiptDraft gives');
  valid.push(await describe('ECDSA provider, stored signature', ecdsaReceipt, response, { note: 'The provider signature is a stored example; ECDSA signing is random.' }));
  assert(valid.every(item => item.valid), 'valid receipts verify');

  const countersigned = [];
  for (const item of valid) {
    const receipt = await countersignReceipt(item.receipt, requester);
    const verified = await verifyReceipt(receipt);
    assert(verified.valid && verified.consumerValid, 'countersigned receipt verifies');
    countersigned.push({ name: item.name, receipt, consumerKeyName: 'requesterEd25519', consumerSignatureInput: item.payloadCanonical,
      memberOrder: Object.keys(receipt), valid: true });
  }
  assert(canonicalize(countersigned[0].receipt) === canonicalize(receiptFrame.receipt), 'countersigned receipt equals the one the real requester sent');
  assert(countersigned[0].receipt.consumerSignature === receiptFrame.receipt.consumerSignature, 'Ed25519 countersignature is reproducible');

  // What the real requester does with a result that was changed on the way.
  const resign = async (receipt, change, identity = provider) => {
    const next = { ...receipt, ...change };
    delete next.providerSignature; delete next.providerKey;
    return signReceiptDraft(next, identity);
  };
  const flip = text => (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
  const variants = [
    ['answer text replaced in transit', payload => { payload.response.content = 'The capital of France is Lyon.'; return payload; }],
    ['provider signature altered', payload => { payload.receipt.providerSignature = flip(payload.receipt.providerSignature); return payload; }],
    ['receipt for another request, signed by the provider', async payload => { payload.receipt = await resign(payload.receipt, { jobHash: 'request:another-request' }); return payload; }],
    ['receipt names another consumer, signed by the provider', async payload => { payload.receipt = await resign(payload.receipt, { consumer: ecdsa.peerId }); return payload; }],
    ['receipt signed by an identity that is not the proven provider', async payload => {
      payload.receipt = await resign(payload.receipt, { provider: requester.peerId }, requester); return payload; }],
    ['provider key does not hash to the provider id', async payload => {
      payload.receipt = { ...(await resign(payload.receipt, {}, requester)), provider: provider.peerId }; return payload; }],
    ['receipt reports another input token count than the early usage update', async payload => { payload.receipt = await resign(payload.receipt, { inputTokens: 10 }); return payload; }],
    ['receipt reports another output token count than the completion', async payload => { payload.receipt = await resign(payload.receipt, { outputTokens: 8 }); return payload; }],
    ['receipt names another stop reason than the completion', async payload => { payload.receipt = await resign(payload.receipt, { stopReason: 'max-tokens' }); return payload; }],
    ['response names another model', payload => { payload.response.model = 'another-model'; return payload; }],
    ['version 3 receipt for a request without settings', async payload => {
      payload.receipt = await resign(payload.receipt, { version: 3, settingsDigest: `sha256:${'1'.repeat(64)}` }); return payload; }],
    ['completion removed and receipt replaced by an unmetered version 1 receipt', async payload => {
      delete payload.response.completion;
      const { receipt } = payload;
      payload.receipt = await signReceiptDraft(await createReceiptDraft({ provider: receipt.provider, consumer: receipt.consumer, jobHash: receipt.jobHash,
        model: receipt.model, inputTokens: 0, outputTokens: 0, status: 'unmetered', timestamp: receipt.timestamp }), provider);
      return payload;
    }, 'The early usage update was removed too. The JavaScript mesh accepts and countersigns this legacy receipt; server/whole-model-requester.js then refuses the result. A new client refuses it before countersigning.', { dropUsage: true }]
  ];
  const invalid = [];
  for (const [name, mutate, note, options = {}] of variants) {
    const captured = await captureExchange({ transform: frame => rewriteResult(frame, mutate, options) });
    const delivered = captured.frames.find(frame => frame.envelope.type === 'reploid:generation-result').envelope.payload;
    assert(captured.error && !captured.result, `receipt variant "${name}" must be refused by the real requester`);
    invalid.push({ name, requestId, consumer: requester.peerId, provenProviderId: provider.peerId, messages,
      earlyInputTokens: options.dropUsage ? null : FIXED.completion.promptTokenCount,
      response: delivered.response, receipt: delivered.receipt, valid: false, reason: captured.error.message,
      requesterSentReceipt: captured.frames.some(frame => frame.envelope.type === 'reploid:receipt'), ...(note ? { note } : {}) });
  }
  // A result the JavaScript requester still accepts although it carries no receipt.
  const bare = await captureExchange({ transform: frame => rewriteResult(frame, payload => { delete payload.receipt; return payload; }) });
  const acceptedWithoutReceipt = { name: 'receipt removed in transit', javascriptAccepts: bare.error === null,
    requesterSentReceipt: bare.frames.some(frame => frame.envelope.type === 'reploid:receipt'),
    contractRule: 'refuse: a version 2 receipt is required (procedures.receiptVerification step 5)',
    note: 'The JavaScript mesh accepts a result without a receipt when no model contract and no settings are in force. The contract requires a new client to refuse it.' };
  return { description: 'valid: receipts that pass procedures.receiptVerification for requestId, consumer, provenProviderId, messages and response. payloadCanonical is the exact signed text. invalid: results the real requester refuses, with its own error text as reason; each is the complete result payload as delivered. countersigned: the receipt the requester sends back.',
    signedPayloadFields: Object.keys(getReceiptPayload(resultFrame.receipt)), valid, countersigned, invalid, javascriptLeniency: [acceptedWithoutReceipt] };
}

// ------------------------------------------------------------------ transcript
function transcriptSection(complete) {
  const challenges = complete.frames.filter(frame => frame.envelope.type === 'reploid:identity-challenge');
  const purpose = ['requester proves the provider in the background (after its advertisement)', 'provider proves the requester in the background (after its advertisement)',
    'requester proves the provider immediately before the request', 'provider proves the requester again after the request (contextId and recoverable are present)'];
  assert(challenges.length === 4 && complete.inputs.uuidsInOrder.length === 4, 'four identity challenges in the transcript');
  const result = complete.frames.find(frame => frame.envelope.type === 'reploid:generation-result').envelope.payload;
  const receipt = complete.frames.find(frame => frame.envelope.type === 'reploid:receipt').envelope.payload.receipt;
  return {
    description: 'One complete whole-model request between the real JavaScript requester (server/whole-model-requester.js over the mesh and the swarm transport) and the real provider protocol code, in one process, with fixed keys, clock, nonces and salt. frames are the data-channel messages in the order they were sent; the text of each message is the JSON text of envelope with its members in the order shown and no white space. A requester that receives the provider frames in this order and uses the fixed inputs can reproduce every requester frame byte for byte.',
    inputs: {
      ...complete.inputs,
      signalingQuery: `scope=private&roomId=${complete.inputs.roomId}`,
      uuidPurposes: complete.inputs.uuidsInOrder.map((uuid, index) => ({ uuid, usedAs: 'identity-challenge nonce', by: challenges[index].direction.split('->')[0], purpose: purpose[index] })),
      privacy: complete.privacy,
      sessionDescriptions: {
        note: 'Stand-in descriptions: only the a=fingerprint line is read by the protocol. A real client takes its fingerprints from its own WebRTC stack.',
        requesterOffer: complete.signaling.find(item => item.frame.type === 'offer').frame.offer,
        providerAnswer: complete.signaling.find(item => item.frame.type === 'answer').frame.answer
      },
      requesterAdvertisementNote: 'The JavaScript requester advertises itself as a consumer (the first requester frame). observationSession is "node:" + participantId and observationSequence starts at 2 here because one advertisement was attempted before the channel opened.',
      dataChannel: complete.dataChannels.requesterCreated[0]
    },
    frames: complete.frames,
    keepalive: { note: 'Sent after the exchange by calling the transport\'s send with the same payload its heartbeat timer uses; the pong is the real answer.', frames: complete.keepalive },
    final: { content: result.response.content, usage: complete.result.usage, completion: result.response.completion, countersignedReceipt: receipt,
      requesterResult: complete.result },
    requesterApproval: complete.observed.approvals[0],
    nondeterministicFields: []
  };
}

function scenarioSection(captures) {
  const describe = {
    decline: 'The provider host refuses admission. The prompt is never sent.',
    'provider-failure': 'The model fails after one chunk. The request is recoverable, so the error carries signed terminal evidence with status "failed".',
    cancel: 'The requester stops after the first chunk. One more chunk was already on its way. The provider answers with terminal status "cancelled"; the requester has already settled and ignores it.',
    recovery: 'A completed request is read back with reploid:generation-recover. frames is the original exchange and recovery the query that follows.',
    direct: 'The smallest request: no contextId and not recoverable (the mesh called without a conversation key). The provider asks for no second identity proof.'
  };
  return { description: 'Further exchanges captured the same way as the transcript, with the same fixed inputs. outcome.error is what the real requester reports.',
    cases: Object.entries(captures).map(([name, captured]) => ({ name, description: describe[name], frames: captured.frames,
      ...(captured.recovery.length ? { recovery: captured.recovery } : {}),
      outcome: { error: captured.error, content: captured.result?.content ?? captured.recovered?.result?.content ?? null,
        ...(captured.recovered ? { recovered: { status: captured.recovered.status } } : {}),
        promptReachedProvider: captured.providerCalls.length > 0 },
      uuidsInOrder: captured.inputs.uuidsInOrder })) };
}

// ----------------------------------------------------------------------- build
export async function buildVectors() {
  const complete = await captureExchange();
  assert(complete.error === null && complete.result.content === FIXED.answerChunks.join(''), 'the transcript request completes');
  const captures = {};
  for (const scenario of ['decline', 'provider-failure', 'cancel', 'recovery']) captures[scenario] = await captureExchange({ scenario });
  captures.direct = await captureExchange({ direct: true });
  assert(captures.decline.providerCalls.length === 0 && /declined/.test(captures.decline.error.message), 'decline scenario');
  assert(captures['provider-failure'].error.generationTerminal?.status === 'failed', 'provider-failure scenario carries a verified terminal');
  assert(captures.cancel.error && captures.cancel.frames.some(frame => frame.envelope.type === 'reploid:generation-cancel'), 'cancel scenario');
  assert(captures.recovery.recovered?.status === 'completed', 'recovery scenario');
  assert(captures.direct.error === null && captures.direct.result.content === complete.result.content, 'direct scenario');
  const terminalFrame = captures['provider-failure'].frames.find(frame => frame.envelope.type === 'reploid:generation-error').envelope.payload;

  const payloadOf = (captured, type) => captured.frames.find(frame => frame.envelope.type === type).envelope.payload;
  const admit = payloadOf(complete, 'reploid:generation-admit'), request = payloadOf(complete, 'reploid:generation-request');

  // Prompt commitments: each from a real request with other messages and another salt.
  const commitmentInputs = [
    { name: 'the transcript request', messages: FIXED.messages, saltBytes: FIXED.saltBytes, captured: complete },
    { name: 'system and several turns', saltBytes: Array.from({ length: 32 }, (_, index) => 255 - index),
      messages: [{ role: 'system', content: 'Answer in one sentence.' }, { role: 'user', content: 'Name a prime.' }, { role: 'assistant', content: '7' }, { role: 'user', content: 'Another?' }] },
    { name: 'text with quotes, line breaks and non-ASCII characters', saltBytes: Array.from({ length: 32 }, (_, index) => (index * 7 + 3) % 256),
      messages: [{ role: 'user', content: 'She said "caf\u00e9"\n\tthen \u65e5\u672c\u8a9e \ud800\udf48 \\ end' }] },
    { name: 'message members in another order and an empty text', saltBytes: Array.from({ length: 32 }, () => 0xab),
      messages: [{ content: '', role: 'user' }, { content: 'x', role: 'user' }] }
  ];
  const promptCommitment = [];
  for (const input of commitmentInputs) {
    const captured = input.captured ?? await captureExchange({ messages: input.messages, saltBytes: input.saltBytes });
    assert(captured.error === null, `prompt commitment case "${input.name}" completes`);
    const sentRequest = payloadOf(captured, 'reploid:generation-request'), sentAdmit = payloadOf(captured, 'reploid:generation-admit');
    const commitmentInput = { schema: 'reploid.prompt-commitment/v1', salt: sentRequest.admission.salt, messages: sentRequest.messages, settings: null };
    assert(await hashJson(commitmentInput) === sentAdmit.promptCommitment, `prompt commitment case "${input.name}" matches the documented input`);
    promptCommitment.push({ name: input.name, salt: sentRequest.admission.salt, messages: input.messages, settings: null,
      commitmentInputCanonical: canonicalize(commitmentInput), commitment: sentAdmit.promptCommitment });
  }

  const vectors = {
    schema: 'reploid.requester-contract-vectors/v1',
    generatedBy: 'scripts/build-requester-contract-vectors.js',
    notice: 'Generated from the real JavaScript modules. Do not edit. The keys in this file are test keys.',
    canonicalJson: await canonicalJsonSection(),
    identity: await identitySection(),
    signatures: await signaturesSection(),
    identityProof: await identityProofSection(),
    sdpFingerprint: sdpFingerprintSection(),
    promptCommitment: { description: 'commitment = sha256Hex(commitmentInputCanonical). Each case was sent by the real requester with that salt and those messages.', cases: promptCommitment },
    privacyBinding: await privacyBindingSection(admit, payloadOf(complete, 'reploid:peer-advertisement').executionOffers[0]),
    admit: { description: 'request is the reploid:generation-request payload; admitPayload is the reploid:generation-admit payload sent before it (procedures.admitPayloadFromRequest).',
      cases: [
        { name: 'with contextId and recoverable (server/whole-model-requester.js)', request, admitPayload: admit },
        { name: 'smallest request (no contextId, not recoverable)', request: payloadOf(captures.direct, 'reploid:generation-request'), admitPayload: payloadOf(captures.direct, 'reploid:generation-admit') }
      ] },
    receipt: await receiptSection(complete),
    generationTerminal: {
      description: 'Terminal evidence from the provider-failure scenario. signedCanonical is the exact signed text. binding is what the requester compares it with (procedures.generationTerminalVerification).',
      terminal: terminalFrame.terminal,
      signedCanonical: null,
      binding: { requestId: FIXED.requestId, provider: FIXED_IDENTITIES.providerEd25519.peerId, consumer: FIXED_IDENTITIES.requesterEd25519.peerId,
        model: fixedModel().id, modelIdentity: fixedModel().identity, adapterIdentities: [], inputDigest: await hashJson(FIXED.messages) },
      valid: true
    },
    envelope: await envelopeSection(),
    readyPeer: await readyPeerSection(complete.frames.find(frame => frame.direction === 'provider->requester' && frame.envelope.type === 'reploid:peer-advertisement').envelope.payload),
    signaling: signalingSection(complete),
    transcript: transcriptSection(complete),
    scenarios: scenarioSection(captures)
  };
  // The text the real verifier checks the signature over, observed at crypto.subtle.verify.
  const subtle = crypto.subtle, originalVerify = subtle.verify, verifiedTexts = [];
  Object.defineProperty(subtle, 'verify', { configurable: true, writable: true, value(algorithm, key, signature, data) {
    verifiedTexts.push(new TextDecoder().decode(data)); return originalVerify.call(subtle, algorithm, key, signature, data); } });
  try { assert(await verifyGenerationTerminal(vectors.generationTerminal.terminal, vectors.generationTerminal.binding), 'terminal evidence verifies against its binding'); }
  finally { delete subtle.verify; }
  assert(verifiedTexts.length === 1, 'one signature check per terminal');
  vectors.generationTerminal.signedCanonical = verifiedTexts[0];
  return vectors;
}

/** The exact bytes of vectors.json: two-space JSON, ASCII only, one trailing newline. */
export async function buildVectorsText() {
  const text = JSON.stringify(await buildVectors(), null, 2);
  return text.replace(/[\u007f-\uffff]/g, unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`) + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--mint-ecdsa'].includes(arg))) throw new Error('Usage: build-requester-contract-vectors.js [--check | --mint-ecdsa]');
  if (args.includes('--mint-ecdsa')) {
    minting = true;
    await buildVectors();
    console.log(Object.keys(minted).length ? `Replace these ECDSA_SIGNATURES entries:\n${JSON.stringify(minted, null, 2)}` : 'Every stored ECDSA signature still verifies.');
  } else {
    const text = await buildVectorsText();
    if (args.includes('--check')) {
      const current = await fs.readFile(VECTORS_FILE, 'utf8').catch(() => null);
      if (current !== text) { console.error('vectors.json is stale. Run: npm run build:requester-vectors'); process.exitCode = 1; }
      else console.log('vectors.json is current.');
    } else {
      await fs.writeFile(VECTORS_FILE, text);
      console.log(`Wrote ${path.relative(root, VECTORS_FILE)} (${Buffer.byteLength(text)} bytes).`);
    }
  }
}
