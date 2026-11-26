/**
 * The coordinator's signed final settlement statement for one split attempt (docs/settlement-replay.md, "The
 * coordinator's statement").
 *
 * The participants' records decide the debit and every payout, and anyone can recompute those. They cannot show what
 * the ledger did with the hold it placed on the requester's account: a hold is ledger state, and no participant signs
 * it. This record is the smallest thing that makes its release checkable without the ledger: whoever runs the ledger
 * signs, for one attempt, the amounts it posted and the hold it placed, released and left. A verifier compares the
 * amounts with its own replay, and holds the coordinator to the hold line: a hold that outlives this statement
 * contradicts the coordinator's own signature.
 *
 * It proves what the coordinator signed, not what its database holds, and no participant record names the
 * coordinator's key. The fleet service issues it for a reservation that is final (`issueSettlementStatement`, the
 * `settlementStatement` operation of service.js) when it was started with a coordinator key;
 * `scripts/settlement/failure-cases.js` signs it from a real ledger's state with a test key.
 */
import { isSignedTime } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import {
  isCanonicalParticipantProof, normalizeParticipantPublicKey, participantIdFor, verifyParticipantSignature
} from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { SETTLEMENT_RULE_SETS, UNFINISHED_TERMS_OF_RULES } from './credit-shares.js';
import { SETTLEMENT_TERMS_SCHEMA, policyDigest, termsDigest, verifySettlementTerms } from './settlement-terms.js';
import { replaySettlement } from './settlement-replay.js';

export const SETTLEMENT_STATEMENT_SCHEMA = 'reploid.settlement-statement/v1';

const KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'requesterId', 'termsDigest', 'coordinatorId', 'settlementRules', 'status',
  'debit', 'payouts', 'forfeited', 'hold', 'signedAt']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const exact = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;

/** `null` when the body has exactly the documented members and values. */
export function statementProblem(body) {
  const ok = exact(body, KEYS) && body.schema === SETTLEMENT_STATEMENT_SCHEMA && text(body.reservationId, 160) && text(body.attemptId)
    && text(body.requesterId) && DIGEST.test(body.termsDigest) && text(body.coordinatorId) && text(body.settlementRules, 128)
    && ['settled', 'expired'].includes(body.status) && count(body.debit)
    && Array.isArray(body.payouts) && body.payouts.length <= 128
    && body.payouts.every((row, index) => exact(row, ['account', 'amount']) && text(row.account, 128) && Number.isSafeInteger(row.amount) && row.amount > 0
      && (index === 0 || body.payouts[index - 1].account < row.account))
    && Array.isArray(body.forfeited) && body.forfeited.length <= 128
    && body.forfeited.every((stage, index) => count(stage) && (index === 0 || body.forfeited[index - 1] < stage))
    && exact(body.hold, ['placed', 'released', 'remaining']) && count(body.hold.placed) && count(body.hold.released) && count(body.hold.remaining)
    && body.hold.released + body.hold.remaining === body.hold.placed
    && isSignedTime(body.signedAt);
  return ok ? null : 'statement_malformed';
}

/**
 * Signs the statement with the coordinator's own identity (`signer` from createAttemptEvidenceSigner).
 * `payouts` is `[{ account, amount }]` for the accounts credited more than 0; `forfeited` the stage indexes that
 * forfeited; `hold` is `{ placed, remaining }` in credits, for this attempt's reservation.
 */
export async function signSettlementStatement({ signer, terms, settlementRules, status, debit, payouts, forfeited = [], hold, now = signer?.now ?? Date.now }) {
  const checked = await verifySettlementTerms(terms);
  if (!checked.ok) throw Error(`Settlement terms do not verify: ${checked.problem}`);
  if (!SETTLEMENT_RULE_SETS.includes(settlementRules)) throw Error('Unknown settlement rules');
  const sums = new Map();
  for (const row of payouts) sums.set(row.account, (sums.get(row.account) ?? 0) + row.amount);
  const body = {
    schema: SETTLEMENT_STATEMENT_SCHEMA, reservationId: checked.body.reservationId, attemptId: checked.body.attemptId,
    requesterId: checked.body.requesterId, termsDigest: await termsDigest(checked.body), coordinatorId: signer.participantId, settlementRules,
    status, debit, payouts: [...sums].filter(([, amount]) => amount !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([account, amount]) => ({ account, amount })),
    forfeited: [...new Set(forfeited)].sort((a, b) => a - b),
    hold: { placed: hold.placed, released: hold.placed - hold.remaining, remaining: hold.remaining },
    signedAt: new Date(now()).toISOString()
  };
  if (statementProblem(body)) throw Error('Settlement statement is invalid');
  return signer.sign(SETTLEMENT_STATEMENT_SCHEMA, body);
}

/** Checks shape, key, encoding and signature. Returns `{ ok, body }` or `{ ok: false, problem }`. */
export async function verifySettlementStatement(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, problem: 'statement_malformed' };
  const { publicJwk: carried, signature, ...body } = record;
  const problem = statementProblem(body);
  if (problem) return { ok: false, problem };
  const key = normalizeParticipantPublicKey(carried);
  if (!key || !exact(carried, Object.keys(key)) || typeof signature !== 'string') return { ok: false, problem: 'statement_malformed' };
  if (!isCanonicalParticipantProof(carried, signature)) return { ok: false, problem: 'encoding_not_canonical' };
  if (await participantIdFor(key) !== body.coordinatorId) return { ok: false, problem: 'signer_key_mismatch' };
  if (!await verifyParticipantSignature(key, SETTLEMENT_STATEMENT_SCHEMA, body, signature)) return { ok: false, problem: 'signature_invalid' };
  return { ok: true, body };
}

