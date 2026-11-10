import { bytesToBase64, base64ToBytes } from './binary.js';
import { canonicalize } from './canonical-json.js';
import { sha256Bytes, sha256HexUnprefixed, sha256Hex } from '../hashing.js';

export { sha256Bytes, sha256HexUnprefixed, sha256Hex };

const textEncoder = new TextEncoder();

export async function hashJson(value, cryptoApi = globalThis.crypto) {
  return sha256Hex(canonicalize(value), cryptoApi);
}

export async function createSigningKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

export async function exportPublicKey(publicKey) {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function exportPrivateKey(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function importPublicKey(publicKeyBase64) {
  const bytes = base64ToBytes(publicKeyBase64);
  return crypto.subtle.importKey(
    'spki',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

export async function importPrivateKey(privateKeyBase64) {
  const bytes = base64ToBytes(privateKeyBase64);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
}

export async function importSigningKeyPair({ privateKey, publicKey } = {}) {
  if (!privateKey || !publicKey) throw new Error('privateKey and publicKey are required');
  return {
    privateKey: await importPrivateKey(privateKey),
    publicKey: await importPublicKey(publicKey)
  };
}

export function domainSeparatedPayload(domain, payload) {
  const normalized = String(domain || '').trim();
  if (!normalized) throw new Error('signature domain is required');
  return {
    signatureDomain: normalized,
    payload
  };
}

export async function signCanonical(value, privateKey, { domain = null } = {}) {
  const signingValue = domain ? domainSeparatedPayload(domain, value) : value;
  const payload = textEncoder.encode(canonicalize(signingValue));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    payload
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyCanonicalSignature(value, publicKeyBase64, signatureBase64, { domain = null, allowLegacy = false } = {}) {
  const publicKey = await importPublicKey(publicKeyBase64);
  const verifyValue = async (candidate) => crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64ToBytes(signatureBase64),
    textEncoder.encode(canonicalize(candidate))
  );
  if (!domain) return verifyValue(value);
  const domainOk = await verifyValue(domainSeparatedPayload(domain, value));
  if (domainOk || !allowLegacy) return domainOk;
  return verifyValue(value);
}

