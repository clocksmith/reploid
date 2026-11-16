/** Builds bounded reflection proposals from observed failures. Proposals confer no activation authority. */
export function createGepaReflection({ cache, policy, Errors, logger, LLMClient, sanitizeLlmJsonRespPure }) {
  return {
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
      const cachedReflection = cache.get(errorType);
      if (cachedReflection && cachedReflection.timestamp > Date.now() - 300000) {
        reflections.push(cachedReflection);
        continue;
      }

      const samples = failures.slice(0, config.maxReflectionSamples);
      const reflection = await this.generateReflection(errorType, samples, config);

      if (reflection) {
        reflection.timestamp = Date.now();
        cache.set(errorType, reflection);
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
    const depth = config.reflectionDepth || policy.reflectionDepth;

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
    const depth = config.reflectionDepth || policy.reflectionDepth;

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
    cache.clear();
  }
};
}
