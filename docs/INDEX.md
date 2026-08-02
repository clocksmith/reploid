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
- **[./self/blueprints/](../self/blueprints/)** - Decision blueprints and legacy generated module entries (368 files)

**Key Blueprints:**
- [0x000002 - Application Orchestration](../self/blueprints/0x000002-application-orchestration.md) - Boot and DI
- [0x000008 - Agent Cognitive Cycle](../self/blueprints/0x000008-agent-cognitive-cycle.md) - Core loop
- [0x000040 - Verification Manager](../self/blueprints/0x000040-verification-manager.md) - Safety checks
- [0x000049 - HITL Controller](../self/blueprints/0x000049-hitl-controller.md) - Human oversight
- [0x00003C - Genesis Snapshot](../self/blueprints/0x00003C-genesis-snapshot-system.md) - Rollback system
- [0x000031 - Swarm Orchestration](../self/blueprints/0x000031-swarm-orchestration.md) - Multi-agent
- [0x000112 - RGR](../self/blueprints/0x000112-recursive-gepa-ring.md) - Recursive GEPA Ring with validator quarantine, audit anchors, Pareto archive, and gated self-improvement

### Vision and Contracts
- **[docs/substrate.md](./substrate.md)** - Substrate + Ouroboros contract
- **[docs/poolday/product-intent.md](./poolday/product-intent.md)** - Canonical proof-carrying protein-model-network goal, bounded protein journey, evidence boundary, and promotion path
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
│   ├── blueprints/             # Decision blueprints plus legacy generated module entries
│   │   └── (368 documents; migrate generated entries to inventory records)
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

1. Product intent defines the purpose and win condition.
2. The claim index records what may currently be claimed and its evidence.
3. Runtime contracts define implemented behavior.
4. Protocol documents define exact schemas and wire rules.
5. Subsystem blueprints capture architectural decisions, invariants, and failure modes.
6. Generated module inventory records paths, ownership, dependencies, and hashes.

Existing generated blueprint stubs remain compatibility records during migration;
they are not evidence of an architectural decision. New module inventory should
not create Markdown blueprints unless the module introduces such a decision.

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
2. [blueprints/0x000015-dynamic-tool-creation.md](../self/blueprints/0x000015-dynamic-tool-creation.md) - Tool creation
3. [blueprints/0x00005B-recursive-goal-decomposition.md](../self/blueprints/0x00005B-recursive-goal-decomposition.md) - Recursive goal decomposition
4. [blueprints/0x000112-recursive-gepa-ring.md](../self/blueprints/0x000112-recursive-gepa-ring.md) - Recursive GEPA Ring whole-system recursive improvement blueprint

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
