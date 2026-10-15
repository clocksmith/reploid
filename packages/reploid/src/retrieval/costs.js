/** Per-answer costs of a search-backed answer, kept in its retrieval record and never in conversation text. Retrieval
 * (search queries and page fetches), verification (support checks and entailment reviews) and fallback are separate
 * entries so service economics can sum each one. Prices come only from explicit configuration reported by the
 * providers and reviewers: an unpriced or unmeasured component is null, never zero, and a null makes every sum above
 * it null. Zero means the work did not happen. Amounts are integer micro-USD. */

export const RETRIEVAL_COSTS_SCHEMA = 'reploid.retrieval-costs/v1';
/** Who pays a route's retrieval: the operator (a Reploid-paid provider) or the requester (their own device and tools). */
export const COST_BEARERS = Object.freeze(['operator', 'requester']);
/** No fallback route exists yet, so every record says so explicitly rather than omitting the entry. */
export const NO_FALLBACK = Object.freeze({ path: 'none', costMicroUsd: 0 });

const amount = value => Number.isSafeInteger(value) && value >= 0;
const known = value => amount(value) ? value : null;
/** The sum of the amounts, or null when any of them is unknown. */
export const sumMicroUsd = values => values.every(amount) ? values.reduce((total, value) => total + value, 0) : null;

/** A model's configured token prices, micro-USD per million tokens, or null when unpriced. */
export function validTokenPrice(price) {
  return price === null || !!price && typeof price === 'object' && Object.keys(price).length === 2
    && amount(price.inputMicroUsdPerMillionTokens) && amount(price.outputMicroUsdPerMillionTokens);
}
/** One model call's cost; null unless both token counts and the price are known. Rounded to the nearest micro-USD. */
export function tokenCostMicroUsd({ inputTokens, outputTokens, price }) {
  if (!amount(inputTokens) || !amount(outputTokens) || !price || !validTokenPrice(price)) return null;
  return Math.round((inputTokens * price.inputMicroUsdPerMillionTokens + outputTokens * price.outputMicroUsdPerMillionTokens) / 1e6);
}

const unknownSearch = service => ({ service, requests: null, costMicroUsd: null });
const UNKNOWN_EXTRACTION = Object.freeze({ attempted: null, documents: null, failed: null, bytes: null, costMicroUsd: null });
/** The retrieval entry of a record whose retrieval was not observed to completion (for example, interrupted by a reload). */
export const unknownRetrievalCosts = (bearer = null) => ({ bearer, search: unknownSearch(null), extraction: { ...UNKNOWN_EXTRACTION }, costMicroUsd: null });

/**
 * The retrieval entry from what one retrieval observed. `meter`: whether the provider was called and the usage it
 * reported; extraction attempts, failures, fetched bytes (null when an extractor did not report them) and each
 * extracted passage's reported cost (null when unreported). A failed fetch may still have transferred bytes, so any
 * failure leaves the extraction cost unknown.
 */
export function retrievalCostEntry({ bearer = null, service = null, meter }) {
  const search = !meter.searched ? { service: null, requests: 0, costMicroUsd: 0 }
    : meter.usage ? { service: meter.usage.provider, requests: meter.usage.requests, costMicroUsd: known(meter.usage.costMicroUsd) }
      : unknownSearch(service);
  const extraction = { attempted: meter.attempted, documents: meter.documents, failed: meter.failed, bytes: meter.bytes,
    costMicroUsd: meter.attempted === 0 ? 0 : meter.failed > 0 ? null : sumMicroUsd(meter.costs) };
  return { bearer: COST_BEARERS.includes(bearer) ? bearer : null, search, extraction,
    costMicroUsd: sumMicroUsd([search.costMicroUsd, extraction.costMicroUsd]) };
}

