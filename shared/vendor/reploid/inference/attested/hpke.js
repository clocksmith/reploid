/**
 * HPKE (RFC 9180) base mode over Web Crypto: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, and AES-128-GCM or
 * AES-256-GCM. The requester seals its prompt to the enclave's attested X25519 key; the enclave answers under
 * a key exported from the same context, so only the two ends of one attested session can read either direction.
 *
 * Checked against the RFC 9180 appendix A.1 vectors in tests/unit/attested-gpu-hpke.test.js.
 */
import { concatBytes, equalBytes, utf8, toBase64Url } from './bytes.js';

export const KEM_X25519_HKDF_SHA256 = 0x0020;
export const KDF_HKDF_SHA256 = 0x0001;
export const AEAD_AES_128_GCM = 0x0001;
export const AEAD_AES_256_GCM = 0x0002;
/** The suite this route uses: X25519, HKDF-SHA256, AES-256-GCM. */
export const ATTESTED_HPKE_SUITE = Object.freeze({ kem: KEM_X25519_HKDF_SHA256, kdf: KDF_HKDF_SHA256, aead: AEAD_AES_256_GCM,
  name: 'DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM' });

const AEAD = { [AEAD_AES_128_GCM]: { nk: 16 }, [AEAD_AES_256_GCM]: { nk: 32 } };
const NN = 12, NH = 32, NSECRET = 32, NPK = 32;
const subtle = () => globalThis.crypto.subtle;
const i2osp = (value, length) => {
  const out = new Uint8Array(length);
  for (let i = length - 1, v = value; i >= 0; i -= 1, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
};
const VERSION = utf8('HPKE-v1');

async function hmac(key, data) {
  const handle = await subtle().importKey('raw', key.length ? key : new Uint8Array(NH), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', handle, data));
}
const extract = (salt, ikm) => hmac(salt, ikm);
async function expand(prk, info, length) {
  if (length > 255 * NH) throw new RangeError('HKDF expand length too large');
  const blocks = [];
  let previous = new Uint8Array(0);
  for (let i = 1; blocks.length * NH < length; i += 1) {
    previous = await hmac(prk, concatBytes(previous, info, Uint8Array.of(i)));
    blocks.push(previous);
  }
  return concatBytes(...blocks).slice(0, length);
}
const labeledExtract = (suiteId, salt, label, ikm) => extract(salt, concatBytes(VERSION, suiteId, utf8(label), ikm));
const labeledExpand = (suiteId, prk, label, info, length) =>
  expand(prk, concatBytes(i2osp(length, 2), VERSION, suiteId, utf8(label), info), length);

const kemSuiteId = concatBytes(utf8('KEM'), i2osp(KEM_X25519_HKDF_SHA256, 2));

export async function importX25519PublicKey(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== NPK) throw new TypeError('An X25519 public key is 32 bytes');
  return subtle().importKey('raw', raw, { name: 'X25519' }, true, []);
}
export const exportX25519PublicKey = async key => new Uint8Array(await subtle().exportKey('raw', key));

/** A fresh X25519 key pair. The private key is not extractable: it never leaves this process's Web Crypto. */
export const generateX25519KeyPair = () => subtle().generateKey({ name: 'X25519' }, false, ['deriveBits']);

/** Deterministic key pair from raw scalars (tests and RFC vectors only). */
export async function importX25519KeyPair({ privateKey, publicKey }) {
  const jwk = { kty: 'OKP', crv: 'X25519', d: toBase64Url(privateKey), x: toBase64Url(publicKey) };
  return { privateKey: await subtle().importKey('jwk', jwk, { name: 'X25519' }, false, ['deriveBits']),
    publicKey: await importX25519PublicKey(publicKey) };
}

async function dh(privateKey, publicKey) {
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256));
  if (equalBytes(shared, new Uint8Array(32))) throw new Error('HPKE: X25519 produced the all-zero shared secret');
  return shared;
}

async function extractAndExpand(dhValue, kemContext) {
  const prk = await labeledExtract(kemSuiteId, new Uint8Array(0), 'eae_prk', dhValue);
  return labeledExpand(kemSuiteId, prk, 'shared_secret', kemContext, NSECRET);
}

