# Doppler resident partition handoff

## Current checkout and evidence

Inspected on 2026-10-10 UTC. Re-read the linked machine-owned pin before acting;
these observations are a checkpoint, not a new release or qualification.

| Identity | Observed state | Source |
| --- | --- | --- |
| Checkout dependency | Standard `doppler-gpu` 0.6.23; installed package also reports 0.6.23 | [Package pin](../self/config/doppler-package.json), [lockfile](../package-lock.json) |
| Candidate under investigation | The checkout dependency is the working candidate; no retained record here closes its full numerical/application gates. The older 0.6.21 candidate remains a dated result. | [Recovery qualification record](../artifacts/recovery-20261009/README.md) |
| Last accepted full distributed configuration | None established by the cited qualification record. Its 0.6.19 Linux restart control passes, but both-direction frozen comparisons fail the unchanged 0.001 gate. | Same recovery record and its original receipts |
| Last verified public delivery | `replo.id` returned Doppler 0.6.11 and bundle `sha256:6f03c7424faf3fa2ba74efe6ebdef729a342abe211767f29966bac7575006d07` over HTTP 200 | [Served package pin](https://replo.id/config/doppler-package.json), [served bundle manifest](https://replo.id/config/browser-bundle-manifest.json) |

The public package-pin bytes hashed to
`3971246c07fb128f26ee76fcb3efac481ca896d6fd3aa3d4e1007a11904b8b20`;
the served bundle-manifest bytes hashed to
`bac732dd2b4d0d6681ce812697cc989ab1360aa01ef8320b6f2f51d429189e21`.
This verifies served identities, not successful fresh-client execution. It does
not establish the public source commit or qualify the checkout for deployment.

Partition execution, selective piece loading and two-physical-computer runs are
implemented. Numerical qualification and repeatable ordinary-application
acceptance remain open. The [conversation contract](chat-mvp.md) distinguishes
these categories. Preserve generation, scoring, memory repairs, model bytes,
precision and the frozen reference; keep the 0.001 gate unchanged.

The material below records earlier instructions and failures with their original
package/source identities. Its split.13 preservation and 0.6.4 investigation
instructions are historical, not the current dependency policy. Use one ordinary
Doppler package through public APIs; historical archives serve regression and
rollback only. A dependency version is not a separate runtime development track.

## Dated split.13 development checkpoint

This records the user's selected Reploid/Doppler work and takeover constraints.
It does not replace either repository's goals, component ownership, or acceptance
receipts. The numerical source checkpoint is Doppler `f0bd469b`; the reported UI
deployment is Reploid `787aeb78`. The decision and package-isolation sections below
record identified physical executions; the UI deployment was not rerun.

### Product goal and boundaries

Deliver useful, dependable intelligence: generation, retrieval, and typed
decision/scoring operations. Doppler makes model capabilities usable software
components. Reploid combines models, storage, computation, tools and agents across
participants, preserves work, and independently evaluates improvements. Distributed
generation remains a concrete milestone: requesters hold no model weights,
executors selectively acquire verified pieces, and physical devices jointly
produce complete answers. Isolate conversation state, keep cancellation independent,
make recovery explicit, and preserve the current resource budgets.

Doppler owns computation, model mathematics, partition/state semantics, sampling
and stopping. Reploid owns discovery, acquisition coordination, placement,
permissions and conversations through its existing mesh/Poolday interfaces.
Artifact verification and model dependencies remain Doppler-defined. The user has
explicitly brought decision models and scoring into scope alongside generation
and other inference. Task-quality screening and qualification precede adding a
model or operation. Speculative catalog expansion, scheduler experiments and
architecture expansion remain deferred.
Doe's generation experiment stays closed. Dependable delivery does not require
Doppler to adopt Doe.

### Shared end-to-end delivery

Select a useful task and frozen outcome criteria. Compare suitable generation and
decision/classification/scoring implementations against competent alternatives;
choose by task quality, acquisition, memory, latency and integration cost. Extend
Doppler's existing public execution/Capsule contracts for the selected operation,
with defined output and score interpretation, identity, cancellation and cleanup.
Uncalibrated scores do not become correctness probabilities.

Compose these capabilities in Reploid's existing conversation/agent lifecycle:
understand the objective, retrieve relevant context, judge eligible choices,
generate or execute the selected action, inspect the outcome and preserve results.
Permissions and resource eligibility stay in code. Run locally or on authorized
participants when contribution improves capability, availability or total cost.
Small decisions need not incur peer coordination. Model math remains Doppler-owned.

Evaluate completed tasks against strong local and comparable centralized controls.
Use retained observations to propose improvements to prompts, tools and policies;
independently evaluate, adopt under grants and retain rollback. Test improvement
on unfamiliar work and distinguish successful adoption from causal recursion.
Standalone Doppler product work does not depend on resolving the partition
replacement gate. The package diagnosis below gates that replacement specifically.

### Implemented typed-decision connection

The [installed decision acceptance](../artifacts/doppler-choice/README.md) now
records real signed Capsule execution through the public libraries in Node and
browser WebGPU, followed by actual WebRTC delivery to a weightless requester.
All twelve reviewed relevance decisions pass against an independent CPU reference.
Cancellation, resident reuse, receipt verification and cleanup pass in their
identified fixtures. These are whole-request decisions on one physical machine,
with uncalibrated scores and local test release metadata. The injected public
operation does not change the app's split.13 pin or close the numerical,
selective-acquisition, public-release or cross-device partition gates below.

The [peer-custody decision receipt](../artifacts/doppler-choice/custody-summary.json)
additionally records verified OPFS supplier storage, origin-blocked executor
acquisition, corruption rejection and supplier-departure recovery. Both suppliers
close before all twelve decisions execute for a weightless requester. Two fresh
runs pass on one machine. This qualifies the identified whole-request decision
journey, not selective partition acquisition or the separate chat-model failure.

### Doppler: trace the package difference before upgrading Reploid

Start at [the recurrent-state controls receipt](https://github.com/clocksmith/doppler/blob/f0bd469b/tests/fixtures/partition-recurrent-state-controls-evidence.json).
Original `0.6.3-dev.split.13` matches all 55 frozen-reference steps exactly when
both partitions execute on the Mac. The unchanged installed `0.6.4` candidate
fails 16/55 in that same placement, with maximum difference about `0.001768`.
This does not identify the implementation responsible or prove the reference
wrong. Cross-platform arithmetic alone cannot explain this package-dependent
failure. Locate the earliest differing operation before another substitution.

The [local entry-point isolation](https://github.com/clocksmith/doppler/blob/main/tests/fixtures/partition-package-entry-evidence.json)
now identifies that boundary for the first retained prompt on Linux. Embeddings
match exactly. Split.13 silently selects `main_subgroup` for input normalization;
the candidate honors the manifest's declared `main`. Shader bytes and constants
match. Two unchanged split.13 runs and an identity substitution match exactly.
Changing only the old package's normalization entry point to `main` reproduces
the candidate's logits and all 11,070 captured tensors exactly. The baseline versus
candidate logit maximum is `0.0015213489532470703`. Independent Float64 checks on
the identical observed embeddings find comparable normalization accuracy, not
evidence that the legacy trajectory is mathematically superior.

This is a test-only entry-point substitution, not a production arithmetic change.
It uses an older local reference with a different hash from the latest frozen
55-step reference. It does not resolve that reference's acceptance or establish
both physical directions. Preserve manifest enforcement, the frozen gate and the
Reploid pin; do not restore silent entry-point replacement to recover old output.

Compare exact archive/source/shader identities and matched execution settings.
Keep upstream projection and normalization unchanged during isolation. Preserve
the frozen reference and require both unchanged physical model directions within
`0.001`; matching tokens and stopping does not satisfy the numerical gate.

The controls include single-step reference-state resets and continuous GPU-state
replay on both platforms. Resetting state reduces accumulated state error while
output error stays similar. Continuous replay matches uninterrupted execution.
Independent calculations use pinned Float64 model equations; production precision
is unchanged. Captured recurrent controls cover nineteen layer-zero prefill tokens,
not arbitrary continuations.

### Narrow causal experiments and rejected candidates

Keep the existing conditional reference owner. Separate inherited operand error
from local arithmetic error. Decay already has an individual intervention; beta
and output gating still need independent selection if the package investigation
justifies them. Composite normalization/gate interventions identify combined
effects only. Compute a normalization replacement from the device's captured raw
output; an inverse-square-root-only intervention must use its captured denominator
without changing the preceding reduction. Require a nonperturbing observation and
an identity-substitution control preserving output and recurrent state. Prioritize
demonstrated downstream improvement, not error magnitudes on different scales.

Readout compensation improved aggregate independent output error on both GPUs
without changing state, but failed 20/55 forward and 17/55 reverse model comparisons;
maximum differences were about `0.002387` and `0.001814`. Memory-projection
compensation reduced state RMS error but failed 23/55 forward and 15/55 reverse;
maxima were about `0.003901` and `0.002094`. Reference-rounded decay slightly
worsened output accuracy. These remain separate rejected experiments. Do not
combine them or promote them as repairs. The earlier compensated-dot rejection
also stands for that candidate.

### Reproduction and archive custody

Use [recurrent-state-controls.js](https://github.com/clocksmith/doppler/blob/f0bd469b/tests/integration/recurrent-state-controls.js)
and [installed-reploid-acceptance.js](https://github.com/clocksmith/doppler/blob/f0bd469b/tests/fixtures/installed-reploid-acceptance.js).
Test substitutions require `DOPPLER_TEST_ONLY_ARITHMETIC=1` and exact shader hashes;
they are diagnostics, not installed-package acceptance. Supply the current
authorized Playwright endpoint through `REPLOID_EXECUTOR_WS`. Do not assume the
Mac's loopback tunnel exists on Linux or manufacture another endpoint.

The unpublished archive is `dist/0.6.4-candidate/doppler-gpu-0.6.4.tgz` in Doppler.
Raw captures and controls are ignored artifacts under
`dist/0.6.4-candidate/recurrent-state-controls/`. Obtain them from the Mac and
verify inventory hashes before replay. Git summaries are not the operand captures.
Retain failed observations and distinguish diagnostic tensor forwarding from
actual WebRTC acquisition.

### Numerical promotion, memory and Reploid acceptance

Test one causally identified correction at an actual failing model boundary,
then rerun both unchanged full-model directions before broader kernel changes.
Require independent-reference improvement and the complete numerical gate.
Reploid remains pinned to split.13 until an exact replacement archive qualifies.

Earlier memory acceptance passed repeated 1,588-token prompts within
1,420,000,000 allocated bytes, including lifecycle checks. Rerun it only after
numerical promotion, against the exact replacement archive. These are owned
allocation budgets, not physical GPU-residency measurements. Preserve cancellation
settlement, resident reuse, rejection cleanup, and explicit device-loss outcomes.

Then repeat ordinary onboarding, selective acquisition, full streaming and
stopping, concurrent isolated conversations, cancellation, contributor loss,
explicit fresh-attempt retry and recovery with weightless requesters. Do not imply
stateful continuation merely because a replacement owns the weights. Preserve
the unexplained missing-piece acquisition failure: atomic inventory replacement
did not establish its physical cause. Retain acquisition, storage, memory,
communication and complete-delivery costs separately. Cross-device execution
and genuinely capacity-enabling placement remain different milestones.

### Reploid UI handoff and current operating constraints

The user reports deployment at `https://replo.id` from `787aeb78`, with HTTP 200
and all 8,374 manifest-listed files matching the local build. Focused code tests
passed. These are supplied deployment-integrity/behavior results, not renewed
visual approval or comprehensive runtime qualification.

The reported Mac checkout is `/Users/xyz/deco/reploid`, branch `main`, with an
existing server at `http://localhost:8000/`. The current agent's Linux checkout
is `/home/x/deco/reploid`; do not treat the Mac path as a local directory.
Leave the existing server and unrelated processes alone. Continue UI work through
source inspection: the user stopped browser checks and prohibited screenshots.

Refine concrete user feedback before expanding scope: restrained consistent
neumorphism, clear alignment, compact controls, and the execution ribbon centered
in the top app bar between logo and settings. Its earlier conversation placement
is corrected and covered by a regression test. Header lifecycle ownership is in
[`index.js`](../self/ui/pool-home/index.js), markup in
[`view.js`](../self/ui/pool-home/view.js), and projection/interaction in
[`execution-ribbon.js`](../self/ui/pool-home/execution-ribbon.js).

The ribbon follows the selected thread's latest attempt and assigned executors;
discovered peers are not execution participants. Put model labels above executors.
Details expose participants, layers, available measurements and a collapsed
timeline. Missing measurements stay explicit. Output animation follows observed
response updates and respects reduced motion.

Appearance settings are System, Light and Dark in the top-right popover; choosing
one dismisses it. Changes also lives there. The logo returns to Work; Network
remains contextual. Keep dark depth `0.64` and light depth `0.6`, neutral switch
gradients and shared depth shadows. Composer spacing and Network field alignment
are already corrected. Preserve drafts, disclosure permissions, automatic discovery,
optional model downloads, selected-thread isolation and the Doppler pin. UI
deployment does not resolve numerical qualification or physical acquisition.

Numerical handoff: component `doppler.tests`; intent preserved; acceptance evidence
is physical controls, focused reference/normalization regressions and
architecture/style checks. No production arithmetic changed.

This docket update: component Reploid documentation; intent preserved; boundary
effects none beyond documented task ordering. Physical and browser tasks above
are pending work, not execution performed by this documentation change.

## Earlier interface and qualification checkpoint

The following preserves the earlier session contract and linked checkpoint
evidence. Its observations remain bounded to those specific receipts; the current
docket above controls task order and records subsequent numerical/UI handoffs.

Reploid consumes an explicit resident-partition API. The original Reploid
increment did not change Doppler. Subsequent numerical work is tracked in
[Doppler's resident partition execution record](https://github.com/clocksmith/doppler/blob/main/docs/distribution/resident-partition-execution.md)
and its [retained local diagnostic](https://github.com/clocksmith/doppler/blob/main/reports/resident-partitions/20260927/README.md).

That work adds bounded GPU layer execution, assigned-layer cache allocation,
the resident factory, and attempt-owned continuations. It compares a real model
split with unsplit execution on one local GPU. Signed partition qualification
now gates Capsule opening in Doppler source, but public acquisition and real
model execution through this browser path have not passed end-to-end acceptance.
Keep the injected arithmetic fixture identified as such until the conformance
harness and browser path pass with real residents.

This is the contract consumed from the pinned Doppler archive, not a claim of
physical network qualification. `doppler-gpu/partitions` exports the resident
factory, plan digest, activation, and comparison contracts. The factory opens
through the verified Capsule path; accepted signed TargetPlan evidence must
qualify the exact partition plan and index. The minimal Capsule root remains
independent of the partition implementation.

## Ownership

Doppler owns model/artifact verification, partial weight dependencies, GPU state,
chat templates/tokenization, layer execution, logits, sampling and stopping.
Reploid owns contribution lifecycle, eligibility, signed attempt grants, peer
identity binding, transfer, ordering, replay rejection, conversation history and
cancellation settlement. Neither library can attest that an arbitrary browser
executed honestly.

The first integrated placement is fixed: the input-owning participant executes A
locally; an authenticated contributor executes B remotely. Both must explicitly
prepare their residents. A third requester, more than two partitions, automatic
placement and split LoRA execution are outside this API version. Existing
whole-request and adapter paths remain available independently.

## Exact factory interface

Canonical types: [resident-partition.d.ts](../packages/reploid/src/mesh/partitions/resident-partition.d.ts).
Existing step types: [partition-runner.d.ts](../packages/reploid/src/mesh/partitions/partition-runner.d.ts).

```js
const session = await factory.openResidentPartition({
  model,          // exact id, manifest identity and host-pinned source descriptor
  plan, planId,   // Doppler plan; planId = hashLayerPartitionPlan(plan)
  index,          // 0 or 1
  participantId, // orchestration identity, not runtime authorization
  limits,         // output/prompt/activation/attempt/concurrency allocation ceilings
  signal,
});
```

`getDescriptor()` must synchronously return:

```js
{
  schema: 'doppler.resident-partition/v1',
  ready: true,
  modelId, modelIdentity, planId, index,
  layerRange: [firstLayer, lastLayer],
  residentWeightBytes, // owned weight allocation; not physical VRAM usage
}
```

Only return ready after the assigned weights and executable session exist. The
model identity must come from verified loaded artifacts. Validate the plan
against the artifact before acquisition or execution. Reploid checks identities
and readiness again around every operation.

Tokenization returns resolved Doppler `generation` settings with the prompt
tokens. Reploid binds their digest to the signed attempt grant and forwards the
same settings through A, activation metadata, and remote B. Each step carries
the effective `maxTokens`, which can be below the allocation ceiling. Doppler
finalizes its incremental decoder and returns `done` with its last delta at
that limit. Reploid rejects missing, changed, or over-budget limits and settings.
Partition B receives prompt token context for Doppler's repetition and presence
penalties only under a separate approval scope that names token disclosure;
the earlier activation-only approval cannot authorize this transfer.

All sessions expose idempotent asynchronous `closeAttempt({identity})` and
`close()`. The first settles submitted work and disposes only that attempt's
KV/recurrent state. The second settles all work and releases owned model/session
resources. Cancellation may not terminate submitted GPU work immediately.

A additionally exposes:

```js
await session.tokenize({ messages, identity, signal });
// -> { modelIdentity, tokenIds, generation } using the exact model tokenizer
await session.executeGroup0({
  tokenIds, continuation, identity, step, tokenPosition, inputTokenCount, maxTokens,
  generation, executionGrant, signal,
});
// -> { activationTensor: { shape: [1, inputTokenCount, hiddenSize],
//      dtype: 'f32' /* or plan f16 */, data, step, seqOffset: tokenPosition },
//      continuation }
```

B exposes:

```js
await session.executeGroup1({
  activation, continuation, identity, step, tokenPosition, inputTokenCount, maxTokens,
  generation, inputTokenIds, executionGrant, outputGrant, signal,
});
// -> { identity, step, tokenPosition, tokenId, delta, done, stopReason,
//      continuation, logits? }
```

`activation` is the result of the existing Doppler
`deserializeActivationFrame`. B executes its assigned late layers, final norm and
output head, then selects **one** token. It returns that token even for a terminal
step; terminal steps require a stop reason. `delta` contains decoded incremental
text. Optional logits support qualification and remain at B in the network path.
No result may contain an independently generated `content` or `tokenIds` batch.

Continuation must be bounded, JSON-safe data or `null`, not GPU resources or
weights. Device state stays in the session, keyed by complete attempt identity.
Different threads never share mutable generation state. Reused, closed, changed
or out-of-order attempts must fail closed. Reploid supplies additional replay
protection but the runtime must protect its own public entry.

The signed grant fields are host authority metadata. They are not model settings
and must not change math. Sampling/stopping and precision must follow the exact
runtime/model execution contract and be identical for the split and reference
runs. Unsupported architectures or dependencies crossing the split must fail
explicitly. Do not secretly execute a complete model on either participant.

## Selective acquisition work to complete in Doppler

The loader accepts `{ partition: { plan, index } }`, keeps original layer
indices, selects assigned decoder layers/endpoints, and disables out-of-partition
prefetch. The resident session uses assigned-layer attention state. Shared/tied
weights still need explicit accounting and dependency packaging.

Artifact verification can still read whole shared shards containing unrelated
layers. Partial materialization is not selective acquisition. Preserve signature
and hash verification while solving dependency acquisition; record which weights
and artifacts each resident actually owns/reads.

## Reploid composition

Public exports from `reploid/mesh`:

- `createResidentPartition`: wraps the factory; `prepare({approved:true})` opens
  once, while chat never downloads or prepares a missing resident.
- `createPartitionGrantAuthority`: signs and verifies attempt-scoped grants bound
  to mesh, model, plan, thread, attempt, both participants, expiry and budgets.
- `createPartitionPeer`: combines binary RTC framing, current authorization,
  receiver ordering and acknowledged attempt settlement.
- `createPartitionNetwork`: opens the dedicated `reploid-partitions` channel only
  after the existing certificate-bound mesh signing identity proof. The Work host
  exposes `swarm.createPartitionNetwork(options)` using its existing verifier.
- `createPartitionChat`: composes local A and remote B through the existing runner.
  Pass it as `partitions` to `createChatSession`. Its model selection binds the
  placement; an unavailable split never falls back to whole-model execution.

Create the authority with the same signing identity as the connected swarm.
Create both residents from the same pinned model/plan, explicitly prepare each,
then connect a peer endpoint. On A, create the chat adapter and call its `refresh`
method to populate readiness. The host owns residents, network and authority;
closing chat settles attempts without unloading those borrowed resources.

No new boot-time runtime import or automatic contribution is installed. Supply
the factory at host composition with a Capsule and signed partition
qualification. Calls fail closed when `openResidentPartition` is absent.

## Executable acceptance

- [API and lifecycle tests](../tests/unit/partition-api.test.js) exercise signed
  grant tampering, scope, expiry, revocation, readiness, resident reuse and chat.
- [Two-tab browser integration](../tests/e2e/partition-chat.spec.js) uses real RTC
  certificates, signing proofs, grant signatures and binary transfer, including
  concurrent threads, scoped approval reuse, revocation, settlement, peer loss and
  restored history. Its arithmetic executor is injected; it proves no model math.
- [Runtime conformance harness](../tests/contracts/doppler-partition-session.js)
  accepts a real factory, codecs, model/plan, messages, limits, explicit tolerance,
  and an independent unsplit reference callback. The callback returns
  `{modelIdentity, content, steps:[{tokenId, logits}]}`. It compares every selected
  token/logit vector and the stopping point, then settles both residents.

The [installed same-machine conformance receipt](../artifacts/partition-resident/20260927/README.md)
uses real resident sessions through that harness. The adjacent real two-tab
browser receipt exercises ordinary chat, concurrent threads, and cancellation
through authenticated RTC with real residents. Both diagnostic paths load the
identified local model through installed Doppler internals. Signed public
Capsule acquisition remains unqualified, as do separate devices and capacity
pooling.

An [installed synthetic signed-opening check](../artifacts/partition-resident/20260927/installed-signed-opening.json)
passes through the public resident factory and rejects the unqualified partition
index before program creation. It has no executable model and does not replace
the real chat Capsule acquisition gate.

Run the numerical harness on exact identified model bytes before replacing the
browser fixture with real execution. Record actual allocated weights/cache,
artifact reads, per-token comparisons, frame costs, and the browser/GPU/runtime
identity. A passing mock or a descriptor is not numerical or memory proof.
Physical multi-machine and capacity-pooling qualification remain separate from
the current local-tab phase.

The current connected qualification target uses separate tabs or browser windows
on this same machine. Compare the installed package unsplit and split there,
including concurrent conversations, cancellation and participant loss. Separate
participant identities do not establish separate physical GPU capacity.

## Output-limit correction

The [retained execution report](../artifacts/partition-limits/20260927/report.json)
records effective-limit propagation, immutable per-attempt limits, rejection of
unfinalized length stops, same-machine two-tab transport, and installed-package
checks. Browser computation remains injected. The first parallel authorization
to finish may acquire the first token lease; the test checks alternating leases
without assuming signature verification finishes in thread-creation order.

Component: Reploid partition coordination.
Intent: preserved.
Acceptance evidence: the report links executed unit, browser and installed-package
results; library types, delivery and CATSCAN checks pass.
Boundary effects: partition step declarations, authenticated peer protocol,
generated browser delivery, and the Doppler consumer contract. Peers lacking the
effective request limit fail closed. This earlier report predates the resident
factory and dependency update described above.

## Takeover checkpoint

Component: Reploid documentation and Doppler integration boundary.
Intent: preserved.
Acceptance evidence: `npm run verify:catscan` and
`npx vitest run tests/unit/partition-api.test.js tests/unit/surface-claim-index.test.js tests/unit/catscan.test.js`;
retained logs are in the linked Doppler diagnostic.
Boundary effects at that checkpoint: documentation only. The pinned archive is
updated in the current integration work; the browser arithmetic fixture remains.

*Interface checkpoint: September 2026. Current docket: October 2026.*
