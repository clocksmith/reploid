#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DOPPLER_BROWSER_RUNTIME_VERSION,
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL,
  DOPPLER_PACKAGE_NAME,
  DOPPLER_PACKAGE_VERSION
} from '../self/config/doppler-local-models.js';

const RUNTIME_ENV_KEYS = Object.freeze({
  REPLOID_POOL_MODEL_BASE_URL: 'modelBaseUrl',
  REPLOID_DOPPLER_MODULE_URL: 'dopplerModuleUrl',
  REPLOID_DOPPLER_KERNEL_BASE_URL: 'dopplerKernelBaseUrl'
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const formatJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function synchronizeCompatibility(value, packageVersion) {
  if (Array.isArray(value)) {
    return value.map((entry) => synchronizeCompatibility(entry, packageVersion));
  }
  if (!value || typeof value !== 'object') return value;

  const synchronized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'runtime' && typeof entry === 'string' && entry.startsWith(`${DOPPLER_PACKAGE_NAME}@`)) {
      synchronized[key] = `${DOPPLER_PACKAGE_NAME}@${packageVersion}`;
      continue;
    }
    if (key === 'capabilityAction' && typeof entry === 'string') {
      synchronized[key] = entry.replace(
        new RegExp(`${escapeRegExp(DOPPLER_PACKAGE_NAME)}@\\d+\\.\\d+\\.\\d+`, 'g'),
        `${DOPPLER_PACKAGE_NAME}@${packageVersion}`
      );
      continue;
    }
    synchronized[key] = synchronizeCompatibility(entry, packageVersion);
  }
  return synchronized;
}

export function replaceCloudRunEnvValue(source, key, value) {
  const pattern = new RegExp(`(^\\s*- name: ${escapeRegExp(key)}\\s*\\n\\s*value:)\\s*[^\\n]+`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`Cloud Run manifest is missing env entry ${key}`);
  }
  return source.replace(pattern, `$1 ${JSON.stringify(value)}`);
}

