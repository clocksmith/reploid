import { describe, expect, it } from 'vitest';
import { createPoolStore } from '../../server/pool/store.js';
import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';
import { POOL_SETTLEMENT_STORAGE_BUDGET } from '../../server/pool/store-contract.js';
import { validateSettlementStorageBudget } from '../../server/pool/services/acceptance-settlement.js';
import { buildAcceptanceSummary } from '../../server/pool/services/acceptance.js';
import {
  acceptanceSigningPayload, countersignReceipt, createSigningKeyPair, exportPublicKey,
  signCanonical, SIGNATURE_DOMAINS
} from '../../self/pool/inference-receipt.js';
import { createSettlementFirestore } from '../helpers/pool-settlement-firestore.js';

async function fixture(kind) {
  const fake = kind === 'firestore' ? createSettlementFirestore() : null;
  const store = fake ? createFirestorePoolStore({ firestore: fake.firestore }) : createPoolStore();
  const keys = await createSigningKeyPair();
  await store.registerProvider({ providerId: 'provider_settlement' });
  await store.createJob({ jobId: 'job_settlement', requesterId: 'requester_settlement',
    requesterPublicKey: await exportPublicKey(keys.publicKey), policyId: 'fastest_receipt', maxPointSpend: 20 });
  await store.createAssignment({ assignmentId: 'assignment_settlement', jobId: 'job_settlement',
    providerId: 'provider_settlement', requesterId: 'requester_settlement', assignmentAttemptId: 1, policyId: 'fastest_receipt' });
  await store.updateAssignment('assignment_settlement', { status: 'receipt_verified' });
  await store.saveReceipt('receipt_settlement', {
    jobId: 'job_settlement', assignmentId: 'assignment_settlement', assignmentAttemptId: 1,
    providerId: 'provider_settlement', requesterId: 'requester_settlement',
    verifierDecision: { accepted: true }, providerAdmission: { earningsCapPerAcceptance: 20 },
    receipt: { providerId: 'provider_settlement', requesterId: 'requester_settlement', tokenCounts: { input: 8, output: 6 } }
  });
  await store.updateJob('job_settlement', { status: 'receipt_verified', receiptHash: 'receipt_settlement',
    receiptHashes: ['receipt_settlement'], assignmentIds: ['assignment_settlement'], assignmentAttemptId: 1 });
  const sign = async accepted => {
    const job = await store.getJob('job_settlement');
    const summary = accepted ? await buildAcceptanceSummary({ store, job, receiptHash: 'receipt_settlement' }) : {};
    return countersignReceipt({ ...summary, receiptHash: 'receipt_settlement', requesterId: job.requesterId, accepted }, keys.privateKey);
  };
  return { store, fake, keys, sign, settle: acceptance => store.settleReceiptAcceptance({ receiptHash: 'receipt_settlement', acceptance }) };
}

