import { canonicalize } from './canonical-json.js';
const textEncoder = new TextEncoder();
const bytesToHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const bytesToBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(String(value || ''), 'base64'));
  }
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export async function sha256Hex(value) {
  const input = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function hashJson(value) {
  return sha256Hex(canonicalize(value));
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

