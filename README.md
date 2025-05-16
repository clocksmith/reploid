# REPLOID (Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID)) x0.7.0 v0.7.0

**REPLOID/DREAMER** is an experimental, self-contained HTML/CSS/JS application demonstrating a conceptual framework for LLM-driven iterative design, development, dynamic tool creation, and recursive self-improvement (RSI). It operates entirely within the browser, leveraging the Google Gemini API and the browser's `localStorage` for persistent, versioned artifact storage. This project explores creating agents that can reflect on their own structure and modify themselves to better achieve goals, all within the constraints of a standard web browser.

The core idea treats every component (UI, logic, prompts, tools, Web Components, and even page structure definitions) as versioned **artifacts** stored in `localStorage`. The agent ('x0', with dual LSD/XYZ personas) analyzes goals, reads artifacts, proposes changes (including structured page compositions), and saves outputs for the next cycle, creating a traceable history.

## File Ecosystem & Artifacts

REPLOID's functionality is derived from a collection of files, each playing a specific role. Many of these become versioned "artifacts" in `localStorage`, forming the basis of the system's state and its capacity for self-modification.

**A. Initial Bootstrap & Execution Environment (Loaded by Browser Directly):**
These files are essential for the application to start. Their *content* is often captured and stored as "boot artifacts" for traceability *after* their initial execution.

*   `index.html`: The main HTML document serving as the application's entry point. It is not a `localStorage` artifact itself. Its entire structure is modifiable by the LLM via `page_composition` (preferred) or `full_html_source` (string) proposals, leading to a full page reload with the new structure.
*   `boot.js`: Orchestrates the initial boot sequence, loading core dependencies (like `config.json` and `utils.js` which now contains custom error definitions) and initializing the system. It executes early (due to `defer` and script order in `index.html`). Its *content* is captured and stored as the `reploid.boot.script` artifact (Cycle 0). Modifications to this artifact's content take effect on subsequent full instantiations of Reploid (e.g., if the `dogs` utility updates the physical `boot.js` file or if its new content is inlined via `page_composition`).

**B. Core Configuration (Fetched Early by Bootstrap):**

*   `config.json`: Provides crucial system configuration, including `localStorage` prefixes, API endpoints, default settings, and definitions for genesis artifacts. It is fetched by `boot.js` at startup. Its *content* is stored as the `reploid.core.config` artifact (Cycle 0). Changes to this artifact primarily affect the system upon the next full boot sequence.

**C. Genesis Artifacts (Content loaded into `localStorage` by `boot.js` at Cycle 0):**
These form the initial, versioned state of the application's core components and data. All are fully modifiable by the LLM as `localStorage` artifacts.

*   **Core Logic Modules (Type: `JS`):**
    *   `reploid.core.utils` (from `utils.js`): Core utility functions, now **also includes custom Error definitions**.
    *   `reploid.core.logic` (from `app-logic.js`): Main application logic orchestrator.
    *   `reploid.core.storage` (from `storage.js`): `localStorage` abstraction.
    *   `reploid.core.statemanager` (from `state-manager.js`): State management.
    *   `reploid.core.apiclient` (from `api-client.js`): Gemini API interaction.
    *   `reploid.core.cyclelogic` (from `agent-cycle.js`): Main execution cycle logic.
    *   `reploid.core.toolrunner` (from `tool-runner.js`): Tool execution engine.
    *   `reploid.core.ui` (from `ui-manager.js`): UI rendering and event handling.
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
    *   `reploid.boot.log` (Bootstrap execution log)
    *   *(Note: `reploid.boot.errors` is removed as error definitions are now part of `reploid.core.utils`)*

**D. Dynamically Loaded by the Application (Not Genesis Artifacts):**

*   `tool-worker.js`: Script for Web Workers executing dynamic tools. Loaded by the browser via `new Worker()`. Not a `localStorage` artifact itself, but its content could be targeted for modification by the LLM, requiring the `dogs` utility to update the physical file for the change to take effect on subsequent worker instantiations.

