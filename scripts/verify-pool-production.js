#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { POOL_CONFIG, POOL_CONFIG_HASH, POOL_CONFIG_VERSION, validatePoolConfig } from '../server/pool/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const valueArg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const allowPlaceholders = args.has('--allow-placeholders');
const deploymentUrl = valueArg('--url') || process.env.REPLOID_POOL_DEPLOYMENT_URL || null;
const envPath = valueArg('--env')
  ? path.resolve(valueArg('--env'))
  : path.join(repoRoot, 'deploy', 'env.production.json');

const fail = (reasons) => {
  console.error('Pool production verification failed:');
  for (const reason of reasons) console.error(`- ${reason}`);
  process.exit(1);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const requiredRuntimeEnv = [
  'NODE_ENV',
  'POOL_BACKEND_ONLY',
  'POOL_STORE',
  'POOL_VERIFY_FIREBASE_AUTH',
  'POOL_REQUIRE_FIREBASE_AUTH',
  'POOL_JSON_LIMIT',
  'REPLOID_POOL_MODEL_BASE_URL',
  'REPLOID_DOPPLER_MODULE_URL',
  'REPLOID_DOPPLER_KERNEL_BASE_URL'
];

const requiredRewrites = [
  '/pool/policies',
  '/pool/config',
  '/pool/status',
  '/pool/deployment/check',
  '/pool/providers/**',
  '/pool/jobs',
  '/pool/jobs/**',
  '/pool/assignments/**',
  '/pool/receipts/**',
  '/pool/signaling/**',
  '/pool/peer/**',
  '/',
  '/run',
  '/contribute',
  '/agents',
  '/receipts',
  '/reputation',
  '/0',
  '/x'
];

const checkLocalFiles = () => {
  const reasons = [];
  const configValidation = validatePoolConfig();
  if (!configValidation.ok) reasons.push(...configValidation.reasons.map((reason) => `pool config: ${reason}`));
  if (POOL_CONFIG.claim !== 'receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference') {
    reasons.push('pool config claim is not the approved trust language');
  }
  if (!POOL_CONFIG.stateModes?.modes?.[POOL_CONFIG.stateModes?.activeModeId]?.appendOnlyCollections?.includes('pool_events')) {
    reasons.push('active state mode must declare pool_events append-only collection');
  }
  for (const forbidden of ['trustless', 'hardware-attested', 'guaranteed honest GPU execution']) {
    if (!POOL_CONFIG.forbiddenClaims?.includes(forbidden)) reasons.push(`forbidden claim missing: ${forbidden}`);
  }

  const envConfig = readJson(envPath);
  for (const key of requiredRuntimeEnv) {
    const value = String(envConfig.runtimeEnv?.[key] || '').trim();
    if (!value) reasons.push(`runtime env missing: ${key}`);
    if (!allowPlaceholders && value.startsWith('<required-')) reasons.push(`runtime env placeholder not replaced: ${key}`);
  }
  if (envConfig.runtimeEnv?.POOL_STORE !== 'firestore') reasons.push('POOL_STORE must be firestore for production');
  if (envConfig.runtimeEnv?.POOL_VERIFY_FIREBASE_AUTH !== 'true') reasons.push('POOL_VERIFY_FIREBASE_AUTH must be true');
  if (envConfig.runtimeEnv?.POOL_REQUIRE_FIREBASE_AUTH !== 'true') reasons.push('POOL_REQUIRE_FIREBASE_AUTH must be true');
  if (envConfig.browserEnv?.REPLOID_DOPPLER_MODULE_URL !== POOL_CONFIG.browserRuntime?.dopplerModuleUrl) {
    reasons.push('browserEnv REPLOID_DOPPLER_MODULE_URL must match pool config browserRuntime.dopplerModuleUrl');
  }
  if (envConfig.browserEnv?.REPLOID_DOPPLER_KERNEL_BASE_URL !== POOL_CONFIG.browserRuntime?.dopplerKernelBaseUrl) {
    reasons.push('browserEnv REPLOID_DOPPLER_KERNEL_BASE_URL must match pool config browserRuntime.dopplerKernelBaseUrl');
  }
  if (envConfig.browserEnv?.REPLOID_POOL_MODEL_BASE_URL !== POOL_CONFIG.browserRuntime?.modelBaseUrl) {
    reasons.push('browserEnv REPLOID_POOL_MODEL_BASE_URL must match pool config browserRuntime.modelBaseUrl');
  }
  if (envConfig.runtimeEnv?.REPLOID_DOPPLER_MODULE_URL !== POOL_CONFIG.browserRuntime?.dopplerModuleUrl) {
    reasons.push('runtime env REPLOID_DOPPLER_MODULE_URL must match pool config browserRuntime.dopplerModuleUrl');
  }
  if (envConfig.runtimeEnv?.REPLOID_DOPPLER_KERNEL_BASE_URL !== POOL_CONFIG.browserRuntime?.dopplerKernelBaseUrl) {
    reasons.push('runtime env REPLOID_DOPPLER_KERNEL_BASE_URL must match pool config browserRuntime.dopplerKernelBaseUrl');
  }
  if (envConfig.runtimeEnv?.REPLOID_POOL_MODEL_BASE_URL !== POOL_CONFIG.browserRuntime?.modelBaseUrl) {
    reasons.push('runtime env REPLOID_POOL_MODEL_BASE_URL must match pool config browserRuntime.modelBaseUrl');
  }

  const firebaseConfig = readJson(path.join(repoRoot, 'firebase.json'));
  const hosting = Array.isArray(firebaseConfig.hosting) ? firebaseConfig.hosting[0] : firebaseConfig.hosting;
  const rewriteSources = new Set((hosting?.rewrites || []).map((rewrite) => rewrite.source));
  for (const source of requiredRewrites) {
    if (!rewriteSources.has(source)) reasons.push(`firebase rewrite missing: ${source}`);
  }

  const indexes = readJson(path.join(repoRoot, 'firestore.indexes.json'));
  const hasAssignmentIndex = indexes.indexes?.some((index) => (
    index.collectionGroup === 'assignments'
    && index.fields?.some((field) => field.fieldPath === 'providerId')
    && index.fields?.some((field) => field.fieldPath === 'status')
  ));
  const hasSignalIndex = indexes.indexes?.some((index) => (
    index.collectionGroup === 'signaling_messages'
    && index.fields?.some((field) => field.fieldPath === 'sessionId')
    && index.fields?.some((field) => field.fieldPath === 'createdAt')
  ));
  const hasPeerRoomIndex = indexes.indexes?.some((index) => (
    index.collectionGroup === 'peer_room_messages'
    && index.fields?.some((field) => field.fieldPath === 'roomId')
    && index.fields?.some((field) => field.fieldPath === 'createdAt')
  ));
  if (!hasAssignmentIndex) reasons.push('Firestore assignments providerId/status index missing');
  if (!hasSignalIndex) reasons.push('Firestore signaling_messages sessionId/createdAt index missing');
  if (!hasPeerRoomIndex) reasons.push('Firestore peer_room_messages roomId/createdAt index missing');

  const cloudRunYaml = readText(path.join(repoRoot, 'deploy', 'cloud-run-service.yaml'));
  for (const key of requiredRuntimeEnv) {
    if (!cloudRunYaml.includes(`name: ${key}`)) reasons.push(`Cloud Run YAML missing env: ${key}`);
  }
  if (!cloudRunYaml.includes(`value: "${POOL_CONFIG.browserRuntime?.dopplerModuleUrl}"`)) {
    reasons.push('Cloud Run YAML Doppler module URL differs from pool config');
  }
  if (!cloudRunYaml.includes(`value: "${POOL_CONFIG.browserRuntime?.dopplerKernelBaseUrl}"`)) {
    reasons.push('Cloud Run YAML Doppler kernel base URL differs from pool config');
  }
  if (!cloudRunYaml.includes(`value: "${POOL_CONFIG.browserRuntime?.modelBaseUrl}"`)) {
    reasons.push('Cloud Run YAML model base URL differs from pool config');
  }
  if (!cloudRunYaml.includes('containerConcurrency: 80')) reasons.push('Cloud Run containerConcurrency not set to 80');

  const cloudBuildYaml = readText(path.join(repoRoot, 'deploy', 'cloudbuild.yaml'));
  if (!cloudBuildYaml.includes('scripts/print-pool-env.js deploy/env.production.json')) {
    reasons.push('Cloud Build does not use print-pool-env placeholder guard');
  }

  return reasons;
};

const checkDeploymentUrl = async (baseUrl) => {
  if (!baseUrl) return [];
  const reasons = [];
  const normalized = String(baseUrl).replace(/\/+$/, '');
  const getJson = async (pathName) => {
    const response = await fetch(`${normalized}${pathName}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${pathName} returned ${response.status}`);
    return payload;
  };
  try {
    const deployment = await getJson('/pool/deployment/check');
    if (deployment.ok !== true) reasons.push('/pool/deployment/check did not return ok=true');
    if (deployment.configVersion !== POOL_CONFIG_VERSION) reasons.push('deployed configVersion differs from local config');
    if (deployment.configHash !== POOL_CONFIG_HASH) reasons.push('deployed configHash differs from local config');
    if (deployment.store?.mode !== 'firestore') reasons.push('deployed store mode is not firestore');
    if (deployment.identity?.serverAuth?.required !== true) reasons.push('deployed server auth is not required');
    if (deployment.store?.commitReveal?.supported !== true) reasons.push('deployed commit-reveal store support is not true');
  } catch (error) {
    reasons.push(`deployment readiness fetch failed: ${error.message}`);
  }
  try {
    const config = await getJson('/pool/config');
    if (config.configHash !== POOL_CONFIG_HASH) reasons.push('/pool/config hash differs from local config');
  } catch (error) {
    reasons.push(`deployment config fetch failed: ${error.message}`);
  }
  return reasons;
};

const reasons = [
  ...checkLocalFiles(),
  ...await checkDeploymentUrl(deploymentUrl)
];

if (reasons.length > 0) fail(reasons);

console.log(`Pool production verification passed for ${POOL_CONFIG_VERSION} ${POOL_CONFIG_HASH}`);
