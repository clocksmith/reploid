/**
 * @fileoverview The one definition of each identifier format Reploid exchanges. Producers stay where they are
 * (artifacts/identity.js derives participant IDs, hashing.js digests); every reader checks with these.
 * No dependencies, so the browser, the native hosts and the HTTP services import the same file.
 */

/** A signing key's participant ID: `peer:` and the first 24 hex digits of its public key's digest (identity.js). */
export const PARTICIPANT_ID_PATTERN = /^peer:[a-f0-9]{24}$/;
/** A content digest: `sha256:` and 64 lowercase hex digits. */
export const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
/** The same digest without its prefix, as file inventories and Doppler manifests carry it. */
export const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/;
/** A transport session (signaling peer) ID: the connection, never the computer (server/swarm-protocol.js PEER_ID_PATTERN). */
export const CONNECTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,127}$/i;
/** Longest operator-assigned ID (a ledger enrollment or account ID, an operation ID). */
export const MAX_RECORD_ID_LENGTH = 256;

export const isParticipantId = value => typeof value === 'string' && PARTICIPANT_ID_PATTERN.test(value);
export const isDigest = value => typeof value === 'string' && DIGEST_PATTERN.test(value);
export const isHexDigest = value => typeof value === 'string' && HEX_DIGEST_PATTERN.test(value);
export const isConnectionId = value => typeof value === 'string' && CONNECTION_ID_PATTERN.test(value);

/** An operator-assigned ID: plain text of 1-256 characters with no control characters. */
export const isRecordId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_RECORD_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
/** A ledger account ID (server/fleet/contract.js enrollment `ownerId`). */
export const isAccountId = isRecordId;
/** A ledger enrollment ID (server/fleet/contract.js enrollment `id`). */
export const isEnrollmentId = isRecordId;

/**
 * A computer's identity: on the mesh, the participant ID of its own (requester) signing key; on a ledger, its
 * enrollment ID. `basis` names which; without it either is accepted.
 */
export function isComputerId(value, basis = null) {
  if (basis === 'signing-key') return isParticipantId(value);
  if (basis === 'ledger-enrollment') return isEnrollmentId(value);
  return basis === null && (isParticipantId(value) || isEnrollmentId(value));
}

/** The hex of a `sha256:` digest, or null. */
export const digestHex = value => (isDigest(value) ? value.slice(7) : null);
/** The `sha256:` digest of 64 hex digits, or null. */
export const toDigest = hex => (isHexDigest(hex) ? `sha256:${hex}` : null);
