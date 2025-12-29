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
 * @see Blueprint 0x000070: Genetic Evolution of Prompt Architectures
 */

const GEPAOptimizer = {
  metadata: {
    id: 'GEPAOptimizer',
    version: '2.0.0',
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

    const EvaluationEngine = {
      /**
       * Clear evaluation cache
       */
      clearCache() {
        _evaluationCache.clear();
      },

      /**
       * Get cache key for a candidate-task pair
       */
      getCacheKey(candidateId, taskId) {
        return `${candidateId}:${taskId}`;
      },

      /**
       * Execute a single evaluation with retry logic
       * @param {Object} candidate - The prompt candidate
       * @param {Object} task - The test task
       * @param {Object} config - Evaluation configuration
       * @returns {Promise<Object>} Execution trace
       */
      async executeOne(candidate, task, config) {
        const cacheKey = this.getCacheKey(candidate.id, task.id || generateId('task'));

        // Check cache
        if (config.cacheEvaluations && _evaluationCache.has(cacheKey)) {
          const cached = _evaluationCache.get(cacheKey);
          return { ...cached, fromCache: true };
        }

        let lastError = null;
        const retries = config.evalRetries || DEFAULTS.evalRetries;

        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const trace = await this.executeWithTimeout(candidate, task, config);

            // Cache successful result
            if (config.cacheEvaluations) {
              _evaluationCache.set(cacheKey, trace);
            }

            return trace;
          } catch (error) {
            lastError = error;
            if (attempt < retries) {
              logger.debug(`[GEPA:Eval] Retry ${attempt + 1}/${retries} for ${candidate.id}`);
              await new Promise(r => setTimeout(r, 100 * (attempt + 1))); // Exponential backoff
            }
          }
        }

        // Return failure trace after all retries exhausted
        return {
          candidateId: candidate.id,
          taskId: task.id || generateId('task'),
          input: task.input || task,
          success: false,
          errorType: 'execution_error',
          error: lastError?.message || 'Unknown error',
          retryExhausted: true
        };
      },

      /**
       * Execute evaluation with timeout
       */
      async executeWithTimeout(candidate, task, config) {
        const timeout = config.evalTimeout || DEFAULTS.evalTimeout;

        const evaluationPromise = this.executeCore(candidate, task, config);

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Evaluation timeout')), timeout);
        });

        return Promise.race([evaluationPromise, timeoutPromise]);
      },

      /**
       * Core evaluation logic
       */
      async executeCore(candidate, task, config) {
        const startTime = performance.now();

        const response = await LLMClient.chat([
          { role: 'system', content: candidate.content },
          { role: 'user', content: task.input || task }
        ], config.evaluationModel);

        const latencyMs = performance.now() - startTime;
        const actualOutput = response.content;
        const expectedOutput = task.expectedOutput || task.expected;
        const success = evaluateResponse(actualOutput, expectedOutput, config.matchMode);

        return {
          candidateId: candidate.id,
          taskId: task.id || generateId('task'),
          input: task.input || task,
          expectedOutput,
          actualOutput,
          success,
          errorType: success ? null : classifyError(actualOutput, expectedOutput),
          latencyMs,
          tokenCount: response.usage?.total_tokens || 0,
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          timestamp: Date.now()
        };
      },

      /**
       * Evaluate a batch of candidates against task set
       * @param {Array} candidates - Prompt candidates
       * @param {Array} taskBatch - Test tasks
       * @param {Object} config - Configuration
       * @returns {Promise<Array>} Evaluation results with scores and traces
       */
      async evaluateBatch(candidates, taskBatch, config) {
        const results = [];

        for (const candidate of candidates) {
          // Handle persona_slot type
          if (candidate.targetType === 'persona_slot') {
            const result = await this.evaluatePersonaSlot(candidate, taskBatch, config);
            results.push(result);
            continue;
          }

          if (candidate.targetType !== 'prompt') {
            throw new Errors.ConfigError(`Unsupported target type: ${candidate.targetType}`);
          }

          const traces = [];

          // Parallel execution of task evaluations
          const tracePromises = taskBatch.map(task =>
            this.executeOne(candidate, task, config)
          );

          const traceResults = await Promise.all(tracePromises);
          traces.push(...traceResults);

          // Compute scores from traces
          const scores = this.computeScores(traces, config);

          results.push({
            candidate,
            scores,
            traces,
            metrics: this.computeMetrics(traces)
          });
        }

        return results;
      },

      /**
       * Evaluate persona_slot type candidates
       */
      async evaluatePersonaSlot(candidate, taskBatch, config) {
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
        const promptCandidate = { ...candidate, content: composedPrompt, targetType: 'prompt' };

        const promptResult = await this.evaluateBatch([promptCandidate], taskBatch, {
          ...config,
          targetType: 'prompt'
        });

        return { ...promptResult[0], candidate };
      },

      /**
       * Compute objective scores from execution traces
       */
      computeScores(traces, config) {
        const traceCount = traces.length || 1;
        const successCount = traces.filter(t => t.success).length;
        const errorCount = traces.filter(t => t.errorType === 'execution_error').length;
        const totalTokens = traces.reduce((sum, t) => sum + (t.tokenCount || 0), 0);
        const avgLatency = avg(traces.map(t => t.latencyMs || 0));

        return {
          accuracy: successCount / traceCount,
          efficiency: 1 - Math.min(avgLatency / 10000, 1),
          robustness: 1 - (errorCount / traceCount),
          cost: 1 - Math.min(totalTokens / (traceCount * 1000), 1)
        };
      },

      /**
       * Compute detailed metrics from traces
       */
      computeMetrics(traces) {
        const successTraces = traces.filter(t => t.success);
        const failedTraces = traces.filter(t => !t.success);

        return {
          totalTokens: traces.reduce((sum, t) => sum + (t.tokenCount || 0), 0),
          avgLatency: avg(traces.map(t => t.latencyMs || 0)),
          minLatency: Math.min(...traces.map(t => t.latencyMs || Infinity)),
          maxLatency: Math.max(...traces.map(t => t.latencyMs || 0)),
          successRate: traces.length ? successTraces.length / traces.length : 0,
          errorTypeCounts: this.countErrorTypes(failedTraces),
          cacheHitRate: traces.filter(t => t.fromCache).length / (traces.length || 1)
        };
      },

      /**
       * Count occurrences of each error type
       */
      countErrorTypes(failedTraces) {
        const counts = {};
        for (const trace of failedTraces) {
          const type = trace.errorType || 'unknown';
          counts[type] = (counts[type] || 0) + 1;
        }
        return counts;
      }
    };

    // =========================================================================
    // REFLECTION ENGINE
    // Analyzes failures and suggests targeted prompt improvements
    // =========================================================================

    const ReflectionEngine = {
      /**
       * Generate reflections for evaluation failures
       * @param {Array} evaluationResults - Results from EvaluationEngine
       * @param {Object} config - Configuration
       * @returns {Promise<Array>} Reflection suggestions
       */
      async analyze(evaluationResults, config) {
        if (!config.reflectionModel) {
          throw new Errors.ConfigError('GEPA reflectionModel is required');
        }

        // Group failures by error type
        const failureGroups = this.groupFailuresByType(evaluationResults);

        if (Object.keys(failureGroups).length === 0) {
          logger.debug('[GEPA:Reflect] No failures to analyze');
          return [];
        }

        const reflections = [];

        for (const [errorType, failures] of Object.entries(failureGroups)) {
          // Check cache first
          const cachedReflection = _reflectionCache.get(errorType);
          if (cachedReflection && cachedReflection.timestamp > Date.now() - 300000) {
            reflections.push(cachedReflection);
            continue;
          }

          const samples = failures.slice(0, config.maxReflectionSamples);
          const reflection = await this.generateReflection(errorType, samples, config);

          if (reflection) {
            reflection.timestamp = Date.now();
            _reflectionCache.set(errorType, reflection);
            reflections.push(reflection);
          }
        }

        return reflections;
      },

      /**
       * Group failures by error type
       */
      groupFailuresByType(evaluationResults) {
        const groups = {};

        for (const result of evaluationResults) {
          for (const trace of result.traces.filter(t => !t.success)) {
            const key = trace.errorType || 'unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push({ candidate: result.candidate, trace });
          }
        }

        return groups;
      },

      /**
       * Generate a reflection for a specific error type
       */
      async generateReflection(errorType, samples, config) {
        const prompt = this.buildReflectionPrompt(errorType, samples, config);

        try {
          const response = await LLMClient.chat([
            { role: 'system', content: this.getReflectionSystemPrompt(config) },
            { role: 'user', content: prompt }
          ], config.reflectionModel);

          const { json } = sanitizeLlmJsonRespPure(response.content || '');
          const parsed = JSON.parse(json);

          return {
            errorType,
            failureCount: samples.length,
            ...parsed,
            validated: this.validateReflection(parsed)
          };
        } catch (e) {
          logger.warn('[GEPA:Reflect] Parse failed', e.message);

          // Retry once if configured
          if (config.maxReflectionRetries > 0) {
            return this.retryReflection(errorType, samples, {
              ...config,
              maxReflectionRetries: config.maxReflectionRetries - 1
            });
          }

          return null;
        }
      },

      /**
       * Retry reflection with simplified prompt
       */
      async retryReflection(errorType, samples, config) {
        const simplifiedPrompt = this.buildSimplifiedPrompt(errorType, samples[0]);

        try {
          const response = await LLMClient.chat([
            { role: 'system', content: 'You are a prompt engineer. Respond only in valid JSON.' },
            { role: 'user', content: simplifiedPrompt }
          ], config.reflectionModel);

          const { json } = sanitizeLlmJsonRespPure(response.content || '');
          const parsed = JSON.parse(json);

          return {
            errorType,
            failureCount: samples.length,
            ...parsed,
            retried: true
          };
        } catch (e) {
          logger.warn('[GEPA:Reflect] Retry failed', e.message);
          return null;
        }
      },

      /**
       * Get system prompt for reflection based on depth setting
       */
      getReflectionSystemPrompt(config) {
        const depth = config.reflectionDepth || DEFAULTS.reflectionDepth;

        if (depth === 'comprehensive') {
          return `You are an expert prompt engineer with deep expertise in LLM behavior.
Analyze prompt failures systematically:
1. Identify root cause patterns
2. Consider model limitations and biases
3. Propose multiple improvement strategies
4. Rank suggestions by expected impact
5. Include specific examples of improved phrasing
Respond in valid JSON format.`;
        }

        if (depth === 'basic') {
          return 'You are a prompt engineer. Analyze failures and suggest fixes. Respond in JSON.';
        }

        // Default: detailed
        return `You are an expert prompt engineer.
Analyze prompt failures and propose targeted fixes.
Consider error patterns, output expectations, and prompt clarity.
Respond in valid JSON format.`;
      },

      /**
       * Build reflection prompt with error-type-specific guidance
       */
      buildReflectionPrompt(errorType, samples, config) {
        const guidance = this.getErrorGuidance(errorType);
        const depth = config.reflectionDepth || DEFAULTS.reflectionDepth;

        let prompt = `## Error Type: ${errorType}

## Analysis Guidance
${guidance}

## Failed Examples
${samples.map((sample, idx) => this.formatSample(sample, idx)).join('\n')}

## Task
1. Identify the root cause specific to this error pattern.
2. Propose ${depth === 'comprehensive' ? '3-5' : '2-3'} specific, actionable prompt modifications.
3. Prioritize modifications by expected impact.`;

        if (depth === 'comprehensive') {
          prompt += `
4. For each modification, explain the cognitive mechanism it addresses.
5. Suggest test cases to verify the fix.`;
        }

        prompt += `

Respond in JSON:
{
  "rootCause": "string describing the fundamental issue",
  "confidence": 0.0-1.0,
  "modifications": [
    {
      "type": "add" | "remove" | "replace" | "restructure",
      "target": "specific section or phrase to modify",
      "content": "new or modified text",
      "rationale": "why this addresses the root cause",
      "priority": "high" | "medium" | "low"${depth === 'comprehensive' ? ',\n      "mechanism": "cognitive mechanism addressed",\n      "testCase": { "input": "...", "expected": "..." }' : ''}
    }
  ]${depth !== 'basic' ? ',\n  "alternativeStrategies": ["strategy 1", "strategy 2"]' : ''}
}`;

        return prompt;
      },

      /**
       * Build simplified prompt for retry
       */
      buildSimplifiedPrompt(errorType, sample) {
        return `A prompt failed with error type: ${errorType}

Prompt: ${(sample.candidate.content || '').slice(0, 300)}...
Input: ${sample.trace.input}
Expected: ${sample.trace.expectedOutput || 'N/A'}
Got: ${(sample.trace.actualOutput || '').slice(0, 200)}

Suggest ONE fix. JSON format:
{"rootCause": "...", "confidence": 0.7, "modifications": [{"type": "add", "target": "end", "content": "...", "rationale": "...", "priority": "high"}]}`;
      },

      /**
       * Get error-type specific guidance
       */
      getErrorGuidance(errorType) {
        const guidance = {
          empty_response: 'The model produced no output. Focus on clarity of instructions, explicit output requirements, and ensuring the prompt is not too restrictive.',
          partial_match: 'The output is close but incomplete. Focus on precision, completeness requirements, and explicit formatting instructions.',
          format_error: 'The output format is wrong. Focus on explicit formatting instructions, examples, and output structure requirements.',
          semantic_drift: 'The output captures intent but uses wrong terminology. Focus on vocabulary constraints, terminology definitions, and concrete examples.',
          partial_understanding: 'The model partially understood the task. Focus on decomposing instructions, providing step-by-step guidance, and clarifying ambiguities.',
          mismatch: 'The output is fundamentally wrong. Consider if the prompt clearly conveys the task objective, provides necessary context, and avoids misleading information.',
          execution_error: 'The model call failed. This may indicate prompt length, complexity issues, or content policy violations.',
          unknown: 'Unable to classify the error. Analyze the examples holistically for patterns.'
        };

        return guidance[errorType] || guidance.unknown;
      },

      /**
       * Format a sample for the reflection prompt
       */
      formatSample(sample, index) {
        const promptPreview = sample.candidate.content.length > 500
          ? sample.candidate.content.substring(0, 500) + '...'
          : sample.candidate.content;

        return `### Example ${index + 1}
**Prompt (preview):**
\`\`\`
${promptPreview}
\`\`\`

**Input:** ${sample.trace.input}
**Expected:** ${sample.trace.expectedOutput || '(not specified)'}
**Actual:** ${(sample.trace.actualOutput || '(empty)').slice(0, 500)}
**Latency:** ${sample.trace.latencyMs ? sample.trace.latencyMs.toFixed(0) + 'ms' : 'N/A'}`;
      },

      /**
       * Validate reflection structure
       */
      validateReflection(reflection) {
        if (!reflection.rootCause) return false;
        if (!Array.isArray(reflection.modifications)) return false;
        if (reflection.modifications.length === 0) return false;

        for (const mod of reflection.modifications) {
          if (!mod.type || !mod.content) return false;
        }

        return true;
      },

      /**
       * Clear reflection cache
       */
      clearCache() {
        _reflectionCache.clear();
      }
    };

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

    // =========================================================================
    // NSGA-II SELECTION ENGINE
    // Pareto-optimal selection with weighted objectives and convergence detection
    // =========================================================================

    const NSGAEngine = {
      /**
       * Check if candidate A dominates candidate B (weighted comparison)
       * @param {Object} a - First candidate
       * @param {Object} b - Second candidate
       * @param {Array} objectives - Objective names
       * @param {Object} weights - Objective weights
       * @returns {number} 1 if A dominates, -1 if B dominates, 0 if neither
       */
      checkDominance(a, b, objectives, weights = {}) {
        let aBetter = 0;
        let bBetter = 0;

        for (const obj of objectives) {
          const weight = weights[obj] || 1.0;
          const aScore = (a.scores[obj] || 0) * weight;
          const bScore = (b.scores[obj] || 0) * weight;

          if (aScore > bScore) aBetter++;
          if (bScore > aScore) bBetter++;
        }

        if (aBetter > 0 && bBetter === 0) return 1;
        if (bBetter > 0 && aBetter === 0) return -1;
        return 0;
      },

      /**
       * Calculate crowding distance for diversity preservation
       * @param {Array} front - Non-dominated front
       * @param {Array} objectives - Objective names
       * @returns {Array} Front with crowdingDistance set
       */
      calculateCrowdingDistance(front, objectives) {
        if (front.length <= 2) {
          for (const c of front) c.crowdingDistance = Infinity;
          return front;
        }

        for (const c of front) c.crowdingDistance = 0;

        for (const obj of objectives) {
          front.sort((a, b) => (a.scores[obj] || 0) - (b.scores[obj] || 0));
          front[0].crowdingDistance = Infinity;
          front[front.length - 1].crowdingDistance = Infinity;

          const range = (front[front.length - 1].scores[obj] || 0) - (front[0].scores[obj] || 0);
          if (range === 0) continue;

          for (let i = 1; i < front.length - 1; i++) {
            front[i].crowdingDistance +=
              ((front[i + 1].scores[obj] || 0) - (front[i - 1].scores[obj] || 0)) / range;
          }
        }

        return front;
      },

      /**
       * Perform NSGA-II selection
       * @param {Array} candidates - All candidates
       * @param {Array} objectives - Objective names
       * @param {number} targetSize - Target population size
       * @param {Object} config - Configuration including weights
       * @returns {Array} Selected candidates
       */
      select(candidates, objectives, targetSize, config = {}) {
        const weights = config.objectiveWeights || DEFAULTS.objectiveWeights;

        // Reset dominance counters
        for (const c of candidates) {
          c.dominatedBy = 0;
          c.dominates = [];
          c.rank = -1;
        }

        // Calculate dominance relationships
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            const dominated = this.checkDominance(candidates[i], candidates[j], objectives, weights);
            if (dominated === 1) {
              candidates[j].dominatedBy++;
              candidates[i].dominates.push(j);
            } else if (dominated === -1) {
              candidates[i].dominatedBy++;
              candidates[j].dominates.push(i);
            }
          }
        }

        // Build Pareto fronts
        const fronts = [];
        let remaining = [...candidates];
        let rank = 0;

        while (remaining.length > 0) {
          const front = remaining.filter(c => c.dominatedBy === 0);
          for (const c of front) c.rank = rank;
          fronts.push(front);

          for (const c of front) {
            for (const dominatedIdx of c.dominates) {
              candidates[dominatedIdx].dominatedBy--;
            }
          }

          remaining = remaining.filter(c => c.dominatedBy > 0);
          rank++;
        }

        // Select candidates from fronts
        const selected = [];
        for (const front of fronts) {
          if (selected.length + front.length <= targetSize) {
            selected.push(...front);
          } else {
            // Use crowding distance for tie-breaking
            const withCrowding = this.calculateCrowdingDistance(front, objectives);
            withCrowding.sort((a, b) => b.crowdingDistance - a.crowdingDistance);
            selected.push(...withCrowding.slice(0, targetSize - selected.length));
            break;
          }
        }

        return selected;
      },

      /**
       * Compute composite fitness score for a candidate
       * @param {Object} candidate - Candidate with scores
       * @param {Array} objectives - Objective names
       * @param {Object} weights - Objective weights
       * @returns {number} Composite fitness
       */
      computeCompositeFitness(candidate, objectives, weights = {}) {
        let totalWeight = 0;
        let weightedSum = 0;

        for (const obj of objectives) {
          const weight = weights[obj] || 1.0;
          const score = candidate.scores[obj] || 0;
          weightedSum += score * weight;
          totalWeight += weight;
        }

        return totalWeight > 0 ? weightedSum / totalWeight : 0;
      },

      /**
       * Check if evolution has converged (stagnation detection)
       * @param {Object} currentBest - Current best scores
       * @param {Object} previousBest - Previous best scores
       * @param {Array} objectives - Objective names
       * @param {number} threshold - Convergence threshold
       * @returns {boolean} True if converged
       */
      checkConvergence(currentBest, previousBest, objectives, threshold) {
        if (!previousBest) return false;

        for (const obj of objectives) {
          const current = currentBest[obj] || 0;
          const previous = previousBest[obj] || 0;
          const improvement = current - previous;

          if (improvement > threshold) {
            return false; // Still improving
          }
        }

        return true;
      },

      /**
       * Get hypervolume indicator (quality metric for Pareto fronts)
       * Uses a reference point of [0, 0, ..., 0]
       * @param {Array} front - Non-dominated front
       * @param {Array} objectives - Objective names
       * @returns {number} Hypervolume approximation
       */
      computeHypervolume(front, objectives) {
        if (front.length === 0) return 0;

        // Simple hypervolume approximation using dominated area
        let volume = 0;

        for (const candidate of front) {
          let contribution = 1;
          for (const obj of objectives) {
            contribution *= (candidate.scores[obj] || 0);
          }
          volume += contribution;
        }

        return volume;
      }
    };

    // Backward compatibility wrappers
    const checkDominance = (a, b, objectives) =>
      NSGAEngine.checkDominance(a, b, objectives, DEFAULTS.objectiveWeights);

    const calculateCrowdingDistance = (front, objectives) =>
      NSGAEngine.calculateCrowdingDistance(front, objectives);

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
      const frontierScores = _paretoFrontier.map(c => c.scores);
      const populationScores = _population.map(c => c.scores);

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
