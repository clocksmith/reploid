# Reploid–Doppler distributed execution specification

**Specification ID:** `RD-EXEC/1`  
**Status:** Proposed implementation specification. No implementation or deployment is authorized or claimed by this document.

**Goal:** Enable useful distributed inference with responsive streaming through prepared execution routes, safe local prefix reuse, and target-verified speculative blocks. Ordinary generation retains a cheap fast path. Per-token network coordination belongs to particular execution plans, not to the mesh as a whole.

**Initial sequence:** ordinary sampling consistency → one same-policy local composite-state fork → fixed two-stage target-replay blocks.

---

## 1. Scope and evidence

### 1.1 Inspected baseline

This specification consolidates the supplied designs and reviews, with targeted inspection of these repository snapshots:

| Item                              | Inspected identity                                                        | Scope                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Doppler source                    | `96ce43d137b897039511e5bfbdd36a6456e103cb`                                | Sampling, resident types, speculation scaffold, cache ownership, package metadata                      |
| Reploid source                    | `646974107824d9acc58677d80c857dd432c2af95`                                | Placement, reservations, receiver ordering, conversation persistence, host composition, dependency pin |
| Reploid’s Doppler dependency      | `doppler-gpu` **0.6.27**, `file:deploy/artifacts/doppler-gpu-0.6.27.tgz`  | Inspected dependency declaration, not a newly hashed installation                                      |
| Retained deployed-browser receipt | `sha256:5be2d8f1e10ddd9467b09b40ce7dbbdc2e1898952f8d988e0f5b2d590a225325` | Receipt records 1,909 verified files; the live site was not independently rechecked here               |

The source snapshots and the pinned archive both declare version 0.6.27, but that does **not** establish identical contents. Source commits, installed archive identity, provider identity, and browser-bundle identity remain separate.

**Unavailable or unexecuted evidence:** remote GPU processes, installed archive contents, live browser delivery, private local captures, and the toy cursor-test artifact linked inside a review were not executed or independently verified for this specification. Attached reviews are design inputs, including where they report tests; they are not new implementation evidence.

### 1.2 Status vocabulary

Every capability below uses one of four statuses:

- **Existing:** directly inspected source provides the stated mechanism. This does not imply physical qualification.
- **Changed:** this specification requires modifying an existing mechanism.
- **Proposed:** a new contract or capability specified here.
- **Deferred:** outside this implementation sequence.

| Capability                                                                        | Status                 | Disposition                                                                               |
| --------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| Two resident partitions, ordinary execution, live continuations and cleanup       | **Existing**           | Preserve public ownership and existing supported behavior                                 |
| Seeded sampling and centralized token-selection utilities                         | **Existing / Changed** | Replace the reproducibility contract through explicit versioning                          |
| Speculation scaffold                                                              | **Existing / Changed** | Keep outside supported block execution until its replacement satisfies this specification |
| Complete composite-state capture and local fork                                   | **Proposed**           | Coordinate existing state owners; do not create another cache system                      |
| Accepted-state preparation and block commit                                       | **Proposed**           | Explicit state transaction                                                                |
| Capability discovery, placement and reservations                                  | **Existing / Changed** | Extend existing owners; fixed-route blocks do not depend on a new placement optimizer     |
| Conversation persistence                                                          | **Existing / Changed** | Add durable, idempotent publication and cancellation serialization                        |
| Measured complete-route ranking                                                   | **Proposed**           | Separate optional improvement after fixed-route correctness                               |
| Probability-preserving rejection sampling                                         | **Deferred**           | Not another mode silently embedded in target replay                                       |
| Cross-policy forks, portable checkpoints, additional stages, coordinator failover | **Deferred**           | Require separate versioned contracts                                                      |

The inspected sampler still uses sine-derived seeded randomness. The resident interface still exposes `executeGroup0()` and `executeGroup1()`. The speculation scaffold still contains its own random generator and a cache-aliasing fallback. These are concrete boundaries, not reasons for a runtime rewrite.

### 1.3 Normative interpretation

**SP-01 — Evidence and scope.** `MUST` identifies a required invariant; `SHOULD` permits a documented, tested exception; `MAY` identifies optional behavior. Normative clauses belong to their nearest requirement ID.

This specification MUST NOT activate a numerical reference, alter model precision, relax an existing tolerance, change a production pin, or reopen unrelated campaigns. The existing independent numerical gate remains separate from distribution and sampling tests.

---

## 2. Concept and ownership map

**SP-02 — Ownership.** Doppler owns computation, sampling, partition validity, inference state and state transitions. Reploid owns discovery, placement, permissions, reservations, protocol coordination and durable conversation publication. Transport carries authenticated bounded messages; it does not declare computation complete or resources released.

This preserves the supplied ownership boundary. Pasted markdown

| Concept         | Definition and owner                                                                                                        | Identity                                                                  | Lifecycle and invariants                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Participant** | An authenticated browser or native process. Reploid owns membership and authorization.                                      | Participant ID plus process epoch; device epoch where relevant            | Discovered → admitted → available/draining/unavailable. A restart changes its epoch. Two participants can share one GPU.  |
| **Piece**       | Verified immutable model bytes. Reploid coordinates custody; Doppler defines required artifacts.                            | Content digest, size, artifact-relative range                             | Acquired → verified → retained → released. A piece is not an execution partition.                                         |
| **Partition**   | A valid section of model computation. Doppler owns validity.                                                                | Model, execution-plan and partition-plan digests; stage index             | Validated before loading. Dependencies and boundary layouts MUST agree.                                                   |
| **Stage**       | A partition prepared on a particular participant/device. Doppler owns resources; Reploid owns its advertisement.            | Partition identity plus participant/process/device epochs and resident ID | Preparing → ready → draining → closed. Readiness is not a reservation.                                                    |
| **Route**       | An ordered set of stages serving an attempt. Reploid owns selection.                                                        | Digest of exact stages, boundaries and execution mode                     | Candidate → reserved → active → retired. Initial distributed routes have exactly two stages.                              |
| **Attempt**     | One authorized execution with immutable route and generation identity. Reploid owns coordination; Doppler owns local state. | Attempt ID, requester, thread, placement generation and execution epoch   | Admitted → active → completed/cancelled/interrupted. Replacement creates a new attempt.                                   |
| **Cursor**      | A logical accepted-history boundary. Doppler defines it; stages and Reploid validate it.                                    | Cursor digest and monotonically increasing revision                       | Describes materialized history, accepted tokens, pending token and stopping state. Physical stage tensors need not match. |
| **Prefix**      | A retained local state snapshot eligible for a same-policy fork. Doppler owns it.                                           | Opaque local handle plus compatibility descriptor                         | Capturing → retained → leased → released. Not a transferable checkpoint or global discovery key.                          |
| **Block**       | A bounded hypothetical continuation following the pending token. Doppler evaluates it; Reploid coordinates it.              | Attempt, execution epoch, sequence and proposal digest                    | Open → evaluated → decided → prepared → committed/discarded. One unresolved block per attempt.                            |
| **Prepared**    | Exact accepted successor state exists locally without replacing its parent. Doppler owns this transition.                   | Decision digest, successor cursor and prepared handle                     | GPU work has settled. Preparation is not commitment.                                                                      |
| **Committed**   | A stage installed the prepared successor under an expected-cursor check. Doppler owns installation.                         | Immutable stage commit acknowledgment                                     | Local commit is not global atomic commit and is not publication.                                                          |
| **Published**   | Reploid durably appended the accepted output record after matching stage commits.                                           | Publication key, digest and output range                                  | UI delivery can be retried without regeneration. Publication does not restore GPU state after loss.                       |

### Execution modes

Reploid MUST distinguish:

| Mode                                | Dependency structure                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Independent job**                 | A complete operation, such as an explicitly separable embedding input, can execute independently                |
| **Ordinary partitioned generation** | Successive tokens depend on a fixed route’s earlier state                                                       |
| **Target-replay block**             | Several dependent hypothetical inputs are evaluated together, then only the target-approved prefix is committed |

Independent jobs MUST NOT inherit speculative rollback semantics. Speculative blocks MUST NOT be described as independent tokens. The supplied designs explicitly distinguish these categories. Pasted markdown

