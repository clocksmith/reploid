/**
 * @fileoverview Unit tests for core Utils module
 * Tests error classes, logger, helpers, and protocol parsers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import UtilsModule from '../../core/utils.js';

describe('Utils Core Module', () => {
  let utils;

  beforeEach(() => {
    utils = UtilsModule.factory();
  });

  describe('Error Classes', () => {
    it('should create ApplicationError with message and details', () => {
      const { ApplicationError } = utils.Errors;
      const error = new ApplicationError('Test error', { code: 'TEST' });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(error.details).toEqual({ code: 'TEST' });
      expect(error.name).toBe('ApplicationError');
      expect(error.timestamp).toBeDefined();
    });

    it('should create ApiError with status code', () => {
      const { ApiError, ApplicationError } = utils.Errors;
      const error = new ApiError('API failed', 500, { endpoint: '/test' });

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('ApiError');
      expect(error.status).toBe(500);
      expect(error.details).toEqual({ endpoint: '/test' });
    });

    it('should create StateError', () => {
      const { StateError, ApplicationError } = utils.Errors;
      const error = new StateError('Invalid state');

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('StateError');
    });

    it('should create ArtifactError', () => {
      const { ArtifactError, ApplicationError } = utils.Errors;
      const error = new ArtifactError('File not found');

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('ArtifactError');
    });

    it('should create ValidationError', () => {
      const { ValidationError, ApplicationError } = utils.Errors;
      const error = new ValidationError('Invalid input');

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('ValidationError');
    });

    it('should create AbortError', () => {
      const { AbortError, ApplicationError } = utils.Errors;
      const error = new AbortError('Operation cancelled');

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('AbortError');
    });

    it('should create ToolError', () => {
      const { ToolError, ApplicationError } = utils.Errors;
      const error = new ToolError('Tool failed', { tool: 'read_file' });

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('ToolError');
    });

    it('should create ConfigError', () => {
      const { ConfigError, ApplicationError } = utils.Errors;
      const error = new ConfigError('Missing config');

      expect(error).toBeInstanceOf(ApplicationError);
      expect(error.name).toBe('ConfigError');
    });
  });

  describe('Logger', () => {
    let consoleSpy;

    beforeEach(() => {
      consoleSpy = {
        debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
        info: vi.spyOn(console, 'info').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        log: vi.spyOn(console, 'log').mockImplementation(() => {})
      };
    });

    afterEach(() => {
      Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    });

    it('should log debug messages', () => {
      utils.logger.debug('Debug message', { data: 'test' });

      expect(consoleSpy.debug).toHaveBeenCalled();
      const args = consoleSpy.debug.mock.calls[0];
      expect(args[0]).toContain('[DEBUG]');
      expect(args[1]).toBe('Debug message');
    });

    it('should log info messages', () => {
      utils.logger.info('Info message');

      expect(consoleSpy.info).toHaveBeenCalled();
      const args = consoleSpy.info.mock.calls[0];
      expect(args[0]).toContain('[INFO]');
      expect(args[1]).toBe('Info message');
    });

    it('should log warning messages', () => {
      utils.logger.warn('Warning message');

      expect(consoleSpy.warn).toHaveBeenCalled();
      const args = consoleSpy.warn.mock.calls[0];
      expect(args[0]).toContain('[WARN]');
    });

    it('should log error messages', () => {
      utils.logger.error('Error message', { error: 'details' });

      expect(consoleSpy.error).toHaveBeenCalled();
      const args = consoleSpy.error.mock.calls[0];
      expect(args[0]).toContain('[ERROR]');
    });

    it('should track log statistics', () => {
      utils.logger.debug('d');
      utils.logger.info('i');
      utils.logger.warn('w');
      utils.logger.error('e');

      const stats = utils.logger.getStats();

      expect(stats.debug).toBe(1);
      expect(stats.info).toBe(1);
      expect(stats.warn).toBe(1);
      expect(stats.error).toBe(1);
    });

    it('should maintain log history', () => {
      utils.logger.info('Test message');

      const history = utils.logger.getHistory();

      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1].msg).toBe('Test message');
      expect(history[history.length - 1].level).toBe('INFO');
    });

    it('should limit history to MAX_LOG_HISTORY entries', () => {
      // Log more than 100 messages
      for (let i = 0; i < 150; i++) {
        utils.logger.info(`Message ${i}`);
      }

      const history = utils.logger.getHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should clear history', () => {
      utils.logger.info('Test');
      utils.logger.clearHistory();

      expect(utils.logger.getHistory().length).toBe(0);
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = utils.generateId();
      const id2 = utils.generateId();

      expect(id1).not.toBe(id2);
    });

    it('should include prefix in ID', () => {
      const id = utils.generateId('test');

      expect(id).toMatch(/^test_/);
    });

    it('should use default prefix if not provided', () => {
      const id = utils.generateId();

      expect(id).toMatch(/^id_/);
    });

    it('should include timestamp component', () => {
      const id = utils.generateId('prefix');
      const parts = id.split('_');

      expect(parts.length).toBe(3);
    });
  });

  describe('trunc', () => {
    it('should truncate strings longer than limit', () => {
      expect(utils.trunc('Hello World', 8)).toBe('Hello...');
    });

    it('should not truncate strings shorter than limit', () => {
      expect(utils.trunc('Hello', 10)).toBe('Hello');
    });

    it('should not truncate strings exactly at limit', () => {
      expect(utils.trunc('Hello', 5)).toBe('Hello');
    });

    it('should handle empty strings', () => {
      expect(utils.trunc('', 10)).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(utils.trunc(null, 10)).toBe('');
      expect(utils.trunc(undefined, 10)).toBe('');
    });
  });

  describe('kabobToCamel', () => {
    it('should convert kebab-case to camelCase', () => {
      expect(utils.kabobToCamel('hello-world')).toBe('helloWorld');
      expect(utils.kabobToCamel('my-long-variable-name')).toBe('myLongVariableName');
    });

    it('should handle single words', () => {
      expect(utils.kabobToCamel('hello')).toBe('hello');
    });

    it('should handle numbers in kebab-case', () => {
      expect(utils.kabobToCamel('item-1-value')).toBe('item1Value');
    });

    it('should handle empty string', () => {
      expect(utils.kabobToCamel('')).toBe('');
    });
  });

  describe('escapeHtml', () => {
    it('should escape < and >', () => {
      expect(utils.escapeHtml('<div>Test</div>')).toBe('&lt;div&gt;Test&lt;/div&gt;');
    });

    it('should escape &', () => {
      expect(utils.escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('should escape quotes', () => {
      expect(utils.escapeHtml('"double" \'single\'')).toBe('&quot;double&quot; &#039;single&#039;');
    });

    it('should handle empty string', () => {
      expect(utils.escapeHtml('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(utils.escapeHtml(null)).toBe('');
      expect(utils.escapeHtml(undefined)).toBe('');
    });

    it('should not modify safe strings', () => {
      expect(utils.escapeHtml('Hello World 123')).toBe('Hello World 123');
    });
  });

  describe('sanitizeLlmJsonRespPure', () => {
    it('should return direct parse for valid JSON', () => {
      const result = utils.sanitizeLlmJsonRespPure('{"key": "value"}');

      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('direct');
    });

    it('should extract JSON from markdown code block', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = utils.sanitizeLlmJsonRespPure(input);

      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('block');
    });

    it('should extract JSON from plain code block', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = utils.sanitizeLlmJsonRespPure(input);

      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('block');
    });

    it('should use heuristic for JSON embedded in text', () => {
      const input = 'Here is the response: {"key": "value"} Done.';
      const result = utils.sanitizeLlmJsonRespPure(input);

      expect(result.json).toBe('{"key": "value"}');
      expect(result.method).toBe('heuristic');
    });

    it('should return empty object for invalid input', () => {
      const result = utils.sanitizeLlmJsonRespPure('not json at all');

      expect(result.json).toBe('{}');
      expect(result.method).toBe('failed');
    });

    it('should handle null/undefined input', () => {
      expect(utils.sanitizeLlmJsonRespPure(null).json).toBe('{}');
      expect(utils.sanitizeLlmJsonRespPure(undefined).json).toBe('{}');
    });

    it('should handle empty string', () => {
      expect(utils.sanitizeLlmJsonRespPure('').json).toBe('{}');
    });
  });

  describe('createSubscriptionTracker', () => {
    it('should create tracker with track and unsubscribeAll methods', () => {
      const tracker = utils.createSubscriptionTracker();

      expect(typeof tracker.track).toBe('function');
      expect(typeof tracker.unsubscribeAll).toBe('function');
    });

    it('should track and call unsubscribe functions', () => {
      const tracker = utils.createSubscriptionTracker();
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();

      tracker.track('module1', unsub1);
      tracker.track('module1', unsub2);
      tracker.unsubscribeAll('module1');

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
    });

    it('should not affect other modules when unsubscribing', () => {
      const tracker = utils.createSubscriptionTracker();
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();

      tracker.track('module1', unsub1);
      tracker.track('module2', unsub2);
      tracker.unsubscribeAll('module1');

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).not.toHaveBeenCalled();
    });

    it('should handle unsubscribing non-existent module gracefully', () => {
      const tracker = utils.createSubscriptionTracker();

      expect(() => tracker.unsubscribeAll('nonexistent')).not.toThrow();
    });
  });

  describe('PAWS Protocol Parsers', () => {
    describe('parseCatsBundle', () => {
      it('should parse valid CATS bundle', () => {
        const content = `## PAWS Context Bundle
**Reason:** Test bundle

\`\`\`vfs-file
path: /test.txt
\`\`\`
\`\`\`
file content here
\`\`\``;

        const result = utils.parseCatsBundle(content);

        expect(result.reason).toBe('Test bundle');
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe('/test.txt');
        expect(result.files[0].content).toBe('file content here');
      });

      it('should parse multiple files', () => {
        const content = `**Reason:** Multi-file bundle

\`\`\`vfs-file
path: /file1.txt
\`\`\`
\`\`\`
content 1
\`\`\`

\`\`\`vfs-file
path: /file2.txt
\`\`\`
\`\`\`
content 2
\`\`\``;

        const result = utils.parseCatsBundle(content);

        expect(result.files).toHaveLength(2);
      });

      it('should return empty files array for invalid content', () => {
        const result = utils.parseCatsBundle('');

        expect(result.files).toEqual([]);
      });

      it('should return empty files for null content', () => {
        const result = utils.parseCatsBundle(null);

        expect(result.files).toEqual([]);
      });
    });

    describe('generateCatsBundle', () => {
      it('should generate valid CATS bundle format', () => {
        const files = [
          { path: '/test.txt', content: 'Hello World' }
        ];

        const bundle = utils.generateCatsBundle(files, 'Test export');

        expect(bundle).toContain('PAWS Context Bundle');
        expect(bundle).toContain('**Reason:** Test export');
        expect(bundle).toContain('**Files:** 1');
        expect(bundle).toContain('path: /test.txt');
        expect(bundle).toContain('Hello World');
      });

      it('should include generation timestamp', () => {
        const bundle = utils.generateCatsBundle([], 'Test');

        expect(bundle).toContain('**Generated:**');
      });
    });

    describe('parseDogsBundle', () => {
      it('should parse CREATE operation', () => {
        const content = `## PAWS Change Proposal

\`\`\`paws-change
operation: CREATE
file_path: /new-file.txt
\`\`\`
\`\`\`
new file content
\`\`\``;

        const changes = utils.parseDogsBundle(content);

        expect(changes).toHaveLength(1);
        expect(changes[0].operation).toBe('CREATE');
        expect(changes[0].file_path).toBe('/new-file.txt');
        expect(changes[0].new_content).toBe('new file content');
      });

      it('should parse MODIFY operation', () => {
        const content = `\`\`\`paws-change
operation: MODIFY
file_path: /existing.txt
\`\`\`
\`\`\`
modified content
\`\`\``;

        const changes = utils.parseDogsBundle(content);

        expect(changes[0].operation).toBe('MODIFY');
      });

      it('should parse DELETE operation without content', () => {
        const content = `\`\`\`paws-change
operation: DELETE
file_path: /to-delete.txt
\`\`\``;

        const changes = utils.parseDogsBundle(content);

        expect(changes[0].operation).toBe('DELETE');
        expect(changes[0].new_content).toBeNull();
      });

      it('should return empty array for invalid content', () => {
        expect(utils.parseDogsBundle('')).toEqual([]);
        expect(utils.parseDogsBundle(null)).toEqual([]);
      });
    });

    describe('generateDogsBundle', () => {
      it('should generate valid DOGS bundle format', () => {
        const changes = [
          { operation: 'CREATE', file_path: '/new.txt', new_content: 'content' }
        ];

        const bundle = utils.generateDogsBundle(changes, 'Test modification');

        expect(bundle).toContain('PAWS Change Proposal');
        expect(bundle).toContain('**Summary:** Test modification');
        expect(bundle).toContain('**Changes:** 1');
        expect(bundle).toContain('operation: CREATE');
        expect(bundle).toContain('file_path: /new.txt');
      });

      it('should not include content block for DELETE operations', () => {
        const changes = [
          { operation: 'DELETE', file_path: '/to-delete.txt' }
        ];

        const bundle = utils.generateDogsBundle(changes);

        expect(bundle).toContain('operation: DELETE');
        // For DELETE, there should be only the paws-change block, no content block
        // The bundle format is: ```paws-change\n...\n``` followed by optional ```\ncontent\n```
        // For DELETE, only the paws-change block should exist
        const afterDeleteBlock = bundle.split('```paws-change')[1].split('```')[1];
        // After the paws-change block closes, there should NOT be another content block starting
        expect(afterDeleteBlock.trim().startsWith('```')).toBe(false);
      });
    });
  });

  describe('Module Metadata', () => {
    it('should have correct metadata', () => {
      expect(UtilsModule.metadata.id).toBe('Utils');
      expect(UtilsModule.metadata.type).toBe('pure');
      expect(UtilsModule.metadata.dependencies).toEqual([]);
    });
  });
});
