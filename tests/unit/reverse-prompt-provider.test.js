// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { openScopedModelProvider } from '../../shared/infrastructure/scoped-model-provider.js';
import { REVERSE_PROMPT_GENERATION, REVERSE_PROMPT_GENERATION_HASH } from '../../shared/infrastructure/reverse-prompt-profile.js';
import { normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { DOPPLER_PACKAGE_VERSION } from '../../shared/config/doppler-local-models.js';
import workProfile from '../../apps/poolday/config/work-profile.json' with { type: 'json' };

const digest = 'sha256:' + 'a'.repeat(64);
const backend = 'sha256:' + 'b'.repeat(64);
const settings = normalizeGenerationSettings({ maxOutputTokens: 16,
  reversePrompt: { schema: 'reploid.reverse-prompt/v1', backendIdentityHash: backend } });

it('enforces the backend, fresh state and non-thinking Qwen decoding before returning a scored output', async () => {
  const model = { id: 'small', provider: 'doppler', identity: digest };
  const messages = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'A greeting?' }];
  const signal = new AbortController().signal;
  const session = { loaded: true, modelId: model.id, manifestHash: digest, activeLoRA: null,
    manifest: { inference: { chatTemplate: { enabled: true, type: 'qwen', thinking: false } } },
    supports: key => key === 'generationContext', resetGenerationState: vi.fn(), stream: vi.fn(),
    createGenerationContext: vi.fn(), generate: vi.fn() };
  const evidence = { generationConfig: REVERSE_PROMPT_GENERATION, generationConfigHash: REVERSE_PROMPT_GENERATION_HASH, backendIdentityHash: backend, runtimeProfile: {
    runtime: { package: 'dopplerx', version: DOPPLER_PACKAGE_VERSION, surface: 'node' },
    model: { modelId: model.id, manifestHash: digest } } };
  session.generate.mockResolvedValue({ outputText: 'Hello', evidence, completion: { schema: 'doppler.generation-completion/v1',
    stopReason: 'eos-token', promptTokenCount: 5, generatedTokenCount: 2 } });
  const provider = await openScopedModelProvider({ model, service: { open: async () => session }, scope: 'daily-fixture',
    signal, providerPolicy: workProfile, generation: { temperature: 1, topK: 30, maxTokens: 64 }, maxOutcomeCharacters: 1024 });
  const onText = vi.fn(), controls = { signal, maxOutputTokens: 16, settings, contextOwner: 'player', contextId: 'older-game' };
  try {
    await expect(provider.generate(messages, onText, controls)).resolves.toMatchObject({ content: 'Hello' });
    expect(session.generate.mock.calls[0][1]).toMatchObject(REVERSE_PROMPT_GENERATION);
    expect(session.createGenerationContext).not.toHaveBeenCalled();
    expect(session.resetGenerationState).toHaveBeenCalledTimes(2);
    expect(session.stream).not.toHaveBeenCalled();
    expect(onText).toHaveBeenCalledOnce();

    evidence.backendIdentityHash = 'sha256:' + 'f'.repeat(64);
    await expect(provider.generate(messages, onText, controls)).rejects.toThrow('qualified backend');
    expect(onText).toHaveBeenCalledOnce();
    evidence.backendIdentityHash = backend;
    evidence.generationConfigHash = 'sha256:' + 'c'.repeat(64);
    await expect(provider.generate(messages, onText, controls)).rejects.toThrow('decoding policy');
    evidence.generationConfigHash = REVERSE_PROMPT_GENERATION_HASH;
    session.manifest.inference.chatTemplate.thinking = true;
    await expect(provider.generate(messages, onText, controls)).rejects.toThrow('thinking disabled');
    expect(session.generate).toHaveBeenCalledTimes(3);
  } finally { await provider.close(); }
});