**E. Informational / Non-System Files (Not Loaded or Used by Reploid):**

*   `errors.js`: This file is **no longer used**. Custom error definitions are now part of `utils.js`.
*   `data-cycle-steps.txt`: Human-readable description of the agent's cycle steps.
*   `sys_human.txt` (The PAWS/SWAP guide): Meta-context for LLM interaction, not an operational Reploid artifact.

## Architectural Overview

REPLOID uses a modular structure orchestrated after bootstrapping:

1.  **Bootstrap (`index.html`, `boot.js`):** Handles the initial page load, loads `config.json`, then loads `utils.js` (which defines custom error types and provides logging). It then proceeds to check application state, load or initialize essential artifacts (including core Web Components) from `localStorage` via a Genesis process if needed, and finally, loads the core logic orchestrator (`app-logic.js`).
2.  **Orchestrator (`app-logic.js`):** Dynamically loads other core modules like `StateManager`, `UI`, `ApiClient`, `CycleLogic`, `ToolRunner`, manages their dependencies, and passes necessary primitives (like the `Errors` object obtained from `Utils`). It also triggers the registration of core Web Components with the `StateManager` after it's initialized.
3.  **`StateManager` (`state-manager.js`):** Manages the application's entire state, including configuration, metrics, goals, artifact metadata (with versions, including `WEB_COMPONENT_DEF` for Web Component definitions and `PAGE_COMPOSITION_DEF` for page structure definitions), autonomy state, history buffers, and a list of currently registered Web Components. It handles persistence to `localStorage`, validation, and import/export functionalities.
4.  **`CycleLogic` (`agent-cycle.js`):** Orchestrates the main execution loop (9 refined steps). It assembles prompts, calls `ApiClient` to interact with the LLM, processes responses (which may include tool calls like `define_web_component` or a `page_composition` object), triggers critiques or Human-In-The-Loop (HITL) interventions, manages autonomy settings, calls `ToolRunner` to execute tools, and instructs `Storage` (via `StateManager`) to apply changes. It includes logic for assembling a full HTML page from a `page_composition` object and triggering HITL for Meta goals that modify core system components or the overall page structure.
5.  **`UI` (`ui-manager.js`):** Renders the user interface. Handles user events. HTML rendering utilizes defined Web Components within `target.body.html`, `reploid.core.body.html`, or as specified in a `page_composition`.
6.  **`ApiClient` (`api-client.js`):** Interacts with the Google Gemini API.
7.  **`ToolRunner` (`tool-runner.js`):** Executes static tools and dynamic tools.
8.  **Modules & Data (`utils.js` (now includes Errors), `storage.js`, various `*.txt`, `*.json` files):** Provide utilities, storage, prompts, initial data.

## Use Case Examples
*(Content for Example 1, 2, 3 remains the same as previously generated)*

**Example 4: Meta Goal + Page Composition - Restructure Reploid's UI Layout**
- **Goal (C0):** "Restructure the main Reploid UI. Create new core Web Components `reploid-main-header` and `reploid-core-sections-container`. Define these appropriately. Then, generate a `page_composition` object that uses these new components along with existing artifacts like `reploid.core.style` and script references for `utils.js` (for errors) and `boot.js` content artifacts to define the new overall page structure." (Type: Meta)
- **Cycle 1:**
  - Agent defines `reploid-main-header` and `reploid-core-sections-container` using `define_web_component`.
  - LLM generates a `page_composition` JSON object. This object would reference `reploid.core.style`, include the new WCs, and reference *artifacts containing the content* of `utils.js` and `boot.js` in `script_references` (to be inlined by `CycleLogic`).
  - HITL is triggered.
  - If approved, `CycleLogic` assembles the full HTML. UI presents this in the meta-sandbox. Final approval reloads the page into the new UI.

## How It Works (Core Concepts & Usage)

