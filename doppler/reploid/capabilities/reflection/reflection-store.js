/**
 * @fileoverview Reflection Store
 * Persists insights, errors, and success patterns to VFS.
 */

const ReflectionStore = {
  metadata: {
    id: 'ReflectionStore',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const STORE_PATH = '/.memory/reflections.json';
    const GENOME_PATH = '/.memory/genomes.json';
    const ADAPTER_STATS_PATH = '/.memory/adapter-stats.json';

    let _cache = [];
    let _genomes = {};      // { taskType: { generations: [...] } }
    let _adapterStats = {}; // { taskType:adapterId: { successes, attempts } }

    const init = async () => {
      // Load reflections
      if (await VFS.exists(STORE_PATH)) {
        try {
          const content = await VFS.read(STORE_PATH);
          _cache = JSON.parse(content);
        } catch (e) {
          logger.error('[Reflection] Corrupt store, resetting.', e);
          _cache = [];
        }
      }

      // Load genomes
      if (await VFS.exists(GENOME_PATH)) {
        try {
          const content = await VFS.read(GENOME_PATH);
          _genomes = JSON.parse(content);
        } catch (e) {
          logger.error('[Reflection] Corrupt genome store, resetting.', e);
          _genomes = {};
        }
      }

      // Load adapter stats
      if (await VFS.exists(ADAPTER_STATS_PATH)) {
        try {
          const content = await VFS.read(ADAPTER_STATS_PATH);
          _adapterStats = JSON.parse(content);
        } catch (e) {
          logger.error('[Reflection] Corrupt adapter stats, resetting.', e);
          _adapterStats = {};
        }
      }

      return true;
    };

    const add = async (entry) => {
      const reflection = {
        id: generateId('ref'),
        ts: Date.now(),
        type: entry.type || 'insight', // 'insight', 'error', 'success'
        content: entry.content,
        context: entry.context || {},
        // Enriched fields for Analyzer
        tags: entry.tags || [],
        description: entry.description || entry.content
      };

      _cache.push(reflection);

      // Simple persistence (no debouncing in core to avoid async complexity)
      await _save();

      EventBus.emit('reflection:added', reflection);
      logger.info(`[Reflection] Added: ${entry.type}`);
      return reflection.id;
    };

    const query = (filterFn) => {
      return _cache.filter(filterFn);
    };

    const getReflections = async (options = {}) => {
      let results = [..._cache];

      if (options.outcome) {
        results = results.filter(r => r.context?.outcome === options.outcome);
      }

      results.sort((a, b) => b.ts - a.ts);

      if (options.limit) {
        results = results.slice(0, options.limit);
      }

      return results;
    };

    const _save = async () => {
      // Ensure directory exists
      if (!await VFS.exists('/.memory')) {
          await VFS.mkdir('/.memory');
      }
      await VFS.write(STORE_PATH, JSON.stringify(_cache, null, 2));
    };

    const _saveGenomes = async () => {
      if (!await VFS.exists('/.memory')) {
        await VFS.mkdir('/.memory');
      }
      await VFS.write(GENOME_PATH, JSON.stringify(_genomes, null, 2));
    };

    const _saveAdapterStats = async () => {
      if (!await VFS.exists('/.memory')) {
        await VFS.mkdir('/.memory');
      }
      await VFS.write(ADAPTER_STATS_PATH, JSON.stringify(_adapterStats, null, 2));
    };

    // ─────────────────────────────────────────────────────────────────────────
    // FunctionGemma Genome Storage
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Store a winning network configuration (genome).
     * Keeps top 10 configurations per task type.
     * @param {string} taskType - Type of task (e.g., 'react-component', 'api-endpoint')
     * @param {Object} genome - Network configuration to store
     * @param {number} fitness - Fitness score (higher is better)
     */
    const storeNetworkGenome = async (taskType, genome, fitness) => {
      if (!_genomes[taskType]) {
        _genomes[taskType] = { generations: [] };
      }

      _genomes[taskType].generations.push({
        genome,
        fitness,
        timestamp: Date.now()
      });

      // Keep top 10 configurations sorted by fitness
      _genomes[taskType].generations.sort((a, b) => b.fitness - a.fitness);
      _genomes[taskType].generations = _genomes[taskType].generations.slice(0, 10);

      await _saveGenomes();

      EventBus.emit('reflection:genome:stored', {
        taskType,
        fitness,
        totalGenomes: _genomes[taskType].generations.length
      });

      logger.info(`[Reflection] Genome stored for ${taskType} (fitness: ${fitness.toFixed(3)})`);
    };

    /**
     * Get the best genome for a task type.
     * @param {string} taskType - Type of task
     * @returns {Object|null} Best genome or null if none stored
     */
    const getBestGenome = (taskType) => {
      const stored = _genomes[taskType];
      return stored?.generations[0]?.genome || null;
    };

    /**
     * Get all genomes for a task type.
     * @param {string} taskType - Type of task
     * @returns {Array} Array of { genome, fitness, timestamp }
     */
    const getGenomes = (taskType) => {
      return _genomes[taskType]?.generations || [];
    };

    // ─────────────────────────────────────────────────────────────────────────
    // UCB1 Adapter Selection
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Update success/failure stats for an adapter.
     * @param {string} taskType - Type of task
     * @param {string} adapterId - Adapter identifier
     * @param {boolean} success - Whether the adapter succeeded
     */
    const updateAdapterStats = async (taskType, adapterId, success) => {
      const key = `${taskType}:${adapterId}`;

      if (!_adapterStats[key]) {
        _adapterStats[key] = { successes: 0, attempts: 0 };
      }

      _adapterStats[key].attempts++;
      if (success) {
        _adapterStats[key].successes++;
      }

      await _saveAdapterStats();

      EventBus.emit('reflection:adapter:updated', {
        taskType,
        adapterId,
        success,
        stats: _adapterStats[key]
      });
    };

    /**
     * Get stats for an adapter.
     * @param {string} taskType - Type of task
     * @param {string} adapterId - Adapter identifier
     * @returns {Object} { successes, attempts }
     */
    const getAdapterStats = (taskType, adapterId) => {
      const key = `${taskType}:${adapterId}`;
      return _adapterStats[key] || { successes: 0, attempts: 0 };
    };

    /**
     * Select the best adapter using UCB1 algorithm.
     * Balances exploitation (high success rate) with exploration (less-tried adapters).
     * @param {string} taskType - Type of task
     * @param {Array<string>} adapterIds - Available adapter IDs
     * @param {number} explorationWeight - UCB1 exploration parameter (default: 2)
     * @returns {string} Selected adapter ID
     */
    const selectAdapterUCB1 = (taskType, adapterIds, explorationWeight = 2) => {
      if (!adapterIds || adapterIds.length === 0) {
        return null;
      }

      // Calculate total attempts across all adapters
      let totalAttempts = 0;
      for (const adapterId of adapterIds) {
        const stats = getAdapterStats(taskType, adapterId);
        totalAttempts += stats.attempts;
      }

      // If no attempts yet, return random adapter
      if (totalAttempts === 0) {
        return adapterIds[Math.floor(Math.random() * adapterIds.length)];
      }

      // Calculate UCB1 score for each adapter
      let bestScore = -Infinity;
      let bestAdapter = adapterIds[0];

      for (const adapterId of adapterIds) {
        const stats = getAdapterStats(taskType, adapterId);

        // If adapter never tried, give it highest priority (infinite UCB)
        if (stats.attempts === 0) {
          return adapterId;
        }

        // UCB1 formula: mean + sqrt(explorationWeight * ln(total) / attempts)
        const mean = stats.successes / stats.attempts;
        const exploration = Math.sqrt(
          (explorationWeight * Math.log(totalAttempts)) / stats.attempts
        );
        const ucbScore = mean + exploration;

        if (ucbScore > bestScore) {
          bestScore = ucbScore;
          bestAdapter = adapterId;
        }
      }

      return bestAdapter;
    };

    return {
      init,
      add,
      query,
      getReflections,
      // Genome storage
      storeNetworkGenome,
      getBestGenome,
      getGenomes,
      // Adapter selection
      updateAdapterStats,
      getAdapterStats,
      selectAdapterUCB1
    };
  }
};

export default ReflectionStore;
