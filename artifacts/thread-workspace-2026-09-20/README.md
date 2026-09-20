# Thread workspace acceptance

Component: Reploid work host, product UI, whole-request mesh.
Intent: preserved; single-active-task presentation and host lifecycle deliberately replaced.
Boundary effects: per-thread host execution/approval state; optional model-bound dispatch context,
provider slot advertisements and request-scoped cancellation in the existing generation protocol.
Doppler model semantics, signed Pack admission and Poolday transport ownership are unchanged.

## Evidence

- 23 Chromium tests passed across `work-threads`, `work-integration`, `workspace-material`,
  `work-clarity` and `agent-network-home`.
- Two independently running host threads: selection, separate approvals, isolated stop,
  completion and persistence after reload.
- Two real WebRTC participants execute primary requests for concurrent threads without
  a requester-side model. Inference responses are injected, not GPU/model-quality evidence.
- Verification Worker accepted changed JavaScript; installed-package acceptance passed.
- Vitest: 2,669 passed, 36 skipped, one pre-existing failure: `self/pool/CATSCAN.md`
  contains 267 words against the 250-word charter limit.
- Lint, library declarations, CSS layering, canonical library delivery passed.
- Registry: 438 source files, 68 modules, 176 declarations, 106 executable owners;
  zero unresolved issues. JSON parses and a second generation pass is byte-identical.
  The existing experimental OpenClaw genesis import is skipped (`document` unavailable).

## Visual review

Open [side-by-side comparisons](compare.html). Desktop and mobile, both themes,
cover empty, active, approval, completed and paused states. These are presentation fixtures.

## Limits

Eight concurrent host threads; this Work runtime serializes borrowed device operations.
Peer execution is whole-request inference, not a model partitioned across GPUs.
Model identity is an advertised compatibility claim, not signed Pack qualification or
hardware attestation. No proof of frontier-scale execution or network benefit is asserted.
Helpers remain bounded, awaited subtasks; this change does not add detached helper threads.
