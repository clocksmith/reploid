/**
 * @fileoverview FunctionGemma Orchestrator
 * Coordinates Doppler multi-model networks with Reploid routing and scoring.
 */

const FunctionGemmaOrchestrator = {
  metadata: {
    id: 'FunctionGemmaOrchestrator',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: [
      'Utils',
      'EventBus?',
      'SemanticMemory?',
      'ArenaHarness?',
      'ContextManager?',
      'SchemaRegistry?',
      'ReflectionStore?',
      'VFS'
    ],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, SemanticMemory, ArenaHarness, ContextManager, SchemaRegistry, ReflectionStore, VFS } = deps;
    const { logger, Errors } = Utils;

    let _imports = null;
    let _loader = null;
    let _network = null;
    let _pool = null;
    let _baseModelId = null;
    let _baseManifest = null;
    let _sharedPrefix = null;
    const _routingStats = { samples: [], lastMs: null, maxSamples: 100 };
    const _errorStats = { failures: 0, lastError: null };
    const _expertPromptIds = new Set();

    const nowMs = () => (
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    );

    const recordRoutingLatency = (ms, meta = {}) => {
      if (!Number.isFinite(ms)) return;
      _routingStats.lastMs = ms;
      _routingStats.samples.push(ms);
      if (_routingStats.samples.length > _routingStats.maxSamples) {
        _routingStats.samples.shift();
      }

      if (EventBus) {
        EventBus.emit('functiongemma:routing:latency', {
          ms,
          taskType: meta.taskType || null,
          topK: meta.topK || null
        });
      }
    };

    const summarizeLatency = (samples) => {
      if (!samples || samples.length === 0) {
        return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, value) => acc + value, 0);
      const percentile = (p) => {
        const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
        return sorted[idx];
      };
      return {
        count: sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / sorted.length,
        p50: percentile(0.5),
        p95: percentile(0.95)
      };
    };

    const recordError = (stage, err, meta = {}) => {
      _errorStats.failures += 1;
      _errorStats.lastError = {
        stage,
        message: err?.message || String(err),
        timestamp: Date.now()
      };

      if (EventBus) {
        EventBus.emit('functiongemma:error', {
          stage,
          message: _errorStats.lastError.message,
          taskType: meta.taskType || null
        });
      }
    };

    const getExpertContext = (expertId) => {
      if (ContextManager?.getExpertContext) {
        return ContextManager.getExpertContext(expertId);
      }
      return {
        prefix: _sharedPrefix,
        expertPrompt: '',
        hasCachedPrefix: !!_sharedPrefix
      };
    };

    const applyExpertContext = (expertId, prompt, options = {}) => {
      const context = getExpertContext(expertId);
      if (context?.prefix && context.prefix !== _sharedPrefix) {
        setSharedPrefix(context.prefix);
      }

      const expertPrompt = context?.expertPrompt || '';
      if (!expertPrompt) return prompt;

      const placement = options.promptPlacement || 'prefix';
      if (placement === 'suffix') {
        return `${prompt}\n\n${expertPrompt}`;
      }
      return `${expertPrompt}\n\n${prompt}`;
    };

    const _ensureImports = async () => {
      if (_imports) return _imports;
      _imports = await import('@clocksmith/doppler');
      return _imports;
    };

    const _loadManifestFromOpfs = async (modelId) => {
      const { initStorage, openModelStore, loadManifestFromStore } = await import('@clocksmith/doppler/storage/shard-manager.js');
      await initStorage();
      await openModelStore(modelId);
      const manifestText = await loadManifestFromStore();
      return JSON.parse(manifestText);
    };

    const _createStorageContext = async (modelId) => {
      const { openModelStore, loadShard } = await import('@clocksmith/doppler/storage/shard-manager.js');
      if (modelId) {
        await openModelStore(modelId);
      }
      return {
        loadShard: async (index) => {
          const data = await loadShard(index);
          return new Uint8Array(data);
        }
      };
    };

    const _initPipelineNetwork = async (manifest, options = {}) => {
      const { initDevice, getDevice, getKernelCapabilities } = await _ensureImports();
      const { getMemoryCapabilities } = await _ensureImports();
      const { getHeapManager } = await _ensureImports();
      const { MultiModelLoader, MultiModelNetwork, MultiPipelinePool } = await _ensureImports();

      await initDevice();
      const gpuCaps = getKernelCapabilities();
      const memCaps = await getMemoryCapabilities();
      const device = getDevice();

      const storageContext = options.storageContext || await _createStorageContext(_baseModelId);
      _loader = new MultiModelLoader();
      await _loader.loadBase(manifest, { storageContext });

      const contexts = {
        gpu: { capabilities: gpuCaps, device },
        memory: { capabilities: memCaps, heapManager: getHeapManager() },
        storage: storageContext,
        baseUrl: options.baseUrl || null
      };

      const pipeline = await _loader.createSharedPipeline(contexts);
      _pool = options.usePool ? new MultiPipelinePool(_loader) : null;
      _network = new MultiModelNetwork(pipeline, _loader, _pool);
    };

    const initBase = async (options = {}) => {
      const { modelId, manifest, baseUrl, usePool = true, storageContext } = options;
      if (!modelId && !manifest) {
        throw new Errors.ValidationError('FunctionGemmaOrchestrator requires modelId or manifest');
      }

      _baseModelId = modelId || _baseModelId;
      _baseManifest = manifest || _baseManifest;

      if (!_baseManifest) {
        _baseManifest = await _loadManifestFromOpfs(_baseModelId);
      }

      await _initPipelineNetwork(_baseManifest, { baseUrl, usePool, storageContext });
      logger.info('[FunctionGemma] Base model initialized');
      return true;
    };

    const registerExperts = async (experts = []) => {
      if (!_network) throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      for (const expert of experts) {
        const adapterName = expert.adapterName || expert.adapter || null;
        if (adapterName && expert.adapterSource) {
          await _loader.loadAdapter(adapterName, expert.adapterSource);
        }
        _network.registerExpert({
          id: expert.id,
          adapterName,
          embedding: expert.embedding,
          metadata: expert.metadata || {}
        });

        if (ContextManager?.registerExpertPrompt) {
          const promptSuffix = expert.promptSuffix
            || expert.prompt
            || (expert.specialization ? `Expert focus: ${expert.specialization}` : null);
          if (promptSuffix) {
            ContextManager.registerExpertPrompt(expert.id, promptSuffix);
            _expertPromptIds.add(expert.id);
          }
        }
      }
      return _network.listExperts();
    };

    const setCombiner = (config) => {
      if (!_network) return;
      _network.setCombiner(config);
    };

    const setSharedPrefix = (snapshot) => {
      if (!_network) return;
      _sharedPrefix = snapshot;
      _network.setSharedPrefixSnapshot(snapshot);
    };

    const setSharedPrefixFromContext = async (context, modelConfig, options = {}) => {
      if (!ContextManager?.createSharedPrefix) return null;
      const { snapshot } = await ContextManager.createSharedPrefix(context, modelConfig, options);
      setSharedPrefix(snapshot);
      return snapshot;
    };

    const initExpertContext = async (systemPrompt, modelConfig, experts = []) => {
      if (!ContextManager?.initSharedPrefix) return null;
      if (!systemPrompt || !modelConfig) return null;

      const { snapshot, prompt } = await ContextManager.initSharedPrefix(systemPrompt, modelConfig);
      if (snapshot) {
        setSharedPrefix(snapshot);
      }

      if (Array.isArray(experts) && ContextManager?.registerExpertPrompt) {
        for (const expert of experts) {
          const promptSuffix = expert.promptSuffix
            || expert.prompt
            || (expert.specialization ? `Expert focus: ${expert.specialization}` : null);
          if (promptSuffix) {
            ContextManager.registerExpertPrompt(expert.id, promptSuffix);
            _expertPromptIds.add(expert.id);
          }
        }
      }

      return { snapshot, prompt };
    };

    const selectExperts = async (task, topK = 1, options = {}) => {
      const started = nowMs();
      try {
        if (!_network) return [];
        const text = task?.routingText || task?.description || task?.prompt || '';
        if (!SemanticMemory || !text) return _network.listExperts().slice(0, topK);
        const embedding = await SemanticMemory.embed(text);
        return _network.selectExpertsByEmbedding(embedding, topK);
      } finally {
        if (options.recordLatency !== false) {
          recordRoutingLatency(nowMs() - started, {
            taskType: task?.type || 'general',
            topK
          });
        }
      }
    };

    const benchmarkRoutingLatency = async (task, options = {}) => {
      const runs = Math.max(1, options.runs || 10);
      const topK = options.topK || 1;
      const latencies = [];

      for (let i = 0; i < runs; i++) {
        const started = nowMs();
        await selectExperts(task, topK, { recordLatency: false });
        latencies.push(nowMs() - started);
      }

      const stats = summarizeLatency(latencies);
      if (EventBus) {
        EventBus.emit('functiongemma:routing:benchmark', {
          runs,
          topK,
          ...stats
        });
      }
      return stats;
    };

    const getRoutingStats = () => ({
      lastMs: _routingStats.lastMs,
      ...summarizeLatency(_routingStats.samples)
    });

    const executeExpert = async (expertId, prompt, options = {}) => {
      if (!_network) throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      const basePrompt = typeof prompt === 'string' ? prompt : String(prompt || '');
      const finalPrompt = options.useExpertContext === false
        ? basePrompt
        : applyExpertContext(expertId, basePrompt, options);
      return _network.executeExpert(expertId, finalPrompt, options);
    };

    const executeTopology = async (genome, task, options = {}) => {
      if (!_network) throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      const topology = genome?.topology?.type || 'ring';
      const nodes = genome?.nodes || [];
      const expertIds = nodes.map((n) => n.id);

      const basePrompt = typeof task.prompt === 'string' ? task.prompt : String(task.prompt || '');
      const useExpertContext = options.useExpertContext !== false;

      if (topology === 'ring') {
        const outputs = await _network.executeRing(expertIds, basePrompt, options);
        return { outputs, combined: await _network.combineOutputs(outputs) };
      }

      if (topology === 'mesh') {
        const tasks = expertIds.map((id, idx) => ({
          id: `${task.id || 'task'}:${id}:${idx}`,
          expertId: id,
          prompt: useExpertContext ? applyExpertContext(id, basePrompt, options) : basePrompt
        }));
        const resultMap = await _network.executeParallel(tasks, options);
        const outputs = Object.values(resultMap);
        return { outputs, combined: await _network.combineOutputs(outputs) };
      }

      const order = topologicalOrder(genome);
      const outputs = {};
      for (const nodeId of order) {
        const parents = (genome.edges || []).filter((e) => e.to === nodeId).map((e) => outputs[e.from]).filter(Boolean);
        const nodePrompt = buildNodePrompt(basePrompt, parents, nodeId, options);
        const finalPrompt = useExpertContext
          ? applyExpertContext(nodeId, nodePrompt, options)
          : nodePrompt;
        outputs[nodeId] = await _network.executeExpert(nodeId, finalPrompt, options);
      }
      const orderedOutputs = order.map((id) => outputs[id]).filter(Boolean);
      return { outputs: orderedOutputs, combined: await _network.combineOutputs(orderedOutputs) };
    };

    const topologicalOrder = (genome) => {
      const nodes = genome?.nodes || [];
      const edges = genome?.edges || [];
      const incoming = new Map();
      const outgoing = new Map();
      for (const node of nodes) {
        incoming.set(node.id, 0);
        outgoing.set(node.id, []);
      }
      for (const edge of edges) {
        if (!incoming.has(edge.to)) continue;
        incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
        outgoing.get(edge.from)?.push(edge.to);
      }

      const queue = [];
      for (const [id, count] of incoming.entries()) {
        if (count === 0) queue.push(id);
      }

      const order = [];
      while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        for (const next of outgoing.get(id) || []) {
          const count = (incoming.get(next) || 0) - 1;
          incoming.set(next, count);
          if (count === 0) queue.push(next);
        }
      }
      return order.length > 0 ? order : nodes.map((n) => n.id);
    };

    const buildNodePrompt = (basePrompt, parentOutputs, nodeId, options = {}) => {
      if (!parentOutputs || parentOutputs.length === 0) return basePrompt;
      const label = options.nodeLabel || nodeId;
      return `${basePrompt}\n\nContext from upstream (${label}):\n${parentOutputs.join('\n\n')}`;
    };

    const validateAgainstSchema = (value, schema) => {
      if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };
      const errors = [];
      const required = Array.isArray(schema.required) ? schema.required : [];
      const properties = schema.properties || {};

      if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        errors.push('Expected object');
        return { valid: false, errors };
      }

      for (const key of required) {
        if (!(key in (value || {}))) {
          errors.push(`Missing required field: ${key}`);
        }
      }

      for (const [key, def] of Object.entries(properties)) {
        if (!(key in (value || {}))) continue;
        const expectedType = def?.type;
        if (!expectedType) continue;
        const actual = value[key];
        if (expectedType === 'array' && !Array.isArray(actual)) {
          errors.push(`Field ${key} expected array`);
        } else if (expectedType === 'object' && (typeof actual !== 'object' || actual === null || Array.isArray(actual))) {
          errors.push(`Field ${key} expected object`);
        } else if (expectedType !== 'array' && expectedType !== 'object' && typeof actual !== expectedType) {
          errors.push(`Field ${key} expected ${expectedType}`);
        }
      }

      return { valid: errors.length === 0, errors };
    };

    const scoreCombinedOutput = (output, task) => {
      const schema = task.schema || (task.schemaName && SchemaRegistry?.getToolSchema?.(task.schemaName)?.parameters) || null;
      if (!schema) return { score: 0.4, valid: true, errors: [] };
      let parsed = output;
      if (typeof output === 'string') {
        try {
          parsed = JSON.parse(output);
        } catch (err) {
          return { score: 0, valid: false, errors: ['Output is not valid JSON'] };
        }
      }
      const validation = validateAgainstSchema(parsed, schema);
      return { score: validation.valid ? 0.7 : 0, valid: validation.valid, errors: validation.errors };
    };

    const runExpertPool = async (task, options = {}) => {
      if (!ArenaHarness?.runExpertPool) {
        throw new Errors.StateError('ArenaHarness not available');
      }
      const experts = options.experts || await selectExperts(task, options.topK || 1);
      return ArenaHarness.runExpertPool(task, experts, { executeExpert }, options);
    };

    const evolveTopology = async (tasks = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Errors.ValidationError('Task set required for topology evolution');
      }

      const { evolveNetwork } = await _ensureImports();
      const experts = _network?.listExperts() || [];
      if (experts.length === 0) {
        throw new Errors.StateError('No experts registered');
      }

      const randomGenome = options.randomGenome || (() => ({
        topology: { type: 'ring' },
        nodes: experts.map((e) => ({ id: e.id })),
        edges: [],
        combiner: { type: 'weighted', weights: experts.map(() => 1) }
      }));

      const evaluate = options.evaluateGenome || (async (genome) => {
        let total = 0;
        for (const task of tasks) {
          const result = await executeTopology(genome, task, options);
          const scored = scoreCombinedOutput(result.combined, task);
          total += scored.score;
        }
        return total / tasks.length;
      });

      const result = await evolveNetwork({
        populationSize: options.populationSize,
        generations: options.generations,
        eliteCount: options.eliteCount,
        mutationRate: options.mutationRate,
        evaluate,
        randomGenome
      });

      // Persist best genome after evolution
      if (result?.best && options.persistWinner !== false) {
        const taskType = options.taskType || tasks[0]?.type || 'evolved';
        await storeGenome(taskType, result.best.genome, result.best.fitness);
        logger.info(`[FunctionGemma] Persisted evolved genome for ${taskType} (fitness: ${result.best.fitness.toFixed(3)})`);
      }

      return result;
    };

    // -------------------------------------------------------------------------
    // Genome Caching via ReflectionStore
    // -------------------------------------------------------------------------

    /**
     * Get cached genome for a task type, or null if none.
     */
    const getCachedGenome = (taskType) => {
      if (!ReflectionStore?.getBestGenome) return null;
      return ReflectionStore.getBestGenome(taskType);
    };

    /**
     * Store a winning genome for a task type.
     */
    const storeGenome = async (taskType, genome, fitness) => {
      if (!ReflectionStore?.storeNetworkGenome) return;
      await ReflectionStore.storeNetworkGenome(taskType, genome, fitness);
    };

    /**
     * Select adapter using UCB1 bandit algorithm.
     */
    const selectAdapterUCB1 = (taskType, adapterIds) => {
      if (!ReflectionStore?.selectAdapterUCB1) {
        return adapterIds[0] || null;
      }
      return ReflectionStore.selectAdapterUCB1(taskType, adapterIds);
    };

    /**
     * Update adapter stats after execution.
     */
    const updateAdapterStats = async (taskType, adapterId, success) => {
      if (!ReflectionStore?.updateAdapterStats) return;
      await ReflectionStore.updateAdapterStats(taskType, adapterId, success);
    };

    // -------------------------------------------------------------------------
    // High-Level Execute API
    // -------------------------------------------------------------------------

    /**
     * Execute a task using the best available strategy:
     * 1. Check for cached genome
     * 2. If cached, execute with that topology
     * 3. If not, route to experts and run expert pool
     * 4. Store winning configuration
     */
    const execute = async (task, options = {}) => {
      if (!task) {
        throw new Errors.ValidationError('Task required');
      }

      const taskType = task.type || 'general';
      const errors = [];
      const recoveryEnabled = options.errorRecovery !== false;

      const recordFailure = (stage, err) => {
        const message = err?.message || String(err);
        errors.push({ stage, message });
        recordError(stage, err, { taskType });
      };

      const withErrors = (result) => {
        if (errors.length === 0) return result;
        return { ...result, errors };
      };

      // Try cached genome first
      const cachedGenome = getCachedGenome(taskType);
      if (cachedGenome && !options.skipCache) {
        try {
          logger.info(`[FunctionGemma] Using cached genome for ${taskType}`);
          const result = await executeTopology(cachedGenome, task, options);
          const scored = scoreCombinedOutput(result.combined, task);

          if (EventBus) {
            EventBus.emit('functiongemma:execute:cached', {
              taskType,
              score: scored.score,
              valid: scored.valid
            });
          }

          return withErrors({
            output: result.combined,
            topology: cachedGenome.topology?.type || 'cached',
            score: scored.score,
            valid: scored.valid,
            cached: true
          });
        } catch (err) {
          if (!recoveryEnabled) throw err;
          recordFailure('cached_genome', err);
        }
      }

      // Route to experts
      let selectedExperts = [];
      try {
        selectedExperts = await selectExperts(task, options.topK || 3);
      } catch (err) {
        if (!recoveryEnabled) throw err;
        recordFailure('routing', err);
        selectedExperts = _network?.listExperts().slice(0, options.topK || 1) || [];
      }

      if (selectedExperts.length === 0) {
        const err = new Errors.StateError('No experts available for task');
        if (!recoveryEnabled) throw err;
        recordFailure('routing', err);
        return withErrors({
          output: '',
          valid: false,
          cached: false,
          error: err.message
        });
      }

      // Run expert pool competition
      let poolResult = null;
      try {
        poolResult = await runExpertPool(task, {
          ...options,
          experts: selectedExperts
        });
      } catch (err) {
        if (!recoveryEnabled) throw err;
        recordFailure('expert_pool', err);
      }

      const winner = poolResult?.winner || null;
      if (!winner) {
        if (!recoveryEnabled) {
          throw new Errors.StateError('Expert pool produced no winner');
        }

        const fallbackExpert = selectedExperts[0];
        if (!fallbackExpert) {
          const err = new Errors.StateError('No fallback expert available');
          recordFailure('fallback_expert', err);
          return withErrors({
            output: '',
            valid: false,
            cached: false,
            error: err.message
          });
        }

        try {
          const output = await executeExpert(fallbackExpert.id, task.prompt, options);
          const validation = SchemaRegistry?.validateCombinedOutput
            ? SchemaRegistry.validateCombinedOutput({ [fallbackExpert.id]: output }, task.schema)
            : { valid: true, errors: [] };

          await updateAdapterStats(taskType, fallbackExpert.adapter || fallbackExpert.id, validation.valid);

          return withErrors({
            output,
            expert: fallbackExpert.id,
            score: 0,
            valid: validation.valid,
            cached: false,
            recovered: true
          });
        } catch (err) {
          recordFailure('fallback_expert', err);
          return withErrors({
            output: '',
            valid: false,
            cached: false,
            error: err?.message || String(err)
          });
        }
      }

      // Validate output
      const validation = SchemaRegistry?.validateCombinedOutput
        ? SchemaRegistry.validateCombinedOutput({ [winner.expert.id]: winner.output }, task.schema)
        : { valid: true, errors: [] };

      // Update adapter stats
      await updateAdapterStats(taskType, winner.expert.adapter || winner.expert.id, validation.valid);

      // Persist winning config as genome if valid and above threshold
      const winnerScore = winner.score?.score || 0;
      if (validation.valid && winnerScore >= (options.persistThreshold || 0.5)) {
        const winnerGenome = {
          topology: { type: 'single-expert' },
          nodes: [{ id: winner.expert.id }],
          edges: [],
          combiner: { type: 'passthrough' },
          metadata: {
            adapterId: winner.expert.adapter || winner.expert.id,
            createdAt: Date.now()
          }
        };
        await storeGenome(taskType, winnerGenome, winnerScore);
        logger.info(`[FunctionGemma] Persisted winning config for ${taskType} (score: ${winnerScore.toFixed(3)})`);
      }

      if (EventBus) {
        EventBus.emit('functiongemma:execute:pool', {
          taskType,
          expertId: winner.expert.id,
          score: winnerScore,
          valid: validation.valid
        });
      }

      return withErrors({
        output: winner.output,
        expert: winner.expert.id,
        score: winnerScore,
        valid: validation.valid,
        cached: false
      });
    };

    // -------------------------------------------------------------------------
    // Arena FunctionGemma Integration (Phase 5)
    // -------------------------------------------------------------------------

    /**
     * Run arena-style competition between genomes for evolution.
     * Evaluates multiple genome configurations, selects winners, persists best.
     *
     * @param {Array} tasks - Array of test tasks for evaluation
     * @param {Object} options - Configuration options
     * @param {number} options.populationSize - Number of genomes to compete (default: 8)
     * @param {number} options.generations - Number of evolution generations (default: 3)
     * @param {number} options.eliteCount - Number of elites to preserve (default: 2)
     * @param {number} options.mutationRate - Mutation probability (default: 0.3)
     * @param {string} options.taskType - Task type for genome storage
     * @param {boolean} options.persistTop - Persist top N genomes (default: true)
     * @param {number} options.persistCount - How many top genomes to persist (default: 3)
     * @returns {Object} { winner, rankings, history, persisted }
     */
    const runArenaEvolution = async (tasks = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Errors.ValidationError('Task set required for arena evolution');
      }

      const {
        populationSize = 8,
        generations = 3,
        eliteCount = 2,
        mutationRate = 0.3,
        taskType = tasks[0]?.type || 'arena-evolved',
        persistTop = true,
        persistCount = 3
      } = options;

      logger.info(`[FunctionGemma] Starting Arena Evolution: ${populationSize} genomes, ${generations} generations`);

      if (EventBus) {
        EventBus.emit('functiongemma:arena:start', {
          taskType,
          populationSize,
          generations,
          taskCount: tasks.length
        });
      }

      // Run evolution with fitness tracking
      const evolutionHistory = [];
      let currentBest = null;

      const trackingEvaluate = async (genome) => {
        let totalScore = 0;
        const taskScores = [];

        for (const task of tasks) {
          try {
            const result = await executeTopology(genome, task, options);
            const scored = scoreCombinedOutput(result.combined, task);
            totalScore += scored.score;
            taskScores.push({
              taskId: task.id || task.type,
              score: scored.score,
              valid: scored.valid
            });
          } catch (err) {
            logger.warn(`[FunctionGemma] Arena eval failed for task: ${err.message}`);
            taskScores.push({
              taskId: task.id || task.type,
              score: 0,
              valid: false,
              error: err.message
            });
          }
        }

        const fitness = totalScore / tasks.length;

        // Track best
        if (!currentBest || fitness > currentBest.fitness) {
          currentBest = { genome, fitness, taskScores };
        }

        return fitness;
      };

      // Run evolution
      const evolutionResult = await evolveTopology(tasks, {
        ...options,
        populationSize,
        generations,
        eliteCount,
        mutationRate,
        evaluateGenome: trackingEvaluate,
        persistWinner: false, // We'll persist multiple winners below
        taskType
      });

      // Collect top genomes from final population
      const rankings = (evolutionResult?.population || [])
        .map((g) => ({ genome: g.genome, fitness: g.fitness }))
        .sort((a, b) => b.fitness - a.fitness)
        .slice(0, persistCount);

      // Persist top genomes
      const persisted = [];
      if (persistTop && rankings.length > 0) {
        for (let i = 0; i < Math.min(rankings.length, persistCount); i++) {
          const entry = rankings[i];
          await storeGenome(taskType, entry.genome, entry.fitness);
          persisted.push({
            rank: i + 1,
            fitness: entry.fitness,
            topology: entry.genome?.topology?.type || 'unknown'
          });
        }
        logger.info(`[FunctionGemma] Persisted ${persisted.length} winning genomes for ${taskType}`);
      }

      const winner = rankings[0] || currentBest;

      if (EventBus) {
        EventBus.emit('functiongemma:arena:complete', {
          taskType,
          winnerFitness: winner?.fitness || 0,
          persistedCount: persisted.length,
          generations
        });
      }

      // Record arena result in ReflectionStore
      if (ReflectionStore?.add) {
        await ReflectionStore.add({
          type: 'success',
          content: `Arena evolution completed: ${generations} generations, winner fitness ${(winner?.fitness || 0).toFixed(3)}`,
          context: {
            taskType,
            outcome: 'success',
            generations,
            populationSize,
            winnerFitness: winner?.fitness || 0,
            persistedCount: persisted.length
          },
          tags: ['arena', 'evolution', taskType],
          description: `Arena evolution for ${taskType}`
        });
      }

      return {
        winner,
        rankings,
        history: evolutionHistory,
        persisted,
        generations,
        taskType
      };
    };

    /**
     * Run head-to-head competition between two genomes.
     * Useful for A/B testing topology configurations.
     *
     * @param {Object} genomeA - First genome
     * @param {Object} genomeB - Second genome
     * @param {Array} tasks - Test tasks
     * @param {Object} options - Execution options
     * @returns {Object} { winner, scores, tie }
     */
    const runHeadToHead = async (genomeA, genomeB, tasks = [], options = {}) => {
      if (!genomeA || !genomeB) {
        throw new Errors.ValidationError('Two genomes required for head-to-head');
      }

      const evaluate = async (genome, label) => {
        let total = 0;
        const results = [];
        for (const task of tasks) {
          try {
            const result = await executeTopology(genome, task, options);
            const scored = scoreCombinedOutput(result.combined, task);
            total += scored.score;
            results.push({ taskId: task.id, score: scored.score, valid: scored.valid });
          } catch (err) {
            results.push({ taskId: task.id, score: 0, valid: false, error: err.message });
          }
        }
        return { label, fitness: total / tasks.length, results };
      };

      const [scoreA, scoreB] = await Promise.all([
        evaluate(genomeA, 'A'),
        evaluate(genomeB, 'B')
      ]);

      const tie = Math.abs(scoreA.fitness - scoreB.fitness) < 0.01;
      const winner = tie ? null : (scoreA.fitness > scoreB.fitness ? 'A' : 'B');

      if (EventBus) {
        EventBus.emit('functiongemma:headtohead:complete', {
          winner,
          tie,
          fitnessA: scoreA.fitness,
          fitnessB: scoreB.fitness
        });
      }

      return {
        winner,
        tie,
        scores: { A: scoreA, B: scoreB },
        genomes: { A: genomeA, B: genomeB }
      };
    };

    // -------------------------------------------------------------------------
    // Temporal Self-Ring Execution
    // -------------------------------------------------------------------------

    /**
     * Execute using Temporal Self-Ring topology.
     * Same model at N temporal states for self-reflective improvement.
     * Based on Godel Agent, RISE, and Reflexion research.
     *
     * @param {Object} task - Task with description, prompt, maxTokens, schema
     * @param {Object} config - Configuration for temporal ring execution
     * @param {number} config.turns - Max iterations (default: 5)
     * @param {number} config.temperatureStart - Initial temperature (default: 0.8)
     * @param {number} config.temperatureDecay - Decay per turn (default: 0.15)
     * @param {number} config.temperatureMin - Minimum temperature (default: 0.1)
     * @param {boolean} config.enableShortcuts - Enable Mobius Ring shortcuts (default: false)
     * @param {number} config.shortcutInterval - Turns between shortcuts (default: 2)
     * @param {number} config.convergenceThreshold - Similarity threshold for convergence
     * @param {boolean} config.persistHistory - Store history in ReflectionStore
     * @returns {Object} { finalOutput, history, turnsUsed, converged, valid }
     */
    const executeTemporalSelfRing = async (task, config = {}) => {
      if (!_network) {
        throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      }

      const {
        turns = 5,
        temperatureStart = 0.8,
        temperatureDecay = 0.15,
        temperatureMin = 0.1,
        enableShortcuts = false,
        shortcutInterval = 2,
        convergenceThreshold,
        persistHistory = false,
        expertId = 'base'
      } = config;

      const taskType = task.type || 'temporal-ring';
      const taskDescription = task.description || task.prompt || '';

      const history = [];
      let currentOutput = '';
      let converged = false;

      logger.info(`[FunctionGemma] Starting Temporal Self-Ring (max ${turns} turns)`);

      for (let t = 0; t < turns; t++) {
        const temperature = Math.max(temperatureMin, temperatureStart - t * temperatureDecay);
        const role = t === 0 ? 'seed' : t % 2 === 1 ? 'reflect' : 'refine';

        // Build temporal prompt
        let prompt = buildTemporalSelfRingPrompt(taskDescription, t, history, currentOutput, role);

        // Mobius Ring: Add shortcuts to earlier temporal states
        if (enableShortcuts && t >= shortcutInterval) {
          const shortcutIdx = t - shortcutInterval;
          const shortcutEntry = history[shortcutIdx];
          if (shortcutEntry) {
            prompt += `\n\n### Earlier Context (turn ${shortcutIdx}):\n${shortcutEntry.output}`;
          }
        }

        // Execute with temporal context
        try {
          currentOutput = await executeExpert(expertId, prompt, {
            ...task,
            temperature,
            useExpertContext: false // Pure temporal execution
          });
        } catch (err) {
          logger.error(`[FunctionGemma] Temporal ring turn ${t} failed:`, err.message);
          recordError('temporal_ring', err, { taskType, turn: t });
          break;
        }

        history.push({
          turn: t,
          output: currentOutput,
          timestamp: Date.now(),
          role,
          temperature
        });

        // Convergence detection
        if (detectTemporalConvergence(currentOutput, history, convergenceThreshold)) {
          converged = true;
          logger.info(`[FunctionGemma] Temporal Self-Ring converged at turn ${t}`);
          break;
        }
      }

      // Validate final output
      const validation = task.schema && SchemaRegistry?.validateCombinedOutput
        ? SchemaRegistry.validateCombinedOutput({ temporal: currentOutput }, task.schema)
        : { valid: true, errors: [] };

      // Persist history for cross-session memory if enabled
      if (persistHistory && ReflectionStore?.add) {
        await ReflectionStore.add({
          type: 'success',
          content: `Temporal Self-Ring completed: ${converged ? 'converged' : 'max turns'}`,
          context: {
            taskType,
            turnsUsed: history.length,
            converged,
            outcome: validation.valid ? 'success' : 'failure'
          },
          tags: ['temporal-ring', taskType],
          description: `Temporal ring execution with ${history.length} turns`
        });
      }

      if (EventBus) {
        EventBus.emit('functiongemma:temporal:complete', {
          taskType,
          turnsUsed: history.length,
          converged,
          valid: validation.valid
        });
      }

      return {
        finalOutput: currentOutput,
        history,
        turnsUsed: history.length,
        converged,
        valid: validation.valid,
        errors: validation.errors
      };
    };

    /**
     * Build prompt for temporal self-ring iteration.
     */
    const buildTemporalSelfRingPrompt = (taskDescription, turn, history, lastOutput, role) => {
      if (role === 'seed') {
        return `Generate code for: ${taskDescription}\n\nOutput JSON: { "code": string, "reasoning": string }`;
      }

      if (role === 'reflect') {
        return `Review this code and identify issues:\n\n${lastOutput}\n\nOutput JSON: { "issues": string[], "severity": string, "suggestions": string[] }`;
      }

      // role === 'refine'
      const originalTurn = turn - 2;
      const originalOutput = history[originalTurn]?.output || lastOutput;
      return `Improve the code based on this feedback:\n\nOriginal code:\n${originalOutput}\n\nCritique:\n${lastOutput}\n\nOutput improved JSON: { "code": string, "changes": string[], "converged": boolean }`;
    };

    /**
     * Detect convergence in temporal self-ring.
     */
    const detectTemporalConvergence = (currentOutput, history, threshold) => {
      if (history.length < 2) return false;

      // Check for explicit convergence signal
      if (currentOutput.includes('"converged": true') || currentOutput.includes('"converged":true')) {
        return true;
      }

      // Check for output stability (same as previous)
      const prevOutput = history[history.length - 1]?.output;
      if (currentOutput === prevOutput) {
        return true;
      }

      // Similarity-based convergence
      if (threshold !== undefined && prevOutput) {
        const similarity = computeJaccardSimilarity(currentOutput, prevOutput);
        if (similarity >= threshold) {
          return true;
        }
      }

      return false;
    };

    /**
     * Simple Jaccard similarity on tokens.
     */
    const computeJaccardSimilarity = (a, b) => {
      const tokensA = new Set(a.toLowerCase().split(/\s+/));
      const tokensB = new Set(b.toLowerCase().split(/\s+/));
      const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
      const union = new Set([...tokensA, ...tokensB]);
      return union.size > 0 ? intersection.size / union.size : 0;
    };

    /**
     * Execute Mobius Ring variant with small-world shortcuts.
     * Wrapper around executeTemporalSelfRing with shortcuts enabled.
     */
    const executeMobiusRing = async (task, config = {}) => {
      return executeTemporalSelfRing(task, {
        ...config,
        enableShortcuts: true,
        shortcutInterval: config.shortcutInterval || 2
      });
    };

    return {
      initBase,
      registerExperts,
      selectExperts,
      executeExpert,
      executeTopology,
      runExpertPool,
      evolveTopology,
      setCombiner,
      setSharedPrefix,
      setSharedPrefixFromContext,
      initExpertContext,
      // Genome caching
      getCachedGenome,
      storeGenome,
      selectAdapterUCB1,
      updateAdapterStats,
      // Routing metrics
      benchmarkRoutingLatency,
      getRoutingStats,
      // High-level API
      execute,
      // Arena FunctionGemma integration (Phase 5)
      runArenaEvolution,
      runHeadToHead,
      // Temporal Self-Ring (single evolving brain)
      executeTemporalSelfRing,
      executeMobiusRing
    };
  }
};

export default FunctionGemmaOrchestrator;
