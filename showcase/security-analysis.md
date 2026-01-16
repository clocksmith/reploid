# REPLOID Agent Loop Analysis

**Run JSON:** [reploid-export-1765143717007.json](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1765143717007.json)

## Overview
The REPLOID agent operates on a recursive "Think-Act-Observe" cycle, implemented primarily in `/core/agent-loop.js`. This architecture supports autonomous recursive self-improvement (RSI) through dynamic tool loading and hot-swappable modules.

## 1. Think (Cognition)
**Component:** `LLMClient`, `ContextManager`

- **Context Construction:** The agent builds a context array containing system prompts, user goals, and conversation history.
- **Constraint Management:** `ContextManager` ensures token limits are respected by compacting history while preserving semantic meaning.
- **Inference:** `LLMClient` routes requests to the configured provider (OpenAI, Anthropic, Gemini, or local WebLLM/Transformers). It supports both streaming and full responses.
- **Multi-Model Support:** The loop can coordinate multiple models (e.g., using a "peer-review" or "arena" strategy) to improve decision quality.

## 2. Act (Execution)
**Component:** `ToolRunner`, `ResponseParser`

- **Intent Parsing:** `ResponseParser` extracts tool calls from the LLM's raw text response using robust regex patterns (handling flexible whitespace and JSON structures).
- **Tool Execution:** `ToolRunner` executes the requested tools. It supports:
  - **Parallel Execution:** Read-only tools (like `ReadFile`, `ListFiles`) run in parallel batches for efficiency.
  - **Sequential Execution:** Mutating tools (like `WriteFile`) run sequentially to preserve causal order.
  - **Dynamic Loading:** Tools are loaded as blobs, allowing the agent to write its own tools and immediately use them (`CreateTool` + `LoadModule` pattern).
- **Circuit Breaker:** A circuit breaker prevents infinite retry loops on failing tools.

## 3. Observe (Perception)
**Component:** `AgentLoop`, `EventBus`

- **Feedback Loop:** Tool results are captured and fed back into the context as `TOOL_RESULT` messages.
- **Smart Truncation:** Large outputs are truncated to prevent context flooding, with hints to use specific file reading tools for details.
- **Loop Health:** The system monitors for "stuck" states (e.g., no tool calls for N iterations, repeated short responses) and attempts recovery or forces a summary.
- **Reflection:** Past execution patterns are stored in memory to warn the agent of potential pitfalls (e.g., "Watch out for these past failure patterns...").

## RSI Specific Features
- **Hot-Reloading:** The `LoadModule` tool allows the agent to modify its own source code and reload it without restarting the browser session.
- **Self-Correction:** The agent is explicitly instructed never to declare itself "done" in RSI mode, enforcing continuous optimization cycles.

## Summary
The REPLOID core is a robust, browser-native agentic loop designed for autonomy. Its ability to read, write, and execute its own code in real-time distinguishes it as a true RSI agent.
