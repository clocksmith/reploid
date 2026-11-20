#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DOPPLER_BROWSER_RUNTIME_VERSION,
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL,
  DOPPLER_STORAGE_TOOLING_URL,
  DOPPLER_PACKAGE_INTEGRITY,
  DOPPLER_PACKAGE_NAME,
  DOPPLER_PACKAGE_SPEC,
  DOPPLER_PACKAGE_TARBALL_URL,
  DOPPLER_PACKAGE_VERSION
} from '../shared/config/doppler-local-models.js';
import { resolveServedFile } from '../server/browser-roots.js';

const RUNTIME_ENV_KEYS = Object.freeze({
  REPLOID_POOL_MODEL_BASE_URL: 'modelBaseUrl',
  REPLOID_DOPPLER_MODULE_URL: 'dopplerModuleUrl',
  REPLOID_DOPPLER_STORAGE_MODULE_URL: 'dopplerStorageModuleUrl',
  REPLOID_DOPPLER_KERNEL_BASE_URL: 'dopplerKernelBaseUrl'
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const formatJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const runtimePackageNames = [DOPPLER_PACKAGE_NAME, 'doppler-gpu'];

function synchronizeCompatibility(value, packageVersion) {
  if (Array.isArray(value)) {
    return value.map((entry) => synchronizeCompatibility(entry, packageVersion));
  }
  if (!value || typeof value !== 'object') return value;

  const synchronized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'runtime' && typeof entry === 'string' && runtimePackageNames.some(name => entry.startsWith(`${name}@`))) {
      synchronized[key] = `${DOPPLER_PACKAGE_NAME}@${packageVersion}`;
      continue;
    }
    if (key === 'capabilityAction' && typeof entry === 'string') {
      synchronized[key] = entry.replace(
        new RegExp(`(?:${runtimePackageNames.map(escapeRegExp).join('|')})@\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?`, 'g'),
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

/** Project ordinary environment values from env.production.json. Secret
 * references and release identities remain deployment-owned manifest entries. */
export function projectCloudRunRuntimeEnv(source, runtimeEnv) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => /^\s*env:\s*$/.test(line));
  if (start < 0) throw new Error('Cloud Run manifest is missing env block');
  const indent = lines[start].match(/^\s*/)[0];
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].match(/^\s*/)[0].length > indent.length)) end++;
  const retained = [];
  const entries = lines.slice(start + 1, end).join('\n').split(new RegExp(`(?=^${indent}  - name:)`, 'm'));
  for (const entry of entries) {
    const name = entry.match(/- name: ([A-Z_][A-Z0-9_]*)/);
    if (name && (/\bvalueFrom:/.test(entry) || name[1].startsWith('REPLOID_RELEASE_'))) {
      if (Object.hasOwn(runtimeEnv, name[1])) throw new Error(`Deployment-owned environment collision: ${name[1]}`);
      retained.push(entry.trimEnd());
    }
  }
  const generated = Object.entries(runtimeEnv).map(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof value !== 'string') throw new Error('Runtime environment must contain named string values');
    return `${indent}  - name: ${key}\n${indent}    value: ${JSON.stringify(value)}`;
  });
  lines.splice(start + 1, end - start - 1, ...[...generated, ...retained].join('\n').split('\n'));
  return lines.join('\n').replace(/\n*$/, '\n');
}

