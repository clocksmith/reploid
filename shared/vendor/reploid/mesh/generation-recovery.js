/** Recovery queries never execute a prompt. Unknown or pruned work stays unresolved. */
import { createRemoteGenerationRequests } from './remote-generation-requests.js';

export function createMemoryGenerationJournal(maxResults) {
  const records = new Map(), results = [];
  const key = binding => JSON.stringify([binding.provider, binding.consumer, binding.requestId]);
  return {
    async get(binding) { return structuredClone(records.get(key(binding)) || null); },
    async claim(binding) {
      const id = key(binding);
      if (records.has(id)) return false;
      records.set(id, { binding: structuredClone(binding), outcome: null }); return true;
    },
    async finish(binding, outcome) {
      const id = key(binding), record = records.get(id);
      if (!record) throw Error('Generation admission missing');
      if (record.finished) throw Error('Generation already finished');
      record.outcome = structuredClone(outcome); record.finished = true; results.push(id);
      while (results.length > maxResults) records.get(results.shift()).outcome = null;
    }
  };
}

export function createGenerationRecovery({ transport, getIdentity, verifyPeer, journal, timeoutMs, maxPending }) {
  const pending = createRemoteGenerationRequests({ timeoutMs, maxPending, sendCancel() {} });
  const handlers = new Set(); let closed = false;
  async function answer(peerId, input) {
    if (closed || handlers.size >= maxPending) return;
    const query = structuredClone(input);
    if (!query || typeof query.requestId !== 'string' || query.requestId.length > 512
      || typeof query.queryId !== 'string' || !/^[a-f0-9-]{36}$/.test(query.queryId)) return;
    const identity = getIdentity(), consumer = await verifyPeer(peerId);
    if (!consumer || closed) return;
    const record = await journal.get({ provider: identity.peerId, consumer, requestId: query.requestId });
    if (!closed) transport.sendToPeer(peerId, 'reploid:generation-recovery', {
      queryId: query.queryId, requestId: query.requestId, outcome: record?.outcome || null
    });
  }
  transport.onMessage('reploid:generation-recover', (peer, query) => {
    const job = answer(peer, query); handlers.add(job);
    job.finally(() => handlers.delete(job)).catch(() => {});
    return job;
  });
  transport.onMessage('reploid:generation-recovery', (peer, input) => {
    const job = pending.get(input?.queryId, peer);
    if (job && input?.requestId === job.originalRequestId) pending.settle(job, { response: structuredClone(input.outcome) });
  });
  return {
    async read(reference, signal) {
      if (closed) throw Error('Generation recovery closed');
      if (await verifyPeer(reference.providerId, signal) !== reference.providerIdentity) throw Error('Recovery provider identity changed');
      const queryId = crypto.randomUUID();
      return pending.start({ requestId: queryId, originalRequestId: reference.requestId, providerPeerId: reference.providerId, signal },
        () => transport.sendToPeer(reference.providerId, 'reploid:generation-recover', { queryId, requestId: reference.requestId }));
    },
    async close() { closed = true; pending.close(); await Promise.allSettled([...handlers]); }
  };
}
