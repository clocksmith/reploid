# REPLOID Upgrade Library

**[Back to Root README](../README.md)**

This directory contains the REPLOID's library of pre-built, functional code modules, referred to as **"upgrades."** Each file or self-contained set of files in this directory represents a discrete capability that can be composed into a REPLOID agent at the moment of its creation. The `boot.js` harness uses the master `config.json` manifest to identify these modules by a short, memorable ID.

During the interactive boot sequence, an operator can select a specific combination of these upgrades to construct a custom agent tailored for a particular task. For instance, one could compose a minimal agent using only the foundational modules, or create a more advanced agent by including optional upgrades like the `idb` (IndexedDB) storage backend or the `eval` (Self-Evaluation) tool from genesis. This compositionality is central to the REPLOID philosophy, allowing for rapid experimentation and a clear separation between the agent's innate capabilities (defined by its composed upgrades) and its learned behaviors (developed through self-modification).

---

## Catalog of Upgrades

### Core Engine & Logic

These modules form the non-optional foundation of any functional REPLOID agent.

- **`app`: Application Orchestrator**

  - **File:** `app-logic.js`
  - **Description:** The central nervous system of the running agent. After the boot harness awakens the agent, this module takes control. It is responsible for dynamically loading all other composed modules (like the State Manager, UI Manager, and Cycle Logic) and injecting their dependencies, effectively wiring the agent's components together to form a cohesive, functional whole.

- **`cyc`: Core Logic Cycle**

  - **File:** `agent-cycle.js`
  - **Description:** The agent's cognitive engine. This module orchestrates the primary think-act loop. It fetches the current goal from the State Manager, assembles the necessary context and prompts, manages the interaction with the API Client to get an LLM response, and processes that response to drive the agent's actions.

- **`sm`: State Manager**

  - **File:** `state-manager.js`
  - **Description:** The agent's memory and single source of truth. It manages the application's state object and provides an abstraction layer over the underlying storage backend. It handles the creation, modification, and deletion of all artifacts within the agent's virtual file system (VFS).

- **`api`: API Client**

  - **File:** `api-client.js`
  - **Description:** The agent's interface to the outside world of large language models. This module is responsible for all communication with the Google Gemini API, handling request formatting, robust retry logic, and sanitizing the JSON responses from the LLM.

- **`tr`: Tool Runner**

  - **File:** `tool-runner.js`
  - **Description:** The engine that allows the agent to perform actions beyond simple text generation. It contains the logic to execute the agent's static tools (defined in `data-tools-static.json`) and provides the sandboxed environment for running dynamically created tools.

- **`util`: Core Utilities**
  - **File:** `utils.js`
  - **Description:** A foundational library providing essential, non-negotiable utilities used throughout the entire system. This includes the custom `Error` classes (`ApiError`, `ToolError`, etc.) that enable robust error handling, as well as the core logger instance.

### Pure Helper Modules

These modules contain deterministic, testable functions that support the core engine, upholding the "functional core, imperative shell" architectural principle.

- **`alp`: Pure Agent Logic**

  - **File:** `agent-logic-pure.js`
  - **Description:** Supports the Core Logic Cycle by providing pure functions for complex prompt assembly. It isolates the complex string and data manipulation required to create a context-rich prompt from the state-management and I/O logic in `agent-cycle.js`.

- **`shp`: Pure State Helpers**

  - **File:** `state-helpers-pure.js`
  - **Description:** Supports the State Manager. It provides pure functions for validating the integrity of the state object's structure and for calculating derived statistics (like average confidence or critique failure rates) from historical data arrays.

- **`trh`: Pure Tool Helpers**
  - **File:** `tool-runner-pure-helpers.js`
  - **Description:** Supports the Tool Runner. Its primary role is to provide pure functions that can convert the agent's internal tool definitions into the specific JSON schema required by the external LLM's function-calling API.

### Persistence Layers

These modules define how the agent's memory (its VFS) is stored in the browser.

- **`store`: Default Storage (localStorage)**

  - **File:** `storage.js`
  - **Description:** The default, standard persistence layer. It implements the VFS backend using the browser's `localStorage` API. It is simple and synchronous, making it ideal for the minimal core agent, but is limited in size.

- **`idb`: Enhanced Storage (IndexedDB)**
  - **File:** `storage-indexeddb.js`
  - **Description:** An optional, more powerful persistence layer using the browser's `IndexedDB` API. Selecting this upgrade at boot gives the agent a significantly larger and more performant, asynchronous memory, suitable for long-term evolution and storing very large artifacts.

### User Interface

These modules create the developer console that the user interacts with.

- **`ui`: UI Manager**

  - **File:** `ui-manager.js`
  - **Description:** This module controls the agent's user interface. It is responsible for rendering the developer console, displaying logs and cycle details, handling user input, and managing the UI for special states like Human-In-The-Loop (HITL) interventions.

- **`body`: UI Body Template**

  - **File:** `ui-body-template.html`
  - **Description:** The foundational HTML skeleton for the developer console UI. The UI Manager injects this into the main `index.html` page to create the application's visual structure.

- **`style`: UI Style**
  - **File:** `ui-style.css`
  - **Description:** Contains the minimal CSS required for the developer console to be functional and readable.

### Tools & Prompts

These modules provide the agent with its initial set of capabilities and its core identity.

- **`prompt`: System Prompt**

  - **File:** `prompt-system.md`
  - **Description:** A foundational artifact that defines the agent’s core identity, mission, and instructions. Swapping this file can fundamentally change the agent's base personality.

- **`tools`: Static Tool Manifest**

  - **File:** `data-tools-static.json`
  - **Description:** A JSON file defining the agent's built-in, static toolset. The default version is minimal, containing only the essential tools for reading and listing artifacts in its own VFS.

- **`worker`: Tool Worker**

  - **File:** `tool-worker.js`
  - **Description:** The script that runs in a sandboxed Web Worker. It provides a secure environment for the agent to execute dynamically generated code for new tools it creates for itself.

- **`eval`: Self-Evaluation Tool**
  - **File:** `tool-evaluator.js`
  - **Description:** An optional, advanced upgrade. It's a self-contained JSON package that provides the agent with the tool definition and the necessary prompt to perform structured, LLM-driven self-evaluation on its own plans and outputs.
