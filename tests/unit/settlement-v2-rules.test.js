// @vitest-environment node
// Reservations made under reploid.settlement-replay/v2 keep settling exactly as they did. The fixture
// (tests/fixtures/settlement-v2-rules.json) was frozen from the last code that gave new split reservations those rules:
// signed records, each reservation as the ledger stored it, every ledger step with its result, the final outcomes,
// snapshots, replay rows and owner statements. Each frozen reservation is planted in a fresh ledger as that code left it
// (reserved, with its hold), the same steps are repeated with the current code, and every result, outcome, journal row
// and statement must come out identical: the amounts, the outcome members, the retry behaviour and the refusals.
// The older rule sets (tests/fixtures/settlement-old-rules.json) are settled again the same way from their statements.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { UNFINISHED_ANSWER_TERMS_V2 } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';

const RULES_V2 = 'reploid.settlement-replay/v2';
const raw = JSON.parse(await readFile(new URL('../fixtures/settlement-v2-rules.json', import.meta.url), 'utf8'));
const older = JSON.parse(await readFile(new URL('../fixtures/settlement-old-rules.json', import.meta.url), 'utf8'));

/** Signed records and route identities are stored once per set and referred to by position. */
function expand(set) {
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && Number.isSafeInteger(value.$record)) return structuredClone(set.records[value.$record]);
    if (Object.keys(value).length === 1 && Number.isSafeInteger(value.$route)) return structuredClone(set.routes[value.$route]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  };
  return { ...set, attempts: visit(set.attempts), statements: visit(set.statements) };
}
const sets = raw.sets.map(expand);
const withoutReason = rows => rows.map(({ reason: _reason, ...row }) => row);

const opened = [];
afterEach(async () => {
  for (const { ledger, directory } of opened.splice(0)) { try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } }
});
async function openLedger(set) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-earlier-rules-'));
  const live = { clock: 0, file: path.join(directory, 'credits.sqlite') };
  live.ledger = await openFleetCredits({ file: live.file, computers: set.computers, policy: set.policy, now: () => live.clock });
  opened.push({ ledger: live.ledger, directory });
  return live;
}
/** Writes a reservation exactly as `reserve` stored it when it was made: the binding, state `reserved`, and its hold. */
async function plant(file, binding) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(file);
  try {
    database.prepare("INSERT INTO fleet_requests VALUES (?,?,'reserved',NULL)").run(binding.id, JSON.stringify(binding));
    database.prepare('UPDATE fleet_accounts SET held=held+? WHERE id=?').run(binding.maximum, binding.accountId);
  } finally { database.close(); }
}

async function perform(ledger, attempt, step) {
  const id = attempt.reservationId, requester = attempt.binding.consumer;
  try {
    let result;
    if (step.op === 'dispatch') result = ledger.dispatch(id, requester);
    else if (step.op === 'admit') result = ledger.admit(id, step.stage, step.owner ?? null) ?? null;
    else if (step.op === 'collect') result = await ledger.collect(id, step.evidence);
    else if (step.op === 'fence') result = await ledger.fence(id, requester);
    else if (step.op === 'recover') result = await ledger.recover(id);
    else if (step.op === 'settle') result = await ledger.settle(id, step.evidence ?? ledger.request(id).evidence);
    else if (step.op === 'closeStageOwner') result = await ledger.closeStageOwner(step.envelope);
    else throw Error(`Unknown step ${step.op}`);
    return { result: JSON.parse(JSON.stringify(result ?? null)) };
  } catch (error) { return { threw: String(error?.message ?? error) }; }
}

