/* @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import genesis from '../../self/config/genesis-levels.json' with { type: 'json' };
import registry from '../../self/config/module-registry.json' with { type: 'json' };

vi.mock('../../self/ui/boot-wizard/detection.js', () => ({
  runDetection: async () => {}, generateGoalPrompt: vi.fn()
}));
vi.mock('../../self/ui/boot-wizard/self-preview.js', () => ({ ensureSelfPreviewLoaded: vi.fn() }));
vi.mock('../../self/boot-helpers/vfs-bootstrap.js', () => ({
  loadVfsManifest: async () => ({ manifest: { files: [] } }),
  readVfsFile: vi.fn(), seedVfsFromManifest: vi.fn(), clearVfsStore: vi.fn()
}));

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  delete window.REPLOID_INSTANCE_ID;
  delete window.getReploidRouteMode;
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([
  ['zero', 'full', 'x'],
  ['x', 'spark', 'x'],
  ['reploid', 'spark', 'zero']
])('applies a new %s → %s selection through the retained wizard caller', async (mode, level, expectedMode) => {
  window.REPLOID_INSTANCE_ID = 'explicit-selection';
  window.getReploidRouteMode = () => null;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network expected'); }));
  const { getCurrentReploidStorage } = await import('../../self/instance.js');
  const { LAB_UPGRADE_STORAGE_KEY } = await import('../../self/config/lab-upgrades.js');
  const storage = getCurrentReploidStorage();
  localStorage.setItem(LAB_UPGRADE_STORAGE_KEY, 'cognition');
  storage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'reflection');
  const { setState, getState } = await import('../../self/ui/boot-wizard/state.js');
  const { initWizard } = await import('../../self/ui/boot-wizard/index.js');
  const { renderAwakenStep } = await import('../../self/ui/boot-wizard/steps/awaken.js');
  setState({ mode, routeLockedMode: null, goal: 'Keep this saved objective',
    moduleConfig: { genesis, registry }, advancedOpen: true });
  const container = document.createElement('div');
  document.body.append(container);
  initWizard(container);
  await vi.waitFor(() => expect(container.querySelector('.wizard-sections')).not.toBeNull());
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY, { legacyFallback: false })).toBeNull();
  // Use the real retained component and its production delegated event handler.
  container.innerHTML = renderAwakenStep(getState());
  const select = container.querySelector('#advanced-genesis-level');
  expect([...select.options].some(option => option.value === level)).toBe(true);
  select.value = level;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(getState().mode).toBe(expectedMode);
  expect(storage.getItem('REPLOID_MODE', { legacyFallback: false })).toBe(expectedMode);
  expect(storage.getItem(LAB_UPGRADE_STORAGE_KEY, { legacyFallback: false }))
    .toBe(expectedMode === 'x' ? level : null);
  expect(storage.getItem('REPLOID_ZERO_UPGRADE_LEVEL')).toBe('reflection');
  expect(localStorage.getItem(LAB_UPGRADE_STORAGE_KEY)).toBe('cognition');
  expect(getState().goal).toBe('Keep this saved objective');
  expect(fetch).not.toHaveBeenCalled();
});
