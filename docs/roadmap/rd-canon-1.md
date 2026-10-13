<a id="canonical-topology-contract-rd-canon1"></a>

## Canonical topology contract: RD-CANON/1

Implementation contract, 12 October 2026. This section consolidates the former
`docs/topology1.md`, `docs/topology2.md`, and `docs/topology3.md` under the user's
RD-CANON/1 specification. It is a design and acceptance contract, not evidence of
passing tests or permission to promote a runtime. MUST means required; MAY means
an explicitly negotiated option. Implementation status remains in [the task register](requirements.md); source components do not close integration or physical qualification gates.

Build ordinary sampling consistency, then one local same-policy fork, then fixed
two-stage target-replay blocks. The delivery gates below belong to this existing
queue, not a separate campaign. RD-CANON/1 resolves earlier draft conflicts,
including bootstrap, C/L limits, route-cardinality publication, and the stronger
performance gate. Earlier drafts remain available through Git history.

### 1. Scope and ownership

Doppler owns model computation, valid partitions, sampling, decoding, inference
state, and local transitions. Reploid owns membership, placement, grants,
reservations, transport coordination, and durable conversation publication.
Extend these owners; do not introduce another runtime, cache, receiver, or scheduler.

A piece is verified model data. A partition is a valid computation segment. A
stage is a prepared partition on a particular resident/process/device. A route
is either one whole-request stage or exactly two sequential layer stages.
Independent jobs have their own complete-operation lifecycle. They are not
speculative tokens.

The initial block protocol uses two stages: A owns input layers and the existing
coordinator; B owns output layers and authoritative sampling. The conversation
workspace owns publication. One-stage ordinary requests require only their own
stage acknowledgment. Additional stages, portable checkpoints, cross-policy
forks, rejection sampling, and transparent failover are excluded.

### 2. Minimal immutable contracts

Execution identity MUST bind model, tokenizer, adapters, execution/partition
plans, numerical policy, state/activation/decoder layouts, and exact runtime
archive. Generation identity additionally binds every sampling, stopping,
decoding, output-limit, and seed choice. An attempt binds requester, input digest,
authorization scope, route, generation identity, coordinator/publisher epochs,
and each stage's participant/device epochs and resident identity. None changes
in place.

Generation policy MUST contain: sampler/arithmetic profile; 64-bit seed;
temperature; top-K/top-P; repetition/presence penalties and explicit history
windows; suppressed/pad/EOS/stop token IDs; ordered stop strings; tool-boundary
policy; maximum generated tokens N; materialized-input capacity C; total accepted
prompt-plus-output limit L; raw/visible UTF-16 limits; decoder identity. C and L
have different meanings. Model transforms, including softcap, belong to execution
identity and run exactly once.

Counts and byte sizes MUST be bounded nonnegative safe integers; token IDs MUST
be valid vocabulary indices. Every array and payload needs an admitted bound.
Reject unknown fields/versions, unsupported policies, invalid UTF-8, nonfinite
numbers, overflow, and inconsistent lengths before allocation. Privately copy
or freeze admitted data.

New metadata uses
`SHA256(UTF8(schema) || 0x00 || UTF8(RFC8785-JCS(body)))`, excluding its own digest.
Token arrays use
`SHA256(UTF8("doppler.tokens/v1") || 0x00 || uint64LE(length) || uint32LE(each token))`.
Hash complete logical token sequences independently of block boundaries. Binary
payloads contribute exact byte length and digest. Preserve existing signed-format
canonicalization.

An activation frame binds attempt, sequence, base cursor, proposal,
source/destination stages, absolute row positions, token-context digest, layout,
and payload digest. Bytes MUST equal rows × hidden size × element stride.
Scalar F16/F32 use one component and 2/4 bytes; paired two-F32 uses two components
and 8 bytes. No inferred components, casts, or trailing bytes.

### 3. One versioned sampling contract

Explicitly select topology3's `philox4x32-10/cpu-categorical-v1` profile:
Philox4x32-10, with exact unsigned multiplication and modulo-2^32 arithmetic.
Seed hexadecimal is high-word followed by low-word; zero is valid. Generate an
omitted seed cryptographically once and persist it before execution. Legacy
numeric seeds retain their legacy identity.

For semantic output index t, purpose s, and draw j:

