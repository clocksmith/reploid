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
  EXECUTION_ERROR_CODES, EXECUTION_METADATA, executionError, executionBackend, EDGES_BACKEND,
  compileExecutionRequirements, compileProtectedExecutionRequirements, compileSecretSharedExecutionRequirements, narrowsExecutionPolicy
} from '../chat/execution-policy.js';

/** The secret-shared split backend: two-party additive shares per stage (inference/secret-shared.js). */
export const SECRET_SHARED_BACKEND = 'doppler-secret-shared-2party/v1';

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
export function validatePrepareRequest(input, { protectedProtocol = null, secretShared = false } = {}) {
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
  // Only a host that enabled the unreviewed protected route passes `protectedProtocol`; then requester-only compiles
  // to the protected policy. Every other refusal (CONFIDENTIAL_EXECUTION_UNAVAILABLE, EXECUTION_REQUEST_INVALID)
  // comes from the one compiler.
  if (protectedProtocol !== null && execution.confidentiality === 'requester-only') {
    return freezeDeep({ model, generation, execution, policy: compileProtectedExecutionRequirements(execution, protectedProtocol), protected: true });
  }
  // Only a host that enabled the unreviewed secret-shared route passes `secretShared`; otherwise the one compiler refuses it.
  if (secretShared === true && execution.confidentiality === 'secret-shared-2party') {
    return freezeDeep({ model, generation, execution, policy: compileSecretSharedExecutionRequirements(execution), secretShared: true });
  }
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
  // An edges route names, among its participants, the two requester-held stages that read content; the rest read activations.
  const edges = candidate.backend === EDGES_BACKEND;
  const edgeParticipants = candidate.edgeParticipants ?? null;
  if (edges ? !(candidate.shape === 'split' && selection === 'all' && Array.isArray(edgeParticipants) && edgeParticipants.length === 2
      && new Set(edgeParticipants).size === 2 && edgeParticipants.every(id => participants.includes(id)) && participants.length >= 3)
    : edgeParticipants !== null) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'The resolved edges route is incomplete. Nothing was sent.');
  }
  const route = { schema: EXECUTION_ROUTE_SCHEMA, shape: candidate.shape, selection, participants: [...participants].sort(),
    backend: candidate.backend, protocol: backend.protocol, model: structuredClone(model), planIdentity,
    ...(edges ? { edgeParticipants: [...edgeParticipants].sort() } : {}) };
  return { route: freezeDeep({ id: await hashJson(route), ...route }), maxCharge: maxCharge && freezeDeep({ ...maxCharge }) };
}

/** Who can read content on this route, and what metadata its backend exposes beyond them. Not a copy of the permission. */
export function routeDisclosures(route, execution) {
  const backend = executionBackend(route.backend);
  if (route.backend === EDGES_BACKEND) return edgesDisclosures(route, backend);
  const local = route.shape === 'local';
  const named = execution.participants.kind === 'named';
  // An executor that reads the content observes its access patterns; the rest also reaches the carriers.
  const observed = backend.executorsReadContent && backend.metadata.includes('access-patterns');
  const carried = backend.metadata.filter(item => item !== 'access-patterns' || !backend.executorsReadContent);
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
      !local && observed ? 'Because they read the content, they can also see its access patterns.' : null,
      local ? 'No network participant receives the content or its metadata.' : `The route can also expose ${carried.join(', ')} to coordinators, credit ledgers and relays that carry it.`,
      'No backend that keeps content from its executors is qualified.'].filter(Boolean).join(' ')
  });
}

/**
 * Requester-held edges: who reads what, stated exactly. Content (prompt and answer, as text or token IDs) reaches only
 * the two edge stages. Every other stage reads plaintext activations, which an operator may invert into content.
 */
