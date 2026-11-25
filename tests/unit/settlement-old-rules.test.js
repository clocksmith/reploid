// @vitest-environment node
// Records, replay rows, ledger outcomes and owner statements frozen from the code that ran the two older settlement
// rules (tests/fixtures/settlement-old-rules.json, each set's `generatedFrom` commit). The current replay and statement
// check must still read them exactly as they were read then, so earlier signed statements keep verifying.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { SETTLEMENT_RULES_INTERIM, SETTLEMENT_RULES_V1, UNFINISHED_ANSWER_TERMS } from '../../server/fleet/credit-shares.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/settlement-old-rules.json', import.meta.url), 'utf8'));
const withoutReason = rows => rows.map(({ reason: _reason, ...row }) => row);

describe.each(fixture.rules.map(set => [set.label, set]))('reservations made under %s', (label, set) => {
  it('were signed under the provider-loss-free terms and reserved under that rules id', () => {
    expect([SETTLEMENT_RULES_V1, SETTLEMENT_RULES_INTERIM]).toContain(label);
    for (const attempt of set.attempts) {
      expect(attempt.records.find(row => row.schema === 'reploid.settlement-terms/v1').unfinishedTerms).toBe(UNFINISHED_ANSWER_TERMS);
    }
    for (const statement of set.statements) {
      for (const entry of statement.entries) expect(entry.request.settlementRules).toBe(label);
    }
  });

  it('replay to the same rows, counts and balances as when they were signed', async () => {
    const accountOf = id => set.accounts[id];
    const replayed = await replaySettlement({ records: set.attempts.flatMap(row => row.records), policies: [set.policy], at: set.at, accountOf });
    expect(replayed.counts).toEqual(set.replay.counts);
    expect(replayed.balances).toEqual(set.replay.balances);
    expect(replayed.rejected).toEqual(set.replay.rejected);
    expect(withoutReason(replayed.reservations)).toEqual(withoutReason(set.replay.reservations));
    // The stage-ended answer is still free in the replay under these terms.
    const ended = replayed.reservations.find(row => row.reservationId === 'reservation-stages-close-early');
    expect(ended).toMatchObject({ status: 'settled', outputs: 3, chargedOutputs: 0, debit: 0 });
  });

  it('keep the ledger outcome they were settled with, and every owner statement still verifies', async () => {
    const ended = set.outcomes['stages-close-early'];
    expect(ended.charge).toBe(label === SETTLEMENT_RULES_V1 ? 0 : 9);
    expect(ended.reason).toBe(label === SETTLEMENT_RULES_V1 ? 'stage-ended-unfinished-answer' : 'unfinished-answer-closed-without-requester-stop');
    for (const statement of set.statements) {
      const verdict = await verifyCreditStatement(statement);
      expect(verdict).toMatchObject({ ok: true, uncheckedCount: 0, balanceMatches: true });
      expect(verdict.recomputedBalance).toBe(statement.balance);
    }
  });
});