/** Render the two service declarations from one bounded scaling policy. */
export function projectServicePolicy(cloudRunYaml, cloudBuildYaml, service) {
  if (!service || !['minInstances', 'maxInstances', 'concurrency', 'timeoutSeconds'].every(key => Number.isSafeInteger(service[key]))
    || service.minInstances < 0 || service.maxInstances < Math.max(1, service.minInstances)
    || service.concurrency < 1 || service.concurrency > 1000 || service.timeoutSeconds < 1 || service.timeoutSeconds > 3600) {
    throw new Error('Invalid bounded Cloud Run service policy');
  }
  const replace = (source, pattern, value) => {
    if (!pattern.test(source)) throw new Error('Missing generated Cloud Run service declaration');
    return source.replace(pattern, `$1${value}`);
  };
  for (const [key, yamlKey, flag, quoted] of [
    ['minInstances', 'autoscaling.knative.dev/minScale', 'min-instances', true],
    ['maxInstances', 'autoscaling.knative.dev/maxScale', 'max-instances', true],
    ['concurrency', 'containerConcurrency', 'concurrency', false],
    ['timeoutSeconds', 'timeoutSeconds', 'timeout', false]
  ]) {
    cloudRunYaml = replace(cloudRunYaml, new RegExp(`(^\\s*${escapeRegExp(yamlKey)}: )[^\\n]+`, 'm'),
      quoted ? JSON.stringify(String(service[key])) : service[key]);
    cloudBuildYaml = replace(cloudBuildYaml, new RegExp(`(--${flag} )[^\\s]+`), service[key]);
  }
  return { cloudRunYaml, cloudBuildYaml };
}

