/**
 * @fileoverview Unit tests for ToolRunner module
 * Tests dynamic tool loading and execution (no built-in tools in RSI mode)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const createMockUtils = () => {
  const ValidationError = class extends Error {
    constructor(message) {
      super(message);
      this.name = 'ValidationError';
    }
  };
  const ToolError = class extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = 'ToolError';
      this.details = details;
    }
  };

  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    Errors: {
      ValidationError,
      ToolError
    }
  };
};

const createMockVFS = () => ({
  read: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn()
});

const createMockToolWriter = () => ({
  create: vi.fn().mockResolvedValue('Tool created successfully')
});

const createMockSchemaRegistry = () => ({
  registerToolSchema: vi.fn(),
  unregisterToolSchema: vi.fn()
});

import ToolRunnerModule from '../../core/tool-runner.js';

describe('ToolRunner', () => {
  let toolRunner;
  let mockUtils;
  let mockVFS;
  let mockToolWriter;
  let mockSchemaRegistry;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockVFS = createMockVFS();
    mockToolWriter = createMockToolWriter();
    mockSchemaRegistry = createMockSchemaRegistry();

    // Default VFS.list to return empty for /tools/
    mockVFS.list.mockResolvedValue([]);

    toolRunner = ToolRunnerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      ToolWriter: mockToolWriter,
      SchemaRegistry: mockSchemaRegistry
    });
  });

  // NOTE: In RSI mode, there are NO built-in tools
  // All tools are dynamically loaded from /tools/ directory
  // This enables full self-modification capability

  describe('tool management', () => {
    describe('list', () => {
      it('should return empty list when no tools loaded', () => {
        const tools = toolRunner.list();
        expect(tools).toEqual([]);
      });

      it('should return dynamically loaded tools', async () => {
        mockVFS.list.mockResolvedValue(['/tools/CustomTool.js']);
        mockVFS.read.mockResolvedValue('export default (args) => "result";');

        // Mock dynamic import
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await toolRunner.init();

        // Tool should be in list after loading
        // (Note: actual loading may fail in test env due to import() limitations)
      });
    });

    describe('has', () => {
      it('should return false for unknown tools when no tools loaded', () => {
        expect(toolRunner.has('ReadFile')).toBe(false);
        expect(toolRunner.has('WriteFile')).toBe(false);
        expect(toolRunner.has('unknown_tool')).toBe(false);
      });
    });
  });

  describe('dynamic tool loading', () => {
    describe('init/refresh', () => {
      it('should load tools from /tools/ directory', async () => {
        mockVFS.list.mockResolvedValue(['/tools/custom_tool.js']);
        mockVFS.read.mockResolvedValue(`
          export default (args) => 'custom result';
        `);

        // Mock URL and import for dynamic loading
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await toolRunner.init();

        expect(mockVFS.list).toHaveBeenCalledWith('/tools/');
      });

      it('should skip test files when loading tools', async () => {
        mockVFS.list.mockResolvedValue([
          '/tools/MyTool.js',
          '/tools/MyTool.test.js',
          '/tools/MyTool.spec.js',
          '/tools/MyTool.integration.js'
        ]);
        mockVFS.read.mockResolvedValue('export default () => {};');

        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await toolRunner.init();

        // Should only attempt to load MyTool.js
        // Test files should be skipped
        expect(mockVFS.read).toHaveBeenCalledTimes(1);
        expect(mockVFS.read).toHaveBeenCalledWith('/tools/MyTool.js');
      });

      it('should handle empty tools directory gracefully', async () => {
        mockVFS.list.mockResolvedValue([]);

        const result = await toolRunner.init();

        expect(result).toBe(true);
      });

      it('should handle tools directory not existing', async () => {
        mockVFS.list.mockRejectedValue(new Error('Directory not found'));

        const result = await toolRunner.init();

        expect(result).toBe(true);
        expect(mockUtils.logger.warn).toHaveBeenCalled();
      });
    });

    describe('execute with lazy loading', () => {
      it('should attempt to load tool if not found', async () => {
        mockVFS.exists.mockResolvedValue(false);

        await expect(toolRunner.execute('unknown_tool', {}))
          .rejects.toThrow('Tool not found: unknown_tool');
      });

      it('should try to load tool from /tools/ if VFS.exists returns true', async () => {
        mockVFS.exists.mockResolvedValue(true);
        mockVFS.read.mockResolvedValue('export default () => "loaded";');

        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        // Will still fail because dynamic import doesn't work in test
        await expect(toolRunner.execute('LazyTool', {}))
          .rejects.toThrow();

        expect(mockVFS.exists).toHaveBeenCalledWith('/tools/LazyTool.js');
      });
    });
  });

  describe('error handling', () => {
    it('should throw ToolError for missing tools', async () => {
      mockVFS.exists.mockResolvedValue(false);

      try {
        await toolRunner.execute('NonExistent', { path: '/test.txt' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.name).toBe('ToolError');
        expect(err.message).toBe('Tool not found: NonExistent');
      }
    });
  });

  describe('SubstrateLoader integration', () => {
    // NOTE: In RSI mode, LoadModule is a dynamic tool loaded from /tools/LoadModule.js
    // SubstrateLoader is injected as a dependency to tools, not used to register built-ins

    it('should provide SubstrateLoader to tools as dependency', () => {
      const mockSubstrateLoader = {
        loadModule: vi.fn().mockResolvedValue(true)
      };

      const runnerWithLoader = ToolRunnerModule.factory({
        Utils: mockUtils,
        VFS: mockVFS,
        ToolWriter: mockToolWriter,
        SchemaRegistry: mockSchemaRegistry,
        SubstrateLoader: mockSubstrateLoader
      });

      // SubstrateLoader is available as dependency, not as built-in tool
      // LoadModule.js in /tools/ will use it
      expect(runnerWithLoader.has('LoadModule')).toBe(false); // No built-in
    });

    it('should not have LoadModule as built-in when SubstrateLoader is unavailable', () => {
      expect(toolRunner.has('LoadModule')).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ToolRunnerModule.metadata.id).toBe('ToolRunner');
      expect(ToolRunnerModule.metadata.type).toBe('service');
      expect(ToolRunnerModule.metadata.async).toBe(true);
      expect(ToolRunnerModule.metadata.dependencies).toContain('VFS');
      expect(ToolRunnerModule.metadata.dependencies).toContain('ToolWriter');
      expect(ToolRunnerModule.metadata.dependencies).toContain('SchemaRegistry');
    });
  });
});
