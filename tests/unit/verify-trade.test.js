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

  it('takes who is charged and who is paid from the accounts each party signed, not from the receipt\'s grouping', async () => {
    const verdict = await judged();
    for (const row of verdict.attempts) {
      expect(row.facts.accounts).toEqual({ requester: 'owner-requester', stages: ['owner-stage0', 'owner-stage1'] });
      expect(row.facts.ownAccountStages).toEqual([]);
    }
    // A receipt that lists stage 0 on the requester's computer changes nothing: that grouping is no longer consulted.
    const regrouped = await judged(r => { r.hosts[0].computerId = r.requester.computerId; });
    expect(problems(regrouped)).toEqual([]);
    expect(regrouped.attempts[0].facts.debit).toBe(verdict.attempts[0].facts.debit);
  });

  it('compares the signed accounts with the enrollment a receipt publishes, and refuses a party listed under another account', async () => {
    const enrol = stage0 => r => {
      r.requester.accountId = 'owner-requester';
      r.hosts[0].accountId = stage0;
      r.hosts[1].accountId = 'owner-stage1';
    };
    const agreed = await judged(enrol('owner-stage0'));
    expect(problems(agreed)).toEqual([]);
    expect(agreed.attempts.every(row => row.facts.enrollmentChecked === true)).toBe(true);
    // The publisher lists stage 0 under the requester's account; stage 0 signed its own.
    const grouped = await judged(enrol('owner-requester'));
    expect(grouped.ok).toBe(false);
    expect(problems(grouped).join('\n')).toMatch(/not final: invalid \(a participant signed an account it is not enrolled under\)/);
  });

  it.each([
    ['a share posted to an account its stage did not sign', r => { r.split.settlement.journalByAccount.find(row => row.accountId === 'owner-stage1').accountId = 'owner-someone-else'; }, /per account/],
    ['a receipt with signed accounts and no per-account journal', r => { delete r.split.settlement.journalByAccount; }, /no per-account journal/],
    ['a per-account journal that does not balance', r => { r.split.settlement.journalByAccount[0].delta -= 1; }, /does not sum to zero per account/]
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

describe('verify-trade and stages on the requester\'s own account', () => {
  // Five outputs at 3 credits, weights 1:3: stage 0's share is 3 and stage 1's is 12. With stage 0 on the requester's own
  // computer the ledger charges 12 and pays only stage 1.
  const ownStage = async ownComputer => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3] });
    const receipt = {
      requester: { participantId: parties.requester.peerId, computerId: 'computer-requester' },
      hosts: [{ participantId: parties.stages[0].peerId, computerId: ownComputer }, { participantId: parties.stages[1].peerId, computerId: 'computer-stage1' }],
      split: { settlementReplay: { records: a.all(), policy: POLICY }, settlement: { reservationId: a.reservationId, charge: 12,
        credits: [{ computerId: 'computer-stage1', amount: 12 }],
        journal: [{ accountId: 'computer-requester', delta: -12 }, { accountId: 'computer-stage1', delta: 12 }] } }
    };
    return { verdict: await verifyTrade({ receipt, at: a.decidedAt }), stage0: parties.stages[0].peerId };
  };

  it('passes, and names the stage it treated as the requester\'s own', async () => {
    const { verdict, stage0 } = await ownStage('computer-requester');
    expect(problems(verdict)).toEqual([]);
    expect(verdict.attempts[0].facts).toMatchObject({ status: 'settled', debit: 12, ownAccountStages: [stage0] });
  });

  it('fails the same ledger amounts when the receipt gives that stage its own computer: the grouping decides, and it is not signed', async () => {
    const { verdict } = await ownStage('computer-stage0');
    expect(verdict.attempts[0].facts.ownAccountStages).toEqual([]);
    expect(problems(verdict).join('\n')).toMatch(/the ledger charged 12, the signed records imply 15/);
  });
});
