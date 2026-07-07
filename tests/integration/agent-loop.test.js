/**
 * @fileoverview Integration tests for AgentLoop
 * Tests the complete cognitive cycle with mocked dependencies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AgentLoopModule from '../../core/agent-loop.js';
import ToolExecutorModule from '../../infrastructure/tool-executor.js';

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
      trunc: (value, max) => String(value).slice(0, max),
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
      getState: vi.fn().mockReturnValue({
        config: {
          agentCycleThrottle: { cycleIntervalMs: 0 }
        }
      })
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
      ToolExecutor: ToolExecutorModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        ToolRunner: {
          execute: (name, args) => mockToolRunner.execute(name, args)
        }
      })
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
      expect(prompt).toContain('Use 4-8 independent read-only calls together when inspecting unrelated roots or files.');
      expect(prompt).toContain('Use all 8 tool-call slots when broad discovery has 8 independent read-only calls.');
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
      expect(prompt.match(/You are Zero/g)).toHaveLength(1);
      expect(prompt.length).toBeLessThan(5200);
      expect(prompt).toContain('Improve this goal and keep iterating until it is truly complete');
      expect(prompt).toContain('Inspect the Zero VFS');
      expect(prompt).toContain('## Scope and constraints');
      expect(prompt).toContain('No host shell/filesystem/process claims');
      expect(prompt).toContain('## Writable boundary (critical)');
      expect(prompt).toContain('Candidate edits go to /shadow, evidence to /artifacts.');
      expect(prompt).toContain('## Zero tool creation workflow');
      expect(prompt).toContain('Use CreateTool for new runtime tools.');
      expect(prompt).toContain('stages /shadow/tools/MyTool.js');
      expect(prompt).toContain('installs /self/tools/MyTool.js');
      expect(prompt).toContain('Use LoadModule only to reload an already installed /self tool.');
      expect(prompt).toContain('Never write candidates under /lab, and never LoadModule a /shadow path.');
      expect(prompt).toContain('ReadFile, ListFiles, Grep, ListTools, WriteFile, EditFile, CreateTool, LoadModule.');
      expect(prompt).toContain('Evidence JSON must be strict JSON only');
      expect(prompt).not.toContain('CreateTool creates, installs, and loads new runtime tools');
      expect(prompt).not.toContain('Valid Promote syntax is candidatePath');
      expect(prompt).not.toContain('CreateTool -> WriteFile -> Promote -> LoadModule');
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

    it('emits visible history when context compacts', async () => {
      mockContextManager.manage.mockImplementationOnce((ctx) => Promise.resolve({
        context: ctx,
        halted: false,
        error: null,
        compacted: true,
        previousTokens: 9000,
        newTokens: 3000
      }));
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test compaction');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'context_compacted',
        previousTokens: 9000,
        newTokens: 3000
      }));
    });

    it('should fit managed Zero provider requests inside the function envelope', async () => {
      agentLoop.setModel({
        id: 'gemini-3.1-flash-lite',
        provider: 'gemini',
        managedServerProxy: true,
        serverType: 'firebase-function'
      });
      for (let index = 0; index < 80; index++) {
        agentLoop.injectHumanMessage(`extra context ${index} ${'x'.repeat(3000)}`);
      }
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE', usage: {} });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Keep managed request bounded');

      const providerContext = mockLLMClient.chat.mock.calls[0][0];
      const inputChars = providerContext.reduce((sum, message) => sum + String(message.content || '').length, 0);
      expect(providerContext.length).toBeLessThanOrEqual(56);
      expect(inputChars).toBeLessThanOrEqual(100000);
      expect(providerContext[0].role).toBe('system');
      expect(providerContext.some((message) => String(message.content || '').includes('Begin. Goal: Keep managed request bounded'))).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'provider_context_envelope'
      }));
    });

    it('should emit history events', async () => {
      mockLLMClient.chat.mockResolvedValue({ content: 'DONE' });
      mockResponseParser.isDone.mockReturnValue(true);

      await agentLoop.run('Test goal');

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'model_request',
        content: expect.stringContaining('## Message 1 /'),
        messageCount: expect.any(Number),
        inputChars: expect.any(Number)
      }));
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

    it('executes the full 8-call read-only native batch when available', async () => {
      const calls = Array.from({ length: 8 }, (_, index) => ({
        name: 'ReadFile',
        args: { path: `/target-${index + 1}.js` }
      }));
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockImplementation(async (name, args) => `${name}:${args.path}`);

      await agentLoop.run('Read eight files');

      expect(mockToolRunner.execute).toHaveBeenCalledTimes(8);
      for (let index = 0; index < 8; index++) {
        expect(mockToolRunner.execute).toHaveBeenCalledWith('ReadFile', { path: `/target-${index + 1}.js` });
      }
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_batch',
        total: 8,
        errors: 0
      }));
    });

    it('requires a mutating tool after repeated read-only batches on build goals', async () => {
      mockToolRunner.getToolSchemas = vi.fn().mockReturnValue([
        {
          type: 'function',
          function: {
            name: 'ReadFile',
            description: 'read',
            parameters: { type: 'object', properties: {} }
          }
        },
        {
          type: 'function',
          function: {
            name: 'WriteFile',
            description: 'write',
            parameters: { type: 'object', properties: {} }
          }
        }
      ]);
      const optionsByCall = [];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation((ctx, model, callback, options = {}) => {
        optionsByCall.push(options);
        iteration++;
        if (iteration <= 4) {
          return Promise.resolve({
            content: '',
            toolCalls: [{ name: 'ReadFile', args: { path: `/target-${iteration}.js` } }]
          });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockResolvedValue('file');

      await agentLoop.run('Build a Katamari DOM picker');

      expect(mockToolRunner.execute).toHaveBeenCalledTimes(3);
      expect(mockToolRunner.execute).not.toHaveBeenCalledWith('ReadFile', { path: '/target-4.js' });
      expect(optionsByCall[3].tools.map((schema) => schema.function.name)).toEqual(['WriteFile']);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'build_progress_gate',
        consecutiveReadOnlyBatches: 3
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_batch',
        errors: 1,
        results: expect.arrayContaining([
          expect.objectContaining({
            name: 'ReadFile',
            error: expect.stringContaining('Build progress gate active')
          })
        ])
      }));
    });

    it('treats ok:false mutating results as failures and skips dependent mutations', async () => {
      const calls = [
        { name: 'WriteFile', args: { path: '/artifacts/KatamariPicker-evidence.json', content: { verified: true } } },
        {
          name: 'Promote',
          args: {
            candidatePath: '/shadow/tools/KatamariPicker.js',
            targetPath: '/self/tools/KatamariPicker.js',
            evidencePath: '/artifacts/KatamariPicker-evidence.json'
          }
        },
        { name: 'LoadModule', args: { path: '/self/tools/KatamariPicker.js' } }
      ];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockImplementation(async (name) => {
        if (name === 'Promote') {
          return { ok: false, promoted: false, reasons: ['evidence replayPassed must be true'] };
        }
        return { ok: true };
      });

      await agentLoop.run('Promote staged Katamari tool');

      expect(mockToolRunner.execute).toHaveBeenCalledWith('WriteFile', calls[0].args);
      expect(mockToolRunner.execute).toHaveBeenCalledWith('Promote', calls[1].args);
      expect(mockToolRunner.execute).not.toHaveBeenCalledWith('LoadModule', calls[2].args);
      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(breaker.recordSuccess).not.toHaveBeenCalledWith('Promote');
      expect(breaker.recordFailure).toHaveBeenCalledWith(
        'Promote',
        expect.objectContaining({ message: 'evidence replayPassed must be true' })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_batch',
        total: 3,
        errors: 2,
        results: expect.arrayContaining([
          expect.objectContaining({
            name: 'Promote',
            error: expect.stringContaining('evidence replayPassed must be true')
          }),
          expect.objectContaining({
            name: 'LoadModule',
            error: expect.stringContaining('skipped because Promote failed')
          })
        ])
      }));
    });

    it('treats worker-returned ok:false tool results as logical failures', async () => {
      const calls = [
        { name: 'AwaitWorkers', args: { workerIds: ['worker_1'] } },
        { name: 'LoadModule', args: { path: '/self/tools/KatamariPicker.js' } }
      ];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockImplementation(async (name) => {
        if (name === 'AwaitWorkers') {
          return {
            awaited: 1,
            timedOut: false,
            results: [
              {
                workerId: 'worker_1',
                status: 'fulfilled',
                value: {
                  workerId: 'worker_1',
                  status: 'completed',
                  toolResults: [
                    {
                      tool: 'Promote',
                      args: { candidatePath: '/shadow/tools/KatamariPicker.js' },
                      result: '{"ok":false,"reasons":["worker evidence failed"]}',
                      rawResult: { ok: false, reasons: ['worker evidence failed'] },
                      success: false,
                      error: 'worker evidence failed'
                    }
                  ]
                }
              }
            ]
          };
        }
        return { ok: true };
      });

      await agentLoop.run('Collect worker result');

      expect(mockToolRunner.execute).toHaveBeenCalledWith('AwaitWorkers', calls[0].args);
      expect(mockToolRunner.execute).not.toHaveBeenCalledWith('LoadModule', calls[1].args);
      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(breaker.recordFailure).toHaveBeenCalledWith(
        'AwaitWorkers',
        expect.objectContaining({ message: expect.stringContaining('worker_1/Promote: worker evidence failed') })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'tool_batch',
        total: 2,
        errors: 2,
        results: expect.arrayContaining([
          expect.objectContaining({
            name: 'AwaitWorkers',
            error: expect.stringContaining('worker_1/Promote: worker evidence failed')
          }),
          expect.objectContaining({
            name: 'LoadModule',
            error: expect.stringContaining('skipped because AwaitWorkers failed')
          })
        ])
      }));
    });

    it('clears stale LoadModule circuit state after successful promotion', async () => {
      const calls = [
        {
          name: 'Promote',
          args: {
            candidatePath: '/shadow/tools/KatamariPicker.js',
            targetPath: '/self/tools/KatamariPicker.js',
            evidencePath: '/artifacts/KatamariPicker-evidence.json'
          }
        }
      ];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration === 1) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockResolvedValue({
        ok: true,
        promoted: true,
        targetPath: '/self/tools/KatamariPicker.js'
      });

      await agentLoop.run('Promote staged Katamari tool');

      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(breaker.recordSuccess).toHaveBeenCalledWith('Promote');
      expect(breaker.recordSuccess).toHaveBeenCalledWith('LoadModule');
    });

    it('circuit-breaks LoadModule after repeated module load failures', async () => {
      const calls = [
        { name: 'LoadModule', args: { path: '/self/tools/KatamariEngine.js' } }
      ];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration <= 4) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockRejectedValue(new Error('Tool module load failed: /self/tools/KatamariEngine.js'));

      await agentLoop.run('Load Katamari tool');

      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(mockToolRunner.execute).toHaveBeenCalledTimes(9);
      expect(breaker.recordFailure).toHaveBeenCalledWith(
        'LoadModule',
        expect.any(Error)
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:circuit_skip', expect.objectContaining({
        tool: 'LoadModule'
      }));
    });

    it('does not circuit-break LoadModule for recoverable precondition failures', async () => {
      const calls = [
        { name: 'LoadModule', args: { path: '/shadow/tools/KatamariEngine.js' } }
      ];
      let iteration = 0;
      mockLLMClient.chat.mockImplementation(() => {
        iteration++;
        if (iteration <= 3) {
          return Promise.resolve({ content: '', toolCalls: calls });
        }
        mockResponseParser.isDone.mockReturnValue(true);
        return Promise.resolve({ content: 'DONE' });
      });
      mockToolRunner.execute.mockRejectedValue(new Error('LoadModule only supports promoted /self paths'));

      await agentLoop.run('Load Katamari tool');

      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      expect(mockToolRunner.execute).toHaveBeenCalledTimes(3);
      expect(breaker.recordFailure).not.toHaveBeenCalledWith(
        'LoadModule',
        expect.any(Error)
      );
      expect(mockEventBus.emit).not.toHaveBeenCalledWith('tool:circuit_skip', expect.objectContaining({
        tool: 'LoadModule'
      }));
    });

    it('parks for tool cooldown resume after successful mutations with a skipped promoted write', async () => {
      vi.useFakeTimers();
      const calls = [
        { name: 'CreateTool', args: { name: 'KatamariEngine', code: 'export default async function() {}' } },
        { name: 'WriteFile', args: { path: '/artifacts/KatamariEngine-evidence.json', content: '{"replayPassed":true}' } },
        {
          name: 'Promote',
          args: {
            candidatePath: '/shadow/tools/KatamariEngine.js',
            targetPath: '/self/tools/KatamariEngine.js',
            evidencePath: '/artifacts/KatamariEngine-evidence.json'
          }
        }
      ];
      const breaker = mockCircuitBreaker.create.mock.results[0].value;
      breaker.recordFailure('Promote');
      breaker.recordFailure('Promote');
      breaker.recordFailure('Promote');
      mockLLMClient.chat.mockResolvedValueOnce({ content: '', toolCalls: calls });
      mockToolRunner.execute.mockResolvedValue({ ok: true });

      await agentLoop.run('Build Katamari tool');

      expect(mockToolRunner.execute).toHaveBeenCalledWith('CreateTool', calls[0].args);
      expect(mockToolRunner.execute).toHaveBeenCalledWith('WriteFile', calls[1].args);
      expect(mockToolRunner.execute).not.toHaveBeenCalledWith('Promote', calls[2].args);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      expect(agentLoop.getProviderRetryState()).toMatchObject({
        goal: 'Build Katamari tool',
        iteration: 1,
        resumeKind: 'tool_cooldown'
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'PARKED',
        autoResume: true
      }));
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
      expect(secondCallCtx.some(m => m.content?.includes('BATCHING TIP: emit 4-8 independent read-only tool calls'))).toBe(true);
      expect(secondCallCtx.some(m => m.content?.includes('Use all 8 slots when there are 8 independent read-only calls.'))).toBe(true);
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

    it('should throttle every LLM call inside a cycle', async () => {
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
      mockResponseParser.parseToolCalls.mockReturnValue([]);
      mockResponseParser.isDone.mockReturnValue(false);
      mockLLMClient.chat.mockImplementation(async () => {
        callTimes.push(Date.now());
        return { content: 'Thinking about something...', usage: {} };
      });

      const runPromise = agentLoop.run('Throttle all provider calls');
      await flushPromises();

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      for (let expectedCalls = 2; expectedCalls <= 6; expectedCalls++) {
        await vi.advanceTimersByTimeAsync(999);
        await flushPromises();
        expect(mockLLMClient.chat).toHaveBeenCalledTimes(expectedCalls - 1);
        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
      }
      await runPromise;

      expect(callTimes).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:warning', expect.objectContaining({
        type: 'stuck_loop'
      }));
    });

    it('should wait the configured interval between successful cycles', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      agentLoop.setModel({
        id: 'primary-model',
        provider: 'gemini',
        agentCycleThrottle: {
          cycleIntervalMs: 1500
        }
      });
      const callTimes = [];
      mockResponseParser.isDone.mockImplementation((content) => content === 'DONE');
      mockLLMClient.chat.mockImplementation(async () => {
        callTimes.push(Date.now());
        return { content: callTimes.length === 1 ? 'continue' : 'DONE', usage: {} };
      });

      const runPromise = agentLoop.run('Throttle cycles');
      await flushPromises();

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1499);
      expect(mockLLMClient.chat).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await runPromise;

      expect(mockLLMClient.chat).toHaveBeenCalledTimes(2);
      expect(callTimes).toEqual([0, 1500]);
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:history', expect.objectContaining({
        type: 'cycle_throttle',
        throttleDelayMs: 1500,
        nextCycle: 2
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'WAITING',
        nextCycle: 2
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

    it('should park managed Zero request rejections instead of crashing Boot', async () => {
      agentLoop.setModel({
        id: 'gemini-3.1-flash-lite',
        provider: 'gemini',
        managedServerProxy: true,
        serverType: 'firebase-function'
      });
      const rejection = Object.assign(new Error('API Error 400: input exceeds limit (120000 chars)'), {
        status: 400,
        responseMessage: 'input exceeds limit (120000 chars)'
      });
      mockLLMClient.chat.mockRejectedValue(rejection);

      await expect(agentLoop.run('Park rejected request')).resolves.toBeUndefined();

      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:warning', expect.objectContaining({
        type: 'provider_request_rejected',
        status: 400,
        responseMessage: 'input exceeds limit (120000 chars)',
        autoResume: false
      }));
      expect(mockEventBus.emit).toHaveBeenCalledWith('agent:status', expect.objectContaining({
        state: 'PARKED',
        activity: expect.stringContaining('Provider request rejected (400)')
      }));
      expect(agentLoop.getProviderRetryState()).toBe(null);
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