### Initial authority placement

For the initial two-stage protocol:

- **Execution coordinator C:** the existing Reploid runner colocated with stage 0.
- **Stage A:** Doppler partition 0.
- **Stage B:** Doppler partition 1 and authoritative target sampler.
- **Publication owner P:** the requesting conversation workspace and its exclusive storage writer.

These are roles, not additional services. P serializes cancellation and publication. C coordinates stage transactions. Neither interprets model probability mathematics.

---

## 3. Typed contracts

**SP-03 — Validation and encoding.** The following interfaces are **Proposed**, not existing exported APIs. Doppler-facing types MUST be exported through `doppler-gpu/partitions`; Reploid MUST import or derive them, retaining its own coordination envelopes.

### 3.1 Primitive rules

```ts
type U32 = number; // Integer: 0..2^32-1.
type Count = number; // Nonnegative safe integer: 0..2^53-1.
type Bytes = Count; // Allocated or transferred bytes, never MiB.
type Milliseconds = number; // Finite, nonnegative duration.
type UnixMs = Count; // Wall-clock timestamp, milliseconds since epoch.
type Digest = `sha256:${string}`; // Exactly 64 lowercase hex digits.
type Nonce128 = string; // Exactly 32 lowercase hex digits.
type Seed64 = string; // Exactly 16 lowercase hex digits.
type StageIndex = 0 | 1;
type TokenId = U32; // Additionally < the bound vocabulary size.
type OpaqueId = string; // 1..256 UTF-8 bytes; never a memory address.

interface TokenRange {
  start: Count; // Inclusive generated-token index.
  end: Count; // Exclusive generated-token index.
}
```

All wire schemas MUST:

1. Reject unsupported versions, unknown behavior-changing fields, invalid enums, unsafe integers and nonfinite numeric values.
2. Use explicit `null` for absent optional semantic values.
3. Validate sizes before allocating, copying, hashing or decoding payloads.
4. Freeze or privately copy admitted metadata and payloads.
5. Use existing canonical JSON/hash owners, with schema-domain separation.
6. Hash raw tensor bytes separately from their canonical metadata.
7. Exclude signatures and transport timestamps from semantic request fingerprints; include all behavior-changing request fields.
8. Reject overflow when multiplying dimensions, components or byte sizes.

`AbortSignal`, GPU buffers and native object references are local implementation values and MUST NOT appear on the wire.

### 3.2 Identities, routes and reservations

**SP-04 — Immutable bindings.**

```ts
interface ExecutionIdentity {
  schema: "doppler.execution-identity/v1";
  modelDigest: Digest;
  tokenizerDigest: Digest;
  adapterDigests: readonly Digest[];
  targetPlanDigest: Digest;
  partitionPlanDigest: Digest;
  runtimeArchiveDigest: Digest;
  numericalPolicyDigest: Digest;
  stateLayoutDigest: Digest;
}

interface GenerationIdentity {
  schema: "doppler.generation-identity/v2";
  execution: ExecutionIdentity;
  policy: SamplingPolicyV2;
  stopping: StoppingPolicyV1;
  decoderImplementationDigest: Digest;
  generationDigest: Digest; // Hash of preceding semantic fields.
}

interface StageBinding {
  index: StageIndex;
  participantId: OpaqueId;
  participantEpoch: Nonce128;
  deviceEpoch: Nonce128;
  residentId: OpaqueId;
  partitionDigest: Digest;
  layerStart: Count; // Inclusive.
  layerEnd: Count; // Exclusive.
  boundaryLayoutDigest: Digest | null;
  resourceAuthorityId: OpaqueId | null;
  qualificationEvidence: readonly Digest[];
}

interface RoutePlan {
  schema: "reploid.route-plan/v1";
  execution: ExecutionIdentity;
  mode: "ordinary-token" | "target-replay-block";
  stages: readonly [StageBinding, StageBinding];
  coordinatorId: OpaqueId; // MUST equal stage 0 participant in v1.
  blockPolicy: BlockPolicyV1 | null;
  routeDigest: Digest;
}

interface AttemptBinding {
  schema: "reploid.partition-attempt/v2";
  meshId: OpaqueId;
  threadId: OpaqueId;
  requesterId: OpaqueId;
  attemptId: OpaqueId;
  executionEpoch: Nonce128; // Coordinator process incarnation.
  publisherEpoch: Nonce128;
  placementGeneration: Count;
  routeDigest: Digest;
  generationDigest: Digest;
  authorizationScopeDigest: Digest;
}

interface ResourceRequest {
  residentGpuBytes: Bytes; // Charged once per actual resident owner.
  attemptGpuBytes: Bytes;
  scratchGpuBytes: Bytes;
  temporaryGpuBytes: Bytes;
  stagingGpuBytes: Bytes;
  hostRetainedBytes: Bytes;
  attemptSlots: Count;
  blockSlots: 0 | 1;
}

interface Reservation {
  schema: "reploid.route-reservation/v1";
  reservationId: OpaqueId;
  attempt: AttemptBinding;
  stage: StageBinding;
  resources: ResourceRequest;
  phase: "provisional" | "active" | "settling" | "settled" | "failed";
  issuedAtUnixMs: UnixMs;
  notAfterUnixMs: UnixMs;
  resourceAuthorityId: OpaqueId;
  reservationDigest: Digest;
}
```

A generation digest MUST NOT include block size, retry count, route timing or draft coupling. Those may change execution cost but MUST NOT change target draws.

A route digest MUST include stage epochs and block mode. Changes to participants, model, generation identity or authorization scope MUST NOT mutate an active attempt.

### 3.3 Cursors and local handles

```ts
interface Cursor {
  schema: "doppler.cursor/v1";
  promptTokenCount: Count;
  materializedTokenCount: Count;
  acceptedGeneratedTokenCount: Count;
  nextTargetTokenIndex: Count;
  pendingTokenId: TokenId | null;
  materializedPrefixDigest: Digest;
  generationDigest: Digest;
  revision: Count;
  terminal: boolean;
  stopReason: StopReason | null;
  cursorDigest: Digest;
}

interface StateHandle {
  schema: "doppler.local-state-handle/v1";
  id: Nonce128;
  participantEpoch: Nonce128;
  deviceEpoch: Nonce128;
  residentId: OpaqueId;
  stageIndex: StageIndex;
  attemptId: OpaqueId;
  cursorDigest: Digest;
  kind: "prefix" | "parent" | "scratch" | "prepared";
}

interface PrefixDescriptor {
  schema: "doppler.local-prefix/v1";
  handle: StateHandle;
  execution: ExecutionIdentity;
  cursor: Cursor;
  generationDigest: Digest;
  retainedGpuBytes: Bytes;
  retainedHostBytes: Bytes;
  publishedPrefixRecordDigest: Digest;
  samePolicyOnly: true;
}
```

Handles MUST be validated against an internal ownership table. Possessing a handle string is not authorization. A prefix handle MUST NOT be portable across process/device epochs.

The materialized-prefix digest MUST use a token-chain construction independent of block boundaries:

```text
h0 = SHA256(domain || tokenizerDigest)
hi+1 = SHA256(domainToken || hi || uint32LE(tokenId))
```

The domain strings and byte framing MUST be pinned in the schema fixture. Digests MUST NOT be broadcast as public prefix-affinity identifiers.

### 3.4 Frames, requests and decisions

