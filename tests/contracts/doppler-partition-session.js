/** Run with real Doppler factories/reference to qualify numerical execution.
 * Injected factories qualify this harness only. No network or physical-memory claim.
 */
import { createResidentPartition, createLayerPartitionRunner, partitionFingerprint } from '../../packages/reploid/src/mesh/index.js';

const require = (condition, message) => { if (!condition) throw new Error(message); };
export async function qualifyDopplerPartitionSessions({ factory, runtime, model, plan, limits, messages,
  reference, tolerance }) {
  require(typeof reference === 'function' && typeof runtime.comparePartitionExecution === 'function'
    && Number.isFinite(tolerance) && tolerance >= 0, 'Independent unsplit reference and explicit numerical tolerance required');
  const planId = await partitionFingerprint(plan);
  const [a, b] = [0, 1].map(index => createResidentPartition({ runtime: factory, model, plan, planId, index,
    participantId: index === 0 ? 'conformance-a' : 'conformance-b', limits }));
  const steps = [];
  let runner;
  try {
    const unsplit = await reference({ model: structuredClone(model), messages: structuredClone(messages), maxTokens: limits.maxTokens });
    require(unsplit.modelIdentity === model.identity && Array.isArray(unsplit.steps) && unsplit.steps.length > 0,
      'Reference must bind the exact model and retain each token logit vector');
    await Promise.all([a.prepare({ approved: true }), b.prepare({ approved: true })]);
    const identity = { modelId: model.id, modelIdentity: model.identity, planId, threadId: 'conformance',
      attemptId: crypto.randomUUID(), participantA: a.id, participantB: b.id };
    const input = await a.tokenize({ messages, identity, signal: new AbortController().signal });
    require(input.modelIdentity === model.identity, 'Tokenization model identity mismatch');
    runner = createLayerPartitionRunner({ runtime, plan, deviceA: a,
      deviceB: { id: b.id, closeAttempt: b.closeAttempt, async executeGroup1(request) {
        const result = await b.executeGroup1(request);
        const expected = unsplit.steps[request.step];
        require(expected && expected.tokenId === result.tokenId, 'Selected token diverged at step ' + request.step);
        require(result.logits?.length > 0 && result.logits.length === expected.logits?.length
          && [...result.logits, ...expected.logits].every(Number.isFinite), 'Finite matching logit vectors required');
        const comparison = runtime.comparePartitionExecution({ splitOutput: result.logits, referenceOutput: expected.logits, tolerance });
        require(comparison.matches, 'Numerical divergence at step ' + request.step);
        steps.push({ step: request.step, tokenId: result.tokenId, comparison });
        return result;
      } },
      transport: { transferActivation: async frame => structuredClone(frame) },
      // Isolated local qualification only. Production uses the signed grant authority.
      authorize: async () => true, limits });
    const result = await runner.execute({ tokenIds: input.tokenIds, identity, maxTokens: limits.maxTokens,
      grants: { executionA: {}, executionB: {}, activation: {}, output: {} } });
    require(steps.length === unsplit.steps.length && result.content === unsplit.content, 'Completed output or stopping point differs');
    return { scope: 'resident partition execution versus supplied unsplit reference', modelIdentity: model.identity, planId,
      tolerance, steps, descriptors: [a.getState().descriptor, b.getState().descriptor], result };
  } finally {
    const closed = [];
    closed.push(...await Promise.allSettled([runner?.close()]));
    closed.push(...await Promise.allSettled([a.close(), b.close()]));
    const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Conformance cleanup failed');
  }
}
