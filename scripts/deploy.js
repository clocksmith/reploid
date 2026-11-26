#!/usr/bin/env node
// Deploy and verify exactly origin/main, as fetched now, from an isolated, ordinary checkout.
// Usage: node scripts/deploy.js [--ref <revision>]  (the ref must be origin/main's tip, else refused)
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseDeployArgs, resolveDeployRevision } from './deploy-revision.js';

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
  const { ref } = parseDeployArgs(process.argv.slice(2));
  const git = async args => (await exec('git', args, { cwd: root })).stdout;
  const revision = await resolveDeployRevision({ git, ref });
  console.log(`[deploy] deploying origin/main ${revision}`);
  const directory = resolve(root, '.deployment-checkouts');
  await mkdir(directory, { recursive: true });
  checkout = await mkdtemp(resolve(directory, 'release-'));
  // Fetch that exact commit, not a branch: the local `main` of a shared checkout can be commits behind.
  await run('git', ['init', '--quiet', checkout], root);
  await run('git', ['fetch', '--quiet', '--depth', '1', root, revision], checkout);
  await run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], checkout);
  const checkedOut = (await exec('git', ['rev-parse', 'HEAD'], { cwd: checkout })).stdout.trim();
  if (checkedOut !== revision) throw new Error(`Release checkout is at ${checkedOut}, expected ${revision}`);
  await run('npm', ['ci', '--ignore-scripts'], checkout);
  await run('npm', ['ci', '--ignore-scripts'], resolve(checkout, 'packages/functions'));
  await run('npm', ['run', 'verify:pool'], checkout);
  await run('npm', ['run', 'prepare:hosting'], checkout);
  // The isolated flow has already prepared this payload before Cloud Build.
  // Its predeploy checks source/archive identity and exact output bytes instead
  // of copying everything again. Direct Firebase deploys keep firebase.json.
  const firebase = JSON.parse(await readFile(resolve(checkout, 'firebase.json'), 'utf8'));
  const hosting = firebase.hosting.filter(item => item.target === 'reploid');
  if (hosting.length !== 1) throw new Error('Expected one reploid Hosting target');
  hosting[0].predeploy = 'npm run verify:browser-bundle:local && node scripts/package-hosting.js --check';
  const preparedConfig = 'firebase.prepared.json';
  await writeFile(resolve(checkout, preparedConfig), JSON.stringify(firebase, null, 2) + '\n');
  await run('gcloud', ['builds', 'submit', '--project=reploid', '--config=deploy/cloudbuild.yaml',
    `--substitutions=COMMIT_SHA=${revision}`, '.'], checkout);
  await run('firebase', ['deploy', '--config', preparedConfig, '--project', 'reploid', '--only',
    'functions,firestore:indexes,firestore:rules,hosting:reploid', '--non-interactive'], checkout);
  // Release qualification requires a clean tree; the prepared config is deploy-only scratch.
  await rm(resolve(checkout, preparedConfig), { force: true });
  await run('npm', ['run', 'verify:pool:release', '--', '--url', 'https://replo.id', '--channel=chrome'], checkout);
  console.log(`[deploy] verified https://replo.id at ${revision}`);
  // The first-visit journeys (FIRST-01 to FIRST-04, docs/critical-user-journeys.md), walked once on the deployed page. A catalog change
  // disconnects every provider still on an older package and no other check sees it. The site is already deployed at
  // this point, so a failure is reported with what did not hold (the JSON line's `failed`), not treated as a failed deploy.
  try { await run('npm', ['run', '--silent', 'verify:public-answer', '--', '--channel=chrome'], checkout); }
  catch { console.error('[deploy] WARNING: the first-visit journey check did not pass on https://replo.id; its JSON line above lists what failed. If no public computer answered, compare the providers\' packages with the deployed model catalog.'); }
} catch (error) {
  console.error(`[deploy] ${error.message}`); process.exitCode = 1;
} finally {
  if (checkout) await rm(checkout, { recursive: true, force: true });
}
