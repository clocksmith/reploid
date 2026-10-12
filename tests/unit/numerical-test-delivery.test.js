// @vitest-environment node
import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyNumericalTestDelivery } from '../fixtures/numerical-test-delivery.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'reploid-delivery-test-'));
  try {
    await mkdir(join(root, 'package'));
    await writeFile(join(root, 'package/source.js'), 'export const value = 1;');
    await writeFile(join(root, 'fixture.js'), 'test only');
    await promisify(execFile)('tar', ['-czf', join(root, 'archive.tgz'), '-C', root, 'package']);
    const binding = { scope: 'Immutable numerical fixture delivery; not deployed application or signed admission',
      archiveSha256: hash(await readFile(join(root, 'archive.tgz'))),
      files: [{ path: 'fixture.js', sha256: hash(await readFile(join(root, 'fixture.js'))) }] };
    const args = { root, bindingPath: join(root, 'binding.json'), archivePath: join(root, 'archive.tgz'), runtimeDirectory: join(root, 'package') };
    const freeze = async () => { const bytes = JSON.stringify(binding); await writeFile(args.bindingPath, bytes); args.bindingSha256 = hash(bytes); };
    await freeze(); await run({ args, binding, freeze, root });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('binds numerical delivery and every installed archive member without claiming application qualification', async () => fixture(async ({ args }) => {
  expect(await verifyNumericalTestDelivery(args)).toMatchObject({ snapshotFiles: 1, installedFiles: 1, applicationQualification: false });
}));
for (const mutation of ['binding', 'listed file', 'installed member', 'archive', 'duplicate', 'traversal']) {
  test(`rejects changed ${mutation} before model execution`, async () => fixture(async ({ args, binding, freeze, root }) => {
    if (mutation === 'binding') args.bindingSha256 = '0'.repeat(64);
    if (mutation === 'listed file') await writeFile(join(root, 'fixture.js'), 'changed');
    if (mutation === 'installed member') await writeFile(join(root, 'package/source.js'), 'changed');
    if (mutation === 'archive') await writeFile(args.archivePath, 'changed');
    if (mutation === 'duplicate') { binding.files.push(binding.files[0]); await freeze(); }
    if (mutation === 'traversal') { binding.files[0].path = '../escape'; await freeze(); }
    await expect(verifyNumericalTestDelivery(args)).rejects.toThrow();
  }));
}
