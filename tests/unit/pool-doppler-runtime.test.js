import { afterEach, describe, expect, it } from 'vitest';

import {
  createDopplerRuntime,
  resetDopplerModuleCacheForTests
} from '../../self/pool/doppler-runtime.js';
import { BROWSER_RUNTIME_CONFIG } from '../../self/pool/config.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const launchHandle = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  generate(request) {
    return {
      outputText: `answered:${request.prompt}`,
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
    expect(loadInput).toBe(LAUNCH_MODEL.dopplerLoadRef);
    expect(loadOptions).toEqual({ modelBaseUrl: '/models', cache: 'memory', timeoutMs: 5000 });
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

  it('installs the hosted handle attachment hook for provider pages', async () => {
    const runtime = createDopplerRuntime();
    expect(typeof globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE).toBe('function');

    const attached = await globalThis.REPLOID_POOL_ATTACH_DOPPLER_HANDLE(launchHandle(), LAUNCH_MODEL);
    expect(attached.ok).toBe(true);
    expect(runtime.isReady()).toBe(true);
    expect(runtime.getModelInfo().modelId).toBe(LAUNCH_MODEL.modelId);
  });
});
