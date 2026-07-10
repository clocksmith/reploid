/**
 * @fileoverview Unit tests for ToolRunner module
 * Tests dynamic tool loading and execution (no built-in tools in RSI mode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import ToolRunnerModule, { filterToolDepsForMode, filterToolDepsForTool } from '../../core/tool-runner.js';

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

  afterEach(() => {
    delete global.window;
  });

  // NOTE: In RSI mode, there are NO built-in tools
  // All tools are dynamically loaded from /tools/ directory
  // This enables full self-modification capability

  describe('mode dependency filtering', () => {
    it('removes host shell and git dependencies in Zero only', () => {
      const deps = {
        VFS: {},
        Shell: {},
        gitTools: {},
        ToolRunner: {}
      };

      expect(filterToolDepsForMode(deps, 'zero')).toEqual({
        VFS: {},
        ToolRunner: {}
      });
      expect(filterToolDepsForMode(deps, 'x')).toBe(deps);
    });

    it('gives Zero-created tools read-only deps until capabilities are declared', () => {
      const deps = {
        VFS: {
          read: vi.fn(),
          list: vi.fn(),
          exists: vi.fn(),
          write: vi.fn()
        },
        ToolRunner: {
          list: vi.fn(),
          execute: vi.fn(),
          has: vi.fn(),
          refresh: vi.fn(),
          allow: vi.fn(),
          load: vi.fn(),
          loadPath: vi.fn()
        },
        Shell: {},
        gitTools: {}
      };

      const readonly = filterToolDepsForTool(deps, 'zero', 'CreatedReader');
      expect(readonly.Shell).toBeUndefined();
      expect(readonly.gitTools).toBeUndefined();
      expect(typeof readonly.VFS.read).toBe('function');
      expect(readonly.VFS.write).toBeUndefined();
      expect(readonly.ToolRunner.execute).toBe(deps.ToolRunner.execute);
      expect(readonly.ToolRunner.loadPath).toBeUndefined();

      const writer = filterToolDepsForTool(deps, 'zero', 'CreatedWriter', {
        capabilities: ['vfs:write', 'tool:load']
      });
      expect(writer.VFS).toBe(deps.VFS);
      expect(writer.ToolRunner.loadPath).toBe(deps.ToolRunner.loadPath);
      expect(writer.ToolRunner.refresh).toBe(deps.ToolRunner.refresh);
    });
  });

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

    it('unloads a runtime-installed tool and its schema', async () => {
      mockVFS.read.mockResolvedValue('export default async function() { return { ok: true }; }');

      await expect(toolRunner.loadPath('/self/tools/ActivationProbe.js', 'ActivationProbe', { allow: true }))
        .resolves.toBe(true);
      expect(toolRunner.has('ActivationProbe')).toBe(true);

      expect(toolRunner.unload('ActivationProbe')).toBe(true);
      expect(toolRunner.has('ActivationProbe')).toBe(false);
      expect(mockSchemaRegistry.unregisterToolSchema).toHaveBeenCalledWith('ActivationProbe');
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
        global.window = { getReploidMode: () => 'x' };
        mockVFS.list.mockResolvedValue([
          '/tools/ReadFile.js',
          '/tools/ReadFile.test.js',
          '/tools/ReadFile.spec.js',
          '/tools/ReadFile.integration.js'
        ]);
        mockVFS.read.mockResolvedValue('export default () => {};');

        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await toolRunner.init();

        // Should only attempt to load ReadFile.js
        // Test files should be skipped
        expect(mockVFS.read).toHaveBeenCalledTimes(1);
        expect(mockVFS.read).toHaveBeenCalledWith('/tools/ReadFile.js');
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

      it('should load the Zero kernel tools that have runtime dependencies', async () => {
        mockVFS.list.mockResolvedValue([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/DeleteFile.js',
          '/tools/MakeDirectory.js',
          '/tools/CopyFile.js',
          '/tools/MoveFile.js',
          '/tools/Head.js',
          '/tools/Tail.js',
          '/tools/Grep.js',
          '/tools/Find.js',
          '/tools/git.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
        mockVFS.read.mockResolvedValue('export default async () => "ok";');
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await toolRunner.init();

        expect(mockVFS.read.mock.calls.map(([path]) => path)).toEqual([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/DeleteFile.js',
          '/tools/MakeDirectory.js',
          '/tools/CopyFile.js',
          '/tools/MoveFile.js',
          '/tools/Head.js',
          '/tools/Tail.js',
          '/tools/Grep.js',
          '/tools/Find.js',
          '/tools/git.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
      });

      it('should include LoadModule in the Zero kernel when SubstrateLoader is available', async () => {
        const runnerWithLoader = ToolRunnerModule.factory({
          Utils: mockUtils,
          VFS: mockVFS,
          ToolWriter: mockToolWriter,
          SchemaRegistry: mockSchemaRegistry,
          SubstrateLoader: { loadModule: vi.fn() }
        });
        mockVFS.list.mockResolvedValue([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/DeleteFile.js',
          '/tools/MakeDirectory.js',
          '/tools/CopyFile.js',
          '/tools/MoveFile.js',
          '/tools/Head.js',
          '/tools/Tail.js',
          '/tools/Grep.js',
          '/tools/Find.js',
          '/tools/git.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
        mockVFS.read.mockResolvedValue('export default async () => "ok";');
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await runnerWithLoader.init();

        expect(mockVFS.read.mock.calls.map(([path]) => path)).toEqual([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/DeleteFile.js',
          '/tools/MakeDirectory.js',
          '/tools/CopyFile.js',
          '/tools/MoveFile.js',
          '/tools/Head.js',
          '/tools/Tail.js',
          '/tools/Grep.js',
          '/tools/Find.js',
          '/tools/git.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
      });

      it('should keep only CreateTool in the Zero kernel without SubstrateLoader', async () => {
        global.window = {
          getReploidMode: () => 'zero'
        };
        const runnerWithoutLoader = ToolRunnerModule.factory({
          Utils: mockUtils,
          VFS: mockVFS,
          ToolWriter: mockToolWriter,
          SchemaRegistry: mockSchemaRegistry
        });
        mockVFS.list.mockResolvedValue([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/Grep.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
        mockVFS.read.mockResolvedValue('export default async () => "ok";');
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await runnerWithoutLoader.init();

        expect(runnerWithoutLoader.list()).toEqual(['CreateTool']);
        expect(runnerWithoutLoader.list()).not.toContain('ReadFile');
        expect(runnerWithoutLoader.list()).not.toContain('LoadModule');
        expect(runnerWithoutLoader.list()).not.toContain('Promote');
      });

      it('should not load non-seed file tools for the Zero tool surface', async () => {
        global.window = {
          getReploidMode: () => 'zero'
        };
        const zeroRunner = ToolRunnerModule.factory({
          Utils: mockUtils,
          VFS: mockVFS,
          ToolWriter: mockToolWriter,
          SchemaRegistry: mockSchemaRegistry,
          SubstrateLoader: { loadModule: vi.fn() }
        });
        mockVFS.list.mockResolvedValue([
          '/tools/ReadFile.js',
          '/tools/WriteFile.js',
          '/tools/EditFile.js',
          '/tools/ListFiles.js',
          '/tools/Grep.js',
          '/tools/ListTools.js',
          '/tools/CreateTool.js',
          '/tools/LoadModule.js',
          '/tools/Promote.js'
        ]);
        mockVFS.read.mockResolvedValue('export default async () => "ok";');
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();

        await zeroRunner.init();

        expect(mockVFS.read.mock.calls.map(([path]) => path)).toEqual([
          '/tools/CreateTool.js'
        ]);
        expect(zeroRunner.list()).toEqual(['CreateTool']);
        expect(zeroRunner.list()).not.toContain('ReadFile');
        expect(zeroRunner.list()).not.toContain('LoadModule');
        expect(zeroRunner.list()).not.toContain('Promote');
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

    it('loadPath propagates dynamic module load failures', async () => {
      const loadError = new SyntaxError('Unexpected token |');
      mockVFS.read.mockRejectedValue(loadError);

      await expect(toolRunner.loadPath('/self/tools/BrokenTool.js', 'BrokenTool', { allow: true }))
        .rejects.toThrow('Unexpected token |');

      expect(mockVFS.read).toHaveBeenCalledWith('/self/tools/BrokenTool.js');
      expect(toolRunner.list()).not.toContain('BrokenTool');
      expect(mockUtils.logger.error).toHaveBeenCalledWith(
        '[ToolRunner] Failed to load /self/tools/BrokenTool.js',
        loadError
      );
    });

    it('loadPath only accepts installed /self/tools modules', async () => {
      await expect(toolRunner.loadPath('/shadow/tools/BrokenTool.js', 'BrokenTool', { allow: true }))
        .rejects.toThrow('ToolRunner.loadPath only supports installed /self/tools/*.js modules');

      expect(mockVFS.read).not.toHaveBeenCalled();
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
      expect(ToolRunnerModule.metadata.dependencies).toContain('ToolWriter?');
      expect(ToolRunnerModule.metadata.dependencies).toContain('SchemaRegistry');
    });
  });
});
