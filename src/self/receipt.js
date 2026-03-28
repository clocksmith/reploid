/**
 * @fileoverview Signed receipt primitives for swarm contribution proof.
 */

import {
  encodeBytes,
  getIdentitySignAlgorithm,
  importSigningKey,
  importVerificationKey,
  toBase64Url,
  fromBase64Url
} from './identity.js';

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

async function sha256Hex(text, cryptoApi = globalThis.crypto) {
  const digest = await getCryptoApi(cryptoApi).subtle.digest('SHA-256', encodeBytes(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getReceiptPayload(receipt = {}) {
  return {
    version: Number(receipt.version || 1),
    receiptId: String(receipt.receiptId || ''),
    provider: String(receipt.provider || ''),
    consumer: String(receipt.consumer || ''),
    jobHash: String(receipt.jobHash || ''),
    model: String(receipt.model || ''),
    inputTokens: Math.max(0, Number(receipt.inputTokens || 0)),
    outputTokens: Math.max(0, Number(receipt.outputTokens || 0)),
    status: String(receipt.status || 'completed'),
    timestamp: Number(receipt.timestamp || Date.now())
  };
}

export function canonicalizeReceiptPayload(receipt = {}) {
  return stableJson(getReceiptPayload(receipt));
}

export async function createReceiptDraft(input = {}, cryptoApi = globalThis.crypto) {
  const payload = getReceiptPayload({
    ...input,
    receiptId: ''
  });
  const digest = await sha256Hex(canonicalizeReceiptPayload(payload), cryptoApi);

  return {
    ...payload,
    receiptId: String(input.receiptId || `receipt:${digest.slice(0, 24)}`)
  };
}

async function signPayload(payload, bundle, cryptoApi = globalThis.crypto) {
  const subtle = getCryptoApi(cryptoApi).subtle;
  const signingKey = await importSigningKey(bundle, cryptoApi);
  const signature = await subtle.sign(
    getIdentitySignAlgorithm(bundle),
    signingKey,
    encodeBytes(canonicalizeReceiptPayload(payload))
  );
  return toBase64Url(signature);
}

async function verifyPayload(payload, signature, publicJwk, cryptoApi = globalThis.crypto) {
  const subtle = getCryptoApi(cryptoApi).subtle;
  const verificationKey = await importVerificationKey(publicJwk, cryptoApi);
  return subtle.verify(
    getIdentitySignAlgorithm(publicJwk),
    verificationKey,
    fromBase64Url(signature),
    encodeBytes(canonicalizeReceiptPayload(payload))
  );
}

export async function signReceiptDraft(draft, providerBundle, cryptoApi = globalThis.crypto) {
  const payload = getReceiptPayload(draft);
  return {
    ...payload,
    providerSignature: await signPayload(payload, providerBundle, cryptoApi),
    providerKey: providerBundle.publicJwk
  };
}

export async function countersignReceipt(receipt, consumerBundle, cryptoApi = globalThis.crypto) {
  const payload = getReceiptPayload(receipt);
  return {
    ...receipt,
    consumerSignature: await signPayload(payload, consumerBundle, cryptoApi),
    consumerKey: consumerBundle.publicJwk
  };
}

export async function verifyReceipt(receipt, cryptoApi = globalThis.crypto) {
  const payload = getReceiptPayload(receipt);

  const providerValid = receipt?.providerSignature && receipt?.providerKey
    ? await verifyPayload(payload, receipt.providerSignature, receipt.providerKey, cryptoApi)
    : false;

  const consumerValid = !receipt?.consumerSignature || !receipt?.consumerKey
    ? false
    : await verifyPayload(payload, receipt.consumerSignature, receipt.consumerKey, cryptoApi);

  return {
    providerValid,
    consumerValid,
    valid: providerValid && (!receipt?.consumerSignature || consumerValid)
  };
}

export default {
  canonicalizeReceiptPayload,
  countersignReceipt,
  createReceiptDraft,
  getReceiptPayload,
  signReceiptDraft,
  verifyReceipt
};
