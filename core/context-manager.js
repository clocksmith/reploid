/**
 * @fileoverview Context Manager
 * Manages token budget and context window compaction.
 */

const ContextManager = {
  metadata: {
    id: 'ContextManager',
    version: '2.1.0',
    dependencies: ['Utils', 'LLMClient', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { LLMClient, EventBus } = deps;

    // Token count caching to avoid redundant O(n) calculations
    let _cachedTokenCount = null;
    let _cachedContextLength = 0;
    let _cachedLastMessageLength = 0;

    const countTokens = (context) => {
      // Fast path: check if context is unchanged
      const contextLength = context.length;
      const lastMessageLength = context.length > 0
        ? (context[context.length - 1].content?.length || 0)
        : 0;

      // Cache hit: same number of messages and last message length unchanged
      if (_cachedTokenCount !== null &&
          contextLength === _cachedContextLength &&
          lastMessageLength === _cachedLastMessageLength) {
        return _cachedTokenCount;
      }

      // Cache miss: recalculate efficiently
      let totalLength = 0;
      for (const m of context) {
        totalLength += (m.content?.length || 0);
      }

      _cachedTokenCount = Math.ceil(totalLength * 0.25); // ~4 chars per token
      _cachedContextLength = contextLength;
      _cachedLastMessageLength = lastMessageLength;

      return _cachedTokenCount;
    };

    const invalidateTokenCache = () => {
      _cachedTokenCount = null;
      _cachedContextLength = 0;
      _cachedLastMessageLength = 0;
    };

    const shouldCompact = (context) => countTokens(context) > 12000;

    const compact = async (context, modelConfig) => {
      if (!shouldCompact(context)) return context;
      if (!modelConfig) {
        logger.warn('[ContextManager] No model config provided, skipping compaction');
        return context;
      }

      logger.info('[ContextManager] Compacting...');
      const start = context.slice(0, 2); // System + First User
      const end = context.slice(-5);     // Last 5
      const middle = context.slice(2, -5);

      if (middle.length === 0) return context;

      const text = middle.map(m => `${m.role}: ${m.content}`).join('\n');

      try {
        const res = await LLMClient.chat([
          { role: 'system', content: 'You are a helpful assistant that summarizes conversations concisely.' },
          { role: 'user', content: `Summarize this conversation, keeping key technical details and tool results:\n${text}` }
        ], modelConfig);

        const summary = res?.content || '[Summary unavailable]';

        // Notify UI about compaction
        if (EventBus) {
          EventBus.emit('context:compacted', {
            previousTokens: countTokens(context),
            newTokens: countTokens([...start, { role: 'user', content: summary }, ...end])
          });
        }

        // Insert summary as user message to avoid multiple system messages (WebLLM requirement)
        const compacted = [...start, { role: 'user', content: `[CONTEXT SUMMARY]: ${summary}` }, ...end];
        invalidateTokenCache(); // Cache is stale after compaction
        return compacted;
      } catch (e) {
        logger.error('[ContextManager] Compaction failed', e);
        const pruned = [...start, { role: 'user', content: '[Previous context was pruned due to length]' }, ...end];
        invalidateTokenCache(); // Cache is stale after compaction
        return pruned;
      }
    };

    // Emit token count updates
    const emitTokens = (context) => {
      const tokens = countTokens(context);
      if (EventBus) {
        EventBus.emit('agent:tokens', { tokens });
      }
      return tokens;
    };

    return { countTokens, shouldCompact, compact, emitTokens, invalidateTokenCache };
  }
};

export default ContextManager;
