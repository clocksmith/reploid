import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GenesisSnapshot, { validatePublicationBaseline } from '../../self/infrastructure/genesis-snapshot.js';

const PIN = '/.genesis/publication/pin.json';
const descriptorPath = '/config/self-source-manifest.json';
const baselinePath = (id) => `/.genesis/publication/${id}.json`;

function makeFixture() {
  // Mix canonical /self host paths and root runtime paths as the actual VFS does.
  const files = new Map([
    ['/self/boot-spec.js', 'export const boot = true;\n'],
    ['/self/kernel/index.html', '<html><head></head><body>X</body></html>\r\n'],
    ['/self/kernel/boot.js', 'export const start = true;\n'],
    ['/self/host/seed-vfs.js', 'export const seed = true;\n'],
    ['/self/host/start-app.js', 'export const app = true;\n'],
    ['/self/host/vfs-bootstrap.js', 'export const bootstrap = true;\n'],
    ['/self/host/sw-module-loader.js', 'export const loader = true;\n'],
    ['/self/image/export.js', 'export const image = true;\n'],
    ['/self/image/manifest.js', 'export const manifest = true;\n'],
    ['/core/tool-runner.js', 'export const run = () => "λ";\n'],
    ['/tools/CreateTool.js', 'export const create = true;\n'],
    ['/config/self-source-catalog.json', ' { "hostMetadata": "must not be rewritten" } \n'],
    // A host inventory can exceed the selected source profile. Snapshot its bytes,
    // unlike the portable export operation which deliberately rewrites this file.
    ['/config/vfs-manifest.json', '{ "version": 1, "files": ["host-only.js"] }\n'],
    [descriptorPath, '']
  ]);
  const descriptor = {
    schema: 'reploid/self-source/v1', version: 1, level: 'spark',
    files: [...files.keys()].map((path) => path.replace(/^\/(self\/)?/, '')),
    seedFiles: [...files.keys()].map((path) => path.slice(1))
  };
  files.set(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  files.set('/artifacts/user-work.txt', 'preserve me');
  files.set('/config/credentials.json', 'not part of the declared source');
  return files;
}

function makeService(files = makeFixture()) {
  let serial = 0;
  const VFS = {
    read: vi.fn(async (path) => {
      if (!files.has(path)) throw new Error(`Missing VFS source: ${path}`);
      return files.get(path);
    }),
    exists: vi.fn(async (path) => files.has(path)),
    write: vi.fn(async (path, content) => files.set(path, content)),
    delete: vi.fn(async (path) => files.delete(path)),
    list: vi.fn(async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix))),
    stat: vi.fn(async () => ({ isDirectory: false }))
  };
  const deps = {
    VFS,
    EventBus: { emit: vi.fn() },
    Utils: {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      generateId: () => `snap_${++serial}`
    }
  };
  return { files, VFS, deps, service: GenesisSnapshot.factory(deps) };
}

const readJson = (files, path) => JSON.parse(files.get(path));
const importFile = (value) => new File([JSON.stringify(value)], 'snapshot.json', { type: 'application/json' });

