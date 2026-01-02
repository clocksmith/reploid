/**
 * @fileoverview Prompt Memory
 * Integration layer between GEPA and SemanticMemory.
 * Stores evolved prompts, enables transfer learning, tracks performance drift.
 *
 * @see TODO.md: Memory + GEPA Integration (Phase 3)
 */

const PromptMemory = {
  metadata: {
    id: 'PromptMemory',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'SemanticMemory', 'EmbeddingStore', 'KnowledgeTree', 'VFS'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, SemanticMemory, EmbeddingStore, KnowledgeTree, VFS } = deps;
    const { logger, generateId, Errors } = Utils;

    // --- Configuration ---
    const CONFIG = {
      promptDomain: 'evolved_prompt',
      performancePath: '/.memory/prompt-performance/',
      driftThreshold: 0.15,           // 15% performance drop triggers re-optimization
      driftWindowSize: 10,            // Number of recent executions to consider
      minExecutionsForDrift: 5,       // Minimum executions before drift detection
      maxHistoricalPrompts: 50,       // Max prompts to keep in memory
      seedPopulationSize: 3           // Number of historical prompts to seed GEPA
    };

    // --- State ---
    let _isInitialized = false;

    // --- Initialization ---

    const init = async () => {
      if (_isInitialized) return true;

      await ensureVfsPath(CONFIG.performancePath);
      _isInitialized = true;

      // Listen for GEPA completion events
      EventBus.on('gepa:generation-complete', handleGEPAComplete);

      logger.info('[PromptMemory] Initialized');
      return true;
    };

    const ensureVfsPath = async (path) => {
      if (!VFS) return;
      if (!await VFS.exists(path)) {
        await VFS.mkdir(path);
      }
    };

    // --- 1. Prompt Storage ---

    /**
     * Store an evolved prompt in SemanticMemory with full metadata.
     * Called after GEPA evolution completes.
     *
     * @param {Object} prompt - The evolved prompt candidate
     * @param {string} prompt.content - The prompt text
     * @param {Object} prompt.scores - Fitness scores {accuracy, efficiency, robustness}
     * @param {number} prompt.generation - Which generation this came from
     * @param {string[]} prompt.parentIds - IDs of parent prompts
     * @param {string} taskType - Type of task this prompt solves
     * @param {Object} [options] - Additional options
     * @returns {Promise<string>} The stored memory ID
     */
    const storeEvolvedPrompt = async (prompt, taskType, options = {}) => {
      if (!prompt?.content) {
        throw new Errors.ValidationError('Prompt content is required');
      }

      const metadata = {
        domain: CONFIG.promptDomain,
        source: 'gepa',
        taskType: taskType || 'general',
        fitness: {
          accuracy: prompt.scores?.accuracy || 0,
          efficiency: prompt.scores?.efficiency || 0,
          robustness: prompt.scores?.robustness || 0,
          composite: computeCompositeFitness(prompt.scores)
        },
        generation: prompt.generation || 0,
        parentIds: prompt.parentIds || [],
        targetType: prompt.targetType || 'prompt',
        payload: prompt.payload || null,
        evolvedAt: Date.now(),
        executionCount: 0,
        performanceHistory: []
      };

      const id = await SemanticMemory.store(prompt.content, metadata);

      EventBus.emit('prompt:memory:stored', {
        id,
        taskType: metadata.taskType,
        fitness: metadata.fitness.composite
      });

      logger.info('[PromptMemory] Stored evolved prompt', {
        id,
        taskType: metadata.taskType,
        fitness: metadata.fitness.composite.toFixed(3)
      });

      return id;
    };

    /**
     * Compute composite fitness from individual scores.
     * Weighted average: accuracy (50%), robustness (30%), efficiency (20%)
     */
    const computeCompositeFitness = (scores) => {
      if (!scores) return 0;
      return (
        (scores.accuracy || 0) * 0.5 +
        (scores.robustness || 0) * 0.3 +
        (scores.efficiency || 0) * 0.2
      );
    };

    /**
     * Retrieve high-performing prompts for a given task type.
     *
     * @param {string} taskType - The type of task
     * @param {Object} [options] - Query options
     * @param {number} [options.topK=5] - Number of prompts to return
     * @param {number} [options.minFitness=0.6] - Minimum composite fitness
     * @returns {Promise<Array>} Matching prompts sorted by fitness
     */
    const getPromptsForTaskType = async (taskType, options = {}) => {
      const { topK = 5, minFitness = 0.6 } = options;

      // Search by task description
      const results = await SemanticMemory.search(taskType, {
        topK: topK * 2, // Get more than needed for filtering
        minSimilarity: 0.5
      });

      // Filter to evolved prompts only
      const prompts = results
        .filter(r => r.domain === CONFIG.promptDomain)
        .filter(r => {
          const fitness = r.metadata?.fitness?.composite || 0;
          return fitness >= minFitness;
        })
        .sort((a, b) => {
          const fitnessA = a.metadata?.fitness?.composite || 0;
          const fitnessB = b.metadata?.fitness?.composite || 0;
          return fitnessB - fitnessA;
        })
        .slice(0, topK);

      return prompts.map(p => ({
        id: p.id,
        content: p.content,
        taskType: p.metadata?.taskType,
        fitness: p.metadata?.fitness,
        generation: p.metadata?.generation,
        similarity: p.similarity
      }));
    };

    // --- 2. Transfer Learning ---

    /**
     * Query for similar historical prompts to seed GEPA population.
     * Uses both KnowledgeTree (if available) and SemanticMemory.
     *
     * @param {string} taskDescription - Description of the current task
     * @param {Object} [options] - Query options
     * @returns {Promise<string[]>} Array of prompt contents to seed population
     */
    const getSeedPrompts = async (taskDescription, options = {}) => {
      const { maxSeeds = CONFIG.seedPopulationSize } = options;

      const seeds = [];
      const seenContent = new Set();

      // 1. Query KnowledgeTree for similar past tasks
      try {
        const treeResults = await KnowledgeTree.query(taskDescription, {
          topK: maxSeeds,
          includeAllLevels: true
        });

        for (const result of treeResults) {
          // Look for prompts associated with this knowledge node
          const relatedPrompts = await getPromptsForTaskType(result.content, {
            topK: 2,
            minFitness: 0.5
          });

          for (const prompt of relatedPrompts) {
            if (!seenContent.has(prompt.content) && seeds.length < maxSeeds) {
              seeds.push(prompt.content);
              seenContent.add(prompt.content);
            }
          }
        }
      } catch (err) {
        logger.debug('[PromptMemory] KnowledgeTree query failed, using SemanticMemory only', err.message);
      }

      // 2. Query SemanticMemory directly for similar prompts
      const directResults = await SemanticMemory.search(taskDescription, {
        topK: maxSeeds * 2,
        minSimilarity: 0.6
      });

      const directPrompts = directResults
        .filter(r => r.domain === CONFIG.promptDomain)
        .filter(r => (r.metadata?.fitness?.composite || 0) >= 0.5);

      for (const prompt of directPrompts) {
        if (!seenContent.has(prompt.content) && seeds.length < maxSeeds) {
          seeds.push(prompt.content);
          seenContent.add(prompt.content);
        }
      }

      EventBus.emit('prompt:memory:seeds', {
        taskDescription: taskDescription.slice(0, 50),
        seedCount: seeds.length
      });

      logger.info('[PromptMemory] Retrieved seed prompts', {
        taskDescription: taskDescription.slice(0, 50),
        seedCount: seeds.length
      });

      return seeds;
    };

    /**
     * Build initial GEPA population using historical prompts.
     * Returns array of candidate objects ready for GEPA.
     *
     * @param {string} seedPrompt - The base seed prompt from user
     * @param {string} taskDescription - Description of the task
     * @param {number} populationSize - Target population size
     * @returns {Promise<Array>} Population array with historical seeds
     */
    const buildSeededPopulation = async (seedPrompt, taskDescription, populationSize) => {
      const historicalSeeds = await getSeedPrompts(taskDescription, {
        maxSeeds: Math.min(CONFIG.seedPopulationSize, Math.floor(populationSize / 2))
      });

      const population = [];

      // First candidate is always the user's seed
      population.push({
        content: seedPrompt,
        generation: 0,
        parentIds: [],
        mutationType: 'seed'
      });

      // Add historical prompts as seeds
      for (const content of historicalSeeds) {
        if (population.length < populationSize) {
          population.push({
            content,
            generation: 0,
            parentIds: [],
            mutationType: 'historical_seed'
          });
        }
      }

      return population;
    };

    // --- 3. Performance Tracking & Drift Detection ---

    /**
     * Record performance of a prompt execution.
     * Called when an evolved prompt is used in production.
     *
     * @param {string} promptId - The memory ID of the prompt
     * @param {Object} metrics - Performance metrics
     * @param {boolean} metrics.success - Whether execution succeeded
     * @param {number} metrics.latencyMs - Execution latency
     * @param {number} [metrics.score] - Optional quality score (0-1)
     * @returns {Promise<Object>} Updated performance stats
     */
    const recordPerformance = async (promptId, metrics) => {
      const performancePath = `${CONFIG.performancePath}${promptId}.json`;

      // Load existing performance data
      let perfData;
      try {
        if (await VFS.exists(performancePath)) {
          const content = await VFS.read(performancePath);
          perfData = JSON.parse(content);
        } else {
          perfData = {
            promptId,
            executions: [],
            createdAt: Date.now()
          };
        }
      } catch (err) {
        perfData = {
          promptId,
          executions: [],
          createdAt: Date.now()
        };
      }

      // Add new execution record
      perfData.executions.push({
        timestamp: Date.now(),
        success: metrics.success,
        latencyMs: metrics.latencyMs,
        score: metrics.score || (metrics.success ? 1 : 0)
      });

      // Keep only recent executions
      if (perfData.executions.length > 100) {
        perfData.executions = perfData.executions.slice(-100);
      }

      // Compute rolling stats
      const recent = perfData.executions.slice(-CONFIG.driftWindowSize);
      perfData.recentStats = {
        successRate: recent.filter(e => e.success).length / recent.length,
        avgLatency: recent.reduce((sum, e) => sum + e.latencyMs, 0) / recent.length,
        avgScore: recent.reduce((sum, e) => sum + e.score, 0) / recent.length,
        count: recent.length
      };

      // Compute baseline (first N executions)
      const baseline = perfData.executions.slice(0, CONFIG.driftWindowSize);
      if (baseline.length >= CONFIG.minExecutionsForDrift) {
        perfData.baselineStats = {
          successRate: baseline.filter(e => e.success).length / baseline.length,
          avgScore: baseline.reduce((sum, e) => sum + e.score, 0) / baseline.length
        };
      }

      // Save updated data
      await VFS.write(performancePath, JSON.stringify(perfData, null, 2));

      // Update EmbeddingStore metadata
      try {
        await EmbeddingStore.updateMemory(promptId, {
          metadata: {
            executionCount: perfData.executions.length,
            recentStats: perfData.recentStats
          }
        });
      } catch (err) {
        logger.debug('[PromptMemory] Could not update memory metadata', err.message);
      }

      EventBus.emit('prompt:memory:performance', {
        promptId,
        successRate: perfData.recentStats.successRate,
        avgScore: perfData.recentStats.avgScore
      });

      return perfData.recentStats;
    };

    /**
     * Check if a prompt has drifted from its baseline performance.
     *
     * @param {string} promptId - The memory ID of the prompt
     * @returns {Promise<Object>} Drift analysis result
     */
    const checkDrift = async (promptId) => {
      const performancePath = `${CONFIG.performancePath}${promptId}.json`;

      try {
        if (!await VFS.exists(performancePath)) {
          return { hasDrift: false, reason: 'no_data' };
        }

        const content = await VFS.read(performancePath);
        const perfData = JSON.parse(content);

        if (!perfData.baselineStats || !perfData.recentStats) {
          return { hasDrift: false, reason: 'insufficient_data' };
        }

        if (perfData.recentStats.count < CONFIG.minExecutionsForDrift) {
          return { hasDrift: false, reason: 'insufficient_recent' };
        }

        // Compare recent performance to baseline
        const baselineScore = perfData.baselineStats.avgScore;
        const recentScore = perfData.recentStats.avgScore;
        const scoreDrop = baselineScore - recentScore;

        const baselineSuccess = perfData.baselineStats.successRate;
        const recentSuccess = perfData.recentStats.successRate;
        const successDrop = baselineSuccess - recentSuccess;

        const hasDrift = scoreDrop > CONFIG.driftThreshold || successDrop > CONFIG.driftThreshold;

        const result = {
          hasDrift,
          baseline: perfData.baselineStats,
          recent: perfData.recentStats,
          scoreDrop,
          successDrop,
          threshold: CONFIG.driftThreshold
        };

        if (hasDrift) {
          EventBus.emit('prompt:memory:drift', {
            promptId,
            scoreDrop,
            successDrop
          });

          logger.warn('[PromptMemory] Drift detected', {
            promptId,
            scoreDrop: scoreDrop.toFixed(3),
            successDrop: successDrop.toFixed(3)
          });
        }

        return result;

      } catch (err) {
        logger.error('[PromptMemory] Drift check failed', err);
        return { hasDrift: false, reason: 'error', error: err.message };
      }
    };

    /**
     * Get all prompts that have drifted and need re-optimization.
     *
     * @returns {Promise<Array>} List of drifted prompt IDs with details
     */
    const getDriftedPrompts = async () => {
      const drifted = [];

      try {
        const files = await VFS.readdir(CONFIG.performancePath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
          const promptId = file.replace('.json', '');
          const driftResult = await checkDrift(promptId);

          if (driftResult.hasDrift) {
            drifted.push({
              promptId,
              ...driftResult
            });
          }
        }
      } catch (err) {
        logger.error('[PromptMemory] Failed to scan for drifted prompts', err);
      }

      return drifted;
    };

    /**
     * Queue a prompt for re-optimization due to drift.
     * Emits event for agent to handle.
     *
     * @param {string} promptId - The drifted prompt ID
     * @param {Object} driftDetails - Details from checkDrift
     */
    const triggerReoptimization = async (promptId, driftDetails) => {
      try {
        const memory = await EmbeddingStore.getMemory(promptId);
        if (!memory) {
          logger.warn('[PromptMemory] Cannot reoptimize: prompt not found', promptId);
          return;
        }

        EventBus.emit('prompt:memory:reoptimize', {
          promptId,
          content: memory.content,
          taskType: memory.metadata?.taskType,
          originalFitness: memory.metadata?.fitness,
          driftDetails
        });

        logger.info('[PromptMemory] Triggered re-optimization', {
          promptId,
          taskType: memory.metadata?.taskType
        });

      } catch (err) {
        logger.error('[PromptMemory] Failed to trigger re-optimization', err);
      }
    };

    /**
     * Get a specific prompt by ID.
     * @param {string} promptId - The memory ID
     * @returns {Promise<Object|null>} Prompt data or null
     */
    const getPromptById = async (promptId) => {
      try {
        const memory = await EmbeddingStore.getMemory(promptId);
        if (!memory || memory.metadata?.domain !== CONFIG.promptDomain) {
          return null;
        }
        return {
          id: memory.id,
          content: memory.content,
          taskType: memory.metadata?.taskType,
          fitness: memory.metadata?.fitness,
          generation: memory.metadata?.generation,
          evolvedAt: memory.metadata?.evolvedAt
        };
      } catch (err) {
        logger.debug('[PromptMemory] Failed to get prompt by ID', err.message);
        return null;
      }
    };

    /**
     * Run automatic drift check and queue re-optimization for drifted prompts.
     * @returns {Promise<Object>} Summary of drift scan results
     */
    const runDriftScan = async () => {
      const drifted = await getDriftedPrompts();

      for (const item of drifted) {
        await triggerReoptimization(item.promptId, {
          scoreDrop: item.scoreDrop,
          successDrop: item.successDrop,
          baseline: item.baseline,
          recent: item.recent
        });
      }

      const summary = {
        scanned: true,
        driftedCount: drifted.length,
        reoptimizationQueued: drifted.length,
        timestamp: Date.now()
      };

      EventBus.emit('prompt:memory:drift-scan', summary);

      return summary;
    };

    // --- Event Handlers ---

    const handleGEPAComplete = async (event) => {
      // Log completion of GEPA evolution
      if (event.frontierSize > 0) {
        logger.debug('[PromptMemory] GEPA generation complete', {
          generation: event.generation,
          frontierSize: event.frontierSize,
          bestScores: event.bestScores
        });
      }
    };

    // --- Maintenance ---

    const getStats = async () => {
      const memoryStats = await SemanticMemory.getStats();

      // Count prompt memories
      let promptCount = 0;
      let totalFitness = 0;

      try {
        const results = await SemanticMemory.search('prompt optimization', {
          topK: CONFIG.maxHistoricalPrompts,
          minSimilarity: 0
        });

        const prompts = results.filter(r => r.domain === CONFIG.promptDomain);
        promptCount = prompts.length;
        totalFitness = prompts.reduce((sum, p) => sum + (p.metadata?.fitness?.composite || 0), 0);
      } catch (err) {
        // Ignore search errors
      }

      return {
        initialized: _isInitialized,
        promptCount,
        avgFitness: promptCount > 0 ? totalFitness / promptCount : 0,
        performancePath: CONFIG.performancePath,
        driftThreshold: CONFIG.driftThreshold
      };
    };

    const clear = async () => {
      // Clear performance data
      try {
        const files = await VFS.readdir(CONFIG.performancePath);
        for (const file of files) {
          await VFS.delete(`${CONFIG.performancePath}${file}`);
        }
      } catch (err) {
        // Ignore errors
      }

      logger.info('[PromptMemory] Cleared performance data');
    };

    return {
      init,
      // Prompt Storage
      storeEvolvedPrompt,
      getPromptsForTaskType,
      getPromptById,
      // Transfer Learning
      getSeedPrompts,
      buildSeededPopulation,
      // Performance Tracking
      recordPerformance,
      checkDrift,
      getDriftedPrompts,
      triggerReoptimization,
      runDriftScan,
      // Maintenance
      getStats,
      clear
    };
  }
};

export default PromptMemory;
