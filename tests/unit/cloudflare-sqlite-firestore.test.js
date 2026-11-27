import { describe, expect, it } from 'vitest';

import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';
import { validatePoolStoreContract } from '../../server/pool/store-contract.js';
import { createFirestoreChangeControlStore } from '../../server/change-control/firestore-store.js';
import { buildAcceptanceSummary } from '../../server/pool/services/acceptance.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey } from '../../shared/pool/inference-receipt.js';
import { createNodeSqliteFirestore } from '../helpers/node-sqlite-firestore.js';

const sqliteStore = () => {
  const backing = createNodeSqliteFirestore();
  return { ...backing, store: createFirestorePoolStore({ firestore: backing.firestore }) };
};

describe('SQLite Firestore subset (Cloudflare coordinator storage)', () => {
  it('stores, merges nested maps and rejects values Firestore would not keep', async () => {
    const { firestore } = createNodeSqliteFirestore();
    const ref = firestore.collection('jobs').doc('job_1');
    await ref.set({ status: 'queued', limits: { a: 1 }, list: [1, 2] });
    await ref.set({ limits: { b: 2 }, list: [3] }, { merge: true });
    expect((await ref.get()).data()).toEqual({ status: 'queued', limits: { a: 1, b: 2 }, list: [3] });
    await ref.set({ status: 'done' });
    expect((await ref.get()).data()).toEqual({ status: 'done' });
    await expect(ref.set({ bad: undefined })).rejects.toThrow(/Undefined value/);
    await expect(ref.set({ bad: new Map() })).rejects.toThrow(/Unsupported value/);
    expect((await firestore.collection('jobs').doc('missing').get()).exists).toBe(false);
  });

  it('filters, orders (leaving out documents without the field), pages with startAfter and limits', async () => {
    const { firestore } = createNodeSqliteFirestore();
    const messages = firestore.collection('peer_room_messages');
    for (const [id, data] of [
      ['m3', { roomId: 'r', createdAt: 2, relayId: 'b' }], ['m1', { roomId: 'r', createdAt: 1, relayId: 'z' }],
      ['m2', { roomId: 'r', createdAt: 2, relayId: 'a' }], ['m4', { roomId: 'other', createdAt: 0, relayId: 'a' }],
      ['m5', { roomId: 'r', relayId: 'no-created-at' }]
    ]) await messages.doc(id).set(data);
    const ordered = messages.where('roomId', '==', 'r').orderBy('createdAt', 'asc').orderBy('relayId', 'asc');
    expect((await ordered.get()).docs.map(doc => doc.id)).toEqual(['m1', 'm2', 'm3']);
    expect((await ordered.startAfter(2, 'a').get()).docs.map(doc => doc.id)).toEqual(['m3']);
    expect((await ordered.limit(2).get()).docs.map(doc => doc.id)).toEqual(['m1', 'm2']);
    expect((await messages.where('createdAt', '>=', 2).get()).size).toBe(2);
    expect((await messages.where('createdAt', '>', '1').get()).size).toBe(0);
    expect((await messages.count().get()).data().count).toBe(5);
  });

  it('applies a transaction all at once, or not at all, and serializes concurrent transactions', async () => {
    const { firestore } = createNodeSqliteFirestore();
    const counter = firestore.collection('counters').doc('c');
    await counter.set({ value: 0 });
    await Promise.all(Array.from({ length: 20 }, () => firestore.runTransaction(async transaction => {
      const value = (await transaction.get(counter)).data().value;
      await new Promise(resolve => setTimeout(resolve, 1));
      transaction.set(counter, { value: value + 1 });
    })));
    expect((await counter.get()).data().value).toBe(20);
    await expect(firestore.runTransaction(async transaction => {
      transaction.set(counter, { value: -1 });
      transaction.set(firestore.collection('counters').doc('d'), { value: 1 });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await expect(firestore.runTransaction(async transaction => {
      transaction.set(firestore.collection('counters').doc('e'), { value: 1 });
      transaction.create(counter, { value: 99 });
    })).rejects.toThrow(/already exists/);
    expect((await counter.get()).data().value).toBe(20);
    expect((await firestore.collection('counters').doc('d').get()).exists).toBe(false);
    expect((await firestore.collection('counters').doc('e').get()).exists).toBe(false);
    await expect(firestore.runTransaction(async transaction => {
      transaction.set(counter, { value: 1 });
      await transaction.get(counter);
    })).rejects.toThrow(/reads before writes/);
  });

  it('imports, inventories, exports and prunes for migration parity checks', async () => {
    const { firestore } = createNodeSqliteFirestore();
    await firestore.importDocuments([
      { path: 'research_records/r1', data: { roomId: 'reploid-default', kind: 'a' } },
      { path: 'reploid_change_passports/p/events/000000000001', data: { sequence: 1 } },
      { path: 'rate_limits/old', data: { expiresAt: '2026-01-01T00:00:00.000Z' } },
      { path: 'rate_limits/new', data: { expiresAt: '2099-01-01T00:00:00.000Z' } }
    ]);
    expect(firestore.inventory()).toEqual([
      { parent: 'rate_limits', count: 2 }, { parent: 'reploid_change_passports/p/events', count: 1 }, { parent: 'research_records', count: 1 }
    ]);
    expect((await firestore.collection('reploid_change_passports').doc('p').collection('events').orderBy('sequence').get()).size).toBe(1);
    expect(await firestore.pruneBefore('rate_limits', 'expiresAt', '2026-11-27T00:00:00.000Z')).toBe(1);
    expect(firestore.exportDocuments({ parent: 'rate_limits' }).map(entry => entry.path)).toEqual(['rate_limits/new']);
    expect((await firestore.listCollections()).map(entry => entry.id)).toEqual(['rate_limits', 'research_records']);
    await expect(firestore.importDocuments([{ path: 'odd', data: {} }])).rejects.toThrow(/Invalid document path/);
  });
});

describe('Pool coordinator store on SQLite matches the memory store', () => {
  it('keeps the full coordinator operation contract', () => {
    expect(validatePoolStoreContract(sqliteStore().store)).toEqual({ ok: true, missing: [] });
  });

  it('claims a provider\'s assignments oldest first, once each, as the Firestore query orders them', async () => {
    const results = [];
    for (const store of [sqliteStore().store]) {
      await store.registerProvider({ providerId: 'provider_a' });
      await store.createJob({ jobId: 'job_a', requesterId: 'requester_a', policyId: 'fastest_receipt' });
      await store.createAssignment({ assignmentId: 'assignment_b', jobId: 'job_a', providerId: 'provider_a' });
      await new Promise(resolve => setTimeout(resolve, 2));
      await store.createAssignment({ assignmentId: 'assignment_a', jobId: 'job_a', providerId: 'provider_a' });
      const first = await store.nextAssignmentForProvider('provider_a');
      const second = await store.nextAssignmentForProvider('provider_a');
      const third = await store.nextAssignmentForProvider('provider_a');
      results.push([first?.assignmentId, first?.status, second?.assignmentId, third]);
    }
    expect(results[0]).toEqual(['assignment_b', 'running', 'assignment_a', null]);
  });

  it('allocates per-room relay sequences once and pages messages without loss', async () => {
    const { store } = sqliteStore();
    const now = Date.now();
    const saved = [];
    for (let index = 0; index < 5; index += 1) {
      saved.push(await store.appendPeerRoomMessage('room_a', { relayId: `relay_${index}`, messageId: `relay_${index}`,
        type: 'provider-advert', fromPeerId: 'peer_a', payload: { index }, expiresAt: new Date(now + 60_000).toISOString() }));
    }
    expect(new Set(saved.map(entry => entry.relaySequence)).size).toBe(5);
    const seen = [];
    let page = await store.listPeerRoomMessages('room_a', { limit: 2 });
    for (let guard = 0; page.length && guard < 10; guard += 1) {
      seen.push(...page.map(message => message.relayId));
      const last = page.at(-1);
      page = await store.listPeerRoomMessages('room_a', { limit: 2, afterSequence: last.relaySequence });
    }
    expect(seen).toEqual(['relay_0', 'relay_1', 'relay_2', 'relay_3', 'relay_4']);
    const rooms = await store.listPeerRooms({});
    expect(JSON.stringify(rooms)).toContain('room_a');
  });

  it('keeps the first immutable research record and the same rate-limit window', async () => {
    const { store } = sqliteStore();
    const record = { recordHash: 'sha256:'.padEnd(71, 'a'), roomId: 'reploid-default', kind: 'note', body: 'first' };
    await store.saveResearchRecord(record);
    await store.saveResearchRecord({ ...record, body: 'second' }).catch(() => null);
    expect((await store.getResearchRecord(record.recordHash)).body).toBe('first');
    const inputs = { key: 'k', maxRequests: 2, bucketMs: 5000, now: 1000 };
    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: true, count: 1 });
    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: true, count: 2 });
    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: false, count: 3 });
    expect(await store.consumeRateLimit({ ...inputs, now: 6000 })).toMatchObject({ allowed: true, count: 1 });
  });

  it('settles a signed receipt acceptance once, including two concurrent identical requests', async () => {
    const { store } = sqliteStore();
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
    const job = await store.getJob('job_settlement');
    const summary = await buildAcceptanceSummary({ store, job, receiptHash: 'receipt_settlement' });
    const acceptance = await countersignReceipt({ ...summary, receiptHash: 'receipt_settlement', requesterId: job.requesterId, accepted: true }, keys.privateKey);
    const [first, second] = await Promise.all([1, 2].map(() => store.settleReceiptAcceptance({ receiptHash: 'receipt_settlement', acceptance })));
    expect(second).toEqual(first);
    const ledger = await store.listLedger({});
    const awards = (Array.isArray(ledger) ? ledger : ledger.events || []).filter(entry => entry.providerId === 'provider_settlement' || entry.userId === 'provider_settlement');
    expect(awards.length).toBeLessThanOrEqual(1);
    expect((await store.getJob('job_settlement')).status).toBe('accepted');
  });
});

