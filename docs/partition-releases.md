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


## Checking a memory-expanding private split

For the catalogued untied 27B plan, run the offline source qualification on a
computer already holding its weight files:

```sh
node tests/fixtures/partition-source-preflight.mjs qwen-3-8-27b-text-q4k-ef16-af32 "$WEIGHTS"
```

This validates the installed Doppler plan and catalog identities, counts each
stage's tensor spans, verified pieces and whole shard files, and reads a bounded
sample from each stage through the native verified storage reader. Each sample
opens with the other stage's shard absent. The fixture uses sparse scratch files
and leaves existing weights untouched.

On each proposed contributor, record physical GPU heaps, binding limits, shader
features, active services and the result of a normal whole-model open with the
same identity, context and decoding settings. A shared-memory adapter's binding
limit applies to one buffer. Doppler can divide a large embedding across several
buffers. An operator-selected allocation cap or other work occupying the GPU does
not establish a physical limit.

After verifying both whole-model limits, configure the enrolled requester with
the exact approved ordered route and stage credit weights as described in
[the fleet API guide](fleet-service.md). Request the split selection shown in its
authenticated `GET /v1/models`. Compare greedy token IDs to the frozen reference,
record the model/plan and both physical stage identities, then interrupt a new
stream and drop a stage in a separate request. Check the stage cleanup,
reservation outcomes, and a subsequent successful request on the surviving
provider when the route is available again.
