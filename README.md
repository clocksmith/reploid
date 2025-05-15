# REPLOID (Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID)) x0.7.0 v0.7.0

**REPLOID/DREAMER** is an experimental, self-contained HTML/CSS/JS application demonstrating a conceptual framework for LLM-driven iterative design, development, dynamic tool creation, and recursive self-improvement (RSI). It operates entirely within the browser, leveraging the Google Gemini API and the browser's `localStorage` for persistent, versioned artifact storage. This project explores creating agents that can reflect on their own structure and modify themselves to better achieve goals, all within the constraints of a standard web browser.

The core idea treats every component (UI, logic, prompts, tools, Web Components, and even page structure definitions) as versioned **artifacts** stored in `localStorage`. The agent ('x0', with dual LSD/XYZ personas) analyzes goals, reads artifacts, proposes changes (including structured page compositions), and saves outputs for the next cycle, creating a traceable history.

## File Ecosystem & Artifacts

REPLOID's functionality is derived from a collection of files, each playing a specific role. Many of these become versioned "artifacts" in `localStorage`, forming the basis of the system's state and its capacity for self-modification.

**A. Initial Bootstrap & Execution Environment (Loaded by Browser Directly):**
These files are essential for the application to start. Their *content* is often captured and stored as "boot artifacts" for traceability *after* their initial execution.

*   `index.html`: The main HTML document serving as the application's entry point. It's not a `localStorage` artifact itself. Its entire structure is modifiable by the LLM via `page_composition` (preferred) or `full_html_source` (string) proposals, leading to a full page reload with the new structure.
*   `errors.js`: Defines global custom error classes (e.g., `ApiError`, `ToolError`). It executes early (due to `defer` and script order in `index.html`) to provide robust error handling during the bootstrap phase. Its *content* is captured and stored as the `reploid.boot.errors` artifact (Cycle 0) for traceability. Modifications to this artifact's content can affect the next full instantiation of Reploid if the `dogs` utility updates the physical `errors.js` file or if its new content is inlined via `page_composition`.
*   `boot.js`: Orchestrates the initial boot sequence, loading core dependencies and initializing the system. It executes after `errors.js` (due to `defer` and script order). Its *content* is captured and stored as the `reploid.boot.script` artifact (Cycle 0). Similar to `errors.js`, changes to this artifact's content take effect on subsequent full instantiations.

**B. Core Configuration (Fetched Early by Bootstrap):**

*   `config.json`: Provides crucial system configuration, including `localStorage` prefixes, API endpoints, default settings, and definitions for genesis artifacts. It is fetched by `boot.js` at startup. Its *content* is stored as the `reploid.core.config` artifact (Cycle 0). Changes to this artifact primarily affect the system upon the next full boot sequence.

**C. Genesis Artifacts (Content loaded into `localStorage` by `boot.js` at Cycle 0):**
These form the initial, versioned state of the application's core components and data. All are fully modifiable by the LLM as `localStorage` artifacts.

*   **Core Logic Modules (Type: `JS`):**
    *   `reploid.core.logic` (from `app-logic.js`)
    *   `reploid.core.utils` (from `utils.js`)
    *   `reploid.core.storage` (from `storage.js`)
    *   `reploid.core.statemanager` (from `state-manager.js`)
    *   `reploid.core.apiclient` (from `api-client.js`)
    *   `reploid.core.cyclelogic` (from `agent-cycle.js`)
    *   `reploid.core.toolrunner` (from `tool-runner.js`)
    *   `reploid.core.ui` (from `ui-manager.js`)
*   **Core UI Structure & Style (Type: `HTML`, `CSS`):**
    *   `reploid.core.body` (from `ui-body-template.html`): App root HTML structure, used if not overridden by `page_composition`.
    *   `reploid.core.style` (from `ui-style.css`): Main application styles, often referenced by `page_composition`.
