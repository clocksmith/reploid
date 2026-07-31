# Poolday Protein Sequence Lane

Poolday carries governed protein-sequence assignments to one selected browser
provider, executes them through Doppler, and returns signed result receipts.
ESM-2 35M is the only enabled Poolday model. Its catalog entry pins the hosted
RDRR manifest, tokenizer, shard identity, source revision, protein-sequence
capabilities, and Doppler browser execution mode. Text, generic embedding,
vision, DNA, and RNA models are not admitted by Poolday.

## Target models

| Model | Poolday state | Initial output | Doppler conversion | Kernel path |
|---|---|---|---|---|
| AMPLIFY 120M | Candidate | Protein pooled/token embeddings and masked-token logits | `amplify-120m-f16-af32`; source tensors are renamed or split into Doppler Q/K/V/O and gated-FFN roles | F16 gather and weights, F32 activations, RMSNorm, RoPE, non-causal F16-KV attention, gated SiLU |
| ESM-2 35M | Enabled | Protein pooled embedding | `esm2-t12-35m-ur50d-f32-af32`; ESM tensor names and character vocabulary are mapped into the RDRR encoder contract | F32 gather/matmul, LayerNorm plus bias, RoPE, non-causal attention, GELU |
| ESMC 300M | Candidate | Protein pooled/token embeddings | `esmc-300m-f32-af32`; fused QKV and gated FFN source tensors are split into explicit projections | F32 gather/matmul, projection-axis Q/K LayerNorm, RoPE, non-causal attention, gated SiLU |
| Nucleotide Transformer v2 50M | Candidate | DNA pooled/token embeddings | `nucleotide-transformer-v2-50m-f32-af32`; ESM-style tensors and greedy vocabulary are mapped into the RDRR encoder contract | F32 gather/matmul, LayerNorm plus bias, RoPE, non-causal attention, gated SiLU |

Each conversion config owns the source checkpoint revision, tensor rules,
tokenizer behavior, execution graph, kernel digests, sequence alphabet,
pooling exclusions, and artifact identity. Poolday must copy only the final
model id, model hash, manifest hash, artifact root, workloads, execution modes,
and sequence capabilities into its catalog. It must not reconstruct the
conversion contract.

## Private input and public-provider boundary

The signed job intent contains a normalized sequence hash, length, alphabet,
workload, and output limits. It never contains the sequence. The normalized
sequence travels only through the selected provider's WebRTC DataChannel.

The public Poolday lane accepts only inputs explicitly classified `public`.
Private, medical, proprietary, or personally identifying sequences require a
trusted local or entitled-provider contract that is not implemented here. The
coordinator `/jobs` route rejects sequence workloads so it cannot accidentally
store a sequence as prompt text.

## Execution and agreement

The provider calls Doppler's public `encodeSequence()` handle. Poolday supports
two initial workload contracts:

- `sequence.embedding.v1`: pooled embedding, with optional token embeddings.
- `sequence.masked_logits.v1`: bounded top-K logits for declared token
  positions. Full logits do not enter the receipt or peer agreement.

Float outputs are hashed as canonical little-endian Float32 bytes. The signed
receipt binds the input hash, request hash, model and manifest identity,
sequence result metadata, and `sequenceResultHash`. Redundant providers agree
on `sequenceResultHash`; ring commit-reveal binds the same field before reveal.
The requester may receive the requested vectors over WebRTC, but they are not
placed in control-plane messages or signed receipt metadata.

## AdapterPack integration

A sequence adapter follows the existing governed AdapterPack path:

1. The pack names the exact biological base model and manifest.
2. Doppler parity and Gamma selection receipts qualify its target modules and
   outputs for that model.
3. The requester signs approval over the pack, sequence hash, and base model.
4. A provider advertises the pack as cached or fetchable.
5. The provider verifies cache, peer, or origin bytes and calls Doppler
   `loadLoRA()` before `encodeSequence()`.
6. The inference receipt requires adapter state `active` and records the
   acquisition source.

Adapter transport support does not prove model-specific LoRA parity. No
biological AdapterPack should be published until Doppler qualifies the exact
target modules for the exact converted base artifact.

## Promotion gate

A target becomes an enabled Poolday model only after all of these exist:

- an immutable hosted RDRR manifest, tokenizer, and shard root;
- a published Doppler release containing `encodeSequence()` and the required
  conversion/runtime support;
- exact output parity receipts on the hosted bytes;
- a browser load and inference receipt on a supported WebGPU device;
- a Poolday catalog entry with matching hashes and sequence capabilities;
- peer-room execution, receipt verification, and corruption tests against that
  exact catalog entry.

ESM-2 35M meets this gate for the public protein pooled-embedding path. AMPLIFY
and ESMC remain Doppler-qualified candidates, not deployable Poolday models.
No protein AdapterPack is published.
