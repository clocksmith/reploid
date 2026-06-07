/**
 * @fileoverview Unit tests for WriteFile tool
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import call, { tool } from '../../../tools/WriteFile.js';

describe('WriteFile', () => {
  let mockVFS;
  let mockEventBus;
  let mockAuditLogger;
  let mockVerificationManager;
  let mockSubstrateLoader;

  beforeEach(() => {
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

    mockVerificationManager = {
      verifyProposal: vi.fn().mockResolvedValue({ passed: true })
    };

    mockSubstrateLoader = {
      loadModule: vi.fn().mockResolvedValue(undefined)
    };
  });

  const context = () => ({
    VFS: mockVFS,
    EventBus: mockEventBus,
    AuditLogger: mockAuditLogger,
    VerificationManager: mockVerificationManager,
    SubstrateLoader: mockSubstrateLoader
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('WriteFile');
    });

    it('should require path', () => {
      expect(tool.inputSchema.required).toContain('path');
    });
  });

  describe('allowed VFS roots', () => {
    it('should write shadow candidates', async () => {
      const result = await call(
        { path: '/shadow/test.txt', content: 'hello world' },
        context()
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/shadow/test.txt', 'hello world');
      expect(result.path).toBe('/shadow/test.txt');
      expect(result.bytesWritten).toBe(11);
    });

    it('should support "file" as alias for "path" under writable roots', async () => {
      await call(
        { file: '/shadow/other.txt', content: 'test' },
        context()
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/shadow/other.txt', 'test');
    });

    it('should write artifact evidence', async () => {
      await call(
        { path: '/artifacts/evidence.json', content: '{"replayPassed":true}' },
        context()
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/artifacts/evidence.json', '{"replayPassed":true}');
    });

    it('should allow empty string content', async () => {
      await call({ path: '/shadow/empty.txt', content: '' }, context());

      expect(mockVFS.write).toHaveBeenCalledWith('/shadow/empty.txt', '');
    });

    it('should reject direct self writes', async () => {
      await expect(call(
        { path: '/self/tools/Test.js', content: 'export default {};' },
        context()
      )).rejects.toThrow('VFS path not writable by WriteFile');

      expect(mockVFS.write).not.toHaveBeenCalled();
    });

    it('should reject direct core writes before verification or audit handling', async () => {
      await expect(call(
        { path: '/core/test.js', content: 'code' },
        context()
      )).rejects.toThrow('VFS path not writable by WriteFile');

      expect(mockVerificationManager.verifyProposal).not.toHaveBeenCalled();
      expect(mockAuditLogger.logCoreWrite).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('should throw error when VFS not available', async () => {
      await expect(call({ path: '/shadow/test.txt', content: 'x' }, {}))
        .rejects.toThrow('VFS not available');
    });

    it('should throw error when path missing', async () => {
      await expect(call({ content: 'x' }, { VFS: mockVFS }))
        .rejects.toThrow('Missing path argument');
    });

    it('should throw error when content missing for writable paths', async () => {
      await expect(call({ path: '/shadow/test.txt' }, { VFS: mockVFS }))
        .rejects.toThrow('Missing content argument');
    });
  });

  describe('event emission', () => {
    it('should emit artifact:created for new files', async () => {
      mockVFS.exists.mockResolvedValue(false);

      await call(
        { path: '/artifacts/new.txt', content: 'new' },
        context()
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('artifact:created', expect.objectContaining({
        path: '/artifacts/new.txt'
      }));
    });

    it('should emit vfs:write for existing files', async () => {
      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue('old content');

      await call(
        { path: '/shadow/existing.txt', content: 'updated' },
        context()
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('vfs:write', expect.objectContaining({
        path: '/shadow/existing.txt'
      }));
    });
  });

  describe('audit logging', () => {
    it('should log FILE_WRITE for writable non-core files', async () => {
      await call(
        { path: '/shadow/tools/test.js', content: 'export default {};' },
        context()
      );

      expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
        'FILE_WRITE',
        expect.objectContaining({
          path: '/shadow/tools/test.js'
        }),
        'INFO'
      );
      expect(mockAuditLogger.logCoreWrite).not.toHaveBeenCalled();
    });

    it('should not treat shadow candidate paths as core writes', async () => {
      await call(
        { path: '/shadow/core/test.js', content: 'candidate' },
        context()
      );

      expect(mockVerificationManager.verifyProposal).not.toHaveBeenCalled();
      expect(mockAuditLogger.logCoreWrite).not.toHaveBeenCalled();
    });
  });

  describe('autoLoad', () => {
    it('should reject autoLoad before Promote places a module under /self', async () => {
      await expect(call(
        {
          path: '/shadow/tools/Auto.js',
          content: 'export default async () => ({ ok: true });',
          autoLoad: true
        },
        context()
      )).rejects.toThrow('autoLoad is only available after Promote places a module under /self');

      expect(mockSubstrateLoader.loadModule).not.toHaveBeenCalled();
    });
  });
});
