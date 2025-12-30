/**
 * @fileoverview Unit tests for Find tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/Find.js';

describe('Find', () => {
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
      expect(tool.name).toBe('Find');
    });

    it('should be marked as readOnly', () => {
      expect(tool.readOnly).toBe(true);
    });
  });

  describe('validation', () => {
    it('should throw error when VFS not available', async () => {
      await expect(call({}, {}))
        .rejects.toThrow('VFS not available');
    });
  });

  describe('listing all files', () => {
    it('should list all files when no name pattern provided', async () => {
      mockVFS.list.mockResolvedValue(['/a.txt', '/b.txt', '/c.txt']);

      const result = await call({}, { VFS: mockVFS });

      expect(result).toBe('/a.txt\n/b.txt\n/c.txt');
    });

    it('should default to root path', async () => {
      mockVFS.list.mockResolvedValue([]);

      await call({}, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/');
    });

    it('should search in specified path', async () => {
      mockVFS.list.mockResolvedValue(['/tools/tool.js']);

      await call({ path: '/tools' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/tools');
    });
  });

  describe('glob patterns', () => {
    it('should match exact file name', async () => {
      mockVFS.list.mockResolvedValue(['/dir/file.txt', '/dir/other.txt', '/dir/file.js']);

      const result = await call({ name: 'file.txt' }, { VFS: mockVFS });

      expect(result).toBe('/dir/file.txt');
    });

    it('should support * wildcard (any characters)', async () => {
      mockVFS.list.mockResolvedValue([
        '/src/app.js',
        '/src/utils.js',
        '/src/style.css',
        '/src/readme.md'
      ]);

      const result = await call({ name: '*.js' }, { VFS: mockVFS });

      expect(result).toBe('/src/app.js\n/src/utils.js');
    });

    it('should support ? wildcard (single character)', async () => {
      mockVFS.list.mockResolvedValue([
        '/file1.txt',
        '/file2.txt',
        '/file10.txt',
        '/files.txt'
      ]);

      const result = await call({ name: 'file?.txt' }, { VFS: mockVFS });

      // ? matches any single character, so file1, file2, files all match
      expect(result).toBe('/file1.txt\n/file2.txt\n/files.txt');
    });

    it('should match prefix with *', async () => {
      mockVFS.list.mockResolvedValue([
        '/test-one.js',
        '/test-two.js',
        '/other.js'
      ]);

      const result = await call({ name: 'test-*' }, { VFS: mockVFS });

      expect(result).toBe('/test-one.js\n/test-two.js');
    });

    it('should match suffix with *', async () => {
      mockVFS.list.mockResolvedValue([
        '/app.test.js',
        '/utils.test.js',
        '/app.js'
      ]);

      const result = await call({ name: '*.test.js' }, { VFS: mockVFS });

      expect(result).toBe('/app.test.js\n/utils.test.js');
    });
  });

  describe('case insensitivity', () => {
    it('should match case insensitively', async () => {
      mockVFS.list.mockResolvedValue([
        '/README.md',
        '/readme.md',
        '/ReadMe.md'
      ]);

      const result = await call({ name: 'readme.md' }, { VFS: mockVFS });

      expect(result).toContain('/README.md');
      expect(result).toContain('/readme.md');
      expect(result).toContain('/ReadMe.md');
    });
  });

  describe('special characters', () => {
    it('should escape regex special characters in pattern', async () => {
      mockVFS.list.mockResolvedValue([
        '/file.test.js',
        '/filetestjs',
        '/file[test].js'
      ]);

      const result = await call({ name: 'file.test.js' }, { VFS: mockVFS });

      // Should match literal dot, not any character
      expect(result).toBe('/file.test.js');
    });

    it('should handle parentheses in file names', async () => {
      mockVFS.list.mockResolvedValue([
        '/func(1).js',
        '/func(2).js',
        '/func.js'
      ]);

      const result = await call({ name: 'func(*).js' }, { VFS: mockVFS });

      expect(result).toBe('/func(1).js\n/func(2).js');
    });
  });

  describe('path matching', () => {
    it('should match only file name, not full path', async () => {
      mockVFS.list.mockResolvedValue([
        '/deep/nested/path/file.txt',
        '/shallow/file.txt'
      ]);

      const result = await call({ name: 'file.txt' }, { VFS: mockVFS });

      expect(result).toContain('/deep/nested/path/file.txt');
      expect(result).toContain('/shallow/file.txt');
    });

    it('should not match directory names', async () => {
      mockVFS.list.mockResolvedValue([
        '/tools/ReadFile.js',
        '/tools/WriteFile.js'
      ]);

      const result = await call({ name: 'tools' }, { VFS: mockVFS });

      expect(result).toBe('');
    });
  });

  describe('empty results', () => {
    it('should return empty string when no matches', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt', '/other.js']);

      const result = await call({ name: '*.md' }, { VFS: mockVFS });

      expect(result).toBe('');
    });

    it('should return empty string when directory is empty', async () => {
      mockVFS.list.mockResolvedValue([]);

      const result = await call({ name: '*.js' }, { VFS: mockVFS });

      expect(result).toBe('');
    });
  });

  describe('output format', () => {
    it('should join results with newlines', async () => {
      mockVFS.list.mockResolvedValue(['/a.js', '/b.js', '/c.js']);

      const result = await call({ name: '*.js' }, { VFS: mockVFS });

      expect(result).toBe('/a.js\n/b.js\n/c.js');
    });

    it('should return single file without trailing newline', async () => {
      mockVFS.list.mockResolvedValue(['/only.js']);

      const result = await call({ name: '*.js' }, { VFS: mockVFS });

      expect(result).toBe('/only.js');
    });
  });

  describe('complex patterns', () => {
    it('should handle multiple wildcards', async () => {
      mockVFS.list.mockResolvedValue([
        '/test-utils-v1.js',
        '/test-helpers-v2.js',
        '/prod-utils-v1.js'
      ]);

      const result = await call({ name: 'test-*-v?.js' }, { VFS: mockVFS });

      expect(result).toBe('/test-utils-v1.js\n/test-helpers-v2.js');
    });
  });
});
