/** Resolve host-selected resident policy through the pinned Doppler contract. */
import { resolveGenerationOptions } from './doppler-generation-contract.js';
import profile from './work-profile.json' with { type: 'json' };
import policy from './partition-policy.json' with { type: 'json' };

export function resolvePartitionGeneration(model) {
  const explicit = Object.hasOwn(model, 'generation');
  const options = explicit ? model.generation
    : { ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen };
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.values(options).some(value => value === undefined)) {
    throw new Error('Partition generation requires an explicit valid options object');
  }
  const generation = resolveGenerationOptions(options);
  if (generation.maxTokens > policy.limits.maxTokens || generation.maxSeqLen > policy.maxSeqLen
    || generation.maxTokens > generation.maxSeqLen
    || (Number.isSafeInteger(model.contextLength) && generation.maxSeqLen > model.contextLength)) {
    throw new Error('Partition generation exceeds the declared context or output limits');
  }
  return generation;
}
