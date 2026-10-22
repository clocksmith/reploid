import { describe, expect, it, vi } from 'vitest';
import { RUN_TRACE_SCHEMA, RUN_TRACE_LIMITS, importRunTrace, validateRunTrace } from '../../self/core/run-replay-bundle.js';
import { createRunTraceRecorder } from '../../self/infrastructure/telemetry-timeline.js';
import ReplayEngine, { createTimelinePlayback, REPLAY_SPEEDS } from '../../self/infrastructure/replay-engine.js';
import { createRunReplayPanel } from '../../self/ui/zero/replay-panel.js';

const fixture = () => ({ schema: RUN_TRACE_SCHEMA, startedAt: 1000, droppedEvents: 0,
  provenance: { build: 'test-revision', models: [{ id: 'fixture', provider: 'synthetic' }] }, events: [
    { seq: 0, ts: 1000, type: 'model_text', data: { content: 'Inspect the fixture.' } },
    { seq: 1, ts: 1800, type: 'tool_call', data: { callId: 'c1', tool: 'ReadFile', args: { path: '/fixture' } } },
    { seq: 2, ts: 2600, type: 'tool_result', data: { callId: 'c1', tool: 'ReadFile', result: 'fixture text', error: null } },
    { seq: 3, ts: 7400, type: 'model_text', data: { content: 'DONE: fixture checked.' } }
  ] });

describe('bounded run traces', () => {
  it('records complete visible responses and ordered tools, excluding private request context', () => {
    let time = 1000;
    const recorder = createRunTraceRecorder({ now: () => time });
    recorder.recordEvent('agent:history', { type: 'model_request', context: 'private prompt' });
    recorder.recordEvent('agent:history', { type: 'llm_response', content: 'Visible generated output', model: 'fixture', provider: 'synthetic', reasoning: 'hidden' });
    recorder.record('tool_call', { callId: 'c1', tool: 'ReadFile', args: { path: '/fixture', apiKey: 'private-key' } });
    time = 2000;
    recorder.record('tool_result', { callId: 'c1', tool: 'ReadFile', result: 'long output '.repeat(1000), error: 'retained failure' });
    const trace = importRunTrace(JSON.stringify(recorder.snapshot()));
    expect(trace.events.map(event => event.type)).toEqual(['model_text', 'tool_call', 'tool_result']);
    expect(trace.events[0].data).toMatchObject({ content: 'Visible generated output', model: 'fixture', provider: 'synthetic' });
    expect(trace.events[1].data.args.apiKey).toBe('[redacted]');
    expect(trace.events[2].data.result).toHaveLength(12000);
    expect(JSON.stringify(trace)).not.toContain('private prompt');
    expect(JSON.stringify(trace)).not.toContain('hidden');
    recorder.recordEvent('agent:history', { type: 'tool_result', tool: 'DeniedTool', args: {}, result: 'Error: policy rejected' });
    expect(recorder.snapshot().events.at(-1)).toMatchObject({ type: 'tool_observation', data: { tool: 'DeniedTool', result: 'Error: policy rejected' } });
  });

  it('marks omitted suffix instead of evicting earlier records or truncating evidence silently', () => {
    const recorder = createRunTraceRecorder({ now: () => 1000 });
    recorder.record('model_text', { content: 'first' });
    recorder.record('model_text', { content: 'x'.repeat(RUN_TRACE_LIMITS.eventBytes) });
    recorder.record('model_text', { content: 'after omitted event' });
    expect(recorder.snapshot()).toMatchObject({ droppedEvents: 2, events: [{ data: { content: 'first' } }] });
    expect(recorder.snapshot().events).toHaveLength(1);
  });

  it('redacts credential patterns and reasoning while leaving visible generated code as inert text', () => {
    const trace = fixture();
    trace.events[0].data.content = '<think>private reasoning</think>Visible: sk-secretvalue0123; Authorization: Bearer abcdef; const x = 1';
    trace.events[1].data.args.accessToken = 'credential';
    const imported = validateRunTrace(trace);
    expect(imported.events[0].data.content).toContain('const x = 1');
    expect(imported.events[0].data.content).not.toMatch(/private reasoning|secretvalue0123|abcdef/);
    expect(imported.events[1].data.args.accessToken).toBe('[redacted]');
  });

  it.each([
    trace => { trace.schema = 'other'; },
    trace => { trace.events[1].seq = 0; },
    trace => { trace.events[1].ts = 999; },
    trace => { trace.events[1].type = 'hitl:approve'; },
    trace => { trace.events[2].data.callId = 'missing'; },
    trace => { trace.events[2].data.tool = 'OtherTool'; },
    trace => { trace.events[2] = { ...trace.events[1], seq: 2 }; },
    trace => { trace.events[0].data = null; },
    trace => { trace.events[0].data.content = 'x'.repeat(RUN_TRACE_LIMITS.eventBytes); },
    trace => { trace.events[0].data = JSON.parse('{"content":"x","__proto__":{"polluted":true}}'); }
  ])('rejects malformed or unsafe imported traces', mutate => {
    const trace = fixture(); mutate(trace);
    expect(() => validateRunTrace(trace)).toThrow();
    expect({}.polluted).toBeUndefined();
  });

  it('bounds UTF-8 bytes before parsing and snapshots caller mutations', () => {
    expect(() => importRunTrace('é'.repeat(RUN_TRACE_LIMITS.bytes / 2 + 1))).toThrow('size limit');
    const trace = fixture(); const imported = validateRunTrace(trace);
    trace.events[0].data.content = 'mutated';
    expect(imported.events[0].data.content).toBe('Inspect the fixture.');
  });
});

