import { assertPartition as assert, canonicalPartitionJson, canonicalRouteAttemptBinding } from './partition-contract.js';

/** Requester-owned publication of ordinary ordered decoding. Doppler executes
 * every stage and decides each token and stopping reason; these records only
 * bind what the final stage returned to its route attempt and durable order.
 * Ordinary ordered stages sign no commitments: records carry zero stage
 * acknowledgments, and the digest port is the injected Doppler metadataDigest. */
export const ORDERED_PUBLICATION_SCHEMA = 'reploid.ordered-publication/v1';
export const ORDERED_PUBLICATION_ATTEMPT_SCHEMA = 'reploid.ordered-publication-attempt/v1';
export const ORDERED_PUBLICATION_CONTEXT_SCHEMA = 'reploid.ordered-publication-context/v1';
const BOUNDS_SCHEMA = 'reploid.ordered-generation-bounds/v1';
const CURSOR_SCHEMA = 'reploid.ordered-cursor/v1';
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const attemptKeys = ['schema', 'attemptId', 'threadId', 'requesterId', 'placementGeneration', 'route',
  'coordinatorEpoch', 'publisherEpoch', 'generationDigest'];
const recordKeys = ['schema', 'publicationDigest', 'attemptId', 'coordinatorEpoch', 'attemptDigest', 'sequence',
  'previousPublicationDigest', 'tokenPosition', 'inputTokenCount', 'tokenId', 'delta', 'successor', 'acknowledgments'];
const cursorKeys = ['schema', 'revision', 'generatedTokenCount', 'nextTokenPosition', 'pendingTokenId',
  'outputCharacters', 'terminal', 'stopReason'];

export function validateOrderedPublicationContext(value) {
  assert(exact(value, ['schema', 'publisherEpoch', 'deadlineAt']) && value.schema === ORDERED_PUBLICATION_CONTEXT_SCHEMA
    && epoch(value.publisherEpoch) && positive(value.deadlineAt), 'Invalid ordered publication context');
  return structuredClone(value);
}

export function validateOrderedPublicationAttempt(value) {
  assert(exact(value, attemptKeys) && value.schema === ORDERED_PUBLICATION_ATTEMPT_SCHEMA
    && epoch(value.coordinatorEpoch) && epoch(value.publisherEpoch) && digest(value.generationDigest),
  'Invalid ordered publication attempt');
  const binding = canonicalRouteAttemptBinding({ schema: 'reploid.partition-attempt/v2', route: value.route,
    threadId: value.threadId, attemptId: value.attemptId, requesterId: value.requesterId, placementGeneration: value.placementGeneration });
  assert(canonicalPartitionJson(binding.route) === canonicalPartitionJson(value.route), 'Ordered publication route is not canonical');
  return structuredClone(value);
}

export function orderedPublicationAttempt({ binding, coordinatorEpoch, publisherEpoch, generationDigest }) {
  const identity = canonicalRouteAttemptBinding(binding);
  return validateOrderedPublicationAttempt({ schema: ORDERED_PUBLICATION_ATTEMPT_SCHEMA, attemptId: identity.attemptId,
    threadId: identity.threadId, requesterId: identity.requesterId, placementGeneration: identity.placementGeneration,
    route: structuredClone(identity.route), coordinatorEpoch, publisherEpoch, generationDigest });
}

export function validateOrderedGenerationBounds(value) {
  assert(exact(value, ['schema', 'maxTokens', 'maxOutputCharacters']) && value.schema === BOUNDS_SCHEMA
    && positive(value.maxTokens) && positive(value.maxOutputCharacters), 'Invalid ordered generation bounds');
  return structuredClone(value);
}

export function orderedGenerationBounds({ maxTokens, maxOutputCharacters }) {
  return validateOrderedGenerationBounds({ schema: BOUNDS_SCHEMA, maxTokens, maxOutputCharacters });
}

/** One durable record per final-stage step, chained to the conversation head. */
export function orderedPublicationRecord({ attempt, bounds, vocabSize, base, previousPublicationDigest, metadataDigest, step }) {
  const { sequence, tokenPosition, inputTokenCount, tokenId, delta, done, stopReason } = step;
  const body = { schema: ORDERED_PUBLICATION_SCHEMA, attemptId: attempt.attemptId, coordinatorEpoch: attempt.coordinatorEpoch,
    attemptDigest: metadataDigest(attempt.schema, attempt), sequence, previousPublicationDigest, tokenPosition, inputTokenCount,
    tokenId, delta: { text: delta }, successor: { schema: CURSOR_SCHEMA, revision: sequence, generatedTokenCount: sequence + 1,
      nextTokenPosition: tokenPosition + inputTokenCount, pendingTokenId: tokenId,
      outputCharacters: (base?.outputCharacters ?? 0) + delta.length, terminal: done === true, stopReason: done === true ? stopReason : null },
    acknowledgments: [] };
  const record = { ...body, publicationDigest: metadataDigest(body.schema, body) };
  return validateOrderedPublication(record, attempt, bounds, vocabSize, base, metadataDigest);
}

/** Validates against the admitted attempt and the prior record's successor cursor. */
export function validateOrderedPublication(input, attempt, bounds, vocabSize, base, metadataDigest) {
  assert(exact(input, recordKeys) && input.schema === ORDERED_PUBLICATION_SCHEMA, 'Invalid ordered publication fields');
  const value = structuredClone(input), { successor: next, delta } = value;
  assert(value.attemptId === attempt.attemptId && value.coordinatorEpoch === attempt.coordinatorEpoch
    && value.attemptDigest === metadataDigest(attempt.schema, attempt), 'Ordered publication attempt binding mismatch');
  assert(count(value.sequence) && value.sequence < bounds.maxTokens
    && (value.previousPublicationDigest === null || digest(value.previousPublicationDigest))
    && count(value.tokenPosition) && positive(value.inputTokenCount)
    && Number.isSafeInteger(value.tokenId) && value.tokenId >= 0 && value.tokenId < vocabSize
    && exact(delta, ['text']) && typeof delta.text === 'string'
    && Array.isArray(value.acknowledgments) && value.acknowledgments.length === 0, 'Invalid ordered publication step');
  assert(exact(next, cursorKeys) && next.schema === CURSOR_SCHEMA && next.revision === value.sequence
    && next.generatedTokenCount === value.sequence + 1 && next.pendingTokenId === value.tokenId
    && next.nextTokenPosition === value.tokenPosition + value.inputTokenCount
    && next.outputCharacters === (base?.outputCharacters ?? 0) + delta.text.length
    && next.outputCharacters <= bounds.maxOutputCharacters && typeof next.terminal === 'boolean'
    && (next.terminal ? typeof next.stopReason === 'string' && next.stopReason.length > 0 && next.stopReason.length <= 64
      : next.stopReason === null)
    && (next.terminal || value.sequence + 1 < bounds.maxTokens), 'Ordered publication cursor mismatch');
  if (base == null) assert(value.sequence === 0 && value.tokenPosition === 0, 'Ordered publication bootstrap mismatch');
  else assert(exact(base, cursorKeys) && base.schema === CURSOR_SCHEMA && !base.terminal && value.sequence === base.revision + 1
    && value.tokenPosition === base.nextTokenPosition && value.inputTokenCount === 1, 'Ordered publication does not extend its base cursor');
  const { publicationDigest, ...body } = value;
  assert(publicationDigest === metadataDigest(body.schema, body), 'Ordered publication digest mismatch');
  return value;
}
