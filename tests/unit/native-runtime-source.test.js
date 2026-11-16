// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectNativeRuntimeSource, openNativeRuntimeSource, assertNativeRuntimeSourceMode } from '../../server/native-runtime-source.js';
import { createNativeParticipant } from '../../server/native-participant-runtime.js';
import { openNativePartition } from '../../server/native-partition.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

const roots = [];
afterEach(async () => {
  delete globalThis.__nativeSourceImported;
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-runtime-source-')); roots.push(root);
  const directory = path.join(root, 'runtime');
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'doppler-gpu', version: 'test', type: 'module' }));
  await fs.writeFile(path.join(directory, 'src/state.js'), 'export const state = { budget: 0 };');
  await fs.writeFile(path.join(directory, 'src/partitions.js'), `import { state } from './state.js';
    globalThis.__nativeSourceImported = true;
    export const createVerifiedPieceStorage = () => {};
    export const createManifestResidentPartitionFactory = () => {};
    export const configureDeviceMemoryBudget = ({maxBytes}) => { state.budget = maxBytes; };
    export const inspectDeviceMemory = () => state;`);
  await fs.writeFile(path.join(directory, 'src/tooling-exports.js'), `import { state } from './state.js';
    export const getDevice = () => state;
    export const destroyBufferPool = () => {};`);
  const receipt = await inspectNativeRuntimeSource(directory);
  const file = path.join(root, 'source.json');
  const config = { schema: 'reploid.native-runtime-source/v1', directory, treeSha256: receipt.treeSha256,
    gather: { maxPartBytes: 8, memoryBudgetBytes: 32, concurrency: 2 } };
  const write = async value => fs.writeFile(file, JSON.stringify(value));
  await write(config);
  return { root, directory, receipt, file, config, write };
}

it('binds source preparation and tooling to the same state and snapshots its policy', async () => {
  const { directory, file, config, write, receipt } = await fixture();
  const source = await openNativeRuntimeSource(file);
  source.runtime.configureDeviceMemoryBudget({ maxBytes: 128 });
  expect(source.tooling.getDevice()).toBe(source.runtime.inspectDeviceMemory());
  expect(source.tooling.getDevice().budget).toBe(128);
  expect(source.receipt).toEqual(receipt);
  expect(Object.isFrozen(source.gather)).toBe(true);
  expect(Object.isFrozen(source.receipt.package)).toBe(true);
  await write({ ...config, gather: { ...config.gather, concurrency: 99 } });
  expect(source.gather.concurrency).toBe(2);
  await source.assertCurrent();
  await fs.writeFile(path.join(directory, 'src/new.js'), '// changed after startup');
  await expect(source.assertCurrent()).rejects.toThrow('hash mismatch');
  const replacement = await inspectNativeRuntimeSource(directory);
  await write({ ...config, treeSha256: replacement.treeSha256 });
  await expect(openNativeRuntimeSource(file)).rejects.toThrow('restart before selecting a new tree');
});

it('rejects missing pins, unknown fields and invalid limits before any source import', async () => {
  const { file, config, write } = await fixture();
  for (const value of [{ ...config, treeSha256: undefined }, { ...config, treeSha256: '0'.repeat(64) },
    { ...config, extra: true }, { ...config, directory: 'relative' },
    { ...config, gather: { ...config.gather, concurrency: 0 } }, { ...config, gather: { ...config.gather, extra: 1 } }]) {
    await write(value);
    await expect(openNativeRuntimeSource(file)).rejects.toThrow();
    expect(globalThis.__nativeSourceImported).toBeUndefined();
  }
  await expect(openNativeRuntimeSource('relative.json')).rejects.toThrow('absolute');
});

it('keeps source selection out of public, signed, custody, earning and whole-model routes', async () => {
  const allowed = { roomId: 'private-fixture', publicRoomId: bootstrap.publicRoomId, model: { id: 'fixture' } };
  expect(() => assertNativeRuntimeSourceMode(allowed)).not.toThrow();
  for (const overrides of [{ roomId: bootstrap.publicRoomId }, { roomId: '' }, { executionMode: 'whole-model' },
    { canonical: {} }, { earning: {} }, { cacheDirectory: '/cache' }, { resolvePartitionSource() {} },
    { model: { capsule: {} } }, { model: { adapters: [{}] } }]) {
    expect(() => assertNativeRuntimeSourceMode({ ...allowed, ...overrides })).toThrow('private unsigned partition');
  }
  // Constructor rejects forbidden source mode before identity, transport or provider initialization.
  await expect(createNativeParticipant({ sourceRuntime: {}, roomId: bootstrap.publicRoomId }))
    .rejects.toThrow('private unsigned partition');
});

it('advertises explicit activation and rejects a public CLI selection before identity or modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-runtime-cli-')); roots.push(root);
  const cli = path.resolve('server/native-participant.js');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 10000 });
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain('--runtime-source-config');
  const identity = path.join(root, 'identity.json');
  const result = spawnSync(process.execPath, [cli, '--contribute', '--model', 'fixture', '--model-directory', root,
    '--identity-file', identity, '--rtc-module', '/never-import.js', '--ws-module', '/never-import.js',
    '--gpu-module', '/never-import.js', '--runtime-source-config', path.join(root, 'absent.json')],
  { encoding: 'utf8', timeout: 10000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('private unsigned partition');
  await expect(fs.stat(identity)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rechecks source identity and cancellation before entering native provider initialization', async () => {
  const nativeGpu = vi.fn(), failure = new Error('Source changed after startup');
  const sourceRuntime = { runtime: {}, gather: {}, assertCurrent: vi.fn(async () => { throw failure; }) };
  const options = { model: { id: 'fixture' }, sourceRuntime, nativeGpu, index: 0, participantId: 'native',
    signal: new AbortController().signal };
  await expect(openNativePartition(options)).rejects.toBe(failure);
  expect(nativeGpu).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort(new Error('Already cancelled'));
  await expect(openNativePartition({ ...options, signal: abort.signal })).rejects.toThrow('Already cancelled');
  expect(sourceRuntime.assertCurrent).toHaveBeenCalledOnce();
  expect(nativeGpu).not.toHaveBeenCalled();
  await expect(openNativePartition({ ...options, sourceRuntime: { assertCurrent: async () => {} } }))
    .rejects.toThrow('selected runtime, gather policy and identity recheck');
  expect(nativeGpu).not.toHaveBeenCalled();
});
