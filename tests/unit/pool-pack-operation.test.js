import { describe, expect, it } from 'vitest';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { runPackOperation, assessPackOperation, assertPackOperationReceipt } from '../../self/pool/pack-operation.js';

const digest = (value) => `sha256:${value.repeat(64)}`;
async function fixture(name = 'encodeSequence') {
  const artifacts = [{ artifactId: 'weights', hash: digest('a'), role: 'weights', path: 'weights.bin', sizeBytes: 4 }];
  const pack = { schema: 'doppler.pack/v2', packId: 'fixture', semanticRoot: digest('b'), envelopeDigest: digest('c'), artifactClosureDigest: await hashDopplerEvidence(artifacts) };
  const binding = { ...pack, artifacts, requiredOperation: name, acceptedTargetPlanDigests: [digest('d')] };
  const output = {
    generate: { text: 'answer', tokenIds: [1, 2] },
    embed: { embeddings: [{ embedding: [0.5, 1] }] },
    rerank: { evidence: { schema: 'doppler_rerank_evidence/v1', scores: [{ index: 0, score: 1 }], ranking: [{ index: 0, rank: 1, score: 1 }] } },
    encodeSequence: { tokens: [1, 2], tokenMask: [1, 1], embeddingDim: 2, pooledEmbedding: [0.5, 1], tokenEmbeddings: null, logits: null }
  }[name] || { value: 'fifth' };
  const input = { generate: { prompt: 'question' }, embed: { texts: ['document'] }, rerank: { query: 'q', documents: ['d'], application: {} }, encodeSequence: { sequence: 'AC' } }[name] || { arbitrary: true };
  const options = { generate: { maxTokens: 2, maxSeqLen: 16, temperature: 0, topP: 1, topK: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 8, useChatTemplate: false }, encodeSequence: { includeLogits: false, includeTokenEmbeddings: false } }[name] || {};
  const policy = { schema: 'poolday.operation-comparison/v1', operation: { name, version: 1 }, referenceDigest: await hashDopplerEvidence(output),
    ...(name === 'generate' ? { rule: 'exact-text' } : { rule: 'numerical-tolerance', absoluteTolerance: 0.001, relativeTolerance: 0 }) };
  const request = { schema: 'doppler.pack-operation-request/v1', operation: { name, version: 1 }, input, options,
    assignment: { id: 'test', attempt: 1, comparisonPolicyDigest: await hashDopplerEvidence(policy) },
    limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt: Date.now() + 60000 } };
  const identity = { pack, targetPlanDigest: digest('d'), artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })) };
  let alter = (events) => events;
  let closed = 0;
  const session = { schema: 'doppler.pack-session/v1', loaded: true, packIdentity: pack, selectedTargetPlanDigest: digest('d'), verification: identity,
    async *executeOperation(invocation) {
      const requestHash = await hashDopplerEvidence(invocation);
      const assignmentHash = await hashDopplerEvidence(invocation.assignment);
      const payload = { schema: 'doppler.pack-operation-receipt/v1', ...identity, operation: invocation.operation,
        runtimeVersion: 'fixture-runtime', requestHash, assignmentHash, inputHash: await hashDopplerEvidence({ input: invocation.input, options: invocation.options }), outputHash: await hashDopplerEvidence(output) };
      const receipt = { ...payload, receiptDigest: await hashDopplerEvidence(payload) };
      let previousEventDigest = null;
      const events = [];
      for (const status of ['partial', 'completed']) {
        const body = { schema: 'doppler.pack-operation-event/v1', operation: invocation.operation, requestHash, assignmentHash,
          eventIndex: events.length, previousEventDigest, status, output, ...(status === 'completed' ? { receipt } : { delta: {} }) };
        const eventDigest = await hashDopplerEvidence(body);
        events.push({ ...body, eventDigest }); previousEventDigest = eventDigest;
      }
      try { yield* await alter(events); } finally { closed++; }
    }
  };
  return { binding, request, session, output, policy, runtimeVersion: 'fixture-runtime',
    alter: (fn) => { alter = fn; }, closed: () => closed };
}

