import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSelfSource } from '../../scripts/build-self-source.js';
import { getLabUpgradeLevel, isMinimalLabMode, LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { getBootSourceManifest, getOptionalBootSource, pickBootSeedFiles } from '../../self/config/boot-seed.js';
import { createScopedReploidStorage, getCurrentReploidStorage } from '../../self/instance.js';
import { resetSession } from '../../self/boot-helpers/vfs-hydrate.js';
import { filterToolDepsForTool } from '../../self/core/tool-runner.js';
import { buildAgentInitialContext } from '../../self/core/agent-context.js';
import vfsManifest from '../../self/config/vfs-manifest.json' with { type: 'json' };

const memory = values => ({ getItem: key => values[key] ?? null });

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('minimal self-source boundary', () => {
  it('includes the transitive source closure and rejects a missing import', async () => {
    const files = { 'kernel.js': "import './loop.js';", 'loop.js': "export * from './tools/create.js';", 'tools/create.js': 'export const create = () => true;' };
    const read = async file => { if (!(file in files)) throw new Error(`Missing ${file}`); return files[file]; };
    expect(await collectSelfSource(['kernel.js'], read)).toEqual(['kernel.js', 'loop.js', 'tools/create.js']);
    delete files['tools/create.js'];
    await expect(collectSelfSource(['kernel.js'], read)).rejects.toThrow('Missing tools/create.js');
  });

  it('keeps Zero minimal and accepts only valid explicit X upgrade selections', () => {
    expect(getLabUpgradeLevel('zero', memory({ [LAB_UPGRADE_STORAGE_KEY]: 'full' }))).toBe('spark');
    expect(getLabUpgradeLevel('x', memory({ [LAB_UPGRADE_STORAGE_KEY]: 'full' }))).toBe('full');
    expect(getLabUpgradeLevel('x', memory({ [LAB_UPGRADE_STORAGE_KEY]: 'unknown' }))).toBe('spark');
  });

  it('never inherits an old Zero choice or another instance global preference', () => {
    localStorage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'full');
    localStorage.setItem(LAB_UPGRADE_STORAGE_KEY, 'full');
    const storage = createScopedReploidStorage(localStorage, 'new-x');
    storage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'cognition');
    expect(getLabUpgradeLevel('x', storage)).toBe('spark');
    storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'reflection');
    expect(getLabUpgradeLevel('x', storage)).toBe('reflection');
    expect(getLabUpgradeLevel('x', createScopedReploidStorage(localStorage, 'other-x'))).toBe('spark');
    expect(storage.getItem('REPLOID_ZERO_UPGRADE_LEVEL')).toBe('cognition');
    expect(localStorage.getItem('REPLOID_ZERO_UPGRADE_LEVEL')).toBe('full');
  });

  it('resumes an exported upgrade only when its source descriptor explicitly binds X', () => {
    const storage = memory({});
    expect(getLabUpgradeLevel('x', storage, { level: 'full' })).toBe('spark');
    expect(getLabUpgradeLevel('x', storage, { level: 'full', surface: 'zero' })).toBe('spark');
    expect(getLabUpgradeLevel('x', storage, { level: 'full', surface: 'x' })).toBe('full');
    expect(getLabUpgradeLevel('zero', storage, { level: 'full', surface: 'x' })).toBe('spark');
    expect(getLabUpgradeLevel('x', storage, { level: 'unknown', surface: 'x' })).toBe('spark');
    expect(getLabUpgradeLevel('x', memory({ [LAB_UPGRADE_STORAGE_KEY]: 'spark' }),
      { level: 'full', surface: 'x' })).toBe('spark');
  });

  it('adds optional source only after an explicit X upgrade selection', () => {
    const base = pickBootSeedFiles(vfsManifest.files, 'zero_home');
    expect(pickBootSeedFiles(vfsManifest.files, 'x_home')).toEqual(base);
    getCurrentReploidStorage().setItem(LAB_UPGRADE_STORAGE_KEY, 'full');
    const upgraded = pickBootSeedFiles(vfsManifest.files, 'x_home');
    expect(upgraded).toContain('tools/Promote.js');
    expect(upgraded).toContain('core/worker-manager.js');
    expect(upgraded.length).toBeGreaterThan(base.length);
    expect(upgraded.length).toBeLessThan(vfsManifest.files.length);
    expect(pickBootSeedFiles(vfsManifest.files, 'zero_home')).toEqual(base);
    expect(isMinimalLabMode('zero')).toBe(true);
    expect(isMinimalLabMode('x')).toBe(false);
    expect(upgraded).not.toContain('tools/git.js');
  });

  it('keeps optional local inference source outside the base image', () => {
    expect(getBootSourceManifest('x_home').files).not.toContain('providers/doppler-reploid.js');
    expect(getOptionalBootSource('doppler').files).toContain('providers/doppler-reploid.js');
    expect(getOptionalBootSource('unknown')).toBeNull();
  });

  it.each(['zero', 'x'])('does not expand %s tool authority when X upgrades are selected', mode => {
    getCurrentReploidStorage().setItem(LAB_UPGRADE_STORAGE_KEY, 'full');
    const deps = { Shell: {}, gitTools: {}, VFS: { read: vi.fn(), write: vi.fn() }, ToolRunner: { load: vi.fn() } };
    const scoped = filterToolDepsForTool(deps, mode, 'CreatedReader');
    expect(scoped.Shell).toBeUndefined();
    expect(scoped.gitTools).toBeUndefined();
    expect(scoped.VFS.write).toBeUndefined();
    expect(scoped.ToolRunner.load).toBeUndefined();
  });

  it('fails closed when a declared source dependency is absent', () => {
    const source = getBootSourceManifest('x_home');
    const incomplete = vfsManifest.files.filter(file => file !== 'tools/CreateTool.js');
    expect(source.files).toContain('tools/CreateTool.js');
    expect(() => pickBootSeedFiles(incomplete, 'x_home')).toThrow('tools/CreateTool.js');
  });

  it('does not delete persisted tools or UI on an ordinary warm start', async () => {
    const vfs = { read: vi.fn(), list: vi.fn(), delete: vi.fn() };
    await resetSession(vfs, {}, 'spark', { info: vi.fn(), warn: vi.fn() });
    expect(vfs.list).not.toHaveBeenCalled();
    expect(vfs.delete).not.toHaveBeenCalled();
  });

  it.each(['zero', 'x'])('tells minimal %s to grow from CreateTool rather than assuming preinstalled file tools', mode => {
    const context = buildAgentInitialContext({ goal: 'Inspect yourself', personaPrompt: '', runtimeMode: mode });
    expect(context[0].content).toContain(`You are ${mode === 'x' ? 'X' : 'Zero'},`);
    expect(context[0].content).toContain('CreateTool');
    expect(context[0].content).toContain('First create a directory-aware reader/lister');
    expect(context[0].content).not.toContain('- ListTools:');
  });
});
