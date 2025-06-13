# REPLOID (Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER)

**REPLOID** is an experimental framework designed to explore LLM-driven recursive self-improvement (RSI) by uniquely leveraging the **web browser as a comprehensive development and execution ecosystem**. The long-term vision is to cultivate self-contained, browser-native agentic systems capable of sophisticated evolution towards Artificial General Intelligence (AGI).

This document serves as the root entry point for understanding the project's architecture, philosophy, and long-term goals.

---

## The Primordial Architecture

The current iteration of REPLOID is built upon a **"primordial"** architecture, a foundational philosophy designed to maximize agent autonomy and evolvability. This design strictly separates the static, immutable launch mechanism from the agent's dynamic, composed being, ensuring that the agent's capacity for self-evolution is an intrinsic property from genesis, not an afterthought.

1.  **The Minimal Harness:** The code in the root `x/` directory constitutes a minimal bootloader, or "harness." Its sole purpose is to provide an interactive environment for composing and launching an agent. It is the launchpad, not the rocket. It handles the initial user interaction, secures necessary credentials like an API key, and orchestrates the creation of the agent's initial state and virtual file system.

2.  **The Composable Agent via Upgrades:** The agent itself is not a monolithic entity. It is dynamically assembled at boot time from a library of discrete, swappable code modules called **"upgrades."** These modules represent distinct capabilities, such as different storage backends, advanced tools, or core logic components. This compositionality allows an operator to precisely define the agent's starting capabilities, facilitating rapid experimentation with different configurations, from a minimal "core" agent to one pre-loaded with advanced tools for self-evaluation.

3.  **Discoverable Knowledge via Blueprints:** The system's potential for more profound evolution is encoded as conceptual **"blueprints."** These are not active code but rather detailed, instructional markdown documents that reside within the agent's own virtual file system. They serve as a discoverable knowledge base, guiding the agent on complex topics like advanced software architecture, tool creation, or even the implementation of more sophisticated cognitive models. The agent is free to study, interpret, or ignore these blueprints, ensuring its evolutionary path is self-directed.

## System Structure & Navigation

The project's file system is organized to reflect this architectural philosophy.

- **`x/` (The Harness):** Contains the minimal files to launch the system.
  - `index.html`: The application's main HTML entry point.
  - `boot.js`: The interactive bootstrap loader that orchestrates the entire genesis process.
  - `config.json`: The master manifest defining all available upgrades and blueprints.
- **`x/upgrades/` (The Upgrade Library):** A comprehensive library of all functional code modules that can be composed into an agent. Each module, or "upgrade," has a short ID for easy selection during the boot process.
  - **[Explore the Upgrade Library](./upgrades/README.md)**
- **`x/blueprints/` (The Knowledge Base):** A collection of conceptual markdown guides. These documents provide the agent with structured knowledge, serving as an optional but powerful catalyst for self-initiated evolution.
  - **[Explore the Knowledge Base](./blueprints/README.md)**

## The Genesis Protocol: Boot Sequence

The `boot.js` script orchestrates a precise sequence to bring a configured agent to life.

1.  **API Key Protocol:** The harness first attempts to secure a Google Gemini API key. It prioritizes fetching from a local development endpoint but will fall back to interactively and securely prompting the user if a key is not found. The process halts until a valid key is provided.
2.  **Manifest Load:** It loads `config.json` to gain a complete understanding of all available upgrades and blueprints, including their IDs, file paths, and descriptions.
3.  **Interactive Composition:** A command-line-style interface is rendered, listing all available modules. The operator is prompted to select which upgrades to install and, optionally, which blueprint to set as the initial area of study. Submitting an empty input selects the `defaultCore` composition defined in the manifest.
4.  **Virtual File System (VFS) Genesis:** This is the critical creation step. The harness clears any pre-existing REPLOID data from `localStorage` to ensure a clean genesis. It then iterates through the selected list of upgrade modules, fetching each file and writing it into the agent's VFS (e.g., at `/modules/`). Concurrently, it fetches _all_ blueprint files and writes them to a dedicated `/docs/` path within the VFS, ensuring the agent's full potential knowledge is always available.
5.  **State Initialization & Awakening:** The harness constructs the initial state object. This critical artifact contains the metadata for every file loaded into the VFS, the agent's initial goal (which may be to study a selected blueprint), and the secured API key. This state object is saved to the VFS. Finally, the harness retrieves the agent's core application logic (`app-logic.js`) from the VFS, creates a new JavaScript Function from its content, and executes it. This final act "awakens" the fully-composed agent, which then takes control, fading out the boot UI and rendering its own developer console interface.
