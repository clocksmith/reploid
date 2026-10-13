// Artifact preparation only. The release owner supplies a hash-bound, genuinely
// qualified catalog; this script binds metadata bytes, not qualification truth.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function stageCatalog({ applicationRoot, capsuleRoot, catalogPath, catalogSha256 }) {
  const bytes = await fs.readFile(catalogPath);
  assert.equal(hash(bytes), catalogSha256, 'Release catalog differs from handoff');
  const catalog = JSON.parse(bytes), pending = new Map();
  const closureRoot = await fs.realpath(capsuleRoot);
  assert(Array.isArray(catalog) && catalog.length > 0);
  for (const model of catalog) {
    assert(model.capsule && model.executablePack && model.packOpenOptions && !model.canonicalGeneration,
      'Signed legacy catalog required; canonical mode is not enabled by delivery');
    for (const file of model.source.files) {
      const artifact = model.capsule.artifacts.find(row => row.role !== 'weight-shard'
        && row.hash === 'sha256:' + file.hash && row.sizeBytes === file.sizeBytes);
      assert(artifact && file.hashAlgorithm === 'sha256' && /^[a-f0-9]{64}$/.test(file.hash), 'Unbound metadata');
      const filename = await fs.realpath(path.resolve(closureRoot, artifact.path));
      assert(filename.startsWith(closureRoot + path.sep), 'Metadata escapes Capsule closure');
      const data = await fs.readFile(filename);
      assert.equal(data.length, file.sizeBytes, 'Metadata size mismatch');
      assert.equal(hash(data), file.hash, 'Metadata hash mismatch');
      const extension = path.extname(artifact.path);
      assert(/^\.[a-zA-Z0-9]+$/.test(extension), 'Metadata extension required');
      const group = file.role === 'model-manifest' ? 'model-manifests' : file.role === 'model-piece-index' ? 'model-pieces' : 'model-artifacts';
      file.url = `/config/${group}/${file.hash}${extension}`;
      pending.set('self' + file.url, data);
    }
  }
  for (const [name, data] of pending) {
    const destination = path.join(applicationRoot, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try { await fs.writeFile(destination, data, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert((await fs.readFile(destination)).equals(data), 'Existing metadata differs'); }
  }
  const output = Buffer.from(JSON.stringify(catalog, null, 2) + '\n');
  const destination = path.join(applicationRoot, 'self/config/chat-models.json');
  await fs.writeFile(destination + '.preparing', output); await fs.rename(destination + '.preparing', destination);
  return { inputCatalogSha256: catalogSha256, outputCatalogSha256: hash(output),
    scope: 'Metadata byte preparation only; supplied qualification is not independently recomputed here',
    metadata: [...pending].map(([name, data]) => ({ path: name, bytes: data.length, sha256: hash(data) })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [applicationRoot, capsuleRoot, catalogPath, catalogSha256, output] = process.argv.slice(2);
  assert(output, 'Explicit application, Capsule closure, catalog, expected SHA256 and receipt required');
  await fs.writeFile(output, JSON.stringify(await stageCatalog({ applicationRoot, capsuleRoot, catalogPath, catalogSha256 }), null, 2) + '\n');
}
