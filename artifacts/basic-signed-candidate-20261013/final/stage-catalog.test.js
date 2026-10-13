// Synthetic metadata-copy controls only; no signing/qualification fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stageCatalog } from './stage-catalog.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'signed-metadata-copy-'));
  try {
    const applicationRoot = path.join(directory, 'app'), capsuleRoot = path.join(directory, 'capsule');
    await fs.mkdir(path.join(applicationRoot, 'self/config'), { recursive: true });
    await fs.mkdir(path.join(capsuleRoot, 'artifacts'), { recursive: true });
    const data = Buffer.from('{"synthetic":true}');
    await fs.writeFile(path.join(capsuleRoot, 'artifacts/manifest.json'), data);
    const catalog = [{ capsule: { artifacts: [{ path: 'artifacts/manifest.json', role: 'manifest', hash: 'sha256:' + hash(data), sizeBytes: data.length }] },
      executablePack: {}, packOpenOptions: {}, source: { files: [{ path: 'manifest.json', role: 'model-manifest', hashAlgorithm: 'sha256', hash: hash(data), sizeBytes: data.length, url: 'https://invalid.test/original' }] } }];
    const catalogPath = path.join(directory, 'catalog.json');
    const bytes = JSON.stringify(catalog); await fs.writeFile(catalogPath, bytes);
    await run({ applicationRoot, capsuleRoot, catalogPath, catalogSha256: hash(bytes) }, catalog, data, directory);
  } finally { await fs.rm(directory, { recursive: true }); }
}
test('preserves signed logical paths and binds local content-addressed metadata', () => fixture(async (options, catalog, data) => {
  const result = await stageCatalog(options);
  const actual = JSON.parse(await fs.readFile(path.join(options.applicationRoot, 'self/config/chat-models.json')));
  assert.deepEqual(actual[0].capsule, catalog[0].capsule);
  assert.equal(actual[0].source.files[0].path, 'manifest.json');
  assert.match(actual[0].source.files[0].url, /^\/config\/model-manifests\/[a-f0-9]{64}\.json$/);
  assert((await fs.readFile(path.join(options.applicationRoot, result.metadata[0].path))).equals(data));
}));
test('rejects changed handoff or metadata before publishing catalog', () => fixture(async options => {
  await assert.rejects(stageCatalog({ ...options, catalogSha256: '0'.repeat(64) }), /handoff/);
  await fs.writeFile(path.join(options.capsuleRoot, 'artifacts/manifest.json'), 'changed');
  await assert.rejects(stageCatalog(options), /mismatch/);
  await assert.rejects(fs.stat(path.join(options.applicationRoot, 'self/config/chat-models.json')), { code: 'ENOENT' });
}));
test('rejects metadata escaping the supplied closure', () => fixture(async (options, catalog, data, directory) => {
  await fs.writeFile(path.join(directory, 'outside.json'), data);
  catalog[0].capsule.artifacts[0].path = '../outside.json';
  const bytes = JSON.stringify(catalog); await fs.writeFile(options.catalogPath, bytes);
  await assert.rejects(stageCatalog({ ...options, catalogSha256: hash(bytes) }), /escapes/);
}));
