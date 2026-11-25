/**
 * Independent settlement replay.
 *
 * A second verifier written from docs/settlement-replay.md and from the code that produces and signs records,
 * without reading server/fleet/settlement-replay.js. It imports nothing from this repository: canonical JSON,
 * participant IDs, digests and signature checks are reimplemented here on node:crypto, so agreement with the
 * service's verifier is evidence that the public rules are enough, and disagreement shows where they are not.
 *
 * README.md lists every fact the document leaves unstated and where each was taken from.
 */
import { createHash, createPublicKey, verify as verifySignatureBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const OUTCOMES = Object.freeze(['settled', 'expired', 'open', 'conflict', 'unknown', 'invalid']);
export const SCHEMAS = Object.freeze({
  terms: 'reploid.settlement-terms/v1',
  acceptance: 'reploid.settlement-acceptance/v1',
  receipt: 'reploid.stage-receipt/v1',
  acknowledgment: 'reploid.output-acknowledgment/v1',
  stop: 'reploid.settlement-stop/v1'
});
const OUTPUT_CHAIN_SCHEMA = 'reploid.output-chain/v1';
const PROVIDER_LOSS_FREE = 'reploid.unfinished-answer/provider-loss-free/v1';
/** The document: "K is maxUnacknowledgedOutputs, currently 2". No signed record carries it. */
export const DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS = 2;

// ---------------------------------------------------------------------------------------------------------------
// Encoding, digests, keys and signatures
// ---------------------------------------------------------------------------------------------------------------

/** Canonical JSON: object keys sorted by UTF-16 code unit, arrays in order, scalars as JSON.stringify writes them. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('not a JSON value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${Array.from(value, item => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex');
export const digestOf = value => `sha256:${sha256Hex(canonicalJson(value))}`;

const COORDINATE = /^[A-Za-z0-9_-]{16,128}$/;
/** The public key reduced to its coordinates, or null. A key carrying private material is refused. */
function publicKeyOf(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || Object.hasOwn(jwk, 'd')) return null;
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && COORDINATE.test(jwk.x ?? '') && jwk.y === undefined) {
    return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
  }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && COORDINATE.test(jwk.x ?? '') && COORDINATE.test(jwk.y ?? '')) {
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }
  return null;
}

/** A participant ID is "peer:" plus the first 24 hex digits of the SHA-256 of the key's canonical coordinates. */
export function participantIdOf(key) {
  return `peer:${sha256Hex(canonicalJson({ kty: key.kty, crv: key.crv, x: key.x, y: key.y ?? null, n: null, e: null })).slice(0, 24)}`;
}

