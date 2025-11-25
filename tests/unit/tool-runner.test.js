/**
 * @fileoverview Unit tests for ToolRunner module
 * Tests built-in tools, dynamic tool loading, and execution
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

const createMockMetaToolWriter = () => ({
  improveCore: vi.fn().mockResolvedValue('Core module improved')
});

import ToolRunnerModule from '../../core/tool-runner.js';

describe('ToolRunner', () => {
  let toolRunner;
  let mockUtils;
  let mockVFS;
  let mockToolWriter;
  let mockMetaToolWriter;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockVFS = createMockVFS();
    mockToolWriter = createMockToolWriter();
    mockMetaToolWriter = createMockMetaToolWriter();

    // Default VFS.list to return empty for /tools/
    mockVFS.list.mockResolvedValue([]);

    toolRunner = ToolRunnerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      ToolWriter: mockToolWriter,
      MetaToolWriter: mockMetaToolWriter
    });
  });

  describe('built-in tools', () => {
    describe('read_file', () => {
      it('should read file content from VFS', async () => {
        mockVFS.read.mockResolvedValue('file content here');

        const result = await toolRunner.execute('read_file', { path: '/test.txt' });

        expect(mockVFS.read).toHaveBeenCalledWith('/test.txt');
        expect(result).toBe('file content here');
      });

      it('should accept "file" as alias for "path"', async () => {
        mockVFS.read.mockResolvedValue('content');

        await toolRunner.execute('read_file', { file: '/test.txt' });

        expect(mockVFS.read).toHaveBeenCalledWith('/test.txt');
      });

      it('should throw ValidationError if path is missing', async () => {
        await expect(toolRunner.execute('read_file', {}))
          .rejects.toThrow('Missing path');
      });

      it('should propagate VFS errors', async () => {
        mockVFS.read.mockRejectedValue(new Error('File not found'));

        await expect(toolRunner.execute('read_file', { path: '/missing.txt' }))
          .rejects.toThrow('File not found');
      });
    });

    describe('write_file', () => {
      it('should write content to VFS', async () => {
        mockVFS.write.mockResolvedValue(true);

        const result = await toolRunner.execute('write_file', {
          path: '/output.txt',
          content: 'Hello World'
        });

        expect(mockVFS.write).toHaveBeenCalledWith('/output.txt', 'Hello World');
        expect(result).toContain('Wrote /output.txt');
        expect(result).toContain('11 bytes');
      });

      it('should accept "file" as alias for "path"', async () => {
        mockVFS.write.mockResolvedValue(true);

        await toolRunner.execute('write_file', { file: '/test.txt', content: 'test' });

        expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'test');
      });

      it('should throw ValidationError if path is missing', async () => {
        await expect(toolRunner.execute('write_file', { content: 'test' }))
          .rejects.toThrow('Missing args');
      });

      it('should throw ValidationError if content is missing', async () => {
        await expect(toolRunner.execute('write_file', { path: '/test.txt' }))
          .rejects.toThrow('Missing args');
      });

      it('should allow empty string as content', async () => {
        mockVFS.write.mockResolvedValue(true);

        const result = await toolRunner.execute('write_file', {
          path: '/empty.txt',
          content: ''
        });

        expect(mockVFS.write).toHaveBeenCalledWith('/empty.txt', '');
        expect(result).toContain('0 bytes');
      });
    });

    describe('list_files', () => {
      it('should list files in directory', async () => {
        mockVFS.list.mockResolvedValue(['/dir/file1.txt', '/dir/file2.txt']);

        const result = await toolRunner.execute('list_files', { path: '/dir' });

        expect(mockVFS.list).toHaveBeenCalledWith('/dir');
        expect(result).toEqual(['/dir/file1.txt', '/dir/file2.txt']);
      });

      it('should accept "directory" as alias for "path"', async () => {
        mockVFS.list.mockResolvedValue([]);

        await toolRunner.execute('list_files', { directory: '/mydir' });

        expect(mockVFS.list).toHaveBeenCalledWith('/mydir');
      });

      it('should accept "dir" as alias for "path"', async () => {
        mockVFS.list.mockResolvedValue([]);

        await toolRunner.execute('list_files', { dir: '/mydir' });

        expect(mockVFS.list).toHaveBeenCalledWith('/mydir');
      });

      it('should default to root directory if no path provided', async () => {
        mockVFS.list.mockResolvedValue([]);

        await toolRunner.execute('list_files', {});

        expect(mockVFS.list).toHaveBeenCalledWith('/');
      });
    });

    describe('delete_file', () => {
      it('should delete file from VFS', async () => {
        mockVFS.delete.mockResolvedValue(true);

        const result = await toolRunner.execute('delete_file', { path: '/test.txt' });

        expect(mockVFS.delete).toHaveBeenCalledWith('/test.txt');
        expect(result).toBe('Deleted /test.txt');
      });

      it('should accept "file" as alias for "path"', async () => {
        mockVFS.delete.mockResolvedValue(true);

        await toolRunner.execute('delete_file', { file: '/test.txt' });

        expect(mockVFS.delete).toHaveBeenCalledWith('/test.txt');
      });

      it('should throw ValidationError if path is missing', async () => {
        await expect(toolRunner.execute('delete_file', {}))
          .rejects.toThrow('Missing path');
      });
    });

    describe('create_tool', () => {
      it('should delegate to ToolWriter', async () => {
        const result = await toolRunner.execute('create_tool', {
          name: 'my_tool',
          code: 'export default (args) => args.value * 2;'
        });

        expect(mockToolWriter.create).toHaveBeenCalledWith(
          'my_tool',
          'export default (args) => args.value * 2;'
        );
        expect(result).toBe('Tool created successfully');
      });
    });

    describe('improve_core_module', () => {
      it('should delegate to MetaToolWriter', async () => {
        const result = await toolRunner.execute('improve_core_module', {
          module: 'agent-loop',
          code: 'new code here'
        });

        expect(mockMetaToolWriter.improveCore).toHaveBeenCalledWith(
          'agent-loop',
          'new code here'
        );
        expect(result).toBe('Core module improved');
      });
    });
  });

  describe('tool management', () => {
    describe('list', () => {
      it('should return list of available tools', () => {
        const tools = toolRunner.list();

        expect(tools).toContain('read_file');
        expect(tools).toContain('write_file');
        expect(tools).toContain('list_files');
        expect(tools).toContain('delete_file');
        expect(tools).toContain('create_tool');
        expect(tools).toContain('improve_core_module');
      });
    });

    describe('has', () => {
      it('should return true for built-in tools', () => {
        expect(toolRunner.has('read_file')).toBe(true);
        expect(toolRunner.has('write_file')).toBe(true);
      });

      it('should return false for unknown tools', () => {
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
          '/tools/my_tool.js',
          '/tools/my_tool.test.js',
          '/tools/my_tool.spec.js',
          '/tools/my_tool.integration.js'
        ]);

        await toolRunner.init();

        // Should only attempt to load my_tool.js
        // Test files should be skipped
        expect(mockVFS.read).toHaveBeenCalledTimes(1);
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
    });
  });

  describe('error handling', () => {
    it('should wrap tool errors with context', async () => {
      mockVFS.read.mockRejectedValue(new Error('VFS failure'));

      try {
        await toolRunner.execute('read_file', { path: '/test.txt' });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.name).toBe('ToolError');
        expect(err.message).toBe('VFS failure');
        expect(err.details.tool).toBe('read_file');
      }
    });

    it('should log errors during execution', async () => {
      mockVFS.read.mockRejectedValue(new Error('Test error'));

      try {
        await toolRunner.execute('read_file', { path: '/test.txt' });
      } catch (err) {
        // Expected
      }

      expect(mockUtils.logger.error).toHaveBeenCalledWith(
        '[ToolRunner] Error in read_file',
        expect.any(Error)
      );
    });

    it('should preserve original stack trace', async () => {
      const originalError = new Error('Original error');
      mockVFS.read.mockRejectedValue(originalError);

      try {
        await toolRunner.execute('read_file', { path: '/test.txt' });
      } catch (err) {
        expect(err.stack).toBe(originalError.stack);
      }
    });
  });

  describe('SubstrateLoader integration', () => {
    it('should add load_module tool if SubstrateLoader is available', () => {
      const mockSubstrateLoader = {
        loadModule: vi.fn().mockResolvedValue(true)
      };

      const runnerWithLoader = ToolRunnerModule.factory({
        Utils: mockUtils,
        VFS: mockVFS,
        ToolWriter: mockToolWriter,
        MetaToolWriter: mockMetaToolWriter,
        SubstrateLoader: mockSubstrateLoader
      });

      expect(runnerWithLoader.has('load_module')).toBe(true);
    });

    it('should not add load_module if SubstrateLoader is unavailable', () => {
      expect(toolRunner.has('load_module')).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(ToolRunnerModule.metadata.id).toBe('ToolRunner');
      expect(ToolRunnerModule.metadata.type).toBe('service');
      expect(ToolRunnerModule.metadata.async).toBe(true);
      expect(ToolRunnerModule.metadata.dependencies).toContain('VFS');
      expect(ToolRunnerModule.metadata.dependencies).toContain('ToolWriter');
    });
  });
});
