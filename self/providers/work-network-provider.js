/** Place whole text requests without changing model identity or disclosure grants. */
import { openWorkProvider } from './work-provider.js';

// One borrowed GPU operation per runtime service, shared by threads and suppliers.
// Cancellation removes a waiter; a running operation keeps its slot until settlement.
const queues = new WeakMap();
export async function withWorkDevice(service, signal, operation, onProgress = () => {}) {
  signal.throwIfAborted();
  let queue = queues.get(service);
  if (!queue) { queue = { busy: false, waiting: [] }; queues.set(service, queue); }
  await new Promise((resolve, reject) => {
    const waiter = { enter() {
      signal.removeEventListener('abort', abort);
      queue.busy = true; resolve();
    } };
    const abort = () => {
      queue.waiting = queue.waiting.filter(item => item !== waiter);
      reject(signal.reason);
    };
    if (!queue.busy) waiter.enter();
    else {
      queue.waiting.push(waiter);
      signal.addEventListener('abort', abort, { once: true });
      onProgress('Waiting for this device');
    }
  });
  try { signal.throwIfAborted(); return await operation(); }
  finally {
    queue.busy = false;
    queue.waiting.shift()?.enter();
  }
}

export function createWorkNetworkProvider(options) {
  const { model, service, scope, signal, swarm, controls, onProgress } = options;
  return Object.freeze({
    async generate(messages, onUpdate, { signal: stepSignal } = {}) {
      const combined = AbortSignal.any([signal, ...(stepSignal ? [stepSignal] : [])]);
      combined.throwIfAborted();
      // Cloud adapters can be injected by other hosts, never selected by this workspace.
      if (model.provider !== 'doppler') {
        const provider = await openWorkProvider({ ...options, signal: combined });
        return provider.generate(messages, onUpdate, { signal: combined });
      }
      let connectionError = null;
      if (swarm?.generate) {
        try { await swarm.connect(); }
        catch (error) { connectionError = error; }
        combined.throwIfAborted();
        if (!connectionError && swarm.hasProvider(model.id)) {
          onProgress?.('Awaiting peer approval');
          // Once a peer is selected, refusal or failure cannot trigger an undisclosed retry.
          const result = await swarm.generate(messages, { ...controls, modelId: model.id,
            signal: combined, onPartial: onUpdate });
          if (result.model !== model.id || result.provider !== 'doppler') throw new Error('Peer returned an incompatible model identity');
          return result;
        }
      }
      if (typeof service.isSupported === 'function' && !service.isSupported({ models: [model] })) {
        throw connectionError || new Error('No connected participant can execute this model');
      }
      return withWorkDevice(service, combined, async () => {
        onProgress?.(connectionError ? 'Network unavailable; executing on this device' : 'Executing on this device');
        try {
          const provider = await openWorkProvider({ ...options, signal: combined });
          const result = await provider.generate(messages, onUpdate, { signal: combined });
          return { ...result, connectionError: connectionError?.message || null };
        } finally { await service.close(scope); }
      }, onProgress);
    }
  });
}