```text
counter = [low32(t), high32(t), s, floor(j/4)]
word = Philox(counter, [seedLow, seedHigh])[j mod 4]
u = word / 2^32, evaluated in binary64, so 0 <= u < 1.
```

Target selection uses purpose 0, draw 0. Independent drafting is the default and
uses purpose 1; shared-target drafting MAY use purpose 0 explicitly. Purposes 2/3
remain reserved. First output uses t=0; after g accepted tokens, t=g. Block sizes,
retries, routes, attempts, and scheduling MUST NOT alter target draws. Greedy
acceptance advances t without requiring randomness.

Use one pinned final-stage CPU sampler and host arithmetic profile:

1. Validate post-model logits; reject NaN/+infinity; -infinity is a mask. Copy
   working logits to F32.
2. Apply repetition penalty once per distinct history token, positive scores
   divided and nonpositive multiplied; round each change to F32. Subtract
   presence penalty once per distinct token, rounded to F32. Windows include
   prompt history; zero means all history.
3. Mask pad/suppressed IDs. At temperature zero select the largest finite score,
   breaking ties by smallest ID.
4. Otherwise sort descending score, then ascending ID; retain top-K unless K=0.
   Compute exp((score-maxScore)/temperature) and ordered sums in the pinned
   binary64 profile.
5. Keep the smallest nonempty top-P prefix, renormalize in retained order, and
   select the first cumulative probability strictly greater than u. Rounding-only
   overrun selects the last candidate.

All-masked, invalid, or zero-total distributions fail; there is no uniform
fallback. GPU selection and cross-engine equality require separate qualification.
Matching random words alone establishes neither numerical accuracy nor matching
probability arithmetic. Target replay reproduces qualified ordinary draws;
probability-preserving rejection sampling is a different, excluded algorithm.

### 4. Bootstrap and exact cursor

After prefill, H is materialized history, m=|H|, P is prompt length, g is accepted
generated-token count, and p is the optional accepted pending token. A cursor
records these counts, pending ID, next target index, materialized/accepted token
digests, generation identity, revision, and terminal reason. The invariant is:

```text
m = P + g - indicator(p exists); next target index = g.
```

Admission validates the tokenizer's effective prompt and requires P<=C and P<=L.
Empty input follows the declared tokenizer/BOS rule; unsupported empty input
rejects. N=0, or P=L, yields a durable admission-only empty terminal result,
without model work or a reusable inference cursor. This explicitly tagged result
has no execution acknowledgments or cursor; its reason is max-tokens for N=0,
otherwise context-limit.

Otherwise ordinary prefill materializes the prompt on every route stage. B, or
the sole whole-request stage, selects the first token at index 0. The stages
settle and acknowledge the same successor: H=prompt, m=P, g=1, p=first token.
Publish through section 7 before beginning a block. Failure before this barrier
exposes no candidate output. Bootstrap uses ordinary execution, not speculative
scratch. Sequence 0 identifies bootstrap; subsequent ordinary advances/blocks
use consecutive sequences. The accepted token range begins at zero, or at the
inherited count for a fork.

If P=C<L, last-prefill logits may produce that first token; it remains pending
and the cursor becomes terminal for context capacity unless a higher-priority
stop applies. C bounds consumed input positions; L bounds accepted history,
including pending output. Preserve these meanings explicitly in the qualified
ordinary policy.

At live block entry p MUST exist. Let R=N-g. Admit only:

```text
0 <= k <= min(4, R-1)
m+k+1 <= C
P+g+k+1 <= L
```

plus worst-case resources and output bounds. Terminal cursors and R=0 cannot
start. Inputs are [p,d1,...,dk]. Row j predicts the next token at target index g+j
using history H,p,d1...dj. Never resample or republish p.

If r<k proposals match before correction c:

```text
H'=H+p+d1...dr; new output O=d1...dr+c; p'=c.
```

If all k match:

```text
H'=H+p+d1...dk; O=d1...dk+bonus; p'=bonus.
```

For n=|O|: m'=m+n, g'=g+n. Increment revision once. A terminating accepted token
remains pending; materialize only its predecessors and select no bonus. Reaching
N, L, or exhausted input capacity makes the successor terminal.

Examples from P=5, g=2, m=6, pending p:

