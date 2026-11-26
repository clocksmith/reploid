# Tabula Rasa Runtime

**Classification:** Index & Meta Contract

Reploid starts from a small live context and reads blueprints only when the current objective needs them. The [Zero kernel prompt](../prompts/kernel.md) is the model-facing authority for these rules; this contract restates them and records what the host actually loads.

## Runtime Rules

- Start from VFS discovery: read or list `/` before assuming a named path exists.
- Treat `/config/genesis-levels.json` as the compact runtime and module descriptor. Zero and X images seed it. The Reploid self runtime seed prefixes do not include it; there the generated self descriptor in the first message plays that role.
- Treat `/blueprint-index.json` as the map to architecture knowledge when discovery shows it exists. If it is absent, list `/blueprints` and continue from the contracts that are present.
- Do not invent `/self/self.json` or `/self/manifest.json` as tool paths. `/self/self.json` is not a seeded source file: on the Reploid self runtime the host generates it at boot (`buildSelfFiles` in [`self/manifest.js`](../manifest.js)) and passes its content in the first message.
- Read active blueprints before architecture, boot, prompt, tool, or promotion changes.
- Read lazy blueprints only when their tags or summary match the objective.
- Write candidate changes under `/shadow`.
- Write evidence under `/artifacts`.
- Do not write active runtime changes directly to `/self`. See [`promotion-contract.md`](promotion-contract.md) for the durable change paths, including the Zero `CreateTool` exception.

## First Context

What the first model context contains depends on the route.

| Surface | What the host seeds and sends | Source |
| --- | --- | --- |
| Reploid self runtime (`reploid_home` and `substrate_console` boot profiles) | The VFS seed includes `blueprint-index.json`, `prompts/kernel.md` and four blueprints: `tabula-rasa-runtime.md`, `blueprint-index-contract.md`, `tool-contract.md`, `promotion-contract.md`. The first message contains the generated `/self/self.json`, then `/self/blueprint-index.json`, `/self/prompts/kernel.md` and those same four blueprints. | `REPLOID_MINIMAL_HOME_BOOT_SEED_PREFIXES` in [`self/config/boot-seed.js`](../config/boot-seed.js); `SELF_BLUEPRINT_PATHS` in [`self/manifest.js`](../manifest.js); `initialContext` in [`self/runtime.js`](../runtime.js) |
| Zero and X (`zero_home`, `x_home`) | The seed is the selected self-source image from `shared/config/self-source-catalog.json`. Every level includes `config/genesis-levels.json` and `prompts/kernel.md`; no level seeds blueprints, which is why the kernel treats the index as optional. | `getBootSourceManifest` and `pickBootSeedFiles` in [`self/config/boot-seed.js`](../config/boot-seed.js) |

The `active` list in [`self/blueprint-index.json`](../blueprint-index.json) names three contracts (`tabula-rasa-runtime`, `blueprint-index-contract`, `tool-contract`). It does not select the boot set: `promotion-contract.md` is also seeded and sent on the Reploid self runtime, through the lists cited above.

Everything else is discovered with `ReadFile` or listing tools.

*Last updated: November 2026*
