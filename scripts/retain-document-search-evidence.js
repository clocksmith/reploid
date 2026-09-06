#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const safePath = path => typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path)
  && !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..')
  && !/private|custody|node_modules|npm-cache/i.test(path);

async function retain(config) {
  const report = JSON.parse(await readFile(resolve(config.runDir, 'qualification.json'), 'utf8'));
  requireValue(report.schema === 'reploid.document-search-qualification/v1' && report.passed
    && report.servedFiles.length > 0, 'Completed physical document report with retained runtime required');
  const files = new Map();
  const add = async (path, source, expected) => {
    requireValue(safePath(path) && !files.has(path), `Unsafe or duplicate archive path: ${path}`);
    const bytes = await readFile(source);
    const record = { path, hash: hash(bytes), sizeBytes: bytes.length };
    if (expected) requireValue(record.hash === expected.hash && record.sizeBytes === expected.sizeBytes,
      `Retained bytes differ from observation: ${path}`);
    files.set(path, { ...record, base64: bytes.toString('base64') });
  };
  await add('document-search/qualification.json', resolve(config.runDir, 'qualification.json'));
  await add('document-search/runner.js', resolve(config.runDir, 'runner.js'));
  requireValue(files.get('document-search/runner.js').hash === report.runnerHash, 'Runner identity mismatch');
  for (const receipt of report.servedFiles) {
    await add(`document-search/runtime${receipt.path}`, resolve(config.runDir, 'runtime', '.' + receipt.path), receipt);
  }
  const externalArtifacts = [];
  for (const [role, packPath] of Object.entries(config.packs)) {
    requireValue(['embedding', 'reranker', 'generator'].includes(role), 'Unknown model role');
    const pack = JSON.parse(await readFile(packPath, 'utf8'));
    await add(`packs/${role}/pack.json`, packPath);
    for (const artifact of pack.artifacts) {
      requireValue(safePath(artifact.path), 'Unsafe Pack artifact path');
      if (artifact.role === 'weight-shard') {
        // Verify every omitted weight now; the index is custody evidence, not a download URL.
        const bytes = await readFile(resolve(dirname(packPath), artifact.path));
        requireValue(hash(bytes) === artifact.hash && bytes.length === artifact.sizeBytes,
          `Weight identity mismatch: ${artifact.artifactId}`);
        externalArtifacts.push({ modelRole: role, ...artifact, retained: false });
      } else {
        await add(`packs/${role}/${artifact.path}`, resolve(dirname(packPath), artifact.path), artifact);
      }
    }
    await add(`packs/${role}/MODEL_LICENSE.txt`, resolve(dirname(packPath), 'MODEL_LICENSE.txt'));
  }
  for (const attachment of config.attachments) await add(attachment.path, attachment.source);
  await add('retainer.js', fileURLToPath(import.meta.url));
  const rows = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const plain = Buffer.from(JSON.stringify({ schema: 'reploid.document-evidence-archive/v1', files: rows }) + '\n');
  requireValue(plain.length < 96 * 1024 * 1024, 'Evidence exceeds bounded extraction limit');
  const archive = gzipSync(plain, { level: 9 });
  const index = { schema: 'reploid.document-evidence-index/v1', createdAt: new Date().toISOString(),
    boundary: report.boundary, archive: { path: 'evidence.json.gz', hash: hash(archive), sizeBytes: archive.length,
      expandedBytes: plain.length }, files: rows.map(({ base64, ...receipt }) => receipt), externalArtifacts };
  await mkdir(config.outputDir);
  await writeFile(resolve(config.outputDir, index.archive.path), archive, { flag: 'wx' });
  await writeFile(resolve(config.outputDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  return { files: rows.length, externalWeights: externalArtifacts.length, archiveBytes: archive.length };
}

async function extract(directory, outputDir) {
  const index = JSON.parse(await readFile(resolve(directory, 'index.json'), 'utf8'));
  requireValue(index.schema === 'reploid.document-evidence-index/v1' && safePath(index.archive.path), 'Invalid archive index');
  const bytes = await readFile(resolve(directory, index.archive.path));
  requireValue(hash(bytes) === index.archive.hash && bytes.length === index.archive.sizeBytes, 'Archive digest mismatch');
  const plain = gunzipSync(bytes, { maxOutputLength: 96 * 1024 * 1024 });
  requireValue(plain.length === index.archive.expandedBytes, 'Expanded size mismatch');
  const archive = JSON.parse(plain);
  requireValue(archive.schema === 'reploid.document-evidence-archive/v1'
    && archive.files.length === index.files.length, 'Archive inventory mismatch');
  const seen = new Set();
  const verified = archive.files.map((file, i) => {
    requireValue(safePath(file.path) && !seen.has(file.path), 'Unsafe or duplicate extraction path');
    seen.add(file.path);
    const content = Buffer.from(file.base64, 'base64');
    const expected = index.files[i];
    requireValue(expected.path === file.path && expected.hash === file.hash
      && expected.sizeBytes === file.sizeBytes && content.length === file.sizeBytes
      && hash(content) === file.hash, `Archive entry mismatch: ${file.path}`);
    return { path: file.path, content };
  });
  // A fresh root prevents traversal through pre-existing directories or symlinks.
  await mkdir(outputDir);
  for (const file of verified) {
    const destination = resolve(outputDir, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, { flag: 'wx' });
  }
  return { files: verified.length, outputDir };
}

const [command, input, output] = process.argv.slice(2);
const action = command === 'retain' && input && !output
  ? readFile(input, 'utf8').then(JSON.parse).then(retain)
  : command === 'extract' && input && output ? extract(input, output)
    : Promise.reject(new Error('Usage: retain-document-search-evidence.js retain <config.json> | extract <archive-directory> <new-output-directory>'));
action.then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
