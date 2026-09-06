# Blueprint 0x000081: pool doppler runtime

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/pool/doppler-runtime.js`, `/self/pool/executable-pack.js`, `/self/pool/pack-operation.js`, `/self/pool/pack-operation-adapters.js`

**Planned Artifacts:** None

**Owned Source Files:** `pool/doppler-runtime.js`, `pool/pack-operation.js`, `pool/pack-operation-adapters.js`, `pool/pack-operation-policy.js`

**Former Blueprint Paths:** `self/blueprints/0x000081-pool-doppler-runtime.md`
**Objective:** Execute one exact Poolday model contract through Doppler's public browser handle.

**Target Upgrade:** pool/doppler-runtime.js

**Affected Artifacts:** /pool/doppler-runtime.js, /pool/executable-pack.js, /pool/pack-operation.js, /pool/pack-operation-adapters.js

---

### 1. Intent
Keep protocol decisions in Reploid and model numerics in Doppler. The adapter
may call public `generate`, `embed`, `encodeSequence`, `loadLoRA`, and unload
surfaces. It must not deep-import Doppler pipeline or kernel internals.

An `executablePack` descriptor requires public `openPack`, then validates session
identity, selected plan, artifacts, assignment, and operation receipt before
returning outputs. Transport and signer policy stay outside signed model metadata.
No legacy loader fallback is permitted for a signed Pack assignment.

The versioned Pack operation bridge consumes public `executeOperation` events
without selecting model-specific behavior in its runner. Installed operation
adapters validate inputs and output geometry and apply declared comparison
rules. The initial adapters are `generate`, `embed`, `rerank`, and
`encodeSequence`; unknown names and versions fail explicitly. Model admission
and actual qualification remain separate from adapter availability.

`pool-config.json.operations` owns each adapter binding, operation and contract
version, allowed and required fields, streaming permission, resource ceilings,
comparison policy IDs and input classes. `operationComparisonPolicies` owns
comparison parameter requirements. The registry resolves immutable definitions
and binds implementation functions. Missing policy, unknown adapters and
unsupported contract versions fail explicitly. A fifth operation adds JSON
configuration and an implementation without networking changes. Public request,
event, result, definition and adapter contracts have declaration siblings.

### 2. Architecture
The selected model contract determines the public method. Text generation is
serialized and reset between assignments. The signed deterministic generation
contract explicitly disables speculative decoding, and the adapter always
passes Doppler a boolean `useSpeculative` option. Embeddings are finite-checked
and hashed. Biological sequence execution validates alphabet, length,
disclosure, and output request before calling `encodeSequence`; vectors are
Float32-hashed and masked logits are reduced with a bounded top-K heap.
Cataloged models load through their pinned public Doppler registry reference so
generation evidence retains the canonical model ID; explicit URL/manifest
inputs remain fallback surfaces for uncataloged handles.

Adapter activation verifies a human-promoted AdapterPack, minimum Doppler
version, exact base identity, bytes, and acquisition evidence before
`loadLoRA`. The active pack is returned to the receipt builder.

`runPackOperation` snapshots the input and exact binding before asynchronous
work. Every partial and completed event binds the request, attempt, operation,
event index, and previous digest. Completion requires the exact Pack closure,
accepted plan, requested runtime version, input/output hashes, completed
iterator cleanup, and a current-attempt check. Partial output is never accepted
as completion. Byte limits and deadlines reject oversized or stale results;
signals are cooperative cancellation, not GPU preemption or remote termination.

`assessPackOperation` requires a reference digest and comparison-policy digest
frozen in the assignment. Numerical comparison is explicit; generation's
exact-text rule is only suitable for tasks with a frozen reference. A bounded
reference comparison is not a scientific review. This local bridge neither
sends inputs nor grants delegation. Existing peer authorization remains owner
of remote participation; catalog and remote-job generalization are not implied.

### 3. Implementation Notes
The runtime records hashes and bounded metadata in transcripts, not raw
biological sequences or full logits. The peer transport may return requested
vectors to the requester. A provider cannot advertise a workload absent from
the loaded runtime model contract.

### 4. Verification Checklist
- [x] Text and embedding behavior remains covered
- [x] Doppler generation receives an explicit speculative-decoding boolean
- [x] Sequence embedding and masked-logit paths are covered
- [x] Non-finite values and result-hash mismatches fail closed
- [x] Adapter activation remains exact-model and evidence bound

The [operation tests](../../tests/unit/pool-pack-operation.test.js) cover four
adapters, a fifth without networking edits, stale attempts, tampered receipts,
cancellation, and policy binding. The [paired handoff](../../tests/integration/doppler-pack-handoff.test.js)
checks public Doppler interoperability with injected outputs, not model qualification.

*Last updated: September 2026*
