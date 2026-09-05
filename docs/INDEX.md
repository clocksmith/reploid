# REPLOID Documentation Index

Guide to all documentation in the REPLOID project.

---

## Getting Started

1. **[/README.md](../README.md)** - Project overview, quick start, RSI concepts
2. **[docs/QUICK-START.md](./QUICK-START.md)** - Detailed setup and first run
3. **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Connection modes and boot configuration

---

## Core Documentation

### Architecture
- **[docs/system-architecture.md](./system-architecture.md)** - Complete system design
- **[Blueprint inventory](../self/blueprints/canonical-inventory.md)** - Generated sitemap of maintained architectural decisions; file enumeration belongs to the [source inventory](../self/config/module-inventory.json)

**Key Blueprints:**
- [0x000002 - Application Orchestration](../self/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../self/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000040 - Verification Manager](../self/blueprints/0x000040-verification-manager.md) - Safety checks
- [0x000049 - HITL Controller](../self/blueprints/0x000049-hitl-controller.md) - Human oversight
- [0x00003C - Genesis Snapshot](../self/blueprints/0x00003C-genesis-snapshot-system.md) - Rollback system
- [0x000031 - Swarm Orchestration](../self/blueprints/0x000031-swarm-orchestration.md) - Multi-agent
- [0x00007F - RGR](../self/blueprints/0x00007F-recursive-gepa-ring.md) - Recursive GEPA Ring with validator quarantine, audit anchors, Pareto archive, and gated self-improvement

