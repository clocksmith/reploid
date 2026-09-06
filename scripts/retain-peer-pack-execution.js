#!/usr/bin/env node
/** Retain a local execution episode; never upgrades its independence claims. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { sha256Hex } from '../self/pool/inference-receipt.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const inside = (root, path) => {
  const file = resolve(root, path);
  assert(file.startsWith(resolve(root) + sep), 'Retained artifact path escapes root');
  return file;
};

export async function retainPeerPackExecution({ reportPath, outputDirectory, weightOrigin, attachments = [] }) {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert(report.passed && report.runtimeBootstrap?.files?.length, 'Retention requires a passed source-bound episode');
  const packRoot = dirname(resolve(report.config.packPath));
  const packBytes = await readFile(report.config.packPath);
  assert(await sha256Hex(packBytes) === report.authorization.envelopeArtifact.hash, 'Episode envelope bytes changed');
  const pack = JSON.parse(packBytes);
  const roots = { reploid: ROOT, doppler: resolve(report.config.dopplerRoot) };
  const paths = { reploid: ['scripts/verify-peer-pack-execution.js'], doppler: ['tools/lib/sequence-model-qualification.js'] };
  for (const entry of report.runtimeBootstrap.files) {
    const owner = entry.path.startsWith('/doppler/src/') ? 'doppler' : 'reploid';
    const path = entry.path.slice(owner === 'doppler' ? '/doppler/'.length : 1);
    const bytes = await readFile(inside(roots[owner], path));
    assert(await sha256Hex(bytes) === entry.hash && bytes.length === entry.sizeBytes, `Runtime source changed: ${entry.path}`);
    paths[owner].push(path);
  }
  const patches = {};
  for (const [owner, root] of Object.entries(roots)) {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert(git('rev-parse', 'HEAD').trim() === report.sources[owner].head, `${owner} base revision changed`);
    patches[owner] = git('diff', '--binary', 'HEAD', '--', ...paths[owner]);
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z', '--', ...paths[owner]).split('\0').filter(Boolean);
    for (const path of untracked) {
      const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', path], { cwd: root, encoding: 'utf8' });
      assert(diff.status === 1, `Cannot retain new runtime source: ${path}`);
      patches[owner] += diff.stdout;
    }
  }
  const output = resolve(outputDirectory);
  await mkdir(output); // A retained episode is never overwritten.
  const receipts = [];
  const retain = async (path, bytes) => {
    const file = inside(output, path);
    if (file.startsWith(ROOT + sep)) {
      const ignored = spawnSync('git', ['check-ignore', '--no-index', '-q', '--', relative(ROOT, file)], { cwd: ROOT });
      assert(ignored.status === 1, `Evidence would be excluded from a clean checkout: ${path}`);
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
    receipts.push({ path, hash: await sha256Hex(bytes), sizeBytes: Buffer.byteLength(bytes) });
  };
  await retain('episode.json', await readFile(reportPath));
  await retain('pack/pack.json', packBytes);
  const externalArtifacts = [];
  for (const artifact of pack.artifacts) {
    const bytes = await readFile(inside(packRoot, artifact.path));
    assert(bytes.length === artifact.sizeBytes && await sha256Hex(bytes) === artifact.hash, `Pack source changed: ${artifact.artifactId}`);
    if (artifact.role === 'weight-shard') {
      const url = new URL(basename(artifact.path), weightOrigin);
      assert(url.protocol === 'https:', 'Weight origin must use HTTPS');
      externalArtifacts.push({ ...artifact, url: url.href });
    } else await retain(`pack/${artifact.path}`, bytes);
  }
  for (const [owner, patch] of Object.entries(patches)) await retain(`${owner}-runtime.patch`, patch);
  for (const file of attachments) {
    // The repository ignores diagnostic *.log files. Retained text logs are artifacts.
    const name = basename(file).replace(/\.log$/, '.txt');
    await retain(`attachments/${name}`, await readFile(file));
  }
  const index = { schema: 'reploid.pool.retained-peer-pack-episode/v1', claimBoundary: report.claimBoundary,
    sourceBases: report.sources, sourcePatchScope: 'served browser files and proof entrypoints; not all development changes',
    runtimeSourceSnapshotDigest: report.runtimeBootstrap.sourceSnapshotDigest, files: receipts, externalArtifacts };
  await writeFile(resolve(output, 'index.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  return index;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { attachments: [] };
  const keys = { '--report': 'reportPath', '--out': 'outputDirectory', '--weight-origin': 'weightOrigin' };
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    assert(process.argv[i + 1], `Missing value for ${flag}`);
    if (flag === '--attachment') options.attachments.push(process.argv[i + 1]);
    else { assert(keys[flag], `Unknown option: ${flag}`); options[keys[flag]] = process.argv[i + 1]; }
  }
  const index = await retainPeerPackExecution(options);
  console.log(JSON.stringify({ output: options.outputDirectory, retainedFiles: index.files.length, externalArtifacts: index.externalArtifacts.length }));
}
