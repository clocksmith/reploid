#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
const modelId = valueArg('--model') || '';

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

const run = (label, script, scriptArgs = [], env = {}) => new Promise((resolve, reject) => {
  console.log(`[pool-release] ${label}`);
  const child = spawn(process.execPath, [path.join(__dirname, script), ...scriptArgs], {
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

try {
  const productionArgs = ['--verify-artifact'];
  if (!isLocal) productionArgs.push('--url', baseUrl);
  if (allowPlaceholders) productionArgs.push('--allow-placeholders');
  await run('production contract and deployment readiness', 'verify-pool-production.js', productionArgs);

  await run('synthetic browser route and peer-flow smoke', 'pool-browser-smoke.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);

  await run('actual Doppler browser inference and receipt acceptance', 'pool-actual-browser-smoke.js', [
    baseUrl,
    '--only=single',
    ...(channel ? [`--channel=${channel}`] : []),
    ...(modelId ? [`--model=${modelId}`] : [])
  ]);
  console.log(`[pool-release] passed ${baseUrl}`);
} catch (error) {
  console.error(`[pool-release] failed: ${error.message}`);
  process.exit(1);
}
