# REPLOID (Reflective Embodiment Providing Logical Oversight for Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID)) x0.3.0 DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID (Reflective Embodiment Providing Logical Oversight for Intelligent DREAMER)) v0.3.0

**REPLOID/DREAMER** is an experimental, self-contained HTML/CSS/JS application demonstrating a conceptual framework for LLM-driven iterative design, development, dynamic tool creation, and recursive self-improvement (RSI). It operates entirely within the browser, leveraging the Google Gemini API and the browser's `localStorage` for persistent, versioned artifact storage. This project explores creating agents that can reflect on their own structure and modify themselves to better achieve goals, all within the constraints of a standard web browser.

The core idea treats every component (UI, logic, prompts, tools, **Web Components**) as versioned **artifacts** stored in `localStorage`. The agent ('x0', with dual LSD/XYZ personas) analyzes goals, reads artifacts, proposes changes, and saves outputs for the next cycle, creating a traceable history.

## Architectural Overview

REPLOID uses a modular structure orchestrated after bootstrapping:

1.  **Bootstrap (`index.html`, `errors.js`, `boot.js`):** Initial load, loads custom error definitions (`errors.js`). Checks for existing state, loads/initializes essential artifacts (with checksums) from `localStorage`, and handles the Genesis process if needed. **Registers core Web Components** (e.g., `reploid.core.webcomponent.*`) defined as artifacts. Finally, loads the core logic orchestrator.
2.  **Orchestrator (`app-logic.js`):** Dynamically loads modules (`StateManager`, `UI`, `ApiClient`, `CycleLogic`, `ToolRunner`, etc.) and manages dependencies, passing error handling primitives. It also calls for the registration of any core Web Components after `StateManager` is initialized.
3.  **`StateManager` (`state-manager.js`):** Manages the application state, including configuration, metrics, goals, **artifact metadata with versions (now including `WEB_COMPONENT_DEF` for Web Component definitions)**, autonomy state, history buffers, and a **list of currently registered Web Components**. Handles persistence, validation, and import/export functionalities.
4.  **`CycleLogic` (`agent-cycle.js`):** Orchestrates the main execution loop (9 refined steps). Prepares prompts (informing the LLM about registered Web Components), calls `ApiClient`, processes responses (including tool calls like `define_web_component`), triggers critiques/HITL/evaluation, manages autonomy, calls `ToolRunner`, and instructs `Storage` via `StateManager` to apply changes. **Includes logic for triggering Human-In-The-Loop (HITL) for Meta goals that modify core system components (including core Web Components), if configured (`hitlOnMetaChanges`).**
5.  **`UI` (`ui-manager.js`):** Renders the user interface, including the timeline, artifact display, configuration panel, controls, HITL/Sandbox UI, and preview pane. Handles user events. Standard HTML rendering will now utilize defined Web Components within `target.body.html` or `reploid.core.body.html`.
6.  **`ApiClient` (`api-client.js`):** Interacts with the Google Gemini API, managing streaming responses, function calling, retries, and abort mechanisms, with enhanced custom error propagation.
7.  **`ToolRunner` (`tool-runner.js`):** Executes static tools (internal logic, including the new `define_web_component` tool) and dynamic tools (sandboxed via Web Workers). Handles `convert_to_gemini_fc` for tool definition compatibility.
8.  **Modules & Data (`utils.js`, `storage.js`, `*.txt`, `*.json`, etc.):** Provide utilities, storage abstraction, system prompts (updated for Web Component awareness), and initial configuration/data. Custom error definitions are centralized in `errors.js`.

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

**Example 3: System Goal - Create a Reusable Info Card Web Component**

