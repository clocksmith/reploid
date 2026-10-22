/* @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import ToolRunner from '../../self/core/tool-runner.js';
import { getCurrentReploidStorage } from '../../self/instance.js';
import { LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { setSecurityEnabled } from '../../self/core/security-config.js';
import * as WriteFile from '../../self/tools/WriteFile.js';
import * as EditFile from '../../self/tools/EditFile.js';
import * as LoadModule from '../../self/tools/LoadModule.js';
import * as Promote from '../../self/tools/Promote.js';

const capture = vi.hoisted(() => ({ deps: new Map() }));
vi.mock('../../self/core/vfs-module-loader.js', () => ({
  loadVfsModule: async ({ path }) => {
    const name = path.split('/').pop().replace('.js', '');
    const module = { WriteFile, EditFile, LoadModule, Promote }[name];
    if (!module) return { default: async () => 'installed tool' };
    return { ...module, default: async (args, deps) => {
      capture.deps.set(name, deps);
      return module.default(args, deps);
    } };
  }
}));

afterEach(() => {
  localStorage.clear();
  delete window.getReploidMode;
  capture.deps.clear();
  setSecurityEnabled(false, { persist: false });
});

it('runs explicitly upgraded built-ins with declared capabilities, not unrestricted host dependencies', async () => {
  window.getReploidMode = () => 'zero';
  getCurrentReploidStorage().setItem(LAB_UPGRADE_STORAGE_KEY, 'reflection');
  setSecurityEnabled(false, { persist: false });
  const files = new Map([
    ...['WriteFile', 'EditFile', 'LoadModule', 'Promote'].map(name => [`/tools/${name}.js`, '// loader fixture']),
    ['/self/tools/Installed.js', '// installed fixture']
  ]);
  const VFS = {
    read: vi.fn(async path => files.get(path)),
    write: vi.fn(async (path, value) => files.set(path, value)),
    exists: vi.fn(async path => files.has(path)),
    list: vi.fn(async prefix => [...files.keys()].filter(path => path.startsWith(prefix)))
  };
  const runner = ToolRunner.factory({
    Utils: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, Errors: { ToolError: Error }, trunc: String },
    VFS, Shell: {}, gitTools: {}, EventBus: { emit: vi.fn() },
    SchemaRegistry: { registerToolSchema: vi.fn(), unregisterToolSchema: vi.fn() }
  });
  await runner.init();
  expect(runner.list()).toEqual(expect.arrayContaining(['WriteFile', 'EditFile', 'LoadModule', 'Promote']));
  expect(runner.list()).not.toContain('git');
  await runner.execute('WriteFile', { path: '/artifacts/proof.txt', content: 'before' });
  expect(files.get('/artifacts/proof.txt')).toBe('before');
  await runner.execute('EditFile', { path: '/artifacts/proof.txt', operations: [{ match: 'before', replacement: 'after' }] });
  expect(files.get('/artifacts/proof.txt')).toBe('after');
  await runner.execute('LoadModule', { path: '/self/tools/Installed.js' });
  expect(runner.has('Installed')).toBe(true);
  const denied = await runner.execute('Promote', { candidatePath: '/shadow/missing.js', targetPath: '/self/tools/Missing.js' });
  expect(denied.promoted).not.toBe(true);
  for (const name of ['WriteFile', 'EditFile', 'LoadModule', 'Promote']) {
    const deps = capture.deps.get(name);
    expect(deps.Shell).toBeUndefined();
    expect(deps.gitTools).toBeUndefined();
  }
  expect(capture.deps.get('Promote').VFS.write).toBe(VFS.write);
  expect(capture.deps.get('Promote').ToolRunner.loadPath).toBeUndefined();
  expect(capture.deps.get('LoadModule').VFS.write).toBeUndefined();
  expect(capture.deps.get('LoadModule').ToolRunner.loadPath).toBeTypeOf('function');
  await expect(runner.execute('WriteFile', { path: '/self/core/unsafe.js', content: 'no' })).rejects.toThrow('not writable');
});
