# Blueprint 0x000001: System Prompt Architecture

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/agent-context.js`, `/self/core/zero-prompt.js`, `/self/core/persona-manager.js`, `/self/prompts/kernel.md`, `/self/config/boot-seed.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000001-system-prompt-architecture.md`
**Objective:** Define how the agent's system prompt is assembled from the persona, the goal and the runtime mode, and which prompt text is code and which is a seeded file.

**Prerequisites:** [0x000043](0x000043-persona-management-system.md) (personas)

---

### 1. Assembly

The agent loop ([0x000008](0x000008-agent-cognitive-cycle.md)) builds its first context with `buildAgentInitialContext({ goal, personaPrompt, runtimeMode, maxToolCalls, discoveryLimit })` from `self/core/agent-context.js`. It returns two messages: the system prompt and `Begin. Goal: <goal>`.

The system prompt depends on the mode:

- **Minimal Zero or X seed** (`isMinimalLabMode(mode)` in `self/config/lab-upgrades.js`: mode `zero` or `x` at the `spark` upgrade level): `buildZeroSystemPrompt({ personaPrompt, goal, mode })` from `self/core/zero-prompt.js`. It states the goal, the continuous-improvement directive, the persona section, the writable boundary (`/shadow` for candidates, `/artifacts` for evidence, no direct `/self` writes from the seed), the CreateTool workflow with its Verification Worker and activation-check rules, the seed tool list (`ZERO_SEED_TOOLS` from `shared/config/tool-surfaces.js`) and the `REPLOID/0` tool-call format.
- **Other modes**: the persona prompt followed by a general agent prompt with the `REPLOID/0` tool-call format, shadow-first change rules and the goal. In `x` mode the agent is told never to stop at `DONE` after a working result.

The persona prompt comes from `PersonaManager.getSystemPrompt()` (`self/core/persona-manager.js`), which combines core instructions (`buildZeroCoreInstructions`) with the selected persona's description and instructions. Persona text can be changed through `applySlotMutation` on its `description` and `instructions` slots only.

Prompt text is assembled by template literals in code. There is no placeholder template (`/core/prompt-system.md`) and no `agent-logic-pure.js`.

### 2. Seeded prompt files

`self/prompts/kernel.md` is the Zero kernel prompt: VFS discovery rules, the live roots and the operating contract. It is seeded into the VFS (listed in `self/config/boot-seed.js`) for the agent to read; no code inserts it into the system prompt.

### 3. Changing the prompt

The agent can propose prompt changes like any other change: as a candidate under `/shadow`, through persona slot mutation, or through prompt evolution ([0x000067](0x000067-gepa-prompt-evolution.md)). A better score for a candidate prompt informs the operator; it does not adopt the prompt.

### 4. Verification conditions

- In the minimal Zero seed the system prompt lists exactly the seed tools.
- The first user message is `Begin. Goal: <goal>`.
