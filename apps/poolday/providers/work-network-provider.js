/**
 * Place Work's whole text requests without changing model identity or disclosure grants.
 *
 * Boundary: only the Doppler network branch is Reploid peer inference, and it runs through `reploid/inference`
 * (peer-inference.js) with its refusals and execution receipt. Local steps on this device's Doppler runtime and
 * injected non-Doppler cloud adapters are not Reploid peer inference and keep their own paths below.
 */
import { validateExecutionPolicy, assertAvailableExecutionPolicy, executionRequirementsFor } from '../../../shared/vendor/reploid/chat/execution-policy.js';
import { retainModelStorage } from '../infrastructure/model-storage-lock.js';
import { openWorkProvider } from './work-provider.js';
import { createPeerInference } from './peer-inference.js';

import { withWorkDevice } from './work-device.js';
export { withWorkDevice } from './work-device.js';

export function createWorkNetworkProvider(options) {
  const { model, service, scope, signal, swarm, controls, onProgress } = options;
  const privacy = options.privacy ? validateExecutionPolicy(options.privacy) : null;
  // A requester-only policy is not refused here: the peer inference prepare refuses it with its stable code.
  const requesterOnly = privacy ? executionRequirementsFor(privacy).confidentiality === 'requester-only' : false;
  if (privacy && !requesterOnly) assertAvailableExecutionPolicy(privacy);
  if (privacy && model.provider !== 'doppler') throw Error('This provider has no qualified complete privacy route');
  const peers = createPeerInference({ swarm });
  return Object.freeze({
    async generate(messages, onUpdate, { signal: stepSignal, contextId } = {}) {
      const combined = AbortSignal.any([signal, ...(stepSignal ? [stepSignal] : [])]);
      combined.throwIfAborted();
      // Not peer inference: cloud adapters can be injected by other hosts, never selected by this workspace.
      if (model.provider !== 'doppler') {
        const provider = await openWorkProvider({ ...options, signal: combined });
        return provider.generate(messages, onUpdate, { signal: combined });
      }
      // Peer inference: prepared and run through reploid/inference. Requester-only never reaches this device.
      if (requesterOnly || swarm?.generate && privacy?.placement === 'network-allowed' && privacy.recipients.kind !== 'none') {
        return peers.generate({ model, privacy, messages, approve: controls?.approve, record: controls?.record,
          signal: combined, onPartial: onUpdate, contextId, onProgress });
      }
      // Not peer inference: this device's Doppler runtime.
      if (typeof service.isSupported === 'function' && !service.isSupported({ models: [model] })) {
        throw new Error('This device cannot execute this model');
      }
      return withWorkDevice(service, combined, async () => {
        const releaseStorage = await retainModelStorage({ signal: combined });
        onProgress?.('Executing on this device');
        try {
          const provider = await openWorkProvider({ ...options, signal: combined });
          const result = await provider.generate(messages, onUpdate, { signal: combined });
          return result;
        } finally { await service.close(scope); await releaseStorage(); }
      }, onProgress);
    }
  });
}