- k=0 or first rejection: H'=H,p; O=x; m'=7, g'=3.
- Draft a,b,c; match a then correction x: H'=H,p,a; O=a,x; m'=8, g'=4.
- All match, bonus x: H'=H,p,a,b,c; O=a,b,c,x; m'=10, g'=6.
- Match a then terminating EOS: H'=H,p,a; O=a,EOS; m'=8, g'=4, pending EOS,
  terminal. The same predecessor rule covers terminal correction and bonus.

### 5. Composite state and target replay

Capture a prefix only at a settled, published cursor with no unresolved operation.
One admitted local child preserves exact execution/generation identities, seed,
token history, pending token, decoder state, and target index. Reference inherited
publication; do not republish it. Handles are opaque, locally registered,
authorization-checked, and epoch-bound.

Only B owns mutable sampling-policy/decoder successors in the split route; A
mirrors the bound logical decision/cursor and owns its own numerical state. The
sole whole-request stage owns both. Preserve attention-cache contents/geometry,
overwritten ring slots and indices, recurrent high/low components, convolution
history, policy history, decoder partial bytes/control state, withheld stop suffix,
counters, and all other future-affecting state. Share immutable weights through
charged references. Missing clone/restore support rejects; mutable-parent aliasing
is forbidden.

For k>0 use one immutable parent and one admitted scratch branch:

- `beginBlock`: validate cursor/reservation, pin parent, copy scratch, await copies.
- `evaluateBlock`: run hypothetical inputs sequentially, modifying scratch only.
  A retains token rows and original boundary rows; B retains received rows,
  positions/layout, and token context. B may keep bounded provisional target
  choices rather than full-vocabulary matrices.
- `verifyBlock`: bind one immutable matching-prefix/correction/bonus decision
  and accepted-only decoder successor. No permanent sampling advancement or
  publication.
- `prepareBlockCommit`: if scratch extends beyond the successor, restore from
  parent and replay exactly n accepted input rows. A replays tokens; B replays
  original received activations, never tokens alone. A MUST byte-compare
  regenerated accepted boundary rows against originals and reject
  `REPLAY_DIVERGENCE`. No resampling, repeated decoding acceptance, or tools.
  Await submitted work.
- `commitBlock`: under the resident lock, compare expected parent cursor/revision,
  install once, retain immutable acknowledgment.
- `discardBlock`: settle provisional ownership. After commit return
  `ALREADY_COMMITTED`; cleanup cannot pretend rollback.

Full-acceptance reconstruction MAY be skipped only if scratch already equals the
required state. Prepared means exact successor exists separately; committed means
installed locally; published means durably recorded. These are distinct.

Ordinary k=0 advances in place with no speculative copy, proposal evaluation, or
prepare RPC. Its ordinary result carries the successor acknowledgment needed for
the same publication barrier. Failure after in-place mutation interrupts the
attempt rather than claiming restoration.

### 6. Protocol and failure handling

One unresolved block per attempt spans evaluation, decision, all preparations,
all commits, publication acknowledgment, and required cleanup. Prepared and
committed records MUST agree on attempt, sequence, base cursor, decision, and
successor; layer-specific state bytes need not match.

Receiver key is `(coordinator epoch, participant epoch, attempt ID, sequence, phase)`,
inside the fixed stage namespace. Store the behavioral request digest separately.
Identical pending calls join; completed calls replay their original result after
current authorization. Changed fingerprints collide. Old/evicted results return
`RESULT_EXPIRED` and never reexecute.

Initial limits: k<=4, 64-KiB control messages, two completed block-result sets
retained for at most 60 seconds, 1-MiB retained control data per attempt.
Frames/host memory have separately enforced route bounds. Unresolved records
cannot be evicted. Maintain monotonic retirement boundaries and bounded attempt
tombstones; when full, drain/reject admission rather than forget identities.
Deadlines and retry windows MUST be finite and admitted before execution.

Before commit, cancellation stops future work and settles/discards scratch. Once
any stage commits, retry only the identical operation within retention/deadline;
unresolved partial commitment interrupts and retires the attempt. Unknown
publication is reconciled through storage, never regeneration. Disconnect,
coordinator loss, stale epochs, or cleanup failure cannot revive output or release
uncertain allocations.

Restart changes process/device epochs. Healthy independently admitted capacity
MAY run a fresh authorized attempt while old resources remain charged. Persisted
text, a warm model replica, or a cursor is not a recoverable GPU checkpoint.
No coordinator election or transparent GPU recovery is promised.

