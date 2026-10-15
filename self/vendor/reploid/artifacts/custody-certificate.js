/**
 * @fileoverview Custody-key certificates.
 *
 * Custody signing keys are created fresh for each host process, so a
 * delivery receipt or challenge answer signed with one names no device. The
 * device's persistent participant identity signs a short-lived certificate
 * over the process's custody public key and the custody peer id it uses in
 * grants. A verifier holding the device registration can then attribute the
 * key: certificate, then device, then account. Uncertified keys stay
 * unattributable. WebCrypto only, so any host can sign.
 */

import { importPublicKey } from './signatures.js';
import { participantIdFor, signAsParticipant, verifyParticipantSignature } from './participant-proofs.js';

export const CUSTODY_CERTIFICATE_SCHEMA = 'reploid.custody-key-certificate/v1';

/** The lifetime a native host signs; each verifier enforces its own explicit maximum. */
export const CUSTODY_CERTIFICATE_LIFETIME_MS = 60 * 60_000;

const BODY_KEYS = Object.freeze(['schema', 'certificateId', 'participantId', 'custodyPeerId', 'custodyPublicKey', 'issuedAt', 'expiresAt']);
const CERTIFICATE_KEYS = Object.freeze([...BODY_KEYS, 'signature'].sort());
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const toMs = (value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);

export const custodyCertificateBody = (certificate) => Object.fromEntries(BODY_KEYS.map((key) => [key, certificate[key]]));

/** Sign a certificate for `custodyPublicKey` (base64 SPKI) with the participant identity bundle. */
export async function createCustodyKeyCertificate({
  identity, custodyPeerId, custodyPublicKey, issuedAtMs, lifetimeMs, certificateId = `cert_${crypto.randomUUID()}`
}) {
  const participantId = await participantIdFor(identity?.publicJwk);
  if (!identity?.privateJwk || identity.peerId !== participantId) throw new TypeError('A valid persistent participant identity is required');
  if (!ID.test(String(custodyPeerId)) || typeof custodyPublicKey !== 'string') throw new TypeError('custodyPeerId and custodyPublicKey are required');
  if (!Number.isSafeInteger(issuedAtMs) || !Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) throw new TypeError('issuedAtMs and a positive lifetimeMs are required');
  const body = {
    schema: CUSTODY_CERTIFICATE_SCHEMA,
    certificateId,
    participantId,
    custodyPeerId,
    custodyPublicKey,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + lifetimeMs).toISOString()
  };
  return { ...body, signature: await signAsParticipant(identity, CUSTODY_CERTIFICATE_SCHEMA, body) };
}

/** Lifetime and validity-window problems at `atMs`; the signature is not checked. */
export function certificateWindowProblems({ issuedAt, expiresAt }, { atMs, maxLifetimeMs, maxClockSkewMs }) {
  const issued = toMs(issuedAt);
  const expires = toMs(expiresAt);
  const problems = [];
  if (!(expires - issued <= maxLifetimeMs)) problems.push('certificate_lifetime_exceeded');
  if (!(atMs >= issued - maxClockSkewMs)) problems.push('certificate_not_yet_valid');
  if (!(atMs < expires)) problems.push('certificate_expired');
  return problems;
}

/**
 * Problems with `certificate` as a statement by the participant key
 * `publicJwk` covering time `atMs`; an empty list means valid. Malformed
 * certificates return one problem without checking further.
 */
export async function checkCustodyKeyCertificate(certificate, { publicJwk, atMs, maxLifetimeMs, maxClockSkewMs }) {
  if (!certificate || typeof certificate !== 'object' || Array.isArray(certificate)
    || Object.keys(certificate).sort().join('\u0000') !== CERTIFICATE_KEYS.join('\u0000')) return ['certificate_malformed'];
  const { schema, certificateId, participantId, custodyPeerId, custodyPublicKey, issuedAt, expiresAt, signature } = certificate;
  const issued = toMs(issuedAt);
  const expires = toMs(expiresAt);
  if (schema !== CUSTODY_CERTIFICATE_SCHEMA || !ID.test(String(certificateId)) || !ID.test(String(custodyPeerId))
    || typeof participantId !== 'string' || typeof custodyPublicKey !== 'string' || custodyPublicKey.length > 512
    || !Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return ['certificate_malformed'];
  try {
    await importPublicKey(custodyPublicKey);
  } catch {
    return ['certificate_malformed'];
  }
  const problems = certificateWindowProblems(certificate, { atMs, maxLifetimeMs, maxClockSkewMs });
  if (participantId !== await participantIdFor(publicJwk)) {
    problems.push('certificate_participant_mismatch');
  } else if (!await verifyParticipantSignature(publicJwk, CUSTODY_CERTIFICATE_SCHEMA, custodyCertificateBody(certificate), signature)) {
    problems.push('certificate_signature_invalid');
  }
  return problems;
}

/**
 * Host side: certify the process's custody key with the persistent identity,
 * reusing the current certificate until half its lifetime remains.
 * `onIssue(certificate)` observes each newly signed certificate.
 */
export function createCustodyKeyCertifier({
  identity, lifetimeMs = CUSTODY_CERTIFICATE_LIFETIME_MS, now = () => Date.now(), onIssue = () => {}
}) {
  let current = null;
  let queue = Promise.resolve();
  const fresh = ({ custodyPeerId, custodyPublicKey }) => current !== null
    && current.custodyPeerId === custodyPeerId && current.custodyPublicKey === custodyPublicKey
    && toMs(current.expiresAt) - now() > lifetimeMs / 2;
  return Object.freeze({
    certify(key) {
      if (fresh(key)) return Promise.resolve(current);
      const run = queue.then(async () => {
        if (fresh(key)) return current;
        current = await createCustodyKeyCertificate({ identity, ...key, issuedAtMs: now(), lifetimeMs });
        onIssue(current);
        return current;
      });
      queue = run.catch(() => {});
      return run;
    }
  });
}

export default {
  CUSTODY_CERTIFICATE_SCHEMA,
  CUSTODY_CERTIFICATE_LIFETIME_MS,
  custodyCertificateBody,
  createCustodyKeyCertificate,
  certificateWindowProblems,
  checkCustodyKeyCertificate,
  createCustodyKeyCertifier
};
