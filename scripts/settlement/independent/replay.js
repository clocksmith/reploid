// replay.js: settlement replay for split answers, second implementation.
//
// Written from docs/settlement-replay.md alone, by a second session working for
// the same operator as the reference implementation. It is NOT the work of an
// independent party. The reference code, the signers, the tests and the older
// verifier beside this file were not read. Where the document did not decide a
// behaviour, the choice made here is marked CHOICE and may differ from the
// reference. Node 22, built-in modules only.
//
// Follows the document's text as of commit 4ee9dd6b2: one row per (reservation,
// requester), the matched acknowledged count of step 5, and the closing rule of step 6.

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
const COORDINATE = /^[A-Za-z0-9_-]{16,128}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{1,256}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactly = (v, names) => isObject(v) && Object.keys(v).length === names.length
  && names.every((name) => Object.hasOwn(v, name));
const any = () => true;
// CHOICE: text length is counted in UTF-16 code units.
const text = (max = 256) => (v) => typeof v === 'string' && v.length >= 1 && v.length <= max;
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const isPositive = (v) => Number.isSafeInteger(v) && v > 0;
const isDigest = (v) => typeof v === 'string' && DIGEST.test(v);
const isTime = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
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
    // "null except on the final stage" needs the terms, so it cannot be judged here (see steps 5, 6 and 9).
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

/** The carried key rebuilt with exactly its allowed members, or null. */
function keyOf(jwk) {
  if (!isObject(jwk) || typeof jwk.x !== 'string' || !COORDINATE.test(jwk.x)) return null;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && hasExactly(jwk, ['kty', 'crv', 'x'])) {
    return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && hasExactly(jwk, ['kty', 'crv', 'x', 'y'])
    && typeof jwk.y === 'string' && COORDINATE.test(jwk.y)) {
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }
  return null;
}