### 7. Publication decoding and cancellation

An execution publication contains attempt/sequence, expected revision, previous
publication digest, exact accepted IDs and contiguous token range, successor
cursor, decoder/output delta, stopping outcome, and authenticated commit
acknowledgments. Its acknowledgment set MUST equal the route's stage IDs exactly:
one for whole-request, two for split execution. Reject missing, extra, duplicate,
or mismatched acknowledgments. Admission-only empty results are the explicit
no-execution case in section 4.

The existing conversation owner MUST atomically validate writer epoch,
cancellation/retirement state, revisions, matching commits and contiguous ranges;
append the immutable record; and advance its durable head. The publication key is
`(coordinator epoch, attempt ID, sequence)`. An identical publication key returns
the original receipt; changed content collides. Only after transaction completion
install projections and notify UI. Use one authorized writer and a genuinely
transactional adapter; independent load/save writes are insufficient.

Cancellation competes through that same durable transition. Cancellation first
suppresses unpublished output; publication first preserves it and cancellation
stops later advancement. Unknown/write-failed storage fences execution and
delivery until reconciled. Writer takeover creates a new epoch and interrupts
active attempts. Delivery deduplicates saved events and rechecks read/disclosure
permission; replay never regenerates.

Decode only accepted IDs on provisional decoder state. Count invisible/control
tokens. Buffer incomplete bytes and the longest suffix that could become a stop
string. Detect completed matches anywhere in each new chunk; earliest completion
wins, then earliest start and configured order. Hide the stop string and later
text. Priority is EOS/stop-token/tool boundary, text stop, generated-token limit,
then context limit. On normal finalization flush nonmatching suffix according to
the decoder contract; never newly flush it on failure/cancel.

Raw and visible UTF-16 limits are separate hard guards: violation fails the
unpublished transition, without partial-token acceptance or silent truncation.
Tool execution consumes only durably published, deduplicated intents after
separate permission checks; uncertain external effects require the tool's own
idempotency contract.

### 8. Admission privacy and placement

Reserve the complete route in deterministic authority/participant order;
activate only after every stage accepts. Charge disjoint actual allocations:
resident weights once, live attempt/retained-parent state, scratch, replay inputs,
workspace, staging, and unsettled resources. Host retention has a separate budget.
A temporary third copy must be admitted. Copies remain charged until observed
completion; expiry prevents new work but never proves release.

Enforce the frozen route/device allocation cap. Preserve the 1,420,000,000-byte
GPU-buffer ceiling for the currently qualified campaign/device configuration;
it is not a universal cap for future models or hardware. Shared browser/native
hardware requires an actual shared admission authority or enforced exclusive/static
allocations. A shared-device label is not enforcement. Unknown bounds make
speculation ineligible.

Custody, compute, prompt disclosure, prefix reuse, drafting, and output replay are
separate grants. A colocated drafter is still a disclosure recipient. Keep private
prefix handles/hashes out of global discovery. Signatures prove identity/integrity,
not honest target computation.

Prepare missing coverage in the slow loop; select eligible prepared routes in the
request loop. Never migrate an active attempt. Optional ranking extends existing
placement using measured complete-route preparation, queue, prefill, directed
transfers/relays, decode, and risk costs without double counting. Fixed-route
correctness comes first.

### 9. Existing implementation owners

Doppler: `generation-contract.json` and its generator own declarations;
`token-sampling`/`generation-step` own the versioned sampler; ordinary/resident
callers share semantic indices. Extend `partition-attempt`, `resident-partition`,
`partition-execution`, KV/recurrent/convolution owners, and bundled
`incremental-decoder`; add narrowly scoped resident-state/block contracts.
Export Doppler types through `doppler-gpu/partitions`; Reploid imports them.

Reploid: extend `partition-contract`, runner, peer, entry, step-receiver, grants,
reservations, discovery, placement, and automatic-partitions. Extend
`packages/reploid/src/chat/workspace.js` and `self/host/chat-session.js` with one
publication reducer/transactional history adapter under existing chat/artifact
ownership. Reuse custody, browser host, `server/native-participant.js`, and tool
runner. JSON declares policy; JavaScript orchestrates; WGSL owns GPU
computation/copies. Preserve legacy identities/history, negotiate new capabilities
explicitly, and regenerate generated files. Version expanded wire policies,
including C/L and zero-output outcomes; do not reinterpret older schemas.

