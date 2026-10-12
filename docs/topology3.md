# Reploid–Doppler Distributed Inference Specification

**Specification:** `reploid-doppler-distributed-inference/v1`  
**Status:** Design baseline for implementation. No repository changes, package promotion, or deployment are authorized by this document.

**Implementation sequence:** ordinary sampling consistency → one local same-policy composite-state fork → two-stage target-replay blocks.

**MUST** denotes a required invariant. **SHOULD** denotes a default whose deviation requires a recorded reason and acceptance evidence. **MAY** denotes an optional capability that must be explicitly advertised and admitted.

---

## 1. Scope and evidence

### 1.1 Inspected source and delivery identities

| Surface                                 | Inspected identity                                                         | Evidence boundary                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Reploid source                          | `646974107824d9acc58677d80c857dd432c2af95`                                 | Selected source, contracts, configuration, and recorded status were inspected.                    |
| Doppler source                          | `ec965eb5031705ab42d1a6decbaa8061ec42c6fe`                                 | Selected sampling, generation, partition, cache, and public contract files were inspected.        |
| Reploid’s configured Doppler dependency | `doppler-gpu` `0.6.27`, `file:deploy/artifacts/doppler-gpu-0.6.27.tgz`     | Configuration inspected; archive bytes were not independently extracted or hashed in this review. |
| Recorded accepted archive               | SHA-256 `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc` | Recorded repository evidence, not a new package verification.                                     |
| Recorded browser deployment             | Reploid through `c13cd97e`, with a recorded 1,909-asset verification       | Historical deployment report, not a fresh inspection of the live site.                            |

The source heads, dependency configuration, archive record, and deployment report are distinct evidence. A source change does not establish that an installed package or browser contains it.

**RDI-01 — Evidence identity.** Every implementation report MUST bind its source commit, package archive, installed-file inventory, browser bundle, model, tokenizer, execution configuration, provider, and applicable reference identities. Advertised versions alone are insufficient.

No repository tests, GPU runs, benchmarks, live browser sessions, or installed-package checks were executed for this specification. Private physical-host state and binary artifacts referenced by reports were not inspected. Earlier toy cursor results are not evidence of GPU restoration or distributed transaction correctness.

### 1.2 Capability status

| Capability                                                                                                           | Status                 | Inspected boundary or specified change                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic two-partition placement                                                                                    | **Existing**           | Selection already excludes input owners reporting exhausted capacity; complete-route cost ranking is absent from the inspected selector. |
| Per-attempt resident execution                                                                                       | **Existing**           | Separate attempt state, generation binding, ordered execution, and cleanup.                                                              |
| Indexed legacy seeded sampling                                                                                       | **Existing**           | Token indexing exists, but the scalar generator still uses `Math.sin`.                                                                   |
| Latest-step duplicate replay                                                                                         | **Existing**           | Receiver retains its latest step result, not the proposed multiphase block history.                                                      |
| KV cloning and truncation                                                                                            | **Existing**           | Cache-level operations; ring truncation does not restore overwritten contents.                                                           |
| Speculative decoder scaffold                                                                                         | **Existing**           | Initialization explicitly states that verify-and-accept is not wired into ordinary generation.                                           |
| Activation layout metadata                                                                                           | **Existing**           | Current Doppler source distinguishes scalar and paired layouts; this does not establish their delivery or qualification.                 |
| Composite local prefix handles and scratch branches                                                                  | **Proposed**           | Complete inference-state ownership and restoration.                                                                                      |
| Versioned integer randomness and explicit selection profile                                                          | **Changed**            | New sampler identity; legacy behavior remains separately identified.                                                                     |
| Target-replay block protocol                                                                                         | **Proposed**           | Two stages, one unresolved block per attempt.                                                                                            |
| Durable token-authoritative publication                                                                              | **Changed**            | Existing conversation persistence gains transactional output records and cancellation ordering.                                          |
| Measured complete-route ranking                                                                                      | **Proposed, optional** | Not a prerequisite for fixed-route blocks.                                                                                               |
| Portable checkpoints, additional stages, transparent coordinator failover, probability-preserving rejection sampling | **Deferred**           | No support implied by this specification.                                                                                                |

These classifications follow the inspected placement, receiver, sampling, cache, initialization, and public partition contracts.

### 1.3 Consolidation decisions

**RDI-02 — Scope and ownership.** The latest user baseline controls where earlier reviews conflict.

| Earlier ambiguity                                            | Binding resolution                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| “Prepared” meant opening a speculative branch                | **Prepared means the exact accepted successor has been constructed.** Branch creation is `beginBlock`. |
| Replay described only as replaying tokens                    | Later stages replay retained boundary activation rows and required token context.                      |
| Publication combined storage and delivery                    | **Published means durably appended.** Delivery follows and can be replayed.                            |
| Request digest appeared inside the retry key                 | Lookup excludes the digest; the stored digest detects collisions.                                      |
| Shared draft draws were preferred universally                | Independent draws are the initial default; shared draws are separately measured.                       |
| `k=0` implied the full branch protocol                       | Ordinary execution keeps its existing cheap path.                                                      |
| Failed cleanup could block the whole mesh                    | Only affected resources remain unavailable. Other admitted capacity may execute a new attempt.         |
| Plan inspection decided application eligibility              | Doppler reports validity, requirements, and evidence bindings. Reploid decides eligibility.            |
| Placement optimization appeared before every other increment | Fixed-route execution does not depend on dynamic ranking improvements.                                 |

Attached reviews supply design inputs, not implementation proof. Historical indexing, W8A8, Doe, and unrelated Gamma material MUST NOT reopen deferred work. The principal review itself identifies its content as proposals and preserves the computation/coordination boundary. Pasted text Pasted text

---

## 2. Concept and ownership map

**Status:** Existing terminology consolidated into **Proposed** normative definitions.

| Concept         | Owner and identity                                                                                                                      | Lifecycle and invariants                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Participant** | Reploid; signing identity plus process epoch                                                                                            | Discovered → authorized → available → draining/unavailable. Two participants may share hardware. Process restart changes the epoch. |
| **Piece**       | Reploid custody; authenticated content identity                                                                                         | Discovered → acquired → verified → retained → released. Possession does not authorize input execution or further sharing.           |
| **Partition**   | Doppler; validated plan digest and partition index                                                                                      | Describes model computation and dependencies independently of placement. A valid partition is not automatically qualified.          |
| **Stage**       | Reploid placement plus a Doppler resident; stage identity binds participant epoch, partition, execution identity, and resident instance | Preparing → ready → reserved/executing → draining → settled. Weights are stage-owned; attempt state is not shared accidentally.     |
| **Route**       | Reploid; digest of ordered stage assignments and execution bindings                                                                     | Candidate → admitted → fixed for an attempt → retired. Includes activation and selected-token return paths.                         |
| **Attempt**     | Reploid lifecycle; Doppler state underneath                                                                                             | Authorized execution on one immutable route and generation identity. Retries or replacement use a new attempt identity.             |
| **Cursor**      | Doppler semantics; Reploid records agreed cursor digests                                                                                | Exact logical materialization and acceptance position, including the pending token. It is not a GPU pointer or recovery artifact.   |
| **Prefix**      | Doppler local state; Reploid authorization scope                                                                                        | Captured → retained → forked/released. Initial reuse is same-policy, local, and identity-compatible.                                |
| **Block**       | Reploid coordination; Doppler transition                                                                                                | One bounded proposal and advance from one base cursor. Initially one unresolved block per attempt.                                  |
| **Prepared**    | Doppler stage                                                                                                                           | Exact accepted successor exists separately from its unchanged parent; preparation work has settled.                                 |
| **Committed**   | Doppler stage                                                                                                                           | Prepared successor was installed under the expected parent revision. This says nothing about conversation publication.              |
| **Published**   | Reploid conversation owner                                                                                                              | Matching stage commitments were followed by an idempotent durable output append. Delivery may still be pending.                     |

These definitions preserve the review’s Participant → Piece/Partition → Stage → Route → Attempt → Cursor/Prefix/Block relationships. Pasted text

### 2.1 Three execution shapes

| Shape                             | Dependency structure                                             | Reploid obligation                                                                         |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Independent job**               | Worker owns a complete operation                                 | Assign, authorize, collect, deduplicate, and settle. No universal per-token mesh protocol. |
| **Dependent partition execution** | One model spans stages; later stages consume earlier activations | Coordinate the selected execution plan and preserve its token dependency.                  |
| **Speculative block**             | Hypothetical continuation evaluated by the target route          | Keep provisional state isolated; publish only the target-accepted transition.              |

A speculative block is not an independent job. A replicated model piece is not a stage. A warm stage replica is not a replica of an active attempt’s state.

The initial design assumes authorized target execution under the application’s declared trust model. Block verification rejects bad **draft proposals**; it does not prove that a dishonest target executor calculated its activations correctly. Pasted text

