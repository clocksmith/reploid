#!/usr/bin/env node
// Deploy and verify one pushed revision from an isolated, ordinary checkout.
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exec = promisify(execFile);
async function run(command, args, cwd, env = {}) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(`${command} failed (${code})`)));
  });
}
let checkout;
try {
  const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const pushed = (await exec('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: root })).stdout.split(/\s/)[0];
  if (revision !== pushed) throw new Error('Push the intended main revision before deployment');
  const directory = resolve(root, '.deployment-checkouts');
  await mkdir(directory, { recursive: true });
  checkout = await mkdtemp(resolve(directory, 'release-'));
  await run('git', ['clone', '--no-local', '--depth', '1', '--single-branch', '--branch', 'main', root, checkout], root);
  await run('npm', ['ci', '--ignore-scripts'], checkout);
  await run('npm', ['ci', '--ignore-scripts'], resolve(checkout, 'functions'));
  await run('npm', ['run', 'verify:pool'], checkout);
  await run('npm', ['run', 'prepare:hosting'], checkout);
  await run('gcloud', ['builds', 'submit', '--project=reploid', '--config=deploy/cloudbuild.yaml',
    `--substitutions=COMMIT_SHA=${revision}`, '.'], checkout);
  await run('firebase', ['deploy', '--project', 'reploid', '--only',
    'functions,firestore:indexes,firestore:rules,hosting:reploid', '--non-interactive'], checkout);
  await run('npm', ['run', 'verify:pool:release', '--', '--url', 'https://replo.id', '--channel=chrome'], checkout);
  console.log(`[deploy] verified https://replo.id at ${revision}`);
} catch (error) {
  console.error(`[deploy] ${error.message}`); process.exitCode = 1;
} finally {
  if (checkout) await rm(checkout, { recursive: true, force: true });
}
