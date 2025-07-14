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

### Philosophy

While distinct in implementation, both projects are driven by a unified philosophy: to push the boundaries of what is possible with AI at the edge. The `x/` project explores the frontiers of agent autonomy and self-modification in a universally accessible environment (the browser), while the `r/` project focuses on raw performance and efficiency on specialized, high-powered edge hardware.