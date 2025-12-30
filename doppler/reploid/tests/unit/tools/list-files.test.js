/**
 * @fileoverview Unit tests for ListFiles tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/ListFiles.js';

describe('ListFiles', () => {
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
      expect(tool.name).toBe('ListFiles');
    });

    it('should be marked as readOnly', () => {
      expect(tool.readOnly).toBe(true);
    });

    it('should have path as optional property', () => {
      expect(tool.inputSchema.required).toBeUndefined();
    });
  });

  describe('call function', () => {
    it('should list files in specified directory', async () => {
      const files = ['/dir/file1.txt', '/dir/file2.txt'];
      mockVFS.list.mockResolvedValue(files);

      const result = await call({ path: '/dir' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/dir');
      expect(result).toEqual(files);
    });

    it('should default to root when no path specified', async () => {
      mockVFS.list.mockResolvedValue(['/file.txt']);

      await call({}, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/');
    });

    it('should support "directory" as alias for "path"', async () => {
      mockVFS.list.mockResolvedValue([]);

      await call({ directory: '/tools' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/tools');
    });

    it('should support "dir" as alias for "path"', async () => {
      mockVFS.list.mockResolvedValue([]);

      await call({ dir: '/core' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/core');
    });

    it('should throw error when VFS not available', async () => {
      await expect(call({}, {}))
        .rejects.toThrow('VFS not available');
    });

    it('should return empty array for empty directory', async () => {
      mockVFS.list.mockResolvedValue([]);

      const result = await call({ path: '/empty' }, { VFS: mockVFS });

      expect(result).toEqual([]);
    });

    it('should propagate VFS list errors', async () => {
      mockVFS.list.mockRejectedValue(new Error('Directory not found'));

      await expect(call({ path: '/missing' }, { VFS: mockVFS }))
        .rejects.toThrow('Directory not found');
    });

    it('should handle nested paths', async () => {
      const files = ['/deep/nested/path/file.txt'];
      mockVFS.list.mockResolvedValue(files);

      const result = await call({ path: '/deep/nested/path' }, { VFS: mockVFS });

      expect(result).toEqual(files);
    });
  });
});
