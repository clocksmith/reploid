/**
 * @fileoverview Unit tests for ReadFile tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import call from '../../../tools/ReadFile.js';

describe('ReadFile', () => {
  let mockVFS;

  beforeEach(() => {
    mockVFS = {
      read: vi.fn(),
      write: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      exists: vi.fn(),
      stat: vi.fn().mockResolvedValue({ size: 100, type: 'file' })
    };
  });

  describe('call function', () => {
    it('should read file content from VFS', async () => {
      mockVFS.read.mockResolvedValue('file content');

      const result = await call({ path: '/test.txt' }, { VFS: mockVFS });

      expect(mockVFS.read).toHaveBeenCalledWith('/test.txt');
      expect(result.content).toBe('file content');
    });

    it('should support "file" as alias for "path"', async () => {
      mockVFS.read.mockResolvedValue('content');

      await call({ file: '/other.txt' }, { VFS: mockVFS });

      expect(mockVFS.read).toHaveBeenCalledWith('/other.txt');
    });

    it('should read a VFS text byte window with offset and length', async () => {
      mockVFS.stat.mockResolvedValue({ size: 16, type: 'file' });
      mockVFS.read.mockResolvedValue('0123456789abcdef');

      const result = await call({ path: '/blueprint-index.json', offset: 2, length: 4 }, { VFS: mockVFS });

      expect(result.backend).toBe('vfs');
      expect(result.encoding).toBe('utf-8');
      expect(result.content).toBe('2345');
      expect(result.range).toEqual({
        offset: 2,
        length: 4,
        requestedLength: 4,
        totalBytes: 16
      });
    });

    it('should tolerate binary alias for VFS text byte windows', async () => {
      mockVFS.stat.mockResolvedValue({ size: 16, type: 'file' });
      mockVFS.read.mockResolvedValue('0123456789abcdef');

      const result = await call({
        path: '/blueprint-index.json',
        binary: true,
        offset: 0,
        length: 5
      }, { VFS: mockVFS });

      expect(result.content).toBe('01234');
      expect(result.range.length).toBe(5);
    });

    it('should treat null VFS byte length as omitted', async () => {
      mockVFS.stat.mockResolvedValue({ size: 6, type: 'file' });
      mockVFS.read.mockResolvedValue('abcdef');

      const result = await call({ path: '/blueprint-index.json', length: null }, { VFS: mockVFS });

      expect(result.content).toBe('abcdef');
      expect(result.range).toBeUndefined();
    });

    it('should clamp excessive VFS byte length to maxBytes', async () => {
      mockVFS.stat.mockResolvedValue({ size: 16, type: 'file' });
      mockVFS.read.mockResolvedValue('0123456789abcdef');

      const result = await call({
        path: '/blueprint-index.json',
        offset: 0,
        length: 1e100,
        maxBytes: 5
      }, { VFS: mockVFS });

      expect(result.content).toBe('01234');
      expect(result.bytes).toBe(5);
      expect(result.range.requestedLength).toBe(1e100);
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

      expect(result.content).toBe('');
    });

    it('should handle binary-like content', async () => {
      const binaryContent = '\x00\x01\x02\x03';
      mockVFS.read.mockResolvedValue(binaryContent);

      const result = await call({ path: '/binary.bin' }, { VFS: mockVFS });

      expect(result.content).toBe(binaryContent);
    });

    it('should return a VFS directory listing when path has descendants', async () => {
      mockVFS.stat.mockResolvedValue(null);
      mockVFS.list.mockResolvedValue(['/artifacts/evidence.json']);

      const result = await call({ path: '/artifacts' }, { VFS: mockVFS });

      expect(mockVFS.list).toHaveBeenCalledWith('/artifacts');
      expect(mockVFS.read).not.toHaveBeenCalled();
      expect(result.type).toBe('directory');
      expect(result.content).toContain('Directory: /artifacts');
      expect(result.content).toContain('/artifacts/evidence.json');
    });

    it('should return an empty known VFS directory listing', async () => {
      mockVFS.stat.mockResolvedValue(null);
      mockVFS.list.mockResolvedValue([]);

      const result = await call({ path: '/artifacts' }, { VFS: mockVFS });

      expect(result.type).toBe('directory');
      expect(result.content).toContain('(no entries)');
      expect(result.content).toContain('WriteFile path: /artifacts/<name>');
    });

    it('should still throw for unknown missing files', async () => {
      mockVFS.stat.mockResolvedValue(null);
      mockVFS.list.mockResolvedValue([]);

      await expect(call({ path: '/missing.txt' }, { VFS: mockVFS }))
        .rejects.toThrow('File not found in VFS: /missing.txt');
    });

    it('should suggest existing VFS files for near-miss paths', async () => {
      mockVFS.stat.mockResolvedValue(null);
      mockVFS.list.mockImplementation(async (path) => {
        if (path === '/config') {
          return ['/config/genesis-levels.json'];
        }
        return [];
      });

      await expect(call({ path: '/config/genesis-levels.json_' }, { VFS: mockVFS }))
        .rejects.toThrow('Retry with ReadFile path: /config/genesis-levels.json.');
    });
  });
});
