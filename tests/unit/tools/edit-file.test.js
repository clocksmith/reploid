/**
 * @fileoverview Unit tests for EditFile tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call from '../../../tools/EditFile.js';

describe('EditFile', () => {
  let mockVFS;
  let mockEventBus;
  let mockAuditLogger;
  const writablePath = '/shadow/test.txt';

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

  describe('validation', () => {
    it('should throw error when VFS not available', async () => {
      const result = await call({ path: writablePath, operations: [] }, {});
      expect(result).toBe('VFS unavailable');
    });

    it('should throw error when path missing', async () => {
      await expect(call({ operations: [{ match: 'x', replacement: 'y' }] }, { VFS: mockVFS }))
        .rejects.toThrow('Missing "path" argument');
    });

    it('should throw error when operations empty', async () => {
      await expect(call({ path: writablePath, operations: [] }, { VFS: mockVFS }))
        .rejects.toThrow('Provide content or at least one operation');
    });

    it('should throw error when operations not array', async () => {
      await expect(call({ path: writablePath, operations: 'invalid' }, { VFS: mockVFS }))
        .rejects.toThrow('Provide content or at least one operation');
    });

    it('should throw error when operation missing match', async () => {
      mockVFS.read.mockResolvedValue('content');

      await expect(call(
        { path: writablePath, operations: [{ replacement: 'y' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('Operation #1 missing "match"');
    });

    it('should throw error when match is empty string', async () => {
      mockVFS.read.mockResolvedValue('content');

      // Empty string is falsy, so it triggers "missing match" error first
      await expect(call(
        { path: writablePath, operations: [{ match: '', replacement: 'y' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('Operation #1 missing "match"');
    });

    it('should reject direct edits outside writable candidate and evidence roots', async () => {
      await expect(call(
        { path: '/core/agent-loop.js', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('VFS path not editable by EditFile');

      await expect(call(
        { path: '/test.txt', operations: [{ match: 'code', replacement: 'modified' }] },
        { VFS: mockVFS }
      )).rejects.toThrow('VFS path not editable by EditFile');
    });
  });

  describe('single replacement', () => {
    it('should replace first occurrence by default', async () => {
      mockVFS.read.mockResolvedValue('hello world hello');

      const result = await call(
        { path: writablePath, operations: [{ match: 'hello', replacement: 'hi' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'hi world hello');
      expect(result.changed).toBe(true);
      expect(result.operations[0].replacements).toBe(1);
    });

    it('should handle replacement with empty string (deletion)', async () => {
      mockVFS.read.mockResolvedValue('remove this word');

      await call(
        { path: writablePath, operations: [{ match: 'this ', replacement: '' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'remove word');
    });

    it('should default replacement to empty string when not provided', async () => {
      mockVFS.read.mockResolvedValue('delete me');

      await call(
        { path: writablePath, operations: [{ match: ' me' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'delete');
    });
  });

  describe('count parameter', () => {
    it('should replace specified count of occurrences', async () => {
      mockVFS.read.mockResolvedValue('a a a a a');

      const result = await call(
        { path: writablePath, operations: [{ match: 'a', replacement: 'b', count: 3 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'b b b a a');
      expect(result.operations[0].replacements).toBe(3);
    });

    it('should replace all when count is 0', async () => {
      mockVFS.read.mockResolvedValue('x x x x');

      const result = await call(
        { path: writablePath, operations: [{ match: 'x', replacement: 'y', count: 0 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'y y y y');
      expect(result.operations[0].replacements).toBe(4);
    });

    it('should replace all when count is negative', async () => {
      mockVFS.read.mockResolvedValue('a a a');

      await call(
        { path: writablePath, operations: [{ match: 'a', replacement: 'z', count: -1 }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'z z z');
    });
  });

  describe('multiple operations', () => {
    it('should apply operations in order', async () => {
      mockVFS.read.mockResolvedValue('foo bar baz');

      const result = await call(
        {
          path: writablePath,
          operations: [
            { match: 'foo', replacement: 'FOO' },
            { match: 'bar', replacement: 'BAR' },
            { match: 'baz', replacement: 'BAZ' }
          ]
        },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'FOO BAR BAZ');
      expect(result.operations).toHaveLength(3);
    });

    it('should handle chained replacements', async () => {
      mockVFS.read.mockResolvedValue('hello');

      await call(
        {
          path: writablePath,
          operations: [
            { match: 'hello', replacement: 'world' },
            { match: 'world', replacement: 'universe' }
          ]
        },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith(writablePath, 'universe');
    });
  });

  describe('no changes', () => {
    it('should not write when no matches found', async () => {
      mockVFS.read.mockResolvedValue('no match here');

      const result = await call(
        { path: writablePath, operations: [{ match: 'xyz', replacement: 'abc' }] },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      expect(result.operations[0].replacements).toBe(0);
    });
  });

  describe('candidate and evidence writes', () => {
    it('should not emit core-write audit for writable candidate paths', async () => {
      mockVFS.read.mockResolvedValue('original');

      await call(
        { path: writablePath, operations: [{ match: 'original', replacement: 'modified' }] },
        { VFS: mockVFS, AuditLogger: mockAuditLogger, EventBus: mockEventBus }
      );

      expect(mockAuditLogger.logCoreWrite).not.toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should write full replacement content to evidence paths', async () => {
      mockVFS.read.mockResolvedValue('old evidence');

      const result = await call(
        { path: '/artifacts/result.txt', content: 'new evidence' },
        { VFS: mockVFS }
      );

      expect(mockVFS.write).toHaveBeenCalledWith('/artifacts/result.txt', 'new evidence');
      expect(result).toMatchObject({
        path: '/artifacts/result.txt',
        backend: 'vfs',
        changed: true
      });
    });
  });

  describe('result format', () => {
    it('should return success result with operation details', async () => {
      mockVFS.read.mockResolvedValue('hello world');

      const result = await call(
        { path: writablePath, operations: [{ match: 'hello', replacement: 'hi' }] },
        { VFS: mockVFS }
      );

      expect(result).toEqual(expect.objectContaining({
        path: writablePath,
        changed: true,
        operations: [{
          matchPreview: 'hello',
          replacementPreview: 'hi',
          replacements: 1
        }]
      }));
    });

    it('should truncate long match/replacement in preview', async () => {
      const longString = 'a'.repeat(100);
      mockVFS.read.mockResolvedValue(longString);

      const result = await call(
        { path: writablePath, operations: [{ match: longString, replacement: longString }] },
        { VFS: mockVFS }
      );

      expect(result.operations[0].matchPreview.length).toBeLessThanOrEqual(60);
      expect(result.operations[0].matchPreview).toContain('...');
    });
  });
});
