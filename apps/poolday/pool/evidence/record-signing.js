/** Attributable authors and the signed record envelope shared by every record kind. */
import {
  DOMAIN_BY_KIND,
  RESEARCH_RECORD_VERSION,
  normalizeRoomId
} from '../evidence-record-contract.js';
import {
  authorPolicyFor,
  deepFreeze
} from './primitives.js';
import {
  exportPublicKey,
  hashJson,
  signCanonical
} from '../../../../shared/pool/inference-receipt.js';

/** Resolves a signing identity whose role the evidence policy allows for `kind`. */
export const createAuthor = async (identity, kind) => {
  if (!identity?.resolve || !identity?.getSigningKeyPair) throw new TypeError('signing identity is required');
  const expectedRoles = authorPolicyFor(kind)?.roles;
  if (!expectedRoles?.length) throw new TypeError(`research record kind has no author policy: ${kind}`);
  const [resolved, keyPair] = await Promise.all([identity.resolve(), identity.getSigningKeyPair()]);
  if (!expectedRoles.includes(resolved.kind)) {
    throw new TypeError(`identity role must be one of: ${expectedRoles.join(', ')}`);
  }
  return {
    author: {
      role: resolved.kind,
      roleId: resolved.roleId,
      userId: resolved.userId,
      deviceId: resolved.deviceId,
      identityRootId: resolved.identityRootId,
      publicKey: await exportPublicKey(keyPair.publicKey)
    },
    privateKey: keyPair.privateKey
  };
};

/**
 * Builds the versioned envelope for `kind`, then the kind's fields, and signs the immutable
 * record. The room is normalized before `buildFields` runs, so validation order is unchanged.
 * The record hash covers every field except the signature.
 */
export const signResearchRecord = async (kind, { roomId, createdAt, author, privateKey }, buildFields) => {
  const domain = DOMAIN_BY_KIND[kind];
  const envelope = {
    version: RESEARCH_RECORD_VERSION,
    kind,
    signatureDomain: domain,
    roomId: normalizeRoomId(roomId),
    createdAt,
    author
  };
  const payload = { ...envelope, ...(await buildFields()) };
  const record = { ...payload, recordHash: await hashJson(payload) };
  return deepFreeze({
    ...record,
    signature: await signCanonical(record, privateKey, { domain })
  });
};
