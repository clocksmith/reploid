/**
 * @fileoverview Integration tests for ReplayEngine
 * Tests session loading, re-execution, checkpointing, and comparison
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReplayEngineModule from '../../infrastructure/replay-engine.js';
import { RUN_REPLAY_SCHEMA, RUN_TRACE_SCHEMA, RUN_TRACE_LIMITS, importRunTrace, validateRunTrace } from '../../self/core/run-replay-bundle.js';

describe('ReplayEngine - Integration Tests', () => {
  let replayEngine;
  let mockUtils;
  let mockEventBus;
  let mockVFS;
  let mockAuditLogger;
  let mockVFSSandbox;
  let mockToolRunner;
  let mockLLMClient;
  let emittedEvents;

  const createMocks = () => {
    emittedEvents = [];

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
    };

    mockEventBus = {
      emit: vi.fn().mockImplementation((event, data) => {
        emittedEvents.push({ event, data });
      }),
      on: vi.fn()
    };

    mockVFS = {
      read: vi.fn(),
      write: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false)
    };

    mockAuditLogger = {
      getEntries: vi.fn().mockResolvedValue([])
    };

    mockVFSSandbox = {
      createSnapshot: vi.fn().mockResolvedValue({
        files: { '/test.txt': 'content' },
        timestamp: Date.now()
      }),
      restoreSnapshot: vi.fn().mockResolvedValue()
    };

    mockToolRunner = {
      run: vi.fn().mockResolvedValue('tool result'),
      execute: vi.fn().mockResolvedValue('tool result')
    };

    mockLLMClient = {
      chat: vi.fn().mockResolvedValue({ content: 'LLM response', toolCalls: [] })
    };
  };

  beforeEach(() => {
    createMocks();
    replayEngine = ReplayEngineModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      VFS: mockVFS,
      AuditLogger: mockAuditLogger,
      VFSSandbox: mockVFSSandbox,
      ToolRunner: mockToolRunner,
      LLMClient: mockLLMClient
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    replayEngine.clear();
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ReplayEngineModule.metadata.id).toBe('ReplayEngine');
      expect(ReplayEngineModule.metadata.version).toBe('2.0.0');
      expect(ReplayEngineModule.metadata.type).toBe('infrastructure');
    });
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      const result = await replayEngine.init();
      expect(result).toBe(true);
      expect(mockUtils.logger.info).toHaveBeenCalledWith('[ReplayEngine] Initialized (v2.0 with re-execution)');
    });
  });

  // =========================================================================
  // Timeline Playback (v1.0 features)
  // =========================================================================

  describe('loadRun', () => {
    it('should load timeline events from run data', () => {
      const runData = {
        vfs: {
          '/.logs/timeline/2024-01-01.jsonl': JSON.stringify({ ts: 1000, type: 'test', payload: {} }) + '\n'
        },
        state: { totalCycles: 5 }
      };

      const { events, metadata } = replayEngine.loadRun(runData);

      expect(events).toHaveLength(1);
      expect(metadata.eventCount).toBe(1);
      expect(metadata.totalCycles).toBe(5);
    });

    it('should throw for invalid run data', () => {
      expect(() => replayEngine.loadRun({})).toThrow('Invalid run data: missing vfs');
      expect(() => replayEngine.loadRun(null)).toThrow();
    });

    it('should emit replay:loaded event', () => {
      const runData = {
        vfs: { '/.logs/timeline/test.jsonl': '' },
        state: {}
      };

      replayEngine.loadRun(runData);

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:loaded', expect.any(Object));
    });
  });

  describe('legacy import boundary', () => {
    const record = (ts = 1000, type = 'agent:status', payload = { state: 'running' }) => ({
      id: `evt_${ts}`, ts, type, severity: 'info', tags: ['agent'], payload
    });
    const legacy = (events = [record()]) => ({ version: '1.1', exportedAt: '2024-01-01T00:00:00Z',
      state: { totalCycles: 2, goal: 'Inspect saved work' },
      vfs: { '/.logs/timeline/2024-01-01.jsonl': events.map(event => JSON.stringify(event)).join('\n') + '\n' }
    });

    it.each([undefined, RUN_REPLAY_SCHEMA, 'reploid-run-replay/v1', 'reploid/run-replay/v1'])(
      'normalizes supported exporter envelopes (%s) without importing state or files', schema => {
        const run = legacy();
        if (schema) run.schema = schema;
        run.vfs['/private.txt'] = 'unrelated private file';
        run.state.context = 'private request';
        const trace = importRunTrace(JSON.stringify(run));
        expect(trace).toMatchObject({ schema: RUN_TRACE_SCHEMA, droppedEvents: 0,
          provenance: { source: 'legacy-vfs-timeline', totalCycles: 2, fileCount: 2 },
          events: [{ seq: 0, ts: 1000, type: 'status', data: { legacyType: 'agent:status', payload: { state: 'running' } } }] });
        expect(JSON.stringify(trace)).not.toMatch(/unrelated private file|private request/);
      }
    );

    it('merges dated files deterministically and snapshots sanitized visible evidence', () => {
      const run = legacy([record(2000)]);
      run.vfs['/.logs/timeline/2023-12-31.jsonl'] = JSON.stringify(record(1000, 'agent:history', {
        type: 'llm_response', content: '<think>hidden</think>Visible sk-secretvalue0123', reasoning: 'private reasoning'
      }));
      const trace = importRunTrace(run);
      run.vfs['/.logs/timeline/2023-12-31.jsonl'] = '';
      expect(trace.events.map(event => [event.seq, event.ts])).toEqual([[0, 1000], [1, 2000]]);
      expect(trace.events[0]).toMatchObject({ type: 'model_text', data: { content: '[reasoning omitted]Visible [redacted]' } });
      expect(JSON.stringify(trace)).not.toMatch(/hidden|private reasoning|secretvalue0123/);
    });

    it('omits request history and never upgrades legacy observations into executable calls', async () => {
      const run = legacy([
        record(1000, 'agent:history', { type: 'model_request', content: 'private prompt' }),
        record(2000, 'agent:history', { type: 'llm_response', content: 'Visible output', toolCalls: [{ name: 'WriteFile', args: {} }] }),
        record(3000, 'agent:history', { type: 'tool_result', tool: 'WriteFile', args: { apiKey: 'secret' }, result: 'observed result' }),
        record(4000, 'hitl:approve', { approved: true })
      ]);
      const session = replayEngine.loadSessionFromRun(run);
      expect(session).toMatchObject({ goal: 'Inspect saved work', llmResponses: 1, toolResults: 1 });
      replayEngine.seek(4);
      const events = emittedEvents.filter(({ event }) => event === 'replay:event').map(({ data }) => data);
      expect(events.map(event => event.type)).toEqual(['status', 'model_text', 'tool_observation', 'status']);
      expect(events[2].data.args.apiKey).toBe('[redacted]');
      expect(JSON.stringify(events)).not.toMatch(/private prompt|toolCalls/);
      await expect(replayEngine.executeSession()).rejects.toThrow('read-only');
      await expect(replayEngine.executeIteration(1, [], {})).rejects.toThrow('read-only');
      await expect(replayEngine.restoreCheckpoint(0)).rejects.toThrow('read-only');
      expect(emittedEvents.every(({ event }) => event.startsWith('replay:'))).toBe(true);
      expect(mockToolRunner.execute).not.toHaveBeenCalled();
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
      expect(mockVFS.write).not.toHaveBeenCalled();
      expect(mockVFSSandbox.restoreSnapshot).not.toHaveBeenCalled();
    });

    it.each([
      ['llm:request', {}],
      ['agent:system_prompt', {}],
      ['agent:context', {}],
      ['agent:reasoning', {}],
      ['audit:AGENT_ACTION', { action: 'model_request' }],
      ['audit:AGENT_ACTION', { kind: 'system_prompt' }],
      ['audit:AGENT_ACTION', { type: 'llm_request' }]
    ])('omits known private legacy event or action labels: %s', (type, labels) => {
      const trace = importRunTrace(legacy([record(1000, type, { ...labels, content: 'private text', messages: ['private message'] })]));
      expect(trace.events[0].data).toMatchObject({ legacyType: type, omittedPayload: expect.any(String) });
      expect(JSON.stringify(trace)).not.toMatch(/private text|private message/);
    });

    it.each([
      run => { run.schema = 'unknown'; },
      run => { run.version = '2.0'; },
      run => { run.trace = { schema: RUN_TRACE_SCHEMA, events: [] }; },
      run => { run.schema = RUN_TRACE_SCHEMA; },
      run => { run.vfs = []; },
      run => { run.state = []; },
      run => { run.state.totalCycles = -1; },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'agent:history', { type: 'llm_response', content: 1 })); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'agent:history', { type: 'tool_result', result: 'missing name' })); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'event', Array.from({ length: 14 }).reduce(value => ({ nested: value }), {}))); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = {}; },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] += '{bad json}'; },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(-1)); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'event', [])); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] += JSON.stringify(record(999)); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] += JSON.stringify(record(1001 + RUN_TRACE_LIMITS.durationMs)); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'event', JSON.parse('{"__proto__":{"polluted":true}}'))); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = JSON.stringify(record(1000, 'event', { text: 'é'.repeat(RUN_TRACE_LIMITS.eventBytes / 2) })); },
      run => { run.vfs['/.logs/timeline/2024-01-01.jsonl'] = (JSON.stringify(record()) + '\n').repeat(RUN_TRACE_LIMITS.events + 1); },
      run => { run.vfs['/large.txt'] = 'é'.repeat(RUN_TRACE_LIMITS.bytes / 2); }
    ])('rejects malformed legacy replacement transactionally', mutate => {
      replayEngine.loadRun(legacy());
      replayEngine.step();
      const state = replayEngine.getState();
      const emitted = emittedEvents.length;
      const run = legacy(); mutate(run);
      expect(() => replayEngine.loadRun(run)).toThrow();
      expect(replayEngine.getState()).toEqual(state);
      expect(emittedEvents).toHaveLength(emitted);
      expect({}.polluted).toBeUndefined();
    });

    it('preserves uppercase audit ERROR severity as passive error evidence', () => {
      const trace = importRunTrace(legacy([{ ...record(1000, 'audit:TOOL_EXEC', { error: 'retained failure' }), severity: 'ERROR' }]));
      expect(trace.events[0]).toMatchObject({ type: 'error', data: {
        legacyType: 'audit:TOOL_EXEC', payload: { error: 'retained failure' }
      } });
    });

    const expandingTrace = (eventCount = 1, keys = 8000) => ({ schema: RUN_TRACE_SCHEMA,
      startedAt: 0, provenance: {}, droppedEvents: 0,
      events: Array.from({ length: eventCount }, (_, seq) => ({ seq, ts: seq, type: 'status',
        data: Object.fromEntries(Array.from({ length: keys }, (_, index) => [`token${index}`, ''])) }))
    });

    it.each(['audit', 'trace'])('preserves prior %s state when sanitization expands an event beyond the limit', async mode => {
      if (mode === 'audit') {
        mockAuditLogger.getEntries.mockResolvedValue([
          { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'retained response' }, ts: '2024-01-01T00:00:00Z' }
        ]);
        await replayEngine.loadSession('2024-01-01');
      } else {
        replayEngine.loadRun(legacy());
        replayEngine.step();
      }
      await replayEngine.createCheckpoint();
      const playbackState = replayEngine.getState();
      const executionState = replayEngine.getExecutionState();
      const emitted = emittedEvents.length;
      const oversized = expandingTrace();
      expect(new TextEncoder().encode(JSON.stringify(oversized.events[0])).length).toBeLessThan(RUN_TRACE_LIMITS.eventBytes);
      expect(() => replayEngine.loadRun(oversized)).toThrow('size limit');
      expect(replayEngine.getState()).toEqual(playbackState);
      expect(replayEngine.getExecutionState()).toEqual(executionState);
      expect(emittedEvents).toHaveLength(emitted);
      if (mode === 'audit') {
        await expect(replayEngine.executeIteration(1, [], {})).resolves.toMatchObject({ content: 'retained response', mocked: true });
      } else {
        await expect(replayEngine.executeIteration(1, [], {})).rejects.toThrow('read-only');
      }
      expect(mockToolRunner.execute).not.toHaveBeenCalled();
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
      expect(mockVFS.write).not.toHaveBeenCalled();
    });

    it('bounds the canonical total when individually bounded events expand during redaction', () => {
      const trace = expandingTrace(48, 4000);
      expect(new TextEncoder().encode(JSON.stringify(trace)).length).toBeLessThan(RUN_TRACE_LIMITS.bytes);
      expect(() => validateRunTrace(trace)).toThrow('size limit');
    });

    it('rejects an unknown wrapper schema even when it contains a valid trace', () => {
      const trace = importRunTrace(legacy());
      expect(() => importRunTrace({ ...legacy(), schema: 'unknown', trace })).toThrow('Unsupported');
    });
  });

  describe('playback controls', () => {
    beforeEach(() => {
      const runData = {
        vfs: {
          '/.logs/timeline/test.jsonl':
            JSON.stringify({ ts: 1000, type: 'event1', payload: { data: 1 } }) + '\n' +
            JSON.stringify({ ts: 2000, type: 'event2', payload: { data: 2 } }) + '\n'
        }
      };
      replayEngine.loadRun(runData);
    });

    it('should step through events', () => {
      replayEngine.step();

      expect(mockEventBus.emit).not.toHaveBeenCalledWith('event1', expect.anything());
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:event', expect.objectContaining({
        type: 'status', data: { legacyType: 'event1', payload: { data: 1 } }
      }));
      expect(emittedEvents.every(({ event }) => event.startsWith('replay:'))).toBe(true);
      expect(mockToolRunner.execute).not.toHaveBeenCalled();
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
      expect(mockVFS.write).not.toHaveBeenCalled();
    });

    it('should track playback state', () => {
      const state = replayEngine.getState();

      expect(state.isPlaying).toBe(false);
      expect(state.isPaused).toBe(true);
      expect(state.currentIndex).toBe(0);
      expect(state.totalEvents).toBe(2);
    });

    it('should set speed', () => {
      replayEngine.setSpeed(256);

      expect(replayEngine.getState().speed).toBe(256);
      expect(replayEngine.getSpeeds()).toEqual([1, 8, 64, 256]);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:progress', expect.objectContaining({ speed: 256 }));
    });

    it('should reject invalid speed', () => {
      expect(() => replayEngine.setSpeed(3)).toThrow('Unsupported replay speed');
      expect(replayEngine.getState().speed).toBe(1);
    });

    it('should seek to position', () => {
      replayEngine.seek(1);

      expect(replayEngine.getState().currentIndex).toBe(1);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:progress', expect.objectContaining({ currentIndex: 1 }));
    });

    it('should stop playback', () => {
      replayEngine.step();
      replayEngine.stop();

      expect(replayEngine.getState().currentIndex).toBe(0);
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:reset');
    });
  });

  // =========================================================================
  // Session Re-execution (v2.0 features)
  // =========================================================================

  describe('loadSession', () => {
    it('should load session from audit logs', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'goal_set', goal: 'Test goal' }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 1', toolCalls: [{ name: 'TestTool', args: {} }] }, ts: '2024-01-01T00:00:01Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'TestTool', result: 'Result 1' }, ts: '2024-01-01T00:00:02Z' }
      ]);

      const session = await replayEngine.loadSession('2024-01-01');

      expect(session.goal).toBe('Test goal');
      expect(session.totalIterations).toBe(1);
      expect(session.llmResponses).toBe(1);
      expect(session.toolResults).toBe(1);
    });

    it('should throw when AuditLogger not available', async () => {
      const engineNoAudit = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS
      });

      await expect(engineNoAudit.loadSession('2024-01-01'))
        .rejects.toThrow('AuditLogger not available');
    });

    it('should throw when no entries found', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([]);

      await expect(replayEngine.loadSession('2024-01-01'))
        .rejects.toThrow('No audit entries found');
    });

    it('should emit session_loaded event', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Test' }, ts: '2024-01-01T00:00:00Z' }
      ]);

      await replayEngine.loadSession('2024-01-01');

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:session_loaded', expect.any(Object));
    });
  });

  describe('loadSessionFromRun', () => {
    it('should load session from exported run with VFS', () => {
      const runData = {
        vfs: {
          '/.logs/timeline/test.jsonl':
            JSON.stringify({ ts: 1000, type: 'agent:history', payload: { type: 'llm_response', content: 'Response', cycle: 1 } }) + '\n' +
            JSON.stringify({ ts: 2000, type: 'agent:history', payload: { type: 'tool_result', tool: 'ReadFile', result: 'file content' } }) + '\n'
        },
        state: { goal: 'Exported goal' }
      };

      const session = replayEngine.loadSessionFromRun(runData);

      expect(session.goal).toBe('Exported goal');
      expect(session.hasVFS).toBe(true);
      expect(session.llmResponses).toBe(1);
      expect(session.toolResults).toBe(1);
    });
  });

  describe('checkpoints', () => {
    it('should create VFS checkpoint', async () => {
      const index = await replayEngine.createCheckpoint();

      expect(index).toBe(0);
      expect(mockVFSSandbox.createSnapshot).toHaveBeenCalled();
    });

    it('should restore checkpoint', async () => {
      await replayEngine.createCheckpoint();
      await replayEngine.restoreCheckpoint(0);

      expect(mockVFSSandbox.restoreSnapshot).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:checkpoint_restored', { index: 0 });
    });

    it('should throw for invalid checkpoint', async () => {
      await expect(replayEngine.restoreCheckpoint(99))
        .rejects.toThrow('Checkpoint 99 not found');
    });

    it('should list checkpoints', async () => {
      await replayEngine.createCheckpoint();
      await replayEngine.createCheckpoint();

      const checkpoints = replayEngine.getCheckpoints();

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].index).toBe(0);
      expect(checkpoints[1].index).toBe(1);
    });
  });

  describe('getMockedResponse', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Mocked content', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should return recorded response', () => {
      const response = replayEngine.getMockedResponse(1);

      expect(response).not.toBeNull();
      expect(response.content).toBe('Mocked content');
    });

    it('should return null for unrecorded iteration', () => {
      const response = replayEngine.getMockedResponse(99);

      expect(response).toBeNull();
    });
  });

  describe('executeIteration', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Recorded response', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should use mocked response when available', async () => {
      const response = await replayEngine.executeIteration(1, [], {});

      expect(response.content).toBe('Recorded response');
      expect(response.mocked).toBe(true);
      expect(mockLLMClient.chat).not.toHaveBeenCalled();
    });

    it('should fall back to live LLM when no recording', async () => {
      const response = await replayEngine.executeIteration(99, [], {});

      expect(response.mocked).toBe(false);
      expect(mockLLMClient.chat).toHaveBeenCalled();
    });
  });

  describe('compareToolResult', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'LLM', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'ReadFile', result: 'expected content' }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should detect matching results', () => {
      const comparison = replayEngine.compareToolResult(1, 'ReadFile', 'expected content');

      expect(comparison.match).toBe(true);
      expect(comparison.diff).toBeNull();
    });

    it('should detect mismatching results', () => {
      const comparison = replayEngine.compareToolResult(1, 'ReadFile', 'different content');

      expect(comparison.match).toBe(false);
      expect(comparison.diff).toContain('Mismatch');
    });

    it('should handle missing recorded result', () => {
      const comparison = replayEngine.compareToolResult(1, 'UnknownTool', 'result');

      expect(comparison.match).toBe(false);
      expect(comparison.diff).toBe('No recorded result');
    });

    it('should emit comparison event', () => {
      replayEngine.compareToolResult(1, 'ReadFile', 'expected content');

      expect(mockEventBus.emit).toHaveBeenCalledWith('replay:comparison', expect.any(Object));
    });
  });

  describe('executeSession', () => {
    beforeEach(async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 1', toolCalls: [{ name: 'Tool1', args: {} }] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'Tool1', result: 'tool result' }, ts: '2024-01-01T00:00:01Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'Response 2', toolCalls: [] }, ts: '2024-01-01T00:00:02Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
    });

    it('should execute full session', async () => {
      const report = await replayEngine.executeSession();

      expect(report.iterations).toBe(2);
      expect(report.mode).toBe('mocked');
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should compare tool results', async () => {
      const report = await replayEngine.executeSession({ compareResults: true });

      expect(report.toolCalls).toBe(1);
      expect(report.matches + report.mismatches).toBe(1);
    });

    it('should create checkpoints at intervals', async () => {
      await replayEngine.executeSession({ checkpointInterval: 1 });

      const checkpoints = replayEngine.getCheckpoints();
      expect(checkpoints.length).toBeGreaterThan(1);
    });

    it('should emit execution events', async () => {
      await replayEngine.executeSession();

      const startEvent = emittedEvents.find(e => e.event === 'replay:execution_started');
      const completeEvent = emittedEvents.find(e => e.event === 'replay:execution_complete');

      expect(startEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
    });

    it('should call onIteration callback', async () => {
      const onIteration = vi.fn();

      await replayEngine.executeSession({ onIteration });

      expect(onIteration).toHaveBeenCalledTimes(2);
    });

    it('should throw if no session loaded', async () => {
      replayEngine.clear();

      await expect(replayEngine.executeSession())
        .rejects.toThrow('No session loaded');
    });

    it('should throw if already executing', async () => {
      // Start execution but don't await
      const promise = replayEngine.executeSession();

      await expect(replayEngine.executeSession())
        .rejects.toThrow('already in progress');

      await promise;
    });
  });

  describe('abortExecution', () => {
    it('should abort running execution', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R1', toolCalls: [] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R2', toolCalls: [] }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');

      // Abort after first iteration
      const onIteration = vi.fn().mockImplementation((i) => {
        if (i === 1) replayEngine.abortExecution();
      });

      const report = await replayEngine.executeSession({ onIteration });

      expect(report.iterations).toBeLessThanOrEqual(2);
    });
  });

  describe('getComparisonResults', () => {
    it('should return comparison results from last execution', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R', toolCalls: [{ name: 'T', args: {} }] }, ts: '2024-01-01T00:00:00Z' },
        { type: 'AGENT_ACTION', data: { action: 'tool_result', tool: 'T', result: 'res' }, ts: '2024-01-01T00:00:01Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
      await replayEngine.executeSession({ compareResults: true });

      const results = replayEngine.getComparisonResults();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getExecutionState', () => {
    it('should return current execution state', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R' }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');

      const state = replayEngine.getExecutionState();

      expect(state.isExecuting).toBe(false);
      expect(state.recordedResponses).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all replay state', async () => {
      mockAuditLogger.getEntries.mockResolvedValue([
        { type: 'AGENT_ACTION', data: { action: 'llm_response', content: 'R' }, ts: '2024-01-01T00:00:00Z' }
      ]);
      await replayEngine.loadSession('2024-01-01');
      await replayEngine.createCheckpoint();

      replayEngine.clear();

      const state = replayEngine.getExecutionState();
      expect(state.recordedResponses).toBe(0);
      expect(state.checkpoints).toBe(0);
    });
  });

  describe('without optional dependencies', () => {
    it('should handle missing VFSSandbox gracefully', async () => {
      const engineNoSandbox = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS,
        AuditLogger: mockAuditLogger
      });

      const index = await engineNoSandbox.createCheckpoint();
      expect(index).toBe(-1);
    });

    it('should throw when restoring without VFSSandbox', async () => {
      const engineNoSandbox = ReplayEngineModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        VFS: mockVFS,
        AuditLogger: mockAuditLogger
      });

      await expect(engineNoSandbox.restoreCheckpoint(0))
        .rejects.toThrow('VFSSandbox not available');
    });
  });
});
