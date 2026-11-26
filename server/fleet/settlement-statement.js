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
 * coordinator's key. The live fleet service does not issue it yet; `scripts/settlement/failure-cases.js` signs it
 * from a real ledger's state with a test key.
 */
import { isSignedTime } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import {
  isCanonicalParticipantProof, normalizeParticipantPublicKey, participantIdFor, verifyParticipantSignature
} from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { SETTLEMENT_RULE_SETS } from './credit-shares.js';
import { termsDigest, verifySettlementTerms } from './settlement-terms.js';

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
