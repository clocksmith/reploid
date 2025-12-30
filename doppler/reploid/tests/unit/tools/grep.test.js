/**
 * @fileoverview Unit tests for Grep tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/Grep.js';

describe('Grep', () => {
  let mockVFS;

  beforeEach(() => {
    mockVFS = {
      read: vi.fn(),
      write: vi.fn(),
      list: vi.fn(),
      exists: vi.fn()
    };
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('Grep');
    });

    it('should be marked as readOnly', () => {
      expect(tool.readOnly).toBe(true);
    });
  });

  describe('validation', () => {
    it('should throw error when VFS not available', async () => {
      await expect(call({ pattern: 'test' }, {}))
        .rejects.toThrow('VFS not available');
    });

    it('should throw error when pattern missing', async () => {
      await expect(call({}, { VFS: mockVFS }))
        .rejects.toThrow('Missing "pattern" argument');
    });
  });

  describe('basic search', () => {
    it('should find matching lines in files', async () => {
      mockVFS.list.mockResolvedValue(['/file1.txt', '/file2.txt']);
      mockVFS.read.mockImplementation((path) => {
        if (path === '/file1.txt') return Promise.resolve('hello world\ngoodbye world');
        if (path === '/file2.txt') return Promise.resolve('no match here');
        return Promise.reject(new Error('Not found'));
      });

      const result = await call({ pattern: 'world' }, { VFS: mockVFS });

      expect(result).toContain('/file1.txt:1:hello world');
      expect(result).toContain('/file1.txt:2:goodbye world');
      expect(result).not.toContain('file2.txt');
    });

    it('should return "No matches found" when nothing matches', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('content without pattern');

      const result = await call({ pattern: 'xyz' }, { VFS: mockVFS });

      expect(result).toBe('No matches found');
    });

    it('should search in specified path', async () => {
      mockVFS.list.mockResolvedValue(['/dir/file.txt']);
      mockVFS.read.mockResolvedValue('test content');

      await call({ pattern: 'test', path: '/dir' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/dir');
    });

    it('should default to root path', async () => {
      mockVFS.list.mockResolvedValue([]);

      await call({ pattern: 'test' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/');
    });
  });

  describe('regex patterns', () => {
    it('should support regex patterns', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('foo123bar\nfoo456bar\nbaz');

      const result = await call({ pattern: 'foo\\d+bar' }, { VFS: mockVFS });

      expect(result).toContain('/file.txt:1:foo123bar');
      expect(result).toContain('/file.txt:2:foo456bar');
      expect(result).not.toContain('baz');
    });

    it('should support word boundary patterns', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('the quick fox\nquicker foxes');

      const result = await call({ pattern: '\\bquick\\b' }, { VFS: mockVFS });

      expect(result).toContain('/file.txt:1:the quick fox');
      expect(result).not.toContain('quicker');
    });
  });

  describe('case sensitivity', () => {
    it('should be case sensitive by default', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('Hello World\nhello world');

      const result = await call({ pattern: 'Hello' }, { VFS: mockVFS });

      expect(result).toContain('/file.txt:1:Hello World');
      expect(result).not.toContain('/file.txt:2');
    });

    it('should support case insensitive search', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('Hello World\nhello world\nHELLO WORLD');

      const result = await call({ pattern: 'hello', ignoreCase: true }, { VFS: mockVFS });

      expect(result).toContain('/file.txt:1:Hello World');
      expect(result).toContain('/file.txt:2:hello world');
      expect(result).toContain('/file.txt:3:HELLO WORLD');
    });
  });

  describe('line numbers', () => {
    it('should include correct line numbers (1-indexed)', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('line1\nline2\nmatch\nline4\nmatch');

      const result = await call({ pattern: 'match' }, { VFS: mockVFS });

      expect(result).toContain('/file.txt:3:match');
      expect(result).toContain('/file.txt:5:match');
    });
  });

  describe('error handling', () => {
    it('should skip files that cannot be read', async () => {
      mockVFS.list.mockResolvedValue(['/good.txt', '/bad.txt', '/also-good.txt']);
      mockVFS.read.mockImplementation((path) => {
        if (path === '/bad.txt') return Promise.reject(new Error('Permission denied'));
        return Promise.resolve('match content');
      });

      const result = await call({ pattern: 'match' }, { VFS: mockVFS });

      expect(result).toContain('/good.txt:1:match');
      expect(result).toContain('/also-good.txt:1:match');
      expect(result).not.toContain('bad.txt');
    });

    it('should handle empty file list', async () => {
      mockVFS.list.mockResolvedValue([]);

      const result = await call({ pattern: 'test' }, { VFS: mockVFS });

      expect(result).toBe('No matches found');
    });

    it('should handle empty files', async () => {
      mockVFS.list.mockResolvedValue(['/empty.txt']);
      mockVFS.read.mockResolvedValue('');

      const result = await call({ pattern: 'test' }, { VFS: mockVFS });

      expect(result).toBe('No matches found');
    });
  });

  describe('multiple matches per line', () => {
    it('should report line once even with multiple matches', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);
      mockVFS.read.mockResolvedValue('test test test');

      const result = await call({ pattern: 'test' }, { VFS: mockVFS });

      // Line should appear once, not three times
      const lines = result.split('\n');
      expect(lines.filter(l => l.includes('/file.txt:1:')).length).toBe(1);
    });
  });

  describe('output format', () => {
    it('should format results as path:line:content', async () => {
      mockVFS.list.mockResolvedValue(['/src/file.js']);
      mockVFS.read.mockResolvedValue('const x = 1;');

      const result = await call({ pattern: 'const' }, { VFS: mockVFS });

      expect(result).toBe('/src/file.js:1:const x = 1;');
    });

    it('should join multiple results with newlines', async () => {
      mockVFS.list.mockResolvedValue(['/a.txt', '/b.txt']);
      mockVFS.read.mockResolvedValue('match');

      const result = await call({ pattern: 'match' }, { VFS: mockVFS });

      expect(result).toBe('/a.txt:1:match\n/b.txt:1:match');
    });
  });
});
