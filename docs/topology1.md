# Reploid and Doppler distributed inference specification

Version 1 proposed implementation contract
12 October 2026

This specification consolidates the latest 96-line paste and the preceding 290-line amendment into one implementation plan. The sequence is ordinary sampling consistency, a same-policy local state fork, and two-stage target-replay blocks. The first implementation proof is an isolated fork that restores each stage's actual inputs within its admitted memory budget. A specification is not evidence that these capabilities have shipped.

MUST denotes a release requirement. SHOULD denotes the recommended default whose exception requires recorded evidence. MAY denotes an optional behavior. All interfaces introduced below are proposed contracts, not assertions about current exported APIs.

## 1 Scope and evidence

E01. Existing means observed in the earlier source audit; Proposed means a new contract; Changed means an existing owner must be extended; Deferred means excluded from this series. Source identities must travel with test receipts. A source checkout, published package, and browser-served bundle are separate artifacts.

Previously inspected baseline: Doppler 651cdf0b564daef5b765e2a0450dd716a60bf377; Reploid d2ee4d545d52d047be07f5ee426647805f52d12c. Those observations establish a two-stage resident partition path, reservations/grants, single-token incremental execution, existing attention and recurrent state owners, and a Reploid Doppler package pin of 0.6.27. They do not establish block execution. A final source-owner check is recorded in section 10.

Existing: two-stage execution, resident ownership, partition contracts, ordinary generation, attention-cache and recurrent-state machinery. Changed: sampling identity, composite state ownership, stage-input retention, deduplication and publication integration. Proposed: the block interfaces, isolated composite fork, accepted-state preparation, and typed records below. Deferred: portable GPU checkpoints, transparent coordinator failover, more than two stages, cross-policy prefix forks, general batched target kernels, new consensus machinery, and a new tool-execution framework. Dynamic route ranking follows the fixed-route proof.

The uploaded reviews are design evidence. Reported toy cursor test counts have not been independently reproduced here. No GPU, browser, failure-injection or application benchmark was run for this specification. Existing numerical-accuracy and quality gates remain separate requirements; this document does not waive them.

## 2 Concepts and ownership

Concept | Owner and identity | Lifecycle and invariant
Participant | Reploid; authenticated participant ID plus execution epoch | Advertised, eligible, reserved, active, draining or lost. A reconnect does not erase unsettled ownership.
Piece | Reploid custody; content hash plus byte range | Acquired, verified, retained, released. A storage piece is not automatically an executable partition.
Partition | Doppler; model and partition-plan digest plus layer interval | Validated computational slice with declared input/output layouts and state requirements.
Stage | Doppler executes; Reploid assigns; route ID plus A or B | A is the upstream partition and B is the target sampler. Stages execute a dependent forward path.
Route | Reploid; immutable route digest | Prepared candidate, admitted assignment, expired. Includes ordered stages and directed links.
Attempt | Reploid coordination and Doppler stage-local ownership; unique attempt ID | Reserved, live, interrupted/cancelled/completed, settling, settled. Retransmission is not a new attempt.
Cursor | Doppler logical state, mirrored by Reploid; attempt ID and monotonic revision | Binds materialized history, accepted output count, pending token and terminal state.
Prefix | Doppler local immutable state handle, Reploid authorization | Pinned, forkable, expired, released. Exact computational and authorization compatibility is required.
Block | Reploid coordinated advance; attempt ID plus sequence | One unresolved block per attempt. Contains bounded draft proposals following the pending token.
Prepared | Doppler stage-local successor handle | Accepted state fully constructed and submitted preparation work settled; parent unchanged.
Committed | Doppler stage-local state installation | Expected-parent compare-and-swap succeeded and original acknowledgment retained.
Published | Reploid conversation storage | Accepted output durably appended after matching stage commits. UI delivery is a later replayable operation.

Independent jobs have no shared token-by-token model dependency. Dependent partitions exchange boundary activations. Target-replay blocks amortize those exchanges across hypothetical inputs. No contract imposes per-token network coordination on all mesh work.

## 3 Typed contracts

T01. The following notation is TypeScript-like. Opaque strings MUST be validated, not trusted merely because they have a type name. Wire records use schemaVersion: 1. Unknown versions and unknown behavior-changing fields reject. Optional fields appear only where explicitly marked. Hashes use SHA-256 over a single versioned canonical encoding; canonical JSON uses sorted object keys, no undefined values, no NaN/infinity, and safe integers only. Binary payloads are hashed as bytes, outside JSON. Domain tags distinguish record kinds.

Types: ID is a nonempty opaque identifier with a bounded encoded length. Digest is 64 lowercase hexadecimal characters. Count is an integer from 0 through 2^53-1, further bounded by the model and negotiated limits. Bytes is Count in bytes; TimeMs is finite nonnegative milliseconds. Token is uint32 strictly below vocabularySize. U64Hex is exactly 16 lowercase hexadecimal digits, avoiding JSON precision loss. All intervals are half-open [start,end). Digest fields cover every behavior-changing nested field or its immutable digest.

