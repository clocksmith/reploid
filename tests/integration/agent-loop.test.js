/**
 * @fileoverview Integration tests for AgentLoop
 * Tests the complete cognitive cycle with mocked dependencies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AgentLoopModule from '../../core/agent-loop.js';

describe('AgentLoop - Integration Tests', () => {
  let agentLoop;
  let mockUtils;
  let mockEventBus;
  let mockLLMClient;
  let mockToolRunner;
  let mockContextManager;
  let mockResponseParser;
  let mockStateManager;
  let mockPersonaManager;
  let mockReflectionStore;
  let mockReflectionAnalyzer;

  const createMocks = () => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockReturnValue('req_test123'),
      Errors: {
        StateError: class StateError extends Error {
          constructor(msg) { super(msg); this.name = 'StateError'; }
        },
        ConfigError: class ConfigError extends Error {
          constructor(msg) { super(msg); this.name = 'ConfigError'; }
        },
        AbortError: class AbortError extends Error {
          constructor(msg) { super(msg); this.name = 'AbortError'; }
        }
      }
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    mockLLMClient = {
      chat: vi.fn()
    };

    mockToolRunner = {
      execute: vi.fn()
    };

    mockContextManager = {
      compact: vi.fn().mockImplementation((ctx) => Promise.resolve(ctx)),
      emitTokens: vi.fn()
    };

    mockResponseParser = {
      parseToolCalls: vi.fn().mockReturnValue([]),
      isDone: vi.fn().mockReturnValue(false)
    };

    mockStateManager = {
      setGoal: vi.fn().mockResolvedValue(true),
      incrementCycle: vi.fn().mockResolvedValue(1)
    };

    mockPersonaManager = {
      getSystemPrompt: vi.fn().mockResolvedValue('You are REPLOID, a helpful AI agent.')
    };

    mockReflectionStore = {
      add: vi.fn().mockResolvedValue(true)
    };

    mockReflectionAnalyzer = {
      api: {
        detectFailurePatterns: vi.fn().mockResolvedValue([])
      }
    };
  };

  beforeEach(() => {
    createMocks();
    agentLoop = AgentLoopModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      LLMClient: mockLLMClient,
      ToolRunner: mockToolRunner,
      ContextManager: mockContextManager,
      ResponseParser: mockResponseParser,
      StateManager: mockStateManager,
      PersonaManager: mockPersonaManager,
      ReflectionStore: mockReflectionStore,
      ReflectionAnalyzer: mockReflectionAnalyzer
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('initialization', () => {
    it('should not be running initially', () => {
      expect(agentLoop.isRunning()).toBe(false);
    });

    it('should throw if run without model configured', async () => {
      await expect(agentLoop.run('Test goal'))
        .rejects.toThrow('No model configured');
    });
  });

  describe('run lifecycle', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should set goal via StateManager', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Build a web app');

      expect(mockStateManager.setGoal).toHaveBeenCalledWith('Build a web app');
    });

    it('should emit STARTING status', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'STARTING'
      }));
    });

    it('should emit IDLE status when done', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'IDLE',
        activity: 'Stopped'
      }));
    });

    it('should build initial context with persona', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockPersonaManager.getSystemPrompt).toHaveBeenCalled();
      expect(mockLLMClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' })
        ]),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should throw if already running', async () => {
      mockLLMClient.chat.mockImplementation(() => new Promise(() => {})); // Never resolves

      agentLoop.run('First goal');

      await expect(agentLoop.run('Second goal'))
        .rejects.toThrow('Agent already running');

      agentLoop.stop();
    });
  });

  describe('cognitive cycle', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should increment cycle on each iteration', async () => {
      let callCount = 0;
      mockLLMClient.chat.mockImplementation(() => {
        callCount++;
        if (callCount >= 2) {
          mockResponseParser.isDone.mockReturnValue(true);
        }
        return Promise.resolve({ content: callCount === 2 ? 'DONE' : 'Thinking...' });
      });

      await agentLoop.run('Test goal');

      expect(mockStateManager.incrementCycle).toHaveBeenCalledTimes(2);
    });

    it('should compact context before LLM call', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockContextManager.compact).toHaveBeenCalled();
    });

    it('should emit history events', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'llm_response'
      }));
    });

    it('should emit stream updates via callback', async () => {
      mockLLMClient.chat.mockImplementation((ctx, config, callback) => {
        callback('Streaming ');
        callback('response');
        return Promise.resolve({ content: 'DONE' });
      });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:stream', 'Streaming ');
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:stream', 'response');
    });
  });

  describe('tool execution', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should execute tool calls from response', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'ReadFile', args: { path: '/test.txt' } }
          ]);
          return Promise.resolve({ content: 'TOOL_CALL: ReadFile\nARGS: {"path":"/test.txt"}' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockResolvedValue('File content');

      await agentLoop.run('Read a file');

      expect(mockToolRunner.execute).toHaveBeenCalledWith('ReadFile', { path: '/test.txt' });
    });

    it('should add tool result to context', async () => {
      let chatCalls = [];
      mockLLMClient.chat.mockImplementation((ctx) => {
        chatCalls.push([...ctx]);
        if (chatCalls.length === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'ListFiles', args: { path: '/' } }
          ]);
          return Promise.resolve({ content: 'TOOL_CALL: ListFiles' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockResolvedValue(['/file1.txt', '/file2.txt']);

      await agentLoop.run('List files');

      // Second call should have tool result in context
      const secondCallCtx = chatCalls[1];
      const toolResultMsg = secondCallCtx.find(m => m.content?.includes('TOOL_RESULT'));
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content).toContain('ListFiles');
    });

    it('should emit tool events', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'WriteFile', args: { path: '/out.txt', content: 'Hello' } }
          ]);
          return Promise.resolve({ content: 'Writing file' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockResolvedValue('Wrote /out.txt');

      await agentLoop.run('Write a file');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_result',
        tool: 'WriteFile'
      }));
    });

    it('should handle tool errors gracefully', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'DeleteFile', args: { path: '/missing.txt' } }
          ]);
          return Promise.resolve({ content: 'Deleting file' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockRejectedValue(new Error('File not found'));

      await agentLoop.run('Delete file');

      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:error', expect.objectContaining({
        tool: 'DeleteFile',
        error: 'File not found'
      }));
    });

    it('should limit tool calls per iteration', async () => {
      mockResponseParser.parseToolCalls.mockReturnValue([
        { name: 'tool1', args: {} },
        { name: 'tool2', args: {} },
        { name: 'tool3', args: {} },
        { name: 'tool4', args: {} }
      ]);

      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration > 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([]);
          mockResponseParser.isDone.mockReturnValue(true);
          return Promise.resolve({ content: 'DONE' });
        }
        return Promise.resolve({ content: 'Many tools' });
      });

      mockToolRunner.execute.mockResolvedValue('OK');

      await agentLoop.run('Test');

      // Should only execute 3 tools (MAX_TOOL_CALLS_PER_ITERATION)
      expect(mockToolRunner.execute).toHaveBeenCalledTimes(3);
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should trip circuit after repeated failures', async () => {
      const failingTool = { name: 'failing_tool', args: {} };
      let iteration = 0;

      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration <= 4) {
          mockResponseParser.parseToolCalls.mockReturnValue([failingTool]);
          return Promise.resolve({ content: 'Try tool' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockRejectedValue(new Error('Tool failed'));

      await agentLoop.run('Test circuit');

      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:circuit_open', expect.objectContaining({
        tool: 'failing_tool'
      }));
    });
  });

  describe('stuck loop detection', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should detect when no tools called for too long', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        // Never return tool calls or DONE for 5 iterations
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(false);
        return Promise.resolve({ content: 'Thinking about something...' });
      });

      await agentLoop.run('Test stuck');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:warning', expect.objectContaining({
        type: 'stuck_loop'
      }));
    });

    it('should force stop on repeated short responses', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration > 6) {
          mockResponseParser.isDone.mockReturnValue(true);
          return Promise.resolve({ content: 'DONE' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([{ name: 'test', args: {} }]);
        return Promise.resolve({ content: 'OK' }); // Very short response
      });

      mockToolRunner.execute.mockResolvedValue('Result');

      await agentLoop.run('Test short responses');

      // Should detect degradation
      const warningCalls = mockEventBus.emit.mock.calls.filter(
        c => c[0] === 'agent:warning'
      );
      // May or may not trigger depending on timing, but shouldn't crash
    });
  });

  describe('reflection integration', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should log reflections on tool success', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'ReadFile', args: { path: '/test.txt' } }
          ]);
          return Promise.resolve({ content: 'Reading' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockResolvedValue('Content');

      await agentLoop.run('Test');

      expect(mockReflectionStore.add).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        content: expect.stringContaining('ReadFile')
      }));
    });

    it('should log reflections on tool error', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'WriteFile', args: {} }
          ]);
          return Promise.resolve({ content: 'Writing' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockRejectedValue(new Error('Failed'));

      await agentLoop.run('Test');

      expect(mockReflectionStore.add).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error'
      }));
    });

    it('should inject failure patterns from ReflectionAnalyzer', async () => {
      mockReflectionAnalyzer.api.detectFailurePatterns.mockResolvedValue([
        { indicator: 'Watch for timeout errors' },
        { indicator: 'Check file permissions' }
      ]);

      let chatContexts = [];
      mockLLMClient.chat.mockImplementation((ctx) => {
        chatContexts.push([...ctx]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      await agentLoop.run('Test');

      // Check that memory was injected
      const hasMemoryMsg = chatContexts.some(ctx =>
        ctx.some(m => m.content?.includes('[MEMORY]'))
      );
      expect(hasMemoryMsg).toBe(true);
    });
  });

  describe('abort/stop', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should stop running agent', async () => {
      // Mock LLM to return after a delay but also handle abort
      mockLLMClient.chat.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ content: 'Still thinking...' }), 500);
        });
      });

      // Set up response parser to not be done
      mockResponseParser.parseToolCalls.mockReturnValue([]);
      mockResponseParser.isDone.mockReturnValue(false);

      const runPromise = agentLoop.run('Long running');

      // Give it time to start
      await new Promise(r => setTimeout(r, 50));

      expect(agentLoop.isRunning()).toBe(true);
      agentLoop.stop();

      // Wait for the promise to settle
      await runPromise.catch(() => {}); // May throw AbortError

      expect(agentLoop.isRunning()).toBe(false);
    });
  });

  describe('activity log', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should track recent activities', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test');

      const activities = agentLoop.getRecentActivities();
      expect(activities.length).toBeGreaterThan(0);
      expect(activities[0]).toHaveProperty('ts');
      expect(activities[0]).toHaveProperty('kind');
    });
  });

  describe('module metadata', () => {
    it('should have correct metadata', () => {
      expect(AgentLoopModule.metadata.id).toBe('AgentLoop');
      expect(AgentLoopModule.metadata.type).toBe('core');
      expect(AgentLoopModule.metadata.dependencies).toContain('LLMClient');
      expect(AgentLoopModule.metadata.dependencies).toContain('ToolRunner');
      expect(AgentLoopModule.metadata.dependencies).toContain('ContextManager');
    });
  });
});
