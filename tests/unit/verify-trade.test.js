// @vitest-environment node
// The outsider's trade check (docs/verify-a-trade.md) on a receipt the Stage 1 harness wrote on three local processes
// with a fake runtime (tests/fixtures/stage1-trade). Proves the check passes an honest receipt and refuses edited
// amounts, policies and records; it does not prove anything about a physical trade. The older-rules cases at the end
// use records signed here with test keys.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTrade, verifyTrade } from '../../scripts/settlement/verify-trade.js';
import { POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';
import { UNFINISHED_ANSWER_TERMS } from '../../server/fleet/credit-shares.js';

const DIRECTORY = fileURLToPath(new URL('../fixtures/stage1-trade', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/settlement/verify-trade.js', import.meta.url));
const AT = Date.parse('2030-01-01T00:00:00.000Z');
const trade = readTrade(DIRECTORY);
const judged = async change => {
  const receipt = structuredClone(trade.receipt);
  change?.(receipt);
  return verifyTrade({ receipt, policy: trade.policy, at: AT });
};
const problems = verdict => verdict.attempts.flatMap(row => row.problems.map(text => `${row.name}: ${text}`));

describe('verify-trade on a Stage 1 receipt', () => {
  it('passes the published receipt: signatures, policy digest, both replays, debit, payouts and journal', async () => {
    const verdict = await judged();
    expect(problems(verdict)).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.attempts.map(row => row.name)).toEqual(['split', 'cancel', 'drop']);
    const [split, cancel, drop] = verdict.attempts.map(row => row.facts);
    expect(split).toMatchObject({ status: 'settled', debit: trade.receipt.split.settlement.charge,
      unfinishedTerms: 'reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1' });
    expect(cancel).toMatchObject({ status: 'settled', debit: trade.receipt.cancel.settlement.charge });
    expect(drop).toMatchObject({ debit: 0 });
  });

  it.each([
    ['a ledger charge the records do not imply', r => { r.split.settlement.charge += 1; }, /the ledger charged/],
    ['a payout moved between stages', r => { const [a, b] = r.split.settlement.credits; a.amount += 1; b.amount -= 1; }, /the ledger paid/],
    ['a journal entry changed', r => { r.split.settlement.journal[0].delta -= 1; }, /journal/],
    ['a policy other than the one signed', r => { r.split.settlementReplay.policy = { ...r.split.settlementReplay.policy, creditsPerOutputToken: 2 }; }, /policy/],
    ['a record edited after it was signed', r => {
      const ack = r.split.settlementReplay.records.find(row => row.schema === 'reploid.output-acknowledgment/v1' && row.count > 0);
      ack.count += 1;
    }, /failed their signature/],
    ['a stored replay that differs from a fresh one', r => { r.cancel.settlementReplay.result.reservations[0].debit += 1; }, /stored in the receipt/]
  ])('refuses %s', async (_name, change, pattern) => {
    const verdict = await judged(change);
    expect(verdict.ok).toBe(false);
    expect(problems(verdict).join('\n')).toMatch(pattern);
  });

  it('refuses an attempt still inside its release window, and a receipt with no public policy', async () => {
    const early = await verifyTrade({ ...trade, at: Date.parse(trade.receipt.split.settlementReplay.records[0].notBefore) });
    expect(problems(early).join('\n')).toMatch(/not final/);
    const bare = await judged(r => { for (const name of ['split', 'cancel', 'drop']) delete r[name].settlementReplay.policy; });
    expect(problems(bare).join('\n')).toMatch(/no public policy/);
  });

  it('runs as one plain Node command', () => {
    const out = execFileSync(process.execPath, [SCRIPT, DIRECTORY, '--at', new Date(AT).toISOString()], { encoding: 'utf8' });
    expect(out).toMatch(/^PASS split:/m);
    expect(out).toMatch(/The trade verifies\./);
  });
});

describe('verify-trade on a receipt under the older rules', () => {
  // An unfinished answer the stages closed with no stop, under the provider-loss-free terms: the replay charges 0 and
  // the interim ledger charged the acknowledged prefix, 3 outputs at 3 credits, split 1:3 by the signed weights.
  const older = async (charge, [first, second]) => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS });
    const receipt = {
      requester: { participantId: parties.requester.peerId, computerId: 'computer-requester' },
      hosts: parties.stages.map((stage, index) => ({ participantId: stage.peerId, computerId: `computer-stage${index}` })),
      unfinished: { settlementReplay: { records: a.all(), policy: POLICY }, settlement: { reservationId: a.reservationId, charge,
        credits: [{ computerId: 'computer-stage0', amount: first }, { computerId: 'computer-stage1', amount: second }],
        journal: [{ accountId: 'computer-requester', delta: -charge }, { accountId: 'computer-stage0', delta: first }, { accountId: 'computer-stage1', delta: second }] } }
    };
    return verifyTrade({ receipt, at: a.decidedAt });
  };

  it('passes the one known difference when the prefix is split by the signed weights', async () => {
    const verdict = await older(9, [2, 7]);
    expect(problems(verdict)).toEqual([]);
    expect(verdict.attempts[0].facts).toMatchObject({ status: 'settled', debit: 0, olderRulesDifference: 'unfinished-split-answer-closed-without-stop' });
  });

  it('refuses the same charge paid in other shares, and a charge that is not the acknowledged prefix', async () => {
    expect(problems(await older(9, [7, 2])).join('\n')).toMatch(/under the older rules the ledger paid/);
    expect(problems(await older(8, [2, 6])).join('\n')).toMatch(/the ledger charged 8, the signed records imply 0/);
  });
});
