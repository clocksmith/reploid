# RGR Slot Topology Support Blueprint

Purpose: Keep peer transport as optional slot placement for Blueprint `0x000112`, not a separate operating model.

Core invariant:

```text
Ring slots can be local or remote.
```

## Shape

| Layer | Responsibility |
|-------|----------------|
| Kernel | Serve `/`, install route globals, load the host seed entry. |
| Boot UI | Collect objective, executor state, slot topology, and awaken. |
| Runtime | Maintain Seed, Shadow, and Promote state, context, directive parsing, tool execution, and parking. |
| Bridge | Expose files, tools, local generation, and remote peer generation. |
| Swarm | Advertise local executors and remote slot capacity, route generation requests, stream results. |
| Capsule | Render current state, transcript, peer status, and basic controls. |
| Blueprints | Carry Blueprint `0x000112`, slot topology notes, prompts, traces, receipts, and improvement plans. |

## Root Route Policy

- `/` is the product path.
- `/0` and `/x` remain lab paths.
- Root boot must stay compact: identity, executor state, ring topology, objective, awaken.
- Root boot must not require local inference. Remote slots are a valid awaken state.
- Root boot must not expose dashboards, arenas, GEPA, or full VFS controls by default.
- Root boot must expose RGR as the core use case.

## Operating States

| State | Behavior |
|-------|----------|
| `Seed` | Load identity, prompt, tools, VFS, objective, and Blueprint `0x000112`. No mutation. No promotion. |
| `Shadow` | Run the RGR loop provisionally: execute, trace, reflect, mutate, score, archive. |
| `Promote` | Change the active self only after the anchored promotion gate passes. |

Candidate rings, anchor gates, validators, and promotion checks are phases inside the loop. They are not user-selectable peer modes.

## Slot Topology

| Topology | Slot placement | Behavior |
|----------|----------------|----------|
| `local` | all runnable slots local | One browser executes the ring when local inference is available. |
| `peer-assisted` | local and remote slots | Peers may execute candidate slots or contribute anchor observations. |
| `remote-wait` | remote slots pending | The browser parks until a remote host can run a requested slot. |
| `empty` | no runnable slots | Seed remains loaded, but Shadow cannot advance. |

The archive format, score vector, lineage, validator quarantine, and merge rule stay identical in every topology.

## Self-Improvement Loop

1. Read `/self/self.json`.
2. Read `/self/prompts/kernel.md`.
3. Read `/self/blueprints/0x000112-recursive-gepa-ring.md`.
4. Read this support blueprint.
5. Enter Shadow unless the user explicitly asks for promotion.
6. Choose the smallest reversible prompt, blueprint, trace, receipt, artifact, or self edit that advances the objective.
7. Use `ReadFile` before `WriteFile`.
8. Write blueprints, prompts, traces, receipts, or artifacts first when code is not required.
9. Use `CreateTool` only when a reusable capability is missing.
10. Use `MILESTONE:` for verified progress.
11. Use `IDLE:` when blocked or waiting.

An RSI demonstration is valid only when it records:

- baseline
- reversible candidate
- score vector including `Q_anchor`
- receipt or archive path
- rollback path
- gate result and reasons

Feature ideas without this evidence are only ideas, not Shadow RSI results.

## Served Contract

The server must route `/`, `/0`, and `/x` to `self/index.html`.

The root title must identify the served experience as `Reploid`.

The root self manifest must expose:

/self/prompts/kernel.md
/self/blueprints/0x000112-recursive-gepa-ring.md
/self/blueprints/rgr-slot-topology.md

## Promotion Rule

A root route change is valid only if:

- the boot UI still awakens with remote slots and no local inference
- the runtime still receives the kernel prompt, Blueprint `0x000112`, and this support blueprint in bootstrap context
- `ReadFile` can read those files from the awakened self
- `/0` and `/x` still route to their lab modes
- the product model remains: ring slots can be local or remote

*Last updated: May 2026*