export function synchronizeRuntimeConfig({
  poolConfig,
  deploymentConfig,
  cloudRunYaml,
  packageManifest,
  packageLock,
  packageVersion = DOPPLER_PACKAGE_VERSION,
  browserRuntimeVersion = DOPPLER_BROWSER_RUNTIME_VERSION,
  moduleUrl = DOPPLER_MODULE_URL,
  kernelBaseUrl = DOPPLER_KERNEL_BASE_URL
}) {
  const manifestVersion = packageManifest.dependencies?.[DOPPLER_PACKAGE_NAME];
  if (manifestVersion !== packageVersion) {
    throw new Error(`package.json must pin ${DOPPLER_PACKAGE_NAME} exactly to ${packageVersion}`);
  }

  const lockRootVersion = packageLock.packages?.['']?.dependencies?.[DOPPLER_PACKAGE_NAME];
  const lockedPackage = packageLock.packages?.[`node_modules/${DOPPLER_PACKAGE_NAME}`];
  if (lockRootVersion !== packageVersion || lockedPackage?.version !== packageVersion) {
    throw new Error(`package-lock.json must pin ${DOPPLER_PACKAGE_NAME} exactly to ${packageVersion}`);
  }
  if (!String(lockedPackage.integrity || '').startsWith('sha512-')) {
    throw new Error(`package-lock.json must include sha512 integrity for ${DOPPLER_PACKAGE_NAME}@${packageVersion}`);
  }

  const synchronizedPoolConfig = synchronizeCompatibility(clone(poolConfig), browserRuntimeVersion);
  synchronizedPoolConfig.configVersion = String(synchronizedPoolConfig.configVersion || '').replace(
    /doppler-\d+\.\d+\.\d+/,
    `doppler-${browserRuntimeVersion}`
  );
  if (!synchronizedPoolConfig.configVersion.includes(`doppler-${browserRuntimeVersion}`)) {
    throw new Error('Pool configVersion must contain a doppler-x.y.z segment');
  }
  synchronizedPoolConfig.browserRuntime = {
    ...synchronizedPoolConfig.browserRuntime,
    dopplerModuleUrl: moduleUrl,
    dopplerKernelBaseUrl: kernelBaseUrl
  };

  const synchronizedDeploymentConfig = clone(deploymentConfig);
  for (const [envKey, runtimeKey] of Object.entries(RUNTIME_ENV_KEYS)) {
    const value = synchronizedPoolConfig.browserRuntime?.[runtimeKey];
    if (!String(value || '').trim()) {
      throw new Error(`Pool browserRuntime.${runtimeKey} must be configured`);
    }
    synchronizedDeploymentConfig.runtimeEnv = {
      ...synchronizedDeploymentConfig.runtimeEnv,
      [envKey]: value
    };
    synchronizedDeploymentConfig.browserEnv = {
      ...synchronizedDeploymentConfig.browserEnv,
      [envKey]: value
    };
  }

  let synchronizedCloudRunYaml = cloudRunYaml;
  for (const [envKey, runtimeKey] of Object.entries(RUNTIME_ENV_KEYS)) {
    synchronizedCloudRunYaml = replaceCloudRunEnvValue(
      synchronizedCloudRunYaml,
      envKey,
      synchronizedPoolConfig.browserRuntime[runtimeKey]
    );
  }

  return {
    poolConfig: synchronizedPoolConfig,
    deploymentConfig: synchronizedDeploymentConfig,
    cloudRunYaml: synchronizedCloudRunYaml
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const filePaths = {
    poolConfig: path.join(repoRoot, 'self', 'pool', 'pool-config.json'),
    deploymentConfig: path.join(repoRoot, 'deploy', 'env.production.json'),
    cloudRunYaml: path.join(repoRoot, 'deploy', 'cloud-run-service.yaml'),
    packageManifest: path.join(repoRoot, 'package.json'),
    packageLock: path.join(repoRoot, 'package-lock.json')
  };
  const current = {
    poolConfig: fs.readFileSync(filePaths.poolConfig, 'utf8'),
    deploymentConfig: fs.readFileSync(filePaths.deploymentConfig, 'utf8'),
    cloudRunYaml: fs.readFileSync(filePaths.cloudRunYaml, 'utf8')
  };
  const synchronized = synchronizeRuntimeConfig({
    poolConfig: JSON.parse(current.poolConfig),
    deploymentConfig: JSON.parse(current.deploymentConfig),
    cloudRunYaml: current.cloudRunYaml,
    packageManifest: JSON.parse(fs.readFileSync(filePaths.packageManifest, 'utf8')),
    packageLock: JSON.parse(fs.readFileSync(filePaths.packageLock, 'utf8'))
  });
  const expected = {
    poolConfig: formatJson(synchronized.poolConfig),
    deploymentConfig: formatJson(synchronized.deploymentConfig),
    cloudRunYaml: synchronized.cloudRunYaml
  };
  const changed = Object.keys(expected).filter((key) => current[key] !== expected[key]);

  if (process.argv.includes('--write')) {
    for (const key of changed) fs.writeFileSync(filePaths[key], expected[key]);
    console.log(changed.length > 0
      ? `Synchronized runtime config: ${changed.join(', ')}`
      : 'Runtime config already synchronized.');
  } else if (changed.length > 0) {
    console.error(`Runtime config is stale: ${changed.join(', ')}`);
    console.error('Run npm run sync:runtime-config to regenerate it.');
    process.exitCode = 1;
  } else {
    console.log(
      `Runtime config verified for browser ${DOPPLER_PACKAGE_NAME}@${DOPPLER_BROWSER_RUNTIME_VERSION}`
      + ` with npm tooling ${DOPPLER_PACKAGE_VERSION}.`
    );
  }
}