### Vision and Contracts
- **[GOALS.md](../GOALS.md)** - Repository mission, value, and durable strategic goals
- **[CATSCAN.md](../CATSCAN.md)** - Root component purpose, authority, boundaries, and acceptance contract
- **[docs/component-index.md](./component-index.md)** - Generated recursive index of component charters
- **[docs/substrate.md](./substrate.md)** - Substrate + Ouroboros contract
- **[docs/rsi-improvement-episodes.md](./rsi-improvement-episodes.md)** - Signed causal episode ledger, metric semantics, evaluator authority, generations, and X workbench
- **[docs/poolday/executable-intelligence-network-plan.md](./poolday/executable-intelligence-network-plan.md)** - Independent Poolday/Reploid network proof from base-Pack exchange through causal evidence-to-routing improvement
- **[docs/change-passport/product-intent.md](./change-passport/product-intent.md)** - Inactive commercial alternative, independent proof, authority, and claim boundary
- **[docs/change-passport/implementation-plan.md](./change-passport/implementation-plan.md)** - Ordered repository deltas, acceptance gates, integrations, pilot, and launch evidence
- **[docs/change-passport/pilot-charter.md](./change-passport/pilot-charter.md)** - Frozen comparison protocol and external authority boundary
- **[docs/change-passport/pilot-manifest.json](./change-passport/pilot-manifest.json)** - Machine-readable pilot readiness and fail-closed freeze gate
- **[docs/change-passport/runtime-contract.md](./change-passport/runtime-contract.md)** - Hosted storage, authentication, GitHub App, endpoint, and deployment boundary
- **[Ouroboros documentation authority](https://github.com/clocksmith/ouroboros/blob/main/docs/authority/README.md)** - Cross-project record routing; Reploid remains canonical for product and runtime behavior
- **[docs/poolday/product-intent.md](./poolday/product-intent.md)** - Primary Poolday execution and improved-decision goal; optional scientific workflow; secondary Zero/X boundaries
- **[docs/poolday/discovery-contract.md](./poolday/discovery-contract.md)** - Target atomic active-science object, action-value boundary, epistemic updates, replication, and closure

### Reference
- **[docs/API.md](./API.md)** - Module API documentation
- **[docs/status/surface-claim-index.json](./status/surface-claim-index.json)** - Machine-checked surface status, evidence, blockers, and claim permission
- **[docs/browser-inference-pool.md](./browser-inference-pool.md)** - Current Poolday runtime, peer, coordinator, and deployment contract
- **[docs/poolday/claims-and-nonclaims.md](./poolday/claims-and-nonclaims.md)** - Poolday claim boundary
- **[docs/poolday/threat-model.md](./poolday/threat-model.md)** - Poolday adversaries, trust boundaries, and evidence
- **[docs/poolday/receipt-schema.md](./poolday/receipt-schema.md)** - Provider receipts and requester acceptances
- **[docs/poolday/artifact-manifest.md](./poolday/artifact-manifest.md)** - Hugging Face/GCS custody, exact model and adapter identity, and private delivery
- **[docs/poolday/receipt-backed-retrieval.md](./poolday/receipt-backed-retrieval.md)** - Target strategy for receipt-backed embeddings, retrieval, reranking, and vector memory
- **[docs/poolday/biological-sequence-lane.md](./poolday/biological-sequence-lane.md)** - Governed protein/DNA sequence execution, receipt, privacy, and AdapterPack boundary
- **[docs/poolday/p2p-envelope-protocol.md](./poolday/p2p-envelope-protocol.md)** - Signed peer envelope contract
- **[docs/poolday/participation-identity-routing.md](./poolday/participation-identity-routing.md)** - Request/contribute modes, device identity, artifact authority, and deterministic routing
- **[docs/poolday/reputation-ledger.md](./poolday/reputation-ledger.md)** - Event-sourced reputation reducer contract
- **[docs/multi-model-evaluation.md](./multi-model-evaluation.md)** - Generic LLM evaluation harness, not Poolday promotion evidence
- **[docs/intent-bundle-lora.md](./intent-bundle-lora.md)** - Intent bundle LoRA workflow
- **[docs/trained-adapter-promotion.md](./trained-adapter-promotion.md)** - Tinker adapter evidence, Shadow staging, and human-only promotion
- **[docs/CONFIGURATION.md](./CONFIGURATION.md)** - Boot UI settings and localStorage keys
- **[docs/local-models.md](./local-models.md)** - WebLLM and Ollama setup
- **[docs/style-guide.md](./style-guide.md)** - Code and UI conventions
- **[docs/SECURITY.md](./SECURITY.md)** - Security model and containment layers
- **[docs/maverick-hunting.md](./maverick-hunting.md)** - Evidence-backed provider/candidate containment and bounded bug hinting
- **[self/blueprints/0x0000AF-reploid-rooms-distributed-cognition.md](../self/blueprints/0x0000AF-reploid-rooms-distributed-cognition.md)** - Proposed Rooms runtime specification; not implementation evidence

---

## Code Organization

```
reploid/
├── self/                       # Browser application and public root
│   ├── index.html              # Entry point
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
│   │   ├── event-bus.js        # Pub/sub event system
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
├── tests/                      # Test suites
│
├── docs/                       # Human-facing documentation
└── server/                     # Proxy server
```

---

## Reading Guide

## Documentation hierarchy

Read and maintain documentation by authority rather than by file count:

1. `GOALS.md` defines repository mission, value, and durable strategy.
2. The recursive `CATSCAN.md` chain defines component outcomes, authority, invariants, acceptance, and non-goals.
3. Product intent defines the user workflow and win condition for a product surface.
4. The claim index records what may currently be claimed and its evidence.
5. Runtime contracts define implemented behavior.
6. Protocol documents define exact schemas and wire rules.
7. Subsystem blueprints capture architectural decisions, invariants, and failure modes.
8. Generated module inventory records paths, ownership, dependencies, and hashes.

Former blueprint paths and consolidation provenance remain in the
[deduplication map](../self/blueprints/deduplication-map.json). Source enumeration
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
- `./self/index.html` - Entry point

**Key Directories:**
- `./self/` - Agent substrate modules and public web root
- `./self/tools/` - Dynamic agent tools
- `./self/infrastructure/` - Support services
- `./self/ui/` - Proto UI
- `./self/blueprints/` - Architectural specifications
- `docs/` - Human-facing documentation. Internal module system invariants and migration checklist live in the private wrapper repo.

**External Links:**
- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine (separate repo)

---

*Last updated: August 2026*