- **Goal (C0):** "Create a Web Component named 'info-card' that displays a title and content. It should have attributes 'card-title' and 'card-content'. Save its definition as 'target.webcomponent.info-card-def'. Then, use this component in 'target.body.html' to display 'Welcome' and 'This is a REPLOID demo.'."
- **Cycle 1:**
    - **Analysis & Proposal:** Agent decides to use the `define_web_component` tool. Proposes a JavaScript class string for the `<info-card>` element and modifications to `target.body.html` to use it.
    - **Tool Call:** Agent proposes a call to `define_web_component` with parameters: `tagName: 'info-card'`, the JavaScript class string, `targetArtifactId: 'target.webcomponent.info-card-def'`, and a description like "Displays a title and content."
    - **Artifact Creation:** The `define_web_component` tool executes, saving the provided JavaScript class string as an artifact named `target.webcomponent.info-card-def` with type `WEB_COMPONENT_DEF`.
    - **Registration:** The tool then calls `customElements.define('info-card', TheGeneratedClass)` to make the component available in the DOM. `StateManager` records 'info-card' as registered.
    - **HTML Update:** Agent generates new content for `target.body.html` artifact, which now includes `<info-card card-title="Welcome" card-content="This is a REPLOID demo."></info-card>`.
    - **UI Preview:** The UI Preview pane updates, rendering the new `target.body.html`, and the `<info-card>` component displays the title and content.
- **Cycle 2 (Meta Goal - Improve Core UI with a Web Component):** "Create a core Web Component 'reploid-status-bar' to display the current cycle number and active persona. Save its definition as 'reploid.core.webcomponent.status-bar-def'. Integrate this new component into 'reploid.core.body.html'."
    - **Cycle:** Agent proposes a `define_web_component` tool call for `reploid-status-bar` and modifications to `reploid.core.body.html`.
    - **HITL Trigger:** Since this is a Meta goal modifying a `reploid.core.*` artifact (both the new WC definition and `reploid.core.body.html`), and `hitlOnMetaChanges` is true by default, this cycle will likely trigger a Human-In-The-Loop pause for review and confirmation before the changes are applied and the page reloads (if `reploid.core.body.html` modification requires it).