describe('passive timeline playback', () => {
  it.each(REPLAY_SPEEDS)('applies every event at %sx in the same order and never executes tools', speed => {
    vi.useFakeTimers();
    const applied = []; const renders = vi.fn();
    const player = createTimelinePlayback({ now: () => Date.now(), onEvent: event => applied.push(event.seq), onUpdate: renders });
    player.loadRun(fixture()); player.setSpeed(speed); player.play();
    vi.advanceTimersByTime(Math.ceil(6400 / speed) + 32);
    expect(applied).toEqual([0, 1, 2, 3]);
    expect(player.getState()).toMatchObject({ currentIndex: 4, isPlaying: false, percent: 100 });
    if (speed === 256) expect(renders.mock.calls.length).toBeLessThan(10);
    player.dispose(); vi.useRealTimers();
  });

  it('batches thousands of coincident events without event loss or per-event rendering', () => {
    const trace = fixture();
    trace.events = Array.from({ length: 2000 }, (_, seq) => ({ seq, ts: 1000, type: 'model_text', data: { content: String(seq) } }));
    const applied = vi.fn(); const render = vi.fn();
    const player = createTimelinePlayback({ onEvent: applied, onUpdate: render });
    player.loadRun(trace); render.mockClear(); player.play();
    expect(applied).toHaveBeenCalledTimes(2000);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('pauses elapsed time, seeks deterministically through end, restarts, and ignores repeated play', () => {
    vi.useFakeTimers(); let applied = [];
    const player = createTimelinePlayback({ now: () => Date.now(), onEvent: event => applied.push(event.seq), onReset: () => { applied = []; } });
    player.loadRun(fixture()); player.play(); player.play();
    vi.advanceTimersByTime(400); player.pause(); vi.advanceTimersByTime(10000);
    expect(applied).toEqual([0]);
    player.play(); vi.advanceTimersByTime(416);
    expect(applied).toEqual([0, 1]);
    player.seek(4); expect(applied).toEqual([0, 1, 2, 3]);
    player.seek(2); expect(applied).toEqual([0, 1]);
    player.stop(); expect(applied).toEqual([]);
    player.step(); expect(applied).toEqual([0]);
    player.dispose(); vi.advanceTimersByTime(10000); expect(applied).toEqual([0]);
    vi.useRealTimers();
  });

  it('keeps current trace on invalid replacement and forbids imported re-execution on legacy service', async () => {
    const emit = vi.fn(); const execute = vi.fn(); const chat = vi.fn();
    const engine = ReplayEngine.factory({ Utils: { logger: { info: vi.fn() }, generateId: () => 'id' }, EventBus: { emit }, ToolRunner: { execute }, LLMClient: { chat } });
    engine.loadRun(fixture());
    expect(() => engine.loadRun({ ...fixture(), schema: 'bad' })).toThrow();
    engine.play();
    expect(emit.mock.calls.every(([name]) => name.startsWith('replay:'))).toBe(true);
    await expect(engine.executeSession()).rejects.toThrow('read-only');
    await expect(engine.executeIteration(1, [], {})).rejects.toThrow('read-only');
    await expect(engine.restoreCheckpoint(0)).rejects.toThrow('read-only');
    expect(execute).not.toHaveBeenCalled(); expect(chat).not.toHaveBeenCalled(); engine.stop();
  });
});

describe('Inspect replay controls', () => {
  const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  it('requires review before download, excludes unrelated bundle state and supports cancelling', () => {
    const root = document.createElement('section'); const downloadJson = vi.fn();
    const panel = createRunReplayPanel({ escapeHtml, downloadJson }); panel.mount(root);
    panel.preview({ trace: fixture(), context: 'private', systemPrompt: 'secret prompt' });
    expect(downloadJson).not.toHaveBeenCalled();
    expect(root.querySelector('[data-replay-preview-json]').textContent).not.toContain('private');
    root.querySelector('[data-replay-action="cancel-export"]').click();
    expect(root.querySelector('[data-replay-preview]').hidden).toBe(true);
    panel.preview({ trace: fixture() }); root.querySelector('[data-replay-action="confirm-export"]').click();
    expect(downloadJson).toHaveBeenCalledTimes(1);
    expect(downloadJson.mock.calls[0][0]).toEqual(fixture()); panel.dispose();
  });

  it('imports untrusted text as inert content and cancels stale async imports on disposal', async () => {
    const root = document.createElement('section');
    const panel = createRunReplayPanel({ escapeHtml, downloadJson: vi.fn() }); panel.mount(root);
    const input = root.querySelector('[data-replay-import]'); const trace = fixture();
    trace.events[0].data.content = '<img src=x onerror="throw new Error()">';
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 1000, text: async () => JSON.stringify(trace) }] });
    input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve();
    root.querySelector('[data-replay-action="step"]').click();
    expect(root.querySelector('[data-replay-events]').textContent).toContain('<img');
    expect(root.querySelector('img')).toBeNull();
    let resolve; const pending = new Promise(done => { resolve = done; });
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 1, text: () => pending }] });
    input.dispatchEvent(new Event('change', { bubbles: true })); panel.dispose(); resolve(JSON.stringify(trace));
    await pending; await Promise.resolve();
  });
});

