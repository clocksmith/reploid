/* @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import catalog from '../../self/config/self-source-catalog.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../self/instance.js';

const fixture = vi.hoisted(() => ({ files: new Map(), seed: vi.fn(), write: vi.fn() }));
vi.mock('../../self/host/vfs-bootstrap.js', () => ({
  loadVfsManifest: async () => ({ manifest: { files: catalog.profiles.spark.seedFiles }, text: '{}' }),
  readVfsFile: async path => fixture.files.get(path) ?? null,
  writeVfsFile: async (path, text) => {
    fixture.write(path, text);
    fixture.files.set(path, text);
  },
  seedVfsFromManifest: async ({ files }, options) => {
    fixture.seed(files, options);
    expect(options.preserveOnBoot).toBe(true);
    for (const path of files) {
      if (!fixture.files.has(`/${path}`)) fixture.files.set(`/${path}`,
        path === 'config/self-source-manifest.json' ? JSON.stringify(catalog.profiles.spark) : 'seed source');
    }
  },
  ensureVfsFileMirrors: vi.fn(),
  clearVfsStore: vi.fn(() => { throw new Error('Unexpected reset'); }),
  pruneVfsStoreToPaths: vi.fn(() => { throw new Error('Unexpected pruning'); })
}));

const sourcePath = '/config/self-source-manifest.json';
const boot = async mode => {
  window.getReploidMode = () => mode;
  window.getReploidBootProfile = () => `${mode}_home`;
  window.REPLOID_INSTANCE_ID = `seed-${mode}`;
  window.REPLOID_VFS_VERSION = 'roles-test';
  vi.stubGlobal('navigator', {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Exercise the real host hydration entry. Starting the app is outside this
  // unit boundary: its absolute browser import cannot resolve in this harness.
  await import('../../self/host/seed-vfs.js');
  await vi.waitFor(() => expect(getCurrentReploidStorage().getItem(
    `REPLOID_BOOT_SEED_READY:${mode}_home:roles-test`
  )).toBe('true'));
  await vi.waitFor(() => expect(window.REPLOID_BOOTSTRAP_STAGE)
    .toMatch(/^(?:ready|error:)/));
};

afterEach(() => {
  fixture.files.clear();
  fixture.seed.mockClear();
  fixture.write.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  for (const key of ['getReploidMode', 'getReploidBootProfile', 'REPLOID_INSTANCE_ID',
    'REPLOID_VFS_VERSION', 'REPLOID_BOOTSTRAP_STAGE', 'REPLOID_VFS_FULL_SEED_PROMISE']) delete window[key];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each(['zero', 'x'])('stamps a genuinely fresh %s descriptor after stock source hydration', async mode => {
  fixture.files.set('/notes/keep.txt', 'Owned note');
  await boot(mode);
  expect(fixture.seed).toHaveBeenCalledOnce();
  expect(JSON.parse(fixture.files.get(sourcePath))).toMatchObject({ surface: mode, level: 'spark' });
  expect(fixture.write).toHaveBeenCalledOnce();
  expect(fixture.files.get('/notes/keep.txt')).toBe('Owned note');
});

it.each([false, true])('preserves returning legacy source byte-for-byte (warm: %s)', async warm => {
  const legacy = JSON.stringify({ ...catalog.profiles.reflection, note: 'Owned legacy descriptor' }, null, 2);
  for (const path of catalog.profiles.spark.seedFiles) fixture.files.set(`/${path}`, 'owned source');
  fixture.files.set(sourcePath, legacy);
  fixture.files.set('/notes/keep.txt', 'Owned note');
  if (warm) {
    window.REPLOID_INSTANCE_ID = 'seed-zero';
    const storage = getCurrentReploidStorage();
    storage.setItem('REPLOID_VFS_VERSION', 'roles-test');
    storage.setItem('REPLOID_BOOT_SEED_READY:zero_home:roles-test', 'true');
  }
  const before = [...fixture.files];
  await boot('zero');
  expect(fixture.seed).toHaveBeenCalledTimes(warm ? 0 : 1);
  expect(fixture.write).not.toHaveBeenCalled();
  expect([...fixture.files]).toEqual(before);
});
