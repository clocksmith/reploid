/** Durable exposure limits around accepted ledger reservations. This creates no money,
 * price, credit, or settlement. Quote and settled-cost projections belong to the ledger adapter. */
import { assertLedgerBackend } from './ledger/store-contract.js';
import { createHash } from 'node:crypto';

export const TRIAL_COLLECTIONS = Object.freeze({ totals: 'trial_totals', accounts: 'trial_accounts', holds: 'trial_holds' });
const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const assert = (ok, message, status = 409) => { if (!ok) throw Object.assign(Error(message), { status }); };
const amount = n => Number.isSafeInteger(n) && n >= 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

export function createTrialAdmission({ backend, policy, readReservation, readSettlement, production = true, clock = Date.now }) {
  assertLedgerBackend(backend);
  assert(!production || backend.kind === 'firestore', 'Production trial admission requires durable shared storage');
  assert(text(policy?.trialId) && policy.currency === 'USD' && amount(policy.totalMinor) && policy.totalMinor > 0
    && amount(policy.accountMinor) && policy.accountMinor > 0 && policy.accountMinor <= policy.totalMinor
    && Number.isSafeInteger(policy.maxConcurrent) && policy.maxConcurrent > 0, 'Explicit trial exposure limits required');
  assert(typeof readReservation === 'function' && typeof readSettlement === 'function', 'Trial admission requires ledger reservation and settlement readers');
  policy = structuredClone(policy);
  const binding = JSON.stringify([policy.currency, policy.totalMinor, policy.accountMinor, policy.maxConcurrent]);
  const trialKey = key(policy.trialId);
  const blank = () => ({ spentMinor: 0, reservedMinor: 0, active: 0 });
  const totalsFor = existing => {
    assert(!existing || existing.binding === binding, 'Trial limits changed under an existing trial identity');
    return existing || { ...blank(), binding };
  };
  return Object.freeze({
    async reserve({ accountId, reservationId }) {
      assert(text(accountId) && text(reservationId), 'Trial account and reservation identities required');
      const quote = structuredClone(await readReservation(reservationId));
      assert(quote?.reservationId === reservationId && quote.accountId === accountId && quote.accepted === true
        && quote.currency === policy.currency && text(quote.quoteIdentity) && amount(quote.maxSubsidyMinor)
        && Number.isFinite(quote.expiresAt), 'Accepted, currency-bound ledger reservation required');
      const holdKey = key(policy.trialId, reservationId), accountKey = key(policy.trialId, accountId);
      return backend.runTransaction(async tx => {
        const existing = await tx.get('holds', holdKey);
        const totals = totalsFor(await tx.get('totals', trialKey));
        const account = await tx.get('accounts', accountKey) || blank();
        if (existing) {
          assert(existing.accountId === accountId && existing.quoteIdentity === quote.quoteIdentity
            && existing.maxSubsidyMinor === quote.maxSubsidyMinor, 'Trial reservation replay changed its binding');
          return { admitted: false, record: existing };
        }
        assert(quote.expiresAt > clock(), 'Trial reservation expired');
        assert(totals.active < policy.maxConcurrent, 'Trial global concurrency exhausted', 429);
        assert(totals.spentMinor + totals.reservedMinor + quote.maxSubsidyMinor <= policy.totalMinor, 'Trial total subsidy exhausted', 403);
        assert(account.spentMinor + account.reservedMinor + quote.maxSubsidyMinor <= policy.accountMinor, 'Trial lifetime account subsidy exhausted', 403);
        const record = { reservationId, accountId, quoteIdentity: quote.quoteIdentity, maxSubsidyMinor: quote.maxSubsidyMinor,
          state: 'reserved', reservedAt: clock() };
        for (const counter of [totals, account]) { counter.reservedMinor += quote.maxSubsidyMinor; counter.active++; }
        tx.create('holds', holdKey, record); tx.set('totals', trialKey, totals); tx.set('accounts', accountKey, account);
        return { admitted: true, record };
      });
    },
    async reconcile(reservationId) {
      assert(text(reservationId), 'Trial reservation identity required');
      // A timeout, HTTP disconnect or missing receipt is not execution settlement.
      const settled = structuredClone(await readSettlement(reservationId));
      if (!settled?.executionSettled) return { released: false };
      assert(settled.reservationId === reservationId && text(settled.accountId) && text(settled.settlementId)
        && settled.currency === policy.currency && amount(settled.subsidyMinor), 'Bound ledger settlement required');
      return backend.runTransaction(async tx => {
        const holdKey = key(policy.trialId, reservationId), accountKey = key(policy.trialId, settled.accountId);
        const record = await tx.get('holds', holdKey);
        const totals = totalsFor(await tx.get('totals', trialKey));
        const account = await tx.get('accounts', accountKey);
        assert(record && account && record.accountId === settled.accountId && settled.subsidyMinor <= record.maxSubsidyMinor,
          'Trial settlement exceeds or differs from its reservation');
        if (record.state === 'settled') {
          assert(record.settlementId === settled.settlementId && record.subsidyMinor === settled.subsidyMinor, 'Trial settlement replay changed');
          return { released: false, record };
        }
        for (const counter of [totals, account]) {
          counter.reservedMinor -= record.maxSubsidyMinor; counter.spentMinor += settled.subsidyMinor; counter.active--;
        }
        const completed = { ...record, state: 'settled', settlementId: settled.settlementId, subsidyMinor: settled.subsidyMinor, settledAt: clock() };
        tx.set('holds', holdKey, completed); tx.set('totals', trialKey, totals); tx.set('accounts', accountKey, account);
        return { released: true, record: completed };
      });
    },
    async getState() { return structuredClone(totalsFor(await backend.get('totals', trialKey))); }
  });
}