-   **Artifacts are Key:** Everything (code, UI structure definitions, prompts, data, Web Component definitions, page composition schemas) is a versioned artifact stored in `localStorage`.
-   **Web Components as Artifacts:** JS class definitions for Web Components are stored as `WEB_COMPONENT_DEF` artifacts.
-   **Page Structure Modification:**
    *   **`page_composition` (Preferred for Meta Goals):** The LLM can propose a structured `page_composition` object (artifact type `PAGE_COMPOSITION_DEF`). This object defines the entire HTML page by referencing artifacts. `CycleLogic` assembles this into a full HTML string. Script artifacts (e.g., content of `utils.js` or `boot.js` stored as `reploid.core.utils` or `reploid.boot.script`) referenced by `artifact_id` are inlined by `CycleLogic` for the immediate self-reload.
    *   **`full_html_source` (Legacy):** Raw HTML string for the full page.
    *   Both trigger a sandbox preview. Approval reloads the page into the new version.
-   **Cycle Loop (9 Refined Steps):** As previously detailed.
-   **Goals:** System vs. Meta. Core Meta changes default to HITL.
-   **Tools:** Static and Dynamic tools.
-   **HITL & Confirmation:** As previously detailed.
-   **RSI on Bootstrap Components:** The *content* of initial bootstrap files (`boot.js`) and core utilities/errors (`utils.js`) is stored as `reploid.boot.script` and `reploid.core.utils` artifacts respectively. The LLM can analyze these and propose modified versions. These new versions can be incorporated into the system via a `page_composition` (by inlining the new script artifact content) or by having the `dogs` utility update the physical files for the next full application load.

## Key Features (v0.7.0)

-   **Structured Page Composition (`page_composition`):** Enables advanced, artifact-driven full-page self-modification.
-   **Error Handling Integrated into `utils.js`:** Streamlined bootstrap by removing global `errors.js` dependency.
-   Web Components as First-Class Artifacts (`WEB_COMPONENT_DEF`).
-   `define_web_component` Static Tool.
-   Core Web Component Registration.
-   Simplified HTML Artifacts via Web Components and `page_composition`.
-   Default Human Confirmation for Core Meta Changes & Page Structure.
-   Updated System and Critique Prompts.
-   LocalStorage Persistence & Artifact Versioning (State Version: `0.7.0`).
-   Refined 9-Step Cycle-Based Iteration.
-   Dynamic Tool Creation & Sandboxed Use.
-   Enhanced UI, API Client, and Robust Error Handling.

## Technical Stack / Limitations

-   **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3, Web Components
-   **LLM:** Google Gemini API (e.g., `gemini-1.5-pro-latest`)
-   **Persistence:** `localStorage` (Application State Version: `0.7.0`), `sessionStorage`.
-   **Limitations:** Experimental. `localStorage` size. Self-mod risks (mitigated by HITL). `page_composition` script inlining makes generated HTML larger. Patch tools (`apply_diff_patch`, `apply_json_patch`) are placeholders.

## Next Steps / Future Work
*(Content largely similar to the previous README's "Next Steps", but remove item about `errors.js` and potentially update based on the `page_composition` implementation)*
1.  **Refine Web Component Lifecycle & Styling.**
2.  **Web Component Based UI for Reploid Itself (via `page_composition`).**
3.  **Implement Modular Artifact Improvement Tools.**
4.  **Advanced Context Management.**
5.  **Advanced Tooling for Web Components & Page Composition.**
6.  **Add Basic Unit Tests.**
7.  **Refined Human-In-The-Loop (HITL) Experience.**
8.  **Browser-Cached Model Support.**
9.  **Implement Self-Improvement via Evals/Critiques.**
10. **Refine Script Handling in `page_composition`:** Explore alternatives to full inlining for core script updates.

## Easter Eggs
-   **Boot Screen Shortcuts:** `Enter` to Continue, `Space` to Reset.
-   **Skip Boot Animation:** `Enter`, click, or tap.
-   **Numbers:** [OEIS A001110](https://oeis.org/A001110).