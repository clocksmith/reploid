/**
 * @fileoverview Requester-acceptance summary construction for verified Pool receipts.
 */

import { POOL_CONFIG_HASH, POOL_CONFIG_VERSION } from '../config.js';
import { deriveProviderAdmission } from '../runtime-profile.js';
import { calculateReceiptPoints } from '../points.js';
import { getPolicy } from '../policy-router.js';
import { hashJson } from '../hash.js';

export function compactAgreementForAcceptance(agreement = null) {
  if (!agreement) return null;
  return {
    mode: agreement.mode || null,
    status: agreement.status || null,
    requiredAgreement: Number(agreement.requiredAgreement || agreement.requiredProviders || 1),
    providerCount: Number(agreement.providerCount || 1),
    agreementField: agreement.agreementField || 'tokenIdsHash',
    outputHash: agreement.outputHash || null,
    tokenIdsHash: agreement.tokenIdsHash || null,
    vectorHash: agreement.vectorHash || null,
    sequenceResultHash: agreement.sequenceResultHash || null,
    effectiveTrustTier: agreement.effectiveTrustTier || null
  };
}

export async function buildAcceptanceSummary({ store, job, receiptHash } = {}) {
  const receiptHashes = Array.isArray(job?.agreement?.receiptHashes) && job.agreement.status === 'accepted'
    ? job.agreement.receiptHashes
    : [receiptHash];
  const agreedRecords = [];
  for (const currentReceiptHash of receiptHashes) {
    const agreedRecord = await store.getReceipt(currentReceiptHash);
    if (agreedRecord?.verifierDecision?.accepted) agreedRecords.push(agreedRecord);
  }
  const multiplier = 1 / Math.max(1, receiptHashes.length);
  const providerPoints = [];
  for (const record of agreedRecords) {
    const provider = await store.getProvider?.(record.providerId);
    const reputation = await store.getReputation?.(record.providerId);
    const admission = deriveProviderAdmission({
      provider: provider || {},
      reputation: reputation || {},
      policy: getPolicy(job?.policyId) || {}
    });
    const uncappedPoints = calculateReceiptPoints(record, { multiplier });
    const cap = record.providerAdmission?.earningsCapPerAcceptance ?? admission?.lane?.earningsCapPerAcceptance;
    providerPoints.push({
      receiptHash: record.receiptHash,
      providerId: record.providerId,
      points: Number.isFinite(Number(cap)) ? Math.min(uncappedPoints, Number(cap)) : uncappedPoints
    });
  }
  const pointSpend = providerPoints.reduce((sum, entry) => sum + entry.points, 0);
  const payload = {
    jobId: job?.jobId || null,
    requesterId: job?.requesterId || null,
    policyId: job?.policyId || null,
    policyConfigVersion: job?.policyConfigVersion || POOL_CONFIG_VERSION,
    policyConfigHash: job?.policyConfigHash || POOL_CONFIG_HASH,
    receiptHash,
    receiptHashes,
    agreement: compactAgreementForAcceptance(job?.agreement || null),
    pointSpend,
    providerPoints
  };
  return {
    ...payload,
    agreementHash: hashJson(payload),
    agreedRecords,
    multiplier,
    totalProviderPoints: pointSpend
  };
}
