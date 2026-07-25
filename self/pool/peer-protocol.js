/**
 * @fileoverview Signed message protocol for the Poolday peer control plane.
 */

import {
  SIGNATURE_DOMAINS,
  hashJson,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';

export const PEER_CONTROL_VERSION = 'reploid_peer_control/v1';
export const PEER_CONTROL_NETWORK = 'poolday';

export const PEER_MESSAGE_TYPES = Object.freeze({
  JOB_INTENT: 'job_intent',
  PROVIDER_ADVERT: 'provider_advert',
  ASSIGNMENT_CLAIM: 'assignment_claim',
  COMMITMENT: 'commitment',
  REVEAL: 'reveal',
  EXECUTION_RESULT: 'execution_result',
  RECEIPT: 'receipt',
  ACCEPTANCE: 'acceptance',
  POINTS_EVENT: 'points_event',
  REPUTATION_EVENT: 'reputation_event',
  HEARTBEAT: 'heartbeat'
});

const MESSAGE_TYPES = new Set(Object.values(PEER_MESSAGE_TYPES));

export const requirePeerString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const optionalString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

export const stripPeerUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripPeerUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripPeerUndefined(child)])
  );
};

const randomNonce = () => (
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
);

export function peerMessageSigningPayload(message = {}) {
  const { signature, messageHash, ...payload } = message || {};
  return stripPeerUndefined(payload);
}

export function createPeerMessage({
  type,
  fromPeerId,
  publicKey,
  toPeerId = null,
  body = {},
  createdAt = new Date().toISOString(),
  expiresAt = null,
  nonce = randomNonce(),
  causalRefs = []
} = {}) {
  if (!MESSAGE_TYPES.has(type)) throw new TypeError('peer message type is not allowed');
  return stripPeerUndefined({
    peerControlVersion: PEER_CONTROL_VERSION,
    network: PEER_CONTROL_NETWORK,
    type,
    fromPeerId: requirePeerString(fromPeerId, 'fromPeerId'),
    toPeerId: optionalString(toPeerId),
    publicKey: requirePeerString(publicKey, 'publicKey'),
    body: body || {},
    createdAt,
    expiresAt,
    nonce: requirePeerString(nonce, 'nonce'),
    causalRefs: Array.isArray(causalRefs) ? causalRefs.filter(Boolean) : []
  });
}

export function validatePeerMessage(message = {}) {
  const reasons = [];
  if (message.peerControlVersion !== PEER_CONTROL_VERSION) reasons.push('peerControlVersion mismatch');
  if (message.network !== PEER_CONTROL_NETWORK) reasons.push('peer control network mismatch');
  if (!MESSAGE_TYPES.has(message.type)) reasons.push('peer message type is not allowed');
  for (const field of ['fromPeerId', 'publicKey', 'createdAt', 'nonce']) {
    if (!String(message[field] || '').trim()) reasons.push(`${field} is required`);
  }
  if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) {
    reasons.push('body must be an object');
  }
  if (message.expiresAt && Date.parse(message.expiresAt) <= Date.now()) {
    reasons.push('peer message expired');
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export async function hashPeerMessage(message = {}) {
  return hashJson(peerMessageSigningPayload(message));
}

export async function signPeerMessage(message = {}, privateKey) {
  if (!privateKey) throw new TypeError('privateKey is required');
  const validation = validatePeerMessage(message);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  const unsigned = peerMessageSigningPayload(message);
  return {
    ...unsigned,
    messageHash: await hashJson(unsigned),
    signature: await signCanonical(unsigned, privateKey, { domain: SIGNATURE_DOMAINS.peerMessage })
  };
}

export async function createSignedPeerMessage({ privateKey, ...message } = {}) {
  return signPeerMessage(createPeerMessage(message), privateKey);
}

export async function verifyPeerMessage(message = {}) {
  const reasons = [];
  const validation = validatePeerMessage(message);
  reasons.push(...validation.reasons);
  const messageHash = await hashPeerMessage(message);
  if (message.messageHash !== messageHash) reasons.push('messageHash mismatch');
  if (!message.signature) {
    reasons.push('signature is required');
  } else if (message.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        peerMessageSigningPayload(message),
        message.publicKey,
        message.signature,
        { domain: SIGNATURE_DOMAINS.peerMessage }
      );
      if (!ok) reasons.push('signature invalid');
    } catch (error) {
      reasons.push(`signature verification failed: ${error.message}`);
    }
  }
  return {
    ok: reasons.length === 0,
    messageHash,
    reasons
  };
}
