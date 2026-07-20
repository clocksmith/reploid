import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDopplerPublicProviderAdapter,
  createReploidDopplerProvider
} from '../../self/providers/doppler-reploid.js';

class ConfigError extends Error {}

const setWebGpu = (value) => {
  Object.defineProperty(globalThis.navigator, 'gpu', {
    configurable: true,
    value
  });
};

describe('Reploid Doppler 0.4.14 provider adapter', () => {
  afterEach(() => {
    setWebGpu(undefined);
    delete globalThis.REPLOID_DOPPLER_LOAD_OPTIONS;
  });

  it('adapts public model handles to chat, stream, KV, and LoRA methods', async () => {
    setWebGpu({});
    const calls = [];
    const handle = {
      loaded: true,
      modelId: 'qwen-test',
      deviceInfo: { vendor: 'test' },
      activeLoRA: null,
      async chatText(messages, options) {
        calls.push({ method: 'chatText', messages, options });
        return { content: 'hello', usage: { totalTokens: 2 } };
      },
      async *chat(messages, options) {
        calls.push({ method: 'chat', messages, options });
        yield 'hel';
        yield 'lo';
      },
      advanced: {
        prefillKV: vi.fn(async () => ({ seqLen: 3 }))
      },
      async loadLoRA(adapter) {
        this.activeLoRA = adapter.name;
      },
      async unloadLoRA() {
        this.activeLoRA = null;
      },
      unload: vi.fn(async () => {})
    };
    const load = vi.fn(async () => handle);
    const runtime = { load, listModels: vi.fn(async () => ['qwen-test']) };
    const base = createDopplerPublicProviderAdapter({ doppler: runtime }, {
      Errors: { ConfigError }
    });
    const provider = createReploidDopplerProvider(base, { Errors: { ConfigError } });
    const model = { id: 'qwen-test', maxTokens: 8, temperature: 0 };

    expect(await base.init()).toBe(true);
    const response = await provider.chat([{ role: 'user', content: 'hi' }], model, 'request-1');
    const updates = [];
    const streamed = await provider.stream(
      [{ role: 'user', content: 'hi' }],
      model,
      (token) => updates.push(token),
      'request-2'
    );

    expect(load).toHaveBeenCalledWith('qwen-test', {});
    expect(response).toMatchObject({ content: 'hello', model: 'qwen-test', provider: 'doppler' });
    expect(streamed.content).toBe('hello');
    expect(updates).toEqual(['hel', 'lo']);
    expect(calls.map(({ method }) => method)).toEqual(['chatText', 'chat']);
    expect(calls[0].options).toEqual({ maxTokens: 8, temperature: 0 });
    await expect(provider.prefillKV('prefix', model)).resolves.toEqual({ seqLen: 3 });
    await provider.loadLoRAAdapter({ name: 'adapter-a' });
    expect(provider.getActiveLoRA()).toBe('adapter-a');
    await provider.unloadLoRAAdapter();
    expect(provider.getActiveLoRA()).toBeNull();
    await provider.destroy();
    expect(handle.unload).toHaveBeenCalledOnce();
  });

  it('keeps structured load progress out of the text token stream', async () => {
    setWebGpu({});
    const handle = {
      loaded: true,
      async *chat() {
        yield 'ready';
      },
      unload: vi.fn(async () => {})
    };
    const load = vi.fn(async (_source, options) => {
      options.onProgress?.({ stage: 'download-start', percent: 25 });
      options.onProgress?.({ stage: 'warming', progress: 0.5 });
      return handle;
    });
    const base = createDopplerPublicProviderAdapter({ load }, { Errors: { ConfigError } });
    const provider = createReploidDopplerProvider(base, { Errors: { ConfigError } });
    const updates = [];

    const result = await provider.stream(
      [{ role: 'user', content: 'hi' }],
      { id: 'qwen-test' },
      (text) => updates.push(text),
      'request-progress'
    );

    expect(result.content).toBe('ready');
    expect(updates).toEqual([
      '[System: Downloading model... 25%]\n',
      '[System: Loading model into GPU... 50%]\n',
      'ready'
    ]);
    expect(updates.every((text) => typeof text === 'string')).toBe(true);
  });

  it('fails closed when Doppler emits a non-text generation chunk', async () => {
    setWebGpu({});
    const handle = {
      loaded: true,
      async *chat() {
        yield { token: 'not-text' };
      },
      unload: vi.fn(async () => {})
    };
    const base = createDopplerPublicProviderAdapter({
      load: vi.fn(async () => handle)
    }, { Errors: { ConfigError } });
    const provider = createReploidDopplerProvider(base, { Errors: { ConfigError } });

    await expect(provider.stream(
      [{ role: 'user', content: 'hi' }],
      { id: 'qwen-test' },
      vi.fn(),
      'request-invalid-stream'
    )).rejects.toThrow('Doppler chat stream emitted a non-text chunk');
  });

  it('scopes promoted runtime options to the intended model', async () => {
    setWebGpu({});
    const handle = {
      loaded: true,
      async chatText() { return { content: 'ok' }; },
      unload: vi.fn(async () => {})
    };
    const load = vi.fn(async () => handle);
    const base = createDopplerPublicProviderAdapter({ load }, { Errors: { ConfigError } });
    await base.init();
    globalThis.REPLOID_DOPPLER_LOAD_OPTIONS = {
      scopeModelId: 'qwen-target',
      optimizationProfileHash: 'sha256:profile',
      isolatedLoader: true,
      runtimeConfig: { shared: { kernelWarmup: { enabled: true } } }
    };

    await base.loadModel('qwen-other');
    await base.loadModel('qwen-target');

    expect(load).toHaveBeenNthCalledWith(1, 'qwen-other', {});
    expect(load).toHaveBeenNthCalledWith(2, 'qwen-target', {
      isolatedLoader: true,
      runtimeConfig: { shared: { kernelWarmup: { enabled: true } } }
    });
  });

  it('forwards only the supported Doppler tooling surface', async () => {
    const base = {
      getCapabilities: vi.fn(() => ({ available: true, initialized: true })),
      destroy: vi.fn(async () => {})
    };
    const tooling = {
      runBrowserCommand: vi.fn(async () => ({ ok: true })),
      validateRuntimeOptimizationContract: vi.fn((contract) => contract),
      hashRuntimeOptimizationContract: vi.fn(() => 'sha256:contract'),
      enumerateRuntimeOptimizationCandidates: vi.fn(() => [{ candidateId: 'candidate-a' }]),
      materializeRuntimeOptimizationCandidate: vi.fn(() => ({ runtimeConfig: {} })),
      evaluateBrowserRuntimeOptimizationCandidate: vi.fn(async () => ({
        decision: { accepted: true }
      }))
    };
    const provider = createReploidDopplerProvider(base, {
      Errors: { ConfigError },
      loadTooling: vi.fn(async () => tooling)
    });
    const contract = { schema: 'test' };

    await expect(provider.tooling.runBrowserCommand({ request: {} })).resolves.toEqual({ ok: true });
    await expect(provider.tooling.optimization.validateContract(contract)).resolves.toBe(contract);
    await expect(provider.tooling.optimization.hashContract(contract)).resolves.toBe('sha256:contract');
    await expect(provider.tooling.optimization.enumerateCandidates(contract)).resolves.toEqual([
      { candidateId: 'candidate-a' }
    ]);
    expect(provider.bench).toBeUndefined();
  });

  it('keeps the requested registry identity when Doppler reports a source URL', async () => {
    setWebGpu({});
    const handle = {
      loaded: true,
      modelId: 'https://models.example.test/qwen-test',
      unload: vi.fn(async () => {})
    };
    const base = createDopplerPublicProviderAdapter({
      load: vi.fn(async () => handle)
    }, { Errors: { ConfigError } });

    await base.init();
    await base.loadModel('qwen-test', 'https://models.example.test/qwen-test');

    expect(base.getCapabilities().currentModelId).toBe('qwen-test');
    expect(base.getCurrentModelId()).toBe('qwen-test');
  });

  it('fails closed when WebGPU or the public load API is missing', async () => {
    setWebGpu(undefined);
    expect(() => createDopplerPublicProviderAdapter({}, {
      Errors: { ConfigError }
    })).toThrow('Doppler public module does not expose load');

    const base = createDopplerPublicProviderAdapter({
      load: vi.fn()
    }, { Errors: { ConfigError } });
    const provider = createReploidDopplerProvider(base, { Errors: { ConfigError } });
    await expect(provider.chat([], { id: 'qwen-test' }, 'request')).rejects.toThrow(
      'Doppler not available - WebGPU may not be supported'
    );
  });
});
