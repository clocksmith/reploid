/**
 * Independent settlement replay for split attempts.
 *
 * Input: the public credit policies, and whatever signed records the participants hand over (requester terms, stage
 * acceptances, stage receipts, requester output acknowledgments). No operator journal, balance or enrollment table is
 * read. Each attempt comes out as exactly one of:
 *
 *   settled   every stage closed (a closing receipt signed by deadline + release window + clock allowance), or a
 *             delivered answer's unclosed stages are treated as closed at their last step; the requester is debited for the outputs it
 *             acknowledged in time, and each stage is credited its signed share of that debit (credit-shares.js, the
 *             ledger's own arithmetic)
 *   expired   the release window passed without every stage closing and without a delivered answer, including an
 *             attempt that never started; nobody is charged or paid (a stage's missing close is a verified provider
 *             failure)
 *   open      not every stage has closed and the release window has not passed (at <= deadline + releaseWindowMs +
 *             maxClockSkewMs); the outcome is not final yet
 *   conflict  some participant signed two incompatible statements; the conflicting records are listed
 *   unknown   the records presented cannot decide the outcome (for example a delivered answer with no receipt from
 *             one stage covering it); nothing is inferred
 *   invalid   the terms do not match a supplied public policy (or none was supplied)
 *
 * What this establishes: who signed what, and the amounts those signatures imply under the named policy. It does not
 * establish that any computation was correct, and it cannot see records a participant withholds; a withheld record
 * can only turn an outcome into `unknown`, `expired` or a smaller acknowledged count, never a larger charge.
 */
import { canonicalPartitionJson } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import {
  MAX_UNACKNOWLEDGED_OUTPUTS, OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, outputChainGenesis, verifyOutputAcknowledgment, verifyStageReceipt
} from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V2, UNFINISHED_ANSWER_TERMS_V3, creditSettlementDeltas } from './credit-shares.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_FAULT_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA, policyDigest, termsDigest,
  verifySettlementAcceptance, verifySettlementFault, verifySettlementStop, verifySettlementTerms
} from './settlement-terms.js';

export const SETTLEMENT_REPLAY_SCHEMA = 'reploid.settlement-replay/v2';
const ms = value => Date.parse(value);
const signedBody = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };

async function classify(records) {
  const byReservation = new Map(), rejected = [];
  const slot = id => {
    if (!byReservation.has(id)) byReservation.set(id, { terms: [], acceptances: [], receipts: [], acknowledgments: [], stops: [], faults: [] });
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
    else if (schema === SETTLEMENT_FAULT_SCHEMA) { checked = await verifySettlementFault(record); kind = 'faults'; }
    if (!checked?.ok) { rejected.push({ index, schema: typeof schema === 'string' ? schema : null, problem: checked?.problem ?? 'unknown_record' }); continue; }
    slot(checked.body.reservationId)[kind].push(checked.body);
  }
  return { byReservation, rejected };
}

/**
 * Splits one reservation's records by requester. Terms, acknowledgments and stops name their requester; each
 * requester's own records form its own attempt, so a stranger signing under a known reservation ID can only make an
 * attempt that charges the stranger. Acceptances, stage receipts and stage faults name no requester and are offered to
 * every attempt; each attempt keeps only those that match its own terms.
 */
