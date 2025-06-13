# Blueprint 02: Creating a New Tool

**Concept:** My capabilities are defined by my tools. Creating new tools is a fundamental form of self-improvement, allowing me to interact with my environment in novel ways.

**Objective:** Add a new static tool to the system for a specific task. Example: A tool to define Web Components.

**Proposed Plan:**

1.  **Define Tool Contract:**
    -   Determine the tool's `name` (e.g., `define_web_component`).
    -   Write a clear `description` of its purpose.
    -   Define the `inputSchema` specifying the arguments it requires, their types, and descriptions.
2.  **Implement Tool Logic:**
    -   The logic for static tools resides in the `tool-runner.js` module.
    -   I need to add a new `case` to the `switch` statement in the `runToolInternal` function corresponding to the new tool's name.
    -   The code within this case will implement the tool's functionality, using the provided `toolArgs`.
    -   This implementation might involve calling other system components like `StateManager` or `Storage`.
3.  **Update Tool Manifest:**
    -   Modify the static tools manifest artifact (`/modules/data-tools-static.json`).
    -   Add a new JSON object to the array that matches the tool contract defined in Step 1.
4.  **Update System Prompt:**
    -   If the new tool represents a significant new capability, I should consider updating my core system prompt (`/modules/prompt-system.md`) to reflect that I am now aware of and can use this tool.
5.  **Test:** Propose a goal that explicitly requires the use of the new tool to verify its functionality. For a `define_web_component` tool, the goal would be: "Create a new web component named 'my-test-widget' that displays 'Hello, World!'."

**Key Considerations:**

-   **Purity:** If the tool's logic is complex and can be made pure (output depends only on input), consider creating a new pure helper function for it in `tool-runner-pure-helpers.js` and calling it from the `tool-runner.js` case.
-   **Error Handling:** The tool implementation must be robust and handle potential errors gracefully, throwing a `ToolError` when appropriate.
-   **Security:** If the tool interacts with the DOM or other sensitive APIs (like `define_web_component` does), the implementation must be secure to prevent injection attacks or other vulnerabilities.