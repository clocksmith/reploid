# Doppler resident partition handoff

Reploid consumes an explicit resident-partition API. The original Reploid
increment did not change Doppler. Subsequent numerical work is tracked in
[Doppler's resident partition execution record](https://github.com/clocksmith/doppler/blob/main/docs/distribution/resident-partition-execution.md)
and its [retained local diagnostic](https://github.com/clocksmith/doppler/blob/main/reports/resident-partitions/20260927/README.md).

That work adds bounded GPU layer execution and assigned-layer cache allocation.
It compares a real model split with unsplit execution on one local GPU. It does
not yet implement this resident factory, attempt-owned continuations, signed
Capsule partition delivery, or real model execution through this browser path.
Keep the injected arithmetic fixture until the conformance harness below passes
with real residents.

This is a **proposed consumer contract**, not an assertion that a published
Doppler version implements it. Existing `doppler-gpu/partitions` supplies plan,
activation and comparison contracts. The missing export is a factory exposing
`openResidentPartition`. Keep the minimal Capsule root independent; a dedicated
public subpath may expose the implementation.

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
  plan, planId,   // Doppler plan; planId = await partitionFingerprint(plan)
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

Each step carries the effective request `maxTokens`, which can be below the
allocation ceiling. The runner preserves it through A, the activation metadata,
and remote B. Doppler must finalize its incremental decoder and return `done`
with its last delta at that limit. The runner rejects an unfinalized final step
instead of silently discarding pending text. The peer rejects missing, mismatched,
or over-budget limits. Other effective generation settings still require binding
through the resident contract before complete session parity can be claimed.

All sessions expose idempotent asynchronous `closeAttempt({identity})` and
`close()`. The first settles submitted work and disposes only that attempt's
KV/recurrent state. The second settles all work and releases owned model/session
resources. Cancellation may not terminate submitted GPU work immediately.

A additionally exposes:

```js
await session.tokenize({ messages, identity, signal });
// -> { modelIdentity, tokenIds } using the exact model chat template/tokenizer
await session.executeGroup0({
  tokenIds, continuation, identity, step, tokenPosition, inputTokenCount, maxTokens,
  executionGrant, signal,
});
// -> { activationTensor: { shape: [1, inputTokenCount, hiddenSize],
//      dtype: 'f32' /* or plan f16 */, data, step, seqOffset: tokenPosition },
//      continuation }
```

B exposes:

```js
await session.executeGroup1({
  activation, continuation, identity, step, tokenPosition, inputTokenCount, maxTokens,
  executionGrant, outputGrant, signal,
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

## Existing loading work to complete in Doppler

The candidate loader already accepts `{ partition: { plan, index } }`, keeps
original layer indices, selects assigned decoder layers/endpoints and disables
out-of-partition prefetch. Connect it to executable resident sessions. Allocate
only the assigned KV/recurrent state, and explicitly handle shared/tied weights.

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
this factory at host composition after Doppler implements it. Calls fail closed
when `openResidentPartition` is absent.

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
effective request limit fail closed. This does not qualify the missing Doppler
resident factory or update the Doppler dependency.

## Takeover checkpoint

Component: Reploid documentation and Doppler integration boundary.
Intent: preserved.
Acceptance evidence: `npm run verify:catscan` and
`npx vitest run tests/unit/partition-api.test.js tests/unit/surface-claim-index.test.js tests/unit/catscan.test.js`;
retained logs are in the linked Doppler diagnostic.
Boundary effects: documentation only; the pinned Doppler archive and browser
arithmetic fixture remain unchanged.

*Last updated: September 2026*
