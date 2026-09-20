# Simpler workspace

Component: Pool-home presentation.
Intent: preserved. One task surface and one Agents surface share desktop row
bounds, widths, header baselines and gutters; mobile uses one column.
Boundary effects: none. No inference, transport or mutation authority changes.

Task header and result share a raised surface. Idle contribution details and
history are collapsed. Selected failures remain in the task, active contribution
keeps limits and stop visible, and outgoing approval keeps the exact payload.
Changes, history and More form one compact disclosure row.

Acceptance: 21 Chromium checks pass, including Verification Worker, peer
exchange, protected evaluation/adoption/rollback and resized viewport alignment.
The screenshot matrix covers both themes, desktop/mobile, empty, active,
approval, completed and paused states. These are presentation fixtures, not
inference evidence. [Comparison gallery](comparison.html).

CSS-layer, module-layer and scoped lint checks pass. Full-suite status retains
the existing `self/pool/CATSCAN.md` 267-word charter failure.
The registry-audit skill regenerates canonical metadata with zero unresolved
issues and checks second-pass idempotence.

```sh
REPLOID_E2E_ARTIFACT_DIR=artifacts/simple-workspace-2026-09-20 \
  npx playwright test tests/e2e/workspace-material.spec.js \
  tests/e2e/work-clarity.spec.js tests/e2e/agent-network-home.spec.js \
  tests/e2e/work-integration.spec.js --project=chromium --timeout=60000
```
