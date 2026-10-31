// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inspectPackageArchive, verifyInstalledPackage, packageIdentityReceipt,
  preflightInstalledWorkers } from '../fixtures/installed-package-identity.js';

const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-identity-test-'));
  directories.push(directory);
  const installedPackage = path.join(directory, 'package');
  await fs.mkdir(path.join(installedPackage, 'src'), { recursive: true });
  return { directory, installedPackage };
}

async function pack(f, source = 'export const value = 42;\n') {
  await fs.writeFile(path.join(f.installedPackage, 'package.json'),
    JSON.stringify({ name: 'doppler-gpu', version: '1.0.0', type: 'module' }));
  await fs.writeFile(path.join(f.installedPackage, 'src/partitions.js'), source);
  const archivePath = path.join(f.directory, 'package.tgz');
  await exec('tar', ['-czf', archivePath, '-C', f.directory, 'package']);
  return { path: archivePath, sha256: hash(await fs.readFile(archivePath)) };
}

async function withWorker(config, directory, run) {
  const configPath = path.join(directory, 'single-worker.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const worker = fileURLToPath(new URL('../fixtures/qwen-partition-worker.js', import.meta.url));
  const child = spawn(process.execPath, [worker, configPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let serial = 0;
  async function rpc(body) {
    const id = ++serial;
    child.stdin.write(JSON.stringify({ ...body, id }) + '\n');
    const line = await lines.next();
    expect(line.done).toBe(false);
    const result = JSON.parse(line.value.slice('@q4-response '.length));
    expect(result.id).toBe(id);
    return result;
  }
  try { await run(rpc); }
  finally {
    child.stdin.end();
    await exited;
  }
}

describe('installed package bytes before diagnostic model opening', () => {
  it('derives hashes from the archive and verifies installed files without importing them', async () => {
    const f = await fixture();
    const source = "throw new Error('Importing package code is forbidden during identity preflight');\n";
    const packageArchive = await pack(f, source);
    const expected = await inspectPackageArchive(packageArchive);
    expect(expected.files.find(file => file.path === 'src/partitions.js')).toEqual({
      path: 'src/partitions.js', sizeBytes: Buffer.byteLength(source), sha256: hash(source) });
    const receipt = await verifyInstalledPackage({ ...f, packageArchive });
    expect(receipt.archiveSha256).toBe(packageArchive.sha256);
    expect(receipt.package).toEqual({ name: 'doppler-gpu', version: '1.0.0' });
    expect(receipt.fileCount).toBe(2);
    expect(receipt.exclusions).toEqual(['node_modules']);
    // External dependencies are explicitly outside this byte-identity contract.
    await fs.mkdir(path.join(f.installedPackage, 'node_modules'));
    await fs.writeFile(path.join(f.installedPackage, 'node_modules/provider.node'), 'unverified provider');
    expect(await verifyInstalledPackage({ ...f, packageArchive })).toEqual(receipt);
  });

  it.each(['changed', 'missing', 'extra', 'link'])('rejects %s installed files', async kind => {
    const f = await fixture();
    const packageArchive = await pack(f);
    const file = path.join(f.installedPackage, 'src/partitions.js');
    if (kind === 'changed') await fs.writeFile(file, 'export const value = 43;\n');
    if (kind === 'missing') await fs.unlink(file);
    if (kind === 'extra') await fs.writeFile(path.join(f.installedPackage, 'src/stale.js'), 'stale');
    if (kind === 'link') {
      await fs.rename(file, path.join(f.directory, 'borrowed.js'));
      await fs.symlink(path.join(f.directory, 'borrowed.js'), file);
    }
    await expect(verifyInstalledPackage({ ...f, packageArchive })).rejects.toThrow(
      /hash mismatch|Missing installed|Unexpected installed|links are not supported/);
  });

  it('rejects changed archive bytes and requires an explicit hash', async () => {
    const f = await fixture();
    const packageArchive = await pack(f);
    await fs.appendFile(packageArchive.path, 'changed');
    await expect(inspectPackageArchive(packageArchive)).rejects.toThrow('archive SHA-256 mismatch');
    await expect(inspectPackageArchive({ path: packageArchive.path })).rejects.toThrow('SHA-256 is required');
  });

  it('rejects archive links and bundled dependencies rather than claiming dependency closure', async () => {
    const f = await fixture();
    await fs.symlink('/outside', path.join(f.installedPackage, 'link'));
    let packageArchive = await pack(f);
    await expect(inspectPackageArchive(packageArchive)).rejects.toThrow('Archive links');
    await fs.unlink(path.join(f.installedPackage, 'link'));
    await fs.mkdir(path.join(f.installedPackage, 'node_modules'));
    packageArchive = await pack(f);
    await expect(inspectPackageArchive(packageArchive)).rejects.toThrow('Bundled dependencies');
  });

  it('retains observed mismatches and admits no model until all worker identities agree', async () => {
    const f = await fixture();
    const expected = await inspectPackageArchive(await pack(f));
    const receipt = packageIdentityReceipt(expected);
    const events = [], receipts = [];
    const workers = [0, 1].map(index => ({ async rpc(request) {
      events.push([index, request.op]);
      return index ? { ...receipt, treeSha256: '0'.repeat(64) } : receipt;
    } }));
    await expect(preflightInstalledWorkers(workers, expected, receipts)).rejects.toThrow('Stage 1');
    expect(events).toEqual([[0, 'identity'], [1, 'identity']]);
    expect(receipts).toHaveLength(2);
    workers[1].rpc = async request => { events.push([1, request.op]); return receipt; };
    await preflightInstalledWorkers(workers, expected, []);
  });

  it('requires preflight and catches installation changes before the first package import', async () => {
    const f = await fixture();
    const packageArchive = await pack(f, "throw new Error('Package import must not happen');\n");
    await withWorker({ ...f, packageArchive }, f.directory, async rpc => {
      expect((await rpc({ op: 'open', indices: [0] })).error.message).toMatch(/preflight is required/);
      expect((await rpc({ op: 'identity' })).value.archiveSha256).toBe(packageArchive.sha256);
      await fs.appendFile(path.join(f.installedPackage, 'src/partitions.js'), '// mutation');
      expect((await rpc({ op: 'open', indices: [0] })).error.message).toMatch(/Installed package size mismatch/);
      expect((await rpc({ op: 'close' })).value).toEqual({ gpuOpened: false });
    });
  });

  it('fails the actual two-worker controller before either package imports or model opens', async () => {
    const f = await fixture();
    const marker = path.join(f.directory, 'imported');
    const packageArchive = await pack(f,
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported');\n`);
    const other = path.join(f.directory, 'other-package');
    await fs.cp(f.installedPackage, other, { recursive: true });
    await fs.appendFile(path.join(other, 'src/partitions.js'), '// tampered');
    const worker = fileURLToPath(new URL('../fixtures/qwen-partition-worker.js', import.meta.url));
    const configs = await Promise.all([f.installedPackage, other].map(async (installedPackage, index) => {
      const filename = path.join(f.directory, `worker-${index}.json`);
      await fs.writeFile(filename, JSON.stringify({ installedPackage, packageArchive }));
      return filename;
    }));
    const baselinePath = path.join(f.directory, 'baseline.json');
    const baseline = JSON.stringify({ ids: [], rows: [] });
    await fs.writeFile(baselinePath, baseline);
    const configPath = path.join(f.directory, 'controller.json');
    await fs.writeFile(configPath, JSON.stringify({ packageArchive, baselinePath,
      baselineSha256: hash(baseline), commandTimeoutMs: 3000,
      workers: configs.map(filename => ({ command: process.execPath, args: [worker, filename] })) }));
    const controller = fileURLToPath(new URL('../fixtures/qwen-partition-cross-host.js', import.meta.url));
    const output = path.join(f.directory, 'receipts');
    await expect(exec(process.execPath, [controller, configPath, output], { timeout: 10000 })).rejects.toThrow();
    const report = JSON.parse(await fs.readFile(path.join(output, 'report.json'), 'utf8'));
    expect(report.passed).toBe(false);
    expect(report.error.message).toMatch(/Installed package size mismatch/);
    expect(report.packages).toHaveLength(1);
    expect(report.opens).toEqual([]);
    expect(report.cleanup).toEqual([{ gpuOpened: false }, { gpuOpened: false }]);
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
