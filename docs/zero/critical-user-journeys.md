# Zero Critical User Journeys

Zero is the minimal research agent at `/zero`. Its canonical status registry is
[`../status/zero-critical-user-journeys.json`](../status/zero-critical-user-journeys.json).
Zero starts with exactly `CreateTool`; it does not inherit X's file, promotion,
worker, cognition, optimization, or swarm tools.

## Current journey status

| Journey | Status | Honest outcome |
| --- | --- | --- |
| Configure and awaken | Conditional | The operator can choose managed proxy or local Doppler inference, set an objective and cycle interval, and awaken when configuration is complete. |
| Run and observe a cycle | Conditional | The UI shows model input/output, tool runs, state, cycles, tokens, and failures while a compatible provider responds. |
| Grow the tool surface | Conditional | CreateTool can fixture-test, replay, install, load, and use a new tool when the model authors a valid contract. |
| Apply a self-modification | Conditional | A created `self:write` tool can preserve rollback evidence and patch live tools, UI, or mirrored core code. |
| Steer and stop | Limited | The operator can queue a note and stop or cancel retry, but cannot resume from the Zero shell. |
| Inspect and recover evidence | Limited | VFS files persist locally, but Zero has no built-in VFS browser, export, replay, or automatic created-tool recovery proof. |
| Prove actual local RSI | Conditional | An opt-in hardware lane executes real Doppler cognition, but it is skipped by default and uses a supplied target transcript. |

## Critical boundary

CreateTool activation executes declared fixtures, re-imports the candidate in a
fresh harness, replays the fixtures, and requires matching transcripts. That is
meaningful evidence for the declared activation behavior. It is not an
independent security review, a complete regression suite, or proof that the
tool works on held-out inputs.

Zero does not expose `Promote`. The current self-modification proof creates and
activates a capability-bearing `self:write` tool, which can write live mirrored
paths and trigger reload. This is a real behavior, not merely a proposed
architecture. The registry therefore tracks an explicit P0 authority task for
high-impact writes instead of describing Zero as if it shared X's promotion
gate.

## Release standard

The deterministic browser tests prove boot, tool growth, cycle artifacts, VFS
persistence, and live self-patching. Most use mock cognition or direct tool
driving. The actual Doppler test is opt-in and no immutable deployed run is
currently linked. Zero remains conditional until an artifact binds deployment,
model, provider, cycles, mutations, visible result, and final verdict.

Remaining work belongs only in the registry's `openWork` collection. Narrative
docs and blueprint checklists do not own current journey status.
