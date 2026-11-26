/**
 * Builds records-only trade exports (docs/verify-a-trade.md, "Records only"): what an outsider is given instead of a
 * receipt. An export holds the public policy, the signed settlement records of each attempt, the published enrollment
 * or grouping of keys into accounts, and the publisher's stated amounts. It holds no prompt, no answer text, no token
 * IDs, no workload description and no ledger journal.
 *
 * `exportFromReceipt` strips a Stage 1 or north-star receipt down to that. Its stated amounts come from the ledger
 * trace in the receipt and are not signed: the hold line of such an export is the publisher's word.
 * `exportFailureCases` runs the in-process failure cases (failure-cases.js) and exports them with the coordinator's
 * signed statement. Those are simulated trades with test keys on one machine.
 */
import { RECORDS_EXPORT_SCHEMA } from './verify-records.js';
import { runFailureCases } from './failure-cases.js';

const RECORD_SCHEMAS = new Set(['reploid.settlement-terms/v1', 'reploid.settlement-acceptance/v1', 'reploid.stage-receipt/v1',
  'reploid.output-acknowledgment/v1', 'reploid.settlement-stop/v1', 'reploid.settlement-stage-fault/v1']);
/** Every member name a records-only export may contain, at any depth: the export's own, the policy's, and the signed records' (docs/settlement-replay.md, "Record fields"). */
const EXPORT_KEYS = new Set(['schema', 'id', 'label', 'simulated', 'source', 'policy', 'attempts', 'name', 'what', 'reservationId', 'requesterId', 'enrollment',
  'enrollmentSource', 'records', 'stated', 'statement', 'participantId', 'account', 'settlementRules', 'status', 'debit', 'payouts', 'amount', 'forfeited', 'hold',
  'placed', 'released', 'remaining']);
const RECORD_KEYS = new Set(['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'policyDigest', 'unit', 'creditsPerOutputToken', 'maxOutputTokens',
  'maximum', 'shares', 'partitionIndex', 'participantId', 'weight', 'unfinishedTerms', 'maxUnacknowledgedOutputs', 'notBefore', 'deadline', 'releaseWindowMs',
  'signedAt', 'debitAccount', 'termsDigest', 'payoutAccount', 'acknowledged', 'sequence', 'status', 'steps', 'tokens', 'prompt', 'processed', 'timing', 'reservedAt',
  'firstStepAt', 'lastStepAt', 'closedAt', 'output', 'count', 'chain', 'done', 'stopReason', 'publicJwk', 'kty', 'crv', 'x', 'y', 'signature',
  // the coordinator's statement
  'coordinatorId', 'settlementRules', 'debit', 'payouts', 'account', 'amount', 'forfeited', 'hold', 'placed', 'released', 'remaining']);
const MAX_TEXT = 256;

/**
 * Throws unless `trade` is records-only: every member name is one the export or a signed record defines, every text is
 * at most 256 characters (no record field is longer), nothing is a list of numbers (token IDs), and the `tokens` of a
 * stage receipt are its two counts. The policy is public and is not inspected.
 */
export function assertRecordsOnly(trade) {
  const walk = (value, where, keys) => {
    if (typeof value === 'string') { if (value.length > MAX_TEXT) throw Error(`${where}: a text of ${value.length} characters is not a signed-record field`); return; }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      if (value.some(item => typeof item === 'number') && !where.endsWith('.forfeited')) throw Error(`${where}: a list of numbers is not a signed-record field`);
      value.forEach((item, index) => walk(item, `${where}[${index}]`, keys));
      return;
    }
    if (typeof value !== 'object') throw Error(`${where}: not a JSON value`);
    for (const [key, item] of Object.entries(value)) {
      if (!keys.has(key)) throw Error(`${where}.${key}: not a member of a records-only export`);
      if (key === 'policy' && where === 'trade') continue;
      if ((key === 'tokens' || key === 'prompt' || key === 'processed') && !(key === 'tokens'
        ? item && typeof item === 'object' && Object.keys(item).sort().join() === 'processed,prompt' : item === null || Number.isSafeInteger(item))) {
        throw Error(`${where}.${key}: only a stage receipt's two token counts may appear`);
      }
      walk(item, `${where}.${key}`, key === 'records' || key === 'statement' ? RECORD_KEYS : keys);
    }
  };
  walk(trade, 'trade', EXPORT_KEYS);
  for (const attempt of trade.attempts) {
    for (const record of attempt.records) if (!RECORD_SCHEMAS.has(record?.schema)) throw Error(`attempt ${attempt.name}: ${record?.schema} is not a signed settlement record`);
  }
  return trade;
}