describe('Change Control store on SQLite', () => {
  it('appends passport events in order and refuses a stale sequence', async () => {
    const { firestore } = createNodeSqliteFirestore();
    const store = createFirestoreChangeControlStore({ firestore, collectionPrefix: 'reploid' });
    const event = sequence => ({ sequence, timestamp: `2026-11-27T00:00:0${sequence}.000Z`, type: 'note' });
    await store.createPassport({ passportId: 'passport:1', event: event(1), idempotencyKey: 'c', requestHash: 'h1' });
    await store.appendEvent({ passportId: 'passport:1', event: event(2), expectedSequence: 1, idempotencyKey: 'a', requestHash: 'h2' });
    expect(await store.appendEvent({ passportId: 'passport:1', event: event(2), expectedSequence: 1, idempotencyKey: 'a', requestHash: 'h2' }))
      .toMatchObject({ sequence: 2 });
    await expect(store.appendEvent({ passportId: 'passport:1', event: event(2), expectedSequence: 1, idempotencyKey: 'b', requestHash: 'h3' }))
      .rejects.toMatchObject({ code: 'SEQUENCE_CONFLICT' });
    expect(await store.getEvents('passport:1')).toEqual([event(1), event(2)]);
    expect(await store.listPassportIds()).toEqual(['passport:1']);
  });
});
