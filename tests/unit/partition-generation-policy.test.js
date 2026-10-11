import { expect, it } from 'vitest';
import { resolvePartitionGeneration } from '../../self/config/partition-generation.js';
import { resolveGenerationOptions } from '../../self/config/doppler-generation-contract.js';
import profile from '../../self/config/work-profile.json' with { type: 'json' };
import policy from '../../self/config/partition-policy.json' with { type: 'json' };
import catalog from '../../self/config/chat-models.json' with { type: 'json' };
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';

const explicit = () => ({ ...profile.generation, maxSeqLen: policy.maxSeqLen,
  temperature: 0.6, topK: 20, topP: 0.95, repetitionPenalty: 1, seed: 37 });
it('preserves every current catalog model generation setting exactly', () => {
  const expected = resolveGenerationOptions({ ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen });
  for (const model of catalog) expect(resolvePartitionGeneration(model)).toEqual(expected);
});
it('uses an explicit complete model policy without inheriting greedy settings', () => {
  const generation = explicit(), resolved = resolvePartitionGeneration({ generation });
  expect(resolved).toEqual(resolveGenerationOptions(generation));
  generation.temperature = 0;
  expect(resolved.temperature).toBe(0.6);
  expect(Object.isFrozen(resolved)).toBe(true);
});
it.each([
  null, undefined, [], { temperature: 0.6 }, { ...explicit(), seed: undefined },
  { ...explicit(), minP: 0 }, { ...explicit(), maxTokens: policy.limits.maxTokens + 1 },
  { ...explicit(), maxSeqLen: policy.maxSeqLen + 1 }, { ...explicit(), maxSeqLen: 1 },
])('rejects unsupported, incomplete or contradictory explicit generation %#', generation => {
  expect(() => resolvePartitionGeneration({ generation })).toThrow();
});
it('requires a stochastic seed and honors a declared model context ceiling', () => {
  const generation = explicit(); delete generation.seed;
  expect(() => resolvePartitionGeneration({ generation })).toThrow('seed');
  expect(() => resolvePartitionGeneration({ generation: explicit(), contextLength: 1024 })).toThrow('context');
});
it('carries explicit application instructions through the existing purpose and attempt prompt owner', async () => {
  const requests = [], model = { id: 'synthetic-policy', name: 'Synthetic', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), adapters: [] };
  const instruction = 'Use the explicitly requested output form.';
  const workspace = createChatWorkspace({ meshId: 'mesh', participantId: 'requester',
    store: { load: () => null, save() {} },
    execute: async request => {
      requests.push(structuredClone(request));
      return { threadId: request.threadId, attemptId: request.attemptId, modelId: model.id,
        modelIdentity: model.identity, adapterIdentities: [], content: 'Answer' };
    } });
  try {
    const configured = workspace.createThread({ model, purpose: instruction });
    await workspace.send(configured, 'Question');
    expect(requests[0].messages).toEqual([{ role: 'system', content: instruction }, { role: 'user', content: 'Question' }]);
    expect(workspace.getState().threads[0].attempts[0].request.messages).toEqual(requests[0].messages);
    const ordinary = workspace.createThread({ model }); await workspace.send(ordinary, 'Question');
    expect(requests[1].messages).toEqual([{ role: 'user', content: 'Question' }]);
  } finally { await workspace.close(); }
});
