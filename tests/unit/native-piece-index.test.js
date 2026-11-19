// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Hex } from '../../server/hashing.js';
import { fetchPieceIndex, isExternalPieceIndex } from '../../server/native-piece-index.js';
import { openNativeModelSource } from '../../server/native-model-source.js';

const roots = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const bytes = Buffer.from('{"files":[]}');
const hash = sha256Hex(bytes);
const modelId = 'flash-test';
const url = `https://huggingface.co/clocksmith/rdrr/resolve/${'1'.repeat(40)}/models/${modelId}/indexes/${hash}/pieces.json`;
const file = { path: 'pieces.json', role: 'model-piece-index', sizeBytes: bytes.length, hashAlgorithm: 'sha256', hash, url };

it('loads a missing index through the native source, then opens it offline', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-index-'));
  roots.push(root);
  const manifest = JSON.stringify({ modelId });
  await fs.writeFile(path.join(root, 'manifest.json'), manifest);
  const fetch = vi.fn(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  const source = { model: { id: modelId, identity: 'sha256:' + sha256Hex(manifest), source: { files: [file] } },
    modelDirectory: root, runtime: { createVerifiedPieceStorage: async ({ indexBytes }) => {
      expect(Buffer.from(indexBytes)).toEqual(bytes);
      return { storage: { close() {} } };
    } } };
  await openNativeModelSource(source);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit' }));
  await openNativeModelSource(source);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(root, file.path))).toEqual(bytes);
});

it('requires a release pin and rejects an oversized, short or corrupt response', async () => {
  expect(isExternalPieceIndex(modelId, { ...file, url: url.replace('1'.repeat(40), 'main') })).toBe(false);
  expect(isExternalPieceIndex(modelId, { ...file, url: url + '?redirect=1' })).toBe(false);
  expect(isExternalPieceIndex('another-model', file)).toBe(false);
  for (const payload of [Buffer.concat([bytes, Buffer.from('x')]), bytes.subarray(1), Buffer.alloc(bytes.length)]) {
    await expect(fetchPieceIndex(modelId, file, undefined, async () => new Response(payload))).rejects.toThrow();
  }
});
