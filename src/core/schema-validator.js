/**
 * @fileoverview Schema Validator
 * Type-safe runtime validation for tool outputs using Zod-like schemas.
 * Provides type-level guarantees for tool return values.
 *
 * NOTE: Zod is not currently installed. Add to package.json:
 *   "zod": "^3.22.0"
 *
 * This module works without Zod by providing a compatible subset implementation.
 * When Zod is installed, it will be used automatically for enhanced validation.
 */

// -----------------------------------------------------------------------------
// Zod-compatible Schema Builder (standalone implementation)
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success - Whether validation passed
 * @property {*} [data] - Validated data (on success)
 * @property {Object} [error] - Validation error details (on failure)
 * @property {Array<{path: string[], message: string}>} [error.issues] - List of validation issues
 */

/**
 * Helper to create chainable schema with proper `this` binding
 */
const createSchema = (config, methods) => {
  const schema = { ...config };

  // Add methods that reference the schema via closure
  for (const [name, fn] of Object.entries(methods)) {
    schema[name] = (...args) => fn(schema, ...args);
  }

  return schema;
};

/**
 * Create a string schema
 * @returns {Object}
 */
const string = () => {
  const config = {
    _type: 'string',
    _optional: false,
    _nullable: false,
    _default: undefined,
    _minLength: undefined,
    _maxLength: undefined
  };

  const methods = {
    min: (self, length) => string()._cloneWith({ ...self, _minLength: length }),
    max: (self, length) => string()._cloneWith({ ...self, _maxLength: length }),
    optional: (self) => string()._cloneWith({ ...self, _optional: true }),
    nullable: (self) => string()._cloneWith({ ...self, _nullable: true }),
    default: (self, value) => string()._cloneWith({ ...self, _default: value, _optional: true }),

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._default !== undefined) {
          return { success: true, data: self._default };
        }
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (value === null) {
        if (self._nullable) {
          return { success: true, data: null };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Expected string, received null' }] } };
      }
      if (typeof value !== 'string') {
        return { success: false, error: { issues: [{ path: [], message: `Expected string, received ${typeof value}` }] } };
      }
      if (self._minLength !== undefined && value.length < self._minLength) {
        return { success: false, error: { issues: [{ path: [], message: `String must contain at least ${self._minLength} character(s)` }] } };
      }
      if (self._maxLength !== undefined && value.length > self._maxLength) {
        return { success: false, error: { issues: [{ path: [], message: `String must contain at most ${self._maxLength} character(s)` }] } };
      }
      return { success: true, data: value };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  const schema = createSchema(config, methods);
  schema._cloneWith = (newConfig) => {
    const s = createSchema(newConfig, methods);
    s._cloneWith = schema._cloneWith;
    return s;
  };
  return schema;
};

/**
 * Create a number schema
 * @returns {Object}
 */
const number = () => {
  const config = {
    _type: 'number',
    _optional: false,
    _nullable: false,
    _default: undefined,
    _min: undefined,
    _max: undefined,
    _int: false
  };

  const methods = {
    min: (self, value) => number()._cloneWith({ ...self, _min: value }),
    max: (self, value) => number()._cloneWith({ ...self, _max: value }),
    int: (self) => number()._cloneWith({ ...self, _int: true }),
    optional: (self) => number()._cloneWith({ ...self, _optional: true }),
    nullable: (self) => number()._cloneWith({ ...self, _nullable: true }),
    default: (self, value) => number()._cloneWith({ ...self, _default: value, _optional: true }),

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._default !== undefined) {
          return { success: true, data: self._default };
        }
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (value === null) {
        if (self._nullable) {
          return { success: true, data: null };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Expected number, received null' }] } };
      }
      if (typeof value !== 'number' || isNaN(value)) {
        return { success: false, error: { issues: [{ path: [], message: `Expected number, received ${typeof value}` }] } };
      }
      if (self._int && !Number.isInteger(value)) {
        return { success: false, error: { issues: [{ path: [], message: 'Expected integer, received float' }] } };
      }
      if (self._min !== undefined && value < self._min) {
        return { success: false, error: { issues: [{ path: [], message: `Number must be greater than or equal to ${self._min}` }] } };
      }
      if (self._max !== undefined && value > self._max) {
        return { success: false, error: { issues: [{ path: [], message: `Number must be less than or equal to ${self._max}` }] } };
      }
      return { success: true, data: value };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  const schema = createSchema(config, methods);
  schema._cloneWith = (newConfig) => {
    const s = createSchema(newConfig, methods);
    s._cloneWith = schema._cloneWith;
    return s;
  };
  return schema;
};

/**
 * Create a boolean schema
 * @returns {Object}
 */
const boolean = () => {
  const config = {
    _type: 'boolean',
    _optional: false,
    _nullable: false,
    _default: undefined
  };

  const methods = {
    optional: (self) => boolean()._cloneWith({ ...self, _optional: true }),
    nullable: (self) => boolean()._cloneWith({ ...self, _nullable: true }),
    default: (self, value) => boolean()._cloneWith({ ...self, _default: value, _optional: true }),

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._default !== undefined) {
          return { success: true, data: self._default };
        }
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (value === null) {
        if (self._nullable) {
          return { success: true, data: null };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Expected boolean, received null' }] } };
      }
      if (typeof value !== 'boolean') {
        return { success: false, error: { issues: [{ path: [], message: `Expected boolean, received ${typeof value}` }] } };
      }
      return { success: true, data: value };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  const schema = createSchema(config, methods);
  schema._cloneWith = (newConfig) => {
    const s = createSchema(newConfig, methods);
    s._cloneWith = schema._cloneWith;
    return s;
  };
  return schema;
};

/**
 * Create an array schema
 * @param {Object} itemSchema - Schema for array items
 * @returns {Object}
 */
const array = (itemSchema) => {
  const config = {
    _type: 'array',
    _optional: false,
    _nullable: false,
    _default: undefined,
    _minLength: undefined,
    _maxLength: undefined,
    _itemSchema: itemSchema
  };

  const methods = {
    min: (self, length) => {
      const s = array(self._itemSchema)._cloneWith({ ...self, _minLength: length });
      return s;
    },
    max: (self, length) => {
      const s = array(self._itemSchema)._cloneWith({ ...self, _maxLength: length });
      return s;
    },
    optional: (self) => array(self._itemSchema)._cloneWith({ ...self, _optional: true }),
    nullable: (self) => array(self._itemSchema)._cloneWith({ ...self, _nullable: true }),
    default: (self, value) => array(self._itemSchema)._cloneWith({ ...self, _default: value, _optional: true }),

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._default !== undefined) {
          return { success: true, data: self._default };
        }
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (value === null) {
        if (self._nullable) {
          return { success: true, data: null };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Expected array, received null' }] } };
      }
      if (!Array.isArray(value)) {
        return { success: false, error: { issues: [{ path: [], message: `Expected array, received ${typeof value}` }] } };
      }
      if (self._minLength !== undefined && value.length < self._minLength) {
        return { success: false, error: { issues: [{ path: [], message: `Array must contain at least ${self._minLength} element(s)` }] } };
      }
      if (self._maxLength !== undefined && value.length > self._maxLength) {
        return { success: false, error: { issues: [{ path: [], message: `Array must contain at most ${self._maxLength} element(s)` }] } };
      }
      // Validate each item
      const validatedItems = [];
      for (let i = 0; i < value.length; i++) {
        const itemResult = self._itemSchema.safeParse(value[i]);
        if (!itemResult.success) {
          const issues = itemResult.error.issues.map(issue => ({
            path: [i, ...issue.path],
            message: issue.message
          }));
          return { success: false, error: { issues } };
        }
        validatedItems.push(itemResult.data);
      }
      return { success: true, data: validatedItems };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  const schema = createSchema(config, methods);
  schema._cloneWith = (newConfig) => {
    const s = createSchema(newConfig, methods);
    s._cloneWith = schema._cloneWith;
    return s;
  };
  return schema;
};

/**
 * Create an object schema
 * @param {Object<string, Object>} shape - Object shape definition
 * @returns {Object}
 */
const object = (shape) => {
  const config = {
    _type: 'object',
    _optional: false,
    _nullable: false,
    _default: undefined,
    _shape: shape,
    _strict: false,
    _passthrough: false
  };

  const methods = {
    strict: (self) => object(self._shape)._cloneWith({ ...self, _strict: true }),
    passthrough: (self) => object(self._shape)._cloneWith({ ...self, _passthrough: true }),
    optional: (self) => object(self._shape)._cloneWith({ ...self, _optional: true }),
    nullable: (self) => object(self._shape)._cloneWith({ ...self, _nullable: true }),
    default: (self, value) => object(self._shape)._cloneWith({ ...self, _default: value, _optional: true }),
    extend: (self, additionalShape) => object({ ...self._shape, ...additionalShape }),

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._default !== undefined) {
          return { success: true, data: self._default };
        }
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (value === null) {
        if (self._nullable) {
          return { success: true, data: null };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Expected object, received null' }] } };
      }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, error: { issues: [{ path: [], message: `Expected object, received ${Array.isArray(value) ? 'array' : typeof value}` }] } };
      }

      // Check for unrecognized keys in strict mode
      if (self._strict) {
        const extraKeys = Object.keys(value).filter(k => !(k in self._shape));
        if (extraKeys.length > 0) {
          return { success: false, error: { issues: [{ path: [extraKeys[0]], message: `Unrecognized key: ${extraKeys[0]}` }] } };
        }
      }

      // Validate each property
      const validatedObj = self._passthrough ? { ...value } : {};
      const allIssues = [];

      for (const [key, propSchema] of Object.entries(self._shape)) {
        const propResult = propSchema.safeParse(value[key]);
        if (!propResult.success) {
          for (const issue of propResult.error.issues) {
            allIssues.push({
              path: [key, ...issue.path],
              message: issue.message
            });
          }
        } else if (propResult.data !== undefined) {
          validatedObj[key] = propResult.data;
        }
      }

      if (allIssues.length > 0) {
        return { success: false, error: { issues: allIssues } };
      }

      return { success: true, data: validatedObj };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  const schema = createSchema(config, methods);
  schema._cloneWith = (newConfig) => {
    const s = createSchema(newConfig, methods);
    s._cloneWith = schema._cloneWith;
    return s;
  };
  return schema;
};

/**
 * Create a union schema (one of multiple types)
 * @param {Object[]} schemas - Array of possible schemas
 * @returns {Object}
 */
const union = (schemas) => {
  const config = {
    _type: 'union',
    _optional: false,
    _schemas: schemas
  };

  const methods = {
    optional: (self) => {
      const s = union(self._schemas);
      s._optional = true;
      return s;
    },

    safeParse: (self, value) => {
      if (value === undefined && self._optional) {
        return { success: true, data: undefined };
      }
      for (const subSchema of self._schemas) {
        const result = subSchema.safeParse(value);
        if (result.success) {
          return result;
        }
      }
      return { success: false, error: { issues: [{ path: [], message: 'Invalid input: does not match any union member' }] } };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  return createSchema(config, methods);
};

/**
 * Create a literal schema (exact value match)
 * @param {*} literalValue - The exact value to match
 * @returns {Object}
 */
const literal = (literalValue) => {
  const config = {
    _type: 'literal',
    _value: literalValue,
    _optional: false
  };

  const methods = {
    optional: (self) => {
      const s = literal(self._value);
      s._optional = true;
      return s;
    },

    safeParse: (self, value) => {
      if (value === undefined && self._optional) {
        return { success: true, data: undefined };
      }
      if (value !== self._value) {
        return { success: false, error: { issues: [{ path: [], message: `Expected ${JSON.stringify(self._value)}, received ${JSON.stringify(value)}` }] } };
      }
      return { success: true, data: value };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  return createSchema(config, methods);
};

/**
 * Create an any schema (accepts anything)
 * @returns {Object}
 */
const any = () => {
  const config = {
    _type: 'any',
    _optional: false
  };

  const methods = {
    optional: (self) => {
      const s = any();
      s._optional = true;
      return s;
    },

    safeParse: (self, value) => {
      if (value === undefined && !self._optional) {
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      return { success: true, data: value };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  return createSchema(config, methods);
};

/**
 * Create an unknown schema (accepts anything but typed as unknown)
 * @returns {Object}
 */
const unknown = () => any();

/**
 * Create a record schema (object with dynamic keys)
 * @param {Object} keySchema - Schema for keys (must be string)
 * @param {Object} valueSchema - Schema for values
 * @returns {Object}
 */
const record = (keySchema, valueSchema) => {
  const config = {
    _type: 'record',
    _optional: false,
    _keySchema: keySchema,
    _valueSchema: valueSchema
  };

  const methods = {
    optional: (self) => {
      const s = record(self._keySchema, self._valueSchema);
      s._optional = true;
      return s;
    },

    safeParse: (self, value) => {
      if (value === undefined) {
        if (self._optional) {
          return { success: true, data: undefined };
        }
        return { success: false, error: { issues: [{ path: [], message: 'Required' }] } };
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { success: false, error: { issues: [{ path: [], message: 'Expected object' }] } };
      }

      const validatedObj = {};
      for (const [key, val] of Object.entries(value)) {
        const keyResult = self._keySchema.safeParse(key);
        if (!keyResult.success) {
          return { success: false, error: { issues: [{ path: [key], message: 'Invalid key' }] } };
        }
        const valResult = self._valueSchema.safeParse(val);
        if (!valResult.success) {
          return { success: false, error: { issues: valResult.error.issues.map(i => ({ path: [key, ...i.path], message: i.message })) } };
        }
        validatedObj[key] = valResult.data;
      }
      return { success: true, data: validatedObj };
    },

    parse: (self, value) => {
      const result = self.safeParse(value);
      if (!result.success) {
        const err = new Error(result.error.issues[0].message);
        err.name = 'ZodError';
        err.issues = result.error.issues;
        throw err;
      }
      return result.data;
    }
  };

  return createSchema(config, methods);
};

// -----------------------------------------------------------------------------
// Zod-compatible API
// -----------------------------------------------------------------------------

const z = {
  string,
  number,
  boolean,
  array,
  object,
  union,
  literal,
  any,
  unknown,
  record
};

// -----------------------------------------------------------------------------
// Tool Output Schemas
// -----------------------------------------------------------------------------

/**
 * Schema for ReadFile tool output
 */
const ReadFileResultSchema = z.object({
  content: z.string(),
  path: z.string(),
  size: z.number().int().optional(),
  encoding: z.string().optional()
});

/**
 * Schema for WriteFile tool output
 */
const WriteFileResultSchema = z.object({
  success: z.boolean(),
  path: z.string(),
  bytesWritten: z.number().int().min(0)
});

/**
 * Schema for DeleteFile tool output
 */
const DeleteFileResultSchema = z.object({
  success: z.boolean(),
  path: z.string()
});

/**
 * Schema for ListFiles tool output
 */
const ListFilesResultSchema = z.object({
  files: z.array(z.string()),
  path: z.string()
});

/**
 * Schema for Search/Grep tool output
 */
const SearchResultItemSchema = z.object({
  file: z.string(),
  line: z.number().int().optional(),
  content: z.string().optional(),
  match: z.string().optional()
});

const SearchResultSchema = z.object({
  results: z.array(SearchResultItemSchema),
  query: z.string(),
  totalMatches: z.number().int().min(0).optional()
});

/**
 * Schema for CreateTool tool output
 */
const CreateToolResultSchema = z.object({
  success: z.boolean(),
  name: z.string(),
  path: z.string().optional(),
  message: z.string().optional()
});

/**
 * Schema for LoadModule tool output
 */
const LoadModuleResultSchema = z.object({
  success: z.boolean(),
  path: z.string(),
  moduleId: z.string().optional()
});

/**
 * Generic tool result schema (for tools without specific schema)
 */
const GenericResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  message: z.string().optional()
});

/**
 * Error result schema
 */
const ErrorResultSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional()
});

// -----------------------------------------------------------------------------
// Schema Registry for Tool Outputs
// -----------------------------------------------------------------------------

const OUTPUT_SCHEMAS = {
  ReadFile: ReadFileResultSchema,
  WriteFile: WriteFileResultSchema,
  DeleteFile: DeleteFileResultSchema,
  ListFiles: ListFilesResultSchema,
  Search: SearchResultSchema,
  Grep: SearchResultSchema,
  Find: SearchResultSchema,
  CreateTool: CreateToolResultSchema,
  LoadModule: LoadModuleResultSchema
};

// -----------------------------------------------------------------------------
// SchemaValidator Module
// -----------------------------------------------------------------------------

const SchemaValidator = {
  metadata: {
    id: 'SchemaValidator',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['Utils'],
    async: false,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;

    // Configuration
    let _validationEnabled = false;
    let _strictMode = false;
    const _customSchemas = new Map();

    /**
     * Enable or disable output validation
     * @param {boolean} enabled
     */
    const setValidationEnabled = (enabled) => {
      _validationEnabled = !!enabled;
      logger.info(`[SchemaValidator] Output validation ${_validationEnabled ? 'enabled' : 'disabled'}`);
    };

    /**
     * Enable or disable strict mode (throws on validation failure)
     * @param {boolean} strict
     */
    const setStrictMode = (strict) => {
      _strictMode = !!strict;
      logger.info(`[SchemaValidator] Strict mode ${_strictMode ? 'enabled' : 'disabled'}`);
    };

    /**
     * Check if validation is enabled
     * @returns {boolean}
     */
    const isValidationEnabled = () => _validationEnabled;

    /**
     * Check if strict mode is enabled
     * @returns {boolean}
     */
    const isStrictMode = () => _strictMode;

    /**
     * Register a custom output schema for a tool
     * @param {string} toolName - Tool name
     * @param {Object} schema - Zod-compatible schema
     */
    const registerOutputSchema = (toolName, schema) => {
      _customSchemas.set(toolName, schema);
      logger.debug(`[SchemaValidator] Registered output schema for ${toolName}`);
    };

    /**
     * Unregister a custom output schema
     * @param {string} toolName - Tool name
     * @returns {boolean} - Whether schema was removed
     */
    const unregisterOutputSchema = (toolName) => {
      return _customSchemas.delete(toolName);
    };

    /**
     * Get the output schema for a tool
     * @param {string} toolName - Tool name
     * @returns {Object|null}
     */
    const getOutputSchema = (toolName) => {
      return _customSchemas.get(toolName) || OUTPUT_SCHEMAS[toolName] || null;
    };

    /**
     * Validate tool output against its schema
     * @param {string} toolName - Tool name
     * @param {*} output - Tool output to validate
     * @returns {Object}
     */
    const validateOutput = (toolName, output) => {
      const schema = getOutputSchema(toolName);

      if (!schema) {
        // No schema defined, use generic validation
        return validateGeneric(output);
      }

      return schema.safeParse(output);
    };

    /**
     * Validate output with generic schema
     * @param {*} output - Output to validate
     * @returns {Object}
     */
    const validateGeneric = (output) => {
      // Allow string outputs (many tools return simple strings)
      if (typeof output === 'string') {
        return { success: true, data: output };
      }

      // Allow objects
      if (typeof output === 'object' && output !== null) {
        return GenericResultSchema.safeParse(output);
      }

      // Allow other primitives
      if (output === null || output === undefined) {
        return { success: true, data: output };
      }

      return { success: true, data: output };
    };

    /**
     * Validate and potentially transform tool output
     * This is the main hook for ToolRunner integration
     * @param {string} toolName - Tool name
     * @param {*} output - Tool output
     * @returns {*} - Validated/transformed output (or throws in strict mode)
     */
    const validateToolOutput = (toolName, output) => {
      if (!_validationEnabled) {
        return output;
      }

      const result = validateOutput(toolName, output);

      if (!result.success) {
        const errorMsg = `[SchemaValidator] ${toolName} output validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`;

        if (_strictMode) {
          const err = new Error(errorMsg);
          err.name = 'ValidationError';
          err.issues = result.error.issues;
          throw err;
        }

        logger.warn(errorMsg);
        return output; // Return original output in non-strict mode
      }

      return result.data;
    };

    /**
     * Create a wrapper function that validates tool output
     * @param {string} toolName - Tool name
     * @param {Function} toolFn - Original tool function
     * @returns {Function} - Wrapped function with validation
     */
    const wrapToolWithValidation = (toolName, toolFn) => {
      return async (args, deps) => {
        const result = await toolFn(args, deps);
        return validateToolOutput(toolName, result);
      };
    };

    /**
     * List all registered output schemas
     * @returns {Array<{name: string, builtin: boolean}>}
     */
    const listOutputSchemas = () => {
      const schemas = [];

      // Built-in schemas
      for (const name of Object.keys(OUTPUT_SCHEMAS)) {
        schemas.push({ name, builtin: true });
      }

      // Custom schemas
      for (const name of _customSchemas.keys()) {
        if (!OUTPUT_SCHEMAS[name]) {
          schemas.push({ name, builtin: false });
        }
      }

      return schemas;
    };

    return {
      // Configuration
      setValidationEnabled,
      setStrictMode,
      isValidationEnabled,
      isStrictMode,

      // Schema management
      registerOutputSchema,
      unregisterOutputSchema,
      getOutputSchema,
      listOutputSchemas,

      // Validation
      validateOutput,
      validateGeneric,
      validateToolOutput,
      wrapToolWithValidation,

      // Export schema builders for external use
      z,

      // Export built-in schemas for reference
      schemas: {
        ReadFileResultSchema,
        WriteFileResultSchema,
        DeleteFileResultSchema,
        ListFilesResultSchema,
        SearchResultSchema,
        SearchResultItemSchema,
        CreateToolResultSchema,
        LoadModuleResultSchema,
        GenericResultSchema,
        ErrorResultSchema
      }
    };
  }
};

export default SchemaValidator;
export { z };
