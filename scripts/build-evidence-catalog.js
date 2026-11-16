#!/usr/bin/env node
/** Inventory immutable historical Git bytes before removing generated output from the source tree. */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPOSITORY_ROOT, readEvidenceCatalog } from './retained-evidence.js';

const args = process.argv.slice(2);
const includeCurrent = args.includes('--include-current-runtime');
if (includeCurrent) args.splice(args.indexOf('--include-current-runtime'), 1);
if (args.length !== 2 || args[0] !== '--source' || !/^[a-f0-9]{40}$/.test(args[1])) throw new Error('Usage: build-evidence-catalog.js --source FULL_PUSHED_COMMIT');
const sourceCommit = args[1], root = REPOSITORY_ROOT;
const git = values => execFileSync('git', values, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, 'origin/main'], { cwd: root });
let previous = null;
try { previous = await readEvidenceCatalog(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const pin = JSON.parse(git(['show', `${sourceCommit}:shared/config/doppler-package.json`]));
// Small frozen inputs still consumed directly by the ordinary/contract/browser tests.
const retainedInputs = [
  'artifacts/cleanup-failure-20261012/signed-preflight.js',
  'artifacts/concurrent-memory-observation-20261012/bounded-result/accounting-control.json',
  'artifacts/partition-resident/20260927/signed-opening-fixture.json',
  'artifacts/partition-resident/20260927/installed-physical.json',
  'artifacts/first-use-preparation-20261013/conversation-workspace-before.js'
];
const rows = git(['ls-tree', '-rlz', sourceCommit]).split('\0').filter(Boolean).flatMap(line => {
  const [metadata, name] = line.split('\t'), fields = metadata.trim().split(/\s+/);
  if (retainedInputs.includes(name)) return [];
  if (!name.startsWith('artifacts/') && !name.startsWith('reports/local/')
    && !(name.startsWith('deploy/artifacts/') && name.endsWith('.tgz') && (includeCurrent || name !== `deploy/artifacts/doppler-gpu-${pin.version}.tgz`))) return [];
  if (!['100644', '100755'].includes(fields[0])) throw new Error('Evidence must be an ordinary file');
  return [{ path: name, gitBlob: fields[2], bytes: Number(fields[3]), mode: fields[0], sourceCommit }];
}).sort((left, right) => left.path.localeCompare(right.path));

const child = spawn('git', ['cat-file', '--batch'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
child.stdin.end(rows.map(row => row.gitBlob).join('\n') + '\n');
let pending = Buffer.alloc(0), rowIndex = 0, remaining = null, hash;
for await (const chunk of child.stdout) {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length) {
    if (remaining === null) {
      const newline = pending.indexOf(10);
      if (newline < 0) break;
      const header = pending.subarray(0, newline).toString('utf8').split(' ');
      const row = rows[rowIndex];
      if (!row || header[0] !== row.gitBlob || header[1] !== 'blob' || Number(header[2]) !== row.bytes) throw new Error('Historical Git blob differs from its tree entry');
      pending = pending.subarray(newline + 1); remaining = row.bytes; hash = createHash('sha256');
    }
    if (remaining > 0) {
      const size = Math.min(remaining, pending.length);
      hash.update(pending.subarray(0, size)); pending = pending.subarray(size); remaining -= size;
    }
    if (remaining > 0 || !pending.length) break;
    if (pending[0] !== 10) throw new Error('Invalid Git blob framing');
    pending = pending.subarray(1); rows[rowIndex++].sha256 = hash.digest('hex'); remaining = null;
    if (rowIndex % 1000 === 0) console.log(`[evidence-catalog] hash-verified ${rowIndex}/${rows.length} historical files`);
  }
}
if (await exited !== 0 || remaining !== null || pending.length || rowIndex !== rows.length) throw new Error('Historical Git inventory was incomplete');
const merged = new Map([...(previous?.files.values() || [])].map(row => [row.path, { ...row, mode: row.mode || '100644', sourceCommit: row.sourceCommit || previous.sourceCommit }]));
for (const row of rows) {
  const old = merged.get(row.path);
  if (old && (old.gitBlob !== row.gitBlob || old.sha256 !== row.sha256 || old.bytes !== row.bytes)) throw new Error(`Retained evidence path was reused with different bytes: ${row.path}`);
  if (!old) merged.set(row.path, row);
  else if (old.sourceCommit === sourceCommit) old.mode = row.mode;
}
rows.splice(0, rows.length, ...[...merged.values()].sort((a, b) => a.path.localeCompare(b.path)));
const directory = path.join(root, 'docs/evidence-catalog');
await fs.mkdir(directory, { recursive: true });
const parts = [];
for (let start = 0; start < rows.length; start += 400) {
  const files = rows.slice(start, start + 400), name = `part-${String(parts.length).padStart(4, '0')}.json`;
  const bytes = JSON.stringify(files, null, 2) + '\n';
  await fs.writeFile(path.join(directory, name), bytes);
  parts.push({ path: name, count: files.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const index = { schema: 'reploid.retained-evidence/v1', sourceCommit: previous?.sourceCommit || sourceCommit, sourceCommits: [...new Set(rows.map(row => row.sourceCommit))].sort(), retention: 'immutable Git history; no expiry for existing qualification evidence',
  fileCount: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), retainedInputs, parts };
await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`[evidence-catalog] ${index.fileCount} files / ${index.bytes} bytes retained at ${sourceCommit}`);
