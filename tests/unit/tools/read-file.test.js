/**
 * @fileoverview Unit tests for ReadFile tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call, { tool } from '../../../tools/ReadFile.js';

describe('ReadFile', () => {
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
      expect(tool.name).toBe('ReadFile');
    });

    it('should be marked as readOnly', () => {
      expect(tool.readOnly).toBe(true);
    });

    it('should have path as required property', () => {
      expect(tool.inputSchema.required).toContain('path');
    });
  });

  describe('call function', () => {
    it('should read file content from VFS', async () => {
      mockVFS.read.mockResolvedValue('file content');

      const result = await call({ path: '/test.txt' }, { VFS: mockVFS });

      expect(mockVFS.read).toHaveBeenCalledWith('/test.txt');
      expect(result).toBe('file content');
    });

    it('should support "file" as alias for "path"', async () => {
      mockVFS.read.mockResolvedValue('content');

      await call({ file: '/other.txt' }, { VFS: mockVFS });

      expect(mockVFS.read).toHaveBeenCalledWith('/other.txt');
    });

    it('should throw error when VFS not available', async () => {
      await expect(call({ path: '/test.txt' }, {}))
        .rejects.toThrow('VFS not available');
    });

    it('should throw error when path missing', async () => {
      await expect(call({}, { VFS: mockVFS }))
        .rejects.toThrow('Missing path argument');
    });

    it('should propagate VFS read errors', async () => {
      mockVFS.read.mockRejectedValue(new Error('File not found'));

      await expect(call({ path: '/missing.txt' }, { VFS: mockVFS }))
        .rejects.toThrow('File not found');
    });

    it('should handle empty file content', async () => {
      mockVFS.read.mockResolvedValue('');

      const result = await call({ path: '/empty.txt' }, { VFS: mockVFS });

      expect(result).toBe('');
    });

    it('should handle binary-like content', async () => {
      const binaryContent = '\x00\x01\x02\x03';
      mockVFS.read.mockResolvedValue(binaryContent);

      const result = await call({ path: '/binary.bin' }, { VFS: mockVFS });

      expect(result).toBe(binaryContent);
    });
  });
});
