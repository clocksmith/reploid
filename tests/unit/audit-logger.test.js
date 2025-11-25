/**
 * @fileoverview Unit tests for AuditLogger module
 * Tests security logging, retry logic, and VFS integration
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

import AuditLoggerModule from '../../infrastructure/audit-logger.js';

describe('AuditLogger', () => {
  let auditLogger;
  let mockUtils;
  let mockVFS;

  beforeEach(() => {
    mockUtils = createMockUtils();
    mockVFS = createMockVFS();
    mockVFS.exists.mockResolvedValue(false);
    mockVFS.read.mockResolvedValue('');
    mockVFS.write.mockResolvedValue(true);

    auditLogger = AuditLoggerModule.factory({
      Utils: mockUtils,
      VFS: mockVFS
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
      await auditLogger.logAgentAction('EXECUTE', 'read_file', { path: '/test.txt' });

      const content = mockVFS.write.mock.calls[0][1];
      const entry = JSON.parse(content.trim());

      expect(entry.type).toBe('AGENT_ACTION');
      expect(entry.data).toEqual({
        action: 'EXECUTE',
        tool: 'read_file',
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
    });
  });
});
