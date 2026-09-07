# Linux product-closure continuation, 2026-09-07

This observation continues the [handoff](../product-closure-handoff-2026-09-07.md).
It does not complete the network goal or replace prior adverse evidence.

## Changes and checks

At source base `855e429b`, browser and VFS inventories were already current.
`verify:runtime-config` still failed because `documentDelegation.taskClasses`
did not use the generator's canonical formatting. Regeneration changes no
policy values. The browser byte manifest follows that formatting change.
After a lockfile installation, all required local CI contract commands and
TypeScript pass. The full suite passes 2,460 tests with 35 explicit skips.
The previously reported replay failures did not recur.

The physical answer runner now accepts `corpusPath` with a mandatory
`corpusDigest` in `sha256:<hex>` form for a separate corpus. It verifies the
digest and unchanged semantic acceptance rules before launching a browser.
The original corpus remains the default. Separate bytes do not establish
held-out provenance, independent review, or answer quality. Regression corpus
fixtures are not new model-quality evidence.

The actual-browser startup poll now recognizes text-only terminal errors.
Chrome 136 failed Ed25519 key import; the previous poll hid that terminal state
until its deadline. The repaired poll reports the original failure directly.
An earlier run from port 8137 failed the bucket's CORS policy. Port 8000 is
explicitly supported; the access policy and signature requirements are unchanged.

## Physical observations

Chromium 145 on this Intel gen-12lp host executes the enabled signed ESM-2
Capsule with published Doppler 0.6.0. Six passing test executions cover:

- Complete WebRTC job, requester acceptance, and OPFS restoration without shard refetch.
- After-start cancellation without publishing the cancelled receipt.
- Instrumented stale-result rejection.
- Strict manifest-corruption rejection before provider advertisement.
- Cached-shard corruption detection and origin-backed recovery.
- Extended cancellation: runtime closure after settlement, restart, and a new accepted job.

The first negative-test invocation skipped two strict-preflight cases. A separate
invocation explicitly enabled that precondition and passed both. Every invocation
uses zero automatic retries. The archive retains the failures and separate runs.
The startup microprobe is a separate dispatch-only observation on Chrome 136.

This is one internal operator on one machine. It does not prove GPU preemption,
complete numerical equivalence, production qualification, origin-disabled peer
reconstruction, independent operation, or learned scheduling. Browser qualification
attachments deliberately remain incomplete; source-release bindings are not supplied.

## Remaining gates

Production readback still identifies `956c26a8` and `reploid-pool-00082-mvj`,
with a browser bundle different from this checkout. Hosted CI for `855e429b`
fails its contract step; local passing checks are not a new hosted CI result.
Deployment tooling/authorization, the original Apple answer-evaluation artifacts,
the affected AMD machine, and unrelated operators have been requested.
Assistant semantics, qualified presets, useful coding specialization, independent
delegation and repeat use, four-machine acquisition, measured loading improvements,
and held-out learned-routing benefit remain unproved. MoE remains inactive.

`receipt.json` binds `evidence.tar.gz` and the changed source bytes. Extract the
archive into a fresh directory; nested browser archives preserve their full
Playwright JSON attachments. No signing keys or private documents are included.

Component: Reploid runtime configuration and qualification tooling.
Intent: preserved. Acceptance evidence: archived commands and browser attachments.
Boundary effects: generated browser bytes, answer-corpus selection, terminal-error
detection, and cancellation evidence. Doppler source is unchanged.

*Last updated: September 2026*
