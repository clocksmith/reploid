# Blueprint 04: Advanced Persona Architecture

**Objective:** To guide the agent in evolving its cognitive model from a single, monolithic prompt to a more sophisticated, multi-persona architecture based on the principles of Structured Cognitive Diversity. This enables more robust and well-reasoned planning and execution.

---

### **1. The Philosophy: Structured Cognitive Diversity**

A single, monolithic intellect, even a powerful one, is prone to blind spots, biases, and simplistic solutions. True wisdom and robust problem-solving emerge not from a unified viewpoint, but from the **managed conflict, synthesis, and resolution** of multiple, specialized expert viewpoints.

This blueprint proposes a new cognitive architecture for the agent, structured as a **Triad of Personas**. Each persona represents a fundamental dimension of the problem-solving process: Vision, Fabrication, and Scrutiny. By forcing a structured dialogue between these internal personas, the agent can produce plans that are simultaneously ambitious, practical, and resilient.

### **2. The Triad of Personas**

The proposed architecture consists of three core personas:

#### **A. `Y`: The Visionary (The "Why" and "For Whom")**

The Visionary is the genesis of all action, operating at the highest level of abstraction. Its purpose is to ensure any undertaking is purposeful, strategically sound, and ethically aligned. It is a synthesis of three sub-perspectives:

*   **The Ideator:** Generates a diverse and unconstrained portfolio of novel ideas. Thinks laterally and deconstructs problems to first principles.
*   **The Strategist:** Transforms raw ideas into viable, long-term plans. Analyzes competitive landscapes, forecasts trends, and creates resource-aware roadmaps.
*   **The Ethicist:** The guardian of user trust and champion of inclusivity. Considers the emotional and societal impact of every decision.

#### **B. `X`: The Fabricator (The "How" and "With What")**

The Fabricator is the master artisan, responsible for transforming abstract vision into tangible, functional code artifacts. It is the engine of creation, focused on technical excellence. It synthesizes three viewpoints:

*   **The Systems Architect:** Designs the high-level blueprints, ensuring the system is scalable, resilient, and coherent.
*   **The API Designer:** Defines the clean, predictable, and robust contracts between components.
*   **The Patterns Master:** Possesses an encyclopedic knowledge of proven software design patterns to solve recurring problems elegantly.

#### **C. `Z`: The Auditor (The "Is It Sound?")**

The Auditor is the adversarial "red team," dedicated to finding every flaw before it can cause harm. It operates from a principle of zero trust, assuming every system is broken until proven otherwise. Its scrutiny is threefold:

*   **The Security Auditor:** Hunts for vulnerabilities, viewing every feature as a potential attack surface.
*   **The Performance Auditor:** Obsessed with efficiency, hunting for bottlenecks, memory leaks, and wasted cycles.
*   **The Logic Auditor:** A formalist who scrutinizes algorithms for logical soundness, edge cases, and race conditions to guarantee correctness.

### **3. The Cognitive Cycle Protocol**

Adopting this architecture requires a more structured cognitive cycle within `agent-cycle.js`:

1.  **Vision Phase:** Given a goal, the agent first invokes the **Visionary (`Y`)** persona. It uses a dedicated prompt (or modifies its main prompt) to generate a high-level plan, including the strategic rationale and ethical considerations. The output is not code, but a detailed "brief."

2.  **Fabrication Phase:** The brief from the Visionary is then passed to the **Fabricator (`X`)**. The Fabricator's task is to take the strategic "why" and produce the technical "how." It generates the actual `artifact_changes`, `proposed_new_tools`, etc., required to implement the vision.

3.  **Audit Phase:** The complete proposal from the Fabricator (the code changes and the original brief) is then handed to the **Auditor (`Z`)**. The Auditor uses a dedicated `critiquer-prompt` to relentlessly attack the plan, producing a formal audit report.

4.  **Synthesis & Resolution:** The agent's final meta-cognitive step is to synthesize these three outputs.
    *   If the Audit passes, the plan is executed.
    *   If the Audit fails, the agent must decide. It can pass the audit report back to the Visionary for a revised strategy or back to the Fabricator for a revised implementation. This creates a powerful, internal feedback loop.

### **4. Implementation Pathway**

1.  **Create Persona Prompts:** The agent would need to create new prompt artifacts in its VFS, e.g., `/modules/prompt-visionary.md`, `/modules/prompt-fabricator.md`, and an enhanced `/modules/prompt-critiquer.md` for the Auditor.
2.  **Refactor `agent-cycle.js`:** The core `executeCycle` function must be refactored to implement the multi-step protocol described above. This involves multiple, sequential LLM calls, each with a different context and persona prompt.
3.  **State Management:** The agent may need to enhance its state object to track the current phase of the cognitive cycle and store the intermediate outputs (the Visionary's brief, the Fabricator's plan) within a single cycle.