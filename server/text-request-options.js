import { fail, object, freeze } from './text-request-values.js';
import { compileExecutionRequirements, EXECUTION_BACKENDS } from '../shared/vendor/reploid/chat/execution-policy.js';
import { SERVICE_CREDIT_REFUSAL_STATUS } from './fleet/contract.js';

/** HTTP status for each stable inference refusal code. The body's error.code is the code in lower case. */
export const EXECUTION_ERROR_STATUS = Object.freeze({
  EXECUTION_REQUEST_INVALID: 400, CONFIDENTIAL_EXECUTION_UNAVAILABLE: 422, LEAKAGE_NOT_ALLOWED: 422,
  EXECUTION_ROUTE_UNAVAILABLE: 503, EXECUTION_PLAN_EXPIRED: 409, EXECUTION_PLAN_CHANGED: 409, RESULT_UNVERIFIED: 502,
  ATTESTED_EXECUTION_UNAVAILABLE: 422, ATTESTATION_REJECTED: 422
});
/**
 * A service-credit refusal (server/fleet/contract.js `creditRefusal`) made before any hold or disclosure: 402 when
 * the account cannot cover the quote, 409 when it has too many unfinished answers. Every protocol returns the stable
 * lower-case code and the refused quote in `service_credit`.
 */
export const CREDIT_REFUSAL_STATUS = SERVICE_CREDIT_REFUSAL_STATUS;
export const creditRefusalOf = error => (Object.hasOwn(CREDIT_REFUSAL_STATUS, error?.creditRefusal?.code ?? '') ? error.creditRefusal : null);
export const creditRefusalFields = error => {
  const refusal = creditRefusalOf(error);
  if (!refusal) return {};
  const { code, ...details } = refusal;
  return { code: code.toLowerCase(), service_credit: structuredClone(details) };
};
// Only refusals of the caller's own extension point at the `reploid` parameter.
const EXTENSION_CODES = ['EXECUTION_REQUEST_INVALID', 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', 'ATTESTED_EXECUTION_UNAVAILABLE', 'LEAKAGE_NOT_ALLOWED'];
export const executionFailure = error => Object.hasOwn(EXECUTION_ERROR_STATUS, error?.code)
  ? Object.assign(fail(EXECUTION_ERROR_STATUS[error.code], error.message, error.param ?? (EXTENSION_CODES.includes(error.code) ? 'reploid' : null)),
    { code: error.code }) : error;

/** The requirements a standard JSON request runs under when it carries no extension: any participant the operator allows. */
export const STANDARD_HTTP_EXECUTION = Object.freeze({ placement: 'network-allowed', participants: Object.freeze({ kind: 'open' }),
  confidentiality: 'executor-readable', allowMetadata: Object.freeze([...EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata]) });

const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);

/**
 * The one `reploid` extension of /v1/chat/completions, /v1/messages and /v1/responses: the same `model` pin and
 * `execution` requirements as `reploid/inference` prepare(), plus the private pool and conversation to use.
 * It is read before the protocol's messages. A request for requester-only confidentiality is refused here:
 * an ordinary JSON body is already plaintext to this server, so it can never be protected afterwards.
 */
export function parseExecutionExtension(value) {
  if (value === undefined) return undefined;
  const invalid = message => Object.assign(fail(400, message, 'reploid'), { code: 'EXECUTION_REQUEST_INVALID' });
  if (!object(value) || !Object.keys(value).length
    || Object.keys(value).some(key => !['model', 'execution', 'poolId', 'conversationId'].includes(key))) {
    throw invalid('reploid accepts model, execution, poolId and conversationId');
  }
  if (value.model !== undefined) {
    const { model } = value;
    if (!object(model) || Object.keys(model).some(key => !['identity', 'adapterIdentities', 'planIdentity'].includes(key))
      || !digest(model.identity) || (model.adapterIdentities !== undefined && (!Array.isArray(model.adapterIdentities)
        || model.adapterIdentities.length > 1 || !model.adapterIdentities.every(digest)))
      || (model.planIdentity !== undefined && (typeof model.planIdentity !== 'string' || !model.planIdentity || model.planIdentity.length > 256))) {
      throw invalid('reploid.model pins a sha256 identity, at most one sha256 adapter identity and an optional plan identity');
    }
  }
  if (value.poolId !== undefined && (typeof value.poolId !== 'string' || !value.poolId || value.poolId.length > 256)) throw invalid('Invalid reploid.poolId');
  if (value.conversationId !== undefined && (typeof value.conversationId !== 'string' || !value.conversationId
    || value.conversationId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(value.conversationId))) throw invalid('Invalid reploid.conversationId');
  if (value.execution !== undefined) {
    try { compileExecutionRequirements(value.execution); }
    catch (error) {
      throw executionFailure(Object.hasOwn(EXECUTION_ERROR_STATUS, error.code) ? error : Object.assign(error, { code: 'EXECUTION_REQUEST_INVALID' }));
    }
    if (value.execution.placement !== 'network-allowed') throw invalid('This API runs on network participants; local-only placement is not available here');
  }
  return freeze(structuredClone(value));
}