describe('operation-independent Pack execution bridge (synthetic results)', () => {
  for (const name of ['generate', 'embed', 'rerank', 'encodeSequence']) {
    it(`validates and assesses ${name} through the same runner`, async () => {
      const f = await fixture(name);
      const partials = [];
      const execution = await runPackOperation({ ...f, onPartial: (event) => partials.push(event) });
      expect(f.closed()).toBe(1);
      expect(partials).toHaveLength(1);
      expect(execution.output).toEqual(f.output);
      expect((await assessPackOperation({ execution, reference: f.output, policy: f.policy })).accepted).toBe(true);
      await expect(assessPackOperation({ execution, reference: f.output, policy: { ...f.policy, rule: 'relaxed' } })).rejects.toThrow('frozen');
      await expect(assertPackOperationReceipt(f.binding, execution.receipt, { request: { ...f.request, assignment: { ...f.request.assignment, attempt: 2 } }, output: execution.output, runtimeVersion: f.runtimeVersion })).rejects.toThrow('request mismatch');
    });
  }

  it('adds a fifth operation with an adapter and no runner, receipt, discovery or transport edits', async () => {
    const f = await fixture('audio.test');
    await expect(runPackOperation(f)).rejects.toThrow('unknown operation');
    const registry = createPackOperationRegistry({ 'audio.test': { version: 1,
      validateRequest(request) { if (request.input.arbitrary !== true) throw new Error('input'); },
      validateOutput(output) { if (output.value !== 'fifth') throw new Error('output'); },
      compare: (output, reference) => output.value === reference.value } });
    const execution = await runPackOperation({ ...f, registry });
    expect((await assessPackOperation({ execution, reference: f.output, policy: f.policy, registry })).accepted).toBe(true);
  });

  it('rejects replay, truncation, reordered events, changed output, and output after completion', async () => {
    for (const alter of [
      (events) => [events[0], ...events],
      (events) => [events[0]],
      (events) => events.reverse(),
      (events) => [{ ...events[0], output: {} }, events[1]],
      (events) => [...events, events[0]]
    ]) {
      const f = await fixture(); f.alter(alter);
      await expect(runPackOperation(f)).rejects.toThrow();
      expect(f.closed()).toBe(1);
    }
  });

  it('rejects a re-sealed receipt from the wrong runtime, output, assignment, or Pack', async () => {
    for (const change of [
      (r) => { r.runtimeVersion = 'upgrade'; },
      (r) => { r.outputHash = digest('f'); },
      (r) => { r.assignmentHash = digest('f'); },
      (r) => { r.pack = { ...r.pack, envelopeDigest: digest('f') }; }
    ]) {
      const f = await fixture();
      f.alter(async (events) => {
        const final = structuredClone(events[1]);
        const { receiptDigest, ...receipt } = final.receipt; change(receipt);
        final.receipt = { ...receipt, receiptDigest: await hashDopplerEvidence(receipt) };
        const { eventDigest, ...body } = final;
        return [events[0], { ...body, eventDigest: await hashDopplerEvidence(body) }];
      });
      await expect(runPackOperation(f)).rejects.toThrow();
    }
  });

  it('suppresses completion after cancellation or attempt invalidation, and enforces byte limits', async () => {
    const f = await fixture();
    const controller = new AbortController();
    await expect(runPackOperation({ ...f, signal: controller.signal, onPartial: () => controller.abort(new Error('cancelled')) })).rejects.toThrow('cancelled');
    expect(f.closed()).toBe(1);
    let current = true;
    await expect(runPackOperation({ ...f, onPartial: () => { current = false; }, assertCurrent: () => { if (!current) throw new Error('stale attempt'); } })).rejects.toThrow('stale attempt');
    await expect(runPackOperation({ ...f, request: { ...f.request, limits: { ...f.request.limits, maxOutputBytes: 1 } } })).rejects.toThrow('output byte');
    await expect(runPackOperation({ ...f, request: { ...f.request, limits: { ...f.request.limits, deadlineAt: 1 } } })).rejects.toThrow('deadline');
  });
});
