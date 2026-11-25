// replay.js: settlement replay for split answers, second implementation.
//
// Written from docs/settlement-replay.md alone, by a second session working for
// the same operator as the reference implementation. It is NOT the work of an
// independent party. The reference code, the signers, the tests and the older
// verifier beside this file were not read. Where the document did not decide a
// behaviour, the choice made here is marked CHOICE and may differ from the
// reference. Node 22, built-in modules only.
//
// Follows the document's text as of commit c29bc5d44: canonical base64url and exact
// ISO times, one row per (reservation, requester) attempt, the receiver policy's K in
// step 3, closesInTime for closing receipts, and the conflict entries of its table.

import { createHash, createPublicKey, verify } from 'node:crypto';

const TERMS = 'reploid.settlement-terms/v1';
const ACCEPTANCE = 'reploid.settlement-acceptance/v1';
const RECEIPT = 'reploid.stage-receipt/v1';
const ACKNOWLEDGMENT = 'reploid.output-acknowledgment/v1';
const STOP = 'reploid.settlement-stop/v1';
const OUTPUT_CHAIN = 'reploid.output-chain/v1';
const PROVIDER_LOSS_FREE = 'reploid.unfinished-answer/provider-loss-free/v1';
const STATUSES = new Set(['executing', 'settled', 'failed']);
const CLOSING = new Set(['settled', 'failed']);
// K of the stages' receiver policy: "currently 2" in the document, which is all a verifier
// that may not read that policy has. See `receiverPolicy` on replaySettlement.
const RECEIVER_POLICY_K = 2;

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
// is required and no other is allowed), and rules that span members.
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
    across(body) {
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

/** Shape, key and signature checks. Returns { reason } to reject, or the admitted record. */
function admit(records, index) {
  let record;
  try {
    const input = records[index];
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return { reason: 'not an object' };
    record = plainCopy(input);
  } catch {
    return { reason: 'not a plain finite JSON value' };
  }
  const kind = KINDS.get(record.schema);
  if (!kind) return { reason: 'unknown schema' }; // CHOICE: rejected, not silently skipped
  if (!Object.hasOwn(record, 'publicJwk') || !Object.hasOwn(record, 'signature')) {
    return { reason: 'publicJwk or signature missing' };
  }
  const { publicJwk, signature, ...body } = record;
  if (Object.keys(body).some((name) => !Object.hasOwn(kind.fields, name))) return { reason: 'member not allowed' };
  for (const name of Object.keys(kind.fields)) {
    if (!Object.hasOwn(body, name)) return { reason: `member missing: ${name}` };
    if (!kind.fields[name](body[name])) return { reason: `field rule: ${name}` };
  }
  const fault = kind.across ? kind.across(body) : null;
  if (fault) return { reason: `field rule: ${fault}` };
  const jwk = keyOf(publicJwk);
  if (!jwk) return { reason: 'key shape' };
  if (!isBase64url(signature, 64)) return { reason: 'signature format' };
  if (body[kind.signer] !== participantIdOf(jwk)) return { reason: `${kind.signer} is not the ID of the carried key` };
  if (!signatureHolds(record.schema, body, jwk, signature)) return { reason: 'signature does not verify' };
  const admitted = { index, schema: record.schema, body, identity: canonicalJson(body), signedAt: Date.parse(body.signedAt) };
  if (record.schema === TERMS) {
    admitted.digest = digestOf(body);
    admitted.notBefore = Date.parse(body.notBefore);
    admitted.deadline = Date.parse(body.deadline);
  }
  return admitted;
}

// Groups by reservationId and then by requester (one "attempt", one output row): terms,
// acknowledgments and stops go to the requester they name; acceptances and stage receipts
// name no requester and are offered to every attempt under the reservation.
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

// ---- Deciding an outcome ----------------------------------------------------

/** Step 3. Returns what is wrong between the agreed terms and the policies, or null. */
function policyFault(agreed, policy, receiverK) {
  const terms = agreed.body;
  if (!policy) return 'the policy digest names no supplied policy'; // also the case of no policy at all
  if (terms.maxUnacknowledgedOutputs !== receiverK) return 'maxUnacknowledgedOutputs is not the receiver policy\'s K';
  if (policy.unit !== terms.unit) return 'unit is not the policy\'s';
  if (policy.creditsPerOutputToken !== terms.creditsPerOutputToken) return 'creditsPerOutputToken is not the policy\'s';
  if (policy.partitionUnclaimedReleaseMs !== terms.releaseWindowMs) return 'releaseWindowMs is not the policy\'s';
  if (typeof policy.maxOutputTokens !== 'number' || !(terms.maxOutputTokens <= policy.maxOutputTokens)) {
    return 'maxOutputTokens is above the policy\'s';
  }
  if (typeof policy.maxRequestMs !== 'number' || !(agreed.deadline - agreed.notBefore <= policy.maxRequestMs)) {
    return 'deadline - notBefore is above maxRequestMs';
  }
  // CHOICE: inTime cannot be computed without the allowance, so its absence is also invalid.
  if (!isCount(policy.maxClockSkewMs)) return 'the policy has no usable maxClockSkewMs';
  return null;
}

/** A closing receipt: `settled` or `failed`, with `closedAt` (step 4). */
const isClosing = (receipt) => CLOSING.has(receipt.body.status) && receipt.body.timing.closedAt !== null;

// Step 5, first conflict bullet, over one stage's kept receipts sorted by sequence (late ones
// included). Returns the pairs of sequences that conflict. CHOICE: the document does not say
// which two, or how many entries. Here: [s, s] for a repeated sequence; [the earliest earlier
// receipt with the most steps, s] when steps go backwards at s; [the first closing receipt, s]
// for a receipt after it; each pair once per stage.
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
// account. A participant it does not place is its own account.
async function accountFor(accountOf, participantId) {
  try {
    const account = typeof accountOf === 'function' ? await accountOf(participantId)
      : accountOf instanceof Map ? accountOf.get(participantId) : undefined;
    return account ?? participantId;
  } catch {
    return participantId;
  }
}

/** Decides one attempt, a (reservationId, requesterId) pair: one row of the output. */
async function decide(reservationId, requesterId, attempt, { policyByDigest, receiverK, at, accountOf }) {
  const result = {
    reservationId, outcome: 'unknown', reason: '', requesterId, termsDigest: null, units: 0, debit: 0,
    credits: [], late: [], foreign: [], unmatched: [], closedAtLastStep: [], conflicts: [],
  };
  const done = (outcome, reason) => {
    for (const list of [result.late, result.foreign, result.unmatched]) list.sort((a, b) => a.index - b.index);
    return Object.assign(result, { outcome, reason });
  };
  // Own terms, acknowledgments and stops; every acceptance and stage receipt of the reservation.
  const { terms: everyTerms, acknowledgments, stops, acceptances, receipts } = attempt;
  const listLate = (record) => result.late.push({ index: record.index, schema: record.schema });
  // One entry of `conflicts`: kind, blocking and signer, plus the members of its kind
  // (the table under "Conflict entries").
  const conflict = (kind, blocking, signer, members) => result.conflicts.push({ kind, blocking, signer, ...members });
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
    if (contradicted) result.foreign.push({ index: candidate.index });
    else if (!windowOf(candidate)(candidate.signedAt)) listLate(candidate);
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
  result.termsDigest = agreed.digest;

  // Step 3. Policy, and the receiver policy's K.
  const policy = policyByDigest.get(terms.policyDigest);
  const fault = policyFault(agreed, policy, receiverK);
  if (fault) return done('invalid', `step 3: ${fault}`);

  // Step 4. Records kept. A closing receipt counts when signed closesInTime, every other kept
  // record when signed inTime; a kept record that does not count is listed as late.
  const opens = agreed.notBefore - policy.maxClockSkewMs;
  const inTime = (t) => opens <= t && t <= agreed.deadline + policy.maxClockSkewMs;
  const closesInTime = (t) => opens <= t && t < agreed.deadline + terms.releaseWindowMs;
  const keep = (records, belongs) => {
    const kept = { all: [], counting: [] };
    for (const record of records) {
      // Another attemptId or a non-party: dropped without being listed. CHOICE: so is a
      // party's record with another route hash, and an acceptance of other terms.
      if (record.body.attemptId !== terms.attemptId || !belongs(record)) continue;
      kept.all.push(record);
      const closing = record.schema === RECEIPT && isClosing(record);
      if (closing ? closesInTime(record.signedAt) : inTime(record.signedAt)) kept.counting.push(record);
      else listLate(record);
    }
    return kept;
  };
  const onAgreedRoute = (record) => record.body.routeHash === terms.routeHash;
  const keptReceipts = keep(receipts, (receipt) => onAgreedRoute(receipt) && fromNamedStage(agreed, receipt));
  const keptAcks = keep(acknowledgments, onAgreedRoute); // the requester is this row's already
  const keptAcceptances = keep(acceptances, (acceptance) => accepts(acceptance, agreed));
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

  // Step 5. Acknowledged count and contradictions, late receipts included.
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
  const ackedChains = new Map(); // count -> the chains of its in-time acknowledgments
  for (const ack of keptAcks.counting) {
    if (!ackedChains.has(ack.body.count)) ackedChains.set(ack.body.count, new Set());
    ackedChains.get(ack.body.count).add(ack.body.chain);
  }
  let acknowledged = 0; // the highest matched count, 0 if none
  for (const count of [...ackedChains.keys()].sort(ascending)) {
    const chains = [...ackedChains.get(count)].sort();
    const finalChains = committedAt(count);
    const matched = finalChains === null ? null : chains.find((chain) => finalChains.has(chain)) ?? null;
    if (finalChains === null) {
      // No final-stage receipt commits a chain at this count: not charged. CHOICE: entries are { index, count }.
      for (const ack of keptAcks.counting) {
        if (ack.body.count === count) result.unmatched.push({ index: ack.index, count });
      }
    } else if (matched !== null) {
      acknowledged = Math.max(acknowledged, count);
    } else if (count === 0) {
      // CHOICE: at count 0 only this entry, not the disputed-chain one as well.
      conflict('charge-binding', true, requesterId, { count: 0 });
    } else {
      conflict('output-chain', true, null, { count, signers: [finalStageId, requesterId] });
    }
    if (chains.length > 1) {
      // CHOICE: also listed when the count is not matched (the table gives `settledOn` only
      // "when the count is matched"); `chains` then holds every chain. Chains are sorted.
      const others = chains.filter((chain) => chain !== matched);
      const members = matched === null ? { count, chains: others } : { count, chains: others, settledOn: matched };
      conflict('acknowledgment-equivocation', false, requesterId, members);
    }
  }
  const blockingKinds = new Set(result.conflicts.filter((entry) => entry.blocking).map((entry) => entry.kind));
  if (blockingKinds.size > 0) return done('conflict', `step 5: ${[...blockingKinds].join(', ')}`);

  // Step 6. Closing. A non-final stage's `output` is never read.
  const hasClosed = ({ latest }) => latest !== null && isClosing(latest);
  const delivered = finalStage.latest?.body.output ?? null; // the final stage's latest receipt's output
  const answerDelivered = delivered?.done === true && delivered.count > 0 && acknowledged === delivered.count;
  const unclosed = stages.filter((stage) => !hasClosed(stage));
  if (unclosed.length > 0) {
    // CHOICE: without a usable verification time the release window has not passed.
    const windowPassed = typeof at === 'number' && at >= agreed.deadline + terms.releaseWindowMs;
    if (!answerDelivered) {
      return windowPassed
        ? done('expired', 'step 6: not every stage closed, no delivered answer, and the release window passed')
        : done('open', 'step 6: not every stage closed and the release window has not passed');
    }
    // Whatever the time. A stage with no counting receipt at all has none that covers the answer.
    const uncovered = unclosed.find((stage) => stage.latest === null || stage.latest.body.steps < delivered.count);
    if (uncovered) {
      return done('unknown', `step 6: delivered, but stage ${uncovered.position} has no receipt covering the answer`);
    }
    if (!windowPassed) return done('open', 'step 6: delivered, a stage has not closed and the release window has not passed');
    // Treated as closed at its last signed step. CHOICE: entries are { partitionIndex, participantId },
    // and they stay listed if step 7 or 8 then decides the row.
    for (const stage of unclosed) {
      result.closedAtLastStep.push({ partitionIndex: stage.position, participantId: stage.share.participantId });
    }
  }

  // Step 7. Steps.
  const behind = stages.filter((stage) => stage.latest.body.steps < acknowledged);
  if (behind.length > 0) {
    for (const stage of behind) conflict('steps', true, stage.share.participantId, { partitionIndex: stage.position });
    return done('conflict', 'step 7: a stage\'s latest receipt has fewer steps than the acknowledged count');
  }

  // Step 8. Acceptances.
  const unaccepted = stages.find((stage) => !keptAcceptances.counting.some((a) => a.body.partitionIndex === stage.position));
  if (unaccepted) return done('unknown', `step 8: stage ${unaccepted.position} has no in-time acceptance of the agreed terms`);

  // Step 9. Settled.
  const finished = delivered?.done === true;
  const stopped = keptStops.counting.length > 0;
  const withheld = delivered !== null && delivered.count - acknowledged > terms.maxUnacknowledgedOutputs;
  const endedByStage = terms.unfinishedTerms === PROVIDER_LOSS_FREE && !finished && !stopped && !withheld;
  const units = endedByStage ? 0n
    : BigInt(Math.min(acknowledged, terms.maxOutputTokens)) * BigInt(terms.creditsPerOutputToken);

  // Split arithmetic. Every amount is at most `maximum`, a safe integer, so Number() is exact.
  const amounts = splitUnits(units, terms.shares.map((share) => BigInt(share.weight)));
  const requesterAccount = await accountFor(accountOf, requesterId);
  let debit = units;
  for (const [position, share] of terms.shares.entries()) {
    // The requester's own account is neither charged nor credited. CHOICE: its entry shows 0.
    const own = (await accountFor(accountOf, share.participantId)) === requesterAccount;
    if (own) debit -= amounts[position];
    const amount = own ? 0 : Number(amounts[position]);
    result.credits.push({ partitionIndex: position, participantId: share.participantId, amount });
  }
  result.units = Number(units);
  result.debit = Number(debit);
  const closing = unclosed.length > 0 ? `; step 6: ${unclosed.length} stage(s) closed at their last step` : '';
  if (endedByStage) return done('settled', 'step 9: ended by a stage under provider-loss-free terms, charges 0');
  const why = finished ? 'finished' : stopped ? 'stopped by the requester' : withheld ? 'acknowledgments withheld' : 'unfinished';
  return done('settled', `step 9: ${why}, the acknowledged prefix is charged${closing}`);
}

/**
 * Replays signed settlement records against public policies (possibly none) at verification
 * time `at` (milliseconds since the epoch). `reservations` holds one row per attempt, a
 * (reservationId, requesterId) pair. Never throws on bad records: they are listed as rejected.
 *
 * CHOICE: the document says the replay reads K from the stages' receiver policy and that "a
 * verifier may be given another value", but names no input. Here it is the optional
 * `receiverPolicy`, an object with `maxUnacknowledgedOutputs`; without a usable one K is 2,
 * and one value serves every stage.
 */
export async function replaySettlement({ records, policies, at, accountOf = null, receiverPolicy = null } = {}) {
  const given = isObject(receiverPolicy) ? receiverPolicy.maxUnacknowledgedOutputs : undefined;
  const receiverK = isCount(given) ? given : RECEIVER_POLICY_K;
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
    if (admitted.reason) {
      rejected.push({ index, reason: admitted.reason });
    } else if (!seen.has(admitted.identity)) {
      seen.add(admitted.identity);
      place(byReservation, admitted);
    }
  }

  // CHOICE: rows are ordered by reservationId, then requesterId. A reservation whose records
  // name no requester (acceptances and stage receipts only) has no attempt, so no row.
  const reservations = [];
  for (const reservationId of [...byReservation.keys()].sort()) {
    const { attempts, acceptances, receipts } = byReservation.get(reservationId);
    for (const requesterId of [...attempts.keys()].sort()) {
      const attempt = { ...attempts.get(requesterId), acceptances, receipts };
      reservations.push(await decide(reservationId, requesterId, attempt, { policyByDigest, receiverK, at, accountOf }));
    }
  }
  return { rejected, reservations };
}
