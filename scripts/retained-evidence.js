/** Exact historical evidence retained by an immutable Git revision, outside the current source tree. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPOSITORY_ROOT } from './evidence-paths.js';
export { REPOSITORY_ROOT } from './evidence-paths.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const relativePath = value => typeof value === 'string' && value && !path.posix.isAbsolute(value)
  && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..');

export async function readEvidenceCatalog(root = REPOSITORY_ROOT) {
  const directory = path.join(root, 'docs/evidence-catalog');
  const index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8'));
  if (index.schema !== 'reploid.retained-evidence/v1' || !/^[a-f0-9]{40}$/.test(index.sourceCommit)) throw new Error('Invalid evidence catalog identity');
  const files = new Map();
  for (const part of index.parts) {
    if (!/^part-\d{4}\.json$/.test(part.path)) throw new Error('Invalid evidence catalog part');
    const bytes = await fs.readFile(path.join(directory, part.path));
    if (digest(bytes) !== part.sha256) throw new Error(`Evidence catalog part hash mismatch: ${part.path}`);
    const rows = JSON.parse(bytes);
    if (rows.length !== part.count) throw new Error('Evidence catalog part count mismatch');
    for (const row of rows) {
      if (!relativePath(row.path) || files.has(row.path) || !/^[a-f0-9]{40}$/.test(row.gitBlob)
        || !['100644', '100755'].includes(row.mode || '100644')
        || row.sourceCommit && !/^[a-f0-9]{40}$/.test(row.sourceCommit)
        || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new Error('Invalid retained evidence entry');
      files.set(row.path, row);
    }
  }
  if (files.size !== index.fileCount || [...files.values()].reduce((sum, row) => sum + row.bytes, 0) !== index.bytes) throw new Error('Evidence catalog totals mismatch');
  return { ...index, files };
}

/** Check object availability without materializing run output or making a network request. */
export function checkEvidenceObjects(catalog, root = REPOSITORY_ROOT) {
  const rows = [...catalog.files.values()];
  const output = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd: root, input: rows.map(row => row.gitBlob).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }
  }).trim().split('\n');
  return rows.filter((row, index) => output[index] !== `${row.gitBlob} blob ${row.bytes}`).map(row => row.path);
}

/** Explicitly fetch the pinned source commit for a shallow checkout. No branch or working file changes. */
export function fetchEvidenceObjects(catalog, root = REPOSITORY_ROOT) {
  for (const commit of catalog.sourceCommits || [catalog.sourceCommit]) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid retained source revision');
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', commit], { cwd: root, stdio: 'inherit' });
  }
}

async function safeParent(destination, relative) {
  const root = await fs.realpath(destination);
  const parts = relative.split('/');
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = path.join(directory, part);
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Evidence destination crosses a symlink or non-directory');
  }
  return path.join(root, relative);
}

/** Restore one file by its Git blob and independently verify SHA-256 and byte count.
 * Existing files are never overwritten, including interrupted or divergent runs. */
export async function restoreEvidenceFile(row, { root = REPOSITORY_ROOT, destination = root } = {}) {
  if (!relativePath(row.path) || !/^[a-f0-9]{40}$/.test(row.gitBlob) || !/^[a-f0-9]{64}$/.test(row.sha256)
    || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw new Error('Invalid evidence restore entry');
  await fs.mkdir(destination, { recursive: true });
  const target = await safeParent(destination, row.path);
  try {
    const existing = await fs.lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`Refusing to replace existing evidence: ${row.path}`);
    const bytes = await fs.readFile(target);
    if (bytes.length !== row.bytes || digest(bytes) !== row.sha256) throw new Error(`Existing evidence differs: ${row.path}`);
    return target;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.restore-${randomUUID()}`;
  const file = await fs.open(temporary, 'wx', 0o600);
  const child = spawn('git', ['cat-file', 'blob', row.gitBlob], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
  let bytes = 0, stderr = '';
  const hash = createHash('sha256');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-2048); });
  try {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > row.bytes) throw new Error(`Retained evidence exceeds its byte count: ${row.path}`);
      hash.update(chunk); await file.writeFile(chunk);
    }
    if (await exited !== 0) throw new Error(`Evidence blob unavailable; use restore-evidence.js --fetch first. ${stderr.trim()}`);
    if (bytes !== row.bytes || hash.digest('hex') !== row.sha256) throw new Error(`Retained evidence integrity mismatch: ${row.path}`);
    await file.chmod(row.mode === '100755' ? 0o755 : 0o644);
    await file.close();
    // Publish complete verified bytes atomically; never replace a racing writer.
    await fs.link(temporary, target);
    await fs.unlink(temporary);
    return target;
  } catch (error) {
    child.kill(); await exited.catch(() => {}); await file.close(); await fs.unlink(temporary); throw error;
  }
}
