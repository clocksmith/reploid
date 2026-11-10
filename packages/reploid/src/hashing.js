/**
 * @fileoverview The library's one browser SHA-256 over Web Crypto. It lives at the library
 * root, outside artifacts/, so modules any surface ships (including the Zero source
 * image, which never exports artifacts paths) can import it.
 */
const textEncoder = new TextEncoder();
const bytesToHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

/**
 * The library's one SHA-256 over Web Crypto, as the raw ArrayBuffer digest: a
 * Uint8Array is hashed as is, any other value as the UTF-8 bytes of
 * String(value). Hosted services use their node:crypto twin, server/hashing.js.
 */
export async function sha256Bytes(value, cryptoApi = globalThis.crypto) {
  const subtle = (cryptoApi || globalThis.crypto)?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable');
  return subtle.digest('SHA-256', value instanceof Uint8Array ? value : textEncoder.encode(String(value)));
}

/** Lowercase hex form of sha256Bytes, with no prefix. */
export async function sha256HexUnprefixed(value, cryptoApi = globalThis.crypto) {
  return bytesToHex(new Uint8Array(await sha256Bytes(value, cryptoApi)));
}

/** `sha256:`-prefixed form of sha256HexUnprefixed. */
export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  return `sha256:${await sha256HexUnprefixed(value, cryptoApi)}`;
}
