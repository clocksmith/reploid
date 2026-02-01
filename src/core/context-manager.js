/**
 * @fileoverview Context Manager
 * Manages token budget and context window compaction.
 * Supports model-specific limits with configurable defaults and overrides.
 */

const ContextManager = {
  metadata: {
    id: 'ContextManager',
    version: '2.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'LLMClient', 'EventBus', 'DopplerToolbox?'],
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { LLMClient, EventBus, DopplerToolbox } = deps;

    // -------------------------------------------------------------------------
    // Model Limits Configuration
    // -------------------------------------------------------------------------

    // Default limits (conservative, works with most models)
    const DEFAULT_LIMITS = {
      compact: 30000,      // Trigger compaction at 30k tokens
      warning: 100000,     // Emit warning at 100k tokens (80% of hard)
      hard: 120000         // Hard limit - aggressive compact then halt
    };

    // Model-specific overrides (model ID pattern -> limits)
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

    // FunctionGemma KV prefix cache
    let _kvPrefixCache = null;
    let _expertPrompts = {};

    // -------------------------------------------------------------------------
    // Limit Resolution
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Token Counting (with caching)
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Threshold Checks
    // -------------------------------------------------------------------------

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

    const COMPACTION_MARKER = '[CONTEXT COMPACTED';

    const isCompactionMessage = (msg) => {
      const content = msg?.content || '';
      return content.includes(COMPACTION_MARKER);
    };

    const stripCompactionMessages = (messages) => {
      let compactionSummary = null;
      const filtered = [];
      for (const msg of messages) {
        if (isCompactionMessage(msg)) {
          compactionSummary = msg;
          continue;
        }
        filtered.push(msg);
      }
      return { filtered, compactionSummary };
    };

    const parseCompactionSummary = (content = '') => {
      const sections = {
        toolCalls: [],
        memoryOps: [],
        errors: [],
        decisions: [],
        memorySignals: []
      };
      let compactions = 0;
      if (!content) return { compactions, sections };

      const lines = content.split('\n');
      let current = null;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          current = null;
          continue;
        }

        if (trimmed.toLowerCase().startsWith('compactions:')) {
          const match = trimmed.match(/Compactions:\s*(\d+)/i);
          if (match) compactions = Number(match[1]) || compactions;
          continue;
        }

        if (trimmed.startsWith('TOOL CALLS')) {
          current = 'toolCalls';
          continue;
        }
        if (trimmed.startsWith('MEMORY OPERATIONS')) {
          current = 'memoryOps';
          continue;
        }
        if (trimmed.startsWith('ERRORS TO AVOID')) {
          current = 'errors';
          continue;
        }
        if (trimmed.startsWith('KEY DECISIONS')) {
          current = 'decisions';
          continue;
        }
        if (trimmed.startsWith('MEMORY SIGNALS')) {
          current = 'memorySignals';
          continue;
        }
        if (trimmed.startsWith('[') && trimmed.endsWith('messages compacted]')) {
          current = null;
          continue;
        }

        if (trimmed.startsWith('- ') && current) {
          sections[current].push(trimmed.slice(2));
        }
      }

      return { compactions, sections };
    };

    const mergeSectionItems = (existing = [], incoming = []) => {
      const combined = [...existing, ...incoming];
      const seen = new Set();
      const deduped = [];

      for (const item of combined) {
        const normalized = String(item || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(normalized);
      }

      return deduped;
    };

    const trimToTokenBudget = (items, budget) => {
      if (!budget || budget <= 0) return [];
      let used = 0;
      const kept = [];

      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const itemTokens = estimateTokens(item) + 1;
        if (used + itemTokens > budget) continue;
        kept.push(item);
        used += itemTokens;
      }

      return kept.reverse();
    };

    const getCompactionBudget = (tokens, limits, aggressive) => {
      const percentOfContext = aggressive ? 0.05 : 0.08;
      const minTokens = aggressive ? 500 : 800;
      const maxTokens = Math.max(
        minTokens,
        Math.floor(limits.compact * (aggressive ? 0.08 : 0.12))
      );
      const target = Math.floor(tokens * percentOfContext);
      return Math.max(minTokens, Math.min(maxTokens, target));
    };

    const allocateSectionBudgets = (totalBudget, sections) => {
      const weights = {
        toolCalls: 0.35,
        memoryOps: 0.2,
        errors: 0.18,
        decisions: 0.18,
        memorySignals: 0.09
      };
      const minimums = {
        toolCalls: 120,
        memoryOps: 80,
        errors: 100,
        decisions: 100,
        memorySignals: 60
      };

      const budgets = {};
      let sum = 0;
      for (const [key, weight] of Object.entries(weights)) {
        if (!sections[key] || sections[key].length === 0) {
          budgets[key] = 0;
          continue;
        }
        budgets[key] = Math.max(Math.floor(totalBudget * weight), minimums[key]);
        sum += budgets[key];
      }

      if (sum <= totalBudget) return budgets;

      let excess = sum - totalBudget;
      const reducible = ['toolCalls', 'memoryOps', 'decisions', 'memorySignals'];

      for (const key of reducible) {
        if (excess <= 0) break;
        if (!sections[key] || sections[key].length === 0) continue;
        const min = minimums[key];
        const available = budgets[key] - min;
        if (available <= 0) continue;
        const reduce = Math.min(available, excess);
        budgets[key] -= reduce;
        excess -= reduce;
      }

      if (excess > 0 && budgets.errors) {
        const min = Math.min(minimums.errors, budgets.errors);
        const available = budgets.errors - min;
        if (available > 0) {
          budgets.errors -= Math.min(available, excess);
        }
      }

      return budgets;
    };

    const buildCompactionSummary = ({
      mode,
      compactionCount,
      sections,
      compactedCount
    }) => {
      let summary = `[CONTEXT COMPACTED - ${mode}]\n`;
      summary += `Compactions: ${compactionCount}\n\n`;

      const addSection = (title, items) => {
        if (!items || items.length === 0) return;
        summary += `${title} (${items.length}):\n`;
        items.forEach(item => {
          summary += `- ${item}\n`;
        });
        summary += '\n';
      };

      addSection('TOOL CALLS', sections.toolCalls);
      addSection('MEMORY SIGNALS', sections.memorySignals);
      addSection('MEMORY OPERATIONS', sections.memoryOps);
      addSection('ERRORS TO AVOID', sections.errors);
      addSection('KEY DECISIONS', sections.decisions);

      summary += `[${compactedCount} messages compacted]`;
      return summary;
    };

    // -------------------------------------------------------------------------
    // Critical Info Extraction
    // -------------------------------------------------------------------------

    const extractCriticalInfo = (messages, aggressive = false) => {
      const toolCalls = [];
      const memoryOps = [];
      const errors = [];
      const decisions = [];
      const memorySignals = [];

      for (const msg of messages) {
        const content = msg.content || '';
        if (!content) continue;
        if (content.includes(COMPACTION_MARKER)) continue;

        // Extract tool calls
        const toolCallMatches = content.matchAll(/TOOL_CALL:\s*(\w+)/g);
        for (const match of toolCallMatches) {
          toolCalls.push(match[1]);
        }

        const toolResultMatches = content.matchAll(/Act #(\d+) -> (\w+)\s*(.*?)(?=Act #|\n\n|$)/gs);
        for (const match of toolResultMatches) {
          // In aggressive mode, truncate results more
          const resultLen = aggressive ? 50 : 100;
          const result = match[3].replace(/\s+/g, ' ').trim().substring(0, resultLen);
          toolCalls.push(result ? `${match[2]}: ${result}` : match[2]);
        }

        // Extract memory operations
        if (content.includes('WriteFile') || content.includes('CreateTool') || content.includes('LoadModule')) {
          const opLen = aggressive ? 80 : 150;
          memoryOps.push(content.replace(/\s+/g, ' ').trim().substring(0, opLen));
        }

        // Extract errors (always preserve these)
        if (content.includes('ERROR') || content.includes('failed') || content.includes('Error:')) {
          const errLen = aggressive ? 100 : 200;
          errors.push(content.replace(/\s+/g, ' ').trim().substring(0, errLen));
        }

        // Extract key decisions
        const thinkMatches = content.matchAll(/Think #(\d+)\s*\n(.*?)(?=\nTOOL_CALL|\nThink #|$)/gs);
        for (const match of thinkMatches) {
          if (match[2].length > 50) {
            const thoughtLen = aggressive ? 100 : 200;
            const thought = match[2].replace(/\s+/g, ' ').trim().substring(0, thoughtLen);
            decisions.push(`Cycle ${match[1]}: ${thought}`);
          }
        }

        if (content.includes('[MEMORY]') ||
            content.includes('[Past Context]') ||
            content.includes('[Anticipated:') ||
            content.includes('[Relevant Memories]') ||
            content.includes('[Conversation Context]')) {
          const signalLen = aggressive ? 140 : 220;
          const lines = content.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^\[(MEMORY|Past Context|Anticipated|Relevant Memories|Conversation Context)\b/.test(trimmed)) {
              const clipped = trimmed.length > signalLen
                ? `${trimmed.slice(0, signalLen).trim()}...`
                : trimmed;
              memorySignals.push(clipped);
            }
          }
        }
      }

      return { toolCalls, memoryOps, errors, decisions, memorySignals };
    };

    // -------------------------------------------------------------------------
    // Compaction
    // -------------------------------------------------------------------------

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

      const { filtered: middleMessages, compactionSummary } = stripCompactionMessages(middle);
      if (middleMessages.length === 0) {
        return { context, compacted: false };
      }

      const previous = parseCompactionSummary(compactionSummary?.content);
      const critical = extractCriticalInfo(middleMessages, aggressive);

      const combined = {
        toolCalls: mergeSectionItems(previous.sections.toolCalls, critical.toolCalls),
        memoryOps: mergeSectionItems(previous.sections.memoryOps, critical.memoryOps),
        errors: mergeSectionItems(previous.sections.errors, critical.errors),
        decisions: mergeSectionItems(previous.sections.decisions, critical.decisions),
        memorySignals: mergeSectionItems(previous.sections.memorySignals, critical.memorySignals)
      };

      const summaryBudget = getCompactionBudget(tokens, limits, aggressive);
      const budgets = allocateSectionBudgets(summaryBudget, combined);

      const mergedSections = {
        toolCalls: trimToTokenBudget(combined.toolCalls, budgets.toolCalls),
        memoryOps: trimToTokenBudget(combined.memoryOps, budgets.memoryOps),
        errors: trimToTokenBudget(combined.errors, budgets.errors),
        decisions: trimToTokenBudget(combined.decisions, budgets.decisions),
        memorySignals: trimToTokenBudget(combined.memorySignals, budgets.memorySignals)
      };

      const priorCompactions = previous.compactions || (compactionSummary ? 1 : 0);
      const compactionCount = Math.max(1, priorCompactions + 1);
      const compactSummary = buildCompactionSummary({
        mode,
        compactionCount,
        sections: mergedSections,
        compactedCount: middleMessages.length
      });

      const compacted = [...start, { role: 'user', content: compactSummary }, ...end];

      invalidateTokenCache();
      const newTokens = countTokens(compacted);
      const summaryTokens = estimateTokens(compactSummary);

      // Notify UI
      if (EventBus) {
        EventBus.emit('context:compacted', {
          mode,
          previousTokens: tokens,
          newTokens,
          reduction: tokens - newTokens,
          preserved: {
            toolCalls: mergedSections.toolCalls.length,
            memorySignals: mergedSections.memorySignals.length,
            memoryOps: mergedSections.memoryOps.length,
            errors: mergedSections.errors.length,
            decisions: mergedSections.decisions.length
          },
          compactions: compactionCount,
          summaryBudget,
          summaryTokens,
          summary: compactSummary,
          ts: Date.now()
        });
      }

      logger.info(`[ContextManager] ${mode} compaction complete: ${tokens} -> ${newTokens} tokens (${middleMessages.length} msgs compacted, summary ~${summaryTokens}/${summaryBudget})`);

      return { context: compacted, compacted: true, previousTokens: tokens, newTokens };
    };

    // -------------------------------------------------------------------------
    // Main Entry Point: Manage Context
    // -------------------------------------------------------------------------

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

      // Step 3: Check if still over hard limit -> aggressive compaction
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

    // -------------------------------------------------------------------------
    // Token Emission (for UI)
    // -------------------------------------------------------------------------

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

    const buildPromptFromContext = (context) => {
      return context
        .map((m) => {
          if (m.role === 'system') return `System: ${m.content}`;
          if (m.role === 'user') return `User: ${m.content}`;
          if (m.role === 'assistant') return `Assistant: ${m.content}`;
          return m.content;
        })
        .join('\n') + '\nAssistant:';
    };

    const createSharedPrefix = async (context, modelConfig, options = {}) => {
      const prefill = DopplerToolbox?.prefillKV || LLMClient?.prefillKV;
      if (!prefill) {
        return { snapshot: null, prompt: null };
      }
      const prompt = options.prompt || buildPromptFromContext(context);
      const snapshot = await prefill(prompt, modelConfig, options);

      if (EventBus) {
        EventBus.emit('context:prefix', {
          tokens: countTokens(context),
          modelId: modelConfig?.id || null
        });
      }

      return { snapshot, prompt };
    };

    // -------------------------------------------------------------------------
    // FunctionGemma Expert Context
    // -------------------------------------------------------------------------

    /**
     * Initialize shared KV prefix for FunctionGemma expert network.
     * Call once before using getExpertContext().
     * @param {string} systemPrompt - Common system prompt for all experts
     * @param {Object} modelConfig - Model configuration
     * @returns {Promise<Object>} KV cache snapshot
     */
    const initSharedPrefix = async (systemPrompt, modelConfig) => {
      const { snapshot, prompt } = await createSharedPrefix(
        [{ role: 'system', content: systemPrompt }],
        modelConfig
      );
      _kvPrefixCache = snapshot;

      if (EventBus) {
        EventBus.emit('context:expert:init', {
          prefixCached: !!snapshot,
          modelId: modelConfig?.id
        });
      }

      return { snapshot, prompt };
    };

    /**
     * Register an expert-specific prompt suffix.
     * @param {string} expertId - Expert identifier
     * @param {string} promptSuffix - Expert specialization prompt
     */
    const registerExpertPrompt = (expertId, promptSuffix) => {
      _expertPrompts[expertId] = promptSuffix;
    };

    /**
     * Get context for a specific FunctionGemma expert.
     * @param {string} expertId - Expert identifier
     * @returns {Object} { prefix: KVSnapshot, expertPrompt: string }
     */
    const getExpertContext = (expertId) => {
      const expertPrompt = _expertPrompts[expertId] || '';

      return {
        prefix: _kvPrefixCache,
        expertPrompt,
        hasCachedPrefix: !!_kvPrefixCache
      };
    };

    /**
     * Clear expert context state.
     */
    const clearExpertContext = () => {
      _kvPrefixCache = null;
      _expertPrompts = {};
    };

    // -------------------------------------------------------------------------
    // Exports
    // -------------------------------------------------------------------------

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

      // Shared prefix KV helpers
      createSharedPrefix,

      // FunctionGemma expert context
      initSharedPrefix,
      registerExpertPrompt,
      getExpertContext,
      clearExpertContext,

      // Expose defaults for reference
      DEFAULT_LIMITS,
      MODEL_LIMITS
    };
  }
};

export default ContextManager;