GenerationIdentity = {
schemaVersion: 1, generationId: ID,
modelDigest: Digest, tokenizerDigest: Digest, planDigest: Digest,
numericalProfile: ID, runtimeDigest: Digest,
samplerId: ID, policyDigest: Digest, seed: U64Hex,
promptDigest: Digest, promptTokens: Count, vocabularySize: Count,
maxGeneratedTokens: Count, contextInputCapacity: Count
}

StageAssignment = {
stage: 'A'|'B', participantId: ID, executionEpoch: ID,
partitionDigest: Digest, incomingBoundary: ID|null,
outgoingBoundary: ID|null, admissionAuthorityId: ID,
resourceGroupId: ID, reservationId: ID
}
RoutePlan = {
schemaVersion: 1, routeId: Digest, generationIdentityDigest: Digest,
stages: [StageAssignment, StageAssignment],
link: {from:'A', to:'B', layoutDigest:Digest, maxFrameBytes:Bytes},
grantDigest: Digest, evidenceDigest: Digest, expiresAtUnixMs: Count
}

Reservation = {
reservationId: ID, authorityId: ID, resourceGroupId: ID,
attemptId: ID, stage:'A'|'B', capBytes: Bytes,
breakdown: {weights:Bytes, parent:Bytes, scratch:Bytes,
retainedInputs:Bytes, staging:Bytes, temporaries:Bytes,
unsettledDestruction:Bytes},
state:'provisional'|'active'|'settling'|'released'
}

Cursor = {
attemptId: ID, revision: Count, generationIdentityDigest: Digest,
promptTokens: Count, materializedTokens: Count,
acceptedGeneratedTokens: Count, pendingToken: Token|null,
acceptedHistoryDigest: Digest, materializedHistoryDigest: Digest,
policyStateDigest: Digest, decoderStateDigest: Digest,
terminal: boolean, stopReason: null|'eos'|'stop_string'|'length'|'context'|'cancelled'
}

StateHandle = {opaqueLocalId:ID, stage:'A'|'B', attemptId:ID,
executionEpoch:ID, cursorDigest:Digest, policyDigest:Digest,
allocationOwnerId:ID, completionOwnerId:ID}
PrefixHandle = {state:StateHandle, generationIdentityDigest:Digest,
exactTokenPrefixDigest:Digest, grantDigest:Digest, expiresAtUnixMs:Count}

ActivationFrame = {
schemaVersion:1, attemptId:ID, blockSequence:Count,
sourceEpoch:ID, destinationEpoch:ID, baseCursorDigest:Digest,
boundaryId:ID, absoluteRowStart:Count, rowCount:Count,
dtype:'f16'|'f32', shape:Count[], strides:Count[],
layoutDigest:Digest, tokenContextDigest:Digest,
payloadDigest:Digest, payloadBytes:Bytes
}
ReplayInputHandle = {opaqueLocalId:ID, stage:'A'|'B',
attemptId:ID, executionEpoch:ID, blockSequence:Count,
baseCursorDigest:Digest, absoluteRowStart:Count, rowCount:Count,
tokenContextDigest:Digest, retainedBytes:Bytes,
allocationOwnerId:ID, completionOwnerId:ID}

BlockRequest = {
schemaVersion:1, attemptId:ID, blockSequence:Count,
baseCursorDigest:Digest, generationIdentityDigest:Digest,
pendingToken:Token, proposals:Token[], replayMode:'sequential-v1',
coupling:'independent'|'shared', grantDigest:Digest
}
VerificationDecision = {
decisionDigest:Digest, attemptId:ID, blockSequence:Count,
baseCursorDigest:Digest, acceptedProposalCount:Count,
acceptedOutput:Token[], replayInputRows:Count,
outputStart:Count, outputEnd:Count, successor:Cursor
}
PreparedSuccessor = {stage:'A'|'B', executionEpoch:ID,
decisionDigest:Digest, parentRevision:Count,
successorCursorDigest:Digest, successor:StateHandle,
preparationSettled:true}
CommitAck = {stage:'A'|'B', executionEpoch:ID, attemptId:ID,
blockSequence:Count, decisionDigest:Digest,
parentRevision:Count, successorCursorDigest:Digest, committed:true}
PublicationRecord = {
schemaVersion:1, conversationId:ID, generationId:ID,
attemptId:ID, blockSequence:Count, decisionDigest:Digest,
priorConversationRevision:Count, successor:Cursor,
outputStart:Count, outputEnd:Count, acceptedTokenIds:Token[],
visibleTextDelta:string, decoderContinuation:{codecId:ID, durableStateRef:ID},
terminal:boolean, stopReason:Cursor['stopReason'],
stageCommitDigests:[Digest,Digest], disclosureGrantDigest:Digest
}

T02. expiresAtUnixMs is an absolute UTC Unix epoch timestamp in milliseconds. Validate it through the existing grant/lease authority, including its clock-skew policy. Expiration prevents new admission; it does not authorize a receiver to free resources on another participant's clock. State and replay handles are process-local capabilities and MUST NOT be serialized as portable GPU state.

