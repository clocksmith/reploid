// replay.js: settlement replay for split answers, second implementation.
//
// Written from docs/settlement-replay.md alone, by a second session working for
// the same operator as the reference implementation. It is NOT the work of an
// independent party. The reference code, the signers, the tests and the older
// verifier beside this file were not read. Where the document did not decide a
// behaviour, the choice made here is marked CHOICE and may differ from the
// reference. Node 22, built-in modules only.
//
// Follows the document's text with the decided unfinished-answer rule (the owner decision
// of 2026-11-25) as amended for terms signed before terms carried K, then for signed accounts,
// and then in answer to DOC-GAPS 83-89 (756 lines; the author had no commit hash for it, nor for
// the 744-line text of signed accounts, the 713-line text before them or the 694-line text of
// the decided rule that the versions before this one followed).
// Earlier versions followed the text as of commit 955bd5f7a, before the decision.
// From the two amendments for signed accounts: terms that sign K may carry one more member,
// `debitAccount`, and an acceptance may carry `payoutAccount`. When the agreed terms carry
// `debitAccount`: step 4 drops an acceptance without `payoutAccount`; step 8 answers `conflict`,
// with one `payout-account` entry for each participant that named more than one account, then,
// when the caller supplied `accountOf`, `invalid` if a signed account differs from `accountOf`
// of its participant, and only otherwise `unknown` for a stage without a counting acceptance;
// the split and `balances` use the signed accounts, and `accountOf` is used for nothing but that
// enrollment test; and the row carries one more member, `accounts`, once step 3 has passed.
// Without `debitAccount` every record is judged as before (DOC-GAPS 83-93).
// From the amendment for terms before K: one older shape of terms is also accepted, with every
// member but `maxUnacknowledgedOutputs` and with `unfinishedTerms` null or the provider-loss-free
// value; step 3 passes such terms only against a policy that has no `maxUnacknowledgedOutputs`
// either and answers `invalid` against one that publishes K; and K for them is the receiver
// policy's value, the `maxUnacknowledgedOutputs` input, which step 9 then uses (DOC-GAPS 80-82).
// From the decided rule:
// the result's `schema` is `reploid.settlement-replay/v2`; in step 9 an unfinished answer
// whose stages all closed charges the acknowledged prefix, capped at maxOutputTokens, under
// `unfinishedTerms` equal to `reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1`
// (the decided rules), `null` or any other value, an unattributed disconnect included; only
// under the older `reploid.unfinished-answer/provider-loss-free/v1` is an unattributed
// disconnect charged 0; relief for a verified provider failure stays step 6's `expired`.
// Unchanged from before: canonical base64url, low-S P-256 signatures and exact ISO times;
// one row per (reservation, requester) attempt with exactly the members of its "Rows" table;
// K from the named policy, else from the `maxUnacknowledgedOutputs` input; closesInTime for
// closing receipts; the release window passing only after the last instant a close can count;
// and late records used only as evidence of a contradiction, except that a late final-stage
// receipt still commits its chain. The ledger's interim rules (`v1+acknowledged-prefix` in
// the document's "Older rules") are a ledger rule and are not implemented here: over
// provider-loss-free terms this replay charges an unattributed disconnect 0.

import { createHash, createPublicKey, verify } from 'node:crypto';

const TERMS = 'reploid.settlement-terms/v1';
const ACCEPTANCE = 'reploid.settlement-acceptance/v1';
const RECEIPT = 'reploid.stage-receipt/v1';
const ACKNOWLEDGMENT = 'reploid.output-acknowledgment/v1';
const STOP = 'reploid.settlement-stop/v1';
const OUTPUT_CHAIN = 'reploid.output-chain/v1';
// The result's schema since the decided rules (it was `v1` before them; rows have the same
// members). CHOICE (DOC-GAPS 78): this one value whatever `unfinishedTerms` each row's terms name.
const RESULT_SCHEMA = 'reploid.settlement-replay/v2';
// The decided `unfinishedTerms`, and the older one kept for the reservations made under it.
const ACKNOWLEDGED_PREFIX = 'reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1';
const PROVIDER_LOSS_FREE = 'reploid.unfinished-answer/provider-loss-free/v1';
const STATUSES = new Set(['executing', 'settled', 'failed']);
const CLOSING = new Set(['settled', 'failed']);
// The stages' receiver policy's K, used for a policy that does not name its own.
const RECEIVER_POLICY_K = 2;
// The order of the P-256 group, for the low-S rule.
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// ---- Encoding ---------------------------------------------------------------

