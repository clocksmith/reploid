/**
 * @fileoverview Receipt verifier for fastest-receipt launch policy.
 */

import { webcrypto } from 'crypto';
import { canonicalize, hashJson } from './hash.js';

const textEncoder = new TextEncoder();

const base64ToBuffer = (value) => Buffer.from(String(value || ''), 'base64');

const receiptSigningPayload = (receipt = {}) => {
  const { providerSignature, requesterAcceptance, verifierDecision, ledgerEffects, ...payload } = receipt;
  return payload;
};

async function verifyProviderSignature(receipt, publicKeyBase64) {
  if (!publicKeyBase64 || !receipt.providerSignature) return false;
  const publicKey = await webcrypto.subtle.importKey(
    'spki',
    base64ToBuffer(publicKeyBase64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  return webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64ToBuffer(receipt.providerSignature),
    textEncoder.encode(canonicalize(receiptSigningPayload(receipt)))
  );
}

export async function verifyReceipt({ store, assignment, receipt }) {
  const reasons = [];
  const provider = assignment ? store.getProvider(assignment.providerId) : null;
  if (!assignment) reasons.push('assignment not found');
  if (!receipt) reasons.push('receipt missing');
  if (assignment && receipt?.assignmentId !== assignment.assignmentId) reasons.push('assignment id mismatch');
  if (assignment && receipt?.jobId !== assignment.jobId) reasons.push('job id mismatch');
  if (assignment && receipt?.providerId !== assignment.providerId) reasons.push('provider id mismatch');
  if (assignment && receipt?.requesterId !== assignment.requesterId) reasons.push('requester id mismatch');
  if (assignment && receipt?.policyId !== assignment.policyId) reasons.push('policy id mismatch');
  if (assignment && receipt?.inputHash !== assignment.inputHash) reasons.push('input hash mismatch');
  if (assignment && receipt?.generationConfigHash !== assignment.generationConfigHash) reasons.push('generation config hash mismatch');
  if (!receipt?.outputHash) reasons.push('output hash missing');
  if (!receipt?.tokenIdsHash) reasons.push('token ids hash missing');
  if (!receipt?.providerSignature) reasons.push('provider signature missing');
  if (!provider?.publicKey) reasons.push('provider public key missing');

  if (reasons.length === 0) {
    try {
      const signatureOk = await verifyProviderSignature(receipt, provider.publicKey);
      if (!signatureOk) reasons.push('provider signature invalid');
    } catch (error) {
      reasons.push(`provider signature verification failed: ${error.message}`);
    }
  }

  const receiptHash = hashJson(receipt);
  return {
    receiptHash,
    accepted: reasons.length === 0,
    reasons,
    verifiedAt: new Date().toISOString()
  };
}

export default {
  verifyReceipt
};
