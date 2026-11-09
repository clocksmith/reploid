# Quiet answer progress — 2026-11-09

Component: Poolday conversation presentation.
Intent: deliberately changed at the owner's request to replace repeated progress and metadata with one animated indicator.
Boundary effects: browser UI only; execution, permission, discovery and provider contracts are unchanged.

The selected answer has one pulsing dot during queueing, preparation, search and generation, even before an execution receipt arrives. The composer and model selector no longer animate independently. The dot opens the existing answer inspector. It retains a 44px touch target when becoming the static details icon, avoiding a completion layout shift. Pending cancellation and permissions remain explicit. Failure, interruption, retry and partial answers remain visible.

Model, generated token count, elapsed generation time and measured throughput live in the inspector instead of repeating under each answer. Accessible progress announcements remain, with reduced-motion and forced-colors handling inherited from the shared dot primitive. Measurements remain scoped to the selected answer's receipt.

## Acceptance evidence

- 62 unit tests passed: execution activity, message list and conversation workspace.
- 8 Chromium SwiftShader browser tests passed: compact 320px chat, accessible/reduced motion, observed execution details, stable long-answer geometry in both themes, receipt selection, one indicator at 1280/390, search/cancel/retry.
- CSS ownership, scoped lint, browser manifest and diff checks passed.
- The first browser pass found a 26px to 38px details-button width change. The fixed minimum 44px target passed the unchanged geometry assertions on rerun.
- Retained screenshots use explicit presentation fixtures, not inference. No model or GPU qualification is implied. Production byte identity and boot checks are recorded separately in live.json after deployment.
