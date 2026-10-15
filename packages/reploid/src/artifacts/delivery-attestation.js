/**
 * @fileoverview Custody delivery attestations.
 *
 * After a verified acquisition, the acquirer signs the exact custody receipt
 * with the custody key its grant names. The statement says the bytes arrived
 * and verified; supplier-held records cannot say that. A verifier attributes
 * the custody key to a participant only through that participant's custody
 * certificate, so an uncertified host's attestation names no one and hosts
 * without an identity sign none. `hash` is the evidence digest the custody
 * records use (canonical JSON, sha256), supplied by the caller so signer and
 * verifier share one function. WebCrypto only.
 */

import { sha256Hex, signCanonical } from './signatures.js';

export const DELIVERY_ATTESTATION_SCHEMA = 'reploid.custody-delivery-attestation/v1';

/** The statement an acquirer signs over one completed receipt. */
export async function deliveryAttestationBody({ receipt, attestedAt, hash }) {
  return {
    schema: DELIVERY_ATTESTATION_SCHEMA,
    authorizationHash: receipt.authorizationHash,
    transferId: receipt.transferId,
    receiptDigest: await hash(receipt),
    completed: receipt.completed,
    attestedAt
  };
}

/** Sign the attestation with the acquirer's custody private key (ECDSA P-256 CryptoKey). */
export async function signDeliveryAttestation({ receipt, attestedAt, privateKey, hash }) {
  const body = await deliveryAttestationBody({ receipt, attestedAt, hash });
  return { ...body, signature: await signCanonical(body, privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) };
}

/** One identifier per delivered artifact of one grant; the supplier derives it from its own grant. */
export async function deliveryEvidenceId({ authorizationHash, artifactId }) {
  return `dlv_${(await sha256Hex(`${authorizationHash}|${artifactId}`)).slice(7, 39)}`;
}

/**
 * The delivery evidence a certified acquirer submits for one artifact of a
 * requester record from the custody exchange; null without an attestation.
 */
export function deliveryEvidenceFromRecord(record, artifactId = record?.authorization?.artifactSet?.artifacts?.[0]?.artifactId) {
  if (record?.role !== 'requester' || !record.attestation || !record.certificates?.requester || typeof artifactId !== 'string') return null;
  return structuredClone({
    artifactId,
    authorization: record.authorization,
    index: record.index,
    receipt: record.receipt,
    attestation: record.attestation,
    supplierCertificate: record.certificates.supplier,
    acquirerCertificate: record.certificates.requester
  });
}

export default {
  DELIVERY_ATTESTATION_SCHEMA,
  deliveryAttestationBody,
  signDeliveryAttestation,
  deliveryEvidenceId,
  deliveryEvidenceFromRecord
};
