/**
 * @fileoverview Tool Runner
 * Execution engine for built-in and dynamic tools.
 */

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'ToolWriter', 'SubstrateLoader?', 'EventBus', 'AuditLogger?', 'HITLController?', 'ArenaHarness?', 'VFSSandbox?', 'VerificationManager?', 'Shell?', 'gitTools?', 'WorkerManager?', 'EmbeddingStore?', 'SemanticMemory?', 'KnowledgeGraph?', 'SchemaRegistry'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, ToolWriter, SubstrateLoader, EventBus, AuditLogger, HITLController, ArenaHarness, VFSSandbox, VerificationManager, Shell, gitTools, WorkerManager, EmbeddingStore, SemanticMemory, KnowledgeGraph, SchemaRegistry } = deps;
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

    // All tools are now dynamic (loaded from /tools/)
    // No hardcoded built-ins - full RSI capability

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

          // Capture schema from dynamic tool if available
          if (mod.tool?.inputSchema || mod.tool?.description) {
            SchemaRegistry.registerToolSchema(name, {
              description: mod.tool.description || `Dynamic tool: ${name}`,
              parameters: mod.tool.inputSchema || { type: 'object', properties: {} }
            });
          }

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
        SchemaRegistry.unregisterToolSchema(name);
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

    /**
     * Execute a tool with optional permission filtering (for workers)
     * @param {string} name - Tool name
     * @param {Object} args - Tool arguments
     * @param {Object} [options] - Execution options
     * @param {string[]|'*'} [options.allowedTools] - Allowed tools filter ('*' = all)
     * @param {string} [options.workerId] - Worker ID for audit logging
     */
    const execute = async (name, args = {}, options = {}) => {
      const { allowedTools, workerId } = options;

      // Permission check for worker execution
      if (allowedTools && allowedTools !== '*') {
        if (!allowedTools.includes(name)) {
          const error = new Errors.ToolError(`Tool '${name}' not permitted for this worker type`);
          if (AuditLogger) {
            await AuditLogger.logEvent('TOOL_PERMISSION_DENIED', {
              tool: name,
              workerId,
              allowedTools
            }, 'WARN');
          }
          throw error;
        }
      }
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

      // HITL approval check for critical tools
      if (_requiresApproval(name)) {
        logger.info(`[ToolRunner] Requesting HITL approval for ${name}`);
        const approved = await _requestApproval(name, args);
        if (!approved) {
          if (AuditLogger) {
            await AuditLogger.logEvent('TOOL_REJECTED', {
              tool: name,
              args: _sanitizeArgs(args),
              reason: 'User rejected via HITL'
            }, 'WARN');
          }
          return { error: 'Operation rejected by user', rejected: true };
        }
      }

      logger.info(`[ToolRunner] Executing ${name}`);
      const startTime = Date.now();

      try {
        // Get TransformersClient from global (pre-resolved in boot.js)
        const TransformersClient = window.REPLOID?.transformersClient || null;

        // Inject comprehensive deps for full RSI capability
        const toolDeps = {
          Utils,
          VFS,
          Shell,
          gitTools,
          EventBus,
          AuditLogger,
          ToolWriter,
          SubstrateLoader,
          VFSSandbox,
          VerificationManager,
          WorkerManager,
          TransformersClient,
          EmbeddingStore,
          SemanticMemory,
          KnowledgeGraph,
          ToolRunner: { list: () => Array.from(_tools.keys()), execute, has: (n) => _tools.has(n) }
        };
        const result = await toolFn(args, toolDeps);

        // Audit log successful execution
        if (AuditLogger) {
          await AuditLogger.logEvent('TOOL_EXEC', {
            tool: name,
            args: _sanitizeArgs(args),
            durationMs: Date.now() - startTime,
            success: true,
            ...(workerId && { workerId })
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
            error: err.message,
            ...(workerId && { workerId })
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

    // Critical tools that require HITL approval
    const CRITICAL_TOOLS = ['WriteFile', 'DeleteFile', 'CreateTool', 'Edit', 'LoadModule'];

    /**
     * Check if tool requires HITL approval
     * @param {string} toolName - Tool name
     * @returns {boolean}
     */
    const _requiresApproval = (toolName) => {
      if (!HITLController) return false;
      const state = HITLController.getState();
      const mode = state?.approvalMode || 'autonomous';
      if (mode === 'autonomous') return false;
      return CRITICAL_TOOLS.includes(toolName);
    };

    /**
     * Request HITL approval for a tool execution
     * @param {string} toolName - Tool name
     * @param {Object} args - Tool arguments
     * @returns {Promise<boolean>} - True if approved
     */
    const _requestApproval = async (toolName, args) => {
      if (!HITLController) return true;

      return new Promise((resolve) => {
        const approvalId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        HITLController.requestApproval({
          id: approvalId,
          moduleId: 'ToolRunner',
          capability: 'APPROVE_TOOL_EXECUTION',
          action: toolName,
          data: { tool: toolName, args: _sanitizeArgs(args) },
          onApprove: () => resolve(true),
          onReject: (reason) => {
            logger.info(`[ToolRunner] Tool ${toolName} rejected: ${reason}`);
            resolve(false);
          },
          timeout: 300000 // 5 minute timeout
        });
      });
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

    /**
     * Get tool schemas for native tool calling (OpenAI format)
     * @returns {Array<{type: string, function: {name: string, description: string, parameters: object}}>}
     */
    const getToolSchemas = () => {
      const schemas = [];

      for (const [name] of _tools) {
        // Check dynamic schema first, then built-in
        const schema = SchemaRegistry.getToolSchema(name);
        if (schema) {
          schemas.push({
            type: 'function',
            function: {
              name,
              description: schema.description,
              parameters: schema.parameters
            }
          });
        }
      }

      return schemas;
    };

    /**
     * Get filtered list of tools based on allowed tools
     * @param {string[]|'*'} allowedTools - Allowed tools ('*' = all)
     * @returns {string[]} - List of tool names
     */
    const listFiltered = (allowedTools) => {
      const allTools = Array.from(_tools.keys());
      if (allowedTools === '*') return allTools;
      return allTools.filter(name => allowedTools.includes(name));
    };

    /**
     * Get filtered tool schemas for worker (OpenAI format)
     * @param {string[]|'*'} allowedTools - Allowed tools ('*' = all)
     * @returns {Array} - Filtered schemas
     */
    const getToolSchemasFiltered = (allowedTools) => {
      const schemas = getToolSchemas();
      if (allowedTools === '*') return schemas;
      return schemas.filter(s => allowedTools.includes(s.function.name));
    };

    return {
      init: loadDynamicTools,
      execute,
      refresh: loadDynamicTools,
      list: () => Array.from(_tools.keys()),
      listFiltered,
      has: (name) => _tools.has(name),
      setArenaGating,
      isArenaGatingEnabled,
      getToolSchemas,
      getToolSchemasFiltered
    };
  }
};

export default ToolRunner;
