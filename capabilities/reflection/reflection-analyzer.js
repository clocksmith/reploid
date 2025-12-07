/**
 * @fileoverview Reflection Analyzer
 * Analyzes patterns in reflections to enable learning from past experiences.
 */

const ReflectionAnalyzer = {
  metadata: {
    id: 'ReflectionAnalyzer',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['ReflectionStore', 'Utils'],
    async: true,
    type: 'intelligence'
  },

  factory: (deps) => {
    const { ReflectionStore, Utils } = deps;
    const { logger } = Utils;

    const getKeywords = (text) => {
      if (!text) return [];
      return text.toLowerCase()
        .split(/\W+/)
        .filter(w => w.length > 3)
        .slice(0, 10);
    };

    // Simple failure pattern detection
    const detectFailurePatterns = async () => {
      const failed = await ReflectionStore.getReflections({
        outcome: 'failed',
        limit: 50
      });

      const counts = {};
      const examples = {};

      for (const r of failed) {
          // Heuristic: Error message is usually in content or context
          const msg = r.content || "Unknown error";
          const errorType = msg.split(':')[0] || "GenericError";

          counts[errorType] = (counts[errorType] || 0) + 1;
          if (!examples[errorType]) examples[errorType] = msg;
      }

      // Convert to array
      return Object.entries(counts)
          .filter(([_, count]) => count >= 2) // Threshold
          .map(([indicator, count]) => ({
              indicator: indicator,
              count: count,
              example: examples[indicator]
          }))
          .sort((a, b) => b.count - a.count);
    };

    return {
      init: async () => {
        logger.info('[ReflectionAnalyzer] Initialized');
        return true;
      },
      api: {
        detectFailurePatterns
      }
    };
  }
};

export default ReflectionAnalyzer;
