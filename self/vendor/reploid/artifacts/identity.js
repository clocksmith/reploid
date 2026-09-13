const encoder = new TextEncoder();
const stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const getCryptoApi = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle) {
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

async function sha256Hex(text, cryptoApi = globalThis.crypto) {
  const digest = await getCryptoApi(cryptoApi).subtle.digest('SHA-256', encoder.encode(String(text || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inferIdentityAlgorithm(bundleOrJwk = {}) {
  const algorithm = String(bundleOrJwk?.algorithm || '').trim();
  const crv = String(bundleOrJwk?.crv || bundleOrJwk?.publicJwk?.crv || '').trim();
  if (algorithm === 'Ed25519' || crv === 'Ed25519') {
    return 'Ed25519';
  }
  return 'ECDSA';
}

export function getIdentityImportAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === 'Ed25519'
    ? { name: 'Ed25519' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
}

export function getIdentitySignAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === 'Ed25519'
    ? { name: 'Ed25519' }
    : { name: 'ECDSA', hash: 'SHA-256' };
}

export async function createPeerIdFromPublicJwk(publicJwk, cryptoApi = globalThis.crypto) {
  const publicShape = publicJwk ? {
    kty: publicJwk.kty || null,
    crv: publicJwk.crv || null,
    x: publicJwk.x || null,
    y: publicJwk.y || null,
    n: publicJwk.n || null,
    e: publicJwk.e || null
  } : {};
  const digest = await sha256Hex(stableJson(publicShape), cryptoApi);
  return `peer:${digest.slice(0, 24)}`;
}

export async function importSigningKey(bundle, cryptoApi = globalThis.crypto) {
  if (!bundle?.privateJwk) {
    throw new Error('Missing private JWK');
  }
  return getCryptoApi(cryptoApi).subtle.importKey(
    'jwk',
    bundle.privateJwk,
    getIdentityImportAlgorithm(bundle),
    false,
    ['sign']
  );
}

export async function importVerificationKey(bundleOrJwk, cryptoApi = globalThis.crypto) {
  const publicJwk = bundleOrJwk?.publicJwk || bundleOrJwk;
  if (!publicJwk) {
    throw new Error('Missing public JWK');
  }
  return getCryptoApi(cryptoApi).subtle.importKey(
    'jwk',
    publicJwk,
    getIdentityImportAlgorithm(publicJwk),
    false,
    ['verify']
  );
}

export function encodeBytes(value) {
  return encoder.encode(String(value || ''));
}

export { fromBase64Url, toBase64Url };


export async function createSigningIdentity({ algorithm, cryptoApi = globalThis.crypto }) {
  if (!['Ed25519', 'ECDSA'].includes(algorithm)) throw new TypeError('Explicit supported signing algorithm required');
  const params = algorithm === 'Ed25519' ? { name: algorithm } : { name: algorithm, namedCurve: 'P-256' };
  const keys = await cryptoApi.subtle.generateKey(params, true, ['sign', 'verify']);
  const publicJwk = await cryptoApi.subtle.exportKey('jwk', keys.publicKey);
  const privateJwk = await cryptoApi.subtle.exportKey('jwk', keys.privateKey);
  return { version: 1, algorithm, peerId: await createPeerIdFromPublicJwk(publicJwk, cryptoApi), publicJwk, privateJwk };
}
