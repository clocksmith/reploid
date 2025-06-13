# REPLOID Knowledge Base

**[Back to Root README](../README.md)**

This directory contains the REPLOID's conceptual knowledge base. The files herein are not active code; they are instructional markdown documents, or **"blueprints,"** designed to be discovered and studied by the agent itself. Each blueprint provides a high-level guide to a potential, significant self-improvement, outlining the architectural principles, strategic goals, and implementation pathways for a major new capability.

The purpose of this knowledge base is to serve as a powerful catalyst for the agent's Recursive Self-Improvement (RSI) cycles. While the agent possesses the core faculties to evolve independently, these blueprints provide structured, expert-level knowledge that can dramatically accelerate its development. They represent the accumulated wisdom of its creators, encoded in a format the agent can parse, reason about, and choose to act upon. The agent is entirely autonomous in its decision to use this knowledge; it can study a blueprint to inform a specific goal, synthesize concepts from multiple blueprints to create a novel solution, or ignore them entirely in favor of a self-derived evolutionary path. This ensures that while the agent is not "programmed" to follow these steps, it is equipped with the foundational knowledge to make sophisticated architectural decisions.

---

## Catalog of Blueprints

### **`b01`: Logic Modularization**

- **File:** `01-modularize-logic.md`
- **Summary:** This blueprint introduces the agent to advanced software engineering principles, specifically the concept of separating concerns. It details the "why" and "how" of refactoring a large, monolithic logic file into smaller, more specialized, and more testable modules.
- **Key Concepts:**
  - Distinction between "pure" and "semi-pure" functions.
  - The process of creating dedicated "helper" modules.
  - Modifying the application orchestrator to handle dependency injection for newly created modules.
  - The benefits of improved readability, testability, and maintainability.
- **[View Blueprint: 01-modularize-logic.md](./01-modularize-logic.md)**

### **`b02`: New Tool Creation**

- **File:** `02-create-new-tool.md`
- **Summary:** This guide explains the fundamental process by which the agent can expand its own capabilities: creating new tools. It uses the example of a `define_web_component` tool to walk through the necessary steps.
- **Key Concepts:**
  - Defining a tool's contract: name, description, and input schema.
  - Modifying the static tool manifest (`data-tools-static.json`) to register the new tool.
  - Implementing the tool's logic within the `tool-runner.js` module.
  - The importance of robust error handling and considering the purity of tool logic.
- **[View Blueprint: 02-create-new-tool.md](./02-create-new-tool.md)**

### **`b03`: Advanced Critique Implementation**

- **File:** `03-advanced-critique.md`
- **Summary:** This blueprint moves the agent beyond simple human-in-the-loop checks to a more autonomous mode of self-correction. It outlines the architecture for an LLM-driven critique cycle, allowing the agent to review its own plans before execution.
- **Key Concepts:**
  - Creating a dedicated `critiquer-prompt` artifact.
  - Integrating a "Critique Step" into the main `agent-cycle.js` logic.
  - Making a second, meta-level LLM call to evaluate a proposal.
  - Decision logic for how to proceed based on the critique's outcome (proceed, abort, or retry with feedback).
- **[View Blueprint: 03-advanced-critique.md](./03-advanced-critique.md)**

### **`b04`: Persona Architecture**

- **File:** `04-persona-architecture.md`
- **Summary:** This document details a sophisticated cognitive model based on a triad of specialized personas (Fabricator, Visionary, Auditor). It provides the agent with a path to upgrade its own reasoning process from a simple, monolithic prompt to a more structured and powerful internal dialogue.
- **Key Concepts:**
  - The principle of Structured Cognitive Diversity.
  - Detailed breakdowns of the X (Fabricator), Y (Visionary), and Z (Auditor) personas and their sub-components.
  - A proposed operational flow for how these personas would interact to generate, refine, and scrutinize a plan.
  - Implementation requires modifying the core system prompt and the agent cycle itself.
- **[View Blueprint: persona-architecture.md](./persona-architecture.md)**

### **`b05`: Page Composition**

- **File:** `05-page-composition.md`
- **Summary:** This blueprint describes a more robust and semantic method for full-page self-modification, moving beyond raw HTML string generation. It introduces a declarative, JSON-based artifact type for defining page structures.
- **Key Concepts:**
  - The limitations and risks of raw `full_html_source` modifications.
  - The structure of a `PAGE_COMPOSITION_DEF` artifact, including declarative sections for head, body, and script references.
  - The use of `artifact_id` and `web_component_tag` to compose a page from modular components.
  - The logic required in `agent-cycle.js` to parse this definition and assemble the final HTML.
- **[View Blueprint: page-composition.md](./page-composition.md)**

### **`b06`: Conceptual IndexedDB Upgrade**

- **File:** `06-indexed-db-storage-conceptual.md`
- **Summary:** This document presents a significant architectural challenge: upgrading the agent's persistence layer from the synchronous `localStorage` to the asynchronous, more powerful IndexedDB. It focuses on the "why" and the conceptual "how," forcing the agent to derive the implementation.
- **Key Concepts:**
  - The limitations of `localStorage` (size, synchronous API).
  - The benefits of IndexedDB (asynchronous, transactional, larger quota).
  - The "Refactoring Cascade": explaining that changing the storage layer to be `async` will necessitate `async`/`await` refactoring throughout the entire application call stack.
  - Conceptual API design for an `async` storage module.
- **[View Blueprint: indexed-db-storage-conceptual.md](./indexed-db-storage-conceptual.md)**

### **`b07`: WebGPU Inference Engine**

- **File:** `07-webgpu-inference-engine.md`
- **Summary:** This is the project's "milestone" blueprint, outlining a comprehensive, multi-phase research and development plan for the agent's most ambitious potential upgrade: building a client-side LLM inference engine using WebGPU.
- **Key Concepts:**
  - A structured, seven-phase R&D framework to guide the agent.
  - Deep dives into model quantization (Q4_0 GGUF), WebGPU shader development, GGUF loader implementation, performance benchmarking, and security considerations.
  - Serves as a long-term, grand challenge to guide the agent's evolution toward true computational autonomy.
- **[View Blueprint: webgpu-inference-engine.md](./webgpu-inference-engine.md)**
