/**
 * Node host ports for a protected requester: discovery by asking listed endpoints for their signed advertisements,
 * the protected wire over TCP, and Doppler's key holder as a child process. A browser host implements the same
 * three ports with its own transport and a WebAssembly key holder.
 */
import { createProtectedExecution } from '../../shared/vendor/reploid/inference/index.js';
import { requestProtectedAdvertisement } from '../../shared/vendor/reploid/mesh/protected-generation.js';
import { connectFrameSocket } from './frame-socket.js';
import { openGoRequesterBridge } from './go-bridge.js';

export function createNodeProtectedExecution({ endpoints, engine, policy, stateDir = null, keyTtlSeconds = 86400, connectTimeoutMs = 30000, ...options }) {
  return createProtectedExecution({
    policy,
    async discover({ signal }) {
      const found = await Promise.all(endpoints.map(async endpoint => {
        try {
          const channel = await connectFrameSocket(endpoint, { signal, timeoutMs: connectTimeoutMs });
          try { return { endpoint, advertisement: await requestProtectedAdvertisement(channel, { timeoutMs: connectTimeoutMs }) }; } finally { channel.close(); }
        } catch { return null; }
      }));
      return found.filter(Boolean);
    },
    connect: (endpoint, { signal }) => connectFrameSocket(endpoint, { signal, timeoutMs: connectTimeoutMs }),
    openCrypto: ({ parameterSet }) => openGoRequesterBridge({ binary: engine, profile: parameterSet.id,
      allowInsecureDevelopment: parameterSet.insecureDevelopment && policy.allowInsecureDevelopment, stateDir, keyTtlSeconds }),
    ...options
  });
}
