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


## Catalog and execution ownership

| Field or decision | Source of truth | Reploid's copy or check |
| --- | --- | --- |
| Artifact model ID, architecture, context ceiling, quantization layout, tokenizer, tensor/shard layout and kernel/session requirements | Digest-pinned raw Doppler manifest for ordinary execution; verified signed Capsule contract and TargetPlan on the signed path | Catalog ID must match. The display context and quantization are projections, not runtime authority; verify tokenizer and data bytes against their artifact pins. |
| Artifact identity and distribution | Reploid source descriptor pins manifest, tokenizer and piece-index digests, lengths and origins; the verified piece index identifies individual ranges | Browser and native verify acquisition before use. Origins and peer claims are locators, not identity or authorization. Catalog identity duplicates the manifest digest intentionally and must agree. |
| Cut and plan | Reploid selects an ordinary cut and pins the expected digest. Installed Doppler derives canonical geometry/activation contracts from the verified manifest and computes the plan hash. A signed Doppler TargetPlan instead remains signed, unchanged contract authority. | 27B no longer duplicates expanded geometry. The laptop 2B still supplies the older single-cut field, not a v3 pin. Reject mismatches rather than refreshing an expected digest at runtime. |
| Execution controls and adapters | Doppler manifest owns supported execution semantics and compatibility; Reploid catalog/operator owns narrower load or generation choices, memory budgets, and selection of pinned adapter artifacts | A requirement cannot be overridden by a presentation field or an offer. The exact adapter set participates in the plan/route identity where applicable. |
| Model display, aliases and availability | Reploid owns labels, sizes shown, supersession, recommendations and declared execution modes | Neither a listed mode nor a peer offer is admission authority. A ready stage must first verify manifest and plan; route eligibility and recipient consent are Reploid checks and remain separate from Doppler. |

All five current catalog rows carry model-manifest, tokenizer and piece-index
pins. The catalog also retains display context and quantization for all five.
These are projections distinct from the underlying manifest; they must not be
used as substitute artifact or geometry evidence.

| Catalog row | Current host policy / remaining duplication |
| --- | --- |
| Qwen 3.5 0.8B | No declared partition cut; offers a pinned adapter choice. |
| Qwen 3.5 2B | Legacy `partitionSplitLayer: 4`; no compact v3 contract. |
| Qwen 3.8 27B | Whole model and partition; compact `splitLayers: [1]`, F32 and pinned `a000b91d…d882c`; explicit generation, load and per-stage budgets. |
| Qwen 3.6 35B A3B | Whole model; explicit generation and load settings, no cut. |
| Qwen 3.8 Flash-Next | Whole model; explicit generation, load and gather budgets, no cut. |

### Remaining pre-disclosure qualification

