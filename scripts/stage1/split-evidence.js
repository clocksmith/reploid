/** Evidence both Stage 1 adapters gather the same way: the ledger's record, the token check and the gated cancel. */
import { verifyStageTokenWitnesses } from '../../server/fleet/stage-token-witness.js';
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
  return { reservationId, state: row?.state ?? 'missing', charge: row?.outcome?.charge ?? null, outputTokens: row?.outcome?.outputTokens ?? null,
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
