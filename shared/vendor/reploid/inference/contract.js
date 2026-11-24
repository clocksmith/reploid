/**
 * The `reploid/inference` contract: request shapes, route descriptions, disclosures, refusals and the
 * execution receipt. Pure validation and record building; `index.js` owns plans, runs and events.
 *
 * A receipt records what this requester checked. It never states that an executor behaved honestly,
 * computed correctly, erased its input or ran attested hardware.
 */
import { hashJson } from '../artifacts/signatures.js';
import { canonicalPartitionJson } from '../contracts/partition.js';
import {
  EXECUTION_ERROR_CODES, EXECUTION_METADATA, executionError, executionBackend,
  compileExecutionRequirements, narrowsExecutionPolicy
} from '../chat/execution-policy.js';

export { EXECUTION_ERROR_CODES, executionError };
export const INFERENCE_API_VERSION = 'reploid.inference/v1';
export const EXECUTION_ROUTE_SCHEMA = 'reploid.inference-route/v1';
export const EXECUTION_RECEIPT_SCHEMA = 'reploid.execution-receipt/v1';
export const INFERENCE_EVENT_TYPES = Object.freeze(['admitted', 'output.delta', 'completed', 'cancelled', 'failed']);
export const ROUTE_SHAPES = Object.freeze(['local', 'remote', 'split']);
/** all: every participant reads content. one-of: exactly one named participant will. any-eligible: one provider chosen at admission. */
export const ROUTE_SELECTIONS = Object.freeze(['all', 'one-of', 'any-eligible']);

const invalid = message => executionError('EXECUTION_REQUEST_INVALID', message);
const changed = message => executionError('EXECUTION_PLAN_CHANGED', `${message}. Nothing was sent.`);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
export const freezeDeep = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
};
const onlyKeys = (value, allowed, name) => {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw invalid(`${name} does not accept ${extra.join(', ')}`);
};

/** A pinned artifact: exact model identity and the exact adapters, in order. */
export function validateModelPin(model) {
  if (!object(model)) throw invalid('model must be { id, identity, adapterIdentities? }');
  onlyKeys(model, ['id', 'identity', 'adapterIdentities'], 'model');
  const adapterIdentities = model.adapterIdentities ?? [];
  if (!label(model.id) || !digest(model.identity) || !Array.isArray(adapterIdentities) || adapterIdentities.length > 8
    || !adapterIdentities.every(digest) || new Set(adapterIdentities).size !== adapterIdentities.length) {
    throw invalid('model needs an id, a sha256 identity and distinct sha256 adapter identities');
  }
  return { id: model.id, identity: model.identity, adapterIdentities: [...adapterIdentities] };
}

/** prepare() input. It takes no prompts, tools or prompt hashes: only the pin, limits and requirements. */
export function validatePrepareRequest(input) {
  if (!object(input)) throw invalid('prepare needs { model, generation?, execution }');
  onlyKeys(input, ['model', 'generation', 'execution'], 'prepare (it takes no prompts, tools or prompt hashes)');
  const model = validateModelPin(input.model);
  let generation = { maxOutputTokens: null };
  if (input.generation !== undefined) {
    if (!object(input.generation)) throw invalid('generation must be an object');
    onlyKeys(input.generation, ['maxOutputTokens'], 'generation');
    const limit = input.generation.maxOutputTokens;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) throw invalid('generation.maxOutputTokens must be a positive integer');
    generation = { maxOutputTokens: limit ?? null };
  }
  if (!object(input.execution)) throw invalid('execution requirements are required');
  const execution = structuredClone(input.execution);
  // Refusals (CONFIDENTIAL_EXECUTION_UNAVAILABLE, EXECUTION_REQUEST_INVALID) come from the one compiler.
  const policy = compileExecutionRequirements(execution);
  return freezeDeep({ model, generation, execution, policy });
}

/** run() input: a prepared plan, the caller's idempotency key, and the content. */
export function validateRunRequest(input) {
  if (!object(input)) throw invalid('run needs { planId, requestId, input: { messages } }');
  onlyKeys(input, ['planId', 'requestId', 'input'], 'run');
  if (!label(input.planId)) throw invalid('planId is required');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.requestId)) {
    throw invalid('requestId must be 1 to 128 letters, digits, dots, colons, underscores or hyphens');
  }
  if (!object(input.input)) throw invalid('input must be { messages }');
  onlyKeys(input.input, ['messages'], 'input');
  const { messages } = input.input;
  if (!Array.isArray(messages) || !messages.length || messages.length > 256
    || !messages.every(message => object(message) && typeof message.role === 'string' && typeof message.content === 'string')) {
    throw invalid('input.messages must be 1 to 256 messages with a role and text content');
  }
  return { planId: input.planId, requestId: input.requestId, messages: structuredClone(messages) };
}

