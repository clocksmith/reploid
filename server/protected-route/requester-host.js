/**
 * Node host ports for a protected requester: discovery by asking listed endpoints for their signed advertisements,
 * the protected wire over TCP, the caller's key holder, and trap batches from the pinned oracle. A browser host implements the same
 * ports with its own transport.
 *
 * The key holder used to be Doppler's Go `privacy-protected bridge` child process. Reploid runs JavaScript only, so
 * that bridge is removed; until a JavaScript key holder exists, `openKeyHolder` must be supplied or the route refuses.
 */
import { createProtectedExecution } from '../../shared/vendor/reploid/inference/index.js';
import { requestProtectedAdvertisement } from '../../shared/vendor/reploid/mesh/protected-generation.js';
import { connectFrameSocket } from './frame-socket.js';

export const PROTECTED_KEY_HOLDER_UNAVAILABLE = 'PROTECTED_KEY_HOLDER_UNAVAILABLE';

/** The default key holder: refuses, because the Go bridge is removed and no JavaScript key holder exists yet. */
export async function refuseKeyHolder() {
  throw Object.assign(new Error('No protected key holder: Doppler\'s Go privacy-protected bridge was removed (Reploid runs JavaScript only), '
    + 'and no JavaScript key holder exists yet'), { code: PROTECTED_KEY_HOLDER_UNAVAILABLE });
}

export function createNodeProtectedExecution({ endpoints, policy, openKeyHolder = refuseKeyHolder, stateDir = null, keyTtlSeconds = 86400,
  connectTimeoutMs = 30000, ...options }) {
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
    openCrypto: ({ parameterSet }) => openKeyHolder({ profile: parameterSet.id,
      allowInsecureDevelopment: parameterSet.insecureDevelopment && policy.allowInsecureDevelopment, stateDir, keyTtlSeconds }),
    // The batch is signed by the oracle and encrypted to this request's one-time key, so plain HTTP carries it; a
    // network observer learns the same sizes and timing the oracle does.
    async requestTraps({ endpoint, request, signal }) {
      const response = await fetch(new URL('/v1/trap-batch', endpoint), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(connectTimeoutMs)]) : AbortSignal.timeout(connectTimeoutMs) });
      if (!response.ok) throw new Error(`trap oracle answered ${response.status}`);
      return response.json();
    },
    ...options
  });
}
