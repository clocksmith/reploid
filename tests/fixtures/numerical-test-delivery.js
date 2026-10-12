/** Numerical fixture delivery only; no application/deployment identity claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyNumericalTestDelivery({ root, bindingPath, bindingSha256, archivePath, runtimeDirectory }) {
  const bytes = await readFile(bindingPath);
  assert.match(bindingSha256, /^[a-f0-9]{64}$/);
  assert.equal(hash(bytes), bindingSha256, 'Frozen test delivery binding changed');
  const binding = JSON.parse(bytes);
  assert.equal(binding.scope, 'Immutable numerical fixture delivery; not deployed application or signed admission');
  assert(Array.isArray(binding.files) && binding.files.length > 0);
  const seen = new Set();
  for (const file of binding.files) {
    assert.equal(typeof file.path, 'string');
    assert(!isAbsolute(file.path) && !file.path.split('/').includes('..') && !seen.has(file.path), 'Invalid/duplicate delivery member');
    seen.add(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(await readFile(resolve(root, file.path))), file.sha256, `Changed delivery member: ${file.path}`);
  }
  assert.equal(hash(await readFile(archivePath)), binding.archiveSha256, 'Installed archive differs');
  const directory = await mkdtemp(resolve(tmpdir(), 'reploid-numerical-delivery-'));
  try {
    const execute = promisify(execFile);
    const { stdout } = await execute('tar', ['-tzf', resolve(archivePath)]);
    const entries = stdout.trim().split('\n');
    assert(entries.every(path => path.startsWith('package/') && !path.split('/').includes('..')), 'Invalid archive member');
    await execute('tar', ['-xzf', resolve(archivePath), '-C', directory]);
    const members = entries.filter(path => !path.endsWith('/'));
    for (const member of members) {
      const suffix = member.slice('package/'.length);
      const installed = resolve(runtimeDirectory, suffix);
      assert(!relative(runtimeDirectory, installed).startsWith('..'));
      assert.equal(hash(await readFile(installed)), hash(await readFile(resolve(directory, member))), `Installed archive member differs: ${suffix}`);
    }
    return { schema: 'reploid.numerical-test-delivery/v1', testDeliveryHash: 'sha256:' + bindingSha256,
      archiveSha256: binding.archiveSha256, snapshotFiles: seen.size, installedFiles: members.length,
      scope: binding.scope, applicationQualification: false };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