/** Signed bytes: UTF-8 canonical JSON of { signatureDomain: schema, payload: body }. */
function signatureHolds(schema, body, jwk, signature) {
  try {
    const bytes = Buffer.from(canonicalJson({ signatureDomain: schema, payload: body }), 'utf8');
    const raw = Buffer.from(signature, 'base64url');
    if (raw.length !== 64) return false; // Ed25519 and raw P-256 r || s are both 64 bytes
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
  if (typeof signature !== 'string' || !SIGNATURE.test(signature)) return { reason: 'signature format' };
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

/** Step 3. Returns what is wrong between the agreed terms and their policy, or null. */
function policyFault(agreed, policy) {
  const terms = agreed.body;
  if (!policy) return 'the policy digest names no supplied policy';
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

/** Step 5, first conflict bullet, over one stage's receipts sorted by sequence (late ones included). */
function receiptFaults(sorted) {
  const faults = new Set();
  let highestSteps = -1; // over receipts with a strictly lower sequence
  let closed = false; // a receipt with a strictly lower sequence closed the stage
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end].body.sequence === sorted[start].body.sequence) end += 1;
    const sameSequence = sorted.slice(start, end);
    if (sameSequence.length > 1) faults.add('receipt-sequence-repeated');
    if (sameSequence.some((receipt) => receipt.body.steps < highestSteps)) faults.add('receipt-steps-backwards');
    if (closed) faults.add('receipt-after-closing');
    for (const { body } of sameSequence) {
      highestSteps = Math.max(highestSteps, body.steps);
      closed ||= CLOSING.has(body.status);
    }
    start = end;
  }
  return [...faults];
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

/** Decides one (reservation, requester) attempt: one row of the output. */
async function decide(reservationId, requesterId, attempt, { policyByDigest, at, accountOf }) {
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
  const block = (signer, kind) => result.conflicts.push({ signer, kind, blocking: true });
  const fromNamedStage = (terms, record) =>
    terms.body.shares[record.body.partitionIndex]?.participantId === record.body.participantId;
  // "An acceptance counts only for the agreed terms digest and its own share" (and its attempt).
  const accepts = (acceptance, terms) => acceptance.body.termsDigest === terms.digest
    && acceptance.body.attemptId === terms.body.attemptId && fromNamedStage(terms, acceptance);
  // inTime(t) for one set of terms and the policy it names. CHOICE: in steps 1 and 2 the
  // policy has not been checked yet; one that is not supplied gives an allowance of 0.
  const windowOf = (terms) => {
    const skew = policyByDigest.get(terms.body.policyDigest)?.maxClockSkewMs;
    const allowance = isCount(skew) ? skew : 0;
    return (t) => terms.notBefore - allowance <= t && t <= terms.deadline + allowance;
  };

  // Step 1. Which terms. The acknowledgments here are this requester's only.
  // CHOICE: "any acknowledgment" means any for the terms' attemptId; terms that are both
  // off the route and late are listed as foreign only.
  const remaining = [];
  for (const candidate of everyTerms) {
    const { attemptId, routeHash } = candidate.body;
    const itsAcks = acknowledgments.filter((ack) => ack.body.attemptId === attemptId);
    const itsReceipts = receipts.filter((receipt) => receipt.body.attemptId === attemptId
      && fromNamedStage(candidate, receipt));
    const onRoute = itsAcks.length + itsReceipts.length > 0
      && (itsReceipts.length === 0 || itsReceipts.some((receipt) => receipt.body.routeHash === routeHash))
      && (itsAcks.length === 0 || itsAcks.some((ack) => ack.body.routeHash === routeHash));
    if (!onRoute) result.foreign.push({ index: candidate.index });
    else if (!windowOf(candidate)(candidate.signedAt)) listLate(candidate);
    else remaining.push(candidate);
  }

  // Step 2. One set or several.
  if (remaining.length === 0) return done('unknown', 'step 2: no terms left');
  let agreed = remaining[0];
  if (remaining.length > 1) {
    // CHOICE: no terms are agreed yet, so each acceptance is timed against the set it names.
    const named = remaining.filter((candidate) => {
      const inItsWindow = windowOf(candidate);
      return acceptances.some((acceptance) => accepts(acceptance, candidate) && inItsWindow(acceptance.signedAt));
    });
    if (named.length !== 1) {
      block(requesterId, 'terms-equivocation');
      return done('conflict', named.length === 0
        ? 'step 2: several terms from one requester and no in-time acceptance'
        : 'step 2: in-time acceptances name different terms');
    }
    [agreed] = named;
    // CHOICE: "the settled digest" is carried as `settledOn`, the member step 5 names for its own entry.
    result.conflicts.push({ signer: requesterId, kind: 'terms-equivocation', blocking: false, settledOn: agreed.digest });
  }
  const terms = agreed.body;
  result.termsDigest = agreed.digest;

  // Step 3. Policy.
  const fault = policyFault(agreed, policyByDigest.get(terms.policyDigest));
  if (fault) return done('invalid', `step 3: ${fault}`);

  // Step 4. Records of this attempt.
  const inTime = windowOf(agreed);
  const keep = (records, belongs) => {
    const kept = { all: [], inTime: [] };
    for (const record of records) {
      // Another attempt or a non-party: dropped without being listed. CHOICE: so is a
      // party's record with another route hash, and an acceptance of other terms.
      if (record.body.attemptId !== terms.attemptId || !belongs(record)) continue;
      kept.all.push(record);
      if (inTime(record.signedAt)) kept.inTime.push(record);
      else listLate(record);
    }
    return kept;
  };
  const onAgreedRoute = (record) => record.body.routeHash === terms.routeHash;
  const keptReceipts = keep(receipts, (receipt) => onAgreedRoute(receipt) && fromNamedStage(agreed, receipt));
  const keptAcks = keep(acknowledgments, onAgreedRoute); // the requester is this row's already
  const keptAcceptances = keep(acceptances, (acceptance) => accepts(acceptance, agreed));
  const keptStops = keep(stops, () => true);

  // CHOICE: "latest" is the highest sequence. Step 5 leaves no ties once it passes.
  const bySequence = (a, b) => a.body.sequence - b.body.sequence;
  const stages = terms.shares.map((share, position) => {
    const mine = (receipt) => receipt.body.partitionIndex === position;
    const all = keptReceipts.all.filter(mine).sort(bySequence); // late receipts included
    const stageInTime = keptReceipts.inTime.filter(mine).sort(bySequence);
    return { share, position, all, inTime: stageInTime, latest: stageInTime.at(-1) ?? null };
  });
  const finalStage = stages.at(-1);

  // Step 5. Acknowledged count and contradictions. CHOICE: the document names only the kinds
  // terms-equivocation and acknowledgment-equivocation; the other kinds below are mine.
  for (const stage of stages) {
    for (const kind of receiptFaults(stage.all)) block(stage.share.participantId, kind);
  }
  // The chains the final stage's receipts give per count. CHOICE: in-time receipts only (step 4
  // ignores late records, and only the first conflict bullet says late receipts are included).
  const committed = new Map();
  for (const { body } of finalStage.inTime) {
    if (body.output === null) continue; // CHOICE: `output: null` on the final stage commits nothing
    committed.set(body.output.count, (committed.get(body.output.count) ?? new Set()).add(body.output.chain));
  }
  if ([...committed.values()].some((chains) => chains.size > 1)) {
    block(finalStage.share.participantId, 'output-chain-equivocation');
  }
  // At count 0 the committed chain is the starting value. CHOICE: whatever a receipt gives there.
  const startingChain = digestOf({ schema: OUTPUT_CHAIN, reservationId, routeHash: terms.routeHash });
  const committedAt = (count) => (count === 0 ? new Set([startingChain]) : committed.get(count) ?? null);
  const acksByCount = new Map();
  for (const ack of keptAcks.inTime) {
    if (!acksByCount.has(ack.body.count)) acksByCount.set(ack.body.count, []);
    acksByCount.get(ack.body.count).push(ack);
  }
  let acknowledged = 0; // the highest matched count, 0 if none
  for (const count of [...acksByCount.keys()].sort((a, b) => a - b)) {
    const acks = acksByCount.get(count);
    const chains = committedAt(count);
    if (chains === null) {
      // No final-stage receipt commits to this count: not charged. CHOICE: entries are { index, count }.
      for (const ack of acks) result.unmatched.push({ index: ack.index, count });
      continue;
    }
    const matched = acks.find((ack) => chains.has(ack.body.chain))?.body.chain ?? null;
    if (matched === null && count === 0) {
      // CHOICE: a wrong charge binding is the requester's fault alone (anyone can compute the value).
      block(requesterId, 'charge-binding-not-starting-chain');
    } else if (matched === null) {
      // CHOICE: `signers` lists the requester, then the final stage.
      const signers = [requesterId, finalStage.share.participantId];
      result.conflicts.push({ signer: null, signers, kind: 'disputed-chain', blocking: true });
    } else {
      acknowledged = Math.max(acknowledged, count);
      // CHOICE: one entry per extra acknowledgment, not one per count.
      for (const ack of acks) {
        if (ack.body.chain === matched) continue;
        result.conflicts.push({ signer: requesterId, kind: 'acknowledgment-equivocation', blocking: false, settledOn: matched });
      }
    }
  }
  const blockingKinds = new Set(result.conflicts.filter((conflict) => conflict.blocking).map((conflict) => conflict.kind));
  if (blockingKinds.size > 0) return done('conflict', `step 5: ${[...blockingKinds].join(', ')}`);

  // Step 6. Closing. A non-final stage's `output` is never read.
  const hasClosed = ({ latest }) => latest !== null && CLOSING.has(latest.body.status) && latest.body.timing.closedAt !== null;
  const delivered = finalStage.latest?.body.output ?? null; // the final stage's latest in-time output
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
    // CHOICE: a stage with no covering receipt makes the outcome unknown before the window too.
    const uncovered = unclosed.find((stage) => stage.latest === null || stage.latest.body.steps < delivered.count);
    if (uncovered) {
      return done('unknown', `step 6: delivered, but stage ${uncovered.position} has no in-time receipt covering the answer`);
    }
    if (!windowPassed) return done('open', 'step 6: delivered, a stage has not closed and the release window has not passed');
    // Treated as closed at its last signed step. CHOICE: entries are { partitionIndex, participantId },
    // and they stay listed if step 7 or 8 then decides the row.
    for (const stage of unclosed) {
      result.closedAtLastStep.push({ partitionIndex: stage.position, participantId: stage.share.participantId });
    }
  }

  // Step 7. Steps. CHOICE: listed against the stage whose receipt is behind.
  const behind = stages.filter((stage) => stage.latest.body.steps < acknowledged);
  if (behind.length > 0) {
    for (const stage of behind) block(stage.share.participantId, 'steps-below-acknowledged');
    return done('conflict', 'step 7: a stage\'s latest receipt has fewer steps than the acknowledged count');
  }

  // Step 8. Acceptances.
  const unaccepted = stages.find((stage) => !keptAcceptances.inTime.some((a) => a.body.partitionIndex === stage.position));
  if (unaccepted) return done('unknown', `step 8: stage ${unaccepted.position} has no in-time acceptance of the agreed terms`);

  // Step 9. Settled.
  const finished = delivered?.done === true;
  const stopped = keptStops.inTime.length > 0;
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
 * Replays signed settlement records against public policies at verification time `at`
 * (milliseconds since the epoch). `reservations` holds one row per (reservationId, requesterId).
 * Never throws on bad records: they are listed as rejected.
 */
export async function replaySettlement({ records, policies, at, accountOf = null } = {}) {
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
      reservations.push(await decide(reservationId, requesterId, attempt, { policyByDigest, at, accountOf }));
    }
  }
  return { rejected, reservations };
}
