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

For a physical two-stage acceptance run, keep both contributor processes alive
while reviewing the advertised route. Configure each contributor's
`ordered.stage` with its model, index, resident ID and execution ID. Use
`ordered.stage: null` on a third connect-only requester, with the same ordered
limits. The requester still needs the pinned local `manifest.json`. Review the
complete route in the native host's `{"op":"state"}` output against the enrolled
computers. Keep the API's single approval for that roster and pin
`textApi.allowedRecipients` to the two stage providers. One can restart the
requester with the reviewed configuration while the contributors remain up.
Recheck its state and the authenticated `GET /v1/models` listing afterwards.

To prepare the HTTP request without sending anything, save the state result
and listing as JSON. Use a frozen prompt fixture containing `modelId`,
`messages` and `maxOutputTokens`.

```sh
node tests/fixtures/private-split-request.mjs requester.json state.json models.json prompt.json > request.json
```

Run the offline fixture checks with
`node --test tests/fixtures/private-split-request-check.mjs`. The checks
cover an accepted split, a replaced stage executor, a whole-model-only listing,
two approved rosters sharing the selection ID, a requester assigned to a
stage, and a reference bound to a different model or plan. The positive case
parses the resulting body through the Responses handler. These checks require
only Node and the repository files.

The resulting body is for `POST /v1/responses`. Its terminal response includes
the requested execution evidence in `response.reploid`. The request binds the model,
plan, adapter set and permitted identities. The third requester receives its
own output. Its key therefore also appears in the request's disclosure list.
The qualified route and server allowlist bind just the two compute providers.
The normal API checks the route again when it dispatches the request.

The [27B code-trace fixture](../tests/fixtures/private-split-27b-code-trace.json)
includes the exact messages and greedy tokens measured by the independent
Transformers reference over the retained Q4 weights. The reference prints 22
for a calculation whose correct answer is 26. Record numerical agreement and
task accuracy separately. Compare the executing stages’ prompt IDs and output
IDs, including the stop token, before claiming token parity.

Account for both stage storage and GPU memory. Network-fetched partition pieces
are retained in the native cache with its configured storage limit. Stage 1 of
the catalogued 27B needs more than the default 3 GiB. Locally staged, verified
pieces can be read directly from the owner's weight directory. The supplier's
lifetime upload allowance is a separate budget. Preserve the HTTP reservation
ID for recovery. The stage and requester signatures bind acknowledged output
deltas and counts; exact token-ID parity also needs a token trace from the
executing stage and a matched independent reference.
