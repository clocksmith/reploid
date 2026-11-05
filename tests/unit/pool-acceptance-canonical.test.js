import { describe, expect, it, vi } from 'vitest';
import {
  ACCEPTANCE_V2, ACCEPTANCE_V2_DOMAIN, canonicalAcceptanceAgreement, canonicalAcceptanceTerms
} from '../../packages/reploid/src/artifacts/acceptance.js';
import {
  acceptanceSigningPayload, buildAcceptanceSummary, countersignReceipt, createSigningKeyPair,
  exportPublicKey, hashJson, verifyCanonicalSignature, SIGNATURE_DOMAINS
} from '../../shared/pool/inference-receipt.js';
import { createRequesterClient } from '../../apps/poolday/pool/requester-client.js';

const fixture = () => {
  const job = { jobId: 'job', requesterId: 'requester', assignmentAttemptId: 3, ringAttemptId: 'ring3',
    policyId: 'redundant_agreement', policyConfigVersion: 'config1', policyConfigHash: 'sha256:config',
    agreement: { mode: 'redundant', status: 'accepted', receiptHashes: ['receipt-b', 'receipt-a'], requiredAgreement: 2, providerCount: 2 } };
  const receiptRecords = ['receipt-a', 'receipt-b'].map((receiptHash, index) => ({ receiptHash,
    jobId: job.jobId, requesterId: job.requesterId, providerId: `provider-${index}`, verifierDecision: { accepted: true },
    providerAdmission: { earningsCapPerAcceptance: 20 }, receipt: { tokenCounts: { input: 4, output: 7 } } }));
  return { job, receiptRecords };
};

