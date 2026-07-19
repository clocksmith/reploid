import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOPPLER_MODEL_ID,
  DOPPLER_PACKAGE_NAME,
  DOPPLER_PACKAGE_VERSION,
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL,
  DOPPLER_TOOLING_URL,
  LOCAL_DOPPLER_MODELS,
  buildDefaultLocalDopplerModelConfig,
  buildLocalDopplerModelConfig,
  getDefaultLocalDopplerModel,
  getLocalDopplerModel
} from '../../self/config/doppler-local-models.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

describe('local Doppler model contract', () => {
  it('exposes Qwen as the only local Doppler option for now', () => {
    expect(DOPPLER_PACKAGE_NAME).toBe('doppler-gpu');
    expect(DOPPLER_PACKAGE_VERSION).toBe('0.4.11');
    expect(DOPPLER_MODULE_URL).toBe('https://esm.sh/doppler-gpu@0.4.11/src/client/doppler-api.js?bundle');
    expect(DOPPLER_KERNEL_BASE_URL).toBe('https://esm.sh/doppler-gpu@0.4.11/src/gpu/kernels');
    expect(DOPPLER_TOOLING_URL).toBe('https://esm.sh/doppler-gpu@0.4.11/tooling?bundle');
    expect(DEFAULT_DOPPLER_MODEL_ID).toBe('qwen-3-5-2b-q4k-ehaf16');
    expect(LOCAL_DOPPLER_MODELS.map((model) => model.id)).toEqual([
      DEFAULT_DOPPLER_MODEL_ID
    ]);
  });

  it('keeps the Doppler package version pinned to package.json', () => {
    expect(packageJson.dependencies?.[DOPPLER_PACKAGE_NAME]).toBe(DOPPLER_PACKAGE_VERSION);
  });

  it('resolves only declared local Doppler model ids', () => {
    expect(getLocalDopplerModel(DEFAULT_DOPPLER_MODEL_ID)).toMatchObject({
      id: DEFAULT_DOPPLER_MODEL_ID,
      packageVersion: '0.4.11'
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
      packageVersion: '0.4.11'
    });
    expect(buildDefaultLocalDopplerModelConfig()).toMatchObject({
      id: DEFAULT_DOPPLER_MODEL_ID
    });
    expect(buildLocalDopplerModelConfig('smollm2-360m')).toBeNull();
  });
});
