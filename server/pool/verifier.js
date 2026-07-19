/**
 * @fileoverview Receipt verifier for fastest-receipt launch policy.
 */

import { webcrypto } from 'crypto';
import { canonicalize, hashJson, sha256Hex } from './hash.js';
import { PROVIDER_RECEIPT_TRUST_TIER, RECEIPT_VERSION } from './receipt-contract.js';
import { getRingPhaseProtocol } from './config.js';
import { revealMatchesCommitment } from './commit-reveal.js';
import { isSequenceWorkload } from '../../self/pool/sequence-workload.js';

const textEncoder = new TextEncoder();
const SIGNATURE_DOMAINS = Object.freeze({
  providerReceipt: 'poolday.provider_receipt.v1',
  requesterAcceptance: 'poolday.requester_acceptance.v1'
});

const base64ToBuffer = (value) => Buffer.from(String(value || ''), 'base64');

const receiptSigningPayload = (receipt = {}) => {
  const { providerSignature, requesterAcceptance, verifierDecision, ledgerEffects, ...payload } = receipt;
  return payload;
};

const domainSeparatedPayload = (domain, payload) => ({
  signatureDomain: domain,
  payload
});

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
    textEncoder.encode(canonicalize(domainSeparatedPayload(
      SIGNATURE_DOMAINS.providerReceipt,
      receiptSigningPayload(receipt)
    )))
  );
}

const compareModel = (assignment, receipt, reasons) => {
  const expected = assignment?.model || {};
  const actual = receipt?.model || {};
  const expectedWorkload = expected.workload || expected.requirements?.workload || null;
  const actualWorkload = actual.workload || actual.requirements?.workload || null;
  const expectedExecutionMode = expected.executionMode || expected.requirements?.executionMode || null;
  const actualExecutionMode = actual.executionMode || actual.requirements?.executionMode || null;
  if (expected.id && actual.id !== expected.id) reasons.push('model id mismatch');
  if (expected.hash && actual.hash !== expected.hash) reasons.push('model hash mismatch');
  if (expected.manifestHash && actual.manifestHash !== expected.manifestHash) reasons.push('manifest hash mismatch');
  if (expected.runtime && actual.runtime !== expected.runtime) reasons.push('runtime mismatch');
  if (expected.backend && actual.backend !== expected.backend) reasons.push('backend mismatch');
  if (expectedWorkload && actualWorkload !== expectedWorkload) reasons.push('model workload mismatch');
  if (expectedExecutionMode && actualExecutionMode !== expectedExecutionMode) reasons.push('model execution mode mismatch');
};

const compareRuntime = (assignment, receipt, reasons) => {
  const expected = assignment?.model || {};
  const actual = receipt?.runtime || {};
  if (expected.runtime && actual.runtime !== expected.runtime) reasons.push('receipt runtime identity mismatch');
  if (expected.backend && actual.backend !== expected.backend) reasons.push('receipt backend identity mismatch');
};

const compareAdapter = (assignment, receipt, reasons) => {
  const expected = assignment?.adapter || assignment?.model?.requirements?.adapter || null;
  const actual = receipt?.adapter || null;
  if (!expected) {
    if (actual) reasons.push('receipt declares an adapter absent from the assignment');
    return;
  }
  if (!actual) {
    reasons.push('receipt adapter identity missing');
    return;
  }
  for (const field of [
    'schema',
    'packHash',
    'adapterId',
    'adapterSha256',
    'baseModelId',
    'baseModelHash',
    'baseManifestHash',
    'humanPromotionReceiptHash',
    'dopplerParityReceiptHash',
    'gammaSelectionReceiptHash',
    'publicationHash',
    'publisherId'
  ]) {
    if (actual[field] !== expected[field]) reasons.push(`receipt adapter ${field} mismatch`);
  }
  if (actual.adapterUseApprovalHash !== assignment.adapterUseApproval?.approvalHash) {
    reasons.push('receipt adapter use approval hash mismatch');
  }
  if (actual.state !== 'active') reasons.push('receipt adapter was not active');
  if (!Array.isArray(actual.artifactSources) || actual.artifactSources.length === 0) {
    reasons.push('receipt adapter acquisition source evidence missing');
  } else if (!actual.artifactSources.some((source) => (
    ['cache', 'peer', 'origin'].includes(source?.source)
    && source?.packHash === expected.packHash
    && source?.adapterSha256 === expected.adapterSha256
  ))) {
    reasons.push('receipt adapter acquisition source evidence mismatch');
  }
};

const sequenceResultPayload = (value = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { requestHash, resultHash, ...result } = value;
  return result;
};

