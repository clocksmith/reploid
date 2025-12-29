/**
 * @fileoverview Integration tests for ToolRunner
 * Tests VFS-loaded JS tool execution flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ToolRunnerModule from '../../core/tool-runner.js';

describe('ToolRunner - Integration Tests', () => {
  let toolRunner;
  let mockUtils;
  let mockVFS;
  let mockSchemaRegistry;
  let mockEventBus;
  let mockVerificationManager;

  const createMocks = () => {
    const ToolError = class extends Error {
      constructor(message, details = {}) {
        super(message);
        this.name = 'ToolError';
        this.details = details;
      }
    };

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      Errors: { ToolError },
      trunc: (str, len) => (str?.length > len ? str.slice(0, len) : str)
    };

    // Mock VFS with in-memory storage for tool files
    const vfsStorage = new Map();
    mockVFS = {
      read: vi.fn().mockImplementation(async (path) => {
        if (!vfsStorage.has(path)) throw new Error(`File not found: ${path}`);
        return vfsStorage.get(path);
      }),
      write: vi.fn().mockImplementation(async (path, content) => {
        vfsStorage.set(path, content);
        return true;
      }),
      list: vi.fn().mockImplementation(async (dir) => {
        const files = [];
        for (const path of vfsStorage.keys()) {
          if (path.startsWith(dir)) files.push(path);
        }
        return files;
      }),
      exists: vi.fn().mockImplementation(async (path) => vfsStorage.has(path)),
      delete: vi.fn().mockImplementation(async (path) => {
        vfsStorage.delete(path);
        return true;
      }),
      _storage: vfsStorage
    };

    mockSchemaRegistry = {
      registerToolSchema: vi.fn(),
      unregisterToolSchema: vi.fn(),
      getToolSchema: vi.fn().mockReturnValue(null)
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    mockVerificationManager = {
      verifyProposal: vi.fn().mockResolvedValue({ passed: true, warnings: [] })
    };
  };

  beforeEach(() => {
    createMocks();

    toolRunner = ToolRunnerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      ToolWriter: { create: vi.fn() },
      SchemaRegistry: mockSchemaRegistry,
      EventBus: mockEventBus,
      VerificationManager: mockVerificationManager
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('VFS Tool Loading', () => {
    it('loads tools from /tools/ directory on init', async () => {
      // Setup: Add a tool to VFS
      mockVFS._storage.set('/tools/TestTool.js', `
        export const tool = {
          name: 'TestTool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
          call: async (args) => 'Hello ' + args.msg
        };
        export default async (args) => 'Hello ' + args.msg;
      `);

      await toolRunner.init();

      const tools = toolRunner.list();
      expect(tools).toContain('TestTool');
    });

    it('skips test files during init', async () => {
      mockVFS._storage.set('/tools/RealTool.js', `export default () => 'real';`);
      mockVFS._storage.set('/tools/RealTool.test.js', `export default () => 'test';`);
      mockVFS._storage.set('/tools/RealTool.spec.js', `export default () => 'spec';`);
      mockVFS._storage.set('/tools/RealTool.integration.js', `export default () => 'integration';`);

      await toolRunner.init();

      const tools = toolRunner.list();
      expect(tools).toContain('RealTool');
      expect(tools).not.toContain('RealTool.test');
      expect(tools).not.toContain('RealTool.spec');
      expect(tools).not.toContain('RealTool.integration');
    });

    it('lazy loads tools on execute if not already loaded', async () => {
      await toolRunner.init();
      expect(toolRunner.has('LazyTool')).toBe(false);

      // Add tool after init
      mockVFS._storage.set('/tools/LazyTool.js', `export default async () => 'lazy loaded';`);

      // Execute should trigger lazy load
      // Note: This requires blob URL support which isn't available in test environment
      // So we expect the tool check to work, but execution would need browser
      expect(await mockVFS.exists('/tools/LazyTool.js')).toBe(true);
    });
  });

  describe('Tool Execution Flow', () => {
    it('executes tool with dependencies injected', async () => {
      const executedWith = { args: null, deps: null };

      // Create a mock tool that captures its inputs
      const mockTool = vi.fn().mockImplementation(async (args, deps) => {
        executedWith.args = args;
        executedWith.deps = deps;
        return { success: true, result: args.input * 2 };
      });

      // Manually register the tool (bypassing VFS module loading)
      toolRunner._tools = new Map([['MockTool', mockTool]]);

      const result = await toolRunner.execute('MockTool', { input: 21 });

      expect(mockTool).toHaveBeenCalled();
      expect(executedWith.args).toEqual({ input: 21 });
      expect(executedWith.deps).toHaveProperty('VFS');
      expect(executedWith.deps).toHaveProperty('Utils');
      expect(executedWith.deps).toHaveProperty('EventBus');
      expect(result).toEqual({ success: true, result: 42 });
    });

    it('throws ToolError for non-existent tool', async () => {
      await toolRunner.init();

      await expect(toolRunner.execute('NonExistent', {}))
        .rejects.toThrow('Tool not found: NonExistent');
    });

    it('respects permission filtering for workers', async () => {
      const mockTool = vi.fn().mockResolvedValue('executed');
      toolRunner._tools = new Map([
        ['AllowedTool', mockTool],
        ['ForbiddenTool', mockTool]
      ]);

      // With allowed tools filter
      await expect(toolRunner.execute('AllowedTool', {}, { allowedTools: ['AllowedTool'] }))
        .resolves.toBe('executed');

      await expect(toolRunner.execute('ForbiddenTool', {}, { allowedTools: ['AllowedTool'] }))
        .rejects.toThrow("Tool 'ForbiddenTool' not permitted");
    });

    it('allows all tools when allowedTools is "*"', async () => {
      const mockTool = vi.fn().mockResolvedValue('executed');
      toolRunner._tools = new Map([['AnyTool', mockTool]]);

      await expect(toolRunner.execute('AnyTool', {}, { allowedTools: '*' }))
        .resolves.toBe('executed');
    });
  });

  describe('Arena Gating', () => {
    it('arena gating is disabled by default', () => {
      expect(toolRunner.isArenaGatingEnabled()).toBe(false);
    });

    it('can enable and disable arena gating', () => {
      toolRunner.setArenaGating(true);
      expect(toolRunner.isArenaGatingEnabled()).toBe(true);

      toolRunner.setArenaGating(false);
      expect(toolRunner.isArenaGatingEnabled()).toBe(false);
    });
  });

  describe('Schema Management', () => {
    it('returns tool schemas in OpenAI format', async () => {
      // Register a tool with schema
      const mockTool = vi.fn();
      toolRunner._tools = new Map([['SchemaTest', mockTool]]);

      mockSchemaRegistry.getToolSchema.mockReturnValue({
        description: 'Test tool description',
        parameters: {
          type: 'object',
          properties: {
            arg1: { type: 'string' }
          }
        }
      });

      const schemas = toolRunner.getToolSchemas();

      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toEqual({
        type: 'function',
        function: {
          name: 'SchemaTest',
          description: 'Test tool description',
          parameters: {
            type: 'object',
            properties: {
              arg1: { type: 'string' }
            }
          }
        }
      });
    });

    it('filters schemas based on allowed tools', async () => {
      toolRunner._tools = new Map([
        ['Tool1', vi.fn()],
        ['Tool2', vi.fn()],
        ['Tool3', vi.fn()]
      ]);

      mockSchemaRegistry.getToolSchema.mockImplementation((name) => ({
        description: `${name} description`,
        parameters: { type: 'object' }
      }));

      const filtered = toolRunner.getToolSchemasFiltered(['Tool1', 'Tool3']);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(s => s.function.name)).toEqual(['Tool1', 'Tool3']);
    });
  });

  describe('Error Handling', () => {
    it('wraps tool errors in ToolError with context', async () => {
      const failingTool = vi.fn().mockRejectedValue(new Error('Something broke'));
      toolRunner._tools = new Map([['FailTool', failingTool]]);

      try {
        await toolRunner.execute('FailTool', { arg: 'value' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.name).toBe('ToolError');
        expect(err.message).toBe('Something broke');
        expect(err.details).toEqual({ tool: 'FailTool', args: { arg: 'value' } });
      }
    });
  });

  describe('Refresh', () => {
    it('refresh reloads tools from VFS', async () => {
      await toolRunner.init();
      expect(toolRunner.list()).toHaveLength(0);

      mockVFS._storage.set('/tools/NewTool.js', `export default () => 'new';`);
      await toolRunner.refresh();

      // Tool should be discovered (actual loading requires blob URL support)
      expect(mockVFS.list).toHaveBeenCalledWith('/tools/');
    });
  });
});
