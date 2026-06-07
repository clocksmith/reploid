/**
 * @fileoverview Ring commit-reveal hash helpers.
 */

import { hashJson } from './hash.js';

export function buildCommitmentPayload(input = {}) {
  return {
    schema: 'reploid.pool.commitment/v1',
    jobId: input.jobId || null,
    assignmentId: input.assignmentId || null,
    ringAttemptId: input.ringAttemptId || null,
    providerId: input.providerId || null,
    outputHash: input.outputHash || null,
    tokenIdsHash: input.tokenIdsHash || null,
    transcriptHash: input.transcriptHash || null,
    salt: input.salt || null
  };
}

export function buildCommitmentHash(input = {}) {
  return hashJson(buildCommitmentPayload(input));
}

export function validateCommitmentInput(input = {}) {
  const reasons = [];
  for (const field of ['jobId', 'assignmentId', 'ringAttemptId', 'providerId', 'commitmentHash']) {
    if (!input[field]) reasons.push(`${field} is required`);
  }
  if (input.commitmentHash && !String(input.commitmentHash).startsWith('sha256:')) {
    reasons.push('commitmentHash must be sha256-prefixed');
  }
  return reasons;
}

export function validateRevealInput(input = {}) {
  const reasons = [];
  for (const field of ['jobId', 'assignmentId', 'ringAttemptId', 'providerId', 'outputHash', 'tokenIdsHash', 'transcriptHash', 'salt']) {
    if (!input[field]) reasons.push(`${field} is required`);
  }
  for (const field of ['outputHash', 'tokenIdsHash', 'transcriptHash']) {
    if (input[field] && !String(input[field]).startsWith('sha256:')) reasons.push(`${field} must be sha256-prefixed`);
  }
  return reasons;
}

export function revealMatchesCommitment({ commitment = {}, reveal = {} } = {}) {
  const expectedHash = buildCommitmentHash({
    jobId: commitment.jobId,
    assignmentId: commitment.assignmentId,
    ringAttemptId: commitment.ringAttemptId,
    providerId: commitment.providerId,
    outputHash: reveal.outputHash,
    tokenIdsHash: reveal.tokenIdsHash,
    transcriptHash: reveal.transcriptHash,
    salt: reveal.salt
  });
  return {
    ok: expectedHash === commitment.commitmentHash,
    expectedHash,
    actualHash: commitment.commitmentHash
  };
}

export default {
  buildCommitmentPayload,
  buildCommitmentHash,
  validateCommitmentInput,
  validateRevealInput,
  revealMatchesCommitment
};
