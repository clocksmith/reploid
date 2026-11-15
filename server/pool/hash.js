/**
 * @fileoverview Canonical hashing helpers shared by pool server modules.
 */

import { sha256Digest as digest } from '../hashing.js';
import { canonicalize } from '../../shared/pool/canonical-json.js';

export { canonicalize };

/** Pool wire identities retain their `sha256:` prefix. */
export function sha256Digest(value) {
  return digest(String(value));
}

/** Historical pool API; unlike server/hashing.js sha256Hex, this is prefixed. */
export const sha256Hex = sha256Digest;

export function hashJson(value) {
  return sha256Digest(canonicalize(value));
}
