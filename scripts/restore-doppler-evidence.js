#!/usr/bin/env node
/** Restore a historical package without changing the application's active pin. */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const retained = JSON.parse(readFileSync(path.join(root, 'deploy/artifacts/retention.json')));
const [mode, version, destination] = process.argv.slice(2);
if (!['--check', '--restore'].includes(mode)) throw new Error('Use --check or --restore VERSION EMPTY_DESTINATION');
const verify = row => {
  const archive = path.resolve(root, row.archive);
  if (!archive.startsWith(path.join(root, 'deploy/artifacts') + path.sep)) throw new Error('Archive must be a retained deployment artifact');
  const bytes = readFileSync(archive);
  if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== row.integrity) throw new Error('Historical archive integrity mismatch');
  return archive;
};
if (mode === '--check') {
  for (const row of retained.archivedVersions) verify(row);
  console.log(`Verified ${retained.archivedVersions.length} historical Doppler archives`);
} else {
  const row = retained.archivedVersions.find(item => item.version === version);
  if (!row || !destination) throw new Error('Choose a retained version and an empty destination');
  const archive = verify(row), target = path.resolve(destination);
  if (existsSync(target)) throw new Error('Destination must not already exist');
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (entries.some(entry => !entry.startsWith('package/') || entry.split('/').includes('..'))) throw new Error('Unsafe archive path');
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' });
  if (listing.trim().split('\n').some(line => !['-', 'd'].includes(line[0]))) throw new Error('Archive links are not supported');
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  if (pkg.name !== 'doppler-gpu' || pkg.version !== version) throw new Error('Historical package identity mismatch');
  mkdirSync(target, { recursive: true });
  try { execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', target]); }
  catch (error) { rmSync(target, { recursive: true, force: true }); throw error; }
  console.log(`Restored Doppler ${version}; application pin unchanged`);
}
