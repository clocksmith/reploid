import { assertPartition as assert } from './partition-contract.js';

export const TEXT_GENERATION_CAPABILITY = Object.freeze({ schema: 'reploid.text-generation/v1', usage: 'raw-model-tokens/v1' });

/** Optional caller ceiling, not a sampling override or a new generation policy. */
export function generationRequest(value) {
  if (value === undefined) return undefined;
  assert(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3 && value.schema === 'reploid.partition-generation-request/v1'
    && value.usage === 'raw-model-tokens/v1' && Number.isSafeInteger(value.maxOutputTokens) && value.maxOutputTokens > 0,
  'Invalid caller token limit or usage contract');
  return Object.freeze({ schema: value.schema, maxOutputTokens: value.maxOutputTokens, usage: value.usage });
}
export function requireGenerationCapability(model, requested, canonical = false) {
  const value = generationRequest(requested);
  if (value) assert(!canonical && model?.textGeneration?.schema === TEXT_GENERATION_CAPABILITY.schema
    && model.textGeneration.usage === TEXT_GENERATION_CAPABILITY.usage, 'Prepared route lacks caller token limit and usage capability');
  return value;
}
export function boundedGeneration(settings, requested) {
  const value = generationRequest(requested);
  if (!value) return settings;
  assert(value.maxOutputTokens <= settings.maxTokens, 'Caller token limit exceeds the prepared generation allocation');
  return { ...settings, maxTokens: value.maxOutputTokens };
}
/** Counts the provider's actual template tokenization and raw sampled tokens,
 * including any terminal token. No counts are inferred from visible text. */
export function tokenUsage(inputTokens, outputTokens, requested) {
  const value = generationRequest(requested);
  assert(value && Number.isSafeInteger(inputTokens) && inputTokens > 0 && Number.isSafeInteger(outputTokens)
    && outputTokens >= 0 && outputTokens <= value.maxOutputTokens, 'Invalid provider token usage');
  return Object.freeze({ schema: value.usage, inputTokens, outputTokens });
}
