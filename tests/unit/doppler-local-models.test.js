import pin from '../../self/config/doppler-package.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

import {
  DEFAULT_DOPPLER_MODEL_ID,
  DOPPLER_BROWSER_RELEASE_REF,
  DOPPLER_BROWSER_RUNTIME_VERSION,
  DOPPLER_PACKAGE_INTEGRITY,
  DOPPLER_PACKAGE_NAME,
  DOPPLER_PACKAGE_SPEC,
  DOPPLER_PACKAGE_TARBALL_URL,
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

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

describe('local Doppler model contract', () => {
  it('can advertise every retained piece of a selected model within the inventory and transport budgets', () => {
    const policy = JSON.parse(readFileSync('self/config/chat-files.json', 'utf8'));
    const application = JSON.parse(readFileSync('self/config/reploid-library.json', 'utf8'));
    const transport = resolveConfig({ profile: application.profile }).value.webrtc;
    for (const model of LOCAL_DOPPLER_MODELS) {
      const descriptor = model.source.files.find(file => file.role === 'model-piece-index');
      const index = JSON.parse(readFileSync('self' + descriptor.url, 'utf8'));
      const pieces = index.files.flatMap(file => file.pieces.map(piece => ({
        path: `piece-${piece.identity.slice(7)}.bin`, role: 'model-weights',
        sizeBytes: piece.size, hashAlgorithm: 'sha256', hash: piece.identity.slice(7),
      })));
      const artifacts = [...model.source.files, ...pieces];
      expect(artifacts.length, model.id).toBeLessThanOrEqual(policy.maxInventoryFiles);
      expect(JSON.stringify({ artifacts }).length, model.id).toBeLessThanOrEqual(transport.maxMessageBytes);
    }
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
    expect(LOCAL_DOPPLER_MODELS.map((model) => model.id)).toEqual([
      'qwen-3-5-0-8b-q4k-ehaf16', DEFAULT_DOPPLER_MODEL_ID
    ]);
  });

  it('keeps the Doppler package version pinned to package.json', () => {
    expect(packageJson.dependencies?.[DOPPLER_PACKAGE_NAME]).toBe(DOPPLER_PACKAGE_SPEC);
    expect(packageLock.packages?.['']?.dependencies?.[DOPPLER_PACKAGE_NAME]).toBe(DOPPLER_PACKAGE_SPEC);
    expect(packageLock.packages?.[`node_modules/${DOPPLER_PACKAGE_NAME}`]).toMatchObject({
      version: DOPPLER_PACKAGE_VERSION,
      resolved: DOPPLER_PACKAGE_TARBALL_URL,
      integrity: DOPPLER_PACKAGE_INTEGRITY
    });
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
