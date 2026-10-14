import { describe, expect, it, vi } from 'vitest';
import { createChatExecution } from '../../self/host/chat-execution.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { openWorkProvider } from '../../self/providers/work-provider.js';
import { readWorkGenerationCompletion } from '../../self/providers/work-generation-completion.js';

const model = { id: 'fixture', name: 'Fixture', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), adapters: [] };
const complete = stopReason => ({ schema: 'doppler.generation-completion/v1', stopReason,
  promptTokenCount: 4, generatedTokenCount: 9 });

describe('Doppler termination through ordinary chat owners (injected execution)', () => {
  it.each(['local', 'network'])('retains %s completion and partial text without calling token exhaustion success', async placement => {
    let stopReason = 'max-tokens', saved = null;
    const response = () => ({ model: model.id, modelIdentity: model.identity, adapterIdentities: [],
      provider: 'doppler', content: 'Visible answer', evidence: { output: { completion: complete(stopReason) } } });
    const scheduler = { getState: () => ({}), schedule: async (_request, controls) => {
      controls.onDelta('Visible answer'); return response();
    } };
    const swarm = { connect: async () => {}, hasProvider: () => true, async generate(_messages, controls) {
      controls.onPartial('Visible answer'); return { ...response(), peerId: 'provider' };
    } };
    const execution = createChatExecution({ service: {}, models: [model], getModels: () => [model],
      profile: { generation: {}, maxOutcomeCharacters: 100 }, scheduler, swarm });
    const options = { meshId: 'mesh', participantId: 'requester', execute: execution.execute,
      store: { load: () => saved, save: value => { saved = structuredClone(value); } } };
    const workspace = createChatWorkspace(options);
    const thread = workspace.createThread({ model, permissions: { sharingScope: placement === 'local' ? 'local' : 'mesh' } });
    const truncated = await workspace.send(thread, 'Question');
    expect(truncated.status).toBe('failed');
    expect(truncated.error).toContain('generation limit');
    expect(truncated.execution).toMatchObject({ stopReason: 'max-tokens', completion: complete('max-tokens') });
    expect(workspace.getState().threads[0].messages.at(-1)).toMatchObject({ content: 'Visible answer', status: 'failed' });
    stopReason = 'eos-token';
    const retried = await workspace.retry(thread, truncated.id);
    expect(retried.status).toBe('completed');
    expect(retried.id).not.toBe(truncated.id);
    expect(retried.execution.stopReason).toBe('eos-token');
    await workspace.close();
    const restored = createChatWorkspace(options);
    expect(restored.getState().threads[0].attempts.map(attempt => attempt.execution.stopReason))
      .toEqual(['max-tokens', 'eos-token']);
    await restored.close(); await execution.close();
  });

  it('treats absent legacy metadata as unknown and rejects malformed declared metadata', () => {
    expect(readWorkGenerationCompletion({ content: 'Old answer' })).toBeNull();
    expect(() => readWorkGenerationCompletion({ completion: { ...complete('eos-token'), generatedTokenCount: -1 } }))
      .toThrow('invalid generation completion');
    expect(() => readWorkGenerationCompletion({ completion: complete('fabricated-stop') }))
      .toThrow('invalid generation completion');
  });

  it('preserves scoped stream raw counts with empty visible deltas', async () => {
    const terminal = complete('max-tokens');
    const session = { loaded: true, modelId: model.id, manifestHash: model.identity.slice(7),
      resetGenerationState: vi.fn(), async *stream() {
        yield { type: 'text-delta', text: '' };
        yield { type: 'text-delta', text: 'final' };
        yield { type: 'complete', outputText: 'final', completion: terminal };
      } };
    const controller = new AbortController(), deltas = [];
    const provider = await openWorkProvider({ model, service: { open: async () => session },
      scope: 'fixture', signal: controller.signal, generation: {}, maxOutcomeCharacters: 100 });
    const result = await provider.generate([], delta => deltas.push(delta), { signal: controller.signal });
    expect(deltas).toEqual(['', 'final']);
    expect(result.completion).toEqual(terminal);
    terminal.generatedTokenCount = 100;
    expect(result.completion.generatedTokenCount).toBe(9);
  });

  it('never decodes raw adapter tokens into visible text', async () => {
    const adapter = { identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: model.identity };
    let active = null;
    const session = { loaded: true, modelId: model.id, manifestHash: model.identity.slice(7),
      get activeLoRA() { return active; }, resetGenerationState() {}, async *stream() {},
      loadLoRA() { active = 'adapter'; }, unloadLoRA() { active = null; },
      advanced: { createIncrementalDecoder() { throw new Error('Reploid must not decode raw tokens'); } },
      async generate(_messages, options) {
        options.onToken(1, ''); options.onToken(2, 'answer');
        return { outputText: 'answer!', completion: complete('eos-token'), evidence: {
          runtimeProfile: { model: { modelId: model.id, manifestHash: model.identity,
            activeAdapterDigest: adapter.identity } } } };
      } };
    const signal = new AbortController().signal, deltas = [];
    const provider = await openWorkProvider({ model, service: { open: async () => session }, signal,
      generation: {}, maxOutcomeCharacters: 100,
      resolveAdapter: async () => ({ manifest: { baseModel: model.id }, options: {} }) });
    const result = await provider.generate([], delta => deltas.push(delta), { signal, adapters: [adapter] });
    expect(deltas).toEqual(['', 'answer', '!']);
    expect(result.content).toBe('answer!');
    expect(result.completion).toEqual(complete('eos-token'));
    expect(active).toBeNull();
  });
});
