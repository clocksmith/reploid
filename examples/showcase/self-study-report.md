# Agent Loop Self-Description (two runs)

Two runs asked the agent to read its own source and describe its loop. Both
produced near-identical summaries of the same "Think-Act-Observe" cycle in
`/core/agent-loop.js`; they are merged here. This is the agent's own description
of code as it stood then, not a security analysis and not verified against the
code. For the current architecture see
[docs/system-architecture.md](../../docs/system-architecture.md).

**Curated run summaries (not replayable):**
[reploid-export-1765143717007.json](runs/reploid-export-1765143717007.json) and
[reploid-gemini3-run.json](runs/reploid-gemini3-run.json).

## 1. Think

- **Goal and context:** `StateManager.setGoal()` starts the cycle; the context holds the
  system prompt, the goal and the conversation history.
- **Reflection injection:** `ReflectionAnalyzer` supplies past failure patterns relevant to
  the context as warnings.
- **Human input:** a message queue (`injectHumanMessage`) takes priority.
- **Semantic enrichment:** `CognitionAPI.semantic.enrich()` adds Knowledge Graph context.
- **Compaction:** `ContextManager.compact()` keeps the prompt within token limits; a hard
  limit stops the agent if the context grows too large.
- **Inference:** `LLMClient` routes to the configured provider, streaming or not.

## 2. Act

- **Model strategy:** `MultiModelCoordinator` can run an "arena" or "peer-review" process;
  otherwise `LLMClient.chat()` runs one model. Tool schemas from `ToolRunner` are injected
  for models with native function calling.
- **Parsing:** `ResponseParser` extracts tool calls from the raw text.
- **Execution:** read-only tools run in parallel batches and mutating tools in order. Tools
  load as blobs, so the agent can write a tool and use it at once (`CreateTool` + `LoadModule`).
- **Resilience:** a circuit breaker stops repeated calls to failing tools (3 failures, 60 s
  cooldown); tools run with retries and timeouts; tools can return `nextSteps`.
- **Safety:** `ToolRunner` enforces permissions, especially for workers, and supports
  human approval for critical actions.

## 3. Observe

- **Results:** tool output returns to the context as `TOOL_RESULT` messages, truncated when large.
- **Validation and learning:** `CognitionAPI.symbolic.validate()` checks responses against
  rules; `CognitionAPI.learning.extract()` updates the Knowledge Graph.
- **Loop health:** `_checkLoopHealth` detects stuck states and can force a summary or stop.
- **Reflection logging:** successes and failures go to `ReflectionStore`.
- **Hot reload:** `LoadModule` reloads modified source without restarting the session.