describe('versioned agreement acceptance', () => {
  it('canonicalizes receipt and allocation order without discarding duplicate evidence', () => {
    const left = canonicalAcceptanceAgreement({ receiptHashes: ['b', 'a', 'a'], providerPoints: [
      { receiptHash: 'b', providerId: 'p2', points: 2 }, { receiptHash: 'a', providerId: 'p1', points: 1 }
    ], pointSpend: 3 });
    expect(left.receiptHashes).toEqual(['a', 'a', 'b']);
    expect(left.providerPoints.map(entry => entry.receiptHash)).toEqual(['a', 'b']);
  });

  it('binds attempts and economics but not the selected member or signing instant to decision identity', async () => {
    const f = fixture();
    const first = await buildAcceptanceSummary({ ...f, receiptHash: 'receipt-a' });
    const second = await buildAcceptanceSummary({ job: { ...f.job, agreement: { ...f.job.agreement, receiptHashes: ['receipt-a', 'receipt-b'] } },
      receiptRecords: [...f.receiptRecords].reverse(), receiptHash: 'receipt-b' });
    expect(first.schema).toBe(ACCEPTANCE_V2);
    expect(first.agreementHash).toBe(second.agreementHash);
    const left = canonicalAcceptanceTerms({ ...first, accepted: true, acceptedAt: 'first' });
    const right = canonicalAcceptanceTerms({ ...second, accepted: true, acceptedAt: 'second' });
    expect(left).toEqual(right);
    expect(canonicalAcceptanceTerms({ ...second, assignmentAttemptId: 4, accepted: true })).not.toEqual(left);
    expect(canonicalAcceptanceTerms({ ...second, pointSpend: 99, accepted: true })).not.toEqual(left);
    expect(canonicalAcceptanceTerms({ ...second, accepted: false })).not.toEqual(left);
  });

  it('signs the member selector and timestamp even though re-signing preserves semantic terms', async () => {
    const keys = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keys.publicKey);
    const summary = await buildAcceptanceSummary({ ...fixture(), receiptHash: 'receipt-a' });
    const first = await countersignReceipt({ ...summary, accepted: true, acceptedAt: '2026-10-31T12:00:00.000Z' }, keys.privateKey);
    const second = await countersignReceipt({ ...summary, receiptHash: 'receipt-b', accepted: true, acceptedAt: '2026-10-31T12:01:00.000Z' }, keys.privateKey);
    expect(canonicalAcceptanceTerms(first)).toEqual(canonicalAcceptanceTerms(second));
    expect(first.signatureDomain).toBe(ACCEPTANCE_V2_DOMAIN);
    expect(await verifyCanonicalSignature(acceptanceSigningPayload(first), publicKey, first.requesterSignature,
      { domain: ACCEPTANCE_V2_DOMAIN })).toBe(true);
    expect(await verifyCanonicalSignature(acceptanceSigningPayload({ ...first, acceptedAt: second.acceptedAt }), publicKey,
      first.requesterSignature, { domain: ACCEPTANCE_V2_DOMAIN })).toBe(false);
    expect(await verifyCanonicalSignature(acceptanceSigningPayload({ ...first, receiptHash: 'receipt-b' }), publicKey,
      first.requesterSignature, { domain: ACCEPTANCE_V2_DOMAIN })).toBe(false);
  });

  it('keeps legacy signing and selector-bound summaries explicit', async () => {
    const keys = await createSigningKeyPair();
    const first = await buildAcceptanceSummary({ ...fixture(), receiptHash: 'receipt-a', version: 1 });
    const second = await buildAcceptanceSummary({ ...fixture(), receiptHash: 'receipt-b', version: 1 });
    expect(first.schema).toBeUndefined();
    expect(first.agreementHash).not.toBe(second.agreementHash);
    const acceptance = await countersignReceipt({ ...first, version: 1, accepted: true }, keys.privateKey);
    expect(acceptance.signatureDomain).toBe(SIGNATURE_DOMAINS.requesterAcceptance);
    expect(await verifyCanonicalSignature(acceptanceSigningPayload(acceptance), await exportPublicKey(keys.publicKey),
      acceptance.requesterSignature, { domain: SIGNATURE_DOMAINS.requesterAcceptance })).toBe(true);
  });

  it.each([true, false])('hosted requester signs complete v2 terms when accepted=%s', async accepted => {
    const f = fixture();
    const submitted = [];
    const sdk = {
      getReceipt: async hash => f.receiptRecords.find(record => record.receiptHash === hash),
      pollJob: async () => ({ job: f.job }),
      acceptReceipt: async (hash, acceptance) => { submitted.push({ hash, acceptance }); return acceptance; }
    };
    const keys = await createSigningKeyPair();
    const client = createRequesterClient({ requesterId: f.job.requesterId, sdk, keyPair: keys, identity: null });
    const result = await client.acceptReceipt('receipt-b', accepted);
    expect(result).toMatchObject({ schema: ACCEPTANCE_V2, accepted, assignmentAttemptId: 3, ringAttemptId: 'ring3',
      receiptHashes: ['receipt-a', 'receipt-b'], receiptHash: 'receipt-b' });
    expect(result.providerPoints).toHaveLength(2);
    expect(result.agreementHash).toBe(await hashJson(canonicalAcceptanceAgreement(result)));
    expect(submitted).toHaveLength(1);
  });

  it('pending rejection signs the complete currently recorded receipt set', async () => {
    const f = fixture();
    f.job.agreement.status = 'pending';
    f.job.receiptHashes = ['receipt-b', 'receipt-a'];
    const summary = await buildAcceptanceSummary({ ...f, receiptHash: 'receipt-a' });
    expect(summary.receiptHashes).toEqual(['receipt-a', 'receipt-b']);
    expect(summary.providerPoints).toHaveLength(2);
  });

  it('natural hosted retry re-signs persisted economics through another member without repricing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'));
      const f = fixture();
      const reads = [];
      const sdk = {
        getReceipt: async hash => { reads.push(hash); return f.receiptRecords.find(record => record.receiptHash === hash); },
        pollJob: async () => ({ job: f.job }),
        acceptReceipt: async (hash, acceptance) => {
          if (!f.job.settlement) f.job.settlement = { result: { acceptance: structuredClone(acceptance) } };
          return acceptance;
        }
      };
      const client = createRequesterClient({ requesterId: f.job.requesterId, sdk, keyPair: await createSigningKeyPair(), identity: null });
      const first = await client.acceptReceipt('receipt-a');
      for (const record of f.receiptRecords) record.providerAdmission.earningsCapPerAcceptance = 0;
      const priorReads = reads.length;
      vi.setSystemTime(new Date('2026-10-31T12:01:00.000Z'));
      const retry = await client.acceptReceipt('receipt-b');
      expect(retry.receiptHash).toBe('receipt-b');
      expect(retry.acceptedAt).not.toBe(first.acceptedAt);
      expect(retry.pointSpend).toBe(first.pointSpend);
      expect(retry.providerPoints).toEqual(first.providerPoints);
      expect(retry.agreementHash).toBe(first.agreementHash);
      expect(reads.slice(priorReads)).toEqual(['receipt-b']);
      const opposite = await client.acceptReceipt('receipt-b', false);
      expect(opposite.accepted).toBe(false);
      expect(opposite.providerPoints).toEqual(first.providerPoints);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays the authenticated original v1 request unchanged and refuses selector or decision remapping', async () => {
    const f = fixture();
    const keys = await createSigningKeyPair();
    f.job.requesterPublicKey = await exportPublicKey(keys.publicKey);
    const summary = await buildAcceptanceSummary({ ...f, receiptHash: 'receipt-a', version: 1 });
    const original = await countersignReceipt({ ...summary, accepted: true, version: 1 }, keys.privateKey);
    f.job.settlement = { result: { acceptance: { ...original, createdAt: 'server-added' } } };
    const accept = vi.fn(async (hash, payload) => payload);
    const sdk = { getReceipt: async hash => f.receiptRecords.find(record => record.receiptHash === hash),
      pollJob: async () => ({ job: f.job }), acceptReceipt: accept };
    const client = createRequesterClient({ requesterId: f.job.requesterId, sdk, keyPair: keys, identity: null });
    expect(await client.acceptReceipt('receipt-a')).toEqual(original);
    expect(accept).toHaveBeenCalledWith('receipt-a', original);
    await expect(client.acceptReceipt('receipt-b')).rejects.toThrow('original receipt and decision');
    await expect(client.acceptReceipt('receipt-a', false)).rejects.toThrow('original receipt and decision');
    f.job.settlement.result.acceptance.pointSpend += 1;
    await expect(client.acceptReceipt('receipt-a')).rejects.toThrow('reconciliation');
    expect(accept).toHaveBeenCalledTimes(1);
  });

});
