/**
 * @fileoverview Canonical hashing helpers shared by pool server modules.
 */

import { sha256Digest } from '../hashing.js';
import { canonicalize } from '../../shared/pool/canonical-json.js';

export { canonicalize };

export function sha256Hex(value) {
  return sha256Digest(String(value));
}

export function hashJson(value) {
  return sha256Hex(canonicalize(value));
}
