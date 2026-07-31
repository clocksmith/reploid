/**
 * @fileoverview Receipt-to-assignment agreement rules for Poolday peers.
 */

import { SIGNATURE_DOMAINS } from './inference-receipt.js';
import { LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS } from './model-contract.js';
import {
  agreementFieldForWorkload,
  isSequenceWorkload
} from './sequence-workload.js';

export function receiptAgreementValue(receipt = {}, agreementField = 'tokenIdsHash') {
  if (receipt[agreementField]) return receipt[agreementField];
  if (agreementField === 'tokenIdsHash') return receipt.tokenIdsHash || null;
  if (agreementField === 'outputHash') return receipt.outputHash || null;
  if (agreementField === 'vectorHash') return receipt.vectorHash || null;
  return null;
}

export function receiptMatchesAssignment(receipt = {}, assignment = {}) {
  const reasons = [];
  if (receipt.assignmentId !== assignment.assignmentId) reasons.push('receipt assignmentId mismatch');
  if (receipt.routeDecisionHash !== assignment.routeDecisionHash) reasons.push('receipt routeDecisionHash mismatch');
  if (receipt.jobId !== assignment.jobId) reasons.push('receipt jobId mismatch');
  if (receipt.requesterId !== assignment.requesterId) reasons.push('receipt requesterId mismatch');
  if (receipt.providerId !== assignment.providerId) reasons.push('receipt providerId mismatch');
  if (receipt.policyId !== assignment.policyId) reasons.push('receipt policyId mismatch');
  if (receipt.inputHash !== assignment.inputHash) reasons.push('receipt inputHash mismatch');
  if (receipt.generationConfigHash !== assignment.generationConfigHash) reasons.push('receipt generationConfigHash mismatch');
  if (receipt.model?.id !== assignment.model?.id) reasons.push('receipt model id mismatch');
  if (receipt.model?.hash !== assignment.model?.hash) reasons.push('receipt model hash mismatch');
  if (receipt.model?.manifestHash !== assignment.model?.manifestHash) reasons.push('receipt manifest hash mismatch');
  if ((receipt.model?.runtime || LAUNCH_MODEL.runtime) !== (assignment.model?.runtime || LAUNCH_MODEL.runtime)) reasons.push('receipt runtime mismatch');
  if ((receipt.model?.backend || LAUNCH_MODEL.backend) !== (assignment.model?.backend || LAUNCH_MODEL.backend)) reasons.push('receipt backend mismatch');
  if ((receipt.model?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding)
    !== (assignment.model?.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding)) reasons.push('receipt workload mismatch');
  const expectedAdapter = assignment.adapter || assignment.model?.requirements?.adapter || null;
  const actualAdapter = receipt.adapter || null;
  if (!expectedAdapter && actualAdapter) reasons.push('receipt declares an adapter absent from the assignment');
  if (expectedAdapter && !actualAdapter) reasons.push('receipt adapter identity missing');
  if (expectedAdapter && actualAdapter) {
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
      if (actualAdapter[field] !== expectedAdapter[field]) reasons.push(`receipt adapter ${field} mismatch`);
    }
    if (actualAdapter.adapterUseApprovalHash !== assignment.adapterUseApproval?.approvalHash) {
      reasons.push('receipt adapter use approval hash mismatch');
    }
    if (actualAdapter.state !== 'active') reasons.push('receipt adapter was not active');
    if (!Array.isArray(actualAdapter.artifactSources) || actualAdapter.artifactSources.length === 0) {
      reasons.push('receipt adapter acquisition source evidence missing');
    } else if (!actualAdapter.artifactSources.some((source) => (
      ['cache', 'peer', 'origin'].includes(source?.source)
      && source?.packHash === expectedAdapter.packHash
      && source?.adapterSha256 === expectedAdapter.adapterSha256
    ))) {
      reasons.push('receipt adapter acquisition source evidence mismatch');
    }
  }
  if (!receipt.providerSignature) reasons.push('receipt providerSignature is required');
  if (receipt.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) reasons.push('receipt signature domain mismatch');
  if (!receipt.outputHash) reasons.push('receipt outputHash is required');
  const workload = assignment.workload
    || assignment.model?.workload
    || assignment.model?.requirements?.workload
    || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding;
  const agreementField = agreementFieldForWorkload(workload);
  if (!receipt[agreementField]) reasons.push(`receipt ${agreementField} is required`);
  if (isSequenceWorkload(workload)) {
    if (receipt.sequence?.requestHash !== assignment.sequenceRequestHash) reasons.push('receipt sequence request hash mismatch');
    if (receipt.sequence?.sequenceHash !== assignment.inputHash) reasons.push('receipt sequence input hash mismatch');
  }
  return reasons;
}
