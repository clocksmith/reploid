# Tool Contract

**Classification:** Index & Meta Contract

The tabula-rasa runtime exposes a small primitive tool surface.

The [Zero kernel prompt](../prompts/kernel.md#primitive-tools) owns the primitive tool table.
The executable allowlist is [`shared/config/tool-surfaces.js`](../../shared/config/tool-surfaces.js), served at `/config/tool-surfaces.js`. Zero and X at the `spark` level expose only `CreateTool`; the Reploid surface and X at `reflection` or higher add the `promotion` surface (`Promote`).

`CreateTool` has two behaviors, chosen by `isMinimalLabMode` in [`self/config/lab-upgrades.js`](../config/lab-upgrades.js) (Zero or X at the `spark` level):

- **Minimal Zero/X:** `CreateTool` is the complete new-tool path and does not call `Promote`. It stages source under `/shadow/tools`, requires static Verification Worker approval of the exact bytes, executes the declared activation checks, re-imports and replays them in a fresh fixture harness, requires matching transcripts, installs the tool at `/self/tools/<Name>.js`, loads it into the runtime, and writes activation evidence under `/artifacts`. It installs only a new file: a target that already exists, or that `defaultAllowTargetPath` rejects, fails with "requires promotion", and a validator target is quarantined instead of installed (`activateZeroTool` in [`self/core/create-tool.js`](../core/create-tool.js)).
- **Every other surface:** `CreateTool` only stages the candidate under `/shadow/tools` and emits `tool:candidate_created`. Installing it under `/self` goes through `Promote` ([`promotion-contract.md`](promotion-contract.md)).

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

*Last updated: November 2026*