### 10. Delivery and release gates

Deliver in order: contract/cursor fixtures; ordinary sampler consistency; one
real local fork; fixed two-stage replay plus transactional publication;
exact-package application qualification. Measured placement is optional afterward.

Required tests cover malformed contracts and Philox vectors;
transforms/ties/uniform endpoints; bootstrap/N=0/context edges; every
rejection/terminal position; nonzero-temperature whole/split/block equivalence
under retries/interleaving; real ring/recurrent/convolution/decoder restoration;
replay divergence; copy/dispatch/readback cancellation and third-copy peaks;
duplicate phases/expired results; partial commit/disconnect/stale epochs;
publication failures/cancellation races/UI replay; cross-block stops/tools;
shared-device overcommit; grants/revocation; and scratch-free ordinary execution.

Numerical accuracy, distribution parity, same-seed replay, lifecycle safety,
answer quality, and performance are separate gates. Preserve existing tolerances,
including 0.001 where required. The current paired full-model 55-prefix package
qualification remains required before promotion. Bind evidence to source commits,
exact archive/installed files, browser/native bundles, model/configuration,
provider, and reference. Version strings alone are insufficient.

Freeze workload, seeds, route, cache/warmup policy, resource limits, and measurement
method. Compare ordinary execution with fixed k=1,2,4; no adaptive block sizing
before a fixed configuration qualifies. Include drafting, copying, computation,
transfer, rejected work, reconstruction, commit, durable publication, and required
cleanup. Denominator: newly published accepted raw tokens. Preserve
failed/interrupted measurements; report loading separately and end-to-end.

Enable speculation only with at least 30 matched measured pairs, at least 10%
median committed-token-cost improvement, and a paired 95% confidence interval
excluding no improvement. Additional p95 first-irrevocable-output delay MUST be
<=25 ms; additional p95 visible publication gap MUST be <=50 ms. Report longest
visible pause, transferred/discarded work, memory peaks, and cancellation
settlement. No correctness, numerical, lifecycle, authorization, or quality
regression is permitted. Inconclusive cohorts remain disabled.

Remaining work is qualification of concrete package/model, arithmetic profiles,
state geometries, hosts, storage durability, budgets, drafter, and measured
cohorts. None permits weakening this architecture or its gates.

### Inherited normative fixtures and provenance

Pinned source commit: `clocksmith/reploid`
`81c355e2a56b75ca488a7cc6911e288ec4354458`.

