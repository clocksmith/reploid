/* @vitest-environment happy-dom */
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import manifest from '../../self/config/vfs-manifest.json' with { type: 'json' };
import catalog from '../../self/config/self-source-catalog.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../self/instance.js';
import { LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { pickBootSeedFiles } from '../../self/config/boot-seed.js';
import { exportSelfImage, validateSelfImageExport } from '../../self/image/export.js';

const fixture = vi.hoisted(() => ({ files: new Map(), seed: null, available: null, seedError: null, seedAttempts: 0, failNextWritePath: null }));
vi.mock('../../self/boot-helpers/vfs-bootstrap.js', () => ({
  loadVfsManifest: async () => ({ manifest: fixture.available || manifest }),
  seedVfsFromManifest: async (selected, options) => {
    expect(options.preserveOnBoot).toBe(true);
    fixture.seedAttempts++;
    if (fixture.seedError) throw fixture.seedError;
    fixture.seed = selected.files;
    for (const file of selected.files) {
      if (!fixture.files.has(`/${file}`)) {
        const source = file.replace(/^self\//, '');
        fixture.files.set(`/${file}`, await readFile(`${process.cwd()}/self/${source}`, 'utf8'));
      }
    }
  },
  readVfsFile: async path => fixture.files.get(path) ?? null,
  deleteVfsFile: async path => fixture.files.delete(path),
  writeVfsFile: async (path, text) => {
    if (fixture.failNextWritePath === path) {
      fixture.failNextWritePath = null;
      throw new Error('Selection manifest write failed');
    }
    fixture.files.set(path, text);
  }
}));
import { initZeroBootHome } from '../../self/ui/zero-home/index.js';

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  delete window.getReploidMode;
  delete window.getReploidBootProfile;
  delete window.triggerAwaken;
  fixture.files.clear();
  fixture.seed = null;
  fixture.available = null;
  fixture.seedError = null;
  fixture.seedAttempts = 0;
  fixture.failNextWritePath = null;
  vi.restoreAllMocks();
});

it('explicit X upgrade preserves live bytes and exports the newly selected closure', async () => {
  window.getReploidMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  window.triggerAwaken = vi.fn();
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Inspect the selected source');
  storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'spark');
  fixture.files.set('/config/self-source-manifest.json', JSON.stringify(catalog.profiles.spark));
  fixture.files.set('/notes/keep.txt', 'User work must stay');
  const originalUtils = await readFile(`${process.cwd()}/self/core/utils.js`, 'utf8');
  const ownedUtils = `// Existing instance edit.\n${originalUtils}`;
  fixture.files.set('/core/utils.js', ownedUtils);
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home');
  initZeroBootHome(root);
  const selection = root.querySelector('#zero-upgrade-level');
  selection.value = 'reflection';
  selection.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('[data-action="awaken"]').click();
  await vi.waitFor(() => expect(window.triggerAwaken).toHaveBeenCalledOnce());
  const active = JSON.parse(fixture.files.get('/config/self-source-manifest.json'));
  expect(active.level).toBe('reflection');
  expect(active.surface).toBe('x');
  expect(fixture.seed).toEqual(catalog.profiles.reflection.seedFiles);
  expect(active.files).toContain('tools/Promote.js');
  expect(fixture.files.get('/notes/keep.txt')).toBe('User work must stay');
  expect(fixture.files.get('/core/utils.js')).toBe(ownedUtils);

  const image = await exportSelfImage({}, {
    readFile: async ({ path }) => ({ content: fixture.files.get(path) }),
    VFS: { list: async () => [] }
  });
  await expect(validateSelfImageExport(image)).resolves.toBeTruthy();
  const exported = JSON.parse(image.files['/self/config/self-source-manifest.json']);
  const exportedCatalog = JSON.parse(image.files['/self/config/self-source-catalog.json']);
  expect(exportedCatalog.profiles.reflection).toEqual(exported);
  expect(image.files['/self/core/utils.js']).toBe(ownedUtils);
  expect(image.files['/self/notes/keep.txt']).toBeUndefined();
});

