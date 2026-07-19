# Blueprint 0x000144: Pool home view

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
- The navigation remains a full-height activity rail when collapsed. Expansion
  reveals current-view context, route explanations, peer-room details, and
  secondary runtimes in a top-and-bottom sidebar composition.
- Route changes preserve the current navigation expansion state. Page reloads
  begin collapsed.

### 3. Implementation Notes

- Collapsed route labels remain visible. Expanded content must add information,
  not merely repeat those labels.
- The 7/77 mark is the rail toggle. Its two glyphs exchange visual weight during
  expansion, and the control has no decorative left border that reads as an
  active-route indicator.
- Escape closes the expanded sidebar. Reduced-motion preferences collapse its
  transition durations.
- The rail occupies the viewport height on desktop and mobile. Expanded mobile
  navigation leaves a visible edge of the current route for spatial context.

### 4. Verification Checklist

- [x] Collapsed and expanded navigation have browser geometry tests
- [x] Route descriptions and room context have DOM contract tests
- [x] Narrow mobile routes remain free of horizontal clipping
- [x] The VFS and blueprint registries cover both view-state artifacts

*Last updated: July 2026*
