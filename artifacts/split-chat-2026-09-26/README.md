# Split-model chat: orchestration work, not milestone completion

Comparison release remains the [Cloudflare release](../cloudflare-2026-09-26/deployment.md),
bundle `6765f4e8ab62`. No deployment, commit or push occurred in this work.
Existing uncommitted chat, LoRA, custody and Cloudflare changes are preserved.

## Implemented in this work

- The partition coordinator processes the prompt through A and B, then returns
  each selected token to A and repeats both groups. B cannot return an independent
  multi-token generation. Doppler's per-step port owns sampling and stopping.
- Required host authorization replaces default allow. Both execution grants,
  intermediate disclosure and output disclosure are checked before work and
  rechecked at async boundaries. This is a port contract, not a new actual chat
  grant verifier; that host integration remains required.
- Frames bind model identity, plan, thread, attempt, participants, step and token
  position. Allocations, output length, token counts and concurrency are bounded.
- A receiver coalesces duplicate steps, rejects changed payloads and old/future
  steps, and retires failed state rather than reapplying potentially mutated KV.
  This is in-memory per-receiver idempotency, not exactly-once distributed delivery.
- FIFO token leases interleave conversations. Cancellation and close wait for
  owned attempts to settle, preserving shared resident ownership.
- Mutable port results are snapshotted before subsequent awaits. Both endpoint
  cleanups run on failures. Declarations and a component charter accompany code.

## Evidence and scope

Passed: [57 unit tests](unit.json), including 27 partition regressions, and
[3 browser boundary tests](browser.json). Types, layer/loader checks, 39 component
charters, targeted ESLint and whitespace checks pass. Registry reports zero
unresolved issues; repeated generation produces identical hashes. Its 18 existing
modules without individual blueprints are informational. The Genesis generator's
browser-only openclaw-audit skip leaves the tracked Genesis file unchanged.

Local candidate bundle, not deployed:
`sha256:07efd6bd12bbf5ea8c4ce5b827f980060cfff8806b5ec76c8523a2ee86326b96`
(2,691 declared served files).

Commands:

```sh
npx vitest run tests/unit/partition-runner.test.js tests/unit/partition-step-receiver.test.js tests/unit/chat-session.test.js tests/unit/work-resident-provider.test.js tests/unit/work-swarm-lifecycle.test.js tests/unit/browser-library-cancellation.test.js
npx playwright test tests/e2e/release-boundaries.spec.js --project=chromium
npm run verify:library-types
npm run verify:layers
npm run verify:catscan
node scripts/validate-registry.js
npm run verify:browser-bundle:local
```

The partition tests inject computation and transport. They establish loop,
authority-port, ordering, replay, fairness and cancellation behavior only.
The browser checks establish inert mesh imports and Verification Worker acceptance,
not actual partition execution. The immutable bootstrap rejection remains intact.

## Remaining defining work

1. Doppler-owned partial dependency loading and executable sessions, retaining
   original layer positions and declared shared endpoint weights. No such
   executor was implemented in this work. The local Doppler source contains a
   plan/codec contract, not executable group sessions.
2. A reproducibly pinned browser runtime with that capability. The installed
   Node package exports partition helpers; the hosted 0.6.2 index and Capsule
   entry do not. Node tests are not evidence for the hosted module graph. No
   pinned package or integrity declaration was overwritten to hide this gap.
3. Actual grant verification at the host and both recipients, bounded binary
   activation transport and token return, connected to the existing conversation
   execution port. Neither coordinator nor receiver is wired into live chat yet.
4. One real split answer, numerical/intermediate parity and measured partial
   residency, followed by two concurrent conversations and isolated cancellation.
5. Physical-device execution and, separately, a capacity-constrained pooling run.

The machine reported about 1.1 GiB free during inspection. No weights were
downloaded and no caches or user data were removed. This is a test-capacity risk,
not evidence that a split-generation run was attempted and failed.

Component: model partition coordination.
Intent: preserved; split-model chat is now explicit as the immediate milestone.
Acceptance evidence: commands above; scoped test results, not real generation.
Boundary effects: partition execution-port contract, mesh exports/types, generated
browser delivery and network-plan ordering. Existing application execution and
deployed services remain unchanged. Debug skills kept injected evidence separate
from real execution; registry skill kept generated delivery source-owned.

*Last updated: September 2026*
