# REPLOID (Reflective Embodiment Providing Logical Oversight for Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID)) x0.0.0 DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID (Reflective Embodiment Providing Logical Oversight for Intelligent DREAMER)) v0.0.0

**REPLOID/DREAMER** is an experimental, self-contained HTML/CSS/JS application demonstrating a conceptual framework for LLM-driven iterative design, development, dynamic tool creation, and recursive self-improvement (RSI). It operates entirely within the browser, leveraging the Google Gemini API and the browser's `localStorage` for persistent, versioned artifact storage. This project explores creating agents that can reflect on their own structure and modify themselves to better achieve goals, all within the constraints of a standard web browser.

The core idea treats every component (UI, logic, prompts, tools) as versioned **artifacts** stored in `localStorage`. The agent ('x0', with dual LSD/XYZ personas) analyzes goals, reads artifacts, proposes changes, and saves outputs for the next cycle, creating a traceable history.

## Architectural Overview

REPLOID uses a modular structure orchestrated after bootstrapping:

1.  **Bootstrap (`index.html`, `boot.js`):** Initial load, checks/loads/initializes state & essential artifacts (with checksums) from `localStorage`, handles Genesis process if needed, loads the core logic orchestrator.
2.  **Orchestrator (`app-logic.js`):** Dynamically loads modules (`StateManager`, `UI`, `ApiClient`, `CycleLogic`, `ToolRunner`, etc.) and manages dependencies.
3.  **`StateManager` (`state-manager.js`):** Manages the application state (config, metrics, goals, **artifact metadata with versions**, autonomy state, history buffers). Handles persistence, validation, import/export.
4.  **`CycleLogic` (`agent-cycle.js`):** Orchestrates the main execution loop (9 refined steps), prepares prompts, calls `ApiClient`, processes responses (including tool calls/definitions), triggers critiques/HITL/evaluation, manages autonomy, calls `ToolRunner`, and instructs `Storage` via `StateManager` to apply changes.
5.  **`UI` (`ui-manager.js`):** Renders the interface (timeline, artifact display, config, controls, HITL/Sandbox UI, preview), handles events.
6.  **`ApiClient` (`api-client.js`):** Interacts with the Gemini API (streaming, function calling, retries, aborts).
7.  **`ToolRunner` (`tool-runner.js`):** Executes static tools (internal logic) and dynamic tools (sandboxed via Web Workers). Handles `convert_to_gemini_fc`.
8.  **Modules & Data (`utils.js`, `storage.js`, `*.txt`, `*.json`, etc.):** Provide utilities, storage abstraction, prompts, and initial configuration/data.

## Use Case Examples

**Example 1: System Goal - Simple Web Calculator (Basic Iteration)**

- **Goal (C0):** "Create a basic HTML calculator page with two inputs, four operation buttons, and a result display." (Type: System)
- **Cycle 1:** Agent generates `target.body` (HTML), `target.style.calculator` (CSS), `target.script.calculator` (JS). UI Preview updates.
- **Goal (C1):** "Add division by zero error handling to the calculator script." (Type: System)
- **Cycle 2:** Agent modifies `target.script.calculator` to include the check. Auto-critique passes. Preview behavior updated.

**Example 2: Meta Goal + RSI - Implementing Code Complexity Analysis**

- **Scenario:** Agent observes through self-evaluation or feedback that its generated Javascript (`target.script.*` artifacts) sometimes becomes overly complex over multiple iterations.
- **Goal (Cycle N):** "Improve self-awareness of code quality. Develop a dynamic tool called 'analyze_code_complexity'. Input: artifactId, cycle, language ('javascript'). Output: JSON object containing metrics like estimated cyclomatic complexity (counting keywords like if, for, while, etc.) and function length analysis for the specified JS artifact. Then, modify `reploid.core.evaluator-prompt` to include instructions for the evaluation LLM to consider the output of this new tool when assessing the 'quality_correctness' of Javascript artifacts." (Type: Meta)
- **Cycle N+1:**
  - **Analysis:** Agent identifies need for a new tool and modification of an existing prompt artifact.
  - **Proposal:** Proposes creating the `analyze_code_complexity` tool (declaration + implementation) and modifying `reploid.core.evaluator-prompt`. Confidence: 0.8.
  - **Generation:** LLM generates the tool schema, the JS implementation string for the tool (performing basic keyword counting), and the modified evaluator prompt text.
  - **Critique:** Auto-critique verifies the tool schema/implementation plausibility and checks the prompt modification. Passes.
  - **Apply:** `CycleLogic` adds the new dynamic tool definition to `state.dynamicTools` and saves the updated `reploid.core.evaluator-prompt` artifact for Cycle N+1.
