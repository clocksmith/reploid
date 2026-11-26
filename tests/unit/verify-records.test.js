// @vitest-environment node
// The records-only check (docs/verify-a-trade.md, "Records only"): an export holds signed records and the publisher's
// stated amounts and nothing else, and scripts/settlement/verify-records.js recomputes the debit and every payout from
// it with the second verifier alone. Proves that the export leaks no text, token or ledger field, that an honest export
// passes and edited amounts, records and statements are refused, and what the hold line rests on. The receipt is the
// Stage 1 fixture (three local processes, a fake runtime) and the v3 trades are the in-process failure cases: test keys
// and simulated parties throughout, nothing here is a physical trade.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { UNFINISHED_ANSWER_TERMS } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { signSettlementStatement, verifySettlementStatement } from '../../server/fleet/settlement-statement.js';
import { replaySettlement as secondReplay } from '../../scripts/settlement/independent/replay.js';
import { assertRecordsOnly, exportFailureCases, exportFromReceipt } from '../../scripts/settlement/records-export.js';
import { POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';
import { checkStatement, signedShares, verifyRecords } from '../../scripts/settlement/verify-records.js';
import { readTrade } from '../../scripts/settlement/verify-trade.js';

const DIRECTORY = fileURLToPath(new URL('../fixtures/stage1-trade', import.meta.url));
const SCRIPT = name => fileURLToPath(new URL(`../../scripts/settlement/${name}`, import.meta.url));
const AT = Date.parse('2030-01-01T00:00:00.000Z');
const source = readTrade(DIRECTORY);
const fromFixture = () => exportFromReceipt({ id: 'fixture', label: 'Fixture trade', ...structuredClone(source) });
const problems = verdict => [...(verdict.problems ?? []), ...verdict.attempts.flatMap(row => row.problems.map(text => `${row.name}: ${text}`))];
const judged = async (trade, change) => { const copy = structuredClone(trade); change?.(copy); return verifyRecords({ trade: copy, at: AT }); };

describe('a records-only export of a receipt', () => {
  it('carries no answer text, token ID, workload or ledger journal', () => {
    const trade = fromFixture(), text = JSON.stringify(trade);
    const names = new Set();
    JSON.stringify(trade, (key, value) => { if (key && !/^\d+$/.test(key)) names.add(key); return value; });
    // The receipt's own fields for those things.
    for (const leaked of ['text', 'visibleText', 'partialText', 'outputIds', 'workload', 'messagesDigest', 'promptDigest', 'journal', 'journalByAccount', 'credits',
      'charge', 'balance', 'accountAfter', 'result', 'machine', 'inventory']) expect(names.has(leaked), leaked).toBe(false);
    // Their values: the output token IDs, the model and the prompt digest of the fixture.
    expect(source.receipt.split.tokens.outputIds.length).toBeGreaterThan(0);
    expect(text).not.toContain(JSON.stringify(source.receipt.split.tokens.outputIds).slice(1, -1));
    for (const value of [source.receipt.workload.modelId, source.receipt.workload.promptDigest, source.receipt.workload.messagesDigest.slice(7), source.receipt.split.tokens.sampleDigest]) {
      expect(text).not.toContain(value);
    }
    // Every record is one of the six signed kinds, and the only token members are a stage receipt's two counts.
    for (const attempt of trade.attempts) {
      for (const record of attempt.records) {
        expect(record.schema).toMatch(/^reploid\.(settlement-(terms|acceptance|stop|stage-fault)|stage-receipt|output-acknowledgment)\/v1$/);
        if (record.tokens) expect(Object.values(record.tokens).every(value => value === null || Number.isSafeInteger(value))).toBe(true);
      }
      expect(Object.keys(attempt).sort()).toEqual(['enrollment', 'enrollmentSource', 'name', 'records', 'requesterId', 'reservationId', 'stated']);
    }
  });

  it.each([
    ['answer text beside an attempt', t => { t.attempts[0].text = 'The answer'; }],
    ['answer text inside a record', t => { t.attempts[0].records[3].delta = ' answer'; }],
    ['output token IDs', t => { t.attempts[0].outputIds = [17, 17, 248046]; }],
    ['token IDs in a stage receipt\'s tokens', t => { t.attempts[0].records.find(row => row.tokens).tokens.processed = [17, 248046]; }],
    ['a prompt', t => { t.attempts[0].records.find(row => row.tokens).tokens.prompt = 'What is 11 + 11?'; }],
    ['the ledger journal', t => { t.attempts[0].journal = [{ accountId: 'owner-requester', delta: -3 }]; }],
    ['a workload description', t => { t.workload = { modelId: 'model' }; }],
    ['a long text in a record field', t => { t.attempts[0].records[0].unit = 'x'.repeat(300); }],
    ['a record that is not a signed settlement record', t => { t.attempts[0].records.push({ schema: 'reploid.chat-message/v1' }); }]
  ])('the builder refuses %s', (_name, change) => {
    const trade = fromFixture();
    change(trade);
    expect(() => assertRecordsOnly(trade)).toThrow();
  });

  it('reproduces every debit and payout from the records, within the signed maximum', async () => {
    const verdict = await judged(fromFixture());
    expect(problems(verdict)).toEqual([]);
    expect(verdict.attempts.map(row => row.name)).toEqual(['split', 'cancel', 'drop']);
    for (const [index, name] of ['split', 'cancel', 'drop'].entries()) {
      const facts = verdict.attempts[index].facts, trace = source.receipt[name].settlement;
      expect(facts.debit).toBe(trace.charge);
      expect(facts.stated.debit).toBe(trace.charge);
      expect(facts.debit).toBeLessThanOrEqual(facts.quote.maximum);
      expect(facts.stages.map(stage => stage.paid)).toEqual(facts.stages.map(stage => stage.specified));
      expect(Object.values(facts.payouts).reduce((sum, amount) => sum + amount, 0)).toBe(trace.charge);
    }
  });

  it('does not call the hold released on the publisher\'s word', async () => {
    const verdict = await judged(fromFixture());
    expect(verdict.holdReleaseShown).toBe(0);
    expect(verdict.attempts.every(row => row.facts.hold.basis === 'publisher-stated' && row.facts.hold.releaseShown === false)).toBe(true);
    expect(problems(await judged(fromFixture(), t => { t.attempts[0].stated.hold.remaining = 4; })).join('\n')).toMatch(/states 4 still held/);
  });

  it.each([
    ['a stated debit the records do not imply', t => { t.attempts[0].stated.debit += 1; }, /states a debit of 4, the signed records imply 3/],
    ['a stated payout moved between accounts', t => { const [a, b] = t.attempts[0].stated.payouts; a.amount += 1; b.amount -= 1; }, /states payouts/],
    ['a stated outcome the records do not imply', t => { t.attempts[2].stated.status = 'settled'; }, /states settled, the signed records imply expired/],
    ['a record edited after it was signed', t => { t.attempts[0].records.find(row => row.schema === 'reploid.output-acknowledgment/v1' && row.count > 0).count += 1; }, /failed their signature/],
    ['a record with a member no record has', t => { t.attempts[0].records[2].text = 'hi'; }, /failed their signature or shape/],
    ['a policy other than the one signed', t => { t.policy = { ...t.policy, creditsPerOutputToken: 2 }; }, /policy/],
    ['an attempt with a member a records-only attempt does not have', t => { t.attempts[0].journal = []; }, /unknown or missing member/],
    ['a key listed under another account than it signed', t => { t.attempts[0].enrollment[1].account = 'owner-requester'; }, /not final: invalid/]
  ])('refuses %s', async (_name, change, pattern) => {
    const verdict = await judged(fromFixture(), change);
    expect(verdict.ok).toBe(false);
    expect(problems(verdict).join('\n')).toMatch(pattern);
  });

  it('refuses a debit over the signed maximum even when the publisher states the same', async () => {
    // Signed terms cap the charge at 4; no honest record set implies more, so only the stated side can exceed it.
    const verdict = await judged(fromFixture(), t => { t.attempts[0].stated.debit = 5; });
    expect(problems(verdict).join('\n')).toMatch(/exceeds the signed maximum 4/);
  });

  it('runs as one plain Node command, alone and as verify-trade.js --records', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'verify-records-'));
    try {
      writeFileSync(path.join(directory, 'trade.json'), JSON.stringify(fromFixture()));
      for (const args of [[SCRIPT('verify-records.js'), directory], [SCRIPT('verify-trade.js'), '--records', path.join(directory, 'trade.json')]]) {
        const out = execFileSync(process.execPath, [...args, '--at', new Date(AT).toISOString()], { encoding: 'utf8' });
        expect(out).toMatch(/^PASS split: settled/m);
        expect(out).toMatch(/its release is NOT proven here/);
        expect(out).toMatch(/Hold release shown by a signed statement in 0 of 3 attempts\./);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('imports nothing but the second verifier and Node built-ins', () => {
    const imports = file => [...readFileSync(SCRIPT(file), 'utf8').matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]);
    expect(imports('verify-records.js').filter(spec => !spec.startsWith('node:'))).toEqual(['./independent/replay.js']);
    expect(imports('independent/replay.js').filter(spec => !spec.startsWith('node:'))).toEqual([]);
  });
});

describe('the simulated v3 trades with the coordinator\'s signed statement', () => {
  let trade;
  beforeAll(async () => { trade = await exportFailureCases(); }, 60000);

  it('are labelled as simulated, and reproduce the debit, each payout and the forfeit', async () => {
    expect(trade.simulated).toMatch(/^SIMULATED: test keys/);
    const verdict = await judged(trade);
    expect(problems(verdict)).toEqual([]);
    const facts = Object.fromEntries(verdict.attempts.map(row => [row.name, row.facts]));
    // 8 outputs at 3 credits are quoted: at most 24. Weights 2, 3 and 1.
    expect(facts.cancellation).toMatchObject({ settlementRules: 'reploid.settlement-replay/v3', debit: 15, payouts: { 'owner-a': 5, 'owner-b': 7, 'owner-c': 3 }, forfeited: [] });
    expect(facts['unattributed disconnect']).toMatchObject({ debit: 12, payouts: { 'owner-a': 4, 'owner-b': 6, 'owner-c': 2 }, forfeited: [] });
    expect(facts['verified provider failure (signed fault)']).toMatchObject({ debit: 6, payouts: { 'owner-a': 4, 'owner-c': 2 }, forfeited: [1] });
    expect(facts['verified provider failure (silent)']).toMatchObject({ debit: 6, payouts: { 'owner-a': 4, 'owner-c': 2 }, forfeited: [1] });
    expect(facts['verified provider failure (silent)'].stages[1]).toMatchObject({ signedShare: 6, forfeited: 'no-close', specified: 0, paid: 0 });
    for (const row of verdict.attempts) expect(row.facts.quote.maximum).toBe(24);
  });

  it('show the hold released by the coordinator\'s signature, and only by it', async () => {
    const verdict = await judged(trade);
    expect(verdict.holdReleaseShown).toBe(4);
    for (const row of verdict.attempts) {
      expect(row.facts.hold).toMatchObject({ basis: 'coordinator-signed', placed: 24, released: 24, remaining: 0, releaseShown: true });
      expect(row.facts.hold.coordinatorId).toBe(trade.attempts[0].statement.coordinatorId);
    }
    // An edited statement no longer verifies; nothing falls back to trusting it.
    const edited = await judged(trade, t => { t.attempts[0].statement.hold = { placed: 24, released: 24, remaining: 0 }; t.attempts[0].statement.debit = 14; });
    expect(problems(edited).join('\n')).toMatch(/coordinator's statement is refused: its signature does not verify/);
    expect(edited.attempts[0].facts.hold).toBeUndefined();
  });

  it('refuse a coordinator that signs a surviving hold, a smaller hold, other amounts or another attempt\'s terms', async () => {
    const coordinator = createAttemptEvidenceSigner({ identity: (await createParties(0)).requester, now: () => AT });
    const terms = index => trade.attempts[index].records.find(row => row.schema === 'reploid.settlement-terms/v1');
    const sign = (index, change) => signSettlementStatement({ signer: coordinator, terms: terms(index), settlementRules: 'reploid.settlement-replay/v3', status: 'settled',
      debit: 15, payouts: [{ account: 'owner-a', amount: 5 }, { account: 'owner-b', amount: 7 }, { account: 'owner-c', amount: 3 }], forfeited: [],
      hold: { placed: 24, remaining: 0 }, ...change });
    const withStatement = async statement => problems(await judged(trade, t => { t.attempts[0].statement = statement; })).join('\n');
    expect(await withStatement(await sign(0, {}))).toBe('');
    expect(await withStatement(await sign(0, { hold: { placed: 24, remaining: 9 } }))).toMatch(/coordinator states 9 still held/);
    expect(await withStatement(await sign(0, { hold: { placed: 15, remaining: 0 } }))).toMatch(/states a hold of 15; the signed maximum is 24/);
    expect(await withStatement(await sign(0, { debit: 16 }))).toMatch(/states a debit of 16, the signed records imply 15/);
    expect(await withStatement(await sign(0, { forfeited: [2] }))).toMatch(/states forfeits \[2\]/);
    expect(await withStatement(await sign(0, { settlementRules: 'reploid.settlement-replay/v2' }))).toMatch(/does not settle under the signed terms/);
    expect(await withStatement(await sign(1, {}))).toMatch(/names terms that are not the agreed ones/);
  });

  it('carry a statement the service\'s own check accepts, which neither replay reads as a record', async () => {
    const statement = trade.attempts[0].statement;
    expect(await verifySettlementStatement(statement)).toMatchObject({ ok: true });
    expect(checkStatement(statement).body.coordinatorId).toBe(statement.coordinatorId);
    expect(checkStatement({ ...statement, signature: `${statement.signature.slice(0, -1)}${statement.signature.endsWith('A') ? 'Q' : 'A'}` }).problem).toBeTruthy();
    const records = [...trade.attempts[0].records, statement];
    for (const replay of [replaySettlement, secondReplay]) {
      const result = await replay({ records, policies: [trade.policy], at: AT });
      expect(result.rejected.map(row => row.index)).toEqual([records.length - 1]);
      expect(result.reservations[0]).toMatchObject({ status: 'settled', debit: 15 });
    }
  });
});

describe('records-only under the older rules', () => {
  // As in verify-trade.test.js: an unfinished answer the stages closed with no stop, under the provider-loss-free terms.
  // The replay charges 0; the interim ledger charged the acknowledged prefix, 3 outputs at 3 credits, split 1:3.
  const older = async (debit, [first, second]) => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS });
    const receipt = {
      requester: { participantId: parties.requester.peerId, computerId: 'computer-requester' },
      hosts: parties.stages.map((stage, index) => ({ participantId: stage.peerId, computerId: `computer-stage${index}` })),
      unfinished: { settlementReplay: { records: a.all(), policy: POLICY }, settlement: { reservationId: a.reservationId, charge: debit, heldAfter: 0,
        credits: [{ computerId: 'computer-stage0', amount: first }, { computerId: 'computer-stage1', amount: second }] } }
    };
    return verifyRecords({ trade: exportFromReceipt({ id: 'older', label: 'Older', receipt }), at: a.decidedAt });
  };

  it('passes the one known difference when the prefix is split by the signed weights, and nothing else', async () => {
    const verdict = await older(9, [2, 7]);
    expect(problems(verdict)).toEqual([]);
    expect(verdict.attempts[0].facts).toMatchObject({ status: 'settled', debit: 0, olderRulesDifference: 'unfinished-split-answer-closed-without-stop' });
    expect(problems(await older(9, [7, 2])).join('\n')).toMatch(/under the older rules the publisher states payouts/);
    expect(problems(await older(8, [2, 6])).join('\n')).toMatch(/states a debit of 8, the signed records imply 0/);
  });

  it('splits by floor shares with the remainder to the last stage', () => {
    expect(signedShares(15, [2, 3, 1])).toEqual([5, 7, 3]);
    expect(signedShares(9, [1, 3])).toEqual([2, 7]);
    expect(signedShares(0, [1, 1])).toEqual([0, 0]);
  });
});
