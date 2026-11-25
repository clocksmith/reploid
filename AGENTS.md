# Reploid Code Agent

When this repository is checked out under Deco, `../AGENTS.md` supplies the
shared operating rules. This file covers Reploid-specific commands and boundaries;
a standalone checkout does not require the Deco workspace.

**Prime Directive:** Build what the request needs. [GOALS.md](GOALS.md), [INTENT.md](INTENT.md) and `CATSCAN.md` files ([component index](docs/component-index.md)) are references for ownership and contracts: look up the one for the surface you touch when it helps, not as a reading list before editing. See [DOPPLER](https://github.com/clocksmith/doppler) for the WebGPU inference engine.

## Product and component references

Follow `../ouroboros/docs/projects/reploid/roadmap.md` in the deco workspace for capped validation and acceptance; never copy private roadmap, pricing, or business-plan content into this repository. Public product authority lives in [product-specification.md](docs/product-specification.md) and [open-mesh-architecture.md](docs/open-mesh-architecture.md).

Where each surface keeps its owner docs (a lookup, not a reading list):

| Change | Relevant owner reference |
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
- **Public copy & routes:** Trace route files, boot profile, VFS seed, and rendered state when changing the UI. Preserve the requested product direction and trust claims; make routine UI implementation choices within that scope.
- **Zero / X operational discipline:** Diagnose Zero behavior from process parentage, provider status, VFS state, tool logs, and resume state. All agent-generated changes must pass the Verification Worker sandbox and preserve Genesis Kernel rollback. Governed self-improvement (L0–L4) follows [INTENT.md](INTENT.md) and [rsi-improvement-episodes.md](docs/rsi-improvement-episodes.md); model or Arena scoring never grants activation permission.
- **Symbols:** Enforce [`docs/EMOJI.md`](docs/EMOJI.md); use only approved Unicode symbols, no emojis.
- **JavaScript only:** No Python or Go files, and no code that starts a Python or Go process; port to Node instead. WGSL through Doppler is fine. `npm run verify:js-only` (part of `npm run lint` and CI) enforces it.

## Poolday design system

Poolday UI code composes `@reploid/poolday-ui` components only. The full contract and the
assessment behind it are in [docs/poolday-ui-architecture.md](docs/poolday-ui-architecture.md).

- **One library.** `packages/poolday-ui` (import `@reploid/poolday-ui`, nothing deeper) is the
  design system. Its components render the primitive classes in
  `apps/poolday/styles/poolday/primitives/*.css` over `tokens.css`; those stylesheets are the
  implementation and the single source of every value. No second component set, no page CSS.
- **Layers** (`apps/poolday-react/src`, checked by `scripts/poolday-ui-architecture.json`):

  | Layer | Path | May import |
  | --- | --- | --- |
  | ui | `packages/poolday-ui/src/` | ui, `react` |
  | domain | `features/<f>/domain/` | domain |
  | infrastructure | `features/<f>/infrastructure/` | domain, platform globals, the API bridge's public entries and `apps/poolday/host/` |
  | presentation | `features/<f>/presentation/` | ui, domain, application, l10n, React hooks, types and `memo` |
  | composition | `app/`, `main-*.tsx` | everything, `react-dom/client`, platform globals |
  | l10n | `l10n/` | l10n |

  Features never import each other; the composition layer joins them.
- **Rules.** Outside `packages/poolday-ui`: no HTML elements (so no raw `button`, `input`,
  `select`, `textarea` or `a`), no `className`, `style` or `dangerouslySetInnerHTML`, no
  literal colours, sizes or durations. Inside it: values come from tokens, and `style` may set
  only `--pool-param-*`. Pick choice controls by the decision (style guide table): exactly one
  is `SingleChoice`, several is `MultiChoice`, on/off is `Toggle`.
- **The API bridge stays pure.** `packages/reploid/src` has no React, JSX, DOM rendering or
  presentation state, and every public entry has `.d.ts` types. Only infrastructure adapts it.
- **Adding a primitive.** Add the component to `packages/poolday-ui/src` and export it from
  `index.ts`; put any new look in a primitives stylesheet using tokens (`npm run verify:pool:css`);
  add it to `PRIMITIVE_ORDER` in `scripts/build-poolday-design-index.mjs`, a specimen in
  `apps/poolday-react/src/features/design/presentation/primitiveSpecimens.tsx` and an interaction
  and accessibility test in `tests/unit/poolday-ui/components.test.tsx`; then
  `npm run build:browser-bundle`. It appears on `/design` with its tokens and compositions.
- **Checks.** `npm run verify:poolday-ui` (boundaries, the legacy ratchet, the design index,
  types; part of `npm run lint` and the CI `design-system` job) and `npm run test:poolday-ui`.
  The ratchet (`scripts/poolday-ui-ratchet.json`) counts the legacy vanilla UI and may only go down.

## Run and verify

- `npm start` starts the local application; `npm run start:signaling` starts the
  signaling server. See [README.md](README.md) for setup and local routes.
- Run a focused unit test with
  `npx vitest run --config tests/vitest.config.js <test-file>`. The test-value
  guidance lives in [docs/style-guide.md](docs/style-guide.md#test-value).
- `npm run verify:library-types` checks library declarations;
  `npm run verify:poolday-types` checks Poolday declarations.
- `npm run build` regenerates the complete application build. For a narrower
  change, use the matching `build:*` / `verify:*` script in `package.json`;
  `npm run verify:library`, `npm run verify:ownership-inventory` and
  `npm run verify:browser-bundle:local` check their respective generated inputs.
- `npm run verify:catscan` checks component-map links and inventory after
  component-map or boundary changes. `catscan:chain` is an optional lookup.
- Choose browser journeys for the actual changed surface. Fake-buffer or unit
  tests do not establish real inference, physical peer recovery or production
  readiness.
