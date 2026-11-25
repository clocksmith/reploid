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
 * The unfinished-answer terms of reservations under SETTLEMENT_RULES_V2, signed into the requester's settlement
 * terms so the replay applies the same rule from the records alone (docs/settlement-replay.md, step 9). An unfinished
 * answer that every stage closed, with no signed stop, is an unattributed disconnect and charges the acknowledged
 * prefix; a verified provider failure (a stage with no closing receipt, or a stage owner's interruption claim) charges
 * nothing.
 */
export const UNFINISHED_ANSWER_TERMS_V2 = 'reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1';
/**
 * The unfinished-answer terms the owner decided on 2026-11-25 after the relief of UNFINISHED_ANSWER_TERMS_V2 proved
 * to be a way to take an answer for nothing (docs/settlement-replay.md, "Failed stages"). A stage that fails, by its
 * own signed fault or by having no closing receipt once the release window has passed, forfeits its own share and
 * nothing else: the stages that closed are paid for the outputs the requester acknowledged, and the requester pays
 * exactly those shares. A stage on the requester's own account is never charged or paid, so its failure relieves
 * nothing.
 */
export const UNFINISHED_ANSWER_TERMS_V3 = 'reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1';
/** Terms under which a stage owner's interruption claim settles the answer at zero. */
export const PROVIDER_RELIEF_TERMS = Object.freeze([UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V2]);
/**
 * A split reservation that names these rules settles as the settlement replay computes (docs/settlement-replay.md):
 * a stage ending an unfinished answer on its own costs nothing, a requester's signed stop charges the acknowledged
 * prefix, closes inside the release window count, and outputs past the signed ceiling are never charged. Reservations
 * made under them on 2026-11-25 keep them.
 */
export const SETTLEMENT_RULES_V1 = 'reploid.settlement-replay/v1';
/**
 * The ledger's interim rules of 2026-11-25, kept for the reservations made under them: the first rules, except that
 * an unfinished split answer the stages closed with no requester stop charges the acknowledged-in-time prefix. The
 * replay then charged 0 there (the known difference of docs/settlement-replay.md, "Older rules").
 */
export const SETTLEMENT_RULES_INTERIM = 'reploid.settlement-replay/v1+acknowledged-prefix';
/**
 * The provider-relief rules (docs/settlement-replay.md, step 9), reserved with UNFINISHED_ANSWER_TERMS_V2 on
 * 2026-11-25 and kept for the reservations made under them. An unfinished answer the stages closed with no signed stop
 * charges the requester's acknowledged-in-time output, capped at the signed `maxOutputTokens` and split by the signed
 * weights; a verified provider failure (a stage with no closing receipt, or a stage owner's interruption claim) charges
 * nothing; a signed stop charges the acknowledged prefix. A split answer is decided once the clock passes deadline +
 * release window + clock allowance.
 */
export const SETTLEMENT_RULES_V2 = 'reploid.settlement-replay/v2';
/**
 * The failed-stage rules (docs/settlement-replay.md, "Failed stages"), taken by every new split reservation together
 * with UNFINISHED_ANSWER_TERMS_V3. They are the provider-relief rules, except that a stage that fails no longer makes
 * the answer free: a stage that signed a fault (in the ledger, its owner's interruption claim), or that has no closing
 * receipt once the release window has passed, forfeits its own share and nothing else. Every other stage is credited
 * what it would have been credited had every stage closed, and the requester's charge falls by exactly the forfeited
 * share. An answer with nothing acknowledged and a stage that did not close still expires with nobody charged or paid.
 * The ledger posts what the settlement replay computes from the same signed records.
 */
export const SETTLEMENT_RULES = 'reploid.settlement-replay/v3';
export const SETTLEMENT_RULE_SETS = Object.freeze([SETTLEMENT_RULES_V1, SETTLEMENT_RULES_INTERIM, SETTLEMENT_RULES_V2, SETTLEMENT_RULES]);
/** The unfinished-answer terms each settlement-rules id was reserved with. */
export const UNFINISHED_TERMS_OF_RULES = Object.freeze({ [SETTLEMENT_RULES_V1]: UNFINISHED_ANSWER_TERMS,
  [SETTLEMENT_RULES_INTERIM]: UNFINISHED_ANSWER_TERMS, [SETTLEMENT_RULES_V2]: UNFINISHED_ANSWER_TERMS_V2, [SETTLEMENT_RULES]: UNFINISHED_ANSWER_TERMS_V3 });
/** The ledger's reason for a settlement in which a failed stage forfeited its share (SETTLEMENT_RULES). */
export const FORFEIT_REASON = 'failed-stage-forfeits-own-share';
/**
 * Older rules only: the one case where the ledger under SETTLEMENT_RULES_INTERIM and the replay over
 * provider-loss-free terms post different amounts, an unfinished split answer that the stages closed with no in-time
 * requester stop and no more than K acknowledgments withheld. The replay charges 0; the ledger charged the
 * acknowledged prefix. A replay row shows it as `settled` with `outputs > 0` and `chargedOutputs: 0`, which no other
 * settled row has (the ceiling is positive). It cannot arise under SETTLEMENT_RULES_V2 or SETTLEMENT_RULES.
 */
export const WALK_AWAY_DIFFERENCE = 'unfinished-split-answer-closed-without-stop';
export const isWalkAwayRow = row => row?.status === 'settled' && Number.isSafeInteger(row.outputs) && row.outputs > 0 && row.chargedOutputs === 0;

/**
 * The units a settled request moves. Under these terms a split answer whose stage owner vanished charges the
 * requester nothing and pays no stage, even for acknowledged output; so does one a stage ended on its own
 * (credit-evidence.js `stageEnded`) under SETTLEMENT_RULES_V1 only. A reservation made before them has no
 * `unfinishedTerms` and keeps the acknowledged-prefix charge it was accepted under. Under the failed-stage terms
 * (UNFINISHED_ANSWER_TERMS_V3) the units are always the acknowledged output: a failed stage's share is taken out of
 * the split below (`forfeited`), not out of the units.
 */
export function settledCreditUnits(request, observed, creditsPerOutputToken) {
  if (observed.fixedCharge !== null && observed.fixedCharge !== undefined) return observed.fixedCharge;
  if (PROVIDER_RELIEF_TERMS.includes(request.unfinishedTerms) && observed.interruptedStages?.length) return 0;
  if (request.unfinishedTerms === UNFINISHED_ANSWER_TERMS && observed.stageEnded === true && request.settlementRules === SETTLEMENT_RULES_V1) return 0;
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
 *
 * `forfeited` lists the stage indexes that failed (docs/settlement-replay.md, "Split arithmetic"). The shares are
 * computed over every stage first; a forfeiting stage is then credited 0 and the charge falls by exactly the amount
 * it would have been credited. No other stage's amount changes and nothing is redistributed. A forfeiting stage on
 * the requester's own unit changes nothing: its share was never charged.
 */
export function creditSettlementDeltas(request, totalUnits, computerOf, forfeited = []) {
  const amounts = stageShares(request.providers, totalUnits);
  let ownComputeUnits = 0, forfeitedUnits = 0;
  const credits = request.providers.map((provider, index) => {
    const share = amounts[index], computerId = computerOf(provider.participantId);
    if (computerId === request.computerId) ownComputeUnits += share;
    else if (forfeited.includes(index)) forfeitedUnits += share;
    return { participantId: provider.participantId, computerId, amount: forfeited.includes(index) ? 0 : share };
  }).filter(row => row.computerId !== request.computerId);
  const charge = totalUnits - ownComputeUnits - forfeitedUnits;
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
 *
 * `forfeited` lists the stage indexes that failed, as in creditSettlementDeltas: such a stage is credited 0 and the
 * charge falls by its share, unless it is on the requester's own account (or, before owner accounts, own computer).
 */
export function accountSettlement(request, totalUnits, placeOf, forfeited = []) {
  let credits, ownComputeUnits, charge, entries;
  if (request.accountId === undefined) {
    const split = creditSettlementDeltas(request, totalUnits, peer => placeOf(peer).computerId, forfeited);
    const accountOf = new Map([[request.computerId, placeOf(request.consumer).accountId],
      ...split.credits.map(row => [row.computerId, placeOf(row.participantId).accountId])]);
    ({ credits, ownComputeUnits, charge } = split);
    entries = [...split.deltas].map(([computerId, delta]) => ({ accountId: accountOf.get(computerId), computerId, delta }));
  } else {
    const amounts = stageShares(request.providers, totalUnits);
    let forfeitedUnits = 0;
    ownComputeUnits = 0;
    credits = request.providers.map((provider, index) => {
      const { computerId, accountId } = placeOf(provider.participantId);
      if (accountId === request.accountId) ownComputeUnits += amounts[index];
      else if (forfeited.includes(index)) forfeitedUnits += amounts[index];
      return { participantId: provider.participantId, computerId, accountId, amount: forfeited.includes(index) ? 0 : amounts[index] };
    }).filter(row => row.accountId !== request.accountId);
    charge = totalUnits - ownComputeUnits - forfeitedUnits;
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
