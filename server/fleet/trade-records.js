/**
 * One whole-model request as a trade receipt: the requester's signed settlement records (requester.js,
 * settlementRecordsOf) with the ledger's own record of the reservation (credits.js, trace), in the form
 * scripts/settlement/verify-trade.js reads. Saved as `receipt.json` in a directory, it is checked with
 *
 *   node scripts/settlement/verify-trade.js DIRECTORY
 *
 * which replays the signed records with both verifiers and compares the debit and payout with the ledger's journal
 * (docs/verify-a-trade.md). Nothing here decides an amount: a receipt whose records are incomplete says so in
 * `label` and does not verify.
 */
import { isParticipantId, operationRoles } from '../computer-records.js';

/**
 * The roles of one whole-model request (reploid.operation-roles/1): the requester's key consumed, the computer that
 * ran it provided (its ledger enrollment ID when known, its key otherwise). Unsigned and derived, beside the fields it
 * restates; null until the reservation and a provider are known, and for a split answer, which has several providers.
 */
export function requestOperationRoles({ reservationId, consumerId = null, providerId = null, providerIdentity = null }) {
  const key = value => (isParticipantId(value) ? value : null);
  if (!reservationId || !(providerId || key(providerIdentity)) || !key(consumerId)) return null;
  try {
    return operationRoles({ operation: 'inference', operationId: reservationId, consumer: { computerId: consumerId, participantId: consumerId },
      provider: { computerId: providerId ?? key(providerIdentity), participantId: key(providerIdentity) } });
  } catch { return null; }
}

export const TRADE_RECEIPT_SCHEMA = 'reploid.whole-model-trade-receipt/v1';
/** What a host returns instead of a records-only export when it cannot build one. It is not a trade and verifies as nothing. */
export const INCOMPLETE_EXPORT_SCHEMA = 'reploid.settlement-records-incomplete/v1';

const CLOSE = 'reploid.stage-receipt/v1';

/**
 * The same request as a records-only export (scripts/settlement/verify-records.js; docs/verify-a-trade.md, "Records
 * only"): the signed records, the enrollment the ledger states for the two keys, and the ledger's amounts and
 * remaining hold as the publisher's statement. The whole-model ledger does not replay the records, so for a charge of
 * zero it has no word for the replay's `settled` or `expired`: the export states the one the held records imply (a
 * provider's close is held, or not). The debit, the payout and the hold are the ledger's own.
 *
 * With `statement`, the coordinator's signed settlement statement for the reservation (settlement-statement.js), the
 * export carries that instead of the unsigned amounts: the hold's release then rests on the coordinator's signature.
 */
export function buildRecordsExport({ id, label, records, trace, statement = null }) {
  if (!records?.records?.length) throw Error('This request has no signed records to export');
  if (!trace || trace.reservationId !== records.reservationId) throw Error('The ledger record of this reservation is required');
  const paid = new Map();
  for (const entry of trace.journalByAccount ?? []) if (entry.delta > 0) paid.set(entry.accountId, (paid.get(entry.accountId) ?? 0) + entry.delta);
  const closed = records.records.some(record => record.schema === CLOSE);
  return { schema: 'reploid.settlement-records-export/v1', id, label, simulated: null,
    source: 'one whole-model request: the requester host\'s signed records and its ledger\'s trace of the reservation', policy: structuredClone(records.policy),
    attempts: [{ name: 'answer', what: 'A whole-model answer from one computer. For a zero charge the status word is read from the records; the amounts and the hold are the ledger\'s.',
      reservationId: records.reservationId, requesterId: records.requesterId,
      enrollment: (trace.participants ?? []).map(row => ({ participantId: row.participantId, account: row.accountId })),
      enrollmentSource: 'the ledger\'s enrollment of the two keys', records: structuredClone(records.records),
      ...(statement ? { statement: structuredClone(statement) } : { stated: { settlementRules: null, status: (trace.charge ?? 0) > 0 || closed ? 'settled' : 'expired', debit: trace.charge ?? 0,
        payouts: [...paid].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([account, amount]) => ({ account, amount })), forfeited: null,
        hold: { placed: null, released: null, remaining: trace.held } } }) }] };
}

