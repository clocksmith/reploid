/** Pure adapter policy validation. No publication, network or execution imports. */
import { freezeOperationPolicy } from './pack-operation-policy.js';
const assert = (ok, message) => { if (!ok) throw new Error(`Adapter execution: ${message}`); };
const positive = value => Number.isSafeInteger(value) && value > 0;

export function resolveAdapterExecutionPolicy(input) {
  const policy = freezeOperationPolicy(input);
  assert(policy?.schema === 'reploid.pool.adapter-execution-policy/v1', 'versioned policy required');
  assert(Array.isArray(policy.allowedFormats) && policy.allowedFormats.length > 0
    && policy.allowedFormats.every(value => ['peft_safetensors'].includes(value)), 'unsupported adapter format');
  for (const field of ['maxAdaptersPerJob', 'maxAdapterBytes', 'maxTotalAdapterBytes']) assert(positive(policy[field]), `${field} required`);
  assert(typeof policy.fetchBeforeExecute === 'boolean', 'fetch-before-execute permission required');
  assert(policy.combinations?.allowed === false && policy.combinations.order === 'request'
    && policy.combinations.semantics === 'single' && policy.maxAdaptersPerJob === 1, 'only explicitly declared single-adapter composition is implemented');
  assert(Array.isArray(policy.defaultAdapterSet) && policy.defaultAdapterSet.length === 0, 'explicit default adapter set required');
  assert(typeof policy.storage?.databaseName === 'string' && policy.storage.databaseName.length > 0
    && positive(policy.storage.maxCacheBytes) && positive(policy.storage.maxConcurrentChunks), 'persistent transfer policy required');
  return policy;
}

