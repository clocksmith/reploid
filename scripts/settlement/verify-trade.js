#!/usr/bin/env node
/**
 * Checks one published trade receipt from its signed records alone (docs/verify-a-trade.md).
 *
 *   node scripts/settlement/verify-trade.js RECEIPT_DIRECTORY [--at ISO_TIME] [--json]
 *
 * RECEIPT_DIRECTORY holds `receipt.json`: a Stage 1 receipt, or the `{ receipt, verdict }` file `scripts/stage1/run.js`
 * writes. Each attempt in it that carries a `settlementReplay` is checked: its signed records are replayed by the
 * service's verifier (server/fleet/settlement-replay.js) and by the one written from docs/settlement-replay.md alone
 * (scripts/settlement/independent/replay.js), which must agree; the public policy must hash to the digest the
 * requester signed into its terms and the ledger ran; and the ledger's recorded debit, payouts and journal must equal
 * the replay's. The public policy comes from the receipt (`settlementReplay.policy`) or from `policy.json` beside it.
 *
 * Plain Node 22 or later, no npm packages, no keys and no network. A pass shows that the published records, signed by
 * the keys they name, imply the amounts the ledger posted under the named policy. It does not show who owns a key,
 * that any computation was correct, that no party withheld a record, or when a record was really signed.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { policyDigest, SETTLEMENT_TERMS_SCHEMA } from '../../server/fleet/settlement-terms.js';
import { UNFINISHED_ANSWER_TERMS, WALK_AWAY_DIFFERENCE, creditSettlementDeltas, isWalkAwayRow } from '../../server/fleet/credit-shares.js';
import { replaySettlement as docReplay } from './independent/replay.js';

const FINAL = new Set(['settled', 'expired']);
/** Non-zero amounts summed per `key`, keys sorted: two stages on one computer are one payout. */
const amountsBy = (rows, key) => {
  const sums = new Map();
  for (const row of rows ?? []) sums.set(row[key], (sums.get(row[key]) ?? 0) + row.amount);
  return Object.fromEntries([...sums].filter(([, amount]) => amount !== 0).sort());
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Reads `receipt.json` (and `policy.json` when present) from a receipt directory. */
export function readTrade(directory) {
  const file = JSON.parse(readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
  const policyFile = path.join(directory, 'policy.json');
  return { receipt: file.receipt ?? file, policy: existsSync(policyFile) ? JSON.parse(readFileSync(policyFile, 'utf8')) : null };
}

/** Checks one attempt. Returns `{ name, ok, problems, facts }`. */
async function checkAttempt(name, attempt, { receipt, policy: suppliedPolicy, at }) {
  const problems = [], facts = {};
  const fail = text => problems.push(text);
  const evidence = attempt.settlementReplay, trace = attempt.settlement;
  const policy = suppliedPolicy ?? evidence.policy ?? null;
  const records = Array.isArray(evidence.records) ? evidence.records : [];
  if (!policy) return { name, ok: false, problems: ['no public policy: add policy.json beside receipt.json'], facts };
  if (!trace?.reservationId) return { name, ok: false, problems: ['no ledger record of this attempt'], facts };
  facts.reservationId = trace.reservationId;

  // The policy: the requester signed its digest into the terms, and the ledger ran the same one.
  const digest = await policyDigest(policy);
  facts.policyDigest = digest;
  const terms = records.filter(row => row?.schema === SETTLEMENT_TERMS_SCHEMA && row.reservationId === trace.reservationId);
  if (terms.length === 0) fail('no requester-signed terms for this reservation');
  for (const row of terms) if (row.policyDigest !== digest) fail(`the signed terms name policy ${row.policyDigest}, not ${digest}`);
  if (evidence.ledgerPolicyDigest && evidence.ledgerPolicyDigest !== digest) fail(`the ledger ran policy ${evidence.ledgerPolicyDigest}, not ${digest}`);
  facts.unfinishedTerms = terms[0]?.unfinishedTerms ?? null;

  // Who is who: the receipt's hosts and requester map each signing key to the computer its ledger account is kept on.
  const computerOf = new Map([[receipt.requester?.participantId, receipt.requester?.computerId],
    ...(receipt.hosts ?? []).map(host => [host.participantId, host.computerId])].filter(([id, computer]) => id && computer));
  const accountOf = id => computerOf.get(id) ?? id;
  // Stages the receipt places on the requester's own computer are neither charged nor paid. No signed record carries
  // that grouping: it is the publisher's statement, so it is reported with the verdict rather than verified.
  const requesterId = terms[0]?.requesterId ?? receipt.requester?.participantId;
  facts.ownAccountStages = [...new Set(terms.flatMap(row => row.shares.map(share => share.participantId)))]
    .filter(id => id !== requesterId && accountOf(id) === accountOf(requesterId));

  // Both verifiers replay the same signed records under the same public policy. With signed accounts the receipt's
  // per-computer grouping is not an input; the enrollment the receipt publishes by owner account (`accountId` on its
  // requester and hosts, or `participants.accounts`) is, and a party that signed an account it is not listed under
  // makes the attempt `invalid`.
  const signedAccounts = terms.some(row => Object.hasOwn(row, 'debitAccount'));
  const listed = new Map([
    ...[receipt.requester, ...(receipt.hosts ?? [])].filter(party => party?.participantId && party.accountId).map(party => [party.participantId, party.accountId]),
    ...(receipt.participants?.accounts ?? []).flatMap(account => (account.participants ?? []).map(id => [id, account.accountId]))]);
  const enrollment = signedAccounts ? (listed.size ? { accountOf: id => listed.get(id) ?? id } : {}) : { accountOf };
  if (signedAccounts) facts.enrollmentChecked = listed.size > 0;
  const service = await replaySettlement({ records, policies: [policy], at, ...enrollment });
  const second = await docReplay({ records, policies: [policy], at, ...enrollment });
  if (service.rejected.length) fail(`${service.rejected.length} record(s) failed their signature or shape checks`);
  const row = service.reservations.find(item => item.reservationId === trace.reservationId);
  const other = second.reservations?.find(item => item.reservationId === trace.reservationId && item.requesterId === row?.requesterId);
  if (!row) return { name, ok: false, problems: [...problems, 'the records do not settle this reservation'], facts };
  facts.status = row.status;
  facts.debit = row.debit;
  facts.payouts = amountsBy(row.credits, 'participantId');
  if (!FINAL.has(row.status)) fail(`the replay is not final: ${row.status} (${row.reason})`);
  if (!other || other.status !== row.status || other.debit !== row.debit || !same(amountsBy(other.credits, 'participantId'), facts.payouts)) {
    fail(`the two verifiers disagree: ${row.status} ${row.debit} against ${other?.status} ${other?.debit}`);
  }
  // The receipt's own stored replay, if any, must be what a fresh replay gives.
  const stored = evidence.result?.reservations?.find(item => item.reservationId === trace.reservationId);
  if (stored && (stored.status !== row.status || stored.debit !== row.debit || !same(amountsBy(stored.credits, 'participantId'), facts.payouts))) {
    fail('the replay stored in the receipt differs from a fresh replay of its records');
  }

  const journal = Array.isArray(trace.journal) ? trace.journal : [];
  if (journal.reduce((sum, entry) => sum + entry.delta, 0) !== 0) fail('the ledger journal for this reservation does not sum to zero');

  // Signed accounts (docs/settlement-replay.md, step 8): the requester signed the account it is charged from and each
  // stage the account it is paid into, so the ledger is compared per account and the receipt's own grouping is not used.
  if (row.accounts) {
    facts.accounts = row.accounts;
    facts.ownAccountStages = [];
    const charged = trace.charge ?? 0;
    if ((row.debit ?? 0) !== charged) fail(`the ledger charged ${charged}, the signed records imply ${row.debit}`);
    const implied = amountsBy([{ account: row.accounts.requester, amount: -(row.debit ?? 0) },
      ...(row.credits ?? []).map((credit, index) => ({ account: row.accounts.stages[index] ?? credit.participantId, amount: credit.amount }))], 'account');
    const rows = Array.isArray(trace.journalByAccount) ? trace.journalByAccount : null;
    if (!rows) fail('the terms and acceptances sign their accounts, but the receipt has no per-account journal (settlement.journalByAccount)');
    else {
      if (rows.reduce((sum, entry) => sum + entry.delta, 0) !== 0) fail('the ledger journal for this reservation does not sum to zero per account');
      const posted = amountsBy(rows.map(entry => ({ account: entry.accountId, amount: entry.delta })), 'account');
      if (!same(posted, implied)) fail(`the ledger posted ${JSON.stringify(posted)} per account, the signed records and accounts imply ${JSON.stringify(implied)}`);
      // The ledger's per-computer payout list must be its own journal's credits.
      const paid = amountsBy(trace.credits, 'computerId');
      const credited = amountsBy(rows.filter(entry => entry.delta > 0).map(entry => ({ computerId: entry.computerId, amount: entry.delta })), 'computerId');
      if (!same(paid, credited)) fail(`the ledger paid ${JSON.stringify(paid)} but its journal credited ${JSON.stringify(credited)}`);
    }
    return { name, ok: problems.length === 0, problems, facts };
  }

  // The ledger's debit, payouts and journal against the replay.
  const ledgerPayouts = amountsBy(trace.credits, 'computerId');
  const replayPayouts = amountsBy((row.credits ?? []).map(credit => ({ ...credit, computerId: accountOf(credit.participantId) })), 'computerId');
  const charge = trace.charge ?? 0;
  const requesterComputer = accountOf(row.requesterId);
  // Only reservations made under the older provider-loss-free terms can carry the old known difference
  // (docs/settlement-replay.md, "Older rules"): the replay free, the interim ledger charging the acknowledged prefix,
  // split by the signed weights like any other charge.
  const signed = terms.find(item => item.attemptId === row.attemptId) ?? terms[0];
  const prefix = facts.unfinishedTerms === UNFINISHED_ANSWER_TERMS && isWalkAwayRow(row) && signed
    ? creditSettlementDeltas({ providers: signed.shares.map(share => ({ participantId: share.participantId, weight: share.weight })),
      computerId: requesterComputer }, Math.min(row.outputs, signed.maxOutputTokens) * signed.creditsPerOutputToken, accountOf)
    : null;
  if (prefix && charge !== (row.debit ?? 0) && charge === prefix.charge) {
    facts.olderRulesDifference = WALK_AWAY_DIFFERENCE;
    const prefixPayouts = amountsBy(prefix.credits, 'computerId');
    if (!same(ledgerPayouts, prefixPayouts)) {
      fail(`under the older rules the ledger paid ${JSON.stringify(ledgerPayouts)}, the acknowledged prefix split by the signed weights is ${JSON.stringify(prefixPayouts)}`);
    }
  } else {
    if ((row.debit ?? 0) !== charge) fail(`the ledger charged ${charge}, the signed records imply ${row.debit}`);
    if (!same(ledgerPayouts, replayPayouts)) fail(`the ledger paid ${JSON.stringify(ledgerPayouts)}, the signed records imply ${JSON.stringify(replayPayouts)}`);
  }
  const posted = Object.fromEntries(journal.filter(entry => entry.delta !== 0).map(entry => [entry.accountId, entry.delta]).sort());
  const expected = Object.fromEntries([...(charge ? [[requesterComputer, -charge]] : []), ...Object.entries(ledgerPayouts)].sort());
  if (!same(posted, expected)) fail(`the journal posted ${JSON.stringify(posted)}, the charge and payouts imply ${JSON.stringify(expected)}`);
  return { name, ok: problems.length === 0, problems, facts };
}

/** Checks every attempt of a receipt that carries signed settlement records. */
export async function verifyTrade({ receipt, policy = null, at = Date.now() }) {
  const attempts = Object.entries(receipt ?? {}).filter(([, value]) => value && typeof value === 'object' && value.settlementReplay);
  const results = [];
  for (const [name, attempt] of attempts) results.push(await checkAttempt(name, attempt, { receipt, policy, at }));
  return { ok: results.length > 0 && results.every(row => row.ok), at: new Date(at).toISOString(), attempts: results,
    ...(results.length ? {} : { problems: ['the receipt has no attempt with signed settlement records'] }) };
}

async function main() {
  const args = process.argv.slice(2), flag = name => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1] ?? true; };
  const directory = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--at');
  if (!directory) { console.error('Usage: node scripts/settlement/verify-trade.js RECEIPT_DIRECTORY [--at ISO_TIME] [--json]'); process.exitCode = 2; return; }
  const at = flag('at') ? Date.parse(flag('at')) : Date.now();
  if (!Number.isFinite(at)) { console.error('--at needs an ISO time'); process.exitCode = 2; return; }
  const verdict = await verifyTrade({ ...readTrade(path.resolve(directory)), at });
  if (flag('json')) console.log(JSON.stringify(verdict, null, 2));
  else {
    for (const row of verdict.attempts) {
      const f = row.facts;
      console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${f.status ?? '-'} debit ${f.debit ?? '-'} payouts ${JSON.stringify(f.payouts ?? {})}`
        + ` policy ${f.policyDigest ?? '-'} terms ${f.unfinishedTerms ?? 'none'}${f.olderRulesDifference ? ' (older rules: known difference)' : ''}`);
      if (f.accounts) {
        console.log(`  accounts, each signed by its own party: requester ${f.accounts.requester}; stages ${f.accounts.stages.join(', ')}`
          + (f.enrollmentChecked ? ' (each matches the enrollment the receipt publishes)' : ' (the receipt publishes no enrollment to compare them with)'));
      }
      if (f.ownAccountStages?.length) {
        console.log(`  note: the receipt places ${f.ownAccountStages.join(', ')} on the requester's own account, so neither charged nor paid;`
          + ' no signed record confirms that grouping');
      }
      for (const problem of row.problems) console.log(`  - ${problem}`);
    }
    for (const problem of verdict.problems ?? []) console.log(`FAIL ${problem}`);
    console.log(verdict.ok ? 'The trade verifies.' : 'The trade does not verify.');
  }
  process.exitCode = verdict.ok ? 0 : 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await main();
