/**
 * Evidence both Stage 1 adapters gather the same way: the ledger's record, the token check, the gated cancel, the
 * forced provider drop, and the settlement replay over the participants' own signed records.
 */
import { verifyStageTokenWitnesses } from '../../server/fleet/stage-token-witness.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { policyDigest } from '../../server/fleet/settlement-terms.js';
import { witnessDigest } from './expectations.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function until(check, { timeoutMs, label, signal, pollMs = 50 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${label}`);
    await delay(pollMs);
  }
}

/** The ledger's own record of one reservation, including what presenting its evidence a second time changes. */
export async function ledgerTrace(credits, reservationId) {
  const row = credits.request(reservationId), before = credits.snapshot();
  const entries = before.journal.filter(entry => entry.request_id === reservationId);
  let replay = { attempted: false };
  if (row?.state === 'settled' && row.evidence) {
    const outcome = await credits.settle(reservationId, row.evidence), after = credits.snapshot();
    replay = { attempted: true, journalBefore: before.journal.length, journalAfter: after.journal.length,
      balancesUnchanged: JSON.stringify(after.accounts) === JSON.stringify(before.accounts),
      outcomeUnchanged: JSON.stringify(outcome) === JSON.stringify(row.outcome) };
  }
  return { reservationId, state: row?.state ?? 'missing', status: row?.outcome?.status ?? null, charge: row?.outcome?.charge ?? null, outputTokens: row?.outcome?.outputTokens ?? null,
    credits: (row?.outcome?.credits ?? []).map(credit => ({ computerId: credit.computerId, amount: credit.amount })),
    journal: entries.map(entry => ({ accountId: entry.account_id, delta: entry.delta })),
    heldAfter: before.accounts.reduce((sum, account) => sum + account.held, 0), replay };
}

/** Read from the ledger file itself: a reservation that never settled has no journal entry to find it by. */
export async function openReservationCount(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(file, { readOnly: true });
  try { return database.prepare("SELECT COUNT(*) AS count FROM fleet_requests WHERE state IN ('reserved','dispatched','closing')").get().count; }
  finally { database.close(); }
}

/** How many reservations the ledger holds for one conversation thread: a resend would make a second. */
export async function reservationsOnThread(file, threadId) {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(file, { readOnly: true });
  try { return database.prepare("SELECT COUNT(*) AS count FROM fleet_requests WHERE json_extract(binding,'$.route.threadId')=?").get(threadId).count; }
  finally { database.close(); }
}

/** Cleartext IDs from the final stage must hash to what the production witness recorded, and that witness must verify. */
export function verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId, threadId, requesterId }) {
  if (witnessDigest(tokenIds) !== output.sampleDigest || tokenIds.length !== output.sampleCount) {
    throw Object.assign(Error('token-witness-disagrees: the final stage trace differs from its production witness'), { code: 'token-witness-disagrees' });
  }
  const parity = verifyStageTokenWitnesses({ fixtureBytes, httpAttemptId: answer.attemptId, input, output,
    response: { status: 'completed', output: [{ content: [{ text: answer.text }] }],
      reploid: { attemptId: answer.attemptId, threadId, poolId: roomId, executionClass: 'private-pool',
        modelIdentity: answer.route.modelIdentity, planIdentity: answer.route.planId, adapterIdentities: [],
        recipients: [...answer.route.stages, requesterId], execution: answer.execution } } });
  return { parityExact: parity.exact === true,
    tokens: { outputIds: tokenIds, promptDigest: output.promptDigest, tokenizerDigest: input.tokenizerDigest,
      sampleCount: output.sampleCount, sampleDigest: output.sampleDigest, stopReason: output.stopReason } };
}

/**
 * Holds the final stage before its last token, stops the answer once the requester has seen output, and returns the
 * stopped attempt. Works for any reference of at least two tokens because the gate, not timing, keeps it unfinished.
 */
export async function runGatedCancel({ requester, finalStage, messages, threadId, outputCount, signal, timeoutMs = 60000 }) {
  await finalStage.call('arm-gate', { threadId, step: outputCount - 1 });
  let finished = false;
  const answering = requester.call('generate', { messages, threadId }).finally(() => { finished = true; });
  answering.catch(() => {});
  try {
    await until(async () => {
      if (finished) throw Error('cancel-gate-missed: the answer ended before the gate held it');
      const [gate, progress] = await Promise.all([finalStage.call('gate-state', { threadId }), requester.call('progress')]);
      return gate.entered && progress.deltas >= 1;
    }, { timeoutMs, label: 'the answer to reach the cancel gate', signal });
  } catch (error) {
    await requester.call('cancel').catch(() => {});
    await answering.catch(() => {});
    throw error;
  }
  await requester.call('cancel');
  return answering;
}

/**
 * Holds the first stage at the middle step of the answer (never step 0) and, once the requester has received at least one output, hands
 * the attempt to `beforeKill` (which collects what that stage can still sign) and then `kill`s the stage's process hard.
 * The requester is asked for nothing else. Its answer is not awaited: with its coordinating stage gone, the requester
 * keeps waiting on its own bounded channel timeout, so `answering` is returned for the caller to observe.
 */
