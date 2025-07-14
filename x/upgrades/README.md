# REPLOID Upgrade Library

**[Back to Harness README](../README.md)**

---

This directory contains the REPLOID's library of pre-built, functional code modules, referred to as **"upgrades."** Each file or self-contained set of files in this directory represents a discrete capability that can be composed into a REPLOID agent at the moment of its creation. The `boot.js` harness uses the master `config.json` manifest to identify these modules by a short, memorable ID.

During the interactive boot sequence, an operator can select a specific combination of these upgrades to construct a custom agent tailored for a particular task. This compositionality is central to the REPLOID philosophy, allowing for rapid experimentation and a clear separation between the agent's innate capabilities (defined by its composed upgrades) and its learned behaviors (developed through self-modification).

The default storage mechanism is the asynchronous `storage-indexeddb.js` (`idb`) module for improved performance and capacity.

## Catalog of Upgrades

The following is a high-level catalog of the core upgrades available for composition. For detailed architectural information on any component, refer to the corresponding document in the **[Blueprint Knowledge Base](../blueprints/README.md)**.

### Core Engine & Logic
*   **`app`**: The main application orchestrator.
*   **`cyc`**: The agent's core cognitive cycle logic.
*   **`sm`**: The state manager and VFS interface.
*   **`api`**: The client for communicating with the Gemini API.
*   **`tr`**: The tool execution engine.
*   **`util`**: Essential shared utilities and custom `Error` classes.

### Pure Helper Modules
*   **`alp`**: Pure functions for agent prompt assembly.
*   **`shp`**: Pure functions for state validation and statistics.
*   **`trh`**: Pure functions for converting tool schemas for the API.

### Persistence Layer
*   **`idb`**: The default `IndexedDB` asynchronous storage backend.

### User Interface
*   **`ui`**: Manages the rendering and event handling for the dev console.
*   **`body`**: The HTML skeleton for the dev console UI.
*   **`style`**: The CSS styles for the dev console.

### Tools & System Artifacts
*   **`prompt`**: The agent's core system prompt and identity.
*   **`tools`**: The JSON manifest of all built-in static tools.
*   **`worker`**: The sandboxed Web Worker for dynamic tool execution.
*   **`eval`**: An optional, packaged self-evaluation tool.
*   **`sys-cfg`**: The agent's mutable runtime configuration file.
*   **`sys-scratch`**: A volatile working memory artifact.
*   **`sys-tools-dyn`**: The manifest for agent-created dynamic tools.