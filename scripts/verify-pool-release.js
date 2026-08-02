#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { POOL_CONFIG_HASH, POOL_CONFIG_VERSION } from '../server/pool/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const valueArg = (name) => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = String(
  valueArg('--url')
  || positionalUrl
  || process.env.REPLOID_POOL_RELEASE_URL
  || process.env.REPLOID_POOL_DEPLOYMENT_URL
  || ''
).replace(/\/+$/, '');
const allowLocal = args.includes('--allow-local');
const allowPlaceholders = args.includes('--allow-placeholders');
const channel = valueArg('--channel') || process.env.REPLOID_POOL_ACTUAL_BROWSER_CHANNEL || '';

if (!baseUrl) {
  console.error('A release URL is required through --url, REPLOID_POOL_RELEASE_URL, or REPLOID_POOL_DEPLOYMENT_URL');
  process.exit(1);
}

const parsedUrl = new URL(baseUrl);
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
if (isLocal && !allowLocal) {
  console.error('Local release verification requires --allow-local');
  process.exit(1);
}

const runCommand = (label, command, commandArgs = [], env = {}) => new Promise((resolve, reject) => {
  console.log(`[pool-release] ${label}`);
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
  });
});

const run = (label, script, scriptArgs = [], env = {}) => runCommand(
  label,
  process.execPath,
  [path.join(__dirname, script), ...scriptArgs],
  env
);

const verifyDeployedPoolContract = async () => {
  const endpoint = new URL('/pool/deployment/check', `${baseUrl}/`);
  let response;
  try {
    response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(`could not read deployed Pool contract: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`deployed Pool contract returned ${response.status}`);
  }
  let deployed;
  try {
    deployed = await response.json();
  } catch (error) {
    throw new Error(`deployed Pool contract was not valid JSON: ${error.message}`);
  }
  const deployedVersion = deployed.configVersion || deployed.config?.version || null;
  const deployedHash = deployed.configHash || deployed.config?.hash || null;
  if (deployedVersion !== POOL_CONFIG_VERSION || deployedHash !== POOL_CONFIG_HASH) {
    throw new Error(
      `deployed Pool contract does not match local governed config: expected ${POOL_CONFIG_VERSION} ${POOL_CONFIG_HASH}, received ${deployedVersion || 'missing'} ${deployedHash || 'missing'}`
    );
  }
};

try {
  await verifyDeployedPoolContract();

  await run('deploy-surface drift gate', 'verify-deploy-surface.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);

  const productionArgs = ['--verify-artifact'];
  if (!isLocal) productionArgs.push('--url', baseUrl);
  if (allowPlaceholders) productionArgs.push('--allow-placeholders');
  await run('production contract and deployment readiness', 'verify-pool-production.js', productionArgs);

  await run('synthetic browser route and peer-flow smoke', 'pool-browser-smoke.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);

  const actualInferenceEnv = {
    REPLOID_E2E_ACTUAL_INFERENCE: '1',
    REPLOID_E2E_ACTUAL_MULTI_PROVIDER: '1',
    REPLOID_E2E_RELAY_MODE: 'server',
    REPLOID_E2E_FORCE_TURN: '1',
    REPLOID_E2E_BASE_URL: baseUrl,
    ...(channel ? { REPLOID_E2E_CHROMIUM_CHANNEL: channel } : {})
  };
  const actualInferenceLanes = [
    ['deployed relay-only ESM-2 protein inference and receipt acceptance', 'loads ESM-2, embeds'],
    ['deployed relay-only queued-provider continuity and receipt acceptance', 'queues two public protein sequences'],
    ['deployed relay-only two-provider quorum inference and receipt acceptance', 'loads two independent']
  ];
  for (const [label, grep] of actualInferenceLanes) {
    await runCommand(
      label,
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        'tests/e2e/p2p-actual-inference.spec.js',
        '--project=chromium',
        '--grep',
        grep
      ],
      actualInferenceEnv
    );
  }
  console.log(`[pool-release] passed ${baseUrl}`);
} catch (error) {
  console.error(`[pool-release] failed: ${error.message}`);
  process.exit(1);
}
