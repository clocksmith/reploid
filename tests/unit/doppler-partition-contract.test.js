import { it, expect } from 'vitest';
import * as runtime from 'doppler-gpu/partitions';
import { qualifyDopplerPartitionSessions } from '../contracts/doppler-partition-session.js';
import { createPartitionRuntimeFixture } from '../fixtures/partition-runtime.js';

// These independent arithmetic expectations qualify the harness, not any model.
it.each(['match', 'logits', 'token', 'stop'])('conformance harness detects %s against independent reference', async kind => {
  const factory = createPartitionRuntimeFixture();
  const model = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64) };
  const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128, splitLayer: 2 });
  const reference = { modelIdentity: model.identity, content: '2 3 4 ',
    steps: [{ tokenId: 2, logits: [2, -2] }, { tokenId: 3, logits: [3, -3] }, { tokenId: 4, logits: [4, -4] }] };
  if (kind === 'logits') reference.steps[1].logits[0] = 0;
  if (kind === 'token') reference.steps[1].tokenId = 9;
  if (kind === 'stop') reference.steps.pop();
  const result = qualifyDopplerPartitionSessions({ factory, runtime, model, plan, tolerance: 0,
    limits: { maxTokens: 4, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 1024,
      maxAttempts: 4, maxConcurrentAttempts: 2 },
    messages: [{ role: 'user', content: '1' }], reference: async () => reference });
  if (kind === 'match') expect((await result).steps).toHaveLength(3);
  else await expect(result).rejects.toThrow(/divergen|diverged/);
  expect(factory.log.opens).toEqual([0, 1]);
  expect(factory.log.closes.sort()).toEqual([0, 1]);
});
