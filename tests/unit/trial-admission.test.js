// @vitest-environment node
import { expect, it } from 'vitest';
import { createTrialAdmission, TRIAL_COLLECTIONS } from '../../server/trial-admission.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../../server/ledger/memory-store.js';

// Fictional test exposure and ledger projections, not a deployed pricing policy.
const policy = { trialId: 'fixture', currency: 'USD', totalMinor: 120, accountMinor: 80, maxConcurrent: 1 };
function fixture() {
  const state = createMemoryLedgerState(), reservations = new Map(), settlements = new Map();
  let now = 1000;
  const open = (overrides = {}) => createTrialAdmission({
    backend: createMemoryLedgerBackend({ state, collections: TRIAL_COLLECTIONS }), policy, production: false,
    readReservation: async id => reservations.get(id), readSettlement: async id => settlements.get(id), clock: () => now, ...overrides
  });
  const quote = (reservationId, accountId, maxSubsidyMinor) => {
    reservations.set(reservationId, { reservationId, accountId, maxSubsidyMinor, accepted: true, currency: 'USD',
      quoteIdentity: 'quote:' + reservationId, expiresAt: now + 10000 });
    return { accountId, reservationId };
  };
  const settle = (reservationId, subsidyMinor, executionSettled = true) => settlements.set(reservationId, {
    reservationId, accountId: reservations.get(reservationId).accountId, settlementId: 'settled:' + reservationId,
    currency: 'USD', subsidyMinor, executionSettled
  });
  return { open, quote, settle, reservations, settlements, advance: () => { now += 100000000; } };
}

it('shares one slot across instances, replays and restarts without expiring uncertain execution', async () => {
  const f = fixture(), one = f.open(), two = f.open();
  const a = f.quote('a', 'account-a', 30), b = f.quote('b', 'account-b', 30);
  const outcomes = await Promise.allSettled([one.reserve(a), two.reserve(b)]);
  expect(outcomes.map(row => row.status)).toEqual(['fulfilled', 'rejected']);
  expect(outcomes[1].reason.message).toContain('concurrency');
  expect((await f.open().reserve(a)).admitted).toBe(false);
  expect(await one.reconcile('a')).toEqual({ released: false });
  f.settle('a', 10, false);
  expect(await one.reconcile('a')).toEqual({ released: false });
  f.advance();
  await expect(f.open().reserve(f.quote('c', 'account-c', 20))).rejects.toThrow('concurrency');
  f.settle('a', 10);
  expect((await two.reconcile('a')).released).toBe(true);
  expect((await one.reconcile('a')).released).toBe(false);
  expect(await f.open().getState()).toMatchObject({ active: 0, spentMinor: 10, reservedMinor: 0 });
});

it('enforces lifetime account and global limits, returning only unspent reservation headroom', async () => {
  const f = fixture(), guard = f.open();
  await guard.reserve(f.quote('a', 'account-a', 80)); f.settle('a', 60); await guard.reconcile('a');
  f.advance();
  await expect(f.open().reserve(f.quote('b', 'account-a', 21))).rejects.toThrow('lifetime account');
  await guard.reserve(f.quote('c', 'account-a', 20)); f.settle('c', 20); await guard.reconcile('c');
  await expect(guard.reserve(f.quote('d', 'account-b', 41))).rejects.toThrow('total subsidy');
  await guard.reserve(f.quote('e', 'account-b', 40)); f.settle('e', 40); await guard.reconcile('e');
  await expect(guard.reserve(f.quote('f', 'account-c', 1))).rejects.toThrow('total subsidy');
  expect(await guard.getState()).toMatchObject({ active: 0, spentMinor: 120, reservedMinor: 0 });
});

it('refuses changed reservations, limits, currency, accounts and oversized settlements', async () => {
  const f = fixture(), guard = f.open(), a = f.quote('a', 'account-a', 30);
  await guard.reserve(a);
  await expect(f.open({ policy: { ...policy, totalMinor: 121 } }).getState()).rejects.toThrow('limits changed');
  await expect(guard.reserve({ ...a, accountId: 'other' })).rejects.toThrow('reservation required');
  f.reservations.get('a').maxSubsidyMinor++;
  await expect(guard.reserve(a)).rejects.toThrow('replay changed');
  f.settle('a', 31);
  await expect(guard.reconcile('a')).rejects.toThrow('exceeds');
  f.settle('a', 5); f.settlements.get('a').currency = 'EUR';
  await expect(guard.reconcile('a')).rejects.toThrow('Bound ledger settlement');
  expect(await guard.getState()).toMatchObject({ active: 1, reservedMinor: 30, spentMinor: 0 });
});

it('requires explicit limits and refuses memory storage for production', () => {
  const f = fixture();
  expect(() => f.open({ policy: undefined })).toThrow('Explicit trial exposure');
  expect(() => f.open({ production: true })).toThrow('durable shared storage');
});
