/**
 * @fileoverview Unit tests for WriteFile tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/WriteFile.js';

describe('WriteFile', () => {
  let mockVFS;
  let mockEventBus;
  let mockAuditLogger;
  let mockVFSSandbox;
  let mockVerificationManager;
  let mockSubstrateLoader;

  beforeEach(() => {
    // Reset localStorage mock
    global.localStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn()
    };

    mockVFS = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      exists: vi.fn().mockResolvedValue(false)
    };

    mockEventBus = {
      emit: vi.fn()
    };

    mockAuditLogger = {
      logEvent: vi.fn().mockResolvedValue(undefined),
      logCoreWrite: vi.fn().mockResolvedValue(undefined)
    };

    mockVFSSandbox = {
      createSnapshot: vi.fn().mockResolvedValue('snapshot-id'),
      restoreSnapshot: vi.fn().mockResolvedValue(undefined),
      applyChanges: vi.fn().mockResolvedValue(undefined)
    };

    mockVerificationManager = {
      verifyProposal: vi.fn().mockResolvedValue({ passed: true })
    };

    mockSubstrateLoader = {
      loadModule: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('WriteFile');
    });

    it('should require path and content', () => {
      expect(tool.inputSchema.required).toContain('path');
      expect(tool.inputSchema.required).toContain('content');
    });
  });

  describe('basic write operations', () => {
    it('should write content to VFS', async () => {
      const result = await call(
        { path: '/test.txt', content: 'hello world' },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'hello world');
      expect(result).toContain('Wrote /test.txt');
      expect(result).toContain('11 bytes');
    });

    it('should support "file" as alias for "path"', async () => {
      await call(
        { file: '/other.txt', content: 'test' },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/other.txt', 'test');
    });

    it('should throw error when VFS not available', async () => {
      await expect(call({ path: '/test.txt', content: 'x' }, {}))
        .rejects.toThrow('VFS not available');
    });

    it('should throw error when path missing', async () => {
      await expect(call({ content: 'x' }, { VFS: mockVFS }))
        .rejects.toThrow('Missing path argument');
    });

    it('should throw error when content missing', async () => {
      await expect(call({ path: '/test.txt' }, { VFS: mockVFS }))
        .rejects.toThrow('Missing content argument');
    });

    it('should allow empty string content', async () => {
      await call({ path: '/empty.txt', content: '' }, { VFS: mockVFS });

      expect(mockVFS.write).toHaveBeenCalledWith('/empty.txt', '');
    });
  });

  describe('event emission', () => {
    it('should emit artifact:created for new files', async () => {
      mockVFS.exists.mockResolvedValue(false);

      await call(
        { path: '/new.txt', content: 'new' },
        { VFS: mockVFS, EventBus: mockEventBus }
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('artifact:created', { path: '/new.txt' });
    });

    it('should emit vfs:write for existing files', async () => {
      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue('old content');

      await call(
        { path: '/existing.txt', content: 'updated' },
        { VFS: mockVFS, EventBus: mockEventBus }
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('vfs:write', { path: '/existing.txt' });
    });

    it('should emit tool:core_write for core paths', async () => {
      await call(
        { path: '/core/test.js', content: 'code' },
        { VFS: mockVFS, EventBus: mockEventBus }
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:core_write', expect.objectContaining({
        path: '/core/test.js',
        operation: 'WriteFile'
      }));
    });
  });

  describe('audit logging', () => {
    it('should log FILE_WRITE for non-core files', async () => {
      await call(
        { path: '/tools/test.js', content: 'code' },
        { VFS: mockVFS, AuditLogger: mockAuditLogger }
      );

      expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
        'FILE_WRITE',
        expect.objectContaining({ path: '/tools/test.js' }),
        'INFO'
      );
    });

    it('should use logCoreWrite for core files', async () => {
      await call(
        { path: '/core/agent-loop.js', content: 'code' },
        { VFS: mockVFS, AuditLogger: mockAuditLogger }
      );

      expect(mockAuditLogger.logCoreWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/core/agent-loop.js',
          operation: 'WriteFile'
        })
      );
    });

    it('should detect infrastructure as core path', async () => {
      await call(
        { path: '/infrastructure/hitl.js', content: 'code' },
        { VFS: mockVFS, AuditLogger: mockAuditLogger }
      );

      expect(mockAuditLogger.logCoreWrite).toHaveBeenCalled();
    });
  });

  describe('arena verification', () => {
    beforeEach(() => {
      global.localStorage.getItem.mockReturnValue('true');
    });

    it('should verify core file changes when arena gating enabled', async () => {
      await call(
        { path: '/core/test.js', content: 'code' },
        {
          VFS: mockVFS,
          VFSSandbox: mockVFSSandbox,
          VerificationManager: mockVerificationManager
        }
      );

      expect(mockVFSSandbox.createSnapshot).toHaveBeenCalled();
      expect(mockVerificationManager.verifyProposal).toHaveBeenCalled();
      expect(mockVFSSandbox.restoreSnapshot).toHaveBeenCalled();
    });

    it('should block write when verification fails', async () => {
      mockVerificationManager.verifyProposal.mockResolvedValue({
        passed: false,
        errors: ['Unsafe modification']
      });

      await expect(call(
        { path: '/core/test.js', content: 'bad code' },
        {
          VFS: mockVFS,
          VFSSandbox: mockVFSSandbox,
          VerificationManager: mockVerificationManager,
          AuditLogger: mockAuditLogger,
          EventBus: mockEventBus
        }
      )).rejects.toThrow('Core modification blocked');

      expect(mockVFS.write).not.toHaveBeenCalled();
      expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
        'CORE_WRITE_BLOCKED',
        expect.any(Object),
        'WARN'
      );
    });

    it('should not verify non-core files', async () => {
      await call(
        { path: '/tools/test.js', content: 'code' },
        {
          VFS: mockVFS,
          VFSSandbox: mockVFSSandbox,
          VerificationManager: mockVerificationManager
        }
      );

      expect(mockVFSSandbox.createSnapshot).not.toHaveBeenCalled();
    });

    it('should skip verification when arena gating disabled', async () => {
      global.localStorage.getItem.mockReturnValue(null);

      await call(
        { path: '/core/test.js', content: 'code' },
        {
          VFS: mockVFS,
          VFSSandbox: mockVFSSandbox,
          VerificationManager: mockVerificationManager
        }
      );

      expect(mockVFSSandbox.createSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('autoLoad', () => {
    it('should hot-reload JS modules when autoLoad is true', async () => {
      const result = await call(
        { path: '/tools/new-tool.js', content: 'export default {}', autoLoad: true },
        { VFS: mockVFS, SubstrateLoader: mockSubstrateLoader }
      );

      expect(mockSubstrateLoader.loadModule).toHaveBeenCalledWith('/tools/new-tool.js');
      expect(result).toContain('hot-reloaded');
    });

    it('should not autoLoad non-JS files', async () => {
      const result = await call(
        { path: '/data/config.json', content: '{}', autoLoad: true },
        { VFS: mockVFS, SubstrateLoader: mockSubstrateLoader }
      );

      expect(mockSubstrateLoader.loadModule).not.toHaveBeenCalled();
      expect(result).not.toContain('hot-reloaded');
    });

    it('should handle autoLoad failure gracefully', async () => {
      mockSubstrateLoader.loadModule.mockRejectedValue(new Error('Load failed'));

      const result = await call(
        { path: '/tools/bad.js', content: 'bad', autoLoad: true },
        { VFS: mockVFS, SubstrateLoader: mockSubstrateLoader }
      );

      expect(result).toContain('autoLoad failed');
    });

    it('should skip autoLoad when SubstrateLoader not available', async () => {
      const result = await call(
        { path: '/tools/test.js', content: 'code', autoLoad: true },
        { VFS: mockVFS }
      );

      expect(result).toContain('SubstrateLoader not available');
    });
  });
});
