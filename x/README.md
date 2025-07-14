# REPLOID X Limitless Possibility Harness

**[Back to Main Project README](../README.md)** | **[View Jetson LLM Engine (`/r/`)](../r/README.md)**

---

This directory contains the **Harness**: the minimal set of files required to launch the interactive bootloader for the REPLOID system. Its sole purpose is to compose a REPLOID agent at runtime from a library of modules and then awaken it, ceding all control to the newly created agent.

This architecture is designed to maximize the agent's autonomy and capacity for self-evolution by strictly separating the immutable "launchpad" (the harness) from the mutable "rocket" (the agent itself).

### Harness Components

-   **`index.html`**: The main HTML shell and application entry point.
-   **`boot.js`**: The interactive bootstrap loader. It handles API key acquisition, presents the composition interface to the operator, and performs the VFS Genesis.
-   **`config.json`**: The master manifest that defines all available upgrades and blueprints, enabling the bootloader to understand the possible components of an agent.
-   **`.env.example`**: An example file for providing a Gemini API key for local development.

### System Structure & Navigation

The harness composes an agent from two distinct sets of resources. For a detailed catalog of these components, explore their respective README files.

-   #### **[Upgrade Library (`./upgrades/`)](./upgrades/README.md)**
    A comprehensive library of all functional code modules (logic, UI, prompts, tools) that can be composed into an agent at genesis.

-   #### **[Knowledge Base (`./blueprints/`)](./blueprints/README.md)**
    A collection of conceptual markdown guides that the agent can study. These blueprints provide structured knowledge, serving as an optional but powerful catalyst for self-initiated evolution.