/** The resolver's candidate route, checked and given an identity. Nothing has been sent at this point. */
export async function describeRoute(candidate, model) {
  if (!object(candidate)) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'No route can run this request. Nothing was sent.');
  const backend = executionBackend(candidate.backend);
  const participants = candidate.participants ?? [];
  const selection = candidate.selection ?? 'all';
  if (!backend) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', `Backend ${candidate.backend} is not qualified here. Nothing was sent.`);
  const listed = Array.isArray(participants) && participants.length <= 128 && participants.every(label)
    && new Set(participants).size === participants.length;
  const complete = candidate.shape === 'local' ? participants.length === 0 && selection === 'all'
    : selection === 'any-eligible' ? candidate.shape === 'remote' && participants.length === 0 : participants.length > 0;
  if (!ROUTE_SHAPES.includes(candidate.shape) || !ROUTE_SELECTIONS.includes(selection) || !listed || !complete) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved route is incomplete. Nothing was sent.');
  }
  const maxCharge = candidate.maxCharge ?? null;
  const planIdentity = candidate.planIdentity ?? null;
  if (planIdentity !== null && (!label(planIdentity) || candidate.shape !== 'split')) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'Only a split route has a partition plan identity. Nothing was sent.');
  }
  if (maxCharge !== null && !(object(maxCharge) && Number.isSafeInteger(maxCharge.maximum) && maxCharge.maximum >= 0 && label(maxCharge.unit))) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved route has an invalid charge ceiling. Nothing was sent.');
  }
  const route = { schema: EXECUTION_ROUTE_SCHEMA, shape: candidate.shape, selection, participants: [...participants].sort(),
    backend: candidate.backend, protocol: backend.protocol, model: structuredClone(model), planIdentity };
  return { route: freezeDeep({ id: await hashJson(route), ...route }), maxCharge: maxCharge && freezeDeep({ ...maxCharge }) };
}

/** Who can read content on this route, and what metadata its backend exposes beyond them. Not a copy of the permission. */
export function routeDisclosures(route, execution) {
  const backend = executionBackend(route.backend);
  const local = route.shape === 'local';
  const named = execution.participants.kind === 'named';
  const readers = local ? 'Only this device reads the content.'
    : route.selection === 'any-eligible' ? 'One eligible provider reads the content in plaintext. It is identified, and checked against this plan, before anything is sent.'
      : route.selection === 'one-of' ? 'One of the listed participants reads the content in plaintext.'
        : 'Every listed participant reads the content in plaintext.';
  return freezeDeep({
    contentReadableBy: { requesterDevice: local, participants: [...route.participants], selection: route.selection },
    executorsReadContent: backend.executorsReadContent,
    metadata: local ? [] : [...backend.metadata],
    statement: [readers,
      named && !local ? 'They are the participants you named. Naming your own devices limits readers to those devices; Reploid does not check who owns them.' : null,
      local ? 'No network participant receives the content or its metadata.' : `The route can also expose ${backend.metadata.join(', ')} to coordinators, credit ledgers and relays that carry it.`,
      'No backend that keeps content from its executors is qualified.'].filter(Boolean).join(' ')
  });
}

export function assertLeakageAllowed(disclosures, allowMetadata) {
  const missing = disclosures.metadata.filter(item => !allowMetadata.includes(item));
  if (missing.length) throw executionError('LEAKAGE_NOT_ALLOWED', `This route exposes ${missing.join(', ')}, which the request does not allow. Nothing was sent.`);
}

/** The prepared route must stay within the caller's placement and participants. */
export function assertRouteWithinRequirements(route, execution) {
  const { placement, participants } = execution;
  if (placement === 'local-only' && route.shape !== 'local') throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'Local-only execution has no local route. Nothing was sent.');
  if (participants.kind === 'named' && !route.participants.every(id => participants.ids.includes(id))) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The only available route includes a participant that was not named. Nothing was sent.');
  }
}

/**
 * Check a disclosure preview against the plan before the caller's approval is asked and before content leaves.
 * Returns the admitted route; any substitution of backend, model, adapters or participants is EXECUTION_PLAN_CHANGED.
 */
export function admitRoute(plan, policy, binding) {
  const { route } = plan;
  if (!object(binding) || !object(binding.route) || !Array.isArray(binding.route.hops)) throw changed('The route has no execution binding');
  if (binding.route.backend !== route.backend || binding.route.protocol !== route.protocol) throw changed('The backend changed');
  if (binding.route.modelId !== route.model.id || binding.route.modelIdentity !== route.model.identity
    || !same(binding.route.adapterIdentities, route.model.adapterIdentities)) throw changed('The model or adapters changed');
  if (!narrowsExecutionPolicy(policy, binding.policy)) throw changed('The route policy is broader than the request');
  const remote = binding.route.hops.filter(hop => hop.placement === 'remote').map(hop => hop.recipient);
  const local = binding.route.hops.length - remote.length;
  const fits = route.shape === 'local' ? remote.length === 0 && local > 0
    : local === 0 && (route.selection === 'all' ? same([...remote].sort(), route.participants)
      : route.selection === 'one-of' ? remote.length === 1 && route.participants.includes(remote[0])
        : remote.length === 1);
  if (!fits) throw changed('The participants differ from the prepared route');
  return freezeDeep({ id: binding.routeId, planRouteId: route.id, policyId: binding.policyId, shape: route.shape,
    participants: [...remote].sort(), backend: route.backend, protocol: route.protocol });
}

