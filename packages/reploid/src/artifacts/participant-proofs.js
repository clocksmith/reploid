/**
 * @fileoverview Host-neutral participant identity proofs.
 *
 * A device's persistent participant identity (the Ed25519 or ECDSA P-256
 * bundle browser and native hosts already keep) signs domain-separated
 * canonical statements: device registration proofs and session bindings here, custody-key
 * certificates in custody-certificate.js. WebCrypto only, so browser and
 * native hosts can sign with the same code the server verifies with.
 */

import { canonicalize } from './canonical-json.js';
import {
  createPeerIdFromPublicJwk,
  encodeBytes,
  fromBase64Url,
  getIdentitySignAlgorithm,
  importSigningKey,
  importVerificationKey,
  toBase64Url
} from './identity.js';

export const REGISTRATION_PROOF_SCHEMA = 'reploid.device-registration-proof/v1';
export const SESSION_BINDING_SCHEMA = 'reploid.device-session-binding/v1';
export const DEVICE_HOSTS = Object.freeze(['browser', 'native']);

const PROOF_KEYS = Object.freeze(['schema', 'challengeId', 'nonce', 'accountId', 'audience', 'participantId', 'publicJwk', 'host', 'signature']);
const SESSION_BINDING_KEYS = Object.freeze(['schema', 'challengeId', 'nonce', 'accountId', 'sessionId', 'participantId', 'signature']);
const COORDINATE = /^[A-Za-z0-9_-]{16,128}$/;

const sameKeys = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/**
 * The public half of a participant identity: an Ed25519 or ECDSA P-256 JWK
 * reduced to its coordinates. Returns null for anything else, including a
 * JWK carrying private key material.
 */
export function normalizeParticipantPublicKey(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || Object.hasOwn(jwk, 'd')) return null;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && COORDINATE.test(jwk.x ?? '') && jwk.y === undefined) {
    return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && COORDINATE.test(jwk.x ?? '') && COORDINATE.test(jwk.y ?? '')) {
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }
  return null;
}

/** The participant id every host derives from its identity public key. */
export const participantIdFor = (publicJwk) => createPeerIdFromPublicJwk(publicJwk);

const signedBytes = (domain, body) => encodeBytes(canonicalize({ signatureDomain: domain, payload: body }));

/** Sign `body` under `domain` with a participant identity bundle ({ publicJwk, privateJwk, algorithm? }). */
export async function signAsParticipant(identity, domain, body) {
  const key = await importSigningKey(identity);
  return toBase64Url(await crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, signedBytes(domain, body)));
}

/** Verify a participant signature; malformed keys or signatures fail closed. */
export async function verifyParticipantSignature(publicJwk, domain, body, signature) {
  if (typeof signature !== 'string' || signature.length === 0 || signature.length > 256) return false;
  try {
    const key = await importVerificationKey(publicJwk);
    return await crypto.subtle.verify(getIdentitySignAlgorithm(publicJwk), key, fromBase64Url(signature), signedBytes(domain, body));
  } catch {
    return false;
  }
}

/** The statement a device signs to answer one registration challenge. */
export const registrationProofBody = ({ challenge, participantId, publicJwk, host }) => ({
  schema: REGISTRATION_PROOF_SCHEMA,
  challengeId: challenge.challengeId,
  nonce: challenge.nonce,
  accountId: challenge.accountId,
  audience: challenge.audience,
  participantId,
  publicJwk,
  host
});

/** Device side: answer a server registration challenge with the persistent participant identity. */
export async function createDeviceRegistrationProof({ identity, challenge, host }) {
  const publicJwk = normalizeParticipantPublicKey(identity?.publicJwk);
  if (!publicJwk || !identity.privateJwk) throw new TypeError('A persistent participant signing identity is required');
  if (!DEVICE_HOSTS.includes(host)) throw new TypeError(`host must be one of ${DEVICE_HOSTS.join(', ')}`);
  const body = registrationProofBody({ challenge, participantId: await participantIdFor(publicJwk), publicJwk, host });
  return { ...body, signature: await signAsParticipant(identity, REGISTRATION_PROOF_SCHEMA, body) };
}