- **Cycle N+2 (Self-Evaluation Scenario):** When the agent later calls the `run_self_evaluation` tool on a JS artifact, it (or the evaluation LLM guided by the updated prompt) can now _also_ call `analyze_code_complexity` on the target artifact. The complexity score becomes part of the evaluation context, potentially leading to lower evaluation scores for overly complex code and encouraging simpler solutions in future cycles.

**Example 3: System Goal + Dynamic Tool - Weather Display**

- **Goal (C X):** "Create a tool to fetch current temperature for a city using OpenWeatherMap API (assume key available). Display city/temp on the target page." (Type: System)
- **Cycle X+1:** Agent proposes+generates: 1) Dynamic tool `get_city_temperature` (schema + JS implementation using `fetch`), 2) Changes to `target.body` (placeholders), 3) New `target.script.weather` (calls tool, updates DOM). Applies changes, adds tool to state.
- **Goal (C X+1):** "Add button/input field to trigger weather lookup." (Type: System)
- **Cycle X+2:** Agent modifies `target.body`/`target.script.weather`. Specifies `tool_call` for `code_linter` on the new script. Tool runs, passes. Changes applied. User interaction in preview now triggers the dynamic tool.

**Example 4: Meta Goal + RSI - Implementing Self-Correction Planning**

- **Scenario:** A cycle fails due to a critique rejecting a proposal or a tool execution error, and standard retries don't resolve it, forcing HITL. The agent needs a better way to recover.
- **Goal (Cycle Z):** "When a cycle fails definitively (e.g., max retries reached, critique failure after feedback), instead of just stopping or requiring generic HITL, implement a self-correction planning mechanism. Create a dynamic tool 'propose_correction_plan'. Input: failureAnalysis (string). Output: JSON { proposed_actions: [{ artifact_id, change_description, rationale }], confidence }. Modify `CycleLogic` (`reploid.core.cyclelogic`) to call this tool on critical failure, using the generated plan to potentially inform the next cycle's goal or provide more structured options for HITL." (Type: Meta)
- **Cycle Z+1:**
  - **Analysis:** Agent understands the need for a recovery planning tool and modification to its core cycle logic. Targets `reploid.core.cyclelogic` and proposes the new tool.
  - **Proposal:** Proposes `propose_correction_plan` tool (schema + implementation - likely calling the core LLM with a specific prompt template focused on analyzing the failure string and proposing targeted fixes). Proposes modifications to the error/retry/HITL handling sections of `reploid.core.cyclelogic` to integrate the call to this new tool. Confidence: 0.75.
  - **Generation:** LLM generates the tool code and the complex Javascript modifications for `reploid.core.cyclelogic`.
  - **Critique:** Auto-critique runs. It might struggle to fully validate the complex logic changes in `reploid.core.cyclelogic` but checks for basic syntax and plausibility. Passes with caveats.
  - **Apply:** Tool added to state. Modified `reploid.core.cyclelogic` saved for Cycle Z+1. **Requires page reload to take effect.**
- **Cycle Z+2 (Failure Scenario):** A future cycle fails critically. The _updated_ `CycleLogic` now runs. Instead of generic HITL, it calls `propose_correction_plan` with details of the failure. The tool returns a structured plan (e.g., "[Modify artifact X because...], [Rerun tool Y with different params because...]"). `CycleLogic` then either uses this plan to auto-generate the next cycle's goal ("Attempt correction: [Plan Action 1]") or presents the structured plan as options in the HITL UI.

**Example 5: Meta Goal + Domain Tool - Transformer Config Generator**

