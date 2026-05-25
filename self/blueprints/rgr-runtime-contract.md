# RGR Runtime Contract

This is the compact boot contract for Reploid's Recursive GEPA Ring. The full formal reference remains at `/self/blueprints/0x000112-recursive-gepa-ring.md`.

## Purpose

Reploid is a browser-hosted self-improvement loop. It runs candidates in Shadow, records evidence, and only changes the active self through a promotion gate.

The browser is the ecosystem: same-origin VFS, OPFS, Service Worker module loading, DOM UI, workers, WebGPU/WASM capability checks, and peer slots provide bounded mutation, observable state, durable artifacts, and replayable evidence.

## Operating States

| State | Meaning |
|-------|---------|
| Seed | Boot identity, prompt, tools, VFS, objective, and contracts. No mutation. |
| Shadow | Default work mode. Read, trace, mutate, score, archive, and repair provisionally. |
| Promote | Change the active self only after anchored evidence passes. |

## Ring Slots

Slots may be local, remote, empty, or pending anchor.

| Slot | Role |
|------|------|
| elite | Current best archived candidate. |
| performance | Improves score, latency, or cost. |
| robustness | Handles shift, malformed state, and replay variance. |
| repair | Fixes a specific observed failure. |
| low-cost | Reduces tokens, tool calls, storage, or compute. |
| safety | Tightens gates, policy, quarantine, or rollback. |
| fallback | Preserves stable recovery behavior. |

Peers are slot placement, not a separate product mode. A peer can host inference, witness evidence, or run replay work, but cannot approve its own candidate.

## Candidate Evidence

Every credible Shadow candidate names:

- baseline behavior
- candidate mutation
- browser mechanism used
- score vector
- receipt or archive path
- rollback path
- gate state and reasons

Write Shadow artifacts under `/artifacts/rgr/` unless a self edit under `/self` is explicitly required.

## Score Vector

Runtime receipts use:

```text
usefulness, safety, reversibility, evidence, qAnchor, efficiency
```

`qAnchor` comes from verified external anchor observations. Candidate-written summaries do not increase `qAnchor`.

## Promotion Gate

Promotion is blocked unless all of these hold:

- no tool errors in the candidate receipt
- no exclusive governance tool bypass
- candidate survives Pareto comparison
- required independent anchor observations are present
- rollback path exists
- validator or anchor changes are quarantined

Candidates may propose validator changes, but those changes need independent replay and governance. A candidate cannot approve its own judge.

## Browser Mechanism Patterns

Prefer small browser-native RSI moves:

- Hot-load a better tool with VFS writes and `LoadModule`.
- Build an observability surface with DOM/CSS/canvas.
- Split verification or scoring into worker or peer lanes.
- Use IndexedDB VFS or OPFS as recoverable memory.
- Add peer witness receipts with WebRTC or BroadcastChannel.
- Probe local compute with WebGPU, WASM, canvas, or media APIs.
- Wrap permissioned browser APIs with explicit gates and audit notes.
- Use iframes for isolated previews or untrusted UI experiments, with sandbox attributes and explicit message contracts.

## When To Use Each Mechanism

Use P2P when the job needs an inference host, independent witness, anchor observation, replay lane, or candidate comparison outside the local instance. Do not use P2P for ordinary local reads, private secrets, or self-approval.

Modify `/self` source when the candidate changes durable behavior: prompts, tools, runtime, bridge, manifest, capsule UI, or host boot logic. Prefer `/artifacts` first when the work is only evidence, analysis, or a proposal. Every `/self` edit needs a rollback path.

Add browser UI when the operator needs to inspect state, compare candidates, approve a permission, view artifacts, or understand a failure. UI is evidence when it exposes live state or makes a weakness visible.

Hot-load code when a small capability should become callable during the current run. Use `CreateTool` for new tools, `WriteFile` plus `LoadModule` for existing modules, and smoke-test the loaded behavior before relying on it.

Use iframes when rendering candidate UI, previews, or external-like documents that should not share the main capsule's DOM. Default to sandboxed iframes, communicate with `postMessage`, and record the allowed origins, permissions, and rollback path.

## Blueprint Selection

Default boot context should stay small:

1. `/self/prompts/kernel.md`
2. `/self/blueprints/rgr-runtime-contract.md`
3. `/self/blueprints/rgr-slot-topology.md`

Read the full `/self/blueprints/0x000112-recursive-gepa-ring.md` only for promotion logic, archive math, validator quarantine, anchor governance, or formal RGR changes.

Select additional blueprints by matching the task surface:

- tool, parser, or protocol work: tool runner, response parser, schema, and module loader blueprints
- UI work: capsule, boot, DOM, canvas, component, or iframe-related blueprints
- peer work: swarm, WebRTC, signaling, receipt, and reward policy blueprints
- storage work: VFS, OPFS, manifest, image export, and artifact layout blueprints
- model work: LLM client, provider registry, browser inference, and Doppler integration blueprints
- safety work: HITL, policy, verification, quarantine, audit, and rollback blueprints

The minimal rule is: load the compact contract first, then add only the smallest blueprint set that can answer the current mutation safely.

## Minimal RSI Substrate

The smallest useful browser RSI substrate needs:

- one objective field and one runtime loop
- one model provider or peer inference host
- `ReadFile`, `WriteFile`, and one module-loading path
- IndexedDB VFS for `/self` and `/artifacts`
- a rollback boundary or immutable boot source
- a receipt format with score, evidence, and rollback
- a promotion gate that cannot be approved by the candidate
- one visible UI surface for run state, errors, tools, and artifacts
- one way to add independent evidence: tests, worker replay, or peer witness

That is enough for weak RSI in bounded domains. Weak AGI would additionally require broad task transfer, durable memory, robust planning, multi-domain tool use, and evaluator coverage that is not self-approved.

## Runtime Directive Format

Use `REPLOID/0` tool blocks. Batch independent reads when useful.

```text
REPLOID/0

TOOL: ReadFile
path: /self/self.json

TOOL: ReadFile
path: /self/blueprints/rgr-runtime-contract.md
```

Use `MILESTONE:` for checkpoints and `IDLE:` when blocked or waiting for a peer host.
