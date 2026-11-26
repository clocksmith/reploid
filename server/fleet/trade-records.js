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
export const TRADE_RECEIPT_SCHEMA = 'reploid.whole-model-trade-receipt/v1';

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

export function buildTradeReceipt({ records, trace = null }) {
  if (!records || typeof records.reservationId !== 'string') throw Error('The signed records of one request are required');
  if (trace && trace.reservationId !== records.reservationId) throw Error('The ledger record names another reservation');
  const party = id => trace?.participants?.find(row => row.participantId === id) ?? null;
  const named = id => (id ? { participantId: id, ...(party(id) ? { accountId: party(id).accountId, computerId: party(id).computerId } : {}) } : null);
  return { schema: TRADE_RECEIPT_SCHEMA, reservationId: records.reservationId, label: records.label, missing: [...(records.missing ?? [])],
    ...(records.reason ? { reason: records.reason } : {}), ledgerRecord: trace ? 'included' : 'not-available',
    requester: named(records.requesterId ?? trace?.participants?.[0]?.participantId), hosts: [named(records.providerId ?? trace?.participants?.[1]?.participantId)].filter(Boolean),
    // The one attempt verify-trade.js checks: it reads every member that carries `settlementReplay`.
    ...(records.records?.length ? { answer: {
      settlement: trace ? { reservationId: trace.reservationId, state: trace.state, status: trace.status, reason: trace.reason, charge: trace.charge,
        outputTokens: trace.outputTokens, credits: trace.credits, journal: trace.journal, journalByAccount: trace.journalByAccount, heldAfter: trace.held } : null,
      settlementReplay: { records: structuredClone(records.records), policy: structuredClone(records.policy),
        ...(trace?.policyDigest ? { ledgerPolicyDigest: trace.policyDigest } : {}) } } } : {}) };
}
