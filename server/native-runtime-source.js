// Explicit operator-local source selection. Byte identity is not release qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inventory } from './native-runtime-files.js';

// Node retains imported module bytes by URL for this process. A new tree pin at
// the same real directory requires a restart, even if the disk now matches it.
const importedTrees = new Map();

/** Capture all checkout files except Git metadata and separately owned dependencies. */
export async function inspectNativeRuntimeSource(directory) {
  const files = await inventory(directory, { installed: true, source: true });
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.ok(['dopplerx', 'doppler-gpu'].includes(manifest.name), 'Expected Doppler source');
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

/** Read and validate operator policy before importing any selected source code. */
export async function openNativeRuntimeSource(file) {
  assert(typeof file === 'string' && path.isAbsolute(file), 'Native runtime source config requires an absolute JSON path');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(config?.schema === 'reploid.native-runtime-source/v1'
    && Object.keys(config).every(key => ['schema', 'directory', 'treeSha256', 'gather'].includes(key)),
  'Unknown native runtime source schema or field');
  assert(typeof config.directory === 'string' && path.isAbsolute(config.directory), 'Native runtime source directory must be absolute');
  assert(typeof config.treeSha256 === 'string' && /^[a-f0-9]{64}$/u.test(config.treeSha256), 'Pinned source tree SHA-256 is required');
  const gather = config.gather;
  assert(gather && Object.keys(gather).every(key => ['maxPartBytes', 'memoryBudgetBytes', 'concurrency'].includes(key))
    && ['maxPartBytes', 'memoryBudgetBytes', 'concurrency'].every(key => Number.isSafeInteger(gather[key]) && gather[key] > 0),
  'Native runtime source requires explicit positive gather bounds and concurrency');
  const directory = await fs.realpath(config.directory);
  const expected = config.treeSha256;
  const assertCurrent = async () => {
    const current = await inspectNativeRuntimeSource(directory);
    assert.equal(current.treeSha256, expected, 'Native runtime source tree hash mismatch');
    return current;
  };
  const observed = await assertCurrent();
  assert(!importedTrees.has(directory) || importedTrees.get(directory) === expected,
    'Source runtime bytes changed at an imported directory; restart before selecting a new tree');
  importedTrees.set(directory, expected);
  const receipt = Object.freeze({ ...observed, package: Object.freeze({ ...observed.package }),
    exclusions: Object.freeze([...observed.exclusions]) });
  // Fixed entries preserve one device/pool owner across preparation and shutdown.
  const [runtime, tooling] = await Promise.all(['src/partitions.js', 'src/tooling-exports.js']
    .map(entry => import(pathToFileURL(path.join(directory, entry)).href)));
  await assertCurrent();
  for (const key of ['createVerifiedPieceStorage', 'createManifestResidentPartitionFactory', 'configureDeviceMemoryBudget', 'inspectDeviceMemory']) {
    assert(typeof runtime[key] === 'function', 'Source runtime lacks native capability: ' + key);
  }
  for (const key of ['getDevice', 'destroyBufferPool']) {
    assert(typeof tooling[key] === 'function', 'Source tooling lacks native ownership capability: ' + key);
  }
  return Object.freeze({ directory, runtime, tooling, receipt,
    gather: Object.freeze({ ...gather }), assertCurrent });
}

/** This opt-in never changes public, signed, earning, adapter or whole-model routes. */
export function assertNativeRuntimeSourceMode({ roomId, publicRoomId, executionMode = 'partition', canonical = null,
  earning = null, cacheDirectory = null, resolvePartitionSource = null, model }) {
  assert(roomId && roomId !== publicRoomId && executionMode === 'partition' && !canonical && !earning
    && cacheDirectory === null && resolvePartitionSource === null && model && model.capsule === undefined && !model.adapters?.length,
  'Native source runtime requires private unsigned partition compute without custody, earning, adapters or another source resolver');
}
