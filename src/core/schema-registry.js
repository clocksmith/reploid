/**
 * @fileoverview Schema Registry
 * Central source for tool input schemas, output schemas, and worker type definitions.
 * Integrates with SchemaValidator for runtime type safety.
 */

const SchemaRegistry = {
  metadata: {
    id: 'SchemaRegistry',
    version: '1.1.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'VFS', 'SchemaValidator?'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, SchemaValidator } = deps;
    const { logger } = Utils;

    const SCHEMAS_PATH = '/.system/schemas.json';

    const _toolSchemas = new Map();   // name -> { schema, builtin }
    const _workerSchemas = new Map(); // name -> { config, builtin }

    // Tool schemas with readOnly flag for parallel execution
    // readOnly: true = safe for parallel execution (no side effects)
    // readOnly: false/undefined = mutating, must execute sequentially
    const DEFAULT_TOOL_SCHEMAS = {
      ReadFile: {
        description: 'Read contents of a file from VFS or OPFS',
        readOnly: true,
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Path to read (vfs:/ or opfs:/). Default backend is VFS.' },
            backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
            mode: { type: 'string', enum: ['text', 'binary'], description: 'Read mode (default: text)' },
            maxBytes: { type: 'number', description: 'Maximum bytes to read' },
            offset: { type: 'number', description: 'Binary read offset (bytes)' },
            length: { type: 'number', description: 'Binary read length (bytes)' },
            startLine: { type: 'number', description: 'First line to read (1-indexed, inclusive). VFS only.' },
            endLine: { type: 'number', description: 'Last line to read (1-indexed, inclusive). VFS only.' }
          }
        }
      },
      WriteFile: {
        description: 'Write content to a file in VFS or OPFS',
        readOnly: false,
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Path to write (vfs:/ or opfs:/). Default backend is VFS.' },
            backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
            mode: { type: 'string', enum: ['text', 'binary'], description: 'Write mode (default: text)' },
            content: { type: 'string', description: 'Text content to write' },
            data: { type: 'string', description: 'Base64 data for binary writes' },
            checksum: { type: 'string', description: 'Optional checksum for binary data' },
            checksumAlgorithm: { type: 'string', description: 'Checksum algorithm (default: sha256)' },
            maxBytes: { type: 'number', description: 'Maximum bytes to write' },
            create: { type: 'boolean', description: 'Create file if missing (default true)' },
            overwrite: { type: 'boolean', description: 'Overwrite file if it exists (default true)' },
            autoLoad: { type: 'boolean', description: 'If true and path is .js, hot-reload the module after writing', default: false }
          }
        }
      },
      EditFile: {
        description: 'Apply literal match/replace edits to a text file in VFS or OPFS',
        readOnly: false,
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Path to edit (vfs:/ or opfs:/). Default backend is VFS.' },
            backend: { type: 'string', description: 'Optional backend override (vfs or opfs)' },
            content: { type: 'string', description: 'Full replacement content (text only)' },
            patch: {
              type: 'array',
              description: 'Patch operations with find/replace',
              items: {
                type: 'object',
                required: ['find'],
                properties: {
                  find: { type: 'string' },
                  replace: { type: 'string' },
                  count: { type: 'number' }
                }
              }
            },
            operations: {
              type: 'array',
              description: 'Legacy operations array',
              items: {
                type: 'object',
                required: ['match'],
                properties: {
                  match: { type: 'string' },
                  replacement: { type: 'string' },
                  count: { type: 'number' }
                }
              }
            },
            create: { type: 'boolean', description: 'Create file if missing (default false)' }
          }
        }
      },
      ListFiles: {
        description: 'List files in a directory',
        readOnly: true,
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default: /)' }
          }
        }
      },
      DeleteFile: {
        description: 'Delete a file from the virtual filesystem',
        readOnly: false,
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'VFS path to delete' }
          }
        }
      },
      CreateTool: {
        description: 'Create a new tool at runtime (Level 1 RSI)',
        readOnly: false,
        parameters: {
          type: 'object',
          required: ['name', 'code'],
          properties: {
            name: { type: 'string', description: 'Tool name (CamelCase, e.g., ReadFile, AnalyzeLogs)' },
            code: { type: 'string', description: 'JavaScript code with export default { metadata: { readOnly: true/false }, call: async (args, deps) => {...} }. Set readOnly: true for tools that only read data (enables parallel execution).' }
          }
        }
      },
      ListTools: {
        description: 'List all available tools',
        readOnly: true,
        parameters: { type: 'object', properties: {} }
      },
      LoadModule: {
        description: 'Hot-reload a module from the VFS',
        readOnly: false,
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'VFS path to module' }
          }
        }
      }
    };

    // Persist non-builtin schemas to VFS
    const _persist = async () => {
      if (!VFS) return;
      try {
        const data = {
          tools: {},
          workers: {}
        };
        // Only persist non-builtin schemas
        for (const [name, entry] of _toolSchemas.entries()) {
          if (!entry.builtin) {
            data.tools[name] = entry.schema;
          }
        }
        for (const [name, entry] of _workerSchemas.entries()) {
          if (!entry.builtin) {
            data.workers[name] = entry.config;
          }
        }
        await VFS.write(SCHEMAS_PATH, JSON.stringify(data, null, 2));
      } catch (e) {
        logger.warn('[SchemaRegistry] Failed to persist schemas:', e.message);
      }
    };

    // Load persisted schemas from VFS
    const _load = async () => {
      if (!VFS) return;
      try {
        const content = await VFS.read(SCHEMAS_PATH);
        if (!content) return;
        const data = JSON.parse(content);
        // Merge persisted tool schemas (non-builtin)
        if (data.tools) {
          for (const [name, schema] of Object.entries(data.tools)) {
            if (!_toolSchemas.has(name)) {
              _toolSchemas.set(name, { schema, builtin: false });
            }
          }
        }
        // Merge persisted worker schemas (non-builtin)
        if (data.workers) {
          for (const [name, config] of Object.entries(data.workers)) {
            if (!_workerSchemas.has(name)) {
              _workerSchemas.set(name, { config, builtin: false });
            }
          }
        }
        logger.info('[SchemaRegistry] Loaded persisted schemas from VFS');
      } catch (e) {
        // File may not exist yet, that's fine
        if (!e.message?.includes('not found')) {
          logger.warn('[SchemaRegistry] Failed to load schemas:', e.message);
        }
      }
    };

    const registerToolSchema = (name, schema, options = {}) => {
      if (!name || !schema) return;
      _toolSchemas.set(name, { schema, builtin: !!options.builtin });
      // Persist non-builtin schemas
      if (!options.builtin) {
        _persist();
      }
    };

    const unregisterToolSchema = (name) => {
      const entry = _toolSchemas.get(name);
      if (entry?.builtin) return false;
      const result = _toolSchemas.delete(name);
      if (result) _persist();
      return result;
    };

    const getToolSchema = (name) => _toolSchemas.get(name)?.schema || null;

    /**
     * Check if a tool is read-only (safe for parallel execution)
     * Falls back to hardcoded list for tools without explicit metadata
     */
    const isToolReadOnly = (name) => {
      const entry = _toolSchemas.get(name);
      if (entry?.schema?.readOnly !== undefined) {
        return entry.schema.readOnly;
      }
      // Fallback for tools without explicit readOnly metadata
      const FALLBACK_READ_ONLY = ['Grep', 'Find', 'FileOutline', 'Head', 'Tail'];
      return FALLBACK_READ_ONLY.includes(name);
    };

    /**
     * Get list of all read-only tool names
     */
    const getReadOnlyTools = () => {
      const readOnly = [];
      for (const [name, entry] of _toolSchemas.entries()) {
        if (entry.schema?.readOnly === true) {
          readOnly.push(name);
        }
      }
      // Add fallback tools
      const FALLBACK_READ_ONLY = ['Grep', 'Find', 'FileOutline', 'Head', 'Tail'];
      for (const name of FALLBACK_READ_ONLY) {
        if (!readOnly.includes(name)) {
          readOnly.push(name);
        }
      }
      return readOnly;
    };

    const listToolSchemas = () => {
      const result = [];
      for (const [name, entry] of _toolSchemas.entries()) {
        result.push({ name, ...entry });
      }
      return result;
    };

    const registerWorkerTypes = (workerTypes = {}, options = {}) => {
      let hasNonBuiltin = false;
      for (const [name, config] of Object.entries(workerTypes)) {
        _workerSchemas.set(name, { config, builtin: !!options.builtin });
        if (!options.builtin) hasNonBuiltin = true;
      }
      // Persist if any non-builtin types were added
      if (hasNonBuiltin) _persist();
    };

    const getWorkerType = (name) => _workerSchemas.get(name)?.config || null;

    const listWorkerTypes = () => {
      const result = [];
      for (const [name, entry] of _workerSchemas.entries()) {
        result.push({ name, ...entry });
      }
      return result;
    };

    // -------------------------------------------------------------------------
    // FunctionGemma Output Validation & Merging
    // -------------------------------------------------------------------------

    /**
     * Validate a value against a JSON schema (simplified).
     * @param {*} value - Value to validate
     * @param {Object} schema - JSON schema
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    const validateSchema = (value, schema) => {
      const errors = [];

      if (!schema || typeof schema !== 'object') {
        return { valid: true, errors: [] };
      }

      // Type check
      if (schema.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (schema.type === 'object' && (value === null || actualType !== 'object')) {
          errors.push(`Expected object, got ${actualType}`);
        } else if (schema.type === 'array' && actualType !== 'array') {
          errors.push(`Expected array, got ${actualType}`);
        } else if (schema.type !== 'object' && schema.type !== 'array' && actualType !== schema.type) {
          errors.push(`Expected ${schema.type}, got ${actualType}`);
        }
      }

      // Required fields
      if (schema.required && Array.isArray(schema.required) && typeof value === 'object' && value !== null) {
        for (const key of schema.required) {
          if (!(key in value)) {
            errors.push(`Missing required field: ${key}`);
          }
        }
      }

      // Properties type check
      if (schema.properties && typeof value === 'object' && value !== null) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in value && propSchema.type) {
            const propType = Array.isArray(value[key]) ? 'array' : typeof value[key];
            if (propSchema.type !== propType && value[key] !== null) {
              errors.push(`Field ${key}: expected ${propSchema.type}, got ${propType}`);
            }
          }
        }
      }

      return { valid: errors.length === 0, errors };
    };

    /**
     * Validate combined outputs from multiple FunctionGemma experts.
     * @param {Object} outputs - { expertId: output, ... }
     * @param {Object|string} taskSchema - Schema object or schema name
     * @returns {Object} { valid: boolean, errors: Array<{ expertId, errors }> }
     */
    const validateCombinedOutput = (outputs, taskSchema) => {
      const schema = typeof taskSchema === 'string'
        ? getToolSchema(taskSchema)?.parameters
        : taskSchema;

      const allErrors = [];

      for (const [expertId, output] of Object.entries(outputs)) {
        let parsed = output;

        // Try to parse if string
        if (typeof output === 'string') {
          try {
            parsed = JSON.parse(output);
          } catch {
            allErrors.push({ expertId, errors: ['Output is not valid JSON'] });
            continue;
          }
        }

        const result = validateSchema(parsed, schema);
        if (!result.valid) {
          allErrors.push({ expertId, errors: result.errors });
        }
      }

      return {
        valid: allErrors.length === 0,
        errors: allErrors
      };
    };

    /**
     * Merge outputs from multiple FunctionGemma experts.
     * @param {Array<{ output, weight }>} outputs - Weighted outputs
     * @param {string} strategy - 'voting', 'weighted', or 'concatenate'
     * @returns {Object} Merged output
     */
    const mergeOutputs = (outputs, strategy = 'weighted') => {
      if (!outputs || outputs.length === 0) {
        return null;
      }

      if (strategy === 'voting') {
        // Simple majority voting on parsed outputs
        const votes = new Map();
        for (const { output } of outputs) {
          const key = JSON.stringify(output);
          votes.set(key, (votes.get(key) || 0) + 1);
        }
        let maxVotes = 0;
        let winner = null;
        for (const [key, count] of votes.entries()) {
          if (count > maxVotes) {
            maxVotes = count;
            winner = JSON.parse(key);
          }
        }
        return winner;
      }

      if (strategy === 'weighted') {
        // Weighted merge - higher weight outputs take priority
        const merged = { code: '', imports: new Set() };

        // Sort by weight descending
        const sorted = [...outputs].sort((a, b) => (b.weight || 0) - (a.weight || 0));

        for (const { output, weight } of sorted) {
          if ((weight || 0) < 0.5) continue;

          const parsed = typeof output === 'string' ? JSON.parse(output) : output;

          if (parsed?.code) {
            merged.code += (merged.code ? '\n\n' : '') + parsed.code;
          }
          if (parsed?.imports) {
            for (const imp of parsed.imports) {
              merged.imports.add(imp);
            }
          }
        }

        merged.imports = [...merged.imports];
        return merged;
      }

      // Default: concatenate
      const merged = { code: '', imports: new Set() };

      for (const { output } of outputs) {
        const parsed = typeof output === 'string' ? JSON.parse(output) : output;

        if (parsed?.code) {
          merged.code += (merged.code ? '\n\n' : '') + parsed.code;
        }
        if (parsed?.imports) {
          for (const imp of parsed.imports) {
            merged.imports.add(imp);
          }
        }
      }

      merged.imports = [...merged.imports];
      return merged;
    };

    // -------------------------------------------------------------------------
    // Output Schema Integration (via SchemaValidator)
    // -------------------------------------------------------------------------

    /**
     * Register an output schema for a tool (delegates to SchemaValidator)
     * @param {string} toolName - Tool name
     * @param {Object} schema - Zod-compatible schema
     */
    const registerOutputSchema = (toolName, schema) => {
      if (SchemaValidator) {
        SchemaValidator.registerOutputSchema(toolName, schema);
      }
    };

    /**
     * Get the output schema for a tool
     * @param {string} toolName - Tool name
     * @returns {Object|null}
     */
    const getOutputSchema = (toolName) => {
      if (SchemaValidator) {
        return SchemaValidator.getOutputSchema(toolName);
      }
      return null;
    };

    /**
     * Validate tool output against its schema
     * @param {string} toolName - Tool name
     * @param {*} output - Output to validate
     * @returns {Object} Validation result { success, data?, error? }
     */
    const validateToolOutput = (toolName, output) => {
      if (SchemaValidator) {
        return SchemaValidator.validateOutput(toolName, output);
      }
      // Fallback: no validation
      return { success: true, data: output };
    };

    /**
     * Enable or disable output validation
     * @param {boolean} enabled
     */
    const setOutputValidationEnabled = (enabled) => {
      if (SchemaValidator) {
        SchemaValidator.setValidationEnabled(enabled);
      }
    };

    /**
     * Check if output validation is enabled
     * @returns {boolean}
     */
    const isOutputValidationEnabled = () => {
      if (SchemaValidator) {
        return SchemaValidator.isValidationEnabled();
      }
      return false;
    };

    const init = async () => {
      // Register builtin schemas first
      registerToolSchema('ReadFile', DEFAULT_TOOL_SCHEMAS.ReadFile, { builtin: true });
      registerToolSchema('WriteFile', DEFAULT_TOOL_SCHEMAS.WriteFile, { builtin: true });
      registerToolSchema('EditFile', DEFAULT_TOOL_SCHEMAS.EditFile, { builtin: true });
      registerToolSchema('ListFiles', DEFAULT_TOOL_SCHEMAS.ListFiles, { builtin: true });
      registerToolSchema('DeleteFile', DEFAULT_TOOL_SCHEMAS.DeleteFile, { builtin: true });
      registerToolSchema('CreateTool', DEFAULT_TOOL_SCHEMAS.CreateTool, { builtin: true });
      registerToolSchema('ListTools', DEFAULT_TOOL_SCHEMAS.ListTools, { builtin: true });
      registerToolSchema('LoadModule', DEFAULT_TOOL_SCHEMAS.LoadModule, { builtin: true });
      logger.info('[SchemaRegistry] Default tool schemas registered');
      // Load persisted non-builtin schemas from VFS
      await _load();
      return true;
    };

    return {
      init,
      registerToolSchema,
      unregisterToolSchema,
      getToolSchema,
      isToolReadOnly,
      getReadOnlyTools,
      listToolSchemas,
      registerWorkerTypes,
      getWorkerType,
      listWorkerTypes,
      // FunctionGemma output validation & merging
      validateSchema,
      validateCombinedOutput,
      mergeOutputs,
      // Output schema integration (via SchemaValidator)
      registerOutputSchema,
      getOutputSchema,
      validateToolOutput,
      setOutputValidationEnabled,
      isOutputValidationEnabled
    };
  }
};

export default SchemaRegistry;
