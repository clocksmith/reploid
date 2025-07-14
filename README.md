# REPLOID (Reflective Embodiment Providing Logical Overseeing Intelligent DREAMER (Deep Recursive Exploration Around Multimodal Embodying REPLOID))

This repository contains two primary projects exploring advanced, local AI agent systems.

1.  **`x/` (REPLOID Primordial Harness):** An experimental framework designed for recursive self-improvement, leveraging the web browser as a comprehensive development and execution ecosystem.
2.  **`r/` (Jetson LLM Engine):** A high-performance Python toolkit for running and benchmarking quantized GGUF language models on NVIDIA Jetson Orin hardware.

---

## Project Navigation

-   ### **[REPLOID Primordial Harness (`./x/`)](./x/README.md)**
    -   **Summary:** A browser-native agent architecture built for maximum autonomy and evolvability. Features a minimal boot harness that composes an agent at runtime from a library of "upgrades" and provides it with a knowledge base of "blueprints" to guide its self-improvement.
    -   **Technology Stack:** HTML, CSS, JavaScript (ESM).
    -   **[Explore the Harness Architecture & Concepts](./x/README.md)**

-   ### **[Jetson LLM Engine (`./r/`)](./r/README.md)**
    -   **Summary:** A complete toolkit for running 27B+ parameter GGUF models on an NVIDIA Jetson Orin 64GB. Includes setup scripts, interactive CLI, a FastAPI web server, and detailed performance analysis utilities.
    -   **Technology Stack:** Python, `llama-cpp-python`, `pynvml`, FastAPI.
    -   **[Explore the Jetson Engine & Benchmarks](./r/README.md)**

---

## Philosophy: The Vision for Autonomous Edge AI

The long-term vision of this repository is to explore pathways toward Artificial General Intelligence (AGI) through **Recursive Self-Improvement (RSI)**, executed entirely on local, edge-native hardware. We believe that true autonomy requires an agent to not only perform tasks but to understand, critique, and fundamentally rewrite its own operational logic. This repository investigates this vision by tackling two critical, complementary pillars of advanced edge AI.

The `x/` project explores the frontiers of **software and cognitive autonomy**. It treats the web browser as a complete development and execution ecosystem, investigating whether an agent can achieve true self-modification within this universal sandbox. It is an experiment in creating a mind that can learn and evolve. The `r/` project addresses **hardware and performance efficiency**, pushing the limits of raw inference throughput on specialized, power-conscious hardware. It is an experiment in creating a powerful engine to run that mind.

Ultimately, the insights from both are symbiotic. The goal is a future where the self-evolving cognitive architectures developed in `x/` can be deployed on the hyper-efficient, specialized engines pioneered in `r/`, enabling truly autonomous, powerful, and accessible AI that is not confined to the data center.

## The Compositional Agent Architecture

The diagram below illustrates how the Primordial Harness (`boot.js`) composes two different agents based on operator input, drawing from the same libraries of `Upgrades` and `Blueprints`.

```mermaid
graph TD
    subgraph "User Choices & Available Components"
        direction LR
        Input1[("Goal: 'System Check'<br/>Composition: Default")]
        Input2[("Goal: 'Study Blueprint 0x000011'<br/>Composition: Core + idb, eval")]

        CoreUpgrades["Core Upgrades<br/>(cyc, sm, ui...)"]
        AdvUpgrades["Adv. Upgrades<br/>(idb, eval)"]
        BPs["Blueprints<br/>(0x000011...)"]
    end

    Harness["boot.js<br/>Genesis Protocol"]

    Input1 -- "Selects" --> CoreUpgrades
    Input2 -- "Selects" --> CoreUpgrades
    Input2 -- "Selects" --> AdvUpgrades
    Input2 -- "Informs Goal" --> BPs

    CoreUpgrades --> Harness
    AdvUpgrades -.-> Harness
    BPs -.-> Harness

    subgraph "Resulting Composed Agents"
        direction LR
        Agent1("Agent A (Minimal)<br/>- IndexedDB Storage<br/>- Basic Tools")
        Agent2("Agent B (Advanced)<br/>- IndexedDB Storage<br/>- Eval Tool<br/>- Goal: Study IDB Blueprint")
    end

    Harness -- "Awakens" --> Agent1
    Harness -- "Awakens" --> Agent2

    // Style definitions
    style Input1 fill:#e6f3ff,stroke:#0000FF,color:#000
    style Agent1 fill:#e6f3ff,stroke:#0000FF,stroke-width:2px,color:#000
    linkStyle 0 stroke:#0000FF,stroke-width:2px;

    style Input2 fill:#ffe6e6,stroke:#FF0000,color:#000
    style Agent2 fill:#ffe6e6,stroke:#FF0000,stroke-width:2px,color:#000
    linkStyle 1,2,3 stroke:#FF0000,stroke-width:2px;
    
    style Harness fill:#ddffdd,stroke:#006400,color:#000
```
