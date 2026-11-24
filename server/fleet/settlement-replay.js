/**
 * Independent settlement replay for split attempts.
 *
 * Input: the public credit policies, and whatever signed records the participants hand over (requester terms, stage
 * acceptances, stage receipts, requester output acknowledgments). No operator journal, balance or enrollment table is
 * read. Each attempt comes out as exactly one of:
 *
 *   settled   every stage closed in time; the requester is debited for the outputs it acknowledged in time, and each
 *             stage is credited its signed share of that debit (credit-shares.js, the ledger's own arithmetic)
 *   expired   the release window passed without every stage closing and without a delivered answer; nobody is charged
 *             or paid (the provider-loss-free terms)
 *   open      not every stage has closed and the release window has not passed; the outcome is not final yet
 *   conflict  some participant signed two incompatible statements; the conflicting records are listed
 *   unknown   the records presented cannot decide the outcome (for example a delivered answer with a stage's closing
 *             receipt missing); nothing is inferred
 *   invalid   the terms do not match a known public policy
 *
 * What this establishes: who signed what, and the amounts those signatures imply under the named policy. It does not
 * establish that any computation was correct, and it cannot see records a participant withholds; a withheld record
 * can only turn an outcome into `unknown`, `expired` or a smaller acknowledged count, never a larger charge.
 */
import { canonicalPartitionJson } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import {
  MAX_UNACKNOWLEDGED_OUTPUTS, OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, outputChainGenesis, verifyOutputAcknowledgment, verifyStageReceipt
} from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { UNFINISHED_ANSWER_TERMS, creditSettlementDeltas } from './credit-shares.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA, policyDigest, termsDigest, verifySettlementAcceptance,
  verifySettlementStop, verifySettlementTerms
} from './settlement-terms.js';

export const SETTLEMENT_REPLAY_SCHEMA = 'reploid.settlement-replay/v1';
const ms = value => Date.parse(value);
const signedBody = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };

async function classify(records) {
  const byReservation = new Map(), rejected = [];
  const slot = id => {
    if (!byReservation.has(id)) byReservation.set(id, { terms: [], acceptances: [], receipts: [], acknowledgments: [], stops: [] });
    return byReservation.get(id);
  };
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    const schema = record?.schema;
    let checked = null, kind = null;
    if (schema === SETTLEMENT_TERMS_SCHEMA) { checked = await verifySettlementTerms(record); kind = 'terms'; }
    else if (schema === SETTLEMENT_ACCEPTANCE_SCHEMA) { checked = await verifySettlementAcceptance(record); kind = 'acceptances'; }
    else if (schema === STAGE_RECEIPT_SCHEMA) { checked = await verifyStageReceipt(record); kind = 'receipts'; }
    else if (schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA) { checked = await verifyOutputAcknowledgment(record); kind = 'acknowledgments'; }
    else if (schema === SETTLEMENT_STOP_SCHEMA) { checked = await verifySettlementStop(record); kind = 'stops'; }
    if (!checked?.ok) { rejected.push({ index, schema: typeof schema === 'string' ? schema : null, problem: checked?.problem ?? 'unknown_record' }); continue; }
    slot(checked.body.reservationId)[kind].push(checked.body);
  }
  return { byReservation, rejected };
}

/** Distinct bodies only: the same signed statement presented twice counts once. */
const distinct = rows => {
  const seen = new Map();
  for (const row of rows) seen.set(canonicalPartitionJson(row), row);
  return [...seen.values()];
};

