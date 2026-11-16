/** Evaluates candidates against frozen tasks and retains request-local evaluation traces. Scores confer no promotion authority. */
export function createGepaEvaluation({ cache, policy, generateId, logger, LLMClient, evaluateResponse, classifyError, Errors, PersonaManager, avg }) {
  return {
  /**
   * Clear evaluation cache
   */
  clearCache() {
    cache.clear();
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
    if (config.cacheEvaluations && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      return { ...cached, fromCache: true };
    }

    let lastError = null;
    const retries = config.evalRetries || policy.evalRetries;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const trace = await this.executeWithTimeout(candidate, task, config);

        // Cache successful result
        if (config.cacheEvaluations) {
          cache.set(cacheKey, trace);
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
    const timeout = config.evalTimeout || policy.evalTimeout;

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
}
