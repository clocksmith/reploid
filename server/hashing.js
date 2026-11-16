/**
 * @fileoverview The hosted services' one SHA-256 and canonical JSON, over
 * node:crypto. Keys, record ids and evidence digests written by server code
 * come from here, so retained hashes have one definition. The browser
 * library's Web Crypto twin is packages/reploid/src/artifacts/signatures.js.
 */

import { createHash } from 'node:crypto';
import { canonicalizeWith } from '../shared/pool/canonical-json.js';

/** Lowercase hex SHA-256 with no prefix: bytes as given, any other value as the UTF-8 of String(value). */
export const sha256Hex = (value) => createHash('sha256')
  .update(typeof value === 'string' || ArrayBuffer.isView(value) ? value : String(value))
  .digest('hex');

/** `sha256:`-prefixed form of sha256Hex. */
export const sha256Digest = (value) => `sha256:${sha256Hex(value)}`;

/**
 * Sorted-key JSON. Object members whose value is undefined are left out; any
 * other undefined (array items, the top-level value) serializes as null, as
 * JSON.stringify would.
 */
export const canonicalJson = canonicalizeWith(undefined, { undefinedValues: 'json' });

/** `sha256:` digest of canonicalJson(value). */
export const hashCanonical = (value) => sha256Digest(canonicalJson(value));
