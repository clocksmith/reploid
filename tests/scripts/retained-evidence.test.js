import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkEvidenceObjects, readEvidenceCatalog, restoreEvidenceFile } from '../../scripts/retained-evidence.js';

const directories = [];
after(async () => { for (const directory of directories) await fs.rm(directory, { recursive: true, force: true }); });
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-evidence-')); directories.push(root);
  execFileSync('git', ['init', '-q', root]);
  const bytes = Buffer.from('retained proof\n');
  const gitBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: bytes, encoding: 'utf8' }).trim();
  const row = { path: 'artifacts/run/proof.sh', gitBlob, sha256: hash(bytes), bytes: bytes.length, mode: '100755', sourceCommit: 'a'.repeat(40) };
  return { root, bytes, row };
}

test('restores exact historical bytes and executable mode without overwriting divergent local work', async () => {
  const { root, bytes, row } = await fixture();
  const target = await restoreEvidenceFile(row, { root });
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o755);
  assert.equal(await restoreEvidenceFile(row, { root }), target);
  await fs.writeFile(target, 'local work');
  await assert.rejects(restoreEvidenceFile(row, { root }), /Existing evidence differs/);
  assert.equal(await fs.readFile(target, 'utf8'), 'local work');
});

test('refuses traversal and symlink destinations and removes a failed integrity restore', async () => {
  const { root, row } = await fixture();
  await assert.rejects(restoreEvidenceFile({ ...row, path: '../escape' }, { root }), /Invalid evidence restore entry/);
  await fs.mkdir(path.join(root, 'outside'));
  await fs.symlink(path.join(root, 'outside'), path.join(root, 'artifacts'));
  await assert.rejects(restoreEvidenceFile(row, { root }), /symlink or non-directory/);
  await fs.unlink(path.join(root, 'artifacts'));
  await assert.rejects(restoreEvidenceFile({ ...row, sha256: '0'.repeat(64) }, { root }), /integrity mismatch/);
  await assert.rejects(fs.access(path.join(root, row.path)), { code: 'ENOENT' });
});

test('checks catalog hashes, duplicate paths and offline object availability', async () => {
  const { root, row } = await fixture();
  const directory = path.join(root, 'docs/evidence-catalog'); await fs.mkdir(directory, { recursive: true });
  const part = JSON.stringify([row]);
  const index = { schema: 'reploid.retained-evidence/v1', sourceCommit: row.sourceCommit, fileCount: 1, bytes: row.bytes,
    parts: [{ path: 'part-0000.json', count: 1, sha256: hash(part) }] };
  await fs.writeFile(path.join(directory, 'part-0000.json'), part);
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(index));
  const catalog = await readEvidenceCatalog(root);
  assert.deepEqual(checkEvidenceObjects(catalog, root), []);
  assert.deepEqual(checkEvidenceObjects({ files: new Map([[row.path, { ...row, gitBlob: 'b'.repeat(40) }]]) }, root), [row.path]);
  await fs.writeFile(path.join(directory, 'part-0000.json'), part + '\n');
  await assert.rejects(readEvidenceCatalog(root), /part hash mismatch/);
  const duplicates = JSON.stringify([row, row]);
  await fs.writeFile(path.join(directory, 'part-0000.json'), duplicates);
  index.parts[0] = { ...index.parts[0], count: 2, sha256: hash(duplicates) };
  await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(index));
  await assert.rejects(readEvidenceCatalog(root), /Invalid retained evidence entry/);
});