/**
 * The records-only file a person hands an outsider for one request (docs/verify-a-trade.md, "Run a trade"): the
 * export above with the coordinator's statement when the ledger signed one. Its `label` says plainly when records are
 * missing or no statement was signed, and why; the verifier still decides from the records alone. With no signed
 * records, or no ledger record to state amounts from, there is nothing to export: the result then says so
 * (INCOMPLETE_EXPORT_SCHEMA) and no verifier accepts it.
 */
export function buildTradeExport({ id, records, trace = null, statement = null, statementProblem = null }) {
  const missing = [...(records?.missing ?? [])], reason = records?.reason ?? null;
  if (!records?.records?.length || !trace || trace.reservationId !== id) {
    return { schema: INCOMPLETE_EXPORT_SCHEMA, reservationId: id, complete: false, missing,
      reason: !records?.records?.length ? reason ?? 'records-not-held' : 'ledger-record-not-available',
      note: 'No signed records, or no ledger record, for this reservation. This file is not a trade and does not verify.' };
  }
  const held = missing.length ? `INCOMPLETE, missing ${missing.join(', ')}${reason ? ` (${reason})` : ''}` : 'signed-records';
  const hold = statement ? 'coordinator statement included' : `no coordinator statement${statementProblem ? ` (${statementProblem})` : ''}: the hold's release is not proven`;
  return buildRecordsExport({ id, label: `${held}; ${hold}`.slice(0, 256), records, trace, statement });
}

const tradeRoles = (operationId, consumer, provider) => {
  const party = row => ({ computerId: row.computerId ?? null, participantId: row.participantId, accountId: row.accountId });
  try { return operationRoles({ operation: 'inference', operationId, consumer: party(consumer), provider: party(provider) }); } catch { return null; }
};

export function buildTradeReceipt({ records, trace = null }) {
  if (!records || typeof records.reservationId !== 'string') throw Error('The signed records of one request are required');
  if (trace && trace.reservationId !== records.reservationId) throw Error('The ledger record names another reservation');
  const party = id => trace?.participants?.find(row => row.participantId === id) ?? null;
  const named = id => (id ? { participantId: id, ...(party(id) ? { accountId: party(id).accountId, computerId: party(id).computerId } : {}) } : null);
  const requester = named(records.requesterId ?? trace?.participants?.[0]?.participantId), host = named(records.providerId ?? trace?.participants?.[1]?.participantId);
  return { schema: TRADE_RECEIPT_SCHEMA, reservationId: records.reservationId, label: records.label, missing: [...(records.missing ?? [])],
    ...(records.reason ? { reason: records.reason } : {}), ledgerRecord: trace ? 'included' : 'not-available',
    requester, hosts: [host].filter(Boolean),
    // The same parties as reploid.operation-roles/1: the requester consumed, the host provided. Unsigned and derived;
    // the signed records below are unchanged and remain what verify-trade.js checks.
    ...(requester && host ? { roles: tradeRoles(records.reservationId, requester, host) } : {}),
    // The one attempt verify-trade.js checks: it reads every member that carries `settlementReplay`.
    ...(records.records?.length ? { answer: {
      settlement: trace ? { reservationId: trace.reservationId, state: trace.state, status: trace.status, reason: trace.reason, charge: trace.charge,
        outputTokens: trace.outputTokens, credits: trace.credits, journal: trace.journal, journalByAccount: trace.journalByAccount, heldAfter: trace.held } : null,
      settlementReplay: { records: structuredClone(records.records), policy: structuredClone(records.policy),
        ...(trace?.policyDigest ? { ledgerPolicyDigest: trace.policyDigest } : {}) } } } : {}) };
}
