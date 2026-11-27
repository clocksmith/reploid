import { describe, expect, it } from 'vitest';
import {
  replaceCloudRunEnvValue,
  projectCloudRunRuntimeEnv,
  projectServicePolicy,
  projectWranglerRuntimeVars,
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
} from '../../shared/config/doppler-local-models.js';

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
    dependencies: { 'dopplerx': DOPPLER_PACKAGE_SPEC }
  },
  packageLock: {
    packages: {
      '': { dependencies: { 'dopplerx': DOPPLER_PACKAGE_SPEC } },
      'node_modules/dopplerx': {
        version: DOPPLER_PACKAGE_VERSION,
        resolved: DOPPLER_PACKAGE_TARBALL_URL,
        integrity: DOPPLER_PACKAGE_INTEGRITY
      }
    }
  }
});

describe('runtime config synchronization', () => {
  it('rejects a separate browser runtime version', () => {
    expect(() => synchronizeRuntimeConfig({ ...createFixture(), browserRuntimeVersion: '0.0.1' }))
      .toThrow('Every browser consumer must use the installed Doppler package version');
  });
  it('projects the canonical Doppler runtime into Pool and deployment mirrors', () => {
    const synchronized = synchronizeRuntimeConfig(createFixture());

    expect(synchronized.poolConfig.configVersion).toBe(`2026-07-24.doppler-${DOPPLER_BROWSER_RUNTIME_VERSION}.v1`);
    expect(synchronized.poolConfig.launchModel.runtimeCompatibility).toMatchObject({
      capabilityFallbacks: [{ runtime: `dopplerx@${DOPPLER_BROWSER_RUNTIME_VERSION}` }],
      capabilityAction: `Use dopplerx@${DOPPLER_BROWSER_RUNTIME_VERSION} or newer.`
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
    fixture.packageManifest.dependencies['dopplerx'] = '^0.4.15';

    expect(() => synchronizeRuntimeConfig(fixture)).toThrow(
      `package.json must pin dopplerx exactly to ${DOPPLER_PACKAGE_SPEC}`
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

it('removes a previous prerelease suffix without consuming the configuration suffix', () => {
  const fixture = createFixture();
  fixture.poolConfig.configVersion = 'release.doppler-0.6.27-unicode.1.esm2-capsule-v2';
  fixture.poolConfig.browserRuntime.dopplerModuleUrl = '/vendor/doppler/0.6.27-unicode.1/src/index.js';
  fixture.poolConfig.launchModel.runtimeCompatibility.capabilityAction = 'Use doppler-gpu@0.6.27-unicode.1 or newer.';
  const result = synchronizeRuntimeConfig(fixture);
  expect(result.poolConfig.configVersion).toBe(`release.doppler-${DOPPLER_BROWSER_RUNTIME_VERSION}.esm2-capsule-v2`);
  expect(result.poolConfig.launchModel.runtimeCompatibility.capabilityAction).toBe(`Use dopplerx@${DOPPLER_BROWSER_RUNTIME_VERSION} or newer.`);
});

it('projects changed and removed environment values while retaining secret and release ownership', () => {
  const source = `service:
  env:
    - name: OLD
      value: obsolete
    - name: REPLOID_TURN_SHARED_SECRET
      valueFrom:
        secretKeyRef:
          name: private-reference
          key: latest
    - name: REPLOID_RELEASE_SOURCE_REVISION
      value: '<required-source-revision>'
  resources:
    cpu: 1
`;
  const rendered = projectCloudRunRuntimeEnv(source, { REPLOID_TURN_HOST: 'new.example.test', LIMIT: '512kb' });
  expect(rendered).not.toContain('name: OLD');
  expect(rendered).toContain('value: "new.example.test"');
  expect(rendered).toContain('name: private-reference');
  expect(rendered).toContain("value: '<required-source-revision>'");
  expect(rendered).toContain('  resources:\n    cpu: 1');
  expect(projectCloudRunRuntimeEnv(rendered, { REPLOID_TURN_HOST: 'new.example.test', LIMIT: '512kb' })).toBe(rendered);
  expect(() => projectCloudRunRuntimeEnv(source, { REPLOID_TURN_SHARED_SECRET: 'override' })).toThrow('collision');
});

it('projects one service policy into both deployment paths and refuses an absent bound', () => {
  const run = 'autoscaling.knative.dev/minScale: "9"\nautoscaling.knative.dev/maxScale: "9"\ncontainerConcurrency: 9\ntimeoutSeconds: 9\n';
  const build = '--min-instances 9 --max-instances 9 --concurrency 9 --timeout 9';
  const policy = { minInstances: 0, maxInstances: 1, concurrency: 80, timeoutSeconds: 300 };
  const result = projectServicePolicy(run, build, policy);
  expect(result.cloudRunYaml).toContain('maxScale: "1"');
  expect(result.cloudRunYaml).toContain('timeoutSeconds: 300');
  expect(result.cloudBuildYaml).toBe('--min-instances 0 --max-instances 1 --concurrency 80 --timeout 300');
  expect(() => projectServicePolicy(run, build, { ...policy, maxInstances: 0 })).toThrow('Invalid bounded');
  expect(() => projectServicePolicy(run, '--concurrency 9', policy)).toThrow('Missing generated');
});

it('projects the Doppler runtime URLs into the Worker vars and keeps every other line', () => {
  const env = {
    REPLOID_POOL_MODEL_BASE_URL: 'https://models.example/models',
    REPLOID_DOPPLER_MODULE_URL: '/vendor/doppler/9.9.9/src/index.js',
    REPLOID_DOPPLER_STORAGE_MODULE_URL: '/vendor/doppler/9.9.9/src/tooling-exports/storage.js',
    REPLOID_DOPPLER_KERNEL_BASE_URL: '/vendor/doppler/9.9.9/src/gpu/kernels'
  };
  const source = '{\n  // vars\n  "vars": {\n    "NODE_ENV": "production",\n'
    + Object.keys(env).map(key => `    "${key}": "/vendor/doppler/0.1.7/x"`).join(',\n') + '\n  }\n}\n';
  const projected = projectWranglerRuntimeVars(source, env);
  for (const [key, value] of Object.entries(env)) expect(projected).toContain(`"${key}": "${value}"`);
  expect(projected).toContain('// vars');
  expect(projected).toContain('"NODE_ENV": "production"');
  expect(() => projectWranglerRuntimeVars('{ "vars": {} }', env)).toThrow('missing var');
});
