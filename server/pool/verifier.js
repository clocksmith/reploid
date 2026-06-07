/**
 * @fileoverview Receipt verifier for fastest-receipt launch policy.
 */

import { webcrypto } from 'crypto';
import { canonicalize, hashJson, sha256Hex } from './hash.js';

const textEncoder = new TextEncoder();
const RECEIPT_VERSION = 'reploid_browser_inference/v1';
const TRUST_TIER_SIGNED_RECEIPT = 'T1_signed_receipt';

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

const compareModel = (assignment, receipt, reasons) => {
  const expected = assignment?.model || {};
  const actual = receipt?.model || {};
  if (expected.id && actual.id !== expected.id) reasons.push('model id mismatch');
  if (expected.hash && actual.hash !== expected.hash) reasons.push('model hash mismatch');
  if (expected.manifestHash && actual.manifestHash !== expected.manifestHash) reasons.push('manifest hash mismatch');
  if (expected.runtime && actual.runtime !== expected.runtime) reasons.push('runtime mismatch');
  if (expected.backend && actual.backend !== expected.backend) reasons.push('backend mismatch');
};

export async function verifyReceipt({ store, assignment, receipt, outputText = '', tokenIds = [], transcript = null }) {
  const reasons = [];
  const provider = assignment ? store.getProvider(assignment.providerId) : null;
  if (!assignment) reasons.push('assignment not found');
  if (!receipt) reasons.push('receipt missing');
  if (receipt?.receiptVersion !== RECEIPT_VERSION) reasons.push('receipt version mismatch');
  if (receipt?.trustTier !== TRUST_TIER_SIGNED_RECEIPT) reasons.push('trust tier mismatch');
  if (assignment?.expiresAt && Date.parse(assignment.expiresAt) < Date.now()) reasons.push('assignment expired');
  if (assignment?.prompt && assignment.inputHash !== sha256Hex(assignment.prompt)) {
    reasons.push('assignment inputHash does not match stored prompt');
  }
  if (assignment?.generationConfig && assignment.generationConfigHash !== hashJson(assignment.generationConfig)) {
    reasons.push('assignment generationConfigHash does not match stored generation config');
  }
  if (assignment && receipt?.assignmentId !== assignment.assignmentId) reasons.push('assignment id mismatch');
  if (assignment && receipt?.jobId !== assignment.jobId) reasons.push('job id mismatch');
  if (assignment && receipt?.providerId !== assignment.providerId) reasons.push('provider id mismatch');
  if (assignment && receipt?.requesterId !== assignment.requesterId) reasons.push('requester id mismatch');
  if (assignment && receipt?.policyId !== assignment.policyId) reasons.push('policy id mismatch');
  if (assignment && receipt?.inputHash !== assignment.inputHash) reasons.push('input hash mismatch');
  if (assignment && receipt?.generationConfigHash !== assignment.generationConfigHash) reasons.push('generation config hash mismatch');
  if (!receipt?.outputHash) reasons.push('output hash missing');
  if (!receipt?.tokenIdsHash) reasons.push('token ids hash missing');
  if (!receipt?.transcriptHash) reasons.push('transcript hash missing');
  if (!receipt?.providerSignature) reasons.push('provider signature missing');
  if (!provider?.publicKey) reasons.push('provider public key missing');
  if (!Array.isArray(tokenIds)) reasons.push('submitted tokenIds must be an array');
  compareModel(assignment, receipt, reasons);

  if (receipt?.outputHash && receipt.outputHash !== sha256Hex(outputText)) {
    reasons.push('output hash does not match submitted outputText');
  }
  if (receipt?.tokenIdsHash && Array.isArray(tokenIds) && receipt.tokenIdsHash !== hashJson(tokenIds)) {
    reasons.push('token ids hash does not match submitted tokenIds');
  }
  const submittedTranscript = transcript || { outputText, tokenIds: Array.isArray(tokenIds) ? tokenIds : [] };
  if (receipt?.transcriptHash && receipt.transcriptHash !== hashJson(submittedTranscript)) {
    reasons.push('transcript hash does not match submitted transcript');
  }

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

const acceptanceSigningPayload = (acceptance = {}) => {
  const { requesterSignature, ...payload } = acceptance;
  return payload;
};

export async function verifyRequesterAcceptance({ job, acceptance }) {
  const reasons = [];
  if (!job) reasons.push('job not found');
  if (!acceptance) reasons.push('acceptance missing');
  if (typeof acceptance?.accepted !== 'boolean') reasons.push('acceptance accepted flag must be boolean');
  if (!acceptance?.receiptHash) reasons.push('acceptance receiptHash is required');
  if (!acceptance?.requesterSignature) reasons.push('requester signature missing');
  if (!job?.requesterPublicKey) reasons.push('requester public key missing');
  if (job?.receiptHash && acceptance?.receiptHash !== job.receiptHash) reasons.push('acceptance receiptHash mismatch');

  if (reasons.length === 0) {
    try {
      const publicKey = await webcrypto.subtle.importKey(
        'spki',
        base64ToBuffer(job.requesterPublicKey),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      const signatureOk = await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        base64ToBuffer(acceptance.requesterSignature),
        textEncoder.encode(canonicalize(acceptanceSigningPayload(acceptance)))
      );
      if (!signatureOk) reasons.push('requester signature invalid');
    } catch (error) {
      reasons.push(`requester signature verification failed: ${error.message}`);
    }
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    verifiedAt: new Date().toISOString()
  };
}

export default {
  verifyReceipt,
  verifyRequesterAcceptance
};