it.each([
  ['missing source', null, false],
  ['missing source', 'spark', false],
  ['fetch failure', null, false],
  ['fetch failure', 'spark', false],
  ['fetch failure', 'spark', true]
])('preserves the bootable selection after %s with previous level %s (repeat: %s)', async (failure, previous, repeat) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.getReploidMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  window.triggerAwaken = vi.fn();
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Inspect the selected source');
  if (previous !== null) {
    storage.setItem(LAB_UPGRADE_STORAGE_KEY, previous);
    storage.setItem('REPLOID_GENESIS_LEVEL', previous);
  }
  const originalSource = JSON.stringify(catalog.profiles.spark);
  fixture.files.set('/config/self-source-manifest.json', originalSource);
  fixture.files.set('/notes/keep.txt', 'User work must stay');
  if (failure === 'missing source') {
    fixture.available = { files: catalog.profiles.spark.seedFiles };
  } else {
    fixture.seedError = new Error('Upgrade source fetch failed');
  }
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home');
  initZeroBootHome(root);
  const selection = root.querySelector('#zero-upgrade-level');
  selection.value = 'reflection';
  selection.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('[data-action="awaken"]').click();
  if (repeat) root.querySelector('[data-action="awaken"]').click();
  const message = failure === 'missing source' ? 'Self-source image is incomplete' : 'Upgrade source fetch failed';
  await vi.waitFor(() => expect(root.textContent).toContain(message));
  expect(window.triggerAwaken).not.toHaveBeenCalled();
  expect(fixture.seedAttempts).toBe(failure === 'missing source' ? 0 : 1);
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBe(previous);
  expect(storage.getItem('REPLOID_GENESIS_LEVEL')).toBe(previous);
  expect(fixture.files.get('/config/self-source-manifest.json')).toBe(originalSource);
  expect(fixture.files.get('/notes/keep.txt')).toBe('User work must stay');
  expect(pickBootSeedFiles(catalog.profiles.spark.seedFiles, 'x_home')).toEqual(catalog.profiles.spark.seedFiles);
  initZeroBootHome(root);
  expect(root.querySelector('#zero-upgrade-level').value).toBe('spark');
});


it('keeps Zero minimal and leaves legacy and X upgrade settings untouched', async () => {
  window.getReploidMode = () => 'zero';
  window.getReploidBootProfile = () => 'zero_home';
  window.triggerAwaken = vi.fn();
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Start the minimal Zero baseline');
  storage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'full');
  storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'reflection');
  fixture.files.set('/notes/keep.txt', 'Owned work');
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home');
  initZeroBootHome(root);
  expect(root.querySelector('#zero-upgrade-level')).toBeNull();
  root.querySelector('[data-action="awaken"]').click();
  await vi.waitFor(() => expect(window.triggerAwaken).toHaveBeenCalledOnce());
  expect(JSON.parse(fixture.files.get('/config/self-source-manifest.json')))
    .toMatchObject({ level: 'spark', surface: 'zero' });
  expect(fixture.seed).toEqual(catalog.profiles.spark.seedFiles);
  expect(fixture.seed).not.toContain('tools/Promote.js');
  expect(storage.getItem('REPLOID_ZERO_UPGRADE_LEVEL')).toBe('full');
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBe('reflection');
  expect(fixture.files.get('/notes/keep.txt')).toBe('Owned work');
});

it('opening the current X form neither migrates old source nor transfers a Zero upgrade', () => {
  window.getReploidMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  window.triggerAwaken = vi.fn();
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Inspect without awakening');
  storage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'full');
  const legacy = JSON.stringify(catalog.profiles.reflection);
  fixture.files.set('/config/self-source-manifest.json', legacy);
  fixture.files.set('/notes/keep.txt', 'Owned work');
  const before = [...fixture.files];
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home');
  initZeroBootHome(root);
  expect(root.querySelector('#zero-upgrade-level').value).toBe('spark');
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBeNull();
  expect(storage.getItem('REPLOID_ZERO_UPGRADE_LEVEL')).toBe('full');
  expect([...fixture.files]).toEqual(before);
  expect(fixture.seedAttempts).toBe(0);
  expect(window.triggerAwaken).not.toHaveBeenCalled();
});

