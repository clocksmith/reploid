# REPLOID

[![Test Suite](https://img.shields.io/github/actions/workflow/status/clocksmith/reploid/test.yml?branch=main&label=tests)](https://github.com/clocksmith/reploid/actions/workflows/test.yml)
[![License metadata: MIT](https://img.shields.io/badge/license%20metadata-MIT-blue.svg)](package.json)

Reploid is a browser runtime family. Its self-modifying agent modes use Seed,
Shadow, and Promote. Seed creates the recoverable self. Shadow stages candidate
changes. Promote writes an allowlisted candidate into the live self only after
its evidence passes. Zero starts from `CreateTool`; the root Reploid UI runs
receipt-backed browser inference under the internal Poolday contract.

The agent modes that expose `Promote` use these states:

| State | File mutation | Evidence | Activation boundary |
| --- | --- | --- | --- |
| Seed | Writes the recoverable identity, prompt, tools, VFS, objective, and Blueprint `0x000112`. | Boot manifest. | Establishes the self that can be restored. |
| Shadow | Writes candidates under `/shadow`; the active `/self` stays unchanged. | RGR traces, scores, receipts, and rollback paths under `/artifacts/rgr`. | Candidate code remains provisional. |
| Promote | Copies an allowlisted candidate from `/shadow` into `/self`. | Anchored gate result, replay result, and candidate hash. | Changes `/self`; validator mutations enter quarantine instead. |

## Surfaces

| Name | Role and boundary |
| --- | --- |
| Reploid | Public family name and shared browser substrate. |
| Poolday | Internal/docs name for the model-serving pool at `/`; the public UI remains Reploid. |
| X | Mature agent surface at `/x` with workers, memory, peer slots, verification, and promotion. |
| Zero | Minimal agent surface at `/zero`; it begins with `CreateTool` and has no pool dependency. |

The [Zero and X intent contract](self/config/surface-intents.js) owns their routes, boot profiles, modules, and tool surfaces. The root Poolday path is owned separately by the [product boot modes](self/config/boot-modes.js), [pool config](self/pool/pool-config.json), and [pool claim boundary](docs/poolday/claims-and-nonclaims.md). Current support claims resolve to the machine-checked [surface claim index](docs/status/surface-claim-index.json).

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:8000`. For the managed Gemini path, set `GEMINI_API_KEY` in `.env` before starting.

## Self Contract

Awaken clears prior live VFS state, writes the generated self manifests, exposes canonical source through a copy-on-write `/self` overlay, mounts Capsule, and starts the runtime. Reploid-owned behavior stays in visible self files, prompts, blueprints, traces, and receipts.

The generated [VFS manifest](self/config/vfs-manifest.json) enumerates seeded files. The executable [tool-surface contract](self/config/tool-surfaces.js) enumerates tool membership. The [RGR runtime contract](self/blueprints/rgr-runtime-contract.md) defines candidate evidence, anchors, quarantine, rollback, and promotion.

## Remote Execution

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

The [documentation index](docs/INDEX.md) owns the complete architecture,
blueprint, API, and operator inventory.

## License

`package.json` declares MIT. This repository does not currently include a
standalone `LICENSE` file.

*Last updated: July 2026*
