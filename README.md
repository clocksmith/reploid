# REPLOID (Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID))

**REPLOID/DREAMER** is an experimental application framework designed to explore LLM-driven iterative design, dynamic tool creation, and recursive self-improvement (RSI) by uniquely leveraging the **web browser as a comprehensive development and execution ecosystem**. The long-term vision is to cultivate self-contained agentic systems capable of sophisticated RSI, with the ultimate aim of investigating pathways towards Artificial General Intelligence (AGI) within this browser-native environment.

Unlike traditional agents that may operate from a command line with indirect access to their target environments, REPLOID is architected to live and evolve directly within the browser. This approach aims to minimize the "impedance mismatch" an agent faces when creating or interacting with web technologies. By operating natively, REPLOID can potentially harness the browser's rich, multi-layered engine—from its powerful JavaScript engines (V8, SpiderMonkey, etc.) and rendering pipelines (Skia, WebRender) to its access to WebGL/WebGPU, WebAssembly, and a vast suite of standardized Web APIs. This allows for more direct "perception" of visual and interactive outputs and more "native" action within the environment it seeks to understand and modify. Initially leveraging the Google Gemini API, REPLOID uses `localStorage` for persistent, versioned artifact storage. Future iterations plan for enhanced autonomy through local model support and controlled network access (e.g., via a local proxy server), enabling the core browser environment to function as an increasingly isolated yet capable "computer" for the agent.

The core idea treats every component (UI, logic, prompts, tools, Web Components, page structure definitions, and even helper modules for pure logic or I/O) as versioned **artifacts** stored in `localStorage`. Each artifact includes metadata describing its type and `execution_paradigm` (e.g., `pure`, `semi-pure`, `boundary_io`, `data`). The agent ('x0', with dual LSD/XYZ personas) analyzes goals, reads artifacts, proposes changes (including structured page compositions and modifications to its own reasoning or utility code), and saves outputs for the next cycle, creating a traceable and increasingly self-aware history within its browser-based world.

## File Ecosystem & Artifacts

REPLOID's functionality is derived from a collection of files, each playing a specific role and often categorized by its `execution_paradigm` (see Architectural Overview). Many of these become versioned "artifacts" in `localStorage`, forming the basis of the system's state and its capacity for self-modification. Artifact metadata includes this paradigm classification, enabling the agent to reason about the nature of its components.

**A. Initial Bootstrap & Execution Environment (Loaded by Browser Directly):**
These files are essential for the application to start. Their _content_ is captured and stored as "boot artifacts" for traceability.

- `index.html`: The main HTML document. Its structure is modifiable by the LLM via `page_composition` proposals. (Paradigm: `ui_template` for its structure).
- `boot.js`: Orchestrates the initial boot sequence, loading core dependencies (`config.json`, `utils.js`, pure helper modules like `agent-logic-pure.js`) and initializing the system. Its _content_ is captured as the `reploid.boot.script` artifact. (Paradigm: `boundary_orchestration`).

**B. Core Configuration (Fetched Early by Bootstrap):**

- `config.json`: Provides system configuration, `localStorage` prefixes, API endpoints, default settings, and genesis artifact definitions (including their intended paradigms). Stored as `reploid.core.config`. (Paradigm: `data`).

**C. Genesis Artifacts (Content loaded into `localStorage` by `boot.js` at Cycle 0):**
These form the initial, versioned state of the application's core components and data.