for (const kind of ['memory', 'firestore']) {
  describe(`${kind} atomic receipt settlement`, () => {
    it('awards and charges once, including a lost-response retry and a fresh signature over the same decision', async () => {
      const { store, keys, sign, settle } = await fixture(kind);
      const acceptance = await sign(true);
      const result = await settle(acceptance);
      expect((await store.getJob('job_settlement')).status).toBe('accepted');
      const ledger = await store.listLedger('requester_settlement');
      expect(ledger.filter(event => event.eventType === 'points_awarded')).toHaveLength(1);
      expect(ledger.filter(event => event.eventType === 'points_spent')).toHaveLength(1);
      expect(ledger.find(event => event.eventType === 'points_awarded').points).toBe(8);
      expect(ledger.find(event => event.eventType === 'points_spent').points).toBe(-8);
      expect(await settle(structuredClone(acceptance))).toEqual(result);
      const resigned = { ...acceptance, requesterSignature: await signCanonical(acceptanceSigningPayload(acceptance), keys.privateKey,
        { domain: SIGNATURE_DOMAINS.requesterAcceptance }) };
      expect(await settle(resigned)).toEqual(result);
      expect(await store.listLedger('requester_settlement')).toEqual(ledger);
      expect((await store.getReputation('provider_settlement')).acceptedReceipts).toBe(1);
    });

    it('records rejection atomically without awarding or charging and replays it', async () => {
      const { store, sign, settle } = await fixture(kind);
      const acceptance = await sign(false);
      const result = await settle(acceptance);
      expect((await store.getJob('job_settlement')).status).toBe('rejected_by_requester');
      expect(await store.listLedger('requester_settlement')).toEqual([]);
      expect(await settle(acceptance)).toEqual(result);
      expect((await store.getReceipt('receipt_settlement')).requesterAcceptance.accepted).toBe(false);
    });

    it('rejects the opposite signed decision after settlement', async () => {
      const { store, sign, settle } = await fixture(kind);
      const yes = await sign(true), no = await sign(false);
      await settle(yes);
      await expect(settle(no)).rejects.toMatchObject({ status: 409 });
      expect((await store.getJob('job_settlement')).status).toBe('accepted');
      expect((await store.listLedger('requester_settlement')).filter(event => event.eventType === 'points_awarded')).toHaveLength(1);
    });

    it('keeps legacy processing blocked without replaying a potentially partial award', async () => {
      const { store, sign, settle } = await fixture(kind);
      const acceptance = await sign(true);
      await store.appendLedger({ ledgerId: 'historical_random_id', eventType: 'points_awarded', userId: 'provider_settlement',
        requesterId: 'requester_settlement', providerId: 'provider_settlement', points: 8 });
      await store.updateJob('job_settlement', { status: 'acceptance_processing' });
      const ledger = await store.listLedger('requester_settlement');
      await expect(settle(acceptance)).rejects.toMatchObject({ status: 409 });
      expect(await store.listLedger('requester_settlement')).toEqual(ledger);
      expect((await store.getJob('job_settlement')).status).toBe('acceptance_processing');
    });

    it('returns the same committed result to both concurrent identical requests', async () => {
      const { store, sign, settle } = await fixture(kind);
      const acceptance = await sign(true);
      const [left, right] = await Promise.all([settle(acceptance), settle(acceptance)]);
      expect(right).toEqual(left);
      expect((await store.listLedger('requester_settlement')).filter(event => event.eventType === 'points_awarded')).toHaveLength(1);
      expect((await store.getReputation('provider_settlement')).acceptedReceipts).toBe(1);
    });

    it('serializes concurrent acceptance and rejection on the same job', async () => {
      const { store, sign, settle } = await fixture(kind);
      const yes = await sign(true), no = await sign(false);
      const results = await Promise.allSettled([settle(yes), settle(no)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(result => result.status === 'rejected').reason.status).toBe(409);
      const state = await store.getJob('job_settlement');
      const awards = (await store.listLedger('requester_settlement')).filter(event => event.eventType === 'points_awarded');
      expect(awards).toHaveLength(state.status === 'accepted' ? 1 : 0);
    });

    it('rejects oversized stored receipt evidence before any settlement mutation', async () => {
      const { store, fake, sign, settle } = await fixture(kind);
      const acceptance = await sign(true);
      const receipt = await store.getReceipt('receipt_settlement');
      await store.saveReceipt('receipt_settlement', { ...receipt,
        outputText: 'x'.repeat(POOL_SETTLEMENT_STORAGE_BUDGET.maxRecordBytes + 1) });
      const before = fake?.dump();
      await expect(settle(acceptance)).rejects.toMatchObject({ status: 413 });
      expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
      expect(await store.listLedger('requester_settlement')).toEqual([]);
      if (fake) expect(fake.dump()).toEqual(before);
    });

    it('rejects a valid signed decision bound by HTTP to a different requester', async () => {
      const { store, fake, sign } = await fixture(kind);
      const acceptance = await sign(true);
      const before = fake?.dump();
      await expect(store.settleReceiptAcceptance({ receiptHash: 'receipt_settlement', acceptance,
        boundRequesterId: 'requester_other' })).rejects.toMatchObject({
        status: 403, code: 'settlement_requester_binding_changed'
      });
      expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
      expect(await store.listLedger('requester_settlement')).toEqual([]);
      if (fake) expect(fake.dump()).toEqual(before);
    });

    it('rechecks the current spending cap and rejects an oversized or duplicate agreement', async () => {
      const { store, sign, settle } = await fixture(kind);
      const acceptance = await sign(true);
      await store.updateJob('job_settlement', { maxPointSpend: 1 });
      await expect(settle(acceptance)).rejects.toMatchObject({ status: 402 });
      await store.updateJob('job_settlement', { maxPointSpend: 20,
        agreement: { status: 'accepted', receiptHashes: ['receipt_settlement', 'receipt_settlement'] } });
      await expect(settle(acceptance)).rejects.toMatchObject({ status: 400 });
      expect(await store.listLedger('requester_settlement')).toEqual([]);
    });
  });
}

describe('Firestore settlement transaction boundary', () => {
  it('does not persist any effects when commit fails, then permits a clean retry', async () => {
    const { store, fake, sign, settle } = await fixture('firestore');
    const acceptance = await sign(true);
    const before = fake.dump();
    fake.beforeNextCommit(() => { throw Error('injected commit outage'); });
    await expect(settle(acceptance)).rejects.toThrow('injected commit outage');
    expect(fake.dump()).toEqual(before);
    await settle(acceptance);
    expect((await store.getJob('job_settlement')).status).toBe('accepted');
  });

  it('fails closed without transactional persistence', async () => {
    const { fake, sign } = await fixture('firestore');
    const acceptance = await sign(true);
    const unsupported = { ...fake.firestore };
    delete unsupported.runTransaction;
    const store = createFirestorePoolStore({ firestore: unsupported });
    const before = fake.dump();
    await expect(store.settleReceiptAcceptance({ receiptHash: 'receipt_settlement', acceptance })).rejects.toThrow(/transaction/i);
    expect(fake.dump()).toEqual(before);
  });

  it('rejects a job changed after preparation instead of committing stale spending terms', async () => {
    const { store, fake, sign, settle } = await fixture('firestore');
    const acceptance = await sign(true);
    fake.beforeNextCommit(() => store.updateJob('job_settlement', { maxPointSpend: 1 }));
    await expect(settle(acceptance)).rejects.toMatchObject({ status: 402 });
    expect(await store.listLedger('requester_settlement')).toEqual([]);
    expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
    expect(fake.retries()).toBeGreaterThan(0);
  });

  it('rechecks the HTTP requester binding after the job owner changes during preparation', async () => {
    const { store, fake, sign } = await fixture('firestore');
    const acceptance = await sign(true);
    fake.beforeNextCommit(() => store.updateJob('job_settlement', { requesterId: 'requester_other' }));
    await expect(store.settleReceiptAcceptance({ receiptHash: 'receipt_settlement', acceptance,
      boundRequesterId: 'requester_settlement' })).rejects.toMatchObject({
      status: 403, code: 'settlement_requester_binding_changed'
    });
    expect(await store.listLedger('requester_settlement')).toEqual([]);
    expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
    expect(fake.retries()).toBeGreaterThan(0);
  });

  it('rejects changed receipt evidence and leaves no settlement effects', async () => {
    const { store, fake, sign, settle } = await fixture('firestore');
    const acceptance = await sign(true);
    const receipt = await store.getReceipt('receipt_settlement');
    fake.beforeNextCommit(() => store.saveReceipt('receipt_settlement', { ...receipt, verifierDecision: { accepted: false } }));
    await expect(settle(acceptance)).rejects.toMatchObject({ status: 400 });
    expect(await store.listLedger('requester_settlement')).toEqual([]);
    expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
  });

  it('reprepares a changed reputation revision without reading event history inside the transaction', async () => {
    const { store, fake, sign, settle } = await fixture('firestore');
    const acceptance = await sign(true);
    const revision = await store.getSettlementRecord('reputationState', 'provider_settlement');
    const queriesBefore = fake.transactionQueries();
    fake.beforeNextCommit(() => fake.seed('reputation_state', 'provider_settlement', {
      ...revision, evidenceRevision: Number(revision?.evidenceRevision || 0) + 1
    }));
    await settle(acceptance);
    expect(fake.retries()).toBeGreaterThan(0);
    expect((await store.getSettlementRecord('reputationState', 'provider_settlement')).evidenceRevision).toBe(2);
    expect((await store.listLedger('requester_settlement')).filter(event => event.eventType === 'points_awarded')).toHaveLength(1);
    expect(fake.transactionQueries()).toBe(queriesBefore);
  });

  it.each([
    { label: 'missing', admission: {} },
    { label: 'null', admission: { earningsCapPerAcceptance: null } }
  ])('preserves $label-cap current-admission fallback and refuses a stale signed price after promotion', async ({ admission }) => {
    const { store, fake, sign, settle } = await fixture('firestore');
    const receipt = await store.getReceipt('receipt_settlement');
    await store.saveReceipt('receipt_settlement', { ...receipt, providerAdmission: admission });
    const acceptance = await sign(true);
    const prior = await store.getSettlementRecord('reputationState', 'provider_settlement');
    fake.beforeNextCommit(() => fake.seed('reputation_state', 'provider_settlement', {
      ...prior, acceptedReceipts: 100, admissionLane: 'trusted_browser_provider',
      evidenceRevision: Number(prior?.evidenceRevision || 0) + 1
    }));
    await expect(settle(acceptance)).rejects.toMatchObject({ status: 400 });
    expect(await store.listLedger('requester_settlement')).toEqual([]);
    expect((await store.getJob('job_settlement')).status).toBe('receipt_verified');
  });

});


describe('settlement storage budget', () => {
  it('bounds aggregate evidence even when each record individually fits', () => {
    const value = { text: 'x'.repeat(Math.floor(POOL_SETTLEMENT_STORAGE_BUDGET.maxRecordBytes / 2)) };
    const count = Math.ceil(POOL_SETTLEMENT_STORAGE_BUDGET.maxPlanBytes / Buffer.byteLength(JSON.stringify(value))) + 1;
    const plan = { reads: Array.from({ length: count }, (_, index) => ({ collection: 'receipts', id: String(index), value })),
      writes: [], result: {} };
    expect(() => validateSettlementStorageBudget({ reads: [], writes: [], result: {} })).not.toThrow();
    expect(() => validateSettlementStorageBudget(plan)).toThrow(expect.objectContaining({ status: 413 }));
  });
});
