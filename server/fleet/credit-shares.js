/**
 * How one settled request moves service credits between computers. The ledger applies it when it settles, and a
 * contributor's statement check (credit-statement.js) recomputes it from the same signed evidence, so a balance
 * can be checked without trusting whoever operates the ledger.
 *
 * Integer arithmetic with a stable stage-order remainder: every credited unit has a matching debit. Work a
 * requester's own computer did for its own request is neither charged nor credited.
 */
export const UNFINISHED_ANSWER_TERMS = 'reploid.unfinished-answer/provider-loss-free/v1';

/**
 * The units a settled request moves. Under these terms a split answer whose stage owner vanished charges the
 * requester nothing and pays no stage, even for acknowledged output. A reservation made before them has no
 * `unfinishedTerms` and keeps the acknowledged-prefix charge it was accepted under.
 */
export function settledCreditUnits(request, observed, creditsPerOutputToken) {
  if (observed.fixedCharge !== null && observed.fixedCharge !== undefined) return observed.fixedCharge;
  if (request.unfinishedTerms === UNFINISHED_ANSWER_TERMS && observed.interruptedStages?.length) return 0;
  return observed.outputTokens * creditsPerOutputToken;
}

export function creditSettlementDeltas(request, totalUnits, computerOf) {
  const totalWeight = request.providers.reduce((sum, row) => sum + row.weight, 0);
  let remaining = totalUnits, ownComputeUnits = 0;
  const credits = request.providers.map((provider, index) => {
    const amount = index === request.providers.length - 1 ? remaining
      : Number(BigInt(totalUnits) * BigInt(provider.weight) / BigInt(totalWeight));
    remaining -= amount;
    const computerId = computerOf(provider.participantId);
    if (computerId === request.computerId) ownComputeUnits += amount;
    return { participantId: provider.participantId, computerId, amount };
  }).filter(row => row.computerId !== request.computerId);
  const charge = totalUnits - ownComputeUnits;
  const deltas = new Map([[request.computerId, charge === 0 ? 0 : -charge]]);
  for (const credit of credits) deltas.set(credit.computerId, (deltas.get(credit.computerId) || 0) + credit.amount);
  return { credits, ownComputeUnits, charge, deltas };
}
