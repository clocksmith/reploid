/**
 * @fileoverview Tool Runner
 * Execution engine for built-in and dynamic tools.
 */

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '2.3.0',
    dependencies: ['Utils', 'VFS', 'ToolWriter', 'SubstrateLoader?', 'EventBus', 'AuditLogger?', 'HITLController?', 'ArenaHarness?', 'VFSSandbox?', 'VerificationManager?'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, ToolWriter, SubstrateLoader, EventBus, AuditLogger, HITLController, ArenaHarness, VFSSandbox, VerificationManager } = deps;
    const { logger, Errors } = Utils;

    // Arena verification for self-modification (opt-in via config)
    let _arenaGatingEnabled = false;
    try {
      const saved = localStorage.getItem('REPLOID_ARENA_GATING');
      _arenaGatingEnabled = saved === 'true';
    } catch (e) { /* ignore */ }

    const _tools = new Map();
    const _dynamicTools = new Set();

    // --- Arena Verification for Core Changes ---

    /**
     * Verify a core file change in sandbox before committing
     * @param {string} path - File path
     * @param {string} content - New content
     * @returns {Promise<{passed: boolean, errors: string[]}>}
     */
    const _verifyCoreMutation = async (path, content) => {
      // Skip verification if arena/verification not available or disabled
      if (!_arenaGatingEnabled || !VFSSandbox || !VerificationManager) {
        return { passed: true, errors: [], skipped: true };
      }

      try {
        logger.info(`[ToolRunner] Arena gating: verifying ${path}`);

        // Create snapshot of current state
        const snapshot = await VFSSandbox.createSnapshot();

        try {
          // Apply the change in sandbox
          await VFSSandbox.applyChanges({ [path]: content });

          // Run verification
          const result = await VerificationManager.verifyProposal({ [path]: content });

          return {
            passed: result.passed,
            errors: result.errors || [],
            warnings: result.warnings || []
          };
        } finally {
          // Always restore original state
          await VFSSandbox.restoreSnapshot(snapshot);
        }
      } catch (err) {
        logger.error('[ToolRunner] Arena verification failed:', err.message);
        return { passed: false, errors: [err.message] };
      }
    };

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

        const isCore = path.startsWith('/core/');
        const existed = await VFS.exists(path);
        const beforeContent = existed ? await VFS.read(path).catch(() => null) : null;

        // Arena verification for core file changes (when enabled)
        if (isCore && _arenaGatingEnabled) {
          const verification = await _verifyCoreMutation(path, content);
          if (!verification.passed && !verification.skipped) {
            const errorMsg = `Core modification blocked: ${verification.errors.join(', ')}`;
            logger.warn(`[ToolRunner] ${errorMsg}`);

            if (AuditLogger) {
              await AuditLogger.logEvent('CORE_WRITE_BLOCKED', {
                path,
                errors: verification.errors
              }, 'WARN');
            }

            if (EventBus) {
              EventBus.emit('tool:core_blocked', { path, errors: verification.errors });
            }

            throw new Errors.ValidationError(errorMsg);
          }

          if (verification.warnings?.length > 0) {
            logger.info(`[ToolRunner] Core write warnings: ${verification.warnings.join(', ')}`);
          }
        }

        await VFS.write(path, content);

        // Emit event for UI to auto-refresh VFS viewer
        if (EventBus) {
          EventBus.emit(existed ? 'vfs:write' : 'artifact:created', { path });
        }

        // Audit log with before/after
        if (AuditLogger) {
          await AuditLogger.logEvent('FILE_WRITE', {
            path,
            existed,
            bytesWritten: content.length,
            bytesBefore: beforeContent?.length || 0,
            isCore,
            arenaVerified: isCore && _arenaGatingEnabled
          }, isCore ? 'WARN' : 'INFO');
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

        // Capture before state for audit
        const beforeContent = await VFS.read(path).catch(() => null);

        await VFS.delete(path);

        // Emit event for UI to show deletion with strikethrough
        if (EventBus) {
          EventBus.emit('artifact:deleted', { path });
        }

        // Audit log deletion
        if (AuditLogger) {
          const isCore = path.startsWith('/core/');
          await AuditLogger.logEvent('FILE_DELETE', {
            path,
            bytesBefore: beforeContent?.length || 0,
            isCore
          }, isCore ? 'WARN' : 'INFO');
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
      const startTime = Date.now();

      try {
        const result = await toolFn(args, { VFS }); // Inject VFS for tools like code_intel

        // Audit log successful execution
        if (AuditLogger) {
          await AuditLogger.logEvent('TOOL_EXEC', {
            tool: name,
            args: _sanitizeArgs(args),
            durationMs: Date.now() - startTime,
            success: true
          });
        }

        return result;
      } catch (err) {
        logger.error(`[ToolRunner] Error in ${name}`, err);

        // Audit log failed execution
        if (AuditLogger) {
          await AuditLogger.logEvent('TOOL_EXEC', {
            tool: name,
            args: _sanitizeArgs(args),
            durationMs: Date.now() - startTime,
            success: false,
            error: err.message
          }, 'ERROR');
        }

        const errorWithContext = new Errors.ToolError(err.message, { tool: name, args });
        errorWithContext.stack = err.stack; // Preserve original stack trace
        throw errorWithContext;
      }
    };

    // Sanitize args for logging (truncate large content)
    const _sanitizeArgs = (args) => {
      const sanitized = {};
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string' && value.length > 200) {
          sanitized[key] = value.substring(0, 200) + `... (${value.length} chars)`;
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };

    // Arena gating control
    const setArenaGating = (enabled) => {
      _arenaGatingEnabled = !!enabled;
      try {
        localStorage.setItem('REPLOID_ARENA_GATING', String(_arenaGatingEnabled));
      } catch (e) { /* ignore */ }
      logger.info(`[ToolRunner] Arena gating ${_arenaGatingEnabled ? 'enabled' : 'disabled'}`);
      if (EventBus) {
        EventBus.emit('toolrunner:arena_gating', { enabled: _arenaGatingEnabled });
      }
    };

    const isArenaGatingEnabled = () => _arenaGatingEnabled;

    return {
      init: loadDynamicTools,
      execute,
      refresh: loadDynamicTools,
      list: () => Array.from(_tools.keys()),
      has: (name) => _tools.has(name),
      setArenaGating,
      isArenaGatingEnabled
    };
  }
};

export default ToolRunner;
