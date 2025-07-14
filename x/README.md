
# REPLOID Limitless Harness X

**[Back to Main Project README](../README.md)** | **[View Jetson LLM Engine (`/r/`)](../r/README.md)**

---

This directory contains the **REPLOID Harness**, the foundation for creating self-contained, browser-native AI agents. It uniquely leverages the web browser as a complete development, execution, and evolution ecosystem, allowing an agent to be composed and "awakened" entirely within a client's machine.

The harness is not the agent itself; it is the **launchpad**. Its sole purpose is to orchestrate the "Genesis Protocol": an interactive boot sequence that assembles an agent from a library of components and then cedes all control.

### Harness Architecture

The design of the harness is guided by three core principles:

1.  **The Minimal Harness:** The code in this directory (`boot.js`, `index.html`) is a static, immutable launcher. Its only job is to compose and start the agent.
2.  **The Composable Agent:** The agent's initial capabilities are not fixed. They are defined at boot time by selecting from a library of **Upgrades**—discrete code modules providing specific functionalities.
3.  **Discoverable Knowledge:** The agent's potential for long-term evolution is encoded in **Blueprints**. These are instructional guides the agent can study to learn new architectural concepts and initiate its own upgrades.

### Key Harness Files

-   **`index.html`**: The minimal HTML shell required to host and execute the boot script.
-   **`boot.js`**: The interactive bootstrap loader. It handles API key acquisition, presents the composition interface, and performs the VFS Genesis.
-   **`config.json`**: The master manifest that defines all available `upgrades` and `blueprints`, enabling the bootloader to understand the possible components of an agent.

### The Boot Sequence

The `boot.js` script orchestrates the following precise sequence to bring an agent to life:

1.  **API Key Protocol:** Secures a Gemini API key, prompting the user if necessary.
2.  **Manifest Load:** Fetches `config.json` to understand all available components.
3.  **Interactive Composition:** Renders a command-line interface for the operator to select upgrades and an optional blueprint to study. (Pressing Enter selects the default core composition).
4.  **VFS Genesis:** Clears any old VFS data from `localStorage`, then fetches and writes the selected `upgrades` and *all* `blueprints` into the agent's new VFS.
5.  **Awakening:** Constructs the initial state artifact (with goal and VFS metadata), saves it, and then executes the agent's core `app-logic.js` from the VFS, handing off full control.

### Component Libraries

The harness composes an agent from two resource libraries. For a detailed catalog of available components, explore their respective READMEs:

-   #### **[Upgrade Library (`./upgrades/`)](./upgrades/README.md)**
    A comprehensive library of all functional code modules (logic, UI, prompts, tools) that can be composed into an agent at genesis.

-   #### **[Knowledge Base (`./blueprints/`)](./blueprints/README.md)**
    A collection of conceptual markdown guides that the agent can study, providing structured knowledge for self-initiated evolution.
🐕 --- DOGS_END_FILE: x/README.md ---