T03. Validate row counts, byte-length/shape/stride arithmetic without overflow, vocabulary bounds, stage order, boundary layout, grant, epoch, cursor and reservation before allocation. B receives the token IDs/context needed for penalties as well as activation rows. A digest is an integrity binding, not permission to disclose data.

## 4 Sampling contract

S01. Proposed sampler ID: philox4x32-10/u24-v1. Seed is exactly 16 lowercase hexadecimal digits, parsed losslessly as uint64. Philox key is [low32(seed),high32(seed)]. Let t be the zero-based absolute generated-token ordinal, excluding prompt tokens. For semantic word ordinal j, counter is [low32(t),high32(t),purpose,floor(j/4)]; choose result lane j mod 4. TARGET=0, DRAFT=1; reserve ACCEPT=2 and RESIDUAL=3 for other algorithms, unused here. Target selection always uses (TARGET,t,0). Require t<2^64,j<2^34 and all application counts within safe-integer bounds. Attempt ID, scheduling, block size and retries never enter the RNG address. A replacement continuing the same generation preserves seed/index; a genuinely new generation receives its own identity.

Philox4x32-10 pseudocode, all additions modulo 2^32:
c=counter; k=key
for round in 0..9:
p0=exact_uint64(0xD2511F53*c[0])
p1=exact_uint64(0xCD9E8D57*c[2])
c=[hi32(p1)^c[1]^k[0],lo32(p1),hi32(p0)^c[3]^k[1],lo32(p0)]
if round!=9: k=[k[0]+0x9E3779B9,k[1]+0xBB67AE85]
return c

Use exact integer limbs or a conforming integer multiply-high operation. JavaScript floating multiplication of uint32 operands is not an exact uint64 product. Convert selected word r using u=f32(r>>8)\*2^-24, an exact 24-bit grid in [0,1). Do not substitute f32(r)/2^32, which can round to 1. This is a specified discrete sampler, not a claim of ideal continuous randomness.

S02. Known-answer vectors, words in hexadecimal array order:
Counter [0,0,0,0], key [0,0] -> [6627e8d5,e169c58d,bc57ac4c,9b00dbd8].
Counter [243f6a88,85a308d3,13198a2e,03707344], key [a4093822,299f31d0] -> [d16cfe09,94fdcceb,5001e420,24126ea1].
Address fixtures independently computed with exact Python integers after checking the reference vectors: seed=0,t=1,TARGET,j=0 -> f8e4cca4; seed=0,t=0,DRAFT,j=0 -> 844515e1; seed=0,t=0,TARGET,j=4 -> 2dce73e5.
For seed=0,t=0,TARGET,j=0, u=6694888/16777216. Probabilities for token IDs [0,1,2,3]=[0,0.25,0.5,0.25] select token 2. Boundary fixtures: u=0 selects token 1; u=0.25 selects token 2; u=0.75 selects token 3.
Reference implementation: https://github.com/DEShawResearch/random123/blob/main/include/Random123/philox.h
Reference vectors: https://github.com/DEShawResearch/random123/blob/main/tests/kat_vectors
These reference/CPU checks do not establish a WGSL implementation pass.

S03. Versioned policy order is logit bias, sign-aware repetition penalty, frequency/presence penalties, then hard masks. Repetition divides nonnegative logits and multiplies negative logits by a strictly positive penalty. At temperature zero, select maximum remaining processed logit with lower token ID breaking ties; bypass top-k/top-p. Otherwise divide by strictly positive temperature, apply top-k (descending logit, ascending token ID for ties), normalize, retain the smallest descending-probability top-p prefix including its crossing token, and renormalize. Final CDF is ascending token-ID order; choose first CDF strictly greater than u; set the final positive token's CDF to exactly 1. Reject NaN, positive infinity, empty support, invalid parameters or normalization. Negative infinity excludes support. Disable top-k with zero and top-p with one. Additional processors require a declared ordered position and sampler/policy identity change.

The numerical profile MUST bind floating arithmetic, exp/normalization implementation and reduction order. CPU/GPU fallbacks require qualification under that profile. Exact RNG equality guarantees equal words/uniform values; identical selections additionally require identical ordered CDFs. Hypothetical row history includes only the committed prefix plus that row's preceding draft proposals; it becomes authoritative only through the accepted decision.

S04. Target replay means B makes the same authoritative selection it would make in ordinary decoding at each semantic output index. It accepts a proposal only when the selected target token equals that proposal. At the first mismatch it emits the selected target correction and stops. Full acceptance permits one bonus draw if nonterminal and admitted. It does not use the min(1,p/q) acceptance rule or residual distributions of rejection-based speculative sampling.

S05. Initial coupling is independent. Shared draws MAY be selected explicitly in a different immutable block policy for experiments, without changing the target stream. Neither coupling universally maximizes agreement. Identical random words do not establish identical token selections when scores or policy arithmetic differ. Record RNG equality, score parity and selected-token parity separately. Preserve old sampler IDs and old transcripts; publish a new sampler ID for changed behavior.

## 5 Exact cursor semantics

C01. Let P be canonical prompt length, H materialized input history, m=|H|, p the accepted pending token, g accepted generated-token count, and G the output limit. At a live block boundary p exists and was already durably published. Then m=P+g-1. These are logical counts, not occupied ring-buffer slots. A terminal cursor may retain an unmaterialized terminal token.

