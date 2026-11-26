import { createGepaEvaluation } from './gepa-evaluation.js';
import { createGepaReflection } from './gepa-reflection.js';
import { createGepaSelection } from './gepa-selection.js';
/**
 * @fileoverview GEPA Optimizer
 * Genetic Evolution of Prompt Architectures (GEPA)
 * Multi-objective Pareto prompt evolution with execution trace reflection.
 *
 * Features:
 * - Evaluation Engine: Run prompts against test cases, collect execution traces
 * - Reflection Engine: LLM analyzes failures, suggests prompt improvements
 * - NSGA-II Selection: Pareto-optimal selection on multiple objectives
 * - VFS Checkpoints: Save/resume population state
 * - Transfer Learning: Seed population from historical prompts via PromptMemory
 *
 * @see Blueprint 0x000067: Genetic Evolution of Prompt Architectures
 */

const GEPAOptimizer = {
  metadata: {
    id: 'GEPAOptimizer',
    version: '2.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['LLMClient', 'EventBus', 'Utils', 'VFS', 'PersonaManager?', 'ArenaHarness?', 'PromptMemory?', 'HITLController?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { LLMClient, EventBus, Utils, VFS, PersonaManager, ArenaHarness, PromptMemory, HITLController } = deps;
    const { logger, Errors, generateId, sanitizeLlmJsonRespPure } = Utils;

    // Load boot config from localStorage if available
    const bootConfig = typeof window !== 'undefined' && window.getGEPAConfig
      ? window.getGEPAConfig()
      : {};

    const DEFAULTS = {
      populationSize: bootConfig.populationSize ?? 6,
      maxGenerations: bootConfig.maxGenerations ?? 5,
      mutationRate: bootConfig.mutationRate ?? 0.3,
      crossoverRate: bootConfig.crossoverRate ?? 0.5,
      eliteCount: bootConfig.eliteCount ?? 2,
      objectives: ['accuracy', 'efficiency', 'robustness', 'cost'],
      objectiveWeights: {
        accuracy: 1.0,
        efficiency: 0.8,
        robustness: 0.9,
        cost: 0.6
      },
      evaluationBatchSize: 6,
      maxReflectionSamples: 5,
      checkpointPath: '/.memory/gepa/',
      matchMode: bootConfig.matchMode ?? 'exact',
      // Evaluation engine settings
      evalTimeout: 30000,        // 30s timeout per evaluation
      evalRetries: 2,           // Retries on transient failures
      cacheEvaluations: true,   // Cache evaluation results
      // Reflection engine settings
      reflectionDepth: 'detailed',  // 'basic', 'detailed', 'comprehensive'
      maxReflectionRetries: 1,
      // NSGA-II settings
      nsgaConvergenceThreshold: 0.01,
      nsgaMaxStagnantGens: 3
    };

    let _population = [];
    let _paretoFrontier = [];
    let _generation = 0;
    let _reflectionCache = new Map();
    let _evaluationCache = new Map();
    let _stagnantGenerations = 0;
    let _previousBestScores = null;

    // =========================================================================
    // EVALUATION ENGINE
    // Runs prompts against test cases, collects detailed execution traces
    // =========================================================================

    const EvaluationEngine = createGepaEvaluation({ cache: _evaluationCache, policy: DEFAULTS, generateId, logger, LLMClient,
      evaluateResponse: (...args) => evaluateResponse(...args), classifyError: (...args) => classifyError(...args),
      Errors, PersonaManager, avg: (...args) => avg(...args) });

    // =========================================================================
    // REFLECTION ENGINE
    // Analyzes failures and suggests targeted prompt improvements
    // =========================================================================

    const ReflectionEngine = createGepaReflection({ cache: _reflectionCache, policy: DEFAULTS, Errors, logger, LLMClient, sanitizeLlmJsonRespPure });

    const ensureVfsPath = async (path) => {
      if (!VFS) return;
      if (!await VFS.exists(path)) {
        await VFS.mkdir(path);
      }
    };

    const createCandidate = (content, generation, parentIds = [], meta = {}) => ({
      id: generateId('gepa'),
      content,
      generation,
      parentIds,
      scores: {},
      dominatedBy: 0,
      crowdingDistance: 0,
      targetType: meta.targetType || 'prompt',
      payload: meta.payload || null,
      mutationType: meta.mutationType || 'seed',
      appliedReflections: meta.appliedReflections || []
    });

    const normalizeText = (text) => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();

    const evaluateResponse = (actual, expected, matchMode = DEFAULTS.matchMode) => {
      if (expected === undefined || expected === null) return true;
      const actualNorm = normalizeText(actual);
      const expectedNorm = normalizeText(expected);
      if (matchMode === 'includes') {
        return actualNorm.includes(expectedNorm);
      }
      return actualNorm === expectedNorm;
    };

    /**
     * Classify error type based on actual vs expected output.
     * Provides detailed categorization for reflection engine.
     */
    const classifyError = (actual, expected) => {
      if (expected === undefined || expected === null) return 'unknown';
      if (!actual || actual.trim() === '') return 'empty_response';

      const actualNorm = normalizeText(actual);
      const expectedNorm = normalizeText(expected);

      // Check for partial match
      if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) {
        return 'partial_match';
      }

      // Check for format issues (JSON parsing, etc)
      try {
        JSON.parse(expected);
        try {
          JSON.parse(actual);
        } catch {
          return 'format_error';
        }
      } catch {
        // Expected wasn't JSON, continue
      }

      // Check for semantic similarity hints
      const actualWords = new Set(actualNorm.split(/\s+/));
      const expectedWords = new Set(expectedNorm.split(/\s+/));
      const overlap = [...actualWords].filter(w => expectedWords.has(w)).length;
      const unionSize = new Set([...actualWords, ...expectedWords]).size;
      const jaccard = overlap / (unionSize || 1);

      if (jaccard > 0.5) return 'semantic_drift';
      if (jaccard > 0.2) return 'partial_understanding';

      return 'mismatch';
    };

    const avg = (values) => {
      if (!values.length) return 0;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };

    const sampleTasks = (taskSet, batchSize) => {
      if (!Array.isArray(taskSet)) return [];
      if (taskSet.length <= batchSize) return taskSet;
      const shuffled = [...taskSet].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, batchSize);
    };

    /**
     * Evaluate candidates using the EvaluationEngine.
     * Wraps EvaluationEngine.evaluateBatch with validation.
     */
    const evaluate = async (candidates, taskBatch, config) => {
      if (!config.evaluationModel) {
        throw new Errors.ConfigError('GEPA evaluationModel is required');
      }
      if (!taskBatch.length) {
        throw new Errors.ValidationError('GEPA taskBatch is empty');
      }

      return EvaluationEngine.evaluateBatch(candidates, taskBatch, config);
    };

    /**
     * Generate reflections using the ReflectionEngine.
     * Wraps ReflectionEngine.analyze with validation.
     */
    const reflect = async (evaluationResults, config) => {
      return ReflectionEngine.analyze(evaluationResults, config);
    };

    const applyAddition = (content, mod) => `${content}\n\n${mod.content}`.trim();
    const applyRemoval = (content, mod) => content.replace(mod.target, '').trim();
    const applyReplacement = (content, mod) => {
      if (!content.includes(mod.target)) {
        return `${content}\n\n${mod.content}`.trim();
      }
      return content.replace(mod.target, mod.content).trim();
    };

    const randomMutate = (candidate) => {
      const suffix = `\n\n[Mutation ${generateId('mut')}]: Be concise and verify outputs.`;
      return createCandidate(candidate.content + suffix, candidate.generation + 1, [candidate.id], {
        mutationType: 'random',
        targetType: candidate.targetType || 'prompt',
        payload: candidate.payload || null
      });
    };

    const mutatePrompt = (candidate, reflections) => {
      const applicable = reflections.filter(r =>
        candidate.traces?.some(t => t.errorType === r.errorType)
      );

      if (applicable.length === 0) {
        return randomMutate(candidate);
      }

      let mutatedContent = candidate.content;
      for (const reflection of applicable) {
        for (const mod of reflection.modifications || []) {
          switch (mod.type) {
            case 'add':
              mutatedContent = applyAddition(mutatedContent, mod);
              break;
            case 'remove':
              mutatedContent = applyRemoval(mutatedContent, mod);
              break;
            case 'replace':
              mutatedContent = applyReplacement(mutatedContent, mod);
              break;
          }
        }
      }

      return createCandidate(mutatedContent, candidate.generation + 1, [candidate.id], {
        mutationType: 'reflection_guided',
        appliedReflections: applicable.map(r => r.errorType),
        targetType: candidate.targetType || 'prompt',
        payload: candidate.payload || null
      });
    };

    const mutate = (candidate, reflections) => {
      const targetType = candidate.targetType || 'prompt';
      if (targetType === 'prompt' || targetType === 'persona_slot') {
        return mutatePrompt(candidate, reflections);
      }
      throw new Errors.ConfigError(`Unsupported target type: ${targetType}`);
    };

    const parsePromptSections = (content) => {
      const sections = {};
      const lines = String(content || '').split('\n');
      let current = 'default';
      sections[current] = [];
      for (const line of lines) {
        if (line.startsWith('# ')) {
          current = line.substring(2).trim();
          sections[current] = [];
        } else {
          sections[current].push(line);
        }
      }
      return sections;
    };

    const assembleSections = (sections) => {
      return Object.entries(sections)
        .map(([name, lines]) => {
          if (name === 'default') return lines.join('\n');
          return `# ${name}\n${lines.join('\n')}`;
        })
        .join('\n\n')
        .trim();
    };

    const crossover = (parent1, parent2) => {
      const sections1 = parsePromptSections(parent1.content);
      const sections2 = parsePromptSections(parent2.content);
      const childSections = {};

      const allKeys = new Set([...Object.keys(sections1), ...Object.keys(sections2)]);
      for (const key of allKeys) {
        const score1 = parent1.scores?.accuracy || 0;
        const score2 = parent2.scores?.accuracy || 0;
        const total = score1 + score2 || 1;
        const takeFirst = Math.random() < (score1 / total);
        childSections[key] = takeFirst ? (sections1[key] || []) : (sections2[key] || []);
      }

      return createCandidate(assembleSections(childSections), Math.max(parent1.generation, parent2.generation) + 1, [
        parent1.id,
        parent2.id
      ], {
        mutationType: 'crossover',
        targetType: parent1.targetType || 'prompt',
        payload: parent1.payload || null
      });
    };

    const loadSafePrompts = async (path) => {
      if (!VFS) return { prompts: [] };
      try {
        if (await VFS.exists(path)) {
          const content = await VFS.read(path);
          const parsed = JSON.parse(content);
          return { prompts: parsed?.prompts || [], updatedAt: parsed?.updatedAt || Date.now() };
        }
      } catch (err) {
        logger.warn('[GEPA] Failed to load safe prompts', err.message);
      }
      return { prompts: [], updatedAt: Date.now() };
    };

    const saveSafePrompts = async (path, data) => {
      if (!VFS) return false;
      await ensureVfsPath(path.substring(0, path.lastIndexOf('/')));
      const payload = {
        updatedAt: Date.now(),
        prompts: data.prompts || []
      };
      await VFS.write(path, JSON.stringify(payload, null, 2));
      return true;
    };

    const requestPersonaAdoption = ({ personaId, slot, content, candidateId }) => {
      if (!HITLController?.requestApproval) {
        logger.warn('[GEPA] Persona change not applied: no HITL controller to collect operator adoption');
        return { applied: false, status: 'not-applied', reason: 'operator adoption unavailable' };
      }
      const apply = async () => {
        await PersonaManager.applySlotMutation({ personaId, slot, content, mode: 'replace' });
        EventBus?.emit?.('gepa:persona:adopted', { personaId, slot, candidateId });
      };
      HITLController.registerModule?.('GEPAOptimizer', ['approve_persona_change'], 'GEPA - apply an evolved prompt to a persona');
      const approvalId = HITLController.requestApproval({
        moduleId: 'GEPAOptimizer',
        capability: 'approve_persona_change',
        action: `Replace persona ${personaId} ${slot} with evolved candidate ${candidateId}`,
        data: { personaId, slot, candidateId, content },
        alwaysRequireHuman: true,
        onApprove: () => apply().catch(error => logger.error('[GEPA] Adopted persona change failed', error)),
        onReject: (reason) => logger.info(`[GEPA] Persona change for ${personaId} rejected: ${reason}`)
      });
      return { applied: false, status: 'awaiting-adoption', approvalId };
    };

    const promoteCandidate = async (candidate, options = {}) => {
      if (!candidate) return { promoted: false, error: 'No candidate provided' };
      const storagePath = options.storagePath || '/.memory/gepa/safe-prompts.json';
      const current = await loadSafePrompts(storagePath);
      const entry = {
        id: candidate.id,
        targetType: candidate.targetType || 'prompt',
        payload: candidate.payload || null,
        content: candidate.content,
        scores: candidate.scores || {},
        generation: candidate.generation || 0,
        promotedAt: Date.now()
      };
      const prompts = current.prompts.filter(p => p.id !== candidate.id);
      prompts.unshift(entry);
      const next = { prompts };
      const nextContent = JSON.stringify({ updatedAt: Date.now(), prompts }, null, 2);

      if (options.arenaValidate && ArenaHarness?.verifySolution) {
        const verification = await ArenaHarness.verifySolution({
          solution: nextContent,
          parseChanges: (solution) => ({ [storagePath]: solution })
        });
        if (!verification.passed) {
          return { promoted: false, passed: false, errors: verification.errors || [verification.error] };
        }
      }

      await saveSafePrompts(storagePath, next);

      // Writing the safe-prompt store records the candidate; changing the live persona changes the
      // agent. A score never grants that: the persona slot changes only after an operator adopts it
      // through the HITL queue (queued even in autonomous mode). Without a controller, nothing is applied.
      let persona = null;
      if (options.applyToPersona && candidate.targetType === 'persona_slot' && PersonaManager?.applySlotMutation) {
        const slot = candidate.payload?.slot || 'instructions';
        const personaId = candidate.payload?.personaId || (await PersonaManager.getPromptSlots()).personaId;
        persona = await requestPersonaAdoption({ personaId, slot, content: candidate.content, candidateId: candidate.id });
      }

      return { promoted: true, passed: true, path: storagePath, ...(persona ? { persona } : {}) };
    };

    // =========================================================================
    // NSGA-II SELECTION ENGINE
    // Pareto-optimal selection with weighted objectives and convergence detection
    // =========================================================================

    const NSGAEngine = createGepaSelection({ policy: DEFAULTS });

    const paretoSelect = (candidates, objectives, targetSize, config = {}) =>
      NSGAEngine.select(candidates, objectives, targetSize, config);


    /**
     * Save checkpoint to VFS with comprehensive metadata.
     * @param {number} generation - Current generation number
     * @param {Array} population - Current population
     * @param {Array} frontier - Current Pareto frontier
     * @param {Object} config - Evolution configuration
     * @param {Object} metadata - Additional metadata
     */
    const saveCheckpoint = async (generation, population, frontier, config, metadata = {}) => {
      if (!VFS) return;
      await ensureVfsPath(config.checkpointPath);
      const path = `${config.checkpointPath}gen_${generation}.json`;

      // Compute checkpoint metrics
      const bestScores = getBestScores(population, config.objectives);
      const hypervolume = NSGAEngine.computeHypervolume(frontier, config.objectives);
      const avgFitness = population.reduce((sum, c) =>
        sum + NSGAEngine.computeCompositeFitness(c, config.objectives, config.objectiveWeights || {}), 0
      ) / (population.length || 1);

      const checkpointData = {
        generation,
        timestamp: Date.now(),
        population: population.map(c => ({
          id: c.id,
          content: c.content,
          generation: c.generation,
          scores: c.scores,
          dominatedBy: c.dominatedBy,
          rank: c.rank,
          crowdingDistance: c.crowdingDistance,
          targetType: c.targetType || 'prompt',
          payload: c.payload || null,
          parentIds: c.parentIds || [],
          mutationType: c.mutationType || 'unknown',
          appliedReflections: c.appliedReflections || []
        })),
        frontier: frontier.map(c => ({
          id: c.id,
          content: c.content,
          generation: c.generation,
          scores: c.scores,
          rank: c.rank,
          targetType: c.targetType || 'prompt'
        })),
        config: {
          populationSize: config.populationSize,
          maxGenerations: config.maxGenerations,
          objectives: config.objectives,
          objectiveWeights: config.objectiveWeights || DEFAULTS.objectiveWeights,
          taskDescription: config.taskDescription || '',
          targetType: config.targetType || 'prompt',
          mutationRate: config.mutationRate,
          crossoverRate: config.crossoverRate,
          eliteCount: config.eliteCount
        },
        metrics: {
          bestScores,
          hypervolume,
          avgFitness,
          frontierSize: frontier.length,
          populationDiversity: calculatePopulationDiversity(population),
          stagnantGenerations: _stagnantGenerations,
          ...metadata
        },
        cacheStats: {
          reflectionCacheSize: _reflectionCache.size,
          evaluationCacheSize: _evaluationCache.size
        }
      };

      await VFS.write(path, JSON.stringify(checkpointData, null, 2));

      EventBus.emit('gepa:checkpoint:saved', {
        generation,
        path,
        frontierSize: frontier.length,
        hypervolume
      });

      return path;
    };

    /**
     * Calculate population diversity using pairwise content similarity.
     * @param {Array} population - Population to analyze
     * @returns {number} Diversity score (0-1, higher = more diverse)
     */
    const calculatePopulationDiversity = (population) => {
      if (population.length < 2) return 1;

      let totalDiff = 0;
      let comparisons = 0;

      for (let i = 0; i < population.length; i++) {
        for (let j = i + 1; j < population.length; j++) {
          const a = population[i].content || '';
          const b = population[j].content || '';
          // Simple Jaccard-like diversity based on word sets
          const wordsA = new Set(a.toLowerCase().split(/\s+/));
          const wordsB = new Set(b.toLowerCase().split(/\s+/));
          const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
          const union = new Set([...wordsA, ...wordsB]).size;
          const similarity = union > 0 ? intersection / union : 0;
          totalDiff += (1 - similarity);
          comparisons++;
        }
      }

      return comparisons > 0 ? totalDiff / comparisons : 1;
    };

    /**
     * Load checkpoint from VFS for resuming evolution.
     * @param {string} checkpointPath - Path to checkpoint directory
     * @param {number} [generation] - Specific generation to load (default: latest)
     * @returns {Promise<Object|null>} Checkpoint data or null if not found
     */
    const loadCheckpoint = async (checkpointPath, generation = null) => {
      if (!VFS) return null;

      try {
        if (generation !== null) {
          const path = `${checkpointPath}gen_${generation}.json`;
          if (await VFS.exists(path)) {
            const content = await VFS.read(path);
            return JSON.parse(content);
          }
          return null;
        }

        // Find latest checkpoint
        if (!await VFS.exists(checkpointPath)) return null;

        const files = await VFS.readdir(checkpointPath);
        const genFiles = files
          .filter(f => f.startsWith('gen_') && f.endsWith('.json'))
          .map(f => ({
            file: f,
            gen: parseInt(f.replace('gen_', '').replace('.json', ''), 10)
          }))
          .filter(f => !isNaN(f.gen))
          .sort((a, b) => b.gen - a.gen);

        if (genFiles.length === 0) return null;

        const latestPath = `${checkpointPath}${genFiles[0].file}`;
        const content = await VFS.read(latestPath);
        return JSON.parse(content);

      } catch (err) {
        logger.warn('[GEPA] Failed to load checkpoint', err.message);
        return null;
      }
    };

    /**
     * List available checkpoints.
     * @param {string} checkpointPath - Path to checkpoint directory
     * @returns {Promise<Array>} List of checkpoint generations with metadata
     */
    const listCheckpoints = async (checkpointPath) => {
      if (!VFS) return [];

      try {
        if (!await VFS.exists(checkpointPath)) return [];

        const files = await VFS.readdir(checkpointPath);
        const checkpoints = [];

        for (const file of files) {
          if (file.startsWith('gen_') && file.endsWith('.json')) {
            const gen = parseInt(file.replace('gen_', '').replace('.json', ''), 10);
            if (!isNaN(gen)) {
              try {
                const content = await VFS.read(`${checkpointPath}${file}`);
                const data = JSON.parse(content);
                checkpoints.push({
                  generation: gen,
                  timestamp: data.timestamp,
                  populationSize: data.population?.length || 0,
                  frontierSize: data.frontier?.length || 0,
                  bestScores: data.metadata?.bestScores || {}
                });
              } catch (e) {
                checkpoints.push({ generation: gen, error: e.message });
              }
            }
          }
        }

        return checkpoints.sort((a, b) => a.generation - b.generation);
      } catch (err) {
        logger.warn('[GEPA] Failed to list checkpoints', err.message);
        return [];
      }
    };

    const getBestScores = (candidates, objectives) => {
      const best = {};
      for (const obj of objectives) {
        best[obj] = Math.max(...candidates.map(c => c.scores[obj] || 0));
      }
      return best;
    };

    const selectParents = (population) => {
      const sorted = [...population].sort((a, b) => (b.scores.accuracy || 0) - (a.scores.accuracy || 0));
      const pick = () => sorted[Math.floor(Math.random() * Math.min(3, sorted.length))];
      return [pick(), pick()];
    };

    const selectParent = (population) => {
      return population[Math.floor(Math.random() * population.length)];
    };

    const runGeneration = async (gen, taskSet, config) => {
        _generation = gen;
        const taskBatch = sampleTasks(taskSet, config.evaluationBatchSize);
        const evalResults = await evaluate(_population, taskBatch, config);

        for (const result of evalResults) {
          result.candidate.scores = result.scores;
          result.candidate.traces = result.traces;
        }

        EventBus.emit('gepa:evaluated', {
          generation: gen,
          results: evalResults.map(r => ({ id: r.candidate.id, scores: r.scores }))
        });

        const reflections = await reflect(evalResults, config);
        reflections.forEach(r => _reflectionCache.set(r.errorType, r));

        EventBus.emit('gepa:reflected', {
          generation: gen,
          reflectionCount: reflections.length,
          errorTypes: reflections.map(r => r.errorType)
        });

        const offspring = [];
        const elite = paretoSelect(_population, config.objectives, config.eliteCount);
        offspring.push(...elite);

        while (offspring.length < config.populationSize * 0.5) {
          const [p1, p2] = selectParents(_population);
          if (Math.random() < config.crossoverRate) {
            offspring.push(crossover(p1, p2));
          }
        }

        while (offspring.length < config.populationSize) {
          const parent = selectParent(_population);
          if (Math.random() < config.mutationRate) {
            offspring.push(mutate(parent, reflections));
          } else {
            offspring.push(randomMutate(parent));
          }
        }

        _population = paretoSelect(offspring, config.objectives, config.populationSize);
        _paretoFrontier = _population.filter(c => c.dominatedBy === 0);

        EventBus.emit('gepa:generation-complete', {
          generation: gen,
          frontierSize: _paretoFrontier.length,
          bestScores: getBestScores(_population, config.objectives)
        });

        await saveCheckpoint(gen, _population, _paretoFrontier, config);

    };

    /**
     * Resume evolution from a checkpoint.
     * @param {string} checkpointPath - Path to checkpoint directory
     * @param {Array} taskSet - Task set for evaluation
     * @param {Object} options - Evolution options
     * @returns {Promise<Object>} Evolution result
     */
    const resumeEvolution = async (checkpointPath, taskSet, options = {}) => {
      const checkpoint = await loadCheckpoint(checkpointPath);
      if (!checkpoint) {
        throw new Errors.ValidationError('No checkpoint found to resume from');
      }

      const config = {
        ...DEFAULTS,
        ...checkpoint.config,
        ...options
      };

      // Restore population state
      _population = checkpoint.population || [];
      _paretoFrontier = checkpoint.frontier || [];
      _generation = checkpoint.generation;

      logger.info('[GEPA] Resuming from checkpoint', {
        generation: _generation,
        populationSize: _population.length,
        frontierSize: _paretoFrontier.length
      });

      EventBus.emit('gepa:resumed', {
        generation: _generation,
        populationSize: _population.length,
        checkpointPath
      });

      // Continue evolution from next generation
      const startGen = _generation + 1;
      const remainingGens = config.maxGenerations - startGen;

      if (remainingGens <= 0) {
        return {
          frontier: _paretoFrontier,
          bestOverall: _paretoFrontier[0] || null,
          generations: _generation + 1,
          resumed: true,
          message: 'Evolution already complete'
        };
      }

      // Run remaining generations
      for (let gen = startGen; gen < config.maxGenerations; gen++) {
        await runGeneration(gen, taskSet, config);
      }

      const result = {
        frontier: _paretoFrontier,
        bestOverall: _paretoFrontier[0] || null,
        generations: _generation + 1,
        totalEvaluations: ((_generation + 1) - startGen) * config.populationSize * config.evaluationBatchSize,
        resumed: true,
        resumedFromGeneration: checkpoint.generation
      };

      if (config.promoteBest) {
        result.promotion = await promoteCandidate(result.bestOverall, config.promoteOptions || {});
      }

      return result;
    };

    const evolve = async (seedPrompt, taskSet, options = {}) => {
      const config = {
        ...DEFAULTS,
        ...options
      };

      if (!seedPrompt || typeof seedPrompt !== 'string') {
        throw new Errors.ValidationError('GEPA seedPrompt must be a string');
      }

      const targetType = config.targetType || 'prompt';
      const targetMeta = config.targetMeta || {};
      const taskDescription = config.taskDescription || '';

      // --- Transfer Learning: Seed population with historical prompts ---
      _population = [createCandidate(seedPrompt, 0, [], { targetType, payload: targetMeta })];

      if (PromptMemory && config.useTransferLearning !== false && taskDescription) {
        try {
          const historicalSeeds = await PromptMemory.getSeedPrompts(taskDescription, {
            maxSeeds: Math.min(3, Math.floor(config.populationSize / 2))
          });

          for (const content of historicalSeeds) {
            if (_population.length < config.populationSize) {
              _population.push(createCandidate(content, 0, [], {
                targetType,
                payload: targetMeta,
                mutationType: 'historical_seed'
              }));
            }
          }

          if (historicalSeeds.length > 0) {
            logger.info('[GEPA] Seeded population with historical prompts', {
              historicalCount: historicalSeeds.length
            });
          }
        } catch (err) {
          logger.debug('[GEPA] Transfer learning unavailable', err.message);
        }
      }

      // Fill remaining population with mutations
      while (_population.length < config.populationSize) {
        _population.push(randomMutate(_population[0]));
      }

      EventBus.emit('gepa:started', {
        populationSize: _population.length,
        objectives: config.objectives,
        taskDescription: taskDescription.slice(0, 50)
      });

      for (let gen = 0; gen < config.maxGenerations; gen++) {
        await runGeneration(gen, taskSet, config);
      }

      const result = {
        frontier: _paretoFrontier,
        bestOverall: _paretoFrontier[0] || null,
        generations: _generation + 1,
        totalEvaluations: (_generation + 1) * config.populationSize * config.evaluationBatchSize
      };

      if (config.promoteBest) {
        result.promotion = await promoteCandidate(result.bestOverall, config.promoteOptions || {});
      }

      // --- Prompt Storage: Store evolved prompts in SemanticMemory ---
      if (PromptMemory && config.storeEvolved !== false && result.bestOverall) {
        try {
          const taskType = taskDescription || config.taskType || 'general';

          // Store best prompt
          const storedId = await PromptMemory.storeEvolvedPrompt(
            result.bestOverall,
            taskType
          );
          result.storedPromptId = storedId;

          // Optionally store entire frontier
          if (config.storeFrontier && _paretoFrontier.length > 1) {
            const frontierIds = [];
            for (const candidate of _paretoFrontier.slice(1, 4)) { // Top 3 after best
              const id = await PromptMemory.storeEvolvedPrompt(candidate, taskType);
              frontierIds.push(id);
            }
            result.storedFrontierIds = frontierIds;
          }

          logger.info('[GEPA] Stored evolved prompts', {
            bestId: storedId,
            taskType
          });
        } catch (err) {
          logger.warn('[GEPA] Failed to store evolved prompts', err.message);
        }
      }

      return result;
    };

    /**
     * Get current evolution status with detailed metrics.
     * @returns {Object} Status object
     */
    const getStatus = () => ({
      generation: _generation,
      populationSize: _population.length,
      frontierSize: _paretoFrontier.length,
      reflectionCount: _reflectionCache.size,
      evaluationCacheSize: _evaluationCache.size,
      stagnantGenerations: _stagnantGenerations,
      hypervolume: _paretoFrontier.length > 0
        ? NSGAEngine.computeHypervolume(_paretoFrontier, DEFAULTS.objectives)
        : 0,
      diversity: _population.length > 0
        ? calculatePopulationDiversity(_population)
        : 0
    });

    /**
     * Clear all caches (evaluation and reflection).
     */
    const clearCaches = () => {
      EvaluationEngine.clearCache();
      ReflectionEngine.clearCache();
      _stagnantGenerations = 0;
      _previousBestScores = null;
    };

    /**
     * Get detailed statistics about the evolution run.
     * @returns {Object} Statistics object
     */
    const getStatistics = () => {

      return {
        generation: _generation,
        population: {
          size: _population.length,
          diversity: calculatePopulationDiversity(_population),
          avgFitness: _population.reduce((sum, c) =>
            sum + NSGAEngine.computeCompositeFitness(c, DEFAULTS.objectives, DEFAULTS.objectiveWeights), 0
          ) / (_population.length || 1)
        },
        frontier: {
          size: _paretoFrontier.length,
          hypervolume: NSGAEngine.computeHypervolume(_paretoFrontier, DEFAULTS.objectives),
          bestScores: getBestScores(_paretoFrontier, DEFAULTS.objectives)
        },
        caches: {
          reflection: _reflectionCache.size,
          evaluation: _evaluationCache.size
        },
        convergence: {
          stagnantGenerations: _stagnantGenerations,
          previousBest: _previousBestScores
        }
      };
    };

    return {
      api: {
        evolve,
        resumeEvolution,
        promoteCandidate,
        loadCheckpoint,
        listCheckpoints,
        getStatus,
        getStatistics,
        clearCaches
      },
      // Expose engines for advanced usage and testing
      engines: {
        EvaluationEngine,
        ReflectionEngine,
        NSGAEngine
      }
    };
  }
};

export default GEPAOptimizer;