- **Core Logic & Utility Modules (Type: `JS`):**
  - `reploid.core.utils` (from `utils.js`): Core pure utility functions and custom Error definitions. (Paradigm: `pure`).
  - `reploid.core.logic` (from `app-logic.js`): Main application logic orchestrator. (Paradigm: `boundary_orchestration`).
  - `reploid.core.storage` (from `storage.js`): `localStorage` abstraction. (Paradigm: `boundary_io`).
  - `reploid.core.statemanager` (from `state-manager.js`): State management, utilizing pure helpers. (Paradigm: `boundary_orchestration`).
  - `reploid.core.apiclient` (from `api-client.js`): Gemini API interaction. (Paradigm: `boundary_io`).
  - `reploid.core.cyclelogic` (from `agent-cycle.js`): Main execution cycle orchestrator, delegating to pure logic helpers. (Paradigm: `boundary_orchestration`).
  - `reploid.core.toolrunner` (from `tool-runner.js`): Tool execution engine, utilizing pure helpers. (Paradigm: `boundary_orchestration`).
  - `reploid.core.ui` (from `ui-manager.js`): UI rendering and event handling, using pure formatters. (Paradigm: `boundary_io`).
  - `reploid.core.agent-logic-pure` (from `agent-logic-pure.js`): Pure/semi-pure functions for `agent-cycle.js` logic. (Paradigm: `pure` / `semi-pure`).
  - `reploid.core.state-helpers-pure` (from `state-helpers-pure.js`): Pure/semi-pure functions for `state-manager.js` logic. (Paradigm: `pure` / `semi-pure`).
  - `reploid.core.tool-runner-pure-helpers` (from `tool-runner-pure-helpers.js`): Pure/semi-pure functions for `tool-runner.js`. (Paradigm: `pure` / `semi-pure`).
- **Core UI Structure & Style:**
  - `reploid.core.body` (from `ui-body-template.html`, Type: `HTML`, Paradigm: `ui_template`).
  - `reploid.core.style` (from `ui-style.css`, Type: `CSS`, Paradigm: `data`).
- **Core Web Component Definitions (Type: `WEB_COMPONENT_DEF`):** Definition artifact is `data`, underlying JS class paradigm varies (e.g., `semi-pure` for logic, `boundary_io` for DOM interaction).
  - (e.g., `reploid.core.webcomponent.status-bar-def`).
- **LLM Prompts (Type: `PROMPT`; Paradigm: `data`):**
  - `reploid.core.sys-prompt` (from `prompt-system.txt`)
  - `reploid.core.critiquer-prompt` (from `prompt-critiquer.txt`)
  - `reploid.core.summarizer-prompt` (from `prompt-summarizer.txt`)
  - `reploid.core.evaluator-prompt` (from `prompt-evaluator.txt`)
- **Tooling & Data Definitions (Type: `JSON`, `EVAL_DEF`; Paradigm: `data`):**
  - `reploid.core.static-tools` (from `data-tools-static.json`)
  - `reploid.core.default-eval` (from `data-eval-default.json`)
- **Bootstrap Traceability Artifacts (Captured by `boot.js`):**
  - `reploid.boot.style` (Type: `CSS`, Paradigm: `data`)
  - `reploid.boot.script` (Type: `JS`, Paradigm: `boundary_orchestration`)
  - `reploid.boot.log` (Type: `LOG`, Paradigm: `data`)

**D. Dynamically Loaded by the Application (Not Genesis Artifacts):**

- `tool-worker.js`: Script for Web Workers. Its shell is `boundary_io`; runs arbitrary tool code.

**E. Informational / Non-System Files (Not Loaded or Used by Reploid):**

- `data-cycle-steps.txt`: Human-readable description of the agent's cycle.
- `sys_human.txt` (The PAWS/SWAP guide): Meta-context for LLM interaction.

## Architectural Overview: Functional Core, Imperative Shell

REPLOID employs a modular structure emphasizing a "functional core, imperative shell" approach. This design aims to isolate pure and semi-pure logic (responsible for data transformation and decision-making without direct side effects) from the imperative "shell" modules that handle all I/O (DOM, `localStorage`, API calls) and orchestrate major state changes. Artifact metadata now includes an `execution_paradigm` field (e.g., `pure`, `semi-pure`, `boundary_io`, `data`) to reflect this.

