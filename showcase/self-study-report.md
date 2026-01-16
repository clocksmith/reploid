# REPLOID Agent Loop Analysis

**Run JSON:** [reploid-gemini3-run.json](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-gemini3-run.json)

## Overview
The REPLOID agent operates on a recursive "Think-Act-Observe" cycle, implemented primarily in `/core/agent-loop.js`. It features advanced capabilities like multi-model consensus, self-reflection, and robust error handling.

## 1. Think (Cognition & Planning)
Before taking action, the agent constructs and refines its context:

- **Goal Management**: The cycle begins with `StateManager.setGoal()`. Context is initialized with a system prompt and the user's goal.
- **Reflection Injection**: The agent queries `ReflectionAnalyzer` for past failure patterns relevant to the current context, injecting them as warnings to prevent repeating mistakes.
- **Human-in-the-Loop**: The agent checks a message queue for human intervention (`injectHumanMessage`), prioritizing user guidance.
- **Semantic Enrichment**: `CognitionAPI.semantic.enrich()` expands the user's input with relevant knowledge from the Knowledge Graph before the LLM sees it.
- **Context Compaction & Safety**: `ContextManager.compact()` ensures the prompt stays within token limits. A hard token limit check acts as a final safety barrier, stopping the agent if the context grows dangerously large.

## 2. Act (Execution)
The agent determines the best course of action using flexible model strategies:

- **Model Execution Strategy**:
  - **Multi-Model Consensus**: If configured, `MultiModelCoordinator` runs an "arena" or "peer-review" process where multiple models propose solutions.
  - **Single Model Fallback**: Uses `LLMClient.chat()` for standard execution.
  - **Native Tool Calling**: Dynamically injects tool schemas from `ToolRunner` for models that support OpenAI-style function calling.

- **Tool Execution Engine**:
  - **Circuit Breaker**: `_toolCircuitBreaker` prevents repeated calls to failing tools (e.g., 3 failures = 60s cooldown).
  - **Retry Logic**: Tools are executed with retries and timeouts (`_executeToolWithRetry`).
  - **Recursive Chaining**: Supports tools returning `nextSteps` for immediate follow-up actions without a full cognitive cycle.
  - **Safety**: `ToolRunner` enforces permissions (especially for workers) and supports HITL (Human-in-the-Loop) approval for critical actions.

## 3. Observe (Feedback & Learning)
After execution, the agent processes results to refine its internal state:

- **Symbolic Validation**: `CognitionAPI.symbolic.validate()` checks the LLM's response against logic rules (post-generation safety).
- **Auto-Learning**: `CognitionAPI.learning.extract()` parses the interaction to update the Knowledge Graph automatically.
- **Loop Health & Recovery**: `_checkLoopHealth` detects stuck states (e.g., no tool calls, repetitive responses). It can trigger recovery strategies like forcing the agent to summarize its progress or stopping execution to prevent infinite loops.
- **Result Processing**: Tool outputs are truncated if too large (smart truncation), then added to the context.
- **Reflection Logging**: Successes and failures are logged to `ReflectionStore` to inform future "Think" phases.

## Summary
The REPLOID architecture goes beyond a simple loop by integrating **Meta-Cognition** (Reflection/Learning) and **Resilience** (Circuit Breakers/Health Checks) directly into the core cycle. This enables recursive self-improvement and robust autonomous operation.
