// Shared durable-scheduler fixture. Test-only intervals, batch sizes and leases; no product decisions.
import { expect } from 'vitest';

/**
 * A scheduler backend whose process dies before it records a finished pass:
 * the transaction that would mark the pass completed or failed throws, so the
 * lease and the `running` pass stay behind exactly as after a crash.
 */
export const dyingBeforeFinish = (backend) => ({
  ...backend,
  runTransaction: (operation) => backend.runTransaction((tx) => operation({
    get: (collection, id) => tx.get(collection, id),
    create: (collection, id, value) => tx.create(collection, id, value),
    set(collection, id, value) {
      if (collection === 'passes' && !['running', 'abandoned'].includes(value?.status)) {
        throw new Error('simulated process death before the pass was recorded');
      }
      return tx.set(collection, id, value);
    }
  }))
});

/** Every job's result in one round, by job id. */
export const byJob = (results) => Object.fromEntries(results.map((result) => [result.jobId, result]));

/** Each account's balances and open lots; sweeps may add or release holds, never remove credit. */
export const balanceSnapshot = async (ledger, accountIds) => Object.fromEntries(await Promise.all(accountIds.map(async (accountId) => {
  const account = await ledger.getAccount(accountId);
  return [accountId, account];
})));

/**
 * No balance was expired, spent, reversed or refunded between two snapshots:
 * every lot still holds what it held (released holds return to it), and per
 * provenance nothing was spent, reversed or refunded.
 */
export function expectBalancesKept(before, after) {
  for (const [accountId, prior] of Object.entries(before)) {
    if (!prior) continue;
    const current = after[accountId];
    expect(current.outstanding).toBeGreaterThanOrEqual(prior.outstanding);
    for (const [kind, totals] of Object.entries(prior.byProvenance)) {
      expect(current.byProvenance[kind]).toMatchObject({ spent: totals.spent, reversed: totals.reversed, refunded: totals.refunded });
      expect(current.byProvenance[kind].issued).toBeGreaterThanOrEqual(totals.issued);
    }
    for (const lot of prior.openLots) {
      const kept = current.openLots.find((entry) => entry.lotId === lot.lotId);
      expect(kept, `${accountId} lot ${lot.lotId}`).toBeTruthy();
      expect(kept.available + kept.held).toBe(lot.available + lot.held);
    }
  }
}
