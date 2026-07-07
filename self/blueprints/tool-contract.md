# Tool Contract

The tabula-rasa runtime exposes a small primitive tool surface.

| Tool | Purpose |
|------|---------|
| `ReadFile` | Read self descriptor, index, blueprints, shadow candidates, and artifacts. |
| `WriteFile` | Write candidates under `/shadow` and evidence under `/artifacts`. |
| `CreateTool` | Create, install, and load a new runtime tool. |
| `LoadModule` | Reload an approved module from `/self`. |

In Zero, `CreateTool` is the complete new-tool path: it stages source under `/shadow/tools`, writes activation evidence under `/artifacts`, installs the tool under `/self/tools`, and loads it into the runtime. Broader Reploid/X surfaces may expose a separate `Promote` tool for evidence-gated self changes.

*Last updated: July 2026*