C02. Bootstrap is an ordinary prefill plus first authoritative selection/publication: m=P, g=1, p=first selected token. A zero-output request does no generation. If the first token terminates, no block starts. Reject P>C. If P=C, the first selected token is context-terminal because no further input position is available. Already materialized prompt tokens are never reclassified as generated output.

C03. A block proposes d1..dk following p and evaluates input rows [p,d1,..,dk] at absolute positions m..m+k. Score row j (zero-based) selects output index g+j. Row zero verifies d1. When k=0, row zero selects one ordinary continuation. Admission requires live cursor, R=G-g>0, 0<=k<=R-1 and m+k+1<=C, where C is the admitted logical input-position capacity. Sliding-window storage capacity is a separate allocation limit. Speculative input evaluation MUST NOT exceed either limit.

Outcome | Materialized additional inputs | Newly accepted output | Pending token
k=0 | p | c | c
Zero accepted, k>0 | p | c | c
r accepted, 0<r<k | p,d1..dr | d1..dr,c | c
All k accepted, nonterminal | p,d1..dk | d1..dk,b | b
Accepted proposal di terminates | p,d1..d(i-1) | d1..di | di, terminal
Correction after r proposals terminates | p,d1..dr | d1..dr,c | c, terminal
Bonus terminates after full acceptance | p,d1..dk | d1..dk,b | b, terminal

C04. If n new tokens are accepted, output range is [g,g+n), g'=g+n, m'=m+n, replayInputRows=n, and pending is the last accepted token. Accepted proposal count alone is insufficient to determine replay rows. The terminal proposal case has n=i, without materializing di. Stop at the first accepted-token boundary that causes EOS, a stop string, a configured character limit or the output allowance. Do not draw an extra bonus. Stop behavior and visible-text truncation MUST be versioned in the policy digest; add a specific stopReason enum before supporting additional limit types.

Example: P=10, g=3, m=12, pending p, proposals [a,b,c]. Target chooses a, then z instead of b. Prepare [p,a], output [a,z] at indices [3,5), new m=14,g=5,pending=z. B replays its first two retained activation rows. Neither p nor b/c is newly published. If a itself terminates, prepare only [p], output [a], new m=13,g=4,pending=a terminal. If all three accept, prepare [p,a,b,c], output [a,b,c,bonus], new m=16,g=7.

If m'=C and no earlier stopping condition applies, mark the successor terminal with stopReason=context; it MUST NOT remain live with no admissible ordinary step. This is an input-position cap, distinct from sliding-window occupancy.

C05. Rejected hypothetical tokens MUST NOT advance authoritative RNG positions, penalty history, decoder buffers, stop matcher or publication ranges. Hypothetical evaluation can have branch-local policy history; the committed successor must contain only accepted history. Cancellation is an attempt outcome and does not manufacture a newly accepted token.

## 6 Composite state transaction

L01. The new resident-state coordinator MUST delegate to existing state owners. Its snapshot inventory includes attention keys/values, occupied slots and absolute ring positions; overwritten ring bytes; recurrent and convolution buffers; pending-token and token-position counters; penalty/token history; incremental decoder and stop-matcher buffers; terminal state; allocation references; and queued GPU/copy completion ownership. Unlisted mutable state discovered during implementation blocks qualification until owned.

Operation | Preconditions and inputs | Result and state change
beginBlock | Live expected parent revision, same identity/policy, grant and admitted capacity, no unresolved branch | Lock parent against same-attempt mutation; return isolated scratch or fail with tracked cleanup. No alias fallback.
evaluateBlock | Scratch plus validated token or activation inputs | Sequential hypothetical stage execution; retain opaque replay-input handle and outputs. Parent unchanged.
verifyBlock | B's target rows, proposals, base policy/history and indexed sampler | Immutable decision; speculative decoder changes remain branch-local. No publication.
prepareBlockCommit | Parent, evaluated scratch, original replay handle and matching decision | Restore scratch and replay exactly replayInputRows, install accepted policy/decoder decision without resampling; return prepared successor only after work settles.
commitBlock | Prepared successor, expected parent revision and decision digest | Atomically install successor locally; retain original acknowledgment. Transfer allocation ownership; release superseded parent only when no references/in-flight work remain.
discardBlock | Uncommitted branch | Suppress further branch work, settle submitted operations and release only owned allocations. Parent remains unchanged.

Only B owns authoritative sampling policy, incremental decoding and stop state. B prepares them from its retained decision or deterministic accepted-token replay without resampling; A installs its partition model state and mirrors logical cursor/decision digests. Digests alone cannot reconstruct B's mutable state.

L02. Stage A retains [p,d1..dk]. B retains the exact incoming activation rows and relevant token context. Replay handles bind attempt/epoch/block/base cursor/stage/boundary/absolute rows/layout/payload identity. prepareBlockCommit MUST use those original rows, not silently ask A to regenerate them. The initial implementation MUST replay with the same sequential numerical path, positions, order and precision profile as evaluation.

