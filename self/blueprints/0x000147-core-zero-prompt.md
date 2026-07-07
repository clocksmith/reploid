# Blueprint 0x000147: Zero Prompt Builder

**Objective:** Keep Zero runtime prompt construction in one browser-local module.

**Target Upgrade:** core/zero-prompt.js

**Affected Artifacts:** /core/zero-prompt.js

---

### 1. Intent
`core/zero-prompt.js` is the source of truth for Zero prompt text that is shared across runtime surfaces. AgentLoop owns the cycle and passes the active goal, batching limit, and discovery budget. PersonaManager owns persona selection. The prompt builder owns Zero-specific wording: browser containment, VFS paths, CreateTool activation, LoadModule reload semantics, and the visible Zero tool list.

Zero must not imply host shell, host filesystem, process, or arbitrary network access. Zero must also not teach the Promote workflow as its normal tool creation path.

### 2. Architecture
The module imports `getToolNamesForMode('zero')` from `config/tool-surfaces.js` so the prompt and manifests share one tool-surface source. It exports:

- `buildZeroCoreInstructions()` for PersonaManager.
- `buildZeroSystemPrompt()` for AgentLoop.
- `getZeroMutationProgressToolList()` for build-progress gates.
- `extractPersonaSection()` for carrying a selected persona section into the per-goal prompt.

AgentLoop passes runtime values into `buildZeroSystemPrompt()` and stores the returned string as the current system prompt. The builder returns text only. It does not read VFS, mutate state, execute tools, or inspect provider status.

### 3. Implementation Notes
- Keep CreateTool as the Zero installation path: stage, validate, write activation evidence, install under `/self/tools`, and load.
- Keep LoadModule scoped to reloading an already installed `/self` tool.
- Keep Zero tool order discovery-first: read/list/search/list-tools before write/edit/create/reload.
- Keep batch guidance parameterized by AgentLoop values instead of hardcoding cycle policy in prompt text.
- Keep Reploid/X promotion wording outside the Zero core prompt.

### 4. Verification Checklist
- [x] AgentLoop Zero prompt tests assert containment, CreateTool flow, LoadModule reload scope, and no legacy CreateTool -> WriteFile -> Promote -> LoadModule path.
- [x] Tool surface tests assert Zero does not expose Promote.
- [x] Module verifier requires this file in VFS manifest and blueprint registry.

*Last updated: July 2026*
