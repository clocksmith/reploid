# RGR Dream Instance Manifest Blueprint

Purpose: Let the Reploid self manifest Dream as a browser-governed instance without merging Dream's runtime contract into Reploid's core loop.

Core invariant:

```text
Dream instances are manifested and governed by Reploid, but Dream receipts, traces, gates, and model-family locks remain authoritative.
```

## Shape

| Layer | Responsibility |
|-------|----------------|
| Boot | Seed `/self/instances/dream/default.instance.json` beside `/self/self.json`. |
| Runtime | Expose the Dream instance as a Shadow-governed ecosystem target, not a promoted self change. |
| Bridge | Provide VFS, OPFS, local host, remote host, and receipt primitives for queues and eval artifacts. |
| Dream instance | Describe stages, queues, gates, artifacts, and promotion anchors. |
| Promotion gate | Require evidence from Dream validators, trainer acceptance, gates or benchmarks, locks, lineage, and verification receipts. |

## Instance Path

```text
/self/instances/dream/default.instance.json
```

The source that builds the manifest lives at:

```text
/self/dream-instance.js
```

## Browser Responsibilities

- Hold Dream instance manifests in the VFS.
- Store larger queues, checkpoints, eval summaries, and receipts under `/artifacts/dream` or `opfs:/artifacts/dream`.
- Route teacher, adjudicator, evaluator, witness, and training lanes through local or remote RGR slots.
- Keep all Dream candidates in Shadow until promotion anchors pass.

## Dream Responsibilities

- Keep the runtime boundary ordered as Composition Graph to Effects Graph to policy check to receipt-bound dispatch.
- Keep teacher labels incomplete until validation, export, trainer acceptance, retraining, gate or benchmark, lock refresh, lineage, and verification pass.
- Keep model-family locks, asset-map hashes, and lineage append-only evidence authoritative.
- Reject unanchored self-training where the same candidate mutates and approves its own evaluator.

## Boot Rule

Root boot remains compact. It may show that a Dream instance will be manifested, but it must not expose Dream as a separate product mode. Reploid stays the browser RGR orchestrator. Dream appears as a governed instance inside the awakened self.

## Read Order

When working on Dream orchestration, read these first:

```text
/self/self.json
/self/instances/dream/default.instance.json
/self/blueprints/rgr-dream-instance-manifest.md
/self/blueprints/rgr-runtime-contract.md
/self/blueprints/0x000112-recursive-gepa-ring.md
/self/blueprints/rgr-slot-topology.md
```

*Last updated: May 2026*
