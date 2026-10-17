import { createTrainingSession, createTrainingNetwork } from '../vendor/reploid/training/index.js';
import policy from '../config/lora-training.json' with { type: 'json' };

export function createTrainingWorker({ WorkerClass = globalThis.Worker, onProgress = () => {} } = {}) {
  const worker = new WorkerClass('/host/lora-training-worker.js', { type: 'module' });
  let nextId = 0, pending = null, closed = false, closing = null;
  worker.addEventListener('message', ({ data }) => {
    if (data.progress) { onProgress(data.progress); return; }
    if (!pending || pending.id !== data.id) return;
    const request = pending; pending = null; request.clean();
    data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
  });
  worker.addEventListener('error', event => {
    closed = true;
    if (pending) { const request = pending; pending = null; request.clean(); request.reject(new Error(event.message || 'Training worker failed')); }
    worker.terminate();
  });
  const request = (action, input, { signal } = {}) => {
    signal?.throwIfAborted();
    if (closed || pending) return Promise.reject(new Error('Training worker closed or busy'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const abort = () => worker.postMessage({ action: 'cancel' });
      pending = { id, resolve, reject, clean: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      // Keep the promise pending until GPU execution and the command have returned.
      worker.postMessage({ id, action, input });
    });
  };
  return { request,
    close() {
      if (pending) return Promise.reject(new Error('Training work has not settled'));
      return closing ||= (async () => {
        try { if (!closed) await request('close'); }
        finally { closed = true; worker.terminate(); }
      })();
    }
  };
}

export function createBrowserTraining({ swarm, createWorker = createTrainingWorker }) {
  let identity = `local:${crypto.randomUUID()}`;
  const session = createTrainingSession({ policy,
    async participantId(networked) {
      if (!networked) return identity;
      await swarm.connect({ automatic: true });
      identity = swarm.partitions.requesterIdentity();
      if (!identity) throw new Error('Connect before training with participants');
      return identity;
    },
    openExecutor: async ({ onProgress }) => createWorker({ onProgress }),
    connectPeer: (network, peer, signal) => network.connect(peer, signal),
    openNetwork: ({ receive, allowed }) => createTrainingNetwork({ policy, localParticipantId: identity,
      openNetwork: options => swarm.createPartitionNetwork(options), receive, allowed })
  });
  return Object.freeze({ ...session, policy,
    peers: () => swarm.getTrainingPeers() });
}