1.  **Bootstrap (`index.html`, `boot.js`):** Initializes the environment, loads `config.json`, `utils.js` (pure utilities and Error definitions), and pure helper modules (e.g., `agent-logic-pure.js`). It then loads the main orchestrator, `app-logic.js`.
2.  **Orchestrator (`app-logic.js`):** Dynamically loads core boundary modules (`StateManager`, `UI`, `ApiClient`, `CycleLogic`, `ToolRunner`), injecting dependencies including references to pure helper modules where appropriate. Triggers Web Component registration.
3.  **`StateManager` (`state-manager.js`):** Manages all application state. Core state transformation, validation, and derivation logic are increasingly handled by pure functions within `state-helpers-pure.js`, which `StateManager` calls.
4.  **`CycleLogic` (`agent-cycle.js`):** Orchestrates the main execution loop. Complex decision-making (e.g., prompt assembly, response processing, critique logic) is delegated to pure or semi-pure functions residing in `agent-logic-pure.js`. `CycleLogic` then calls boundary modules (`ApiClient`, `ToolRunner`, `StateManager` for writes, `UI`) to enact decisions and side effects.
5.  **`UI` (`ui-manager.js`):** A boundary module responsible for all DOM rendering and user event handling. It may use pure helper functions (potentially from `ui-formatters-pure.js`) to format data for display before performing impure DOM manipulations.
6.  **`ApiClient` (`api-client.js`):** A boundary module for all interactions with the Google Gemini API. Response sanitization logic is pure (likely via `utils.js`).
7.  **`ToolRunner` (`tool-runner.js`):** A boundary_orchestration module that executes tools. Conversion of tool definitions and some static tool logic leverage pure functions from `tool-runner-pure-helpers.js`. Dynamic tool execution via Web Workers is an I/O boundary.
8.  **Pure Helper Modules (`agent-logic-pure.js`, `state-helpers-pure.js`, `tool-runner-pure-helpers.js`):** These house pure or semi-pure functions, providing testable, predictable logic for data transformation, decision-making, and complex calculations, serving the core orchestrating modules.
9.  **Foundational Modules & Data (`utils.js`, `storage.js`, prompts, JSON data):** `utils.js` provides globally accessible pure utilities. `storage.js` is a strict `boundary_io` module for `localStorage`. Prompts and JSON files are `data` artifacts.

## How It Works (Core Concepts & Usage)

- **Artifacts & Paradigms:** All components are versioned `localStorage` artifacts. Their metadata now includes an `execution_paradigm` (e.g., `pure`, `semi-pure`, `boundary_io`, `boundary_orchestration`, `data`) to inform the agent and system about their inherent nature and guide modification strategies.
- **Functional Core, Imperative Shell:** The architecture strives to isolate testable, pure/semi-pure logic for computation and decision-making (the "core") from modules that interact with the external environment or manage state mutations (the "shell").
- **Web Components as Artifacts:** JS class definitions for Web Components are stored as `WEB_COMPONENT_DEF` artifacts (artifact `data`, code paradigm varies).
- **Page Structure Modification:**
  - **`page_composition` (Preferred):** The LLM proposes a structured `PAGE_COMPOSITION_DEF` artifact. `CycleLogic` assembles this into full HTML, inlining script artifact content.
  - **`full_html_source` (Legacy):** Raw HTML string.
  - Both trigger a sandbox preview and page reload on approval.
- **Cycle Loop (9 Refined Steps):** The agent iteratively defines goals, analyzes state (including artifact paradigms), proposes changes, executes tools, undergoes critique/HITL, applies changes, and evaluates.
- **Goals, Tools, HITL & Confirmation:** These mechanisms remain central, but are now informed by the paradigm of artifacts involved. Core Meta changes or modifications to `boundary_io`/`boundary_orchestration` artifacts default to HITL.
- **RSI on All Components:** The agent can propose modifications to any artifact, including its own pure logic helpers, boundary module orchestration, or bootstrap scripts. The system (and critiquer) can use paradigm information to assess risk.

## Key Features