function byRequester(group) {
  const ids = [...new Set([...group.terms, ...group.acknowledgments, ...group.stops].map(row => row.requesterId))].sort();
  if (ids.length === 0) return [[null, group]];
  // (An attempt with no requester-named record has no terms and is `unknown` before any fault is read.)
  const own = (rows, id) => rows.filter(row => row.requesterId === id);
  return ids.map(id => [id, { terms: own(group.terms, id), acknowledgments: own(group.acknowledgments, id), stops: own(group.stops, id),
    acceptances: group.acceptances, receipts: group.receipts, faults: group.faults }]);
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
 * Terms with no receipt and no acknowledgment of their attemptId sit on no other route either, so they count: an
 * attempt that never started is `open` and then `expired`, never undecidable. Terms signed outside their own window
 * are listed as `late` and ignored. When the requester signed more than one
 * set, the set every stage's acceptance names is the agreed one and the equivocation is recorded for reputation;
 * only acceptances split across sets make a conflict.
 */
async function agreedTerms(group, base, policies) {
  const receipts = distinct(group.receipts), acknowledgments = distinct(group.acknowledgments), acceptances = distinct(group.acceptances);
  const onRoute = row => {
    const own = receipts.filter(item => item.attemptId === row.attemptId && row.shares[item.partitionIndex]?.participantId === item.participantId);
    const acked = acknowledgments.filter(item => item.attemptId === row.attemptId);
    return (own.length === 0 || own.some(item => item.routeHash === row.routeHash))
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

const closingReceipt = row => row.status !== 'executing' && row.timing.closedAt !== null;

/**
 * One stage's contradictory receipts (docs/settlement-replay.md, "Conflict entries"), over its kept receipts sorted by
 * sequence, late ones included. Each distinct pair `[earlier, later]` of sequences is listed once, in order of first
 * finding: `[s, s]` when two different receipts carry sequence `s`; `[h, s]` when a receipt at `s` has fewer steps
 * than one at a lower sequence, `h` being the lowest sequence with the most steps below `s`; `[c, s]` for each
 * receipt after the stage's first closing receipt, at sequence `c`.
 */
function receiptConflicts(rows) {
  const pairs = new Map(), add = (earlier, later) => pairs.set(`${earlier},${later}`, [earlier, later]);
  let highest = null, closing = null;
  for (let start = 0; start < rows.length;) {
    let end = start;
    while (end < rows.length && rows[end].sequence === rows[start].sequence) end += 1;
    const group = rows.slice(start, end), { sequence } = group[0];
    if (group.length > 1) add(sequence, sequence);
    if (highest && group.some(row => row.steps < highest.steps)) add(highest.sequence, sequence);
    if (closing) add(closing.sequence, sequence);
    for (const row of group) {
      if (!highest || row.steps > highest.steps) highest = row;
      if (!closing && closingReceipt(row)) closing = row;
    }
    start = end;
  }
  return [...pairs.values()];
}

/**
 * The signed account step 8 gave each participant of a settled row with signed accounts, for `balances`. A row's
 * `accounts` lists `null` for a stage that named two accounts; under the failed-stage terms such a stage on the
 * requester's own account is still summed under `debitAccount`, as step 8 says. Kept beside the row, not in it.
 */
const postedAccounts = new WeakMap();

async function replayOne(reservationId, requesterId, group, { policies, at, computerOf, enrolled = null, maxUnacknowledgedOutputs }) {
  // Every row has exactly these members (docs/settlement-replay.md, "Rows").
  const base = { reservationId, attemptId: null, requesterId, status: null, reason: null, debit: null, credits: null, outputs: null,
    chargedOutputs: null, unacknowledgedOutputs: null, beyondCeiling: null, closedAtLastStep: [], conflicts: [], late: [], foreign: [], unmatched: [] };
  const chosen = await agreedTerms(group, base, policies);
  if (chosen.stop) return { ...base, ...chosen.stop, conflicts: [...base.conflicts, ...(chosen.stop.conflicts ?? [])] };
  const { agreed, digest } = chosen;
  base.attemptId = agreed.attemptId;
  base.requesterId = agreed.requesterId;
  const policy = policies.get(agreed.policyDigest);
  if (!policy) return { ...base, status: 'invalid', reason: 'the terms name a policy that was not supplied' };
  // The release window must outlast the clock allowance, or a record signed in time could arrive after the window.
  if (!(policy.partitionUnclaimedReleaseMs > policy.maxClockSkewMs)) {
    return { ...base, status: 'invalid', reason: 'the named policy\'s release window is not longer than its clock allowance' };
  }
  // K: the public policy's `maxUnacknowledgedOutputs` when it names one (it is in the policy digest the terms sign),
  // otherwise the stages' receiver policy's value.
  const published = Number.isSafeInteger(policy.maxUnacknowledgedOutputs);
  const bound = published ? policy.maxUnacknowledgedOutputs : maxUnacknowledgedOutputs;
  // Terms signed before terms carried K have no such member (settlement-terms.js): K is then the receiver policy's
  // value, and a policy that publishes K was never theirs.
  // Whole-model terms that say so sign the whole-model window; every other terms, historical whole-model ones included,
  // sign the split window (docs/settlement-replay.md, "Release window").
  const wholeModel = agreed.mode === 'whole-model';
  const releaseWindow = wholeModel ? policy.wholeModelUnclaimedReleaseMs : policy.partitionUnclaimedReleaseMs;
  const boundAgrees = Object.hasOwn(agreed, 'maxUnacknowledgedOutputs') ? agreed.maxUnacknowledgedOutputs === bound : !published;
  if (agreed.unit !== policy.unit || agreed.creditsPerOutputToken !== policy.creditsPerOutputToken
    || agreed.maxOutputTokens > policy.maxOutputTokens || agreed.releaseWindowMs !== releaseWindow
    || ms(agreed.deadline) - ms(agreed.notBefore) > policy.maxRequestMs || !boundAgrees) {
    return { ...base, status: 'invalid', reason: 'the terms differ from the named policy' };
  }
  const skew = policy.maxClockSkewMs, closesAt = ms(agreed.deadline) + agreed.releaseWindowMs;
  const inTime = within(agreed, skew);
  // The release window has passed once no closing receipt signed in time can still arrive: after its last instant,
  // deadline + releaseWindowMs + maxClockSkewMs. Until then an attempt with an unclosed stage stays `open`.
  // Whole-model terms that say so follow the ledger's whole-model release: the hold is released at deadline +
  // releaseWindowMs, with no clock allowance after it.
  const windowOpen = wholeModel ? at < closesAt : at <= closesAt + skew;
  // A closing receipt counts when signed by deadline + release window + clock allowance, even after the deadline: a stage that closes
  // honestly late is then paid what one that backdates its close would be. The charge stays capped by the requester's
  // in-time acknowledgments. Both ends carry the clock allowance, as `inTime`'s do. Whole-model terms that say so end
  // where their window passes, before deadline + releaseWindowMs: the ledger has released the hold by then, so a close
  // signed later could only turn the expiry it posted into a settlement (docs/settlement-replay.md, "Release window").
  const closesInTime = value => ms(value) >= ms(agreed.notBefore) - skew && (wholeModel ? ms(value) < closesAt : ms(value) <= closesAt + skew);
  const counted = row => (closingReceipt(row) ? closesInTime(row.signedAt) : inTime(row.signedAt));
  const stages = agreed.shares.length, finalIndex = stages - 1;
  const matches = row => row.attemptId === agreed.attemptId;
  // Notes such as a requester's settled equivocation stay listed; only conflicts found from here on block settlement.
  const noted = base.conflicts.length;

  // Acceptances: each stage, its own share, these exact terms, signed in time.
  // Signed accounts (step 8): terms that name the requester's account count only acceptances that name the stage's.
  const signedAccounts = Object.hasOwn(agreed, 'debitAccount');
  const accepted = new Set(), payout = Array.from({ length: stages }, () => new Set());
  for (const row of distinct(group.acceptances).filter(matches)) {
    if (row.termsDigest !== digest || agreed.shares[row.partitionIndex]?.participantId !== row.participantId) continue;
    if (signedAccounts && !Object.hasOwn(row, 'payoutAccount')) continue;
    if (inTime(row.signedAt)) { accepted.add(row.partitionIndex); if (signedAccounts) payout[row.partitionIndex].add(row.payoutAccount); }
    else base.late.push({ kind: 'acceptance', partitionIndex: row.partitionIndex });
  }
  if (signedAccounts) base.accounts = { requester: agreed.debitAccount, stages: payout.map(named => (named.size === 1 ? [...named][0] : null)) };

  // Failed-stage terms (step 6 on). Under them nothing a stage on the requester's own account signs or withholds
  // can reduce what the other stages are paid. A stage is the requester's own when the requester's key runs it; with
  // signed accounts, when a counting acceptance of its participant names the requester's account; without them, when
  // the caller's grouping places both under one account.
  const forfeitRules = agreed.unfinishedTerms === UNFINISHED_ANSWER_TERMS_V3;
  const ownStage = index => {
    const id = agreed.shares[index].participantId;
    if (id === agreed.requesterId) return true;
    return signedAccounts ? agreed.shares.some((share, at) => share.participantId === id && payout[at].has(agreed.debitAccount))
      : computerOf(id) === computerOf(agreed.requesterId);
  };
  const ownFinal = forfeitRules && ownStage(finalIndex);

  // Stage receipts: one tally per stage, cumulative by sequence. Two different bodies at one sequence, or steps that
  // go backwards, are the stage contradicting itself.
  const perStage = Array.from({ length: stages }, () => []);
  for (const row of distinct(group.receipts).filter(matches)) {
    if (row.routeHash !== agreed.routeHash || agreed.shares[row.partitionIndex]?.participantId !== row.participantId) continue;
    perStage[row.partitionIndex].push(row);
  }
  const latest = [], contradicted = new Set();
  for (const [index, rows] of perStage.entries()) {
    rows.sort((a, b) => a.sequence - b.sequence);
    // Under the failed-stage terms the requester's own stage cannot block settlement by contradicting itself: its
    // entries are listed, it is failed (step 6) and it has no latest receipt (as the final stage, its last receipt
    // still shows how the answer ended, below).
    const own = forfeitRules && ownStage(index), pairs = receiptConflicts(rows);
    for (const sequences of pairs) {
      base.conflicts.push({ signer: agreed.shares[index].participantId, kind: 'stage-receipt', blocking: !own, partitionIndex: index, sequences });
    }
    rows.filter(row => !counted(row)).forEach(row => base.late.push({ kind: 'stage-receipt', partitionIndex: index, sequence: row.sequence }));
    if (own && pairs.length) contradicted.add(index);
    latest[index] = contradicted.has(index) ? null : rows.filter(counted).at(-1) ?? null;
  }
  // Failed stages (step 6): under the terms that name them, a stage's own signed fault counts when signed by the
  // closing bound, as a closing receipt does. Under any other terms a fault is dropped without being listed.
  const faulted = new Set();
  if (forfeitRules) {
    base.forfeited = [];
    for (const row of distinct(group.faults ?? []).filter(matches)) {
      if (row.routeHash !== agreed.routeHash || agreed.shares[row.partitionIndex]?.participantId !== row.participantId) continue;
      if (closesInTime(row.signedAt)) faulted.add(row.partitionIndex);
      else if (!base.late.some(item => item.kind === 'fault' && item.partitionIndex === row.partitionIndex)) base.late.push({ kind: 'fault', partitionIndex: row.partitionIndex });
    }
    // A stage that signed both a fault and a closing receipt contradicted itself. It is listed and forfeits (step 6);
    // nobody else's payment depends on it, so the entry does not block.
    for (const index of [...faulted].sort((a, b) => a - b)) {
      if (latest[index] && closingReceipt(latest[index])) {
        base.conflicts.push({ signer: agreed.shares[index].participantId, kind: 'fault-and-close', blocking: false, partitionIndex: index });
      }
    }
  }

  // Requester acknowledgments, checked against the final stage's committed chain at each count (at count 0, the
  // starting value anyone can compute). A count is charged only when an in-time acknowledgment of it carries that
  // chain. Any further chain the requester signed for that count is its own contradiction: it is listed, and it never
  // lowers what the requester owes. A late acknowledgment is listed and never charged, but it is still the requester's
  // signed statement, so it counts as evidence in every contradiction test, as late receipts do.
  const acknowledgments = distinct(group.acknowledgments).filter(row => matches(row) && row.routeHash === agreed.routeHash
    && row.requesterId === agreed.requesterId);
  acknowledgments.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'acknowledgment', count: row.count }));
  // The requester's stops. A late one is listed and ignored, whatever the outcome.
  const stops = distinct(group.stops).filter(row => matches(row) && row.requesterId === agreed.requesterId);
  stops.filter(row => !inTime(row.signedAt)).forEach(row => base.late.push({ kind: 'stop', acknowledged: row.acknowledged }));
  const finalParticipant = agreed.shares[finalIndex].participantId;
  const committed = new Map([[0, await outputChainGenesis({ reservationId, routeHash: agreed.routeHash })]]);
  for (const row of perStage[finalIndex] ?? []) {
    if (!row.output) continue;
    const held = committed.get(row.output.count);
    if (held === undefined) committed.set(row.output.count, row.output.chain);
    else if (held !== row.output.chain && !base.conflicts.some(item => item.kind === 'output-chain' && item.count === row.output.count)) {
      // The final stage's own two chains for one count (or a starting value other than the computable one).
      base.conflicts.push({ signer: row.participantId, kind: 'output-chain', blocking: !ownFinal, count: row.output.count });
    }
  }
  // Every chain the requester signed for each count, in time or late, and the counts it acknowledged in time.
  const chainsAt = new Map(), timelyAt = new Map();
  for (const row of acknowledgments) {
    chainsAt.set(row.count, new Set([...(chainsAt.get(row.count) ?? []), row.chain]));
    if (inTime(row.signedAt)) timelyAt.set(row.count, new Set([...(timelyAt.get(row.count) ?? []), row.chain]));
  }
  const matchedCounts = [];
  for (const [count, chains] of [...chainsAt.entries()].sort(([a], [b]) => a - b)) {
    const stageChain = committed.get(count), others = [...chains].filter(chain => chain !== stageChain).sort();
    // When the final stage is the requester's own (failed-stage terms), the requester signed both sides: every count
    // it acknowledged in time is matched, whatever chain it carries and whether or not a receipt commits one.
    const matched = ownFinal ? timelyAt.has(count) : stageChain !== undefined && Boolean(timelyAt.get(count)?.has(stageChain));
    if (stageChain !== undefined && chains.has(stageChain)) {
      // The requester signed the final stage's chain for this count; charged only when that acknowledgment is in time.
      if (matched) matchedCounts.push(count);
      if (others.length) {
        base.conflicts.push({ signer: agreed.requesterId, kind: 'acknowledgment-equivocation', count, blocking: false,
          ...(matched ? { settledOn: stageChain } : {}), chains: others });
      }
    } else if (stageChain === undefined) {
      // No presented final-stage receipt commits to this count: an in-time acknowledgment is listed and not charged.
      if (matched) matchedCounts.push(count);
      else if (timelyAt.has(count)) base.unmatched.push({ kind: 'acknowledgment', count });
      if (others.length > 1) base.conflicts.push({ signer: agreed.requesterId, kind: 'acknowledgment-equivocation', count, blocking: false, chains: others });
    } else if (count === 0) {
      base.conflicts.push({ signer: agreed.requesterId, kind: 'charge-binding', blocking: !ownFinal, count: 0 });
      if (matched) matchedCounts.push(count);
    } else {
      // Every chain the requester signed for this count differs from the final stage's: one of the two signed something
      // false, and the records cannot show which. Under the failed-stage terms that does not block: the count is not
      // matched, so the requester owes the counts whose chains agree, as if it had withheld this acknowledgment.
      base.conflicts.push({ signer: null, signers: [finalParticipant, agreed.requesterId], kind: 'output-chain', blocking: !forfeitRules, count });
      if (matched) matchedCounts.push(count);
    }
  }
  if (base.conflicts.slice(noted).some(row => row.blocking !== false)) {
    return { ...base, status: 'conflict', reason: 'a participant signed incompatible statements' };
  }

  const acknowledged = Math.max(0, ...matchedCounts);
  // A requester's own final stage that contradicted itself has no latest receipt, but its contradiction must not cost
  // the outside stages their pay: how the answer ended is still read from its highest-sequence counting receipt, when
  // no other receipt of it has that sequence.
  const ownFinalEnd = () => {
    const last = perStage[finalIndex].filter(counted).at(-1);
    return last && perStage[finalIndex].filter(row => row.sequence === last.sequence).length === 1 ? last.output ?? null : null;
  };
  const final = latest[finalIndex], delivered = contradicted.has(finalIndex) ? ownFinalEnd() : final?.output ?? null;
  const closed = latest.map(row => Boolean(row && closingReceipt(row)));
  const answerDelivered = Boolean(delivered?.done && acknowledged === delivered.count && acknowledged > 0);
  const unclosed = closed.flatMap((ok, index) => (ok ? [] : [index]));
  let closedAtLastStep = [];

  if (forfeitRules) {
    // A stage is decided once it closed, signed a fault, or the release window passed. A stage that signed a fault
    // forfeits whether or not it closed. Past the window an unclosed stage is treated as closed at its last step when
    // the answer was delivered and its in-time receipts cover all of it, and forfeits otherwise. Nobody else's payment
    // waits on it or is lost with it.
    const faults = [...new Set([...faulted, ...contradicted])].sort((a, b) => a - b)
      .map(index => ({ partitionIndex: index, cause: contradicted.has(index) ? 'contradiction' : closed[index] ? 'fault-and-close' : 'fault' }));
    const silent = unclosed.filter(index => !faulted.has(index) && !contradicted.has(index));
    if (silent.length && windowOpen) {
      return { ...base, status: 'open', outputs: acknowledged, forfeited: faults,
        reason: `stage ${silent.join(', ')} has neither closed nor signed a fault and the release window is still open` };
    }
    closedAtLastStep = silent.filter(index => answerDelivered && latest[index] && latest[index].steps >= delivered.count);
    base.closedAtLastStep = closedAtLastStep;
    base.forfeited = [...faults, ...silent.filter(index => !closedAtLastStep.includes(index)).map(index => ({ partitionIndex: index, cause: 'no-close' }))]
      .sort((a, b) => a.partitionIndex - b.partitionIndex);
    if (acknowledged === 0 && unclosed.length) {
      return { ...base, status: 'expired', debit: 0, credits: agreed.shares.map(row => ({ participantId: row.participantId, amount: 0 })),
        outputs: 0, reason: 'nothing was acknowledged and not every stage closed (a failed stage, or an attempt that never started); nobody is charged or paid' };
    }
  } else if (unclosed.length && answerDelivered) {
    // The final stage signed `done` at N and the requester acknowledged N in time. A stage whose in-time step receipts
    // cover all N steps evidently computed the whole answer, so after the release window it is treated as closed at its
    // last signed step and paid its share: one stage withholding its closing receipt cannot veto everyone's payment.
    // A stage with no receipt covering the answer stays undecided.
    const uncovered = unclosed.filter(index => !(latest[index] && latest[index].steps >= delivered.count));
    if (uncovered.length) {
      return { ...base, status: 'unknown', outputs: acknowledged,
        reason: `the answer was delivered and acknowledged, but no in-time receipt covering it was presented for stage ${uncovered.join(', ')}` };
    }
    if (windowOpen) {
      return { ...base, status: 'open', outputs: acknowledged, reason: `the answer was delivered and acknowledged; stage ${unclosed.join(', ')} has not closed `
        + 'and the release window is still open' };
    }
    closedAtLastStep = unclosed;
    // The stages stay listed whatever a later step decides (docs/settlement-replay.md, "Rows").
    base.closedAtLastStep = closedAtLastStep;
  } else if (unclosed.length) {
    if (windowOpen) return { ...base, status: 'open', outputs: acknowledged, reason: 'not every stage has closed and the release window is still open' };
    return { ...base, status: 'expired', debit: 0, credits: agreed.shares.map(row => ({ participantId: row.participantId, amount: 0 })),
      outputs: acknowledged, reason: 'the release window passed without every stage closing (a verified provider failure, or an attempt that never started); nobody is charged or paid' };
  }
  // A forfeited stage is paid nothing whatever its receipts say, so its steps are not tested (and it may have none).
  const forfeits = new Set((base.forfeited ?? []).map(row => row.partitionIndex));
  // Under the failed-stage terms only the stages that are paid are tested: the requester's own stages are never paid.
  const tested = index => !forfeits.has(index) && !(forfeitRules && ownStage(index));
  const short = latest.flatMap((row, index) => (tested(index) && row.steps < acknowledged ? [index] : []));
  // When the final stage is the requester's own, nobody but the requester vouches for the acknowledged count, so a
  // count beyond what the paid stages signed for is no conflict of theirs: the charge stops at the fewest steps any of
  // them signed.
  const stepCap = ownFinal ? Math.min(Infinity, ...agreed.shares.flatMap((_, index) => (tested(index) ? [latest[index].steps] : []))) : Infinity;
  if (short.length && !ownFinal) {
    return { ...base, status: 'conflict', outputs: acknowledged, reason: 'the requester acknowledged outputs a stage says it never computed',
      conflicts: [...base.conflicts, ...short.map(index => ({ signer: latest[index].participantId, kind: 'steps', blocking: true, partitionIndex: index }))] };
  }
  // Signed accounts: each participant has one account, the requester's the terms' `debitAccount` and a stage's the
  // `payoutAccount` it signed. A participant that named two contradicted itself. `computerOf` is then not consulted.
  let accountFor = computerOf;
  if (signedAccounts) {
    // Listed in the order of the participants' first stages; the requester's own key starts from the terms' account.
    const named = new Map();
    agreed.shares.forEach((share, index) => {
      const own = named.get(share.participantId) ?? new Set(share.participantId === agreed.requesterId ? [agreed.debitAccount] : []);
      for (const account of payout[index]) own.add(account);
      named.set(share.participantId, own);
    });
    const named2 = [...named].filter(([, own]) => own.size > 1);
    // Failed-stage terms: a participant on the requester's own account that also named another stays the requester's
    // own. It is listed, it is never paid, and it blocks nobody.
    const ownSplit = forfeitRules ? named2.filter(([signer, own]) => signer === agreed.requesterId || own.has(agreed.debitAccount)) : [];
    for (const [signer, own] of ownSplit) {
      base.conflicts.push({ signer, kind: 'payout-account', blocking: false, accounts: [...own].sort() });
      named.set(signer, new Set([agreed.debitAccount]));
    }
    const split = named2.filter(entry => !ownSplit.includes(entry));
    if (split.length) {
      return { ...base, status: 'conflict', outputs: acknowledged, reason: 'a participant named more than one account',
        conflicts: [...base.conflicts, ...split.map(([signer, own]) => ({ signer, kind: 'payout-account', blocking: true, accounts: [...own].sort() }))] };
    }
    const accountOfParty = id => (id === agreed.requesterId ? agreed.debitAccount : [...(named.get(id) ?? [])][0]);
    // The caller's enrollment, when it supplies one: a key cannot name an account it is not enrolled under.
    if (enrolled) {
      const parties = [agreed.requesterId, ...agreed.shares.map(share => share.participantId)];
      // A participant the enrollment does not place is its own account.
      if (parties.some(id => accountOfParty(id) !== undefined && (enrolled(id) ?? id) !== accountOfParty(id))) {
        return { ...base, status: 'invalid', outputs: acknowledged, reason: 'a participant signed an account it is not enrolled under' };
      }
    }
    accountFor = id => accountOfParty(id) ?? id;
  }
  const missingAcceptance = agreed.shares.flatMap((_, index) => (accepted.has(index) ? [] : [index]));
  if (missingAcceptance.length) {
    return { ...base, status: 'unknown', outputs: acknowledged,
      reason: `no in-time signed acceptance of these terms was presented for stage ${missingAcceptance.join(', ')}` };
  }

  // The signed quote is a ceiling: outputs past `maxOutputTokens` are never charged, whoever acknowledged them.
  const chargeable = Math.min(acknowledged, agreed.maxOutputTokens, stepCap);
  // The final stage signed its last output (`done`). Then the answer finished whatever the requester acknowledged,
  // and the outputs it acknowledged in time are owed: withholding the last acknowledgments never makes it free.
  const finished = Boolean(delivered?.done);
  const fullyAcknowledged = finished && delivered.count === acknowledged;
  // Every stage closed (step 6), so no provider failure is verified: that would be a stage with no closing receipt,
  // which step 6 already made `expired`. A `failed` close names no cause, and a stage signs it too when the
  // requester's abort reaches a step in flight. An unfinished answer with no signed stop and no more than K
  // outputs unacknowledged (K being the terms' signed `maxUnacknowledgedOutputs`) is therefore an unattributed
  // disconnect. Under the decided terms (UNFINISHED_ANSWER_TERMS_V2) it charges the acknowledged prefix. Under the
  // older provider-loss-free terms it is read as ended by a stage and costs nothing.
  const stoppedByRequester = stops.some(row => inTime(row.signedAt));
  const withheld = Boolean(delivered) && delivered.count - acknowledged > bound;
  const disconnected = !finished && !stoppedByRequester && !withheld;
  const providerEnded = disconnected && agreed.unfinishedTerms === UNFINISHED_ANSWER_TERMS;
  const units = providerEnded ? 0 : chargeable * agreed.creditsPerOutputToken;
  const request = { providers: agreed.shares.map(row => ({ participantId: row.participantId, weight: row.weight })), computerId: accountFor(agreed.requesterId) };
  const split = creditSettlementDeltas(request, units, accountFor);
  // One entry per stage in stage order; a stage on the requester's own account is listed with amount 0.
  const paid = split.credits[Symbol.iterator]();
  // A forfeited stage's share is not paid and not charged: the requester's debit falls by exactly that share, and
  // every other stage gets what it would have got had all of them closed.
  let debit = split.charge;
  const credits = agreed.shares.map((row, index) => {
    const amount = accountFor(row.participantId) === request.computerId ? 0 : paid.next().value.amount;
    if (forfeits.has(index)) debit -= amount;
    return { participantId: row.participantId, amount: forfeits.has(index) ? 0 : amount };
  });
  const reason = forfeits.size ? `stage ${[...forfeits].sort((a, b) => a - b).join(', ')} failed (a signed fault, no close in time, or a contradiction by the requester's own stage) and forfeits `
    + 'its share; the stages that closed are paid for the outputs the requester acknowledged'
    : closedAtLastStep.length ? `the answer was completed and acknowledged; stage ${closedAtLastStep.join(', ')} signed no closing `
    + 'receipt and is treated as closed at its last signed step'
    : fullyAcknowledged ? 'the answer was completed and acknowledged'
    : finished ? 'the answer was completed; the outputs the requester acknowledged in time are charged'
      : providerEnded ? 'a stage ended the answer before it finished; under these terms nobody is charged or paid'
        : stoppedByRequester ? 'the requester signed a stop; the outputs it acknowledged are charged'
          : disconnected && agreed.unfinishedTerms === UNFINISHED_ANSWER_TERMS_V2
            ? 'the stages closed an unfinished answer with no signed stop and no verified provider failure; the outputs the requester acknowledged are charged'
            : disconnected && forfeitRules ? 'the stages closed an unfinished answer with no signed stop; the outputs the requester acknowledged are charged'
            : disconnected ? 'the stages closed an unfinished answer; under these terms the outputs the requester acknowledged are charged'
              : 'the requester stopped acknowledging; the outputs it acknowledged are charged';
  const row = { ...base, status: 'settled', debit, credits,
    outputs: acknowledged, chargedOutputs: providerEnded ? 0 : chargeable, unacknowledgedOutputs: delivered ? delivered.count - acknowledged : null,
    beyondCeiling: Math.max(0, acknowledged - agreed.maxOutputTokens), closedAtLastStep, reason };
  if (signedAccounts) postedAccounts.set(row, accountFor);
  return row;
}

