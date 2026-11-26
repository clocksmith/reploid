# REPLOID Documentation Index

A map of the documentation in the REPLOID project, grouped by area. Each area
lists its contracts first, then designs, then evidence.

| Area | Start with |
| --- | --- |
| [Start here](#start-here) | [Glossary and code map](glossary.md), [quick start](QUICK-START.md) |
| [Product](#product) | [Product contract](product-specification.md), [GOALS.md](../GOALS.md) |
| [Mesh and partitions](#mesh-and-partitions) | [Open mesh architecture](open-mesh-architecture.md), [RD-CANON/1](roadmap/rd-canon-1.md) |
| [Fleet and credits](#fleet-and-credits) | [Fleet service](fleet-service.md), [self-serve accounts](self-serve-credits.md), [native participant](native-participant.md) |
| [Settlement replay](#settlement-replay) | [Settlement replay](settlement-replay.md) |
| [Poolday](#poolday) | [Browser inference pool](browser-inference-pool.md), [Poolday claims](poolday/claims-and-nonclaims.md) |
| [Zero / X](#zero--x) | [X/Zero setup](zero-x-quick-start.md), [agent and VFS architecture](system-architecture.md) |
| [Releases and evidence](#releases-and-evidence) | [Claim index](status/surface-claim-index.json), [release 0.1.5 qualification](../reports/release-015-qualification/README.md) |
| [Operations](#operations) | [Configuration](CONFIGURATION.md), [testing](TESTING.md) |
| [Code organization](#code-organization) | [Ownership inventory](ownership-inventory.md), [component index](component-index.md) |

---

## Start here

[Execution privacy contracts and current limits](execution-privacy.md) · [Confidential execution and the inference API](confidential-execution.md) · [Wire visibility: who can read what](wire-visibility.md).

Start with [concepts, glossary and code map](glossary.md) to distinguish Reploid,
Doppler, WebRTC, WebGPU and the internal Poolday name.
Its three diagrams cover [the overview](glossary.md#1-overview),
[one request](glossary.md#2-one-request), and
[record keeping](glossary.md#3-record-keeping).

1. **[/README.md](../README.md)** - Project overview, quick start, RSI concepts
2. **[docs/QUICK-START.md](./QUICK-START.md)** - Ordinary network conversations, prepared capacity, disclosure and contribution
3. **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Connection modes and boot configuration
4. **[Scoped helpers, private peers, and tool improvement](./work-collaboration.md)** - Compatibility-host tool evaluation and private candidate delivery; separate from public-mesh onboarding
5. **[Concurrent mesh chat MVP](./chat-mvp.md)** - Required conversation, file, adapter, inference and physical-device acceptance boundaries
6. **[P2P development sessions](./p2p-testing.md)** - Tailscale access, persistent terminals, contribution and testing with placeholder connection details

Zero and X setup guides are listed under [Zero / X](#zero--x).

---

## Product

Keep [GOALS.md](../GOALS.md) and [INTENT.md](../INTENT.md) as durable direction.
The public product documents are:

1. [Product contract](product-specification.md) — the terms quotes and receipts bind: service records, Community Access, credits and settlement, answer quality, contribution and disclosure.
2. [Architecture](open-mesh-architecture.md) — components, network participation, execution and recovery.
3. [Four inference routes](product-specification.md#5-contribution-and-execution), [claim index](status/surface-claim-index.json), and [Poolday claims](poolday/claims-and-nonclaims.md) — distinguish route requirements from evidence for specific surfaces.

The business plan, roadmap, acceptance register, economics and planning history
are maintained privately by the owner. The old network-intent path contains
compatibility links only. Retained receipts are supporting evidence, not another
plan, and specialist protocols remain scoped references. Public contract requirements
do not select the active experiment or prove product fit. [GOALS.md](../GOALS.md)
describes the shared-model service boundary; the private plan owns current user,
comparison and evidence selection.

### Vision and contracts
- **[GOALS.md](../GOALS.md)** - Repository mission, value, and durable strategic goals
- **[GOVERNANCE.md](../GOVERNANCE.md)** - Current control of the name, `replo.id` domain, and credit ledger; non-cash mutual service credits; offline receipt verification; and the stewardship review threshold
- **[INTENT.md](../INTENT.md)** - Collective capability, participant control, semantic preservation, and evaluated evolution
- **[CATSCAN.md](../CATSCAN.md)** - Root component purpose, authority, boundaries, and acceptance contract
- **[docs/component-index.md](./component-index.md)** - Generated recursive index of component charters
- **[Ouroboros documentation authority](https://github.com/clocksmith/ouroboros/blob/main/docs/authority/README.md)** - Cross-project record routing; Reploid remains canonical for product and runtime behavior
- **[Network participation and lifecycle](open-mesh-architecture.md#network-participation-and-lifecycle-contracts)** - Prepared execution, contribution, conversations and independently evaluated improvement under the product contract

### Product surfaces
- **[Anonymous shared inference](./public-inference.md)** - Opt-in public endpoint, declared provider/model pairs and its limits
- **[Reploid Daily](./daily-game.md)** - One target answer per circle per day, prompt rules and scoring
- **[docs/multi-model-evaluation.md](./multi-model-evaluation.md)** - Generic LLM evaluation harness, not Poolday promotion evidence
- **[Research and game plugins](./plugin-architecture.md)** - Versioned activity rules, capability ports, persisted sessions, and the model-imitation pilot.

### Change Passport (inactive alternative)
- **[docs/change-passport/product-intent.md](./change-passport/product-intent.md)** - Inactive commercial alternative, independent proof, authority, and claim boundary
- **[docs/change-passport/pilot-charter.md](./change-passport/pilot-charter.md)** - Frozen comparison protocol and external authority boundary
- **[docs/change-passport/pilot-manifest.json](./change-passport/pilot-manifest.json)** - Machine-readable pilot readiness and fail-closed freeze gate
- **[docs/change-passport/runtime-contract.md](./change-passport/runtime-contract.md)** - Hosted storage, authentication, GitHub App, endpoint, and deployment boundary
- [Change Passport documentation charter](./change-passport/CATSCAN.md)

---

## Mesh and partitions

- **[Open mesh architecture](./open-mesh-architecture.md)** - Requested chat experience, discovery, authenticated pieces, automatic placement, Doppler execution, recovery, resource bounds and acceptance requirements; design, not release evidence
- **[Distributed conversation diagrams](./open-mesh-architecture.md#technical-diagrams)** - Component ownership, two-partition generation, and attempt recovery, linked to implementation.
- **[Architecture stabilization](./architecture-stabilization.md)** - Integration baseline, execution ownership, persistence and verification boundaries
- **[Browser library extraction](./browser-library-extraction.md)** - `packages/reploid` as the publishable browser package and what stays in the application

Topology requirements and inherited fixtures: [RD-CANON/1](roadmap/rd-canon-1.md).
Launch 3 source design (off by default): [orchestration](launch-3-orchestration.md).

Typed model operations: [Doppler decisions in Reploid](doppler-choice-scoring.md).

Proposed receipt retention, authorized peer replication and verifiable usage views:
[Mesh record keeping](mesh-records.md). Design only; current credit authority remains unchanged.

- **[Public partition admission](./partition-releases.md)** - When the catalog and public text API admit distributed routes
- **[Fill one stage from an enrolled supplier](./private-stage-prefill.md)** - Receiver-side stage fill with separate supply and compute
- **[Installed Doppler incremental streaming](./capsule-streaming.md)** - Capsule operation request v2 and streamed results
- **[Work completion acceptance](./work-acceptance.md)** - Acceptance contract for completed work, not a qualification claim
- **[docs/archive/reploid-descriptor-peer-orchestration.md](./archive/reploid-descriptor-peer-orchestration.md)** - Archived layer-pipelining research; not the current Poolday execution contract
- **[docs/archive/open-mesh-gap-table-2026-10-01.md](./archive/open-mesh-gap-table-2026-10-01.md)** - Archived 2026-10-01 open-mesh gap table; history, not current status

---

## Fleet and credits

Native computer identity, non-cash credits and placement: [Fleet service](fleet-service.md).

- **[Self-serve accounts and service credits](./self-serve-credits.md)** - Create an account on replo.id, pair a computer by code, earn by serving and spend in the browser

- **[Run a native Reploid participant](./native-participant.md)** - The browser's application host and participant protocol as a native process
- **[GOVERNANCE.md](../GOVERNANCE.md)** - Who controls the credit ledger and the non-cash mutual service credit terms
- Fleet evidence: [native accounting and execution](../reports/fleet-native/20261110/README.md), [browser journey and replay bundles](../reports/fleet-browser/20261110/README.md), [private fleet HTTPS journey and load](../reports/fleet-browser/20261111/README.md)

---

## Settlement replay

Recomputing split charges and stage credits from signed records: [Settlement replay](settlement-replay.md).
Checking one published trade receipt from outside the project: [Verify a trade](verify-a-trade.md).

---

## Poolday

- **[docs/browser-inference-pool.md](./browser-inference-pool.md)** - Current Poolday runtime, peer, coordinator, and deployment contract
- **[docs/poolday/claims-and-nonclaims.md](./poolday/claims-and-nonclaims.md)** - Poolday claim boundary
- **[docs/poolday-ui-architecture.md](./poolday-ui-architecture.md)** - React Poolday UI: the `@reploid/poolday-ui` design system, layers, the checks that keep the UI to its components, and the assessment behind it
- **[docs/poolday-panel-audit.md](./poolday-panel-audit.md)** - Audit of Poolday panels, dialogs and choice controls, and the choice primitives that replaced them
- **[docs/poolday/threat-model.md](./poolday/threat-model.md)** - Poolday adversaries, trust boundaries, and evidence
- **[docs/poolday/receipt-schema.md](./poolday/receipt-schema.md)** - Provider receipts and requester acceptances
- **[docs/poolday/artifact-manifest.md](./poolday/artifact-manifest.md)** - Hugging Face/GCS custody, exact model and adapter identity, and private delivery
- **[docs/poolday/receipt-backed-retrieval.md](./poolday/receipt-backed-retrieval.md)** - Target strategy for receipt-backed embeddings, retrieval, reranking, and vector memory
- **[docs/poolday/document-search.md](./poolday/document-search.md)** - Local document workflow, exact Pack configuration, privacy, and release prerequisites
- **[docs/poolday/complete-pack-jobs.md](./poolday/complete-pack-jobs.md)** - Explicit public operation delegation, bounded recovery, signed streams and archived acceptance
- **[docs/poolday/remote-operations.md](./poolday/remote-operations.md)** - Complete jobs on an exact base model and signed LoRA publication, and reviewed document tasks
- **[docs/poolday/biological-sequence-lane.md](./poolday/biological-sequence-lane.md)** - Governed protein/DNA sequence execution, receipt, privacy, and AdapterPack boundary
- **[docs/poolday/room-1-pilot-charter.md](./poolday/room-1-pilot-charter.md)** - Prospective protein annotation adjudication pilot
- **[docs/poolday/p2p-envelope-protocol.md](./poolday/p2p-envelope-protocol.md)** - Signed peer envelope contract
- **[docs/poolday/participation-identity-routing.md](./poolday/participation-identity-routing.md)** - Request/contribute modes, device identity, artifact authority, and deterministic routing
- **[docs/poolday/reputation-ledger.md](./poolday/reputation-ledger.md)** - Event-sourced reputation reducer contract
- **[docs/poolday/agent-api.md](./poolday/agent-api.md)** - Agent-facing API for deterministic inference jobs
- **[docs/poolday/canary-and-challenge-policy.md](./poolday/canary-and-challenge-policy.md)** - Canaries and challenges that turn receipts into audit-backed evidence
- **[docs/poolday/policy-classes.md](./poolday/policy-classes.md)** - Prompt policy classes for browser providers
- **[docs/poolday/discovery-contract.md](./poolday/discovery-contract.md)** - Target atomic active-science object, action-value boundary, epistemic updates, replication, and closure
- [Network product intent](./poolday/product-intent.md) - Compatibility links only
- [Poolday product contracts charter](./poolday/CATSCAN.md)

### Models and adapters
- **[docs/adapters.md](./adapters.md)** - Catalog adapters: picker facts, identity through an answer, preparation, serving and held-out evaluation
- **[docs/intent-bundle-lora.md](./intent-bundle-lora.md)** - Intent bundle LoRA workflow
- **[docs/trained-adapter-promotion.md](./trained-adapter-promotion.md)** - Tinker adapter evidence, Shadow staging, and human-only promotion
- **[docs/local-models.md](./local-models.md)** - WebLLM and Ollama setup

---

## Zero / X

- [X/Zero setup](zero-x-quick-start.md) starts with the minimal Zero base and explicit X upgrades.
- [Compact Zero capsules](zero-capsules.md) describes fresh boot, source reproduction and fully counted dependencies.
- [Recorded run playback](x/run-replay.md) covers bounded trace export, review, import and side-effect-free accelerated playback.
- [Self-source contract](x/self-source.md) separates the exported source closure from hosting and inference prerequisites.
- [Local X external reasoning](x/external-brain.md) connects a same-machine responder without a model API key.

### Architecture
- **[Agent and VFS architecture](./system-architecture.md)** - The separate Zero/X substrate
- **[Reploid, Doppler, and Doe diagram](./diagrams/reploid-diagram/README.md)** - Editable interactive views of intended relationships, operations, improvement and recovery; not implementation evidence
- **[Blueprint inventory](../self/blueprints/canonical-inventory.md)** - Generated sitemap of maintained architectural decisions; file enumeration belongs to the [source inventory](../self/config/module-inventory.json)
- **[docs/substrate.md](./substrate.md)** - Substrate + Ouroboros contract
- **[docs/API.md](./API.md)** - Module API documentation
- **[self/blueprints/0x0000AF-reploid-rooms-distributed-cognition.md](../self/blueprints/0x0000AF-reploid-rooms-distributed-cognition.md)** - Proposed Rooms runtime specification; not implementation evidence

**Key Blueprints:**
- [0x000002 - Application Orchestration](../self/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../self/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000040 - Verification Manager](../self/blueprints/0x000040-verification-manager.md) - Safety checks
- [0x000049 - HITL Controller](../self/blueprints/0x000049-hitl-controller.md) - Human oversight
- [0x00003C - Genesis Snapshot](../self/blueprints/0x00003C-genesis-snapshot-system.md) - Rollback system
- [0x000031 - Swarm Orchestration](../self/blueprints/0x000031-swarm-orchestration.md) - Multi-agent
- [0x00007F - RGR](../self/blueprints/0x00007F-recursive-gepa-ring.md) - Recursive GEPA Ring with validator quarantine, audit anchors, Pareto archive, and gated self-improvement

### Self-improvement and safety
- **[docs/rsi-improvement-episodes.md](./rsi-improvement-episodes.md)** - Signed causal episode ledger, metric semantics, evaluator authority, generations, and X workbench
- **[RSI levels](./RSI-LEVELS.md)** - The `L0` through `L4` ladder used by goal presets
- **[docs/maverick-hunting.md](./maverick-hunting.md)** - Evidence-backed provider/candidate containment and bounded bug hinting
- **[docs/SECURITY.md](./SECURITY.md)** - Security model and containment layers

---

## Releases and evidence

- **[docs/status/surface-claim-index.json](./status/surface-claim-index.json)** - Machine-checked surface status, evidence, blockers, and claim permission
- **[docs/first-visit-journeys.md](./first-visit-journeys.md)** - The owner's four first-visit journeys for replo.id, the rules that follow from them, and the check that walks them
- **[docs/critical-user-journeys.md](./critical-user-journeys.md)** - Outcome-based Reploid journey catalogue, coverage variants, and retained Poolday/Zero/X registries
- **[docs/status/poolday-critical-user-journeys.json](./status/poolday-critical-user-journeys.json)** - Canonical Poolday user outcomes, prerequisites, evidence, limitations, and remaining work
- **[docs/poolday/critical-user-journeys.md](./poolday/critical-user-journeys.md)** - Human-readable Poolday journey status
- **[docs/status/zero-critical-user-journeys.json](./status/zero-critical-user-journeys.json)** - Canonical Zero user outcomes, evidence, limitations, and remaining work
- **[docs/zero/critical-user-journeys.md](./zero/critical-user-journeys.md)** - Human-readable Zero journey status
- **[docs/status/x-critical-user-journeys.json](./status/x-critical-user-journeys.json)** - Canonical X user outcomes, evidence, limitations, and remaining work
- **[docs/x/critical-user-journeys.md](./x/critical-user-journeys.md)** - Human-readable X journey status
- [Evidence status charter](./status/CATSCAN.md) and the [retained evidence catalog](./evidence-catalog/index.json) for evidence moved out of the source tree

### Release and measurement reports
- [Reploid 0.1.5 + DopplerX 0.1.5 qualification](../reports/release-015-qualification/README.md)
- [Whole-model conversation reuse](../reports/generation-context/20261109/README.md)
- [Qwen 27B on a workstation and a Windows laptop](../reports/native-throughput/20261109/README.md)
- [JSON-configured native Qwen partition checks](../reports/ordered-qwen-native/20261109/README.md)
- Fleet reports are listed under [Fleet and credits](#fleet-and-credits).

### Reviews and history
- [2026-11-15 review dispositions](review-resolution-2026-11-15.md) — all 92 finding IDs, implementation evidence, corrections and retained contracts.
- [Branch integration, September 2026](branch-integration-2026-09-26.md) — repository integration record.
- [Historical scoped repair](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/scripts/repair_reploid.py) — commit-specific recovery source, retained in history rather than the current tool set.

---

## Operations

- **[Testing guide](./TESTING.md)** - Test-value rules, focused checks and physical controllers
- **[Cloudflare discovery and TURN migration](./cloudflare-migration.md)** - Signaling rendezvous and temporary TURN credentials
- **[Public discovery and pinned runtime repair](./public-swarm-repair.md)** - Discovery alternatives and pinned Doppler runtime recovery
- **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Boot UI settings and localStorage keys
- **[docs/style-guide.md](./style-guide.md)** - Code and UI conventions
- **[diagnostic-planning.md](./diagnostic-planning.md)** - Optional belief-based investigation strategy and bounded comparison evidence

### Repository support files

- [Development environment template](../examples/.env.example) and [configuration example](../examples/.reploidrc.json.example).
- [Test configuration](../tests/vitest.config.js), [browser test configuration](../tests/playwright.config.js), and [browser type-check configuration](../tests/tsconfig.browser.json).
- [Cloud Run container](../deploy/Dockerfile) — build from the repository root with `docker build -f deploy/Dockerfile .`.
- [Security audit policy](SECURITY_AUDIT.md) — cooperative self-audit scope and sanitized findings.
- [Approved symbols](EMOJI.md) — presentation and documentation conventions.
- [Primes example](../examples/primes.html) — standalone HTML example.

---

## Code Organization

The [browser ownership inventory](./ownership-inventory.md) assigns every served browser file to
`apps/poolday` (the Poolday product), `self` (the agent/VFS substrate) or `shared`, from its references.

```
reploid/
├── apps/poolday/               # Poolday product, served at the same URLs (index.html, ui/pool-home/, pool/, host/)
├── shared/                     # Browser code both surfaces load (vendor/, config/, identity.js, ...)
│   └── infrastructure/event-bus.js # Shared pub/sub event system
├── self/                       # Agent/VFS substrate; with the two roots above, one served tree
│   ├── kernel/index.html       # Substrate boot entry
│   ├── entry/seed-vfs.js       # VFS hydration compatibility shim
│   ├── entry/start-app.js      # Bootstrapper compatibility shim
│   ├── sw-module-loader.js     # Service worker for VFS modules
│   │
│   ├── host/                   # VFS seeding and runtime handoff
│   ├── kernel/                 # Immutable boot shell
│   ├── capsule/                # Capsule UI
│   │
│   ├── core/                   # Core substrate
│   │   ├── agent-loop.js       # Cognitive cycle (Think -> Act -> Observe)
│   │   ├── vfs.js              # Virtual filesystem (IndexedDB)
│   │   ├── llm-client.js       # Multi-provider LLM abstraction
│   │   ├── tool-runner.js      # Dynamic tool loading/execution
│   │   └── verification-manager.js  # Pre-flight safety checks
│   │
│   ├── infrastructure/         # Support services
│   │   ├── di-container.js     # Dependency injection
│   │   ├── hitl-controller.js  # Human-in-the-loop oversight
│   │   └── audit-logger.js     # Execution logging
│   │
│   ├── capabilities/           # Extended capabilities
│   │   └── communication/      # Swarm sync, WebRTC transport
│   │
│   ├── tools/                  # Agent tools (CamelCase)
│   │
│   ├── config/                 # Configuration
│   │   └── genesis-levels.json # Module/worker/role definitions
│   │
│   ├── blueprints/             # Maintained architectural decisions
│   │   └── canonical-inventory.md # Generated sitemap; counts derive from source
│   │
├── packages/reploid/src/       # Reploid library source; served as the shared/vendor/reploid mirror
├── tests/                      # Test suites
│
├── docs/                       # Human-facing documentation
└── server/                     # Proxy server and native participant
```

---

## Reading Guide

## Documentation hierarchy

Read and maintain documentation by authority rather than by file count:

1. `GOALS.md` defines repository mission, value, and durable strategy.
2. `INTENT.md` protects collective capability, participant control, semantic preservation, and evaluated evolution.
3. The recursive `CATSCAN.md` chain assigns component ownership, interfaces, constraints, and acceptance checks; surface product intents define their user workflows and win conditions.
4. The claim index records what may currently be claimed and its evidence.
5. Runtime contracts define implemented behavior.
6. Protocol documents define exact schemas and wire rules.
7. Subsystem blueprints capture architectural decisions, invariants, and failure modes.
8. Generated module inventory records paths, ownership, dependencies, and hashes.

Former blueprint paths and consolidation provenance remain in the
[deduplication audit](../self/blueprints/deduplication-audit.md). Source enumeration
does not create Markdown blueprints unless a module introduces an architectural decision.

### For New Users
1. [README.md](../README.md) - Understand REPLOID
2. [QUICK-START.md](./QUICK-START.md) - Get running
3. [CONFIGURATION.md](./CONFIGURATION.md) - Configure connections

### For Developers
1. [system-architecture.md](./system-architecture.md) - Understand architecture
2. [blueprints/README.md](../self/blueprints/README.md) - Study specifications
3. [API.md](./API.md) - Learn module APIs
4. [tools/README.md](../self/tools/README.md) - Tool development

### For RSI Research
1. [README.md](../README.md) - Core RSI thesis
2. [rsi-improvement-episodes.md](./rsi-improvement-episodes.md) - Canonical causal improvement record and current proof boundary
3. [blueprints/0x000015-dynamic-tool-creation.md](../self/blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
4. [blueprints/0x00005B-recursive-goal-decomposition.md](../self/blueprints/0x00005B-recursive-goal-decomposition.md) - Recursive goal decomposition
5. [blueprints/0x00007F-recursive-gepa-ring.md](../self/blueprints/0x00007F-recursive-gepa-ring.md) - Recursive GEPA Ring whole-system recursive improvement blueprint
6. [diagnostic-planning.md](./diagnostic-planning.md) - Optional belief-based investigation strategy and bounded comparison evidence

### For Security Researchers
1. [SECURITY.md](./SECURITY.md) - Security model and containment
2. [blueprints/0x000040-verification-manager.md](../self/blueprints/0x000040-verification-manager.md) - Verification and sandbox design
3. [blueprints/0x00005C-circuit-breaker-pattern.md](../self/blueprints/0x00005C-circuit-breaker-pattern.md) - Failure containment

---

## Quick Reference

**Key Files:**
- `./self/config/genesis-levels.json` - Module registry and worker types
- `./self/entry/seed-vfs.js` - VFS hydration compatibility shim
- `./self/entry/start-app.js` - Application bootstrap compatibility shim
- `./self/kernel/index.html` - Substrate boot entry

**Key Directories:**
- `./self/` - Agent substrate modules; one served tree overlays this with `shared/` and `apps/poolday/`
- `./self/tools/` - Dynamic agent tools
- `./self/infrastructure/` - Support services
- `./self/ui/` - Proto UI
- `./self/blueprints/` - Architectural specifications
- `docs/` - Human-facing documentation. Component ownership and invariants live in the applicable CATSCAN chain; the owner's private roadmap owns active implementation work.

**External Links:**
- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine (separate repo)

---

*Last updated: November 2026*