- **Goal (Cycle T):** "Enable representing basic Transformer model architectures. Create a dynamic tool 'generate_transformer_config'. Input: description (string detailing layers, heads, dimensions, etc.). Output: A structured JSON object representing this configuration. Also, create a new artifact type 'TRANSFORMER_CONFIG' and update artifact metadata logic if needed." (Type: Meta)
- **Cycle T+1:**
  - **Analysis:** Agent identifies need for a new tool focused on a specific data structure (AI model config).
  - **Proposal:** Proposes the `generate_transformer_config` tool (schema + JS implementation that parses the description string and constructs the JSON). May also propose changes to `StateManager` or utils if a new artifact type needs formal recognition (or just uses JSON type). Confidence: 0.8.
  - **Generation:** LLM generates the tool code.
  - **Critique:** Passes.
  - **Apply:** Tool added to state. Modified `StateManager` (if needed) saved for Cycle T+1 (requires reload).
- **Cycle T+2 (Usage):**
  - **Goal:** "Generate a config for a 6-layer, 8-head transformer with dim 512 and save it as 'target.model.small_transformer_cfg'." (Type: System, using the new Meta-generated tool)
  - **Cycle:** Agent proposes calling `generate_transformer_config` and creating a new artifact `target.model.small_transformer_cfg` of type JSON (or TRANSFORMER_CONFIG) with the tool's output. Cycle completes, saving the JSON config artifact.

## How It Works (Core Concepts & Usage)

