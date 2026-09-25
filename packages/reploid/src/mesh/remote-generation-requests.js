/** Single terminal settlement for bounded, cancellable remote generation requests. */
export function createRemoteGenerationRequests({ timeoutMs, maxPending, sendCancel }) {
  const requests = new Map();
  let closed = false;
  const settle = (pending, outcome = {}) => {
    if (!pending || requests.get(pending.requestId) !== pending) return false;
    requests.delete(pending.requestId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.abort);
    if (outcome.cancel) {
      // Transport teardown must not prevent local settlement.
      try { sendCancel(pending.providerPeerId, pending.requestId); } catch { /* Original failure remains authoritative. */ }
    }
    if (Object.hasOwn(outcome, 'error')) pending.reject(outcome.error ?? new Error('Remote request cancelled'));
    else pending.resolve(outcome.response);
    return true;
  };
  const start = (metadata, send) => {
    if (closed) return Promise.reject(new Error('Mesh is closed'));
    if (requests.size >= maxPending) return Promise.reject(new Error('Pending remote job limit exceeded'));
    if (requests.has(metadata.requestId)) return Promise.reject(new Error('Duplicate remote request identity'));
    metadata.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const pending = { ...metadata, resolve, reject, processing: false };
      pending.abort = () => settle(pending, { error: pending.signal.reason, cancel: true });
      pending.timer = setTimeout(() => settle(pending, {
        error: new Error('Timed out waiting for remote host slot response'), cancel: true
      }), timeoutMs);
      requests.set(pending.requestId, pending);
      pending.signal?.addEventListener('abort', pending.abort, { once: true });
      try {
        if (!send()) settle(pending, { error: new Error('Failed to send swarm generation request') });
      } catch (error) { settle(pending, { error, cancel: true }); }
    });
  };
  return Object.freeze({
    start, settle,
    get size() { return requests.size; },
    get(requestId, peerId) {
      const pending = requests.get(String(requestId || ''));
      return pending?.providerPeerId === peerId ? pending : null;
    },
    retirePeer(peerId) {
      for (const pending of requests.values()) if (pending.providerPeerId === peerId) {
        settle(pending, { error: new Error('Execution peer disconnected; retry requires a new attempt') });
      }
    },
    close() {
      closed = true;
      for (const pending of requests.values()) settle(pending, { error: new Error('Mesh closed'), cancel: true });
    }
  });
}
