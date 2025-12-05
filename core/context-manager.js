/**
 * @fileoverview Context Manager
 * Manages token budget and context window compaction.
 */

const ContextManager = {
  metadata: {
    id: 'ContextManager',
    version: '1.0.0',
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

    const MAX_CONTEXT_TOKENS = 120000; // Hard limit for cloud models (128k - 8k buffer)
    const COMPACT_THRESHOLD = 30000;    // Compact at 30k tokens

    const shouldCompact = (context) => countTokens(context) > COMPACT_THRESHOLD;

    const exceedsHardLimit = (context) => {
      const tokens = countTokens(context);
      return {
        exceeded: tokens > MAX_CONTEXT_TOKENS,
        tokens,
        limit: MAX_CONTEXT_TOKENS
      };
    };

    const extractCriticalInfo = (messages) => {
      const toolCalls = [];
      const memoryOps = [];
      const errors = [];
      const decisions = [];

      for (const msg of messages) {
        const content = msg.content || '';

        // Extract tool calls (TOOL_CALL: pattern)
        const toolCallMatches = content.matchAll(/TOOL_CALL:\s*(\w+)/g);
        for (const match of toolCallMatches) {
          toolCalls.push({ tool: match[1], role: msg.role });
        }

        // Extract tool results (Act #N → pattern)
        const toolResultMatches = content.matchAll(/Act #(\d+) → (\w+)\s*(.*?)(?=Act #|\n\n|$)/gs);
        for (const match of toolResultMatches) {
          toolCalls.push({ cycle: match[1], tool: match[2], result: match[3].substring(0, 100) });
        }

        // Extract memory operations
        if (content.includes('WriteFile') || content.includes('CreateTool') || content.includes('LoadModule')) {
          memoryOps.push({ role: msg.role, op: content.substring(0, 150) });
        }

        // Extract errors
        if (content.includes('ERROR') || content.includes('failed') || content.includes('Error:')) {
          errors.push(content.substring(0, 200));
        }

        // Extract key decisions (Think #N patterns)
        const thinkMatches = content.matchAll(/Think #(\d+)\s*\n(.*?)(?=\nTOOL_CALL|\nThink #|$)/gs);
        for (const match of thinkMatches) {
          if (match[2].length > 50) {
            decisions.push({ cycle: match[1], thought: match[2].substring(0, 200) });
          }
        }
      }

      return { toolCalls, memoryOps, errors, decisions };
    };

    const compact = async (context, modelConfig) => {
      if (!shouldCompact(context)) return context;
      if (!modelConfig) {
        logger.warn('[ContextManager] No model config provided, skipping compaction');
        return context;
      }

      logger.info('[ContextManager] Compacting...');
      const start = context.slice(0, 2); // System + First User (goal)
      const end = context.slice(-8);     // Last 8 messages (recent context)
      const middle = context.slice(2, -8);

      if (middle.length === 0) return context;

      // Extract critical structured information
      const critical = extractCriticalInfo(middle);

      // Build compact structured summary
      let compactSummary = '[CONTEXT COMPACTED - Critical Info Preserved]\n\n';

      if (critical.toolCalls.length > 0) {
        compactSummary += `TOOL CALLS (${critical.toolCalls.length}):\n`;
        critical.toolCalls.slice(-10).forEach(tc => {
          compactSummary += `- ${tc.tool}${tc.result ? ': ' + tc.result : ''}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.memoryOps.length > 0) {
        compactSummary += `MEMORY OPERATIONS:\n`;
        critical.memoryOps.slice(-5).forEach(op => {
          compactSummary += `- ${op.op}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.errors.length > 0) {
        compactSummary += `ERRORS TO AVOID:\n`;
        critical.errors.slice(-3).forEach(err => {
          compactSummary += `- ${err}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.decisions.length > 0) {
        compactSummary += `KEY DECISIONS:\n`;
        critical.decisions.slice(-5).forEach(dec => {
          compactSummary += `- Cycle ${dec.cycle}: ${dec.thought}\n`;
        });
      }

      compactSummary += `\n[${middle.length} messages compacted]`;

      // Notify UI about compaction
      if (EventBus) {
        EventBus.emit('context:compacted', {
          previousTokens: countTokens(context),
          newTokens: countTokens([...start, { role: 'user', content: compactSummary }, ...end]),
          preserved: {
            toolCalls: critical.toolCalls.length,
            errors: critical.errors.length,
            decisions: critical.decisions.length
          }
        });
      }

      // Insert structured summary as user message
      const compacted = [...start, { role: 'user', content: compactSummary }, ...end];
      invalidateTokenCache(); // Cache is stale after compaction
      logger.info(`[ContextManager] Compacted ${middle.length} msgs, preserved ${critical.toolCalls.length} tool calls, ${critical.errors.length} errors`);
      return compacted;
    };

    // Emit token count updates and check hard limit
    const emitTokens = (context) => {
      const tokens = countTokens(context);
      const limitCheck = exceedsHardLimit(context);

      if (EventBus) {
        EventBus.emit('agent:tokens', {
          tokens,
          exceeded: limitCheck.exceeded,
          limit: limitCheck.limit
        });
      }

      if (limitCheck.exceeded) {
        logger.error(`[ContextManager] HARD LIMIT EXCEEDED: ${tokens}/${limitCheck.limit} tokens`);
      }
      return tokens;
    };

    return { countTokens, shouldCompact, compact, emitTokens, invalidateTokenCache, exceedsHardLimit, MAX_CONTEXT_TOKENS };
  }
};

export default ContextManager;
