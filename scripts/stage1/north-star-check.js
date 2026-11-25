/**
 * The north-star receipt's checks (north-star.js), kept apart from the runner so they can be applied to a written
 * receipt, and tested, without opening a ledger or a host. Each check is named; nothing short-circuits.
 */
import { creditSettlementDeltas } from '../../server/fleet/credit-shares.js';
import { createHash } from 'node:crypto';
import { canonicalPartitionJson } from '../../packages/reploid/src/contracts/partition.js';

/** The production stage token witness's digest (expectations.js `witnessDigest`), without loading the catalog. */
const witnessDigest = value => createHash('sha256').update(canonicalPartitionJson(value)).digest('hex');

/** Per stage: what its resident was handed over the whole answer, from its own visibility rows. */
export function summarizeVisibility(rows) {
  const steps = rows.filter(row => row.op === 'step');
  return { tokenizeCalls: rows.filter(row => row.op === 'tokenize').length, steps: steps.length,
    tokenContext: [...new Set(steps.map(row => row.tokenContext))],
    tokenIdsReceived: steps.reduce((sum, row) => sum + (row.tokenIds?.count ?? 0), 0),
    nonzeroTokenIdsReceived: steps.reduce((sum, row) => sum + (row.tokenIds?.nonzero ?? 0), 0),
    activationBytesIn: steps.reduce((sum, row) => sum + row.activationInBytes, 0),
    activationBytesOut: steps.reduce((sum, row) => sum + row.activationOutBytes, 0),
    tokensOut: steps.filter(row => row.output === 'token').length,
    deltaCharactersOut: steps.reduce((sum, row) => sum + row.deltaCharacters, 0) };
}

