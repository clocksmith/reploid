# Blueprint 0x00003A: Context Management

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/context-manager.js`, `/tests/unit/context-manager.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/context-manager.js`

**Former Blueprint Paths:** `self/blueprints/0x00003A-context-management.md`

**Module ID:** `ContextManager` (version 2.0.0, genesis level `spark`, type `service`; dependencies `Utils`, `LLMClient`, `EventBus`, optional `DopplerToolbox`)

**Source:** `self/core/context-manager.js`

---

## Purpose

`ContextManager` keeps the agent's message array inside the selected model's context window. Before each model request the agent loop calls `manage(context, modelConfig)` (`packages/reploid/src/agent/lab-strategy-cycle.js:211`). It estimates tokens, emits a warning near the limit, replaces the middle of the conversation with a structured summary when the compaction threshold is passed, and tells the caller to halt when even aggressive compaction cannot get under the hard limit.

It does not score messages by importance. There is no recency, role, keyword or length weighting in the code; earlier drafts of this blueprint described one (with conflicting keyword weights of 25% and 15) that was never implemented. Compaction is positional plus pattern extraction, described below.

## Limits

`getLimitsForModel(modelId)` (`context-manager.js:76`) returns `{ compact, warning, hard }`:

1. If `setLimits(overrides)` was called, `{ ...DEFAULT_LIMITS, ...overrides }`.
2. Otherwise the first `MODEL_LIMITS` key that the lowercased model ID starts with, merged over the defaults. Keys are checked in declaration order (for example `gemini-`, `claude-opus-4`, `claude-3.5`, `gpt-5`, `gpt-4o`, `gpt-4`, `o1`, `llama`, `qwen`, `smollm`).
3. Otherwise `DEFAULT_LIMITS = { compact: 30000, warning: 100000, hard: 120000 }`.

`clearLimitOverrides()` removes runtime overrides.

## Token estimate

`estimateTokens(text)` (`:119`) is a word heuristic: words of up to 4 characters count 1, up to 8 count 1.3, up to 12 count 1.7, longer words count `ceil(length / 4)`, plus 0.5 per non-word character. `countTokens(context)` (`:148`) adds 4 tokens per message and caches the result keyed on message count and last-message length; `invalidateTokenCache()` clears it. The estimate is not a tokenizer and can differ from the provider's count.

## `manage(context, modelConfig)`

Defined at `:598`. Returns `{ context, halted, error, compacted, previousTokens, newTokens }`.

1. Emit `agent:tokens` with `{ tokens, compact, warning, limit, exceeded, percentage }`.
2. If tokens are above `warning` and at or below `hard`, emit `context:warning` with `{ tokens, limit, percentage }`.
3. If tokens are above `compact`, run standard `compact`.
4. If still above `hard`, run aggressive `compact`.
5. If still above `hard`, emit `context:halted` with `{ reason: 'hard_limit_exceeded', tokens, limit, message }` and return `halted: true` with an error string. The caller must stop the run.

## `compact(context, modelConfig, { aggressive })`

Defined at `:491`. Returns `{ context, compacted }`, plus `previousTokens` and `newTokens` when it compacted.

- It does nothing when tokens are at or below `compact` (unless `aggressive`), when `modelConfig` is missing, or when there is no middle section.
- It keeps the first two messages (system prompt and goal) and the last 8 messages (4 when aggressive). The middle is replaced by one `user` message that starts with `[CONTEXT COMPACTED - STANDARD]` or `[CONTEXT COMPACTED - AGGRESSIVE]`.
- A previous compaction message in the middle is parsed and merged, so repeated compactions accumulate one summary and increment its `Compactions:` count.
- `extractCriticalInfo` (`:416`) pulls five sections from the middle messages by pattern: tool calls (`TOOL_CALL:`/`TOOL:` names and `Act #n -> Tool result` lines), memory operations (messages mentioning `WriteFile`, `CreateTool` or `LoadModule`), errors (`ERROR`, `failed`, `Error:`), decisions (`Think #n` blocks longer than 50 characters) and memory signals (lines starting with `[MEMORY]`, `[Past Context]`, `[Anticipated:`, `[Relevant Memories]` or `[Conversation Context]`). Excerpts are clipped shorter in aggressive mode.
- The summary budget (`getCompactionBudget`, `:319`) is 8% of current tokens (5% aggressive), clamped between 800 and 12% of `compact` (500 and 8% aggressive).
- `allocateSectionBudgets` (`:330`) splits it by fixed weights: tool calls 0.35, memory operations 0.2, errors 0.18, decisions 0.18, memory signals 0.09, with per-section minimums of 120, 80, 100, 100 and 60 tokens. When minimums exceed the total, the other sections shrink before errors do.
- Each section keeps its newest items that fit its budget, deduplicated.
- It emits `context:compacted` with `{ mode, previousTokens, newTokens, reduction, preserved, compactions, summaryBudget, summaryTokens, summary, ts }`.

## Other exports

`shouldCompact`, `isAtWarningLevel`, `exceedsHardLimit`, `emitTokens`, `DEFAULT_LIMITS` and `MODEL_LIMITS` expose the same checks. For the FunctionGemma expert path, `createSharedPrefix(context, modelConfig, options)` pre-fills a KV prefix through `DopplerToolbox.prefillKV` or `LLMClient.prefillKV` (returning `{ snapshot: null, prompt: null }` when neither exists) and emits `context:prefix`; `initSharedPrefix`, `registerExpertPrompt`, `getExpertContext` and `clearExpertContext` hold the shared prefix and per-expert prompt suffixes used by `self/core/functiongemma-orchestrator.js`.

## Boundaries

- Compaction is lossy: content outside the extracted patterns in the middle section is dropped from the request. It is not archived elsewhere by this module.
- Halting is reported to the caller; the module does not stop the agent itself.

## Related blueprints

- [0x000008 Agent Cognitive Cycle](0x000008-agent-cognitive-cycle.md): the caller.
- [0x000007 API Client and Communication](0x000007-api-client-and-communication.md): receives the managed context.
- [0x000039 Streaming Response Handler](0x000039-streaming-response-handler.md): streams the response after the request is sent.
