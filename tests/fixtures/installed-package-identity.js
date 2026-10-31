// Private diagnostic preflight. Byte identity is not remote attestation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const schema = 'reploid.installed-package-identity/v1';
const exclusions = ['node_modules'];

function validateRelativePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'Empty package path');
  assert(!/[\\\x00-\x1f\x7f]/u.test(value), `Unsupported package path: ${value}`);
  assert(!value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'),
    `Unsafe package path: ${value}`);
}

async function inventory(directory, { installed = false } = {}) {
  const files = [];
  async function walk(relative) {
    const absolute = path.join(directory, relative);
    const stat = await fs.lstat(absolute);
    assert(!stat.isSymbolicLink(), `Package links are not supported: ${relative || '.'}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) {
        const child = relative ? relative + '/' + name : name;
        validateRelativePath(child);
        // Non-bundled dependencies have a separate lockfile/provider identity.
        // Never imply this package receipt verifies their bytes.
        if (child === 'node_modules') {
          assert(installed, 'Bundled dependencies require a separate archive contract');
          continue;
        }
        await walk(child);
      }
    } else {
      assert(stat.isFile(), `Unsupported package entry: ${relative}`);
      const bytes = await fs.readFile(absolute);
      files.push({ path: relative, sizeBytes: bytes.length, sha256: sha(bytes) });
    }
  }
  await walk('');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return files;
}

/** Derive expected file bytes from the captured, hash-pinned npm archive. */
export async function inspectPackageArchive({ path: archivePath, sha256 }) {
  assert(/^[a-f0-9]{64}$/u.test(sha256), 'Expected archive SHA-256 is required');
  const bytes = await fs.readFile(archivePath);
  assert.equal(sha(bytes), sha256, 'Package archive SHA-256 mismatch');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-package-identity-'));
  try {
    // Extraction uses these same captured bytes, not a mutable source path.
    const archive = path.join(scratch, 'captured.tgz');
    await fs.writeFile(archive, bytes, { flag: 'wx' });
    const options = { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 };
    const { stdout: names } = await exec('tar', ['-tzf', archive], options);
    const entries = names.trimEnd().split('\n');
    const seen = new Set();
    for (const entry of entries) {
      assert(entry.startsWith('package/'), `Archive entry outside package/: ${entry}`);
      const relative = entry.slice(8).replace(/\/$/u, '');
      if (relative) validateRelativePath(relative);
      else assert.equal(entry, 'package/');
      assert(!seen.has(relative), `Duplicate archive entry: ${entry}`);
      seen.add(relative);
    }
    const { stdout: listing } = await exec('tar', ['-tvzf', archive], options);
    assert(listing.trimEnd().split('\n').every(line => line[0] === '-' || line[0] === 'd'),
      'Archive links and special entries are not supported');
    await exec('tar', ['-xzf', archive, '-C', scratch], options);
    const directory = path.join(scratch, 'package');
    const files = await inventory(directory);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'doppler-gpu', 'Expected a Doppler package');
    assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'Missing package version');
    return { schema, archiveSha256: sha256, package: { name: manifest.name, version: manifest.version },
      treeSha256: sha(JSON.stringify(files)), fileCount: files.length,
      packageBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0), exclusions: [...exclusions], files };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

export function packageIdentityReceipt(expected) {
  const { files, ...receipt } = expected;
  return receipt;
}

/** No package code is imported and no GPU is acquired by this check. */
export async function verifyInstalledPackage({ packageArchive, installedPackage }) {
  const expected = await inspectPackageArchive(packageArchive);
  const actual = await inventory(installedPackage, { installed: true });
  const byPath = new Map(expected.files.map(file => [file.path, file]));
  for (const file of actual) {
    const match = byPath.get(file.path);
    assert(match, `Unexpected installed package file: ${file.path}`);
    assert.equal(file.sizeBytes, match.sizeBytes, `Installed package size mismatch: ${file.path}`);
    assert.equal(file.sha256, match.sha256, `Installed package hash mismatch: ${file.path}`);
    byPath.delete(file.path);
  }
  assert.equal(byPath.size, 0, `Missing installed package files: ${[...byPath.keys()].join(', ')}`);
  return packageIdentityReceipt(expected);
}

/** Admit all workers before any caller opens a model, retaining partial receipts. */
export async function preflightInstalledWorkers(workers, expected, receipts) {
  for (const [index, worker] of workers.entries()) {
    const started = performance.now();
    const observed = await worker.rpc({ op: 'identity' });
    receipts.push({ index, observed, elapsedMs: performance.now() - started });
    assert.deepEqual(observed, packageIdentityReceipt(expected), `Stage ${index} installed package identity mismatch`);
  }
}