/** A local route never asks for disclosure approval; its admission is the plan itself. */
export function admitLocalRoute(plan) {
  return freezeDeep({ id: null, planRouteId: plan.route.id, policyId: null, shape: 'local', participants: [],
    backend: plan.route.backend, protocol: plan.route.protocol });
}

const STOP_REASONS = ['length', 'max-tokens', 'stop', 'eos', 'eos-token', 'stop-token', 'stop-sequence', 'context-limit'];

/** Check an executor's answer against the plan. Anything unexpected is RESULT_UNVERIFIED, never a success. */
export function readExecutorResult(plan, raw, streamed) {
  const unverified = message => executionError('RESULT_UNVERIFIED', message);
  if (!object(raw) || typeof raw.content !== 'string') throw unverified('The executor returned no text answer');
  const { model } = plan.route;
  if (raw.modelIdentity !== model.identity || (raw.modelId ?? raw.model) !== model.id) throw unverified('The answer names a different model');
  if (!same(raw.adapterIdentities ?? [], model.adapterIdentities)) throw unverified('The answer names different adapters');
  if (streamed !== null && streamed !== raw.content) throw unverified('The final answer differs from its streamed text');
  // A provider that predates completion metadata reports no reason: the answer is whole, its reason unknown.
  const stopReason = raw.execution?.stopReason ?? raw.execution?.completion?.stopReason ?? null;
  if (stopReason !== null && !STOP_REASONS.includes(stopReason)) throw unverified('The answer has an unrecognized termination reason');
  const completion = raw.execution?.completion;
  const usage = Number.isSafeInteger(raw.usage?.inputTokens) && Number.isSafeInteger(raw.usage?.outputTokens)
    ? { inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens }
    : Number.isSafeInteger(completion?.promptTokenCount) && Number.isSafeInteger(completion?.generatedTokenCount)
      ? { inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount } : null;
  const limit = plan.generation.maxOutputTokens;
  if (limit !== null && usage && usage.outputTokens > limit) throw unverified('The answer exceeds the output limit');
  return {
    output: { text: raw.content, stopReason,
      finishReason: stopReason === null ? 'unknown' : ['length', 'max-tokens', 'context-limit'].includes(stopReason) ? 'length' : 'stop' },
    usage,
    settlement: raw.serviceCredit ?? raw.execution?.serviceCredit ?? null,
    providerReceipt: raw.execution?.executionReceipt ?? raw.execution?.receipt ?? null
  };
}

const NOT_CONFIDENTIAL = ['recipient-conduct', 'erasure', 'hardware-attestation', 'cryptographic-protection'];

/** The receipt binds the requested policy, the actual route, backend and protocol identity, and the disclosures. */
export async function executionReceipt({ plan, requestId, attemptId, status, admitted, read = null }) {
  const local = admitted?.shape === 'local';
  return freezeDeep({
    schema: EXECUTION_RECEIPT_SCHEMA, api: INFERENCE_API_VERSION, requestId, attemptId, planId: plan.id, status,
    requested: { model: structuredClone(plan.route.model), execution: structuredClone(plan.execution), policyId: plan.policyId },
    route: admitted ? { planRouteId: plan.route.id, admittedRouteId: admitted.id, policyId: admitted.policyId, shape: admitted.shape,
      participants: [...admitted.participants], backend: admitted.backend, protocol: admitted.protocol, planIdentity: plan.route.planIdentity } : null,
    disclosures: structuredClone(plan.disclosures),
    evidence: {
      confidentiality: {
        mode: 'executor-readable',
        contentReadBy: admitted ? { requesterDevice: local, participants: [...admitted.participants] } : null,
        verified: admitted ? [{ claim: local ? 'content-stayed-on-requester-device' : 'content-recipients', by: 'requester',
          method: local ? 'local-route' : 'route-binding-before-disclosure', value: [...admitted.participants] }] : [],
        notVerified: NOT_CONFIDENTIAL
      },
      integrity: {
        verified: read ? [
          { claim: 'model-identity', by: 'requester', method: 'answer-identity', value: plan.route.model.identity },
          { claim: 'adapter-identities', by: 'requester', method: 'answer-identity', value: [...plan.route.model.adapterIdentities] },
          { claim: 'stream-matches-answer', by: 'requester', method: 'text-comparison' }
        ] : [],
        providerReceipt: read?.providerReceipt ? { digest: await hashJson(read.providerReceipt), checkedHere: false } : null,
        notVerified: ['correct-computation', 'reported-token-counts', ...(read?.output?.stopReason === null ? ['termination-reason'] : [])]
      }
    }
  });
}

export const metadataNames = () => [...EXECUTION_METADATA];
