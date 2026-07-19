# Blueprint 0x00011f: pool doppler runtime

**Objective:** Execute one exact Poolday model contract through Doppler's public browser handle.

**Target Upgrade:** pool/doppler-runtime.js

**Affected Artifacts:** /pool/doppler-runtime.js

---

### 1. Intent
Keep protocol decisions in Reploid and model numerics in Doppler. The adapter
may call public `generate`, `embed`, `encodeSequence`, `loadLoRA`, and unload
surfaces. It must not deep-import Doppler pipeline or kernel internals.

### 2. Architecture
The selected model contract determines the public method. Text generation is
serialized and reset between assignments. Embeddings are finite-checked and
hashed. Biological sequence execution validates alphabet, length, disclosure,
and output request before calling `encodeSequence`; vectors are Float32-hashed
and masked logits are reduced with a bounded top-K heap.

Adapter activation verifies a human-promoted AdapterPack, minimum Doppler
version, exact base identity, bytes, and acquisition evidence before
`loadLoRA`. The active pack is returned to the receipt builder.

### 3. Implementation Notes
The runtime records hashes and bounded metadata in transcripts, not raw
biological sequences or full logits. The peer transport may return requested
vectors to the requester. A provider cannot advertise a workload absent from
the loaded runtime model contract.

### 4. Verification Checklist
- [x] Text and embedding behavior remains covered
- [x] Sequence embedding and masked-logit paths are covered
- [x] Non-finite values and result-hash mismatches fail closed
- [x] Adapter activation remains exact-model and evidence bound

*Last updated: July 2026*
