import { describe, expect, it } from 'vitest';
import { createPoolStore } from '../../server/pool/store.js';
import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';
import { buildAcceptanceSummary } from '../../server/pool/services/acceptance.js';
import { hashJson } from '../../server/pool/hash.js';
import { ACCEPTANCE_V2, canonicalAcceptanceAgreement } from '../../packages/reploid/src/artifacts/acceptance.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey, signCanonical, acceptanceSigningPayload } from '../../self/pool/inference-receipt.js';
import { createSettlementFirestore } from '../helpers/pool-settlement-firestore.js';

async function fixture(kind, { pending = false } = {}) {
  const fake = kind === 'firestore' ? createSettlementFirestore() : null;
  const store = fake ? createFirestorePoolStore({ firestore: fake.firestore }) : createPoolStore();
  const keys = await createSigningKeyPair();
  await store.createJob({ jobId: 'agreement_job', requesterId: 'requester', requesterPublicKey: await exportPublicKey(keys.publicKey),
    policyId: 'redundant_agreement', maxPointSpend: 20 });
  for (const id of ['a', 'b']) {
    await store.registerProvider({ providerId: `provider_${id}` });
    await store.createAssignment({ assignmentId: `assignment_${id}`, jobId: 'agreement_job', providerId: `provider_${id}`,
      requesterId: 'requester', assignmentAttemptId: 1 });
    await store.saveReceipt(`receipt_${id}`, { jobId: 'agreement_job', assignmentId: `assignment_${id}`, assignmentAttemptId: 1,
      requesterId: 'requester', providerId: `provider_${id}`, verifierDecision: { accepted: true },
      providerAdmission: { earningsCapPerAcceptance: 20 },
      receipt: { providerId: `provider_${id}`, requesterId: 'requester', tokenCounts: { input: 8, output: 6 } } });
  }
  await store.updateJob('agreement_job', { status: 'receipt_verified', assignmentAttemptId: 1, ringAttemptId: null,
    assignmentIds: ['assignment_a', 'assignment_b'], receiptHash: 'receipt_a', receiptHashes: ['receipt_b', 'receipt_a'],
    agreement: { mode: 'redundant', status: pending ? 'pending' : 'accepted', receiptHashes: ['receipt_b', 'receipt_a'],
      requiredAgreement: 2, providerCount: 2, outputHash: 'output', tokenIdsHash: 'tokens' } });
  const summary = await buildAcceptanceSummary({ store, job: await store.getJob('agreement_job'), receiptHash: 'receipt_a' });
  const sign = async (patch = {}, version = 2) => {
    const terms = version === 1 ? await buildAcceptanceSummary({ store, job: await store.getJob('agreement_job'), receiptHash: 'receipt_a', version: 1 }) : summary;
    return countersignReceipt({ ...terms, accepted: true, acceptedAt: '2026-10-31T10:00:00.000Z', ...patch, version }, keys.privateKey);
  };
  const resign = async acceptance => ({ ...acceptance, requesterSignature: await signCanonical(acceptanceSigningPayload(acceptance), keys.privateKey,
    { domain: acceptance.signatureDomain }) });
  const settle = (receiptHash, acceptance) => store.settleReceiptAcceptance({ receiptHash, acceptance, boundRequesterId: 'requester' });
  return { store, fake, keys, summary, sign, resign, settle };
}

