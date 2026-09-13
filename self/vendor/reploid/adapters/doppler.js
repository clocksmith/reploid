import { requireResolvedConfig, snapshotJson } from '../config/index.js';

// Doppler remains an optional peer dependency. Loading this adapter has no
// model, GPU, network or credential side effects.
export function createDopplerProvider({ config, session, ownership, toGenerationRequest }) {
  const policy = requireResolvedConfig(config);
  if (!session?.generateText || typeof toGenerationRequest !== 'function'
    || !['owned', 'borrowed'].includes(ownership)) {
    throw new TypeError('Doppler adapter requires a public session, explicit ownership and request formatter');
  }
  const contract = policy.models.contract;
  if (!contract || ['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].some(key => typeof contract[key] !== 'string'
    || session[key] !== contract[key])) throw new Error('Doppler session does not match the exact configured execution contract');
  let closed = false;
  return Object.freeze({
    contract,
    async generate(messages, onUpdate, { signal } = {}) {
      if (closed) throw new Error('Doppler provider is closed');
      signal?.throwIfAborted();
      const request = await toGenerationRequest(snapshotJson(messages), contract);
      signal?.throwIfAborted();
      const result = await session.generateText({ ...request, signal });
      signal?.throwIfAborted();
      const content = result.text;
      if (typeof content !== 'string') throw new Error('Doppler generation output is missing text');
      onUpdate?.(content);
      return { content, raw: content, model: session.modelId, provider: 'doppler', evidence: result };
    },
    async close() { if (closed) return; closed = true; if (ownership === 'owned') await session.close(); }
  });
}

export async function openDopplerProvider({ config, capsule, runtimePorts, sessionOptions, toGenerationRequest }) {
  const { openCapsule } = await import('doppler-gpu');
  const session = await openCapsule(capsule, { ...runtimePorts, session: sessionOptions });
  try { return createDopplerProvider({ config, session, ownership: 'owned', toGenerationRequest }); }
  catch (error) { await session.close(); throw error; }
}
