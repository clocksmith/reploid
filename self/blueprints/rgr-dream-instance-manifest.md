# RGR Dream Instance Manifest Blueprint

**Classification:** Index & Meta Contract

Purpose: Let the Reploid self manifest Dream as a browser-governed instance without merging Dream's runtime contract into Reploid's core loop.

Core invariant:

```text
Dream instances are manifested and governed by Reploid, but Dream receipts, traces, gates, and model-family locks remain authoritative.
```

## Shape

| Layer | Responsibility |
|-------|----------------|
| Boot | Declare the instance path and source in `instances` of [`self/boot-spec.js`](../boot-spec.js). No default boot path writes the manifest today: nothing calls `buildDreamInstanceFiles`, which the 2026-10-15 cleanup in [`deduplication-audit.md`](deduplication-audit.md) records as deliberate. |
| Runtime | Expose the Dream instance as a Shadow-governed ecosystem target, not a promoted self change. |
| Bridge | Provide VFS, OPFS, local host, remote host, and receipt primitives for queues and eval artifacts. |
| Dream instance | Describe stages, queues, gates, artifacts, and promotion anchors. |
| Promotion gate | Require evidence from Dream validators, trainer acceptance, gates or benchmarks, locks, lineage, and verification receipts, then operator adoption. Evidence makes a candidate eligible; it never activates it. |

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
- Keep all Dream candidates in Shadow until promotion anchors pass and the operator adopts them ([`promotion-contract.md`](promotion-contract.md)).

## Dream Responsibilities

- Keep the runtime boundary ordered as Composition Graph to Effects Graph to policy check to receipt-bound dispatch.
- Keep teacher labels incomplete until validation, export, trainer acceptance, retraining, gate or benchmark, lock refresh, lineage, and verification pass.
- Keep model-family locks, asset-map hashes, and lineage append-only evidence authoritative.
- Reject unanchored self-training where the same candidate mutates and approves its own evaluator.

## Boot Rule

Lab boot remains compact. It may show that a Dream instance will be manifested, but it must not expose Dream as a separate product mode. Reploid stays the browser RGR orchestrator. Dream appears as a governed instance inside the awakened self.

## Read Order

When working on Dream orchestration, read these first:

The self descriptor is the generated `/self/self.json` content in the first message, not a file to look up; the instance manifest exists only after a caller writes it with `buildDreamInstanceFiles` ([`self/dream-instance.js`](../dream-instance.js)).

```text
/self/instances/dream/default.instance.json
/self/blueprints/rgr-dream-instance-manifest.md
/self/blueprints/rgr-runtime-contract.md
/self/blueprints/0x00007F-recursive-gepa-ring.md
/self/blueprints/rgr-slot-topology.md
```

*Last updated: November 2026*
