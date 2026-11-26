# RGR Slot Topology Support Blueprint

**Classification:** Index & Meta Contract

Purpose: Keep peer transport as optional slot placement for Blueprint `0x00007F`, not a separate operating model.

Core invariant:

```text
Ring slots can be local or remote.
```

## Shape

| Layer | Responsibility |
|-------|----------------|
| Kernel | On `/zero` and `/x`, install route globals and load the host seed entry. |
| Boot UI | Collect objective, executor state, slot topology, and awaken. |
| Runtime | Maintain Seed, Shadow, and Promote state, context, directive parsing, tool execution, and parking. |
| Bridge | Expose files, tools, local generation, and remote peer generation. |
| Swarm | Advertise local executors and remote slot capacity, route generation requests, stream results. |
| Capsule | Render current state, transcript, peer status, and basic controls. |
| Blueprints | Carry Blueprint `0x00007F`, slot topology notes, prompts, traces, receipts, and improvement plans. |

## Route Policy

- `/` is the Poolday product path. It does not boot the RGR runtime: `server/proxy-static.js` serves it, with the other product routes, from `pool-entry.html` (source `apps/poolday/pool-entry.html`).
- `/zero` and `/x` are the lab paths where the ring runs. `server/proxy-static.js` serves them from the browser-tree `index.html` (source `apps/poolday/index.html`), which imports `/zero/boot.js` on `/zero` and `/kernel/boot.js` otherwise. There is no `self/index.html`.
- Lab boot stays compact: identity, executor state, ring topology, objective, awaken.
- Lab boot must not require local inference. Remote slots are a valid awaken state.
- Lab boot does not expose dashboards, arenas, GEPA, or full VFS controls by default.

## Operating States

| State | Behavior |
|-------|----------|
| `Seed` | Load identity, prompt, tools, VFS, objective, and Blueprint `0x00007F`. No mutation. No promotion. |
| `Shadow` | Run the RGR loop provisionally: execute, trace, reflect, mutate, score, archive. |
| `Promote` | Change the active self only after the anchored promotion gate passes and the operator adopts the candidate ([`rgr-runtime-contract.md`](rgr-runtime-contract.md#promotion-gate)). |

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

1. Use the self descriptor the host provides: `/config/genesis-levels.json` on Zero and X, or the generated `/self/self.json` content in the first message on the Reploid self runtime ([`tabula-rasa-runtime.md`](tabula-rasa-runtime.md)).
2. Read `/self/prompts/kernel.md` if it is not already in context.
3. Read `/self/blueprints/rgr-runtime-contract.md` for boot rules, then `/self/blueprints/0x00007F-recursive-gepa-ring.md` only for formal promotion or archive changes.
4. Read this support blueprint.
5. Enter Shadow. Promotion happens only through the promotion gate and operator adoption.
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

The server routes `/zero` and `/x` to the browser-tree `index.html` and `/` to `pool-entry.html` (`PRODUCT_ROUTES` and `SUBSTRATE_ROUTES` in [`server/proxy-static.js`](../../server/proxy-static.js)). The lab page sets the document title to `Zero` or `X`; product routes use `Reploid`.

The generated self descriptor (`buildSelfManifest` in [`self/manifest.js`](../manifest.js)) lists the kernel prompt under `promptPaths` and these lazy references under `blueprints.lazyReferencePaths`:

```text
/self/blueprints/0x00007F-recursive-gepa-ring.md
/self/blueprints/rgr-runtime-contract.md
/self/blueprints/rgr-slot-topology.md
```

## Promotion Rule

A `/zero` or `/x` route change is valid only if:

- the boot UI still awakens with remote slots and no local inference
- the runtime still receives the kernel prompt in bootstrap context, and on the Reploid self runtime the generated self descriptor still lists Blueprint `0x00007F` and this support blueprint as lazy references
- `ReadFile` can read those files from the awakened self
- the operator adopts the change; a passing check list does not activate it
- `/zero` and `/x` still route to their lab modes
- the product model remains: ring slots can be local or remote

*Last updated: November 2026*
