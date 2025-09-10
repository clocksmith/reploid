# REPLOID Upgrade Library

**[Back to Harness README](../README.md)**

---

This directory contains the REPLOID's library of pre-built, functional code modules, referred to as **"upgrades."** Each file or self-contained set of files in this directory represents a discrete capability that can be composed into a REPLOID agent at the moment of its creation. The `boot.js` harness uses the master `config.json` manifest to identify these modules by a short, memorable ID.

During the interactive boot sequence, an operator can select a specific combination of these upgrades to construct a custom agent tailored for a particular task. This compositionality is central to the REPLOID philosophy, allowing for rapid experimentation and a clear separation between the agent's innate capabilities (defined by its composed upgrades) and its learned behaviors (developed through self-modification).

The default storage mechanism is the asynchronous `storage-indexeddb.js` (`idb`) module for improved performance and capacity.

## Catalog of Upgrades

The following is a high-level catalog of the core upgrades available for composition. Each upgrade uses a 4-character ID in config.json. All modules now follow a standardized format - see **[STANDARDIZATION.md](../STANDARDIZATION.md)** for details.

### Core Engine & Logic
*   **`APPL`** (`app-logic.js`): The main application orchestrator with module loader support
*   **`CYCL`** (`agent-cycle.js`): The agent's core cognitive cycle logic  
*   **`STMT`** (`state-manager.js`): The state manager and VFS interface
*   **`APIC`** (`api-client.js`): The client for communicating with the Gemini API
*   **`TRUN`** (`tool-runner.js`): The tool execution engine
*   **`UTIL`** (`utils.js`): Essential shared utilities and custom `Error` classes

### Pure Helper Modules (No Dependencies)
*   **`AGLP`** (`agent-logic-pure.js`): Pure functions for agent prompt assembly
*   **`STHP`** (`state-helpers-pure.js`): Pure functions for state validation and statistics
*   **`TRHP`** (`tool-runner-pure-helpers.js`): Pure functions for converting tool schemas

### Persistence Layer
*   **`IDXB`** (`storage-indexeddb.js`): The default `IndexedDB` asynchronous storage backend

### User Interface
*   **`UIMN`** (`ui-manager.js`): Manages the rendering and event handling for the dev console
*   **`BODY`** (`ui-body-template.html`): The HTML skeleton for the dev console UI
*   **`STYL`** (`ui-style.css`): The CSS styles for the dev console

### Tools & Capabilities
*   **`PRMT`** (`prompt-system.md`): The agent's core system prompt and identity
*   **`TLRD`** (`tools-read.json`): Read-only tools for safe introspection
*   **`TLWR`** (`tools-write.json`): Write tools that enable RSI capabilities
*   **`WRKR`** (`tool-worker.js`): The sandboxed Web Worker for dynamic tool execution
*   **`EVAL`** (`tool-evaluator.js`): An optional, packaged self-evaluation tool

### System Configuration
*   **`SCFG`** (`system-config.json`): The agent's mutable runtime configuration
*   **`SCRT`** (`system-scratchpad.md`): A volatile working memory artifact
*   **`STLD`** (`system-tools-dynamic.json`): The manifest for agent-created dynamic tools

### RSI Meta-Modules
*   **`MTCP`** (`meta-tool-creator.js`): Meta-tool creation patterns and utilities
*   **`GMOD`** (`goal-modifier.js`): Safe goal modification and evolution mechanisms
*   **`BLPR`** (`blueprint-creator.js`): Blueprint generation and management system

### Module System (New)
*   **`MLDR`** (`boot-module-loader.js`): Standardized module loader with dependency injection
*   **`MMNF`** (`module-manifest.json`): Module dependency manifest and load order