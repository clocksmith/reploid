/**
 * @fileoverview Context Manager
 * Manages token budget and context window compaction.
 */

const ContextManager = {
  metadata: {
    id: 'ContextManager',
    version: '2.0.1',
    dependencies: ['Utils', 'LLMClient'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { LLMClient } = deps;

    const countTokens = (context) => {
      const text = context.map(m => m.content).join('');
      return Math.ceil(text.length * 0.25); // ~4 chars per token
    };

    const shouldCompact = (context) => countTokens(context) > 12000;

    const compact = async (context, modelConfig) => {
      if (!shouldCompact(context)) return context;

      logger.info('[ContextManager] Compacting...');
      const start = context.slice(0, 2); // System + First User
      const end = context.slice(-5);     // Last 5
      const middle = context.slice(2, -5);

      if (middle.length === 0) return context;

      const text = middle.map(m => `${m.role}: ${m.content}`).join('\n');

      try {
        const res = await LLMClient.chat([{
          role: 'user',
          content: `Summarize this conversation, keeping key technical details and tool results:\n${text}`
        }], modelConfig);

        return [...start, { role: 'system', content: `[SUMMARY]: ${res.content}` }, ...end];
      } catch (e) {
        logger.error('[ContextManager] Compaction failed', e);
        return [...start, { role: 'system', content: '[DATA PRUNED]' }, ...end];
      }
    };

    return { countTokens, shouldCompact, compact };
  }
};

export default ContextManager;
