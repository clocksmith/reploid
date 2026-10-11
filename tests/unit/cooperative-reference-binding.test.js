import { expect, it } from 'vitest';
import { compareObservedLogits } from '../fixtures/cooperative-observer.js';
import { partitionFingerprint } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

async function fixture() {
  const generation = { maxTokens: 1, temperature: 0, topK: 1 };
  const reference = { modelIdentity: 'sha256:' + 'a'.repeat(64), planId: 'sha256:' + 'b'.repeat(64), generation,
    prompts: [[{ role: 'user', content: 'Question' }]],
    expected: [{ steps: [{ tokenId: 2, stopReason: 'max-tokens', logits: Buffer.from(new Float32Array([1, 2]).buffer).toString('base64') }] }] };
  const step = { identity: { modelIdentity: reference.modelIdentity, planId: reference.planId, threadId: 'thread', attemptId: 'attempt' },
    generation: structuredClone(generation), generationDigest: await partitionFingerprint(generation),
    step: 0, tokenId: 2, stopReason: 'max-tokens', logits: [1, 2] };
  return { reference, step, history: { threads: [{ id: 'thread', messages: [{ role: 'user', content: 'Question' }],
    attempts: [{ id: 'attempt', request: { messages: structuredClone(reference.prompts[0]) } }] }] } };
}

it('compares logits only after exact model, plan and generation bindings match', async () => {
  const { reference, step, history } = await fixture();
  expect(await compareObservedLogits([{ steps: [step] }], history, reference, 0.001))
    .toEqual([expect.objectContaining({ matches: true, maxDifference: 0 })]);
});
it.each(['modelIdentity', 'planId', 'generation', 'generationDigest', 'missingGeneration'])
('rejects %s mismatch before reading any logits, including a later mismatched step', async field => {
  const { reference, step, history } = await fixture();
  const wrong = structuredClone(step);
  if (field === 'generation') wrong.generation.temperature = 0.6;
  else if (field === 'missingGeneration') delete wrong.generation;
  else if (field === 'generationDigest') wrong.generationDigest = 'sha256:' + 'f'.repeat(64);
  else wrong.identity[field] = 'sha256:' + 'f'.repeat(64);
  Object.defineProperty(step, 'logits', { get() { throw Error('Numerical comparison occurred before identity admission'); } });
  await expect(compareObservedLogits([{ steps: [step, wrong] }], history, reference, 0.001))
    .rejects.toThrow(field === 'modelIdentity' || field === 'planId' ? 'model or partition plan' : 'generation identity');
});
it('does not substitute matching sampled tokens for declared stopping or numerical checks', async () => {
  const { reference, step, history } = await fixture();
  step.logits[0] += 0.002;
  expect((await compareObservedLogits([{ steps: [step] }], history, reference, 0.001))[0].matches).toBe(false);
  step.stopReason = 'eos-token';
  await expect(compareObservedLogits([{ steps: [step] }], history, reference, 0.001)).rejects.toThrow('stopping differs');
});

it.each(['system', 'history', 'missingAttempt'])('rejects changed %s prompt identity before reading logits', async field => {
  const { reference, step, history } = await fixture();
  const attempt = history.threads[0].attempts[0];
  if (field === 'missingAttempt') history.threads[0].attempts = [];
  else attempt.request.messages.unshift({ role: field === 'system' ? 'system' : 'assistant', content: 'Changed context' });
  Object.defineProperty(step, 'logits', { get() { throw Error('Compared numerical values before prompt admission'); } });
  await expect(compareObservedLogits([{ steps: [step] }], history, reference, 0.001))
    .rejects.toThrow(field === 'missingAttempt' ? 'retained prompt identity' : 'exact numerical reference');
});
