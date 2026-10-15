/**
 * @fileoverview Server-side verification of REP-5 custody delivery records.
 *
 * Evidence is the acquirer's existing `reploid.pool.pack-custody-receipt/v1`
 * with the v2 grant and chunk index it binds, plus the acquirer's signature
 * over that receipt. Each credited chunk needs the acquirer's signed request
 * and the supplier's signed response, both bound to the index's committed chunk
 * hash, and the hash the acquirer observed. Only the recipient's attestation
 * says the bytes arrived and verified; supplier-held records cannot.
 *
 * Contracted challenges reuse the same commitments: a chunk proof is the
 * chunk's bytes, checked against the committed hash.
 */

import { DELIVERY_ATTESTATION_SCHEMA, deliveryAttestationBody as attestationBody } from '../../packages/reploid/src/artifacts/delivery-attestation.js';
import { sha256Hex, verifyCanonicalSignature } from '../../packages/reploid/src/artifacts/signatures.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { isIsoTime } from '../ledger/domain.js';

const PREFIX = 'reploid.pool.pack-custody';
export { DELIVERY_ATTESTATION_SCHEMA };
export const CHALLENGE_ANSWER_SCHEMA = 'reploid.reward-challenge-answer/v1';

const unsigned = ({ signature: _signature, ...body }) => body;
const same = async (left, right) => (await hashDopplerEvidence(left ?? null)) === (await hashDopplerEvidence(right ?? null));

/** Verify a domain-separated signature; malformed keys or messages fail closed. */
export async function verifySigned(message, publicKey, schema) {
  try {
    return message?.schema === schema && typeof message.signature === 'string' && typeof publicKey === 'string'
      && await verifyCanonicalSignature(unsigned(message), publicKey, message.signature, { domain: schema });
  } catch {
    return false;
  }
}

/**
 * The binding an identity certificate attests for a per-process custody key:
 * `{ participantId, custodyPeerId, publicKey }`, or null. Custody keys and the
 * peer ids grants name are created per process; only a certificate from the
 * participant's persistent identity, checked by `identity.verifyCustodyKey`,
 * attributes them to a participant. The certificate format belongs to the
 * identity owner; this component reads only the returned binding.
 */
export async function certifiedCustodyKey(identity, { certificate, at }) {
  if (certificate == null) return null;
  try {
    const binding = await identity.verifyCustodyKey({ certificate, at });
    const { participantId, custodyPeerId, publicKey } = binding ?? {};
    return [participantId, custodyPeerId, publicKey].every((value) => typeof value === 'string' && value.length > 0)
      ? { participantId, custodyPeerId, publicKey } : null;
  } catch {
    return null;
  }
}

/**
 * The body an acquirer host signs, with its custody key, after a verified
 * acquisition: the library format the custody exchange signs, over the same
 * evidence digest.
 */
export const deliveryAttestationBody = ({ receipt, attestedAt }) => attestationBody({ receipt, attestedAt, hash: hashDopplerEvidence });

/** A chunk proof is the chunk itself: base64 bytes matching the committed size and hash. */
export async function verifyChunkBytes(base64, chunk) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(chunk.sizeBytes / 3) * 4 + 4) return false;
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  return bytes.byteLength === chunk.sizeBytes && (await sha256Hex(bytes)) === chunk.hash;
}

const verifyGrant = async (authorization, index) => {
  const set = authorization?.artifactSet;
  if (authorization?.schema !== `${PREFIX}-authorization/v2` || set?.schema !== 'reploid.pool.artifact-set/v1'
    || !Array.isArray(set.artifacts) || set.artifacts.length === 0 || !Array.isArray(authorization.suppliers)
    || typeof authorization.requester?.peerId !== 'string' || typeof authorization.requester?.publicKey !== 'string'
    || typeof authorization.transferId !== 'string' || !Number.isSafeInteger(authorization.attempt)
    || !Number.isSafeInteger(authorization.expiresAt)
    || index?.schema !== `${PREFIX}-index/v2` || index.artifactSetIdentity !== set.identity || !Array.isArray(index.artifacts)) return false;
  return set.identity === await hashDopplerEvidence(set.artifacts)
    && authorization.indexDigest === await hashDopplerEvidence(index);
};

// Verify one accepted chunk attempt end to end; returns false on any mismatch.
const verifyChunkAttempt = async ({ attempt, chunk, artifactId, authorization, authorizationHash, supplier }) => {
  const { request, response } = attempt;
  const requestBody = request && unsigned(request);
  return Boolean(request && response)
    && request.authorizationHash === authorizationHash && request.transferId === authorization.transferId
    && request.attempt === authorization.attempt && request.requesterPeerId === authorization.requester.peerId
    && request.supplierPeerId === supplier.peerId && request.artifactId === artifactId && request.chunkIndex === chunk.index
    && request.offset === chunk.offset && request.sizeBytes === chunk.sizeBytes
    && await verifySigned(request, authorization.requester.publicKey, `${PREFIX}-request/v1`)
    && attempt.requestHash === await hashDopplerEvidence(requestBody)
    && response.authorizationHash === authorizationHash && response.peerId === supplier.peerId
    && response.requestHash === attempt.requestHash && response.bytesHash === chunk.hash
    && await verifySigned(response, supplier.publicKey, `${PREFIX}-response/v1`)
    && attempt.observedBytesHash === chunk.hash;
};

