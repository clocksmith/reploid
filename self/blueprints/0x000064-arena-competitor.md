# Blueprint 0x000064: Arena Competitor

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/testing/arena/competitor.js`

**Planned Artifacts:** None

**Owned Source Files:** `testing/arena/competitor.js`

**Former Blueprint Paths:** `self/blueprints/0x000064-arena-competitor.md`
**Module:** `ArenaCompetitor` (version 1.0.0, type `utility`)
**File:** `self/testing/arena/competitor.js`
**Genesis level:** `full` (`self/config/genesis-levels.json`)
**Dependencies:** `LLMClient`, `Utils`
**Purpose:** Wrap one model configuration as an Arena competitor that returns a proposal with timing and an approximate token count.

## Contract

A competitor is a model call, not an agent instance. It has no VFS sandbox, no `AgentLoop`, no `run(challenge)` and no `cleanup()`. Sandboxing and verification belong to the harness ([0x000066](0x000066-arena-harness.md)).

`createCompetitor(config)` (`competitor.js:28-79`) takes `{ name, modelConfig, systemPrompt, temperature = 0.7 }`. The default system prompt is "You are a code assistant. Output only the modified code." The returned object has `name`, `modelConfig` (with `temperature` merged in) and one method:

`propose(task, context)` (`:46-77`) sends a system message and a user message (`task`, then `## Context`, then `context`) through `LLMClient.chat(messages, modelConfig)` and returns:

| Field | Meaning |
| --- | --- |
| `competitorName` | `config.name` |
| `solution` | `response.content` |
| `tokenCount` | `ceil(length / 4)` of `response.raw` or `response.content`; an estimate, not a provider count |
| `executionMs` | Wall time of the call |
| `model`, `provider` | `modelConfig.id`, `modelConfig.provider` |

Errors are logged and rethrown; the harness records them as `ERROR` results.

## Exports

| Export | Line | Behavior |
| --- | --- | --- |
| `createCompetitor(config)` | 28 | One competitor. |
| `createCompetitors(configs)` | 86 | `configs.map(createCompetitor)`. |

The module emits no events.

## Related blueprints

- [0x000066 Arena Harness](0x000066-arena-harness.md): runs proposals and verification.
- [0x000065 Arena Metrics](0x000065-arena-metrics.md): result records and ranking.
- [0x000058 Browser-Native Multi-Model Arena](0x000058-browser-native-paxos.md): the broader Arena design.
