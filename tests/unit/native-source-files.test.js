// @vitest-environment node
import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeSourceFileReader, snapshotNativeSourceFiles } from '../../server/native-source-files.js';
const roots = [], readers = [];
afterEach(async () => {
  await Promise.all(readers.splice(0).map(read => read.close()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function ownReader(paths) {
  const read = await createNativeSourceFileReader(paths);
  readers.push(read); return read;
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-source-paths-'));
  roots.push(root);
  const source = path.join(root, 'source.gguf');
  await fs.writeFile(source, new Uint8Array([1, 2, 3, 4]));
  return { root, source };
}
it('reads only an exact local mapped file with bounded ranges', async () => {
  const f = await fixture();
  const read = await ownReader({ 'weights.gguf': f.source });
  expect(await read('weights.gguf', { offset: 1, size: 2, maxBytes: 2 })).toEqual(new Uint8Array([2, 3]));
  expect(await read('source.gguf', { offset: 0, size: 1, maxBytes: 2 })).toBeNull();
  expect(await read('../source.gguf', { offset: 0, size: 1, maxBytes: 2 })).toBeNull();
  for (const values of [{ offset: -1, size: 1 }, { offset: 3, size: 2 }, { offset: 0, size: 3 }, { offset: 0, size: 0 }]) {
    await expect(read('weights.gguf', { ...values, maxBytes: 2 })).rejects.toThrow('range');
  }
});
it('snapshots the map before asynchronous path resolution', async () => {
  const f = await fixture();
  const paths = { 'weights.gguf': f.source };
  const pending = ownReader(paths);
  paths['weights.gguf'] = '/not-approved';
  paths['other.gguf'] = f.source;
  const read = await pending;
  expect(await read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).toEqual(new Uint8Array([1]));
  expect(await read('other.gguf', { offset: 0, size: 1, maxBytes: 1 })).toBeNull();
});
it('rejects replaced files, leaf symlinks, directories, invalid maps and cancellation', async () => {
  const f = await fixture();
  const read = await ownReader({ 'weights.gguf': f.source });
  expect(await read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).toEqual(new Uint8Array([1]));
  const control = new AbortController();
  control.abort(new Error('cancelled'));
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1, signal: control.signal })).rejects.toThrow('cancelled');
  await fs.rename(f.source, path.join(f.root, 'old'));
  await fs.writeFile(f.source, new Uint8Array([1, 2, 3, 4]));
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow('changed');
  await fs.unlink(f.source);
  await fs.symlink(path.join(f.root, 'old'), f.source);
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow();
  await expect(createNativeSourceFileReader({ 'weights.gguf': f.root })).rejects.toThrow('regular file');
  for (const paths of [null, [], { '../weights': f.source }, { '..': f.source }, { weights: 'relative' }]) {
    expect(() => snapshotNativeSourceFiles(paths)).toThrow();
  }
});

it('shares one lazy descriptor across concurrent positioned reads and closes it once', async () => {
  const f = await fixture();
  const open = vi.spyOn(fs, 'open');
  const read = await ownReader({ 'weights.gguf': f.source });
  expect(open).not.toHaveBeenCalled();
  const results = await Promise.all(Array.from({ length: 12 }, (_, offset) =>
    read('weights.gguf', { offset: offset % 4, size: 1, maxBytes: 1 })));
  expect(results.map(bytes => bytes[0])).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]);
  expect(open).toHaveBeenCalledTimes(1);
  const handle = await open.mock.results[0].value;
  const close = vi.spyOn(handle, 'close');
  await read.close(); await read.close();
  expect(close).toHaveBeenCalledTimes(1);
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow('closed');
});

it('settles real in-flight I/O before closing its descriptor and never publishes cancelled bytes', async () => {
  const f = await fixture();
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const original = fs.open.bind(fs);
  let handle;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    handle = await original(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...values) => {
      entered(); await gate; return read(...values);
    });
    return handle;
  });
  const read = await ownReader({ 'weights.gguf': f.source });
  const pending = expect(read('weights.gguf', { offset: 0, size: 4, maxBytes: 4 })).rejects.toThrow('closed');
  await started;
  const close = vi.spyOn(handle, 'close');
  let settled = false;
  const closing = read.close().then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false); expect(close).not.toHaveBeenCalled();
  release(); await pending; await closing;
  expect(close).toHaveBeenCalledTimes(1);
});

it('retains failed descriptor cleanup for an explicit retry while keeping admission closed', async () => {
  const f = await fixture(), open = vi.spyOn(fs, 'open');
  const read = await ownReader({ 'weights.gguf': f.source });
  await read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 });
  const handle = await open.mock.results[0].value;
  const close = vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('Delayed descriptor release'));
  await expect(read.close()).rejects.toThrow('cleanup failed');
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow('closed');
  await read.close();
  expect(close).toHaveBeenCalledTimes(2);
});

it('keeps an unadmitted descriptor owned when both identity checking and immediate release fail', async () => {
  const f = await fixture(), original = fs.open.bind(fs);
  let close;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    vi.spyOn(handle, 'stat').mockRejectedValueOnce(new Error('Descriptor identity check failed'));
    close = vi.spyOn(handle, 'close').mockRejectedValueOnce(new Error('Descriptor release failed'));
    return handle;
  });
  const read = await ownReader({ 'weights.gguf': f.source });
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow('admission and cleanup failed');
  await expect(read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).rejects.toThrow('closed');
  await read.close();
  expect(close).toHaveBeenCalledTimes(2);
});
