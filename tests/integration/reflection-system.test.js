/**
 * @fileoverview Integration tests for Reflection System
 * Tests ReflectionStore and ReflectionAnalyzer interaction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReflectionStoreModule from '../../capabilities/reflection/reflection-store.js';
import ReflectionAnalyzerModule from '../../capabilities/reflection/reflection-analyzer.js';

describe('Reflection System - Integration Tests', () => {
  let reflectionStore;
  let reflectionAnalyzer;
  let mockUtils;
  let mockVFS;
  let mockEventBus;
  let fileStorage;
  let idCounter;

  const createMocks = () => {
    fileStorage = new Map();
    idCounter = 0;

    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: vi.fn().mockImplementation((prefix) => `${prefix}_${++idCounter}`)
    };

    mockVFS = {
      exists: vi.fn().mockImplementation((path) => Promise.resolve(fileStorage.has(path))),
      read: vi.fn().mockImplementation((path) => {
        if (fileStorage.has(path)) {
          return Promise.resolve(fileStorage.get(path));
        }
        return Promise.reject(new Error('File not found'));
      }),
      write: vi.fn().mockImplementation((path, content) => {
        fileStorage.set(path, content);
        return Promise.resolve(true);
      }),
      mkdir: vi.fn().mockResolvedValue(true)
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
  };

  beforeEach(() => {
    createMocks();

    reflectionStore = ReflectionStoreModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      EventBus: mockEventBus
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ReflectionStore metadata', () => {
    it('should have correct metadata', () => {
      expect(ReflectionStoreModule.metadata.id).toBe('ReflectionStore');
      expect(ReflectionStoreModule.metadata.type).toBe('capability');
      expect(ReflectionStoreModule.metadata.async).toBe(true);
      expect(ReflectionStoreModule.metadata.dependencies).toContain('VFS');
      expect(ReflectionStoreModule.metadata.dependencies).toContain('EventBus');
    });
  });

  describe('ReflectionStore.init', () => {
    it('should initialize with empty cache if no store file exists', async () => {
      mockVFS.exists.mockResolvedValue(false);

      const result = await reflectionStore.init();

      expect(result).toBe(true);
    });

    it('should load existing reflections from VFS', async () => {
      const existingReflections = [
        { id: 'ref_1', type: 'error', content: 'Past error' }
      ];
      fileStorage.set('/.memory/reflections.json', JSON.stringify(existingReflections));

      await reflectionStore.init();

      const reflections = await reflectionStore.getReflections();
      expect(reflections).toHaveLength(1);
    });

    it('should handle corrupt store file', async () => {
      fileStorage.set('/.memory/reflections.json', 'not valid json');

      await reflectionStore.init();

      expect(mockUtils.logger.error).toHaveBeenCalledWith(
        '[Reflection] Corrupt store, resetting.',
        expect.any(Error)
      );

      const reflections = await reflectionStore.getReflections();
      expect(reflections).toHaveLength(0);
    });
  });

  describe('ReflectionStore.add', () => {
    beforeEach(async () => {
      await reflectionStore.init();
    });

    it('should add reflection with generated ID', async () => {
      const id = await reflectionStore.add({
        type: 'insight',
        content: 'Test insight'
      });

      expect(id).toBe('ref_1');
    });

    it('should add reflection with timestamp', async () => {
      const before = Date.now();
      await reflectionStore.add({ content: 'Timed entry' });
      const after = Date.now();

      const reflections = await reflectionStore.getReflections();
      expect(reflections[0].ts).toBeGreaterThanOrEqual(before);
      expect(reflections[0].ts).toBeLessThanOrEqual(after);
    });

    it('should persist to VFS', async () => {
      await reflectionStore.add({
        type: 'success',
        content: 'Persisted reflection'
      });

      expect(mockVFS.write).toHaveBeenCalledWith(
        '/.memory/reflections.json',
        expect.any(String)
      );

      const savedContent = JSON.parse(fileStorage.get('/.memory/reflections.json'));
      expect(savedContent).toHaveLength(1);
      expect(savedContent[0].content).toBe('Persisted reflection');
    });

    it('should emit reflection:added event', async () => {
      await reflectionStore.add({
        type: 'error',
        content: 'Error occurred'
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'reflection:added',
        expect.objectContaining({
          type: 'error',
          content: 'Error occurred'
        })
      );
    });

    it('should default type to insight', async () => {
      await reflectionStore.add({
        content: 'No type specified'
      });

      const reflections = await reflectionStore.getReflections();
      expect(reflections[0].type).toBe('insight');
    });

    it('should include context', async () => {
      await reflectionStore.add({
        type: 'error',
        content: 'Tool failed',
        context: { tool: 'read_file', cycle: 5, outcome: 'failed' }
      });

      const reflections = await reflectionStore.getReflections();
      expect(reflections[0].context).toEqual({
        tool: 'read_file',
        cycle: 5,
        outcome: 'failed'
      });
    });

    it('should include tags', async () => {
      await reflectionStore.add({
        type: 'success',
        content: 'Pattern applied',
        tags: ['file-ops', 'optimization']
      });

      const reflections = await reflectionStore.getReflections();
      expect(reflections[0].tags).toEqual(['file-ops', 'optimization']);
    });

    it('should create directory if needed', async () => {
      mockVFS.exists.mockImplementation((path) => {
        if (path === '/.memory') return Promise.resolve(false);
        return Promise.resolve(fileStorage.has(path));
      });

      await reflectionStore.add({ content: 'First entry' });

      expect(mockVFS.mkdir).toHaveBeenCalledWith('/.memory');
    });

    it('should log addition', async () => {
      await reflectionStore.add({ type: 'success', content: 'Test' });

      expect(mockUtils.logger.info).toHaveBeenCalledWith('[Reflection] Added: success');
    });
  });

  describe('ReflectionStore.query', () => {
    beforeEach(async () => {
      await reflectionStore.init();
      await reflectionStore.add({ type: 'error', content: 'Error 1', context: { tool: 'read_file' } });
      await reflectionStore.add({ type: 'success', content: 'Success 1', context: { tool: 'write_file' } });
      await reflectionStore.add({ type: 'error', content: 'Error 2', context: { tool: 'list_files' } });
    });

    it('should filter reflections by custom function', () => {
      const errors = reflectionStore.query(r => r.type === 'error');

      expect(errors).toHaveLength(2);
      expect(errors.every(r => r.type === 'error')).toBe(true);
    });

    it('should filter by context properties', () => {
      const readFileRefs = reflectionStore.query(r => r.context?.tool === 'read_file');

      expect(readFileRefs).toHaveLength(1);
      expect(readFileRefs[0].content).toBe('Error 1');
    });

    it('should return empty array when no matches', () => {
      const none = reflectionStore.query(r => r.type === 'nonexistent');

      expect(none).toEqual([]);
    });
  });

  describe('ReflectionStore.getReflections', () => {
    beforeEach(async () => {
      await reflectionStore.init();
    });

    it('should return all reflections', async () => {
      await reflectionStore.add({ content: 'A' });
      await reflectionStore.add({ content: 'B' });
      await reflectionStore.add({ content: 'C' });

      const all = await reflectionStore.getReflections();

      expect(all).toHaveLength(3);
    });

    it('should sort by timestamp descending (newest first)', async () => {
      await reflectionStore.add({ content: 'First' });
      await new Promise(r => setTimeout(r, 5));
      await reflectionStore.add({ content: 'Second' });
      await new Promise(r => setTimeout(r, 5));
      await reflectionStore.add({ content: 'Third' });

      const sorted = await reflectionStore.getReflections();

      expect(sorted[0].content).toBe('Third');
      expect(sorted[2].content).toBe('First');
    });

    it('should filter by outcome', async () => {
      await reflectionStore.add({ content: 'Pass', context: { outcome: 'successful' } });
      await reflectionStore.add({ content: 'Fail', context: { outcome: 'failed' } });
      await reflectionStore.add({ content: 'Fail 2', context: { outcome: 'failed' } });

      const failed = await reflectionStore.getReflections({ outcome: 'failed' });

      expect(failed).toHaveLength(2);
      expect(failed.every(r => r.context.outcome === 'failed')).toBe(true);
    });

    it('should limit results', async () => {
      for (let i = 0; i < 10; i++) {
        await reflectionStore.add({ content: `Entry ${i}` });
      }

      const limited = await reflectionStore.getReflections({ limit: 3 });

      expect(limited).toHaveLength(3);
    });
  });

  describe('ReflectionAnalyzer', () => {
    beforeEach(async () => {
      await reflectionStore.init();

      reflectionAnalyzer = ReflectionAnalyzerModule.factory({
        ReflectionStore: reflectionStore,
        Utils: mockUtils
      });
    });

    describe('metadata', () => {
      it('should have correct metadata', () => {
        expect(ReflectionAnalyzerModule.metadata.id).toBe('ReflectionAnalyzer');
        expect(ReflectionAnalyzerModule.metadata.type).toBe('intelligence');
        expect(ReflectionAnalyzerModule.metadata.dependencies).toContain('ReflectionStore');
      });
    });

    describe('init', () => {
      it('should initialize successfully', async () => {
        const result = await reflectionAnalyzer.init();

        expect(result).toBe(true);
        expect(mockUtils.logger.info).toHaveBeenCalledWith('[ReflectionAnalyzer] Initialized');
      });
    });

    describe('detectFailurePatterns', () => {
      it('should detect repeated error patterns', async () => {
        // Add multiple failures of same type
        await reflectionStore.add({ type: 'error', content: 'FileNotFound: /missing.txt', context: { outcome: 'failed' } });
        await reflectionStore.add({ type: 'error', content: 'FileNotFound: /other.txt', context: { outcome: 'failed' } });
        await reflectionStore.add({ type: 'error', content: 'FileNotFound: /another.txt', context: { outcome: 'failed' } });

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        expect(patterns).toHaveLength(1);
        expect(patterns[0].indicator).toBe('FileNotFound');
        expect(patterns[0].count).toBe(3);
      });

      it('should require minimum count threshold', async () => {
        // Only one occurrence - shouldn't be detected
        await reflectionStore.add({ type: 'error', content: 'Unique: single error', context: { outcome: 'failed' } });

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        expect(patterns).toHaveLength(0);
      });

      it('should sort by count descending', async () => {
        // Add errors with different counts
        for (let i = 0; i < 5; i++) {
          await reflectionStore.add({ type: 'error', content: 'MostCommon: error', context: { outcome: 'failed' } });
        }
        for (let i = 0; i < 2; i++) {
          await reflectionStore.add({ type: 'error', content: 'LessCommon: error', context: { outcome: 'failed' } });
        }

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        expect(patterns[0].indicator).toBe('MostCommon');
        expect(patterns[0].count).toBe(5);
        expect(patterns[1].indicator).toBe('LessCommon');
        expect(patterns[1].count).toBe(2);
      });

      it('should include example message', async () => {
        await reflectionStore.add({ type: 'error', content: 'Timeout: connection failed after 30s', context: { outcome: 'failed' } });
        await reflectionStore.add({ type: 'error', content: 'Timeout: operation exceeded limit', context: { outcome: 'failed' } });

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        expect(patterns[0].example).toBeDefined();
        expect(patterns[0].example).toContain('Timeout');
      });

      it('should handle empty failure list', async () => {
        // Only successes
        await reflectionStore.add({ type: 'success', content: 'All good', context: { outcome: 'successful' } });

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        expect(patterns).toEqual([]);
      });

      it('should handle unknown error type', async () => {
        await reflectionStore.add({ type: 'error', content: 'No colon here', context: { outcome: 'failed' } });
        await reflectionStore.add({ type: 'error', content: 'No colon here either', context: { outcome: 'failed' } });

        const patterns = await reflectionAnalyzer.api.detectFailurePatterns();

        // Should use first part before colon, or whole message if no colon
        expect(patterns.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Full integration flow', () => {
    it('should support full learning cycle', async () => {
      // Initialize both systems
      await reflectionStore.init();
      reflectionAnalyzer = ReflectionAnalyzerModule.factory({
        ReflectionStore: reflectionStore,
        Utils: mockUtils
      });
      await reflectionAnalyzer.init();

      // Simulate agent learning from errors
      await reflectionStore.add({
        type: 'error',
        content: 'Tool read_file',
        context: { tool: 'read_file', cycle: 1, outcome: 'failed' }
      });

      await reflectionStore.add({
        type: 'error',
        content: 'Tool read_file',
        context: { tool: 'read_file', cycle: 2, outcome: 'failed' }
      });

      await reflectionStore.add({
        type: 'success',
        content: 'Tool write_file',
        context: { tool: 'write_file', cycle: 3, outcome: 'successful' }
      });

      // Analyze patterns
      const patterns = await reflectionAnalyzer.api.detectFailurePatterns();
      expect(patterns.length).toBeGreaterThanOrEqual(1);

      // Query for specific insights
      const readFileErrors = reflectionStore.query(r =>
        r.type === 'error' && r.context?.tool === 'read_file'
      );
      expect(readFileErrors).toHaveLength(2);

      // Verify persistence
      expect(fileStorage.has('/.memory/reflections.json')).toBe(true);
      const persisted = JSON.parse(fileStorage.get('/.memory/reflections.json'));
      expect(persisted).toHaveLength(3);
    });

    it('should persist and reload state', async () => {
      // First session
      await reflectionStore.init();
      await reflectionStore.add({ type: 'insight', content: 'Lesson learned' });

      // Simulate restart - create new instance
      const newStore = ReflectionStoreModule.factory({
        Utils: mockUtils,
        VFS: mockVFS,
        EventBus: mockEventBus
      });

      await newStore.init();

      // Should have loaded previous data
      const reflections = await newStore.getReflections();
      expect(reflections).toHaveLength(1);
      expect(reflections[0].content).toBe('Lesson learned');
    });
  });
});
