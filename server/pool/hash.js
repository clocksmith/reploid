/**
 * @fileoverview Canonical hashing helpers shared by pool server modules.
 */

import crypto from 'crypto';
import { canonicalize } from '../../self/pool/canonical-json.js';

export { canonicalize };

export function sha256Hex(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

export function hashJson(value) {
  return sha256Hex(canonicalize(value));
}
