/**
 * @fileoverview Browser-native sealed secret helpers for access-code based unsealing.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ITERATIONS = 250000;
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_IV_BYTES = 12;

const getCryptoApi = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== 'function') {
    throw new Error('WebCrypto unavailable');
  }
  return api;
};

const toBase64Url = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

async function deriveAesKey(options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const accessCode = String(options.accessCode || '').trim();
  if (!accessCode) {
    throw new Error('Missing access code');
  }

  const salt = options.salt instanceof Uint8Array
    ? options.salt
    : fromBase64Url(options.salt);

  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(accessCode),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: Math.max(1, Number(options.iterations || DEFAULT_ITERATIONS))
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function createAccessWindowLabel(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toISOString().slice(0, 10);
}

export async function sealString(options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const plaintext = String(options.plaintext || '');
  const salt = cryptoApi.getRandomValues(new Uint8Array(DEFAULT_SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(DEFAULT_IV_BYTES));
  const iterations = Math.max(1, Number(options.iterations || DEFAULT_ITERATIONS));
  const key = await deriveAesKey({
    accessCode: options.accessCode,
    salt,
    iterations,
    cryptoApi
  });

  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );

  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-GCM-256',
    label: String(options.label || ''),
    iterations,
    salt: toBase64Url(salt),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  };
}

export async function unsealString(options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const blob = options.blob || {};
  const key = await deriveAesKey({
    accessCode: options.accessCode,
    salt: blob.salt,
    iterations: blob.iterations || DEFAULT_ITERATIONS,
    cryptoApi
  });

  const plaintext = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(blob.iv) },
    key,
    fromBase64Url(blob.ciphertext)
  );

  return decoder.decode(plaintext);
}

export async function withUnsealedSecret(options = {}, callback) {
  const secret = await unsealString(options);
  try {
    return await callback(secret);
  } finally {
    // The plaintext remains in local scope only; do not persist it.
  }
}

export default {
  createAccessWindowLabel,
  sealString,
  unsealString,
  withUnsealedSecret
};