async function replayOne(reservationId, group, { policies, at, computerOf }) {
  const base = { reservationId, attemptId: null, status: null, reason: null, debit: null, credits: null, outputs: null,
    unacknowledgedOutputs: null, conflicts: [], late: [] };
  const terms = distinct(group.terms);
  if (terms.length === 0) return { ...base, status: 'unknown', reason: 'no requester-signed terms were presented' };
  if (terms.length > 1) {
    return { ...base, status: 'conflict', reason: 'the requester signed different terms for one reservation',
      conflicts: terms.map(row => ({ signer: row.requesterId, kind: 'terms', digest: null, attemptId: row.attemptId })) };
  }
  const agreed = terms[0], digest = await termsDigest(agreed);
  base.attemptId = agreed.attemptId;
  const policy = policies.get(agreed.policyDigest);
  if (!policy) return { ...base, status: 'invalid', reason: 'the terms name a policy that was not supplied' };
  if (agreed.unit !== policy.unit || agreed.creditsPerOutputToken !== policy.creditsPerOutputToken
    || agreed.maxOutputTokens > policy.maxOutputTokens || agreed.releaseWindowMs !== policy.partitionUnclaimedReleaseMs
    || ms(agreed.deadline) - ms(agreed.notBefore) > policy.maxRequestMs) {
    return { ...base, status: 'invalid', reason: 'the terms differ from the named policy' };
  }
  const skew = policy.maxClockSkewMs, deadline = ms(agreed.deadline), closesAt = deadline + agreed.releaseWindowMs;
  const inTime = value => ms(value) >= ms(agreed.notBefore) - skew && ms(value) <= deadline + skew;
  const stages = agreed.shares.length, finalIndex = stages - 1;
  const matches = row => row.attemptId === agreed.attemptId;

  // Acceptances: each stage, its own share, these exact terms.
  const accepted = new Set();
  for (const row of distinct(group.acceptances).filter(matches)) {
    if (row.termsDigest === digest && agreed.shares[row.partitionIndex]?.participantId === row.participantId) accepted.add(row.partitionIndex);
  }

  // Stage receipts: one tally per stage, cumulative by sequence. Two different bodies at one sequence, or steps that
  // go backwards, are the stage contradicting itself.
  const perStage = Array.from({ length: stages }, () => []);
  for (const row of distinct(group.receipts).filter(matches)) {
    if (row.routeHash !== agreed.routeHash || agreed.shares[row.partitionIndex]?.participantId !== row.participantId) continue;
    perStage[row.partitionIndex].push(row);
  }
  const latest = [];
  for (const [index, rows] of perStage.entries()) {
    rows.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < rows.length; i++) {
      const [previous, current] = [rows[i - 1], rows[i]];
      if (previous.sequence === current.sequence || current.steps < previous.steps || previous.timing.closedAt !== null) {
        base.conflicts.push({ signer: current.participantId, kind: 'stage-receipt', partitionIndex: index, sequences: [previous.sequence, current.sequence] });
      }
    }
    const timely = rows.filter(row => inTime(row.signedAt));
    rows.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'stage-receipt', partitionIndex: index, sequence: row.sequence }));
    latest[index] = timely.at(-1) ?? null;
  }

  // Requester acknowledgments: one chain value per count. The final stage's receipts must agree at every count both signed.
  const acknowledgments = distinct(group.acknowledgments).filter(row => matches(row) && row.routeHash === agreed.routeHash
    && row.requesterId === agreed.requesterId);
  const chainAt = new Map();
  for (const row of acknowledgments) {
    if (chainAt.has(row.count) && chainAt.get(row.count) !== row.chain) {
      base.conflicts.push({ signer: row.requesterId, kind: 'acknowledgment', count: row.count });
    }
    chainAt.set(row.count, row.chain);
  }
  for (const row of perStage[finalIndex] ?? []) {
    if (row.output && chainAt.has(row.output.count) && chainAt.get(row.output.count) !== row.output.chain) {
      base.conflicts.push({ signer: row.participantId, kind: 'output-chain', count: row.output.count });
    }
  }
  if (chainAt.has(0) && chainAt.get(0) !== await outputChainGenesis({ reservationId, routeHash: agreed.routeHash })) {
    base.conflicts.push({ signer: agreed.requesterId, kind: 'charge-binding', count: 0 });
  }
  if (base.conflicts.length) return { ...base, status: 'conflict', reason: 'a participant signed incompatible statements' };

  acknowledgments.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'acknowledgment', count: row.count }));
  const acknowledged = Math.max(0, ...acknowledgments.filter(row => inTime(row.signedAt)).map(row => row.count));
  const final = latest[finalIndex], delivered = final?.output ?? null;
  const closed = latest.map(row => Boolean(row && row.status !== 'executing' && row.timing.closedAt !== null));
  const answerDelivered = Boolean(delivered?.done && acknowledged === delivered.count && acknowledged > 0);

  if (!closed.every(Boolean)) {
    if (answerDelivered) {
      const missing = closed.flatMap((ok, index) => (ok ? [] : [index]));
      return { ...base, status: 'unknown', outputs: acknowledged,
        reason: `the answer was delivered and acknowledged, but no in-time closing receipt was presented for stage ${missing.join(', ')}` };
    }
    if (at < closesAt) return { ...base, status: 'open', reason: 'not every stage has closed and the release window is still open' };
    return { ...base, status: 'expired', debit: 0, credits: agreed.shares.map(row => ({ participantId: row.participantId, amount: 0 })),
      outputs: acknowledged, reason: 'the release window passed without every stage closing; under these terms nobody is charged or paid' };
  }
  if (latest.some(row => row.steps < acknowledged)) {
    return { ...base, status: 'conflict', reason: 'the requester acknowledged outputs a stage says it never computed',
      conflicts: latest.flatMap((row, index) => (row.steps < acknowledged ? [{ signer: row.participantId, kind: 'steps', partitionIndex: index }] : [])) };
  }
  const missingAcceptance = agreed.shares.flatMap((_, index) => (accepted.has(index) ? [] : [index]));
  if (missingAcceptance.length) {
    return { ...base, status: 'unknown', outputs: acknowledged,
      reason: `no signed acceptance of these terms was presented for stage ${missingAcceptance.join(', ')}` };
  }

  // The signed quote is a ceiling: outputs past `maxOutputTokens` are never charged, whoever acknowledged them.
  const chargeable = Math.min(acknowledged, agreed.maxOutputTokens);
  const finished = Boolean(delivered?.done && delivered.count === acknowledged);
  // An unfinished answer under provider-loss-free terms is owed only when the requester ended it: by its own signed
  // stop, or by withholding acknowledgments until a stage refused to go on (more than K outputs unacknowledged). A
  // stage that closes early on its own, even with a polite `failed` receipt, earns nothing and costs the requester nothing.
  const stoppedByRequester = distinct(group.stops).some(row => matches(row) && row.requesterId === agreed.requesterId && inTime(row.signedAt));
  const withheld = Boolean(delivered) && delivered.count - acknowledged > MAX_UNACKNOWLEDGED_OUTPUTS;
  const providerEnded = !finished && agreed.unfinishedTerms === UNFINISHED_ANSWER_TERMS && !stoppedByRequester && !withheld;
  const units = providerEnded ? 0 : chargeable * agreed.creditsPerOutputToken;
  const request = { providers: agreed.shares.map(row => ({ participantId: row.participantId, weight: row.weight })), computerId: computerOf(agreed.requesterId) };
  const split = creditSettlementDeltas(request, units, computerOf);
  const reason = finished ? 'the answer was completed and acknowledged'
    : providerEnded ? 'a stage ended the answer before it finished; under these terms nobody is charged or paid'
      : stoppedByRequester ? 'the requester signed a stop; the outputs it acknowledged are charged'
        : 'the requester stopped acknowledging; the outputs it acknowledged are charged';
  return { ...base, status: 'settled', debit: split.charge, credits: split.credits.map(row => ({ participantId: row.participantId, amount: row.amount })),
    outputs: acknowledged, chargedOutputs: providerEnded ? 0 : chargeable, unacknowledgedOutputs: delivered ? delivered.count - acknowledged : null,
    ...(acknowledged > agreed.maxOutputTokens ? { beyondCeiling: acknowledged - agreed.maxOutputTokens } : {}), reason };
}

