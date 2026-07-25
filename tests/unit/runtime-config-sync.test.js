import { describe, expect, it } from 'vitest';
import {
  replaceCloudRunEnvValue,
  synchronizeRuntimeConfig
} from '../../scripts/sync-runtime-config.js';

const createFixture = () => ({
  poolConfig: {
    configVersion: '2026-07-24.doppler-0.4.14.v1',
    launchModel: {
      runtimeCompatibility: {
        capabilityFallbacks: [{ runtime: 'doppler-gpu@0.4.14' }],
        capabilityAction: 'Use doppler-gpu@0.4.14 or newer.'
      }
    },
    browserRuntime: {
      modelBaseUrl: 'https://models.example.test',
      dopplerModuleUrl: 'https://old.example.test/index.js',
      dopplerKernelBaseUrl: 'https://old.example.test/kernels'
    }
  },
  deploymentConfig: {
    runtimeEnv: {},
    browserEnv: {}
  },
  cloudRunYaml: [
    'env:',
    '  - name: REPLOID_POOL_MODEL_BASE_URL',
    '    value: "old-models"',
    '  - name: REPLOID_DOPPLER_MODULE_URL',
    '    value: "old-module"',
    '  - name: REPLOID_DOPPLER_KERNEL_BASE_URL',
    '    value: "old-kernels"',
    ''
  ].join('\n'),
  packageManifest: {
    dependencies: { 'doppler-gpu': '0.4.15' }
  },
  packageLock: {
    packages: {
      '': { dependencies: { 'doppler-gpu': '0.4.15' } },
      'node_modules/doppler-gpu': {
        version: '0.4.15',
        integrity: 'sha512-test'
      }
    }
  }
});

describe('runtime config synchronization', () => {
  it('projects the canonical Doppler runtime into Pool and deployment mirrors', () => {
    const synchronized = synchronizeRuntimeConfig(createFixture());

    expect(synchronized.poolConfig.configVersion).toBe('2026-07-24.doppler-0.4.15.v1');
    expect(synchronized.poolConfig.launchModel.runtimeCompatibility).toMatchObject({
      capabilityFallbacks: [{ runtime: 'doppler-gpu@0.4.15' }],
      capabilityAction: 'Use doppler-gpu@0.4.15 or newer.'
    });
    expect(synchronized.deploymentConfig.runtimeEnv).toMatchObject({
      REPLOID_POOL_MODEL_BASE_URL: 'https://models.example.test',
      REPLOID_DOPPLER_MODULE_URL: 'https://cdn.jsdelivr.net/npm/doppler-gpu@0.4.15/src/index.js',
      REPLOID_DOPPLER_KERNEL_BASE_URL: 'https://cdn.jsdelivr.net/npm/doppler-gpu@0.4.15/src/gpu/kernels'
    });
    expect(synchronized.deploymentConfig.browserEnv).toEqual(synchronized.deploymentConfig.runtimeEnv);
    expect(synchronized.cloudRunYaml).toContain(
      'value: "https://cdn.jsdelivr.net/npm/doppler-gpu@0.4.15/src/index.js"'
    );
  });

  it('rejects package metadata that is not an exact integrity-bound pin', () => {
    const fixture = createFixture();
    fixture.packageManifest.dependencies['doppler-gpu'] = '^0.4.15';

    expect(() => synchronizeRuntimeConfig(fixture)).toThrow(
      'package.json must pin doppler-gpu exactly to 0.4.15'
    );
  });

  it('fails when a required Cloud Run environment entry is absent', () => {
    expect(() => replaceCloudRunEnvValue('env:\n', 'MISSING_KEY', 'value')).toThrow(
      'Cloud Run manifest is missing env entry MISSING_KEY'
    );
  });
});
