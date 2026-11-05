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
  let preparing = null, preparingIdentity = null, closing = null;
  let retirement = null, cleanup = null;
  const lifetime = new AbortController();
  const retire = () => {
    if (retirement) return retirement;
    if (!resident) return Promise.resolve();
    const previous = resident;
    cleanup = { status: 'pending', modelIdentity: residentIdentity, error: null };
    retirement = Promise.resolve().then(() => {
      assert(typeof previous.close === 'function', 'Resident cleanup port is unavailable');
      return previous.close();
    }).then(() => {
      // The device owner remains retained until its cleanup positively settles.
      resident = null;
      residentIdentity = null;
      cleanup = null;
    }).catch(error => {
      cleanup = { status: 'failed', modelIdentity: residentIdentity, error: error?.message || String(error) };
      throw error;
    }).finally(() => { retirement = null; });
    return retirement;
  };
  const acquireResident = async (model, signal) => {
    const opened = await open(structuredClone(model), { signal });
    // Ownership begins when open returns, before validation can reject its contract.
    resident = opened;
    residentIdentity = opened ? model.identity : null;
    try {
      assert(typeof opened?.run === 'function' && typeof opened?.reset === 'function'
        && typeof opened?.setAdapters === 'function' && typeof opened?.close === 'function', 'Resident execution contract is incomplete');
      signal.throwIfAborted();
    } catch (error) {
      // An unvalidated session must never receive reset, adapter changes or execution.
      try { await retire(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Resident acquisition and cleanup failed'); }
      throw error;
    }
  };
  const queued = () => [...queues.values()].reduce((sum, list) => sum + list.length, 0);
  const rejectQueued = async (entry, error, status = 'cancelled') => {
    entry.signal.removeEventListener('abort', entry.abort);
    try {
      await observe({ schema: 'reploid.chat-execution-observation/v1', id: entry.key,
        participantId: entry.request.participantId, threadId: entry.request.threadId, attemptId: entry.request.attemptId,
        modelIdentity: entry.request.model.identity, adapterIdentities: (entry.request.model.adapters || []).map(adapter => adapter.identity),
        queuedMs: now() - entry.enqueuedAt, loadMs: 0, executionMs: 0,
        reservedOutputTokens: entry.request.maxOutputTokens, status, error: error?.message || String(error) });
    } catch (observationError) { error = new AggregateError([error, observationError], 'Cancelled request observation failed'); }
    entry.reject(error);
  };
  const rejectPending = async (error, status = 'cancelled') => {
    const entries = [...queues.values()].flat();
    queues.clear();
    rotation.length = 0;
    await Promise.all(entries.map(entry => rejectQueued(entry, error, status)));
  };
  const pump = () => {
    if (draining || closed || !rotation.length) return;
    draining = (async () => {
      await preparing?.catch(() => {});
      while (!closed && rotation.length) {
        if (cleanup) {
          await rejectPending(new Error('Resident cleanup remains unsettled'), 'failed');
          break;
        }
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
            await acquireResident(entry.request.model, entry.signal);
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
          try { if (resident && !cleanup) { await resident.reset(); await resident.setAdapters([], {}); } }
          catch (error) { failure ||= error; try { await retire(); } catch (cleanup) { failure = new AggregateError([failure, cleanup]); } }
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
    prepare(model) {
      assert(!closed, 'Scheduler is closed');
      assert(model?.identity && model?.id, 'Identified model required');
      if (preparing) {
        assert(preparingIdentity === model.identity, 'Another model is being prepared');
        return preparing;
      }
      assert(!cleanup, 'Resident cleanup remains unsettled');
      if (residentIdentity === model.identity) return Promise.resolve();
      assert(!active && !queued(), 'Wait for current conversations before changing the local model');
      model = structuredClone(model);
      preparingIdentity = model.identity;
      preparing = (async () => {
        await retire();
        lifetime.signal.throwIfAborted();
        await acquireResident(model, lifetime.signal);
      })().finally(() => { preparing = null; preparingIdentity = null; });
      return preparing;
    },
    getState: () => ({ queued: queued(), activeAttemptId: active?.request.attemptId || null, residentIdentity, closed,
      cleanup: cleanup ? { ...cleanup } : null }),
    schedule(request, { signal, onDelta = () => {}, onState = () => {} }) {
      assert(!closed, 'Contribution is closed');
      assert(!cleanup, 'Resident cleanup remains unsettled');
      signal.throwIfAborted();
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
    close() {
      if (closing) return closing;
      closed = true;
      lifetime.abort(new Error('Scheduler closed'));
      closing = (async () => {
        await rejectPending(new Error('Contribution stopped before execution'));
        // Active work is borrowed; its cancellation and cleanup must settle first.
        await draining;
        await preparing?.catch(() => {});
        await retire();
      })().catch(error => {
        closing = null;
        throw error;
      });
      return closing;
    }
  });
}
