# Shared capability validation boundary

Component: model partition coordination and its dependency validator. Intent
preserved. Discovery observes; placement selects; neither owns the other.

`before.txt` retains the real repository violations: discovery imported placement
for capability/route-shape checks, while placement's historical empty dependency
allowlist rejected the shared contract module. The two pure validation helpers
now live in the existing `partition-contract.js`. Discovery consumes that module
directly; placement keeps its public re-exports and selection behavior.
The validator allows placement to consume only this shared contract, with new
negative controls still rejecting discovery/placement/reservation coupling and
transport/runtime ownership. The charter states that distinction explicitly.

`tests.txt` records 64 passing controls covering dependency boundaries, malformed
route capabilities, automatic selection and multiuser interruption/replacement.
`after.txt`, `types.txt`, `charters.txt` and `worker.json` retain layer/delivery,
declaration, charter/index and actual Verification Worker checks. An independent
review confirms the moved predicates are unchanged apart from the assertion
alias. No grants, admission, tensor arithmetic or public package pins change.

The initial generated-copy mismatch is retained in `before-regeneration.txt`;
normal library generation repairs it. The charter-length failure is retained;
its wording was condensed within the existing limit and the index regenerated.
The Worker also rejected an existing infinite-loop *string fixture* when the old
layer test file was included; `worker-existing-fixture-rejection.json` retains
that result. The existing test stays unchanged. New partition-specific cases
live in their own focused test file and pass the unchanged Worker. No checker
policy or dangerous-fixture expectation was relaxed.

Reproduce with the focused test files in `tests.txt`, `node scripts/verify-layers.js`,
`npm run verify:library-types`, `node scripts/verify-catscan.js`, and
`node artifacts/ordered-boundary-repair-20261013/verify-worker.js`.
This is source/boundary evidence, not physical inference or deployment.