The following retained details come from topology3 sections 3.1, 4.1, 6.2, 10,
and 11. They remain normative where sections 1–10 above do not override them.
Former requirement/test IDs remain for traceability; they do not identify a
second active specification. The original [topology3 source](https://github.com/clocksmith/reploid/blob/81c355e2a56b75ca488a7cc6911e288ec4354458/docs/topology3.md)
and [topology2 source](https://github.com/clocksmith/reploid/blob/81c355e2a56b75ca488a7cc6911e288ec4354458/docs/topology2.md)
retain historical context. Topology2 section 11.3 supplies the stronger
performance gate in section 10 above. Conflicting topology3 section 12.3
thresholds do not apply. Topology1's earlier proposal is superseded and retained
in Git history, not as another work queue.

#### Canonical representation fixtures

**RDI-03 — Encoding and validation.**

```ts
type UInt32 = number; // Integer: 0 .. 4_294_967_295
type Count = number; // Nonnegative safe integer, further bounded by policy (section 2)
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

#### Philox algorithm and known-answer fixtures

**RDI-05 — Random words.** The new generator is **Philox4x32-10**, with the constants and round function below, matching Random123 v1.14.0. This is a sampling generator, not an authentication primitive. The specified algorithm and published vectors are reference requirements; conformance evidence is recorded separately in [the task register](requirements.md). [GitHub](https://raw.githubusercontent.com/DEShawResearch/random123/v1.14.0/include/Random123/philox.h)

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

#### Retained-row replay fixtures

**RDI-11 — Replay-input retention.**

`evaluateBlock()` MUST retain exact inputs until commit or discard settles:

- Stage 0: token IDs, absolute positions, and execution identity.
- Stage 1: received activation rows, layout, absolute positions, payload identity, and required token context.

For partial acceptance of `a` from `a,b,c`, both stages materialize `p,a`. Stage 1 therefore replays the **first two activation rows**, not one row and not token IDs alone.

The first implementation MUST restore scratch from the parent and replay the accepted materialized prefix whenever tentative state extends beyond the successor. It MUST NOT use counter-only truncation.

Stage 0 MUST compare regenerated accepted boundary rows with its retained original rows under the exact replay contract. A mismatch is `REPLAY_DIVERGENCE`; it MUST NOT silently substitute the new rows. Stage 1 replays the original received rows.

Reconstruction installs the bound decision without repeating authoritative sampling, decoder acceptance, publication, or tool execution.

#### Implementation map and migration rules

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

The generation declarations explicitly identify `generation-contract.json` as their source. The owner map defines required extension points; [the task register](requirements.md) records implementation and qualification status.

##### Migration rules

1. Legacy sampler and generation identities MUST remain interpretable without changing their transcripts.
2. The new generation policy MUST require explicit selection; old numeric seeds are not silently remapped.
3. Block capability MUST be separately advertised. Existing checkpoint/replay flags MUST remain false unless those distinct capabilities are implemented.
4. Paired activation layouts MUST use the existing Doppler layout/schema owner; old receivers reject unsupported schemas rather than inferring them.
5. Existing text-only conversation records remain valid display history. They MUST be marked as lacking authoritative generated-token history and excluded from new prefix/state claims.
6. The transactional history adapter MUST migrate or reference legacy history without two competing authoritative writers. Failed migration preserves the legacy store.
7. Source, package, and served browser changes require new identities and applicable conformance checks. Generated delivery files MUST be regenerated from canonical source.
8. JSON declares policies and limits; JavaScript owns orchestration and state lifecycle; WGSL implements GPU arithmetic. Random-word and CPU selection code are appropriate JavaScript computation, not network policy.

---

#### Acceptance matrix and exhaustive test catalogue

**RDI-28 — Separate gates and evidence.**

Every test below is required acceptance work. This contract alone does not report any as passed; consult the scoped evidence in [the task register](requirements.md).

| Gate                               | Required evidence                                                                                           | Does not establish                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Distribution parity**            | Split versus whole execution under the same admitted policy, including selected tokens and stopping         | Independent mathematical accuracy              |
| **Independent numerical accuracy** | Applicable approved reference and unchanged tolerance; retain the existing 0.001 requirement where mandated | Same-seed transcript across different samplers |
| **Random-word conformance**        | Published Philox vectors, seed encoding, counters, purposes, lanes                                          | Equal probability arithmetic                   |
| **Same-seed target replay**        | Identical accepted token IDs, stopping, and continuation to ordinary execution in the declared profile      | Universal cross-device equality                |
| **State/lifecycle safety**         | Real state restoration, cancellation, isolation, settlement, and memory accounting                          | Useful answers                                 |
| **Answer quality**                 | Scope-matched basic chat/follow-ups; document factual/citation tasks apply only to secondary attachment acceptance                                                      | Runtime numerical conformance                  |
| **Performance**                    | Complete operation cost and visible pauses against ordinary execution                                       | Safety or quality                              |

The current repository’s qualification boundaries remain separate. This specification neither weakens independent accuracy requirements nor treats their failure as proof of a distribution defect.

##### Test catalogue

| Test ID                             | Test surface and required cases                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **T01 Contract validation**         | New schema tests: malformed IDs, nonfinite values, unknown fields, overflow, wrong layout/stride, payload mismatch, unsupported versions      |
| **T02 RNG vectors**                 | New RNG unit tests plus existing seeded-generation tests; published vectors, seed endian, purpose and index isolation                         |
| **T03 Selection**                   | Identical logits, greedy ties, top-K/top-P boundaries, penalty windows, masks, uniform endpoints, CPU/GPU distinction                         |
| **T04 Cursor**                      | All cursor examples in section 4 above; R=0/R=1; terminal entry; pending-token invariants; invisible accepted tokens                                                 |
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
| **T17 Application quality**         | Frozen and fresh basic-chat tasks, follow-ups, uninterrupted versus recovered journeys; citations/source navigation only for secondary attachment scope               |

Existing seeded and physical tests SHOULD be extended. New composite-state and block tests MUST use actual state owners rather than mocks for restoration claims. The existing receiver test suite already exercises identity collisions and is the appropriate place for the new bounded-replay cases.

---

*Last updated: October 2026*