---

## 3. Typed contracts

**Status:** All interfaces in this section are **Proposed specification types**, not declarations of existing APIs. Existing public types remain valid until an explicitly versioned migration.

### 3.1 Common representation rules

**RDI-03 — Encoding and validation.**

```ts
type UInt32 = number; // Integer: 0 .. 4_294_967_295
type Count = number; // Integer: 0 .. 4_294_967_295
type Revision = number; // Integer: 0 .. Number.MAX_SAFE_INTEGER
type Bytes = number; // Nonnegative safe integer; units: bytes
type Milliseconds = number; // Finite, nonnegative
type TokenId = number; // Integer: 0 <= id < vocabularySize; no sentinel
type Id = string; // 1..256 ASCII characters: [A-Za-z0-9._:-]
type Epoch = string; // Exactly 32 lowercase hexadecimal characters
type Hash = `sha256:${string}`; // Exactly 64 lowercase hex digits after prefix

interface Range {
  start: Count; // Inclusive
  end: Count; // Exclusive; end >= start
}
```

All public records MUST reject unknown fields unless their schema explicitly defines an extension point. Required nullable fields MUST use `null`, not omission. Arrays MUST have declared length limits. Numeric overflow, nonfinite values, malformed UTF-8, and inconsistent lengths MUST reject before GPU allocation.

