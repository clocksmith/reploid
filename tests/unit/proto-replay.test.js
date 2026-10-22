import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReplayEngine from '../../self/infrastructure/replay-engine.js';
import { RUN_TRACE_SCHEMA } from '../../self/core/run-replay-bundle.js';
import Utils from '../../self/core/utils.js';
import { createReplayManager } from '../../self/ui/proto/replay.js';
import { renderProtoTemplate } from '../../self/ui/proto/template.js';

const visibleText = '<img src=x onerror="window.replayExecuted=true">Visible output';
const currentTrace = () => ({
  schema: RUN_TRACE_SCHEMA, startedAt: 1000, droppedEvents: 0, provenance: {},
  events: [
    { seq: 0, ts: 1000, type: 'status', data: { state: 'Ready', legacyType: {} } },
    { seq: 1, ts: 1001, type: 'model_text', data: { content: visibleText } },
    { seq: 2, ts: 1002, type: 'tool_call', data: { callId: 'call-1', tool: 'WriteFile', args: { path: '/no-write' } } },
    { seq: 3, ts: 1003, type: 'tool_result', data: { callId: 'call-1', tool: 'WriteFile', result: 'observed' } },
    { seq: 4, ts: 1004, type: 'status', data: { state: { phase: 'waiting' } } },
    { seq: 5, ts: 1005, type: 'error', data: { legacyType: 'tool:failed', message: 'Observed failure' } }
  ]
});
const legacyRun = () => ({ version: '1.1', state: { totalCycles: 2 }, vfs: {
  '/.logs/timeline/2024-01-01.jsonl': [
    { ts: 1000, type: 'agent:status', payload: { state: 'Ready' } },
    { ts: 1001, type: 'agent:history', payload: { type: 'llm_response', content: visibleText } },
    { ts: 1002, type: 'agent:history', payload: { type: 'tool_result', tool: 'WriteFile', result: 'observed' } },
    { ts: 1003, type: 'agent:status', payload: { state: { phase: 'waiting' } } },
    { ts: 1004, type: 'tool:failed', severity: 'ERROR', payload: { message: 'Observed failure' } }
  ].map(event => JSON.stringify(event)).join('\n')
} });
const { escapeHtml } = Utils.factory();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Proto replay caller compatibility', () => {
  let engine;
  let manager;
  let ports;
  let EventBus;
  let previousReploid;

  beforeEach(() => {
    document.body.innerHTML = renderProtoTemplate(escapeHtml, 'Existing goal');
    const listeners = new Map();
    EventBus = {
      on: (name, listener) => listeners.set(name, [...(listeners.get(name) || []), listener]),
      emit: vi.fn((name, data) => { for (const listener of listeners.get(name) || []) listener(data); })
    };
    ports = { VFS: { write: vi.fn() }, ToolRunner: { run: vi.fn(), execute: vi.fn() },
      LLMClient: { chat: vi.fn() }, VFSSandbox: { restoreSnapshot: vi.fn() } };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    engine = ReplayEngine.factory({ ...ports, EventBus, Utils: { logger, generateId: () => 'fixture' } });
    previousReploid = window.REPLOID;
    window.REPLOID = { replayEngine: engine };
    manager = createReplayManager({ logger, escapeHtml, EventBus });
    manager.wireEvents();
  });

  afterEach(() => {
    engine.clear();
    if (previousReploid === undefined) delete window.REPLOID;
    else window.REPLOID = previousReploid;
    document.body.innerHTML = '';
  });

  it.each([['legacy', legacyRun], ['current', currentTrace]])(
    'renders %s recordings and drives only supported passive playback controls', async (_name, makeRun) => {
      await manager.loadRunFile({ name: 'recording.json', text: async () => JSON.stringify(makeRun()) });
      await flush();
      const speed = document.getElementById('replay-speed-select');
      expect(speed.value).toBe(String(engine.getState().speed));
      expect([...speed.options].map(option => Number(option.value))).toEqual(engine.getSpeeds());
      for (const option of speed.options) {
        speed.value = option.value;
        speed.dispatchEvent(new Event('change'));
        await flush();
        expect(engine.getState().speed).toBe(Number(option.value));
      }
      const total = engine.getState().totalEvents;
      for (let index = 0; index < total; index++) {
        document.getElementById('replay-step').click();
        await flush();
      }
      const log = document.getElementById('replay-event-log');
      expect(log.textContent).toContain('Ready');
      expect(log.textContent).toContain(visibleText);
      expect(log.textContent).toContain('WriteFile');
      expect(log.textContent).toContain('{"phase":"waiting"}');
      expect(log.querySelector('.replay-event.error')?.textContent).toContain('Observed failure');
      expect(log.querySelector('img')).toBeNull();
      expect(engine.getState().currentIndex).toBe(total);
      expect(EventBus.emit.mock.calls.every(([name]) => name.startsWith('replay:'))).toBe(true);
      await expect(engine.executeSession()).rejects.toThrow('read-only');
      expect(ports.ToolRunner.run).not.toHaveBeenCalled();
      expect(ports.ToolRunner.execute).not.toHaveBeenCalled();
      expect(ports.LLMClient.chat).not.toHaveBeenCalled();
      expect(ports.VFS.write).not.toHaveBeenCalled();
      expect(ports.VFSSandbox.restoreSnapshot).not.toHaveBeenCalled();
      document.getElementById('replay-stop').click();
      await flush();
      expect(engine.getState().currentIndex).toBe(0);
      expect(log.querySelector('.replay-event')).toBeNull();
    }
  );
});
