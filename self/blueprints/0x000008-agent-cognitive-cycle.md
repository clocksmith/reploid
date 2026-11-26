# Blueprint 0x000008: Agent Cognitive Cycle

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/agent-loop.js`, `/packages/reploid/src/agent/lab-strategy.js`, `/packages/reploid/src/agent/lab-strategy-cycle.js`, `/packages/reploid/src/agent/lab-strategy-generation.js`, `/packages/reploid/src/agent/lab-strategy-tools.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/agent-loop.js`

**Former Blueprint Paths:** `self/blueprints/0x000008-agent-cognitive-cycle.md`
**Objective:** Define the agent's think-act-observe loop: how a goal becomes model calls, tool calls and observed results, and how a run stops.

**Prerequisites:** [0x000001](0x000001-system-prompt-architecture.md) (prompt assembly), [0x000005](0x000005-state-management-architecture.md) (state), [0x000007](0x000007-api-client-and-communication.md) (LLM client), [0x00000A](0x00000A-tool-runner-engine.md) (tool runner), [0x00003A](0x00003A-context-management.md) (context), [0x00005C](0x00005C-circuit-breaker-pattern.md) (circuit breaker)

---

### 1. Where the loop lives

- `self/core/agent-loop.js` is the X/Zero module registered as `AgentLoop`. It wraps the shared loop and adds the X/Zero ports: run-trace recording (`createRunTraceRecorder` from `self/infrastructure/telemetry-timeline.js`), surface authorization of every tool call (`authorizeSurfaceOperation` from `shared/config/surface-intents.js`), per-attempt configuration from state and storage (`resolveAttemptConfig`), the prompt builder `buildAgentInitialContext` (`self/core/agent-context.js`) and the policies in `self/core/agent-loop-policies.js` ([0x0000A3](0x0000A3-core-agent-loop-policies.md)).
- The loop itself is `packages/reploid/src/agent/lab-strategy.js`, served to the browser through `shared/vendor/reploid/agent/legacy-loop.js`. It composes `lab-strategy-cycle.js` (context preparation), `lab-strategy-generation.js` (model calls and parsing), `lab-strategy-tools.js` (tool batches), `lab-strategy-function-gemma.js` and `lab-strategy-provider-recovery.js`, and runs each attempt through the execution engine in `engine.js`.

There is no `agent-cycle.js` and no finite-state machine with approval states. The Sentinel state machine of the former [0x000050](0x000050-sentinel-fsm.md) was never built.

### 2. One run

`run(goal)` starts one attempt; a second `run` while an attempt is active is rejected (`Agent already running`). Each attempt:

1. Resolves the attempt configuration, builds the initial context (system prompt plus `Begin. Goal: ...`) and, when `MemoryManager` is present, starts a memory session.
2. For each cycle up to the model's iteration limit (`getModelIterationLimit`):
   - prepares the context: `ContextManager.manage(context, modelConfig)` compacts when needed, and memory retrieval may add context;
   - calls `LLMClient.chat(context, model, onChunk)`, emitting `agent:status` with state `THINKING`;
   - parses tool calls with `ResponseParser.parseToolCalls` and checks `ResponseParser.isDone`;
   - runs the tool batch through `ToolExecutor`, after `authorizeTool` and a per-tool circuit breaker (`CircuitBreaker.create`) that skips a tool whose circuit is open;
   - appends tool results and records `agent:history` events; when `ReflectionStore` is present, tool outcomes are stored as reflections.
3. Stops on `DONE`, the iteration limit, `stop()`, `close()`, an abort, or the attempt timeout. A provider failure can park the attempt for a later resume (`hasPendingProviderResume`).

A read-only progress gate pushes the model to stage a change or report a blocker after a run of read-only discovery batches.

### 3. Public API

`run`, `stop`, `close`, `setModel`, `setModels`, `setConsensusStrategy`, `isRunning`, `hasPendingProviderResume`, `getRecentActivities`, `getExecutionEvents`, `checkpoint`, `getProviderRetryState`, `getProviderResumePromise`, `getSystemPrompt`, `getContext`, `injectHumanMessage`, `getMessageQueue`. The X/Zero wrapper adds `getRecordingStatus`, `flushRecording` and `exportReplayBundle`. Models cannot be changed while an attempt is active.

### 4. Authority

The loop proposes and executes tool calls inside the grants of its surface. A tool call that `authorizeTool` refuses does not run. Changes to the substrate pass the Verification Worker ([0x000040](0x000040-verification-manager.md)) and, for L3 claims, the improvement-episode contract in [docs/rsi-improvement-episodes.md](../../docs/rsi-improvement-episodes.md). A multi-model consensus strategy chooses among model outputs; it does not grant activation, which requires operator adoption ([INTENT.md](../../INTENT.md)).

### 5. Verification conditions

- A second `run` during an active attempt is rejected.
- `stop()` aborts the active model call and ends the attempt.
- A tool refused by surface authorization is not executed.