/**
 * Replays settlement from signed records alone.
 * `policies`: the public policy objects any terms may name. `at`: the verifier's time in ms (decides only whether an
 * unfinished attempt is still `open`). `computerOf`: optional participant-to-computer map, used only to leave work a
 * requester's own computer did uncharged; by default every participant ID is its own computer.
 */
export async function replaySettlement({ records, policies, at, computerOf = id => id }) {
  if (!Array.isArray(policies) || policies.length === 0) throw Error('At least one public policy is required');
  if (!Number.isFinite(at)) throw Error('A verification time is required');
  const byDigest = new Map();
  for (const policy of policies) byDigest.set(await policyDigest(policy), policy);
  const { byReservation, rejected } = await classify(records);
  const reservations = [];
  for (const [reservationId, group] of [...byReservation.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    reservations.push(await replayOne(reservationId, group, { policies: byDigest, at, computerOf }));
  }
  const balances = new Map();
  const add = (id, amount) => balances.set(id, (balances.get(id) ?? 0) + amount);
  for (const row of reservations.filter(item => item.status === 'settled' || item.status === 'expired')) {
    const terms = byReservation.get(row.reservationId).terms[0];
    add(terms.requesterId, -row.debit);
    for (const credit of row.credits) add(credit.participantId, credit.amount);
  }
  const counts = {};
  for (const row of reservations) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { schema: SETTLEMENT_REPLAY_SCHEMA, at: new Date(at).toISOString(), counts, reservations, rejected,
    balances: Object.fromEntries([...balances.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export { signedBody };
