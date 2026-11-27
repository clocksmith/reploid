/**
 * @fileoverview Unit tests for the VerificationManager module.
 * The worker's pattern, capability and complexity rules are tested against the real worker in
 * verification-worker-prototype.test.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

const createMockVFS = () => ({
  read: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn()
});

const createMockEventBus = () => ({
  on: vi.fn(),
  emit: vi.fn(),
  unsubscribeModule: vi.fn()
});

describe('VerificationManager', () => {
  let mockUtils;
  let mockVFS;
  let mockEventBus;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockVFS = createMockVFS();
    mockEventBus = createMockEventBus();
  });

  describe('metadata', () => {
    it('should have correct module metadata', async () => {
      const { default: VerificationManager } = await import('../../core/verification-manager.js');
      expect(VerificationManager.metadata.id).toBe('VerificationManager');
      expect(VerificationManager.metadata.version).toBe('3.0.0');
      expect(VerificationManager.metadata.type).toBe('service');
      expect(VerificationManager.metadata.dependencies).toContain('Utils');
      expect(VerificationManager.metadata.dependencies).toContain('VFS');
    });
  });

  describe('getCapabilitiesForPath', () => {
    it('should return correct capabilities for different paths', async () => {
      const { default: VerificationManager } = await import('../../core/verification-manager.js');
      const manager = VerificationManager.factory({
        Utils: mockUtils,
        VFS: mockVFS,
        EventBus: mockEventBus
      });

      // Tools path
      const toolsCaps = manager.getCapabilitiesForPath('/tools/MyTool.js');
      expect(toolsCaps.canNetwork).toBe(false);
      expect(toolsCaps.canEval).toBe(false);
      expect(toolsCaps.canWrite).toContain('/tools/');

      // Core path
      const coreCaps = manager.getCapabilitiesForPath('/core/agent-loop.js');
      expect(coreCaps.canNetwork).toBe(true);
      expect(coreCaps.canEval).toBe(true);
      expect(coreCaps.canWrite).toContain('*');
    });
  });
});