/** One review's cost: a model review from its reported tokens and configured price; a human review unpriced unless declared. */
export function reviewCostEntry(judgments) {
  if (judgments?.schema !== 'reploid.claim-support-judgments/v1' || !judgments.reviewer) throw new Error('Invalid support judgments');
  const base = { kind: judgments.reviewer.kind, packet: judgments.packet?.id ?? null, reviewer: judgments.reviewer.id };
  if (judgments.reviewer.kind === 'model') {
    const usage = judgments.usage ?? {}, price = validTokenPrice(usage.price ?? null) ? usage.price ?? null : null;
    const inputTokens = known(usage.inputTokens), outputTokens = known(usage.outputTokens);
    return { ...base, inputTokens, outputTokens, price: price && { ...price }, costMicroUsd: tokenCostMicroUsd({ inputTokens, outputTokens, price }) };
  }
  return amount(judgments.declaredCostMicroUsd) ? { ...base, pricing: 'declared', costMicroUsd: judgments.declaredCostMicroUsd }
    : { ...base, pricing: 'unpriced', costMicroUsd: null };
}

/** The verification entry: the configured support checker's checks during verification, plus any entailment reviews. */
function verificationEntry(verification, reviews = []) {
  const checker = verification?.checker ? { id: verification.checker.id, version: verification.checker.version,
    checks: verification.usage?.checks ?? null, costMicroUsd: verification.usage ? known(verification.usage.costMicroUsd) : null } : null;
  return { checker, reviews: structuredClone(reviews),
    costMicroUsd: sumMicroUsd([...(checker ? [checker.costMicroUsd] : []), ...reviews.map(review => review.costMicroUsd)]) };
}
const NO_VERIFICATION = Object.freeze({ checker: null, reviews: [], costMicroUsd: 0 });

/** The complete cost record: three separate entries, their total, and the components whose cost is unknown. */
export function retrievalCostRecord({ retrieval, verification = NO_VERIFICATION, fallback = NO_FALLBACK }) {
  const unknown = [
    ...(retrieval.search.costMicroUsd === null ? ['retrieval.search'] : []),
    ...(retrieval.extraction.costMicroUsd === null ? ['retrieval.extraction'] : []),
    ...(verification.checker?.costMicroUsd === null ? ['verification.checker'] : []),
    ...verification.reviews.filter(review => review.costMicroUsd === null).map(review => `verification.review:${review.kind}:${review.reviewer}`),
    ...(fallback.costMicroUsd === null ? ['fallback'] : [])];
  return { schema: RETRIEVAL_COSTS_SCHEMA, unit: 'micro-usd', retrieval: structuredClone(retrieval), verification: structuredClone(verification),
    fallback: { ...fallback }, totalMicroUsd: sumMicroUsd([retrieval.costMicroUsd, verification.costMicroUsd, fallback.costMicroUsd]), unknown };
}

/** The record with its citation verification attached and the verification cost entry updated from it. */
export function withVerification(record, verification) {
  const costs = record.costs;
  return { ...record, verification, costs: retrievalCostRecord({ retrieval: costs?.retrieval ?? unknownRetrievalCosts(),
    verification: verificationEntry(verification, costs?.verification?.reviews), fallback: costs?.fallback ?? NO_FALLBACK }) };
}

/** The record with entailment review costs added from judgment files; a reviewer's later file for the same packet replaces its earlier one. */
export function withReviewCosts(record, judgmentFiles) {
  if (!Array.isArray(judgmentFiles)) throw new Error('Review cost needs judgment files');
  const reviews = [...(record.costs?.verification?.reviews ?? [])];
  for (const entry of judgmentFiles.map(reviewCostEntry)) {
    const index = reviews.findIndex(item => item.kind === entry.kind && item.reviewer === entry.reviewer && item.packet === entry.packet);
    if (index >= 0) reviews[index] = entry; else reviews.push(entry);
  }
  return { ...record, costs: retrievalCostRecord({ retrieval: record.costs?.retrieval ?? unknownRetrievalCosts(),
    verification: verificationEntry(record.verification, reviews), fallback: record.costs?.fallback ?? NO_FALLBACK }) };
}
