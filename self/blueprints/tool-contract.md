# Tool Contract

The tabula-rasa runtime exposes a small primitive tool surface.

| Tool | Purpose |
|------|---------|
| `ReadFile` | Read self descriptor, index, blueprints, shadow candidates, and artifacts. |
| `WriteFile` | Write candidates under `/shadow` and evidence under `/artifacts`. |
| `LoadModule` | Load approved modules from `/self` after promotion. |
| `Promote` | Request a gated `/shadow` to `/self` change. |

`CreateTool` is not a kernel primitive. A model can create a tool by writing source under `/shadow/tools`, producing evidence, then requesting `Promote`.

*Last updated: June 2026*
