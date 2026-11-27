import { randomUUID } from 'node:crypto';
import { availablePartitionRoute, currentPartitionRoute, matchesPartitionDisclosure } from '../apps/poolday/host/partition-release.js';
import { createExecutionPolicy, compileExecutionRequirements, EXECUTION_BACKENDS, EXECUTION_METADATA, PROTECTIONS, PROTECTION_ROUTES } from '../shared/vendor/reploid/chat/execution-policy.js';
import { createInference, describeDisclosure, FREE } from '../shared/vendor/reploid/inference/index.js';
import { partitionAdapterIdentities } from '../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { setTimeout as delay } from 'node:timers/promises';
import chatModels from '../shared/config/chat-models.json' with { type: 'json' };
import { sendIntentArtifact, sendIntentPermits, sendIntentRefusal, validateSendIntent } from '../shared/vendor/reploid/chat/index.js';

/** `--send-intent`: a reploid.send-intent/1 record as JSON, read by the shared validator. */
export function parseAskSendIntent(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw Object.assign(Error('Invalid send intent: --send-intent takes one JSON record'), { code: 'SEND_INTENT_INVALID' }); }
  return validateSendIntent(value);
}

/**
 * The route `reploid ask` takes when no model is named: the smallest ready model, by its place in the catalog
 * (chat-models.json lists models from smallest to largest), whole-model routes before split ones.
 */
export function smallestServed(eligible, catalog = chatModels) {
  const order = id => { const index = (catalog || chatModels).findIndex(row => row.id === id); return index < 0 ? Infinity : index; };
  return [...eligible].sort((a, b) => Number(!!a.partition) - Number(!!b.partition) || order(a.id) - order(b.id))[0] ?? null;
}

/**
 * `reploid ask` without execution flags: plaintext on any route a provider offers (`auto`), any eligible provider may
 * read the prompt, and the metadata a plaintext route discloses is allowed. Open participants permit discovery, not
 * disclosure: the recipient is still checked against the plan before anything is sent.
 */
export const DEFAULT_ASK_EXECUTION = Object.freeze({ protection: 'plaintext', route: 'auto',
  participants: Object.freeze({ kind: 'open' }), allowMetadata: Object.freeze([...EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata]) });
/** `--route` values `ask` can run: it asks network providers only, and it cannot bind edge devices to the requester. */
export const ASK_ROUTES = Object.freeze(['remote', 'split', 'auto']);

/** The inference requirements `reploid ask` flags select. Unknown values are refused here, before discovery. */
export function askExecution({ participants = [], protection = 'plaintext', route = 'auto', allowMetadata } = {}) {
  const metadata = allowMetadata === undefined ? [...DEFAULT_ASK_EXECUTION.allowMetadata]
    : allowMetadata.split(',').map(item => item.trim()).filter(Boolean);
  if (metadata.some(item => !EXECUTION_METADATA.includes(item))) throw Error(`--allow-metadata takes ${EXECUTION_METADATA.join(', ')}`);
  if (!PROTECTIONS.includes(protection)) throw Error(`--protection is one of ${PROTECTIONS.join(', ')}`);
  if (!PROTECTION_ROUTES[protection].includes(route)) throw Error(`--protection ${protection} takes --route ${PROTECTION_ROUTES[protection].join(', ')}`);
  if (route === 'local') throw Error('--route local runs on this device; ask sends to network providers. Use remote, split or auto');
  if (route === 'split-local-edges') {
    throw Error('--route split-local-edges needs both edge devices bound to you, which ask cannot establish. Nothing was sent; use split, remote or auto');
  }
  return { protection, route,
    participants: participants.length ? { kind: 'named', ids: [...new Set(participants)] } : { kind: 'open' }, allowMetadata: metadata };
}

/** A route `ask` may use now: ready, without an adapter, and for a split outside a private room, released.
 * `reploid peers` counts "ready to serve" with this same test. */
export const askableRoute = (candidate, executionClass) => candidate.availability === 'ready' && !candidate.adapters?.length
  && (!candidate.partition || executionClass === 'private-pool' || availablePartitionRoute(candidate));

