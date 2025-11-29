/**
 * @fileoverview Tool Runner
 * Execution engine for built-in and dynamic tools.
 */

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '2.1.1',
    dependencies: ['Utils', 'VFS', 'ToolWriter', 'SubstrateLoader?', 'EventBus'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, ToolWriter, SubstrateLoader, EventBus } = deps;
    const { logger, Errors } = Utils;

    const _tools = new Map();
    const _dynamicTools = new Set();

    // --- Built-in Tools (VFS & System) ---

    const builtIns = {
      // VFS Ops
      read_file: async (args) => {
        const path = args.path || args.file;
        if (!path) throw new Errors.ValidationError('Missing path');
        return await VFS.read(path);
      },
      write_file: async (args) => {
        const path = args.path || args.file;
        const content = args.content;
        if (!path) throw new Errors.ValidationError('Missing path argument');
        if (content === undefined) throw new Errors.ValidationError('Missing content argument');

        const existed = await VFS.exists(path);
        await VFS.write(path, content);

        // Emit event for UI to auto-refresh VFS viewer
        if (EventBus) {
          EventBus.emit(existed ? 'vfs:write' : 'artifact:created', { path });
        }

        return `Wrote ${path} (${content.length} bytes)`;
      },
      list_files: async (args) => {
        const path = args.path || args.directory || args.dir;
        return await VFS.list(path || '/');
      },
      delete_file: async (args) => {
        const path = args.path || args.file;
        if (!path) throw new Errors.ValidationError('Missing path');
        await VFS.delete(path);

        // Emit event for UI to show deletion with strikethrough
        if (EventBus) {
          EventBus.emit('artifact:deleted', { path });
        }

        return `Deleted ${path}`;
      },

      // Tool Management (RSI)
      create_tool: async ({ name, code }) => {
        return await ToolWriter.create(name, code);
      },

      // Tool Discovery
      list_tools: async () => {
        return Array.from(_tools.keys());
      }
    };

    // L3 Capability: Substrate Loader
    if (SubstrateLoader) {
        builtIns.load_module = async ({ path }) => {
            await SubstrateLoader.loadModule(path);
            return `Hot-reloaded module from ${path}`;
        };
    }

    // Register built-ins
    Object.entries(builtIns).forEach(([name, fn]) => _tools.set(name, fn));

    const loadToolModule = async (path, forcedName = null) => {
      try {
        const code = await VFS.read(path);
        const blob = new Blob([code], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);

        try {
          const mod = await import(url);
          const handler = typeof mod.default === 'function'
            ? mod.default
            : typeof mod.tool?.call === 'function'
              ? mod.tool.call
              : null;

          if (!handler) {
            logger.warn(`[ToolRunner] ${path} missing default export`);
            return false;
          }

          const name = forcedName || path.split('/').pop().replace('.js', '');
          _tools.set(name, handler);
          _dynamicTools.add(name);
          logger.info(`[ToolRunner] Loaded dynamic tool: ${name}`);
          return true;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        logger.error(`[ToolRunner] Failed to load ${path}`, e);
        return false;
      }
    };

    const unloadDynamicTools = () => {
      for (const name of _dynamicTools) {
        _tools.delete(name);
      }
      _dynamicTools.clear();
    };

    // --- Dynamic Tool Loading ---

    const loadDynamicTools = async () => {
      unloadDynamicTools();

      let files = [];
      try {
        files = await VFS.list('/tools/');
      } catch (err) {
        logger.warn('[ToolRunner] Failed to list /tools directory', err);
        return true;
      }

      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        // Skip test files
        if (file.includes('.test.') || file.includes('.spec.') || file.includes('.integration.')) continue;
        await loadToolModule(file);
      }
      return true;
    };

    const ensureToolLoaded = async (name) => {
      if (_tools.has(name)) return true;
      const path = `/tools/${name}.js`;
      if (await VFS.exists(path)) {
        return await loadToolModule(path, name);
      }
      return false;
    };

    // --- Public API ---

    const execute = async (name, args = {}) => {
      if (!_tools.has(name)) {
        const loaded = await ensureToolLoaded(name);
        if (!loaded) {
          throw new Errors.ToolError(`Tool not found: ${name}`);
        }
      }

      const toolFn = _tools.get(name);
      if (!toolFn) {
        throw new Errors.ToolError(`Tool not found: ${name}`);
      }

      logger.info(`[ToolRunner] Executing ${name}`);

      try {
        const result = await toolFn(args, { VFS }); // Inject VFS for tools like code_intel
        return result;
      } catch (err) {
        logger.error(`[ToolRunner] Error in ${name}`, err);
        const errorWithContext = new Errors.ToolError(err.message, { tool: name, args });
        errorWithContext.stack = err.stack; // Preserve original stack trace
        throw errorWithContext;
      }
    };

    return {
      init: loadDynamicTools,
      execute,
      refresh: loadDynamicTools,
      list: () => Array.from(_tools.keys()),
      has: (name) => _tools.has(name)
    };
  }
};

export default ToolRunner;
