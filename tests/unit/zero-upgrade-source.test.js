/* @vitest-environment happy-dom */
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import manifest from '../../self/config/vfs-manifest.json' with { type: 'json' };
import catalog from '../../self/config/self-source-catalog.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../self/instance.js';
import { LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { pickBootSeedFiles } from '../../self/config/boot-seed.js';
import { exportSelfImage, validateSelfImageExport } from '../../self/image/export.js';

const fixture = vi.hoisted(() => ({ files: new Map(), seed: null, available: null, seedError: null, seedAttempts: 0 }));
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
  writeVfsFile: async (path, text) => fixture.files.set(path, text)
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
  vi.restoreAllMocks();
});

it('explicit Zero upgrade preserves live bytes and exports the newly selected closure', async () => {
  window.getReploidMode = () => 'zero';
  window.getReploidBootProfile = () => 'zero_home';
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
  window.getReploidMode = () => 'zero';
  window.getReploidBootProfile = () => 'zero_home';
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
  expect(pickBootSeedFiles(catalog.profiles.spark.seedFiles, 'zero_home')).toEqual(catalog.profiles.spark.seedFiles);
  initZeroBootHome(root);
  expect(root.querySelector('#zero-upgrade-level').value).toBe('spark');
});
