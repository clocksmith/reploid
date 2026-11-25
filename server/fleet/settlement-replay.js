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
 *   unknown   the records presented cannot decide the outcome (for example a delivered answer with no receipt from
 *             one stage covering it); nothing is inferred
 *   invalid   the terms do not match a known public policy
 *
 * What this establishes: who signed what, and the amounts those signatures imply under the named policy. It does not
 * establish that any computation was correct, and it cannot see records a participant withholds; a withheld record
 * can only turn an outcome into `unknown`, `expired` or a smaller acknowledged count, never a larger charge.
 */
import { canonicalPartitionJson } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import {
  OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, outputChainGenesis, verifyOutputAcknowledgment, verifyStageReceipt
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

/**
 * Splits one reservation's records by requester. Terms, acknowledgments and stops name their requester; each
 * requester's own records form its own attempt, so a stranger signing under a known reservation ID can only make an
 * attempt that charges the stranger. Acceptances and stage receipts name no requester and are offered to every
 * attempt; each attempt keeps only those that match its own terms.
 */
function byRequester(group) {
  const ids = [...new Set([...group.terms, ...group.acknowledgments, ...group.stops].map(row => row.requesterId))].sort();
  if (ids.length === 0) return [[null, group]];
  const own = (rows, id) => rows.filter(row => row.requesterId === id);
  return ids.map(id => [id, { terms: own(group.terms, id), acknowledgments: own(group.acknowledgments, id), stops: own(group.stops, id),
    acceptances: group.acceptances, receipts: group.receipts }]);
}

/** Distinct bodies only: the same signed statement presented twice counts once. */
const distinct = rows => {
  const seen = new Map();
  for (const row of rows) seen.set(canonicalPartitionJson(row), row);
  return [...seen.values()];
};

/**
 * The terms this requester's attempt settles on, or the outcome that stops it. Terms count only when they sit on the
 * attempt's route: the stage receipts carry their route hash (which binds the requester) and the acknowledgments
 * carry that route hash with their requester. Anything else is listed as `foreign` and can never cause a conflict.
 * Terms signed outside their own window are listed as `late` and ignored. When the requester signed more than one
 * set, the set every stage's acceptance names is the agreed one and the equivocation is recorded for reputation;
 * only acceptances split across sets make a conflict.
 */
async function agreedTerms(group, base, policies) {
  const receipts = distinct(group.receipts), acknowledgments = distinct(group.acknowledgments), acceptances = distinct(group.acceptances);
  const onRoute = row => {
    const own = receipts.filter(item => item.attemptId === row.attemptId && row.shares[item.partitionIndex]?.participantId === item.participantId);
    const acked = acknowledgments.filter(item => item.attemptId === row.attemptId);
    return own.length + acked.length > 0 && (own.length === 0 || own.some(item => item.routeHash === row.routeHash))
      && (acked.length === 0 || acked.some(item => item.routeHash === row.routeHash && item.requesterId === row.requesterId));
  };
  const candidates = [];
  for (const row of distinct(group.terms)) {
    const digest = await termsDigest(row), policy = policies.get(row.policyDigest);
    if (!onRoute(row)) { base.foreign.push({ kind: 'terms', signer: row.requesterId, attemptId: row.attemptId, digest }); continue; }
    if (policy && !within(row, policy.maxClockSkewMs)(row.signedAt)) { base.late.push({ kind: 'terms', signer: row.requesterId, digest }); continue; }
    candidates.push({ row, digest });
  }
  // The digests each candidate's own stages accepted, in time.
  const acceptedBy = candidate => new Set(acceptances.filter(item => item.attemptId === candidate.row.attemptId
    && item.termsDigest === candidate.digest && candidate.row.shares[item.partitionIndex]?.participantId === item.participantId
    && within(candidate.row, policies.get(candidate.row.policyDigest)?.maxClockSkewMs ?? 0)(item.signedAt)).map(item => item.partitionIndex));
  const pool = candidates;
  if (pool.length === 0) {
    const ignored = base.foreign.length + base.late.length;
    return { stop: { status: 'unknown', reason: ignored ? 'no in-time requester-signed terms for this route were presented'
      : 'no requester-signed terms were presented' } };
  }
  if (pool.length === 1) return { agreed: pool[0].row, digest: pool[0].digest };
  const accepted = pool.filter(item => acceptedBy(item).size > 0);
  const equivocation = { signer: pool[0].row.requesterId, kind: 'terms-equivocation', digests: pool.map(item => item.digest).sort() };
  if (accepted.length !== 1) {
    return { stop: { status: 'conflict', reason: accepted.length ? 'the stages accepted different terms the requester signed for one reservation'
      : 'the requester signed different terms for one reservation and no stage accepted either', conflicts: [{ ...equivocation, blocking: true }] } };
  }
  base.conflicts.push({ ...equivocation, blocking: false, settledOn: accepted[0].digest });
  return { agreed: accepted[0].row, digest: accepted[0].digest };
}

/** `notBefore - skew <= signedAt <= deadline + skew` for these terms. */
const within = (terms, skew) => value => ms(value) >= ms(terms.notBefore) - skew && ms(value) <= ms(terms.deadline) + skew;

async function replayOne(reservationId, requesterId, group, { policies, at, computerOf }) {
  const base = { reservationId, attemptId: null, requesterId, status: null, reason: null, debit: null, credits: null, outputs: null,
    unacknowledgedOutputs: null, conflicts: [], late: [], foreign: [], unmatched: [] };
  const chosen = await agreedTerms(group, base, policies);
  if (chosen.stop) return { ...base, ...chosen.stop, conflicts: [...base.conflicts, ...(chosen.stop.conflicts ?? [])] };
  const { agreed, digest } = chosen;
  base.attemptId = agreed.attemptId;
  base.requesterId = agreed.requesterId;
  const policy = policies.get(agreed.policyDigest);
  if (!policy) return { ...base, status: 'invalid', reason: 'the terms name a policy that was not supplied' };
  if (agreed.unit !== policy.unit || agreed.creditsPerOutputToken !== policy.creditsPerOutputToken
    || agreed.maxOutputTokens > policy.maxOutputTokens || agreed.releaseWindowMs !== policy.partitionUnclaimedReleaseMs
    || ms(agreed.deadline) - ms(agreed.notBefore) > policy.maxRequestMs) {
    return { ...base, status: 'invalid', reason: 'the terms differ from the named policy' };
  }
  const skew = policy.maxClockSkewMs, closesAt = ms(agreed.deadline) + agreed.releaseWindowMs;
  const inTime = within(agreed, skew);
  const stages = agreed.shares.length, finalIndex = stages - 1;
  const matches = row => row.attemptId === agreed.attemptId;
  // Notes such as a requester's settled equivocation stay listed; only conflicts found from here on block settlement.
  const noted = base.conflicts.length;

  // Acceptances: each stage, its own share, these exact terms, signed in time.
  const accepted = new Set();
  for (const row of distinct(group.acceptances).filter(matches)) {
    if (row.termsDigest !== digest || agreed.shares[row.partitionIndex]?.participantId !== row.participantId) continue;
    if (inTime(row.signedAt)) accepted.add(row.partitionIndex);
    else base.late.push({ kind: 'acceptance', partitionIndex: row.partitionIndex });
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

  // Requester acknowledgments, checked against the final stage's committed chain at each count (at count 0, the
  // starting value anyone can compute). A count is charged only when an in-time acknowledgment of it carries that
  // chain. Any further chain the requester signed for that count is its own contradiction: it is listed, and it never
  // lowers what the requester owes. Late acknowledgments are listed and ignored: they neither charge nor conflict.
  const acknowledgments = distinct(group.acknowledgments).filter(row => matches(row) && row.routeHash === agreed.routeHash
    && row.requesterId === agreed.requesterId);
  acknowledgments.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'acknowledgment', count: row.count }));
  const timelyAcknowledgments = acknowledgments.filter(row => inTime(row.signedAt));
  const finalParticipant = agreed.shares[finalIndex].participantId;
  const committed = new Map([[0, await outputChainGenesis({ reservationId, routeHash: agreed.routeHash })]]);
  for (const row of perStage[finalIndex] ?? []) {
    if (!row.output) continue;
    const held = committed.get(row.output.count);
    if (held === undefined) committed.set(row.output.count, row.output.chain);
    else if (held !== row.output.chain && !base.conflicts.some(item => item.kind === 'output-chain' && item.count === row.output.count)) {
      // The final stage's own two chains for one count (or a starting value other than the computable one).
      base.conflicts.push({ signer: row.participantId, kind: 'output-chain', count: row.output.count });
    }
  }
  const chainsAt = new Map();
  for (const row of timelyAcknowledgments) chainsAt.set(row.count, new Set([...(chainsAt.get(row.count) ?? []), row.chain]));
  const matchedCounts = [];
  for (const [count, chains] of [...chainsAt.entries()].sort(([a], [b]) => a - b)) {
    const stageChain = committed.get(count), others = [...chains].filter(chain => chain !== stageChain).sort();
    if (stageChain !== undefined && chains.has(stageChain)) {
      matchedCounts.push(count);
      if (others.length) base.conflicts.push({ signer: agreed.requesterId, kind: 'acknowledgment-equivocation', count, blocking: false, settledOn: stageChain, chains: others });
    } else if (stageChain === undefined) {
      // No presented final-stage receipt commits to this count: the acknowledgment is listed and not charged.
      base.unmatched.push({ kind: 'acknowledgment', count });
      if (others.length > 1) base.conflicts.push({ signer: agreed.requesterId, kind: 'acknowledgment-equivocation', count, blocking: false, chains: others });
    } else if (count === 0) {
      base.conflicts.push({ signer: agreed.requesterId, kind: 'charge-binding', count: 0 });
    } else {
      // Every chain the requester signed for this count differs from the final stage's: one of the two signed something
      // false, and the records cannot show which.
      base.conflicts.push({ signer: null, signers: [finalParticipant, agreed.requesterId], kind: 'output-chain', count });
    }
  }
  if (base.conflicts.slice(noted).some(row => row.blocking !== false)) {
    return { ...base, status: 'conflict', reason: 'a participant signed incompatible statements' };
  }

  const acknowledged = Math.max(0, ...matchedCounts);
  const final = latest[finalIndex], delivered = final?.output ?? null;
  const closed = latest.map(row => Boolean(row && row.status !== 'executing' && row.timing.closedAt !== null));
  const answerDelivered = Boolean(delivered?.done && acknowledged === delivered.count && acknowledged > 0);
  const unclosed = closed.flatMap((ok, index) => (ok ? [] : [index]));
  let closedAtLastStep = [];

  if (unclosed.length && answerDelivered) {
    // The final stage signed `done` at N and the requester acknowledged N in time. A stage whose in-time step receipts
    // cover all N steps evidently computed the whole answer, so after the release window it is treated as closed at its
    // last signed step and paid its share: one stage withholding its closing receipt cannot veto everyone's payment.
    // A stage with no receipt covering the answer stays undecided.
    const uncovered = unclosed.filter(index => !(latest[index] && latest[index].steps >= delivered.count));
    if (uncovered.length) {
      return { ...base, status: 'unknown', outputs: acknowledged,
        reason: `the answer was delivered and acknowledged, but no in-time receipt covering it was presented for stage ${uncovered.join(', ')}` };
    }
    if (at < closesAt) {
      return { ...base, status: 'open', outputs: acknowledged, reason: `the answer was delivered and acknowledged; stage ${unclosed.join(', ')} has not closed `
        + 'and the release window is still open' };
    }
    closedAtLastStep = unclosed;
  } else if (unclosed.length) {
    if (at < closesAt) return { ...base, status: 'open', reason: 'not every stage has closed and the release window is still open' };
    return { ...base, status: 'expired', debit: 0, credits: agreed.shares.map(row => ({ participantId: row.participantId, amount: 0 })),
      outputs: acknowledged, reason: 'the release window passed without every stage closing; under these terms nobody is charged or paid' };
  }
  if (latest.some(row => row.steps < acknowledged)) {
    return { ...base, status: 'conflict', reason: 'the requester acknowledged outputs a stage says it never computed',
      conflicts: [...base.conflicts, ...latest.flatMap((row, index) => (row.steps < acknowledged ? [{ signer: row.participantId, kind: 'steps', partitionIndex: index }] : []))] };
  }
  const missingAcceptance = agreed.shares.flatMap((_, index) => (accepted.has(index) ? [] : [index]));
  if (missingAcceptance.length) {
    return { ...base, status: 'unknown', outputs: acknowledged,
      reason: `no in-time signed acceptance of these terms was presented for stage ${missingAcceptance.join(', ')}` };
  }

  // The signed quote is a ceiling: outputs past `maxOutputTokens` are never charged, whoever acknowledged them.
  const chargeable = Math.min(acknowledged, agreed.maxOutputTokens);
  // The final stage signed its last output (`done`). Then the answer finished whatever the requester acknowledged,
  // and the outputs it acknowledged in time are owed: withholding the last acknowledgments never makes it free.
  const finished = Boolean(delivered?.done);
  const fullyAcknowledged = finished && delivered.count === acknowledged;
  // An unfinished answer under provider-loss-free terms is owed only when the requester ended it: by its own signed
  // stop, or by withholding acknowledgments until a stage refused to go on (more than K outputs unacknowledged, K
  // being the terms' signed `maxUnacknowledgedOutputs`). A stage that closes early on its own, even with a polite
  // `failed` receipt, earns nothing and costs the requester nothing.
  const stops = distinct(group.stops).filter(row => matches(row) && row.requesterId === agreed.requesterId);
  stops.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'stop', acknowledged: row.acknowledged }));
  const stoppedByRequester = stops.some(row => inTime(row.signedAt));
  const withheld = Boolean(delivered) && delivered.count - acknowledged > agreed.maxUnacknowledgedOutputs;
  const providerEnded = !finished && agreed.unfinishedTerms === UNFINISHED_ANSWER_TERMS && !stoppedByRequester && !withheld;
  const units = providerEnded ? 0 : chargeable * agreed.creditsPerOutputToken;
  const request = { providers: agreed.shares.map(row => ({ participantId: row.participantId, weight: row.weight })), computerId: computerOf(agreed.requesterId) };
  const split = creditSettlementDeltas(request, units, computerOf);
  const reason = closedAtLastStep.length ? `the answer was completed and acknowledged; stage ${closedAtLastStep.join(', ')} signed no closing `
    + 'receipt and is treated as closed at its last signed step'
    : fullyAcknowledged ? 'the answer was completed and acknowledged'
    : finished ? 'the answer was completed; the outputs the requester acknowledged in time are charged'
      : providerEnded ? 'a stage ended the answer before it finished; under these terms nobody is charged or paid'
        : stoppedByRequester ? 'the requester signed a stop; the outputs it acknowledged are charged'
          : 'the requester stopped acknowledging; the outputs it acknowledged are charged';
  return { ...base, status: 'settled', debit: split.charge, credits: split.credits.map(row => ({ participantId: row.participantId, amount: row.amount })),
    outputs: acknowledged, chargedOutputs: providerEnded ? 0 : chargeable, unacknowledgedOutputs: delivered ? delivered.count - acknowledged : null,
    ...(acknowledged > agreed.maxOutputTokens ? { beyondCeiling: acknowledged - agreed.maxOutputTokens } : {}),
    ...(closedAtLastStep.length ? { closedAtLastStep } : {}), reason };
}

