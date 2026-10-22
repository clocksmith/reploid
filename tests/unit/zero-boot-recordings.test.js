/* @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { createRunTraceRecorder } from '../../self/infrastructure/telemetry-timeline.js';

const saved = vi.hoisted(() => ({ files: new Map(), reads: vi.fn(), lists: vi.fn() }));
vi.mock('../../self/boot-helpers/vfs-bootstrap.js', async importOriginal => ({
  ...await importOriginal(),
  readVfsFile: async path => { saved.reads(path); return saved.files.get(path); },
  listVfsKeys: async () => { saved.lists(); return [...saved.files.keys()]; }
}));
import { initZeroBootHome } from '../../self/ui/zero-home/index.js';
import { getCurrentReploidStorage } from '../../self/instance.js';

afterEach(() => { saved.files.clear(); saved.reads.mockClear(); saved.lists.mockClear(); window.dispatchEvent(new Event('pagehide')); localStorage.clear(); document.body.innerHTML = ''; delete window.triggerAwaken; delete window.getReploidMode; vi.restoreAllMocks(); });

it('imports and plays a recording before awakening without provider, goal, storage or tool effects', async () => {
  window.getReploidMode = () => 'x';
  window.triggerAwaken = vi.fn();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Keep this live goal');
  storage.setItem('SELECTED_MODELS', JSON.stringify([{ id: 'keep-provider', provider: 'existing' }]));
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home'); initZeroBootHome(root);
  const disclosure = root.querySelector('[data-boot-recordings]');
  expect(disclosure.open).toBe(false); disclosure.open = true;
  const input = root.querySelector('[data-replay-import]');
  const trace = { schema: 'reploid.run-trace.v1', startedAt: 1000, droppedEvents: 0, provenance: {}, events: [
    { seq: 0, ts: 1000, type: 'model_text', data: { content: 'Recorded generated text' } },
    { seq: 1, ts: 1000, type: 'tool_call', data: { callId: 'c1', tool: 'CreateTool', args: { code: 'throw new Error("must never execute")' } } },
    { seq: 2, ts: 1000, type: 'tool_result', data: { callId: 'c1', tool: 'CreateTool', result: 'recorded result' } }
  ] };
  Object.defineProperty(input, 'files', { value: [{ size: 1000, text: async () => JSON.stringify(trace) }] });
  input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve();
  root.querySelector('[data-replay-action="play"]').click();
  expect(root.querySelector('[data-replay-events]').textContent).toContain('Recorded generated text');
  expect(root.querySelector('[data-replay-status]').textContent).toContain('3/3');
  expect(window.triggerAwaken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(storage.getItem('REPLOID_GOAL')).toBe('Keep this live goal');
  expect(JSON.parse(storage.getItem('SELECTED_MODELS'))[0].id).toBe('keep-provider');
  // An unrelated boot rerender preserves recording position and disclosure state.
  root.querySelector('[data-action="choose-proxy"]').click();
  await vi.waitFor(() => expect(root.querySelector('[data-boot-recordings]')).toBe(disclosure));
  expect(root.querySelector('[data-replay-status]').textContent).toContain('3/3');
  expect(disclosure.open).toBe(true);
  vi.unstubAllGlobals();
});


it('reopens a saved recording at fresh boot with exact text/results and no model, tool, goal or provider effects', async () => {
  const VFS = { list: async () => [...saved.files.keys()], read: async path => saved.files.get(path),
    write: vi.fn(async (path, text) => { saved.files.set(path, text); }) };
  const recorder = createRunTraceRecorder({ VFS, withLock: action => action(), now: () => 1000 });
  recorder.record('model_text', { content: 'Recorded benign text\n  exact spacing.' });
  recorder.record('tool_call', { callId: 'c1', tool: 'ReadFile', args: { path: '/synthetic.txt' } });
  recorder.record('tool_result', { callId: 'c1', tool: 'ReadFile', result: 'Saved result\nwith details.' });
  await recorder.close();
  const savedFiles = [...saved.files]; VFS.write.mockClear();
  window.getReploidMode = () => 'x'; window.triggerAwaken = vi.fn();
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const storage = getCurrentReploidStorage();
  storage.setItem('REPLOID_GOAL', 'Do not replace');
  storage.setItem('SELECTED_MODELS', '[{"id":"unchanged","provider":"offline"}]');
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home'); initZeroBootHome(root);
  root.querySelector('[data-replay-action="refresh-saved"]').click();
  await vi.waitFor(() => expect(root.querySelector('[data-replay-saved]').options).toHaveLength(1));
  root.querySelector('[data-replay-action="load-saved"]').click();
  await vi.waitFor(() => expect(root.querySelector('[data-replay-error]').textContent).toContain('Saved recording loaded'));
  root.querySelector('[data-replay-action="play"]').click();
  const content = root.querySelector('[data-replay-events]').textContent;
  expect(content).toContain('Recorded benign text'); expect(content).toContain('Saved result'); expect(content).toContain('/synthetic.txt');
  expect(window.triggerAwaken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(VFS.write).not.toHaveBeenCalled();
  expect([...saved.files]).toEqual(savedFiles);
  expect(storage.getItem('REPLOID_GOAL')).toBe('Do not replace');
  expect(storage.getItem('SELECTED_MODELS')).toBe('[{"id":"unchanged","provider":"offline"}]');
  vi.unstubAllGlobals();
});


it('remounts live recording handlers when the same boot container is initialized again', async () => {
  window.getReploidMode = () => 'x'; window.triggerAwaken = vi.fn();
  document.body.innerHTML = '<main id="home"></main>';
  const root = document.querySelector('#home'); initZeroBootHome(root);
  const stale = root.querySelector('[data-boot-recordings]'); stale.open = true;
  initZeroBootHome(root);
  expect(root.querySelector('[data-boot-recordings]')).not.toBe(stale);
  expect(root.querySelector('[data-boot-recordings]').open).toBe(false);
  const trace = { schema: 'reploid.run-trace.v1', startedAt: 1000, droppedEvents: 0, provenance: {}, events: [
    { seq: 0, ts: 1000, type: 'model_text', data: { content: 'Handlers are live after reinitialization.' } }
  ] };
  saved.files.set('/.logs/recordings/1000-reinit.json', JSON.stringify(trace));
  root.querySelector('[data-replay-action="refresh-saved"]').click();
  await vi.waitFor(() => expect(root.querySelector('[data-replay-saved]').options).toHaveLength(1));
  root.querySelector('[data-replay-action="load-saved"]').click();
  await vi.waitFor(() => expect(root.querySelector('[data-replay-error]').textContent).toContain('Saved recording loaded'));
  root.querySelector('[data-replay-action="step"]').click();
  expect(root.querySelector('[data-replay-events]').textContent).toContain('Handlers are live after reinitialization.');
  expect(root.querySelector('[data-replay-status]').textContent).toContain('1/1');
  expect(window.triggerAwaken).not.toHaveBeenCalled();
});
