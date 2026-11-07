# Public partition admission

Poolday's catalog and public text API admit distributed routes only when a current
ready/busy route matches an entry in `apps/poolday/config/partition-releases.json`.
The checked-in policy is owner-reviewed release authority, not discovery data.
An empty `approvals` array admits no public partition routes. Whole-model providers
are unaffected; low-level partition qualification tools remain separate.

An approval records `modelId`, `modelIdentity`, sorted `adapterIdentities`, the exact
`partition` descriptor, and an `evidence` reference to reviewed release receipts.
Changing the artifact, adapters, plan or participant/stage bindings requires a new
review. Do not populate this policy from a peer's `ready` or `qualified` claim,
a model's declared execution modes, single-device results, or test-signing receipts.
Public signing and the applicable numerical, quality and lifecycle gates must be
satisfied before an approval is added. The reference documents that review; runtime
matching does not rerun qualification or establish correctness by itself.

The host filters choices before the UI renders them. A saved partition selection
is checked again before dispatch, including after asynchronous accounting admission;
a changed or missing route fails explicitly rather than substituting another model
or provider. Completed-answer records remain historical execution evidence.
