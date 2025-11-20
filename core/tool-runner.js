/**
 * @fileoverview Tool Runner
 * Execution engine for built-in and dynamic tools.
 */

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '2.0.0',
    dependencies: ['Utils', 'VFS', 'ToolWriter', 'MetaToolWriter'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, ToolWriter, MetaToolWriter } = deps;
    const { logger, Errors } = Utils;

    const _tools = new Map();

    // --- Built-in Tools (VFS & System) ---

    const builtIns = {
      // VFS Ops
      read_file: async ({ path }) => {
        if (!path) throw new Errors.ValidationError('Missing path');
        return await VFS.read(path);
      },
      write_file: async ({ path, content }) => {
        if (!path || content === undefined) throw new Errors.ValidationError('Missing args');
        await VFS.write(path, content);
        return `Wrote ${path} (${content.length} bytes)`;
      },
      list_files: async ({ path }) => {
        return await VFS.list(path || '/');
      },
      delete_file: async ({ path }) => {
        await VFS.delete(path);
        return `Deleted ${path}`;
      },

      // Tool Management (Level 1 RSI)
      create_tool: async ({ name, code }) => {
        return await ToolWriter.create(name, code);
      },

      // Core Modification (Level 2 RSI)
      improve_core_module: async ({ module, code }) => {
        return await MetaToolWriter.improveCore(module, code);
      }
    };

    // Register built-ins
    Object.entries(builtIns).forEach(([name, fn]) => _tools.set(name, fn));

    // --- Dynamic Tool Loading ---

    const loadDynamicTools = async () => {
      const files = await VFS.list('/tools/');
      for (const file of files) {
        if (file.endsWith('.js')) {
          try {
            const code = await VFS.read(file);
            const name = file.split('/').pop().replace('.js', '');

            // Create blob for import
            const blob = new Blob([code], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);

            const mod = await import(url);
            if (typeof mod.default === 'function') {
              _tools.set(name, mod.default);
              logger.info(`[ToolRunner] Loaded dynamic tool: ${name}`);
            }
            URL.revokeObjectURL(url);
          } catch (e) {
            logger.error(`[ToolRunner] Failed to load ${file}`, e);
          }
        }
      }
    };

    // --- Public API ---

    const execute = async (name, args = {}) => {
      const toolFn = _tools.get(name);
      if (!toolFn) {
        throw new Errors.ToolError(`Tool not found: ${name}`);
      }

      logger.info(`[ToolRunner] Executing ${name}`);

      try {
        const result = await toolFn(args);
        return result;
      } catch (err) {
        logger.error(`[ToolRunner] Error in ${name}`, err);
        throw new Errors.ToolError(err.message, { tool: name, args });
      }
    };

    return {
      init: loadDynamicTools,
      execute,
      list: () => Array.from(_tools.keys()),
      has: (name) => _tools.has(name)
    };
  }
};

export default ToolRunner;
