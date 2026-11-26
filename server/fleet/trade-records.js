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
