/**
 * @fileoverview Unit tests for EditFile tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/EditFile.js';

describe('EditFile', () => {
  let mockVFS;
  let mockEventBus;
  let mockAuditLogger;

  beforeEach(() => {
    mockVFS = {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
      exists: vi.fn()
    };

    mockEventBus = {
      emit: vi.fn()
    };

    mockAuditLogger = {
      logEvent: vi.fn().mockResolvedValue(undefined),
      logCoreWrite: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('EditFile');
    });

    it('should have description mentioning operations array', () => {
      expect(tool.description).toContain('operations');
    });
  });

  describe('validation', () => {
    it('should throw error when VFS not available', async () => {
      const result = await call({ path: '/test.txt', operations: [] }, {});
      expect(result).toBe('VFS unavailable');
    });

    it('should throw error when path missing', async () => {
      await expect(call({ operations: [{ match: 'x', replacement: 'y' }] }, { VFS: mockVFS }))
        .rejects.toThrow('Missing "path" argument');
    });

    it('should throw error when operations empty', async () => {
      await expect(call({ path: '/test.txt', operations: [] }, { VFS: mockVFS }))
        .rejects.toThrow('Provide at least one operation');
    });

    it('should throw error when operations not array', async () => {
      await expect(call({ path: '/test.txt', operations: 'invalid' }, { VFS: mockVFS }))
        .rejects.toThrow('Provide at least one operation');
    });

    it('should throw error when operation missing match', async () => {
      mockVFS.read.mockResolvedValue('content');

      await expect(call(
        { path: '/test.txt', operations: [{ replacement: 'y' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('Operation #1 missing "match"');
    });

    it('should throw error when match is empty string', async () => {
      mockVFS.read.mockResolvedValue('content');

      // Empty string is falsy, so it triggers "missing match" error first
      await expect(call(
        { path: '/test.txt', operations: [{ match: '', replacement: 'y' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('Operation #1 missing "match"');
    });
  });

  describe('single replacement', () => {
    it('should replace first occurrence by default', async () => {
      mockVFS.read.mockResolvedValue('hello world hello');

      const result = await call(
        { path: '/test.txt', operations: [{ match: 'hello', replacement: 'hi' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'hi world hello');
      expect(result.changed).toBe(true);
      expect(result.operations[0].replacements).toBe(1);
    });

    it('should handle replacement with empty string (deletion)', async () => {
      mockVFS.read.mockResolvedValue('remove this word');

      await call(
        { path: '/test.txt', operations: [{ match: 'this ', replacement: '' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'remove word');
    });

    it('should default replacement to empty string when not provided', async () => {
      mockVFS.read.mockResolvedValue('delete me');

      await call(
        { path: '/test.txt', operations: [{ match: ' me' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'delete');
    });
  });

  describe('count parameter', () => {
    it('should replace specified count of occurrences', async () => {
      mockVFS.read.mockResolvedValue('a a a a a');

      const result = await call(
        { path: '/test.txt', operations: [{ match: 'a', replacement: 'b', count: 3 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'b b b a a');
      expect(result.operations[0].replacements).toBe(3);
    });

    it('should replace all when count is 0', async () => {
      mockVFS.read.mockResolvedValue('x x x x');

      const result = await call(
        { path: '/test.txt', operations: [{ match: 'x', replacement: 'y', count: 0 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'y y y y');
      expect(result.operations[0].replacements).toBe(4);
    });

    it('should replace all when count is negative', async () => {
      mockVFS.read.mockResolvedValue('a a a');

      await call(
        { path: '/test.txt', operations: [{ match: 'a', replacement: 'z', count: -1 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'z z z');
    });
  });

  describe('multiple operations', () => {
    it('should apply operations in order', async () => {
      mockVFS.read.mockResolvedValue('foo bar baz');

      const result = await call(
        {
          path: '/test.txt',
          operations: [
            { match: 'foo', replacement: 'FOO' },
            { match: 'bar', replacement: 'BAR' },
            { match: 'baz', replacement: 'BAZ' }
          ]
        },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'FOO BAR BAZ');
      expect(result.operations).toHaveLength(3);
    });

    it('should handle chained replacements', async () => {
      mockVFS.read.mockResolvedValue('hello');

      await call(
        {
          path: '/test.txt',
          operations: [
            { match: 'hello', replacement: 'world' },
            { match: 'world', replacement: 'universe' }
          ]
        },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/test.txt', 'universe');
    });
  });

  describe('no changes', () => {
    it('should not write when no matches found', async () => {
      mockVFS.read.mockResolvedValue('no match here');

      const result = await call(
        { path: '/test.txt', operations: [{ match: 'xyz', replacement: 'abc' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      expect(result.operations[0].replacements).toBe(0);
    });
  });

  describe('core file detection', () => {
    it('should detect /core/ as core path', async () => {
      mockVFS.read.mockResolvedValue('code');

      const result = await call(
        { path: '/core/agent-loop.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS }
      );

      expect(result.isCore).toBe(true);
    });

    it('should detect /infrastructure/ as core path', async () => {
      mockVFS.read.mockResolvedValue('code');

      const result = await call(
        { path: '/infrastructure/hitl.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS }
      );

      expect(result.isCore).toBe(true);
    });

    it('should not mark /tools/ as core path', async () => {
      mockVFS.read.mockResolvedValue('code');

      const result = await call(
        { path: '/tools/my-tool.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS }
      );

      expect(result.isCore).toBe(false);
    });
  });

  describe('audit logging', () => {
    it('should log core writes with logCoreWrite', async () => {
      mockVFS.read.mockResolvedValue('original');

      await call(
        { path: '/core/test.js', operations: [{ match: 'original', replacement: 'modified' }] },
        { VFS: mockVFS, AuditLogger: mockAuditLogger }
      );

      expect(mockAuditLogger.logCoreWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/core/test.js',
          operation: 'Edit'
        })
      );
    });

    it('should not log when no changes made', async () => {
      mockVFS.read.mockResolvedValue('no match');

      await call(
        { path: '/core/test.js', operations: [{ match: 'xyz', replacement: 'abc' }] },
        { VFS: mockVFS, AuditLogger: mockAuditLogger }
      );

      expect(mockAuditLogger.logCoreWrite).not.toHaveBeenCalled();
    });
  });

  describe('event emission', () => {
    it('should emit tool:core_write for core file changes', async () => {
      mockVFS.read.mockResolvedValue('code');

      await call(
        { path: '/core/test.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS, EventBus: mockEventBus }
      );

      expect(mockEventBus.emit).toHaveBeenCalledWith('tool:core_write', expect.objectContaining({
        path: '/core/test.js',
        operation: 'Edit'
      }));
    });

    it('should not emit event for non-core files', async () => {
      mockVFS.read.mockResolvedValue('code');

      await call(
        { path: '/tools/test.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS, EventBus: mockEventBus }
      );

      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('result format', () => {
    it('should return success result with operation details', async () => {
      mockVFS.read.mockResolvedValue('hello world');

      const result = await call(
        { path: '/test.txt', operations: [{ match: 'hello', replacement: 'hi' }] },
        { VFS: mockVFS }
      );

      expect(result).toEqual({
        success: true,
        path: '/test.txt',
        changed: true,
        isCore: false,
        operations: [{
          matchPreview: 'hello',
          replacementPreview: 'hi',
          replacements: 1
        }]
      });
    });

    it('should truncate long match/replacement in preview', async () => {
      const longString = 'a'.repeat(100);
      mockVFS.read.mockResolvedValue(longString);

      const result = await call(
        { path: '/test.txt', operations: [{ match: longString, replacement: longString }] },
        { VFS: mockVFS }
      );

      expect(result.operations[0].matchPreview.length).toBeLessThanOrEqual(60);
      expect(result.operations[0].matchPreview).toContain('...');
    });
  });
});
