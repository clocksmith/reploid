## Reploid Code Agent

**Prime Directive:** Follow `GOALS.md` and the applicable `CATSCAN.md` chain; keep implementation authority inside those charters.

**See also:** [DOPPLER](https://github.com/clocksmith/doppler) for WebGPU inference engine (separate repo).

## Current implementation work

Follow the owner's private roadmap, `../ouroboros/docs/projects/reploid/roadmap.md`
in the deco workspace: the single Doppler–Reploid implementation roadmap and its
detailed acceptance register. Update acceptance evidence and checkboxes there as
acceptance passes. Historical plans cannot start a competing campaign.

Public product authority stays in two documents alongside `GOALS.md` and
`INTENT.md`: the [product contract](docs/product-specification.md) (the terms quotes
and receipts bind) and the [architecture](docs/open-mesh-architecture.md). The
business plan, roadmap, economics and planning history are private in Ouroboros
(`docs/projects/reploid/`); do not copy plans, prices, funding or roadmap content
back into this public repository. Network-intent paths are compatibility links, not
editable copies. Calculations, retained evidence and specialist protocols support
these owners; they do not create another product strategy or work queue.

## Git workflow: direct to main

- Commit on the owning repo's `main` and push to `origin/main`. No feature
  branches, branch-backed worktrees, or PRs unless the user asks for them.
- On another branch, preserve its work and move the task to `main` safely;
  never discard changes to switch. Never force-push `main`.
- Stage only task-related changes; integrate remote updates without
  overwriting unrelated work.
- Report the pushed commit or the concrete blocker. A local commit is not a push.

## Development verification

- During development, choose checks for the changed behavior: syntax/type checks,
  existing focused tests, or a local visual check. A command list is not a requirement
  to run every suite before each commit, push, or ordinary application deployment.
- Do not automatically run full repository suites, broad browser/device matrices,
  GPU/model campaigns, benchmarks, or full release qualification. Run them when
  explicitly requested or when a named correctness question cannot be answered by
  focused checks; state that reason before starting.
- Config-contract, mirror, drift, and freshness checks run only when the change
  edits what they check. Don't add tests that just restate another file or pin
  config literals. Time-box long processes.
- Once relevant checks pass, continue. Repeat or broaden verification only after
  another relevant change, a failure, or a concrete unresolved concern.
- For documentation-only edits, inspect the diff and changed links. Do not run
  application, GPU, browser, or benchmark suites for prose changes.
- For ordinary deployments, build the changed artifact where needed and check the
  affected route after deployment. Deployment alone does not require a new release
  qualification campaign.
- Keep existing acceptance thresholds and release-qualification requirements.
  Report exactly what was checked; focused development checks do not establish
  numerical qualification, performance, multi-device support, or full acceptance.

## Component Intent

Follow the canonical [workspace CATSCAN protocol](https://github.com/clocksmith/ouroboros/blob/main/deco/docs/catscan.md).

Before modifying a file, read `GOALS.md` and every `CATSCAN.md` from the project root to the target directory, in order. Target, Authority, Invariants, Acceptance, and Non-goals are implementation constraints; a child CATSCAN may narrow its parent but not contradict it.

If requested work changes a component boundary, name the conflict and update the affected CATSCAN with the implementation instead of silently working around it. CATSCAN constrains outcomes and authority, not internal algorithms, so novel implementations are welcome. AGENTS.md enforces discovery and precedence; it must not duplicate component goals.

Material-change handoffs must state:

- Component: `<name>`
- Intent: `preserved | deliberately changed`
- Acceptance evidence: `<commands/artifacts>`
- Boundary effects: `<none or named components>`

### Directory Structure

```text
reploid/
├── packages/reploid/src/     ← Reusable implementation and public contracts
│   ├── chat/                 ← Threads, history, attempts, grants, scheduling
│   ├── mesh/                 ← Discovery, placement, partitions and agent work
│   ├── transport/            ← Authenticated, bounded peer delivery
│   ├── artifacts/custody/    ← Authorized piece acquisition and retention
│   └── agent/                ← Goal-directed agent execution
├── self/host/                ← Browser service composition and host ports
├── self/ui/                  ← Renders authoritative state and user actions
├── self/core/                ← Agent/VFS substrate and compatibility forwarding
├── self/config/              ← Browser profiles, catalog and package pins
├── server/                   ← Optional server/proxy adapters
├── tests/                    ← Contract, integration and physical-run harnesses
└── docs/                     ← Intent, architecture and evidence navigation
```

### Before Starting
- Read `docs/INDEX.md` (documentation overview), `docs/style-guide.md` (style), and `docs/EMOJI.md` (approved Unicode symbols)
- Read [`docs/maverick-hunting.md`](docs/maverick-hunting.md) before diagnosing, containing, or repairing evidence-backed provider, mutation, or tool failures
- `self/blueprints/` holds architectural documentation

### Key Paths

- `packages/reploid/src/mesh/partitions/` owns discovery, placement, admission,
  sequencing and settlement through injected Doppler contracts.
- `transport/` and `artifacts/custody/` never define model mathematics.
- `self/host/` supplies identity, catalog, policy, storage and runtime ports.
- `self/core/`, `self/tools/`, and `self/infrastructure/` support the agent/VFS
  substrate. Check the nearest charter before modifying compatibility forwarding.
- `self/config/doppler-package.json` pins one standard Doppler dependency.

### Product architecture

```text
Conversation UI -> Host composition -> reploid/chat -> mesh placement/admission
                                                  -> custody + transport
                                                  -> Doppler public execution
```

Using prepared capacity requires no requester weights. Contribution preparation
has a separate grant and lifecycle. Browser and native hosts compose the same
library contracts with separately qualified support. See the
[technical diagrams](docs/open-mesh-architecture.md#technical-diagrams).

### Agent/VFS substrate architecture

This map describes the substrate used by Zero/X and agent hosts, not the complete
network product or the ownership of distributed conversations.
```
User Input -> AgentLoop -> LLMClient -> Tool Selection
                  |             |
            StateManager   ToolRunner -> VFS (IndexedDB)
                  |             |
            ContextManager  SchemaRegistry
                  |
            EventBus <-> HITL Controller
                  |
            GenesisSnapshot (immutable rollback)
```

### Testing
Reference only. Per Development verification, run the touched test file:
`npx vitest run --config tests/vitest.config.js <file>`.
```bash
npm test                    # Run Vitest suites; does not launch browsers
npm test -- --full          # Vitest followed by Playwright E2E
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:e2e            # Playwright E2E tests
npm run test:coverage       # With coverage report
```

### CLI
```bash
npm run cli                 # Start Reploid CLI
npm run build:genesis       # Build genesis manifest
npm start                   # Start server
```

### Debugging
- **Conversation attempts:** Inspect `packages/reploid/src/chat/workspace.js` and
  its host admission/session ports; retain the originating thread and attempt ID.
- **Discovery or readiness:** Trace `mesh/partitions/` through discovery,
  placement, reservation and resident execution. File custody alone does not
  establish readiness.
- **Acquisition or connection:** Inspect `artifacts/custody/` and `transport/`
  at their authenticated host boundaries.
- **Model computation:** Reproduce through the pinned Doppler public interface;
  patch the numerical owner in Doppler, not duplicated arithmetic here.
- **Agent/VFS substrate:** Inspect `self/core/`, `self/tools/` and
  `self/infrastructure/` under their charters; Genesis rollback, provider setup
  and HITL belong to their scoped agent workflow.

### Guardrails
- Enforce `docs/EMOJI.md`; use only approved Unicode symbols, no emojis
- Runtime: all agent-generated code changes must pass the Verification Worker sandbox
- Preserve Genesis Kernel immutability for recovery
- Runtime target is the browser, with VFS in IndexedDB; Vitest emulates it with
  happy-dom, so routine changes need no browser run

## Intent-First Operations

- Poolday, Zero, and X are distinct surfaces with distinct authority; never merge them mentally.
- Doppler defines partitions, tensors, numerical contracts and model semantics; Reploid places eligible computation and orchestrates agents/improvement; Poolday moves authorized data. Scheduling never substitutes a different learned expert.
- Separate targets from qualified capabilities: declare numerical tolerances, application allocation budgets and cancellation settlement; never promise universal determinism, physical-memory accounting or immediate GPU termination.
- Before proposing names or navigation changes for a route or UI, inspect its route files, boot profile, VFS seed, and rendered state.
- The user controls public naming and product copy: no renaming routes, labels, buttons, or trust language without direction.
- Poolday claims only browser inference backed by signed records, audits, reputation, policy, and deterministic comparison; never imply trustless compute, hardware attestation, or guaranteed honest browser/GPU execution.
- Poolday relay or signaling delivery is bounded at-least-once, never exactly-once across browser reloads, restarts, or partitions. Source, deployed Firestore indexes, running revision and traffic, and the matching browser bundle are separate release evidence. A relay acknowledgement proves only recipient receipt of that relay record.
- Zero operational answers need process parentage, provider status, VFS readability/writability, tool-call logs, and resume state first.
- X keeps self-modification, swarm, validation, and promotion evidence separate from Poolday inference records.
- Answer "deployed?" with the deployed URL/build identifier, not progress language.
- On provider/API errors, verify HTTP status, retry/backoff state, and parked/resumable state before describing behavior.

### Capability Levels
| Level | Name | Scope | Gate |
|---|---|---|---|
| L0 | Basic Functions | CreateTool, Web APIs, new tools | Verification Worker |
| L1 | Meta Tooling | Modify tool-writer, improve CreateTool | Protected independent evaluation and operator grant |
| L2 | Self-Modification (Substrate) | Edit core modules, runtime patches | Independent evaluation, explicit activation grant and rollback |
| L3 | Weak RSI (Iterative) | Bounded feedback loops, self-improvement | Independent evaluation, bounded grants, causal evidence and rollback |
| L4 | Weak AGI | Broad autonomous planning, system-building, and self-directed experimentation | N/A |

The table is navigation, not authority to activate a candidate. Governed
improvement follows [INTENT.md](INTENT.md), [CATSCAN.md](CATSCAN.md) and
[improvement episodes](docs/rsi-improvement-episodes.md). Arena consensus cannot
replace protected independent evaluation or operator adoption. Model scoring
never grants permission.

### Key Concepts
- **VFS:** Virtual file system in IndexedDB
- **Genesis:** Immutable snapshot for rollback
- **HITL:** Human-in-the-loop approval gates
- **Arena:** Multi-model consensus for risky changes

## No speculative engineering timelines

- Never predict how long engineering work will take ("1-2 weeks", "a quick
  fix"). Describe concrete deltas, dependencies, risks, and validation instead.
- For an already-running process, report measured elapsed time, progress, or a
  grounded ETA only when the process exposes one; otherwise report its phase,
  latest output, and whether it is still progressing.

## Pick the real fix

- Fix correctness bugs; don't relabel them. Effort or scope framing
  ("non-trivial", "worth its own thread", "later") is no reason for a lesser fix.
- "Mark experimental", "add a TODO", or "reword the misleading comment" does not
  substitute for fixing wrong behavior.
- If scope must be split, list the concrete deltas and ask the user which path
  to take; don't pre-decide a smaller version.