function edgesDisclosures(route, backend) {
  const middle = route.participants.filter(id => !route.edgeParticipants.includes(id));
  return freezeDeep({
    contentReadableBy: { requesterDevice: false, participants: [...route.edgeParticipants], selection: 'all' },
    activationsReadableBy: { participants: middle, selection: 'all' },
    executorsReadContent: false,
    metadata: [...backend.metadata],
    statement: ['Your prompt and the answer, as text and as token IDs, are read only by the two stages you named as your own devices:',
      'they run the embedding, the first layers, the last layers, the final norm and the output head, and they tokenize, sample and detokenize.',
      'Every other stage receives intermediate activations and token counts, never token IDs or text.',
      'Activations are plaintext model state: an operator who reads them can try to reconstruct the prompt or the answer from them, so this is not confidential execution.',
      'Reploid does not check who owns the devices you name.',
      `The route can also expose ${backend.metadata.join(', ')} to the stages, coordinators, credit ledgers and relays that carry it.`,
      'No backend that keeps content from its executors is qualified.'].join(' ')
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
  // A secret-shared request never falls back to a readable route, and no other request runs on a secret-shared one.
  if ((execution.confidentiality === 'secret-shared-2party') !== (route.backend === SECRET_SHARED_BACKEND)) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', execution.confidentiality === 'secret-shared-2party'
      ? 'No secret-shared route is available. Nothing was sent; the request is not retried as readable.'
      : 'This route is reserved for secret-shared requests. Nothing was sent.');
  }
  // Requester-held edges never fall back to a route whose stages read content, and no other request runs on one.
  if ((execution.confidentiality === 'requester-edges') !== (route.backend === EDGES_BACKEND)) {
    throw executionError('EXECUTION_ROUTE_UNAVAILABLE', execution.confidentiality === 'requester-edges'
      ? 'No route keeps the prompt and answer on your own edge devices. Nothing was sent; the request is not retried as readable.'
      : 'This route is reserved for requester-held edges. Nothing was sent.');
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
  if (route.backend === EDGES_BACKEND) {
    const readers = binding.route.hops.filter(hop => hop.disclosure === 'plaintext').map(hop => hop.recipient).sort();
    if (!same(readers, route.edgeParticipants)) throw changed('The stages that read content differ from the prepared edges');
  }
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
    providerReceipt: raw.execution?.executionReceipt ?? raw.execution?.receipt ?? null,
    timeline: deliveryTimeline(raw.execution?.delivery)
  };
}

const DELIVERY_EVENTS = ['sent', 'resent', 'received', 'path-opened', 'path-failed', 'ice-restart', 'ice-restarted', 'ice-restart-failed'];
const DELIVERY_STAGES = ['admit', 'request'];
/** This requester's own record of how its request frames reached the recipient: each send, each re-send to
 * the same recipient, each acknowledgement and (protocol 2) each change of path on the same connection, in
 * milliseconds from the first frame. Null when none was kept. */
export function deliveryTimeline(delivery) {
  if (!object(delivery) || ![1, 2].includes(delivery.protocol) || !Array.isArray(delivery.timeline) || delivery.timeline.length > 64) return null;
  const rows = delivery.timeline.filter(row => object(row) && DELIVERY_EVENTS.includes(row.event) && DELIVERY_STAGES.includes(row.stage)
    && Number.isSafeInteger(row.attempt) && row.attempt > 0 && Number.isFinite(row.at) && row.at >= 0)
    .map(({ event, stage, attempt, at, path }) => ({ event, stage, attempt, at, ...(Number.isSafeInteger(path) && path >= 0 && path <= 8 ? { path } : {}) }));
  return rows.length ? rows : null;
}

const NOT_CONFIDENTIAL = ['recipient-conduct', 'erasure', 'hardware-attestation', 'cryptographic-protection'];
const NOT_CONFIDENTIAL_EDGES = [...NOT_CONFIDENTIAL, 'activation-inversion-resistance', 'edge-device-ownership'];

/** What the requester bound before disclosure on an edges route: who reads content, who reads activations only. */
function edgesEvidence(plan, admitted) {
  const readers = [...plan.route.edgeParticipants];
  const middle = admitted ? admitted.participants.filter(id => !readers.includes(id)) : [];
  return {
    mode: 'requester-edges',
    contentReadBy: admitted ? { requesterDevice: false, participants: readers } : null,
    activationsReadBy: admitted ? { participants: middle } : null,
    verified: admitted ? [
      { claim: 'content-recipients', by: 'requester', method: 'route-binding-before-disclosure', value: readers },
      { claim: 'activation-only-recipients', by: 'requester', method: 'route-binding-before-disclosure', value: middle }
    ] : [],
    notVerified: NOT_CONFIDENTIAL_EDGES
  };
}

/** The receipt binds the requested policy, the actual route, backend and protocol identity, and the disclosures. */
export async function executionReceipt({ plan, requestId, attemptId, status, admitted, read = null, timeline = null }) {
  const local = admitted?.shape === 'local';
  const edges = plan.route.backend === EDGES_BACKEND;
  timeline = read?.timeline ?? timeline;
  return freezeDeep({
    schema: EXECUTION_RECEIPT_SCHEMA, api: INFERENCE_API_VERSION, requestId, attemptId, planId: plan.id, status,
    // Observed by this requester and not signed by the provider. Present only when the route kept one.
    ...(timeline ? { timeline: structuredClone(timeline) } : {}),
    requested: { model: structuredClone(plan.route.model), execution: structuredClone(plan.execution), policyId: plan.policyId },
    route: admitted ? { planRouteId: plan.route.id, admittedRouteId: admitted.id, policyId: admitted.policyId, shape: admitted.shape,
      participants: [...admitted.participants], backend: admitted.backend, protocol: admitted.protocol, planIdentity: plan.route.planIdentity } : null,
    disclosures: structuredClone(plan.disclosures),
    evidence: {
      confidentiality: edges ? edgesEvidence(plan, admitted) : {
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
