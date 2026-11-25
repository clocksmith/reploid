import { randomUUID } from 'node:crypto';
import { availablePartitionRoute, currentPartitionRoute, matchesPartitionDisclosure } from '../apps/poolday/host/partition-release.js';
import { createExecutionPolicy, compileExecutionRequirements, EXECUTION_BACKENDS, EXECUTION_METADATA } from '../shared/vendor/reploid/chat/execution-policy.js';
import { createInference } from '../shared/vendor/reploid/inference/index.js';
import { partitionAdapterIdentities } from '../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { setTimeout as delay } from 'node:timers/promises';

/** `reploid ask` without execution flags: any eligible provider may read the prompt, and the metadata a plaintext route discloses is allowed. */
export const DEFAULT_ASK_EXECUTION = Object.freeze({ placement: 'network-allowed', participants: Object.freeze({ kind: 'open' }),
  confidentiality: 'executor-readable', allowMetadata: Object.freeze([...EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata]) });

/** The inference requirements `reploid ask` flags select. Unknown values are refused here, before discovery. */
export function askExecution({ participants = [], confidentiality = 'executor-readable', allowMetadata } = {}) {
  const metadata = allowMetadata === undefined ? [...DEFAULT_ASK_EXECUTION.allowMetadata]
    : allowMetadata.split(',').map(item => item.trim()).filter(Boolean);
  if (metadata.some(item => !EXECUTION_METADATA.includes(item))) throw Error(`--allow-metadata takes ${EXECUTION_METADATA.join(', ')}`);
  if (!['executor-readable', 'requester-only'].includes(confidentiality)) throw Error('--confidentiality is executor-readable or requester-only');
  return { placement: 'network-allowed', participants: participants.length ? { kind: 'named', ids: [...new Set(participants)] } : { kind: 'open' },
    confidentiality, allowMetadata: metadata };
}

/** A route `ask` may use now: ready, without an adapter, and for a split outside a private room, released.
 * `reploid peers` counts "ready to serve" with this same test. */
export const askableRoute = (candidate, executionClass) => candidate.availability === 'ready' && !candidate.adapters?.length
  && (!candidate.partition || executionClass === 'private-pool' || availablePartitionRoute(candidate));

/** One prompt through `reploid/inference`, the same API the browser and the SDK use. */
export async function askMesh(participant, model, prompt, { signal, report = console.error, discoveryMs = 45000, generationMs = 120000,
  execution = DEFAULT_ASK_EXECUTION } = {}) {
  // Unsupported guarantees (requester-only) and malformed requirements fail before discovery or any message.
  compileExecutionRequirements(structuredClone(execution));
  const discovery = AbortSignal.timeout(discoveryMs);
  const waiting = AbortSignal.any([signal, discovery]);
  let route;
  try {
    for (;;) {
      waiting.throwIfAborted();
      const eligible = (participant.getState().models || []).filter(candidate =>
        candidate.id === model.id && candidate.identity === model.identity && askableRoute(candidate, participant.executionClass));
      route = eligible.find(candidate => !candidate.partition) ?? eligible[0];
      if (route) break;
      await delay(200, undefined, { signal: waiting });
    }
  } catch (error) {
    signal.throwIfAborted();
    if (discovery.aborted) throw Error(`No ready provider for ${model.name} in room ${participant.roomId}. Check discovery with reploid connect.`);
    throw error;
  }
  const threadId = randomUUID(), attemptId = randomUUID();
  const stages = route.partition && [...new Set(route.partition.route?.stages?.map(stage => stage.participantId)
    ?? [route.partition.participantA, route.partition.participantB])];
  const messages = [{ role: 'user', content: prompt }];
  const inference = createInference({
    resolveRoute: (_request, { context }) => context.stages
      ? { shape: 'split', backend: 'doppler-partition-plaintext/v1', participants: context.stages, selection: 'all', planIdentity: route.partition.planId ?? null }
      : context.execution.participants.kind === 'named'
        ? { shape: 'remote', backend: 'doppler-plaintext/v1', participants: [...context.execution.participants.ids], selection: 'one-of' }
        : { shape: 'remote', backend: 'doppler-plaintext/v1', selection: 'any-eligible' },
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
      report(`Sending to ${recipients.join(', ')} in ${participant.roomId}. ${plan.disclosures.statement}`);
      return true;
    } });
  const result = await run.result;
  if (result.status !== 'completed') throw Object.assign(Error(result.error.message), { code: result.error.code });
  return result.output.text;
}