describe.each(sets.map(set => [set.label, set]))('reservations made under reploid.settlement-replay/v2: %s', (_label, set) => {
  it('were reserved under that rules id, with terms the requester signed as provider-relief', () => {
    expect(raw.rules).toBe(RULES_V2);
    for (const attempt of set.attempts) {
      expect(attempt.binding).toMatchObject({ settlementRules: RULES_V2, unfinishedTerms: UNFINISHED_ANSWER_TERMS_V2 });
      expect(attempt.records.find(row => row.schema === 'reploid.settlement-terms/v1').unfinishedTerms).toBe(UNFINISHED_ANSWER_TERMS_V2);
    }
    // The cases the newer rules decide differently are in the frozen set: a stage that never closes and a stage owner's
    // interruption claim cost nothing here, and a delivered answer without a covering receipt moves nothing.
    const outcome = tag => set.attempts.find(attempt => attempt.tag === tag)?.final.outcome;
    for (const tag of set.attempts.map(attempt => attempt.tag).filter(tag => tag.includes('never-closes'))) {
      expect(outcome(tag)).toMatchObject({ status: 'expired', charge: 0, credits: [], reason: 'stage-unclaimed-after-window', acknowledgedOutputTokens: 3 });
    }
    for (const tag of set.attempts.map(attempt => attempt.tag).filter(tag => tag.endsWith('interruption-claim'))) {
      expect(outcome(tag)).toMatchObject({ status: 'failed', charge: 0, outputTokens: 3, reason: 'interrupted-stage-owner' });
      expect(outcome(tag).credits.map(row => row.amount)).toEqual([0, 0]);
    }
    if (outcome('uncovered')) expect(outcome('uncovered')).toMatchObject({ status: 'expired', charge: 0, reason: 'unknown-delivered-answer-without-covering-receipt' });
  });

  it('replay to the same rows, counts and balances as when they were signed', async () => {
    const replayed = await replaySettlement({ records: set.attempts.flatMap(attempt => attempt.records), policies: [set.policy], at: set.at,
      accountOf: id => set.accounts[id] });
    expect(replayed.counts).toEqual(set.replay.counts);
    expect(replayed.balances).toEqual(set.replay.balances);
    expect(replayed.rejected).toEqual(set.replay.rejected);
    expect(withoutReason(replayed.reservations)).toEqual(withoutReason(set.replay.reservations));
    // Under these terms no row forfeits anything: the member is absent.
    for (const row of replayed.reservations) expect(row.forfeited).toBeUndefined();
  });

  it('keep every owner statement verifying, to the same balances', async () => {
    for (const statement of set.statements) {
      const verdict = await verifyCreditStatement(statement);
      expect(verdict).toMatchObject({ ok: true, uncheckedCount: 0, balanceMatches: true });
      expect(verdict.recomputedBalance).toBe(statement.balance);
      expect(verdict.entryCount + verdict.expiredCount).toBe(statement.entries.length + statement.expired.length);
    }
  });

  it('settle in a ledger that still holds them exactly as they did: every step, outcome, journal row and statement', async () => {
    const live = await openLedger(set);
    for (const attempt of set.attempts) {
      live.clock = attempt.binding.createdAt;
      await plant(live.file, attempt.binding);
      // A retried reservation still finds the one made under the earlier rules, and keeps them.
      expect(live.ledger.reserve(structuredClone(attempt.reserve)), attempt.tag).toEqual(attempt.binding);
      for (const [index, step] of attempt.steps.entries()) {
        live.clock = step.at;
        const { result, threw, at: _at, ...call } = step;
        expect(await perform(live.ledger, attempt, call), `${attempt.tag} step ${index} (${step.op})`).toEqual(threw === undefined ? { result } : { threw });
      }
      const row = live.ledger.request(attempt.reservationId);
      expect({ state: row.state, outcome: row.outcome, evidence: row.evidence }, attempt.tag).toEqual(attempt.final);
      expect(live.ledger.reserve(structuredClone(attempt.reserve)), attempt.tag).toEqual(attempt.binding);
    }
    live.clock = set.at;
    expect(JSON.parse(JSON.stringify(live.ledger.snapshot()))).toEqual(set.snapshot);
    for (const statement of set.statements) {
      expect(JSON.parse(JSON.stringify(live.ledger.statement(statement.accountId)))).toEqual(statement);
    }
  });
});

describe.each(older.rules.map(rules => [rules.label, rules]))('reservations made under %s', (_label, rules) => {
  it('settle again, from the evidence their statements carry, to the outcome they were settled with', async () => {
    const entries = new Map();
    for (const statement of rules.statements) for (const entry of statement.entries) entries.set(entry.requestId, entry);
    expect(entries.size).toBeGreaterThan(0);
    const live = await openLedger({ computers: rules.statements[0].computers, policy: rules.policy });
    for (const entry of entries.values()) {
      const binding = entry.request;
      expect(binding.settlementRules).toBe(rules.label);
      live.clock = binding.createdAt;
      await plant(live.file, binding);
      // A retried reservation still finds the one made under these rules, and keeps them.
      const { requestHash: _hash, computerId: _computer, accountId: _account, maximum: _maximum, policyVersion: _version, terminalCharge: _terminal,
        admissionVersion: _admission, createdAt: _created, deadline: _deadline, unfinishedTerms: _terms, settlementRules: _rules, ...reserved } = binding;
      expect(live.ledger.reserve(structuredClone(reserved)), binding.id).toEqual(binding);
      live.ledger.dispatch(binding.id, binding.consumer);
      binding.providers.forEach((_, index) => live.ledger.admit(binding.id, index));
      live.clock = entry.outcome.settledAt;
      expect(await live.ledger.settle(binding.id, structuredClone(entry.evidence)), binding.id).toEqual(entry.outcome);
      // Presented a second time, the same evidence changes nothing.
      const journal = live.ledger.snapshot().journal.length;
      expect(await live.ledger.settle(binding.id, structuredClone(entry.evidence))).toEqual(entry.outcome);
      expect(live.ledger.snapshot().journal).toHaveLength(journal);
    }
    live.clock = Math.max(...rules.statements.map(statement => statement.issuedAt));
    for (const statement of rules.statements) {
      const again = live.ledger.statement(statement.accountId);
      expect(again.balance).toBe(statement.balance);
      expect(again.entries.map(entry => [entry.requestId, entry.delta])).toEqual(statement.entries.map(entry => [entry.requestId, entry.delta]));
    }
  });
});
