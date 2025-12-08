/**
 * @fileoverview Schema Registry
 * Central source for tool input schemas and worker type definitions.
 */

const SchemaRegistry = {
  metadata: {
    id: 'SchemaRegistry',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS } = deps;
    const { logger } = Utils;

    const SCHEMAS_PATH = '/.system/schemas.json';

    const _toolSchemas = new Map();   // name -> { schema, builtin }
    const _workerSchemas = new Map(); // name -> { config, builtin }

    const DEFAULT_TOOL_SCHEMAS = {
      ReadFile: {
        description: 'Read contents of a file from the virtual filesystem',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'VFS path to read (e.g. /core/agent-loop.js)' }
          }
        }
      },
      WriteFile: {
        description: 'Write content to a file in the virtual filesystem',
        parameters: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string', description: 'VFS path to write' },
            content: { type: 'string', description: 'Content to write' }
          }
        }
      },
      ListFiles: {
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default: /)' }
          }
        }
      },
      DeleteFile: {
        description: 'Delete a file from the virtual filesystem',
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
        parameters: {
          type: 'object',
          required: ['name', 'code'],
          properties: {
            name: { type: 'string', description: 'Tool name (CamelCase, e.g., ReadFile, AnalyzeLogs)' },
            code: { type: 'string', description: 'JavaScript code with export default async function' }
          }
        }
      },
      ListTools: {
        description: 'List all available tools',
        parameters: { type: 'object', properties: {} }
      },
      LoadModule: {
        description: 'Hot-reload a module from the VFS',
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

    const init = async () => {
      // Register builtin schemas first
      registerToolSchema('ReadFile', DEFAULT_TOOL_SCHEMAS.ReadFile, { builtin: true });
      registerToolSchema('WriteFile', DEFAULT_TOOL_SCHEMAS.WriteFile, { builtin: true });
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
      listToolSchemas,
      registerWorkerTypes,
      getWorkerType,
      listWorkerTypes
    };
  }
};

export default SchemaRegistry;