```ts
interface ActivationFrame {
  schema: "doppler.activation-frame/v1";
  attempt: AttemptBinding;
  blockSequence: Count;
  baseCursorDigest: Digest;
  proposalDigest: Digest;
  fromStage: 0;
  toStage: 1;
  sequenceOffset: Count; // First logical input position.
  rows: Count; // Exactly k + 1 for a full block.
  logicalColumns: Count;
  scalarType: "f16" | "f32";
  components: 1 | 2;
  packing: "plain" | "interleaved-high-low";
  layoutDigest: Digest;
  byteLength: Bytes;
  payloadDigest: Digest;
  frameDigest: Digest;
  // Raw little-endian bytes travel in the existing bounded transport.
}

interface BlockPolicyV1 {
  schema: "reploid.target-replay-policy/v1";
  verification: "target-replay/v1";
  draftCoupling: "independent-draws" | "shared-target-draws";
  draftImplementationDigest: Digest;
  maxDraftTokens: Count;
  maxFrameBytes: Bytes;
  maxHostRetainedBytes: Bytes;
  phaseTimeoutMs: Milliseconds;
  retryWindowMs: Milliseconds;
  maxUnresolvedBlocks: 1;
}

interface BlockRequest {
  schema: "doppler.target-replay-block/v1";
  attempt: AttemptBinding;
  blockSequence: Count;
  expectedCursor: Cursor;
  proposals: readonly TokenId[]; // d1..dk, not including p.
  proposalDigest: Digest;
  blockPolicyDigest: Digest;
  stageReservationDigests: readonly [Digest, Digest];
}

type StopReason =
  | "stop-token"
  | "stop-sequence"
  | "tool-call"
  | "max-tokens"
  | "context-limit"
  | "output-limit";

interface OutputDelta {
  tokenIds: readonly TokenId[];
  irrevocableText: string;
  rawDecodedUtf16Count: Count;
  visibleUtf16Count: Count;
  toolIntents: readonly {
    id: Digest;
    name: string;
    argumentsDigest: Digest;
    arguments: unknown; // Validated by the existing bounded tool schema.
  }[];
}

interface VerificationDecision {
  schema: "doppler.target-replay-decision/v1";
  attempt: AttemptBinding;
  blockSequence: Count;
  baseCursorDigest: Digest;
  proposalDigest: Digest;
  verification: "target-replay/v1";
  matchedProposalCount: Count;
  materializeInputCount: Count;
  output: OutputDelta;
  successor: Cursor;
  decisionDigest: Digest;
}

interface PreparedSuccessor {
  schema: "doppler.prepared-successor/v1";
  stageIndex: StageIndex;
  attempt: AttemptBinding;
  blockSequence: Count;
  baseCursorDigest: Digest;
  proposalDigest: Digest;
  decisionDigest: Digest;
  successor: Cursor;
  preparedState: StateHandle;
  replayInputDigest: Digest;
  submittedWorkSettled: true;
}

interface CommitAck {
  schema: "doppler.block-commit/v1";
  stage: StageBinding;
  attempt: AttemptBinding;
  blockSequence: Count;
  decisionDigest: Digest;
  baseCursorDigest: Digest;
  successorCursorDigest: Digest;
  installedRevision: Count;
  ackDigest: Digest;
}
```

Two-component frames are eligible only when the accepted execution plan explicitly supports that boundary representation. This specification does not authorize a precision change or reinterpret existing single-component frames.

### 3.5 Publication

```ts
interface PublicationRecord {
  schema: "reploid.conversation-publication/v1";
  attempt: AttemptBinding;
  blockSequence: Count;
  decisionDigest: Digest;
  previousPublicationDigest: Digest | null;
  tokenRange: TokenRange;
  acceptedTokenIds: readonly TokenId[];
  successorCursor: Cursor;
  output: OutputDelta;
  stageCommitAckDigests: readonly [Digest, Digest];
  stopReason: StopReason | null;
  recordDigest: Digest;
}

interface PublicationAck {
  recordDigest: Digest;
  successorCursorDigest: Digest;
  acceptedThrough: Count;
  durable: true;
}
```

`tokenRange.end - tokenRange.start` MUST equal `acceptedTokenIds.length`. For a fork, the first range begins at the inherited generated-token count, not zero.

“Durable” means the configured storage adapter completed its atomic persistence operation. It does not imply protection against browser-data deletion, device destruction or every operating-system failure.

---

## 4. Sampling contract

### 4.1 Integer generator

**SP-05 — Random-word contract: Changed.**

