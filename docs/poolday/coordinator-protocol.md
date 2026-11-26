# Coordinator protocol (journeys retired 2026-11-26; code remains on specialist routes)

This page describes the hosted coordinator lane: requesters, browser providers
and the coordinator exchanging signed jobs, receipts, audits and reputation
events. Its user journeys were
[retired on 2026-11-26](../critical-user-journeys.md#archived-poolday-coordinator-lanes).
The code stays in `apps/poolday/pool/`, `server/pool/` and `shared/pool/` and is
reached from the specialist routes (`/ask`, `/compute`, `/records`, `/room-1`).
It is not the conversation workspace at `/`, and it is not `/zero` or `/x`.

Relay delivery, envelope fields and fault handling are in the
[P2P envelope protocol](p2p-envelope-protocol.md).

## Threat model

The lane is audited as a browser inference control plane. It is not a
marketplace: account transfers and marketplace trading are disabled
([product specification](../product-specification.md#3-credits-and-marketplace)).

### Protected assets

- model artifact identity
- adapter pack, publication, promotion, and revocation identity
- requester approval for adapter use
- prompt hash and generation config hash
- provider receipt signature
- requester acceptance signature
- commit and reveal evidence
- receipt agreement hash
- points and reputation events
- provider admission state

### Adversaries

- dishonest provider returning fabricated output
- provider that commits and then refuses to reveal
- provider that reveals after seeing another output
- requester that refuses to accept a valid quorum
- requester that submits secrets to public providers
- colluding provider group
- sybil provider group
- signaling relay that injects or withholds metadata
- artifact host serving wrong bytes
- peer serving corrupt or substituted adapter bytes

### Trust boundaries

Browser execution is not hardware-attested. The protocol therefore treats
provider output as a claim until it is checked by deterministic comparison,
quorum, canary, challenge, or reputation history.

Servers can help with discovery, signaling metadata, rate limiting, and abuse
filtering. Servers should not be the final authority for model identity,
receipt validity, quorum acceptance, or reputation truth when signed peer
artifacts exist.

### Required evidence

An accepted result should be reconstructible from:

- signed intent
- signed provider adverts
- assignment plan
- commitment events
- reveal events
- provider receipts
- requester acceptance
- reputation events
- model and manifest hashes
- adapter pack, publication, requester approval, and acquisition-source hashes when used
- deterministic generation config

## Receipt schema

The receipt is the lane's central artifact. It is a provider claim until
verifier checks, quorum agreement, and requester acceptance attach to it.

### Provider receipt

Required fields:

- `receiptVersion`
- `signatureDomain`
- `assignmentId`
- `jobId`
- `requesterId`
- `providerId`
- `policyId`
- `model.id`
- `model.hash`
- `model.manifestHash`
- `model.runtime`
- `model.backend`
- `runtime`
- `inputHash`
- `generationConfigHash`
- `outputHash`
- `tokenIdsHash`
- `transcriptHash`
- `verification.runtimeProfileHash`
- `providerSignature`

Provider signatures use the `poolday.provider_receipt.v1` domain.

When an assignment requests an adapter, the receipt also binds the adapter pack
and the evidence that made it routable; the gate and its receipts are defined in
[Trained adapter promotion](../trained-adapter-promotion.md). Adapter
publication, requester approval, and revocation use separate signature domains.
They are not inferred from the provider receipt.

For `sequence.embedding.v1` or `sequence.masked_logits.v1`, the receipt also
requires:

- `sequenceResultHash`
- `sequence.schema`
- `sequence.workload`
- `sequence.alphabet`
- `sequence.sequenceHash`
- `sequence.requestHash`
- `sequence.resultHash`
- hashes for each requested output class

The raw sequence, pooled vector, token vectors, and logits are not receipt
fields. Requested outputs travel to the requester through the assignment's
WebRTC DataChannel. Redundant agreement and commit-reveal use
`sequenceResultHash`.

### Requester acceptance

Requester acceptance is a separate artifact. It must not be conflated with
provider receipt creation.

Required fields:

- `signatureDomain`
- `receiptHash`
- `requesterId`
- `accepted`
- `acceptedAt`
- `requesterSignature`

Ring acceptance also binds:

- `jobId`
- `policyId`
- `policyConfigVersion`
- `policyConfigHash`
- `receiptHashes`
- `agreementHash`
- `pointSpend`
- `providerPoints`

Requester signatures use the `poolday.requester_acceptance.v1` domain.

## Reputation ledger

Reputation is event-sourced. Reducers produce views, but direct score mutation
is not the source of truth.

### Event types

- `reputation_seed`
- `provider_advertised`
- `assignment_accepted`
- `commit_received`
- `reveal_received`
- `receipt_validated`
- `quorum_match`
- `quorum_mismatch`
- `canary_passed`
- `canary_failed`
- `challenge_passed`
- `challenge_failed`
- `requester_accepted`
- `requester_disputed`
- `timeout`
- `stale_assignment`
- `policy_violation`

### Reducer rule

```text
reputation_v1(events) -> provider reputation view
```

The reducer must be:

- deterministic
- versioned
- idempotent under duplicate gossip
- stable under harmless event reordering
- able to quarantine repeated identity or policy failures

Reputation can be global, per-model, per-runtime bucket, or per-policy. The
active view must state which scope it uses.

### Hosted implementation

Hosted reputation mutations append category `reputation` events to
`pool_events`, then rebuild the provider's `reputation_state` projection with
`poolday.reputation.reducer.v1`. Accepted receipts, rejected receipts,
timeouts, canary outcomes, and delayed challenge outcomes use this path. A
provider with pre-event-source counters receives one `reputation_seed`
migration event before its first new event. Reusing an event id is idempotent
under replay.

`reputation_state` is a scheduler-facing projection, not the source of truth.
Audit quarantine uses deterministic unresolved failure balances; it does not
depend on Firestore query order or random event-id ordering.

These reputation points are local protocol records. They are not the service
credits of the current product.

## Canary and challenge policy

Canaries and challenges turn receipts into audit-backed evidence.

### Canary types

- fixed prompt deterministic output canary
- known token sequence canary
- model-load canary
- runtime-profile canary
- latency sanity canary
- quorum disagreement canary
- delayed challenge rerun
- non-routable adapter runtime canary

Adapter runtime canaries use a separate signed publication and Firestore
collection. They bind custody, exact base identity, runtime integrity, and one
browser receipt. They never enter provider discovery, job routing, requester
approval, or adapter promotion.

### Challenge policy

Coordinator-authorized callers create a delayed rerun with:

```text
POST /pool/audits/challenge
{ "receiptHash": "sha256:...", "providerId": "optional-provider-override" }
```

The coordinator loads the prior receipt and source job, then binds the
challenge to the original prompt, deterministic generation config, model
requirements, expected output hash, expected token hash when present, source
receipt hash, and source job id. The challenge is scheduled through the same
provider assignment and receipt verification path as a canary.

Audit probability should increase for:

- new providers
- high-value jobs
- recent mismatches
- runtime-profile drift
- provider admission changes
- collusion-risk clusters

Failed canaries and failed challenges produce reputation events. Passing
canaries and challenges also produce reputation events.

Canary and challenge events use distinct event types. Routing quarantine is
derived from unresolved failure balance so harmless event reordering or
same-millisecond writes cannot change the result.

Canaries should not be easily distinguishable from ordinary jobs.

## Policy classes

The lane sends prompts to browser providers. Requesters must assume selected
providers can see prompt text unless a separate private mode is added.

Allowed public classes:

- `public_text`
- `code_help`
- `benchmark_eval`

Blocked public provider classes:

- `pii`
- `secrets`
- `medical_private`
- `illegal_content`

Provider adverts may include accepted policy classes. Requester jobs must be
classified before assignment.

The requester UI should state:

```text
Public browser providers can see prompts selected for execution.
Do not submit secrets or private records.
```

## Agent API

Agents submit jobs through the same SDK as other clients
(`submitJob(jobRequest)` in [`shared/pool/sdk.js`](../../shared/pool/sdk.js))
and can sign provisional research proposals. The API must not give agents
direct control over human review, room memory, reputation, allocation, closure,
or promotion gates.

### Required blocks

Agents must not:

- change reputation directly
- bypass deterministic generation config
- submit secrets without policy rejection
- accept receipts without required agreement
- treat Poolday receipts as `/x` promotion evidence without an explicit bridge
- issue `human_claim` review decisions or task approvals
- place provisional proposals into accepted room memory
- allocate or execute a projected next action without human approval
- hide disagreement, replication requests, or missing evidence

### Research proposal authority

An `agent` identity may sign these provisional record kinds through the same
record constructors and verification path as other participants:

- `research_hypothesis`
- `research_prior_evidence`
- `research_prediction`
- `research_work_order`

Agent-authored records remain provisional until an independent permitted human
role reviews them. The governed cycle may expose them as candidates or request
their review, but scientific next actions cannot cite them as basis until they
enter accepted memory.

`projectGovernedResearchCycle(records, { questionHash })` is a read-only,
deterministic projection. Its `nextQuestion` output exposes whether the exact
current task contract still requires approval or names the signed approval
record that already satisfied it. It always has `executionAuthority: "none"`.
Approval never lets an agent allocate or execute work.

Research result v2 admits either a server-verifier acceptance or an authentic
peer agreement whose embedded provider receipts are re-hashed and signature
verified. Hash strings and provider labels without those signed receipts never
establish independent execution. Legacy v1 approvals remain attributable
history but cannot authorize an exact v2 task contract.

Poolday receipts are inference evidence. They are not self-improvement
promotion evidence unless `/x` adds a separate validator gate.

*Merged 2026-11-26 from threat-model.md, receipt-schema.md, reputation-ledger.md,
canary-and-challenge-policy.md, policy-classes.md and agent-api.md (last updated
June to August 2026).*