/** The checks, each named. `fail` collects; nothing short-circuits so the receipt shows every problem at once. */
export function checkNorthStar(receipt, { reference, weights, creditsPerOutputToken = 1, cases = [] }) {
  const problems = [], fail = (code, detail) => problems.push({ code, detail: String(detail) });
  const earn = receipt.earn, split = receipt.split, privacy = receipt.privacy;
  // 1. Earn by serving someone else.
  if (!earn) fail('earn-missing', 'no earning');
  else {
    if (earn.accountBefore !== 0) fail('earn-seeded-balance', earn.accountBefore);
    let earned = 0;
    for (const [index, trace] of (earn.settlements ?? []).entries()) {
      if (trace.state !== 'settled' || trace.heldAfter !== 0) fail('earn-not-settled', `earn-${index} ${trace.state}`);
      if (trace.journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', `earn-${index}`);
      const credited = trace.journal.filter(row => row.accountId === earn.accountId).reduce((sum, row) => sum + row.delta, 0);
      if (credited !== trace.charge || trace.charge !== trace.outputTokens * creditsPerOutputToken) fail('earn-not-credited', `earn-${index}`);
      if (trace.replay?.attempted !== true || trace.replay.balancesUnchanged !== true) fail('double-settlement', `earn-${index}`);
      earned += credited;
    }
    if (earned <= 0) fail('earn-nothing', earned);
    if (earn.buyerAccountId === earn.accountId) fail('earn-self-served', earn.buyerAccountId);
  }
  // 2. Spend those credits on the split, within the cap.
  const trace = split?.settlement;
  let expected = null;
  if (!trace) fail('split-settlement-missing', 'no ledger trace');
  else {
    if (trace.state !== 'settled' || trace.heldAfter !== 0) fail('stranded-hold', `${trace.state} held ${trace.heldAfter}`);
    if (trace.journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', 'split');
    const debits = trace.journal.filter(row => row.delta < 0);
    if (debits.length !== 1 || debits[0].accountId !== split.account.accountId) fail('double-settlement', JSON.stringify(debits));
    // The ledger's own split: each stage's weighted share of the answer's units, the last stage taking the remainder;
    // stages on the requester's own account are neither charged nor credited (server/fleet/credit-shares.js).
    const stages = receipt.participants?.stages ?? [];
    const computerOf = id => { const stage = stages.find(row => row.participantId === id); return stage?.role === 'operator' ? `computer-${stage.label}` : split.account.accountId; };
    expected = creditSettlementDeltas({ computerId: split.account.accountId, providers: stages.map((stage, index) => ({ participantId: stage.participantId, weight: weights[index] })) },
      trace.outputTokens * creditsPerOutputToken, computerOf);
    if (stages.length !== weights.length || trace.charge !== expected.charge || trace.outputTokens * creditsPerOutputToken > split.cap) {
      fail('settlement-charge', `${trace.charge} for ${trace.outputTokens}, expected ${expected.charge}, cap ${split.cap}`);
    }
    if (!(split.account.before >= trace.charge)) fail('spend-before-earning', `balance ${split.account.before}, charge ${trace.charge}`);
    const net = trace.journal.filter(row => row.accountId === split.account.accountId).reduce((sum, row) => sum + row.delta, 0);
    if (split.account.after !== split.account.before + net) fail('spend-mismatch', `${split.account.before} + ${net} != ${split.account.after}`);
    const paid = Object.fromEntries(expected.credits.filter(row => row.amount !== 0).map(row => [row.computerId, row.amount]));
    const posted = Object.fromEntries(trace.credits.filter(row => row.amount !== 0).map(row => [row.computerId, row.amount]));
    if (JSON.stringify(Object.entries(paid).sort()) !== JSON.stringify(Object.entries(posted).sort())) fail('settlement-shares', `ledger ${JSON.stringify(posted)}, expected ${JSON.stringify(paid)}`);
    if (trace.replay?.attempted !== true || trace.replay.balancesUnchanged !== true || trace.replay.outcomeUnchanged !== true) fail('double-settlement', 'split replay changed the ledger');
  }
  // 3. The independent replay from signed records equals the ledger.
  const replay = split?.settlementReplay, row = replay?.result?.reservations?.find(item => item.reservationId === trace?.reservationId);
  if (!row) fail('replay-reservation-missing', 'split');
  else {
    if (row.status !== 'settled') fail('replay-not-settled', row.status);
    // Compared per participant: the replay lists every stage (own-account stages at 0); the ledger posts only non-zero
    // payouts, by computer. A stage the ledger omits counts as 0; any other difference in debit or amount fails.
    const stages = receipt.participants?.stages ?? [];
    const computerOf = id => { const stage = stages.find(item => item.participantId === id); return stage?.role === 'operator' ? `computer-${stage.label}` : split.account.accountId; };
    const replayed = {}, ledger = {};
    for (const credit of row.credits ?? []) replayed[credit.participantId] = (replayed[credit.participantId] ?? 0) + credit.amount;
    for (const stage of stages) {
      const computer = computerOf(stage.participantId);
      ledger[stage.participantId] = computer === split.account.accountId ? 0 : trace.credits.filter(item => item.computerId === computer).reduce((sum, item) => sum + item.amount, 0);
    }
    const unknown = (row.credits ?? []).filter(credit => !stages.some(stage => stage.participantId === credit.participantId));
    if (row.debit !== trace.charge || unknown.length || stages.some(stage => (replayed[stage.participantId] ?? 0) !== ledger[stage.participantId])) {
      fail('replay-differs-from-ledger', `replay ${row.debit} ${JSON.stringify(replayed)} ledger ${trace.charge} ${JSON.stringify(ledger)}`);
    }
    if (replay.problems?.length) fail('replay-records', replay.problems.join('; '));
    if (!replay.ledgerPolicyDigest || replay.termsPolicyDigest !== replay.ledgerPolicyDigest) fail('replay-policy-mismatch', replay.termsPolicyDigest);
  }
  // 4. The answer matches the frozen single-host reference, token for token.
  if (!split?.tokens || JSON.stringify(split.tokens.outputIds) !== JSON.stringify(reference.outputIds)
    || witnessDigest(split.tokens.outputIds) !== reference.sampleDigest) fail('answer-tokens-differ', 'output tokens differ from the reference');
  if (split?.parityExact !== true) fail('answer-witness', 'the stage witnesses do not verify');
  if (split?.text !== reference.outputText) fail('answer-text-differs', 'answer text differs from the reference text');
  // 5. The privacy tier: named, bound before disclosure, and observed at every stage.
  const evidence = split?.inference?.result?.executionReceipt?.evidence?.confidentiality;
  if (evidence?.mode !== 'requester-edges') fail('tier-not-named', evidence?.mode);
  if (privacy) {
    for (const stage of privacy.stages) {
      const seen = stage.visibility;
      if (stage.role === 'operator') {
        if (seen.nonzeroTokenIdsReceived !== 0 || seen.tokenizeCalls !== 0 || seen.tokensOut !== 0 || seen.deltaCharactersOut !== 0
          || seen.tokenContext.some(value => value !== 'withheld')) fail('operator-saw-content', `${stage.label} ${JSON.stringify(seen)}`);
        if (!(seen.steps > 0 && seen.activationBytesIn > 0)) fail('operator-did-not-run', stage.label);
        if (stage.hostWeights?.servedOutsideStage) fail('stage-weights', stage.label);
      }
    }
    const operatorIds = privacy.stages.filter(stage => stage.role === 'operator').map(stage => stage.participantId);
    if (operatorIds.some(id => privacy.contentRecipients.includes(id))) fail('operator-content-recipient', 'an operator stage is a content recipient');
    if (privacy.bindingHops.some(hop => operatorIds.includes(hop.recipient) && hop.disclosure !== 'activations')) fail('operator-hop', 'an operator hop reads plaintext content');
  } else fail('privacy-trace-missing', 'no visibility trace');
  // 6. A requester-signed Stop partway: the acknowledged prefix, split by the ledger's rule, and the replay agrees.
  const stages = receipt.participants?.stages ?? [];
  const accountOf = (id, requesterAccount) => { const stage = stages.find(item => item.participantId === id); return stage?.role === 'operator' ? `computer-${stage.label}` : requesterAccount; };
  const sameAsLedger = (name, ledgerTrace, row, requesterAccount) => {
    const replayed = {}, ledger = {};
    for (const credit of row.credits ?? []) replayed[credit.participantId] = (replayed[credit.participantId] ?? 0) + credit.amount;
    for (const stage of stages) {
      const computer = accountOf(stage.participantId, requesterAccount);
      ledger[stage.participantId] = computer === requesterAccount ? 0 : (ledgerTrace.credits ?? []).filter(item => item.computerId === computer).reduce((sum, item) => sum + item.amount, 0);
    }
    const unknown = (row.credits ?? []).filter(credit => !stages.some(stage => stage.participantId === credit.participantId));
    if ((row.debit ?? 0) !== ledgerTrace.charge || unknown.length || stages.some(stage => (replayed[stage.participantId] ?? 0) !== ledger[stage.participantId])) {
      fail('replay-differs-from-ledger', `${name}: replay ${row.debit} ${JSON.stringify(replayed)} ledger ${ledgerTrace.charge} ${JSON.stringify(ledger)}`);
    }
  };
  const operatorsBlind = (name, visibility) => {
    for (const stage of stages.filter(item => item.role === 'operator')) {
      const seen = visibility?.[stage.label];
      if (!seen) { fail('privacy-trace-missing', `${name}: ${stage.label}`); continue; }
      if (seen.nonzeroTokenIdsReceived !== 0 || seen.tokenizeCalls !== 0 || seen.tokensOut !== 0 || seen.deltaCharactersOut !== 0
        || seen.tokenContext.some(value => value !== 'withheld')) fail('operator-saw-content', `${name}: ${stage.label} ${JSON.stringify(seen)}`);
    }
  };
  if (cases.includes('stop')) {
    const stop = receipt.cancel, ledgerTrace = stop?.settlement;
    if (!ledgerTrace) fail('stop-missing', 'no stop case');
    else {
      if (ledgerTrace.state !== 'settled' || ledgerTrace.heldAfter !== 0) fail('stranded-hold', `stop ${ledgerTrace.state} held ${ledgerTrace.heldAfter}`);
      if (stop.stopSigned !== true || stop.stoppedBeforeCompletion !== true) fail('stop-not-signed', JSON.stringify({ signed: stop.stopSigned, stopped: stop.stoppedBeforeCompletion }));
      if (!(ledgerTrace.outputTokens > 0 && ledgerTrace.outputTokens <= (stop.outputsReceived ?? 0) && ledgerTrace.outputTokens < (receipt.split?.cap ?? Infinity))) {
        fail('stop-charge', `charged ${ledgerTrace.outputTokens} outputs, received ${stop.outputsReceived}`);
      }
      const due = creditSettlementDeltas({ computerId: stop.account.accountId, providers: stages.map((stage, index) => ({ participantId: stage.participantId, weight: weights[index] })) },
        ledgerTrace.outputTokens * creditsPerOutputToken, id => accountOf(id, stop.account.accountId));
      if (ledgerTrace.charge !== due.charge) fail('settlement-charge', `stop: ${ledgerTrace.charge}, expected ${due.charge}`);
      if (ledgerTrace.journal.reduce((sum, item) => sum + item.delta, 0) !== 0) fail('settlement-not-conserved', 'stop');
      const row = stop.settlementReplay?.result?.reservations?.find(item => item.reservationId === ledgerTrace.reservationId);
      if (!row || row.status !== 'settled') fail('replay-not-settled', `stop: ${row?.status}`);
      else sameAsLedger('stop', ledgerTrace, row, stop.account.accountId);
      if (stop.settlementReplay?.problems?.length) fail('replay-records', `stop: ${stop.settlementReplay.problems.join('; ')}`);
      operatorsBlind('stop', stop.visibility);
    }
  }
  // 6b. A disconnect: no signed stop, every stage closed. The v2 rule charges the acknowledged prefix as an unattributed
  // disconnect; the ledger names that reason and the replay charges the same outputs.
  if (cases.includes('disconnect')) {
    const gone = receipt.disconnect, ledgerTrace = gone?.settlement;
    if (!ledgerTrace) fail('disconnect-missing', 'no disconnect case');
    else {
      if (ledgerTrace.state !== 'settled' || ledgerTrace.heldAfter !== 0) fail('stranded-hold', `disconnect ${ledgerTrace.state} held ${ledgerTrace.heldAfter}`);
      if (gone.stopSigned !== false || gone.completed !== false || !gone.disconnected) fail('disconnect-shape', JSON.stringify({ stop: gone.stopSigned, completed: gone.completed, disconnected: gone.disconnected }));
      if (ledgerTrace.reason !== 'unattributed-disconnect-acknowledged-prefix') fail('disconnect-reason', ledgerTrace.reason);
      if (!(ledgerTrace.outputTokens > 0 && ledgerTrace.outputTokens <= (gone.outputsReceived ?? 0) && ledgerTrace.outputTokens < (receipt.split?.cap ?? Infinity))) {
        fail('disconnect-charge', `charged ${ledgerTrace.outputTokens} outputs, received ${gone.outputsReceived}`);
      }
      const due = creditSettlementDeltas({ computerId: gone.account.accountId, providers: stages.map((stage, index) => ({ participantId: stage.participantId, weight: weights[index] })) },
        ledgerTrace.outputTokens * creditsPerOutputToken, id => accountOf(id, gone.account.accountId));
      if (ledgerTrace.charge !== due.charge) fail('settlement-charge', `disconnect: ${ledgerTrace.charge}, expected ${due.charge}`);
      if (ledgerTrace.journal.reduce((sum, item) => sum + item.delta, 0) !== 0) fail('settlement-not-conserved', 'disconnect');
      if (gone.account.after !== gone.account.before - ledgerTrace.charge) fail('spend-mismatch', `disconnect: ${gone.account.before} - ${ledgerTrace.charge} != ${gone.account.after}`);
      const row = gone.settlementReplay?.result?.reservations?.find(item => item.reservationId === ledgerTrace.reservationId);
      if (!row || row.status !== 'settled' || row.chargedOutputs !== ledgerTrace.outputTokens) fail('replay-not-settled', `disconnect: ${row?.status} charged ${row?.chargedOutputs}`);
      else sameAsLedger('disconnect', ledgerTrace, row, gone.account.accountId);
      if (gone.settlementReplay?.problems?.length) fail('replay-records', `disconnect: ${gone.settlementReplay.problems.join('; ')}`);
      operatorsBlind('disconnect', gone.visibility);
    }
  }
  // 7. A dropped stage host, no stop: verified-provider-failure relief. Nothing charged, nobody paid, nothing held.
  if (cases.includes('drop')) {
    const drop = receipt.drop, ledgerTrace = drop?.settlement;
    if (!ledgerTrace) fail('drop-missing', 'no drop case');
    else {
      if (ledgerTrace.state !== 'settled' || ledgerTrace.heldAfter !== 0) fail('stranded-hold', `drop ${ledgerTrace.state} held ${ledgerTrace.heldAfter}`);
      if (ledgerTrace.charge !== 0 || (ledgerTrace.credits ?? []).some(item => item.amount !== 0)) fail('drop-charged', `charge ${ledgerTrace.charge}`);
      if (drop.account.after !== drop.account.before) fail('drop-charged', `balance ${drop.account.before} -> ${drop.account.after}`);
      if (drop.stopSigned !== false || drop.killed?.confirmedGone !== true) fail('drop-shape', JSON.stringify({ stop: drop.stopSigned, killed: drop.killed }));
      const row = drop.settlementReplay?.result?.reservations?.find(item => item.reservationId === ledgerTrace.reservationId);
      if (!row || !(row.status === 'expired' || (row.status === 'settled' && (row.debit ?? 0) === 0))) fail('replay-drop-charged', `${row?.status} ${row?.debit}`);
      else sameAsLedger('drop', ledgerTrace, row, drop.account.accountId);
      operatorsBlind('drop', drop.visibility);
    }
  }
  if (receipt.cleanup?.processesExited !== true || receipt.cleanup?.openReservations !== 0 || receipt.cleanup?.heldCredits !== 0) {
    fail('cleanup', JSON.stringify(receipt.cleanup));
  }
  return { passed: problems.length === 0, problems };
}