L03. A full-acceptance branch may be promoted without replay only if every mutable component already equals the accepted successor and there is no evaluated rejected/terminal suffix. This optimization requires explicit tests. The reference implementation MAY always restore/replay. Retained inputs remain charged until no replay or submitted work can reference them.

L04. Restore into existing scratch where supported. Otherwise settle and release it before allocating replacement scratch, or reserve the true three-copy peak. One branch per parent revision; ordinary execution on that attempt cannot mutate the parent while it is pinned. Other attempts remain independent. Cancellation during a GPU copy stops future work but is not proof that submitted copying has stopped.

L05. Errors are explicit: STALE_CURSOR, POLICY_MISMATCH, UNSUPPORTED_STATE, ADMISSION_DENIED, INVALID_FRAME, CANCELLED, DEVICE_LOST and PREPARATION_FAILED. Before speculative mutation, ADMISSION_DENIED may choose ordinary execution. After mutation, failure follows branch cleanup; after a possibly installed stage commit, the attempt is interrupted. Never silently retry ordinary work against uncertain state.

## 7 Distributed protocol

N01. Fix exactly two stages initially. All partitions/reservations/grants must be admitted before starting model work. Stage A produces a frame for the block's rows; B acquires retained replay inputs before A's transport owner releases the last required reference. Transfer and receiver copies may overlap and both count in memory admission.

Success sequence
Coordinator -> A,B: beginBlock(base cursor, reservation, identity)
Coordinator -> A: evaluateBlock(p, proposals)
A -> B: activation frame with bound rows and token context
B -> coordinator: evaluated result and target verification decision
Coordinator -> A,B: prepareBlockCommit(decision)
A,B -> coordinator: matching prepared successor acknowledgments
Coordinator -> A,B: commitBlock(expected revision, decision)
A,B -> coordinator: matching retained commit acknowledgments
Coordinator -> conversation owner: append publication under attempt revision
Conversation owner -> UI: deliver persisted output range

N02. Coordinator states: READY -> EVALUATING -> PREPARING -> COMMITTING -> PUBLISHING -> READY or TERMINAL. A lost acknowledgment may remain in its current phase while an identical retry can recover a retained result. An outcome that cannot be established transitions the attempt to INTERRUPTED and SETTLING; it cannot return to READY by replacing one uncertain stage. Stage states: PARENT -> BRANCH -> EVALUATED -> PREPARED -> COMMITTED. BRANCH/EVALUATED/PREPARED may discard back to an unchanged parent after cleanup. COMMITTED cannot pretend to discard back to the old parent.

N03. Each stage receiver scopes deduplication by its own stage and process epoch. Lookup key is (executionEpoch,attemptId,blockSequence,phase). Request digest is stored separately. Same key/same digest joins in-flight work or replays original result; changed digest returns OPERATION_CONFLICT. In-flight work is unevictable. Enforce one unresolved sequence and a bounded retained-result count. Maintain retiredThrough and active-sequence records; an evicted consumed operation returns RESULT_EXPIRED with no allocation, sampling or state mutation. Retirement cannot jump over unresolved work. A new process epoch rejects all old-epoch requests.

Case | Required transition
Rejected proposal | Normal decision, prepare accepted prefix, commit, publish correction. Rejection is not a protocol failure.
Duplicate evaluate/prepare/commit | Join or replay original result; do not execute again.
Lost acknowledgment | Retry identical operation while result retained. Query/retry must not construct a new block. If outcome cannot be established, interrupt.
Cancel before any commit | Fence attempt, discard branches, settle allocations, publish no new block.
Cancel racing commits | Fence publication, allow completion accounting; any installed state is retired, not falsely rolled back.
A commits and B fails | Interrupt; keep last published prefix; uncertain stage ownership stays charged.
Disconnect or expired commit result | Treat outcome as unknown and interrupt; do not infer failure or successful release.
Coordinator crash before durable append | Preserve last durable prefix; interrupt old execution. No transparent inference-state recovery.
Crash after append before delivery | Replay stored event after disclosure check; never rerun inference.
Replacement | Fresh authorized attempt on independently admitted healthy capacity; old messages cannot affect it.

N04. Authentication/grants bind route, stage, attempt, epochs, generation identity, byte/token limits and allowed operation phases. Model hashes or payload digests alone do not authenticate senders. Changed parameters require a new valid identity/grant. Transport may retransmit but may not reinterpret accepted output ranges.

## 8 Publication and stopping

P01. Matching commits require A and B acknowledgments for the same attempt/block/decision/base revision/logical successor, from expected epochs. Matching does not mean A and B have identical physical state bytes. Publication records contain accepted token IDs and successor cursor directly, or an immutable durable reference with equivalent availability. Rendered prose alone is insufficient.

P02. Publication and cancellation MUST serialize through one attempt owner and one atomic durable state transition spanning attempt status, conversation revision and output append. Use the existing storage owner's transaction mechanism; if it lacks the necessary atomic boundary, extending it is a prerequisite. A check of an in-memory abort flag followed by a separate append is insufficient.

