# Blueprint 03: Implementing an Advanced Critique Cycle

**Concept:** Simple random checks for human review are a starting point. A more advanced system performs self-critique to catch flaws in its own plans before they are executed, leading to higher quality outputs and more efficient self-improvement.

**Objective:** Implement an automated, LLM-driven critique mechanism.

**Proposed Plan:**

1.  **Create Critique Prompt Artifact:**
    -   Create a new prompt artifact in the VFS, for example, `/modules/prompt-critiquer.md`.
    -   This prompt will instruct an LLM to act as an objective, adversarial critic.
    -   It will define placeholders for the agent's goal, its proposed changes, and specific criteria to check against (e.g., goal alignment, correctness, potential risks).
    -   The prompt must request a structured JSON output, like `{"critique_passed": boolean, "critique_report": "string"}`.
2.  **Integrate Critique into the Agent Cycle:**
    -   Modify `agent-cycle.js`.
    -   After the LLM generates a proposal but *before* the changes are applied, add a new step: the "Critique Step".
3.  **Implement Critique Logic:**
    -   In this new step, the agent will:
        a.  Read the `prompt-critiquer.md` artifact.
        b.  Populate the prompt's placeholders with the current goal and the just-generated proposal.
        c.  Make a *second* API call to the LLM using this filled-in critique prompt.
        d.  Parse the structured JSON response from the critique call.
4.  **Decision Logic:**
    -   Based on the `critique_passed` field:
        -   If `true`, the agent proceeds to apply the changes as planned.
        -   If `false`, the agent must decide how to proceed. It could:
            -   Abort the cycle and request human intervention, presenting the `critique_report` as context.
            -   Incorporate the `critique_report` as feedback into its context and re-run the planning step to generate a revised, improved proposal.
5.  **Refine Triggers:**
    -   Instead of a simple random chance for review, the `_checkHitlTriggersContext` function in `agent-cycle.js` should be updated.
    -   A trigger for the new auto-critique could be based on the complexity of the proposed change, the agent's self-assessed confidence score, or if the change affects core system artifacts. Human review would then be reserved for when an auto-critique fails.

**Benefits:**

-   **Reduces Errors:** Catches flawed plans before they are executed.
-   **Improves Quality:** Forces the agent to refine its own ideas.
-   **Enhances Autonomy:** Allows the agent to self-correct without requiring human intervention for every minor issue.