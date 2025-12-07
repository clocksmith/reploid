/**
 * @fileoverview Unit tests for Utils module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';

// Initialize Utils module
const utils = UtilsModule.factory();

describe('Utils - Error Classes', () => {
  it('should create ApplicationError with message and details', () => {
    const { ApplicationError } = utils.Errors;
    const error = new ApplicationError('Test error', { code: 'TEST' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test error');
    expect(error.details).toEqual({ code: 'TEST' });
    expect(error.name).toBe('ApplicationError');
  });

  it('should create ApiError extending ApplicationError', () => {
    const { ApiError, ApplicationError } = utils.Errors;
    const error = new ApiError('API failed', { status: 500 });
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe('ApiError');
  });

  it('should create ToolError extending ApplicationError', () => {
    const { ToolError, ApplicationError } = utils.Errors;
    const error = new ToolError('Tool failed', { tool: 'read' });
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe('ToolError');
  });

  it('should create StateError extending ApplicationError', () => {
    const { StateError, ApplicationError } = utils.Errors;
    const error = new StateError('Invalid state');
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe('StateError');
  });
});

describe('Utils - Logger', () => {
  let consoleDebugSpy, consoleInfoSpy, consoleWarnSpy, consoleErrorSpy;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // Logger uses format: console.debug('[DEBUG]', message, details)
  // So first arg is prefix, second is message

  it('should log debug messages', () => {
    utils.logger.debug('Debug message', { test: true });
    expect(consoleDebugSpy).toHaveBeenCalled();
    expect(consoleDebugSpy.mock.calls[0][0]).toBe('[DEBUG]');
    expect(consoleDebugSpy.mock.calls[0][1]).toBe('Debug message');
  });

  it('should log info messages', () => {
    utils.logger.info('Info message');
    expect(consoleInfoSpy).toHaveBeenCalled();
    expect(consoleInfoSpy.mock.calls[0][0]).toBe('[INFO]');
    expect(consoleInfoSpy.mock.calls[0][1]).toBe('Info message');
  });

  it('should log warning messages', () => {
    utils.logger.warn('Warning message');
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toBe('[WARN]');
    expect(consoleWarnSpy.mock.calls[0][1]).toBe('Warning message');
  });

  it('should log error messages', () => {
    utils.logger.error('Error message', { error: 'test' });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toBe('[ERROR]');
    expect(consoleErrorSpy.mock.calls[0][1]).toBe('Error message');
  });

  it('should track log history', () => {
    utils.logger.info('Test message');
    const history = utils.logger.getHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].msg).toBe('Test message');
  });
});

describe('Utils - String Utilities', () => {
  describe('kabobToCamel', () => {
    it('should convert kebab-case to camelCase', () => {
      expect(utils.kabobToCamel('hello-world')).toBe('helloWorld');
      expect(utils.kabobToCamel('test-case-name')).toBe('testCaseName');
    });

    it('should handle single words', () => {
      expect(utils.kabobToCamel('hello')).toBe('hello');
    });

    it('should handle empty strings', () => {
      expect(utils.kabobToCamel('')).toBe('');
    });
  });

  describe('trunc', () => {
    it('should truncate strings longer than specified length', () => {
      expect(utils.trunc('hello world', 8)).toBe('hello...');
    });

    it('should not truncate strings shorter than length', () => {
      expect(utils.trunc('hello', 10)).toBe('hello');
    });

    it('should handle exact length', () => {
      expect(utils.trunc('hello', 5)).toBe('hello');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(utils.escapeHtml('<div>Test</div>')).toBe('&lt;div&gt;Test&lt;/div&gt;');
      expect(utils.escapeHtml('A&B')).toBe('A&amp;B');
      expect(utils.escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
      expect(utils.escapeHtml("'single'")).toBe('&#039;single&#039;');
    });

    it('should handle empty strings', () => {
      expect(utils.escapeHtml('')).toBe('');
    });

    it('should handle strings without special chars', () => {
      expect(utils.escapeHtml('hello world')).toBe('hello world');
    });
  });

  describe('sanitizeLlmJsonRespPure', () => {
    it('should extract JSON from markdown code blocks', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = utils.sanitizeLlmJsonRespPure(input);
      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('block');
    });

    it('should handle JSON without code blocks (direct parse)', () => {
      const input = '{"key": "value"}';
      const result = utils.sanitizeLlmJsonRespPure(input);
      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('direct');
    });

    it('should extract JSON from text with prefix/suffix (heuristic)', () => {
      const input = 'Here is the response:\n{"key": "value"}\nEnd of response';
      const result = utils.sanitizeLlmJsonRespPure(input);
      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('heuristic');
    });

    it('should return empty JSON for invalid input', () => {
      const result = utils.sanitizeLlmJsonRespPure('not valid json at all');
      expect(result.json).toBe('{}');
      expect(result.method).toBe('failed');
    });
  });
});

describe('Utils - DRY Helpers', () => {
  describe('createSubscriptionTracker', () => {
    it('should create tracker with track and unsubscribeAll methods', () => {
      const tracker = utils.createSubscriptionTracker();
      expect(tracker).toHaveProperty('track');
      expect(tracker).toHaveProperty('unsubscribeAll');
    });

    it('should unsubscribe all tracked functions for a module', () => {
      const tracker = utils.createSubscriptionTracker();
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();

      tracker.track('TestModule', unsub1);
      tracker.track('TestModule', unsub2);
      tracker.unsubscribeAll('TestModule');

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
    });

    it('should handle multiple modules independently', () => {
      const tracker = utils.createSubscriptionTracker();
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();

      tracker.track('Module1', unsub1);
      tracker.track('Module2', unsub2);

      tracker.unsubscribeAll('Module1');
      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).not.toHaveBeenCalled();
    });

    it('should handle unsubscribe for non-existent module gracefully', () => {
      const tracker = utils.createSubscriptionTracker();
      // Should not throw
      expect(() => tracker.unsubscribeAll('NonExistent')).not.toThrow();
    });
  });

  // NOTE: showButtonSuccess, exportAsMarkdown, and HTTP utilities (post/get)
  // were removed from the Utils module - these tests are no longer applicable
});