New metadata digests MUST use a domain-separated SHA-256 over canonical JSON. The canonicalization is RFC 8785 JCS; binary arrays travel separately and contribute their byte length and digest to the metadata. Existing signed formats retain their original canonicalization and signatures. [RFC Editor](https://www.rfc-editor.org/rfc/rfc8785)

```text
digest(schema, body) =
  SHA256(UTF8(schema) || 0x00 || UTF8(JCS(body)))

tokenDigest(ids) =
  SHA256(UTF8("doppler.tokens/v1") || 0x00 ||
         uint64LE(ids.length) || uint32LE(ids[0]) || ...)
```

A record’s own digest field is excluded from its digest input. Transport request IDs, signatures, mutable timings, and local handles are not semantic identity unless explicitly listed.

### 3.2 Execution identity, stages, and routes

**RDI-04 — Immutable route and attempt binding.**

```ts
interface ExecutionIdentity {
  schema: "doppler.execution-identity/v1";
  model: Hash;
  tokenizer: Hash;
  adapters: readonly Hash[]; // Empty when unsupported
  runtimeArchive: Hash;
  executionConfig: Hash;
  numericalContract: Hash;
  stateLayout: Hash;
  decoderContract: Hash;
}

interface ActivationLayout {
  dtype: "f16" | "f32";
  precision: "f16" | "f32" | "two-f32";
  components: 1 | 2;
  elementStrideBytes: 2 | 4 | 8;
  hiddenSize: Count;
  byteOrder: "little-endian";
}

interface ResourceEnvelope {
  residentWeightBytes: Bytes;
  attemptStateBytes: Bytes;
  scratchStateBytes: Bytes;
  replayInputBytes: Bytes;
  workspaceBytes: Bytes;
  stagingBytes: Bytes;
  retainedControlBytes: Bytes;
  maxGpuAllocatedBytes: Bytes;
  maxHostRetainedBytes: Bytes;
  maxAttempts: Count;
  maxConcurrentAttempts: Count;
}

interface StageRef {
  stageId: Hash;
  participantId: Id;
  participantEpoch: Epoch;
  residentId: Id;
  partitionIndex: 0 | 1;
  partitionPlan: Hash;
  execution: ExecutionIdentity;
  resourceAuthorityId: Id | null;
  resourceGroupId: Id | null;
  qualificationBindings: readonly Hash[];
}

type RoutePlan =
  | {
      schema: "reploid.route/v1";
      routeId: Hash;
      kind: "whole-request";
      stages: readonly [StageRef];
      blockProtocol: null;
    }
  | {
      schema: "reploid.route/v1";
      routeId: Hash;
      kind: "two-stage-layer";
      stages: readonly [StageRef, StageRef];
      activationLayout: ActivationLayout;
      blockProtocol: "target-replay-block/v1" | null;
    };

interface AttemptIdentity {
  meshId: Id;
  requesterId: Id;
  threadId: Id;
  attemptId: Id;
  coordinatorId: Id;
  coordinatorEpoch: Epoch;
  placementGeneration: Revision;
  routeId: Hash;
  generationId: Hash;
  inputDigest: Hash;
}
```

Validation MUST ensure stage ordering, model compatibility, supported boundaries, and exact plan identity. `two-f32` requires two components, F32 storage, and an eight-byte element stride. Scalar F16/F32 require one component and their corresponding stride.

Current Doppler source already exposes activation precision/components/stride and separate paired-layout schemas. Implementers MUST extend those owners instead of assuming `dtype === "f32"` always means four bytes per logical value.

A route ID MUST exclude mutable queue estimates. An attempt MUST NOT change route, generation identity, model, or participant epochs in place.

### 3.3 Reservations

```ts
interface Reservation {
  schema: "reploid.route-reservation/v1";
  reservationId: Id;
  attempt: AttemptIdentity;
  stageId: Hash;
  participantEpoch: Epoch;
  authorityId: Id;
  resourceGroupId: Id | null;
  phase: "provisional" | "active" | "settling" | "settled" | "unconfirmed";
  envelope: ResourceEnvelope;
  leaseDurationMs: Milliseconds;
  expiresAtUnixMs: number; // Informational remote timestamp
  authorizationScope: Hash;
}
```

The issuing owner enforces expiry using its own monotonic timer. A remote timestamp MUST NOT establish resource release. Expiry prevents new admission; resources already used remain charged until settlement.

Shared resident weights are charged once to their actual owner, not once per reservation and not zero times.

### 3.4 Generation identity

```ts
interface GenerationPolicyV2 {
  schema: "doppler.generation-policy/v2";
  sampler: "philox4x32-10/cpu-categorical-v1";
  seedHex64: string; // Exactly 16 lowercase hex digits
  selectionArithmeticId: Hash; // Sampler module + host arithmetic profile
  temperature: number; // Finite; >= 0
  topK: Count; // 0 means no top-k filtering
  topP: number; // 0 < topP <= 1
  repetitionPenalty: number; // Finite; > 0
  repetitionPenaltyWindow: Count; // 0 means entire policy history
  presencePenalty: number; // Finite; >= 0
  suppressTokenIds: readonly TokenId[];
  padTokenId: TokenId | null;
  eosTokenIds: readonly TokenId[];
  stopTokenIds: readonly TokenId[];
  stopSequences: readonly string[];
  maxGeneratedTokens: Count; // > 0
  maxContextTokens: Count; // > 0
  maxRawOutputUtf16: Count;
  maxVisibleOutputUtf16: Count;
  decoderContract: Hash;
}

interface GenerationIdentity {
  generationId: Hash;
  policy: GenerationPolicyV2;
  executionIdentity: Hash;
}
```

Model-specific logit transformations, including any model softcap, belong to `executionIdentity`. They MUST occur exactly once. Unsupported policy fields, including undeclared filters, MUST reject rather than disappear during normalization.

Initial limits: at most 16 stop strings, each nonempty and at most 256 UTF-16 code units. Suppressed and stopping token lists MUST contain unique valid token IDs and fit the admitted metadata limit.

### 3.5 Cursor and local state handles

```ts
type StopReason = "eos-token" | "stop-token" | "stop-sequence" | "max-tokens";

interface Cursor {
  schema: "doppler.cursor/v1";
  cursorId: Hash;
  generationId: Hash;
  revision: Revision;
  promptTokenCount: Count;
  materializedTokenCount: Count;
  acceptedGeneratedTokenCount: Count;
  nextTargetTokenIndex: Count;
  pendingTokenId: TokenId | null;
  materializedPrefixDigest: Hash;
  acceptedTokenDigest: Hash;
  terminal: boolean;
  stopReason: StopReason | null;
}

interface LocalStateHandle {
  schema: "doppler.local-state-handle/v1";
  handleId: Id; // Opaque, unguessable, locally registered
  participantEpoch: Epoch;
  residentId: Id;
  stageId: Hash;
  attemptId: Id;
  cursorId: Hash;
  role: "prefix" | "scratch" | "prepared";
  retainedGpuBytes: Bytes;
  retainedHostBytes: Bytes;
  authorizationScope: Hash;
}
```

Handles are not portable GPU snapshots. A handle is valid only in its issuing resident and epoch, and only with current authorization. A serialized handle ID MUST NOT authorize access by itself.

The initial prefix operation supports exact, same-policy continuation/forking. It MUST NOT silently rebase a completed answer into a differently tokenized follow-up prompt, reset generated-token indices, or replace a previously accepted pending token.

### 3.6 Proposal and activation records

```ts
interface Proposal {
  schema: "doppler.target-replay-proposal/v1";
  proposalId: Hash;
  baseCursorId: Hash;
  tokenIds: readonly TokenId[]; // d1..dk; initially 0 <= k <= 4
  drafterId: Id | null; // Null for an admitted local deterministic rule
  drafterExecutionId: Hash;
  coupling: "independent" | "shared-target";
  disclosureScope: Hash;
}

interface ActivationFrame {
  schema: "reploid.block-activation/v1";
  attempt: AttemptIdentity;
  blockSequence: Revision;
  baseCursorId: Hash;
  proposalId: Hash;
  fromStageId: Hash;
  toStageId: Hash;
  tokenRows: Range; // Absolute logical positions
  layout: ActivationLayout;
  shape: readonly [1, Count, Count];
  payloadBytes: Bytes;
  payloadDigest: Hash;
  tokenContextDigest: Hash;
}
```

The binary payload is out-of-band. For `rows = tokenRows.end - tokenRows.start`:

\[
\text{payloadBytes}
= \text{rows}\times\text{hiddenSize}\times\text{elementStrideBytes}.
\]

No trailing bytes, implicit casts, lossy compression, or inferred component count are permitted.

### 3.7 Block operations and results

```ts
type BlockPhase =
  | "begin"
  | "evaluate"
  | "verify"
  | "prepare"
  | "commit"
  | "discard";

interface OperationKey {
  coordinatorEpoch: Epoch;
  participantEpoch: Epoch;
  attemptId: Id;
  blockSequence: Revision;
  phase: BlockPhase;
}

interface BlockEnvelope<P extends BlockPhase, B> {
  schema: "reploid.block-operation/v1";
  key: OperationKey & { phase: P };
  attempt: AttemptIdentity;
  stageId: Hash;
  expectedCursorId: Hash;
  proposalId: Hash;
  authorizationScope: Hash;
  requestDigest: Hash; // Stored fingerprint; NOT part of lookup key
  body: B;
}

interface BeginBody {
  prefix: LocalStateHandle;
  proposal: Proposal;
  reservationId: Id;
}

type EvaluateBody =
  | {
      stageIndex: 0;
      scratch: LocalStateHandle;
      tokenIds: readonly TokenId[]; // [p,d1..dk]
    }
  | {
      stageIndex: 1;
      scratch: LocalStateHandle;
      inputFrame: ActivationFrame;
      tokenIds: readonly TokenId[]; // Same row-aligned token context
    };

interface EvaluationResult {
  evaluationId: Id; // Opaque local record
  baseCursorId: Hash;
  proposalId: Hash;
  replayInputId: Id;
  replayInputDigest: Hash;
  evaluatedRowCount: Count;
  outputFrame: ActivationFrame | null;
  retainedGpuBytes: Bytes;
  retainedHostBytes: Bytes;
}

interface VerificationDecision {
  schema: "doppler.target-replay-decision/v1";
  decisionId: Hash;
  attemptId: Id;
  blockSequence: Revision;
  baseCursorId: Hash;
  proposalId: Hash;
  generationId: Hash;
  acceptedProposalCount: Count;
  materializeInputCount: Count;
  acceptedTokenIds: readonly TokenId[];
  tokenRange: Range;
  successor: Cursor;
  outputDelta: string;
  visibleUtf16Range: Range;
  rawOutputUtf16Count: Count;
  decoderStateDigest: Hash;
  incomingActivationDigest: Hash;
}

interface PreparedSuccessor {
  schema: "doppler.prepared-successor/v1";
  stageId: Hash;
  participantEpoch: Epoch;
  blockSequence: Revision;
  decisionId: Hash;
  baseCursorId: Hash;
  successorCursorId: Hash;
  preparedState: LocalStateHandle;
  replayInputDigest: Hash;
  outgoingAcceptedRowsDigest: Hash | null;
  incomingAcceptedRowsDigest: Hash | null;
  preparationSettled: true;
}

interface CommitAck {
  schema: "doppler.block-commit/v1";
  stageId: Hash;
  participantEpoch: Epoch;
  attemptId: Id;
  blockSequence: Revision;
  decisionId: Hash;
  baseCursorId: Hash;
  successorCursorId: Hash;
  committedRevision: Revision;
  authenticatedReceiptId: Hash;
}

interface Settlement {
  settled: boolean;
  remainingGpuBytes: Bytes;
  remainingHostBytes: Bytes;
  ownershipReceiptId: Hash;
}
```

`authenticatedReceiptId` references evidence produced through existing identity/transport mechanisms. It is not proof of correct model arithmetic.

The local extension exposes:

```ts
interface ResidentBlockExtension {
  beginBlock(
    request: BlockEnvelope<"begin", BeginBody>,
    signal: AbortSignal,
  ): Promise<LocalStateHandle>;

  evaluateBlock(
    request: BlockEnvelope<"evaluate", EvaluateBody>,
    payload: ArrayBuffer | null,
    signal: AbortSignal,
  ): Promise<EvaluationResult>;

  verifyBlock(
    request: BlockEnvelope<"verify", { evaluationId: Id }>,
    signal: AbortSignal,
  ): Promise<VerificationDecision>;

  prepareBlockCommit(
    request: BlockEnvelope<
      "prepare",
      {
        evaluationId: Id;
        decision: VerificationDecision;
      }
    >,
    signal: AbortSignal,
  ): Promise<PreparedSuccessor>;

  commitBlock(
    request: BlockEnvelope<
      "commit",
      {
        prepared: PreparedSuccessor;
        decisionId: Hash;
      }
    >,
    signal: AbortSignal,
  ): Promise<CommitAck>;

  discardBlock(
    request: BlockEnvelope<"discard", { scratchHandleId: Id }>,
  ): Promise<Settlement>;
}
```

Signals and local buffer objects are excluded from wire metadata. Settlement is not abandoned because the initiating signal was cancelled.

### 3.8 Publication records

```ts
interface PublicationRecord {
  schema: "reploid.conversation-output/v2";
  eventId: Hash;
  attempt: AttemptIdentity;
  blockSequence: Revision;
  mode: "ordinary" | "target-replay";
  previousOutputEventId: Hash | null;
  expectedAttemptRevision: Revision;
  nextAttemptRevision: Revision;
  decision: VerificationDecision;
  stageCommits: readonly [CommitAck, CommitAck];
}

interface CancellationRecord {
  schema: "reploid.conversation-cancel/v1";
  eventId: Hash;
  attempt: AttemptIdentity;
  expectedAttemptRevision: Revision;
  nextAttemptRevision: Revision;
  lastPublishedOutputEventId: Hash | null;
  reason: "user" | "revoked" | "deadline" | "execution-failure";
}
```

The decision is embedded initially because its token count is bounded. An immutable durable reference MAY replace embedding later, but a transient URL or in-memory handle MUST NOT.

`outputDelta` is a display projection. Accepted token IDs, the successor cursor, and stopping outcome remain authoritative.

---

## 4. Sampling contract

**Status:** **Changed** versioned sampling; legacy identities preserved.

### 4.1 Integer generator

**RDI-05 — Random words.** The new generator is **Philox4x32-10**, with the constants and round function below, matching Random123 v1.14.0. This is a sampling generator, not an authentication primitive. The specified algorithm and published vectors are external references; they are not claims of an implemented Doppler sampler. [GitHub](https://raw.githubusercontent.com/DEShawResearch/random123/v1.14.0/include/Random123/philox.h)

```text
M0 = 0xD2511F53
M1 = 0xCD9E8D57
W0 = 0x9E3779B9
W1 = 0xBB67AE85

repeat 10 rounds:
    (hi0, lo0) = unsigned_32x32_product(M0, c0)
    (hi1, lo1) = unsigned_32x32_product(M1, c2)
    (c0,c1,c2,c3) =
        (hi1 XOR c1 XOR k0, lo1, hi0 XOR c3 XOR k1, lo0)
    before the next round:
        k0 = (k0 + W0) modulo 2^32
        k1 = (k1 + W1) modulo 2^32
```

Every multiply MUST preserve its full 64-bit unsigned product. JavaScript implementations MUST NOT obtain its high word from a rounded 53-bit `Number` product.

Seed encoding is conventional 64-bit hexadecimal. The last eight hex digits are `k0`; the first eight are `k1`. All-zero seed is valid. Legacy numeric seeds MUST NOT be silently coerced into this format.

For generated-token index \(t\), purpose \(s\), and draw index \(j\):

```text
counter = [low32(t), high32(t), s, floor(j / 4)]
word    = Philox(counter, key)[j mod 4]
```

Purpose IDs are fixed:

| Purpose                             |  ID |
| ----------------------------------- | --: |
| Target selection                    |   0 |
| Independent draft selection         |   1 |
| Reserved future acceptance test     |   2 |
| Reserved future residual correction |   3 |

Published primitive known-answer vectors:

| Counter words                         | Key words           | Output words                          |
| ------------------------------------- | ------------------- | ------------------------------------- |
| `00000000 00000000 00000000 00000000` | `00000000 00000000` | `6627e8d5 e169c58d bc57ac4c 9b00dbd8` |
| `ffffffff ffffffff ffffffff ffffffff` | `ffffffff ffffffff` | `408f276d 41c83b0e a20bc7c6 6d5451fd` |

Implementations MUST also test counter packing, lane selection, seed endianness, and values above the 32-bit token-index boundary.

### 4.2 Uniform conversion and selection arithmetic

**RDI-06 — Selection semantics.**

\[
u=\frac{\text{word}}{2^{32}},\qquad 0\le u<1.
\]

Conversion MUST use binary64. Thus `0 → 0`, `0x80000000 → 0.5`, and `0xffffffff → 1−2⁻³²`. An F32 conversion that rounds the last value to one is not conforming.

**Initial execution choice:** accepted-token selection runs on the final stage’s CPU using one pinned JavaScript sampler and recorded host arithmetic profile. GPU selection is not enabled for this new profile until separately qualified.

This avoids claiming that integer-word agreement implies cross-engine or CPU/GPU probability agreement. The current source uses CPU probability calculations and an implementation-approximated transcendental generator; language and shader specifications permit relevant floating-point variation. [TC39](https://tc39.es/ecma262/multipage/numbers-and-dates.html)

The new CPU profile MUST perform these operations in order:

1. Obtain the declared post-model-transform logits. Reject NaN and positive infinity. Negative infinity is permitted only as an explicit mask.
2. Copy to F32 working logits.
3. Determine the unique token IDs in the declared history window, including prompt tokens. Window zero means all policy history.
4. Apply repetition penalty once per unique ID: positive logits divide by the penalty; nonpositive logits multiply. Round each changed value to F32.
5. Subtract presence penalty once per unique ID; round to F32.
6. Mask pad and suppressed token IDs.
7. For temperature zero, choose the largest finite logit; ties choose the smallest token ID. No random word is needed.
8. Otherwise order candidates by descending logit, then ascending token ID. Retain top K when K is nonzero.
9. Scale using the recorded CPU binary64 operation order; evaluate exponentials and normalization with the pinned arithmetic profile.
10. Apply top-P to the normalized top-K distribution, retaining the smallest nonempty prefix whose cumulative mass reaches the threshold.
11. Renormalize in retained order. Choose the first candidate whose cumulative probability is **strictly greater** than \(u\).
12. If rounding leaves \(u\) beyond the final cumulative value, choose the last retained candidate.

No silent uniform fallback is permitted for invalid or zero-total distributions. Such inputs produce `NUMERICAL_INVALID`.

The initial profile records its engine/build and sampler implementation identity. It does **not** promise universal same-seed transcripts across different arithmetic profiles. An implementation seeking that stronger claim must supply a separately specified and qualified deterministic probability evaluator.

### 4.3 Semantic indices and draft coupling

**RDI-07 — Random-stream independence from scheduling.**

The first generated token uses target index zero. If \(g\) generated token IDs have already been accepted, the next selection uses index \(g\).

Block sequence, participant identity, attempt replacement, network retry count, and scratch-handle identity MUST NOT be mixed into the target draw.

A same-policy fork preserves the generation identity and target index. A deliberately new generation may receive a new seed, but that is a new recorded policy choice.

For target replay:

- `independent` uses purpose 1 for drafting and purpose 0 for target selection.
- `shared-target` lets the drafter use the target’s purpose-0 draw at the same semantic position.
- Target selection always uses purpose 0 regardless of coupling.

Neither coupling is universally superior. For fixed-order inverse-CDF sampling, \(p=(0.5,0.5,0)\) and \(q=(0,0.5,0.5)\) have zero shared-draw agreement but 0.25 independent-draw agreement.

**Probability-preserving rejection sampling is Deferred.** It has a different acceptance/residual algorithm and may preserve the target distribution without reproducing the ordinary same-seed transcript. It MUST NOT be enabled by changing a target-replay flag. [Proceedings of Machine Learning Research](https://proceedings.mlr.press/v202/leviathan23a.html)

---

## 5. Exact cursor semantics

**Status:** **Proposed**, replacing ambiguous step/count interpretations.

### 5.1 Invariants and admission

**RDI-08 — Cursor accounting and bounds.**

Let:

- \(P\): prompt token count.
- \(H\): logically materialized history.
- \(m=|H|\).
- \(p\): one already accepted token pending materialization.
- \(g\): accepted generated-token count.
- \(N\): maximum generated-token allowance.
- \(R=N-g\): remaining allowance.
- \(C\): admitted context capacity.
- \(d_1,\ldots,d_k\): proposals following \(p\).

At a live speculative entry:

\[
m=P+g-1,\qquad
\text{nextTargetTokenIndex}=g,\qquad p\ne\text{null}.
\]

More generally:

\[
m=P+g-\mathbf1[p\ne\text{null}].
\]

These are logical counts, not occupied ring slots.

A block MUST NOT begin when terminal, when \(R=0\), or without exactly one pending token under this initial convention.

Admission requires:

\[
0\le k\le \min(4,R-1),
\]

\[
m+k+1\le C,
\]

plus the actual state, activation, staging, and workspace reservations. Initial attempt admission also requires \(P+N\le C\).

The already accepted pending token \(p\) MUST NOT be sampled or published again.

### 5.2 Distribution alignment

**RDI-09 — Accepted transition alignment.**

Hypothetical stage inputs are:

\[
[p,d_1,\ldots,d_k].
\]

The scores after consuming \(p\) verify \(d_1\), using target index \(g\). Scores after consuming \(p,d_1\) verify \(d_2\), using \(g+1\).

| Score row | Materialized suffix | Selection                              |
| --------- | ------------------- | -------------------------------------- |
| 0         | `p`                 | Verify `d1`                            |
| 1         | `p,d1`              | Verify `d2`                            |
| \(k-1\)   | `p,d1…d(k−1)`       | Verify `dk`                            |
| \(k\)     | `p,d1…dk`           | Select bonus continuation if all match |

Only rows preceding the first mismatch or stopping condition are authoritative.

For \(r<k\) accepted proposals and target correction \(c\):

```text
Materialized successor: H + p + d1…dr
New accepted output:   d1…dr + c
Pending successor:     c
```

For full acceptance and bonus \(b\):

```text
Materialized successor: H + p + d1…dk
New accepted output:   d1…dk + b
Pending successor:     b
```

In both nonterminal cases:

\[
g'=g+r+1,\qquad m'=m+r+1.
\]

For full acceptance use \(r=k\).

If proposal \(d_i\) terminates generation, materialize only through its predecessor:

\[
g'=g+i,\qquad m'=m+i.
\]

The terminating token remains pending and no bonus is sampled.

### 5.3 Worked examples

Use \(P=6\), \(g=3\), \(m=8\), \(N=10\), \(C=16\). Thus \(R=7\). The existing pending token is `p`.

| Case                    | Proposal and target result                 | Materialized successor | Newly accepted IDs | Pending      | \(m',g'\) |
| ----------------------- | ------------------------------------------ | ---------------------- | ------------------ | ------------ | --------- |
| **k=0**                 | No proposals; target selects `z` after `p` | `H+p`                  | `z`                | `z`          | 9, 4      |
| **Zero acceptance**     | Draft `a,b,c`; target chooses `z≠a`        | `H+p`                  | `z`                | `z`          | 9, 4      |
| **Partial acceptance**  | Accept `a`; choose `z≠b`                   | `H+p+a`                | `a,z`              | `z`          | 10, 5     |
| **Full acceptance**     | Accept `a,b,c`; bonus `w`                  | `H+p+a+b+c`            | `a,b,c,w`          | `w`          | 12, 7     |
| **Terminal proposal**   | Accept `a`, then terminating `b`           | `H+p+a`                | `a,b`              | terminal `b` | 10, 5     |
| **Terminal correction** | Accept `a`; correction is EOS              | `H+p+a`                | `a,EOS`            | EOS          | 10, 5     |
| **Terminal bonus**      | Accept `a,b,c`; bonus is EOS               | `H+p+a+b+c`            | `a,b,c,EOS`        | EOS          | 12, 7     |

If \(R=1\), only `k=0` is permitted. Its selection reaches the output allowance and terminates with `max-tokens` unless a higher-priority stopping reason applies.

An accepted token may produce no visible characters. It still increments \(g\), occupies its token range, and participates in the cursor invariant.

---

## 6. Composite-state transaction

**Status:** **Proposed** local Doppler capability.

### 6.1 Complete state ownership

**RDI-10 — Fork isolation.** The initial implementation uses one immutable parent and one admitted scratch branch. The parent’s model state and decoder MUST remain unchanged until local commit.

The composite owner MUST preserve:

| Component           | Required preserved state                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| Full attention      | Relevant cache bytes, geometry, logical positions, and validity metadata           |
| Sliding attention   | Physical ring contents, overwrite positions, logical counters, and window geometry |
| Recurrent attention | All state components, precision, component layout, and sequence position           |
| Convolution         | History buffers and positions                                                      |
| Sampling            | Generation identity, policy history, and semantic target index                     |
| Token history       | Materialized and accepted identities, including pending token                      |
| Decoder             | Pending bytes, control/filter state, stop-prefix buffer, output counters           |
| Execution           | Any future-affecting counters and resolved execution configuration                 |
| Shared resources    | Explicit references to immutable weights and prepared resources                    |

Existing ring-cache cloning submits copies; truncation changes lengths without restoring overwritten values. The new composite transaction MUST NOT treat those operations as equivalent.

A missing clone/restore implementation MUST reject. It MUST NOT alias the mutable parent as a fallback.

### 6.2 Stage-specific replay inputs

**RDI-11 — Replay-input retention.**

`evaluateBlock()` MUST retain exact inputs until commit or discard settles:

- Stage 0: token IDs, absolute positions, and execution identity.
- Stage 1: received activation rows, layout, absolute positions, payload identity, and required token context.

For partial acceptance of `a` from `a,b,c`, both stages materialize `p,a`. Stage 1 therefore replays the **first two activation rows**, not one row and not token IDs alone.

The first implementation MUST restore scratch from the parent and replay the accepted materialized prefix whenever tentative state extends beyond the successor. It MUST NOT use counter-only truncation.

Stage 0 MUST compare regenerated accepted boundary rows with its retained original rows under the exact replay contract. A mismatch is `REPLAY_DIVERGENCE`; it MUST NOT silently substitute the new rows. Stage 1 replays the original received rows.

Reconstruction installs the bound decision without repeating authoritative sampling, decoder acceptance, publication, or tool execution.

### 6.3 Method behavior

**RDI-12 — Local transitions.**

| Operation            | Preconditions                                                                                      | State changes and output                                                                                                                                                        | Cancellation/error behavior                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `beginBlock`         | Live published cursor; same policy; no unresolved branch; resource admission succeeds; parent idle | Pin parent; allocate/copy scratch; register all resources; return handle only after required copies settle                                                                      | Before mutation: reject cleanly. During copies: track ownership until settlement; parent remains valid.                        |
| `evaluateBlock`      | Matching scratch, base cursor, proposal, epoch, and retained-input allowance                       | Retain immutable inputs; run hypothetical inputs sequentially inside this stage; stage 0 returns activation frame; stage 1 retains bounded per-row target-selection information | Never mutate parent. Failure makes branch noncommittable. No output publication.                                               |
| `verifyBlock`        | Final stage only; complete valid evaluation; unchanged policy                                      | Determine matching proposal prefix, correction/bonus, stopping, decoder successor, and exact cursor                                                                             | Pure indexed target draws do not advance permanent RNG state. Repeated operation returns the same decision.                    |
| `prepareBlockCommit` | Valid decision bound to evaluation and base                                                        | Restore/replay as needed; prepare exact successor and decoder state; await submitted work; return `PreparedSuccessor`                                                           | Failure leaves parent unchanged and branch noncommittable. No new sampling.                                                    |
| `commitBlock`        | Prepared successor; expected parent cursor and revision still match; attempt not retired           | Under resident lock, install successor once; retain immutable acknowledgment                                                                                                    | Before swap: cancellation prevents commit. After swap: return committed outcome or retain it for retry; never report rollback. |
| `discardBlock`       | Branch exists, or retained discard result exists                                                   | Settle provisional work and release branch-owned inputs/state                                                                                                                   | After commit it MUST NOT undo installed state. Return `ALREADY_COMMITTED`; attempt cleanup uses existing `closeAttempt`.       |

Stage-1 evaluation MAY compute and retain each row’s provisional target-selected ID as logits become available, avoiding a full-vocabulary matrix. This remains provisional: verification determines the accepted prefix, and permanent decoder/cursor state changes only during preparation/commit.

### 6.4 Memory and completion

**RDI-13 — Account actual overlap.**

\[
M*{\text{peak}} =
M*{\text{weights}}
+M*{\text{all live attempts}}
+M*{\text{parents retained separately}}
+M*{\text{scratch}}
+M*{\text{replay inputs}}
+M*{\text{workspace}}
+M*{\text{staging}}
+M\_{\text{unsettled resources}}.
\]

Terms represent disjoint owned allocations; aliases are not double-counted, and hidden copies are not omitted.

The configured **1,420,000,000-byte GPU-buffer allocation ceiling** remains unchanged for the applicable contributor profile. It is not a statement about total process RAM or physical GPU residency.

Restoration SHOULD reuse scratch storage. If it allocates a replacement before the rejected scratch is released, admission MUST charge all three copies: parent, old scratch, and replacement scratch.

Copies and dispatches remain owned after cancellation until completion is observed. Cleanup failure retains the resource owner and blocks reuse of those allocations.

Parent prefix references retained by other local consumers survive a successful commit through reference counting. Their memory remains charged.

---

## 7. Distributed protocol

**Status:** **Proposed**, extending existing partition transport and receiver owners.

### 7.1 State machines

**RDI-14 — One unresolved block and ordered phases.**

```text
Stage:
Idle
  → Forking
  → Evaluating
  → Evaluated
  → PreparingAccepted
  → Prepared
  → Committed

Any precommit state → Discarding → Settled
Any uncertain/failed state → Retiring → Settled or Unconfirmed
Committed cannot transition back to its old parent.
```

```text
Attempt coordinator:
Running
  → BlockOpen
  → Evaluated
  → DecisionBound
  → BothPrepared
  → Committing
  → BothCommitted
  → AwaitingPublication
  → Running or Completed

Any state → Cancelling / Interrupted
Retired attempts cannot return to Running.
```

No next block starts until the current block is published or the attempt is retired. Different attempts may progress independently.

### 7.2 Successful or normally rejected block

```text
Conversation owner C       Coordinator / A             Stage B
        |                        |                        |
        | existing published cursor                      |
        |                        |-- beginBlock --------->|
        |                        | begin local scratch    |
        |                        | evaluate p,d1..dk       |
        |                        |-- activation block --->|
        |                        |                        | evaluate
        |                        |                        | verify
        |                        |<-- bound decision -----|
        |                        | prepare accepted A     |
        |                        |-- prepare decision --->|
        |                        |<-- prepared B ---------|
        |                        | compare logical cursors|
        |                        | commit A               |
        |                        |-- commit B ----------->|
        |                        |<-- commit ack B --------|
        |<-- decision + matching commit acknowledgments -|
        | transactional publication append               |
        |-- publication acknowledgment -->|              |
        | deliver saved output             |              |
```

Proposal rejection is a normal successful block outcome. It causes accepted-state reconstruction, not an automatic failed attempt.

Both prepared successors MUST identify the same decision and successor cursor. Their state bytes differ by layer and MUST NOT be compared as identical replicas.

### 7.3 Duplicate delivery and lost acknowledgments

**RDI-15 — Idempotency.**

Receiver lookup key:

```text
(coordinatorEpoch, participantEpoch, attemptId, blockSequence, phase)
```

The receiver’s stage identity is an additional fixed namespace, not a caller-selected substitute.

Stored fingerprint:

```text
digest of the immutable behavioral request,
including expected cursor, generation, proposal,
authorization scope, payload identity and byte length
```

The fingerprint is not part of the lookup key.

```text
A                              B
|-- commit(key,digest) -------->|
|                              | installs successor once
|       acknowledgment lost    |
|-- same commit(key,digest) --->|
|<-- original acknowledgment --|
```

| Duplicate condition                    | Required behavior                          |
| -------------------------------------- | ------------------------------------------ |
| Same key/digest pending                | Join the existing operation                |
| Same key/digest completed and retained | Replay original result after authorization |
| Same key, changed digest               | `OPERATION_COLLISION`; no execution        |
| Changed expected cursor under same key | Collision, not a fresh operation           |
| Retired attempt or stale epoch         | Reject before allocation                   |

### 7.4 Bounded retention

**RDI-16 — Expiration and fencing.**

Initial protocol defaults:

| Limit                                        |        Initial value |
| -------------------------------------------- | -------------------: |
| Unresolved blocks per attempt                |                    1 |
| Maximum draft tokens                         |                    4 |
| Retained completed block-result sets         |                    2 |
| Completed-result retry age                   |            60,000 ms |
| Maximum control message                      | 65,536 encoded bytes |
| Maximum retained control results per attempt |      1,048,576 bytes |

Artifact/activation bytes are admitted separately. Model and attempt limits may reduce these values.

Unresolved operations MUST NOT be evicted. Admission MUST reject rather than discard an unresolved transaction to create room.

After result eviction, the receiver retains a monotonic completed/retired-through boundary. Requests at or below that boundary return `RESULT_EXPIRED`; they never become new work. The boundary cannot advance past unresolved work.

Attempt tombstones remain bounded by the existing admitted-attempt limit. When that history is exhausted, the owner drains or rejects new attempts. It MUST NOT erase tombstones and reuse identities in the same epoch.

A restarted participant uses a new epoch and rejects old handles and operations.

### 7.5 Failure disposition

**RDI-17 — Fail locally, fence globally visible output.**

| Failure point                              | Required disposition                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| Before branch admission                    | Ordinary execution may be selected without speculative mutation                   |
| During evaluation/preparation              | Discard and settle branches; network attempt is interrupted conservatively        |
| One stage committed; other status unknown  | Retry the identical operation within its retention/deadline; otherwise interrupt  |
| Both committed; publication status unknown | Query/retry the idempotent publication operation; do not generate again           |
| Participant disconnects                    | Fence the attempt; retain last published prefix; unknown resources remain charged |
| Late response from old epoch               | Reject; never attach it to a replacement                                          |
| Cleanup fails                              | Keep affected capacity unavailable; expose retryable cleanup                      |
| Other healthy capacity exists              | It may serve a separately authorized attempt without waiting for the entire mesh  |

```text
C records cancellation        A                         B
        |                     |-- late commit request ->|
        | reject publication  |<-- possible commit ack --|
        |                     | retire attempt           |
        |                     |-- settle --------------->|
        | preserve old output |                          |
```

This protocol does not provide atomic distributed commit or transparent coordinator failover. Two acknowledgments establish two reported local commitments, not a fault-tolerant consensus service.

---

## 8. Publication and stopping

### 8.1 Durable publication

**RDI-18 — Append before delivery.**

The conversation owner MUST process:

```text
matching stage commit acknowledgments
→ idempotent durable output transaction
→ notification/UI delivery
```

The durable transaction MUST atomically:

1. Verify the attempt writer epoch and expected attempt revision.
2. Reject cancelled, retired, or superseded attempts.
3. Verify contiguous token and visible-output ranges.
4. Insert the event or recognize an identical existing event.
5. Advance the durable output head and attempt revision.
6. Record the successor cursor and terminal outcome.

Only transaction completion makes the event **Published**.

The inspected workspace currently accepts text deltas and persists through `load/save`; the host’s default adapter is localStorage. That is not the specified transactional token-history contract and requires an explicit extension.

The first browser implementation SHOULD use the existing artifact-storage ownership and an IndexedDB transaction. It MUST NOT pretend a sequence of independent writes is atomic.

```text
function publish(decision, commits):
    transaction(attempt):
        if identical event already exists:
            return original publication receipt
        require current writer epoch
        require attempt permits publication
        require matching commits and expected revision
        require contiguous token/output ranges
        append immutable event
        advance output head and revision
    after transaction completion:
        notify subscribers
```

### 8.2 Cancellation ordering

**RDI-19 — One serialized authority.**

Cancellation and publication MUST compete through the same durable attempt transition.

| Winner                                 | Outcome                                                           |
| -------------------------------------- | ----------------------------------------------------------------- |
| Cancellation transaction commits first | Unpublished block is suppressed; execution is retired/settled     |
| Publication transaction commits first  | Output remains recorded; cancellation prevents further progress   |
| Storage outcome is unknown             | No new output is delivered until the event’s presence is resolved |
| Storage fails                          | Stop the attempt; retain the last confirmed durable prefix        |
| Output persisted, delivery failed      | Replay the saved event; no model execution                        |

An abort flag may request prompt cancellation, but it is not the publication linearization point. If recording cancellation fails, the in-memory owner MUST immediately fence further delivery and execution; on reopening, unfinished attempts are interrupted.

The browser has one authorized writer epoch per conversation store. Other tabs are read-only unless an explicit ownership transition creates a new epoch and interrupts old active attempts. This is not transparent failover.

### 8.3 Tokens, decoding, and stop matching

**RDI-20 — Preserve raw token authority and irrevocable text.**

Each accepted token ID MUST pass through the same versioned incremental decoder used by ordinary execution. Decoder mutation occurs on provisional state until preparation/commit.

For the initial new decoder profile:

- Stop matching operates on tokenizer-decoded text before UI rendering.
- Partial byte sequences remain buffered.
- A suffix that could become a stop string remains withheld.
- Matching examines completed occurrences inside newly decoded text, not only whether a token’s text ends with a stop string.
- The first completed match in character order wins; ties use earlier start, then configured string order.
- Stop text and later text from that same decoded chunk are not displayed.
- EOS/stop-token detection precedes text-stop detection; text-stop precedes max-token termination.
- On ordinary EOS or max-token finalization, nonmatching buffered text is flushed according to the admitted decoder contract.
- On cancellation/failure, unresolved withheld text is not newly flushed.

Example:

```text
Accepted token in block 1 decodes: "hello ST"
Configured stop string:          "STOP"

Published visible text:          "hello "
Retained decoder suffix:         "ST"

Next accepted token decodes:     "OP tail"
Published next visible delta:    ""
Terminal reason:                stop-sequence
```

Both raw token IDs remain in the durable token record. The second token terminates generation even though its visible delta is empty.

Raw-character and visible-character limits are checked separately. A character-limit violation before publication fails the unpublished transition; it does not authorize truncating an answer into a passing result.

Existing alternative decoder/projection behavior MUST retain its own identity and qualify fork/restore before using blocks. This specification does not silently replace legacy decoding.

### 8.4 Delivery, disclosure, and tools

**RDI-21 — Replay does not execute.**

UI application MUST deduplicate by event identity and enforce visible-range continuity. Reconnection replays saved events, not generation calls.

Retained output delivery MUST recheck applicable read/disclosure authorization. Revoking future remote disclosure does not automatically erase already authorized local history; read, disclosure, retention, and deletion rights remain distinct.

Tool side effects MUST consume committed, deduplicated tool-call records through the existing tool runner. Draft text, provisional decoder output, and a repeated publication delivery MUST NOT invoke tools.

This increment does not promise exactly-once effects in an external service lacking its own idempotency mechanism.

---

## 9. Placement, resources, and privacy

### 9.1 Preparation versus request placement

**RDI-22 — Prepare slowly; admit quickly.**

The slow preparation loop acquires authorized dependencies, prepares valid partitions, and advertises observed readiness. It SHOULD favor missing compatible stage coverage over redundant copies of an already abundant stage.

The fast request loop selects among prepared, eligible routes and reserves the complete path. New participants MUST NOT migrate an active attempt.

Before ranking, Reploid MUST reject routes failing any required condition: model/execution compatibility, qualification policy, disclosure scope, stage epoch, memory admission, supported layout, or deadline eligibility.

`inspectPartitionPlan()` is a **Proposed Doppler API** reporting validated dependencies, resource requirements, unknown bounds, and applicable evidence identities. It does not grant application eligibility.

### 9.2 Complete-route cost

**RDI-23 — Measured ranking is optional.**

The initial fixed-route block implementation MUST work without a new placement algorithm.

When enabled, ranking extends the existing selector and estimates:

\[
T*{\text{route}} =
T*{\text{preparation}}
+T*{\text{queue}}
+T*{\text{prefill}}
+\widehat N T*{\text{decode}}
+T*{\text{risk}}.
\]

For ordinary dependent decode:

\[
T*{\text{decode}}
=
\sum_i T*{\text{stage},i}
+\sum*{i\to i+1}T*{\text{activation}}
+T\_{\text{selected-token return}}.
\]

The relevant links are directed executor-to-executor paths, including actual relays. Requester-to-peer ping alone is insufficient. Nested measurements MUST NOT be added twice.

\(\widehat N\) is a scheduling estimate; declared maximum output controls admission.

Queue, throughput, availability, and acceptance estimates MAY be approximate and stale within a declared TTL. They MUST NOT soften permissions, resource limits, or committed state.

The existing selector already filters zero-capacity input owners; ranking MUST extend that behavior and include complementary-executor capacity.

### 9.3 Reservations and shared devices

**RDI-24 — Enforce real capacity.**

Reserve stages in a consistent authority/participant order using bounded provisional reservations. Activate only after all stages accept. Failed route admission releases successful provisional reservations or leaves unresolved ownership charged.

A browser and native process sharing one GPU MUST NOT each count the entire group budget as independently available.

A hard shared-device guarantee requires an actual local admission authority, or explicit mutually exclusive/static allocations enforced by that authority. A resource-group label alone is a hint.

Without enforceable group admission, Reploid MUST NOT claim that overlapping process budgets establish independent capacity.

Reservations charge actual speculative state, retained frames, copying, and unsettled cleanup. Hypothetical acceptance rates cannot reduce the reserved worst case.

### 9.4 Prefix and drafter privacy

**RDI-25 — Private state remains scoped.**

Prefix handles and hashes MUST NOT enter global discovery. Prefix affinity is evaluated only inside an authorized scope.

A drafter is a disclosure recipient even when colocated with a target stage. Its access to prompt tokens, previous outputs, tools, or private prefixes requires explicit authorization.

Initial prefix forks preserve the same generation identity, execution identity, token history, position, state layout, and policy. Cross-temperature forks, changed adapters, prefix rebasing, and portable state movement are Deferred.

Piece replication MAY occur within custody grants. It does not authorize replication of private KV, recurrent, decoder, or conversation state.

---

## 10. Implementation map

**RDI-26 — Extend owners and migrate explicitly.**

`Changed` below means the specification requires extending an existing owner. `Proposed addition` means a new narrowly scoped module, not another runtime or framework.

| Requirement group                | Existing modules to extend                                                                                                                                                         | Proposed additions and dependencies                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sampling identity and validation | Doppler `src/config/generation-contract.json`, `tools/sync-generation-contract.js`, generated `generation-contract.*`                                                              | Add the versioned policy schema; regenerate declarations rather than hand-editing generated types                     |
| Random words                     | Doppler `src/inference/token-sampling.*`                                                                                                                                           | `src/inference/sampling-rng.*`; Philox vectors and counter packing                                                    |
| Selection consistency            | `generation-step.js`, `src/client/runtime/session-controller.js`, `pipelines/text/resident-partition.js`, `generator*`, `generator/decode-runtime.js`, `src/gpu/kernels/sample.js` | One admitted CPU selection profile; GPU support remains separately qualified                                          |
| Plan inspection                  | Doppler `layer-partition-contract.*`, `partition-execution.js`, `src/client/resident-partitions.*`, `src/partitions.*`                                                             | `partition-plan-inspection.*` under the existing text pipeline ownership                                              |
| Composite state                  | `partition-attempt.js`, `resident-partition.*`, `linear-attention.js`, `linear-attention/state-layout.js`, `src/inference/kv-cache/`                                               | `resident-state.*`; complete local state ownership and restoration                                                    |
| Decoder snapshot/restore         | Doppler `src/inference/tokenizers/bundled/incremental-decoder.*` and existing generation-output owners                                                                             | Add local snapshot/restore methods to those owners, not a parallel decoder                                            |
| Block computation                | Doppler `src/inference/speculative.js`, `partition-execution.js`, existing logits owners                                                                                           | `resident-block-contract.*`; bounded target-replay operations                                                         |
| Discovery and ranking            | Reploid `partition-discovery.js`, `partition-placement.js`, `automatic-partitions.js`, existing `placement-beliefs.js`                                                             | Optional complete-route observations; fixed-route blocks do not depend on them                                        |
| Block transport                  | Reploid `partition-runner.js`, `partition-peer.js`, `partition-entry.js`, `partition-step-receiver.js`, `partition-contract.js`                                                    | Versioned block envelopes within existing transport                                                                   |
| Grants and budgets               | `partition-grants.js`, `partition-reservations.js`, `resident-partition.js`, `self/config/partition-policy.json`                                                                   | Explicit branch/frame/control allowances and local authority bindings                                                 |
| Publication semantics            | `packages/reploid/src/chat/workspace.js`, `self/host/chat-session.js`, `chat-execution.js`, `product-session.js`                                                                   | A focused publication reducer under `src/chat/` and transactional conversation-history adapter under `src/artifacts/` |
| Piece acquisition                | `self/host/work-partitions.js`, `work-model-files.js`, `packages/reploid/src/artifacts/custody/`                                                                                   | Reuse existing custody; no checkpoint transport in this increment                                                     |
| Browser/native composition       | Existing browser host and `server/native-participant.js`                                                                                                                           | Capability negotiation and exact installed-identity checks only                                                       |
| UI                               | Existing conversation workspace and message rendering                                                                                                                              | Consume durable events; no new scheduler or governance dashboard                                                      |

The generation declarations explicitly identify `generation-contract.json` as their source. Current public partition types and resident recovery declarations provide the extension points but do not expose these block APIs.

### Migration rules

1. Legacy sampler and generation identities MUST remain interpretable without changing their transcripts.
2. The new generation policy MUST require explicit selection; old numeric seeds are not silently remapped.
3. Block capability MUST be separately advertised. Existing checkpoint/replay flags MUST remain false unless those distinct capabilities are implemented.
4. Paired activation layouts MUST use the existing Doppler layout/schema owner; old receivers reject unsupported schemas rather than inferring them.
5. Existing text-only conversation records remain valid display history. They MUST be marked as lacking authoritative generated-token history and excluded from new prefix/state claims.
6. The transactional history adapter MUST migrate or reference legacy history without two competing authoritative writers. Failed migration preserves the legacy store.
7. Source, package, and served browser changes require new identities and applicable conformance checks. Generated delivery files MUST be regenerated from canonical source.
8. JSON declares policies and limits; JavaScript owns orchestration and state lifecycle; WGSL implements GPU arithmetic. Random-word and CPU selection code are appropriate JavaScript computation, not network policy.

---

## 11. Acceptance matrix

**RDI-28 — Separate gates and evidence.**

Every proposed test below is **required future work**. None is reported as passed by this specification.

| Gate                               | Required evidence                                                                                           | Does not establish                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Distribution parity**            | Split versus whole execution under the same admitted policy, including selected tokens and stopping         | Independent mathematical accuracy              |
| **Independent numerical accuracy** | Applicable approved reference and unchanged tolerance; retain the existing 0.001 requirement where mandated | Same-seed transcript across different samplers |
| **Random-word conformance**        | Published Philox vectors, seed encoding, counters, purposes, lanes                                          | Equal probability arithmetic                   |
| **Same-seed target replay**        | Identical accepted token IDs, stopping, and continuation to ordinary execution in the declared profile      | Universal cross-device equality                |
| **State/lifecycle safety**         | Real state restoration, cancellation, isolation, settlement, and memory accounting                          | Useful answers                                 |
| **Answer quality**                 | Frozen factual/citation tasks and fresh held-out tasks                                                      | Runtime numerical conformance                  |
| **Performance**                    | Complete operation cost and visible pauses against ordinary execution                                       | Safety or quality                              |

The current repository’s qualification boundaries remain separate. This specification neither weakens independent accuracy requirements nor treats their failure as proof of a distribution defect.

### Test catalogue

| Test ID                             | Test surface and required cases                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **T01 Contract validation**         | New schema tests: malformed IDs, nonfinite values, unknown fields, overflow, wrong layout/stride, payload mismatch, unsupported versions      |
| **T02 RNG vectors**                 | New RNG unit tests plus existing seeded-generation tests; published vectors, seed endian, purpose and index isolation                         |
| **T03 Selection**                   | Identical logits, greedy ties, top-K/top-P boundaries, penalty windows, masks, uniform endpoints, CPU/GPU distinction                         |
| **T04 Cursor**                      | All §5 examples; R=0/R=1; terminal entry; pending-token invariants; invisible accepted tokens                                                 |
| **T05 Fork isolation**              | Real full/ring attention, recurrence, convolution, decoder state, parent continuation after child discard                                     |
| **T06 Replay**                      | Ring overwrite and restore; exact stage-1 activation replay; partial and full acceptance; replay divergence rejection                         |
| **T07 Allocation**                  | Failure before/during copies, transient third copy, cancellation during submitted work, cleanup failure, peak accounting                      |
| **T08 Local blocks**                | Every rejection position, k=0, zero/full acceptance, terminal proposal/correction/bonus, repeated prepare/commit                              |
| **T09 Receiver**                    | Extend existing receiver suite: pending join, changed digest, duplicate commits, result eviction, retirement boundary, stale epochs           |
| **T10 Distributed failures**        | Lost messages/acks, failure at every phase, one-stage commit, disconnect, replacement on independent capacity                                 |
| **T11 Publication**                 | Durable append failure and unknown outcome, duplicate event, crash before/after append, delivery replay                                       |
| **T12 Cancellation/stops/tools**    | Cancellation/publication races, stop strings across blocks, partial decoded bytes, invisible controls, no speculative side effects            |
| **T13 Routes/resources**            | Complementary capacity, stale offers, provisional admission, directed costs, shared-device overcommit rejection                               |
| **T14 Privacy**                     | Drafter grants, private prefix scope, revoked output reads, changed recipients, unauthenticated handles                                       |
| **T15 Delivery migration**          | Legacy history preservation, writer epochs, exact installed package/browser identities, unsupported capability rejection                      |
| **T16 Physical parity/performance** | Existing physical partition tests extended with nonzero-temperature interleaving, ordinary/block comparison, both placements, complete timing |
| **T17 Application quality**         | Frozen and fresh complete-request tasks, follow-ups, citations, source navigation, uninterrupted versus recovered user journeys               |

Existing seeded and physical tests SHOULD be extended. New composite-state and block tests MUST use actual state owners rather than mocks for restoration claims. The existing receiver test suite already exercises identity collisions and is the appropriate place for the new bounded-replay cases.

---

## 12. Delivery sequence

### 12.1 Smallest independently testable increments

**RDI-30 — Ordered delivery and deferral.**

| Increment                                      | Deliverable                                                                                                                     | Completion criterion                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A. Ordinary sampling**                       | Versioned random-word and CPU selection profile; legacy preservation                                                            | T02/T03 plus ordinary whole/split and interleaving results                    |
| **B. Executable cursor contracts**             | Cursor validation, decisions, stopping alignment, typed fixtures                                                                | T01/T04; no GPU or networking claims                                          |
| **C. Local same-policy fork**                  | Composite state owner, retained replay inputs, exact accepted-state preparation                                                 | T05–T08 on real supported cache/state geometries within the allocation budget |
| **D. Fixed-route two-stage blocks**            | Existing runner/peer/receiver extensions and durable publication                                                                | T09–T12; failure injection at every transition; no transparent failover       |
| **E. Exact-package application qualification** | One package/browser/native combination                                                                                          | T15–T17 and all applicable separate gates                                     |
| **F. Optional measured placement**             | Complete-route ranking using existing discovery/reservations                                                                    | T13/T14 and a measured route-level benefit                                    |
| **Deferred**                                   | Portable checkpoints, cross-policy prefix rebasing, more stages, rejection sampling, transparent failover, unrelated optimizers | Requires a separately scoped specification and evidence                       |

Fixed-route block execution MUST NOT wait for optional dynamic-placement improvements.

### 12.2 Ordinary fast path

**RDI-27 — Unify semantics, not overhead.**

Ordinary generation MUST NOT allocate speculative scratch, retain speculative activation blocks, or execute a prepare/commit RPC sequence merely because `k=0` is logically equivalent to one advance.

It uses the same cursor, sampling, stopping, and publication semantics through its admitted ordinary execution path.

Speculation MAY be declined before branch admission. Once a network block has mutated provisional state, failures follow the explicit transaction rules; no hidden recomputation or fallback is permitted.

### 12.3 Performance acceptance

**RDI-29 — Earn complete cost.**

Measure:

\[
T*{\text{block}} =
T*{\text{draft}}
+T*{\text{copy}}
+T*{\text{evaluate}}
+T*{\text{transfer}}
+T*{\text{accepted replay}}
+T*{\text{prepare/commit}}
+T*{\text{publication}}
+T\_{\text{cleanup attributable to the block}}.
\]

The comparison denominator is newly **published accepted raw tokens**, with failures, discarded work, and cleanup included. Also report complete-request latency and visible-output pauses.

Initial experiments compare fixed `k ∈ {1,2,4}` against ordinary execution. Automatic block-size adaptation is disabled until one fixed configuration earns admission.

Before candidate measurements, freeze the workload, seeds, execution route, cache state, warmup policy, repetitions, and visible-pause budget. Use at least 30 paired measured requests after separately reported warmups. Preserve every failed or interrupted measurement with its classification.

The initial promotion rule SHOULD require:

- At least a 5% improvement in median paired complete cost per published token.
- A paired uncertainty analysis that does not support a regression.
- No breach of the frozen first-output or visible-gap limits.
- No memory, correctness, lifecycle, or answer-quality regression.

The percentage is a proposed engineering threshold, not a measured result. A cohort with inadequate or noisy evidence remains inconclusive.

Measure gaps between **visible publication batches**, not just token timestamps inside a burst. Count all control exchanges, copying, retained buffers, CPU selection, and stage acknowledgments. Sequential-first blocks target fewer network waits; they do not inherently reduce target computation.

The attached design explicitly requires complete committed-token cost, visible-gap limits, and all protocol exchanges rather than acceptance rate alone. Pasted text

### 12.4 Remaining decisions that require evidence

The architecture and initial behavior are fixed. Only these deployment choices remain open:

| Decision                                                       | Resolution process                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Which concrete model/runtime package is admitted               | Applicable numerical, lifecycle, quality, and package gates          |
| Which host arithmetic profiles may claim same-seed equivalence | T03/T16 conformance; no universal inference from shared random words |
| Which cache/state geometries advertise local forks             | Real restoration and allocation tests; unsupported layouts reject    |
| Whether shared draft draws outperform independent draws        | Separate fixed-policy measurements                                   |
| Whether speculation is enabled for a route/workload cohort     | RDI-29 complete-cost and visible-pause acceptance                    |
| Whether dynamic ranking is worth enabling                      | Route-level evidence after eligibility and reservation correctness   |

### Requirement-to-owner-to-test traceability

| Requirement                                          | Status              | Responsible owner/modules                                        | Acceptance tests                                                        |
| ---------------------------------------------------- | ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **RDI-01 Evidence identity**                         | Changed             | Both release/package owners; Reploid delivery configuration      | T15, T16                                                                |
| **RDI-02 Scope and ownership**                       | Changed             | Existing Doppler computation and Reploid coordination boundaries | T01, architectural import checks                                        |
| **RDI-03 Canonical validated contracts**             | Proposed            | Doppler block contracts; Reploid partition contracts             | T01                                                                     |
| **RDI-04 Immutable route/attempt binding**           | Changed             | `partition-contract`, grants, resident allocation                | T01, T09, T14                                                           |
| **RDI-05 Philox random words**                       | Changed             | Doppler `sampling-rng`, `token-sampling`                         | T02                                                                     |
| **RDI-06 Selection arithmetic and order**            | Changed             | Doppler generation-step and sampling owners                      | T03, T16                                                                |
| **RDI-07 Semantic indices and coupling**             | Changed             | Doppler ordinary/resident callers and verifier                   | T02, T03, T08, T16                                                      |
| **RDI-08 Cursor bounds and accounting**              | Proposed            | Doppler cursor/resident contracts                                | T04, T07                                                                |
| **RDI-09 Accepted transition alignment**             | Proposed            | Doppler block verifier and state preparation                     | T04, T06, T08                                                           |
| **RDI-10 Composite fork isolation**                  | Proposed            | Doppler `resident-state`, KV, recurrent and decoder owners       | T05, T07                                                                |
| **RDI-11 Stage-specific replay inputs**              | Proposed            | Doppler partition execution; Reploid frame lifetime              | T06, T08                                                                |
| **RDI-12 Local transaction operations**              | Proposed            | Doppler resident/block owners                                    | T05–T08                                                                 |
| **RDI-13 Actual allocation and settlement**          | Changed             | Doppler memory owners; Reploid reservations                      | T07, T13, T16                                                           |
| **RDI-14 One-block distributed lifecycle**           | Proposed            | Reploid runner, peer, entry                                      | T08–T10                                                                 |
| **RDI-15 Duplicate key and fingerprint**             | Changed             | Reploid step receiver and contract                               | T09                                                                     |
| **RDI-16 Retention, expiration and epochs**          | Changed             | Reploid receiver and participant lifecycle                       | T09, T10, T15                                                           |
| **RDI-17 Local failure and independent replacement** | Changed             | Reploid attempt/placement/reservation owners                     | T10, T13                                                                |
| **RDI-18 Durable append before delivery**            | Changed             | Reploid workspace and transactional history adapter              | T11, T15                                                                |
| **RDI-19 Cancellation/publication serialization**    | Changed             | Reploid serialized attempt history transition                    | T11, T12                                                                |
| **RDI-20 Raw-token and stopping semantics**          | Changed             | Doppler incremental decoder; Reploid durable output records      | T04, T08, T12                                                           |
| **RDI-21 Replay, read authorization and tools**      | Changed             | Reploid publication/disclosure and existing tool runner          | T11, T12, T14                                                           |
| **RDI-22 Preparation and eligibility**               | Changed             | Reploid automatic partitions; Doppler plan inspection            | T01, T13                                                                |
| **RDI-23 Complete-route ranking**                    | Proposed, optional  | Reploid placement and observations                               | T13, T16                                                                |
| **RDI-24 Enforceable shared-device admission**       | Changed             | Actual local admission authority; existing reservations          | T07, T13                                                                |
| **RDI-25 Private prefix and drafter access**         | Proposed            | Reploid grants; Doppler local handle validation                  | T05, T14                                                                |
| **RDI-26 Versioning and migration**                  | Changed             | Generated contracts, public exports, host and delivery owners    | T01, T15                                                                |
| **RDI-27 Cheap ordinary path**                       | Changed             | Doppler ordinary execution; Reploid ordinary runner              | T07, T16                                                                |
| **RDI-28 Separate acceptance gates**                 | Changed             | Existing test/evidence owners in both repositories               | T01–T17, separately reported                                            |
| **RDI-29 Complete-cost promotion**                   | Proposed            | Both benchmark owners and Reploid admission policy               | T16, T17                                                                |
| **RDI-30 Delivery order and deferred scope**         | Proposed / Deferred | Canonical cross-project task ownership                           | Increment completion records; no capability advertised before its gates |
