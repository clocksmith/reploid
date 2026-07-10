# Tool Contract

The tabula-rasa runtime exposes a small primitive tool surface.

| Tool | Purpose |
|------|---------|
| `ReadFile` | Read self descriptor, index, blueprints, shadow candidates, and artifacts. |
| `WriteFile` | Write candidates under `/shadow` and evidence under `/artifacts`. |
| `CreateTool` | Create, install, and load a new runtime tool. |
| `LoadModule` | Reload an approved module from `/self`. |

In Zero, `CreateTool` is the complete new-tool path. It stages source under `/shadow/tools`, executes declared activation checks, re-imports and replays them in a fresh fixture harness, requires matching transcripts, installs the tool under `/self/tools`, loads it into the runtime, and writes derived activation evidence under `/artifacts`. Broader Reploid/X surfaces may expose a separate `Promote` tool for evidence-gated self changes.

Every auto-activated Zero tool declares at least one bounded check:

```javascript
export const tool = {
  name: 'ExampleTool',
  activation: {
    fixtures: {
      vfs: { '/activation/input.txt': 'fixture input' }
    },
    checks: [{
      name: 'reads fixture input',
      args: { path: '/activation/input.txt' },
      expected: { content: 'fixture input' }
    }]
  }
};
```

`expected` object values are matched as subsets. Replay compares the complete result and harness transcript, including VFS state, tool calls, events, audit calls, and loaded tools. Failed validation, activation, replay, installation, or runtime loading writes rejection evidence. If installation started, CreateTool unloads the runtime tool and removes the target, then records the observed cleanup state. A cleanup failure leaves the actual loaded and retained-target state in the evidence instead of claiming rollback succeeded.

*Last updated: July 2026*
