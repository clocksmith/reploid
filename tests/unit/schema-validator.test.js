/**
 * @fileoverview Unit tests for SchemaValidator module
 * Tests Zod-like schema validation for tool outputs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import SchemaValidatorModule, { z } from '../../core/schema-validator.js';

// Mock dependencies
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

describe('SchemaValidator', () => {
  let schemaValidator;
  let mockUtils;

  beforeEach(() => {
    mockUtils = createMockUtils();
    schemaValidator = SchemaValidatorModule.factory({
      Utils: mockUtils
    });
  });

  describe('z schema builders', () => {
    describe('z.string()', () => {
      it('should validate strings', () => {
        const schema = z.string();
        expect(schema.safeParse('hello').success).toBe(true);
        expect(schema.safeParse('hello').data).toBe('hello');
      });

      it('should reject non-strings', () => {
        const schema = z.string();
        expect(schema.safeParse(123).success).toBe(false);
        expect(schema.safeParse(null).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
      });

      it('should handle optional strings', () => {
        const schema = z.string().optional();
        expect(schema.safeParse(undefined).success).toBe(true);
        expect(schema.safeParse('test').success).toBe(true);
      });

      it('should handle nullable strings', () => {
        const schema = z.string().nullable();
        expect(schema.safeParse(null).success).toBe(true);
        expect(schema.safeParse('test').success).toBe(true);
      });

      it('should validate min length', () => {
        const schema = z.string().min(3);
        expect(schema.safeParse('ab').success).toBe(false);
        expect(schema.safeParse('abc').success).toBe(true);
        expect(schema.safeParse('abcd').success).toBe(true);
      });

      it('should validate max length', () => {
        const schema = z.string().max(3);
        expect(schema.safeParse('ab').success).toBe(true);
        expect(schema.safeParse('abc').success).toBe(true);
        expect(schema.safeParse('abcd').success).toBe(false);
      });

      it('should handle default values', () => {
        const schema = z.string().default('default');
        expect(schema.safeParse(undefined).data).toBe('default');
        expect(schema.safeParse('custom').data).toBe('custom');
      });

      it('should throw on parse failure', () => {
        const schema = z.string();
        expect(() => schema.parse(123)).toThrow();
      });
    });

    describe('z.number()', () => {
      it('should validate numbers', () => {
        const schema = z.number();
        expect(schema.safeParse(42).success).toBe(true);
        expect(schema.safeParse(3.14).success).toBe(true);
      });

      it('should reject non-numbers', () => {
        const schema = z.number();
        expect(schema.safeParse('42').success).toBe(false);
        expect(schema.safeParse(NaN).success).toBe(false);
      });

      it('should validate min value', () => {
        const schema = z.number().min(0);
        expect(schema.safeParse(-1).success).toBe(false);
        expect(schema.safeParse(0).success).toBe(true);
        expect(schema.safeParse(1).success).toBe(true);
      });

      it('should validate max value', () => {
        const schema = z.number().max(100);
        expect(schema.safeParse(99).success).toBe(true);
        expect(schema.safeParse(100).success).toBe(true);
        expect(schema.safeParse(101).success).toBe(false);
      });

      it('should validate integers', () => {
        const schema = z.number().int();
        expect(schema.safeParse(42).success).toBe(true);
        expect(schema.safeParse(3.14).success).toBe(false);
      });

      it('should handle optional numbers', () => {
        const schema = z.number().optional();
        expect(schema.safeParse(undefined).success).toBe(true);
      });
    });

    describe('z.boolean()', () => {
      it('should validate booleans', () => {
        const schema = z.boolean();
        expect(schema.safeParse(true).success).toBe(true);
        expect(schema.safeParse(false).success).toBe(true);
      });

      it('should reject non-booleans', () => {
        const schema = z.boolean();
        expect(schema.safeParse(1).success).toBe(false);
        expect(schema.safeParse('true').success).toBe(false);
      });

      it('should handle default values', () => {
        const schema = z.boolean().default(true);
        expect(schema.safeParse(undefined).data).toBe(true);
      });
    });

    describe('z.array()', () => {
      it('should validate arrays', () => {
        const schema = z.array(z.string());
        expect(schema.safeParse(['a', 'b']).success).toBe(true);
        expect(schema.safeParse([]).success).toBe(true);
      });

      it('should reject non-arrays', () => {
        const schema = z.array(z.string());
        expect(schema.safeParse('not array').success).toBe(false);
        expect(schema.safeParse({ 0: 'a' }).success).toBe(false);
      });

      it('should validate array items', () => {
        const schema = z.array(z.number());
        expect(schema.safeParse([1, 2, 3]).success).toBe(true);
        expect(schema.safeParse([1, 'two', 3]).success).toBe(false);
      });

      it('should validate min length', () => {
        const schema = z.array(z.string()).min(2);
        expect(schema.safeParse(['a']).success).toBe(false);
        expect(schema.safeParse(['a', 'b']).success).toBe(true);
      });

      it('should validate max length', () => {
        const schema = z.array(z.string()).max(2);
        expect(schema.safeParse(['a', 'b']).success).toBe(true);
        expect(schema.safeParse(['a', 'b', 'c']).success).toBe(false);
      });

      it('should include path in error for invalid items', () => {
        const schema = z.array(z.number());
        const result = schema.safeParse([1, 'invalid', 3]);
        expect(result.success).toBe(false);
        expect(result.error.issues[0].path).toContain(1);
      });
    });

    describe('z.object()', () => {
      it('should validate objects', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number()
        });
        expect(schema.safeParse({ name: 'John', age: 30 }).success).toBe(true);
      });

      it('should reject non-objects', () => {
        const schema = z.object({ name: z.string() });
        expect(schema.safeParse('not object').success).toBe(false);
        expect(schema.safeParse(null).success).toBe(false);
        expect(schema.safeParse([]).success).toBe(false);
      });

      it('should validate required fields', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number()
        });
        expect(schema.safeParse({ name: 'John' }).success).toBe(false);
      });

      it('should handle optional fields', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number().optional()
        });
        expect(schema.safeParse({ name: 'John' }).success).toBe(true);
      });

      it('should validate nested objects', () => {
        const schema = z.object({
          user: z.object({
            name: z.string()
          })
        });
        expect(schema.safeParse({ user: { name: 'John' } }).success).toBe(true);
        expect(schema.safeParse({ user: { name: 123 } }).success).toBe(false);
      });

      it('should strip extra fields by default', () => {
        const schema = z.object({ name: z.string() });
        const result = schema.safeParse({ name: 'John', extra: 'field' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: 'John' });
      });

      it('should reject extra fields in strict mode', () => {
        const schema = z.object({ name: z.string() }).strict();
        const result = schema.safeParse({ name: 'John', extra: 'field' });
        expect(result.success).toBe(false);
      });

      it('should keep extra fields in passthrough mode', () => {
        const schema = z.object({ name: z.string() }).passthrough();
        const result = schema.safeParse({ name: 'John', extra: 'field' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: 'John', extra: 'field' });
      });

      it('should extend objects', () => {
        const baseSchema = z.object({ name: z.string() });
        const extendedSchema = baseSchema.extend({ age: z.number() });
        expect(extendedSchema.safeParse({ name: 'John', age: 30 }).success).toBe(true);
        expect(extendedSchema.safeParse({ name: 'John' }).success).toBe(false);
      });
    });

    describe('z.union()', () => {
      it('should accept any matching type', () => {
        const schema = z.union([z.string(), z.number()]);
        expect(schema.safeParse('hello').success).toBe(true);
        expect(schema.safeParse(42).success).toBe(true);
      });

      it('should reject non-matching types', () => {
        const schema = z.union([z.string(), z.number()]);
        expect(schema.safeParse(true).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
      });
    });

    describe('z.literal()', () => {
      it('should match exact values', () => {
        const schema = z.literal('success');
        expect(schema.safeParse('success').success).toBe(true);
        expect(schema.safeParse('failure').success).toBe(false);
      });

      it('should work with numbers', () => {
        const schema = z.literal(42);
        expect(schema.safeParse(42).success).toBe(true);
        expect(schema.safeParse(43).success).toBe(false);
      });
    });

    describe('z.any()', () => {
      it('should accept anything except undefined when required', () => {
        const schema = z.any();
        expect(schema.safeParse('string').success).toBe(true);
        expect(schema.safeParse(123).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse(null).success).toBe(true);
        expect(schema.safeParse(undefined).success).toBe(false);
      });

      it('should accept undefined when optional', () => {
        const schema = z.any().optional();
        expect(schema.safeParse(undefined).success).toBe(true);
      });
    });

    describe('z.record()', () => {
      it('should validate record objects', () => {
        const schema = z.record(z.string(), z.number());
        expect(schema.safeParse({ a: 1, b: 2 }).success).toBe(true);
        expect(schema.safeParse({ a: 'not number' }).success).toBe(false);
      });
    });
  });

  describe('built-in schemas', () => {
    it('should have ReadFileResultSchema', () => {
      const { ReadFileResultSchema } = schemaValidator.schemas;
      expect(ReadFileResultSchema).toBeDefined();

      const valid = { content: 'file content', path: '/test.txt' };
      expect(ReadFileResultSchema.safeParse(valid).success).toBe(true);

      const invalid = { path: '/test.txt' }; // missing content
      expect(ReadFileResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('should have WriteFileResultSchema', () => {
      const { WriteFileResultSchema } = schemaValidator.schemas;
      expect(WriteFileResultSchema).toBeDefined();

      const valid = { success: true, path: '/test.txt', bytesWritten: 100 };
      expect(WriteFileResultSchema.safeParse(valid).success).toBe(true);

      const invalid = { success: true, path: '/test.txt' }; // missing bytesWritten
      expect(WriteFileResultSchema.safeParse(invalid).success).toBe(false);
    });

    it('should have SearchResultSchema', () => {
      const { SearchResultSchema } = schemaValidator.schemas;
      expect(SearchResultSchema).toBeDefined();

      const valid = {
        results: [{ file: '/test.js', line: 10, content: 'test' }],
        query: 'test'
      };
      expect(SearchResultSchema.safeParse(valid).success).toBe(true);
    });

    it('should have GenericResultSchema', () => {
      const { GenericResultSchema } = schemaValidator.schemas;
      expect(GenericResultSchema).toBeDefined();

      const valid = { success: true, data: { key: 'value' } };
      expect(GenericResultSchema.safeParse(valid).success).toBe(true);

      const withError = { success: false, error: 'Something went wrong' };
      expect(GenericResultSchema.safeParse(withError).success).toBe(true);
    });
  });

  describe('validation control', () => {
    it('should start with validation disabled', () => {
      expect(schemaValidator.isValidationEnabled()).toBe(false);
    });

    it('should enable validation', () => {
      schemaValidator.setValidationEnabled(true);
      expect(schemaValidator.isValidationEnabled()).toBe(true);
    });

    it('should disable validation', () => {
      schemaValidator.setValidationEnabled(true);
      schemaValidator.setValidationEnabled(false);
      expect(schemaValidator.isValidationEnabled()).toBe(false);
    });

    it('should start with strict mode disabled', () => {
      expect(schemaValidator.isStrictMode()).toBe(false);
    });

    it('should enable strict mode', () => {
      schemaValidator.setStrictMode(true);
      expect(schemaValidator.isStrictMode()).toBe(true);
    });
  });

  describe('validateOutput', () => {
    it('should validate known tool outputs', () => {
      const result = schemaValidator.validateOutput('ReadFile', {
        content: 'test content',
        path: '/test.txt'
      });
      expect(result.success).toBe(true);
    });

    it('should fail for invalid tool outputs', () => {
      const result = schemaValidator.validateOutput('ReadFile', {
        path: '/test.txt'
        // missing content
      });
      expect(result.success).toBe(false);
    });

    it('should use generic validation for unknown tools', () => {
      const result = schemaValidator.validateOutput('UnknownTool', {
        success: true,
        data: 'some data'
      });
      expect(result.success).toBe(true);
    });
  });

  describe('validateToolOutput', () => {
    it('should return output unchanged when validation disabled', () => {
      const output = { invalid: 'data' };
      const result = schemaValidator.validateToolOutput('ReadFile', output);
      expect(result).toBe(output);
    });

    it('should validate and return data when validation enabled', () => {
      schemaValidator.setValidationEnabled(true);
      const output = { content: 'test', path: '/test.txt' };
      const result = schemaValidator.validateToolOutput('ReadFile', output);
      expect(result).toEqual(output);
    });

    it('should log warning for invalid output in non-strict mode', () => {
      schemaValidator.setValidationEnabled(true);
      schemaValidator.setStrictMode(false);
      const output = { path: '/test.txt' }; // missing content
      const result = schemaValidator.validateToolOutput('ReadFile', output);
      expect(result).toBe(output);
      expect(mockUtils.logger.warn).toHaveBeenCalled();
    });

    it('should throw for invalid output in strict mode', () => {
      schemaValidator.setValidationEnabled(true);
      schemaValidator.setStrictMode(true);
      const output = { path: '/test.txt' }; // missing content
      expect(() => schemaValidator.validateToolOutput('ReadFile', output)).toThrow();
    });
  });

  describe('custom schema registration', () => {
    it('should register custom output schema', () => {
      const customSchema = z.object({
        result: z.string(),
        count: z.number()
      });
      schemaValidator.registerOutputSchema('CustomTool', customSchema);

      const result = schemaValidator.validateOutput('CustomTool', {
        result: 'success',
        count: 5
      });
      expect(result.success).toBe(true);
    });

    it('should unregister custom output schema', () => {
      const customSchema = z.object({ test: z.string() });
      schemaValidator.registerOutputSchema('TempTool', customSchema);
      expect(schemaValidator.getOutputSchema('TempTool')).toBeDefined();

      schemaValidator.unregisterOutputSchema('TempTool');
      expect(schemaValidator.getOutputSchema('TempTool')).toBeNull();
    });

    it('should list registered schemas', () => {
      const schemas = schemaValidator.listOutputSchemas();
      expect(Array.isArray(schemas)).toBe(true);
      expect(schemas.some(s => s.name === 'ReadFile')).toBe(true);
      expect(schemas.some(s => s.name === 'WriteFile')).toBe(true);
    });
  });

  describe('wrapToolWithValidation', () => {
    it('should wrap tool function with validation', async () => {
      schemaValidator.setValidationEnabled(true);

      const mockTool = vi.fn().mockResolvedValue({
        content: 'test content',
        path: '/test.txt'
      });

      const wrappedTool = schemaValidator.wrapToolWithValidation('ReadFile', mockTool);
      const result = await wrappedTool({ path: '/test.txt' }, {});

      expect(mockTool).toHaveBeenCalled();
      expect(result.content).toBe('test content');
    });

    it('should validate output of wrapped tool', async () => {
      schemaValidator.setValidationEnabled(true);
      schemaValidator.setStrictMode(true);

      const mockTool = vi.fn().mockResolvedValue({
        path: '/test.txt'
        // missing content
      });

      const wrappedTool = schemaValidator.wrapToolWithValidation('ReadFile', mockTool);

      await expect(wrappedTool({ path: '/test.txt' }, {})).rejects.toThrow();
    });
  });

  describe('z export', () => {
    it('should export z schema builders', () => {
      expect(schemaValidator.z).toBeDefined();
      expect(schemaValidator.z.string).toBeDefined();
      expect(schemaValidator.z.number).toBeDefined();
      expect(schemaValidator.z.boolean).toBeDefined();
      expect(schemaValidator.z.array).toBeDefined();
      expect(schemaValidator.z.object).toBeDefined();
    });
  });

  describe('metadata', () => {
    it('should have correct module metadata', () => {
      expect(SchemaValidatorModule.metadata.id).toBe('SchemaValidator');
      expect(SchemaValidatorModule.metadata.type).toBe('service');
      expect(SchemaValidatorModule.metadata.async).toBe(false);
      expect(SchemaValidatorModule.metadata.dependencies).toContain('Utils');
    });
  });
});
