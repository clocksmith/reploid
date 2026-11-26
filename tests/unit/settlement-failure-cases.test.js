// @vitest-environment node
// Cancellation, an unattributed disconnect and a verified provider failure, each as its own trade under the
// failed-stage rules (reploid.settlement-replay/v3): scripts/settlement/failure-cases.js drives a real ledger, the
// settlement replay and the second verifier over records signed by the production signers. Each case must honour the
// signed maximum, pay the stages that closed their signed share, leave no hold, and post the same amounts in all
// three. Test keys, simulated identities and a fake clock; this is no physical trade.
import { describe, expect, it } from 'vitest';
import { runFailureCases } from '../../scripts/settlement/failure-cases.js';

describe('a split answer that ends early, case by case', () => {
  it('honours the signed maximum, pays the stages as signed and leaves no hold', async () => {
    const report = await runFailureCases();
    for (const row of report.cases) expect(row.checks, row.case).toEqual(Object.fromEntries(Object.keys(row.checks).map(name => [name, true])));
    const by = Object.fromEntries(report.cases.map(row => [row.case, row]));
    // 8 outputs at 3 credits are quoted: at most 24. Weights 2, 3 and 1.
    expect(report.cases.map(row => [row.quote.maximum, row.holdAtReservation])).toEqual([[24, 24], [24, 24], [24, 24], [24, 24]]);
    // A signed stop at 5 acknowledged outputs: 15 units, every stage paid.
    expect(by.cancellation.ledger).toMatchObject({ debit: 15, payouts: [5, 7, 3], forfeited: [] });
    // 7 outputs delivered, 4 acknowledged, nothing else signed: the acknowledged prefix is charged, every stage paid.
    expect(by['unattributed disconnect']).toMatchObject({ delivered: 7, acknowledged: 4, ledger: { debit: 12, payouts: [4, 6, 2], forfeited: [] } });
    // The failed stage loses its own 6 and nobody else's amount changes; the requester pays 6, not 12.
    expect(by['verified provider failure (signed fault)'].ledger).toMatchObject({ debit: 6, payouts: [4, 0, 2], forfeited: [{ partitionIndex: 1, cause: 'fault' }],
      decidedAtTheWindow: false });
    expect(by['verified provider failure (silent)'].ledger).toMatchObject({ debit: 6, payouts: [4, 0, 2], forfeited: [{ partitionIndex: 1, cause: 'no-close' }],
      decidedAtTheWindow: true });
    for (const row of report.cases) expect(Object.values(row.holdsAfter), row.case).toEqual([0, 0, 0, 0]);
  });
});