export function synchronizeRuntimeConfig({
  poolConfig,
  deploymentConfig,
  cloudRunYaml,
  cloudBuildYaml,
  packageManifest,
  packageLock,
  packageVersion = DOPPLER_PACKAGE_VERSION,
  browserRuntimeVersion = DOPPLER_BROWSER_RUNTIME_VERSION,
  moduleUrl = DOPPLER_MODULE_URL,
  storageModuleUrl = DOPPLER_STORAGE_TOOLING_URL,
  kernelBaseUrl = DOPPLER_KERNEL_BASE_URL
}) {
  if (browserRuntimeVersion !== packageVersion) {
    throw new Error('Every browser consumer must use the installed Doppler package version');
  }
  const manifestSpec = packageManifest.dependencies?.[DOPPLER_PACKAGE_NAME];
  if (manifestSpec !== DOPPLER_PACKAGE_SPEC) {
    throw new Error(`package.json must pin ${DOPPLER_PACKAGE_NAME} exactly to ${DOPPLER_PACKAGE_SPEC}`);
  }

  const lockRootSpec = packageLock.packages?.['']?.dependencies?.[DOPPLER_PACKAGE_NAME];
  const lockedPackage = packageLock.packages?.[`node_modules/${DOPPLER_PACKAGE_NAME}`];
  if (lockRootSpec !== DOPPLER_PACKAGE_SPEC || lockedPackage?.version !== packageVersion) {
    throw new Error(`package-lock.json must pin ${DOPPLER_PACKAGE_NAME} exactly to ${DOPPLER_PACKAGE_SPEC}`);
  }
  if (lockedPackage.resolved !== DOPPLER_PACKAGE_TARBALL_URL) {
    throw new Error(
      `package-lock.json must resolve ${DOPPLER_PACKAGE_NAME}@${packageVersion} `
      + `to ${DOPPLER_PACKAGE_TARBALL_URL}`
    );
  }
  if (lockedPackage.integrity !== DOPPLER_PACKAGE_INTEGRITY) {
    throw new Error(`package-lock.json must include the published integrity for ${DOPPLER_PACKAGE_NAME}@${packageVersion}`);
  }

  for (const model of poolConfig.modelCatalog || []) {
    if (model.enabled !== false && model.executionMode === 'complete_pack_browser'
      && model.runtimeVersion !== browserRuntimeVersion) {
      throw new Error(`Enabled model ${model.modelId} pins Doppler ${model.runtimeVersion}; `
        + `the browser loads ${browserRuntimeVersion}. Explicitly update and qualify the model runtime pin before release.`);
    }
  }

  const synchronizedPoolConfig = synchronizeCompatibility(clone(poolConfig), browserRuntimeVersion);
  const configVersion = String(synchronizedPoolConfig.configVersion || '').trim();
  if (!configVersion) throw new Error('Pool configVersion is required');
  const previousVersion = poolConfig.browserRuntime?.dopplerModuleUrl?.match(/\/vendor\/doppler\/([^/]+)\//)?.[1];
  const versionPattern = previousVersion ? new RegExp(`doppler-${escapeRegExp(previousVersion)}`) : /doppler-\d+\.\d+\.\d+/;
  synchronizedPoolConfig.configVersion = versionPattern.test(configVersion)
    ? configVersion.replace(versionPattern, `doppler-${browserRuntimeVersion}`)
    : `${configVersion}.doppler-${browserRuntimeVersion}`;
  synchronizedPoolConfig.browserRuntime = {
    ...synchronizedPoolConfig.browserRuntime,
    dopplerModuleUrl: moduleUrl,
    dopplerStorageModuleUrl: storageModuleUrl,
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

  let synchronizedCloudRunYaml = projectCloudRunRuntimeEnv(cloudRunYaml, synchronizedDeploymentConfig.runtimeEnv);

  if (cloudBuildYaml !== undefined) {
    const projected = projectServicePolicy(synchronizedCloudRunYaml, cloudBuildYaml, synchronizedDeploymentConfig.service);
    synchronizedCloudRunYaml = projected.cloudRunYaml;
    cloudBuildYaml = projected.cloudBuildYaml;
  }
  return {
    ...(cloudBuildYaml !== undefined ? { cloudBuildYaml } : {}),
    poolConfig: synchronizedPoolConfig,
    deploymentConfig: synchronizedDeploymentConfig,
    cloudRunYaml: synchronizedCloudRunYaml
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const filePaths = {
    poolConfig: resolveServedFile('pool/pool-config.json', { repoRoot }),
    deploymentConfig: path.join(repoRoot, 'deploy', 'env.production.json'),
    cloudRunYaml: path.join(repoRoot, 'deploy', 'cloud-run-service.yaml'),
    cloudBuildYaml: path.join(repoRoot, 'deploy', 'cloudbuild.yaml'),
    packageManifest: path.join(repoRoot, 'package.json'),
    packageLock: path.join(repoRoot, 'package-lock.json')
  };
  const current = {
    poolConfig: fs.readFileSync(filePaths.poolConfig, 'utf8'),
    deploymentConfig: fs.readFileSync(filePaths.deploymentConfig, 'utf8'),
    cloudRunYaml: fs.readFileSync(filePaths.cloudRunYaml, 'utf8'),
    cloudBuildYaml: fs.readFileSync(filePaths.cloudBuildYaml, 'utf8')
  };
  const poolConfig = JSON.parse(current.poolConfig);
  const browserRuntimeVersion = DOPPLER_BROWSER_RUNTIME_VERSION;
  const runtimeBase = `/vendor/doppler/${browserRuntimeVersion}`;
  const synchronized = synchronizeRuntimeConfig({
    poolConfig,
    browserRuntimeVersion,
    moduleUrl: `${runtimeBase}/src/index.js`,
    storageModuleUrl: `${runtimeBase}/src/tooling-exports/storage.js`,
    kernelBaseUrl: `${runtimeBase}/src/gpu/kernels`,
    deploymentConfig: JSON.parse(current.deploymentConfig),
    cloudRunYaml: current.cloudRunYaml,
    cloudBuildYaml: current.cloudBuildYaml,
    packageManifest: JSON.parse(fs.readFileSync(filePaths.packageManifest, 'utf8')),
    packageLock: JSON.parse(fs.readFileSync(filePaths.packageLock, 'utf8'))
  });
  const expected = {
    poolConfig: formatJson(synchronized.poolConfig),
    deploymentConfig: formatJson(synchronized.deploymentConfig),
    cloudRunYaml: synchronized.cloudRunYaml,
    cloudBuildYaml: synchronized.cloudBuildYaml
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
      `Runtime config verified for Poolday browser ${DOPPLER_PACKAGE_NAME}@${browserRuntimeVersion}`
      + ` with npm tooling ${DOPPLER_PACKAGE_VERSION}.`
    );
  }
}
