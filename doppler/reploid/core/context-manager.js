/**
 * @fileoverview Context Manager
 * Manages token budget and context window compaction.
 * Supports model-specific limits with configurable defaults and overrides.
 */

const ContextManager = {
  metadata: {
    id: 'ContextManager',
    version: '2.0.0',
    genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'LLMClient', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { LLMClient, EventBus } = deps;

    // ─────────────────────────────────────────────────────────────────────────
    // Model Limits Configuration
    // ─────────────────────────────────────────────────────────────────────────

    // Default limits (conservative, works with most models)
    const DEFAULT_LIMITS = {
      compact: 30000,      // Trigger compaction at 30k tokens
      warning: 100000,     // Emit warning at 100k tokens (80% of hard)
      hard: 120000         // Hard limit - aggressive compact then halt
    };

    // Model-specific overrides (model ID pattern → limits)
    // Patterns are matched with startsWith for flexibility
    // Order matters - more specific patterns should come first
    const MODEL_LIMITS = {
      // Gemini models - massive context windows (1M+)
      // Match gemini-2, gemini-3, gemini-exp, etc.
      'gemini-': { compact: 200000, warning: 400000, hard: 500000 },
      'gemini-exp': { compact: 200000, warning: 400000, hard: 500000 },

      // Anthropic Claude models (200k context)
      'claude-opus-4': { compact: 150000, warning: 170000, hard: 190000 },
      'claude-sonnet-4': { compact: 150000, warning: 170000, hard: 190000 },
      'claude-3-opus': { compact: 150000, warning: 170000, hard: 190000 },
      'claude-3-sonnet': { compact: 150000, warning: 170000, hard: 190000 },
      'claude-3-haiku': { compact: 150000, warning: 170000, hard: 190000 },
      'claude-3.5': { compact: 150000, warning: 170000, hard: 190000 },

      // OpenAI models
      'gpt-5': { compact: 150000, warning: 180000, hard: 200000 },  // Future GPT-5
      'gpt-4o': { compact: 100000, warning: 115000, hard: 125000 },
      'gpt-4-turbo': { compact: 100000, warning: 115000, hard: 125000 },
      'gpt-4': { compact: 6000, warning: 7000, hard: 8000 },  // Original GPT-4 has 8k
      'gpt-3.5': { compact: 12000, warning: 14000, hard: 16000 },
      'o1': { compact: 100000, warning: 180000, hard: 200000 },
      'o3': { compact: 100000, warning: 180000, hard: 200000 },
      'o4': { compact: 150000, warning: 180000, hard: 200000 },

      // Local/WebLLM models (typically smaller context)
      'llama': { compact: 6000, warning: 7000, hard: 8000 },
      'phi': { compact: 3000, warning: 3500, hard: 4000 },
      'qwen': { compact: 25000, warning: 28000, hard: 32000 },
      'smollm': { compact: 1500, warning: 1800, hard: 2000 }
    };

    // Runtime limit overrides (set via setLimits)
    let _runtimeOverrides = null;

    // ─────────────────────────────────────────────────────────────────────────
    // Limit Resolution
    // ─────────────────────────────────────────────────────────────────────────

    const getLimitsForModel = (modelId) => {
      // Runtime overrides take precedence
      if (_runtimeOverrides) {
        return { ...DEFAULT_LIMITS, ..._runtimeOverrides };
      }

      if (!modelId) return DEFAULT_LIMITS;

      const lowerModelId = modelId.toLowerCase();

      // Find matching model pattern
      for (const [pattern, limits] of Object.entries(MODEL_LIMITS)) {
        if (lowerModelId.startsWith(pattern.toLowerCase())) {
          return { ...DEFAULT_LIMITS, ...limits };
        }
      }

      return DEFAULT_LIMITS;
    };

    const setLimits = (overrides) => {
      _runtimeOverrides = overrides;
      logger.info(`[ContextManager] Runtime limits set: ${JSON.stringify(overrides)}`);
    };

    const clearLimitOverrides = () => {
      _runtimeOverrides = null;
      logger.info('[ContextManager] Runtime limit overrides cleared');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Token Counting (with caching)
    // ─────────────────────────────────────────────────────────────────────────

    let _cachedTokenCount = null;
    let _cachedContextLength = 0;
    let _cachedLastMessageLength = 0;

    /**
     * Improved token estimator using word-based heuristics
     * More accurate than simple char/4 approximation
     * ~1.3 tokens per word for English, accounting for punctuation and whitespace
     */
    const estimateTokens = (text) => {
      if (!text || typeof text !== 'string') return 0;

      // Count words (split on whitespace)
      const words = text.trim().split(/\s+/).filter(w => w.length > 0);
      let tokenEstimate = 0;

      for (const word of words) {
        // Most words are 1 token, but long words and punctuation add more
        if (word.length <= 4) {
          tokenEstimate += 1;
        } else if (word.length <= 8) {
          tokenEstimate += 1.3;
        } else if (word.length <= 12) {
          tokenEstimate += 1.7;
        } else {
          // Very long words (technical terms, URLs) are split into more subwords
          tokenEstimate += Math.ceil(word.length / 4);
        }

        // Add tokens for punctuation attached to words
        const punctuation = (word.match(/[^\w]/g) || []).length;
        tokenEstimate += punctuation * 0.5;
      }

      // Account for message structure overhead (role, formatting)
      return Math.ceil(tokenEstimate);
    };

    const countTokens = (context) => {
      const contextLength = context.length;
      const lastMessageLength = context.length > 0
        ? (context[context.length - 1].content?.length || 0)
        : 0;

      // Cache hit
      if (_cachedTokenCount !== null &&
          contextLength === _cachedContextLength &&
          lastMessageLength === _cachedLastMessageLength) {
        return _cachedTokenCount;
      }

      // Cache miss: recalculate with improved estimator
      let totalTokens = 0;
      for (const m of context) {
        // Add ~4 tokens overhead per message for role/formatting
        totalTokens += 4;
        totalTokens += estimateTokens(m.content);
      }

      _cachedTokenCount = totalTokens;
      _cachedContextLength = contextLength;
      _cachedLastMessageLength = lastMessageLength;

      return _cachedTokenCount;
    };

    const invalidateTokenCache = () => {
      _cachedTokenCount = null;
      _cachedContextLength = 0;
      _cachedLastMessageLength = 0;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Threshold Checks
    // ─────────────────────────────────────────────────────────────────────────

    const shouldCompact = (context, modelId) => {
      const limits = getLimitsForModel(modelId);
      return countTokens(context) > limits.compact;
    };

    const isAtWarningLevel = (context, modelId) => {
      const limits = getLimitsForModel(modelId);
      const tokens = countTokens(context);
      return tokens > limits.warning && tokens <= limits.hard;
    };

    const exceedsHardLimit = (context, modelId) => {
      const limits = getLimitsForModel(modelId);
      const tokens = countTokens(context);
      return {
        exceeded: tokens > limits.hard,
        tokens,
        limit: limits.hard,
        limits // Include full limits for debugging
      };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Critical Info Extraction
    // ─────────────────────────────────────────────────────────────────────────

    const extractCriticalInfo = (messages, aggressive = false) => {
      const toolCalls = [];
      const memoryOps = [];
      const errors = [];
      const decisions = [];

      for (const msg of messages) {
        const content = msg.content || '';

        // Extract tool calls
        const toolCallMatches = content.matchAll(/TOOL_CALL:\s*(\w+)/g);
        for (const match of toolCallMatches) {
          toolCalls.push({ tool: match[1], role: msg.role });
        }

        const toolResultMatches = content.matchAll(/Act #(\d+) → (\w+)\s*(.*?)(?=Act #|\n\n|$)/gs);
        for (const match of toolResultMatches) {
          // In aggressive mode, truncate results more
          const resultLen = aggressive ? 50 : 100;
          toolCalls.push({ cycle: match[1], tool: match[2], result: match[3].substring(0, resultLen) });
        }

        // Extract memory operations
        if (content.includes('WriteFile') || content.includes('CreateTool') || content.includes('LoadModule')) {
          const opLen = aggressive ? 80 : 150;
          memoryOps.push({ role: msg.role, op: content.substring(0, opLen) });
        }

        // Extract errors (always preserve these)
        if (content.includes('ERROR') || content.includes('failed') || content.includes('Error:')) {
          const errLen = aggressive ? 100 : 200;
          errors.push(content.substring(0, errLen));
        }

        // Extract key decisions
        const thinkMatches = content.matchAll(/Think #(\d+)\s*\n(.*?)(?=\nTOOL_CALL|\nThink #|$)/gs);
        for (const match of thinkMatches) {
          if (match[2].length > 50) {
            const thoughtLen = aggressive ? 100 : 200;
            decisions.push({ cycle: match[1], thought: match[2].substring(0, thoughtLen) });
          }
        }
      }

      return { toolCalls, memoryOps, errors, decisions };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Compaction
    // ─────────────────────────────────────────────────────────────────────────

    const compact = async (context, modelConfig, options = {}) => {
      const modelId = modelConfig?.id;
      const limits = getLimitsForModel(modelId);
      const tokens = countTokens(context);
      const aggressive = options.aggressive || false;

      // Check if compaction needed
      if (tokens <= limits.compact && !aggressive) {
        return { context, compacted: false };
      }

      if (!modelConfig) {
        logger.warn('[ContextManager] No model config provided, skipping compaction');
        return { context, compacted: false };
      }

      const mode = aggressive ? 'AGGRESSIVE' : 'STANDARD';
      logger.info(`[ContextManager] ${mode} compaction starting (${tokens} tokens, limit: ${limits.compact})`);

      // Aggressive mode: keep fewer recent messages
      const recentCount = aggressive ? 4 : 8;

      const start = context.slice(0, 2); // System + First User (goal)
      const end = context.slice(-recentCount);
      const middle = context.slice(2, -recentCount);

      if (middle.length === 0) {
        return { context, compacted: false };
      }

      // Extract critical info (with aggressive truncation if needed)
      const critical = extractCriticalInfo(middle, aggressive);

      // Build compact summary
      let compactSummary = `[CONTEXT COMPACTED - ${mode}]\n\n`;

      // In aggressive mode, keep fewer items
      const toolLimit = aggressive ? 5 : 10;
      const memLimit = aggressive ? 3 : 5;
      const errLimit = aggressive ? 2 : 3;
      const decLimit = aggressive ? 3 : 5;

      if (critical.toolCalls.length > 0) {
        compactSummary += `TOOL CALLS (${critical.toolCalls.length}):\n`;
        critical.toolCalls.slice(-toolLimit).forEach(tc => {
          compactSummary += `- ${tc.tool}${tc.result ? ': ' + tc.result : ''}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.memoryOps.length > 0) {
        compactSummary += `MEMORY OPERATIONS:\n`;
        critical.memoryOps.slice(-memLimit).forEach(op => {
          compactSummary += `- ${op.op}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.errors.length > 0) {
        compactSummary += `ERRORS TO AVOID:\n`;
        critical.errors.slice(-errLimit).forEach(err => {
          compactSummary += `- ${err}\n`;
        });
        compactSummary += '\n';
      }

      if (critical.decisions.length > 0) {
        compactSummary += `KEY DECISIONS:\n`;
        critical.decisions.slice(-decLimit).forEach(dec => {
          compactSummary += `- Cycle ${dec.cycle}: ${dec.thought}\n`;
        });
      }

      compactSummary += `\n[${middle.length} messages compacted]`;

      const compacted = [...start, { role: 'user', content: compactSummary }, ...end];
      const newTokens = countTokens(compacted);

      invalidateTokenCache();

      // Notify UI
      if (EventBus) {
        EventBus.emit('context:compacted', {
          mode,
          previousTokens: tokens,
          newTokens,
          reduction: tokens - newTokens,
          preserved: {
            toolCalls: Math.min(critical.toolCalls.length, toolLimit),
            errors: Math.min(critical.errors.length, errLimit),
            decisions: Math.min(critical.decisions.length, decLimit)
          }
        });
      }

      logger.info(`[ContextManager] ${mode} compaction complete: ${tokens} → ${newTokens} tokens (${middle.length} msgs compacted)`);

      return { context: compacted, compacted: true, previousTokens: tokens, newTokens };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Main Entry Point: Manage Context
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Main context management function. Call before each LLM request.
     * Returns { context, halted, error } where halted=true means agent should stop.
     */
    const manage = async (context, modelConfig) => {
      const modelId = modelConfig?.id;
      const limits = getLimitsForModel(modelId);
      let currentContext = context;
      let tokens = countTokens(currentContext);

      // Emit current token count
      emitTokens(currentContext, modelId);

      // Step 1: Warning level check
      if (isAtWarningLevel(currentContext, modelId)) {
        logger.warn(`[ContextManager] Context at warning level: ${tokens}/${limits.hard} tokens`);
        if (EventBus) {
          EventBus.emit('context:warning', {
            tokens,
            limit: limits.hard,
            percentage: Math.round((tokens / limits.hard) * 100)
          });
        }
      }

      // Step 2: Standard compaction if needed
      if (shouldCompact(currentContext, modelId)) {
        const result = await compact(currentContext, modelConfig, { aggressive: false });
        if (result.compacted) {
          currentContext = result.context;
          tokens = countTokens(currentContext);
        }
      }

      // Step 3: Check if still over hard limit → aggressive compaction
      let hardCheck = exceedsHardLimit(currentContext, modelId);
      if (hardCheck.exceeded) {
        logger.warn(`[ContextManager] Still over hard limit after standard compact, trying aggressive...`);

        const result = await compact(currentContext, modelConfig, { aggressive: true });
        if (result.compacted) {
          currentContext = result.context;
          tokens = countTokens(currentContext);
        }

        // Step 4: Final check - if still over, halt the agent
        hardCheck = exceedsHardLimit(currentContext, modelId);
        if (hardCheck.exceeded) {
          const error = `Context exceeds hard limit even after aggressive compaction: ${tokens}/${limits.hard} tokens. Agent must halt.`;
          logger.error(`[ContextManager] ${error}`);

          if (EventBus) {
            EventBus.emit('context:halted', {
              reason: 'hard_limit_exceeded',
              tokens,
              limit: limits.hard,
              message: error
            });
          }

          return {
            context: currentContext,
            halted: true,
            error
          };
        }
      }

      return {
        context: currentContext,
        halted: false,
        error: null
      };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Token Emission (for UI)
    // ─────────────────────────────────────────────────────────────────────────

    const emitTokens = (context, modelId) => {
      const limits = getLimitsForModel(modelId);
      const tokens = countTokens(context);
      const hardCheck = exceedsHardLimit(context, modelId);

      if (EventBus) {
        EventBus.emit('agent:tokens', {
          tokens,
          compact: limits.compact,
          warning: limits.warning,
          limit: limits.hard,
          exceeded: hardCheck.exceeded,
          percentage: Math.round((tokens / limits.hard) * 100)
        });
      }

      return tokens;
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Exports
    // ─────────────────────────────────────────────────────────────────────────

    return {
      // Core functions
      countTokens,
      invalidateTokenCache,

      // Threshold checks
      shouldCompact,
      isAtWarningLevel,
      exceedsHardLimit,

      // Compaction
      compact,

      // Main entry point (recommended)
      manage,

      // Configuration
      getLimitsForModel,
      setLimits,
      clearLimitOverrides,

      // Token events
      emitTokens,

      // Expose defaults for reference
      DEFAULT_LIMITS,
      MODEL_LIMITS
    };
  }
};

export default ContextManager;
