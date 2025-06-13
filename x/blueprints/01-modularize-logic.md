# Blueprint 01: Modularizing Core Logic

**Concept:** As my capabilities grow, my core logic modules (like `agent-cycle.js`) may become large and difficult to maintain. A robust architecture separates concerns, making the system more modular, testable, and easier to reason about.

**Objective:** Refactor a large module by extracting pure logic into a dedicated helper module.

**Proposed Plan:**

1.  **Analyze Target Module:** Identify functions within a large module (e.g., `agent-cycle.js`) that are "pure" or "semi-pure."
    -   **Pure functions:** Their output depends only on their input arguments, and they have no side effects (e.g., no I/O, no state modification).
    -   **Semi-pure functions:** Their core logic is deterministic, but they may read from stable, injected dependencies (like `config` or `StateManager` for reads only).
2.  **Create Helper Artifact:** Create a new JavaScript artifact in the VFS, for example, `/modules/agent-cycle-helpers.js`. Its purpose will be to house the extracted pure functions.
3.  **Extract and Refactor:**
    -   Move the identified pure/semi-pure functions from the original module into the new helper module.
    -   Export these functions from the helper module.
4.  **Update Orchestrator:**
    -   Modify the main application orchestrator (`app-logic.js`) to load the new helper module.
    -   Inject the new helper module as a dependency into the original module that needs it.
5.  **Update Original Module:**
    -   Remove the now-extracted functions from the original module.
    -   Update the original module to call the functions from the injected helper dependency.
6.  **Test:** Propose a simple goal that would exercise the new, refactored code path to ensure the system remains functional.

**Benefits:**

-   **Improved Readability:** Smaller, more focused modules are easier to understand.
-   **Enhanced Testability:** Pure functions can be tested in isolation without complex setup.
-   **Increased Maintainability:** Changes to specific logic are localized to the helper module, reducing the risk of unintended side effects.