Cancellation durable first: reject subsequent append and suppress this unpublished block. Publication durable first: preserve its accepted range, then cancellation prevents later progress. Append identity is (conversation,generation,outputStart,decisionDigest); another decision at the same outputStart conflicts. Enforce contiguous output ranges and exact successor consistency. Late acknowledgments cannot revive an attempt.

P03. UI tracks delivered event identity and output range. Delivery retry replays persisted text/token records after current disclosure authority is checked. Delivery does not restore GPU state or rerun a tool. A revoked grant may prevent delivery without deleting the durable historical decision.

P04. Incremental decoding and stop matching run in accepted-token order. Hold incomplete byte sequences and text that could still complete a configured stop string; flush only irrevocable text. Withhold excluded stop text. Persist decoder continuation or sufficient exact accepted tokens and versioned decoder state to reconstruct it deterministically. Partial UTF-8 sequences and stop strings split across blocks are release tests. The text-visible count and accepted raw-token count are distinct.

P05. Tool invocations use existing committed, deduplicated tool-call records. Replaying a publication cannot invoke a tool again. Speculative drafts never trigger tools. This series does not promise globally exactly-once external side effects after arbitrary third-party failures.

## 9 Placement resources and privacy

R01. Slow route preparation discovers artifacts, validates partition eligibility, records backend/model qualification, measures directed links, and prepares resident resources. Fast placement authenticates the request, filters complete routes by grants, numerical/quality gates, layouts, context, memory and health, then ranks eligible complete routes and atomically activates provisional reservations. A failed reservation releases or settles already acquired ownership before trying another route. No execution starts after reserving only A.

R02. The initial fixed-route milestone uses existing placement. A later ranking extension SHOULD minimize measured predicted completion cost: queue delay, missing artifact preparation, stage service time, directional bytes/bandwidth and latency, branch/replay overhead, and commit/publication time. Include observation age and uncertainty. Prefix affinity reduces cost only after exact compatibility and authorization checks. Do not rank an ineligible route highly and repair permissions afterward.

R03. A real local admission authority must serialize reservations for the same physical resource group. A label alone does not enforce a budget. If multiple tabs/processes cannot coordinate admission, do not count them as independent capacity for this route. Charge uniquely owned physical allocations once, shared weights through an explicit reference owner, overlapping copies separately, and unsettled destruction until completion is established. Peer accounting remains operational admission, not proof against malicious device reporting.

R04. Prefix reuse is local, private, same-policy and identity-bound. Require matching model, tokenizer, partition/layout, runtime/numerical profile, exact materialized token prefix, pending token, sampling identity, seed/index and decoder/policy state. New generation or changed policy needs explicit requalification; never reuse a state solely because visible text matches. Expiration prevents new forks, but does not free allocations still referenced by active work.

R05. A drafter is a separately authorized recipient of whatever prompt/history it sees. Bind its disclosure scope and draft work allowance before dispatch. Boundary activations and token context are private data and must follow route grants. No cross-user prefix lookup or cache-hit exposure is permitted without authorization. Prepared route metadata must avoid exposing private token content.

## 10 Implementation map and migration

I01. Fresh read-only source-owner check: Doppler 7eb47eaee64f88610467a07859c33fc3692b9be9 and Reploid 646974107824d9acc58677d80c857dd432c2af95. These supersede the earlier snapshots for the file map. No repository changes or tests were performed.

Doppler files and required edits:

- src/inference/token-sampling.js: extend existing scalar sampler and samplingSeedForToken entry points with versioned integer draws and explicit semantic indices.
- src/gpu/kernels/sample.js, sample.wgsl, sample_f16.wgsl: implement the same draw conversion and selection contract; include exact RNG conformance tests. Preserve legacy sampler behavior by identity.
- src/inference/pipelines/text/generator/decode.js and src/inference/generation-step.js: wire ordinary decode, GPU/CPU fallback, shared policy transforms and stopping through the declared sampler.
- src/inference/pipelines/text/resident-state.js: proposed new narrow composite coordinator, with .d.ts if needed. Coordinate existing state owners; no duplicate KV/recurrent/decoder implementation.
- src/inference/pipelines/text/partition-attempt.js and resident-partition.js: bind fork ownership, cursor/replay handles, B policy/decoder state and cleanup. Current post-prefill path accepts one input token and samples through generation-step.js using samplingSeedForToken(seed,step).
- src/inference/pipelines/text/partition-execution.js: extend its current numTokens==1 incremental restriction through a deliberate sequential-row loop, retaining all verification rows rather than only last-position logits. Do not silently substitute an unqualified batched kernel.
- src/inference/pipelines/text/resident-partition-contract.js and .d.ts; layer-partition-contract.js and .d.ts: add schema versions, capabilities, input retention, prepare/commit/discard and explicit errors.
- src/partitions.js and .d.ts; src/client/resident-partitions.js and .d.ts: export supported contracts through existing public wiring.
- src/inference/kv-cache/base.js, sliding-window.js and mixed-geometry.js: qualified fork/restore for actual layouts. quantized.js, tiered.js and basis-decomposed-paged.js require explicit support or rejection; truncate alone is not rollback evidence.
- src/inference/pipelines/text/linear-attention.js; linear-attention/plan.js and state-layout.js: reuse recurrentState/convState clone/restore, sequence metadata and both two-f32 components where enabled. General convolution layers remain outside the current resident gate; this series must not broaden model eligibility implicitly.
- src/inference/pipelines/text/sequence-state.js currently truncates KV and changes currentSeqLen; it must not be mistaken for the whole composite transaction.