/**
 * Replays settlement from signed records alone.
 * `policies`: the public policy objects any terms may name. `at`: the verifier's time in ms (decides only whether an
 * unfinished attempt is still `open`). `accountOf`: optional participant-to-account map (the enrolled owner, as the
 * ledger keeps balances): work a requester's own account did stays uncharged, and `balances` sums per account.
 * `computerOf` is the earlier map: it leaves the own-unit work uncharged but keeps `balances` per participant ID. By
 * default every participant ID is its own account.
 */
export async function replaySettlement({ records, policies, at, computerOf = id => id, accountOf = null }) {
  if (!Array.isArray(policies) || policies.length === 0) throw Error('At least one public policy is required');
  if (!Number.isFinite(at)) throw Error('A verification time is required');
  const byDigest = new Map();
  for (const policy of policies) byDigest.set(await policyDigest(policy), policy);
  const { byReservation, rejected } = await classify(records);
  const reservations = [];
  for (const [reservationId, group] of [...byReservation.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const [requesterId, attempt] of byRequester(group)) {
      reservations.push(await replayOne(reservationId, requesterId, attempt, { policies: byDigest, at, computerOf: accountOf ?? computerOf }));
    }
  }
  const balances = new Map();
  const add = (participantId, amount) => { const id = accountOf ? accountOf(participantId) : participantId; balances.set(id, (balances.get(id) ?? 0) + amount); };
  for (const row of reservations.filter(item => item.status === 'settled' || item.status === 'expired')) {
    add(row.requesterId, -row.debit);
    for (const credit of row.credits) add(credit.participantId, credit.amount);
  }
  const counts = {};
  for (const row of reservations) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { schema: SETTLEMENT_REPLAY_SCHEMA, at: new Date(at).toISOString(), counts, reservations, rejected,
    balances: Object.fromEntries([...balances.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export { signedBody };
