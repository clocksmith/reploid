# REPLOID Knowledge Base

**[Back to Harness README](../README.md)**

---

> **Note for Contributors:** As of the new consumer-focused architecture, Blueprints are no longer presented directly to the end-user. Instead, they are bundled into **Personas**, which are defined in `config.json`. This directory remains the source of truth for the agent's technical knowledge, but it is now an abstraction used to build the user-facing personas. See `docs/PERSONAS.md` for more details.

This directory contains the REPLOID's conceptual knowledge base. The files herein are not active code; they are instructional markdown documents, or **"blueprints,"** designed to be discovered and studied by the agent itself. Each blueprint provides a high-level guide to a potential, significant self-improvement, outlining the architectural principles, strategic goals, and implementation pathways for a major new capability.

The purpose of this knowledge base is to serve as a powerful catalyst for the agent's Recursive Self-Improvement (RSI) cycles. While the agent possesses the core faculties to evolve independently, these blueprints provide structured, expert-level knowledge that can dramatically accelerate its development.

## Blueprint Style Guide

### 1. Philosophy

This guide ensures that every blueprint in the REPLOID knowledge base is consistent, machine-readable, and pedagogically sound. Blueprints are the agent's textbooks; their structure and clarity are paramount for facilitating autonomous learning and evolution. Adherence to this guide is mandatory for all new blueprint artifacts.

### 2. File Naming Convention

Blueprint files MUST follow a strict naming convention:

`0x{HEX_ID}-{kebab-case-title}.md`

-   `0x{HEX_ID}`: A zero-padded, 6-digit hexadecimal identifier (e.g., `0x000001`, `0x00000A`, `0x000012`).
-   `kebab-case-title`: A short, descriptive title in lowercase, with words separated by hyphens.

**Example:** `0x000008-agent-cognitive-cycle.md`

### 3. Core Blueprint Structure

Every blueprint artifact MUST contain the following sections, in this precise order, using the specified Markdown formatting.

```
# Blueprint 0x{HEX_ID}: [Title Case Title]

**Objective:** A single, concise sentence articulating the primary goal or purpose of the concept described in this blueprint.

**Prerequisites:** A list of other blueprint IDs that should be understood before tackling this one. Use "None" if it is a foundational concept.
- *Example: `Prerequisites: 0x000004, 0x000005`*

**Affected Artifacts:** A list of the primary VFS artifacts that will likely be created, modified, or deleted if the agent acts on this blueprint.
- *Example: `/modules/agent-cycle.js`, `/modules/prompt-system.md`*

---

### 1. The Strategic Imperative
*(This section explains the "Why." It provides the high-level strategic reasoning behind the concept. It should be focused and concise, ideally between 50-150 words).*

### 2. The Architectural Solution
*(This section explains the "How." It describes the technical design and architectural pattern that solves the strategic challenge. It may include small code snippets using Markdown code fences to illustrate key ideas).*

### 3. The Implementation Pathway
*(This section provides the "What." It is a clear, step-by-step list of actions the agent could take to implement the solution. This serves as a guide for the agent's own planning process).*
```

### 4. Content and Formatting Rules