/**
 * Verify that the custody peer `supplierPeerId` delivered `artifactId` to the grant's
 * requester, that the requester completed and verified it, and that the
 * requester attested that receipt. Returns `{ reasons, delivery }`.
 */
export async function verifyCustodyDelivery({ authorization, index, receipt, attestation, artifactId, supplierPeerId }) {
  const reasons = [];
  const reject = (code, message) => reasons.push({ code, message });
  if (!await verifyGrant(authorization, index)) {
    reject('custody_grant_invalid', 'the custody grant, artifact set and chunk index do not bind one another');
    return { reasons, delivery: null };
  }
  const authorizationHash = await hashDopplerEvidence(authorization);
  if (receipt?.schema !== `${PREFIX}-receipt/v1` || receipt.authorizationHash !== authorizationHash
    || receipt.transferId !== authorization.transferId || receipt.attempt !== authorization.attempt
    || receipt.artifactSetIdentity !== authorization.artifactSet.identity || receipt.indexDigest !== authorization.indexDigest
    || !Array.isArray(receipt.attempts) || !Array.isArray(receipt.completed)) {
    reject('custody_receipt_mismatch', 'the acquirer receipt does not belong to this custody grant');
    return { reasons, delivery: null };
  }
  const expected = await deliveryAttestationBody({ receipt, attestedAt: attestation?.attestedAt });
  if (!isIsoTime(attestation?.attestedAt) || !await same(unsigned(attestation), expected)
    || !await verifySigned(attestation, authorization.requester.publicKey, DELIVERY_ATTESTATION_SCHEMA)) {
    reject('recipient_attestation_invalid', 'the acquirer did not sign this exact receipt');
    return { reasons, delivery: null };
  }
  const declared = authorization.artifactSet.artifacts.find((artifact) => artifact?.artifactId === artifactId);
  const entry = index.artifacts.find((artifact) => artifact?.artifactId === artifactId);
  const completed = receipt.completed.find((artifact) => artifact?.artifactId === artifactId);
  if (!declared || !entry || !Array.isArray(entry.chunks) || entry.hash !== declared.hash || entry.sizeBytes !== declared.sizeBytes
    || completed?.hash !== declared.hash || completed.sizeBytes !== declared.sizeBytes) {
    reject('delivery_not_completed', 'the acquirer did not complete and verify this artifact');
    return { reasons, delivery: null };
  }
  const supplier = authorization.suppliers.find((peer) => peer?.peerId === supplierPeerId);
  if (!supplier || typeof supplier.publicKey !== 'string') {
    reject('supplier_not_granted', 'the contributor was not a granted supplier of this transfer');
    return { reasons, delivery: null };
  }
  let deliveredBytes = 0;
  let deliveredChunks = 0;
  for (const chunk of entry.chunks) {
    const accepted = receipt.attempts.filter((attempt) => attempt?.artifactId === artifactId
      && attempt.chunkIndex === chunk.index && attempt.status === 'accepted');
    if (accepted.length > 1) {
      reject('delivery_proof_invalid', 'a chunk records more than one accepted delivery');
      return { reasons, delivery: null };
    }
    if (accepted[0]?.peerId !== supplier.peerId) continue;
    if (!await verifyChunkAttempt({ attempt: accepted[0], chunk, artifactId, authorization, authorizationHash, supplier })) {
      reject('delivery_proof_invalid', `chunk ${chunk.index} lacks a signed request, signed response or verified hash`);
      return { reasons, delivery: null };
    }
    deliveredBytes += chunk.sizeBytes;
    deliveredChunks += 1;
  }
  if (deliveredBytes === 0) reject('nothing_delivered', 'the acquirer received none of this artifact\'s chunks from the contributor');
  return {
    reasons,
    delivery: {
      authorizationHash,
      transferId: authorization.transferId,
      grantExpiresAt: authorization.expiresAt,
      artifact: { artifactId, hash: declared.hash, sizeBytes: declared.sizeBytes },
      acquirer: { custodyPeerId: authorization.requester.peerId, publicKey: authorization.requester.publicKey },
      supplier: { custodyPeerId: supplier.peerId, publicKey: supplier.publicKey },
      deliveredBytes,
      deliveredChunks,
      totalChunks: entry.chunks.length,
      attestedAt: attestation.attestedAt
    }
  };
}

export default { verifyCustodyDelivery, verifyChunkBytes, verifySigned, deliveryAttestationBody };