Reploid files and required edits, relative to packages/reploid/src/mesh/partitions unless otherwise stated:

- partition-runner.js: extend its current one-token B-result expectation to verified block decisions, stage-specific frame lifetime, preparation/commit ordering and durable publication handoff.
- partition-peer.js and packages/reploid/src/transport/partition-data-channel.js: extend existing bounded control/data operations; no parallel channel stack.
- partition-step-receiver.js: phase-scoped operation keys, stored request fingerprints, retained results, unresolved-operation bounds, retirement fences and expired-result errors.
- partition-contract.js and .d.ts; partition-grants.js and .d.ts: bind block/draw identities, disclosure and byte/token limits. Current grants constrain post-prefill inputTokenCount to one; broaden only with capability and budget checks.
- partition-reservations.js and resident-partition.js: extend scratch/retained-input/temporary budgets and confirmed settlement. Internal rollback does not enable the currently false portable recovery flags.
- partition-chat.js: propagate only committed durable deltas and preserve approved generation identity.
- packages/reploid/src/chat/workspace.js and self/host/chat-session.js: serialize cancellation/publication and persist token ranges/decisions before delivery. Current workspace saves streamed deltas through localStorage-backed chat-session; this is not yet proof of the required atomic cross-record transition. Consolidate a single attempt/conversation envelope or extend the existing storage transaction owner with an explicit failure-tested commit boundary.
- scripts/sync-doppler-partition-contract.js: regenerate packages/reploid/src/contracts/doppler-partitions.d.ts and provenance. Update existing .d.ts siblings; generated self/vendor/reploid files are mirrors, not separate owners.

Package check: both Doppler source package.json and Reploid's pin say 0.6.27. Reploid uses file:deploy/artifacts/doppler-gpu-0.6.27.tgz, integrity sha512-Vy1sOPYVImM+EfSpBIhOdtlrM/a4vwEo5TIFGESRim+En1mrbt3CLOhJI2H4UL5fv/i9+8FAKtHSiHACWRvw6A==, vendored at self/vendor/doppler/0.6.27/. Generated partition-contract provenance SHA-256 is 907fabad0a6125369d769e530e54544093530bb283f6a89a17b5568f157f6a6b. Matching version strings do not establish matching source/artifact bytes or deployed browser identity.
Sources: https://github.com/clocksmith/doppler/tree/7eb47eaee64f88610467a07859c33fc3692b9be9/src
https://github.com/clocksmith/reploid/tree/646974107824d9acc58677d80c857dd432c2af95/packages/reploid/src
https://github.com/clocksmith/reploid/blob/646974107824d9acc58677d80c857dd432c2af95/self/config/doppler-package.json

I02. Keep declarative admission limits, supported capability records and policy selections in existing JSON/schema owners. JavaScript owns orchestration, validation, transactional state and lifetimes. WGSL owns GPU computation; it does not implement network state machines or conversation persistence. Do not create a parallel reservation, decoder or recurrent-state framework.

I03. Migration order: introduce explicit sampler version with legacy replay retained; extend source contracts and tests; implement composite state locally; publish a versioned Doppler package; update Reploid's dependency and browser import pins together; verify served artifact hashes and capability negotiation; enable blocks only for qualified route/model/backend tuples. Source-main success cannot substitute for a served-package receipt. Legacy peers continue ordinary execution and reject unsupported block operations.

## 11 Acceptance matrix

Every test receipt MUST include source/package/bundle identities, model/capsule, tokenizer, policy and sampler versions, seed, prompt, route/partition plan, backend, device, driver/runtime, input/output hashes, peak resource accounting, exact command and retained artifacts. Unsupported or untested hardware is recorded explicitly, never inferred from another vendor's result.

Gate | Required experiment | Pass meaning
Random-word equality | Known-answer vectors on JavaScript and WGSL; indices crossing 32-bit boundary; interleaved attempts/retries/block sizes | Exact uint32 words match; no transcendental RNG dependency.
Same-seed replay | Repeated ordinary executions and ordinary/block comparisons at nonzero temperature using the same qualified numerical path | Exact accepted token IDs and semantic draw positions match.
Whole versus split parity | Matched weights, policies, seed, prefix and numerical profile on whole and two-stage paths | Frozen score/tokens criteria pass; separately report first divergence.
Independent numerical accuracy | Forced common prefixes versus independent reference, all token scores where required | Existing declared tolerance passes; no inference from token equality alone.
Answer quality | Held-out task/answer suite under frozen generation settings | Existing quality threshold passes independently of arithmetic error.
Local lifecycle safety | Real ring wrap/overwrite, recurrent and convolution changes, rejection at every position, terminal proposal/correction/bonus, cancelled copies, device loss | Parent unchanged; accepted successor continues like ordinary; no alias/leak/unowned work.
Stage B replay | Reject after a prefix; restore B using retained original activation rows | Correct absolute positions and arithmetic path; no hidden upstream regeneration.
Distributed safety | Fault at each evaluation/preparation/commit/append/delivery boundary; duplicates/conflicts/expiry/stale epoch | No duplicate output or revived attempt; uncertain resources charged; fresh healthy capacity usable.
Decoder and stop safety | Split UTF-8, multi-token stop strings, withheld suffixes, cancellation/publication races | No leaked draft/stop suffix, duplicate text or lost durable output.
Resource safety | Peak allocations including parent, scratch, retained frames, transport overlap and delayed destruction | Reservation bound never exceeded; no hidden third copy or shared-device oversubscription.
Performance | Matched ordinary/block runs for identical accepted output; warmed and cold workloads, varied link delay and block size | Complete cost and visible pauses satisfy predeclared workload gates, not kernel-only speedups.

