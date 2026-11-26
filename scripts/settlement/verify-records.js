#!/usr/bin/env node
/**
 * Checks a records-only trade export: signed settlement records and the publisher's stated amounts, with no prompt,
 * no answer text, no token IDs and no ledger journal (docs/verify-a-trade.md, "Records only").
 *
 *   node scripts/settlement/verify-records.js TRADE.json_or_DIRECTORY [--at ISO_TIME] [--json]
 *
 * For each attempt it recomputes the debit and every stage's payout from the signed records and compares them with
 * what the publisher stated, checks the debit against the maximum the requester signed, checks each stage against
 * its signed share, and reports what, if anything, shows that the hold was released.
 *
 * The replay is the second verifier (independent/replay.js, written from docs/settlement-replay.md alone). This file
 * and that one import nothing but Node built-ins: the service's ledger and replay code are not used. The split
 * arithmetic and the coordinator's statement check below are written here from the same document.
 *
 * A pass shows that the signed records imply the stated debit and payouts under the policy the requester signed. It
 * does not show who owns a key, that any computation was correct, that nobody withheld a record, or when a record was
 * really signed. The hold line says exactly what it rests on.
 */
import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, digestOf, participantIdOf, replaySettlement } from './independent/replay.js';

export const RECORDS_EXPORT_SCHEMA = 'reploid.settlement-records-export/v1';
const TERMS = 'reploid.settlement-terms/v1';
const STATEMENT = 'reploid.settlement-statement/v1';
const PROVIDER_LOSS_FREE = 'reploid.unfinished-answer/provider-loss-free/v1';
/** The unfinished-answer terms each ledger settlement version signs (docs/settlement-replay.md, "Unfinished answers" and "Older rules"). */
const TERMS_OF_RULES = Object.freeze({
  'reploid.settlement-replay/v1': PROVIDER_LOSS_FREE,
  'reploid.settlement-replay/v1+acknowledged-prefix': PROVIDER_LOSS_FREE,
  'reploid.settlement-replay/v2': 'reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1',
  'reploid.settlement-replay/v3': 'reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1'
});
const FINAL = new Set(['settled', 'expired']);
const TRADE_KEYS = ['schema', 'id', 'label', 'simulated', 'source', 'policy', 'attempts'];
const ATTEMPT_KEYS = ['name', 'what', 'reservationId', 'requesterId', 'enrollment', 'enrollmentSource', 'records', 'stated', 'statement'];
const STATED_KEYS = ['settlementRules', 'status', 'debit', 'payouts', 'forfeited', 'hold'];
const STATEMENT_KEYS = ['schema', 'reservationId', 'attemptId', 'requesterId', 'termsDigest', 'coordinatorId', 'settlementRules', 'status', 'debit',
  'payouts', 'forfeited', 'hold', 'signedAt'];
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => isObject(value) && Object.keys(value).every(key => keys.includes(key));
const exactly = (value, keys) => only(value, keys) && Object.keys(value).length === keys.length;
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const countOrNull = value => value === null || count(value);
/** Canonical base64url of exactly `bytes` bytes: decoding and encoding again gives the same text. */
const base64url = (value, bytes) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
  && Buffer.from(value, 'base64url').length === bytes && Buffer.from(value, 'base64url').toString('base64url') === value;
