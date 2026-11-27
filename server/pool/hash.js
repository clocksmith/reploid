/**
 * @fileoverview Canonical hashing helpers shared by pool server modules.
 */

import { sha256Digest as digest } from '../hashing.js';
import { canonicalize } from '../../shared/pool/canonical-json.js';

export { canonicalize };

/** Pool text digests hash the UTF-8 bytes of String(value) and retain the wire prefix. */
export function sha256TextDigest(value) {
  return digest(String(value));
}

/** @deprecated Use sha256TextDigest for the Pool text contract. */
export const sha256Digest = sha256TextDigest;
/** @deprecated Use sha256TextDigest for the Pool text contract. */
export const sha256Hex = sha256TextDigest;

export function hashJson(value) {
  return sha256TextDigest(canonicalize(value));
}