/** Why the ledger signed no statement: the code is stable, the message says what is missing. */
export const STATEMENT_REFUSALS = Object.freeze(['not-final', 'never-dispatched', 'terms-missing', 'terms-differ', 'records-rejected', 'records-not-final',
  'ledger-differs', 'hold-open']);
const refuse = (code, message) => { throw Object.assign(Error(message), { statementRefusal: code }); };
const MAX_PRESENTED_RECORDS = 4096;

/**
 * The ledger's side of the statement: signs it for reservation `id` from the ledger's own state, and only when the
 * signed records a participant presents replay to exactly what the ledger posted.
 *
 * The ledger does not settle from these records (a whole-model reservation settles on the countersigned receipt, the
 * requester's stop or the provider's terminal record; credits.js), so it replays them here, as an outsider would, and
 * refuses unless the replay is final and its debit and per-account payouts are the journal's. The debit, the payouts
 * and the hold in the statement are the ledger's own; `status` and `forfeited` are the replay's words for the records
 * presented, which is what a verifier compares them with. Presented with fewer records (a close left out), the same
 * reservation can be stated `expired` at zero where the full set reads `settled` at zero; no amount can differ.
 *
 * `credits` is the open ledger (credits.js), `signer` the coordinator's (createAttemptEvidenceSigner over its
 * configured identity). Throws an error with `statementRefusal` (STATEMENT_REFUSALS) when it will not sign.
 */
export async function issueSettlementStatement({ credits, signer, id, records, now = Date.now }) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_PRESENTED_RECORDS) refuse('terms-missing', 'Present the signed records of this reservation');
  const trace = credits.trace(id), row = credits.request(id), binding = row.binding;
  if (row.state === 'abandoned') refuse('never-dispatched', 'This reservation was released before anything was sent; no terms were signed for it');
  if (row.state !== 'settled') refuse('not-final', `This reservation is not final yet (${row.state}); its hold of ${trace.held} is still placed`);
  if (trace.held !== 0) refuse('hold-open', 'This reservation still holds credits');
  const policy = credits.policy, digest = await policyDigest(policy);
  let terms = null, body = null;
  for (const record of records) {
    if (record?.schema !== SETTLEMENT_TERMS_SCHEMA || record.reservationId !== id) continue;
    const checked = await verifySettlementTerms(record);
    if (checked.ok && checked.body.requesterId === binding.consumer && checked.body.attemptId === binding.executionId) { terms = record; body = checked.body; break; }
  }
  if (!terms) refuse('terms-missing', 'The presented records hold no terms signed by this reservation\'s requester for its attempt');
  const account = peer => credits.enrollment.byPeer.get(peer)?.ownerId ?? peer;
  const sameShares = body.shares.length === binding.providers.length
    && body.shares.every((share, index) => share.participantId === binding.providers[index].participantId && share.weight === binding.providers[index].weight);
  if (body.policyDigest !== digest || body.maximum !== binding.maximum || body.maxOutputTokens !== binding.maxOutputTokens
    || body.creditsPerOutputToken !== (binding.creditsPerOutputToken ?? policy.creditsPerOutputToken) || !sameShares
    || Object.hasOwn(body, 'debitAccount') && body.debitAccount !== trace.participants[0].accountId) {
    refuse('terms-differ', 'The signed terms are not the terms this reservation was held under');
  }
  // A split reservation names the rules it settles under. A whole-model one names none: the statement then names the
  // current rule set of the unfinished-answer terms the requester signed, which is the one this replay ran.
  const settlementRules = binding.settlementRules ?? [...SETTLEMENT_RULE_SETS].reverse().find(rules => UNFINISHED_TERMS_OF_RULES[rules] === body.unfinishedTerms);
  if (!settlementRules || UNFINISHED_TERMS_OF_RULES[settlementRules] !== body.unfinishedTerms) {
    refuse('terms-differ', 'The signed terms name unfinished-answer terms this ledger does not settle under');
  }
  const replay = await replaySettlement({ records, policies: [policy], at: now(), accountOf: account });
  if (replay.rejected.length) refuse('records-rejected', `${replay.rejected.length} presented record(s) failed their signature or shape checks`);
  const replayed = replay.reservations.find(item => item.reservationId === id && item.requesterId === binding.consumer && item.attemptId === binding.executionId);
  if (!replayed || !['settled', 'expired'].includes(replayed.status)) {
    refuse('records-not-final', `The presented records do not decide this reservation yet: ${replayed?.status ?? 'no attempt'}${replayed?.reason ? ` (${replayed.reason})` : ''}`);
  }
  const perAccount = rows => {
    const sums = new Map();
    for (const item of rows) sums.set(item.account, (sums.get(item.account) ?? 0) + item.amount);
    return JSON.stringify([...sums].filter(([, amount]) => amount !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  };
  const posted = trace.journalByAccount.filter(entry => entry.delta > 0).map(entry => ({ account: entry.accountId, amount: entry.delta }));
  const implied = (replayed.credits ?? []).map((credit, index) => ({ account: replayed.accounts?.stages[index] ?? account(credit.participantId), amount: credit.amount }));
  const charge = trace.charge ?? 0;
  if (replayed.debit !== charge || perAccount(posted) !== perAccount(implied)) {
    refuse('ledger-differs', `The ledger posted a debit of ${charge} and payouts ${perAccount(posted)}; the presented records imply ${replayed.debit} and ${perAccount(implied)}`);
  }
  return signSettlementStatement({ signer, terms, settlementRules, status: replayed.status, debit: charge, payouts: posted,
    forfeited: (replayed.forfeited ?? []).map(item => item.partitionIndex), hold: { placed: binding.maximum, remaining: trace.held }, now });
}
