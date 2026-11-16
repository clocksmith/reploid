// Offline diagnostics only. This is byte identity, not deployment qualification.
import assert from 'node:assert/strict';
import { verifyInstalledPackage } from './installed-package-identity.js';
import { inspectNativeRuntimeSource as inspectDiagnosticSource } from '../../server/native-runtime-source.js';
export { inspectNativeRuntimeSource as inspectDiagnosticSource } from '../../server/native-runtime-source.js';

export async function verifyDiagnosticRuntime(config) {
  if (config.sourceTree === undefined) return verifyInstalledPackage(config);
  assert(config.packageArchive === undefined, 'Choose sourceTree or packageArchive, never both');
  const expected = config.sourceTree?.treeSha256;
  assert(typeof expected === 'string' && /^[a-f0-9]{64}$/u.test(expected), 'Pinned source tree SHA-256 is required');
  const receipt = await inspectDiagnosticSource(config.installedPackage);
  assert.equal(receipt.treeSha256, expected, 'Diagnostic source tree hash mismatch');
  return receipt;
}
