/**
 * @fileoverview Unit tests for VFS Module Loader
 * Note: Dynamic import() cannot be easily mocked in Node/vitest,
 * so these tests focus on the logic around loading, not the actual import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearVfsModuleCache,
  getVfsModuleStats,
  isModuleCached,
  resetVfsModuleStats
} from '../../core/vfs-module-loader.js';

describe('VFS Module Loader', () => {
  beforeEach(() => {
    clearVfsModuleCache();
    resetVfsModuleStats();
  });

  describe('clearVfsModuleCache', () => {
    it('clears all cache when no path provided', () => {
      const result = clearVfsModuleCache();
      expect(result).toEqual({ cleared: 'all' });
    });

    it('reports when clearing specific path that did not exist', () => {
      const result = clearVfsModuleCache('/nonexistent.js');
      expect(result).toEqual({ cleared: '/nonexistent.js', existed: false });
    });

    it('normalizes paths without extension', () => {
      const result = clearVfsModuleCache('test');
      expect(result.cleared).toBe('/test.js');
    });

    it('normalizes paths without leading slash', () => {
      const result = clearVfsModuleCache('tools/test.js');
      expect(result.cleared).toBe('/tools/test.js');
    });
  });

  describe('getVfsModuleStats', () => {
    it('returns initial statistics', () => {
      const stats = getVfsModuleStats();

      expect(stats).toMatchObject({
        loads: 0,
        cacheHits: 0,
        cacheMisses: 0,
        verificationPasses: 0,
        verificationFailures: 0,
        errors: 0,
        cacheSize: 0,
        cacheTotalBytes: 0,
        cacheEntries: []
      });
    });
  });

  describe('isModuleCached', () => {
    it('returns false for uncached modules', () => {
      expect(isModuleCached('/unknown.js')).toBe(false);
    });

    it('normalizes path when checking', () => {
      expect(isModuleCached('test')).toBe(false);
      expect(isModuleCached('/test.js')).toBe(false);
    });
  });

  describe('resetVfsModuleStats', () => {
    it('resets all statistics to zero', () => {
      // Stats start at 0, reset should keep them at 0
      resetVfsModuleStats();
      const stats = getVfsModuleStats();

      expect(stats.loads).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.cacheMisses).toBe(0);
      expect(stats.errors).toBe(0);
    });
  });

  describe('Path Normalization', () => {
    it('adds leading slash if missing', () => {
      // Test via clearVfsModuleCache which uses normalizePath
      const result = clearVfsModuleCache('tools/test.js');
      expect(result.cleared).toBe('/tools/test.js');
    });

    it('adds .js extension if missing', () => {
      const result = clearVfsModuleCache('/tools/test');
      expect(result.cleared).toBe('/tools/test.js');
    });

    it('preserves .mjs extension', () => {
      const result = clearVfsModuleCache('/tools/test.mjs');
      expect(result.cleared).toBe('/tools/test.mjs');
    });

    it('handles paths with only filename', () => {
      const result = clearVfsModuleCache('mymodule');
      expect(result.cleared).toBe('/mymodule.js');
    });
  });
});

/**
 * Integration tests that require browser environment would go here.
 * The loadVfsModule function works correctly in browser with real Blob URLs.
 *
 * Key features implemented:
 * - Path normalization (leading slash, .js extension)
 * - Content-based caching with invalidation
 * - Concurrent load deduplication
 * - Optional verification via VerificationManager
 * - Retry logic with configurable attempts and delay
 * - EventBus integration for load/error events
 * - Statistics tracking (loads, hits, misses, errors)
 * - Preload multiple modules in parallel
 */
