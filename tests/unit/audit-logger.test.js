/**
 * @fileoverview Unit tests for AuditLogger module
 * Tests security logging, retry logic, VFS integration, sanitization, and EventBus events
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Utils
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  generateId: vi.fn().mockReturnValue('log_test123_abc')
});

// Mock VFS
const createMockVFS = () => ({
  exists: vi.fn(),
  read: vi.fn(),
  write: vi.fn()
});

// Mock EventBus
const createMockEventBus = () => ({
  emit: vi.fn(),
  on: vi.fn()
});

import AuditLoggerModule from '../../infrastructure/audit-logger.js';

describe('AuditLogger', () => {
  let auditLogger;
  let mockUtils;
  let mockVFS;
  let mockEventBus;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockVFS = createMockVFS();
    mockEventBus = createMockEventBus();
    mockVFS.exists.mockResolvedValue(false);
    mockVFS.read.mockResolvedValue('');
    mockVFS.write.mockResolvedValue(true);

    auditLogger = AuditLoggerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS,
      EventBus: mockEventBus
    });
  });

  describe('init', () => {
    it('should return true on initialization', async () => {
      const result = await auditLogger.init();
      expect(result).toBe(true);
    });
  });

  describe('logEvent', () => {
    it('should write event to JSONL file in VFS', async () => {
      await auditLogger.logEvent('TEST_EVENT', { key: 'value' });

      expect(mockVFS.write).toHaveBeenCalled();

      const writeCall = mockVFS.write.mock.calls[0];
      const path = writeCall[0];
      const content = writeCall[1];

      // Path should be /.logs/audit/YYYY-MM-DD.jsonl
      expect(path).toMatch(/^\/.logs\/audit\/\d{4}-\d{2}-\d{2}\.jsonl$/);

      // Content should be valid JSONL
      const entry = JSON.parse(content.trim());
      expect(entry.id).toBe('log_test123_abc');
      expect(entry.type).toBe('TEST_EVENT');
      expect(entry.data).toEqual({ key: 'value' });
      expect(entry.severity).toBe('INFO');
      expect(entry.ts).toBeDefined();
    });

    it('should append to existing log file', async () => {
      const existingContent = '{"id":"old","type":"OLD_EVENT"}\n';
      mockVFS.exists.mockResolvedValue(true);
      mockVFS.read.mockResolvedValue(existingContent);

      await auditLogger.logEvent('NEW_EVENT', { new: true });

      const writeCall = mockVFS.write.mock.calls[0];
      const content = writeCall[1];

      // Should contain old entry + new entry
      expect(content).toContain('OLD_EVENT');
      expect(content).toContain('NEW_EVENT');
    });

    it('should use provided severity level', async () => {
      await auditLogger.logEvent('CRITICAL', {}, 'ERROR');

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.severity).toBe('ERROR');
    });

    it('should log to console for ERROR severity', async () => {
      await auditLogger.logEvent('SECURITY_BREACH', { details: 'test' }, 'ERROR');

      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        '[Audit] SECURITY_BREACH',
        { details: 'test' }
      );
    });

    it('should log to console for WARN severity', async () => {
      await auditLogger.logEvent('WARNING_EVENT', { info: 'test' }, 'WARN');

      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        '[Audit] WARNING_EVENT',
        { info: 'test' }
      );
    });

    it('should not log INFO events to console', async () => {
      await auditLogger.logEvent('INFO_EVENT', {}, 'INFO');

      expect(mockUtils.logger.warn).not.toHaveBeenCalled();
    });

    it('should generate unique ID for each event', async () => {
      let idCounter = 0;
      mockUtils.generateId.mockImplementation(() => `log_${idCounter++}`);

      await auditLogger.logEvent('EVENT_1', {});
      await auditLogger.logEvent('EVENT_2', {});

      const content1 = mockVFS.write.mock.calls[0][1];
      const content2 = mockVFS.write.mock.calls[1][1];

      expect(content1).not.toBe(content2);
    });
  });

  describe('retry logic', () => {
    it('should retry once on write failure', async () => {
      mockVFS.write
        .mockRejectedValueOnce(new Error('First write failed'))
        .mockResolvedValueOnce(true);

      await auditLogger.logEvent('RETRY_EVENT', {});

      expect(mockVFS.write).toHaveBeenCalledTimes(2);
      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('retrying'),
        expect.any(String)
      );
    });

    it('should log error if retry also fails', async () => {
      mockVFS.write
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'));

      await auditLogger.logEvent('LOST_EVENT', { important: true });

      expect(mockVFS.write).toHaveBeenCalledTimes(2);
      expect(mockUtils.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('audit event lost'),
        expect.objectContaining({
          error: 'Second fail',
          entry: expect.objectContaining({
            type: 'LOST_EVENT',
            severity: 'INFO'
          })
        })
      );
    });

    it('should not throw even if write fails completely', async () => {
      mockVFS.write.mockRejectedValue(new Error('Always fails'));

      // Should not throw
      await expect(auditLogger.logEvent('FAILING_EVENT', {}))
        .resolves.toBeUndefined();
    });
  });

  describe('logAgentAction', () => {
    it('should log agent actions with correct format', async () => {
      await auditLogger.logAgentAction('EXECUTE', 'ReadFile', { path: '/test.txt' });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('AGENT_ACTION');
      expect(entry.data).toEqual({
        action: 'EXECUTE',
        tool: 'ReadFile',
        args: { path: '/test.txt' }
      });
    });
  });

  describe('logSecurity', () => {
    it('should log security events with ERROR severity', async () => {
      await auditLogger.logSecurity('UNAUTHORIZED_ACCESS', {
        ip: '192.168.1.1',
        attempted: '/admin'
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('SECURITY');
      expect(entry.severity).toBe('ERROR');
      expect(entry.data.type).toBe('UNAUTHORIZED_ACCESS');
      expect(entry.data.ip).toBe('192.168.1.1');
    });

    it('should echo security events to console', async () => {
      await auditLogger.logSecurity('BREACH_ATTEMPT', { source: 'test' });

      expect(mockUtils.logger.warn).toHaveBeenCalledWith(
        '[Audit] SECURITY',
        expect.objectContaining({ type: 'BREACH_ATTEMPT' })
      );
    });
  });

  describe('date-based log files', () => {
    it('should create new file for new date', async () => {
      const originalDate = Date;

      // First event on day 1
      global.Date = class extends originalDate {
        toISOString() { return '2024-01-15T10:00:00.000Z'; }
      };
      global.Date.now = () => 1705312800000;

      await auditLogger.logEvent('DAY1_EVENT', {});

      // Restore and set day 2
      global.Date = class extends originalDate {
        toISOString() { return '2024-01-16T10:00:00.000Z'; }
      };
      global.Date.now = () => 1705399200000;

      await auditLogger.logEvent('DAY2_EVENT', {});

      global.Date = originalDate;

      // Should have written to different files
      const path1 = mockVFS.write.mock.calls[0][0];
      const path2 = mockVFS.write.mock.calls[1][0];

      expect(path1).toContain('2024-01-15');
      expect(path2).toContain('2024-01-16');
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(AuditLoggerModule.metadata.id).toBe('AuditLogger');
      expect(AuditLoggerModule.metadata.type).toBe('infrastructure');
      expect(AuditLoggerModule.metadata.async).toBe(true);
      expect(AuditLoggerModule.metadata.dependencies).toContain('VFS');
      expect(AuditLoggerModule.metadata.dependencies).toContain('Utils');
      expect(AuditLoggerModule.metadata.dependencies).toContain('EventBus?');
    });
  });

  describe('sanitizeArgs', () => {
    it('should redact sensitive keys like apiKey', () => {
      const result = auditLogger.sanitizeArgs({
        path: '/test.js',
        apiKey: 'sk-secret-key-12345',
        content: 'normal content'
      });

      expect(result.path).toBe('/test.js');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.content).toBe('normal content');
    });

    it('should redact token, password, secret keys', () => {
      const result = auditLogger.sanitizeArgs({
        token: 'bearer-token-xyz',
        password: 'mysecretpassword',
        secret: 'shh-secret',
        accessToken: 'access-123'
      });

      expect(result.token).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.secret).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
    });

    it('should redact values that look like API keys (sk- prefix)', () => {
      const result = auditLogger.sanitizeArgs({
        someField: 'sk-proj-abcdefghijk123456'
      });

      expect(result.someField).toBe('[REDACTED]');
    });

    it('should redact values with bearer prefix', () => {
      const result = auditLogger.sanitizeArgs({
        auth: 'bearer eyJhbGciOiJIUzI1NiJ9...'
      });

      expect(result.auth).toBe('[REDACTED]');
    });

    it('should truncate long string values', () => {
      const longContent = 'x'.repeat(1000);
      const result = auditLogger.sanitizeArgs({
        content: longContent
      });

      expect(result.content.length).toBeLessThan(longContent.length);
      expect(result.content).toContain('[truncated');
    });

    it('should handle nested objects', () => {
      const result = auditLogger.sanitizeArgs({
        config: {
          apiKey: 'secret-key',
          url: 'https://example.com'
        }
      });

      expect(result.config.apiKey).toBe('[REDACTED]');
      expect(result.config.url).toBe('https://example.com');
    });

    it('should handle arrays', () => {
      const result = auditLogger.sanitizeArgs({
        items: [
          { password: 'secret1', name: 'item1' },
          { password: 'secret2', name: 'item2' }
        ]
      });

      expect(result.items[0].password).toBe('[REDACTED]');
      expect(result.items[0].name).toBe('item1');
      expect(result.items[1].password).toBe('[REDACTED]');
    });

    it('should handle null and undefined', () => {
      const result = auditLogger.sanitizeArgs({
        nullVal: null,
        undefinedVal: undefined,
        normalVal: 'test'
      });

      expect(result.nullVal).toBeNull();
      expect(result.undefinedVal).toBeUndefined();
      expect(result.normalVal).toBe('test');
    });
  });

  describe('isSubstratePath', () => {
    it('should return true for /core/ paths', () => {
      expect(auditLogger.isSubstratePath('/core/agent-loop.js')).toBe(true);
      expect(auditLogger.isSubstratePath('/core/tool-runner.js')).toBe(true);
    });

    it('should return true for /infrastructure/ paths', () => {
      expect(auditLogger.isSubstratePath('/infrastructure/event-bus.js')).toBe(true);
      expect(auditLogger.isSubstratePath('/infrastructure/audit-logger.js')).toBe(true);
    });

    it('should return false for other paths', () => {
      expect(auditLogger.isSubstratePath('/tools/ReadFile.js')).toBe(false);
      expect(auditLogger.isSubstratePath('/ui/proto/index.js')).toBe(false);
      expect(auditLogger.isSubstratePath('/config/settings.json')).toBe(false);
    });

    it('should handle null/undefined paths', () => {
      expect(auditLogger.isSubstratePath(null)).toBe(false);
      expect(auditLogger.isSubstratePath(undefined)).toBe(false);
      expect(auditLogger.isSubstratePath('')).toBe(false);
    });
  });

  describe('logToolExec', () => {
    it('should log successful tool execution with sanitized args', async () => {
      await auditLogger.logToolExec({
        tool: 'ReadFile',
        args: { path: '/test.txt', apiKey: 'secret-key' },
        durationMs: 50,
        success: true
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('TOOL_EXEC');
      expect(entry.severity).toBe('INFO');
      expect(entry.data.tool).toBe('ReadFile');
      expect(entry.data.args.path).toBe('/test.txt');
      expect(entry.data.args.apiKey).toBe('[REDACTED]');
      expect(entry.data.durationMs).toBe(50);
      expect(entry.data.success).toBe(true);
    });

    it('should log failed tool execution with ERROR severity', async () => {
      await auditLogger.logToolExec({
        tool: 'WriteFile',
        args: { path: '/test.txt' },
        durationMs: 100,
        success: false,
        error: 'Permission denied'
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('TOOL_EXEC');
      expect(entry.severity).toBe('ERROR');
      expect(entry.data.success).toBe(false);
      expect(entry.data.error).toBe('Permission denied');
    });

    it('should include workerId when provided', async () => {
      await auditLogger.logToolExec({
        tool: 'ReadFile',
        args: { path: '/test.txt' },
        durationMs: 25,
        success: true,
        workerId: 'worker_123'
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.data.workerId).toBe('worker_123');
    });

    it('should emit audit:tool_exec event', async () => {
      await auditLogger.logToolExec({
        tool: 'ReadFile',
        args: { path: '/test.txt' },
        durationMs: 50,
        success: true
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:tool_exec',
        expect.objectContaining({
          tool: 'ReadFile',
          success: true,
          severity: 'INFO'
        })
      );
    });
  });

  describe('logCoreWrite', () => {
    it('should log core write with WARN severity', async () => {
      await auditLogger.logCoreWrite({
        path: '/core/agent-loop.js',
        operation: 'WriteFile',
        existed: true,
        bytesWritten: 1500
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('CORE_WRITE');
      expect(entry.severity).toBe('WARN');
      expect(entry.data.path).toBe('/core/agent-loop.js');
      expect(entry.data.operation).toBe('WriteFile');
      expect(entry.data.isSubstrate).toBe(true);
      expect(entry.data.bytesWritten).toBe(1500);
    });

    it('should emit audit:core_write event', async () => {
      await auditLogger.logCoreWrite({
        path: '/infrastructure/event-bus.js',
        operation: 'Edit',
        existed: true
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:core_write',
        expect.objectContaining({
          path: '/infrastructure/event-bus.js',
          operation: 'Edit',
          isSubstrate: true
        })
      );
    });

    it('should emit audit:warning event for core writes', async () => {
      await auditLogger.logCoreWrite({
        path: '/core/tool-runner.js',
        operation: 'Edit',
        existed: true
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:warning',
        expect.objectContaining({
          type: 'CORE_WRITE',
          severity: 'WARN'
        })
      );
    });

    it('should include arenaVerified when provided', async () => {
      await auditLogger.logCoreWrite({
        path: '/core/agent-loop.js',
        operation: 'WriteFile',
        existed: false,
        bytesWritten: 2000,
        arenaVerified: true
      });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.data.arenaVerified).toBe(true);
    });
  });

  describe('EventBus integration', () => {
    it('should emit audit:tool_exec for TOOL_EXEC events', async () => {
      await auditLogger.logEvent('TOOL_EXEC', { tool: 'TestTool', success: true });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:tool_exec',
        expect.objectContaining({ tool: 'TestTool', success: true })
      );
    });

    it('should emit audit:core_write for CORE_WRITE events', async () => {
      await auditLogger.logEvent('CORE_WRITE', { path: '/core/test.js' }, 'WARN');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:core_write',
        expect.objectContaining({ path: '/core/test.js' })
      );
    });

    it('should emit audit:warning for WARN severity', async () => {
      await auditLogger.logEvent('CUSTOM_WARNING', { reason: 'test' }, 'WARN');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:warning',
        expect.objectContaining({
          type: 'CUSTOM_WARNING',
          severity: 'WARN'
        })
      );
    });

    it('should emit audit:warning for ERROR severity', async () => {
      await auditLogger.logEvent('CRITICAL_ERROR', { details: 'crash' }, 'ERROR');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'audit:warning',
        expect.objectContaining({
          type: 'CRITICAL_ERROR',
          severity: 'ERROR'
        })
      );
    });

    it('should not emit warning events for INFO severity', async () => {
      await auditLogger.logEvent('INFO_EVENT', { data: 'test' }, 'INFO');

      // Should not emit audit:warning
      const warningCalls = mockEventBus.emit.mock.calls.filter(
        call => call[0] === 'audit:warning'
      );
      expect(warningCalls.length).toBe(0);
    });

    it('should work without EventBus (graceful degradation)', async () => {
      const loggerNoEventBus = AuditLoggerModule.factory({
        Utils: mockUtils,
        VFS: mockVFS
        // No EventBus
      });

      // Should not throw
      await expect(
        loggerNoEventBus.logEvent('TEST', { data: 'test' }, 'WARN')
      ).resolves.toBeUndefined();
    });
  });
});