/** The signed bytes are the canonical JSON of { signatureDomain: <schema>, payload: <body> }. */
function signatureHolds(key, domain, body, signature) {
  if (typeof signature !== 'string' || signature.length === 0 || signature.length > 256) return false;
  try {
    const data = Buffer.from(canonicalJson({ signatureDomain: domain, payload: body }), 'utf8');
    const bytes = Buffer.from(signature, 'base64url');
    const keyObject = createPublicKey({ key, format: 'jwk' });
    if (key.kty === 'OKP') return verifySignatureBytes(null, data, keyObject, bytes);
    return verifySignatureBytes('sha256', data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, bytes);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Record shapes. The document names the records and what they bind; the field lists come from the producers.
// ---------------------------------------------------------------------------------------------------------------

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const hasExactly = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isText = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isPositive = value => Number.isSafeInteger(value) && value > 0;
const isTime = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isTimeOrNull = value => value === null || isTime(value);

const SHAPES = {
  [SCHEMAS.terms]: {
    signer: body => body.requesterId,
    wellFormed: body => hasExactly(body, ['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'policyDigest', 'unit',
      'creditsPerOutputToken', 'maxOutputTokens', 'maximum', 'shares', 'unfinishedTerms', 'notBefore', 'deadline', 'releaseWindowMs', 'signedAt'])
      && isText(body.reservationId, 160) && isText(body.attemptId) && DIGEST.test(body.routeHash) && isText(body.requesterId)
      && DIGEST.test(body.policyDigest) && isText(body.unit, 64) && isPositive(body.creditsPerOutputToken) && isPositive(body.maxOutputTokens)
      && Number.isSafeInteger(body.maximum) && body.maximum === body.maxOutputTokens * body.creditsPerOutputToken
      && Array.isArray(body.shares) && body.shares.length >= 1 && body.shares.length <= 128
      && body.shares.every((row, index) => hasExactly(row, ['partitionIndex', 'participantId', 'weight']) && row.partitionIndex === index
        && isText(row.participantId) && isPositive(row.weight))
      && (body.unfinishedTerms === null || isText(body.unfinishedTerms, 128))
      && isTime(body.notBefore) && isTime(body.deadline) && Date.parse(body.deadline) > Date.parse(body.notBefore)
      && isPositive(body.releaseWindowMs) && isTime(body.signedAt)
  },
  [SCHEMAS.acceptance]: {
    signer: body => body.participantId,
    wellFormed: body => hasExactly(body, ['schema', 'termsDigest', 'reservationId', 'attemptId', 'participantId', 'partitionIndex', 'signedAt'])
      && DIGEST.test(body.termsDigest) && isText(body.reservationId, 160) && isText(body.attemptId) && isText(body.participantId)
      && isCount(body.partitionIndex) && isTime(body.signedAt)
  },
  [SCHEMAS.receipt]: {
    signer: body => body.participantId,
    wellFormed: body => hasExactly(body, ['schema', 'reservationId', 'attemptId', 'routeHash', 'partitionIndex', 'participantId', 'sequence',
      'status', 'steps', 'tokens', 'timing', 'output', 'signedAt'])
      && isText(body.reservationId, 160) && isText(body.attemptId) && DIGEST.test(body.routeHash) && isCount(body.partitionIndex)
      && isText(body.participantId) && isPositive(body.sequence) && ['executing', 'settled', 'failed'].includes(body.status) && isCount(body.steps)
      && hasExactly(body.tokens, ['prompt', 'processed']) && (body.tokens.prompt === null || isCount(body.tokens.prompt)) && isCount(body.tokens.processed)
      && hasExactly(body.timing, ['reservedAt', 'firstStepAt', 'lastStepAt', 'closedAt']) && Object.values(body.timing).every(isTimeOrNull)
      && isTime(body.signedAt)
      && (body.output === null || (hasExactly(body.output, ['count', 'chain', 'done', 'stopReason']) && isCount(body.output.count)
        && body.output.count === body.steps && DIGEST.test(body.output.chain) && typeof body.output.done === 'boolean'
        && (body.output.stopReason === null || isText(body.output.stopReason, 64))))
  },
  [SCHEMAS.acknowledgment]: {
    signer: body => body.requesterId,
    wellFormed: body => hasExactly(body, ['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'count', 'chain', 'signedAt'])
      && isText(body.reservationId, 160) && isText(body.attemptId) && DIGEST.test(body.routeHash) && isText(body.requesterId)
      && isCount(body.count) && DIGEST.test(body.chain) && isTime(body.signedAt)
  },
  [SCHEMAS.stop]: {
    signer: body => body.requesterId,
    wellFormed: body => hasExactly(body, ['schema', 'reservationId', 'attemptId', 'requesterId', 'acknowledged', 'signedAt'])
      && isText(body.reservationId, 160) && isText(body.attemptId) && isText(body.requesterId) && isCount(body.acknowledged) && isTime(body.signedAt)
  }
};

/** One record checked on its own: shape, key, signer ID and signature. */
export function checkRecord(record) {
  let id;
  try { id = digestOf(record); } catch { return { ok: false, reason: 'not_json', id: null, schema: null, reservationId: null }; }
  const schema = record && typeof record === 'object' && !Array.isArray(record) ? record.schema : null;
  const reservationId = typeof record?.reservationId === 'string' ? record.reservationId : null;
  const fail = reason => ({ ok: false, reason, id, schema: typeof schema === 'string' ? schema : null, reservationId });
  const shape = typeof schema === 'string' && Object.hasOwn(SHAPES, schema) ? SHAPES[schema] : null;
  if (!shape) return fail('unknown_schema');
  const { publicJwk, signature, ...body } = record;
  if (!shape.wellFormed(body)) return fail('malformed');
  const key = publicKeyOf(publicJwk);
  if (!key) return fail('key_malformed');
  if (participantIdOf(key) !== shape.signer(body)) return fail('signer_is_not_key');
  if (!signatureHolds(key, schema, body, signature)) return fail('signature_invalid');
  return { ok: true, id, schema, reservationId, body, signer: shape.signer(body), signedAt: Date.parse(body.signedAt) };
}

// ---------------------------------------------------------------------------------------------------------------
// Judging one reservation
// ---------------------------------------------------------------------------------------------------------------

/** The ledger's split: floor(total * weight / totalWeight) per stage in order, the last stage takes the remainder. */
export function splitByWeights(total, shares) {
  const totalWeight = shares.reduce((sum, row) => sum + BigInt(row.weight), 0n);
  let remaining = BigInt(total);
  return shares.map((row, index) => {
    const amount = index === shares.length - 1 ? remaining : BigInt(total) * BigInt(row.weight) / totalWeight;
    remaining -= amount;
    return Number(amount);
  });
}

/** Which policy fields the terms must repeat. The document says only that terms must "match the named policy". */
function policyMismatches(terms, policy) {
  const problems = [];
  if (terms.unit !== policy.unit) problems.push('unit');
  if (terms.creditsPerOutputToken !== policy.creditsPerOutputToken) problems.push('creditsPerOutputToken');
  if (terms.releaseWindowMs !== policy.partitionUnclaimedReleaseMs) problems.push('releaseWindowMs');
  if (Number.isSafeInteger(policy.maxOutputTokens) && terms.maxOutputTokens > policy.maxOutputTokens) problems.push('maxOutputTokens');
  if (Number.isSafeInteger(policy.maxRequestMs) && Date.parse(terms.deadline) - Date.parse(terms.notBefore) > policy.maxRequestMs) problems.push('maxRequestMs');
  return problems;
}

const brief = entry => ({ id: entry.id, schema: entry.schema, signer: entry.signer ?? null });

function judgeReservation(reservationId, entries, { policyByDigest, now, K }) {
  const result = { reservationId, outcome: null, reason: null, attemptId: null, requesterId: null, deadline: null, releaseEndsAt: null,
    finished: null, delivered: null, acknowledged: null, total: 0, requesterDebit: 0, ownComputeUnits: 0, credits: [], late: [], rejected: [] };
  const done = (outcome, reason) => Object.assign(result, { outcome, reason });
  const reject = (entry, reason) => result.rejected.push({ ...brief(entry), reason });
  const of = schema => entries.filter(entry => entry.schema === schema);

  // Terms. One requester signing two different bodies is a conflict; bodies from different requesters cannot be
  // told apart by any signed record, so the reservation is undecidable.
  const termsEntries = of(SCHEMAS.terms);
  if (termsEntries.length === 0) return done('unknown', 'terms_missing');
  const termsByDigest = new Map(termsEntries.map(entry => [digestOf(entry.body), entry]));
  if (termsByDigest.size > 1) {
    const perRequester = new Map();
    for (const entry of termsByDigest.values()) perRequester.set(entry.signer, (perRequester.get(entry.signer) ?? 0) + 1);
    return [...perRequester.values()].some(count => count > 1) ? done('conflict', 'two_sets_of_terms') : done('unknown', 'terms_from_several_requesters');
  }
  const [[termsDigest, termsEntry]] = [...termsByDigest];
  const terms = termsEntry.body;
  const deadline = Date.parse(terms.deadline), releaseEndsAt = deadline + terms.releaseWindowMs;
  Object.assign(result, { attemptId: terms.attemptId, requesterId: terms.requesterId, deadline: terms.deadline, releaseEndsAt: new Date(releaseEndsAt).toISOString() });

  const policy = policyByDigest.get(terms.policyDigest);
  if (!policy) return done('invalid', 'policy_not_public');
  const mismatches = policyMismatches(terms, policy);
  if (mismatches.length) return done('invalid', `terms_do_not_match_policy:${mismatches.join(',')}`);

  const isLate = entry => entry.signedAt > deadline;
  const conflicts = [];
  if (isLate(termsEntry)) result.late.push(brief(termsEntry));

  // Records of this reservation that name another attempt or route are not statements about these terms.
  const boundTo = entry => entry.body.attemptId === terms.attemptId && (entry.body.routeHash === undefined || entry.body.routeHash === terms.routeHash);
  const bound = schema => of(schema).filter(entry => { if (boundTo(entry)) return true; reject(entry, 'not_bound_to_terms'); return false; });
  const stageCount = terms.shares.length, finalIndex = stageCount - 1;

  // Acceptances: each stage, with its own key, of exactly these terms at its own index.
  const accepted = Array(stageCount).fill(false);
  const acceptedDigests = Array.from({ length: stageCount }, () => new Set());
  for (const entry of bound(SCHEMAS.acceptance)) {
    const index = entry.body.partitionIndex;
    if (index >= stageCount || terms.shares[index].participantId !== entry.signer) { reject(entry, 'not_a_party'); continue; }
    acceptedDigests[index].add(entry.body.termsDigest);
    if (isLate(entry)) { result.late.push(brief(entry)); continue; }
    if (entry.body.termsDigest === termsDigest) accepted[index] = true;
  }
  if (acceptedDigests.some(set => set.size > 1)) conflicts.push('stage_accepted_two_sets_of_terms');

  // Stage receipts: cumulative, numbered by `sequence`.
  const receipts = Array.from({ length: stageCount }, () => []);
  for (const entry of bound(SCHEMAS.receipt)) {
    const index = entry.body.partitionIndex;
    if (index >= stageCount || terms.shares[index].participantId !== entry.signer) { reject(entry, 'not_a_party'); continue; }
    receipts[index].push(entry);
  }
  const stageChains = new Map();                                  // final stage: output count -> chain values it signed
  for (const [index, list] of receipts.entries()) {
    list.sort((a, b) => a.body.sequence - b.body.sequence);
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1].body, after = list[i].body;
      if (after.sequence === before.sequence) { conflicts.push('receipt_sequence_reused'); continue; }
      if (after.steps < before.steps || after.tokens.processed < before.tokens.processed) conflicts.push('receipt_sequence_goes_backwards');
      if (before.status !== 'executing') conflicts.push('receipt_after_close');
    }
    if (index !== finalIndex) continue;
    for (const entry of list) {
      if (!entry.body.output) continue;
      const seen = stageChains.get(entry.body.output.count) ?? new Set();
      stageChains.set(entry.body.output.count, seen.add(entry.body.output.chain));
    }
  }
  if ([...stageChains.values()].some(set => set.size > 1)) conflicts.push('two_output_chains_for_one_count');

  // Requester acknowledgments. Count zero is the charge binding and must carry the chain's starting value.
  const genesis = digestOf({ schema: OUTPUT_CHAIN_SCHEMA, reservationId, routeHash: terms.routeHash });
  const ackChains = new Map();
  let acknowledgedInTime = 0, acknowledgedEver = 0, chainDisagreement = false;
  for (const entry of bound(SCHEMAS.acknowledgment)) {
    if (entry.signer !== terms.requesterId) { reject(entry, 'not_a_party'); continue; }
    const { count, chain } = entry.body;
    ackChains.set(count, (ackChains.get(count) ?? new Set()).add(chain));
    acknowledgedEver = Math.max(acknowledgedEver, count);
    if (isLate(entry)) { result.late.push(brief(entry)); continue; }
    const committed = count === 0 ? new Set([genesis]) : stageChains.get(count);
    if (committed && !committed.has(chain)) { chainDisagreement = true; continue; }
    acknowledgedInTime = Math.max(acknowledgedInTime, count);
  }
  if ([...ackChains.values()].some(set => set.size > 1)) conflicts.push('two_acknowledged_chains_for_one_count');

  // The requester's stop.
  const stopCounts = new Set();
  let stopInTime = null;
  for (const entry of bound(SCHEMAS.stop)) {
    if (entry.signer !== terms.requesterId) { reject(entry, 'not_a_party'); continue; }
    stopCounts.add(entry.body.acknowledged);
    if (isLate(entry)) { result.late.push(brief(entry)); continue; }
    stopInTime = Math.max(stopInTime ?? 0, entry.body.acknowledged);
  }
  if (stopCounts.size > 1) conflicts.push('two_stops');
  if ([...stopCounts].some(count => count < acknowledgedEver)) conflicts.push('stop_understates_acknowledgments');

  if (conflicts.length) return done('conflict', [...new Set(conflicts)].join(','));
  if (isLate(termsEntry)) return done('unknown', 'terms_signed_after_deadline');
  if (accepted.includes(false)) return done('unknown', 'acceptance_missing');
  if (chainDisagreement) return done('unknown', 'acknowledged_chain_is_not_the_stage_chain');

  // Closing: a receipt with status settled or failed, signed no later than the deadline.
  const inTime = receipts.map(list => list.filter(entry => !isLate(entry)));
  for (const list of receipts) for (const entry of list) if (isLate(entry)) result.late.push(brief(entry));
  const closedInTime = inTime.map(list => list.some(entry => entry.body.status !== 'executing'));
  const finalInTime = inTime[finalIndex];
  const delivered = finalInTime.some(entry => entry.body.output?.done === true);
  const deliveredCount = finalInTime.reduce((most, entry) => Math.max(most, entry.body.output?.count ?? 0), 0);
  result.delivered = delivered;

  if (!closedInTime.every(Boolean)) {
    if (now <= releaseEndsAt) return done('open', 'release_window_not_passed');
    return delivered ? done('unknown', 'delivered_answer_without_every_closing_receipt') : done('expired', 'release_window_passed');
  }

  // Settled. What is owed depends on whether the answer finished and, if not, on who ended it.
  const acknowledged = Math.min(Math.max(acknowledgedInTime, stopInTime ?? 0), terms.maxOutputTokens);
  let owed = true, reason = 'answer_finished';
  if (!delivered) {
    if (terms.unfinishedTerms === null) reason = 'unfinished_acknowledged_prefix';
    else if (terms.unfinishedTerms !== PROVIDER_LOSS_FREE) return done('unknown', 'unfinished_terms_not_recognized');
    else if (stopInTime !== null) reason = 'requester_stopped';
    else if (deliveredCount - acknowledgedInTime > K) reason = 'requester_withheld_acknowledgments';
    else { owed = false; reason = 'stage_closed_early'; }
  }
  const total = owed ? acknowledged * terms.creditsPerOutputToken : 0;
  const amounts = splitByWeights(total, terms.shares);
  let ownComputeUnits = 0;
  const credits = terms.shares.map((row, index) => {
    const own = row.participantId === terms.requesterId;
    if (own) ownComputeUnits += amounts[index];
    return { partitionIndex: index, participantId: row.participantId, amount: own ? 0 : amounts[index] };
  });
  Object.assign(result, { finished: delivered, acknowledged, total, ownComputeUnits, requesterDebit: total - ownComputeUnits, credits });
  return done('settled', reason);
}

/**
 * Replay any set of records under the public policies at clock value `now` (milliseconds or an ISO string).
 * Returns one judgment per reservation that has at least one validly signed record, and the records that failed
 * their own checks.
 */
export function replaySettlement({ policies = [], records = [], now = Date.now(), maxUnacknowledgedOutputs = DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS } = {}) {
  const clock = typeof now === 'string' ? Date.parse(now) : Number(now);
  if (!Number.isFinite(clock)) throw new TypeError('now must be a time');
  const policyByDigest = new Map(policies.map(policy => [digestOf(policy), policy]));
  const seen = new Set(), valid = new Map(), rejected = [];
  let duplicates = 0;
  for (const record of records) {
    const checked = checkRecord(record);
    if (checked.id && seen.has(checked.id)) { duplicates += 1; continue; }
    if (checked.id) seen.add(checked.id);
    if (!checked.ok) { rejected.push({ id: checked.id, schema: checked.schema, reservationId: checked.reservationId, reason: checked.reason }); continue; }
    if (!valid.has(checked.reservationId)) valid.set(checked.reservationId, []);
    valid.get(checked.reservationId).push(checked);
  }
  const reservations = [...valid].map(([reservationId, entries]) => {
    const judged = judgeReservation(reservationId, entries, { policyByDigest, now: clock, K: maxUnacknowledgedOutputs });
    for (const row of rejected) if (row.reservationId === reservationId) judged.rejected.push({ id: row.id, schema: row.schema, signer: null, reason: row.reason });
    return judged;
  });
  return { now: new Date(clock).toISOString(), maxUnacknowledgedOutputs, duplicates, reservations, rejected };
}

// node scripts/settlement/independent/replay.js --policies policies.json --records records.json [--now 2026-01-01T00:00:00Z]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1]; };
  const policies = JSON.parse(readFileSync(flag('policies'), 'utf8')), records = JSON.parse(readFileSync(flag('records'), 'utf8'));
  process.stdout.write(`${JSON.stringify(replaySettlement({ policies: [policies].flat(), records, now: flag('now') ?? Date.now() }), null, 2)}\n`);
}
