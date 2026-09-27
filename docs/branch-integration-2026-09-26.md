# Branch integration, September 2026

Component: Reploid repository integration.
Intent: preserved. The network remains the product; Doppler owns model
computation, Poolday moves authorized data, and Reploid orchestrates it.
Boundary effects: existing agent, job journal, peer requester, Zero presentation,
policy validation, and generated registry owners. No deployment or permission
expansion; no new inference qualification.

## Integrated tips

| Branch | Tip | Resolution |
| --- | --- | --- |
| `codex/agent-durable-peer` | `e73cb6d1` | Canonical binding comparison and disconnect recovery moved into library owners; bounded, cancellable reveal waiting and explicit signed-attempt resume retained. |
| `release/reploid-doppler-061-20260912` | `d29cf5dc` | Superseded pin reconciled without downgrading the current integrity-bound, same-origin Doppler 0.6.2 package or deployment configuration. |
| `release/reploid-doppler-061-db4193c7` | `2b47856c` | Same superseded-release resolution; history retained. |
| `codex/zero-runtime-trace-cleanup` | `23974fb2` | Inline tool parsing, trace extraction, and replay import/export integrated. Current CreateTool-only policy, full prompt details, epoch controls, and shared execution engine retained. |
| `agent/reploid-journeys-dead-code-cleanup` | `f317e8aa` | Shared policy validation, journey checks, and unreferenced legacy module cleanup integrated. Current scientific catalog and source-owned registry validation retained. |

Other local and fetched remote branch tips were already ancestors of `main`.
Branches are not deleted. Tags, stashes, detached worktrees, and other repositories
are not branches to merge and were left alone.

## Conflict decisions

- Browser compatibility exports remain facades. No old application-owned agent
  loop, requester, or journal was restored over its library owner.
- Historical numbered blueprints were not reintroduced into the consolidated
  sequence. Removed legacy UI implementations have no executable ownership claim
  in their retained design records.
- Journey records describe supporting receipt/Zero/X workflows, not a replacement
  for concurrent chat. Disabled coordinator text models remain disabled; that
  historical coordinator journey is explicitly blocked, separately from peer chat.
- Zero's seed adds three helper modules for replay, shared prompts, and trace
  rendering. The original permission boundary and current prompt text are retained.
- The parser uses stateless string match iteration, avoiding shared regular-expression
  cursor state and the Verification Worker's broad process-execution pattern.
  The worker's security checks were not relaxed.
- The registry-audit skill regenerated metadata through canonical owners and
  required zero unresolved issues and repeat-generation stability.

## Acceptance and limits

Evidence: [retained test reports](../artifacts/branch-merge-2026-09-26/README.md).
Commands include the full Vitest suite; Chromium chat persistence, native journal
recovery, real WebRTC between local browser contexts, Zero refresh, and merged-module
Verification Worker checks; library types, layers, charters, runtime configuration,
journey/claim validation, and generated browser bundle checks.

The full suite retains four conversation-workspace failures also reproduced at
the pre-merge `a5ce2bba` snapshot. That fixture creates mesh-scoped conversations
without a peer executor and expects implicit local execution. The production
boundary rejects it with `No connected participant can execute this model`.
This merge does not silently restore local fallback to make those tests pass.

The split-chat source and evidence already exist in `a5ce2bba`; the quoted
`f45d1c16` checkout predates them. This integration does not establish resident
partial-weight execution, binary activation transport, physical-device split
generation, or numerical parity. The installed/hosted Doppler partition-export
reproducibility gap still requires its own dependency qualification.

No Hosting or backend deployment was performed.
