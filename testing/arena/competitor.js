/**
 * @fileoverview Arena Competitor - Competitor definition and solution generation
 * Wraps LLM calls for arena competition with metrics tracking.
 */

const ArenaCompetitor = {
  metadata: {
    id: 'ArenaCompetitor',
    version: '1.0.0',
    dependencies: ['LLMClient', 'Utils'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { LLMClient, Utils } = deps;
    const { logger } = Utils;

    /**
     * Create a competitor instance
     * @param {Object} config - Competitor configuration
     * @param {string} config.name - Unique competitor name
     * @param {Object} config.modelConfig - LLMClient model config
     * @param {string} config.systemPrompt - System prompt for this competitor
     * @returns {Object} Competitor instance with propose() method
     */
    const createCompetitor = (config) => {
      const {
        name,
        modelConfig,
        systemPrompt = 'You are a code assistant. Output only the modified code.',
        temperature = 0.7
      } = config;

      return {
        name,
        modelConfig: { ...modelConfig, temperature },

        /**
         * Generate a solution proposal for a task
         * @param {string} task - Task description
         * @param {string} context - Relevant context (existing code, etc.)
         * @returns {Promise<Object>} Proposal with solution and metrics
         */
        async propose(task, context) {
          const startTime = Date.now();

          const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${task}\n\n## Context\n${context}` }
          ];

          logger.info(`[Arena:${name}] Generating proposal...`);

          try {
            const response = await LLMClient.chat(messages, this.modelConfig);
            const executionMs = Date.now() - startTime;

            // Estimate token count from response length (rough approximation)
            const tokenCount = Math.ceil((response.raw?.length || response.content.length) / 4);

            logger.info(`[Arena:${name}] Proposal complete: ${executionMs}ms, ~${tokenCount} tokens`);

            return {
              competitorName: name,
              solution: response.content,
              tokenCount,
              executionMs,
              model: this.modelConfig.id,
              provider: this.modelConfig.provider
            };
          } catch (error) {
            logger.error(`[Arena:${name}] Proposal failed: ${error.message}`);
            throw error;
          }
        }
      };
    };

    /**
     * Create multiple competitors from config array
     * @param {Array<Object>} configs - Array of competitor configurations
     * @returns {Array<Object>} Array of competitor instances
     */
    const createCompetitors = (configs) => {
      return configs.map(createCompetitor);
    };

    return {
      createCompetitor,
      createCompetitors
    };
  }
};

export default ArenaCompetitor;
