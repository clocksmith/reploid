import { afterEach, describe, expect, it } from 'vitest';

import {
  createDopplerRuntime,
  resetDopplerModuleCacheForTests
} from '../../self/pool/doppler-runtime.js';
import { BROWSER_RUNTIME_CONFIG } from '../../self/pool/config.js';
import { hashJson } from '../../self/pool/inference-receipt.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../self/pool/model-contract.js';

const launchHandle = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  artifactIdentity: LAUNCH_MODEL.artifactIdentity,
  generate(prompt) {
    return {
      outputText: `answered:${prompt}`,
      tokenIds: [101, 202],
      tokenCounts: { input: 1, output: 2 }
    };
  }
});

describe('Doppler browser runtime adapter', () => {
  afterEach(() => {
    delete globalThis.REPLOID_DOPPLER_MODULE;
    delete globalThis.REPLOID_DOPPLER_MODULE_URL;
    delete globalThis.REPLOID_DOPPLER_MODULE_URLS;
    delete globalThis.REPLOID_DOPPLER_KERNEL_BASE_URL;
    delete globalThis.__DOPPLER_KERNEL_BASE_PATH__;
    delete globalThis.REPLOID_DOPPLER_LOAD_OPTIONS;
    delete globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE;
    resetDopplerModuleCacheForTests();
  });

  it('disables the Node quickstart cache without changing Poolday load options', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousProcess = globalThis.process;
    let loadOptions = null;

    try {
      globalThis.window = {};
      globalThis.document = {};
      globalThis.process = { env: { EXISTING_ENV: 'present' } };
      globalThis.REPLOID_DOPPLER_LOAD_OPTIONS = { cache: 'opfs' };
      globalThis.__POOL_DOPPLER_RUNTIME_TEST = {
        load(_input, options) {
          loadOptions = options;
          return { handle: launchHandle() };
        }
      };
      globalThis.REPLOID_DOPPLER_MODULE_URL = 'data:text/javascript,export const load = (...args) => globalThis.__POOL_DOPPLER_RUNTIME_TEST.load(...args);';

      const runtime = createDopplerRuntime();
      const loaded = await runtime.loadModel(LAUNCH_MODEL);

      expect(loaded.ok).toBe(true);
      expect(loadOptions.cache).toBe('opfs');
      expect(globalThis.process.env).toEqual({
        EXISTING_ENV: 'present',
        DOPPLER_QUICKSTART_CACHE: 'false'
      });
    } finally {
      delete globalThis.__POOL_DOPPLER_RUNTIME_TEST;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousProcess === undefined) delete globalThis.process;
      else globalThis.process = previousProcess;
    }
  });

  it('loads an injected public Doppler module and merges deployment load options', async () => {
    let loadInput = null;
    let loadOptions = null;
    globalThis.REPLOID_DOPPLER_LOAD_OPTIONS = { modelBaseUrl: '/models', cache: 'opfs' };
    globalThis.REPLOID_DOPPLER_MODULE = {
      load(input, options) {
        loadInput = input;
        loadOptions = options;
        return { handle: launchHandle() };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel({
      ...LAUNCH_MODEL,
      loadOptions: { cache: 'memory', timeoutMs: 5000 }
    });

    expect(loaded.ok).toBe(true);
    expect(loadInput).toEqual(LAUNCH_MODEL.loadInput);
    expect(loadInput.url).toContain(LAUNCH_MODEL.dopplerLoadRef);
    expect(loadOptions).toMatchObject({
      modelBaseUrl: '/models',
      cache: 'memory',
      timeoutMs: 5000,
      runtimeConfig: {
        inference: {
          kernelPathPolicy: {
            mode: 'capability-aware',
            sourceScope: ['model', 'manifest', 'config'],
            allowSources: ['model', 'manifest', 'config'],
            onIncompatible: 'remap'
          }
        }
      }
    });
    expect(globalThis.__DOPPLER_KERNEL_BASE_PATH__).toBe(BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl);

    const result = await runtime.generate({
      prompt: 'hello',
      generationConfig: {
        mode: 'greedy',
        maxOutputTokens: 4,
        temperature: 0,
        topK: 1,
        topP: 1
      },
      assignment: { assignmentId: 'assignment_test' }
    });
    expect(result.outputText).toBe('answered:hello');
    expect(result.tokenIds).toEqual([101, 202]);
  });

  it('honors the hosted Doppler kernel base override before loading the module', async () => {
    globalThis.REPLOID_DOPPLER_KERNEL_BASE_URL = 'https://cdn.example.test/doppler/kernels///';
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        return { handle: launchHandle() };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel(LAUNCH_MODEL);

    expect(loaded.ok).toBe(true);
    expect(globalThis.__DOPPLER_KERNEL_BASE_PATH__).toBe('https://cdn.example.test/doppler/kernels');
  });

  it('rejects descriptor-only identity when a loaded handle lacks model evidence', async () => {
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        return {
          handle: {
            generate() {
              return { outputText: 'no identity' };
            }
          }
        };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel(LAUNCH_MODEL);
    expect(loaded.ok).toBe(false);
    expect(loaded.reason).toContain('Loaded Doppler handle must expose modelId');
  });

  it('lets Qwen loads reach Doppler so the manifest capability fallback can remap shader-f16 paths', async () => {
    const qwenModel = getEnabledPoolModelContract('qwen-3-5-0-8b-q4k-ehaf16');
    let loadCalled = false;
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        loadCalled = true;
        return {
          handle: {
            modelId: qwenModel.modelId,
            modelHash: qwenModel.modelHash,
            manifestHash: qwenModel.manifestHash,
            artifactIdentity: qwenModel.artifactIdentity,
            generate(request) {
              return {
                outputText: `qwen:${request.prompt}`,
                tokenIds: [404],
                tokenCounts: { input: 1, output: 1 }
              };
            }
          }
        };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel(qwenModel);

    expect(loaded.ok).toBe(true);
    expect(loadCalled).toBe(true);
    expect(runtime.getModelInfo().modelId).toBe(qwenModel.modelId);
  });

  it('derives public handle identity from manifest artifact identity', async () => {
    const artifactIdentity = {
      sourceCheckpointId: 'google/gemma-test',
      weightPackId: 'gemma-test-wp-catalog-v1',
      manifestVariantId: 'gemma-test-mv-exec-v1',
      artifactCompleteness: 'complete'
    };
    const manifest = {
      modelId: 'gemma-test-q4k',
      artifactIdentity,
      shards: [{ filename: 'shard_00000.bin', size: 16, hash: 'abc123' }]
    };
    const descriptor = {
      modelId: manifest.modelId,
      modelHash: await hashJson(artifactIdentity),
      manifestHash: await hashJson(manifest),
      runtime: 'doppler',
      backend: 'browser-webgpu',
      artifactIdentity
    };
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        return {
          modelId: manifest.modelId,
          manifest,
          generate() {
            return { outputText: 'manifest evidence', tokenIds: [303] };
          }
        };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel(descriptor);

    expect(loaded.ok).toBe(true);
    expect(runtime.getModelInfo()).toMatchObject({
      modelId: descriptor.modelId,
      modelHash: descriptor.modelHash,
      manifestHash: descriptor.manifestHash,
      artifactIdentity,
      identityEvidence: {
        modelId: true,
        modelHash: true,
        manifestHash: false,
        artifactIdentity: true
      }
    });
  });

  it('uses manifest identity before loader-level handle ids', async () => {
    const artifactIdentity = {
      sourceCheckpointId: 'Qwen/Qwen3.5-0.8B',
      weightPackHash: 'sha256:1234567890abcdef',
      weightPackId: 'qwen-wp-catalog-v1',
      manifestVariantId: 'qwen-mv-exec-v1',
      modalitySet: ['text', 'vision'],
      artifactCompleteness: 'complete'
    };
    const manifest = {
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      artifactIdentity,
      shards: [{ filename: 'shard_00000.bin', size: 16, hash: 'abc123' }]
    };
    const descriptor = {
      modelId: manifest.modelId,
      modelHash: artifactIdentity.weightPackHash,
      manifestHash: await hashJson(manifest),
      runtime: 'doppler',
      backend: 'browser-webgpu',
      artifactIdentity
    };
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        return {
          modelId: 'https://cdn.example.test/models/qwen-3-5-0-8b-q4k-ehaf16',
          modelHash: 'loader-cache-id',
          manifest,
          generate() {
            return { outputText: 'manifest wins', tokenIds: [404] };
          }
        };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel(descriptor);

    expect(loaded.ok).toBe(true);
    expect(runtime.getModelInfo()).toMatchObject({
      modelId: descriptor.modelId,
      modelHash: descriptor.modelHash,
      manifestHash: descriptor.manifestHash,
      artifactIdentity
    });
  });

  it('rejects explicit manifest hash mismatches from public handles', async () => {
    const artifactIdentity = {
      weightPackHash: 'sha256:1234567890abcdef',
      weightPackId: 'qwen-wp-catalog-v1',
      manifestVariantId: 'qwen-mv-exec-v1'
    };
    const manifest = {
      modelId: 'qwen-3-5-0-8b-q4k-ehaf16',
      manifestHash: 'sha256:bad_manifest_hash',
      artifactIdentity,
      shards: [{ filename: 'shard_00000.bin', size: 16, hash: 'abc123' }]
    };
    globalThis.REPLOID_DOPPLER_MODULE = {
      load() {
        return {
          manifest,
          generate() {
            return { outputText: 'wrong manifest hash' };
          }
        };
      }
    };

    const runtime = createDopplerRuntime();
    const loaded = await runtime.loadModel({
      modelId: manifest.modelId,
      modelHash: artifactIdentity.weightPackHash,
      manifestHash: 'sha256:expected_manifest_hash',
      artifactIdentity
    });

    expect(loaded.ok).toBe(false);
    expect(loaded.reason).toContain('Loaded Doppler handle manifestHash does not match requested model identity');
  });

  it('prefers generateText over streaming generate handles', async () => {
    const runtime = createDopplerRuntime({
      model: LAUNCH_MODEL,
      modelSession: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        generate() {
          return (async function* streamObjects() {
            yield { text: 'stream-object' };
          })();
        },
        generateText(prompt) {
          return `text:${prompt}`;
        }
      }
    });

    const result = await runtime.generate({
      prompt: 'hello',
      generationConfig: { maxOutputTokens: 4 },
      assignment: { assignmentId: 'assignment_text' }
    });

    expect(result.outputText).toBe('text:hello');
  });

  it('calls single-arity Doppler generate handles with prompt and options before request-object fallback', async () => {
    const calls = [];
    const runtime = createDopplerRuntime({
      model: LAUNCH_MODEL,
      modelSession: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        generate(prompt, options = {}) {
          calls.push({ prompt, options });
          return {
            outputText: `prompt:${prompt}`,
            tokenIds: [707],
            tokenCounts: { input: 1, output: 1 }
          };
        }
      }
    });

    const result = await runtime.generate({
      prompt: 'hello',
      generationConfig: {
        mode: 'greedy',
        maxOutputTokens: 4,
        temperature: 0.2,
        topK: 7,
        topP: 0.8
      },
      assignment: { assignmentId: 'assignment_prompt_first' }
    });

    expect(result.outputText).toBe('prompt:hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      prompt: 'hello',
      options: {
        maxTokens: 4,
        temperature: 0,
        topK: 1,
        topP: 1
      }
    });
  });

  it('resets and serializes public Doppler generation for independent Poolday assignments', async () => {
    const events = [];
    let releaseFirst = null;
    let markFirstStarted = null;
    const firstStarted = new Promise((resolve) => {
      releaseFirst = () => {};
      markFirstStarted = resolve;
    });
    const runtime = createDopplerRuntime({
      model: LAUNCH_MODEL,
      modelSession: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash,
        resetGenerationState() {
          events.push('reset');
        },
        async generate(prompt) {
          events.push(`generate:${prompt}`);
          if (prompt === 'first') {
            markFirstStarted();
            await new Promise((resolve) => {
              releaseFirst = resolve;
            });
          }
          return {
            outputText: `ok:${prompt}`,
            tokenIds: [prompt === 'first' ? 1 : 2],
            tokenCounts: { input: 1, output: 1 }
          };
        }
      }
    });

    const first = runtime.generate({
      prompt: 'first',
      generationConfig: { maxOutputTokens: 1 },
      assignment: { assignmentId: 'assignment_first' }
    });
    const second = runtime.generate({
      prompt: 'second',
      generationConfig: { maxOutputTokens: 1 },
      assignment: { assignmentId: 'assignment_second' }
    });

    await firstStarted;
    expect(events).toEqual(['reset', 'generate:first']);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.outputText).toBe('ok:first');
    expect(secondResult.outputText).toBe('ok:second');
    expect(events).toEqual([
      'reset',
      'generate:first',
      'reset',
      'generate:second'
    ]);
  });

  it('installs the hosted handle attachment hook for provider pages', async () => {
    const runtime = createDopplerRuntime();
    expect(typeof globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE).toBe('function');

    const attached = await globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE(launchHandle(), LAUNCH_MODEL);
    expect(attached.ok).toBe(true);
    expect(runtime.isReady()).toBe(true);
    expect(runtime.getModelInfo().modelId).toBe(LAUNCH_MODEL.modelId);
  });
});
