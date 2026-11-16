// @vitest-environment node
import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeSourceFileReader, snapshotNativeSourceFiles } from '../../server/native-source-files.js';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-source-paths-'));
  roots.push(root);
  const source = path.join(root, 'source.gguf');
  await fs.writeFile(source, new Uint8Array([1, 2, 3, 4]));
  return { root, source };
}
it('reads only an exact local mapped file with bounded ranges', async () => {
  const f = await fixture();
  const read = await createNativeSourceFileReader({ 'weights.gguf': f.source });
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
  const pending = createNativeSourceFileReader(paths);
  paths['weights.gguf'] = '/not-approved';
  paths['other.gguf'] = f.source;
  const read = await pending;
  expect(await read('weights.gguf', { offset: 0, size: 1, maxBytes: 1 })).toEqual(new Uint8Array([1]));
  expect(await read('other.gguf', { offset: 0, size: 1, maxBytes: 1 })).toBeNull();
});
it('rejects replaced files, leaf symlinks, directories, invalid maps and cancellation', async () => {
  const f = await fixture();
  const read = await createNativeSourceFileReader({ 'weights.gguf': f.source });
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
