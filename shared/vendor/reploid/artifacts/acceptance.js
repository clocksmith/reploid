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

export const ACCEPTANCE_V2 = 'poolday.requester_acceptance/v2';
export const ACCEPTANCE_V2_DOMAIN = 'poolday.requester_acceptance.v2';

const compareIdentity = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Canonical agreement terms. A receipt URL selects a member, not a new agreement. */
export function canonicalAcceptanceAgreement(input = {}) {
  return {
    schema: ACCEPTANCE_V2,
    jobId: input.jobId ?? null,
    requesterId: input.requesterId ?? null,
    assignmentAttemptId: input.assignmentAttemptId ?? null,
    ringAttemptId: input.ringAttemptId ?? null,
    policyId: input.policyId ?? null,
    policyConfigVersion: input.policyConfigVersion ?? null,
    policyConfigHash: input.policyConfigHash ?? null,
    agreement: compactAgreementForAcceptance(input.agreement ?? null),
    receiptHashes: [...(input.receiptHashes || [])].sort(),
    providerPoints: (input.providerPoints || []).map(entry => ({
      receiptHash: entry.receiptHash,
      providerId: entry.providerId,
      points: entry.points
    })).sort((left, right) => compareIdentity(left.receiptHash, right.receiptHash)
      || compareIdentity(left.providerId, right.providerId)),
    pointSpend: input.pointSpend
  };
}

/** Timestamp and signature remain signed evidence, but do not create another decision. */
export function canonicalAcceptanceTerms(input = {}) {
  return {
    ...canonicalAcceptanceAgreement(input),
    agreementHash: input.agreementHash,
    accepted: input.accepted
  };
}

export function acceptanceV2SigningPayload(input = {}) {
  return {
    ...canonicalAcceptanceTerms(input),
    signatureDomain: ACCEPTANCE_V2_DOMAIN,
    receiptHash: input.receiptHash,
    acceptedAt: input.acceptedAt
  };
}
