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

    const _ensureImports = async () => {
      if (_imports) return _imports;
      _imports = await import('@clocksmith/doppler');
      return _imports;
    };

    const _loadManifestFromOpfs = async (modelId) => {
      const { initOPFS, openModelDirectory } = await import('@clocksmith/doppler/storage/shard-manager.js');
      await initOPFS();
      await openModelDirectory(modelId);
      const { loadManifestFromOPFS } = await import('@clocksmith/doppler/storage/shard-manager.js');
      const manifestText = await loadManifestFromOPFS();
      return JSON.parse(manifestText);
    };

    const _createStorageContext = async (modelId) => {
      const { openModelDirectory, loadShard } = await import('@clocksmith/doppler/storage/shard-manager.js');
      if (modelId) {
        await openModelDirectory(modelId);
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

    const selectExperts = async (task, topK = 1) => {
      if (!_network) return [];
      const text = task.routingText || task.description || task.prompt || '';
      if (!SemanticMemory || !text) return _network.listExperts().slice(0, topK);
      const embedding = await SemanticMemory.embed(text);
      return _network.selectExpertsByEmbedding(embedding, topK);
    };

    const executeExpert = async (expertId, prompt, options = {}) => {
      if (!_network) throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      return _network.executeExpert(expertId, prompt, options);
    };

    const executeTopology = async (genome, task, options = {}) => {
      if (!_network) throw new Errors.StateError('FunctionGemmaOrchestrator not initialized');
      const topology = genome?.topology?.type || 'ring';
      const nodes = genome?.nodes || [];
      const expertIds = nodes.map((n) => n.id);

      if (topology === 'ring') {
        const outputs = await _network.executeRing(expertIds, task.prompt, options);
        return { outputs, combined: await _network.combineOutputs(outputs) };
      }

      if (topology === 'mesh') {
        const tasks = expertIds.map((id, idx) => ({
          id: `${task.id || 'task'}:${id}:${idx}`,
          expertId: id,
          prompt: task.prompt
        }));
        const resultMap = await _network.executeParallel(tasks, options);
        const outputs = Object.values(resultMap);
        return { outputs, combined: await _network.combineOutputs(outputs) };
      }

      const order = topologicalOrder(genome);
      const outputs = {};
      for (const nodeId of order) {
        const parents = (genome.edges || []).filter((e) => e.to === nodeId).map((e) => outputs[e.from]).filter(Boolean);
        const prompt = buildNodePrompt(task.prompt, parents, nodeId, options);
        outputs[nodeId] = await _network.executeExpert(nodeId, prompt, options);
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

      return evolveNetwork({
        populationSize: options.populationSize,
        generations: options.generations,
        eliteCount: options.eliteCount,
        mutationRate: options.mutationRate,
        evaluate,
        randomGenome
      });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Genome Caching via ReflectionStore
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // High-Level Execute API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Execute a task using the best available strategy:
     * 1. Check for cached genome
     * 2. If cached, execute with that topology
     * 3. If not, route to experts and run expert pool
     * 4. Store winning configuration
     */
    const execute = async (task, options = {}) => {
      const taskType = task.type || 'general';

      // Try cached genome first
      const cachedGenome = getCachedGenome(taskType);
      if (cachedGenome && !options.skipCache) {
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

        return {
          output: result.combined,
          topology: cachedGenome.topology?.type || 'cached',
          score: scored.score,
          valid: scored.valid,
          cached: true
        };
      }

      // Route to experts
      const selectedExperts = await selectExperts(task, options.topK || 3);

      if (selectedExperts.length === 0) {
        throw new Errors.StateError('No experts available for task');
      }

      // Run expert pool competition
      const poolResult = await runExpertPool(task, {
        ...options,
        experts: selectedExperts
      });

      const winner = poolResult.winner;
      if (!winner) {
        throw new Errors.StateError('Expert pool produced no winner');
      }

      // Validate output
      const validation = SchemaRegistry?.validateCombinedOutput
        ? SchemaRegistry.validateCombinedOutput({ [winner.expert.id]: winner.output }, task.schema)
        : { valid: true, errors: [] };

      // Update adapter stats
      await updateAdapterStats(taskType, winner.expert.adapter || winner.expert.id, validation.valid);

      if (EventBus) {
        EventBus.emit('functiongemma:execute:pool', {
          taskType,
          expertId: winner.expert.id,
          score: winner.score?.score || 0,
          valid: validation.valid
        });
      }

      return {
        output: winner.output,
        expert: winner.expert.id,
        score: winner.score?.score || 0,
        valid: validation.valid,
        cached: false
      };
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
      // Genome caching
      getCachedGenome,
      storeGenome,
      selectAdapterUCB1,
      updateAdapterStats,
      // High-level API
      execute
    };
  }
};

export default FunctionGemmaOrchestrator;
