import { describe, expect, it, vi } from 'vitest';
import {
  assertDopplerSessionIdentity,
  cancelDopplerSession,
  createDopplerModuleLoader,
  generateWithDopplerSession,
  streamDopplerText
} from '../../packages/reploid/src/adapters/doppler.js';

const hash = letter => 'sha256:' + letter.repeat(64);

describe('library Doppler session contract', () => {
  it('loads host candidates in order and retries after a failed load instead of caching the failure', async () => {
    const module = { DOPPLER_VERSION: 'test' };
    let available = false;
    const importModule = vi.fn(async specifier => {
      if (specifier === '/second.js' && available) return module;
      throw new Error('missing ' + specifier);
    });
    const loader = createDopplerModuleLoader({ candidates: () => ['/first.js', '/second.js'], importModule });
    await expect(loader.load()).rejects.toThrow('Attempts: /first.js: missing /first.js; /second.js: missing /second.js');
    available = true;
    await expect(loader.load()).resolves.toBe(module);
    await loader.load();
    expect(importModule).toHaveBeenCalledTimes(4);
  });

  it('rejects a session whose own identity differs from the request, and lets a signed identity replace manifest hashes', async () => {
    const session = { manifest: { modelId: 'model', modelHash: hash('a'), manifestHash: hash('b') } };
    await expect(assertDopplerSessionIdentity(session, { modelId: 'model', modelHash: hash('a'), manifestHash: hash('b') })).resolves.toBeUndefined();
    await expect(assertDopplerSessionIdentity(session, { modelId: 'model', modelHash: hash('c') })).rejects.toThrow('modelHash does not match');
    await expect(assertDopplerSessionIdentity({}, { modelId: 'model' })).rejects.toThrow('must expose modelId');
    const signed = { semanticRoot: hash('c'), envelopeDigest: hash('d') };
    await expect(assertDopplerSessionIdentity(session, { modelHash: hash('c'), manifestHash: hash('d') }, { packIdentity: signed })).resolves.toBeUndefined();
    await expect(assertDopplerSessionIdentity(session, { modelHash: hash('a') }, { packIdentity: signed })).rejects.toThrow('modelHash');
  });

  it('calls a prompt-and-options handle first, falls back to the request form, and surfaces the first failure', async () => {
    const calls = [];
    const session = { async generateText(...args) { calls.push(args); if (calls.length === 1) throw new Error('first'); return 'ok'; } };
    expect(await generateWithDopplerSession(session, 'hi', { maxTokens: 3, mode: 'greedy' })).toBe('ok');
    expect(calls[0]).toEqual(['hi', { maxTokens: 3, temperature: 0, topK: 1, topP: 1, useSpeculative: false }]);
    expect(calls[1][0]).toMatchObject({ prompt: 'hi', maxTokens: 3, samplingOptions: calls[0][1] });
    let attempts = 0;
    const failing = { async generate() { throw new Error(++attempts === 1 ? 'prompt failure' : 'request failure'); } };
    await expect(generateWithDopplerSession(failing, 'hi', {})).rejects.toThrow('prompt failure');
    expect(attempts).toBe(2);
  });

  it('yields only text deltas from a scoped stream and reports whether cancellation was requested', async () => {
    const session = { async *stream() {
      yield { type: 'text-delta', text: 'a' }; yield { type: 'complete', outputText: 'ab' }; yield { type: 'text-delta', text: 'b' };
    } };
    const text = [];
    for await (const chunk of streamDopplerText(session, [])) text.push(chunk);
    expect(text).toEqual(['a', 'b']);
    const cancel = vi.fn(async () => {});
    expect(await cancelDopplerSession({ cancel }, 'stop')).toEqual({ requested: true, method: 'cancel' });
    expect(cancel).toHaveBeenCalledWith({ reason: 'stop' });
    expect(await cancelDopplerSession({}, 'stop')).toEqual({ requested: false, method: null });
  });
});