export async function verifyReceipt({
  store,
  assignment,
  receipt,
  outputText = '',
  tokenIds = [],
  vectorHash = null,
  sequenceResultHash = null,
  sequenceResult = null,
  transcript = null
}) {
  const reasons = [];
  const workload = assignment?.workload
    || assignment?.model?.workload
    || assignment?.model?.requirements?.workload
    || 'text_generation';
  const provider = assignment ? await store.getProvider(assignment.providerId) : null;
  if (!assignment) reasons.push('assignment not found');
  if (!receipt) reasons.push('receipt missing');
  if (receipt?.receiptVersion !== RECEIPT_VERSION) reasons.push('receipt version mismatch');
  if (receipt?.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) reasons.push('receipt signature domain mismatch');
  if (receipt?.trustTier !== PROVIDER_RECEIPT_TRUST_TIER) reasons.push('trust tier mismatch');
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
  if (assignment?.policyConfigVersion && receipt?.policyConfigVersion !== assignment.policyConfigVersion) reasons.push('policy config version mismatch');
  if (assignment?.policyConfigHash && receipt?.policyConfigHash !== assignment.policyConfigHash) reasons.push('policy config hash mismatch');
  if (assignment && receipt?.inputHash !== assignment.inputHash) reasons.push('input hash mismatch');
  if (assignment && receipt?.generationConfigHash !== assignment.generationConfigHash) reasons.push('generation config hash mismatch');
  if (assignment?.auditId && receipt?.verification?.canaryId !== assignment.auditId) reasons.push('canary id mismatch');
  if (assignment?.redundancyGroupSize && Number(receipt?.verification?.redundancyGroupSize || 1) !== Number(assignment.redundancyGroupSize)) {
    reasons.push('redundancy group size mismatch');
  }
  if (assignment?.requiredAgreement && Number(receipt?.verification?.requiredAgreement || 1) !== Number(assignment.requiredAgreement)) {
    reasons.push('required agreement mismatch');
  }
  if (assignment?.ring) {
    const receiptRing = receipt?.verification?.ring || {};
    for (const field of ['ringId', 'ringSeed', 'ringAttemptId', 'ringSize', 'requiredAgreement', 'effectiveTrustTier', 'agreementField', 'layoutHash', 'providerIndex', 'predecessorId', 'successorId', 'determinismProfileId', 'ringPhaseProtocolId', 'providerAdmissionPolicyId', 'runtimeProfileBucket', 'admissionLane']) {
      if (assignment.ring[field] !== receiptRing[field]) reasons.push(`ring ${field} mismatch`);
    }
    if (hashJson(assignment.ring.providerIds || []) !== hashJson(receiptRing.providerIds || [])) {
      reasons.push('ring provider ids mismatch');
    }
    if (assignment.runtimeProfileHash && receipt?.verification?.runtimeProfileHash !== assignment.runtimeProfileHash) {
      reasons.push('runtime profile hash mismatch');
    }
    const phaseProtocol = getRingPhaseProtocol(assignment.ring.ringPhaseProtocolId);
    if (phaseProtocol?.requireRevealBeforeReceipt) {
      if (typeof store.getAssignmentCommitment !== 'function' || typeof store.getAssignmentReveal !== 'function') {
        reasons.push('commit-reveal store support missing');
      } else {
        const commitment = await store.getAssignmentCommitment(assignment.assignmentId);
        const reveal = await store.getAssignmentReveal(assignment.assignmentId);
        if (!commitment) reasons.push('ring commitment missing');
        if (!reveal) reasons.push('ring reveal missing');
        if (commitment && reveal) {
          const commitmentCheck = revealMatchesCommitment({ commitment, reveal });
          if (!commitmentCheck.ok) reasons.push('ring reveal does not match commitment');
          if (receipt?.outputHash !== reveal.outputHash) reasons.push('receipt outputHash does not match reveal');
          if (receipt?.tokenIdsHash !== reveal.tokenIdsHash) reasons.push('receipt tokenIdsHash does not match reveal');
          if (reveal.vectorHash && receipt?.vectorHash !== reveal.vectorHash) reasons.push('receipt vectorHash does not match reveal');
          if (reveal.sequenceResultHash && receipt?.sequenceResultHash !== reveal.sequenceResultHash) {
            reasons.push('receipt sequenceResultHash does not match reveal');
          }
          if (receipt?.transcriptHash !== reveal.transcriptHash) reasons.push('receipt transcriptHash does not match reveal');
        }
      }
    }
  }
  if (!receipt?.outputHash) reasons.push('output hash missing');
  if (!receipt?.tokenIdsHash) reasons.push('token ids hash missing');
  if (workload === 'embedding' && !receipt?.vectorHash) {
    reasons.push('vector hash missing');
  }
  if (isSequenceWorkload(workload) && !receipt?.sequenceResultHash) reasons.push('sequence result hash missing');
  if (!receipt?.transcriptHash) reasons.push('transcript hash missing');
  if (!receipt?.providerSignature) reasons.push('provider signature missing');
  if (!provider?.publicKey) reasons.push('provider public key missing');
  if (!Array.isArray(tokenIds)) reasons.push('submitted tokenIds must be an array');
  compareModel(assignment, receipt, reasons);
  compareRuntime(assignment, receipt, reasons);
  compareAdapter(assignment, receipt, reasons);

  if (receipt?.outputHash && receipt.outputHash !== sha256Hex(outputText)) {
    reasons.push('output hash does not match submitted outputText');
  }
  if (receipt?.tokenIdsHash && Array.isArray(tokenIds) && receipt.tokenIdsHash !== hashJson(tokenIds)) {
    reasons.push('token ids hash does not match submitted tokenIds');
  }
  if (vectorHash && receipt?.vectorHash !== vectorHash) {
    reasons.push('vector hash does not match submitted vectorHash');
  }
  if (sequenceResultHash && receipt?.sequenceResultHash !== sequenceResultHash) {
    reasons.push('sequence result hash does not match submitted sequenceResultHash');
  }
  if (isSequenceWorkload(workload)) {
    const submittedSequenceResult = sequenceResultPayload(sequenceResult || receipt?.sequence);
    const receiptSequenceResult = sequenceResultPayload(receipt?.sequence);
    if (!submittedSequenceResult) reasons.push('submitted sequence result is missing');
    if (!receiptSequenceResult) reasons.push('receipt sequence result is missing');
    if (submittedSequenceResult && hashJson(submittedSequenceResult) !== receipt?.sequenceResultHash) {
      reasons.push('submitted sequence result does not match sequenceResultHash');
    }
    if (receiptSequenceResult && hashJson(receiptSequenceResult) !== receipt?.sequenceResultHash) {
      reasons.push('receipt sequence result does not match sequenceResultHash');
    }
    if (receipt?.sequence?.resultHash !== receipt?.sequenceResultHash) reasons.push('receipt sequence resultHash mismatch');
    if (receipt?.sequence?.sequenceHash !== assignment?.inputHash) reasons.push('receipt sequence input hash mismatch');
    const requestHash = assignment?.sequenceRequestHash || hashJson(assignment?.sequenceRequest || null);
    if (receipt?.sequence?.requestHash !== requestHash) reasons.push('receipt sequence request hash mismatch');
    if (receipt?.sequence?.workload !== workload) reasons.push('receipt sequence workload mismatch');
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

const sameStringArray = (left = [], right = []) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
);

export async function verifyRequesterAcceptance({ job, acceptance, expectedAcceptance = null }) {
  const reasons = [];
  if (!job) reasons.push('job not found');
  if (!acceptance) reasons.push('acceptance missing');
  if (acceptance?.signatureDomain !== SIGNATURE_DOMAINS.requesterAcceptance) reasons.push('acceptance signature domain mismatch');
  if (typeof acceptance?.accepted !== 'boolean') reasons.push('acceptance accepted flag must be boolean');
  if (!acceptance?.receiptHash) reasons.push('acceptance receiptHash is required');
  if (!acceptance?.requesterSignature) reasons.push('requester signature missing');
  if (!job?.requesterPublicKey) reasons.push('requester public key missing');
  if (job?.requesterId && acceptance?.requesterId !== job.requesterId) {
    reasons.push('acceptance requester id mismatch');
  }
  const allowedReceiptHashes = new Set([
    job?.receiptHash,
    ...(Array.isArray(job?.receiptHashes) ? job.receiptHashes : []),
    ...(Array.isArray(job?.acceptedReceiptHashes) ? job.acceptedReceiptHashes : [])
  ].filter(Boolean));
  if (allowedReceiptHashes.size > 0 && !allowedReceiptHashes.has(acceptance?.receiptHash)) {
    reasons.push('acceptance receiptHash mismatch');
  }
  if (acceptance?.accepted === true && expectedAcceptance) {
    if (acceptance.jobId !== expectedAcceptance.jobId) reasons.push('acceptance jobId mismatch');
    if (acceptance.policyId !== expectedAcceptance.policyId) reasons.push('acceptance policyId mismatch');
    if (acceptance.policyConfigVersion !== expectedAcceptance.policyConfigVersion) reasons.push('acceptance policyConfigVersion mismatch');
    if (acceptance.policyConfigHash !== expectedAcceptance.policyConfigHash) reasons.push('acceptance policyConfigHash mismatch');
    if (acceptance.agreementHash !== expectedAcceptance.agreementHash) reasons.push('acceptance agreementHash mismatch');
    if (!sameStringArray(acceptance.receiptHashes, expectedAcceptance.receiptHashes)) {
      reasons.push('acceptance receiptHashes mismatch');
    }
    if (Number(acceptance.pointSpend) !== Number(expectedAcceptance.pointSpend)) {
      reasons.push('acceptance pointSpend mismatch');
    }
    if (hashJson(acceptance.providerPoints || []) !== hashJson(expectedAcceptance.providerPoints || [])) {
      reasons.push('acceptance providerPoints mismatch');
    }
  }

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
        textEncoder.encode(canonicalize(domainSeparatedPayload(
          SIGNATURE_DOMAINS.requesterAcceptance,
          acceptanceSigningPayload(acceptance)
        )))
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
