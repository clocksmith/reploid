/**
 * @fileoverview GEPA Optimizer
 * Genetic-Pareto prompt evolution with execution trace reflection.
 */

const GEPAOptimizer = {
  metadata: {
    id: 'GEPAOptimizer',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['LLMClient', 'EventBus', 'Utils', 'VFS', 'PersonaManager?', 'ArenaHarness?', 'PromptMemory?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { LLMClient, EventBus, Utils, VFS, PersonaManager, ArenaHarness, PromptMemory } = deps;
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
      objectives: ['accuracy', 'efficiency', 'robustness'],
      evaluationBatchSize: 6,
      maxReflectionSamples: 5,
      checkpointPath: '/.memory/gepa/',
      matchMode: bootConfig.matchMode ?? 'exact'
    };

    let _population = [];
    let _paretoFrontier = [];
    let _generation = 0;
    let _reflectionCache = new Map();

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

    const classifyError = (actual, expected) => {
      if (expected === undefined || expected === null) return 'unknown';
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

    const evaluate = async (candidates, taskBatch, config) => {
      if (!config.evaluationModel) {
        throw new Errors.ConfigError('GEPA evaluationModel is required');
      }
      if (!taskBatch.length) {
        throw new Errors.ValidationError('GEPA taskBatch is empty');
      }

      const results = [];

      for (const candidate of candidates) {
        if (candidate.targetType !== 'prompt') {
          if (candidate.targetType === 'persona_slot') {
            if (!PersonaManager?.getPersonas || !PersonaManager?.buildSystemPrompt) {
              throw new Errors.ConfigError('PersonaManager not available for persona_slot evaluation');
            }
            const personas = await PersonaManager.getPersonas();
            const personaId = candidate.payload?.personaId || null;
            const resolvedId = personaId || (await PersonaManager.getPromptSlots()).personaId;
            const personaDef = personas.find(p => p.id === resolvedId) || personas[0];
            if (!personaDef) {
              throw new Errors.ConfigError('No persona available for persona_slot evaluation');
            }
            const slot = candidate.payload?.slot || 'instructions';
            const override = {
              description: slot === 'description' ? candidate.content : personaDef.description,
              instructions: slot === 'instructions' ? candidate.content : personaDef.instructions
            };
            const composedPrompt = PersonaManager.buildSystemPrompt(personaDef, override);
            const personaCandidate = { ...candidate, content: composedPrompt, targetType: 'prompt' };
            const promptResult = await evaluate([personaCandidate], taskBatch, {
              ...config,
              targetType: 'prompt'
            });
            results.push({ ...promptResult[0], candidate });
            continue;
          }
          throw new Errors.ConfigError(`Unsupported target type: ${candidate.targetType}`);
        }

        const traces = [];

        for (const task of taskBatch) {
          const startTime = performance.now();
          try {
            const response = await LLMClient.chat([
              { role: 'system', content: candidate.content },
              { role: 'user', content: task.input || task }
            ], config.evaluationModel);

            const latencyMs = performance.now() - startTime;
            const success = evaluateResponse(response.content, task.expectedOutput || task.expected, config.matchMode);

            traces.push({
              candidateId: candidate.id,
              taskId: task.id || generateId('task'),
              input: task.input || task,
              expectedOutput: task.expectedOutput || task.expected,
              actualOutput: response.content,
              success,
              errorType: success ? null : classifyError(response.content, task.expectedOutput || task.expected),
              latencyMs,
              tokenCount: response.usage?.total_tokens || 0
            });
          } catch (error) {
            traces.push({
              candidateId: candidate.id,
              taskId: task.id || generateId('task'),
              input: task.input || task,
              success: false,
              errorType: 'execution_error',
              error: error.message
            });
          }
        }

        const traceCount = traces.length || 1;
        const scores = {
          accuracy: traces.filter(t => t.success).length / traceCount,
          efficiency: 1 - (avg(traces.map(t => t.latencyMs || 0)) / 10000),
          robustness: 1 - (traces.filter(t => t.errorType === 'execution_error').length / traceCount)
        };

        results.push({ candidate, scores, traces });
      }

      return results;
    };

    const buildReflectionPrompt = (errorType, samples) => `
You analyze prompt failures and propose fixes.

## Error Type
${errorType}

## Failed Examples
${samples.map((sample, index) => `
### Example ${index + 1}
Prompt: ${sample.candidate.content.substring(0, 500)}...
Input: ${sample.trace.input}
Expected: ${sample.trace.expectedOutput}
Actual: ${sample.trace.actualOutput}
Trace: ${JSON.stringify(sample.trace.trace || 'N/A')}
`).join('\n')}

## Task
1. Identify the root cause.
2. Propose 2-3 specific prompt modifications.
3. Explain why each helps.

Respond in JSON:
{
  "rootCause": "string",
  "modifications": [
    {
      "type": "add" | "remove" | "replace",
      "target": "what part to modify",
      "content": "new/modified text",
      "rationale": "why this helps"
    }
  ]
}`;

    const reflect = async (evaluationResults, config) => {
      if (!config.reflectionModel) {
        throw new Errors.ConfigError('GEPA reflectionModel is required');
      }

      const failureGroups = {};
      for (const result of evaluationResults) {
        for (const trace of result.traces.filter(t => !t.success)) {
          const key = trace.errorType || 'unknown';
          if (!failureGroups[key]) failureGroups[key] = [];
          failureGroups[key].push({ candidate: result.candidate, trace });
        }
      }

      const reflections = [];

      for (const [errorType, failures] of Object.entries(failureGroups)) {
        const samples = failures.slice(0, config.maxReflectionSamples);
        const prompt = buildReflectionPrompt(errorType, samples);

        try {
          const response = await LLMClient.chat([
            { role: 'system', content: 'You are an expert prompt engineer.' },
            { role: 'user', content: prompt }
          ], config.reflectionModel);

          const { json } = sanitizeLlmJsonRespPure(response.content || '');
          const parsed = JSON.parse(json);

          reflections.push({
            errorType,
            failureCount: failures.length,
            ...parsed
          });
        } catch (e) {
          logger.warn('[GEPA] Reflection parse failed', e.message);
        }
      }

      return reflections;
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

      if (options.applyToPersona && candidate.targetType === 'persona_slot' && PersonaManager?.applySlotMutation) {
        const slot = candidate.payload?.slot || 'instructions';
        const personaId = candidate.payload?.personaId || (await PersonaManager.getPromptSlots()).personaId;
        await PersonaManager.applySlotMutation({
          personaId,
          slot,
          content: candidate.content,
          mode: 'replace'
        });
      }

      return { promoted: true, passed: true, path: storagePath };
    };

    const checkDominance = (a, b, objectives) => {
      let aBetter = 0;
      let bBetter = 0;
      for (const obj of objectives) {
        if (a.scores[obj] > b.scores[obj]) aBetter++;
        if (b.scores[obj] > a.scores[obj]) bBetter++;
      }
      if (aBetter > 0 && bBetter === 0) return 1;
      if (bBetter > 0 && aBetter === 0) return -1;
      return 0;
    };

    const calculateCrowdingDistance = (front, objectives) => {
      for (const c of front) c.crowdingDistance = 0;

      for (const obj of objectives) {
        front.sort((a, b) => a.scores[obj] - b.scores[obj]);
        front[0].crowdingDistance = Infinity;
        front[front.length - 1].crowdingDistance = Infinity;

        const range = front[front.length - 1].scores[obj] - front[0].scores[obj];
        if (range === 0) continue;

        for (let i = 1; i < front.length - 1; i++) {
          front[i].crowdingDistance +=
            (front[i + 1].scores[obj] - front[i - 1].scores[obj]) / range;
        }
      }

      return front;
    };

    const paretoSelect = (candidates, objectives, targetSize) => {
      for (const c of candidates) {
        c.dominatedBy = 0;
        c.dominates = [];
      }

      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const dominated = checkDominance(candidates[i], candidates[j], objectives);
          if (dominated === 1) {
            candidates[j].dominatedBy++;
            candidates[i].dominates.push(j);
          } else if (dominated === -1) {
            candidates[i].dominatedBy++;
            candidates[j].dominates.push(i);
          }
        }
      }

      const fronts = [];
      let remaining = [...candidates];
      while (remaining.length > 0) {
        const front = remaining.filter(c => c.dominatedBy === 0);
        fronts.push(front);
        for (const c of front) {
          for (const dominated of c.dominates) {
            candidates[dominated].dominatedBy--;
          }
        }
        remaining = remaining.filter(c => c.dominatedBy > 0);
      }

      const selected = [];
      for (const front of fronts) {
        if (selected.length + front.length <= targetSize) {
          selected.push(...front);
        } else {
          const withCrowding = calculateCrowdingDistance(front, objectives);
          withCrowding.sort((a, b) => b.crowdingDistance - a.crowdingDistance);
          selected.push(...withCrowding.slice(0, targetSize - selected.length));
          break;
        }
      }

      return selected;
    };

    const saveCheckpoint = async (generation, population, frontier, config) => {
      if (!VFS) return;
      await ensureVfsPath(config.checkpointPath);
      const path = `${config.checkpointPath}gen_${generation}.json`;
      await VFS.write(path, JSON.stringify({
        generation,
        timestamp: Date.now(),
        population,
        frontier
      }, null, 2));
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

    const getStatus = () => ({
      generation: _generation,
      populationSize: _population.length,
      frontierSize: _paretoFrontier.length,
      reflectionCount: _reflectionCache.size
    });

    return {
      api: {
        evolve,
        promoteCandidate,
        getStatus
      }
    };
  }
};

export default GEPAOptimizer;