*   **Core Web Component Definitions (Type: `WEB_COMPONENT_DEF`):**
    *   (e.g., `reploid.core.webcomponent.status-bar-def` if defined in genesis). These allow modular UI elements for Reploid's own interface, usable within `reploid.core.body` or a `page_composition`.
*   **LLM Prompts (Type: `PROMPT`):**
    *   `reploid.core.sys-prompt` (from `prompt-system.txt`)
    *   `reploid.core.critiquer-prompt` (from `prompt-critiquer.txt`)
    *   `reploid.core.summarizer-prompt` (from `prompt-summarizer.txt`)
    *   `reploid.core.evaluator-prompt` (from `prompt-evaluator.txt`)
*   **Tooling & Data Definitions (Type: `JSON`, `EVAL_DEF`):**
    *   `reploid.core.static-tools` (from `data-tools-static.json`)
    *   `reploid.core.default-eval` (from `data-eval-default.json`)
*   **Bootstrap Traceability Artifacts (Captured by `boot.js` - Type: `CSS`, `JS`, `LOG`):**
    *   `reploid.boot.style` (Initial CSS from `index.html`'s `<style id="boot-style">` tag)
    *   `reploid.boot.script` (Content of `boot.js`)
    *   `reploid.boot.errors` (Content of `errors.js`)
    *   `reploid.boot.log` (Bootstrap execution log)

**D. Dynamically Loaded by the Application (Not Genesis Artifacts):**

*   `tool-worker.js`: Script for Web Workers executing dynamic tools. Loaded by the browser via `new Worker()`. Not a `localStorage` artifact itself, but its content could be targeted for modification by the LLM, requiring the `dogs` utility to update the physical file for the change to take effect on subsequent worker instantiations.

**E. Informational / Non-System Files (Not Loaded or Used by Reploid):**

*   `data-cycle-steps.txt`: Human-readable description of the agent's cycle steps.
*   `sys_human.txt` (The PAWS/SWAP guide): Meta-context for LLM interaction, not an operational Reploid artifact.

## Architectural Overview

REPLOID uses a modular structure orchestrated after bootstrapping:

1.  **Bootstrap (`index.html`, `errors.js`, `boot.js`):** Handles the initial page load, defines global custom error types, checks for existing application state, loads or initializes essential artifacts (including core Web Components) from `localStorage` via a Genesis process if needed, and finally, loads the core logic orchestrator.
2.  **Orchestrator (`app-logic.js`):** Dynamically loads other core modules like `StateManager`, `UI`, `ApiClient`, `CycleLogic`, `ToolRunner`, manages their dependencies, and passes error handling primitives. It also triggers the registration of core Web Components with the `StateManager` after it's initialized.
3.  **`StateManager` (`state-manager.js`):** Manages the application's entire state, including configuration, metrics, goals, artifact metadata (with versions, including `WEB_COMPONENT_DEF` for Web Component definitions and `PAGE_COMPOSITION_DEF` for page structure definitions), autonomy state, history buffers, and a list of currently registered Web Components. It handles persistence to `localStorage`, validation, and import/export functionalities.
4.  **`CycleLogic` (`agent-cycle.js`):** Orchestrates the main execution loop (9 refined steps). It assembles prompts (informing the LLM about registered Web Components and available artifacts), calls `ApiClient` to interact with the LLM, processes responses (which may include tool calls like `define_web_component` or a `page_composition` object), triggers critiques or Human-In-The-Loop (HITL) interventions, manages autonomy settings, calls `ToolRunner` to execute tools, and instructs `Storage` (via `StateManager`) to apply changes. It includes logic for assembling a full HTML page from a `page_composition` object and triggering HITL for Meta goals that modify core system components or the overall page structure.
5.  **`UI` (`ui-manager.js`):** Renders the user interface, including the timeline, artifact display, configuration panel, controls, HITL/Sandbox UI, and preview pane. Handles user events. Standard HTML rendering will utilize defined Web Components within `target.body.html`, `reploid.core.body.html`, or as specified in a `page_composition`.
6.  **`ApiClient` (`api-client.js`):** Interacts with the Google Gemini API, managing streaming responses, function calling, retries, and abort mechanisms, with enhanced custom error propagation.
7.  **`ToolRunner` (`tool-runner.js`):** Executes static tools (internal logic, including `define_web_component`) and dynamic tools (sandboxed via Web Workers). Handles `convert_to_gemini_fc` for tool definition compatibility.
8.  **Modules & Data (`utils.js`, `storage.js`, various `*.txt`, `*.json` files):** Provide utilities, storage abstraction, system prompts (updated for Web Component and `page_composition` awareness), and initial configuration/data. Custom error definitions are centralized in `errors.js`.

## Use Case Examples

**Example 1: System Goal - Simple Web Calculator (Basic Iteration)**
- Goal (C0): "Create a basic HTML calculator page with two inputs, four operation buttons, and a result display." (Type: System)
- Cycle 1: Agent generates `target.body.html` (HTML), `target.style.calculator` (CSS), `target.script.calculator` (JS). UI Preview updates.
- Goal (C1): "Add division by zero error handling to the calculator script." (Type: System)
- Cycle 2: Agent modifies `target.script.calculator`.

**Example 2: Meta Goal + RSI - Implementing Code Complexity Analysis**
- Scenario: Agent observes overly complex generated Javascript.
- Goal (Cycle N): "Develop a dynamic tool 'analyze_code_complexity' [...] Then, modify `reploid.core.evaluator-prompt` to use this tool." (Type: Meta)
- Cycle N+1: Agent generates tool schema, implementation, and modified prompt.
- Cycle N+2: Agent/evaluation LLM can use `analyze_code_complexity`.

**Example 3: System Goal - Create a Reusable Info Card Web Component**
- Goal (C0): "Create a Web Component 'info-card' [...] Save its definition as 'target.webcomponent.info-card-def'. Then, use this component in 'target.body.html' [...]."
- Cycle 1: Agent uses `define_web_component` tool for `<info-card>`, saves definition, and updates `target.body.html`.

**Example 4: Meta Goal + Page Composition - Restructure Reploid's UI Layout**
- **Goal (C0):** "Restructure the main Reploid UI. Create new core Web Components `reploid-main-header` and `reploid-core-sections-container`. Define these appropriately. Then, generate a `page_composition` object that uses these new components along with existing artifacts like `reploid.core.style` and script references for `errors.js` and `boot.js` to define the new overall page structure." (Type: Meta)
- **Cycle 1:**
  - Agent defines `reploid-main-header` and `reploid-core-sections-container` using `define_web_component`.
  - LLM generates a `page_composition` JSON object referencing these new WCs, `reploid.core.style`, and script artifacts for `errors.js` and `boot.js` (content to be inlined).
  - HITL is triggered due to Meta change to page structure.
  - If approved, `CycleLogic` assembles the full HTML. UI presents this in the meta-sandbox. Final approval reloads the page into the new UI.

## How It Works (Core Concepts & Usage)

-   **Artifacts are Key:** Everything (code, UI structure definitions, prompts, data, Web Component definitions, page composition schemas) is a versioned artifact stored in `localStorage`.
-   **Web Components as Artifacts:** JS class definitions for Web Components are stored as `WEB_COMPONENT_DEF` artifacts. The `define_web_component` tool allows the LLM to define and register new components.
-   **Page Structure Modification:**
    *   **`page_composition` (Preferred for Meta Goals):** The LLM can propose a structured `page_composition` object (type `PAGE_COMPOSITION_DEF`). This object defines the entire HTML page (doctype, head, body, scripts) by referencing artifacts (e.g., for stylesheets, body content, Web Components to include, and even the *content* for core scripts like `errors.js` or `boot.js`). `CycleLogic` assembles this into a full HTML string. Script artifact contents referenced by `artifact_id` are typically inlined by `CycleLogic` for the immediate self-reload.
    *   **`full_html_source` (Legacy/Simpler Alternative):** The LLM can also provide a raw HTML string for the full page.
    *   Both methods trigger a sandbox preview. Approval reloads the page into the new version, with state preserved via `sessionStorage`.
-   **Cycle Loop (9 Refined Steps):** (1) Define Goal -> (2) Analyze/Deliberate -> (3) Propose Changes (Artifacts, Tools, Web Components, Page Structure) -> (4) LLM Call (+Tool Exec) -> (5) Check Triggers for Critique/Intervention -> (6) Perform Critique (Auto) or Get Human Feedback -> (7) Apply Approved Changes or Stage Sandbox (Meta) -> (8) Self-Evaluate Cycle Outcome -> (9) Determine Next Action.
-   **Goals:** Use UI radio buttons:
    *   **System:** Modify external `target.*` artifacts (visible in Preview pane), including defining and using `target.webcomponent.*`.
    *   **Meta:** Modify `reploid.*` artifacts (agent's own code/prompts/core WCs) or generate `page_composition` / `full_html_source`. Changes to core artifacts or page structure default to requiring human confirmation via HITL.
-   **Self-Mod Sandbox:** For major Meta changes (`page_composition`, `full_html_source`), a preview appears. Approval reloads the page into the new version.
-   **Tools:** Static tools (e.g., `define_web_component`) + Dynamically created tools (LLM generates schema + JS code, run in Web Worker).
-   **HITL & Confirmation:** Pauses occur on triggers (low confidence, errors, random, forced, or Meta changes to core components/page structure if `hitlOnMetaChanges` is true).
-   **RSI on Bootstrap Components:** The *content* of initial bootstrap files (`errors.js`, `boot.js`) is stored as `reploid.boot.*` artifacts. The LLM can analyze these and propose modified versions. These new versions can be incorporated into the system via a `page_composition` (by inlining the new script artifact content) or by having the `dogs` utility update the physical files for the next full application load.

## Key Features (v0.7.0)

-   **Structured Page Composition (`page_composition`):** Enables advanced, artifact-driven full-page self-modification.
-   Web Components as First-Class Artifacts (`WEB_COMPONENT_DEF`).
-   `define_web_component` Static Tool for dynamic Web Component creation.
-   Core Web Component Registration during bootstrap.
-   Simplified HTML Artifacts through the use of Web Components and declarative page structures.
-   Default Human Confirmation for Core Meta Changes and Page Structure modifications.
-   Updated System and Critique Prompts for Web Component and Page Composition awareness.
-   Robust LocalStorage Persistence & Artifact Versioning (Cycle + optional ID).
-   Refined 9-Step Cycle-Based Iteration with dual LSD/XYZ personas.
-   Clear distinction between System vs. Meta Goals.
-   Sandbox Preview & Self-Modification Workflow via page reload.
-   Dynamic Tool Creation & Sandboxed Use via Web Workers.
-   Unified Tool Interface leveraging Gemini Function Calling.
-   Multi-Mode Human-In-The-Loop (HITL) with clearer UI prompts and critique feedback.
-   Comprehensive State Management (Load/Save, Import/Export, Versioning, Validation, Session Restore, Stats, Web Component registration tracking).
-   Basic Autonomous Operation Modes.
-   Enhanced UI (Syntax Highlighting, Tool Summaries, improved cycle detail display).
-   Advanced API Client (Streaming, Retries, Abort, improved error handling).
-   Simplified Bootstrap Process (`boot.js`) with clearer dependency loading.
-   More Robust Error Handling with Custom Error Types (`errors.js`).
-   Manual Context Summarization capability.
-   Basic Self-Evaluation Capability & History Tracking.
-   Storage Quota Awareness & Checksum Verification for artifacts.

## Technical Stack / Limitations

-   **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3, Web Components
-   **LLM:** Google Gemini API (streaming models like `gemini-1.5-pro-latest` or `gemini-1.5-flash-latest`)
-   **Sandboxing:** Web Workers API (for dynamic tools)
-   **Persistence:** `localStorage` (Application State Version: `0.7.0`), `sessionStorage` (for state preservation during self-modification reloads)
-   **Highlighting:** Prism.js (or highlight.js as fallback)
-   **Limitations:**
    *   Highly experimental nature.
    *   `localStorage` size limit (~5-10MB) can be restrictive for extensive history or very large artifacts.
    *   Self-modification, especially of core components or via `page_composition`, carries inherent risks, though mitigated by HITL and sandboxing.
    *   Tool sandboxing via Web Workers has limitations (e.g., no direct DOM access).
    *   Patch tools (`apply_diff_patch`, `apply_json_patch`) are still placeholders and not fully implemented.
    *   Sensitivity to LLM prompt phrasing and output format.
    *   No direct API cost tracking integrated.
    *   Web Component class definition from LLM-generated strings via `new Function()` (used by `define_web_component` tool and core WC registration) has security implications if the source is not trusted; HITL for core components is a mitigation.
    *   Inlining script artifact content via `page_composition` can make the generated HTML source larger; this is a trade-off for immediate self-contained reloads with modified core script logic.

## Next Steps / Future Work

1.  **Refine Web Component Lifecycle & Styling:** Explore Shadow DOM for robust encapsulation. Investigate advanced styling (CSS Custom Properties, `::part`). Evaluate alternatives to `new Function()` for WC class definition for improved security/CSP.
2.  **Web Component Based UI for Reploid Itself:** Incrementally refactor Reploid's own UI (elements currently in `ui-body-template.html` and managed by `ui-manager.js`) to use `reploid.core.webcomponent.*` artifacts, leveraged through `page_composition`.
3.  **Implement Modular Artifact Improvement Tools:** Fully implement `apply_diff_patch` and `apply_json_patch` with robust libraries. Develop dynamic tools for complex structural editing (e.g., AST manipulation).
4.  **Advanced Context Management:** Implement selective history injection ("arc") or handling tasks exceeding token limits across multiple calls.
5.  **Advanced Tooling for Web Components & Page Composition:** Develop tools to list WC attributes/methods, or a simple visual inspector. Create tools to validate `page_composition` schemas or to help the LLM construct them.
6.  **Add Basic Unit Tests:** Introduce automated tests for key modules (Utilities, StateManager, CycleLogic pure functions, static tools, Web Component registration, `page_composition` assembly).
7.  **Refined Human-In-The-Loop (HITL) Experience:** More granular triggers and options (e.g., direct editing of LLM proposals, including `page_composition` objects, before application). Implement `propose_correction_plan` tool.
8.  **Browser-Cached Model Support (e.g., WebLLM / Transformers.js):** Explore local models for tasks like critiques or code suggestions.
9.  **Implement Self-Improvement via Evals/Critiques:** Use evaluation results to guide self-improvement of core agent components (prompts, logic, core WCs, `page_composition` strategies).
10. **Refine Script Handling in `page_composition`:** Investigate alternatives to full inlining for core script updates, possibly involving closer coordination with the `dogs` utility for file materialization or dynamic script loading from `Blob` URLs if feasible and secure for bootstrap scripts.

## Easter Eggs

-   **Boot Screen Shortcuts:** On the initial "Continue / Reset" screen:
    -   Press `Enter` key to Continue (load existing state).
    -   Press `Space` bar to Reset (clear state and start fresh).
-   **Skip Boot Animation:** During the scrolling bootstrap log animation, pressing `Enter`, clicking, or tapping the screen will skip the animation and load faster.
-   **Numbers:** [OEIS A001110](https://oeis.org/A001110) - Sums of two squares, in two ways. Perhaps reflects the dual nature?