-   **Headings:** Use a single H1 for the title and H3 for the three core sections.
-   **Keywords:** Use `**bold**` for critical terms, file paths, and artifact IDs.
-   **Code:** Use `backticks` for inline code and fenced code blocks (e.g., ````javascript`) for multi-line examples.
-   **Tone:** The language MUST be objective, technical, and pedagogical. The blueprint is a formal technical document, not a casual explanation.
-   **Conciseness:** Each section should be focused and to the point. Avoid verbose prose. The goal is clarity and efficient machine-parsing by the agent.

---

## Catalog of Blueprints

This catalog provides a comprehensive index of the agent's potential evolutionary pathways, mapping directly to its composable `upgrades`.

- **`0x000001`**: **System Prompt Architecture**
  - **Path**: `/docs/0x000001-system-prompt-architecture.md`
  - **Summary**: Defines the structure and philosophy of the agent's core identity prompt, enabling dynamic context injection.

- **`0x000002`**: **Application Orchestration**
  - **Path**: `/docs/0x000002-application-orchestration.md`
  - **Summary**: Details the `app-logic.js` module's role in loading all other modules and managing dependency injection upon agent awakening.

- **`0x000003`**: **Core Utilities and Error Handling**
  - **Path**: `/docs/0x000003-core-utilities-and-error-handling.md`
  - **Summary**: Explains the necessity of a central `utils.js` module for shared functions and custom `Error` classes.

- **`0x000004`**: **Default Storage Backend (localStorage)**
  - **Path**: `/docs/0x000004-default-storage-backend-localstorage.md`
  - **Summary**: Describes the baseline `localStorage` wrapper, providing a simple, synchronous persistence layer for the VFS.

- **`0x000005`**: **State Management Architecture**
  - **Path**: `/docs/0x000005-state-management-architecture.md`
  - **Summary**: Outlines the role of the `StateManager` as the single source of truth for the agent's state and VFS metadata.

- **`0x000006`**: **Pure State Helpers**
  - **Path**: `/docs/0x000006-pure-state-helpers.md`
  - **Summary**: Articulates the principle of separating deterministic state calculations (validation, stats) into a pure helper module.

- **`0x000007`**: **API Client and Communication**
  - **Path**: `/docs/0x000007-api-client-and-communication.md`
  - **Summary**: Details the architecture for a robust API client with features like retry logic, abort handling, and response sanitization.

- **`0x000008`**: **Agent Cognitive Cycle**
  - **Path**: `/docs/0x000008-agent-cognitive-cycle.md`
  - **Summary**: Provides the architectural model for the agent's primary "think-act" loop within `agent-cycle.js`.

- **`0x000009`**: **Pure Agent Logic Helpers**
  - **Path**: `/docs/0x000009-pure-agent-logic-helpers.md`
  - **Summary**: Explains how to isolate complex prompt assembly and reasoning logic into a testable, pure helper module.

- **`0x00000A`**: **Tool Runner Engine**
  - **Path**: `/docs/0x00000A-tool-runner-engine.md`
  - **Summary**: Describes the engine responsible for executing the agent's static and dynamic tools.

- **`0x00000B`**: **Pure Tool Logic Helpers**
  - **Path**: `/docs/0x00000B-pure-tool-logic-helpers.md`
  - **Summary**: Outlines the conversion of internal tool definitions into the specific formats required by external LLM APIs.

- **`0x00000C`**: **Sandboxed Tool Worker**
  - **Path**: `/docs/0x00000C-sandboxed-tool-worker.md`
  - **Summary**: Explains the security and concurrency benefits of executing dynamically created tools in a sandboxed Web Worker.

- **`0x00000D`**: **UI Management**
  - **Path**: `/docs/0x00000D-ui-manager.md`
  - **Summary**: Details the architecture for managing the agent's developer console UI, including rendering, event handling, and state display.

- **`0x00000E`**: **UI Styling (CSS)**
  - **Path**: `/docs/0x00000E-ui-styling-css.md`
  - **Summary**: Covers the role of the `ui-style.css` artifact in defining the visual appearance of the agent's interface.

- **`0x00000F`**: **UI Body Template (HTML)**
  - **Path**: `/docs/0x00000F-ui-body-template-html.md`
  - **Summary**: Describes the foundational HTML skeleton artifact that structures the agent's user interface.

- **`0x000010`**: **Static Tool Manifest**
  - **Path**: `/docs/0x000010-static-tool-manifest.md`
  - **Summary**: Explains the structure of the JSON artifact that defines the agent's built-in, static toolset.

- **`0x000011`**: **Advanced Storage Backend (IndexedDB)**
  - **Path**: `/docs/0x000011-advanced-storage-backend-indexeddb.md`
  - **Summary**: Outlines the architectural upgrade to an asynchronous, high-capacity `IndexedDB` storage layer.

- **`0x000012`**: **Structured Self-Evaluation**
  - **Path**: `/docs/0x000012-structured-self-evaluation.md`
  - **Summary**: Proposes a framework for a structured, LLM-driven self-evaluation tool and its integration into the agent's cycle.