const time = value => typeof value === 'string' && ISO_TIME.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
/** Non-zero amounts per account, accounts sorted. */
const byAccount = rows => {
  const sums = new Map();
  for (const row of rows) sums.set(row.account, (sums.get(row.account) ?? 0) + row.amount);
  return Object.fromEntries([...sums].filter(([, amount]) => amount !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
};

/** Stage i gets floor(U * weight_i / W) and the last stage what remains (docs/settlement-replay.md, "Split arithmetic"). */
export function signedShares(units, weights) {
  const total = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const amounts = weights.slice(0, -1).map(weight => Number(BigInt(units) * BigInt(weight) / total));
  amounts.push(units - amounts.reduce((sum, amount) => sum + amount, 0));
  return amounts;
}

/** The stated amounts have the documented shape: a publisher's plain statement, or the body of a coordinator's signed one. */
function statedProblem(stated, signed) {
  const payouts = Array.isArray(stated.payouts) && stated.payouts.length <= 128
    && stated.payouts.every((row, index) => exactly(row, ['account', 'amount']) && text(row.account, 128) && Number.isSafeInteger(row.amount) && row.amount > 0
      && (index === 0 || stated.payouts[index - 1].account < row.account));
  const stages = list => Array.isArray(list) && list.length <= 128 && list.every((stage, index) => count(stage) && (index === 0 || list[index - 1] < stage));
  if (!payouts || !FINAL.has(stated.status) || !count(stated.debit) || !exactly(stated.hold, ['placed', 'released', 'remaining'])) return 'malformed';
  if (signed) {
    return exactly(stated, STATEMENT_KEYS) && stated.schema === STATEMENT && text(stated.reservationId, 160) && text(stated.attemptId) && text(stated.requesterId)
      && /^sha256:[a-f0-9]{64}$/.test(stated.termsDigest) && text(stated.coordinatorId) && text(stated.settlementRules, 128) && stages(stated.forfeited)
      && count(stated.hold.placed) && count(stated.hold.released) && count(stated.hold.remaining)
      && stated.hold.released + stated.hold.remaining === stated.hold.placed && time(stated.signedAt) ? null : 'malformed';
  }
  return exactly(stated, STATED_KEYS) && (stated.settlementRules === null || text(stated.settlementRules, 128)) && (stated.forfeited === null || stages(stated.forfeited))
    && countOrNull(stated.hold.placed) && countOrNull(stated.hold.released) && countOrNull(stated.hold.remaining) ? null : 'malformed';
}

/**
 * The coordinator's signed statement (docs/settlement-replay.md, "The coordinator's statement"): shape, key, canonical
 * encoding, low-S and signature, as for every other record. Returns `{ body }` or `{ problem }`.
 */
export function checkStatement(record) {
  if (!isObject(record)) return { problem: 'malformed' };
  const { publicJwk: jwk, signature, ...body } = record;
  if (statedProblem(body, true)) return { problem: 'malformed' };
  const okp = exactly(jwk, ['kty', 'crv', 'x']) && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && base64url(jwk.x, 32);
  const ec = exactly(jwk, ['kty', 'crv', 'x', 'y']) && jwk.kty === 'EC' && jwk.crv === 'P-256' && base64url(jwk.x, 32) && base64url(jwk.y, 32);
  if (!(okp || ec) || !base64url(signature, 64)) return { problem: 'its key or signature is not in the canonical encoding' };
  const raw = Buffer.from(signature, 'base64url');
  if (ec) {
    const s = BigInt(`0x${raw.subarray(32).toString('hex')}`);
    if (s < 1n || s > P256_ORDER / 2n) return { problem: 'its P-256 signature is not low-S' };
  }
  if (participantIdOf(jwk) !== body.coordinatorId) return { problem: 'its key is not the coordinator it names' };
  try {
    const bytes = Buffer.from(canonicalJson({ signatureDomain: STATEMENT, payload: body }), 'utf8');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const holds = okp ? verify(null, bytes, key, raw) : verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, raw);
    return holds ? { body } : { problem: 'its signature does not verify' };
  } catch { return { problem: 'its signature does not verify' }; }
}

/** Reads a records-only export: the file itself, or `trade.json` in a directory. */
export function readRecordsTrade(target) {
  const file = statSync(target).isDirectory() ? path.join(target, 'trade.json') : target;
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function checkAttempt(attempt, { policy, at }) {
  const problems = [], facts = {}, name = typeof attempt?.name === 'string' ? attempt.name : '?';
  const fail = line => problems.push(line);
  const done = () => ({ name, ok: problems.length === 0, problems, facts });
  if (!only(attempt, ATTEMPT_KEYS) || !text(attempt.name) || !text(attempt.reservationId, 160) || !text(attempt.requesterId) || !Array.isArray(attempt.records)
    || !Array.isArray(attempt.enrollment) || !attempt.enrollment.every(row => exactly(row, ['participantId', 'account']) && text(row.participantId) && text(row.account, 128))
    || (attempt.stated === undefined) === (attempt.statement === undefined)) {
    fail('the attempt is not a records-only attempt: it has an unknown or missing member');
    return done();
  }
  const records = attempt.records;
  facts.reservationId = attempt.reservationId;

  // The stated amounts: the coordinator's signed statement when there is one, otherwise the publisher's plain statement.
  let stated = attempt.stated ?? null, coordinatorId = null;
  if (attempt.statement !== undefined) {
    const checked = checkStatement(attempt.statement);
    if (checked.problem) { fail(`the coordinator's statement is refused: ${checked.problem}`); return done(); }
    stated = checked.body; coordinatorId = checked.body.coordinatorId;
  } else if (statedProblem(stated ?? {}, false)) { fail('the stated amounts are malformed'); return done(); }

  // The policy the requester signed.
  const digest = digestOf(policy);
  facts.policyDigest = digest;
  const terms = records.filter(row => row?.schema === TERMS && row.reservationId === attempt.reservationId && row.requesterId === attempt.requesterId);
  if (terms.length === 0) { fail('no requester-signed terms for this reservation'); return done(); }
  for (const row of terms) if (row.policyDigest !== digest) fail(`the signed terms name policy ${row.policyDigest}, not ${digest}`);

  // Who is who. With signed accounts the requester and each stage signed their own account, and the published
  // enrollment is only compared with them. Without, the grouping is the publisher's statement and is reported as such.
  const signedAccounts = terms.some(row => Object.hasOwn(row, 'debitAccount'));
  const listed = new Map(attempt.enrollment.map(row => [row.participantId, row.account]));
  const accountOf = id => listed.get(id) ?? id;
  const enrollment = signedAccounts ? (listed.size ? { accountOf } : {}) : { accountOf };
  facts.accountsFrom = signedAccounts ? 'signed by each party' : 'the publisher\'s grouping (not signed)';
  if (signedAccounts) facts.enrollmentChecked = listed.size > 0;

  const replay = await replaySettlement({ records, policies: [policy], at, ...enrollment });
  if (replay.rejected.length) fail(`${replay.rejected.length} record(s) failed their signature or shape checks`);
  const row = replay.reservations.find(item => item.reservationId === attempt.reservationId && item.requesterId === attempt.requesterId);
  if (!row) { fail('the records do not settle this reservation'); return done(); }
  facts.status = row.status;
  if (!FINAL.has(row.status)) { fail(`the replay is not final: ${row.status} (${row.reason})`); return done(); }

  // The agreed terms: the requester's terms for the replayed attempt. Their signature was checked by the replay.
  const rejected = new Set(replay.rejected.map(item => item.index));
  const { publicJwk: _key, signature: _signature, ...agreed } = records.find((item, index) => !rejected.has(index) && item?.schema === TERMS
    && item.reservationId === attempt.reservationId && item.requesterId === attempt.requesterId && item.attemptId === row.attemptId
    && (!coordinatorId || digestOf((({ publicJwk, signature, ...body }) => body)(item)) === stated.termsDigest)) ?? {};
  if (!agreed.schema) { fail(coordinatorId ? 'the coordinator\'s statement names terms that are not the agreed ones' : 'the agreed terms are not among the records'); return done(); }
  facts.unfinishedTerms = agreed.unfinishedTerms;
  facts.settlementRules = stated.settlementRules;
  facts.quote = { maxOutputTokens: agreed.maxOutputTokens, creditsPerOutputToken: agreed.creditsPerOutputToken, maximum: agreed.maximum };
  if (stated.settlementRules !== null && agreed.unfinishedTerms !== null) {
    const expected = TERMS_OF_RULES[stated.settlementRules];
    if (!expected) fail(`unknown settlement version ${stated.settlementRules}`);
    else if (expected !== agreed.unfinishedTerms) fail(`settlement version ${stated.settlementRules} does not settle under the signed terms ${agreed.unfinishedTerms}`);
  }

  // Recomputed from the signed records.
  const credits = row.credits ?? [], forfeits = new Map((row.forfeited ?? []).map(item => [item.partitionIndex, item.cause]));
  const requesterAccount = row.accounts ? row.accounts.requester : accountOf(row.requesterId);
  const stageAccount = index => (row.accounts ? row.accounts.stages[index] ?? agreed.shares[index].participantId : accountOf(agreed.shares[index].participantId));
  facts.acknowledgedOutputs = row.outputs;
  facts.chargedOutputs = row.status === 'settled' ? row.chargedOutputs : 0;
  facts.debit = row.debit;
  facts.maximum = agreed.maximum;
  if (row.accounts) facts.accounts = row.accounts;

  // Each stage against its signed share: floor(units * weight / total), the last stage taking the remainder; a stage
  // on the requester's own account is neither charged nor paid; a failed stage loses its own share and nothing else.
  const units = facts.chargedOutputs * agreed.creditsPerOutputToken;
  const shares = signedShares(units, agreed.shares.map(share => share.weight));
  facts.stages = agreed.shares.map((share, index) => {
    const own = stageAccount(index) === requesterAccount, forfeited = forfeits.get(index) ?? null;
    return { partitionIndex: index, participantId: share.participantId, account: stageAccount(index), weight: share.weight, signedShare: shares[index],
      ownAccount: own, forfeited, specified: own || forfeited ? 0 : shares[index], paid: credits[index]?.amount ?? 0 };
  });
  for (const stage of facts.stages) {
    if (stage.paid !== stage.specified) fail(`stage ${stage.partitionIndex} is paid ${stage.paid}; its signed share specifies ${stage.specified}`);
  }
  const specifiedDebit = facts.stages.reduce((sum, stage) => sum + stage.specified, 0);
  if (row.debit !== specifiedDebit) fail(`the recomputed debit ${row.debit} is not the sum of the specified shares, ${specifiedDebit}`);
  facts.payouts = byAccount(facts.stages.map(stage => ({ account: stage.account, amount: stage.paid })));
  facts.forfeited = [...forfeits.keys()].sort((a, b) => a - b);
  facts.ownAccountStages = signedAccounts ? [] : facts.stages.filter(stage => stage.ownAccount).map(stage => stage.partitionIndex);

  // The maximum the requester signed.
  facts.withinMaximum = row.debit <= agreed.maximum && stated.debit <= agreed.maximum;
  if (!facts.withinMaximum) fail(`the debit (recomputed ${row.debit}, stated ${stated.debit}) exceeds the signed maximum ${agreed.maximum}`);

  // The publisher's stated amounts against the recomputed ones.
  facts.stated = { status: stated.status, debit: stated.debit, payouts: byAccount(stated.payouts), forfeited: stated.forfeited };
  if (stated.status !== row.status) fail(`the publisher states ${stated.status}, the signed records imply ${row.status}`);
  // Only a reservation under the older provider-loss-free terms can carry the old known difference
  // (docs/settlement-replay.md, "Older rules"): the replay charges nothing for an unfinished answer closed with no stop,
  // the interim ledger charged the acknowledged prefix, split by the signed weights like any other charge.
  const walkAway = agreed.unfinishedTerms === PROVIDER_LOSS_FREE && row.status === 'settled' && row.outputs > 0 && row.chargedOutputs === 0;
  let older = null;
  if (walkAway && stated.debit !== row.debit) {
    const prefix = signedShares(Math.min(row.outputs, agreed.maxOutputTokens) * agreed.creditsPerOutputToken, agreed.shares.map(share => share.weight));
    const paid = facts.stages.map((stage, index) => ({ account: stage.account, amount: stage.ownAccount ? 0 : prefix[index] }));
    older = { debit: paid.reduce((sum, item) => sum + item.amount, 0), payouts: byAccount(paid) };
  }
  if (older && stated.debit === older.debit) {
    facts.olderRulesDifference = 'unfinished-split-answer-closed-without-stop';
    if (!same(facts.stated.payouts, older.payouts)) fail(`under the older rules the publisher states payouts ${JSON.stringify(facts.stated.payouts)}, the acknowledged prefix split by the signed weights is ${JSON.stringify(older.payouts)}`);
  } else {
    if (stated.debit !== row.debit) fail(`the publisher states a debit of ${stated.debit}, the signed records imply ${row.debit}`);
    if (!same(facts.stated.payouts, facts.payouts)) fail(`the publisher states payouts ${JSON.stringify(facts.stated.payouts)}, the signed records imply ${JSON.stringify(facts.payouts)}`);
  }
  if (stated.forfeited !== null && !same(stated.forfeited, facts.forfeited)) fail(`the publisher states forfeits ${JSON.stringify(stated.forfeited)}, the signed records imply ${JSON.stringify(facts.forfeited)}`);

  // The hold. Records the participants sign cannot show it: only whoever keeps the ledger can state it.
  const hold = stated.hold;
  if (coordinatorId) {
    if (stated.reservationId !== attempt.reservationId || stated.attemptId !== row.attemptId || stated.requesterId !== row.requesterId) fail('the coordinator\'s statement is for another attempt');
    if (hold.placed !== agreed.maximum) fail(`the coordinator states a hold of ${hold.placed}; the signed maximum is ${agreed.maximum}`);
    if (hold.remaining !== 0) fail(`the coordinator states ${hold.remaining} still held`);
    facts.hold = { basis: 'coordinator-signed', coordinatorId, ...hold, released: hold.released, releaseShown: hold.remaining === 0 && hold.placed === agreed.maximum };
  } else {
    if (hold.remaining !== null && hold.remaining !== 0) fail(`the publisher states ${hold.remaining} still held`);
    facts.hold = { basis: hold.remaining === null ? 'not-stated' : 'publisher-stated', coordinatorId: null, ...hold, releaseShown: false };
  }
  return done();
}

/** Checks every attempt of a records-only export. Returns `{ ok, at, id, attempts, holdReleaseShown }`. */
export async function verifyRecords({ trade, at = Date.now() }) {
  const problems = [];
  if (!only(trade, TRADE_KEYS) || trade.schema !== RECORDS_EXPORT_SCHEMA || !isObject(trade.policy) || !Array.isArray(trade.attempts) || trade.attempts.length === 0) {
    problems.push('not a records-only trade export, or it has a member a records-only export does not have');
    return { ok: false, at: new Date(at).toISOString(), id: trade?.id ?? null, attempts: [], problems };
  }
  const attempts = [];
  for (const attempt of trade.attempts) attempts.push(await checkAttempt(attempt, { policy: trade.policy, at }));
  return { ok: attempts.every(row => row.ok), at: new Date(at).toISOString(), id: trade.id ?? null, attempts,
    holdReleaseShown: attempts.filter(row => row.facts.hold?.releaseShown).length };
}

/** The lines a person reads for one attempt. */
export function describeAttempt(row) {
  const f = row.facts, lines = [];
  if (!f.quote) return [`${row.ok ? 'PASS' : 'FAIL'} ${row.name}`, ...row.problems.map(text => `  problem: ${text}`)];
  lines.push(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${f.status}${f.settlementRules ? ` under ${f.settlementRules}` : ''}`);
  lines.push(`  signed maximum ${f.quote.maximum} (${f.quote.maxOutputTokens} outputs at ${f.quote.creditsPerOutputToken}); acknowledged ${f.acknowledgedOutputs ?? 0}, charged ${f.chargedOutputs} outputs`);
  lines.push(`  debit: recomputed ${f.debit}, stated ${f.stated.debit}; ${f.withinMaximum ? 'within' : 'OVER'} the signed maximum`
    + (f.olderRulesDifference ? ' (older rules: the ledger of that time charged the acknowledged prefix; known difference)' : ''));
  for (const stage of f.stages) {
    const why = stage.ownAccount ? ', on the requester\'s own account: neither charged nor paid' : stage.forfeited ? `, forfeited (${stage.forfeited})` : '';
    lines.push(`  stage ${stage.partitionIndex} ${stage.participantId} weight ${stage.weight}: signed share ${stage.signedShare}${why}; paid ${stage.paid} into ${stage.account}`);
  }
  lines.push(`  payouts by account: recomputed ${JSON.stringify(f.payouts)}, stated ${JSON.stringify(f.stated.payouts)}`);
  lines.push(`  accounts: ${f.accountsFrom}${f.accounts ? (f.enrollmentChecked ? ', each matching the published enrollment' : ', no enrollment published to compare them with') : ''}`);
  if (f.ownAccountStages?.length) lines.push(`  note: stage(s) ${f.ownAccountStages.join(', ')} are on the requester's own account only by the publisher's grouping; no signed record confirms it`);
  const h = f.hold;
  if (h.basis === 'coordinator-signed') {
    lines.push(`  hold: placed ${h.placed}, released ${h.released}, remaining ${h.remaining}; signed by the coordinator ${h.coordinatorId}`
      + (h.releaseShown ? ': the release is shown by that signature' : ': the release is NOT shown'));
  } else if (h.basis === 'publisher-stated') {
    lines.push(`  hold: the publisher states ${h.remaining} held afterwards; no signed record covers the hold, so its release is NOT proven here`);
  } else lines.push('  hold: nothing stated; no signed record covers the hold, so its release is NOT proven here');
  for (const problem of row.problems) lines.push(`  problem: ${problem}`);
  return lines;
}

/** The command: `args` are TRADE.json_or_DIRECTORY and the flags. verify-trade.js --records runs the same. */
export async function recordsCommand(args) {
  const flag = name => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1] ?? true; };
  const target = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--at');
  if (target && !existsSync(target)) { console.error(`There is no file or folder named ${target}. Name a trade.json or the folder that holds one.`); process.exitCode = 2; return; }
  if (!target) { console.error('Usage: node scripts/settlement/verify-records.js TRADE.json_or_DIRECTORY [--at ISO_TIME] [--json]'); process.exitCode = 2; return; }
  const at = flag('at') ? Date.parse(flag('at')) : Date.now();
  if (!Number.isFinite(at)) { console.error('--at needs an ISO time'); process.exitCode = 2; return; }
  const verdict = await verifyRecords({ trade: readRecordsTrade(path.resolve(target)), at });
  if (flag('json')) console.log(JSON.stringify(verdict, null, 2));
  else {
    for (const row of verdict.attempts) for (const line of describeAttempt(row)) console.log(line);
    for (const problem of verdict.problems ?? []) console.log(`FAIL ${problem}`);
    console.log(verdict.ok ? `The stated amounts follow from the signed records. Hold release shown by a signed statement in ${verdict.holdReleaseShown} of ${verdict.attempts.length} attempts.`
      : 'The stated amounts do NOT follow from the signed records.');
  }
  process.exitCode = verdict.ok ? 0 : 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await recordsCommand(process.argv.slice(2));
