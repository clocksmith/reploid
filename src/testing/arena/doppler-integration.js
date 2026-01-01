/**
 * @fileoverview Doppler-Arena Integration
 * Wires Doppler inference with LoRA adapters to ArenaHarness for
 * competitive expert pool evaluation.
 *
 * Key Features:
 * - Connect adapter loading to ArenaHarness expert pools
 * - Enable arena competitions with different LoRA adapters
 * - Measure passRate with adapter switching
 * - Support adapter composition (merge strategies)
 */

const DopplerArenaIntegration = {
  metadata: {
    id: 'DopplerArenaIntegration',
    version: '1.0.0',
    dependencies: ['ArenaHarness', 'Utils', 'EventBus'],
    optional: ['LLMClient'],
    type: 'testing'
  },

  factory: (deps) => {
    const { ArenaHarness, Utils, EventBus, LLMClient } = deps;
    const { logger, generateId } = Utils;

    // Doppler provider reference (lazy loaded)
    let _dopplerProvider = null;
    let _baseModelId = null;
    let _adapterCache = new Map();

    /**
     * Initialize Doppler provider
     */
    const initDoppler = async () => {
      if (_dopplerProvider?.getCapabilities?.()?.initialized) {
        return _dopplerProvider;
      }

      try {
        // Try dynamic import for Doppler
        const { DopplerProvider } = await import('@clocksmith/doppler/provider');
        _dopplerProvider = DopplerProvider;

        if (!_dopplerProvider.getCapabilities().initialized) {
          await _dopplerProvider.init();
        }

        if (!_dopplerProvider.getCapabilities().available) {
          throw new Error('Doppler not available - WebGPU may not be supported');
        }

        logger.info('[DopplerArena] Doppler initialized');
        return _dopplerProvider;
      } catch (err) {
        logger.warn('[DopplerArena] Doppler not available, using LLMClient fallback');
        return null;
      }
    };

    /**
     * Load base model for adapter competitions
     */
    const loadBaseModel = async (modelId, modelUrl = null, options = {}) => {
      const provider = await initDoppler();
      if (!provider) {
        throw new Error('Doppler provider not available');
      }

      const caps = provider.getCapabilities();
      if (caps.currentModelId !== modelId) {
        logger.info(`[DopplerArena] Loading base model: ${modelId}`);
        await provider.loadModel(modelId, modelUrl, options.onProgress);
      }

      _baseModelId = modelId;
      return true;
    };

    /**
     * Load and cache a LoRA adapter
     */
    const loadAdapter = async (adapterId, adapterManifest) => {
      const provider = await initDoppler();
      if (!provider) {
        throw new Error('Doppler provider not available');
      }

      // Cache adapter for quick switching
      _adapterCache.set(adapterId, adapterManifest);

      await provider.loadLoRAAdapter(adapterManifest);
      logger.info(`[DopplerArena] Loaded adapter: ${adapterId}`);

      return adapterId;
    };

    /**
     * Switch to a different adapter (hot-swap)
     */
    const switchAdapter = async (adapterId) => {
      const provider = await initDoppler();
      if (!provider) {
        throw new Error('Doppler provider not available');
      }

      if (!_adapterCache.has(adapterId) && adapterId !== null) {
        throw new Error(`Adapter not loaded: ${adapterId}`);
      }

      // null means no adapter (base model only)
      if (adapterId === null) {
        await provider.unloadLoRAAdapter();
        logger.info('[DopplerArena] Switched to base model (no adapter)');
      } else {
        const manifest = _adapterCache.get(adapterId);
        await provider.loadLoRAAdapter(manifest);
        logger.info(`[DopplerArena] Switched to adapter: ${adapterId}`);
      }

      return adapterId;
    };

    /**
     * Run inference with current adapter
     */
    const runInference = async (prompt, options = {}) => {
      const provider = await initDoppler();
      if (!provider) {
        // Fallback to LLMClient if available
        if (LLMClient) {
          return LLMClient.chat(
            [{ role: 'user', content: prompt }],
            { provider: 'doppler', maxTokens: options.maxTokens || 256 }
          );
        }
        throw new Error('No inference provider available');
      }

      const messages = [
        { role: 'system', content: options.systemPrompt || 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ];

      const startTime = performance.now();
      const result = await provider.chat(messages, {
        maxTokens: options.maxTokens || 256,
        temperature: options.temperature || 0.7,
        topP: options.topP,
        topK: options.topK,
      });
      const durationMs = performance.now() - startTime;

      return {
        content: result.content,
        durationMs,
        tokensGenerated: result.usage?.completionTokens || 0,
        tokPerSec: result.usage?.completionTokens / (durationMs / 1000) || 0,
        adapter: provider.getActiveLoRA?.() || null,
      };
    };

    /**
     * Create expert configuration for arena competition
     */
    const createExpert = (adapterId, options = {}) => {
      return {
        id: adapterId || 'base-model',
        adapter: adapterId,
        name: options.name || adapterId || 'Base Model',
        modelId: _baseModelId,
        weight: options.weight || 1.0,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      };
    };

    /**
     * Run arena expert pool competition with adapters
     *
     * @param {Object} task - Task configuration
     * @param {string} task.prompt - The prompt to evaluate
     * @param {Object} task.schema - Optional JSON schema for output validation
     * @param {number} task.maxTokens - Max tokens per response
     * @param {Array} experts - Array of expert configs (each has adapterId)
     * @param {Object} options - Additional options
     * @returns {Object} Competition results with winner and rankings
     */
    const runAdapterCompetition = async (task, experts, options = {}) => {
      if (!experts || experts.length === 0) {
        throw new Error('At least one expert required');
      }

      const runId = generateId('arena-adapter');
      logger.info(`[DopplerArena] Starting adapter competition: ${experts.length} experts`);

      EventBus.emit('arena:adapter:start', {
        runId,
        expertCount: experts.length,
        task: task.prompt?.slice(0, 100),
      });

      const results = [];

      for (const expert of experts) {
        const expertResult = {
          expert,
          output: null,
          score: { score: 0, valid: true, errors: [] },
          durationMs: 0,
          tokPerSec: 0,
        };

        try {
          // Switch to this expert's adapter
          await switchAdapter(expert.adapter);

          // Run inference
          const startTime = performance.now();
          const inferenceResult = await runInference(task.prompt, {
            maxTokens: task.maxTokens || expert.maxTokens || 256,
            temperature: task.temperature || expert.temperature || 0.7,
            systemPrompt: task.systemPrompt,
          });

          expertResult.output = inferenceResult.content;
          expertResult.durationMs = inferenceResult.durationMs;
          expertResult.tokPerSec = inferenceResult.tokPerSec;

          // Score the output
          expertResult.score = ArenaHarness.scoreOutput
            ? ArenaHarness.scoreOutput(inferenceResult.content, task, options)
            : { score: 0.5, valid: true, errors: [] };

          logger.info(`[DopplerArena] Expert ${expert.id}: score=${expertResult.score.score.toFixed(2)}, ${expertResult.tokPerSec.toFixed(1)} tok/s`);
        } catch (err) {
          expertResult.score = { score: 0, valid: false, errors: [err.message] };
          logger.error(`[DopplerArena] Expert ${expert.id} failed: ${err.message}`);
        }

        results.push(expertResult);
      }

      // Sort by score (descending)
      results.sort((a, b) => b.score.score - a.score.score);

      const winner = results[0];
      const summary = {
        runId,
        totalExperts: experts.length,
        passedExperts: results.filter(r => r.score.valid).length,
        winnerExpert: winner.expert.id,
        winnerScore: winner.score.score,
        winnerTokPerSec: winner.tokPerSec,
        passRate: (results.filter(r => r.score.valid && r.score.score > 0.5).length / experts.length) * 100,
      };

      EventBus.emit('arena:adapter:complete', {
        runId,
        summary,
        winner: winner.expert.id,
      });

      return {
        winner,
        results,
        summary,
      };
    };

    /**
     * Merge multiple LoRA adapters using different strategies
     *
     * @param {Array} adapters - Array of { id, manifest, weight }
     * @param {string} strategy - 'add', 'lerp', 'ties', 'dare'
     * @returns {Object} Merged adapter manifest
     */
    const mergeAdapters = (adapters, strategy = 'lerp') => {
      if (adapters.length === 0) {
        throw new Error('At least one adapter required for merge');
      }

      if (adapters.length === 1) {
        return adapters[0].manifest;
      }

      logger.info(`[DopplerArena] Merging ${adapters.length} adapters with strategy: ${strategy}`);

      // Validate all adapters have same structure
      const first = adapters[0].manifest;
      const rank = first.rank;
      const alpha = first.alpha;

      for (const { manifest } of adapters) {
        if (manifest.rank !== rank) {
          throw new Error('All adapters must have same rank for merging');
        }
      }

      // Merge tensors based on strategy
      const mergedTensors = [];
      const tensorsByName = new Map();

      // Group tensors by name
      for (const { manifest, weight } of adapters) {
        for (const tensor of manifest.tensors || []) {
          if (!tensorsByName.has(tensor.name)) {
            tensorsByName.set(tensor.name, []);
          }
          tensorsByName.get(tensor.name).push({ tensor, weight });
        }
      }

      // Merge each tensor group
      for (const [name, tensors] of tensorsByName) {
        const shape = tensors[0].tensor.shape;
        const totalElements = shape[0] * shape[1];

        // Get data arrays
        const dataArrays = tensors.map(({ tensor, weight }) => {
          let data;
          if (tensor.data) {
            data = new Float32Array(tensor.data);
          } else if (tensor.base64) {
            // Decode base64
            const binary = atob(tensor.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            data = new Float32Array(bytes.buffer);
          } else {
            throw new Error(`Tensor ${name} missing data for merge`);
          }
          return { data, weight };
        });

        // Apply merge strategy
        const merged = new Float32Array(totalElements);

        switch (strategy) {
          case 'add':
            // Simple addition: sum all weighted tensors
            for (const { data, weight } of dataArrays) {
              for (let i = 0; i < totalElements; i++) {
                merged[i] += data[i] * weight;
              }
            }
            break;

          case 'lerp':
            // Linear interpolation (normalized weights)
            const totalWeight = dataArrays.reduce((sum, { weight }) => sum + weight, 0);
            for (const { data, weight } of dataArrays) {
              const normalizedWeight = weight / totalWeight;
              for (let i = 0; i < totalElements; i++) {
                merged[i] += data[i] * normalizedWeight;
              }
            }
            break;

          case 'ties':
            // TIES merging: trim, elect, sign, merge
            // Simplified version: keep values where majority agree on sign
            for (let i = 0; i < totalElements; i++) {
              let positiveCount = 0;
              let negativeCount = 0;
              let positiveSum = 0;
              let negativeSum = 0;

              for (const { data, weight } of dataArrays) {
                if (data[i] > 0) {
                  positiveCount++;
                  positiveSum += data[i] * weight;
                } else if (data[i] < 0) {
                  negativeCount++;
                  negativeSum += data[i] * weight;
                }
              }

              if (positiveCount > negativeCount) {
                merged[i] = positiveSum / positiveCount;
              } else if (negativeCount > positiveCount) {
                merged[i] = negativeSum / negativeCount;
              }
              // else: zero (disagreement)
            }
            break;

          case 'dare':
            // DARE: Drop And REscale - randomly drop some values
            const dropRate = 0.1; // 10% drop rate
            const rescale = 1 / (1 - dropRate);

            for (const { data, weight } of dataArrays) {
              for (let i = 0; i < totalElements; i++) {
                if (Math.random() > dropRate) {
                  merged[i] += data[i] * weight * rescale;
                }
              }
            }

            // Normalize
            const dareTotal = dataArrays.reduce((sum, { weight }) => sum + weight, 0);
            for (let i = 0; i < totalElements; i++) {
              merged[i] /= dareTotal;
            }
            break;

          default:
            throw new Error(`Unknown merge strategy: ${strategy}`);
        }

        mergedTensors.push({
          name,
          shape,
          dtype: 'f32',
          data: Array.from(merged),
        });
      }

      return {
        name: `merged-${strategy}-${adapters.length}adapters`,
        version: '1.0.0',
        baseModel: first.baseModel,
        rank,
        alpha,
        targetModules: first.targetModules,
        tensors: mergedTensors,
      };
    };

    /**
     * Run A/B test between adapters
     */
    const runABTest = async (task, adapterA, adapterB, options = {}) => {
      const numTrials = options.trials || 5;
      const results = { a: [], b: [] };

      for (let i = 0; i < numTrials; i++) {
        // Randomize order to avoid position bias
        const aFirst = Math.random() > 0.5;
        const first = aFirst ? adapterA : adapterB;
        const second = aFirst ? adapterB : adapterA;

        // Run first
        await switchAdapter(first);
        const firstResult = await runInference(task.prompt, task);

        // Run second
        await switchAdapter(second);
        const secondResult = await runInference(task.prompt, task);

        // Record results
        if (aFirst) {
          results.a.push(firstResult);
          results.b.push(secondResult);
        } else {
          results.b.push(firstResult);
          results.a.push(secondResult);
        }
      }

      // Compute statistics
      const avgA = results.a.reduce((sum, r) => sum + r.tokPerSec, 0) / numTrials;
      const avgB = results.b.reduce((sum, r) => sum + r.tokPerSec, 0) / numTrials;

      return {
        adapterA: {
          id: adapterA,
          avgTokPerSec: avgA,
          results: results.a,
        },
        adapterB: {
          id: adapterB,
          avgTokPerSec: avgB,
          results: results.b,
        },
        winner: avgA > avgB ? adapterA : adapterB,
        speedupPercent: ((Math.max(avgA, avgB) - Math.min(avgA, avgB)) / Math.min(avgA, avgB)) * 100,
      };
    };

    /**
     * Get current adapter status
     */
    const getStatus = async () => {
      const provider = await initDoppler().catch(() => null);
      if (!provider) {
        return {
          available: false,
          baseModel: null,
          activeAdapter: null,
          cachedAdapters: [],
        };
      }

      return {
        available: true,
        baseModel: _baseModelId,
        activeAdapter: provider.getActiveLoRA?.() || null,
        cachedAdapters: Array.from(_adapterCache.keys()),
        capabilities: provider.getCapabilities(),
      };
    };

    /**
     * Clean up resources
     */
    const cleanup = async () => {
      _adapterCache.clear();
      if (_dopplerProvider?.destroy) {
        await _dopplerProvider.destroy();
      }
      _dopplerProvider = null;
      _baseModelId = null;
      logger.info('[DopplerArena] Cleaned up');
    };

    return {
      initDoppler,
      loadBaseModel,
      loadAdapter,
      switchAdapter,
      runInference,
      createExpert,
      runAdapterCompetition,
      mergeAdapters,
      runABTest,
      getStatus,
      cleanup,
    };
  }
};

export default DopplerArenaIntegration;