export async function runGatedDrop({ requester, killedStage, messages, threadId, outputCount, signal, beforeKill, kill, timeoutMs = 60000 }) {
  await killedStage.call('arm-gate', { threadId, step: Math.max(1, Math.floor(outputCount / 2)) });
  const answering = { finished: false, result: null, error: null };
  answering.promise = requester.call('generate', { messages, threadId, keepPartial: true })
    .then(result => { answering.result = result; }, error => { answering.error = String(error?.message ?? error); })
    .finally(() => { answering.finished = true; });
  let progress = null;
  try {
    await until(async () => {
      if (answering.finished) throw Error('drop-gate-missed: the answer ended before the gate held it');
      const [gate, seen] = await Promise.all([killedStage.call('gate-state', { threadId }), requester.call('progress')]);
      progress = seen;
      return gate.entered && seen.deltas >= 1 && seen.attemptId;
    }, { timeoutMs, label: 'the answer to reach the drop gate', signal });
  } catch (error) {
    await requester.call('cancel').catch(() => {});
    await answering.promise;
    throw error;
  }
  const collected = await beforeKill(progress.attemptId);
  const killed = await kill();
  return { attemptId: progress.attemptId, outputsBeforeKill: progress.deltas, collected, killed, answering };
}

/** The drop's receipt record: what the requester kept, what was (not) resent, and what the ledger and the replay say. */
export function dropRecord({ drop, own, settlementReplay, accountBefore, accountAfter, settlement, ledgerReservations }) {
  const { answering } = drop;
  return { attemptId: drop.attemptId, killed: drop.killed, outputsBeforeKill: drop.outputsBeforeKill,
    outputsReceived: own.received?.deltas ?? null, partialText: own.received?.text ?? null,
    // The requester's own call may still be waiting on its channel timeout; `requesterOutcome` says where it stood.
    completed: answering.result?.completed === true || own.outcome === 'completed' ? true : false,
    requesterOutcome: own.outcome, requesterReturned: answering.finished,
    resend: { requesterApprovals: own.approvals ?? null, requesterAttemptsOnThread: own.attemptsOnThread ?? null, ledgerReservations },
    settlement, accountBefore, accountAfter, settlementReplay };
}

const bundleRecords = bundle => (bundle ? [...(bundle.receipts ?? []),
  ...(bundle.acknowledged ? [bundle.acknowledged.acknowledgment, bundle.acknowledged.receipt] : [])] : []);

/** Each stage's signed acceptance of these terms, from its own process. A refusal is kept as a problem, not thrown. */
export async function collectAcceptances(stages, terms) {
  return Promise.all(stages.map(stage => (terms ? stage.call('accept-terms', { terms }).catch(error => ({ error: String(error?.message ?? error) })) : null)));
}

/**
 * Replays one attempt from the union of its participants' own signed records: the requester's terms, stop and
 * acknowledgments, each stage's acceptance, closing tally evidence and step checkpoints. Nothing comes from the
 * ledger except the public policy, whose digest the terms must name. `prefetched` carries what a stage handed over
 * before its process was killed; `acceptancesSigned` says when the stages signed.
 */
export async function collectSettlementReplay({ requester, stages, attemptId, policy, computerOf, at = Date.now,
  prefetched = {}, acceptancesSigned = 'after-attempt' }) {
  const own = await requester.call('settlement-records', { attemptId });
  const acceptances = prefetched.acceptances ?? await collectAcceptances(stages, own.terms);
  // A live stage hands its closing evidence to the ledger and to this record in the same step; give it a moment to land.
  const closed = row => Boolean(row?.closing?.receipts?.[0]?.timing?.closedAt);
  const stageRecords = await Promise.all(stages.map(async (stage, index) => {
    if (prefetched.stageRecords?.[index]) return prefetched.stageRecords[index];
    let latest = null;
    await until(async () => {
      try { latest = await stage.call('settlement-records', { attemptId }); return closed(latest); }
      catch (error) { latest = { error: String(error?.message ?? error) }; return true; }
    }, { timeoutMs: 10000, label: 'closing evidence', pollMs: 100 }).catch(() => {});
    return latest;
  }));
  const problems = [own.termsError && `terms: ${own.termsError}`, own.stopError && `stop: ${own.stopError}`,
    ...acceptances.map((row, index) => row?.error && `acceptance ${index}: ${row.error}`),
    ...stageRecords.map((row, index) => row?.error && `stage ${index} records: ${row.error}`)].filter(Boolean);
  const records = [...(own.terms ? [own.terms] : []), ...acceptances.filter(row => row && !row.error), ...(own.stop ? [own.stop] : []),
    ...bundleRecords(own.acknowledgments),
    ...stageRecords.flatMap(row => (row?.error ? [] : [...bundleRecords(row?.closing), ...(row?.checkpoints ?? [])]))];
  const result = await replaySettlement({ records, policies: [policy], at: at(), computerOf });
  return { termsCollectedBy: 'stage1-harness', termsSigned: own.termsSigned ?? null, acceptancesSigned,
    ledgerPolicyDigest: await policyDigest(policy), termsPolicyDigest: own.terms?.policyDigest ?? null,
    stopSigned: Boolean(own.stop), requesterAttempts: { approvals: own.approvals ?? null, onThread: own.attemptsOnThread ?? null },
    problems, recordCount: records.length, records, result };
}