/**
 * Replays settlement from signed records alone.
 * `policies`: the public policy objects any terms may name. `at`: the verifier's time in ms (decides only whether an
 * unfinished attempt is still `open`). `accountOf`: optional participant-to-account map (the enrolled owner, as the
 * ledger keeps balances): work a requester's own account did stays uncharged, and `balances` sums per account.
 * `computerOf` is the earlier map: it leaves the own-unit work uncharged but keeps `balances` per participant ID. By
 * default every participant ID is its own account. K is the named policy's `maxUnacknowledgedOutputs`; for a policy
 * that names none, `maxUnacknowledgedOutputs` here (by default the stages' receiver policy's,
 * partition-receiver-policy.json). Terms that sign another K are `invalid`. With no policy supplied, every attempt
 * whose terms are agreed is `invalid`.
 */
export async function replaySettlement({ records, policies = [], at, computerOf = id => id, accountOf = null,
  maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS }) {
  if (!Number.isFinite(at)) throw Error('A verification time is required');
  const byDigest = new Map();
  for (const policy of Array.isArray(policies) ? policies : []) byDigest.set(await policyDigest(policy), policy);
  const { byReservation, rejected } = await classify(records);
  const reservations = [];
  for (const [reservationId, group] of [...byReservation.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const [requesterId, attempt] of byRequester(group)) {
      reservations.push(await replayOne(reservationId, requesterId, attempt, { policies: byDigest, at, computerOf: accountOf ?? computerOf,
        enrolled: accountOf, maxUnacknowledgedOutputs }));
    }
  }
  const balances = new Map();
  const add = (id, amount) => { balances.set(id, (balances.get(id) ?? 0) + amount); };
  for (const row of reservations.filter(item => item.status === 'settled' || item.status === 'expired')) {
    // A row with signed accounts is summed under them (step 8 has refused any the enrollment contradicts).
    const signed = row.accounts ? new Map([...row.credits.map((credit, index) => [credit.participantId, row.accounts.stages[index]]),
      [row.requesterId, row.accounts.requester]]) : null;
    const posted = postedAccounts.get(row);
    const idOf = id => (posted ? posted(id) : signed ? signed.get(id) ?? id : accountOf ? accountOf(id) : id);
    add(idOf(row.requesterId), -row.debit);
    for (const credit of row.credits) add(idOf(credit.participantId), credit.amount);
  }
  const counts = {};
  for (const row of reservations) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return { schema: SETTLEMENT_REPLAY_SCHEMA, at: new Date(at).toISOString(), counts, reservations, rejected,
    balances: Object.fromEntries([...balances.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

export { signedBody };
