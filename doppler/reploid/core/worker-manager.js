/**
 * @fileoverview Worker Manager
 * Spawns and manages isolated Web Worker agents for parallel task execution.
 * Part of the "Brains + Muscles" architecture:
 * - Brains: Multiple models for quality (Arena mode)
 * - Muscles: Multiple workers for speed (this module)
 */

const WorkerManager = {
  metadata: {
    id: 'WorkerManager',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    files: ['core/worker-manager.js', 'core/worker-agent.js'],
    dependencies: ['Utils', 'VFS', 'LLMClient', 'ToolRunner', 'ResponseParser', 'EventBus', 'AuditLogger?', 'SchemaRegistry?'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils, VFS, LLMClient, ToolRunner, ResponseParser, EventBus, AuditLogger, SchemaRegistry } = deps;
    const { logger } = Utils;

    const WORKERS_DIR = '/.system/workers';
    const MAX_COMPLETED_WORKERS = 100;  // Prevent unbounded memory growth
    const _activeWorkers = new Map();
    const _completedWorkers = new Map();
    const _maxConcurrentWorkers = 10;
    let _workerConfig = null;
    let _modelConfig = null; // Default model config for workers
    let _modelRoles = null; // Role-based model configs (fast, code, orchestrator, local)

    /**
     * Persist worker state to VFS
     * @private
     */
    const _persistWorker = async (workerId, data) => {
      if (!VFS) return;
      try {
        const path = `${WORKERS_DIR}/${workerId}.json`;
        await VFS.write(path, JSON.stringify(data, null, 2));
      } catch (e) {
        logger.warn(`[WorkerManager] Failed to persist worker ${workerId}:`, e.message);
      }
    };

    /**
     * Load persisted workers from VFS on init
     * @private
     */
    const _loadPersistedWorkers = async () => {
      if (!VFS) return;
      try {
        const files = await VFS.list(WORKERS_DIR);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const content = await VFS.read(file);
            const data = JSON.parse(content);
            if (data.workerId && data.status !== 'running') {
              // Only restore completed/error/terminated workers
              _completedWorkers.set(data.workerId, data);
            }
          } catch (e) {
            // Skip invalid files
          }
        }
        if (_completedWorkers.size > 0) {
          logger.info(`[WorkerManager] Loaded ${_completedWorkers.size} persisted workers from VFS`);
        }
      } catch (e) {
        // Directory may not exist yet
      }
    };

    /**
     * Initialize with worker type configuration
     * @param {Object} config - Config from genesis-levels.json (workerTypes, modelRoles)
     * @param {Object} [modelConfig] - Default model configuration for workers
     */
    const init = async (config, modelConfig = null) => {
      _workerConfig = config?.workerTypes || {};
      _modelRoles = config?.modelRoles || {};
      _modelConfig = modelConfig;
      if (SchemaRegistry && _workerConfig) {
        SchemaRegistry.registerWorkerTypes(_workerConfig, { builtin: true });
      }
      // Load persisted workers from VFS
      await _loadPersistedWorkers();

      // Update ToolRunner's WorkerManager reference (circular dependency workaround)
      // ToolRunner initializes before WorkerManager, so it has undefined WorkerManager
      // We need to update it so SpawnWorker tool can access WorkerManager
      if (ToolRunner?.setWorkerManager) {
        ToolRunner.setWorkerManager(api);
      }

      logger.info('[WorkerManager] Initialized with worker types:', Object.keys(_workerConfig));
      logger.info('[WorkerManager] Model roles available:', Object.keys(_modelRoles));
      return true;
    };

    /**
     * Set the default model config for workers
     */
    const setModelConfig = (modelConfig) => {
      _modelConfig = modelConfig;
    };

    /**
     * Set model configs for specific roles
     * @param {Object} roleConfigs - Map of role name to model config
     *   e.g., { fast: {...geminiConfig}, code: {...codestralConfig} }
     */
    const setModelRoles = (roleConfigs) => {
      _modelRoles = { ..._modelRoles, ...roleConfigs };
      logger.info('[WorkerManager] Updated model roles:', Object.keys(_modelRoles).filter(k => _modelRoles[k]?.config));
    };

    /**
     * Resolve a model role to actual model config
     * @param {string} role - Role name (fast, code, orchestrator, local) or null for default
     * @returns {Object} Model config to use
     */
    const _resolveModelConfig = (role) => {
      // If role specified and we have a config for it, use that
      if (role && _modelRoles?.[role]?.config) {
        logger.info(`[WorkerManager] Using model role '${role}': ${_modelRoles[role].config.id}`);
        return _modelRoles[role].config;
      }
      // Fall back to default model config
      return _modelConfig;
    };

    /**
     * Get allowed tools for a worker type
     * @param {string} type - Worker type (explore, analyze, execute)
     * @returns {string[]|'*'} - List of allowed tool names or '*' for all
     */
    const _getWorkerDefinition = (type) => {
      const schemaDef = SchemaRegistry?.getWorkerType(type);
      if (schemaDef) return schemaDef;
      return _workerConfig?.[type] || null;
    };

    const getToolsForType = (type) => {
      let workerType = _getWorkerDefinition(type);
      if (!workerType) {
        logger.warn(`[WorkerManager] Unknown worker type: ${type}, defaulting to explore`);
        workerType = _getWorkerDefinition('explore');
      }
      return workerType?.tools || [];
    };

    /**
     * Check if a tool is allowed for a worker type
     * @param {string} type - Worker type
     * @param {string} toolName - Tool to check
     * @returns {boolean}
     */
    const isToolAllowed = (type, toolName) => {
      const allowedTools = getToolsForType(type);
      if (allowedTools === '*') return true;
      return allowedTools.includes(toolName);
    };

    /**
     * Generate unique worker ID
     */
    const _generateWorkerId = () => {
      return `worker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    };

    /**
     * Spawn a new worker agent
     * @param {Object} options
     * @param {string} options.type - Worker type (explore, analyze, execute)
     * @param {string} options.task - Task description for the worker
     * @param {string} [options.model] - Optional model override
     * @param {number} [options.maxIterations] - Optional iteration cap
     * @param {number} [options.depth=0] - Current nesting depth (0 = main agent)
     * @returns {Promise<{workerId: string, promise: Promise}>}
     */
    const spawn = async ({ type, task, model, maxIterations, depth = 0 }) => {
      // Enforce flat hierarchy - workers cannot spawn workers
      if (depth > 0) {
        throw new Error('Workers cannot spawn other workers (flat hierarchy enforced)');
      }

      // Check concurrent limit
      if (_activeWorkers.size >= _maxConcurrentWorkers) {
        throw new Error(`Maximum concurrent workers (${_maxConcurrentWorkers}) reached`);
      }

      const workerId = _generateWorkerId();
      const workerType = _workerConfig[type] || _workerConfig.explore;
      const allowedTools = workerType?.tools || [];

      logger.info(`[WorkerManager] Spawning ${type} worker: ${workerId}`);
      logger.info(`[WorkerManager] Task: ${task.substring(0, 100)}...`);

      // Audit log spawn
      if (AuditLogger) {
        await AuditLogger.logEvent('WORKER_SPAWN', {
          workerId,
          type,
          task: task.substring(0, 200),
          allowedTools: allowedTools === '*' ? 'ALL' : allowedTools.length
        });
      }

      // Emit event for UI
      if (EventBus) {
        EventBus.emit('worker:spawned', { workerId, type, task });
      }

      // Create the worker execution promise
      const workerPromise = _executeWorker({
        workerId,
        type,
        task,
        model: model || workerType?.defaultModelRole || 'fast',
        allowedTools,
        maxIterations,
        depth: depth + 1
      });

      // Track active worker
      const startTime = Date.now();
      const workerRecord = {
        workerId,
        type,
        task,
        startTime,
        status: 'running',
        logs: []
      };
      _activeWorkers.set(workerId, {
        ...workerRecord,
        promise: workerPromise
      });

      // Persist initial worker state
      _persistWorker(workerId, workerRecord);

      // Handle completion
      workerPromise
        .then(result => {
          const workerData = _activeWorkers.get(workerId);
          _activeWorkers.delete(workerId);
          const completedRecord = {
            workerId,
            type,
            task,
            startTime: workerData?.startTime || startTime,
            status: 'completed',
            result,
            logs: workerData?.logs || [],
            completedTime: Date.now(),
            duration: Date.now() - (workerData?.startTime || startTime)
          };
          _completedWorkers.set(workerId, completedRecord);
          // Evict oldest if over limit (LRU)
          if (_completedWorkers.size > MAX_COMPLETED_WORKERS) {
            const oldestKey = _completedWorkers.keys().next().value;
            _completedWorkers.delete(oldestKey);
          }
          _persistWorker(workerId, completedRecord);
          if (EventBus) {
            EventBus.emit('worker:completed', { workerId, result });
          }
        })
        .catch(error => {
          const workerData = _activeWorkers.get(workerId);
          _activeWorkers.delete(workerId);
          const errorRecord = {
            workerId,
            type,
            task,
            startTime: workerData?.startTime || startTime,
            status: 'error',
            error: error.message,
            logs: workerData?.logs || [],
            completedTime: Date.now(),
            duration: Date.now() - (workerData?.startTime || startTime)
          };
          _completedWorkers.set(workerId, errorRecord);
          // Evict oldest if over limit (LRU)
          if (_completedWorkers.size > MAX_COMPLETED_WORKERS) {
            const oldestKey = _completedWorkers.keys().next().value;
            _completedWorkers.delete(oldestKey);
          }
          _persistWorker(workerId, errorRecord);
          if (EventBus) {
            EventBus.emit('worker:error', { workerId, error: error.message });
          }
        });

      return { workerId, promise: workerPromise };
    };

    /**
     * Execute worker with Promise-based isolation (main thread)
     * For true Web Worker isolation, see worker-agent.js (future)
     * @private
     */
    const _executeWorker = async ({ workerId, type, task, model, allowedTools, maxIterations = 10, depth }) => {
      const startTime = Date.now();
      let iterations = 0;
      const toolResults = [];

      logger.info(`[WorkerManager] Worker ${workerId} starting execution...`);
      logger.info(`[WorkerManager] Model role: ${model || 'default'}`);
      logger.info(`[WorkerManager] Allowed tools: ${allowedTools === '*' ? 'ALL' : allowedTools.join(', ')}`);

      // Resolve model role to actual config
      const resolvedModelConfig = _resolveModelConfig(model);

      // Check if we have a model config
      if (!resolvedModelConfig) {
        logger.warn(`[WorkerManager] No model config available for role '${model}', returning without LLM call`);
        return {
          workerId,
          type,
          status: 'completed',
          output: `Worker ${workerId} task received but no model configured. Task: ${task}`,
          iterations: 0,
          duration: Date.now() - startTime
        };
      }

      // Create worker system prompt
      const workerSystemPrompt = `You are a worker agent (type: ${type}) executing a specific task.
Your task: ${task}

You have access to the following tools: ${allowedTools === '*' ? 'ALL TOOLS' : allowedTools.join(', ')}

Important:
- Focus only on completing your assigned task
- Return your findings/results clearly
- Do not spawn other workers
- When done, provide a clear summary of your results

Available tool format:
TOOL_CALL: ToolName
ARGS: {"arg": "value"}`;

      // Initialize messages for this worker (fresh context)
      const messages = [
        { role: 'system', content: workerSystemPrompt },
        { role: 'user', content: `Please complete this task: ${task}` }
      ];

      // Get filtered tool schemas
      const toolSchemas = ToolRunner.getToolSchemasFiltered(allowedTools);

      // Track consecutive single-tool calls for nudging
      let consecutiveSingleToolCalls = 0;
      const SINGLE_TOOL_NUDGE_THRESHOLD = 3;

      try {
        // Simple agent loop
        while (iterations < maxIterations) {
          iterations++;

          // Report progress
          if (EventBus) {
            EventBus.emit('worker:progress', {
              workerId,
              iteration: iterations,
              maxIterations,
              message: `Iteration ${iterations}/${maxIterations}`
            });
          }

          // Make LLM call
          logger.info(`[WorkerManager] Worker ${workerId} iteration ${iterations}`);
          const response = await LLMClient.chat(messages, resolvedModelConfig, null, { tools: toolSchemas });

          // Add assistant response to messages
          messages.push({ role: 'assistant', content: response.content });

          // Check for native tool calls (OpenAI format)
          if (response.toolCalls?.length > 0) {
            for (const tc of response.toolCalls) {
              logger.info(`[WorkerManager] Worker ${workerId} native tool call: ${tc.name}`);
              try {
                const result = await ToolRunner.execute(tc.name, tc.args, {
                  allowedTools,
                  workerId
                });
                toolResults.push({ tool: tc.name, args: tc.args, result, success: true });
                messages.push({
                  role: 'user',
                  content: `TOOL_RESULT for ${tc.name}: ${JSON.stringify(result)}`
                });
              } catch (err) {
                toolResults.push({ tool: tc.name, args: tc.args, error: err.message, success: false });
                messages.push({
                  role: 'user',
                  content: `TOOL_ERROR for ${tc.name}: ${err.message}`
                });
              }
            }
            // Track single-tool calls and nudge
            if (response.toolCalls.length === 1) {
              consecutiveSingleToolCalls++;
              if (consecutiveSingleToolCalls >= SINGLE_TOOL_NUDGE_THRESHOLD) {
                messages.push({
                  role: 'user',
                  content: 'TIP: You can batch multiple independent tool calls in a single response. Read-only tools (ReadFile, ListFiles, Grep, Find) run in parallel for better efficiency.'
                });
                consecutiveSingleToolCalls = 0;
              }
            } else {
              consecutiveSingleToolCalls = 0;
            }
            continue; // Continue loop to process tool results
          }

          // Parse text-based tool calls
          const toolCalls = ResponseParser.parseToolCalls(response.content);

          if (toolCalls?.length > 0) {
            for (const tc of toolCalls) {
              logger.info(`[WorkerManager] Worker ${workerId} text tool call: ${tc.name}`);
              try {
                const result = await ToolRunner.execute(tc.name, tc.args, {
                  allowedTools,
                  workerId
                });
                toolResults.push({ tool: tc.name, args: tc.args, result, success: true });
                messages.push({
                  role: 'user',
                  content: `TOOL_RESULT for ${tc.name}: ${JSON.stringify(result)}`
                });
              } catch (err) {
                toolResults.push({ tool: tc.name, args: tc.args, error: err.message, success: false });
                messages.push({
                  role: 'user',
                  content: `TOOL_ERROR for ${tc.name}: ${err.message}`
                });
              }
            }
            // Track single-tool calls and nudge
            if (toolCalls.length === 1) {
              consecutiveSingleToolCalls++;
              if (consecutiveSingleToolCalls >= SINGLE_TOOL_NUDGE_THRESHOLD) {
                messages.push({
                  role: 'user',
                  content: 'TIP: You can batch multiple independent tool calls in a single response. Read-only tools (ReadFile, ListFiles, Grep, Find) run in parallel for better efficiency.'
                });
                consecutiveSingleToolCalls = 0;
              }
            } else {
              consecutiveSingleToolCalls = 0;
            }
            continue; // Continue loop to process tool results
          }

          // No tool calls - worker is done
          logger.info(`[WorkerManager] Worker ${workerId} completed after ${iterations} iterations`);
          break;
        }

        // Extract final output from last assistant message
        const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();
        const finalOutput = lastAssistantMsg?.content || 'No output';

        return {
          workerId,
          type,
          task: task.substring(0, 200),
          status: 'completed',
          output: finalOutput,
          iterations,
          toolResults,
          duration: Date.now() - startTime
        };

      } catch (error) {
        logger.error(`[WorkerManager] Worker ${workerId} error:`, error.message);
        return {
          workerId,
          type,
          task: task.substring(0, 200),
          status: 'error',
          error: error.message,
          iterations,
          toolResults,
          duration: Date.now() - startTime
        };
      }
    };

    /**
     * List all active workers
     * @returns {Array<{workerId: string, type: string, task: string, status: string}>}
     */
    const list = () => {
      return Array.from(_activeWorkers.entries()).map(([workerId, data]) => ({
        workerId,
        type: data.type,
        task: data.task.substring(0, 100),
        status: data.status,
        runningFor: Date.now() - data.startTime
      }));
    };

    /**
     * Await completion of specific workers or all workers
     * @param {Object} options
     * @param {string[]} [options.workerIds] - Specific workers to await
     * @param {boolean} [options.all] - Await all active workers
     * @returns {Promise<Object[]>} - Results from all awaited workers
     */
    const awaitWorkers = async ({ workerIds, all }) => {
      let workersToAwait;

      if (all) {
        workersToAwait = Array.from(_activeWorkers.entries());
      } else if (workerIds) {
        workersToAwait = workerIds
          .filter(id => _activeWorkers.has(id))
          .map(id => [id, _activeWorkers.get(id)]);
      } else {
        return [];
      }

      logger.info(`[WorkerManager] Awaiting ${workersToAwait.length} workers...`);

      const results = await Promise.allSettled(
        workersToAwait.map(([id, data]) => data.promise)
      );

      return results.map((result, i) => ({
        workerId: workersToAwait[i][0],
        status: result.status,
        value: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason?.message : null
      }));
    };

    /**
     * Add a log entry to a worker
     * @param {string} workerId
     * @param {string} message
     */
    const addLog = (workerId, message) => {
      const worker = _activeWorkers.get(workerId);
      if (worker) {
        const logEntry = { timestamp: Date.now(), message };
        worker.logs = worker.logs || [];
        worker.logs.push(logEntry);
        // Persist with updated logs
        _persistWorker(workerId, {
          workerId,
          type: worker.type,
          task: worker.task,
          startTime: worker.startTime,
          status: worker.status,
          logs: worker.logs
        });
      }
    };

    /**
     * Terminate a specific worker
     * @param {string} workerId
     */
    const terminate = (workerId) => {
      const worker = _activeWorkers.get(workerId);
      if (worker) {
        logger.info(`[WorkerManager] Terminating worker: ${workerId}`);
        // TODO: Actually terminate the Web Worker in Phase 3
        _activeWorkers.delete(workerId);
        const terminatedRecord = {
          workerId,
          type: worker.type,
          task: worker.task,
          startTime: worker.startTime,
          status: 'terminated',
          logs: worker.logs || [],
          completedTime: Date.now(),
          duration: Date.now() - worker.startTime
        };
        _completedWorkers.set(workerId, terminatedRecord);
        _persistWorker(workerId, terminatedRecord);
        if (EventBus) {
          EventBus.emit('worker:terminated', { workerId });
        }
        return true;
      }
      return false;
    };

    /**
     * Get completed worker results
     * @param {string} [workerId] - Specific worker or all if not provided
     */
    const getResults = (workerId) => {
      if (workerId) {
        return _completedWorkers.get(workerId);
      }
      return Array.from(_completedWorkers.entries()).map(([id, data]) => ({
        workerId: id,
        ...data
      }));
    };

    /**
     * Clear completed worker history (also deletes from VFS)
     */
    const clearHistory = async () => {
      // Delete files from VFS
      if (VFS) {
        for (const workerId of _completedWorkers.keys()) {
          try {
            await VFS.delete(`${WORKERS_DIR}/${workerId}.json`);
          } catch (e) {
            // Ignore deletion errors
          }
        }
      }
      _completedWorkers.clear();
    };

    // Create API object so we can reference it in init for circular dependency fix
    const api = {
      init,
      setModelConfig,
      setModelRoles,
      spawn,
      list,
      awaitWorkers,
      terminate,
      addLog,
      getResults,
      clearHistory,
      getToolsForType,
      isToolAllowed
    };

    return api;
  }
};

export default WorkerManager;
