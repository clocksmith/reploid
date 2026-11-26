# Blueprint 0x000089: Pool home view

Owner: apps/poolday (see [apps/poolday/CATSCAN.md](../../apps/poolday/CATSCAN.md))

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/pool-home/ledger-store.js`, `/self/ui/pool-home/view.js`

**Planned Artifacts:** None

**Owned Source Files:** `ui/pool-home/ledger-store.js`, `ui/pool-home/view.js`, `ui/pool-home/operation-sharing.js`

**Former Blueprint Paths:** `self/blueprints/0x000089-ui-pool-home-view.md`
**Objective:** Render Poolday routes, navigation, records, and room-scoped view state without moving execution authority into presentation code.

**Target Upgrade:** ui/pool-home/view.js

**Affected Artifacts:** /ui/pool-home/view.js, /ui/pool-home/ledger-store.js

---

### 1. Intent

Present the public Poolday surface as ordinary software. Keep model execution,
peer authorization, and receipt validation in their owning modules. The view
renders escaped state and emits controls that those modules bind.

### 2. Architecture

- `view.js` owns route markup, navigation markup, result presentation, and
  receipt-ledger projection.
- `ledger-store.js` owns one stable room-scoped collection set for receipts,
  peer events, streams, and activity summaries.
- Home renders one focused signed-Pack job. Model Pack, input, peer disclosure,
  and Run model are the only default controls.
- Share compute leads with Pack selection, provider state, and Start sharing.
- Share compute exposes current limits and input handling before Start sharing,
  and projects startup failures in the primary surface.
- Recent jobs leads with the job ledger. Advanced details contain execution
  receipts, comparison evidence, peer identities, retries, and recovery only.
- Research Room-1 is a separate non-primary route for scientific governance.
- Navigation is one compact horizontal shell: the brand link, the execution
  ribbon and a Settings menu. `POOLDAY_NAV_ROUTES` in
  [`constants.js`](../../apps/poolday/ui/pool-home/constants.js) holds one
  primary route, Changes (`/improve`); Network, Examples and Experiments are
  Settings shortcuts in [`shell-view.js`](../../apps/poolday/ui/pool-home/shell-view.js).

### 3. Implementation Notes

- The focused task remains centered in the visible desktop region and fits a
  320-pixel viewport without horizontal clipping.
- Compatibility routes do not appear as additional navigation destinations.
- Network state remains understandable without opening another surface.

### 4. Verification requirements

- [x] Navigation routes and shell placement have DOM tests (`tests/unit/pool-home-nav.test.js`)
- [x] Narrow mobile routes remain free of horizontal clipping
- [x] Home exposes one Pack, one input, peer disclosure, and one Run action
- [x] Research Room-1 is absent from Recent jobs markup
- [x] Research Room-1 remains reachable as a separate non-primary route
- [x] The VFS and blueprint registries cover both view-state artifacts

*Last updated: August 2026*
