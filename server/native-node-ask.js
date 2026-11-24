import { randomUUID } from 'node:crypto';
import { availablePartitionRoute, currentPartitionRoute, matchesPartitionDisclosure } from '../apps/poolday/host/partition-release.js';
import { createExecutionPolicy } from '../shared/vendor/reploid/chat/execution-policy.js';
import { setTimeout as delay } from 'node:timers/promises';

export async function askMesh(participant, model, prompt, { signal, report = console.error, discoveryMs = 45000, generationMs = 120000 } = {}) {
  const discovery = AbortSignal.timeout(discoveryMs);
  const waiting = AbortSignal.any([signal, discovery]);
  let route;
  try {
    for (;;) {
      waiting.throwIfAborted();
      const eligible = (participant.getState().models || []).filter(candidate =>
        candidate.id === model.id && candidate.identity === model.identity && candidate.availability === 'ready'
        && !candidate.adapters?.length && (!candidate.partition || participant.executionClass === 'private-pool' || availablePartitionRoute(candidate)));
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
  const stages = route.partition && (route.partition.route?.stages?.map(stage => stage.participantId)
    ?? [route.partition.participantA, route.partition.participantB]);
  const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: stages
    ? { kind: 'named', ids: [...new Set(stages)] } : { kind: 'open', ids: [] } });
  const result = await participant.generate({ model: route, threadId, attemptId, privacy, messages: [{ role: 'user', content: prompt }] }, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(generationMs)]),
    requestApproval(preview) {
      if (route.partition && (!matchesPartitionDisclosure(route.partition, preview)
        || (participant.executionClass !== 'private-pool' && !currentPartitionRoute(route, participant.getState().models || [])))) return false;
      const recipients = preview.recipients ?? preview.input?.recipients;
      const messages = preview.input?.messages;
      if (preview.modelId !== model.id || preview.modelIdentity !== model.identity || preview.threadId !== threadId
        || preview.attemptId !== attemptId || preview.adapterIdentities?.length || !Array.isArray(recipients)
        || !recipients.length || !recipients.every(id => typeof id === 'string' && id.length)
        || messages?.length !== 1 || messages[0].role !== 'user' || messages[0].content !== prompt) return false;
      if (stages && (stages.some(id => !recipients.includes(id))
        || recipients.some(id => id !== participant.identity && !stages.includes(id)))) return false;
      report(`Sending to ${recipients.join(', ')} in ${participant.roomId}. Participating computers can read this request.`);
      return true;
    }
  });
  if (result.modelIdentity !== model.identity || typeof result.content !== 'string') throw Error('Unexpected response from the selected route.');
  return result.content;
}
