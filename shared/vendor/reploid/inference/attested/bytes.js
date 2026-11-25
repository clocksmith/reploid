/** Byte helpers for the attested GPU route. Pure; Web Crypto only where hashing is needed. */
import { toBase64Url, fromBase64Url } from '../../artifacts/binary.js';
import { canonicalize } from '../../artifacts/canonical-json.js';

const encoder = new TextEncoder();
export const utf8 = text => encoder.encode(text);
export const decodeUtf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export { toBase64Url, fromBase64Url, canonicalize };

export function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Constant-time over equal lengths; unequal lengths are unequal. */
export function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export function fromHex(text) {
  if (typeof text !== 'string' || text.length % 2 || !/^[0-9a-f]*$/i.test(text)) throw new TypeError('Invalid hex');
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Strict unpadded base64url to bytes, with an exact or bounded length. */
export function decodeBase64Url(value, { length = null, max = 1 << 24 } = {}) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError('Invalid base64url');
  const bytes = fromBase64Url(value);
  if (toBase64Url(bytes) !== value) throw new TypeError('Non-canonical base64url');
  if ((length !== null && bytes.length !== length) || bytes.length > max) throw new RangeError('Unexpected byte length');
  return bytes;
}

export async function digest(algorithm, bytes, subtle = globalThis.crypto.subtle) {
  return new Uint8Array(await subtle.digest(algorithm, bytes));
}

/** `sha256:<hex>` of the canonical JSON of a value. */
export async function canonicalDigest(value) {
  return `sha256:${toHex(await digest('SHA-256', utf8(canonicalize(value))))}`;
}

export function randomBytes(length) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
