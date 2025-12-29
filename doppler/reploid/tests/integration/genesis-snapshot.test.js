/**
 * @fileoverview Integration tests for GenesisSnapshot and Lifeboat
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import GenesisSnapshotModule from '../../infrastructure/genesis-snapshot.js';

describe('GenesisSnapshot - Integration Tests', () => {
  let genesisSnapshot;
  let mockUtils;
  let mockVFS;
  let mockEventBus;
  let mockLocalStorage;

  const createMocks = () => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix = 'id') => `${prefix}_${Date.now()}`),
      trunc: (str, len) => (str?.length > len ? str.slice(0, len) : str)
    };

    // Mock VFS with in-memory storage
    const vfsStorage = new Map();
    mockVFS = {
      list: vi.fn().mockImplementation(async (dir) => {
        const files = [];
        for (const path of vfsStorage.keys()) {
          if (path.startsWith(dir)) {
            files.push(path);
          }
        }
        return files;
      }),
      read: vi.fn().mockImplementation(async (path) => {
        if (!vfsStorage.has(path)) throw new Error(`File not found: ${path}`);
        return vfsStorage.get(path);
      }),
      write: vi.fn().mockImplementation(async (path, content) => {
        vfsStorage.set(path, content);
        return true;
      }),
      exists: vi.fn().mockImplementation(async (path) => vfsStorage.has(path)),
      delete: vi.fn().mockImplementation(async (path) => {
        vfsStorage.delete(path);
        return true;
      }),
      stat: vi.fn().mockImplementation(async (path) => {
        if (!vfsStorage.has(path)) throw new Error(`File not found: ${path}`);
        return { isDirectory: false, size: vfsStorage.get(path)?.length || 0 };
      }),
      _storage: vfsStorage // Expose for test manipulation
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    // Mock localStorage
    const localStorageData = new Map();
    mockLocalStorage = {
      getItem: vi.fn().mockImplementation((key) => localStorageData.get(key) || null),
      setItem: vi.fn().mockImplementation((key, value) => localStorageData.set(key, value)),
      removeItem: vi.fn().mockImplementation((key) => localStorageData.delete(key)),
      _data: localStorageData // Expose for test manipulation
    };

    // Inject mock localStorage globally
    global.localStorage = mockLocalStorage;

    genesisSnapshot = GenesisSnapshotModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      EventBus: mockEventBus
    });
  };

  beforeEach(() => {
    createMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete global.localStorage;
  });

  describe('Lifeboat', () => {
    it('creates lifeboat from core and infrastructure files', async () => {
      // Setup: Add core and infrastructure files
      mockVFS._storage.set('/core/agent-loop.js', 'const loop = () => {};');
      mockVFS._storage.set('/core/tool-runner.js', 'const runner = {};');
      mockVFS._storage.set('/infrastructure/hitl-controller.js', 'const hitl = {};');
      mockVFS._storage.set('/tools/ReadFile.js', 'export default () => {};'); // Should NOT be in lifeboat

      const result = await genesisSnapshot.createLifeboat();

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(3); // Only core + infrastructure
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'REPLOID_LIFEBOAT',
        expect.any(String)
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'genesis:lifeboat_created',
        expect.objectContaining({ fileCount: 3 })
      );
    });

    it('restores from lifeboat after VFS corruption', async () => {
      // Setup: Create initial state
      mockVFS._storage.set('/core/agent-loop.js', 'const loop = () => {};');
      mockVFS._storage.set('/core/tool-runner.js', 'const runner = {};');
      mockVFS._storage.set('/infrastructure/hitl-controller.js', 'const hitl = {};');

      // Create lifeboat
      await genesisSnapshot.createLifeboat();

      // Simulate corruption: modify and delete files
      mockVFS._storage.set('/core/agent-loop.js', 'CORRUPTED!!!');
      mockVFS._storage.delete('/core/tool-runner.js');
      mockVFS._storage.set('/infrastructure/hitl-controller.js', 'ALSO CORRUPTED');

      // Restore from lifeboat
      const result = await genesisSnapshot.restoreFromLifeboat();

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(3);

      // Verify files are restored
      expect(mockVFS._storage.get('/core/agent-loop.js')).toBe('const loop = () => {};');
      expect(mockVFS._storage.get('/core/tool-runner.js')).toBe('const runner = {};');
      expect(mockVFS._storage.get('/infrastructure/hitl-controller.js')).toBe('const hitl = {};');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'genesis:lifeboat_restored',
        expect.objectContaining({ fileCount: 3 })
      );
    });

    it('hasLifeboat returns true after creation', async () => {
      expect(genesisSnapshot.hasLifeboat()).toBe(false);

      mockVFS._storage.set('/core/test.js', 'test');
      await genesisSnapshot.createLifeboat();

      expect(genesisSnapshot.hasLifeboat()).toBe(true);
    });

    it('getLifeboatInfo returns metadata', async () => {
      mockVFS._storage.set('/core/agent-loop.js', 'const loop = () => {};');
      await genesisSnapshot.createLifeboat();

      const info = genesisSnapshot.getLifeboatInfo();

      expect(info).toHaveProperty('timestamp');
      expect(info).toHaveProperty('fileCount');
      expect(info).toHaveProperty('sizeBytes');
      expect(info.fileCount).toBe(1);
    });

    it('handles empty lifeboat gracefully', async () => {
      // No core/infrastructure files exist
      const result = await genesisSnapshot.createLifeboat();

      expect(result.success).toBe(true);
      expect(result.fileCount).toBe(0);
    });

    it('fails restore gracefully when no lifeboat exists', async () => {
      const result = await genesisSnapshot.restoreFromLifeboat();

      expect(result.success).toBe(false);
      expect(mockUtils.logger.warn).toHaveBeenCalled();
    });
  });

  describe('Snapshots', () => {
    it('creates and restores VFS snapshot', async () => {
      // Setup initial state
      mockVFS._storage.set('/core/agent-loop.js', 'const loop = () => {};');
      mockVFS._storage.set('/tools/ReadFile.js', 'export default () => {};');

      // Create snapshot
      const snapshot = await genesisSnapshot.createSnapshot('test-snapshot');

      expect(snapshot).toHaveProperty('id');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot.fileCount).toBe(2);

      // Modify state
      mockVFS._storage.set('/core/agent-loop.js', 'MODIFIED');
      mockVFS._storage.set('/new-file.js', 'new content');

      // Restore snapshot
      const result = await genesisSnapshot.restoreSnapshot(snapshot.id);

      expect(result.success).toBe(true);
      expect(mockVFS._storage.get('/core/agent-loop.js')).toBe('const loop = () => {};');
    });

    it('lists available snapshots', async () => {
      mockVFS._storage.set('/core/test.js', 'test');

      await genesisSnapshot.createSnapshot('snap-1');
      await genesisSnapshot.createSnapshot('snap-2');

      const snapshots = await genesisSnapshot.listSnapshots();

      expect(snapshots.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('RSI Safety Integration', () => {
    it('lifeboat survives complete VFS wipe', async () => {
      // Setup and create lifeboat
      mockVFS._storage.set('/core/agent-loop.js', 'const loop = () => {};');
      mockVFS._storage.set('/infrastructure/genesis-snapshot.js', 'const genesis = {};');
      await genesisSnapshot.createLifeboat();

      // Wipe VFS completely
      mockVFS._storage.clear();
      expect(mockVFS._storage.size).toBe(0);

      // Lifeboat is in localStorage, not VFS
      expect(genesisSnapshot.hasLifeboat()).toBe(true);

      // Restore from lifeboat
      const result = await genesisSnapshot.restoreFromLifeboat();

      expect(result.success).toBe(true);
      expect(mockVFS._storage.size).toBe(2);
      expect(mockVFS._storage.has('/core/agent-loop.js')).toBe(true);
    });
  });
});