describe('Publication-only Genesis source baseline', () => {
  let fixture;
  beforeEach(() => { fixture = makeService(); });

  it('pins and hashes exactly the complete declared bytes with an independently reproducible ID', async () => {
    const original = new Map(fixture.files);
    const meta = await fixture.service.createPublicationBaseline();
    const payload = await fixture.service.exportPublicationBaseline();
    const descriptor = JSON.parse(original.get(descriptorPath));
    expect(Object.keys(payload.files).sort()).toEqual(descriptor.files.map((path) => `/self/${path}`).sort());
    const hashes = descriptor.files.map((path, index) => {
      const content = original.get(`/${descriptor.seedFiles[index]}`);
      expect(payload.files[`/self/${path}`]).toBe(content);
      return { path: `/self/${path}`, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const id = 'genesis-sha256-' + createHash('sha256').update(JSON.stringify({
      schema: 'reploid/genesis-publication-baseline/v1', version: 1, files: hashes
    })).digest('hex');
    expect(meta).toMatchObject({ id, pinned: true, scope: 'publication', fileCount: descriptor.files.length });
    expect(readJson(fixture.files, PIN).id).toBe(id);
    expect(fixture.files.get('/artifacts/user-work.txt')).toBe('preserve me');
    expect(fixture.VFS.list).not.toHaveBeenCalled();
  });

  it('reuses identical source without any writes, including a fresh service instance', async () => {
    const first = await fixture.service.createPublicationBaseline();
    const before = new Map(fixture.files);
    fixture.VFS.write.mockClear();
    const fresh = GenesisSnapshot.factory(fixture.deps);
    expect(await fresh.createPublicationBaseline()).toEqual(first);
    expect(fixture.VFS.write).not.toHaveBeenCalled();
    expect(fixture.files).toEqual(before);
  });

  it('does not capture undeclared installed tools or user data', async () => {
    fixture.files.set('/self/tools/Later.js', 'new tool');
    await fixture.service.createPublicationBaseline();
    const payload = await fixture.service.exportPublicationBaseline();
    expect(payload.files).not.toHaveProperty('/self/tools/Later.js');
    expect(payload.files).not.toHaveProperty('/self/config/credentials.json');
    expect(payload.files).not.toHaveProperty('/self/artifacts/user-work.txt');
  });

  it.each(['deleted', 'undefined', 'unreadable'])('refuses %s declared source without writing a baseline or pin', async (mode) => {
    const path = '/core/tool-runner.js';
    if (mode === 'deleted') fixture.files.delete(path);
    if (mode === 'undefined') fixture.files.set(path, undefined);
    if (mode === 'unreadable') {
      const read = fixture.VFS.read.getMockImplementation();
      fixture.VFS.read.mockImplementation(async (target) => {
        if (target === path) throw new Error('Storage read denied');
        return read(target);
      });
    }
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow();
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('rejects a partial declared closure missing a required boot source', async () => {
    const descriptor = readJson(fixture.files, descriptorPath);
    const index = descriptor.files.indexOf('kernel/boot.js');
    descriptor.files.splice(index, 1);
    descriptor.seedFiles.splice(index, 1);
    fixture.files.set(descriptorPath, JSON.stringify(descriptor));
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('Missing boot source');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('rejects a declared destination inside protected Genesis storage', async () => {
    const descriptor = readJson(fixture.files, descriptorPath);
    descriptor.files.push('.genesis/publication/pin.json');
    descriptor.seedFiles.push('.genesis/publication/pin.json');
    fixture.files.set(descriptorPath, JSON.stringify(descriptor));
    fixture.files.set(PIN, '{}');
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('protected snapshot storage');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('rejects a source change observed during capture without pinning mixed bytes', async () => {
    const read = fixture.VFS.read.getMockImplementation();
    fixture.VFS.read.mockImplementation(async (path) => {
      if (path === '/tools/CreateTool.js') fixture.files.set('/self/boot-spec.js', 'changed during capture');
      return read(path);
    });
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('source changed during capture');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('rejects changed source instead of replacing the existing pin or baseline', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    const original = fixture.files.get(baselinePath(meta.id));
    const pin = fixture.files.get(PIN);
    fixture.files.set('/core/tool-runner.js', 'changed');
    fixture.VFS.write.mockClear();
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('already pinned');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
    expect(fixture.files.get(baselinePath(meta.id))).toBe(original);
    expect(fixture.files.get(PIN)).toBe(pin);
  });

  it('validates corrupted stored bytes before reuse, export, or any recovery write', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    const payload = readJson(fixture.files, baselinePath(meta.id));
    payload.files['/self/core/tool-runner.js'] = 'corrupt';
    fixture.files.set(baselinePath(meta.id), JSON.stringify(payload));
    fixture.VFS.write.mockClear();
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow(/mismatch/);
    await expect(fixture.service.getPublicationBaseline()).rejects.toThrow(/mismatch/);
    await expect(fixture.service.exportPublicationBaseline()).rejects.toThrow(/mismatch/);
    await expect(fixture.service.restorePublicationBaseline()).rejects.toThrow(/mismatch/);
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('rejects coherently rehashed replacement bytes under the original pin', async () => {
    const first = await fixture.service.createPublicationBaseline();
    const other = makeService();
    other.files.set('/core/tool-runner.js', 'different valid bytes');
    await other.service.createPublicationBaseline();
    const replacement = await other.service.exportPublicationBaseline();
    fixture.files.set(baselinePath(first.id), JSON.stringify(replacement));
    fixture.VFS.write.mockClear();
    await expect(fixture.service.restorePublicationBaseline()).rejects.toThrow('identity');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
    replacement.id = first.id;
    await expect(validatePublicationBaseline(replacement)).rejects.toThrow('baseline hash mismatch');
  });

  it('rejects a corrupt pin or absent stored payload without falling back to live source', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    fixture.files.delete(baselinePath(meta.id));
    fixture.VFS.write.mockClear();
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('Missing VFS source');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
    fixture.files.set(PIN, '{"id":"invalid"}');
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('Invalid Genesis publication pin');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('does not replace a corrupt pre-existing content-addressed record', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    fixture.files.delete(PIN); // Simulate a failed pin write, not a supported API.
    fixture.files.set(baselinePath(meta.id), '{}');
    fixture.VFS.write.mockClear();
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow();
    expect(fixture.VFS.write).not.toHaveBeenCalled();
    expect(fixture.files.get(baselinePath(meta.id))).toBe('{}');
  });

  it('leaves a failed pin write recoverable without rewriting its saved payload', async () => {
    const write = fixture.VFS.write.getMockImplementation();
    fixture.VFS.write.mockImplementation(async (path, content) => {
      if (path === PIN) throw new Error('Pin storage failed');
      return write(path, content);
    });
    await expect(fixture.service.createPublicationBaseline()).rejects.toThrow('Pin storage failed');
    const savedPath = [...fixture.files.keys()].find((path) => path.startsWith('/.genesis/publication/genesis-sha256-'));
    const bytes = fixture.files.get(savedPath);
    expect(savedPath).toBeDefined();
    expect(fixture.files.has(PIN)).toBe(false);
    fixture.VFS.write.mockImplementation(write).mockClear();
    await fixture.service.createPublicationBaseline();
    expect(fixture.files.get(savedPath)).toBe(bytes);
    expect(fixture.VFS.write).toHaveBeenCalledTimes(1);
    expect(fixture.VFS.write.mock.calls[0][0]).toBe(PIN);
  });

  it('restores exact captured text to the declared VFS paths, preserving unrelated work', async () => {
    const original = new Map(fixture.files);
    const meta = await fixture.service.createPublicationBaseline();
    const descriptor = readJson(original, descriptorPath);
    for (const path of descriptor.seedFiles) fixture.files.set(`/${path}`, 'broken');
    fixture.files.delete('/self/kernel/boot.js');
    fixture.files.set('/self/tools/Added.js', 'keep installed user tool');
    expect(await fixture.service.restorePublicationBaseline()).toMatchObject({
      success: true, id: meta.id, restored: descriptor.files.length, deleted: 0
    });
    for (const path of descriptor.seedFiles) expect(fixture.files.get(`/${path}`)).toBe(original.get(`/${path}`));
    expect(fixture.files.get('/artifacts/user-work.txt')).toBe('preserve me');
    expect(fixture.files.get('/self/tools/Added.js')).toBe('keep installed user tool');
    expect(fixture.VFS.delete).not.toHaveBeenCalled();
  });

  it('fails visibly on unsuccessful recovery writes', async () => {
    await fixture.service.createPublicationBaseline();
    fixture.VFS.write.mockImplementation(async () => {});
    fixture.files.set('/self/boot-spec.js', 'corrupt');
    await expect(fixture.service.restorePublicationBaseline()).rejects.toThrow('recovery write mismatch');
    expect(fixture.deps.EventBus.emit).not.toHaveBeenCalledWith('genesis:publication_restored', expect.anything());
  });

  it('carries an explicit validated payload into an empty descendant for recovery', async () => {
    await fixture.service.createPublicationBaseline();
    const payload = await fixture.service.exportPublicationBaseline();
    const descendant = makeService(new Map());
    await expect(descendant.service.restorePublicationBaseline()).rejects.toThrow('No Genesis');
    const meta = await descendant.service.importPublicationBaseline(payload);
    const result = await descendant.service.restorePublicationBaseline();
    expect(result).toMatchObject({ success: true, id: meta.id });
    expect(descendant.files.get('/core/tool-runner.js')).toBe(fixture.files.get('/core/tool-runner.js'));
    payload.files['/self/core/tool-runner.js'] = 'mutated caller object';
    expect((await descendant.service.exportPublicationBaseline()).files['/self/core/tool-runner.js']).not.toBe('mutated caller object');
  });

  it('rejects a different imported baseline after pinning', async () => {
    await fixture.service.createPublicationBaseline();
    const other = makeService();
    other.files.set('/core/tool-runner.js', 'new release');
    await other.service.createPublicationBaseline();
    fixture.VFS.write.mockClear();
    await expect(fixture.service.importPublicationBaseline(await other.service.exportPublicationBaseline())).rejects.toThrow('already pinned');
    expect(fixture.VFS.write).not.toHaveBeenCalled();
  });

  it('fences concurrent captures through separate service/VFS adapters over one store', async () => {
    const second = GenesisSnapshot.factory({ ...fixture.deps, VFS: { ...fixture.VFS } });
    const results = await Promise.all([fixture.service.createPublicationBaseline(), second.createPublicationBaseline()]);
    expect(results[0].id).toBe(results[1].id);
    expect(fixture.VFS.write.mock.calls.filter(([path]) => path === PIN)).toHaveLength(1);
  });

  it('rejects a partial imported payload before any writes', async () => {
    await fixture.service.createPublicationBaseline();
    const payload = await fixture.service.exportPublicationBaseline();
    delete payload.files['/self/kernel/boot.js'];
    const destination = makeService(new Map());
    await expect(destination.service.importPublicationBaseline(payload)).rejects.toThrow('Missing text source');
    expect(destination.VFS.write).not.toHaveBeenCalled();
  });

  it('cannot overwrite, delete or target a baseline through legacy snapshot APIs', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    const before = new Map(fixture.files);
    await expect(fixture.service.deleteSnapshot(meta.id)).rejects.toThrow('immutable');
    await expect(fixture.service.restoreSnapshot(meta.id, { deleteExtra: true })).rejects.toThrow('immutable');
    await expect(fixture.service.importSnapshot(importFile({ id: meta.id, timestamp: 1, files: {} }))).rejects.toThrow('immutable');
    await expect(fixture.service.deleteSnapshot('../publication/pin')).rejects.toThrow('Invalid snapshot ID');
    await expect(fixture.service.importSnapshot(importFile({
      id: 'overwrite', timestamp: 1, files: { [PIN]: '{}' }
    }))).rejects.toThrow('protected snapshot restore path');
    fixture.files.set('/.genesis/snapshots/malicious.json', JSON.stringify({ files: { [baselinePath(meta.id)]: '{}' } }));
    await expect(fixture.service.restoreSnapshot('malicious')).rejects.toThrow('protected snapshot restore path');
    fixture.files.delete('/.genesis/snapshots/malicious.json');
    expect(fixture.files).toEqual(before);
  });

  it('keeps the baseline outside ordinary pruning and preserves it across deleteExtra recovery', async () => {
    const meta = await fixture.service.createPublicationBaseline();
    const bytes = fixture.files.get(baselinePath(meta.id));
    const pin = fixture.files.get(PIN);
    let newest;
    for (let index = 0; index < 12; index += 1) newest = await fixture.service.createSnapshot(`ordinary-${index}`);
    expect(await fixture.service.listSnapshots()).toHaveLength(10);
    await fixture.service.restoreSnapshot(newest.id, { deleteExtra: true });
    expect(fixture.files.get(baselinePath(meta.id))).toBe(bytes);
    expect(fixture.files.get(PIN)).toBe(pin);
    expect(await fixture.service.getPublicationBaseline()).toMatchObject({ id: meta.id });
  });

  it('refuses snapshot ID collisions rather than overwriting existing user snapshots', async () => {
    fixture.files.set('/.genesis/snapshots/snap_1.json', 'old user snapshot');
    await expect(fixture.service.createSnapshot('collision')).rejects.toThrow('already exists');
    await expect(fixture.service.importSnapshot(importFile({ id: 'snap_1', timestamp: 1, files: {} }))).rejects.toThrow('already exists');
    expect(fixture.files.get('/.genesis/snapshots/snap_1.json')).toBe('old user snapshot');
  });
});
