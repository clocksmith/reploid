# REPLOID

[![Test Suite](https://img.shields.io/github/actions/workflow/status/clocksmith/reploid/test.yml?branch=main&label=tests)](https://github.com/clocksmith/reploid/actions/workflows/test.yml)
[![License metadata: MIT](https://img.shields.io/badge/license%20metadata-MIT-blue.svg)](package.json)

Reploid is a browser runtime family for receipt-backed, self-modifying agents.
Everything runs client-side; agent behavior stays in visible self files, prompts,
blueprints, traces, and receipts, never on a server.

It ships as **three distinct surfaces** — Poolday, Zero, and X — each with its own
route, boot profile, and tool set. They are separate products with separate
authority: a capability supported on one surface is **not** implied on another.
Every support claim is machine-checked in the
[surface claim index](docs/status/surface-claim-index.json); read each row by its
declared boundary and status.

## Surfaces

| Surface | Route | What it is | Boundary |
| --- | --- | --- | --- |
| **Poolday** | `/` | The root UI: receipt-backed browser inference under the internal Poolday pool contract. ("Poolday" is the internal/docs name; the public UI remains Reploid.) | Browser inference backed by signed records, audits, reputation, policy, and deterministic comparison — not trustless compute, hardware attestation, or guaranteed honest browser/GPU execution. |
| **Zero** | `/zero` | Minimal agent surface that begins from `CreateTool`, with no pool dependency. | Standalone; requires no inference pool. |
| **X** | `/x` | Mature agent surface with workers, memory, peer slots, verification, and self-modification (Seed → Shadow → Promote). | Self-modification, swarm, validation, and promotion evidence stay separate from Poolday inference records. |

The [Zero and X intent contract](self/config/surface-intents.js) defines their routes,
boot profiles, modules, and tool surfaces. The root Poolday path is owned separately by
the [product boot modes](self/config/boot-modes.js),
[pool config](self/pool/pool-config.json), and
[pool claim boundary](docs/poolday/claims-and-nonclaims.md).

### X self-modification states

The agent modes that expose `Promote` (the X surface) move through Seed, Shadow, and
Promote. Seed creates the recoverable self, Shadow stages candidate changes, and
Promote writes an allowlisted candidate into the live self only after its evidence passes.

| State | File mutation | Evidence | Activation boundary |
| --- | --- | --- | --- |
| Seed | Writes the recoverable identity, prompt, tools, VFS, objective, and Blueprint `0x000112`. | Boot manifest. | Establishes the self that can be restored. |
| Shadow | Writes candidates under `/shadow`; the active `/self` stays unchanged. | RGR traces, scores, receipts, and rollback paths under `/artifacts/rgr`. | Candidate code remains provisional. |
| Promote | Copies an allowlisted candidate from `/shadow` into `/self`. | Anchored gate result, replay result, and candidate hash. | Changes `/self`; validator mutations enter quarantine instead. |

## Quick start

```bash
npm install
npm start
```

Open `http://localhost:8000`. For the managed Gemini path, set `GEMINI_API_KEY` in `.env` before starting.

## Self contract

Awaken clears prior live VFS state, writes the generated self manifests, exposes canonical source through a copy-on-write `/self` overlay, mounts Capsule, and starts the runtime.

The generated [VFS manifest](self/config/vfs-manifest.json) enumerates seeded files. The executable [tool-surface contract](self/config/tool-surfaces.js) enumerates tool membership. The [RGR runtime contract](self/blueprints/rgr-runtime-contract.md) defines candidate evidence, anchors, quarantine, rollback, and promotion.

## Remote execution

The [surface claim index](docs/status/surface-claim-index.json) owns these status lines and their evidence paths:

| Index row | Current boundary |
| --- | --- |
| `local-execution` | A configured local executor runs slots in the current browser. |
| `peer-slot-placement` | Opted-in slots may run on joined peers; enabling slots does not expose local inference unless this browser has an executor. |
| `browser-provider-roles` | Browser requester and provider clients exchange assignments, outputs, and receipts through peer rooms. |
| `signaling` | Same-browser rooms can use `BroadcastChannel`; cross-host WebRTC uses signaling for rendezvous. |
| `sealed-credentials` | `npm start` can build sealed access windows; client artifacts omit the plaintext key and the operator codebook stays ignored under `.reploid-cloud/`. |
| `public-mesh` | Blocked as a signaling-free claim while cross-host rendezvous still requires signaling. |

Users can bypass the managed access-window path and supply their own browser inference.

## Start here

| Reader | Entry points |
| --- | --- |
| Operators | [Quick start](docs/QUICK-START.md), [configuration](docs/CONFIGURATION.md), and [local models](docs/local-models.md) |
| Agent and runtime contributors | [System architecture](docs/system-architecture.md), [RGR runtime contract](self/blueprints/rgr-runtime-contract.md), and [tool surfaces](self/config/tool-surfaces.js) |
| Security and claim reviewers | [Security model](docs/SECURITY.md), [surface claim index](docs/status/surface-claim-index.json), [Poolday claims](docs/poolday/claims-and-nonclaims.md), and [threat model](docs/poolday/threat-model.md) |
| Inference integrators | [Browser inference pool](docs/browser-inference-pool.md), [receipt schema](docs/poolday/receipt-schema.md), and [Doppler](https://github.com/clocksmith/doppler) |

The [documentation index](docs/INDEX.md) owns the complete architecture, blueprint, API, and operator inventory.

## License

License metadata is in `package.json` (license: MIT). This repository does not currently include a standalone `LICENSE` file.