/** One prompt through `reploid/inference`, the same API the browser and the SDK use. */
export async function askMesh(participant, model, prompt, { signal, report = console.error, discoveryMs = 45000, generationMs = 120000,
  execution = DEFAULT_ASK_EXECUTION, anyModel = false, catalog = null, settleMs = 2000, sendIntent = null } = {}) {
  // Protections this command cannot run (secret-sharing, homomorphic, attested) and malformed requirements fail before
  // discovery or any message, with their stable codes. Nothing is retried as plaintext.
  compileExecutionRequirements(structuredClone(execution));
  const routeKind = execution.route;
  // A Send intent bounds the wait for a route at its expiry, whatever discovery is doing, and a pin admits only its artifact.
  const discovery = AbortSignal.timeout(sendIntent ? Math.max(0, Math.min(discoveryMs, sendIntent.expiresAt - Date.now())) : discoveryMs);
  const permitted = candidate => !sendIntent || sendIntentPermits(sendIntent, sendIntentArtifact({ identity: candidate.identity,
    adapterIdentities: partitionAdapterIdentities(candidate) }));
  const waiting = AbortSignal.any([signal, discovery]);
  let route, firstReadyAt = null;
  try {
    for (;;) {
      waiting.throwIfAborted();
      const eligible = (participant.getState().models || []).filter(candidate =>
        (anyModel || candidate.id === model.id && candidate.identity === model.identity) && askableRoute(candidate, participant.executionClass) && permitted(candidate)
        // An explicit route is held exactly; auto may choose either.
        && (routeKind === 'auto' || (routeKind === 'split') === Boolean(candidate.partition)));
      route = anyModel ? smallestServed(eligible, catalog) : eligible.find(candidate => !candidate.partition) ?? eligible[0];
      // Providers advertise one by one: without a named model, a smaller one has a moment to appear after the first.
      if (route && anyModel && (firstReadyAt ??= Date.now()) + settleMs > Date.now()) route = null;
      if (route) break;
      await delay(200, undefined, { signal: waiting });
    }
  } catch (error) {
    signal.throwIfAborted();
    if (discovery.aborted) throw Error(anyModel ? `No ready provider for any model in room ${participant.roomId}. Check discovery with reploid connect.`
      : `No ready provider for ${model.name} in room ${participant.roomId}. Check discovery with reploid connect.`);
    throw error;
  }
  if (anyModel) { model = route; report(`Asking ${route.name}, the smallest model a ready provider serves.`); }
  // Checked again right before anything is created or sent: past the expiry, or for another artifact, nothing is.
  if (sendIntent && sendIntentRefusal(sendIntent, { now: Date.now(), selectionRevision: sendIntent.selectionRevision,
    artifact: sendIntentArtifact({ identity: route.identity, adapterIdentities: partitionAdapterIdentities(route) }) })) {
    throw Error(`No ready provider for ${model?.name ?? 'any model'} in room ${participant.roomId}. Check discovery with reploid connect.`);
  }
  const threadId = sendIntent?.threadId ?? randomUUID(), attemptId = randomUUID();
  const stages = route.partition && [...new Set(route.partition.route?.stages?.map(stage => stage.participantId)
    ?? [route.partition.participantA, route.partition.participantB])];
  const messages = [{ role: 'user', content: prompt }];
  // Charge: free. `ask` sends through a mesh participant with no service-credit path; nothing here reserves or pays.
  const inference = createInference({
    resolveRoute: (_request, { context }) => context.stages
      ? { shape: 'split', backend: 'doppler-partition-plaintext/v1', participants: context.stages, selection: 'all', planIdentity: route.partition.planId ?? null, maxCharge: FREE }
      : context.execution.participants.kind === 'named'
        ? { shape: 'remote', backend: 'doppler-plaintext/v1', participants: [...context.execution.participants.ids], selection: 'one-of', maxCharge: FREE }
        : { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible', maxCharge: FREE },
    // A split binds its exact stages; the plan already checked they are within the caller's participants.
    execute: ({ policy, request }, controls) => participant.generate({ model: route, threadId, attemptId, messages: request.messages,
      privacy: stages ? createExecutionPolicy({ ...policy, recipients: { kind: 'named', ids: stages } }) : policy }, controls)
  });
  const context = { stages, execution };
  const runSignal = AbortSignal.any([signal, AbortSignal.timeout(generationMs)]);
  const plan = await inference.prepare({ model: { id: model.id, identity: model.identity, adapterIdentities: partitionAdapterIdentities(route) },
    execution }, { signal: runSignal, context });
  const run = await inference.run({ planId: plan.id, requestId: attemptId, input: { messages } }, { signal: runSignal, context, attemptId,
    approve(preview) {
      if (route.partition && (!matchesPartitionDisclosure(route.partition, preview)
        || (participant.executionClass !== 'private-pool' && !currentPartitionRoute(route, participant.getState().models || [])))) return false;
      const recipients = preview.recipients ?? preview.input?.recipients;
      const previewed = preview.input?.messages;
      if (preview.modelId !== model.id || preview.modelIdentity !== model.identity || preview.threadId !== threadId
        || preview.attemptId !== attemptId || preview.adapterIdentities?.length || !Array.isArray(recipients)
        || !recipients.length || !recipients.every(id => typeof id === 'string' && id.length)
        || previewed?.length !== 1 || previewed[0].role !== 'user' || previewed[0].content !== prompt) return false;
      if (stages && (stages.some(id => !recipients.includes(id))
        || recipients.some(id => id !== participant.identity && !stages.includes(id)))) return false;
      report(`Sending to ${recipients.join(', ')} in ${participant.roomId}. ${describeDisclosure(plan.disclosure)}`);
      return true;
    } });
  const result = await run.result;
  if (result.status !== 'completed') throw Object.assign(Error(result.error.message), { code: result.error.code });
  return result.output.text;
}
