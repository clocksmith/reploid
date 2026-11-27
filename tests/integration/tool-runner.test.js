/**
 * @fileoverview Integration tests for ToolRunner
 * Tests VFS-loaded JS tool execution flow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ToolRunnerModule from '../../core/tool-runner.js';
import { setSecurityEnabled } from '../../core/security-config.js';

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
    // VFS tool loading uses blob URL imports which require a browser environment
    it.skip('loads tools from /tools/ directory on init', async () => {
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

    it.skip('skips test files during init', async () => {
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
  });

  describe('Tool Execution Flow', () => {
    it('throws ToolError for non-existent tool', async () => {
      await toolRunner.init();

      await expect(toolRunner.execute('NonExistent', {}))
        .rejects.toThrow('Tool not found: NonExistent');
    });
  });

  describe('Arena Gating', () => {
    it('arena gating is disabled by default', () => {
      expect(toolRunner.isArenaGatingEnabled()).toBe(false);
    });

    it('can enable and disable arena gating', () => {
      setSecurityEnabled(true, { persist: false });
      toolRunner.setArenaGating(true);
      expect(toolRunner.isArenaGatingEnabled()).toBe(true);

      toolRunner.setArenaGating(false);
      expect(toolRunner.isArenaGatingEnabled()).toBe(false);
      setSecurityEnabled(false, { persist: false });
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
