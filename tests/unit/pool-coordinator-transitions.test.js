import { describe, expect, it } from 'vitest';

import {
  buildExpiredAssignmentJobPatch,
  canClaimJobForAssignment
} from '../../server/pool/coordinator-transitions.js';

describe('Pool coordinator transitions', () => {
  it('keeps retry eligibility independent of persistence adapters', () => {
    expect(canClaimJobForAssignment({ status: 'queued' })).toBe(true);
    expect(canClaimJobForAssignment({ status: 'failed', retryable: true })).toBe(true);
    expect(canClaimJobForAssignment({ status: 'receipt_verified', retryable: true })).toBe(false);
  });

  it('rejects an impossible redundant agreement after an expired assignment', () => {
    const patch = buildExpiredAssignmentJobPatch({
      now: '2026-08-01T00:00:00.000Z',
      job: {
        jobId: 'job_transition',
        providerCount: 2,
        assignmentIds: ['assignment_expired', 'assignment_complete'],
        agreement: { mode: 'redundant', requiredAgreement: 2, requiredProviders: 2 }
      },
      assignment: { assignmentId: 'assignment_expired', providerId: 'provider_expired' },
      receiptRecords: [{
        jobId: 'job_transition',
        assignmentId: 'assignment_complete',
        receiptHash: 'sha256:complete',
        verifierDecision: { accepted: true },
        receipt: { tokenIdsHash: 'sha256:tokens', outputHash: 'sha256:output', vectorHash: 'sha256:vector' }
      }]
    });

    expect(patch).toMatchObject({
      status: 'redundant_disagreement',
      retryable: true,
      failedAssignmentIds: ['assignment_expired'],
      timedOutProviderIds: ['provider_expired'],
      agreement: { status: 'rejected', acceptedReceipts: 1 },
      verifierDecision: { accepted: false, verifiedAt: '2026-08-01T00:00:00.000Z' }
    });
  });

  it('accepts a matching quorum from the current assignment attempt', () => {
    const patch = buildExpiredAssignmentJobPatch({
      job: {
        jobId: 'job_quorum',
        assignmentAttemptId: 2,
        providerCount: 3,
        assignmentIds: ['assignment_expired', 'assignment_one', 'assignment_two'],
        agreement: { mode: 'redundant', requiredAgreement: 2 }
      },
      assignment: { assignmentId: 'assignment_expired', providerId: 'provider_expired', assignmentAttemptId: 2 },
      receiptRecords: ['assignment_one', 'assignment_two'].map((assignmentId) => ({
        jobId: 'job_quorum', assignmentId, assignmentAttemptId: 2, receiptHash: `sha256:${assignmentId}`,
        verifierDecision: { accepted: true },
        receipt: { tokenIdsHash: 'sha256:tokens', outputHash: 'sha256:output', vectorHash: 'sha256:vector' }
      }))
    });

    expect(patch).toMatchObject({
      status: 'receipt_verified',
      retryable: false,
      agreement: {
        status: 'accepted', agreementValue: 'sha256:tokens', vectorHash: 'sha256:vector',
        receiptHashes: ['sha256:assignment_one', 'sha256:assignment_two']
      }
    });
  });
});
