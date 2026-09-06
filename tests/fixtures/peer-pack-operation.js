/** Synthetic operation outputs for protocol tests, never model qualification. */
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../../self/pool/inference-receipt.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';

export async function packPeerIdentity() {
  const keys = await createSigningKeyPair();
  const publicKey = await exportPublicKey(keys.publicKey);
  return { publicKey, privateKey: keys.privateKey,
    keyId: await sha256Hex(Uint8Array.from(atob(publicKey), c => c.charCodeAt(0))) };
}

export async function operationFixture(name = 'encodeSequence', registry = createPackOperationRegistry()) {
  const digest = value => `sha256:${value.repeat(64)}`;
  const artifacts = [{ artifactId: 'weights', hash: digest('a'), role: 'weights', path: 'weights.bin', sizeBytes: 4 }];
  const pack = { schema: 'doppler.pack/v2', packId: 'synthetic-operation', semanticRoot: digest('b'), envelopeDigest: digest('c'),
    artifactClosureDigest: await hashDopplerEvidence(artifacts) };
  const binding = { ...pack, artifacts, requiredOperation: name, acceptedTargetPlanDigests: [digest('d')] };
  const model = { modelId: 'synthetic-operation', modelHash: pack.semanticRoot, manifestHash: pack.envelopeDigest,
    runtime: 'doppler', backend: 'browser-webgpu', runtimeVersion: 'synthetic-test-runtime',
    workload: registry[name].workload, executionMode: 'complete_pack_browser', executablePack: binding };
  const output = {
    generate: { text: 'answer', tokenIds: [1, 2] },
    embed: { embeddings: [{ embedding: [0.5, 1] }] },
    rerank: { evidence: { schema: 'doppler_rerank_evidence/v1', scores: [{ index: 0, score: 1 }], ranking: [{ index: 0, rank: 1, score: 1 }] } },
    encodeSequence: { tokens: [1, 2], tokenMask: [1, 1], embeddingDim: 2, pooledEmbedding: [0.5, 1], tokenEmbeddings: null, logits: null }
  }[name] || { value: 'fifth' };
  const input = { generate: { prompt: 'question' }, embed: { texts: ['document'], application: {} },
    rerank: { query: 'q', documents: ['d'], application: {} }, encodeSequence: { sequence: 'AC' } }[name] || { arbitrary: true };
  const options = { generate: { maxTokens: 2, maxSeqLen: 16, temperature: 0, topP: 1, topK: 1, repetitionPenalty: 1,
    repetitionPenaltyWindow: 8, useChatTemplate: false }, encodeSequence: { includeLogits: false, includeTokenEmbeddings: false } }[name] || {};
  const policy = { schema: 'poolday.operation-comparison/v1', operation: { name, version: registry[name].version },
    referenceDigest: await hashDopplerEvidence(output), ...(name === 'generate' ? { rule: 'exact-text' }
      : { rule: 'numerical-tolerance', absoluteTolerance: 0.001, relativeTolerance: 0 }) };
  const evidence = { pack, targetPlanDigest: digest('d'),
    artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })) };
  let calls = 0, active = false, alter = events => events, before = async () => {}, after = async () => {};
  const session = { schema: 'doppler.pack-session/v1', loaded: true, packIdentity: pack,
    selectedTargetPlanDigest: digest('d'), verification: evidence,
    async *executeOperation(request) {
      calls++;
      await before(request);
      const requestHash = await hashDopplerEvidence(request), assignmentHash = await hashDopplerEvidence(request.assignment);
      const payload = { schema: 'doppler.pack-operation-receipt/v1', ...evidence, operation: request.operation,
        runtimeVersion: model.runtimeVersion, requestHash, assignmentHash,
        inputHash: await hashDopplerEvidence({ input: request.input, options: request.options }), outputHash: await hashDopplerEvidence(output) };
      const receipt = { ...payload, receiptDigest: await hashDopplerEvidence(payload) };
      let previousEventDigest = null;
      const events = [];
      for (const status of ['partial', 'completed']) {
        const body = { schema: 'doppler.pack-operation-event/v1', operation: request.operation, requestHash, assignmentHash,
          eventIndex: events.length, previousEventDigest, status, output, ...(status === 'completed' ? { receipt } : { delta: {} }) };
        const eventDigest = await hashDopplerEvidence(body);
        events.push({ ...body, eventDigest }); previousEventDigest = eventDigest;
      }
      try { yield* await alter(events); } finally { await after(); }
    } };
  return { model, input, options, output, policy, binding, session,
    before(fn) { before = fn; }, after(fn) { after = fn; }, alter(fn) { alter = fn; }, calls: () => calls,
    executor: {
      async run({ model: selected, ...request }) {
        if (active) throw new Error('synthetic executor busy');
        active = true;
        try {
          return await runPackOperation({ binding: selected.executablePack, session, runtimeVersion: selected.runtimeVersion, registry,
            request: { schema: 'doppler.pack-operation-request/v1', operation: { name, version: registry[name].version },
              input: request.input, options: request.options, assignment: request.assignment, limits: request.limits },
            signal: request.signal, onPartial: request.onPartial, beforeExecute: request.beforeExecute });
        } finally { active = false; }
      },
      getState() { return { active }; },
      async close() {}
    } };
}
