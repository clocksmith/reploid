import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function askMesh(participant, model, prompt, { signal, report = console.error, discoveryMs = 45000 } = {}) {
  const discovery = AbortSignal.timeout(discoveryMs);
  const waiting = AbortSignal.any([signal, discovery]);
  let route;
  try {
    for (;;) {
      waiting.throwIfAborted();
      const eligible = (participant.getState().models || []).filter(candidate =>
        candidate.id === model.id && candidate.identity === model.identity && candidate.availability === 'ready'
        && !candidate.adapters?.length);
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
  const result = await participant.generate({ model: route, threadId, attemptId, messages: [{ role: 'user', content: prompt }] }, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    requestApproval(preview) {
      const recipients = preview.recipients ?? preview.input?.recipients;
      const messages = preview.input?.messages;
      if (preview.modelId !== model.id || preview.modelIdentity !== model.identity || preview.threadId !== threadId
        || preview.attemptId !== attemptId || preview.adapterIdentities?.length || !Array.isArray(recipients)
        || !recipients.length || !recipients.every(id => typeof id === 'string' && id.length)
        || messages?.length !== 1 || messages[0].role !== 'user' || messages[0].content !== prompt) return false;
      report(`Sending to ${recipients.join(', ')} in ${participant.roomId}. Participating computers can read this request.`);
      return true;
    }
  });
  if (result.modelIdentity !== model.identity || typeof result.content !== 'string') throw Error('Unexpected response from the selected route.');
  return result.content;
}
