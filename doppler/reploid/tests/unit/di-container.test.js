/**
 * @fileoverview Unit tests for DIContainer module
 * Tests dependency injection, circular dependency detection, and lifecycle management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Utils
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

import DIContainerModule from '../../infrastructure/di-container.js';

describe('DIContainer', () => {
  let container;
  let mockUtils;

  beforeEach(() => {
    mockUtils = createMockUtils();
    container = DIContainerModule.factory({ Utils: mockUtils });
  });

  describe('register', () => {
    it('should register a module with valid metadata', () => {
      const testModule = {
        metadata: {
          id: 'TestModule',
          dependencies: [],
          type: 'service'
        },
        factory: () => ({ test: true })
      };

      expect(() => container.register(testModule)).not.toThrow();
    });

    it('should throw error for module without metadata', () => {
      const invalidModule = {
        factory: () => ({})
      };

      expect(() => container.register(invalidModule))
        .toThrow('Invalid module registration');
    });

    it('should throw error for module without id', () => {
      const invalidModule = {
        metadata: { dependencies: [] },
        factory: () => ({})
      };

      expect(() => container.register(invalidModule))
        .toThrow('Invalid module registration');
    });

    it('should allow overwriting a registered module', () => {
      const moduleV1 = {
        metadata: { id: 'TestModule', dependencies: [] },
        factory: () => ({ version: 1 })
      };

      const moduleV2 = {
        metadata: { id: 'TestModule', dependencies: [] },
        factory: () => ({ version: 2 })
      };

      container.register(moduleV1);
      container.register(moduleV2);

      // Should not throw, v2 overwrites v1
      expect(container.resolve('TestModule')).resolves.toHaveProperty('version', 2);
    });
  });

  describe('resolve', () => {
    it('should resolve a simple module without dependencies', async () => {
      const testModule = {
        metadata: { id: 'SimpleModule', dependencies: [] },
        factory: () => ({ value: 42 })
      };

      container.register(testModule);
      const instance = await container.resolve('SimpleModule');

      expect(instance).toEqual({ value: 42 });
    });

    it('should cache resolved instances', async () => {
      let callCount = 0;
      const testModule = {
        metadata: { id: 'CachedModule', dependencies: [] },
        factory: () => {
          callCount++;
          return { count: callCount };
        }
      };

      container.register(testModule);

      const instance1 = await container.resolve('CachedModule');
      const instance2 = await container.resolve('CachedModule');

      expect(instance1).toBe(instance2);
      expect(callCount).toBe(1);
    });

    it('should resolve module with dependencies', async () => {
      const depModule = {
        metadata: { id: 'Dependency', dependencies: [] },
        factory: () => ({ name: 'dependency' })
      };

      const mainModule = {
        metadata: { id: 'Main', dependencies: ['Dependency'] },
        factory: (deps) => ({
          dep: deps.Dependency,
          name: 'main'
        })
      };

      container.register(depModule);
      container.register(mainModule);

      const instance = await container.resolve('Main');

      expect(instance.name).toBe('main');
      expect(instance.dep.name).toBe('dependency');
    });

    it('should resolve deep dependency chains', async () => {
      const moduleA = {
        metadata: { id: 'A', dependencies: [] },
        factory: () => ({ id: 'A' })
      };

      const moduleB = {
        metadata: { id: 'B', dependencies: ['A'] },
        factory: (deps) => ({ id: 'B', a: deps.A })
      };

      const moduleC = {
        metadata: { id: 'C', dependencies: ['B'] },
        factory: (deps) => ({ id: 'C', b: deps.B })
      };

      container.register(moduleA);
      container.register(moduleB);
      container.register(moduleC);

      const instance = await container.resolve('C');

      expect(instance.id).toBe('C');
      expect(instance.b.id).toBe('B');
      expect(instance.b.a.id).toBe('A');
    });

    it('should throw error for unregistered module', async () => {
      await expect(container.resolve('NonExistent'))
        .rejects.toThrow('Module not found: NonExistent');
    });

    it('should throw error for missing required dependency', async () => {
      const testModule = {
        metadata: { id: 'NeedsDep', dependencies: ['MissingDep'] },
        factory: (deps) => deps
      };

      container.register(testModule);

      await expect(container.resolve('NeedsDep'))
        .rejects.toThrow('Module not found: MissingDep');
    });

    it('should handle optional dependencies gracefully', async () => {
      const testModule = {
        metadata: { id: 'HasOptional', dependencies: ['OptionalDep?'] },
        factory: (deps) => ({ optional: deps.OptionalDep })
      };

      container.register(testModule);

      const instance = await container.resolve('HasOptional');

      expect(instance.optional).toBeUndefined();
      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Optional dep OptionalDep missing')
      );
    });

    it('should resolve optional dependency if available', async () => {
      const optionalModule = {
        metadata: { id: 'OptionalDep', dependencies: [] },
        factory: () => ({ isOptional: true })
      };

      const testModule = {
        metadata: { id: 'HasOptional', dependencies: ['OptionalDep?'] },
        factory: (deps) => ({ optional: deps.OptionalDep })
      };

      container.register(optionalModule);
      container.register(testModule);

      const instance = await container.resolve('HasOptional');

      expect(instance.optional).toEqual({ isOptional: true });
    });
  });

  describe('circular dependency detection', () => {
    it('should detect direct circular dependency (A -> A)', async () => {
      const selfRefModule = {
        metadata: { id: 'SelfRef', dependencies: ['SelfRef'] },
        factory: (deps) => deps
      };

      container.register(selfRefModule);

      await expect(container.resolve('SelfRef'))
        .rejects.toThrow('Circular dependency: SelfRef');
    });

    it('should detect indirect circular dependency (A -> B -> A)', async () => {
      const moduleA = {
        metadata: { id: 'A', dependencies: ['B'] },
        factory: (deps) => deps
      };

      const moduleB = {
        metadata: { id: 'B', dependencies: ['A'] },
        factory: (deps) => deps
      };

      container.register(moduleA);
      container.register(moduleB);

      await expect(container.resolve('A'))
        .rejects.toThrow('Circular dependency');
    });

    it('should detect long circular chain (A -> B -> C -> A)', async () => {
      const moduleA = {
        metadata: { id: 'A', dependencies: ['B'] },
        factory: (deps) => deps
      };

      const moduleB = {
        metadata: { id: 'B', dependencies: ['C'] },
        factory: (deps) => deps
      };

      const moduleC = {
        metadata: { id: 'C', dependencies: ['A'] },
        factory: (deps) => deps
      };

      container.register(moduleA);
      container.register(moduleB);
      container.register(moduleC);

      await expect(container.resolve('A'))
        .rejects.toThrow('Circular dependency');
    });

    it('should allow diamond dependencies (not circular)', async () => {
      // D depends on B and C, which both depend on A
      const moduleA = {
        metadata: { id: 'A', dependencies: [] },
        factory: () => ({ id: 'A' })
      };

      const moduleB = {
        metadata: { id: 'B', dependencies: ['A'] },
        factory: (deps) => ({ id: 'B', a: deps.A })
      };

      const moduleC = {
        metadata: { id: 'C', dependencies: ['A'] },
        factory: (deps) => ({ id: 'C', a: deps.A })
      };

      const moduleD = {
        metadata: { id: 'D', dependencies: ['B', 'C'] },
        factory: (deps) => ({ id: 'D', b: deps.B, c: deps.C })
      };

      container.register(moduleA);
      container.register(moduleB);
      container.register(moduleC);
      container.register(moduleD);

      const instance = await container.resolve('D');

      expect(instance.id).toBe('D');
      expect(instance.b.a).toBe(instance.c.a); // Same A instance
    });
  });

  describe('async initialization', () => {
    it('should call init() on async modules', async () => {
      const initFn = vi.fn().mockResolvedValue(true);
      const asyncModule = {
        metadata: { id: 'AsyncModule', dependencies: [], async: true },
        factory: () => ({
          init: initFn,
          value: 'test'
        })
      };

      container.register(asyncModule);
      await container.resolve('AsyncModule');

      expect(initFn).toHaveBeenCalled();
    });

    it('should not call init() on sync modules', async () => {
      const initFn = vi.fn();
      const syncModule = {
        metadata: { id: 'SyncModule', dependencies: [] },
        factory: () => ({
          init: initFn,
          value: 'test'
        })
      };

      container.register(syncModule);
      await container.resolve('SyncModule');

      expect(initFn).not.toHaveBeenCalled();
    });

    it('should wait for async init to complete before returning', async () => {
      let initCompleted = false;
      const asyncModule = {
        metadata: { id: 'SlowInit', dependencies: [], async: true },
        factory: () => ({
          init: async () => {
            await new Promise(r => setTimeout(r, 50));
            initCompleted = true;
          },
          value: 'test'
        })
      };

      container.register(asyncModule);
      await container.resolve('SlowInit');

      expect(initCompleted).toBe(true);
    });
  });

  describe('logging', () => {
    it('should log when initializing a module', async () => {
      const testModule = {
        metadata: { id: 'LogTest', dependencies: [] },
        factory: () => ({})
      };

      container.register(testModule);
      await container.resolve('LogTest');

      expect(mockUtils.logger.info).toHaveBeenCalledWith('[DI] Initializing LogTest');
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(DIContainerModule.metadata.id).toBe('DIContainer');
      expect(DIContainerModule.metadata.type).toBe('infrastructure');
      expect(DIContainerModule.metadata.dependencies).toContain('Utils');
    });
  });
});
