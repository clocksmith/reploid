import { fail, object, freeze } from './text-requester.js';

/** Optional private-pool binding; it narrows the host's disclosure authority. */
export function parseRequesterBinding(value) {
  if (value === undefined) return undefined;
  if (!object(value) || Object.keys(value).some(key => !['pool_id', 'expected_model_identity', 'expected_adapter_identities', 'expected_plan_identity', 'allowed_recipients', 'include_execution'].includes(key))
    || typeof value.pool_id !== 'string' || !value.pool_id || value.pool_id.length > 256
    || typeof value.expected_model_identity !== 'string' || !value.expected_model_identity || value.expected_model_identity.length > 512
    || value.include_execution !== true || !Array.isArray(value.allowed_recipients) || !value.allowed_recipients.length
    || value.allowed_recipients.length > 32 || value.allowed_recipients.some(id => typeof id !== 'string' || !id || id.length > 512)
    || new Set(value.allowed_recipients).size !== value.allowed_recipients.length) {
    throw fail(400, 'Require exact model identity and permitted recipient identities', 'reploid');
  }
  if (value.expected_adapter_identities !== undefined && (!Array.isArray(value.expected_adapter_identities)
    || value.expected_adapter_identities.length > 1 || value.expected_adapter_identities.some(id => !/^sha256:[a-f0-9]{64}$/u.test(id)))) throw fail(400, 'Invalid adapter identities', 'reploid');
  if (value.expected_plan_identity != null && (typeof value.expected_plan_identity !== 'string' || !value.expected_plan_identity
    || value.expected_plan_identity.length > 256)) throw fail(400, 'Invalid plan identity', 'reploid');
  return freeze(structuredClone(value));
}