const sorted = sums => [...sums].filter(([, amount]) => amount !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([account, amount]) => ({ account, amount }));
const summed = (rows, key, value) => {
  const sums = new Map();
  for (const row of rows ?? []) sums.set(row[key], (sums.get(row[key]) ?? 0) + row[value]);
  return sorted(sums);
};

/**
 * A receipt (`{ receipt, policy }` as verify-trade.js's readTrade returns it) as a records-only export. Each attempt
 * that carries signed settlement records keeps those records and nothing else of the attempt; the ledger trace in the
 * receipt becomes the publisher's stated amounts.
 */
export function exportFromReceipt({ id, label, receipt, policy: supplied = null, source = 'a published trade receipt, with everything but its signed records removed' }) {
  const attempts = [];
  let policy = supplied;
  for (const [name, attempt] of Object.entries(receipt ?? {})) {
    if (!attempt || typeof attempt !== 'object' || !attempt.settlementReplay) continue;
    const evidence = attempt.settlementReplay, trace = attempt.settlement;
    if (!trace?.reservationId) throw Error(`attempt ${name} has no ledger record to state amounts from`);
    policy ??= evidence.policy ?? null;
    if (!policy) throw Error(`attempt ${name} has no public policy: add policy.json beside receipt.json`);
    if (!supplied && evidence.policy && JSON.stringify(evidence.policy) !== JSON.stringify(policy)) throw Error('the attempts of one receipt name different policies');
    const records = evidence.records.map(record => structuredClone(record));
    const terms = records.filter(row => row.schema === 'reploid.settlement-terms/v1' && row.reservationId === trace.reservationId);
    if (!terms.length) throw Error(`attempt ${name} has no requester-signed terms`);
    const signedAccounts = terms.some(row => Object.hasOwn(row, 'debitAccount'));
    // As verify-trade.js reads them: owner accounts when the parties signed theirs, the receipt's per-computer grouping otherwise.
    const parties = [receipt.requester, ...(receipt.hosts ?? [])].filter(party => party?.participantId);
    const enrollment = signedAccounts
      ? [...parties.filter(party => party.accountId).map(party => [party.participantId, party.accountId]),
        ...(receipt.participants?.accounts ?? []).flatMap(account => (account.participants ?? []).map(peer => [peer, account.accountId]))]
      : parties.filter(party => party.computerId).map(party => [party.participantId, party.computerId]);
    const payouts = signedAccounts && Array.isArray(trace.journalByAccount)
      ? summed(trace.journalByAccount.filter(entry => entry.delta > 0), 'accountId', 'delta') : summed(trace.credits, 'computerId', 'amount');
    attempts.push({
      name, reservationId: trace.reservationId, requesterId: terms[0].requesterId,
      enrollment: [...new Map(enrollment)].map(([participantId, account]) => ({ participantId, account })),
      enrollmentSource: signedAccounts ? 'the enrollment the receipt publishes' : 'the receipt\'s grouping of keys by computer',
      records,
      // Not signed by anyone: what the ledger trace in the receipt said. The trace names no settlement version, no
      // forfeits and only the requester account's hold after the attempt.
      stated: { settlementRules: null, status: trace.status === 'expired' ? 'expired' : 'settled', debit: trace.charge ?? 0, payouts, forfeited: null,
        hold: { placed: null, released: null, remaining: Number.isSafeInteger(trace.heldAfter) ? trace.heldAfter : null } }
    });
  }
  if (!attempts.length) throw Error('the receipt has no attempt with signed settlement records');
  return assertRecordsOnly({ schema: RECORDS_EXPORT_SCHEMA, id, label, simulated: null, source, policy, attempts });
}

export const SIMULATED_NOTE = 'SIMULATED: test keys made for this run, every party on one machine, a fake clock, no model. Not a trade between real hosts.';

/** The in-process failure cases under the failed-stage rules (settlement version v3), each with the coordinator's signed statement. */
export async function exportFailureCases({ id = 'simulated-v3-failure-cases', label = 'Simulated v3 trades: cancellation, unattributed disconnect, provider failure' } = {}) {
  const report = await runFailureCases({ evidence: true });
  if (!report.ok) throw Error('the failure cases do not pass their own checks');
  return assertRecordsOnly({ schema: RECORDS_EXPORT_SCHEMA, id, label, simulated: SIMULATED_NOTE,
    source: 'scripts/settlement/failure-cases.js: a real ledger driven in one process; records signed by the production signers',
    policy: report.policy,
    attempts: report.cases.map(row => ({ name: row.case, what: row.what, reservationId: row.evidence.reservationId, requesterId: row.evidence.requesterId,
      enrollment: row.evidence.enrollment, enrollmentSource: 'the test ledger\'s enrollment', records: row.evidence.records, statement: row.evidence.statement })) });
}