A qualification matrix lists actual OS/API/device combinations separately: Metal on identified Apple/AMD/Intel devices where supported, and Vulkan on identified AMD/Intel devices. Vendor name alone is not a backend identity. This specification supplies no new measurements for any cell.

## 12 Delivery sequence and traceability

D00. Immediate promotion prerequisite from the latest user-supplied progress report: the accepted Reploid runtime remains unchanged. Paired arithmetic/operator controls and nine Mac logits/capture controls are reported; full-model qualification is still pending. The next reported control is AMD recurrent operation, then the complete paired model must pass all 55 reference prefixes on both GPUs. Qualify one exact package through signed opening, concurrent long conversations, cancellation, replacement and cleanup before promotion. Useful document answers remain a separate acceptance requirement. These are reported statuses, not independently rerun results. Local sampler/fork work can proceed as an isolated development track; distributed block integration and promotion must not bypass this runtime gate.

The reported optional system-context change (16-word default when enabled, 32/64 options) belongs to existing conversation controls. Capture its exact approved prompt in generation identity and preserve it on retries; do not duplicate that ongoing implementation in this series.

D01. Increment 1: ordinary indexed sampling. Done when the new sampler identity, vectors, policy ordering and ordinary whole/split qualification are recorded, and the deployed consumer pin is known. Legacy seeded transcripts remain addressable.

D02. Increment 2: one local same-policy composite fork. Done when real attention ring, recurrent/convolution, policy/decoder state and pending-token continuation pass isolation, rejection, termination, allocation-failure and cancellation tests. Include B's retained-activation replay. No network block API depends on an unproved local transition.

D03. Increment 3: fixed two-stage blocks plus durable publication. Done when both stages prepare exact successors, duplicates are bounded/idempotent, partial commit interrupts safely, cancellation races are serialized, and restart replays persisted output without claiming GPU recovery.

D04. Increment 4: workload qualification and optional placement improvements. Measure time per durably committed token and p50/p95 visible output gaps, including drafting, copies, target work, transfer, replay, protocol, append and settlement. Freeze prompts/output limits/seeds, interleave A/A and A/B trials, publish sample counts and uncertainty. A proposed promotion gate is at least 5% lower complete time per committed token with a confidence interval excluding no improvement, while p95 visible gap is no more than 10% worse and all correctness/resource gates pass. These are proposed product thresholds, not measured results. If the gate fails, retain ordinary decoding.

Ordinary k=0 semantics MUST NOT impose speculative copying. Fallback happens before speculative mutation. No user-visible token is streamed from an uncommitted branch; each committed block can be delivered immediately after its durable append. Small or adaptive blocks can trade throughput for pause length only within the qualified bounds.

Before implementation merge, verify grant clock-skew validation, transaction support in the conversation owner, exact capability negotiation fields and measured model/device memory caps. These are integration checks, not permission to expand scope. No additional protocol architecture is needed to begin the local fork proof.

Requirement | Owner | Acceptance evidence
E01 | Release/package owners | Pinned source/package/browser receipt and explicit untested status
T01-T03 | Doppler contracts and Reploid receiver | Schema/version/hash/bounds/layout/grant negative tests
S01-S03 | Doppler sampling | RNG vectors, CPU/GPU policy fixtures, replay migration
S04-S05 | Target verifier | Every mismatch/acceptance case; independent/shared coupling fixtures
C01-C05 | Cursor and policy/decoder owners | Bootstrap, k=0, R bounds, terminal and worked-example tests
L01-L05 | Resident-state coordinator and existing state owners | Real full-state restoration and allocation/copy failure tests
N01-N04 | Runner/peer/receiver/grants | Two-stage failure injection, duplicate conflict/expiry/epoch tests
P01-P05 | Conversation owner and decoder/tool records | Atomic append/cancel race, delivery replay and no repeated side effects
R01-R05 | Placement/reservation/admission/grants | Complete-route admission, shared-resource peak and disclosure tests
I02-I03 | Schema/runtime/release owners | No duplicate ownership, package-pin and served-bundle verification
D00-D04 | Qualification harness | Separate parity/accuracy/quality/lifecycle/performance receipts