/** Canonical JSON: keys in UTF-16 code unit order, no whitespace, arrays in order. */
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, (item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const members = Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${canonicalJson(value[name])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError('not a finite JSON value');
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** `sha256:` and 64 lowercase hex digits over the canonical JSON of the value. */
export const digestOf = (value) => `sha256:${sha256Hex(canonicalJson(value))}`;

/** `peer:` and 24 hex digits over { kty, crv, x, y, n, e }, absent members written as null. */
export function participantIdOf(publicJwk) {
  const { kty = null, crv = null, x = null, y = null, n = null, e = null } = publicJwk;
  return `peer:${sha256Hex(canonicalJson({ kty, crv, x, y, n, e })).slice(0, 24)}`;
}

/** Stage i gets floor(U * weight_i / W); the last stage gets what remains. BigInt in and out. */
export function splitUnits(units, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  const amounts = weights.slice(0, -1).map((weight) => (units * weight) / total);
  amounts.push(units - amounts.reduce((sum, amount) => sum + amount, 0n));
  return amounts;
}

// Copies untrusted input into fresh objects, reading every member once. Throws on
// anything that is not a finite JSON value held in plain objects and arrays. The
// depth and length limits exclude nothing a valid record can contain: the deepest
// member is shares[i].weight and the only array holds at most 128 entries.
function plainCopy(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || depth > 4) throw new TypeError('not a finite JSON value');
  if (Array.isArray(value)) {
    if (value.length > 128) throw new TypeError('array longer than any record allows');
    return Array.from({ length: value.length }, (_, position) => plainCopy(value[position], depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('not a plain object');
  const copy = Object.create(null);
  for (const name of Reflect.ownKeys(value)) {
    if (typeof name !== 'string') throw new TypeError('symbol member');
    copy[name] = plainCopy(value[name], depth + 1);
  }
  return copy;
}

// ---- Record fields ----------------------------------------------------------

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Canonical base64url of exactly `bytes` bytes: no padding, and decoding and encoding
// again gives the same text (so the length is ceil(4n / 3) and unused trailing bits are zero).
const isBase64url = (v, bytes) => {
  if (typeof v !== 'string' || !BASE64URL.test(v)) return false;
  const decoded = Buffer.from(v, 'base64url');
  return decoded.length === bytes && decoded.toString('base64url') === v;
};
// Low-S: s, the second half of r || s read big-endian, satisfies 1 <= s <= n / 2 (rounded down).
const isLowS = (signature) => {
  const s = BigInt(`0x${Buffer.from(signature, 'base64url').subarray(32).toString('hex')}`);
  return s >= 1n && s <= P256_ORDER / 2n;
};
// Exactly what toISOString writes, in UTC, naming a real instant (writing it again gives the same text).
const isTime = (v) => {
  if (typeof v !== 'string' || !TIME.test(v)) return false;
  const instant = Date.parse(v);
  return !Number.isNaN(instant) && new Date(instant).toISOString() === v;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactly = (v, names) => isObject(v) && Object.keys(v).length === names.length
  && names.every((name) => Object.hasOwn(v, name));
const any = () => true;
// CHOICE: text length is counted in UTF-16 code units.
const text = (max = 256) => (v) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isPositive = (v) => Number.isSafeInteger(v) && v > 0;
const isDigest = (v) => typeof v === 'string' && DIGEST.test(v);
const nullOr = (rule) => (v) => v === null || rule(v);

const SHARE = ['partitionIndex', 'participantId', 'weight'];
const TIMING = ['reservedAt', 'firstStepAt', 'lastStepAt', 'closedAt'];
const isShares = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 128 && v.every((share, position) =>
  hasExactly(share, SHARE) && share.partitionIndex === position && text()(share.participantId) && isPositive(share.weight));
const isTokens = (v) => hasExactly(v, ['prompt', 'processed']) && nullOr(isCount)(v.prompt) && isCount(v.processed);
const isTiming = (v) => hasExactly(v, TIMING) && TIMING.every((name) => nullOr(isTime)(v[name]));
const isOutput = (v) => hasExactly(v, ['count', 'chain', 'done', 'stopReason']) && isCount(v.count)
  && isDigest(v.chain) && typeof v.done === 'boolean' && nullOr(text(64))(v.stopReason);

// One entry per record kind: the signer field, a rule per member (every listed member
// is required and no other is allowed), rules that span members, for terms the one
// older shape that is also accepted, and for terms and acceptances the one more member
// they may carry (`optional`, with its rule).
// CHOICE: the document gives no type for attemptId, requesterId, participantId or
// `maximum`. The IDs are read as text 256 and `maximum` as a safe integer.
const KINDS = new Map([
  [TERMS, {
    signer: 'requesterId',
    fields: {
      schema: any, reservationId: text(160), attemptId: text(), routeHash: isDigest, requesterId: text(),
      policyDigest: isDigest, unit: text(64), creditsPerOutputToken: isPositive, maxOutputTokens: isPositive,
      maximum: isCount, shares: isShares, unfinishedTerms: nullOr(text(128)), maxUnacknowledgedOutputs: isCount,
      notBefore: isTime, deadline: isTime, releaseWindowMs: isPositive, signedAt: isTime,
    },
    // One older shape is also accepted: terms signed before terms carried K have every member
    // above except `maxUnacknowledgedOutputs`, and their `unfinishedTerms` must be null or the
    // provider-loss-free value. Terms without the member that name any other value are malformed.
    // CHOICE (DOC-GAPS 80): the shape is told by the missing member alone; no date is checked.
    older: {
      without: 'maxUnacknowledgedOutputs',
      allowed: (body) => body.unfinishedTerms === null || body.unfinishedTerms === PROVIDER_LOSS_FREE,
    },
    // A newer shape is accepted as well: terms that have every member above, K included, may carry
    // one more, `debitAccount`, the ledger account the requester is charged from (step 8).
    optional: { debitAccount: text(128) },
    across(body) {
      // "K included": terms of the older shape, which sign no K, may not carry it (DOC-GAPS 88).
      if (Object.hasOwn(body, 'debitAccount') && !Object.hasOwn(body, 'maxUnacknowledgedOutputs')) {
        return 'debitAccount on terms without maxUnacknowledgedOutputs';
      }
      const product = BigInt(body.maxOutputTokens) * BigInt(body.creditsPerOutputToken);
      if (BigInt(body.maximum) !== product) return 'maximum is not maxOutputTokens * creditsPerOutputToken';
      if (!(Date.parse(body.deadline) > Date.parse(body.notBefore))) return 'deadline is not after notBefore';
      return null;
    },
  }],
  [ACCEPTANCE, {
    signer: 'participantId',
    fields: {
      schema: any, termsDigest: isDigest, reservationId: text(160), attemptId: text(), participantId: text(),
      partitionIndex: isCount, signedAt: isTime,
    },
    // An acceptance has exactly these members, or these and `payoutAccount`, the ledger account
    // this stage's share is paid into (step 8).
    optional: { payoutAccount: text(128) },
  }],
  [STOP, {
    signer: 'requesterId',
    fields: {
      schema: any, reservationId: text(160), attemptId: text(), requesterId: text(), acknowledged: isCount,
      signedAt: isTime,
    },
  }],
  [RECEIPT, {
    signer: 'participantId',
    fields: {
      schema: any, reservationId: text(160), attemptId: text(), routeHash: isDigest, partitionIndex: isCount,
      participantId: text(), sequence: (v) => Number.isSafeInteger(v) && v >= 1, status: (v) => STATUSES.has(v),
      steps: isCount, tokens: isTokens, timing: isTiming, output: nullOr(isOutput), signedAt: isTime,
    },
    // "null except on the final stage" needs the terms, so it cannot be judged here. CHOICE: either
    // form passes on any stage; a non-final stage's output is never read (see steps 5, 6 and 9).
    across: (body) => (body.output !== null && body.output.count !== body.steps ? 'output.count is not steps' : null),
  }],
  [ACKNOWLEDGMENT, {
    signer: 'requesterId',
    fields: {
      schema: any, reservationId: text(160), attemptId: text(), routeHash: isDigest, requesterId: text(),
      count: isCount, chain: isDigest, signedAt: isTime,
    },
  }],
]);

/** The carried key rebuilt with exactly its allowed members, or null. Each coordinate is 32 bytes. */
function keyOf(jwk) {
  if (!isObject(jwk) || !isBase64url(jwk.x, 32)) return null;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && hasExactly(jwk, ['kty', 'crv', 'x'])) {
    return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && hasExactly(jwk, ['kty', 'crv', 'x', 'y']) && isBase64url(jwk.y, 32)) {
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }
  return null;
}

/** Signed bytes: UTF-8 canonical JSON of { signatureDomain: schema, payload: body }. */
function signatureHolds(schema, body, jwk, signature) {
  try {
    const bytes = Buffer.from(canonicalJson({ signatureDomain: schema, payload: body }), 'utf8');
    const raw = Buffer.from(signature, 'base64url'); // 64 bytes: Ed25519, or raw P-256 r || s
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    if (jwk.kty === 'OKP') return verify(null, bytes, key, raw);
    return verify('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }, raw);
  } catch {
    return false; // a coordinate that is not a point, or any other key fault
  }
}

/** Shape, key and signature checks. Returns { rejected } for the `rejected` list, or { record }. */
function admit(records, index) {
  // CHOICE: `schema` is the record's own schema text, known or not; null when it has none
  // or the record cannot be read as JSON. The `problem` texts are mine.
  let schema = null;
  const reject = (problem) => ({ rejected: { index, schema, problem } });
  let copy;
  try {
    const input = records[index];
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return reject('not an object');
    copy = plainCopy(input);
  } catch {
    return reject('not a plain finite JSON value');
  }
  if (typeof copy.schema === 'string') schema = copy.schema;
  const kind = KINDS.get(copy.schema);
  if (!kind) return reject('unknown schema'); // CHOICE: rejected, not silently skipped
  if (!Object.hasOwn(copy, 'publicJwk') || !Object.hasOwn(copy, 'signature')) {
    return reject('publicJwk or signature missing');
  }
  const { publicJwk, signature, ...body } = copy;
  const optional = kind.optional ?? {}; // the one more member a kind may carry, with its rule
  if (Object.keys(body).some((name) => !Object.hasOwn(kind.fields, name) && !Object.hasOwn(optional, name))) {
    return reject('member not allowed');
  }
  for (const name of Object.keys(kind.fields)) {
    if (!Object.hasOwn(body, name)) {
      // The one older shape of a kind has every member but one, and only under its own rule.
      if (name === kind.older?.without && kind.older.allowed(body)) continue;
      return reject(`member missing: ${name}`);
    }
    if (!kind.fields[name](body[name])) return reject(`field rule: ${name}`);
  }
  // A member a kind may carry need not be there; when it is, it obeys its rule.
  for (const name of Object.keys(optional)) {
    if (Object.hasOwn(body, name) && !optional[name](body[name])) return reject(`field rule: ${name}`);
  }
  const fault = kind.across ? kind.across(body) : null;
  if (fault) return reject(`field rule: ${fault}`);
  const jwk = keyOf(publicJwk);
  if (!jwk) return reject('key shape');
  if (!isBase64url(signature, 64)) return reject('signature format');
  if (jwk.kty === 'EC' && !isLowS(signature)) return reject('P-256 signature is not low-S');
  if (body[kind.signer] !== participantIdOf(jwk)) return reject(`${kind.signer} is not the ID of the carried key`);
  if (!signatureHolds(schema, body, jwk, signature)) return reject('signature does not verify');
  const record = { index, schema, body, identity: canonicalJson(body), signedAt: Date.parse(body.signedAt) };
  if (schema === TERMS) {
    record.digest = digestOf(body);
    record.notBefore = Date.parse(body.notBefore);
    record.deadline = Date.parse(body.deadline);
  }
  return { record };
}

// Groups into attempts: terms, acknowledgments and stops go to the attempt of the
// reservationId and requesterId they name; acceptances and stage receipts name no
// requester and are offered to every attempt under their reservationId.
function place(byReservation, record) {
  const id = record.body.reservationId;
  if (!byReservation.has(id)) byReservation.set(id, { attempts: new Map(), acceptances: [], receipts: [] });
  const reservation = byReservation.get(id);
  if (record.schema === ACCEPTANCE) return reservation.acceptances.push(record);
  if (record.schema === RECEIPT) return reservation.receipts.push(record);
  const { requesterId } = record.body;
  if (!reservation.attempts.has(requesterId)) {
    reservation.attempts.set(requesterId, { terms: [], acknowledgments: [], stops: [] });
  }
  const attempt = reservation.attempts.get(requesterId);
  if (record.schema === TERMS) return attempt.terms.push(record);
  return (record.schema === ACKNOWLEDGMENT ? attempt.acknowledgments : attempt.stops).push(record);
}

// ---- Rows -------------------------------------------------------------------

/**
 * A row with exactly the members of the "Rows" table, as they stand before any step decides.
 * The one more member, `accounts`, is added in `decide`, when and only when the agreed terms
 * carry `debitAccount` and the attempt passed step 3 (a row decided at step 1, 2 or 3 never has it).
 */
const newRow = (reservationId, requesterId) => ({
  reservationId, requesterId, attemptId: null, status: 'unknown', reason: '', debit: null, credits: null,
  outputs: null, chargedOutputs: null, unacknowledgedOutputs: null, beyondCeiling: null,
  closedAtLastStep: [], conflicts: [], late: [], foreign: [], unmatched: [],
});

/** How a late record is listed in `late`. */
function lateEntry({ schema, body, digest }) {
  if (schema === TERMS) return { kind: 'terms', signer: body.requesterId, digest };
  if (schema === ACCEPTANCE) return { kind: 'acceptance', partitionIndex: body.partitionIndex };
  if (schema === RECEIPT) return { kind: 'stage-receipt', partitionIndex: body.partitionIndex, sequence: body.sequence };
  if (schema === ACKNOWLEDGMENT) return { kind: 'acknowledgment', count: body.count };
  return { kind: 'stop', acknowledged: body.acknowledged };
}

// ---- Deciding an outcome ----------------------------------------------------

/** Terms of the older shape, signed before terms carried K: their body has no such member. */
const signsNoK = (terms) => !Object.hasOwn(terms, 'maxUnacknowledgedOutputs');

/** Step 3. Returns what is wrong between the agreed terms and the policy they name, or null. */
function policyFault(agreed, policy, receiverK) {
  const terms = agreed.body;
  if (!policy) return 'the policy digest names no supplied policy'; // also the case of no policy at all
  // CHOICE: the allowance must be a count; any other value cannot be compared and is unusable too.
  if (!isCount(policy.maxClockSkewMs) || typeof policy.partitionUnclaimedReleaseMs !== 'number'
    || !(policy.partitionUnclaimedReleaseMs > policy.maxClockSkewMs)) {
    return 'the policy is not usable: partitionUnclaimedReleaseMs is not greater than maxClockSkewMs';
  }
  if (policy.unit !== terms.unit) return 'unit is not the policy\'s';
  if (policy.creditsPerOutputToken !== terms.creditsPerOutputToken) return 'creditsPerOutputToken is not the policy\'s';
  if (policy.partitionUnclaimedReleaseMs !== terms.releaseWindowMs) return 'releaseWindowMs is not the policy\'s';
  if (typeof policy.maxOutputTokens !== 'number' || !(terms.maxOutputTokens <= policy.maxOutputTokens)) {
    return 'maxOutputTokens is above the policy\'s';
  }
  if (typeof policy.maxRequestMs !== 'number' || !(agreed.deadline - agreed.notBefore <= policy.maxRequestMs)) {
    return 'deadline - notBefore is above maxRequestMs';
  }
  // A policy that names K decides it; one with no such member takes the receiver policy's value.
  const publishesK = policy.maxUnacknowledgedOutputs !== undefined;
  // Terms of the older shape pass this last check only against a policy that has no
  // `maxUnacknowledgedOutputs` either; against a policy that publishes K they are invalid.
  if (signsNoK(terms)) {
    return publishesK ? 'terms of the older shape, without maxUnacknowledgedOutputs, name a policy that publishes K' : null;
  }
  const K = publishesK ? policy.maxUnacknowledgedOutputs : receiverK;
  if (terms.maxUnacknowledgedOutputs !== K) return 'maxUnacknowledgedOutputs is not K';
  return null;
}

/** A closing receipt: `settled` or `failed`, with `closedAt` (step 4). */
const isClosing = (receipt) => CLOSING.has(receipt.body.status) && receipt.body.timing.closedAt !== null;

// Step 5, first conflict bullet, over one stage's kept receipts in sequence order (late ones
// included). Returns each distinct [earlier, later] pair once, in the order it is first found:
// [s, s] when two different receipts carry sequence s; [h, s] when a receipt at s has fewer
// steps than some receipt at a lower sequence, h being the lowest sequence with the most steps
// below s; [c, s] for every receipt after the stage's first closing receipt, at sequence c.
// CHOICE: when one sequence gives more than one pair, they are found in that order.
function receiptConflicts(sorted) {
  const pairs = new Map();
  const add = (earlier, later) => pairs.set(`${earlier},${later}`, [earlier, later]);
  let highest = null; // among receipts with a strictly lower sequence
  let closing = null; // the first closing receipt with a strictly lower sequence
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end].body.sequence === sorted[start].body.sequence) end += 1;
    const sameSequence = sorted.slice(start, end);
    const { sequence } = sameSequence[0].body;
    if (sameSequence.length > 1) add(sequence, sequence);
    if (highest !== null && sameSequence.some((receipt) => receipt.body.steps < highest.body.steps)) {
      add(highest.body.sequence, sequence);
    }
    if (closing !== null) add(closing.body.sequence, sequence);
    for (const receipt of sameSequence) {
      if (highest === null || receipt.body.steps > highest.body.steps) highest = receipt;
      if (closing === null && isClosing(receipt)) closing = receipt;
    }
    start = end;
  }
  return [...pairs.values()];
}

// CHOICE: `accountOf` is read as a function (or a Map) from participant ID to an owner
// account. A participant it does not place is its own account. For an attempt with signed
// accounts it is used for nothing but step 8's enrollment test, where this same answer is
// "`accountOf` of that participant" (DOC-GAPS 90).
async function accountFor(accountOf, participantId) {
  try {
    const account = typeof accountOf === 'function' ? await accountOf(participantId)
      : accountOf instanceof Map ? accountOf.get(participantId) : undefined;
    return account ?? participantId;
  } catch {
    return participantId;
  }
}

/**
 * Decides one attempt, a (reservationId, requesterId) pair. Returns its row and, for a
 * settled or expired row, the amounts it posts to accounts (for `balances`).
 */
async function decide(reservationId, requesterId, attempt, { policyByDigest, receiverK, at, accountOf }) {
  const row = newRow(reservationId, requesterId);
  const postings = []; // [account, BigInt amount]
  const listed = { late: [], foreign: [], unmatched: [] };
  // CHOICE: `late`, `foreign` and `unmatched` hold one entry per record, in input order.
  const list = (name, record, entry) => listed[name].push({ index: record.index, entry });
  const done = (status, reason) => {
    for (const name of Object.keys(listed)) {
      row[name] = listed[name].sort((a, b) => a.index - b.index).map(({ entry }) => entry);
    }
    return { row: Object.assign(row, { status, reason }), postings };
  };
  // Own terms, acknowledgments and stops; every acceptance and stage receipt of the reservation.
  const { terms: everyTerms, acknowledgments, stops, acceptances, receipts } = attempt;
  // One entry of `conflicts`: kind, blocking and signer, plus the members of its kind.
  const conflict = (kind, blocking, signer, members) => row.conflicts.push({ kind, blocking, signer, ...members });
  const fromNamedStage = (terms, record) =>
    terms.body.shares[record.body.partitionIndex]?.participantId === record.body.participantId;
  // "An acceptance counts only for the agreed terms digest and its own share" (and its attemptId).
  const accepts = (acceptance, terms) => acceptance.body.termsDigest === terms.digest
    && acceptance.body.attemptId === terms.body.attemptId && fromNamedStage(terms, acceptance);
  // inTime(t) with one set's own notBefore, deadline and named policy. Terms that name an
  // unsupplied policy are not timed before step 3. CHOICE: the same holds for a supplied
  // policy with no usable maxClockSkewMs, and for acceptances of such terms in step 2.
  const windowOf = (terms) => {
    const skew = policyByDigest.get(terms.body.policyDigest)?.maxClockSkewMs;
    if (!isCount(skew)) return () => true;
    return (t) => terms.notBefore - skew <= t && t <= terms.deadline + skew;
  };

  // Step 1. Which terms. Terms count unless another route contradicts them, among the records
  // with their attemptId; with no such receipt and no acknowledgment they pass (never started).
  // CHOICE: terms that are both contradicted and late are listed as foreign only.
  const remaining = [];
  for (const candidate of everyTerms) {
    const { attemptId, routeHash } = candidate.body;
    const onRoute = (record) => record.body.routeHash === routeHash;
    const itsAcks = acknowledgments.filter((ack) => ack.body.attemptId === attemptId); // this requester's
    const itsReceipts = receipts.filter((receipt) => receipt.body.attemptId === attemptId
      && fromNamedStage(candidate, receipt));
    const contradicted = (itsReceipts.length > 0 && !itsReceipts.some(onRoute))
      || (itsAcks.length > 0 && !itsAcks.some(onRoute));
    if (contradicted) list('foreign', candidate, { kind: 'terms', signer: requesterId, attemptId, digest: candidate.digest });
    else if (!windowOf(candidate)(candidate.signedAt)) list('late', candidate, lateEntry(candidate));
    else remaining.push(candidate);
  }

  // Step 2. One set or several, whatever their attemptIds.
  if (remaining.length === 0) return done('unknown', 'step 2: no terms left');
  let agreed = remaining[0];
  if (remaining.length > 1) {
    // CHOICE: `digests` holds every set left after step 1, sorted.
    const digests = remaining.map((candidate) => candidate.digest).sort();
    // CHOICE: no terms are agreed yet, so each acceptance is timed against the set it names.
    const named = remaining.filter((candidate) => {
      const inItsWindow = windowOf(candidate);
      return acceptances.some((acceptance) => accepts(acceptance, candidate) && inItsWindow(acceptance.signedAt));
    });
    if (named.length !== 1) {
      conflict('terms-equivocation', true, requesterId, { digests });
      return done('conflict', named.length === 0
        ? 'step 2: several terms from one requester and no in-time acceptance'
        : 'step 2: in-time acceptances name different terms');
    }
    [agreed] = named;
    conflict('terms-equivocation', false, requesterId, { digests, settledOn: agreed.digest });
  }
  const terms = agreed.body;
  row.attemptId = terms.attemptId;

  // Step 3. Policy: usable, repeated by the terms, and K.
  const policy = policyByDigest.get(terms.policyDigest);
  const fault = policyFault(agreed, policy, receiverK);
  if (fault) return done('invalid', `step 3: ${fault}`);
  // K is what the terms sign, which step 3 found equal to their policy's K. Terms of the older
  // shape sign none and passed only under a policy that publishes none, so K for them is the
  // receiver policy's value. CHOICE (DOC-GAPS 81): that is the input; no signed record fixes it.
  const K = signsNoK(terms) ? receiverK : terms.maxUnacknowledgedOutputs;
  // Signed accounts (step 8): the agreed terms carry `debitAccount`, the requester's account.
  const signedAccounts = Object.hasOwn(terms, 'debitAccount');

  // Step 4. Records kept. A closing receipt counts when signed closesInTime, every other kept
  // record when signed inTime; both windows carry the clock allowance at both ends. A kept
  // record that does not count is late: listed, and used only in step 5's contradiction tests.
  const skew = policy.maxClockSkewMs;
  const opens = agreed.notBefore - skew;
  const inTime = (t) => opens <= t && t <= agreed.deadline + skew;
  const closesInTime = (t) => opens <= t && t <= agreed.deadline + terms.releaseWindowMs + skew;
  const keep = (records, belongs) => {
    const kept = { all: [], counting: [] };
    for (const record of records) {
      // Another attemptId or a non-party: dropped without being listed. CHOICE: so is a
      // party's record with another route hash, and an acceptance of other terms.
      if (record.body.attemptId !== terms.attemptId || !belongs(record)) continue;
      kept.all.push(record);
      const closing = record.schema === RECEIPT && isClosing(record);
      if (closing ? closesInTime(record.signedAt) : inTime(record.signedAt)) kept.counting.push(record);
      else list('late', record, lateEntry(record));
    }
    return kept;
  };
  const onAgreedRoute = (record) => record.body.routeHash === terms.routeHash;
  const keptReceipts = keep(receipts, (receipt) => onAgreedRoute(receipt) && fromNamedStage(agreed, receipt));
  const keptAcks = keep(acknowledgments, onAgreedRoute); // the requester is this row's already
  // When the agreed terms carry `debitAccount`, an acceptance without `payoutAccount` is dropped
  // without being listed (step 2 has still counted it for the set it names); when they do not,
  // an acceptance's `payoutAccount` is not used.
  const keptAcceptances = keep(acceptances, (acceptance) => accepts(acceptance, agreed)
    && (!signedAccounts || Object.hasOwn(acceptance.body, 'payoutAccount')));
  const keptStops = keep(stops, () => true);

  // A stage's latest receipt is its highest-sequence receipt that counts.
  const bySequence = (a, b) => a.body.sequence - b.body.sequence;
  const stages = terms.shares.map((share, position) => {
    const mine = (receipt) => receipt.body.partitionIndex === position;
    const kept = keptReceipts.all.filter(mine).sort(bySequence); // late receipts included
    return { share, position, kept, latest: keptReceipts.counting.filter(mine).sort(bySequence).at(-1) ?? null };
  });
  const finalStage = stages.at(-1);
  const finalStageId = finalStage.share.participantId;
  // With signed accounts, the accounts each stage named: a stage's account is the `payoutAccount`
  // of its in-time acceptances of the agreed terms. Only counting records name an account, so a
  // late acceptance names none, in step 8's contradiction test as well.
  const namedByStage = stages.map(({ position }) => (signedAccounts ? [...new Set(keptAcceptances.counting
    .filter((acceptance) => acceptance.body.partitionIndex === position)
    .map((acceptance) => acceptance.body.payoutAccount))] : []));
  // The row's one more member, when and only when the agreed terms carry `debitAccount` and the
  // attempt passed step 3: `requester` the terms' `debitAccount`, and `stages` one entry per
  // stage in stage order, the `payoutAccount` its counting acceptances (step 4) name, or null
  // when they name none or more than one; the same on every row that has the member, whatever
  // step decided it (`open`, `expired`, a step-5 `conflict`). It is what was signed: step 8's
  // enrollment test does not change it, and a row decided earlier is never tested (DOC-GAPS 93).
  if (signedAccounts) {
    row.accounts = {
      requester: terms.debitAccount,
      stages: namedByStage.map((named) => (named.length === 1 ? named[0] : null)),
    };
  }

  // Step 5. Acknowledged count and contradictions. Kept receipts and acknowledgments, late
  // or not, are used in every contradiction test.
  for (const stage of stages) {
    for (const sequences of receiptConflicts(stage.kept)) {
      conflict('stage-receipt', true, stage.share.participantId, { partitionIndex: stage.position, sequences });
    }
  }
  // Every kept receipt of the final stage with an `output` commits its chain at its count,
  // whenever it was signed. Count 0 always has the starting value, so another chain there is a second one.
  const startingChain = digestOf({ schema: OUTPUT_CHAIN, reservationId, routeHash: terms.routeHash });
  const committed = new Map([[0, new Set([startingChain])]]);
  for (const { body } of finalStage.kept) {
    if (body.output === null) continue; // only a receipt "with an output" commits
    if (!committed.has(body.output.count)) committed.set(body.output.count, new Set());
    committed.get(body.output.count).add(body.output.chain);
  }
  const ascending = (a, b) => a - b;
  for (const count of [...committed.keys()].sort(ascending)) {
    if (committed.get(count).size > 1) conflict('output-chain', true, finalStageId, { count });
  }
  const committedAt = (count) => (count === 0 ? new Set([startingChain]) : committed.get(count) ?? null);
  // The requester's acknowledgments per count: every chain it signed (in time or late), and
  // the ones signed in time, which alone can match and be charged.
  const acked = new Map();
  for (const ack of keptAcks.all) {
    if (!acked.has(ack.body.count)) acked.set(ack.body.count, { chains: new Set(), timely: [] });
    acked.get(ack.body.count).chains.add(ack.body.chain);
  }
  for (const ack of keptAcks.counting) acked.get(ack.body.count).timely.push(ack);
  // Only an in-time acknowledgment is matched, and it may be matched against the chain a late
  // receipt committed (step 4). A late acknowledgment never raises or lowers the count.
  let acknowledged = 0; // the highest matched count, 0 if none
  for (const count of [...acked.keys()].sort(ascending)) {
    const { chains, timely } = acked.get(count);
    const finalChains = committedAt(count);
    if (finalChains === null) {
      // No final-stage receipt commits a chain at this count: in-time acknowledgments are unmatched.
      for (const ack of timely) list('unmatched', ack, { kind: 'acknowledgment', count });
      continue;
    }
    const matched = timely.map((ack) => ack.body.chain).sort().find((chain) => finalChains.has(chain)) ?? null;
    if (matched !== null) acknowledged = Math.max(acknowledged, count);
    const others = [...chains].filter((chain) => !finalChains.has(chain)).sort(); // CHOICE: sorted
    if (others.length === chains.size) {
      // None of its chains for this count, in time or late, is the final stage's.
      // CHOICE: at count 0 only the charge-binding entry, not the disputed-chain one as well.
      if (count === 0) conflict('charge-binding', true, requesterId, { count: 0 });
      else conflict('output-chain', true, null, { count, signers: [finalStageId, requesterId] });
    } else if (others.length > 0) {
      // It also signed the final stage's chain: not blocking; `settledOn` when the count is matched.
      const members = matched === null ? { count, chains: others } : { count, chains: others, settledOn: matched };
      conflict('acknowledgment-equivocation', false, requesterId, members);
    }
  }
  const blockingKinds = new Set(row.conflicts.filter((entry) => entry.blocking).map((entry) => entry.kind));
  if (blockingKinds.size > 0) return done('conflict', `step 5: ${[...blockingKinds].join(', ')}`);

  // Debit and credits of a settled or expired row, and what they post to accounts. An attempt
  // with signed accounts uses those (on a settled row step 8 has already refused any that
  // `accountOf` contradicts) and uses `accountOf` for nothing here: the requester's account is
  // `debitAccount`, a stage's is its signed `payoutAccount`, and a stage is the requester's own
  // exactly when the two are equal. A stage with no signed account, possible only on an expired
  // row where every amount is 0, is under its participant ID.
  // CHOICE (DOC-GAPS 87): so is a stage whose counting acceptances name more than one account;
  // and the signed account texts are keys of `balances` beside the accounts of other rows.
  // CHOICE (DOC-GAPS 93): an expired row never reached step 8, so its accounts are untested.
  const post = async (units) => {
    const amounts = splitUnits(units, terms.shares.map((share) => BigInt(share.weight)));
    const requesterAccount = signedAccounts ? terms.debitAccount : await accountFor(accountOf, requesterId);
    let debit = units;
    row.credits = [];
    for (const [position, share] of terms.shares.entries()) {
      const account = signedAccounts ? row.accounts.stages[position] ?? share.participantId
        : await accountFor(accountOf, share.participantId);
      // The requester's own account is neither charged nor credited: its stage shows amount 0.
      const amount = account === requesterAccount ? 0n : amounts[position];
      debit -= amounts[position] - amount;
      row.credits.push({ participantId: share.participantId, amount: Number(amount) });
      postings.push([account, amount]);
    }
    row.debit = Number(debit); // every amount is at most `maximum`, a safe integer
    postings.push([requesterAccount, -debit]);
  };

  // Step 6. Closing. A non-final stage's `output` is never read.
  row.outputs = acknowledged; // for rows decided at step 6 or later
  const hasClosed = ({ latest }) => latest !== null && isClosing(latest);
  const delivered = finalStage.latest?.body.output ?? null; // the final stage's latest receipt's output
  const answerDelivered = delivered?.done === true && delivered.count > 0 && acknowledged === delivered.count;
  const unclosed = stages.filter((stage) => !hasClosed(stage));
  if (unclosed.length > 0) {
    // The release window has passed after the last instant at which closesInTime holds.
    // CHOICE: `at` is milliseconds since the epoch; without a usable one the window has not passed.
    const windowPassed = typeof at === 'number' && at > agreed.deadline + terms.releaseWindowMs + skew;
    if (!answerDelivered) {
      if (!windowPassed) return done('open', 'step 6: not every stage closed and the release window has not passed');
      // An expired attempt charges nobody and pays nobody, acknowledged outputs included. For an
      // attempt that started, this is the relief for a verified provider failure.
      await post(0n);
      return done('expired', 'step 6: not every stage closed, no delivered answer, and the release window passed');
    }
    // Whatever the time. A stage with no counting receipt at all has none that covers the answer.
    const uncovered = unclosed.find((stage) => stage.latest === null || stage.latest.body.steps < delivered.count);
    if (uncovered) {
      return done('unknown', `step 6: delivered, but stage ${uncovered.position} has no receipt covering the answer`);
    }
    if (!windowPassed) return done('open', 'step 6: delivered, a stage has not closed and the release window has not passed');
    // Treated as closed at its last signed step: the partition indexes, ascending, kept when
    // step 7 or 8 then decides the row.
    row.closedAtLastStep = unclosed.map((stage) => stage.position);
  }

  // Step 7. Steps.
  const behind = stages.filter((stage) => stage.latest.body.steps < acknowledged);
  if (behind.length > 0) {
    for (const stage of behind) conflict('steps', true, stage.share.participantId, { partitionIndex: stage.position });
    return done('conflict', 'step 7: a stage\'s latest receipt has fewer steps than the acknowledged count');
  }

  // Step 8. Acceptances and accounts. With signed accounts each participant has one account, and
  // the outcome is `conflict` if a participant named more than one: a stage whose counting
  // acceptances carry different `payoutAccount`s, a participant that runs several stages and named
  // different ones, or a stage run by the requester's own key whose `payoutAccount` is not
  // `debitAccount`. Each such participant gets one `payout-account` entry, in the order of the
  // participants' first stages; its `accounts` are the distinct accounts it named in counting
  // records (the `debitAccount` too when it is the requester's own key), sorted by code unit.
  if (signedAccounts) {
    const namedBy = new Map(); // participant ID -> the accounts it named, in the order of first stages
    for (const { share, position } of stages) {
      const id = share.participantId;
      if (!namedBy.has(id)) namedBy.set(id, new Set(id === requesterId ? [terms.debitAccount] : []));
      for (const account of namedByStage[position]) namedBy.get(id).add(account);
    }
    const several = [...namedBy].filter(([, named]) => named.size > 1);
    for (const [participantId, named] of several) {
      conflict('payout-account', true, participantId, { accounts: [...named].sort() });
    }
    if (several.length > 0) return done('conflict', 'step 8: a participant named more than one account');
    // Otherwise, when the caller supplied `accountOf`, it is the enrollment the caller trusts, and
    // the outcome is `invalid` if the requester's `debitAccount`, or the signed account of any
    // stage that has one, differs from `accountOf` of that participant. No participant named
    // more than one account here, so each has at most one to test.
    // CHOICE (DOC-GAPS 90): supplied means any value but undefined or null. `accountOf` of a
    // participant is what `accountFor` gives, so one it does not place is its own account and
    // passes only when it signed its own participant ID. The requester is asked first, then the
    // stages' participants in the order of their first stages, each once; the first that differs
    // decides. CHOICE (DOC-GAPS 91): only the reason names it; the row has no member for it.
    if (accountOf !== null && accountOf !== undefined) {
      const signed = new Map([[requesterId, terms.debitAccount]]); // participant ID -> its one signed account
      for (const [participantId, named] of namedBy) {
        for (const account of named) signed.set(participantId, account);
      }
      for (const [participantId, account] of signed) {
        if ((await accountFor(accountOf, participantId)) !== account) {
          const member = participantId === requesterId ? 'debitAccount' : 'payoutAccount';
          return done('invalid', `step 8: accountOf does not enroll ${participantId} under the ${member} it signed`);
        }
      }
    }
  }
  // Otherwise the outcome is `unknown` if any stage has no in-time acceptance of the agreed terms
  // that counts. Without signed accounts this is the whole step, as before.
  const unaccepted = stages.find((stage) => !keptAcceptances.counting.some((a) => a.body.partitionIndex === stage.position));
  if (unaccepted) return done('unknown', `step 8: stage ${unaccepted.position} has no in-time acceptance of the agreed terms`);

  // Step 9. Settled. Every stage has closed or is treated as closed at its last step. The rule for
  // an unfinished answer is the one the requester signed in the terms' `unfinishedTerms`.
  const finished = delivered?.done === true;
  const stopped = keptStops.counting.length > 0; // an in-time stop of its own; its `acknowledged` is not used
  // CHOICE (DOC-GAPS 13): with no output on the final stage's latest receipt, nothing is withheld.
  // CHOICE (DOC-GAPS 82): "the terms' maxUnacknowledgedOutputs" is K, which terms of the older
  // shape do not sign; for every other set of terms it is the same number as before.
  const withheld = delivered !== null && delivered.count - acknowledged > K;
  // Every stage closed, so no provider failure is verified, and the records cannot show who ended it.
  const unattributedDisconnect = !finished && !stopped && !withheld;
  // Under the decided value, under `null` (older terms) and under any other value, every case
  // charges the acknowledged prefix. Only under the older provider-loss-free terms was an
  // unattributed disconnect ended by a stage, at 0. CHOICE (DOC-GAPS 79): the signed value
  // decides, whatever the dates of the terms; nothing here checks it against the decision's date.
  const olderRules = terms.unfinishedTerms === PROVIDER_LOSS_FREE;
  const endedByStage = olderRules && unattributedDisconnect;
  // A row whose answer a stage ended is settled with `outputs > 0` and `chargedOutputs: 0`;
  // no other settled row has that pair. CHOICE: `beyondCeiling` does not depend on whether
  // anything is charged.
  row.chargedOutputs = endedByStage ? 0 : Math.min(acknowledged, terms.maxOutputTokens);
  row.unacknowledgedOutputs = delivered === null ? null : delivered.count - acknowledged;
  row.beyondCeiling = Math.max(0, acknowledged - terms.maxOutputTokens);
  await post(BigInt(row.chargedOutputs) * BigInt(terms.creditsPerOutputToken));
  const closing = unclosed.length > 0 ? `; step 6: ${unclosed.length} stage(s) closed at their last step` : '';
  // CHOICE (DOC-GAPS 78): the reason, which is not part of the outcome, is the only place a row
  // says which unfinished-answer rule applied. When cases overlap (finished and stopped, say),
  // it names the first in step 9's order: finished, stopped, withheld, unattributed disconnect.
  const rule = olderRules ? 'older provider-loss-free terms'
    : terms.unfinishedTerms === ACKNOWLEDGED_PREFIX ? 'the decided acknowledged-prefix terms'
      : terms.unfinishedTerms === null ? 'unfinishedTerms null (older terms)' : 'an unfinishedTerms value of no named rule';
  if (endedByStage) {
    return done('settled', `step 9: unattributed disconnect under ${rule}, ended by a stage, charges 0${closing}`);
  }
  const why = finished ? 'finished' : stopped ? 'stopped by the requester'
    : withheld ? 'acknowledgments withheld' : 'unattributed disconnect';
  return done('settled', `step 9: ${why} under ${rule}, the acknowledged prefix is charged${closing}`);
}

/**
 * Replays signed settlement records against public policies (possibly none) at verification
 * time `at`, and returns { schema, at, counts, reservations, rejected, balances } as the
 * document's "Rows" section describes. Never throws on bad records: they are listed as rejected.
 *
 * `maxUnacknowledgedOutputs` is the stages' receiver policy's K (2 by default), used only for
 * a policy that does not name its own. CHOICE: an unusable value here is read as 2. For terms
 * of the older shape, which sign no K and pass only under such a policy, it is K itself.
 *
 * `accountOf` groups participant IDs into owner accounts. For an attempt with signed accounts,
 * whose agreed terms carry `debitAccount`, it is the enrollment the caller trusts and is used for
 * nothing but step 8's test: when it is supplied (CHOICE, DOC-GAPS 90: any value but undefined
 * or null), a signed account that differs from `accountOf` of its participant makes the row `invalid`.
 */
export async function replaySettlement({
  records, policies, at, accountOf = null, maxUnacknowledgedOutputs = RECEIVER_POLICY_K,
} = {}) {
  const receiverK = isCount(maxUnacknowledgedOutputs) ? maxUnacknowledgedOutputs : RECEIVER_POLICY_K;
  const policyByDigest = new Map();
  for (const policy of Array.isArray(policies) ? policies : []) {
    try {
      if (isObject(policy)) policyByDigest.set(digestOf(policy), policy);
    } catch {
      // A policy that has no canonical JSON has no digest, so no terms can name it.
    }
  }

  const rejected = [];
  const byReservation = new Map();
  const seen = new Set(); // identical bodies presented twice count once
  const count = Array.isArray(records) ? records.length : 0;
  for (let index = 0; index < count; index += 1) {
    const admitted = admit(records, index);
    if (admitted.rejected) {
      rejected.push(admitted.rejected);
    } else if (!seen.has(admitted.record.identity)) {
      seen.add(admitted.record.identity);
      place(byReservation, admitted.record);
    }
  }

  // One row per attempt, ordered by reservationId and then requesterId.
  const reservations = [];
  const totals = new Map(); // account -> BigInt, over settled and expired rows
  for (const reservationId of [...byReservation.keys()].sort()) {
    const { attempts, acceptances, receipts } = byReservation.get(reservationId);
    if (attempts.size === 0) {
      // No record names a requester: one row with `requesterId: null`. It has no terms (step 2).
      const row = newRow(reservationId, null);
      reservations.push(Object.assign(row, { reason: 'step 2: no terms left; no record names a requester' }));
    }
    for (const requesterId of [...attempts.keys()].sort()) {
      const attempt = { ...attempts.get(requesterId), acceptances, receipts };
      const { row, postings } = await decide(reservationId, requesterId, attempt, { policyByDigest, receiverK, at, accountOf });
      reservations.push(row);
      for (const [account, amount] of postings) totals.set(account, (totals.get(account) ?? 0n) + amount);
    }
  }

  // `counts` lists only the outcomes at least one row has (an empty object when there are no rows).
  // CHOICE: `balances` is an object keyed by account, debits negative, and names every account
  // of a settled or expired row, with 0 when nothing moved. A row with signed accounts is summed
  // under those accounts (DOC-GAPS 87); the other rows under `accountOf`'s, as before.
  const counts = {};
  for (const row of reservations) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const balances = Object.fromEntries([...totals].map(([account, total]) => [account, Number(total)]));
  // CHOICE: `at` is read as milliseconds since the epoch; one that is not a valid time is reported as null.
  const usable = typeof at === 'number' && Number.isFinite(at) && Math.abs(at) <= 8.64e15;
  return { schema: RESULT_SCHEMA, at: usable ? new Date(at).toISOString() : null, counts, reservations, rejected, balances };
}
