#!/usr/bin/env node
/**
 * Deploy reploid-api from a clean checkout of a pushed commit. The release identity the coordinator
 * reports at /pool/deployment/check is the commit, the Worker name bound to it, and the SHA-256 of
 * the exact bundle uploaded.
 *
 *   node scripts/cloudflare/deploy-api.js [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
const revision = run('git', ['rev-parse', 'HEAD']);
if (run('git', ['status', '--porcelain=v1', '--untracked-files=no'])) throw new Error('Deploy from a clean checkout');
if (!dryRun && !run('git', ['branch', '-r', '--contains', revision])) throw new Error(`${revision} is not on a remote branch`);
const config = 'deploy/cloudflare/wrangler.api.jsonc';
const outdir = mkdtempSync(path.join(tmpdir(), 'reploid-api-'));
try {
  run('npx', ['wrangler', 'deploy', '--config', config, '--dry-run', '--outdir', outdir]);
  const bundleHash = `sha256:${createHash('sha256').update(readFileSync(path.join(outdir, 'index.js'))).digest('hex')}`;
  const vars = { REPLOID_RELEASE_SOURCE_REVISION: revision, REPLOID_RELEASE_IMAGE: `workers.dev/reploid-api:${revision}`, REPLOID_RUNTIME_BUNDLE_HASH: bundleHash };
  console.log(JSON.stringify({ revision, bundleHash, dryRun }));
  if (!dryRun) {
    execFileSync('npx', ['wrangler', 'deploy', '--config', config, '--message', `reploid-api ${revision}`,
      ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])], { stdio: 'inherit' });
  }
} finally { rmSync(outdir, { recursive: true, force: true }); }
