import { canonicalize as stableJson } from './canonical-json.js';
import { wholeModelReceiptFields } from './whole-model-receipt.js';
import { sha256HexUnprefixed } from './signatures.js';
/**
 * @fileoverview Signed receipt primitives for swarm contribution proof.
 */

import {
  encodeBytes,
  getIdentitySignAlgorithm,
  importSigningKey,
  importVerificationKey,
  toBase64Url,
  fromBase64Url,
  createPeerIdFromPublicJwk
} from './identity.js';



const getCryptoApi = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle) {
    throw new Error('WebCrypto unavailable');
  }
  return api;
};


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
    timestamp: Number(receipt.timestamp || Date.now()),
    ...(Number(receipt.version) === 2 ? wholeModelReceiptFields({ ...receipt, version: 2 }) : {})
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
  const digest = await sha256HexUnprefixed(canonicalizeReceiptPayload(payload), getCryptoApi(cryptoApi));

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
  if (payload.version === 2 && (await createPeerIdFromPublicJwk(receipt.providerKey, cryptoApi) !== receipt.provider
    || receipt.consumerSignature && await createPeerIdFromPublicJwk(receipt.consumerKey, cryptoApi) !== receipt.consumer)) {
    return { providerValid: false, consumerValid: false, valid: false };
  }

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
