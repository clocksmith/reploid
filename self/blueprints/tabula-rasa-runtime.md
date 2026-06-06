# Tabula Rasa Runtime

Reploid starts from a small live context and reads blueprints only when the current objective needs them.

## Runtime Rules

- Treat `/self/self.json` as the compact runtime descriptor.
- Treat `/self/blueprint-index.json` as the map to architecture knowledge.
- Read active blueprints before architecture changes.
- Read lazy blueprints only when their tags or summary match the objective.
- Write candidate changes under `/shadow`.
- Write evidence under `/artifacts`.
- Do not write active runtime changes directly to `/self`.

## First Context

The first model context should contain:

- `/self/self.json`
- `/self/blueprint-index.json`
- `/self/prompts/kernel.md`
- active blueprint contracts listed in the index

Everything else is discovered by `ReadFile`.

*Last updated: June 2026*
