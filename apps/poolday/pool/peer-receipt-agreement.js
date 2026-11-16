import { calculateReceiptPoints, canonicalize, hashJson, receiptSigningPayload, sha256Hex, SIGNATURE_DOMAINS, verifyCanonicalSignature } from "../../../shared/pool/inference-receipt.js";
import { getPolicy } from "../../../shared/pool/config.js";

import { assertPackReceipt } from '../../../shared/pool/executable-pack.js';

import {
  P2P_PAYLOAD_TYPES,
  validateP2PPayload
} from './p2p-payload.js';
import { isSequenceWorkload } from "../../../shared/pool/sequence-workload.js";
import { validateSequenceOutputIntegrity } from './sequence-result.js';

import {
  receiptAgreementValue,
  receiptMatchesAssignment
} from './peer-agreement.js';

export async function buildPeerReceiptAgreement({
  plan,
  receiptPayloads = []
} = {}) {
  if (!Array.isArray(plan?.assignments) || plan.assignments.length === 0) {
    throw new TypeError('plan.assignments is required');
  }
  const assignmentsById = new Map(plan.assignments.map((assignment) => [assignment.assignmentId, assignment]));
  const requiredAgreement = Math.max(1, Number(plan.ring?.requiredAgreement || plan.assignment?.requiredAgreement || 1));
  const agreementField = plan.ring?.agreementField || plan.assignment?.agreementField || 'tokenIdsHash';
  const policy = getPolicy(plan.assignment?.policyId || plan.assignments[0]?.policyId);
  const pointMultiplier = Number(policy?.pointCostMultiplier || 1);
  const maxPointSpend = plan.assignment?.maxPointSpend ?? plan.assignments[0]?.maxPointSpend ?? null;
  const validRecords = [];
  const rejectedRecords = [];
  for (const receiptPayload of receiptPayloads) {
    const validation = validateP2PPayload(receiptPayload);
    const reasons = [...validation.reasons];
    if (receiptPayload?.type !== P2P_PAYLOAD_TYPES.RECEIPT) reasons.push('payload type must be receipt');
    const assignment = assignmentsById.get(receiptPayload?.assignmentId);
    if (!assignment) reasons.push('assignment not in plan');
    const receipt = receiptPayload?.body?.receipt || null;
    if (!receipt) reasons.push('receipt body is required');
    if (assignment && receipt) {
      reasons.push(...receiptMatchesAssignment(receipt, assignment));
      const requiredPack = assignment.model?.requirements?.executablePack || assignment.model?.executablePack;
      if (requiredPack) {
        try { await assertPackReceipt(requiredPack, receipt.dopplerProviderReceipt, { assignment }); }
        catch (error) { reasons.push(error.message); }
      }

      const providerPublicKey = assignment.providerPublicKey
        || receiptPayload?.body?.providerPublicKey
        || receiptPayload?.publicKey
        || receipt.providerPublicKey;
      if (!providerPublicKey) {
        reasons.push('assignment providerPublicKey is missing for verification');
      } else if (receipt.providerSignature) {
        try {
          const sigOk = await verifyCanonicalSignature(
            receiptSigningPayload(receipt),
            providerPublicKey,
            receipt.providerSignature,
            { domain: SIGNATURE_DOMAINS.providerReceipt }
          );
          if (!sigOk) reasons.push('receipt providerSignature verification failed');
        } catch (err) {
          reasons.push(`receipt providerSignature verification error: ${err.message}`);
        }
      }

      const bodyOutputText = receiptPayload?.body?.outputText;
      if (typeof bodyOutputText === 'string' && bodyOutputText.length > 0) {
        const computedOutputHash = await sha256Hex(bodyOutputText);
        if (receipt.outputHash && computedOutputHash !== receipt.outputHash) {
          reasons.push(`receipt outputHash mismatch with returned outputText (${computedOutputHash} vs ${receipt.outputHash})`);
        }
      }

      const bodyTokenIds = receiptPayload?.body?.tokenIds;
      if (Array.isArray(bodyTokenIds) && bodyTokenIds.length > 0) {
        const computedTokenIdsHash = await sha256Hex(canonicalize(bodyTokenIds));
        if (receipt.tokenIdsHash && computedTokenIdsHash !== receipt.tokenIdsHash) {
          reasons.push(`receipt tokenIdsHash mismatch with returned tokenIds (${computedTokenIdsHash} vs ${receipt.tokenIdsHash})`);
        }
      }

      if (isSequenceWorkload(assignment.workload)) {
        const expectedSequenceResultHash = receipt.sequenceResultHash || receipt.sequence?.resultHash || null;
        if (receiptPayload?.body?.sequenceResultHash !== expectedSequenceResultHash) {
          reasons.push('sequenceResultHash does not match the signed receipt');
        }
        const sequenceValidation = await validateSequenceOutputIntegrity({
          sequenceResult: receiptPayload?.body?.sequenceResult,
          sequenceOutput: receiptPayload?.body?.sequenceOutput,
          expectedResultHash: expectedSequenceResultHash
        });
        reasons.push(...sequenceValidation.reasons);
      }
    }
    const receiptHash = receipt ? await hashJson(receipt) : null;
    if (receiptPayload?.body?.receiptHash && receiptPayload.body.receiptHash !== receiptHash) {
      reasons.push('receiptHash mismatch');
    }
    const agreementValue = receipt ? receiptAgreementValue(receipt, agreementField) : null;
    if (!agreementValue) reasons.push(`${agreementField} is required for agreement`);
    if (reasons.length > 0) {
      rejectedRecords.push({
        receiptPayload,
        receiptHash,
        reasons
      });
      continue;
    }
    validRecords.push({
      assignment,
      receiptPayload,
      receipt,
      receiptHash,
      providerId: assignment.providerId,
      providerPublicKey: assignment.providerPublicKey || receiptPayload?.body?.providerPublicKey || receipt.providerPublicKey,
      agreementValue,
      outputHash: receipt.outputHash,
      tokenIdsHash: receipt.tokenIdsHash,
      vectorHash: receipt.vectorHash || null,
      sequenceResultHash: receipt.sequenceResultHash || null
    });
  }
  const groups = new Map();
  for (const record of validRecords) {
    const bucket = groups.get(record.agreementValue) || [];
    const isDuplicate = bucket.some((existing) => (
      existing.providerId === record.providerId ||
      (existing.providerPublicKey && record.providerPublicKey && existing.providerPublicKey === record.providerPublicKey)
    ));
    if (!isDuplicate) {
      bucket.push(record);
      groups.set(record.agreementValue, bucket);
    } else {
      rejectedRecords.push({
        receiptPayload: record.receiptPayload,
        receiptHash: record.receiptHash,
        reasons: ['duplicate provider ID or public key in quorum bucket']
      });
    }
  }
  const rankedGroups = [...groups.entries()]
    .map(([agreementValue, records]) => [agreementValue, records.sort((left, right) => left.providerId.localeCompare(right.providerId))])
    .sort((left, right) => {
      if (right[1].length !== left[1].length) return right[1].length - left[1].length;
      return String(left[0]).localeCompare(String(right[0]));
    });
  const [agreementValue, acceptedRecords = []] = rankedGroups[0] || [null, []];
  const accepted = acceptedRecords.length >= requiredAgreement;
  const acceptedSlice = acceptedRecords.slice(0, accepted ? acceptedRecords.length : 0);
  const providerPoints = acceptedSlice.map((record) => ({
    receiptHash: record.receiptHash,
    providerId: record.providerId,
    points: calculateReceiptPoints({
      receiptHash: record.receiptHash,
      providerId: record.providerId,
      receipt: record.receipt
    }, { multiplier: pointMultiplier })
  }));
  const pointSpend = providerPoints.reduce((sum, entry) => sum + entry.points, 0);
  const spendLimitExceeded = maxPointSpend !== null && Number.isFinite(Number(maxPointSpend)) && pointSpend > Number(maxPointSpend);
  const acceptedWithSpend = accepted && !spendLimitExceeded;
  const rejectionReasons = spendLimitExceeded
    ? [`point spend ${pointSpend} exceeds maxPointSpend ${Number(maxPointSpend)}`]
    : [];
  const baseAgreement = {
    schema: 'reploid.peer.receipt_agreement/v1',
    status: acceptedWithSpend ? 'accepted' : 'rejected',
    mode: plan.ring ? 'ring_quorum' : (plan.assignment?.redundancyGroupSize > 1 ? 'redundant' : 'single'),
    jobId: plan.jobId || plan.assignment?.jobId || null,
    intentHash: plan.intentHash || plan.assignment?.intentHash || null,
    policyId: plan.assignment?.policyId || acceptedSlice[0]?.assignment?.policyId || null,
    policyConfigVersion: plan.assignment?.policyConfigVersion || acceptedSlice[0]?.assignment?.policyConfigVersion || null,
    policyConfigHash: plan.assignment?.policyConfigHash || acceptedSlice[0]?.assignment?.policyConfigHash || null,
    agreementField,
    agreementValue,
    requiredAgreement,
    providerCount: validRecords.length,
    acceptedProviderCount: acceptedSlice.length,
    providerIds: acceptedSlice.map((record) => record.providerId),
    receiptHashes: acceptedSlice.map((record) => record.receiptHash),
    receiptHash: acceptedSlice[0]?.receiptHash || null,
    outputHash: acceptedSlice[0]?.outputHash || null,
    tokenIdsHash: acceptedSlice[0]?.tokenIdsHash || null,
    vectorHash: acceptedSlice[0]?.vectorHash || null,
    sequenceResultHash: acceptedSlice[0]?.sequenceResultHash || null,
    effectiveTrustTier: plan.ring?.effectiveTrustTier || plan.assignment?.trustTier || null,
    ring: plan.ring || null,
    maxPointSpend,
    pointSpend,
    providerPoints,
    rejectionReasons
  };
  return {
    ...baseAgreement,
    agreementHash: await hashJson(baseAgreement),
    accepted: acceptedWithSpend,
    acceptedRecords: acceptedSlice,
    validRecords,
    rejectedRecords
  };
}