describe('bounded saved recordings', () => {
  const createSavedRecorder = options => createRunTraceRecorder({ withLock: action => action(), ...options });
  const memoryVfs = () => {
    const files = new Map();
    return { files, list: vi.fn(async prefix => [...files.keys()].filter(path => path.startsWith(prefix))),
      read: vi.fn(async path => files.get(path)), write: vi.fn(async (path, text) => { files.set(path, text); }) };
  };
  it('roundtrips exact benign generated text, arguments, results and errors after recorder recreation', async () => {
    const { listSavedRunTraces, readSavedRunTrace } = await import('../../self/infrastructure/telemetry-timeline.js');
    const VFS = memoryVfs();
    const recorder = createSavedRecorder({ VFS, now: () => 1000, makeId: () => 'first' });
    const content = 'Visible generated text\n```js\nconst sample = "<b>not HTML</b>";\n```\nUnicode: café ✓';
    const args = { path: '/artifacts/synthetic-fixture.txt', code: 'const message = "literal";\n', flags: [false, 0, null] };
    const result = { text: 'Preserved result\nwith exact whitespace.  ', values: [1, false, null] };
    recorder.recordEvent('agent:history', { type: 'llm_response', content, model: 'fixture', provider: 'synthetic' });
    recorder.record('tool_call', { callId: 'c1', tool: 'ReadFile', args });
    recorder.record('tool_result', { callId: 'c1', tool: 'ReadFile', result, error: 'Exact benign failure.' });
    await recorder.close();
    const expected = recorder.snapshot();
    const [path] = await listSavedRunTraces(VFS);
    expect(await readSavedRunTrace(VFS, path)).toEqual(expected);
    const imported = importRunTrace(JSON.stringify(await readSavedRunTrace(VFS, path)));
    expect(imported.events[0].data.content).toBe(content);
    expect(imported.events[1].data.args).toEqual(args);
    expect(imported.events[2].data).toMatchObject({ result, error: 'Exact benign failure.' });
    const returning = createSavedRecorder({ VFS, now: () => 2000, makeId: () => 'second' });
    returning.record('model_text', { content: 'Different run, previous evidence retained.' });
    await returning.close();
    expect(await listSavedRunTraces(VFS)).toHaveLength(2);
    expect(await readSavedRunTrace(VFS, path)).toEqual(expected);
    expect(VFS.files.get(path)).not.toContain('Different run');
  });

  it('coalesces writes, retains a stopped/resumed prefix and flushes old work before reset', async () => {
    const VFS = memoryVfs(); let id = 0;
    const recorder = createSavedRecorder({ VFS, now: () => 1000, makeId: () => `run-${++id}` });
    recorder.record('status', { state: 'RUNNING' });
    recorder.record('model_text', { content: 'before stop' });
    recorder.record('status', { state: 'IDLE' });
    await recorder.flush();
    expect(VFS.write).toHaveBeenCalledTimes(1);
    const path = recorder.getPersistenceStatus().path;
    recorder.record('status', { state: 'RUNNING' });
    recorder.record('model_text', { content: 'after resume' });
    await recorder.flush();
    expect(JSON.parse(VFS.files.get(path)).events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4]);
    recorder.record('model_text', { content: 'unflushed old tail' });
    recorder.reset(); recorder.record('model_text', { content: 'new run' });
    await recorder.close();
    expect(VFS.files.size).toBe(2);
    expect(VFS.files.get(path)).toContain('unflushed old tail');
  });

  it('preserves all older files at capacity and reports rather than evicting a saved recording', async () => {
    const VFS = memoryVfs(); const warn = vi.fn();
    for (let i = 0; i < 8; i++) VFS.files.set(`/.logs/recordings/${i}-old.json`, JSON.stringify(fixture()));
    const before = [...VFS.files];
    const recorder = createSavedRecorder({ VFS, onPersistenceError: warn, now: () => 1000 });
    recorder.record('model_text', { content: 'still exportable in memory' }); await recorder.close();
    expect([...VFS.files]).toEqual(before); expect(VFS.write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('limit reached'));
    expect(recorder.snapshot().events[0].data.content).toBe('still exportable in memory');
    expect(recorder.getPersistenceStatus()).toMatchObject({ saved: false, error: expect.stringContaining('limit reached') });
  });

  it('does not overwrite an externally modified saved file or fail the run on storage errors', async () => {
    const VFS = memoryVfs(); const recorder = createSavedRecorder({ VFS, now: () => 1000 });
    recorder.record('model_text', { content: 'first' }); await recorder.flush();
    const path = recorder.getPersistenceStatus().path;
    VFS.files.set(path, 'newer external work');
    recorder.record('model_text', { content: 'second' }); await recorder.close();
    expect(VFS.files.get(path)).toBe('newer external work');
    expect(recorder.getPersistenceStatus().error).toContain('changed externally');
    const failing = createSavedRecorder({ VFS: { ...VFS, write: async () => { throw new Error('quota'); } }, now: () => 2000,
      onPersistenceError: () => { throw new Error('bad observer'); } });
    failing.record('model_text', { content: 'export fallback' });
    await expect(failing.close()).resolves.toBeUndefined();
    expect(failing.getPersistenceStatus().error).toBe('quota');
  });

  it('loads saved data through the same passive panel without writes or model/tool ports', async () => {
    const VFS = memoryVfs(); VFS.files.set('/.logs/recordings/1000-test.json', JSON.stringify(fixture()));
    const panel = createRunReplayPanel({ escapeHtml: value => String(value).replaceAll('<', '&lt;'), VFS });
    const root = document.createElement('div'); panel.mount(root);
    root.querySelector('[data-replay-action="refresh-saved"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-replay-saved]').options).toHaveLength(1));
    root.querySelector('[data-replay-action="load-saved"]').click();
    await vi.waitFor(() => expect(root.querySelector('[data-replay-error]').textContent).toContain('Saved recording loaded'));
    const seek = root.querySelector('[data-replay-seek]'); seek.value = 4; seek.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('[data-replay-events]').textContent).toContain('fixture text');
    expect(VFS.write).not.toHaveBeenCalled();
    panel.dispose();
  });
});
