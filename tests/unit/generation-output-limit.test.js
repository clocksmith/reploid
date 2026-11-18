// @vitest-environment node
// The caller's output limit from generation settings, followed from the native whole-model
// provider through the resident owner and the scoped provider into the options of a session.
// The session is a stand-in that stops at `maxTokens` as a sampler does: this shows the limit
// reaches the sampler options, not that a real model honours them.
import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createNativeWholeModel, NATIVE_WHOLE_MODEL_SETTINGS } from '../../server/native-whole-model.js';
import { openScopedModelProvider } from '../../shared/infrastructure/scoped-model-provider.js';
import { normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import profile from '../../apps/poolday/config/work-profile.json' with { type: 'json' };

const messages = [{ role: 'user', content: 'Count upward from one.' }];
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

/** Emits up to ten tokens, or `maxTokens` if that is lower, and reports why it stopped. */
function fakeSession(model, seen) {
  return { loaded: true, modelId: model.id, manifestHash: model.identity, activeLoRA: null, deviceInfo: null,
    supports: () => false, async resetGenerationState() {},
    async *stream(_messages, options) {
      seen.push(options);
      const natural = 10, limit = Math.min(natural, options.maxTokens ?? natural);
      let outputText = '';
      for (let token = 1; token <= limit; token++) {
        const text = `${token} `; outputText += text;
        yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text };
      }
      yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText, completion: { schema: 'doppler.generation-completion/v1',
        stopReason: limit < natural ? 'max-tokens' : 'eos-token', promptTokenCount: 6, generatedTokenCount: limit } };
    } };
}

async function nativeProvider() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'output-limit-')); roots.push(root);
  const bytes = JSON.stringify({ modelId: 'model' }); await fs.writeFile(path.join(root, 'manifest.json'), bytes);
  const model = { id: 'model', provider: 'doppler', identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), generation: { maxTokens: 16 } };
  const seen = [];
  const service = { open: async () => fakeSession(model, seen), close: async () => {} };
  const provider = createNativeWholeModel({ model, modelDirectory: root, nativeGpu: async () => {}, service, configureMemory: async () => {} });
  await provider.contribute(true);
  return { provider, seen, model };
}
const controls = settings => ({ signal: new AbortController().signal, adapterIdentities: [],
  ...(settings === undefined ? {} : { settings: normalizeGenerationSettings(settings) }) });

it('advertises that the native whole-model provider enforces only the output limit', async () => {
  const f = await nativeProvider();
  try {
    expect(f.provider.getGenerationSettingsCapability()).toEqual({ schema: 'reploid.generation-settings/v1',
      maxOutputTokens: true, tools: false, outputSchema: false, thinking: false });
    expect(f.provider.getGenerationSettingsCapability()).toBe(NATIVE_WHOLE_MODEL_SETTINGS);
  } finally { await f.provider.close(); }
});

it('passes the caller output limit to the session options, where generation stops', async () => {
  const f = await nativeProvider();
  try {
    const deltas = [];
    const limited = await f.provider.generate(messages, delta => deltas.push(delta), controls({ maxOutputTokens: 3 }));
    expect(f.seen[0].maxTokens).toBe(3);
    expect(deltas).toEqual(['1 ', '2 ', '3 ']);
    expect(limited).toMatchObject({ content: '1 2 3 ', completion: { generatedTokenCount: 3, stopReason: 'max-tokens' } });
    // The HTTP edge reports this stop reason as finish_reason "length" (server/text-requester.js).
    expect(['length', 'max-tokens', 'context-limit']).toContain(limited.completion.stopReason);

    // Without settings, and with settings that set no limit, the prepared ceiling of 16 applies as before.
    const unlimited = await f.provider.generate(messages, () => {}, controls());
    expect(f.seen[1].maxTokens).toBe(16);
    expect(unlimited.completion).toMatchObject({ generatedTokenCount: 10, stopReason: 'eos-token' });
    await f.provider.generate(messages, () => {}, controls({ maxOutputTokens: null }));
    expect(f.seen[2].maxTokens).toBe(16);
    // A limit above the prepared ceiling never raises it.
    await f.provider.generate(messages, () => {}, controls({ maxOutputTokens: 64 }));
    expect(f.seen[3].maxTokens).toBe(16);
  } finally { await f.provider.close(); }
});

it('refuses settings beyond the advertised capability instead of ignoring them', async () => {
  const f = await nativeProvider();
  try {
    expect(() => f.provider.generate(messages, () => {}, controls({ thinking: 'off' }))).toThrow('Generation setting thinking is not supported');
    expect(() => f.provider.generate(messages, () => {}, controls({ tools: [{ name: 'lookup', parameters: {} }] }))).toThrow('Generation setting tools is not supported');
    expect(() => f.provider.generate(messages, () => {}, { ...controls(), settings: { temperature: 1 } })).toThrow('unknown key temperature');
    expect(f.seen).toEqual([]);
  } finally { await f.provider.close(); }
});

it('caps the scoped provider session at the request limit and reports the limit as the stop reason', async () => {
  const model = { id: 'model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64) };
  const seen = [], lifetime = new AbortController();
  const provider = await openScopedModelProvider({ model, service: { open: async () => fakeSession(model, seen) }, scope: 'test', signal: lifetime.signal,
    generation: { maxTokens: 8, temperature: 0 }, maxOutcomeCharacters: 1000, providerPolicy: profile });
  const result = await provider.generate(messages, () => {}, { signal: lifetime.signal, maxOutputTokens: 2 });
  expect(seen[0]).toMatchObject({ maxTokens: 2, temperature: 0 });
  expect(result.completion).toEqual({ schema: 'doppler.generation-completion/v1', stopReason: 'max-tokens', promptTokenCount: 6, generatedTokenCount: 2 });
  await expect(provider.generate(messages, () => {}, { signal: lifetime.signal, maxOutputTokens: 0 })).rejects.toThrow('positive integer');
});
