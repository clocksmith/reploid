# Reploid Code Agent

**Prime Directive:** Follow [GOALS.md](GOALS.md), [INTENT.md](INTENT.md), and every `CATSCAN.md` from the root to the changed files, parent first ([component index](docs/component-index.md), [workspace CATSCAN protocol](https://github.com/clocksmith/ouroboros/blob/main/deco/docs/catscan.md)). Keep implementation authority inside those charters. See [DOPPLER](https://github.com/clocksmith/doppler) for the WebGPU inference engine.

## Start with the owner

Follow `../ouroboros/docs/projects/reploid/roadmap.md` in the deco workspace for capped validation and acceptance; never copy private roadmap, pricing, or business-plan content into this repository. Public product authority lives in [product-specification.md](docs/product-specification.md) and [open-mesh-architecture.md](docs/open-mesh-architecture.md).

Read only the owner documents for the surface you touch:

| Change | Read at the owner |
| --- | --- |
| Conversations, threads, attempts, grants | [`packages/reploid/src/chat/CATSCAN.md`](packages/reploid/src/chat/CATSCAN.md), [`docs/style-guide.md`](docs/style-guide.md#execution-and-lifecycle-code) |
| Discovery, placement, partitions, agent work | [`packages/reploid/CATSCAN.md`](packages/reploid/CATSCAN.md), [`packages/reploid/src/mesh/partitions/CATSCAN.md`](packages/reploid/src/mesh/partitions/CATSCAN.md), [`packages/reploid/src/mesh/jobs/CATSCAN.md`](packages/reploid/src/mesh/jobs/CATSCAN.md), [`docs/open-mesh-architecture.md`](docs/open-mesh-architecture.md) |
| Custody, transport, or peer delivery | [`packages/reploid/src/artifacts/custody/CATSCAN.md`](packages/reploid/src/artifacts/custody/CATSCAN.md), [`packages/reploid/src/transport/CATSCAN.md`](packages/reploid/src/transport/CATSCAN.md) |
| Poolday product routes, UI, or CSS layers | [`apps/poolday/CATSCAN.md`](apps/poolday/CATSCAN.md), [`apps/poolday/ui/pool-home/CATSCAN.md`](apps/poolday/ui/pool-home/CATSCAN.md), [`docs/style-guide.md`](docs/style-guide.md#poolday-design-system) |
| Poolday host composition, sessions, or earning | [`apps/poolday/host/CATSCAN.md`](apps/poolday/host/CATSCAN.md), [`apps/poolday/host/earning/CATSCAN.md`](apps/poolday/host/earning/CATSCAN.md) |
| Zero / X agent substrate, VFS, tools, or HITL | [`self/CATSCAN.md`](self/CATSCAN.md), [`self/blueprints/`](self/blueprints/), [`docs/rsi-improvement-episodes.md`](docs/rsi-improvement-episodes.md), [`docs/maverick-hunting.md`](docs/maverick-hunting.md) |
| Shared browser code or Doppler package pin | [`shared/CATSCAN.md`](shared/CATSCAN.md), [`shared/config/doppler-package.json`](shared/config/doppler-package.json), [`docs/ownership-inventory.md`](docs/ownership-inventory.md) |
| Server, signaling, relay, or native host | [`server/CATSCAN.md`](server/CATSCAN.md), [`server/rewards/CATSCAN.md`](server/rewards/CATSCAN.md) |
| Documentation, symbols, or status claims | [`docs/INDEX.md`](docs/INDEX.md), [`docs/EMOJI.md`](docs/EMOJI.md), [`docs/status/surface-claim-index.json`](docs/status/surface-claim-index.json) |

## Surface and authority guardrails

- **Distinct surfaces:** Poolday (`apps/poolday/`), Zero, and X (`self/`) have separate authority; never merge them. One served URL tree overlays `self/`, `shared/`, and `apps/poolday/` (`npm run verify:ownership-inventory`).
- **Model vs. orchestration:** Doppler defines partitions, tensors, numerical contracts, and model semantics; Reploid places eligible computation and orchestrates agents; Poolday transfers authorized data. Never duplicate model arithmetic in Reploid or substitute a different learned expert during scheduling.
- **Truthful claims:** Declare numerical tolerances, allocation budgets, and cancellation settlement; never promise universal determinism, immediate GPU termination, trustless compute, hardware attestation, or exactly-once relay delivery. A relay acknowledgement proves only recipient receipt of that relay record.
- **Public copy & routes:** Inspect route files, boot profile, VFS seed, and rendered state before proposing UI/route changes. Never rename routes, labels, buttons, or trust language without user direction.
- **Zero / X operational discipline:** Zero answers require process parentage, provider status, VFS state, tool logs, and resume state first. All agent-generated changes must pass the Verification Worker sandbox and preserve Genesis Kernel rollback. Governed self-improvement (L0–L4) follows [INTENT.md](INTENT.md) and [rsi-improvement-episodes.md](docs/rsi-improvement-episodes.md); model or Arena scoring never grants activation permission.
- **Symbols:** Enforce [`docs/EMOJI.md`](docs/EMOJI.md); use only approved Unicode symbols, no emojis.

## Development verification

Use focused checks for the changed behavior (e.g., `npx vitest run --config tests/vitest.config.js <file>`, syntax/type checks, or a local visual check), following the [workspace verification rules](https://github.com/clocksmith/ouroboros/blob/main/deco/AGENTS.md#development-verification) and [test-value guide](docs/style-guide.md#test-value). Do not automatically run full repository suites, browser/device matrices, GPU campaigns, or release qualification unless requested or required by a named correctness question. Run config/mirror/bundle checks only when editing their inputs. For documentation-only edits, inspect the diff and links. Report exactly what was checked.

## Git workflow and handoff

- Commit directly on `main` and push to `origin/main` (no feature branches, worktrees, or PRs unless requested; never force-push or discard concurrent work). Report the pushed commit or concrete blocker.
- Fix correctness bugs directly rather than relabeling them or adding TODOs. Never predict engineering timelines; report concrete deltas, dependencies, and measured process state.
- Material-change handoffs must state `Component`, `Intent` (`preserved | deliberately changed`), `Acceptance evidence`, and `Boundary effects`.
