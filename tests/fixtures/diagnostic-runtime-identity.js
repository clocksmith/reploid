// Offline diagnostics only. This is byte identity, not deployment qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inventory, verifyInstalledPackage } from './installed-package-identity.js';

/** Capture all checkout files except Git metadata and separately owned dependencies. */
export async function inspectDiagnosticSource(directory) {
  const files = await inventory(directory, { installed: true, source: true });
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'doppler-gpu', 'Expected Doppler source');
  assert(files.some(file => file.path === 'src/partitions.js'), 'Missing source partition entry');
  return {
    schema: 'reploid.diagnostic-source-identity/v1',
    treeSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    fileCount: files.length,
    sourceBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    package: { name: manifest.name, version: manifest.version },
    exclusions: ['.git', 'node_modules'],
  };
}

export async function verifyDiagnosticRuntime(config) {
  if (config.sourceTree === undefined) return verifyInstalledPackage(config);
  assert(config.packageArchive === undefined, 'Choose sourceTree or packageArchive, never both');
  const expected = config.sourceTree?.treeSha256;
  assert(typeof expected === 'string' && /^[a-f0-9]{64}$/u.test(expected), 'Pinned source tree SHA-256 is required');
  const receipt = await inspectDiagnosticSource(config.installedPackage);
  assert.equal(receipt.treeSha256, expected, 'Diagnostic source tree hash mismatch');
  return receipt;
}