**Example 4: System Goal + Dynamic Tool - Weather Display** (Original Example - still valid)
... (Content from original README's Example 3) ...

**Example 5: Meta Goal + RSI - Implementing Self-Correction Planning** (Original Example - still valid)
... (Content from original README's Example 4) ...

**Example 6: Meta Goal + Domain Tool - Transformer Config Generator** (Original Example - still valid)
... (Content from original README's Example 5) ...


## How It Works (Core Concepts & Usage)

- **Artifacts are Key:** Everything (code, UI structure, prompts, data, **Web Component definitions**) is a versioned artifact stored in `localStorage` (key includes cycle & optional version ID). Changes in cycle `N` are saved for cycle `N+1`.
- **Web Components as Artifacts:** JavaScript class definitions for Web Components are stored as `WEB_COMPONENT_DEF` artifacts. The `define_web_component` tool is used by the LLM to propose, define, and register new components. Core Web Components (e.g., for Reploid's own UI) can be defined as artifacts and are registered during the bootstrap process. This allows for modular and reusable UI elements.
- **Cycle Loop:** (1) Define Goal -> (2) Analyze/Deliberate (LSD/XYZ Persona) -> (3) Propose Changes/Tools/Web Components -> (4) LLM Call (+Tool Exec) -> (5) Critique Trigger Check -> (6) Critique/HITL -> (7) Apply (or Sandbox) -> (8) Evaluate -> (9) Next Action.
- **Goals:** Use UI radio buttons:
  - **System:** Modify external `target.*` artifacts (visible in Preview pane), including defining and using `target.webcomponent.*`.
  - **Meta:** Modify `reploid.*` artifacts (agent's own code/prompts/core WCs) or generate `full_html_source`. **Changes to core artifacts (including defining `reploid.core.webcomponent.*` or modifying `reploid.core.body.html`) default to requiring human confirmation via HITL.**
- **Self-Mod Sandbox:** For major Meta changes (`full_html_source`), a preview appears. Approval reloads the page into the new version (state preserved via `sessionStorage`).
- **Tools:** Static tools (e.g., lint, read, `define_web_component`) + Dynamically created tools (LLM generates schema + JS code, run in Web Worker).
- **HITL & Confirmation:** Pauses occur on triggers (low confidence, errors, random, forced, **or Meta changes to core components if `hitlOnMetaChanges` is true**). UI provides modes for feedback, options, or direct code editing.
- **State:** `StateManager` handles state (config, metrics, artifact metadata including Web Component definitions and registration status, history). Export/Import saves/loads metadata, not artifact content.
- **Usage Steps:**
  1.  Provide Gemini API Key (UI or `config.js`).
  2.  Open `index.html`. Start (Continue/Reset).
  3.  (Optional) Adjust Configuration panel.
  4.  Set Goal text + select Goal Type (System/Meta).
  5.  Run (Manual Cycle, N Cycles, or Continuous).
  6.  Monitor UI (Timeline, Cycle Details, Preview, Metrics).
  7.  Handle HITL/Sandbox prompts, especially for Meta changes.
  8.  Use controls (Go Back, Export/Import, Reset Context, Clear Storage - CAREFUL!).

## Key Features (v0.3.0+)

- **Web Components as First-Class Artifacts (`WEB_COMPONENT_DEF`)**: Enabling modular UI and logic encapsulation.
- **`define_web_component` Static Tool**: Allows the LLM to dynamically define and register new Web Components.
- **Core Web Component Registration**: `reploid.core.webcomponent.*` artifacts are automatically registered on boot.
- **Simplified HTML Artifacts**: `target.body.html` and `reploid.core.body.html` become more declarative through the use of Web Components.
- **Default Human Confirmation for Core Meta Changes**: Enhances safety for self-modification, configurable via `hitlOnMetaChanges`.
- **Updated System and Critique Prompts**: Guiding the LLM in effective Web Component definition and usage.
- LocalStorage Persistence & Artifact Versioning (Cycle + optional ID).
- Refined 9-Step Cycle-Based Iteration.
- Dual Persona (LSD/XYZ).
- System vs. Meta Goal Distinction.
- Sandbox Preview & **Self-Modification Workflow via Reload**.
- **Dynamic Tool Creation & Sandboxed Use** (Web Workers).
- Unified Tool Interface (Gemini Function Calling).
- Multi-Mode HITL (inc. Critique Feedback) **with clearer UI prompts**.
- State Management (Load/Save, Import/Export, Versioning, Validation, Session Restore, Stats, WC registration tracking).
- Basic Autonomous Operation Modes.
- Enhanced UI (Syntax Highlighting, Tool Summaries, Pan/Zoom Diagram, **improved cycle detail display**).
- Advanced API Client (Streaming, Retries, Abort, **improved error handling**).
- **Simplified Bootstrap Process (`boot.js`)**.
- **More Robust Error Handling with Custom Error Types (`errors.js`)**.
- Manual Context Summarization.
- Basic Self-Evaluation Capability & History Tracking.
- Storage Quota Awareness & Checksum Verification.

## Technical Stack / Limitations

- **Core:** Vanilla JS (ES6+), HTML5, CSS3, **Web Components**
- **LLM:** Google Gemini API (streaming)
- **Sandboxing:** Web Workers API (for dynamic tools)
- **Persistence:** `localStorage`, `sessionStorage`
- **Highlighting:** Prism.js (or highlight.js if Prism is not found)
- **Limitations:** Experimental, localStorage size (~5-10MB), self-mod risks (though mitigated by HITL for core changes). Tool sandboxing limits. Patch tools (`apply_diff_patch`, `apply_json_patch`) are still placeholders. Prompt sensitivity. No API cost tracking. Web Component class definition from string via `new Function()` has security implications if the source is not trusted (here, it's LLM-generated and ideally reviewed via HITL for core components).

## Next Steps / Future Work

1.  **Refine Web Component Lifecycle & Styling:**
    *   **Description:** Explore Shadow DOM for robust encapsulation of Web Component styles and structure. Investigate more advanced styling strategies (e.g., CSS Custom Properties, `::part`). Evaluate alternatives to `new Function()` for defining WC classes from strings for improved security and CSP compatibility, perhaps by dynamically creating `<script>` tags or leveraging dynamic imports if feasible in the constrained environment.
    *   **Category:** Architectural Refactor / Feature Request (Web Components)
    *   **Complexity:** 7/7
2.  **Web Component Based UI for Reploid Itself:**
    *   **Description:** Incrementally refactor Reploid's own UI (elements currently managed by `ui-manager.js` and defined in `reploid.core.body.html`) to use `reploid.core.webcomponent.*` artifacts. This would make Reploid's own interface more self-modifiable.
    *   **Category:** Architectural Refactor (RSI / UI)
    *   **Complexity:** 7/7
3.  **Implement Modular Artifact Improvement Tools:**
    *   **Description:** Fully implement the `apply_diff_patch` and `apply_json_patch` static tools using robust external libraries (e.g., `diff-match-patch`, `fast-json-patch`). Implement dynamic tools for more complex structural editing (e.g., AST manipulation for replacing specific functions within JS or Web Component artifacts).
    *   **Category:** Feature Request (RSI / Tooling)
    *   **Complexity:** 7/7
4.  **Advanced Context Management (Selective Injection / Graceful Continuation):**
    *   **Description:** Implement sophisticated context management, like selecting only relevant history ("arc") or handling tasks exceeding token limits across multiple calls.
    *   **Category:** Feature Request / Code Improvement
    *   **Complexity:** 7/7
5.  **Advanced Tooling for Web Components:**
    *   **Description:** Develop tools to help the LLM (and human operator) work with Web Components, such as a tool to list a registered Web Component's observed attributes, methods, or events. Potentially a simple visual inspector for component properties.
    *   **Category:** Feature Request (Tooling / Developer Experience)
    *   **Complexity:** 6/7
6.  **Add Basic Unit Tests:**
    *   **Description:** Introduce automated tests for key modules (Utilities, StateManager, pure functions in CycleLogic, static tool logic including `define_web_component`, Web Component registration) to prevent regressions and improve robustness.
    *   **Category:** Code Improvement / Process Improvement
    *   **Complexity:** 5/7
7.  **Refined Human-In-The-Loop (HITL) Experience:**
    *   **Description:** Provide more granular HITL triggers and options beyond simple confirmation. For example, allow users to directly edit LLM proposals (including Web Component JS strings) before application, suggest alternative prompts, or approve/reject individual artifact changes within a larger proposal. Implement the `propose_correction_plan` tool.
    *   **Category:** Feature Request (UI/UX)
    *   **Complexity:** 6/7
8.  **Browser-Cached Model Support (e.g., WebLLM / Transformers.js):**
    *   **Description:** Explore using models running locally in the browser via Web AI / ONNX / WebLLM etc., for tasks like simple critiques, code suggestions, or tool logic generation.
    *   **Category:** Feature Request / Research
    *   **Complexity:** 7/7
9.  **Implement Self-Improvement via Evals/Critiques:**
    *   **Description:** Use evaluation results/critiques to guide self-improvement of core agent components (prompts, logic, even core Web Component definitions via meta-goals).
    *   **Category:** Feature Request (RSI)
    *   **Complexity:** 6/7

## Easter Eggs

- **Boot Screen Shortcuts:** On the initial "Continue / Reset" screen:
  - Press `Enter` key to Continue (load existing state).
  - Press `Space` bar to Reset (clear state and start fresh).
- **Skip Boot Animation:** During the scrolling bootstrap log animation, pressing `Enter`, clicking, or tapping the screen will skip the animation and load faster.
- **Numbers:** [OEIS A001110](https://oeis.org/A001110) - Sums of two squares, in two ways. Perhaps reflects the dual nature?