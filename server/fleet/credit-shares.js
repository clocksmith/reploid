/**
 * How one settled request moves service credits between accounts. The ledger applies it when it settles, and a
 * contributor's statement check (credit-statement.js) recomputes it from the same signed evidence, so a balance
 * can be checked without trusting whoever operates the ledger.
 *
 * Integer arithmetic with a stable stage-order remainder: every credited unit has a matching debit. Work a
 * requester's own account did for its own request is neither charged nor credited.
 */
export const UNFINISHED_ANSWER_TERMS = 'reploid.unfinished-answer/provider-loss-free/v1';
/**
 * A split reservation that names these rules settles as the settlement replay computes (docs/settlement-replay.md):
 * a stage ending an unfinished answer on its own costs nothing, a requester's signed stop charges the acknowledged
 * prefix, closes inside the release window count, and outputs past the signed ceiling are never charged. A
 * reservation made before them keeps the rules it was accepted under.
 */
export const SETTLEMENT_RULES = 'reploid.settlement-replay/v1';

/**
 * The units a settled request moves. Under these terms a split answer whose stage owner vanished, or that a stage
 * ended on its own (credit-evidence.js `stageEnded`), charges the requester nothing and pays no stage, even for
 * acknowledged output. A reservation made before them has no
 * `unfinishedTerms` and keeps the acknowledged-prefix charge it was accepted under.
 */
export function settledCreditUnits(request, observed, creditsPerOutputToken) {
  if (observed.fixedCharge !== null && observed.fixedCharge !== undefined) return observed.fixedCharge;
  if (request.unfinishedTerms === UNFINISHED_ANSWER_TERMS && (observed.interruptedStages?.length || observed.stageEnded === true)) return 0;
  return observed.outputTokens * creditsPerOutputToken;
}

/** Each stage's integer share of `totalUnits`, in stage order; the last stage takes the remainder. */
function stageShares(providers, totalUnits) {
  const totalWeight = providers.reduce((sum, row) => sum + row.weight, 0);
  let remaining = totalUnits;
  return providers.map((provider, index) => {
    const amount = index === providers.length - 1 ? remaining
      : Number(BigInt(totalUnits) * BigInt(provider.weight) / BigInt(totalWeight));
    remaining -= amount;
    return amount;
  });
}

/**
 * The split keyed by one participant-to-unit map: `request.computerId` is the requester's unit and `computerOf`
 * maps each stage to its unit. The settlement replay passes participant IDs; a reservation made before owner
 * accounts uses enrolled computers.
 */
export function creditSettlementDeltas(request, totalUnits, computerOf) {
  const amounts = stageShares(request.providers, totalUnits);
  let ownComputeUnits = 0;
  const credits = request.providers.map((provider, index) => {
    const amount = amounts[index], computerId = computerOf(provider.participantId);
    if (computerId === request.computerId) ownComputeUnits += amount;
    return { participantId: provider.participantId, computerId, amount };
  }).filter(row => row.computerId !== request.computerId);
  const charge = totalUnits - ownComputeUnits;
  const deltas = new Map([[request.computerId, charge === 0 ? 0 : -charge]]);
  for (const credit of credits) deltas.set(credit.computerId, (deltas.get(credit.computerId) || 0) + credit.amount);
  return { credits, ownComputeUnits, charge, deltas };
}

/**
 * The same split posted to owner accounts. `placeOf(participantId)` returns its enrolled `{ computerId, accountId }`.
 *
 * A reservation that names its `accountId` (made since balances are kept per owner account) treats every computer
 * of the requester's own account as its own: that work is neither charged nor credited, so earning on one of an
 * owner's computers pays for asking from another. A reservation without it keeps the per-computer arithmetic it
 * was accepted under, and each computer's delta is posted to that computer's owner account.
 *
 * `entries` lists every journal row: account, the computer the delta is attributed to, and the delta. `deltas`
 * sums them per account.
 */
export function accountSettlement(request, totalUnits, placeOf) {
  let credits, ownComputeUnits, charge, entries;
  if (request.accountId === undefined) {
    const split = creditSettlementDeltas(request, totalUnits, peer => placeOf(peer).computerId);
    const accountOf = new Map([[request.computerId, placeOf(request.consumer).accountId],
      ...split.credits.map(row => [row.computerId, placeOf(row.participantId).accountId])]);
    ({ credits, ownComputeUnits, charge } = split);
    entries = [...split.deltas].map(([computerId, delta]) => ({ accountId: accountOf.get(computerId), computerId, delta }));
  } else {
    const amounts = stageShares(request.providers, totalUnits);
    ownComputeUnits = 0;
    credits = request.providers.map((provider, index) => {
      const { computerId, accountId } = placeOf(provider.participantId);
      if (accountId === request.accountId) ownComputeUnits += amounts[index];
      return { participantId: provider.participantId, computerId, accountId, amount: amounts[index] };
    }).filter(row => row.accountId !== request.accountId);
    charge = totalUnits - ownComputeUnits;
    entries = [{ accountId: request.accountId, computerId: request.computerId, delta: charge === 0 ? 0 : -charge }];
    for (const credit of credits) {
      const prior = entries.find(row => row.accountId === credit.accountId && row.computerId === credit.computerId);
      if (prior) prior.delta += credit.amount;
      else entries.push({ accountId: credit.accountId, computerId: credit.computerId, delta: credit.amount });
    }
  }
  const deltas = new Map();
  for (const row of entries) deltas.set(row.accountId, (deltas.get(row.accountId) || 0) + row.delta);
  return { credits, ownComputeUnits, charge, entries, deltas };
}
