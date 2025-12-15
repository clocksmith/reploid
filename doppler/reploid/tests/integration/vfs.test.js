/**
 * @fileoverview Integration tests for VFS (Virtual File System)
 * Tests IndexedDB-backed file operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VFSModule from '../../core/vfs.js';

describe('VFS - Integration Tests', () => {
  let vfs;
  let mockUtils;
  let mockDB;
  let mockObjectStore;
  let mockTransaction;
  let fileStorage;

  const createMocks = () => {
    fileStorage = new Map();

    mockObjectStore = {
      put: vi.fn().mockImplementation((entry) => {
        fileStorage.set(entry.path, entry);
        return { onsuccess: null, set onsuccess(fn) { fn?.(); } };
      }),
      get: vi.fn().mockImplementation((path) => {
        const result = fileStorage.get(path) || null;
        return {
          result,
          onsuccess: null,
          onerror: null,
          set onsuccess(fn) { fn?.(); }
        };
      }),
      delete: vi.fn().mockImplementation((path) => {
        fileStorage.delete(path);
        return {
          onsuccess: null,
          onerror: null,
          set onsuccess(fn) { fn?.(); }
        };
      }),
      getAllKeys: vi.fn().mockImplementation(() => {
        return {
          result: Array.from(fileStorage.keys()),
          onsuccess: null,
          set onsuccess(fn) { fn?.(); }
        };
      }),
      count: vi.fn().mockImplementation(() => {
        return {
          result: fileStorage.size,
          onsuccess: null,
          set onsuccess(fn) { fn?.(); }
        };
      }),
      clear: vi.fn().mockImplementation(() => {
        fileStorage.clear();
        return {
          onsuccess: null,
          set onsuccess(fn) { fn?.(); }
        };
      })
    };

    mockTransaction = {
      objectStore: vi.fn().mockReturnValue(mockObjectStore),
      onerror: null
    };

    mockDB = {
      transaction: vi.fn().mockReturnValue(mockTransaction),
      objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
      createObjectStore: vi.fn()
    };

    // Mock indexedDB - use queueMicrotask for better async handling
    global.indexedDB = {
      open: vi.fn().mockImplementation(() => {
        const mockRequest = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          result: mockDB
        };

        // Use queueMicrotask to ensure callback fires in correct order
        queueMicrotask(() => {
          if (mockRequest.onsuccess) {
            mockRequest.onsuccess({ target: { result: mockDB } });
          }
        });

        return mockRequest;
      })
    };

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      Errors: {
        ValidationError: class ValidationError extends Error {
          constructor(msg) { super(msg); this.name = 'ValidationError'; }
        },
        StateError: class StateError extends Error {
          constructor(msg) { super(msg); this.name = 'StateError'; }
        },
        ArtifactError: class ArtifactError extends Error {
          constructor(msg) { super(msg); this.name = 'ArtifactError'; }
        }
      }
    };
  };

  beforeEach(() => {
    createMocks();
    vfs = VFSModule.factory({ Utils: mockUtils });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete global.indexedDB;
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(VFSModule.metadata.id).toBe('VFS');
      expect(VFSModule.metadata.type).toBe('service');
      expect(VFSModule.metadata.async).toBe(true);
      expect(VFSModule.metadata.dependencies).toContain('Utils');
    });
  });

  describe('init', () => {
    it('should open database connection', async () => {
      const result = await vfs.init();

      expect(result).toBe(true);
      expect(global.indexedDB.open).toHaveBeenCalledWith('reploid-vfs-v2', 1);
    });

    it('should log successful connection', async () => {
      await vfs.init();

      expect(mockUtils.logger.info).toHaveBeenCalledWith('[VFS] Database connected');
    });

    it('should reuse existing connection', async () => {
      await vfs.init();
      await vfs.init();
      await vfs.init();

      expect(global.indexedDB.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('write', () => {
    it('should write file to storage', async () => {
      await vfs.write('/test.txt', 'Hello World');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        path: '/test.txt',
        content: 'Hello World'
      }));
    });

    it('should normalize path', async () => {
      await vfs.write('test.txt', 'Content');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        path: '/test.txt'
      }));
    });

    it('should record file size', async () => {
      await vfs.write('/data.txt', '12345');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        size: 5
      }));
    });

    it('should record update timestamp', async () => {
      const before = Date.now();
      await vfs.write('/timed.txt', 'data');
      const after = Date.now();

      const putCall = mockObjectStore.put.mock.calls[0][0];
      expect(putCall.updated).toBeGreaterThanOrEqual(before);
      expect(putCall.updated).toBeLessThanOrEqual(after);
    });

    it('should set type as file', async () => {
      await vfs.write('/file.txt', 'content');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        type: 'file'
      }));
    });

    it('should handle backslashes in path', async () => {
      await vfs.write('path\\to\\file.txt', 'content');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        path: '/path/to/file.txt'
      }));
    });
  });

  describe('read', () => {
    it('should read file content', async () => {
      fileStorage.set('/test.txt', { path: '/test.txt', content: 'File content' });

      const content = await vfs.read('/test.txt');

      expect(content).toBe('File content');
    });

    it('should throw for non-existent file', async () => {
      await expect(vfs.read('/missing.txt'))
        .rejects.toThrow('File not found');
    });

    it('should normalize path before reading', async () => {
      fileStorage.set('/normalized.txt', { content: 'data' });

      await vfs.read('normalized.txt');

      expect(mockObjectStore.get).toHaveBeenCalledWith('/normalized.txt');
    });
  });

  describe('delete', () => {
    it('should remove file from storage', async () => {
      fileStorage.set('/to-delete.txt', { content: 'delete me' });

      await vfs.delete('/to-delete.txt');

      expect(mockObjectStore.delete).toHaveBeenCalledWith('/to-delete.txt');
    });

    it('should log deletion', async () => {
      await vfs.delete('/deleted.txt');

      expect(mockUtils.logger.info).toHaveBeenCalledWith('[VFS] Deleted /deleted.txt');
    });
  });

  describe('list', () => {
    it('should list files in directory', async () => {
      fileStorage.set('/dir/file1.txt', { content: 'a' });
      fileStorage.set('/dir/file2.txt', { content: 'b' });
      fileStorage.set('/other/file.txt', { content: 'c' });

      const files = await vfs.list('/dir');

      expect(files).toContain('/dir/file1.txt');
      expect(files).toContain('/dir/file2.txt');
      expect(files).not.toContain('/other/file.txt');
    });

    it('should default to root directory', async () => {
      fileStorage.set('/root-file.txt', { content: 'data' });

      const files = await vfs.list();

      expect(files).toContain('/root-file.txt');
    });

    it('should handle directory with trailing slash', async () => {
      fileStorage.set('/test/nested.txt', { content: 'x' });

      const files = await vfs.list('/test/');

      expect(files).toContain('/test/nested.txt');
    });

    it('should return empty array for empty directory', async () => {
      const files = await vfs.list('/empty');

      expect(files).toEqual([]);
    });
  });

  describe('stat', () => {
    it('should return file metadata', async () => {
      fileStorage.set('/meta.txt', {
        path: '/meta.txt',
        content: 'data',
        size: 4,
        updated: 1000,
        type: 'file'
      });

      const stat = await vfs.stat('/meta.txt');

      expect(stat).toEqual({
        path: '/meta.txt',
        size: 4,
        updated: 1000,
        type: 'file'
      });
    });

    it('should return null for non-existent file', async () => {
      const stat = await vfs.stat('/nonexistent.txt');

      expect(stat).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      fileStorage.set('/exists.txt', { content: 'yes' });

      const result = await vfs.exists('/exists.txt');

      expect(result).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const result = await vfs.exists('/missing.txt');

      expect(result).toBe(false);
    });
  });

  describe('isEmpty', () => {
    it('should return true when no files exist', async () => {
      fileStorage.clear();

      const result = await vfs.isEmpty();

      expect(result).toBe(true);
    });

    it('should return false when files exist', async () => {
      fileStorage.set('/file.txt', { content: 'data' });

      const result = await vfs.isEmpty();

      expect(result).toBe(false);
    });
  });

  describe('mkdir', () => {
    it('should succeed (virtual directory)', async () => {
      const result = await vfs.mkdir('/new-dir');

      expect(result).toBe(true);
    });

    it('should log debug message', async () => {
      await vfs.mkdir('/my-dir');

      expect(mockUtils.logger.debug).toHaveBeenCalledWith('[VFS] mkdir /my-dir (virtual)');
    });
  });

  describe('clear', () => {
    it('should remove all files', async () => {
      fileStorage.set('/a.txt', { content: 'a' });
      fileStorage.set('/b.txt', { content: 'b' });

      const result = await vfs.clear();

      expect(result).toBe(true);
      expect(mockObjectStore.clear).toHaveBeenCalled();
    });
  });

  describe('path normalization', () => {
    it('should throw for null path', async () => {
      await expect(vfs.write(null, 'content'))
        .rejects.toThrow('Invalid path');
    });

    it('should throw for undefined path', async () => {
      await expect(vfs.read(undefined))
        .rejects.toThrow('Invalid path');
    });

    it('should throw for non-string path', async () => {
      await expect(vfs.stat(123))
        .rejects.toThrow('Invalid path');
    });

    it('should trim whitespace from path', async () => {
      await vfs.write('  /spaced.txt  ', 'content');

      expect(mockObjectStore.put).toHaveBeenCalledWith(expect.objectContaining({
        path: '/spaced.txt'
      }));
    });
  });

  describe('CRUD operations flow', () => {
    it('should support full file lifecycle', async () => {
      // Create
      await vfs.write('/lifecycle.txt', 'initial content');
      expect(fileStorage.has('/lifecycle.txt')).toBe(true);

      // Read
      fileStorage.get('/lifecycle.txt').content = 'initial content';
      const content = await vfs.read('/lifecycle.txt');
      expect(content).toBe('initial content');

      // Update
      await vfs.write('/lifecycle.txt', 'updated content');
      expect(fileStorage.get('/lifecycle.txt').content).toBe('updated content');

      // Delete
      await vfs.delete('/lifecycle.txt');
      expect(fileStorage.has('/lifecycle.txt')).toBe(false);
    });

    it('should handle nested directory structure', async () => {
      await vfs.write('/a/b/c/deep.txt', 'deep file');
      await vfs.write('/a/b/sibling.txt', 'sibling');
      await vfs.write('/a/parent.txt', 'parent');

      const deepFiles = await vfs.list('/a/b/c');
      expect(deepFiles).toHaveLength(1);
      expect(deepFiles[0]).toBe('/a/b/c/deep.txt');

      const bFiles = await vfs.list('/a/b');
      expect(bFiles).toHaveLength(2);
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple simultaneous writes', async () => {
      await Promise.all([
        vfs.write('/concurrent1.txt', 'content1'),
        vfs.write('/concurrent2.txt', 'content2'),
        vfs.write('/concurrent3.txt', 'content3')
      ]);

      expect(fileStorage.size).toBe(3);
    });

    it('should handle read while writing', async () => {
      fileStorage.set('/existing.txt', { content: 'original' });

      const [readResult] = await Promise.all([
        vfs.read('/existing.txt'),
        vfs.write('/new.txt', 'new content')
      ]);

      expect(readResult).toBe('original');
    });
  });
});
