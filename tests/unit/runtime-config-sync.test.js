import { describe, expect, it } from 'vitest';
import {
  replaceCloudRunEnvValue,
  synchronizeRuntimeConfig
} from '../../scripts/sync-runtime-config.js';
import {
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL,
  DOPPLER_STORAGE_TOOLING_URL,
  DOPPLER_PACKAGE_INTEGRITY,
  DOPPLER_PACKAGE_TARBALL_URL,
  DOPPLER_PACKAGE_SPEC,
  DOPPLER_PACKAGE_VERSION,
  DOPPLER_BROWSER_RUNTIME_VERSION
} from '../../self/config/doppler-local-models.js';

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
      dopplerStorageModuleUrl: 'https://old.example.test/storage.js',
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
    '  - name: REPLOID_DOPPLER_STORAGE_MODULE_URL',
    '    value: "old-storage"',
    '  - name: REPLOID_DOPPLER_KERNEL_BASE_URL',
    '    value: "old-kernels"',
    ''
  ].join('\n'),
  packageManifest: {
    dependencies: { 'doppler-gpu': DOPPLER_PACKAGE_SPEC }
  },
  packageLock: {
    packages: {
      '': { dependencies: { 'doppler-gpu': DOPPLER_PACKAGE_SPEC } },
      'node_modules/doppler-gpu': {
        version: DOPPLER_PACKAGE_VERSION,
        resolved: DOPPLER_PACKAGE_TARBALL_URL,
        integrity: DOPPLER_PACKAGE_INTEGRITY
      }
    }
  }
});

describe('runtime config synchronization', () => {
  it('projects the canonical Doppler runtime into Pool and deployment mirrors', () => {
    const synchronized = synchronizeRuntimeConfig(createFixture());

    expect(synchronized.poolConfig.configVersion).toBe(`2026-07-24.doppler-${DOPPLER_BROWSER_RUNTIME_VERSION}.v1`);
    expect(synchronized.poolConfig.launchModel.runtimeCompatibility).toMatchObject({
      capabilityFallbacks: [{ runtime: `doppler-gpu@${DOPPLER_BROWSER_RUNTIME_VERSION}` }],
      capabilityAction: `Use doppler-gpu@${DOPPLER_BROWSER_RUNTIME_VERSION} or newer.`
    });
    expect(synchronized.deploymentConfig.runtimeEnv).toMatchObject({
      REPLOID_POOL_MODEL_BASE_URL: 'https://models.example.test',
      REPLOID_DOPPLER_MODULE_URL: DOPPLER_MODULE_URL,
      REPLOID_DOPPLER_STORAGE_MODULE_URL: DOPPLER_STORAGE_TOOLING_URL,
      REPLOID_DOPPLER_KERNEL_BASE_URL: DOPPLER_KERNEL_BASE_URL
    });
    expect(synchronized.deploymentConfig.browserEnv).toEqual(synchronized.deploymentConfig.runtimeEnv);
    expect(synchronized.cloudRunYaml).toContain(
      `value: "${DOPPLER_MODULE_URL}"`
    );
    expect(synchronized.cloudRunYaml).toContain(
      `value: "${DOPPLER_STORAGE_TOOLING_URL}"`
    );
  });

  it('adds the pinned runtime identity when a product contract version has no Doppler segment', () => {
    const fixture = createFixture();
    fixture.poolConfig.configVersion = '2026-08-01.sequence-model-contracts.v1';

    const synchronized = synchronizeRuntimeConfig(fixture);

    expect(synchronized.poolConfig.configVersion)
      .toBe(`2026-08-01.sequence-model-contracts.v1.doppler-${DOPPLER_BROWSER_RUNTIME_VERSION}`);
  });

  it('rejects package metadata that is not an exact integrity-bound pin', () => {
    const fixture = createFixture();
    fixture.packageManifest.dependencies['doppler-gpu'] = '^0.4.15';

    expect(() => synchronizeRuntimeConfig(fixture)).toThrow(
      `package.json must pin doppler-gpu exactly to ${DOPPLER_PACKAGE_SPEC}`
    );
  });

  it('fails when a required Cloud Run environment entry is absent', () => {
    expect(() => replaceCloudRunEnvValue('env:\n', 'MISSING_KEY', 'value')).toThrow(
      'Cloud Run manifest is missing env entry MISSING_KEY'
    );
  });

  it('rejects an enabled model pinned to a different runtime without rewriting its identity', () => {
    const fixture = createFixture();
    fixture.poolConfig.modelCatalog = [{ modelId: 'esm2', enabled: true,
      executionMode: 'complete_pack_browser', runtimeVersion: '0.6.0' }];
    expect(() => synchronizeRuntimeConfig(fixture)).toThrow('Explicitly update and qualify the model runtime pin');
    expect(fixture.poolConfig.modelCatalog[0].runtimeVersion).toBe('0.6.0');
    fixture.poolConfig.modelCatalog[0].runtimeVersion = DOPPLER_BROWSER_RUNTIME_VERSION;
    expect(synchronizeRuntimeConfig(fixture).poolConfig.modelCatalog[0].runtimeVersion).toBe(DOPPLER_BROWSER_RUNTIME_VERSION);
  });

  it('preserves disabled model runtime pins during a browser upgrade', () => {
    const fixture = createFixture();
    fixture.poolConfig.modelCatalog = [{ modelId: 'retained', enabled: false,
      executionMode: 'complete_pack_browser', runtimeVersion: '0.6.0' }];
    expect(synchronizeRuntimeConfig(fixture).poolConfig.modelCatalog[0].runtimeVersion).toBe('0.6.0');
  });
});
