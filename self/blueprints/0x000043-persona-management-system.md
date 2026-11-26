# Blueprint 0x000043: Persona Management System

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/core/persona-manager.js`, `/self/personas/config.json`, `/tests/unit/persona-manager.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `core/persona-manager.js`

**Former Blueprint Paths:** `self/blueprints/0x000043-persona-management-system.md`

**Module ID:** `PersonaManager` (version 1.0.0, genesis level `spark`, type `core`, async; dependencies `Utils`, `VFS`, optional `EventBus`)

**Source:** `self/core/persona-manager.js`

---

## Purpose

`PersonaManager` builds the agent's system prompt from fixed core instructions plus the selected persona's description and behavioral instructions. The agent loop asks it for the prompt at the start of a run (`packages/reploid/src/agent/lab-strategy.js:393`). Prompt optimization (GEPA, [0x000067](0x000067-gepa-prompt-evolution.md)) reads and can rewrite persona prompt slots through it.

Earlier drafts described persona switching, usage statistics, lifecycle events and a widget. Those do not exist; this blueprint describes the current module.

## Sources of persona data

1. **Persona definitions** are fetched with `fetch('/personas/config.json')` (`persona-manager.js:72`), served from `self/personas/config.json`. The file holds `personas` (each `{ id, name, description, instructions, ... }`), `defaultPersona` and other settings. Current IDs: `default` (RSI Agent), `architect`, `explorer`, `debugger`. The result is cached for the life of the module; a failed fetch leaves it `null`.
2. **Selection** is the storage key `REPLOID_PERSONA_ID` (through `getCurrentReploidStorage()`), then `defaultPersona`, then `'default'`.
3. **Overrides** are read from and written to `/.memory/persona-overrides.json` in the VFS as `{ personas: { <id>: { description?, instructions? } }, updatedAt }`.

## Prompt assembly

`getCoreInstructions()` returns the built-in `CORE_INSTRUCTIONS` text, or, when the runtime mode is a minimal lab mode (`isMinimalLabMode` in `self/config/lab-upgrades.js`), the Zero instructions from `buildZeroCoreInstructions` in `self/core/zero-prompt.js`.

`buildSystemPrompt(personaDef, override)` appends:

```text
## PERSONA: <name>
<override.description || description>

## BEHAVIORAL FOCUS
<override.instructions || instructions || 'Focus on continuous improvement.'>
```

`getSystemPrompt()` returns only the core instructions when the config is missing, has no personas, or the selected ID is not found, and on any error.

## Interface

The factory returns `{ getSystemPrompt, getPersonas, getActivePersona, getPromptSlots, applySlotMutation, buildSystemPrompt }`.

- `getPersonas()`: the config's persona list, or `[]`.
- `getActivePersona()`: the selected definition with overrides applied, or `null`.
- `getPromptSlots(personaId?)`: `{ coreInstructions, personaId, personaName, description, instructions }` for the given or selected persona.
- `applySlotMutation({ personaId, slot, content, mode = 'replace' })`: `slot` must be `description` or `instructions`; `mode` is `replace`, `append` or `prepend`. Writes the overrides file and emits `persona:overrides_updated` with `{ updatedAt }`. Returns `{ personaId, slot, content }`.

There is no API to change the selected persona; the boot UI or the operator sets `REPLOID_PERSONA_ID`.

## Authority

A persona override changes the prompt of later runs. `self/capabilities/cognition/gepa-optimizer.js:365-373` calls `applySlotMutation` after a GEPA candidate is promoted with `applyToPersona`, and the `RunGEPA` tool accepts that option from its arguments. Under [INTENT.md](../../INTENT.md), an optimizer score does not grant adoption: applying a candidate to a persona must be an operator decision. This module does not check who asked, so the gate belongs to the caller and the tool permission path ([0x000049](0x000049-hitl-controller.md)).

## Boundaries and gaps

- The config is cached after the first fetch; edits to it need a reload.
- Overrides are not versioned; a replace loses the previous text unless it was captured elsewhere (GEPA keeps its own prompt history).
- `getSystemPrompt` reads overrides for the selected persona only.

## Verification

`tests/unit/persona-manager.test.js` covers the module.

## Related blueprints

- [0x000001 System Prompt Architecture](0x000001-system-prompt-architecture.md): where the prompt sits in the cycle.
- [0x000067 GEPA Prompt Evolution](0x000067-gepa-prompt-evolution.md): reads slots and may write overrides.
- [0x000008 Agent Cognitive Cycle](0x000008-agent-cognitive-cycle.md): consumer of the prompt.