function suiteIdFor(suite) {
  if (suite.kem !== KEM_X25519_HKDF_SHA256 || suite.kdf !== KDF_HKDF_SHA256 || !AEAD[suite.aead]) throw new Error('Unsupported HPKE suite');
  return concatBytes(utf8('HPKE'), i2osp(suite.kem, 2), i2osp(suite.kdf, 2), i2osp(suite.aead, 2));
}

async function keySchedule(suite, sharedSecret, info) {
  const suiteId = suiteIdFor(suite);
  const empty = new Uint8Array(0);
  const pskIdHash = await labeledExtract(suiteId, empty, 'psk_id_hash', empty);
  const infoHash = await labeledExtract(suiteId, empty, 'info_hash', info);
  const context = concatBytes(Uint8Array.of(0), pskIdHash, infoHash);
  const secret = await labeledExtract(suiteId, sharedSecret, 'secret', empty);
  const key = await labeledExpand(suiteId, secret, 'key', context, AEAD[suite.aead].nk);
  const baseNonce = await labeledExpand(suiteId, secret, 'base_nonce', context, NN);
  const exporterSecret = await labeledExpand(suiteId, secret, 'exp', context, NH);
  return createContext({ suiteId, key, baseNonce, exporterSecret });
}

/** An AEAD context with a strictly increasing sequence. `seal` and `open` share one counter per direction. */
async function createContext({ suiteId, key, baseNonce, exporterSecret }) {
  const aesKey = await subtle().importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  let sequence = 0;
  const nonce = () => {
    if (sequence >= 2 ** 32) throw new Error('HPKE: message limit reached');
    const out = baseNonce.slice();
    const counter = i2osp(sequence, NN);
    for (let i = 0; i < NN; i += 1) out[i] ^= counter[i];
    return out;
  };
  return {
    get sequence() { return sequence; },
    async seal(plaintext, aad = new Uint8Array(0)) {
      const out = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce(), additionalData: aad, tagLength: 128 }, aesKey, plaintext));
      sequence += 1;
      return out;
    },
    async open(ciphertext, aad = new Uint8Array(0)) {
      let out;
      try { out = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce(), additionalData: aad, tagLength: 128 }, aesKey, ciphertext)); }
      catch { throw Object.assign(new Error('HPKE: authentication failed'), { code: 'HPKE_OPEN_FAILED' }); }
      sequence += 1;
      return out;
    },
    export: (exporterContext, length) => labeledExpand(suiteId, exporterSecret, 'sec', exporterContext, length)
  };
}

/** Sender side: encapsulate to `recipientPublicKey` (32 raw bytes). `ephemeral` is for RFC vectors only. */
export async function setupBaseSender(recipientPublicKey, info, { suite = ATTESTED_HPKE_SUITE, ephemeral = null } = {}) {
  const pkR = await importX25519PublicKey(recipientPublicKey);
  const pair = ephemeral ?? await subtle().generateKey({ name: 'X25519' }, false, ['deriveBits']);
  const enc = await exportX25519PublicKey(pair.publicKey);
  const sharedSecret = await extractAndExpand(await dh(pair.privateKey, pkR), concatBytes(enc, recipientPublicKey));
  return { enc, context: await keySchedule(suite, sharedSecret, info) };
}

/** Recipient side: `keyPair` is the enclave's X25519 pair; its public half is the attested one. */
export async function setupBaseRecipient(enc, keyPair, info, { suite = ATTESTED_HPKE_SUITE } = {}) {
  const pkE = await importX25519PublicKey(enc);
  const pkRm = await exportX25519PublicKey(keyPair.publicKey);
  const sharedSecret = await extractAndExpand(await dh(keyPair.privateKey, pkE), concatBytes(enc, pkRm));
  return keySchedule(suite, sharedSecret, info);
}

/**
 * The response direction of one session: AES-256-GCM under a key and nonce exported from the request context
 * (the Oblivious HTTP pattern). Each frame carries its sequence number in the associated data.
 */
export async function responseCipher(context, label) {
  const key = await context.export(utf8(`${label} response key`), 32);
  const baseNonce = await context.export(utf8(`${label} response nonce`), NN);
  return createContext({ suiteId: suiteIdFor(ATTESTED_HPKE_SUITE), key, baseNonce, exporterSecret: new Uint8Array(NH) });
}