/**
 * The statement a device signs to make the session that asked for
 * `challenge` act as that device. Only a host holding that session signs it;
 * a device registered from another session's challenge signs only the proof.
 */
export const sessionBindingBody = ({ challenge, participantId }) => ({
  schema: SESSION_BINDING_SCHEMA,
  challengeId: challenge.challengeId,
  nonce: challenge.nonce,
  accountId: challenge.accountId,
  sessionId: challenge.sessionId,
  participantId
});

/** Device side: bind the challenge's session to this persistent participant identity. */
export async function createSessionBinding({ identity, challenge }) {
  const publicJwk = normalizeParticipantPublicKey(identity?.publicJwk);
  if (!publicJwk || !identity.privateJwk) throw new TypeError('A persistent participant signing identity is required');
  if (typeof challenge?.sessionId !== 'string' || challenge.sessionId.length === 0) throw new TypeError('The challenge must name its session');
  const body = sessionBindingBody({ challenge, participantId: await participantIdFor(publicJwk) });
  return { ...body, signature: await signAsParticipant(identity, SESSION_BINDING_SCHEMA, body) };
}

/** Whether `binding` is `publicJwk`'s signed statement binding `challenge.sessionId` to it. */
export async function checkSessionBinding(binding, { publicJwk, challenge }) {
  if (!sameKeys(binding, SESSION_BINDING_KEYS) || binding.schema !== SESSION_BINDING_SCHEMA) return false;
  const participantId = await participantIdFor(publicJwk);
  const { signature, ...body } = binding;
  const expected = sessionBindingBody({ challenge, participantId });
  if (Object.keys(expected).some((key) => body[key] !== expected[key])) return false;
  return verifyParticipantSignature(publicJwk, SESSION_BINDING_SCHEMA, body, signature);
}

/**
 * Check a registration proof's form, key-to-participant binding and
 * signature. Challenge freshness and ownership are the store's checks.
 * Returns { problem, publicJwk, participantId }; problem is null when valid.
 */
export async function checkDeviceRegistrationProof(proof) {
  if (!sameKeys(proof, PROOF_KEYS) || proof.schema !== REGISTRATION_PROOF_SCHEMA) return { problem: 'proof_malformed' };
  const publicJwk = normalizeParticipantPublicKey(proof.publicJwk);
  if (!publicJwk || !sameKeys(proof.publicJwk, Object.keys(publicJwk))) return { problem: 'proof_malformed' };
  if (!DEVICE_HOSTS.includes(proof.host)) return { problem: 'proof_malformed' };
  for (const key of ['challengeId', 'nonce', 'accountId', 'audience', 'participantId']) {
    if (typeof proof[key] !== 'string' || proof[key].length === 0 || proof[key].length > 256) return { problem: 'proof_malformed' };
  }
  const participantId = await participantIdFor(publicJwk);
  if (participantId !== proof.participantId) return { problem: 'participant_key_mismatch' };
  const { signature, ...body } = proof;
  if (!await verifyParticipantSignature(publicJwk, REGISTRATION_PROOF_SCHEMA, body, signature)) return { problem: 'proof_signature_invalid' };
  return { problem: null, publicJwk, participantId };
}

export default {
  REGISTRATION_PROOF_SCHEMA,
  SESSION_BINDING_SCHEMA,
  DEVICE_HOSTS,
  normalizeParticipantPublicKey,
  participantIdFor,
  signAsParticipant,
  verifyParticipantSignature,
  registrationProofBody,
  createDeviceRegistrationProof,
  checkDeviceRegistrationProof,
  sessionBindingBody,
  createSessionBinding,
  checkSessionBinding
};
