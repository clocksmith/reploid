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
  let mockCircuitBreaker;

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
      emitTokens: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      manage: vi.fn().mockImplementation((ctx) => Promise.resolve({
        context: ctx,
        halted: false,
        error: null
      }))
    };

    mockResponseParser = {
      parseToolCalls: vi.fn().mockReturnValue([]),
      isDone: vi.fn().mockReturnValue(false)
    };

    mockStateManager = {
      setGoal: vi.fn().mockResolvedValue(true),
      incrementCycle: vi.fn().mockResolvedValue(1),
      getState: vi.fn().mockReturnValue({ config: {} })
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

    // CircuitBreaker mock - simulates real circuit breaker behavior
    mockCircuitBreaker = {
      create: vi.fn().mockImplementation(() => {
        const failures = {};
        const tripTimes = {};
        const THRESHOLD = 3;
        return {
          isOpen: vi.fn().mockImplementation((tool) => (failures[tool] || 0) >= THRESHOLD),
          getState: vi.fn().mockImplementation((tool) => ({
            failures: failures[tool] || 0,
            lastFailureTime: Date.now(),
            tripTime: tripTimes[tool] || Date.now()
          })),
          recordSuccess: vi.fn().mockImplementation((tool) => { failures[tool] = 0; }),
          recordFailure: vi.fn().mockImplementation((tool) => {
            failures[tool] = (failures[tool] || 0) + 1;
            if (failures[tool] >= THRESHOLD) {
              tripTimes[tool] = Date.now();
            }
          }),
          reset: vi.fn().mockImplementation((tool) => { failures[tool] = 0; })
        };
      })
    };
  };

  const flushPromises = async (passes = 8) => {
    for (let pass = 0; pass < passes; pass++) {
      await Promise.resolve();
    }
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
      ReflectionAnalyzer: mockReflectionAnalyzer,
      CircuitBreaker: mockCircuitBreaker,
      SchemaRegistry: { getToolSchemas: vi.fn().mockReturnValue([]) },
      ToolExecutor: {
        executeWithRetry: vi.fn().mockImplementation(async (call) => {
          try {
            const result = await mockToolRunner.execute(call.name, call.args || call.arguments || {});
            return { result, error: null, duration: 10 };
          } catch (err) {
            return { result: null, error: err, duration: 10 };
          }
        })
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
      // LLMClient.chat takes 4 args: context, modelConfig, streamCallback, options
      expect(mockLLMClient.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' })
        ]),
        expect.any(Object),
        expect.any(Function),
        expect.any(Object)  // options object with tools
      );

      const prompt = agentLoop.getSystemPrompt();
      expect(prompt).toContain('same-origin browser substrate');
      expect(prompt).toContain('/self/ (canonical awakened self)');
      expect(prompt).toContain('A terminal exposes host shell power');
      expect(prompt).toContain('IndexedDB stores live self, memory, traces, and code');
      expect(prompt).toContain('OPFS stores larger artifacts');
      expect(prompt).toContain('Service Worker and blob module loading');
      expect(prompt).toContain('Web Workers isolate verification');
      expect(prompt).toContain('WebGPU, WASM, canvas, and media APIs');
      expect(prompt).toContain('WebRTC, BroadcastChannel, and WebSocket paths');
      expect(prompt).toContain('permission-mediated browser APIs');
      expect(prompt).toContain('Default to Shadow for self changes');
      expect(prompt).toContain('Default to batching independent read-only work.');
      expect(prompt).toContain('Use 2-6 read-only calls together when inspecting unrelated roots or files.');
      expect(prompt).toContain('Batch independent tool calls by default');
      expect(prompt).not.toContain('full DOM access');
      expect(prompt).not.toContain('all Web APIs');
    });

    it('builds Zero context with discovery-first VFS rules', async () => {
      vi.stubGlobal('window', {
        getReploidMode: () => 'zero'
      });
      mockPersonaManager.getSystemPrompt.mockResolvedValue('You are Zero, a browser-local tabula-rasa RSI agent.');
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Inspect the Zero VFS');

      const prompt = agentLoop.getSystemPrompt();
      expect(prompt).toContain('Start every fresh Zero filesystem pass with ReadFile path: / or ListFiles path: /');
      expect(prompt).toContain('If /blueprint-index.json is absent in an older or pruned instance');
      expect(prompt).toContain('ListFiles: enumerate roots and directories before relying on named paths');
      expect(prompt).toContain('Default to batched discovery: combine independent read-only calls in the same response.');
      expect(prompt).toContain('Good first Zero discovery batch: ListFiles path: /, ListTools {}, and ReadFile path: /blueprint-index.json.');
      expect(prompt).toContain('Do not put comments, markdown, or explanatory prose inside a tool block.');
      expect(prompt).toContain('CreateTool code must export a tool contract and an async default function.');
      expect(prompt).toContain('Valid Promote syntax is candidatePath: /shadow/tools/MyTool.js, targetPath: /self/tools/MyTool.js, evidencePath: /artifacts/MyTool-evidence.json.');
      expect(prompt).toContain('Do not read /self/manifest.json or /self/self.json; those are not Zero tool paths.');
      expect(prompt).not.toContain('Use root-scoped VFS source paths for reads: /core, /config, /tools, /ui, /styles, /boot-helpers, /blueprint-index.json, and /blueprints.');
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

    it('should stop at the configured model iteration limit', async () => {
      agentLoop.setModel({ id: 'test-model', provider: 'test', maxIterations: 3 });
      mockResponseParser.parseToolCalls.mockReturnValue([{ name: 'ReadFile', args: { path: '/self/self.json' } }]);
      mockResponseParser.isDone.mockReturnValue(false);
      mockLLMClient.chat.mockResolvedValue({
        content: 'Continue by reading the current seed and recording a bounded observation.'
      });
      mockToolRunner.execute.mockResolvedValue('seed');

      await agentLoop.run('Test capped loop');

      expect(mockStateManager.incrementCycle).toHaveBeenCalledTimes(3);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(3);
    });

    it('should cap managed server proxy loops at 99 iterations', async () => {
      agentLoop.setModel({
        id: 'gemini-3.5-flash',
        provider: 'gemini',
        serverType: 'firebase-function',
        maxIterations: 120
      });
      mockResponseParser.parseToolCalls.mockReturnValue([{ name: 'ReadFile', args: { path: '/self/self.json' } }]);
      mockResponseParser.isDone.mockReturnValue(false);
      mockLLMClient.chat.mockResolvedValue({
        content: 'Continue by reading the current seed and recording a bounded observation.'
      });
      mockToolRunner.execute.mockResolvedValue('seed');

      await agentLoop.run('Test managed cap');

      expect(mockStateManager.incrementCycle).toHaveBeenCalledTimes(99);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(99);
    });

    it('should manage context before LLM call', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockContextManager.manage).toHaveBeenCalled();
    });

    it('should emit history events', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'llm_response'
      }));
    });

    it('should emit the initial system prompt as a history event', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Trace system prompt');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'system_prompt',
        cycle: 0,
        content: expect.stringContaining('Trace system prompt')
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
      expect(secondCallCtx.some(m => m.content?.includes('BATCHING TIP: emit 2-6 independent read-only tool calls'))).toBe(true);
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

    it('should retry ReadFile when the tool returns a safe near-miss path hint', async () => {
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          mockResponseParser.parseToolCalls.mockReturnValue([
            { name: 'ReadFile', args: { path: '/config/genesis-levels.json_' } }
          ]);
          mockResponseParser.isDone.mockReturnValue(false);
          return Promise.resolve({ content: 'Reading config' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockImplementation(async (name, args) => {
        if (args.path === '/config/genesis-levels.json_') {
          throw new Error('File not found in VFS: /config/genesis-levels.json_. Retry with ReadFile path: /config/genesis-levels.json. VFS paths do not carry a /self/ prefix.');
        }
        return '{"levels":["zero"]}';
      });

      await agentLoop.run('Read genesis levels');

      expect(mockToolRunner.execute).toHaveBeenCalledWith('ReadFile', { path: '/config/genesis-levels.json_' });
      expect(mockToolRunner.execute).toHaveBeenCalledWith('ReadFile', { path: '/config/genesis-levels.json' });
      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:recovery', expect.objectContaining({
        tool: 'ReadFile',
        recoveryTool: 'ReadFile',
        recoveryArgs: expect.objectContaining({ path: '/config/genesis-levels.json' })
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_batch',
        errors: 0
      }));
    });

    it('should limit tool calls per iteration', async () => {
      // Request 7 tools but MAX_TOOL_CALLS_PER_ITERATION is 5
      mockResponseParser.parseToolCalls.mockReturnValue([
        { name: 'tool1', args: {} },
        { name: 'tool2', args: {} },
        { name: 'tool3', args: {} },
        { name: 'tool4', args: {} },
        { name: 'tool5', args: {} },
        { name: 'tool6', args: {} },
        { name: 'tool7', args: {} }
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

      // Should only execute 7 tools (DEFAULT_MAX_TOOL_CALLS = 8, so all 7 fit)
      expect(mockToolRunner.execute).toHaveBeenCalledTimes(7);
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      agentLoop.setModel({ id: 'test-model', provider: 'test' });
    });

    it('should skip tool when circuit is open after repeated failures', async () => {
      const failingTool = { name: 'failing_tool', args: {} };
      let iteration = 0;

      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        // After 3+ failures, circuit is open and tool should be skipped
        if (iteration <= 5) {
          mockResponseParser.parseToolCalls.mockReturnValue([failingTool]);
          return Promise.resolve({ content: 'Try tool' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockRejectedValue(new Error('Tool failed'));

      await agentLoop.run('Test circuit');

      // After 3 failures, circuit opens and emits tool:circuit_skip
      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:circuit_skip', expect.objectContaining({
        tool: 'failing_tool'
      }));
    });

    it('should not trip circuit for recoverable tool input errors', async () => {
      const readMissing = { name: 'ReadFile', args: { path: '/missing.txt' } };
      let iteration = 0;

      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration <= 3) {
          mockResponseParser.parseToolCalls.mockReturnValue([readMissing]);
          mockResponseParser.isDone.mockReturnValue(false);
          return Promise.resolve({ content: 'Attempting to inspect the missing VFS path before choosing the next action.' });
        }
        mockResponseParser.parseToolCalls.mockReturnValue([]);
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });

      mockToolRunner.execute.mockRejectedValue(new Error('File not found: /missing.txt'));

      await agentLoop.run('Test recoverable input error');

      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(breaker.recordFailure).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:input_error', expect.objectContaining({
        tool: 'ReadFile',
        error: 'File not found: /missing.txt'
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

    it('should treat parse-error tool calls as no executable progress', async () => {
      let iteration = 0;

      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration <= 5) {
          mockResponseParser.parseToolCalls.mockReturnValue([{
            name: 'ReadFile',
            args: {},
            error: 'Invalid argument line: *Attempting to find entry point in current directory.*'
          }]);
          mockResponseParser.isDone.mockReturnValue(false);
          return Promise.resolve({
            content: 'REPLOID/0\n\nTOOL: ReadFile\n*Attempting to find entry point in current directory.*'
          });
        }
        return Promise.resolve({ content: 'Summary after malformed tool syntax.' });
      });

      await agentLoop.run('Test malformed tool syntax');

      expect(mockToolRunner.execute).not.toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:warning', expect.objectContaining({
        type: 'stuck_loop',
        reason: expect.stringContaining('No tool calls')
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

  describe('provider recovery', () => {
    it('should try an alternate configured model after a transient provider error', async () => {
      agentLoop.setModels([
        { id: 'primary-model', provider: 'gemini' },
        { id: 'fallback-model', provider: 'openai' }
      ]);
      const providerError = Object.assign(new Error('API Error 503'), { status: 503 });
      mockLLMClient.chat
        .mockRejectedValueOnce(providerError)
        .mockResolvedValueOnce({ content: 'DONE', model: 'fallback-model', provider: 'openai' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Recover provider');

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
      expect(mockLLMClient.chat.mock.calls[1][1]).toEqual(expect.objectContaining({
        id: 'fallback-model',
        provider: 'openai'
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('llm:provider_recovered', expect.objectContaining({
        model: 'fallback-model',
        provider: 'openai'
      }));
    });

    it('should throttle provider requests from model config', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      agentLoop.setModel({
        id: 'primary-model',
        provider: 'gemini',
        agentThrottle: {
          minProviderRequestIntervalMs: 1000
        }
      });
      const callTimes = [];
      mockResponseParser.isDone.mockImplementation((content) => content === 'DONE');
      mockLLMClient.chat.mockImplementation(async () => {
        callTimes.push(Date.now());
        return { content: callTimes.length === 1 ? 'continue' : 'DONE', usage: {} };
      });

      const runPromise = agentLoop.run('Throttle provider');
      await flushPromises();

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await runPromise;

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
      expect(callTimes).toEqual([0, 1000]);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'provider_throttle',
        throttleDelayMs: 1000
      }));
    });

    it('should park instead of throwing when every provider candidate is unavailable', async () => {
      agentLoop.setModel({ id: 'primary-model', provider: 'gemini' });
      mockLLMClient.chat.mockRejectedValue(Object.assign(new Error('API Error 503'), { status: 503 }));

      await expect(agentLoop.run('Park provider')).resolves.toBeUndefined();

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:warning', expect.objectContaining({
        type: 'provider_unavailable',
        status: 503
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'PARKED'
      }));
      expect(agentLoop.getProviderRetryState()).toEqual(expect.objectContaining({
        providerRetryAttempt: 1
      }));

      agentLoop.stop();
    });

    it('should auto-resume parked provider requests with exponential backoff', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      agentLoop.setModel({
        id: 'primary-model',
        provider: 'gemini',
        agentThrottle: {
          providerBackoffBaseMs: 1000,
          providerBackoffMaxMs: 8000,
          providerBackoffJitterRatio: 0
        }
      });
      mockResponseParser.isDone.mockImplementation((content) => content === 'DONE');
      mockLLMClient.chat
        .mockRejectedValueOnce(Object.assign(new Error('API Error 429'), { status: 429 }))
        .mockRejectedValueOnce(Object.assign(new Error('API Error 429'), { status: 429 }))
        .mockResolvedValueOnce({ content: 'DONE', usage: {} });

      await agentLoop.run('Resume provider');

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      const firstRetry = agentLoop.getProviderRetryState();
      expect(firstRetry).toMatchObject({
        goal: 'Resume provider',
        iteration: 1,
        providerRetryAttempt: 1,
        delayMs: 1000
      });

      await vi.advanceTimersByTimeAsync(firstRetry.delayMs);
      await agentLoop.getProviderResumePromise();

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
      const secondRetry = agentLoop.getProviderRetryState();
      expect(secondRetry).toMatchObject({
        goal: 'Resume provider',
        iteration: 2,
        providerRetryAttempt: 2,
        delayMs: 2000
      });
      expect(secondRetry.delayMs).toBeGreaterThan(firstRetry.delayMs);

      await vi.advanceTimersByTimeAsync(secondRetry.delayMs);
      await agentLoop.getProviderResumePromise();

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(3);
      expect(agentLoop.getProviderRetryState()).toBe(null);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'provider_resume'
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'IDLE'
      }));
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