After execution-policy v2 (#164) is integrated on the exact candidate release,
test both browser and native requesters against an instrumented old-protocol
peer and a compatible peer that explicitly declines admission. Capture sends at
the requester and receipt/dispatch at the peers. Use distinct synthetic
canaries in the prompt, tools and response schema: **none** may appear in
either negative arm; the declining peer may see only permitted admission
metadata and a salted commitment. Check there is no retry that widens recipient
scope or downgrades to plaintext. Use one explicitly authorized, accepting peer
as a positive control to verify that the capture observes the actual payload
after admission. Archive exact client/provider versions, routes and traces.
The compact-plan tests and offline piece inventory are not this live proof.

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

To inventory the exact ranges before transferring weights, replace the weight
directory argument with `--piece-inventory`. This reads the packaged manifest
and piece index and emits the model, plan, index digest and the stage assignment
for each range. An inventory accounts for the required bytes. A receiver still
has to hash every range it actually acquires and report its source.

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
Node, the repository files, and the pinned DopplerX dependency for the catalog plan.

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
are retained on disk under the fleet host’s absolute `cacheDirectory`. Its owner
can set `maxCacheBytes` in the private host configuration. The default is 3 GiB.
For example, a dedicated cache with `"maxCacheBytes": 17179869184` allows 16 GiB
for the catalogued 27B’s 14.24 GB second stage and cache metadata. Check available
disk space and other models sharing that directory before selecting a limit. Locally staged, verified
pieces can be read directly from the owner's weight directory. The supplier's
lifetime upload allowance is a separate budget. Preserve the HTTP reservation
ID for recovery. The stage and requester signatures bind acknowledged output
deltas and counts; exact token-ID parity also needs a token trace from the
executing stage and a matched independent reference.

### Collecting token evidence on the private ordered route

Use a new conversation ID and a new receipt path for each attempt. On the first and final enrolled contributors, add `localTokenWitness` to the private fleet host configuration before starting the host. Both hosts must use the same reference file, conversation ID, requester ID and stage roster. Each writes its own local file.

```json
{
  "localTokenWitness": {
    "fixtureFile": "/absolute/path/private-split-27b-code-trace.json",
    "fixtureSha256": "850b9fde269c73ad15464744f674219a4ad94cab54e8a11471c1e3e0915a69ee",
    "receiptFile": "/absolute/private/directory/attempt-01-stage.json",
    "threadId": "qualification-REPLACE-WITH-A-FRESH-UUID",
    "requesterId": "REPLACE-WITH-THE-ENROLLED-REQUESTER-ID",
    "stageParticipants": ["REPLACE-WITH-THE-STAGE-0-ID", "REPLACE-WITH-THE-STAGE-1-ID"]
  }
}
```

On the requester, build the ordinary request as above, set its conversation ID, and retain the response headers and stream. `REQUESTER_TOKEN` is the existing private endpoint credential. `REQUESTER_URL` is its base URL without a trailing slash.

```sh
umask 077
jq --arg id "$QUALIFICATION_THREAD" '.reploid.conversation_id = $id' request.json > private-request.json
curl --fail-with-body --silent --show-error --no-buffer -D headers.txt \
  -H "Authorization: Bearer $REQUESTER_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @private-request.json "$REQUESTER_URL/v1/responses" > response.sse
```

Collect each receipt from its respective operator through an authenticated channel. Substitute the actual paths when checking the captured attempt.

```sh
node tests/fixtures/verify-private-stage-tokens.mjs tests/fixtures/private-split-27b-code-trace.json \
  headers.txt response.sse stage-0.json stage-1.json > parity.json
jq -e '.exact and .generation.maxTokens == 4 and .generation.temperature == 0 and .generation.topK == 1 and .generation.topP == 1 and .generation.repetitionPenalty == 1' parity.json
```

Stage zero records SHA-256 over the canonical JSON token array returned by the tokenizer and the prompt array consumed by its first execution step. The final stage records its actual prefill and successive sampled tokens, including the invisible stop. The two files contain counts, digests, sampling settings, and attempt bindings. Each file is created once with mode 0600. A fresh attempt needs fresh paths and a fresh conversation ID.

The verifier checks the complete HTTP route and terminal answer, the stop reason, both token counts, and both operators’ observations against the reference. Remote ordered HTTP returns aggregate step counts. The full per-token output digest comes from the final resident. For this 27B reference there are 85 prompt IDs and 3 selected IDs, including the stop. The decoded answer is `22` and the task’s correct answer is `26`. This procedure assumes an honest operator on both hosts. A matching observation establishes numerical agreement for this single execution. Physical memory eligibility, general answer quality, cancellation and settlement require their own evidence.

A deliberately length-limited control can declare `reference.stopReason` as
`max-tokens` and supply `reference.outputIds` containing exactly
`maxOutputTokens` actual selected IDs. Omit `stopId` and `visibleOutputIds`
for that case. The verifier then requires an HTTP `response.incomplete` event
with `incomplete_details.reason` equal to `max_output_tokens`, plus the
resident's `max-tokens` terminal reason. Reference fixtures with a model stop
ID still require a completed HTTP response and the actual sampled stop.
