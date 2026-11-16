import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { inspectDiagnosticSource, verifyDiagnosticRuntime } from './diagnostic-runtime-identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-source-'));
const directory = path.join(root, 'source');
try {
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'doppler-gpu', version: '0.7.4', type: 'module' }));
  await fs.writeFile(path.join(directory, 'src/partitions.js'), 'throw new Error("Source must not execute during preflight");');
  await fs.symlink('partitions.js', path.join(directory, 'src/alias.js'));
  const expected = await inspectDiagnosticSource(directory);
  const config = { installedPackage: directory, sourceTree: { treeSha256: expected.treeSha256 } };
  assert.equal(expected.schema, 'reploid.diagnostic-source-identity/v1');
  assert.deepEqual(await verifyDiagnosticRuntime(config), expected);
  await assert.rejects(verifyDiagnosticRuntime({ ...config, packageArchive: {} }), /never both/);
  await assert.rejects(verifyDiagnosticRuntime({ ...config, sourceTree: {} }), /Pinned source/);
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const child = spawnSync(process.execPath, [new URL('./qwen-partition-worker.js', import.meta.url).pathname, configPath], {
    input: JSON.stringify({ id: 1, op: 'identity' }) + '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert(child.stdout.includes(expected.treeSha256), child.stdout);
  assert(!child.stdout.includes('Source must not execute'), child.stdout);
  await fs.writeFile(path.join(directory, 'src/extra.js'), '// added');
  await assert.rejects(verifyDiagnosticRuntime(config), /hash mismatch/);
  await fs.rm(path.join(directory, 'src/extra.js'));
  await fs.symlink('/tmp', path.join(directory, 'src/escape'));
  await assert.rejects(verifyDiagnosticRuntime(config), /link escapes checkout/);
  await fs.rm(path.join(directory, 'src/escape'));
  await fs.mkdir(path.join(directory, 'node_modules'));
  await fs.symlink('../node_modules', path.join(directory, 'src/excluded'));
  await assert.rejects(verifyDiagnosticRuntime(config), /excluded bytes/);
  await fs.rm(path.join(directory, 'src/excluded'));
  await fs.rmdir(path.join(directory, 'node_modules'));
  await fs.writeFile(path.join(directory, 'src/partitions.js'), '// changed');
  await assert.rejects(verifyDiagnosticRuntime(config), /hash mismatch/);
  // Archive mode remains byte-pinned and distinct, and still refuses links.
  await fs.rm(path.join(directory, 'src/alias.js'));
  const packageDirectory = path.join(root, 'package');
  await fs.rename(directory, packageDirectory);
  const archive = path.join(root, 'runtime.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
  const sha256 = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  const archiveConfig = { installedPackage: packageDirectory, packageArchive: { path: archive, sha256 } };
  assert.equal((await verifyDiagnosticRuntime(archiveConfig)).schema, 'reploid.installed-package-identity/v1');
  await fs.symlink('partitions.js', path.join(packageDirectory, 'src/alias.js'));
  await assert.rejects(verifyDiagnosticRuntime(archiveConfig), /links are not supported/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('diagnostic-runtime-identity: explicit source pin, no execution, mutations and links rejected');