- **Hybrid Architecture:** "Functional core, imperative shell" for improved testability, predictability, and safer RSI.
- **Artifact Execution Paradigms:** Metadata classifying artifacts (pure, boundary_io, etc.) to guide agent behavior and system operations.
- **Isolated Pure Logic Modules:** Dedicated files (e.g., `agent-logic-pure.js`) for testable helper functions.
- **Structured Page Composition (`page_composition`):** Advanced, artifact-driven full-page self-modification.
- Error Handling Integrated into `utils.js`.
- Web Components as First-Class Artifacts.
- `define_web_component` Static Tool.
- LocalStorage Persistence & Artifact Versioning (State Version: `0.7.0`).
- Refined 9-Step Cycle-Based Iteration.

## Technical Stack / Limitations

- **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3, Web Components
- **LLM:** Google Gemini API (e.g., `gemini-1.5-pro-latest`)
- **Persistence:** `localStorage` (Application State Version: `0.7.0`), `sessionStorage`.
- **Limitations:** Experimental. `localStorage` size. Self-modification risks (mitigated by HITL and paradigm awareness). `page_composition` script inlining makes generated HTML larger. Patch tools (`apply_diff_patch`, `apply_json_patch`) are placeholders. The transition to clearly separated pure/boundary patterns is an ongoing refinement.

## Next Steps / Future Work

The architectural refinements towards a "functional core, imperative shell" and the introduction of artifact paradigms open new avenues and refine existing goals:

1.  **Deepen Pure Function Integration & Testing:** Continue refactoring core modules (`CycleLogic`, `StateManager`, `ToolRunner`) to further isolate pure decision-making and data transformation logic into their respective `*-pure.js` helper modules or as pure internal functions. Implement a unit testing strategy, starting with `utils.js` and all `*-pure.js` modules.
2.  **Paradigm-Driven RSI & Agent Reasoning:**
    - Enhance LLM prompts (system, critique, self-eval) to explicitly leverage artifact `execution_paradigm` metadata for safer, more targeted, and more architecturally-aware self-modification proposals.
    - Develop agent strategies where it uses paradigm information to select appropriate modification techniques or to assess the risk and impact of proposed changes.
3.  **Advanced Context Management:** Improve how context is selected and summarized for the LLM, potentially using paradigm information to prioritize or condense artifacts differently (e.g., summarizing boundary module interfaces vs. inlining pure logic).
4.  **Refine State Management & Immutability:** Further enforce immutable-like state updates within `StateManager` (leveraging `state-helpers-pure.js`) to improve predictability and simplify reasoning about state changes.
5.  **Tooling for Paradigm Analysis & Enforcement:** Explore agent capabilities or static tools to assist in classifying the paradigm of existing or newly LLM-generated code artifacts and to help maintain architectural consistency.
6.  **Offline Capabilities & Controlled Networking for AGI Development:**
    - Implement mechanisms for using locally-hosted or browser-cached LLMs (e.g., via WebLLM, ONNX.js, or WASM-based engines).
    - Design and prototype a local proxy server (e.g., a simple Node.js server) as an optional, sole internet gateway for REPLOID, allowing the core browser application to operate in a more controlled, "offline-first" manner. This enhances security, determinism, and allows for fine-grained control over the agent's external interactions, crucial for safe AGI exploration.
7.  **Web Component-Based UI for Reploid:** Continue migrating Reploid's own UI to be built from its core Web Components, defined and managed as artifacts, and assembled via `page_composition`.
8.  **Sophisticated Artifact Improvement Tools:** Develop more advanced static and dynamic tools for analyzing, patching, and refactoring artifacts, potentially making these tools paradigm-aware.
9.  **Enhanced Human-In-The-Loop (HITL) Experience:** Improve the UI/UX for HITL, providing richer contextual information based on artifact paradigms and the nature of proposed changes to aid human oversight.
10. **Refine Script Handling in `page_composition`:** Explore alternatives to full inlining for core script updates in `page_composition`, balancing immediate effect with maintainability and generated page size.

## Easter Eggs

- **Boot Screen Shortcuts:** `Enter` to Continue, `Space` to Reset.
- **Skip Boot Animation:** `Enter`, click, or tap.
- **Numbers:** [OEIS A001110](https://oeis.org/A001110).
