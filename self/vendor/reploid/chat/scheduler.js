/** One resident model and settled execution slot, fairly shared by authenticated participants. */
import defaults from './policy.json' with { type: 'json' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createChatScheduler({ open, observe, policy = defaults, now = Date.now }) {
  assert(typeof open === 'function' && typeof observe === 'function', 'Scheduler execution and observation ports required');
  for (const name of ['maxQueuedRequests', 'maxRecordedAttempts', 'maxRequestsPerParticipant', 'maxOutputTokens', 'participantTokenBudget', 'budgetWindowMs']) {
    assert(Number.isSafeInteger(policy[name]) && policy[name] > 0, `Invalid ${name}`);
  }
  const limits = structuredClone(policy), queues = new Map(), rotation = [], budgets = new Map(), identities = new Set();
  let active = null, resident = null, residentIdentity = null, closed = false, draining = null;
  const retire = async () => {
    const previous = resident; resident = null; residentIdentity = null;
    await previous?.close();
  };
  const queued = () => [...queues.values()].reduce((sum, list) => sum + list.length, 0);
  const rejectQueued = async (entry, error) => {
    entry.signal.removeEventListener('abort', entry.abort);
    try {
      await observe({ schema: 'reploid.chat-execution-observation/v1', id: entry.key,
        participantId: entry.request.participantId, threadId: entry.request.threadId, attemptId: entry.request.attemptId,
        modelIdentity: entry.request.model.identity, adapterIdentities: (entry.request.model.adapters || []).map(adapter => adapter.identity),
        queuedMs: now() - entry.enqueuedAt, loadMs: 0, executionMs: 0,
        reservedOutputTokens: entry.request.maxOutputTokens, status: 'cancelled', error: error?.message || String(error) });
    } catch (observationError) { error = new AggregateError([error, observationError], 'Cancelled request observation failed'); }
    entry.reject(error);
  };
  const pump = () => {
    if (draining || closed || !rotation.length) return;
    draining = (async () => {
      while (!closed && rotation.length) {
        const owner = rotation.shift(), queue = queues.get(owner), entry = queue.shift();
        if (queue.length) rotation.push(owner); else queues.delete(owner);
        entry.signal.removeEventListener('abort', entry.abort);
        active = entry;
        const startedAt = now(); let loadedAt = null, failure = null, result;
        try {
          entry.signal.throwIfAborted();
          if (residentIdentity !== entry.request.model.identity) {
            await retire();
            entry.signal.throwIfAborted();
            entry.onState('loading');
            resident = await open(structuredClone(entry.request.model), { signal: entry.signal });
            assert(typeof resident?.run === 'function' && typeof resident?.reset === 'function'
              && typeof resident?.setAdapters === 'function' && typeof resident?.close === 'function', 'Resident execution contract is incomplete');
            residentIdentity = entry.request.model.identity;
          }
          loadedAt = now();
          entry.signal.throwIfAborted();
          await resident.reset();
          await resident.setAdapters(structuredClone(entry.request.model.adapters || []), { signal: entry.signal });
          entry.signal.throwIfAborted();
          entry.onState('executing');
          result = await resident.run(structuredClone(entry.request), { signal: entry.signal, onDelta: entry.onDelta });
          entry.signal.throwIfAborted();
        } catch (error) { failure = error; }
        finally {
          // Reset is mandatory even after abort. Never lend a dirty session to another conversation.
          try { if (resident) { await resident.reset(); await resident.setAdapters([], {}); } }
          catch (error) { failure ||= error; try { await retire(); } catch (cleanup) { failure = new AggregateError([failure, cleanup]); } }
          if (resident && residentIdentity === null) {
            try { await retire(); } catch (error) { failure ||= error; }
          }
          try {
            await observe({ schema: 'reploid.chat-execution-observation/v1', id: entry.key,
              participantId: entry.request.participantId, threadId: entry.request.threadId, attemptId: entry.request.attemptId,
              modelIdentity: entry.request.model.identity, adapterIdentities: (entry.request.model.adapters || []).map(adapter => adapter.identity),
              queuedMs: startedAt - entry.enqueuedAt, loadMs: (loadedAt ?? now()) - startedAt,
              executionMs: loadedAt === null ? 0 : now() - loadedAt, reservedOutputTokens: entry.request.maxOutputTokens,
              status: entry.signal.aborted ? 'cancelled' : failure ? 'failed' : 'completed', error: failure?.message || null });
          } catch (error) { failure ||= error; }
          active = null;
          if (failure) entry.reject(failure); else entry.resolve(result);
        }
      }
    })().finally(() => { draining = null; pump(); });
  };
  return Object.freeze({
    getState: () => ({ queued: queued(), activeAttemptId: active?.request.attemptId || null, residentIdentity, closed }),
    schedule(request, { signal, onDelta = () => {}, onState = () => {} }) {
      assert(!closed, 'Contribution is closed'); signal.throwIfAborted();
      assert(request && ['participantId', 'threadId', 'attemptId'].every(name => typeof request[name] === 'string' && request[name]), 'Authenticated participant and attempt identities required');
      assert(typeof request.model?.identity === 'string' && /^sha256:[a-f0-9]{64}$/.test(request.model.identity), 'Exact model identity required');
      assert(Number.isSafeInteger(request.maxOutputTokens) && request.maxOutputTokens > 0
        && request.maxOutputTokens <= limits.maxOutputTokens, 'Request exceeds output allowance');
      const key = JSON.stringify([request.participantId, request.threadId, request.attemptId]);
      assert(!identities.has(key), 'Attempt already scheduled; retry needs a new identity');
      assert(identities.size < limits.maxRecordedAttempts, 'Contribution attempt journal is full');
      const owner = request.participantId;
      assert(queued() < limits.maxQueuedRequests && (queues.get(owner)?.length || 0)
        + (active?.request.participantId === owner ? 1 : 0) < limits.maxRequestsPerParticipant, 'Contribution queue allowance reached');
      const timestamp = now(), budget = budgets.get(owner);
      const current = !budget || timestamp - budget.since >= limits.budgetWindowMs ? { since: timestamp, tokens: 0 } : budget;
      assert(current.tokens + request.maxOutputTokens <= limits.participantTokenBudget, 'Participant contribution budget exhausted');
      onState('queued');
      signal.throwIfAborted();
      current.tokens += request.maxOutputTokens; budgets.set(owner, current); identities.add(key);
      return new Promise((resolve, reject) => {
        const entry = { request: structuredClone(request), key, signal, onDelta: delta => {
          signal.throwIfAborted(); onDelta(delta);
        }, onState, resolve, reject, enqueuedAt: timestamp,
        abort() {
          const queue = queues.get(owner);
          if (!queue?.includes(entry)) return;
          queue.splice(queue.indexOf(entry), 1);
          if (!queue.length) { queues.delete(owner); rotation.splice(rotation.indexOf(owner), 1); }
          void rejectQueued(entry, signal.reason);
        } };
        if (!queues.has(owner)) { queues.set(owner, []); rotation.push(owner); }
        queues.get(owner).push(entry); signal.addEventListener('abort', entry.abort, { once: true });
        pump();
      });
    },
    async close() {
      closed = true;
      const rejected = [...queues.values()].flat().map(entry => rejectQueued(entry, new Error('Contribution stopped before execution')));
      queues.clear(); rotation.length = 0;
      // The active operation is borrowed: stopping contribution waits, never releases it early.
      await Promise.all(rejected); await draining; await retire();
    }
  });
}