The initial new sampler MUST use **Philox4x32-10**, with unsigned 32-bit words, exact multiplication high/low halves and ten rounds. Random123 provides the algorithm and the following known-answer vectors. It is not a cryptographic generator. [GitHub](https://github.com/DEShawResearch/random123)

Constants:

```text
M0 = D2511F53   M1 = CD9E8D57
W0 = 9E3779B9   W1 = BB67AE85
```

One round:

```text
(hi0, lo0) = unsignedMultiply32(M0, c0)
(hi1, lo1) = unsignedMultiply32(M1, c2)

(c0, c1, c2, c3) =
    (hi1 XOR c1 XOR k0, lo1,
     hi0 XOR c3 XOR k1, lo0)
```

Between rounds, add `W0` and `W1` to the key modulo \(2^{32}\). Do not add after the final round.

| Counter words                         | Key words           | Expected output words                 |
| ------------------------------------- | ------------------- | ------------------------------------- |
| `00000000 00000000 00000000 00000000` | `00000000 00000000` | `6627e8d5 e169c58d bc57ac4c 9b00dbd8` |
| `ffffffff ffffffff ffffffff ffffffff` | `ffffffff ffffffff` | `408f276d 41c83b0e a20bc7c6 6d5451fd` |
| `243f6a88 85a308d3 13198a2e 03707344` | `a4093822 299f31d0` | `d16cfe09 94fdcceb 5001e420 24126ea1` |

These are algorithm vectors, not project test results. [GitHub](https://raw.githubusercontent.com/DEShawResearch/random123/main/tests/kat_vectors)

### 4.2 Seed and counter mapping

The proposed algorithm identifier is `philox4x32-10-indexed/v1`.

A seed is a 64-bit unsigned value encoded as sixteen lowercase hexadecimal characters:

```text
key[0] = low 32 bits
key[1] = high 32 bits
```

An omitted new-format seed MUST be generated once using the host’s cryptographic random source and persisted before execution. No clock-derived fallback is permitted. Legacy numeric seeds remain under their legacy sampler identity.

For semantic token index `t` and draw index `j`:

```text
counter[0] = low32(t)
counter[1] = high32(t)
counter[2] = purpose
counter[3] = floor(j / 4)
word       = philox(counter, key)[j mod 4]
uniform    = (word + 0.5) / 2^32
```

The uniform conversion MUST use binary64 arithmetic and yields a value strictly between zero and one.

| Purpose              | Value | Initial use                         |
| -------------------- | ----: | ----------------------------------- |
| Target selection     |   `0` | Ordinary and target-replay sampling |
| Independent drafting |   `1` | Draft proposals                     |
| Rejection acceptance |   `2` | Reserved; unsupported here          |
| Residual correction  |   `3` | Reserved; unsupported here          |

The target uses draw index zero per semantic output position. A greedy selection needs no random word, but accepting its token still advances the semantic token index.

Target draws MUST NOT depend on attempt IDs, block size, wall time, retries, participant order or scheduling. Rejected proposals do not advance the target’s accepted position.

### 4.3 Token selection

**SP-06 — Selection contract: Changed.**

```ts
interface SamplingPolicyV2 {
  schema: "doppler.sampling-policy/v2";
  rng: "philox4x32-10-indexed/v1";
  seed: Seed64;
  selection: "ordered-categorical-js-f64/v1";
  selectionImplementationDigest: Digest;
  mathEnvironmentId: string;
  temperature: number; // Finite, >= 0.
  topK: Count; // 0 means all finite candidates.
  topP: number; // 0 < topP <= 1.
  repetitionPenalty: number; // Finite, > 0.
  repetitionWindow: Count; // 0 means complete logical history.
  presencePenalty: number; // Finite, >= 0.
  presenceWindow: Count; // 0 means complete logical history.
  suppressTokenIds: readonly TokenId[];
  padTokenId: TokenId | null;
}
```

Initial selection runs through one explicit Doppler scalar JavaScript implementation. GPU selection is not silently substituted.

The transform order MUST be:

1. Validate raw logits; reject NaN and positive infinity. Negative infinity denotes an unavailable candidate.
2. Apply repetition penalty once per distinct token in the declared history window: positive score divided by penalty; nonpositive score multiplied by penalty.
3. Subtract presence penalty once per distinct token in its declared window.
4. Mask pad and suppressed tokens.
5. At temperature zero, select maximum score; ties choose the lowest token ID.
6. Otherwise sort by descending transformed score, then ascending token ID; retain top K when nonzero.
7. Compute \(w*i=\exp((\ell_i-\ell*{\max})/T)\) in the declared implementation.
8. Accumulate weights sequentially in that order. Apply top P by keeping the smallest nonempty prefix whose normalized cumulative mass reaches top P.
9. Resum retained weights in the same order.
10. Select the first cumulative weight strictly greater than `uniform × retainedSum`. A rounding-only overrun selects the final retained candidate.

Other transformations, including undeclared grammar masks or nonzero filtering parameters absent from this contract, MUST reject rather than silently disappear.

The initial math environment is explicitly bound because ECMAScript’s `Math.exp` is implementation-approximated. **Equal Philox words do not prove equal transformed distributions or selected tokens across every engine.** Cross-host selection equivalence must be qualified for the claimed implementations; block replay on a host uses the same sampler as its ordinary path. [TC39](https://tc39.es/ecma262/multipage/numbers-and-dates.html)

### 4.4 Draft coupling and verification mode

**SP-07 — Coupling: Proposed.**

The default is `independent-draws`. `shared-target-draws` MAY be enabled explicitly and measured. Neither changes the target stream.

Shared draws improve agreement for identical distributions but can reduce agreement for different distributions. For example, the supplied review’s \(p=(0.5,0.5,0)\), \(q=(0,0.5,0.5)\) has zero shared-draw agreement versus 0.25 independent agreement under the stated token ordering. Pasted text

Target replay requires no draft probabilities. Probability-preserving rejection sampling is **Deferred** and MUST NOT reuse these decisions or randomness rules under the same mode identifier.

---

## 5. Exact cursor semantics

### 5.1 Initial convention

**SP-08 — Cursor algebra: Proposed.**

After ordinary prefill and its first accepted selection:

- \(H\): logically materialized token history.
- \(m=|H|\).
- \(P\): prompt-token count.
- \(p\): accepted, durably published token pending materialization.
- \(g\): accepted generated-token count.
- \(d_1,\ldots,d_k\): proposals following \(p\).
- Block inputs: \([p,d_1,\ldots,d_k]\).

At entry:

\[
m=P+g-1,\qquad \text{nextTargetTokenIndex}=g.
\]

More generally:

\[
m=P+g-\mathbf 1[\text{pending token exists}].
\]

These are logical counts, not occupied slots in a sliding-window cache.

| Target row | Materialized context for that row | Target index | Candidate                |
| ---------: | --------------------------------- | -----------: | ------------------------ |
|          0 | \(H,p\)                           |        \(g\) | \(d_1\)                  |
|          1 | \(H,p,d_1\)                       |      \(g+1\) | \(d_2\)                  |
|    \(i-1\) | \(H,p,d*1,\ldots,d*{i-1}\)        |    \(g+i-1\) | \(d_i\)                  |
|      \(k\) | \(H,p,d_1,\ldots,d_k\)            |      \(g+k\) | Bonus/continuation token |

The pending token MUST NOT be resampled or republished. This adopts the reviewed pending-token convention rather than mixing it with a fully materialized-frontier API. Pasted text

### 5.2 Admission

**SP-09 — Bounds and terminal entry: Proposed.**

Let:

\[
R=\text{maxGeneratedTokens}-g.
\]

A block MUST NOT begin when the cursor is terminal, `pendingTokenId` is null, or \(R=0\).

Initially:

\[
0\le k\le R-1.
\]

The route MUST separately admit:

- \(k+1\) hypothetical model inputs;
- their activation frames;
- parent, scratch, workspace and staging;
- worst-case \(k+1\) newly accepted outputs.

`maxContextTokens` bounds the logical prompt-plus-accepted history, including the pending token. The conservative initial admission therefore also requires:

\[
P+g+k+1\le \text{maxContextTokens}.
\]

This is stricter than checking only physical cache occupancy. Sliding-window eviction does not reset logical positions.

### 5.3 General transition

For \(r<k\) matching proposals followed by target correction \(c\):

\[
H'=H\Vert p\Vert d_1\ldots d_r
\]

\[
O=d_1\ldots d_r\Vert c,\quad p'=c,\quad g'=g+r+1.
\]

For full acceptance and continuation \(b\):

\[
H'=H\Vert p\Vert d_1\ldots d_k
\]

\[
O=d_1\ldots d_k\Vert b,\quad p'=b,\quad g'=g+k+1.
\]

If \(n=|O|\), both cases satisfy:

\[
m'=m+n,\qquad g'=g+n,\qquad \text{nextTargetTokenIndex}'=g'.
\]

The successor revision increments once per accepted transaction, not once per proposed token.

### 5.4 Worked examples

Assume \(P=5\), \(g=2\), \(m=6\), pending token `p`, and sufficient limits. `EOS` denotes a terminal accepted token.

| Case                    | Proposals and target result                                 | Materialized successor | Newly accepted output | New pending / counts      |
| ----------------------- | ----------------------------------------------------------- | ---------------------- | --------------------- | ------------------------- |
| **k=0**                 | No proposals; target selects `x` after `p`                  | `H,p`                  | `x`                   | `x`; \(m'=7,g'=3\)        |
| **Zero acceptance**     | Draft `a,b,c`; target first chooses `x ≠ a`                 | `H,p`                  | `x`                   | `x`; \(7,3\)              |
| **Partial acceptance**  | Draft `a,b,c`; target chooses `a,x`, where `x ≠ b`          | `H,p,a`                | `a,x`                 | `x`; \(8,4\)              |
| **Full acceptance**     | Target agrees with `a,b,c`, then selects `x`                | `H,p,a,b,c`            | `a,b,c,x`             | `x`; \(10,6\)             |
| **Terminal proposal**   | Draft `a,EOS,c`; target agrees through EOS                  | `H,p,a`                | `a,EOS`               | `EOS`; \(8,4\), terminal  |
| **Terminal correction** | Draft `a,b,c`; after `a`, target chooses EOS instead of `b` | `H,p,a`                | `a,EOS`               | `EOS`; \(8,4\), terminal  |
| **Terminal bonus**      | Target agrees with `a,b,c`, then selects EOS                | `H,p,a,b,c`            | `a,b,c,EOS`           | `EOS`; \(10,6\), terminal |

For a terminal proposal \(d_i\), materialize only its predecessor:

\[
H'=H\Vert p\Vert d*1\ldots d*{i-1},\quad
O=d_1\ldots d_i,\quad p'=d_i.
\]

No bonus is selected. The same rule applies when an accepted token completes a stop string or tool boundary.

Raw accepted token IDs, including control and non-visible tokens, count toward \(g\). Visible text length does not.

A character-budget guard MAY terminate before accepting a candidate whose decoded expansion would exceed the bound. If it accepts no new token, the successor retains the base history and pending token, becomes terminal, and publishes an empty token range with the stopping outcome. It MUST NOT partially accept a token or silently change the ordinary stopping policy.

---

## 6. Composite-state transaction

### 6.1 Complete state and local prefix reuse

**SP-10 — Local prefix ownership: Proposed.**

`capturePrefix()` MUST operate at a settled, published cursor with no unresolved block. `forkAttemptFromPrefix()` creates a new authorized attempt with the same generation policy, seed and inherited semantic token index. Inherited output is referenced, not republished.

The first implementation supports one admitted same-policy local child. It MUST NOT change temperature, resample the pending token or reset accepted-token accounting.

**SP-17 — Composite state: Proposed.**

| Component            | Required treatment                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Attention caches     | Preserve geometry, relevant physical contents, positions and sequence metadata                                                 |
| Sliding-window rings | Preserve overwritten slots and ring indexing, not merely logical length                                                        |
| Recurrent state      | Preserve all high/low components and declared precision                                                                        |
| Convolution state    | Preserve history, ordering and position                                                                                        |
| Policy history       | Preserve accepted prompt/output tokens needed for masks and penalties                                                          |
| Decoder              | Preserve partial byte sequences, text/control parsing and stable-emission state                                                |
| Stop matcher         | Preserve withheld suffix and cross-block matching state                                                                        |
| Counters             | Preserve logical positions, accepted counts, target indices and output accounting                                              |
| Shared resources     | Retain references to immutable weights; never duplicate ownership claims                                                       |
| Stage-specific state | Only the output stage needs decoder/sampler state; other stages retain the common logical cursor and their own numerical state |

The composite owner MUST coordinate existing cache, recurrence and decoder implementations. A cache clone or truncation alone is insufficient. Pasted text

### 6.2 Local transaction API

All methods are **Proposed extensions** to the existing resident interface.

| Operation                      | Inputs and preconditions                                                | Output and state transition                                                                                                                 | Cancellation and errors                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SP-11 `beginBlock`**         | Bound request, expected cursor, active reservation; no unresolved block | Pins immutable parent; allocates and copies one scratch branch; returns branch handle after copy completion                                 | Before submission: release provisional resources. After copy submission: suppress success but await settlement. Failure leaves parent unchanged.         |
| **SP-12 `evaluateBlock`**      | Branch plus exact token inputs for A or activation frame for B          | Sequentially evaluates hypothetical inputs; mutates scratch only; A returns retained activation frame; B returns opaque verification handle | Failure invalidates scratch, not parent. No output, tool invocation or permanent target-index advance.                                                   |
| **SP-13 `verifyBlock`**        | Verification handle, proposals, base cursor and policy identity         | Produces one immutable target-replay decision and output-state successor                                                                    | Matching retries return the same decision. No new random stream, cache mutation or publication.                                                          |
| **SP-14 `prepareBlockCommit`** | Branch and exact decision                                               | Restores/replays when needed; prepares exact accepted model state and output metadata; returns `PreparedSuccessor` after work settles       | Cancellation releases or quarantines scratch. It MUST NOT install prepared state.                                                                        |
| **SP-15 `commitBlock`**        | Prepared handle, decision and expected base revision                    | Atomically swaps the local attempt’s state pointer and stores immutable acknowledgment                                                      | Cancellation before the linearization point prevents commit. Afterward the result remains committed; it MUST NOT be reported as an unexecuted operation. |
| **SP-16 `discardBlock`**       | Branch handle and expected ownership                                    | Settles and releases provisional state; parent remains usable                                                                               | Cleanup errors retain charged ownership. Calling after commit returns `ALREADY_COMMITTED`, not a fictitious rollback.                                    |

Common errors include:

```text
UNSUPPORTED_VERSION   INVALID_BINDING      STALE_EPOCH
CURSOR_MISMATCH        BLOCK_IN_PROGRESS    INVALID_LAYOUT
UNSUPPORTED_STATE     BUDGET_EXCEEDED      NONFINITE_INPUT
REQUEST_COLLISION     RESULT_EXPIRED       ALREADY_COMMITTED
ABORTED               DEVICE_LOST          CLEANUP_UNSETTLED
```

Errors MUST distinguish no mutation, scratch mutation, committed mutation and unknown settlement.

### 6.3 Stage-specific replay inputs

A MUST retain `[p,d1,…,dk]`.

B MUST retain the exact corresponding boundary activation rows. B cannot restore accepted state from token IDs alone because it does not own the preceding layers.

For a decision accepting \(n>0\) new tokens, each stage materializes exactly the first \(n\) block-input rows:

```text
Stage A: p, d1, …, d(n−1)
Stage B: retained activation rows [0, n)
```

For the partial example `a,x`, B replays the first **two** rows, corresponding to `p,a`.

Retained replay inputs MUST remain immutable and charged until preparation/discard and any required retransmission ownership settle. Recomputing activations using different arithmetic or batching is not equivalent to replaying retained rows.

### 6.4 Evaluation without full-vocabulary network traffic

B MAY sample each hypothetical row during sequential evaluation into a bounded local vector of target token choices. Those choices are provisional.

For row \(j\), penalties use the hypothetical accepted history through the preceding proposal. Once verification finds a mismatch, later choices are ignored.

`verifyBlock()` MUST apply decoding and stopping only to the accepted prefix. Full-vocabulary logits MUST NOT be sent to Reploid merely to verify a block.

### 6.5 Restore and prepare

Initial restoration MUST use the immutable parent:

```text
await scratch outstanding work
restore scratch from parent
replay required accepted input rows without sampling
install accepted policy/decoder/counter successor from the bound decision
await copies and execution completion
return prepared acknowledgment
```

When full acceptance leaves scratch at exactly the required materialized prefix, reconstruction MAY be skipped after validating that condition.

Replay MUST NOT resample, republish or execute tools.

Asynchronous copying remains charged until observed completion. If restoration allocates replacement scratch before disposing old scratch, admission MUST charge the temporary third copy. The preferred first implementation restores into existing scratch storage.

---

## 7. Distributed protocol

### 7.1 State machines

**SP-18 — Fixed-route block protocol: Proposed.**

One unresolved block includes local execution, stage commits, durable publication acknowledgment and required transaction cleanup. The next block MUST NOT begin before that boundary resolves.

```text
Coordinator:
IDLE → OPENING → EVALUATING → DECIDED → PREPARING
     → COMMITTING → APPENDING → PUBLISHED → IDLE/TERMINAL

Before any commit:
failure/cancel → DISCARDING → SETTLED or CLEANUP_UNSETTLED

After any commit:
unrecoverable uncertainty → INTERRUPTED → RETIRED
```

```text
Stage:
PARENT → COPYING → OPEN → EVALUATED → PREPARED → COMMITTED
                    \──────────────→ DISCARDING → DISCARDED
```

No global mesh consensus is introduced.

### 7.2 Successful block

```text
P: requester/storage     C+A: input owner          B: output owner

        |                       | beginBlock A          |
        |                       |------ beginBlock ---->|
        |                       | evaluate A            |
        |                       |------ frame ---------->|
        |                       |                 evaluate/verify
        |                       |<----- decision --------|
        |                       | prepare A              |
        |                       |------ prepare -------->|
        |                       |<----- prepared --------|
        |                       | compare logical successors
        |                       | commit A               |
        |                       |------ commit ---------->|
        |                       |<----- commitAck --------|
        |<-- publication request + both acknowledgments--|
 atomic append                  |                        |
 deliver saved output           |                        |
        |------ publishedAck -->|                        |
        |                       | settle old ownership   |
```

Both prepared acknowledgments MUST bind the same decision and logical successor. Both commit acknowledgments MUST match them.

### 7.3 Rejection

```text
A/B evaluate hypothetical suffix
B selects first target mismatch
B returns decision for accepted prefix + correction
A restores/replays token rows
B restores/replays retained activation rows
A/B prepare matching successor
normal commit/publication sequence
```

Rejection is not an error. Rejected suffix state and provisional text MUST never become visible.

### 7.4 Duplicates and lost acknowledgments

**SP-19 — Idempotency: Changed.**

Within a recipient’s stage endpoint, lookup uses:

```text
(executionEpoch, attemptId, blockSequence, phase)
```

The request digest is stored **separately**.

| Condition                          | Required action                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Matching operation still running   | Join its promise                                                             |
| Matching completed result retained | Return the original result after current authorization checks                |
| Same key, changed request digest   | `REQUEST_COLLISION`                                                          |
| Old result payload evicted         | `RESULT_EXPIRED`; never execute again                                        |
| Future phase or skipped sequence   | Reject as out of order                                                       |
| Commit acknowledgment lost         | Resend identical commit request; return original acknowledgment              |
| Publication acknowledgment lost    | Resend identical publication record; storage returns original acknowledgment |

The inspected receiver currently retains its latest step and already rejects changed fingerprints and retired attempts. The block protocol extends that owner; it does not add another receiver subsystem.

Initial proposed limits:

| Limit                            |                                Initial value |
| -------------------------------- | -------------------------------------------: |
| Maximum draft tokens             |                                            4 |
| Unresolved blocks per attempt    |                                            1 |
| Maximum control message          |                                      256 KiB |
| Maximum activation frame         |        16 MiB, or lower declared route limit |
| Completed block-result retention |    Last 2 completed blocks, up to 30 seconds |
| Retained operation records       |                       At most 16 per attempt |
| Phase timeout                    | 120 seconds, bounded by the attempt deadline |
| Provisional route reservation    |                                    5 seconds |

These are conservative implementation defaults, not measured optima. Changing performance defaults does not change semantic indices or accepted-token rules.

Unresolved operations MUST NOT be evicted. Finalized payloads MAY be evicted earlier to satisfy explicit memory limits, but a monotonically advancing retired-through boundary MUST prevent their reexecution.

Once retained attempt history is exhausted, the participant MUST reject new admission or renew its endpoint epoch after draining. It MUST NOT forget tombstones and accept old attempt IDs again.

### 7.5 Cancellation, partial commit and disconnect

| Event                                                 | Required transition                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cancel before branch admission                        | Retain cancellation tombstone; allocate nothing                                                    |
| Cancel during copy/evaluation                         | Abort future work; settle submitted work; discard scratch                                          |
| Cancel after preparation, before commit               | Discard prepared state                                                                             |
| Cancel after one or both commits                      | Publication owner determines visibility; retire affected execution rather than pretending rollback |
| One stage commits; the other cannot confirm           | Retry identical requests within limits; otherwise interrupt                                        |
| Data channel disconnects                              | Mark delivery unavailable; resource ownership remains unknown/charged                              |
| Signaling disappears but data channel remains healthy | Continue under existing authorization and liveness rules                                           |
| Coordinator dies                                      | No new coordinator election; P preserves saved output and marks the attempt interrupted            |

### 7.6 Epoch fencing and replacement

**SP-20 — Fencing: Changed.**

All messages MUST bind coordinator, participant and device epochs. Restart generates new epochs before accepting work. Stale messages reject before allocation.

Replacement is a separately authorized attempt with new bindings. It MAY run on healthy capacity while old unreachable ownership remains charged. It MUST NOT reuse resources whose cleanup is unconfirmed.

A same-policy local prefix fork is not transparent recovery. It is permitted only while its actual resident state exists and its compatibility/authorization checks pass.

---

## 8. Publication and stopping

### 8.1 Durable append

**SP-21 — Publication: Changed.**

Required order:

```text
matching stage commits
→ atomic idempotent conversation append
→ install saved workspace projection
→ UI delivery
```

The current workspace updates response text and sequence before calling its persistence function; its host supplies `load/save` over local storage. Block publication therefore requires a real change to those existing owners.

Proposed storage port:

```ts
interface ConversationTransactionStore {
  runExclusive<T>(namespace: string, action: () => Promise<T>): Promise<T>;

  appendPublication(
    record: PublicationRecord,
    expectedPublisherEpoch: Nonce128,
    expectedPreviousDigest: Digest | null,
  ): Promise<PublicationAck>;

  recordCancellation(
    attempt: AttemptBinding,
    expectedPublisherEpoch: Nonce128,
  ): Promise<void>;
}
```

The existing host storage adapter MUST provide atomic snapshot replacement or transactional append under one exclusive writer. A browser implementation MAY use Web Locks to exclude competing tabs, but Web Locks does not itself provide storage durability. [W3C](https://www.w3.org/TR/web-locks/)

Storage absence, corruption or write failure MUST NOT be treated as successful persistence or an empty history. Unwritten candidate state MUST NOT be exposed through observers.

The initial implementation has one publication owner per workspace namespace. A second tab is read-only or explicitly takes ownership after the former writer is gone; active attempts become interrupted rather than transparently adopted.

### 8.2 Publication pseudocode

```text
publish(record):
  under existing workspace's exclusive writer:
    validate identity, both stage acknowledgments and output bounds

    if identical record already stored:
      return original PublicationAck

    if same publication key has different contents:
      reject REQUEST_COLLISION

    if publisher epoch is stale or cancellation already recorded:
      reject; do not append

    require contiguous token range and matching previous publication
    persist new immutable record and attempt head atomically
    install persisted workspace projection

  deliver persisted record to UI
  return PublicationAck
```

The publication key is `(executionEpoch, attemptId, blockSequence)`. UI delivery deduplicates by record digest and output range.

If the UI disconnects after persistence, replay the saved record. Do not regenerate it. If C fails after stage commits but before P establishes a durable record, the attempt is interrupted at its last published prefix.

### 8.3 Cancellation race

**SP-22 — Cancellation serialization: Proposed.**

P’s exclusive attempt owner serializes cancellation with append:

| First durable transition             | Outcome                                                             |
| ------------------------------------ | ------------------------------------------------------------------- |
| Cancellation                         | Suppress any unpublished block; send retirement/settlement requests |
| Publication                          | Preserve that output; cancellation prevents subsequent advancement  |
| Storage outcome uncertain            | Stop advancement and reconcile storage; do not announce success     |
| Late acknowledgment after retirement | Cannot publish or revive the attempt                                |

A transient “Stopping” UI state MAY appear before durable cancellation completes, but MUST NOT claim resources are settled.

### 8.4 Incremental decoding, stopping and tools

**SP-23 — Output safety: Changed.**

Doppler MUST process only accepted token IDs through the cloned incremental decoder and stop matcher.

The stop matcher MUST retain the longest decoded suffix that could still become a configured stop sequence. It emits only irrevocable text. UTF-8 partial bytes, surrogate handling and control-parser state MUST survive forks and block boundaries.

For an accepted token completing a stop string:

- Count the whole token ID as accepted.
- Materialize only its predecessor.
- Retain the token as terminal pending.
- Suppress the configured stop string and subsequent tentative text.
- Select no bonus.

A token that reaches the generated-token or logical-context limit makes the cursor terminal. Stopping priority MUST be declared: stop token/tool boundary, then matched stop sequence, then output/context allowance. The same function and priority apply to ordinary and speculative execution.

A raw-character guard MUST be checked using a decoder preview before accepting an expansion that exceeds its existing limit. It may produce the empty-range terminal transition defined in §5.

Tool side effects MUST consume only durably published, deduplicated tool-intent records. Tool permission is rechecked separately. Uncertain external side effects MUST NOT be retried automatically unless the tool’s own idempotency contract permits it.

---

## 9. Placement, resources and privacy

### 9.1 Slow preparation and fast placement

**SP-24 — Route selection: Changed.**

The preparation loop MAY acquire pieces and prepare missing stage coverage. The request loop selects a complete eligible prepared route. New capacity MUST NOT migrate an executing attempt.

The current selector preserves compatible owners and uses availability hints; it does not rank complete routes by measured costs. This specification extends that selector rather than replacing discovery.

Doppler’s proposed `inspectPartitionPlan()` returns structural validity, artifact dependencies, boundary layouts, conservative resource requirements, assumptions and evidence identifiers. Reploid decides whether those facts meet application policy.

Before ranking, reject routes with:

- mismatched identities or layouts;
- unsupported operations/state formats;
- missing applicable qualification;
- forbidden disclosure;
- unavailable enforceable budget;
- expired observations or unsatisfied deadlines.

Unknown resource bounds make a route ineligible for speculation until bounded; they are not zero.

### 9.2 Complete-route cost

For ordinary sequential decoding, estimate:

\[
T*{\text{route}}
=
T*{\text{prepare}}+T*{\text{queue}}+T*{\text{prefill}}
+\widehat N\left(
T*A+T*{A\to B}+T*B+T*{B\to A}
\right)+T\_{\text{risk}}.
\]

Directed transfer terms include framing, readback, upload and actual relays where measured. Nested measurements MUST NOT be counted twice.

For blocks, use measured cost per **committed** token, including rejected work, reconstruction and publication. Do not use acceptance rate as the placement objective.

The initial deterministic ranking uses median observed completion costs, p95 uncertainty allowance, and lexicographic route digest for exact ties. Missing measurements MUST remain marked unknown. They MUST NOT be invented from GPU names.

### 9.3 Complete-route reservations

**SP-25 — Admission: Changed.**

Acquire provisional reservations in a deterministic participant order. Activate only after both reservations match the same attempt and route. Otherwise release provisional reservations and retry a different route.

Expiration prevents new work; it does not free active allocations. Existing reservation ownership already keeps slots charged until settlement and must retain that behavior.

For each enforceable device budget:

\[
M*{\text{resident}}
+\sum M*{\text{attempt}}
+\sum M*{\text{scratch}}
+M*{\text{workspace}}
+M*{\text{staging}}
+M*{\text{unsettled}}
\le B\_{\text{device}}.
\]

Count actual allocated capacity and shared resources once under their real owner. Host-retained frames and decoded data have separate host-memory limits.

The current campaign’s **1,420,000,000-byte** contributor ceiling remains unchanged where applicable.

A browser and native process MUST NOT independently claim the same spare GPU capacity without a shared local admission authority enforcing the combined budget. Without such authority, co-location is only an observation; placement must conservatively avoid double admission.

### 9.4 Privacy and trust

**SP-26 — Authorization: Existing / Changed.**

Introduction, piece custody, compute, input disclosure, prefix reuse, drafting and output replay are separate grants.

A drafter may require prompt tokens unavailable to another stage’s existing role. Its placement therefore requires explicit disclosure eligibility, even when colocated with a target stage.

Prefix handles and affinity records MUST remain scoped to authorized local users/sessions. Global publication of private prefix hashes is prohibited.

Signed artifacts and messages establish identity/integrity, not truthful target execution. Target replay makes arbitrary draft proposals harmless to the accepted-token rule only within the declared trust model for target computation. It is not a proof against malicious target executors. Pasted markdown

---

## 10. Implementation map

**SP-27 — Reuse and migration: Changed.**

No repository changes are part of this deliverable. The following is the implementation map.

| Requirements       | Existing owner to extend                                                                                                                                                  | Proposed addition or modification                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SP-03–07           | Doppler `src/inference/token-sampling.*`, `generation-step.*`, `src/config/generation-contract.*`                                                                         | Add `src/inference/sampling-rng.*`; version canonical seed, counter and selection semantics                  |
| SP-05–08           | `src/client/runtime/session-controller.js`, `pipelines/text/resident-partition.js`, `generator*`, `generator/decode-runtime.js`, `src/gpu/kernels/sample.js`              | Route ordinary/resident callers through the same semantic index; reject unqualified GPU selection            |
| SP-08–17           | `partition-attempt.js`, `resident-partition-contract.*`, `resident-partition.js`, KV-cache owners, `linear-attention.js`, `linear-attention/state-layout.js`              | Add `pipelines/text/resident-state.js`; coordinate existing state copies, restoration and leases             |
| SP-12–14           | `partition-execution.js`, `src/inference/speculative.js`, text logits owners                                                                                              | Sequential multi-row evaluation, bounded local verification results, exact accepted-input replay             |
| SP-03–04, SP-18–20 | Reploid `partition-contract.js`, `partition-peer.js`, `partition-step-receiver.js`, `partition-grants.js`                                                                 | Versioned block envelopes, fingerprint separation, phase retention and epoch fencing                         |
| SP-18, SP-25       | `partition-runner.js`, `partition-reservations.js`                                                                                                                        | One unresolved block, whole-route admission, bound phase acknowledgments, retained cleanup ownership         |
| SP-21–23           | `packages/reploid/src/chat/workspace.js`, `self/host/chat-session.js`, existing UI projections/tool runner                                                                | Add atomic idempotent append to the existing store owner; serialize cancellation; publish only saved records |
| SP-24–26           | `partition-discovery.js`, `partition-placement.js`, `automatic-partitions.js`, `self/host/work-partitions.js`, `work-model-files.js`, `self/config/partition-policy.json` | Optional measured route ranking, resource descriptions and private prefix affinity                           |

Current inspected ownership supports the receiver, reservation, placement and publication extension points. The attached reviews identify the remaining Doppler touchpoints; implementation must reconcile any subsequent moves without introducing duplicate owners. Pasted text Pasted text

### Migration rules

1. Preserve legacy ordinary sampler identities and transcripts. New semantics require an explicit new generation identity.
2. Keep resident v1 callers supported where already supported. New capabilities require explicit advertisement and version negotiation; absent capability means unsupported.
3. Export Doppler-owned contracts through its public partition entrypoint. Reploid must not maintain competing runtime types.
4. Preserve existing conversation histories. New publication records extend the existing storage owner; they do not reinterpret old logs as token-complete checkpoints.
5. JSON owns declarations and tunable policy. JavaScript owns orchestration and scalar control. WGSL owns model tensor computation and GPU state copying where applicable.
6. Fixed-route blocks MUST be implementable before measured placement optimization.
7. An inactive speculation configuration MUST not allocate scratch, draft resources or new full-vocabulary buffers.

---

## 11. Acceptance matrix

All tests below are **required, not claimed executed**.

### 11.1 Separate release gates

**SP-28 — Correctness gates.**

| Gate                           | Required result                                                                                                           | Must not be substituted by          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Distribution parity            | Ordinary whole/split execution meets its declared comparison contract                                                     | Matching final prose alone          |
| Independent numerical accuracy | Exact candidate passes its applicable independent reference, including the existing 0.001 campaign where required         | GPU agreement or RNG agreement      |
| Same-seed replay               | Ordinary and target-replay paths produce identical accepted token IDs for the qualified arithmetic/sampling configuration | Approximate probability similarity  |
| Answer quality                 | Complete useful answers meet frozen task requirements                                                                     | EOS, valid JSON or numerical parity |
| Integrity/authorization        | Correct identities, artifacts, scopes and phase admission                                                                 | Valid signatures alone              |

### 11.2 Required test families

**SP-29 — Lifecycle and protocol qualification.**

| Test ID | Required coverage                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| **T01** | Schema rejection, unknown versions, malformed digests, unsafe counts, dimensional overflow, wrong package/model/plan |
| **T02** | All Philox known-answer vectors; seed endian mapping; token index crossing \(2^{32}\); purpose/draw separation       |
| **T03** | Policy-transform order, ties, top K/P boundaries, masks, all-masked/nonfinite rejection, greedy/nonzero temperature  |
| **T04** | Nonzero-temperature whole/split/block replay under retries, interleaving, different block sizes and coupling modes   |
| **T05** | Exhaustive small-vocabulary cursor reference for every acceptance position and all terminal examples                 |
| **T06** | Local same-policy fork; parent/child independent continuation; inherited pending token and RNG index                 |
| **T07** | Real attention-ring overwrite, restoration and continuation; not counter-only mocks                                  |
| **T08** | Recurrent/convolution state cloning, including every precision component; decoder/stop/counter restoration           |
| **T09** | Later-stage activation-row replay; wrong row offset/layout/digest rejection; token-only replay rejection             |
| **T10** | Cancel during asynchronous copy, model dispatch, readback, replay and unload                                         |
| **T11** | Duplicate every phase, changed payload collisions, lost commit acknowledgment, expired results and tombstones        |
| **T12** | Fail between stage commits; coordinator loss; stale participant/device/publisher epochs                              |
| **T13** | Publication write failure, acknowledgment loss, UI replay, duplicate range, changed-content collision                |
| **T14** | Cancellation before/during/after durable append; no late revival                                                     |
| **T15** | Stop strings spanning blocks, split UTF-8, hidden/control tokens, terminal proposal/correction/bonus                 |
| **T16** | Tool calls remain tentative until publication; duplicated intents do not trigger duplicated authorized execution     |
| **T17** | Parent/scratch/staging/deferred and third-copy peaks; allocation rejection; concurrent long attempts                 |
| **T18** | Complete-route reservations, expiry, partial acquisition and shared-device over-admission                            |
| **T19** | Prefix/drafter disclosure denial, grant revocation, unauthorized result replay and private-affinity leakage          |
| **T20** | Ordinary fast path with speculation disabled: no scratch allocation or block prepare protocol                        |
| **T21** | Cold/warm fixed-route performance, committed-token cost, visible pauses and cancellation delay                       |
| **T22** | Independent numerical reference on exact candidate, all required prefixes/devices/placements                         |
| **T23** | Frozen and fresh answer-quality cases through the installed application                                              |
| **T24** | Installed archive/browser/native identity, restart migration, public API-only consumption                            |

Real GPU state tests MUST use a model and plan that exercise attention rings and recurrent/convolution state. Testing only a contiguous cache or toy decoder does not qualify the composite owner.

### 11.3 Performance qualification

**SP-30 — Speculation earns admission.**

Measure:

\[
C*{\text{committed token}}
=
\frac{T*{\text{complete operation}}}
{\text{new durably committed token count}}.
\]

The measured boundary MUST include drafting, parent/scratch copies, computation, transfer, reconstruction, preparation, commit, publication and required cleanup. Report preparation/loading separately as well as end-to-end user latency. Overlapping time must not be double-counted.

Also report first irrevocable output, p50/p95 publication gaps, longest visible pause, transferred bytes, discarded work, memory peaks and cancellation settlement.

Initial promotion criteria are **proposed policy**, not measured results:

- At least 30 matched ordinary/speculative pairs across the declared workload set.
- Same inputs, seeds, accepted-token semantics and resource limits.
- At least 10% improvement in median committed-token cost, with a paired 95% confidence interval excluding no improvement.
- No more than 25 ms additional p95 first-output delay or 50 ms additional p95 publication gap.
- No lifecycle, numerical, authorization or quality regression.

Speculation MUST remain disabled for routes where the complete measured cost does not improve. Large acceptance percentages alone are insufficient.

---

## 12. Delivery sequence and traceability

### 12.1 Smallest increments

**SP-31 — Delivery.**

| Increment                                       | Scope                                                        | Completion criterion                                                               |
| ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| **A. Contract fixtures**                        | Types, cursor equations, RNG vectors and phase model         | Validators and independent reference fixtures exist; no runtime capability claimed |
| **B. Ordinary sampling consistency**            | New sampler identity across ordinary and resident callers    | T01–T04 pass in claimed environments; legacy identities remain unchanged           |
| **C. One local same-policy fork**               | Composite state owner and admitted copy/restore              | T05–T10 and local T17 pass on real state; parent remains independently usable      |
| **D. Fixed two-stage target replay**            | Retained frames, verification, prepared successors, commits  | T09–T19 pass with injected failures and exact output publication                   |
| **E. Ordinary-path protection and performance** | Cheap fallback, bounded adaptive block sizes                 | T20–T21 pass; enable only beneficial routes                                        |
| **F. Qualified installed delivery**             | Exact archive, browser/native consumers and real application | Applicable T22–T24 and earlier gates pass                                          |
| **Optional afterward**                          | Measured route ranking and preparation policies              | Demonstrated benefit without moving active attempts or weakening admission         |

### 12.2 Ordinary fast path

For \(k=0\), ordinary execution MUST retain in-place state advancement and the existing execution route. It MUST NOT create speculative scratch, evaluate drafts or run a separate prepare round.

In the initial topology, C is colocated with A. B’s ordinary result carries its successor acknowledgment; C completes A’s matching logical cursor locally and submits the same durable publication form. This preserves publication ordering without requiring a speculative network transaction for each ordinary token.

For \(k>0\), the full transaction applies.

### 12.3 Decisions resolved and remaining

Resolved by this specification:

- Pending-token cursor convention.
- Same-policy local forks only.
- Immutable parent plus one admitted scratch branch.
- Stage-specific retained-input replay.
- Target replay rather than rejection sampling.
- Independent draft draws by default.
- One unresolved block and single coordinator.
- Durable append before delivery.
- Cancellation serialized at the publication owner.
- Fixed-route implementation before placement optimization.

Remaining acceptance inputs, not architectural alternatives:

- Exact model/TargetPlan and host pair eligible for qualification.
- Exact supported selection math environments.
- Whether the existing storage adapter satisfies atomic/exclusive-writer requirements.
- Physical memory and latency evidence for each candidate.
- A useful drafter or proposal source already authorized for its disclosure.
- Any precision change required by separate numerical work.

No unresolved item permits silently weakening a contract. Portable checkpoints, transparent coordinator failover, extra stages and unrelated optimization remain Deferred.

### 12.4 Requirement-to-owner-to-test traceability

| Requirement                                                         | Status             | Primary owner                                           | Tests / completion evidence                                     |
| ------------------------------------------------------------------- | ------------------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| **SP-01** Evidence, version and scope separation                    | Changed            | Both release/evidence owners                            | T01, T24; source/archive/browser identities recorded separately |
| **SP-02** Vocabulary and ownership                                  | Existing / Changed | Both public contracts                                   | T01; imports and authority checks                               |
| **SP-03** Typed schemas, units, bounds and canonical encoding       | Proposed           | Doppler contracts; Reploid envelopes                    | T01, T09, T11                                                   |
| **SP-04** Immutable execution/generation/attempt bindings           | Changed            | Doppler generation contract; Reploid partition contract | T01, T04, T12                                                   |
| **SP-05** Philox seed/counter/random-word contract                  | Changed            | Doppler sampling                                        | T02                                                             |
| **SP-06** Ordered token-selection semantics                         | Changed            | Doppler generation-step/sampler                         | T03, T04                                                        |
| **SP-07** Declared draft coupling and verifier mode                 | Proposed           | Doppler verifier; Reploid policy                        | T04; shared-draw counterexample retained                        |
| **SP-08** Cursor algebra and pending-token alignment                | Proposed           | Doppler resident contract                               | T05, T06, T09                                                   |
| **SP-09** Token/context/output admission and terminal entry         | Proposed           | Doppler; Reploid reservations                           | T05, T15, T17                                                   |
| **SP-10** Local same-policy prefix capture/fork                     | Proposed           | Doppler composite state                                 | T06–T08                                                         |
| **SP-11** Admitted scratch creation                                 | Proposed           | Doppler state and memory owners                         | T07, T10, T17                                                   |
| **SP-12** Hypothetical sequential block evaluation                  | Proposed           | Doppler partition execution                             | T04, T09, T10                                                   |
| **SP-13** Target-replay decision                                    | Proposed           | Doppler output-stage verifier                           | T03–T05, T15                                                    |
| **SP-14** Exact accepted-state preparation and activation replay    | Proposed           | Doppler state owner; Reploid frame lifetime             | T07–T10                                                         |
| **SP-15** Expected-cursor local commit                              | Proposed           | Doppler resident owner                                  | T11, T12, T14                                                   |
| **SP-16** Discard and truthful settlement                           | Changed            | Doppler cleanup; Reploid reservations                   | T10, T12, T17                                                   |
| **SP-17** Complete future-affecting state                           | Proposed           | Existing Doppler cache/recurrent/decoder owners         | T06–T08, T15                                                    |
| **SP-18** Single unresolved fixed-route transaction                 | Proposed           | Reploid runner                                          | T11–T14                                                         |
| **SP-19** Fingerprints, duplicate joins, expiry and retirement      | Changed            | Reploid step receiver                                   | T11                                                             |
| **SP-20** Process/device fencing and replacement                    | Changed            | Both resident/transport admission                       | T12, T19                                                        |
| **SP-21** Durable idempotent publication                            | Changed            | Reploid workspace and host store                        | T13, T24                                                        |
| **SP-22** Cancellation/publication serialization                    | Proposed           | Reploid publication owner                               | T14                                                             |
| **SP-23** Incremental output, stopping and tool deduplication       | Changed            | Doppler decoder; Reploid tool/publication owners        | T15, T16                                                        |
| **SP-24** Eligible complete-route selection                         | Changed            | Reploid placement; Doppler plan inspection              | T18, T21                                                        |
| **SP-25** Enforced route/device/branch admission                    | Changed            | Existing host budget and reservation owners             | T17, T18                                                        |
| **SP-26** Prefix/drafter/disclosure authorization                   | Existing / Changed | Reploid grants and host authority                       | T19                                                             |
| **SP-27** Public API and storage migration without duplicate owners | Changed            | Both integration owners                                 | T01, T24                                                        |
| **SP-28** Separate parity, numerical, replay and quality gates      | Existing / Changed | Both qualification owners                               | T04, T22, T23                                                   |
| **SP-29** Real lifecycle and failure qualification                  | Proposed           | Both physical-test owners                               | T06–T19                                                         |
| **SP-30** Complete cost, visible pauses and ordinary fast path      | Proposed           | Both benchmark owners                                   | T20, T21                                                        |
| **SP-31** Incremental qualified delivery                            | Proposed           | Both release owners                                     | T24 and all applicable preceding gates                          |
