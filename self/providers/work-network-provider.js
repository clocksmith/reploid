/** Place whole text requests without changing model identity or disclosure grants. */
import { openWorkProvider } from './work-provider.js';

import { withWorkDevice } from './work-device.js';
export { withWorkDevice } from './work-device.js';

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
      if (swarm?.generate) {
        await swarm.connect({ automatic: true });
        combined.throwIfAborted();
        onProgress?.(swarm.hasProvider(model.id) ? 'Awaiting peer approval' : 'Waiting for a ready contributor');
        // Once a peer is selected, refusal or failure cannot trigger an undisclosed retry.
        const result = await swarm.generate(messages, { ...controls, modelId: model.id, modelIdentity: model.identity,
          signal: combined, onPartial: onUpdate });
        if (result.model !== model.id || result.provider !== 'doppler') throw new Error('Peer returned an incompatible model identity');
        return result;
      }
      if (typeof service.isSupported === 'function' && !service.isSupported({ models: [model] })) {
        throw new Error('This device cannot execute this model');
      }
      return withWorkDevice(service, combined, async () => {
        onProgress?.('Executing on this device');
        try {
          const provider = await openWorkProvider({ ...options, signal: combined });
          const result = await provider.generate(messages, onUpdate, { signal: combined });
          return result;
        } finally { await service.close(scope); }
      }, onProgress);
    }
  });
}
