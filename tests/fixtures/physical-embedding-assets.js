/** Shared optional mounts for the existing signed embedding qualification fixture. */
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';

export async function physicalEmbeddingAssets(filename) {
  if (!filename) return { configuration: null, serve: () => false };
  const config = JSON.parse(await readFile(filename, 'utf8'));
  const receipt = JSON.parse(await readFile(path.join(config.packageBundlePath, 'receipt.json'), 'utf8'));
  const archive = await readFile(path.join(config.packageBundlePath, receipt.package.filename));
  assert.equal(createHash('sha256').update(archive).digest('hex'), receipt.package.sha256);
  assert.equal(receipt.passed, true);
  const reference = JSON.parse(await readFile(config.referencePath, 'utf8'));
  const capsule = JSON.parse(await readFile(config.capsulePath, 'utf8'));
  const configuration = { config: { ...config, capsuleFilename: path.basename(config.capsulePath) },
    reference, capsule, expectedReferenceDigest: config.application.oracle.digest, runtimePackage: receipt.package };
  const runtimeRoot = path.join(config.packageBundlePath, 'consumer/node_modules/doppler-gpu');
  const capsuleRoot = path.dirname(config.capsulePath);
  return { configuration, serve(pathname, response) {
    if (pathname === '/physical/config.json') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(configuration)); return true;
    }
    const mounted = pathname.startsWith('/src/') ? [runtimeRoot, pathname.slice(1)]
      : pathname.startsWith('/capsule/') ? [capsuleRoot, decodeURIComponent(pathname.slice('/capsule/'.length))] : null;
    if (!mounted) return false;
    const file = path.resolve(...mounted);
    if (!file.startsWith(mounted[0] + path.sep)) { response.writeHead(403).end(); return true; }
    response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json'
      : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy()); stream.pipe(response); return true;
  } };
}