for (const kind of ['memory', 'firestore']) {
  describe(`${kind} versioned agreement replay`, () => {
    it('replays through any member with original or newly signed selector/time, without repricing', async () => {
      const { store, sign, settle } = await fixture(kind);
      const first = await sign();
      expect(first.schema).toBe(ACCEPTANCE_V2);
      const result = await settle('receipt_a', first);
      expect(await settle('receipt_b', first)).toEqual(result);
      const second = await sign({ receiptHash: 'receipt_b', acceptedAt: '2026-10-31T11:00:00.000Z' });
      expect(await settle('receipt_b', second)).toEqual(result);
      const events = await store.listLedger('requester');
      expect(events.filter(event => event.eventType === 'points_awarded')).toHaveLength(2);
      expect(events.filter(event => event.eventType === 'points_spent')).toHaveLength(1);
      expect(events.filter(event => event.eventType === 'points_awarded').map(event => event.points)).toEqual([4, 4]);
      expect(result.acceptance.receiptHash).toBe('receipt_a');
      expect(result.acceptance.acceptedAt).toBe(first.acceptedAt);
    });

    it('keeps the signed selector unchanged when the first submission uses another member URL', async () => {
      const { sign, settle, resign } = await fixture(kind);
      const acceptance = await sign();
      const result = await settle('receipt_b', acceptance);
      expect(result.acceptance.receiptHash).toBe('receipt_a');
      const { createdAt, ...signed } = result.acceptance;
      expect(typeof createdAt).toBe('string');
      expect(await settle('receipt_a', await resign(signed))).toEqual(result);
    });

    it('concurrent cross-URL signatures settle exactly once and both receive the first persisted result', async () => {
      const { store, sign, settle } = await fixture(kind);
      const left = await sign();
      const right = await sign({ receiptHash: 'receipt_b', acceptedAt: '2026-10-31T12:00:00.000Z' });
      const results = await Promise.all([settle('receipt_a', left), settle('receipt_b', right)]);
      expect(results[0]).toEqual(results[1]);
      expect((await store.listLedger('requester')).filter(event => event.eventType === 'points_spent')).toHaveLength(1);
    });

    it('rejection signs the complete pending agreement and replays across members without ledger effects', async () => {
      const { store, sign, settle } = await fixture(kind, { pending: true });
      const no = await sign({ accepted: false });
      const result = await settle('receipt_a', no);
      expect(no.receiptHashes).toEqual(['receipt_a', 'receipt_b']);
      expect(no.agreement.status).toBe('pending');
      expect(await settle('receipt_b', await sign({ accepted: false, receiptHash: 'receipt_b', acceptedAt: '2026-11-01T00:00:00Z' }))).toEqual(result);
      expect(await store.listLedger('requester')).toEqual([]);
    });

    it('does not reinterpret changed spend, attempt, decision, or set as an identical replay', async () => {
      const { sign, settle, resign, summary } = await fixture(kind);
      const acceptance = await sign();
      await settle('receipt_a', acceptance);
      for (const patch of [
        { accepted: false }, { assignmentAttemptId: 2 }, { ringAttemptId: 'another-attempt' },
        { receiptHashes: ['receipt_a'] },
        { pointSpend: 10, providerPoints: summary.providerPoints.map(entry => ({ ...entry, points: 5 })) }
      ]) {
        const changed = { ...acceptance, ...patch };
        changed.agreementHash = hashJson(canonicalAcceptanceAgreement(changed));
        await expect(settle('receipt_a', await resign(changed))).rejects.toMatchObject({ status: expect.any(Number) });
      }
    });

    it('rejects malformed schemas and collections as client errors, before canonical normalization', async () => {
      const { sign, settle } = await fixture(kind);
      const acceptance = await sign();
      for (const patch of [{ receiptHashes: {} }, { providerPoints: {} }, { providerPoints: [null] },
        { schema: 'poolday.requester_acceptance/v99' }, { unsignedAuthority: true },
        { receiptHashes: ['receipt_a', 'receipt_a'] }]) {
        await expect(settle('receipt_a', { ...acceptance, ...patch })).rejects.toMatchObject({ status: 400 });
      }
    });

    it('requires URL membership, authentication and current member evidence even on replay', async () => {
      const { store, sign, settle } = await fixture(kind);
      const acceptance = await sign();
      await settle('receipt_a', acceptance);
      await expect(settle('unknown', acceptance)).rejects.toMatchObject({ status: 404 });
      await expect(settle('receipt_b', { ...acceptance, requesterSignature: 'invalid' })).rejects.toMatchObject({ status: 400 });
      const original = store.getSettlementRecord.bind(store);
      store.getSettlementRecord = async (collection, id) => {
        const value = await original(collection, id);
        return collection === 'assignments' && id === 'assignment_b' ? { ...value, assignmentAttemptId: 2 } : value;
      };
      await expect(settle('receipt_a', acceptance)).rejects.toMatchObject({ status: 409 });
    });

    it('does not upgrade missing legacy receipt attempt evidence into a v2 rejection', async () => {
      const { store, sign, settle } = await fixture(kind, { pending: true });
      const no = await sign({ accepted: false });
      const original = store.getSettlementRecord.bind(store);
      store.getSettlementRecord = async (collection, id) => {
        const value = await original(collection, id);
        if (collection === 'receipts' && id === 'receipt_b') {
          const { assignmentAttemptId, ...legacy } = value;
          expect(assignmentAttemptId).toBe(1);
          return legacy;
        }
        return value;
      };
      await expect(settle('receipt_a', no)).rejects.toMatchObject({ status: 409 });
      expect(await store.listLedger('requester')).toEqual([]);
    });

    it('retains pinned historical policy identity rather than adopting current package defaults', async () => {
      const { store, keys, settle } = await fixture(kind);
      await store.updateJob('agreement_job', { policyConfigVersion: 'retained-config-1', policyConfigHash: 'sha256:retained-config' });
      const job = await store.getJob('agreement_job');
      const summary = await buildAcceptanceSummary({ store, job, receiptHash: 'receipt_b' });
      expect(summary.policyConfigVersion).toBe('retained-config-1');
      expect(summary.policyConfigHash).toBe('sha256:retained-config');
      const acceptance = await countersignReceipt({ ...summary, accepted: true }, keys.privateKey);
      const result = await settle('receipt_b', acceptance);
      const retry = await countersignReceipt({ ...summary, receiptHash: 'receipt_a', accepted: true, acceptedAt: '2026-11-01T00:00:00Z' }, keys.privateKey);
      expect(await settle('receipt_a', retry)).toEqual(result);
      expect(result.acceptance.policyConfigHash).toBe('sha256:retained-config');
    });

    it('keeps v1 original signed-payload identity and accepts persisted unversioned v1 replay records', async () => {
      const { store, sign, settle, resign } = await fixture(kind);
      const acceptance = await sign({}, 1);
      const { requesterSignature, ...payload } = acceptance;
      expect(typeof requesterSignature).toBe('string');
      const decisionId = `settlement_${hashJson({ jobId: 'agreement_job', receiptHash: 'receipt_a', payload }).slice(7)}`;
      const legacyResult = { acceptance: { ...acceptance, createdAt: 'old' }, ledgerEvents: [{ ledgerId: 'historical-random' }] };
      await store.updateJob('agreement_job', { status: 'accepted', settlement: { decisionId, result: legacyResult } });
      expect(await settle('receipt_a', acceptance)).toEqual(legacyResult);
      await expect(settle('receipt_a', await resign({ ...acceptance, acceptedAt: '2026-11-01T00:00:00Z' }))).rejects.toMatchObject({ status: 409 });
      await expect(settle('receipt_b', acceptance)).rejects.toMatchObject({ status: 400 });
      expect(await store.listLedger('requester')).toEqual([]);
    });
  });
}