- **Artifacts are Key:** Everything (code, UI, prompts, data) is a versioned artifact stored in `localStorage` (key includes cycle & optional version ID). Changes in cycle `N` are saved for cycle `N+1`.
- **Cycle Loop:** (1) Define Goal -> (2) Analyze/Deliberate (LSD/XYZ Persona) -> (3) Propose Changes/Tools -> (4) LLM Call (+Tool Exec) -> (5) Critique Trigger Check -> (6) Critique/HITL -> (7) Apply (or Sandbox) -> (8) Evaluate -> (9) Next Action.
- **Goals:** Use UI radio buttons:
  - **System:** Modify external `target.*` artifacts (visible in Preview pane).
  - **Meta:** Modify `reploid.*` artifacts (agent's own code/prompts) or generate `full_html_source`. Requires careful review, potentially via Sandbox Preview.
- **Self-Mod Sandbox:** For major Meta changes (`full_html_source`), a preview appears. Approval reloads the page into the new version (state preserved via `sessionStorage`).
- **Tools:** Static tools (e.g., lint, read) + Dynamically created tools (LLM generates schema + JS code, run in Web Worker).
- **HITL:** Pauses occur on triggers (low confidence, errors, random, forced). UI provides modes for feedback, options, or direct code editing.
- **State:** `StateManager` handles state (config, metrics, artifact metadata, history). Export/Import saves/loads metadata, not artifact content.
- **Usage Steps:**
  1.  Provide Gemini API Key (UI or `config.js`).
  2.  Open `index.html`. Start (Continue/Reset).
  3.  (Optional) Adjust Configuration panel.
  4.  Set Goal text + select Goal Type (System/Meta).
  5.  Run (Manual Cycle, N Cycles, or Continuous).
  6.  Monitor UI (Timeline, Cycle Details, Preview, Metrics).
  7.  Handle HITL/Sandbox prompts.
  8.  Use controls (Go Back, Export/Import, Reset Context, Clear Storage - CAREFUL!).

## Key Features (v0.2.0+)

- LocalStorage Persistence & Artifact Versioning (Cycle + optional ID).
- Refined 9-Step Cycle-Based Iteration.
- Dual Persona (LSD/XYZ).
- System vs. Meta Goal Distinction.
- Sandbox Preview & **Self-Modification Workflow via Reload**.
- **Dynamic Tool Creation & Sandboxed Use** (Web Workers).
- Unified Tool Interface (Gemini Function Calling).
- Multi-Mode HITL (inc. Critique Feedback).
- State Management (Load/Save, Import/Export, Versioning, Validation, Session Restore, Stats).
- Basic Autonomous Operation Modes.
- Enhanced UI (Syntax Highlighting, Tool Summaries, Pan/Zoom Diagram).
- Advanced API Client (Streaming, Retries, Abort).
- Manual Context Summarization.
- Basic Self-Evaluation Capability & History Tracking.
- Storage Quota Awareness & Checksum Verification.

## Technical Stack / Limitations

- **Core:** Vanilla JS (ES6+), HTML5, CSS3
- **LLM:** Google Gemini API (streaming)
- **Sandboxing:** Web Workers API
- **Persistence:** `localStorage`, `sessionStorage`
- **Highlighting:** Prism.js
- **Limitations:** Experimental, localStorage size (~5-10MB), self-mod risks, tool sandboxing limits, patch tools are placeholders, complex error handling needed, prompt sensitivity, no API cost tracking.

## Next Steps / Future Work

1.  **Implement Modular Artifact Improvement Tools:**
    - **Description:** Fully implement the `apply_diff_patch` and `apply_json_patch` static tools using robust external libraries (e.g., `diff`, `fast-json-patch`). Implement dynamic tools for more complex structural editing (e.g., AST manipulation for replacing specific functions).
    - **Category:** Feature Request (RSI)
    - **Complexity:** 7/7
2.  **Advanced Context Management (Selective Injection / Graceful Continuation):**
    - **Description:** Implement sophisticated context management, like selecting only relevant history ("arc") or handling tasks exceeding token limits across multiple calls.
    - **Proposed Solution:** Requires adding logic (LLM-driven or heuristic) to `CycleLogic._assembleCorePrompt` for selective injection. Requires `CycleLogic` and `ApiClient` changes to detect/anticipate token limits, save state, and formulate continuation prompts.
    - **Category:** Feature Request / Code Improvement
    - **Complexity:** 7/7
3.  **Improve Error Handling Granularity:**
    - **Description:** Use specific custom error types (e.g., `ApiError`, `ToolError`) for cleaner, more robust error handling in `CycleLogic` and other modules.
    - **Proposed Solution:** Define custom error classes. Update modules to throw specific errors. Refactor `catch` blocks to handle different types appropriately.
    - **Category:** Code Improvement
    - **Complexity:** 4/7
4.  **Add Basic Unit Tests:**
    - **Description:** Introduce automated tests to prevent regressions.
    - **Proposed Solution:** Use a framework (Jest/Vitest). Test utilities, pure storage functions, state logic, static tool logic, worker message handling. Requires test environment setup.
    - **Category:** Code Improvement / Process Improvement
    - **Complexity:** 5/7
5.  **Implement Eval Refinement Loop:**
    - **Description:** Use evaluation data and critiques to refine the evaluation process itself (e.g., improve `EVAL_DEF` artifacts or the evaluator prompt).
    - **Proposed Solution:** Requires agent logic (likely Meta goal) to analyze `state.evaluationHistory`/`critiqueFeedbackHistory` and propose improvements to evaluation artifacts/prompts via the standard cycle.
    - **Category:** Feature Request (RSI)
    - **Complexity:** 6/7
6.  **Implement Self-Improvement via Evals/Critiques:**
    - **Description:** Use evaluation results/critiques to guide self-improvement of core agent components (prompts, logic via meta-goals).
    - **Proposed Solution:** Enhance core prompt to explicitly use eval/critique history. Agent proposes modifications to core prompts or JS modules based on analysis of failures/low scores.
    - **Category:** Feature Request (RSI)
    - **Complexity:** 6/7
7.  **Token Minimization Analysis & Optimization:**
    - **Description:** Reduce LLM token usage.
    - **Proposed Solution:** Analyze prompts for verbosity. Experiment with concise context representations. Refine summarization. Track token usage per component.
    - **Category:** Performance / Code Improvement
    - **Complexity:** 4/7
8.  **Browser-Cached Model Support (e.g., WebLLM / Transformers.js):**
    - **Description:** Explore using models running locally in the browser via Web AI / ONNX / WebLLM etc.
    - **Proposed Solution:** Abstract `ApiClient`. Integrate a library for local inference. Add UI config to select backend. Note capability differences.
    - **Category:** Feature Request / Research
    - **Complexity:** 7/7
9.  **Enhance Configuration Management:**
    - **Description:** Unify API key handling. Allow config overrides (e.g., URL params).
    - **Proposed Solution:** Consolidate API key loading. Add logic in bootstrap to read URL params and merge with config/state.
    - **Category:** Code Improvement
    - **Complexity:** 3/7

## Easter Eggs

- **Boot Screen Shortcuts:** On the initial "Continue / Reset" screen:
  - Press `Enter` key to Continue (load existing state).
  - Press `Space` bar to Reset (clear state and start fresh).
- **Skip Boot Animation:** During the scrolling bootstrap log animation, pressing `Enter`, clicking, or tapping the screen will skip the animation and load faster.
- **Numbers:** [OEIS A001110](https://oeis.org/A001110) - Sums of two squares, in two ways. Perhaps reflects the dual nature?