it.each([
  ['manifest write', true], ['activation', true], ['activation', false]
])('restores selection metadata after late %s failure (existing metadata: %s)', async (failure, existing) => {
  window.getReploidMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  window.triggerAwaken = failure === 'activation'
    ? vi.fn(async () => { throw new Error('Activation failed'); }) : vi.fn();
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Keep the prior working source');
  storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'spark');
  storage.setItem('REPLOID_GENESIS_LEVEL', 'spark');
  const originalSource = JSON.stringify(catalog.profiles.spark);
  const originalManifest = JSON.stringify({ version: 1, files: catalog.profiles.spark.seedFiles });
  if (existing) {
    fixture.files.set('/config/self-source-manifest.json', originalSource);
    fixture.files.set('/config/vfs-manifest.json', originalManifest);
  }
  fixture.files.set('/notes/keep.txt', 'Owned work');
  if (failure === 'manifest write') fixture.failNextWritePath = '/config/vfs-manifest.json';
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home');
  initZeroBootHome(root);
  root.querySelector('#zero-upgrade-level').value = 'reflection';
  root.querySelector('#zero-upgrade-level').dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('[data-action="awaken"]').click();
  await vi.waitFor(() => expect(root.textContent).toContain(
    failure === 'activation' ? 'Activation failed' : 'Selection manifest write failed'));
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBe('spark');
  expect(storage.getItem('REPLOID_GENESIS_LEVEL')).toBe('spark');
  expect(fixture.files.get('/config/self-source-manifest.json')).toBe(existing ? originalSource : undefined);
  expect(fixture.files.get('/config/vfs-manifest.json')).toBe(existing ? originalManifest : undefined);
  expect(fixture.files.get('/notes/keep.txt')).toBe('Owned work');
  expect(fixture.seedAttempts).toBe(1);
  expect(fixture.files.has('/tools/Promote.js')).toBe(true); // Retained, not selected or executed.
  expect(window.triggerAwaken).toHaveBeenCalledTimes(failure === 'activation' ? 1 : 0);
});

