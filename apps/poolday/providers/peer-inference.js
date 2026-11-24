/**
 * Reploid peer inference for Poolday surfaces outside conversations: Work's network steps, Work's AskPeer and the
 * model-imitation study. Every request is prepared and run through `reploid/inference`, so it gets the same pinned
 * route, admission check, stable refusal codes and execution receipt as conversations, the CLI and the HTTP adapters.
 *
 * `generateOnPeer` is the internal peer binding: one whole request to one Reploid peer over the text swarm. Only
 * inference execute ports call it (the one below, and the conversation port in host/chat-execution.js).
 *
 * Boundary: Work's local steps (this device's Doppler runtime) and injected non-Doppler cloud adapters are not
 * Reploid peer inference. They keep their own paths in work-network-provider.js and never pass through here.
 */
import { createInference, executionError, EXECUTION_ERROR_CODES } from '../../../shared/vendor/reploid/inference/index.js';
import { executionRequirementsFor } from '../../../shared/vendor/reploid/chat/execution-policy.js';
import { readWorkGenerationCompletion } from './work-generation-completion.js';

const adapterIdentitiesOf = model => (model.adapters || []).map(adapter => adapter.identity);

/** The internal peer binding. `approve` must be an inference port's `requestApproval`, which checks the plan first. */
export async function generateOnPeer({ swarm, model, privacy, messages, signal, approve, record, onPartial, contextId, onProgress }) {
  const adapterIdentities = adapterIdentitiesOf(model);
  await swarm.connect?.({ automatic: true });
  signal.throwIfAborted();
  onProgress?.(swarm.hasProvider?.(model.id) ? 'Awaiting peer approval' : 'Waiting for a ready contributor');
  // Once a peer is selected, refusal or failure cannot trigger an undisclosed retry.
  const result = await swarm.generate(messages, { approve, record, modelId: model.id, modelIdentity: model.identity,
    adapterIdentities, signal, onPartial, contextId, privacy });
  if (result.model !== model.id || result.provider !== 'doppler') throw new Error('Peer returned an incompatible model identity');
  if (JSON.stringify(result.adapterIdentities || []) !== JSON.stringify(adapterIdentities)) {
    throw new Error('Peer returned an incompatible adapter identity');
  }
  return result;
}

/** The answer as the inference API reads it: exact identities, text and the completion the peer reported. */
const inferenceAnswer = raw => {
  const completion = readWorkGenerationCompletion(raw);
  return { content: raw.content, model: raw.model, modelIdentity: raw.modelIdentity, adapterIdentities: raw.adapterIdentities || [],
    ...(raw.usage ? { usage: raw.usage } : {}), execution: { completion, stopReason: completion?.stopReason ?? null } };
};

export function createPeerInference({ swarm }) {
  const unavailable = message => executionError('EXECUTION_ROUTE_UNAVAILABLE', `${message} Nothing was sent.`);
  const inference = createInference({
    // Describes the route the swarm will bind, without sending anything.
    resolveRoute({ policy }) {
      if (policy.placement !== 'network-allowed' || policy.recipients.kind === 'none') throw unavailable('Peer inference needs network placement.');
      if (typeof swarm?.generate !== 'function') throw unavailable('No connected participant can execute this model.');
      return policy.recipients.kind === 'named'
        ? { shape: 'remote', backend: 'doppler-plaintext/v1', participants: [...policy.recipients.ids], selection: 'one-of' }
        : { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible' };
    },
    async execute({ policy, request }, controls, context) {
      try {
        context.raw = await generateOnPeer({ swarm, model: context.model, privacy: policy, messages: request.messages,
          signal: controls.signal, contextId: context.contextId, onProgress: context.onProgress, record: context.record,
          approve: preview => controls.requestApproval(preview),
          onPartial: text => { controls.onDelta({ text }); context.onPartial?.(text); } });
        return inferenceAnswer(context.raw);
      } catch (error) { context.failure = error; throw error; }
    }
  });

  /**
   * Prepare and run one whole request on a Reploid peer. `approve(preview, route)` is asked only after the preview's
   * binding matched the plan. Resolves to the peer's result with the inference API's `executionReceipt`.
   */
  async function generate({ model, privacy, messages, approve = null, record, signal, onPartial, contextId, onProgress,
    requestId = crypto.randomUUID() }) {
    if (model?.provider !== 'doppler' || model.partition) throw unavailable('Peer inference runs whole Doppler models only.');
    const context = { model, contextId, onProgress, record, onPartial, raw: null, failure: null };
    // A requester-only policy compiles to CONFIDENTIAL_EXECUTION_UNAVAILABLE here and is never relaxed or made local.
    const plan = await inference.prepare({ model: { id: model.id, identity: model.identity, adapterIdentities: adapterIdentitiesOf(model) },
      execution: executionRequirementsFor(privacy) }, { signal, context });
    const run = await inference.run({ planId: plan.id, requestId, input: { messages } }, { signal, approve, context });
    const result = await run.result;
    if (result.status === 'completed') return { ...context.raw, executionReceipt: result.executionReceipt };
    // The peer binding's own error stands unless the inference layer refused first.
    if (context.failure && !Object.hasOwn(EXECUTION_ERROR_CODES, result.error.code)) throw context.failure;
    throw Object.assign(new Error(result.error.message), { code: result.error.code, executionReceipt: result.executionReceipt });
  }
  return Object.freeze({ generate });
}
