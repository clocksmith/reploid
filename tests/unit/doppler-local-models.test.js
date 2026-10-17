import pin from '../../self/config/doppler-package.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOPPLER_MODEL_ID,
  DOPPLER_BROWSER_RELEASE_REF,
  DOPPLER_BROWSER_RUNTIME_VERSION,
  DOPPLER_PACKAGE_NAME,
  DOPPLER_PACKAGE_VERSION,
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL,
  DOPPLER_STORAGE_TOOLING_URL,
  DOPPLER_TOOLING_URL,
  LOCAL_DOPPLER_MODELS,
  buildDefaultLocalDopplerModelConfig,
  buildLocalDopplerModelConfig,
  getDefaultLocalDopplerModel,
  getLocalDopplerModel
} from '../../self/config/doppler-local-models.js';

describe('local Doppler model contract', () => {
  it('allows the streamed input transaction to remain open for the full conversation attempt', () => {
    const conversation = JSON.parse(readFileSync('packages/reploid/src/chat/policy.json', 'utf8'));
    const partition = JSON.parse(readFileSync('self/config/partition-policy.json', 'utf8'));
    expect(partition.inputChannel.timeoutMs).toBeGreaterThanOrEqual(conversation.attemptTimeoutMs);
    expect(partition.grantMs).toBeGreaterThanOrEqual(conversation.attemptTimeoutMs);
  });
  it('exposes the same identified Qwen models for requests and contribution', () => {
    expect(DOPPLER_PACKAGE_NAME).toBe('doppler-gpu');
    expect(DOPPLER_PACKAGE_VERSION).toBe(`${pin.version}`);
    expect(DOPPLER_BROWSER_RUNTIME_VERSION).toBe(`${pin.version}`);
    expect(DOPPLER_BROWSER_RELEASE_REF).toBe(`doppler-gpu@${pin.version}`);
    expect(DOPPLER_MODULE_URL).toBe(`/vendor/doppler/${pin.version}/src/index.js`);
    expect(DOPPLER_KERNEL_BASE_URL).toBe(`/vendor/doppler/${pin.version}/src/gpu/kernels`);
    expect(DOPPLER_TOOLING_URL).toBe(`/vendor/doppler/${pin.version}/src/tooling-exports.browser.js`);
    expect(DOPPLER_STORAGE_TOOLING_URL).toBe(`/vendor/doppler/${pin.version}/src/tooling-exports/storage.js`);
    expect(DEFAULT_DOPPLER_MODEL_ID).toBe('qwen-3-5-2b-q4k-ehaf16');
    expect(LOCAL_DOPPLER_MODELS.length).toBeGreaterThan(0);
    for (const model of LOCAL_DOPPLER_MODELS) {
      const local = buildLocalDopplerModelConfig(model.id);
      expect(local).toMatchObject({ id: model.id, identity: model.identity, provider: 'doppler' });
      expect(getLocalDopplerModel(model.id)).toMatchObject({ id: model.id, identity: local.identity });
    }
  });

  it('resolves only declared local Doppler model ids', () => {
    expect(getLocalDopplerModel(DEFAULT_DOPPLER_MODEL_ID)).toMatchObject({
      id: DEFAULT_DOPPLER_MODEL_ID,
      packageVersion: DOPPLER_BROWSER_RUNTIME_VERSION
    });
    expect(getDefaultLocalDopplerModel()?.id).toBe(DEFAULT_DOPPLER_MODEL_ID);
    expect(getLocalDopplerModel('smollm2-360m')).toBeNull();
    expect(getLocalDopplerModel('')).toBeNull();
    expect(getLocalDopplerModel(null)).toBeNull();
  });

  it('builds browser-local model configs without accepting unknown ids', () => {
    expect(buildLocalDopplerModelConfig(DEFAULT_DOPPLER_MODEL_ID)).toMatchObject({
      id: DEFAULT_DOPPLER_MODEL_ID,
      name: 'Qwen 3.5 2B',
      provider: 'doppler',
      hostType: 'browser-local',
      packageName: 'doppler-gpu',
      packageVersion: DOPPLER_BROWSER_RUNTIME_VERSION
    });
    expect(buildDefaultLocalDopplerModelConfig()).toMatchObject({
      id: DEFAULT_DOPPLER_MODEL_ID
    });
    expect(buildLocalDopplerModelConfig('smollm2-360m')).toBeNull();
  });
});