it.each(['boot', 'completion', 'mounted'])('rolls back a real host catch-to-caller %s failure and revokes partial tools', async phase => {
  window.getReploidMode = () => 'x';
  window.getReploidBootProfile = () => 'x_home';
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Preserve the previous working selection');
  storage.setItem(LAB_UPGRADE_STORAGE_KEY, 'spark');
  storage.setItem('REPLOID_GENESIS_LEVEL', 'spark');
  const originalSource = JSON.stringify(catalog.profiles.spark);
  const originalManifest = JSON.stringify({ version: 1, files: catalog.profiles.spark.seedFiles });
  fixture.files.set('/config/self-source-manifest.json', originalSource);
  fixture.files.set('/config/vfs-manifest.json', originalManifest);
  fixture.files.set('/notes/keep.txt', 'Owned work');
  const executeTool = vi.fn(async () => 'must not execute');
  const close = vi.fn(async () => {});
  const previousRuntime = { agent: { close: vi.fn() } };
  const previousDi = { prior: true };
  const ui = { mount: vi.fn(), cleanup: vi.fn(), setModels: vi.fn() };
  const cssLoadingDisabled = window.happyDOM.settings.disableCSSFileLoading;
  window.happyDOM.settings.disableCSSFileLoading = true;
  const listeners = new Map();
  const eventBus = {
    on: (type, handler) => {
      listeners.set(type, handler);
      return () => {
        listeners.delete(type);
        if (type === 'vfs:file_changed') throw new Error('Unsubscribe fixture failure');
      };
    },
    emit: (type, data) => listeners.get(type)?.(data)
  };
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  const runtimeUrl = new URL('/ui/zero/index.js?v=1700000000000', window.location.origin).href;
  vi.doMock(runtimeUrl, () => ({ default: { factory: () => ui } }));
  window.REPLOID_UI_VERSION = 'previous';
  window.REPLOID = previousRuntime;
  window.REPLOID_DI = previousDi;
  let runner, container;
  vi.doMock('../../self/core/vfs-module-loader.js', () => ({
    loadVfsModule: async () => ({ default: executeTool, capabilities: [] })
  }));
  vi.doMock('../../self/boot-helpers/index.js', async () => ({
    renderErrorUI: (await import('../../self/boot-helpers/error-ui.js')).renderErrorUI,
    boot: async (_Utils, DIContainer) => {
      const { default: ToolRunner } = await import('../../self/core/tool-runner.js');
      runner = ToolRunner.factory({
        Utils: { logger: { debug() {}, info() {}, warn() {}, error() {} }, Errors: { ToolError: Error }, trunc: String },
        VFS: { read: async () => '// tool fixture', exists: async () => true },
        SchemaRegistry: { registerToolSchema() {}, unregisterToolSchema() {} },
        EventBus: { emit() {} }
      });
      await runner.loadPath('/self/tools/Partial.js', 'Partial', { allow: true });
      expect(runner.has('Partial')).toBe(true);
      container = DIContainer.factory({ Utils: { logger: { info() {}, warn() {} } } });
      container.register({ metadata: { id: 'ToolRunner' }, factory: () => runner });
      container.register({ metadata: { id: 'AgentLoop' }, factory: () => ({ close,
        setModels() {
          eventBus.emit('vfs:file_changed', { path: '/ui/zero/index.js' });
          throw new Error('Mounted activation failed');
        }
      }) });
      if (phase === 'mounted') {
        storage.setItem('SELECTED_MODELS', JSON.stringify([{ id: 'fixture', provider: 'external' }]));
        container.register({ metadata: { id: 'EventBus' }, factory: () => eventBus });
        container.register({ metadata: { id: 'StateManager' }, factory: () => ({}) });
      }
      await container.resolve('ToolRunner');
      const agent = await container.resolve('AgentLoop');
      window.REPLOID = { toolRunner: runner, agent, container };
      window.REPLOID_DI = { resolve: container.resolve };
      if (phase === 'boot') throw new Error('Selected boot failed');
      // The real completion path fails on its required EventBus resolution.
      return { agent, container, vfs: {}, genesisConfig: {} };
    }
  }));
  document.body.innerHTML = '<main id="home"></main><main id="app"></main>';
  try {
    await import('../../self/host/start-app.js');
    await vi.waitFor(() => expect(window.triggerAwaken).toBeTypeOf('function'));
    const root = document.querySelector('#home');
    initZeroBootHome(root);
    root.querySelector('#zero-upgrade-level').value = 'reflection';
    root.querySelector('#zero-upgrade-level').dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('[data-action="awaken"]').click();
    await vi.waitFor(() => expect(document.querySelector('.error-ui-message')?.textContent)
      .toContain({ boot: 'Selected boot failed', completion: 'Module not found: EventBus', mounted: 'Mounted activation failed' }[phase]));
    await vi.waitFor(() => expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBe('spark'));
    expect(storage.getItem('REPLOID_GENESIS_LEVEL')).toBe('spark');
    expect(fixture.files.get('/config/self-source-manifest.json')).toBe(originalSource);
    expect(fixture.files.get('/config/vfs-manifest.json')).toBe(originalManifest);
    expect(fixture.files.get('/notes/keep.txt')).toBe('Owned work');
    expect(runner.list()).toEqual([]);
    await expect(runner.execute('Partial')).rejects.toThrow('disposed');
    await expect(runner.execute('CreateTool')).rejects.toThrow('disposed');
    await expect(runner.refresh()).rejects.toThrow('disposed');
    expect(executeTool).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(container.hasInstance('ToolRunner')).toBe(false);
    expect(container.hasInstance('AgentLoop')).toBe(false);
    expect(window.REPLOID).toBe(previousRuntime);
    expect(window.REPLOID_DI).toBe(previousDi);
    expect(previousRuntime.agent.close).not.toHaveBeenCalled();
    expect(window.REPLOID_UI_VERSION).toBe('previous');
    if (phase === 'mounted') {
      expect(ui.mount).toHaveBeenCalledOnce();
      expect(ui.cleanup).toHaveBeenCalledOnce();
      expect(listeners.size).toBe(0);
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(ui.mount).toHaveBeenCalledOnce();
    }
  } finally {
    for (const key of ['REPLOID', 'REPLOID_DI', 'preloadReploidModules', 'rotateReploidIdentity']) delete window[key];
    window.happyDOM.settings.disableCSSFileLoading = cssLoadingDisabled;
    document.getElementById('runtime-ui-stylesheet')?.remove();
    vi.doUnmock(runtimeUrl);
    delete window.REPLOID_UI_VERSION;
    vi.doUnmock('../../self/core/vfs-module-loader.js');
    vi.doUnmock('../../self/boot-helpers/index.js');
    vi.resetModules();
  }
});
