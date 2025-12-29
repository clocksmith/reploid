/**
 * @fileoverview Tool Runner
 * Execution engine for built-in and dynamic tools.
 */

import { loadVfsModule } from './vfs-module-loader.js';

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '1.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'VFS', 'ToolWriter', 'SubstrateLoader?', 'EventBus', 'AuditLogger?', 'HITLController?', 'ArenaHarness?', 'VFSSandbox?', 'VerificationManager?', 'Shell?', 'gitTools?', 'WorkerManager?', 'EmbeddingStore?', 'SemanticMemory?', 'KnowledgeGraph?', 'GEPAOptimizer?', 'SchemaRegistry', 'TraceStore?', 'PersonaManager?', 'Observability?', 'GenesisSnapshot?'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, ToolWriter, SubstrateLoader, EventBus, AuditLogger, HITLController, ArenaHarness, VFSSandbox, VerificationManager, Shell, gitTools, EmbeddingStore, SemanticMemory, KnowledgeGraph, GEPAOptimizer, SchemaRegistry, TraceStore, PersonaManager, Observability, GenesisSnapshot } = deps;
    const { logger, Errors, trunc } = Utils;

    // WorkerManager is mutable because of circular dependency:
    // ToolRunner -> WorkerManager? (optional) -> ToolRunner
    // WorkerManager initializes AFTER ToolRunner, so we need to update the reference later
    let _workerManager = deps.WorkerManager || null;

    // Arena verification for self-modification (opt-in via config)
    let _arenaGatingEnabled = false;
    try {
      const saved = localStorage.getItem('REPLOID_ARENA_GATING');
      _arenaGatingEnabled = saved === 'true';
    } catch (e) { /* ignore */ }

    const _tools = new Map();
    const _dynamicTools = new Set();

    // Schema cache for performance (#3)
    let _schemaCache = null;
    let _schemaCacheVersion = 0;
    let _toolsVersion = 0;

    const invalidateSchemaCache = () => {
      _toolsVersion++;
      _schemaCache = null;
    };

    // --- Arena Verification for Core Changes ---

    // L3 substrate paths that require arena verification
    const SUBSTRATE_PREFIXES = ['/core/', '/infrastructure/'];

    const isSubstratePath = (path) => {
      if (!path) return false;
      return SUBSTRATE_PREFIXES.some(prefix => path.startsWith(prefix));
    };

    /**
     * Verify a core file change in sandbox before committing
     * @param {string} path - File path
     * @param {string} content - New content
     * @returns {Promise<{passed: boolean, errors: string[], rolledBack: boolean}>}
     */
    const _verifyCoreMutation = async (path, content) => {
      const isL3 = isSubstratePath(path);

      // Skip verification if arena/verification not available or disabled
      if (!_arenaGatingEnabled || !VFSSandbox || !VerificationManager) {
        // Still log L3 changes even if verification is skipped
        if (isL3 && Observability?.recordSubstrateChange) {
          await Observability.recordSubstrateChange({
            path,
            op: 'write',
            passed: true,
            passRate: null,
            rolledBack: false,
            reason: 'verification_skipped'
          });
        }
        return { passed: true, errors: [], skipped: true, rolledBack: false };
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
          const passed = result.passed && (result.passRate === undefined || result.passRate >= 80);

          // Log L3 substrate changes
          if (isL3 && Observability?.recordSubstrateChange) {
            await Observability.recordSubstrateChange({
              path,
              op: 'write',
              passed,
              passRate: result.passRate,
              rolledBack: !passed,
              reason: passed ? 'verified' : (result.errors?.[0] || 'verification_failed')
            });
          }

          if (!passed) {
            logger.warn(`[ToolRunner] L3 change rejected: ${path} (passRate: ${result.passRate})`);
            // Rollback is automatic via finally block
          }

          return {
            passed,
            errors: result.errors || [],
            warnings: result.warnings || [],
            passRate: result.passRate,
            rolledBack: !passed
          };
        } finally {
          // Always restore original state (sandbox isolation)
          await VFSSandbox.restoreSnapshot(snapshot);
        }
      } catch (err) {
        logger.error('[ToolRunner] Arena verification failed:', err.message);

        // Log failed L3 change
        if (isL3 && Observability?.recordSubstrateChange) {
          await Observability.recordSubstrateChange({
            path,
            op: 'write',
            passed: false,
            passRate: null,
            rolledBack: true,
            reason: err.message
          });
        }

        // Emergency rollback via GenesisSnapshot if available
        if (GenesisSnapshot?.restoreFromLifeboat) {
          logger.warn('[ToolRunner] Attempting Lifeboat restore after verification failure');
          try {
            await GenesisSnapshot.restoreFromLifeboat();
          } catch (e) {
            logger.error('[ToolRunner] Lifeboat restore failed:', e.message);
          }
        }

        return { passed: false, errors: [err.message], rolledBack: true };
      }
    };

    // All tools are now dynamic (loaded from /tools/)
    // No hardcoded built-ins - full RSI capability

    const loadToolModule = async (path, forcedName = null) => {
      try {
        const mod = await loadVfsModule({
          VFS,
          logger,
          VerificationManager,
          path
        });
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
        invalidateSchemaCache(); // Invalidate cache when tools change

        // Capture schema from dynamic tool if available
        if (mod.tool?.inputSchema || mod.tool?.description) {
          SchemaRegistry.registerToolSchema(name, {
            description: mod.tool.description || `Dynamic tool: ${name}`,
            parameters: mod.tool.inputSchema || { type: 'object', properties: {} }
          });
        }

        logger.info(`[ToolRunner] Loaded dynamic tool: ${name}`);
        return true;
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
      const trace = options.trace || null;
      const traceSessionId = trace?.sessionId;
      const skipTrace = trace?.skipRunner;

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
          WorkerManager: _workerManager, // Use mutable reference (updated after init)
          TransformersClient,
          EmbeddingStore,
          SemanticMemory,
          KnowledgeGraph,
          PersonaManager,
          ToolRunner: { list: () => Array.from(_tools.keys()), execute, has: (n) => _tools.has(n) }
        };
        if (name === 'RunGEPA') {
          toolDeps.GEPAOptimizer = GEPAOptimizer;
        }
        const result = await toolFn(args, toolDeps);

        if (TraceStore && traceSessionId && !skipTrace) {
          let resultPreview = '';
          if (typeof result === 'string') {
            resultPreview = trunc(result, 2000);
          } else {
            try {
              resultPreview = trunc(JSON.stringify(result), 2000);
            } catch {
              resultPreview = '[Unserializable result]';
            }
          }
          await TraceStore.record(traceSessionId, 'tool:execute', {
            tool: name,
            args: _sanitizeArgs(args),
            durationMs: Date.now() - startTime,
            success: true,
            workerId,
            resultPreview
          }, { tags: ['tool'] });
        }

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

        if (TraceStore && traceSessionId && !skipTrace) {
          await TraceStore.record(traceSessionId, 'tool:execute', {
            tool: name,
            args: _sanitizeArgs(args),
            durationMs: Date.now() - startTime,
            success: false,
            workerId,
            error: err.message
          }, { tags: ['tool', 'error'] });
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
      const mode = state?.config?.approvalMode || 'autonomous';
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
     * Uses caching for performance - invalidated when tools change
     * @returns {Array<{type: string, function: {name: string, description: string, parameters: object}}>}
     */
    const getToolSchemas = () => {
      // Return cached if valid
      if (_schemaCache && _schemaCacheVersion === _toolsVersion) {
        return _schemaCache;
      }

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

      // Cache the result
      _schemaCache = schemas;
      _schemaCacheVersion = _toolsVersion;
      logger.debug(`[ToolRunner] Schema cache built: ${schemas.length} tools`);

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
      getToolSchemasFiltered,
      // Setter for late-bound WorkerManager (circular dependency workaround)
      setWorkerManager: (wm) => {
        _workerManager = wm;
        logger.debug('[ToolRunner] WorkerManager reference updated');
      }
    };
  }
};

export default ToolRunner;
