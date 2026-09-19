import { freezeJson, requireResolvedConfig, snapshotJson } from '../config/index.js';
import { assertSessionCompletion, createV1Verifier } from './doppler-stream.js';
import { abortable } from '../agent/cancellation.js';

// Doppler remains an optional peer dependency. Loading this adapter has no
// model, GPU, network or credential side effects.
export function createDopplerProvider({ config, session, ownership, toGenerationRequest, toOperationRequest, runtime }) {
  const policy = requireResolvedConfig(config);
  const operations = typeof toOperationRequest === 'function';
  if (!session || (operations ? typeof session.executeOperation !== 'function' : typeof session.generateText !== 'function')
    || (toOperationRequest !== undefined && !operations) || (ownership === 'owned' && typeof session.close !== 'function')
    || (operations ? toGenerationRequest !== undefined : typeof toGenerationRequest !== 'function')
    || !['owned', 'borrowed'].includes(ownership)) {
    throw new TypeError('Doppler adapter requires a public session, explicit ownership and exactly one request formatter');
  }
  const contract = policy.models.contract;
  if (!contract || ['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].some(key => typeof contract[key] !== 'string'
    || session[key] !== contract[key])) throw new Error('Doppler session does not match the exact configured execution contract');
  const expectedSession = operations ? freezeJson(snapshotJson({ ...contract,
    capsuleIdentity: session.capsuleIdentity, verification: { artifactReceipts: session.verification?.artifactReceipts } })) : null;
  let closed = false;
  let closePromise;
  const active = new Set();
  const runtimeModule = () => runtime ?? import('doppler-gpu');
  return Object.freeze({
    contract,
    async generate(messages, onUpdate, { signal, adapterArtifactStore } = {}) {
      if (closed) throw new Error('Doppler provider is closed');
      signal?.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      active.add(controller);
      const check = () => controller.signal.throwIfAborted();
      const wait = operation => abortable(operation, controller.signal);
      try {
        const messageSnapshot = snapshotJson(messages);
        // Preserve the original completion-only formatter while applications
        // explicitly migrate to a versioned, bounded operation request.
        if (!operations) {
          if (adapterArtifactStore !== undefined) throw new Error('Request-bound adapters require toOperationRequest');
          const request = await wait(() => toGenerationRequest(messageSnapshot, contract));
          check();
          const result = await session.generateText({ ...request, signal: controller.signal });
          check();
          if (typeof result.text !== 'string') throw new Error('Doppler generation output is missing text');
          if (onUpdate) await wait(() => onUpdate(result.text));
          check();
          return { content: result.text, raw: result.text, model: session.modelId, provider: 'doppler', execution: 'compatibility', evidence: result };
        }
        const request = freezeJson(snapshotJson(await wait(() => toOperationRequest(messageSnapshot, contract))));
        check();
        if (request.operation?.name !== 'generate' || request.operation.version !== 1) {
          throw new Error('Doppler generation provider requires operation generate/v1');
        }
        if (!['doppler.capsule-operation-request/v1', 'doppler.capsule-operation-request/v2'].includes(request.schema)) {
          throw new Error('Unsupported Doppler operation stream format');
        }
        const api = await wait(runtimeModule);
        check();
        if (contract.runtimeVersion !== undefined && api.DOPPLER_VERSION !== contract.runtimeVersion) {
          throw new Error('Doppler runtime does not match the configured version');
        }
        const incremental = request.schema === 'doppler.capsule-operation-request/v2';
        if (incremental && typeof api.createCapsuleStreamAccumulator !== 'function') {
          throw new Error('Installed Doppler runtime does not support operation v2');
        }
        const accumulator = incremental ? api.createCapsuleStreamAccumulator(request) : await createV1Verifier(request);
        check();
        for await (const event of session.executeOperation(request, { signal: controller.signal, adapterArtifactStore })) {
          check();
          await accumulator.accept(event);
          check();
          if (incremental && event.status === 'partial' && event.delta.text && onUpdate) await wait(() => onUpdate(event.delta.text));
          check();
        }
        check();
        const completion = accumulator.finish();
        assertSessionCompletion(completion, expectedSession, api);
        // V1 snapshots can rewrite incomplete Unicode. Its append callback gets
        // the verified final text once; v2 emits stable additions as they arrive.
        if (!incremental && onUpdate) await wait(() => onUpdate(completion.output.text));
        check();
        return { content: completion.output.text, raw: completion.output.text, model: session.modelId,
          provider: 'doppler', execution: 'verified-operation', evidence: completion };
      } finally {
        active.delete(controller);
        signal?.removeEventListener('abort', cancel);
      }
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      for (const controller of active) controller.abort(new Error('Doppler provider is closed'));
      closePromise = Promise.resolve().then(() => { if (ownership === 'owned') return session.close(); });
      return closePromise;
    }
  });
}

export async function openDopplerProvider({ config, capsule, runtimePorts, sessionOptions, toGenerationRequest, toOperationRequest }) {
  const runtime = await import('doppler-gpu');
  const session = await runtime.openCapsule(capsule, { ...runtimePorts, session: sessionOptions });
  try { return createDopplerProvider({ config, session, ownership: 'owned', toGenerationRequest, toOperationRequest, runtime }); }
  catch (error) { await session.close(); throw error; }
}
