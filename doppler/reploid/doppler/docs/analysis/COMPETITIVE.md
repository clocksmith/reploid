# DOPPLER: Competitive Landscape & Technical Context

**DOPPLER** (Distributed Object Parallel Processing Layer Executing REPLOID) is a browser-native LLM inference engine. It is part of the REPLOID system (Recursive Evolution Protocol Loop Orchestrating Inference DOPPLER), with model distribution handled by RDRR (Recursive DOPPLER Runtime Registry).
See also: [Glossary](../GLOSSARY.md)

## TL;DR

DOPPLER is a browser-native LLM inference engine using hand-written WebGPU (WGSL) kernels. Key differentiators:

1. **Flash Attention in WGSL** - No other browser framework implements tiled Flash Attention directly in WGSL
2. **Hand-Optimized MoE** - Custom scatter-add routing (vs TVM-generated gather) for lower VRAM overhead
3. **60GB model support (theoretical)** - Tiered memory system for unified memory architectures
4. **Native Bridge** - mmap access to local files, bypassing OPFS limits

**Caveat:** Performance benchmarks pending. WebLLM supports MoE (Mixtral) via TVM. DOPPLER must prove better performance.
See: `docs/spec/BENCHMARK_HARNESS.md` and `docs/spec/KERNEL_TESTING.md`.

---

## Roadmap and Metrics

This document focuses on competitor context and technical constraints.

Implementation work, task tracking, and priorities live in `docs/plans/OPTIMIZATION_ROADMAP.md`.

Benchmark and testing specs:

- `docs/spec/BENCHMARK_HARNESS.md` (pipeline and system benchmarks, result schema)
- `docs/spec/KERNEL_TESTING.md` (kernel and segment tests, how to interpret correctness)
- `docs/plans/OPTIMIZATION_ROADMAP.md` (action items and priorities)

Key success metrics (the minimum needed for credible comparisons):

- Time to first token (cold and warm).
- Decode throughput (warm): tokens per second for greedy decode on a fixed workload set.
- Peak VRAM and readback bytes per token (logits and debug reads).
- MoE path correctness and performance (Mixtral and GPT-OSS).
- Model coverage matrix with VRAM requirements.

---

## Browser LLM Frameworks (Dec 2025)

| Framework | Compiler | Max Model | MoE | Flash Attn | Maturity | Community |
|-----------|----------|-----------|-----|------------|----------|-----------|
| **[WebLLM](https://github.com/mlc-ai/web-llm)** | TVM/MLC | ~31GB VRAM | **Yes** | Via TVM | Production | 16.9k stars |
| **[Transformers.js](https://huggingface.co/docs/transformers.js)** | ONNX Runtime | **4GB hard** | No | No | Production | 1.4M monthly users |
| **[MediaPipe LLM](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js)** | TFLite | ~27GB | No | Unknown | Production | Google-backed |
| **[WeInfer](https://dl.acm.org/doi/10.1145/3696410.3714553)** | Custom | ~8GB | Unknown | Unknown | Research | Academic |
| **DOPPLER** | None (raw WGSL) | Claims 60GB | **Yes (custom)** | **Yes (custom)** | Prototype | n/a |

**Key gap (Dec 2025):** WebLLM supports Mixtral, but DOPPLER aims to push larger models via shard-based distribution (RDRR) and Native Bridge.

### WebLLM (MLC-AI)

The incumbent. Uses Apache TVM compiler for optimized WebGPU kernels.

> "Evaluations show that WebLLM can retain up to 80% native performance on the same device, with room to further close the gap."
>
> Source: [WebLLM Paper, arXiv 2412.15803](https://arxiv.org/abs/2412.15803), Dec 2024

**Model Catalog (Dec 2025):**

| Model | Params | Quantization | VRAM | Context |
|-------|--------|--------------|------|---------|
| Llama-3.2-1B-Instruct | 1B | q4f16 | ~1GB | 4k |
| Llama-3.2-3B-Instruct | 3B | q4f16 | ~2GB | 4k |
| Llama-3.1-8B-Instruct | 8B | q4f16 | ~5GB | 4k/128k |
| Llama-3-70B-Instruct | 70B | q4f16 | ~31GB | 4k |
| Qwen2.5-Coder-7B | 7B | q4f16 | ~5GB | 4k |
| DeepSeek-R1-Distill-Qwen-7B | 7B | q4f16 | ~5GB | 4k |
| Phi-3.5-vision-instruct | 4B | q4f16 | ~3GB | 4k |
| Gemma-2-9B | 9B | q4f16 | ~6GB | 4k |
| SmolLM2-1.7B | 1.7B | q4f16 | ~1GB | 4k |

Source: [WebLLM GitHub #683](https://github.com/mlc-ai/web-llm/issues/683), Dec 2025

**Quantization formats:** q4f16 (4-bit weights, f16 compute), q4f32, q0f16, q0f32

**API:** OpenAI-compatible

**Roadmap/WIP:**
- Function calling (tools API) - in progress
- Custom model compilation - available

MoE support: Mixtral support is reported. Verify current WebLLM catalog and hardware requirements.

### WeInfer (ACM Web Conference 2025) - Critical Threat

Academic research showing significant improvements over WebLLM. **If open-sourced, could leapfrog both WebLLM and DOPPLER.**

> "Evaluations across 9 different LLMs and 5 heterogeneous devices show that WeInfer delivers substantial improvements in decoding speed, achieving up to a 3.76x performance boost compared with WebLLM."
>
> Source: [ACM WWW 2025](https://dl.acm.org/doi/10.1145/3696410.3714553), April 2025

**Performance claims:**
- 3.76x faster decode vs WebLLM v0.2.46
- Tested: 9 LLMs, 5 devices (RTX 4090, Apple M2, Windows GPUs)
- Baseline: WebLLM v0.2.46 (Dec 2024)

**Key innovations (directly applicable to DOPPLER):**

| Technique | Description | DOPPLER Status |
|-----------|-------------|----------------|
| **Buffer Reuse** | Optimized WebGPU buffer lifecycle management | Partial (buffer-pool.ts) |
| **Async Pipeline** | Decouples resource prep from GPU execution | Not implemented |
| **Deferred Result Fetching** | Parallelized computation with lazy readback | Not implemented |

**Threat assessment:**
- Paper published April 2025, no public repository yet (as of Dec 2025)
- Techniques are framework-agnostic. Could be adopted by WebLLM
- DOPPLER should implement similar buffer pooling and async dispatch
- **Track:** Search for "WeInfer" GitHub releases

**OpenReview:** [https://openreview.net/forum?id=Qu2itILaoZ](https://openreview.net/forum?id=Qu2itILaoZ)

### Transformers.js (Hugging Face)

Largest browser ML community. Broad model support via ONNX Runtime Web, but hard 4GB limit.

**Scale (Oct 2025):**
- **1.4 million unique monthly users**
- **155 supported architectures**
- WebGPU mode: up to **100x faster** than WASM

Source: [JSNation 2025 Talk](https://gitnation.com/contents/transformersjs-state-of-the-art-machine-learning-for-the-web), [Transformers.js v3 Blog](https://huggingface.co/blog/transformersjs-v3), Oct 2024

> "Currently, there is no way for ONNX Runtime Web to run models larger than 4GB... WebAssembly has a memory limit of 4GB. This is the maximum amount of memory that a WebAssembly module can access because of the 32-bit addressing."
>
> Source: [ONNX Runtime Docs](https://onnxruntime.ai/docs/tutorials/web/large-models.html), Dec 2025

**Quantization:** fp32, fp16, q8 (default WASM), q4

**Notable demos:** SmolVLM (multimodal), Phi-3.5-WebGPU, Whisper-WebGPU

**Roadmap:**
- WebNN integration - in progress
- More architectures - ongoing (155→?)
- **WASM64 or direct GPU loading** - "may support in future" (would remove 4GB limit)

**Threat if 4GB limit removed:** Instant access to larger models for 1.4M users

### Google MediaPipe LLM

Google's official solution with custom workarounds for browser limits.

> "MediaPipe's earlier web APIs made heavy use of JavaScript primitives like ArrayBuffer when loading data, but many of these cannot support sizes past ~2GB. For the initial web LLM launch, they worked around the 2GB limitation by creating custom data copying routines... Google has since redesigned the model loading system to run much larger models like Gemma 1.1 7B. This 8.6GB model comprising 7 billion parameters is several times larger than any model they've run in a browser previously."
>
> Source: [Google AI Blog](https://research.google/blog/unlocking-7b-language-models-in-your-browser-a-deep-dive-with-google-ai-edges-mediapipe/), 2024

**Model Catalog (Dec 2025):**

| Model | Params | Multimodal | Notes |
|-------|--------|------------|-------|
| Gemma-3n E2B | 2B | Image + Audio | Latest (Dec 2025) |
| Gemma-3n E4B | 4B | Image + Audio | Latest (Dec 2025) |
| Gemma 2B | 2B | No | Original |
| Gemma 4B | 4B | No | |
| Gemma 12B | 12B | No | |
| Gemma 27B | 27B | No | Largest |
| MedGemma-27B-Text | 27B | No | Medical domain |
| Phi-2 | 2.7B | No | Non-Google |
| Falcon-1B | 1B | No | Non-Google |
| StableLM-3B | 3B | No | Non-Google |

Source: [MediaPipe Web Guide](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js), Dec 2025

**LoRA support:** Gemma-2 2B, Gemma 2B, Phi-2

**Key insight:** Google solved 2GB ArrayBuffer limit with custom data copying routines.

**Limitation:** Primarily Gemma-focused, limited non-Google model support.

---

## Model Size Constraints

### WebGPU Buffer Limits (The Real Bottleneck)

> "Safari's Metal backend imposes a 256MB default buffer size limit on iPhone 6 devices, scaling up to only 993MB on iPad Pro, while Chrome's maxStorageBufferBindingSize is often limited to 128MB despite reporting higher capabilities."
>
> Source: [WebGPU Bugs Article](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)

| Browser | Buffer Limit | Notes |
|---------|--------------|-------|
| Chrome | ~128MB | Often lower than reported |
| Safari (iPhone) | 256MB | Metal backend |
| Safari (iPad Pro) | 993MB | Better but still limited |
| Firefox | Varies | WebGPU in v141+ |

### Practical Model Sizes

> "Currently, models in the 1-8 billion parameter range are most practical with quantization. Larger models may run on powerful devices, but memory and latency make them less user-friendly in browser environments."
>
> Source: [AI Competence Guide](https://aicompetence.org/ai-in-browser-with-webgpu/)

| Model Size | VRAM Required | Browser Feasibility |
|------------|---------------|---------------------|
| 1-3B (INT4) | 1-2GB | Good |
| 7-8B (INT4) | 4-6GB | Marginal |
| 13B+ | 8GB+ | Challenging |
| MoE (Mixtral 8x7B) | 90GB | Requires expert swapping |

### The 35% Compatibility Problem

> "WebGPU's promise of democratizing AI through browser-based LLM inference remains tantalizingly close yet frustratingly unattainable due to implementation bugs and ecosystem fragmentation. While WebLLM demonstrates that browser-based inference can achieve 80% of native performance, the 20% performance gap combined with compatibility issues affecting 35% of users, memory limitations preventing large model deployment, and platform-specific bugs requiring extensive workarounds creates an environment where production deployment remains impractical for most use cases."
>
> Source: [Medium Analysis](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)

---

## MoE Support Comparison (Dec 2025)

**DOPPLER's key differentiator:** Hand-tuned routing kernels vs TVM compilation, and potential for demand-paging experts from disk (Native Bridge).

| Framework | MoE Status | Models | Implementation |
|-----------|------------|--------|----------------|
| **DOPPLER** | **Yes (GPU-native)** | Any (theoretical) | Custom WGSL topk + scatter_add |
| **WebLLM** | Yes | Mixtral 8x7B | TVM-generated kernels |
| **Transformers.js** | No | n/a | 4GB limit blocks Mixtral |
| **MediaPipe** | No | n/a | Dense models only |
| **vLLM (server)** | Yes | DeepSeek-V3, Mixtral, Qwen3 | CUDA/FlashInfer |

### Why MoE Matters

> "Since early 2025, nearly all leading frontier models use MoE designs."
>
> Source: [NVIDIA MoE Blog](https://blogs.nvidia.com/blog/mixture-of-experts-frontier-models/), 2025

Top MoE models (server-side only as of Dec 2025):
- DeepSeek-V3 (671B params, 37B active)
- Mixtral 8x7B (46.7B params, 12.9B active)
- Qwen3 MoE variants
- Llama 4 Scout (109B params)

Source: [Red Hat vLLM+DeepSeek](https://developers.redhat.com/articles/2025/09/08/scaling-deepseek-and-sparse-moe-models-vllm-llm-d), Sept 2025

### DOPPLER MoE Validation Needed

- [ ] Run actual MoE model (e.g., Mixtral-instruct) end-to-end
- [ ] Benchmark expert swapping latency
- [ ] Compare vs WebLLM Mixtral on identical hardware

---

## TVM Compilation vs Hand-Written WGSL

### TVM Approach (WebLLM)

Apache TVM uses machine learning to auto-tune kernel configurations.

> "With an expressive code generator and an efficient search algorithm, we are able to generate kernels that are comparable to heavily hand-optimized ones."
>
> Source: [TVM Blog](https://tvm.apache.org/2018/10/03/auto-opt-all)

**Advantages:**
- Auto-tuning finds optimal tile sizes per device
- Cross-platform compilation
- Less manual optimization work

> "When compared against NCNN, a widely used hand-optimized kernel library that makes extensive use of NEON assembly instructions (with 13k lines of code for only 3x3 convolution layers), TVM outperforms it for all networks on Raspberry Pi 3B."
>
> Source: [TVM Mobile Optimization](https://tvm.apache.org/2018/01/16/opt-mali-gpu)

**Disadvantages:**
- Black box - harder to debug
- Some ops poorly optimized:

> "The scatter_nd op was reported to be almost 1000x slower than a naive hand-written CUDA implementation in one case."
>
> Source: [TVM Discussion](https://www.mail-archive.com/dev@tvm.apache.org/msg03451.html)

- Requires compilation step to add new models

### Hand-Written WGSL Approach (DOPPLER)

**Advantages:**
- Full control over memory layout and access patterns
- Can implement cutting-edge algorithms directly
- No compiler dependency or black box
- Tighter integration with host application

**Disadvantages:**
- Massive engineering effort (~95KB of shader code)
- Must manually optimize for each GPU architecture
- Higher bug risk
- No auto-tuning

### Industry Context

> "First-generation AI frameworks like TensorFlow and PyTorch 1.0 relied heavily on hand-written CUDA kernels, which couldn't scale to rapidly evolving AI workloads. TVM and XLA, as second-generation approaches, tackled this problem with automated compilation."
>
> Source: [Modular Blog](https://www.modular.com/blog/democratizing-ai-compute-part-6-what-about-ai-compilers)

DOPPLER intentionally takes the "first-generation" approach for WebGPU, betting that hand-tuned WGSL can outperform TVM-compiled kernels in the browser environment.

---

## DOPPLER Technical Differentiators

### 1. Multi-Tier Flash Attention in WGSL

DOPPLER implements **multi-tier Flash Attention** with automatic kernel selection based on device capabilities and model architecture:

| Tier | Kernel | headDim | Shared Memory | Use Case |
|------|--------|---------|---------------|----------|
| Large | `attention.wgsl` | <= 64 | 48KB | Standard models (Llama, Mistral) |
| Small | `attention_small.wgsl` | <= 256 | 8KB | Large heads (Gemma 3, custom) |
| Streaming | `attention_streaming.wgsl` | Any | None | Fallback for constrained devices |

```javascript
// Automatic tier selection in kernel-selector.ts
const canLarge = headDim <= 64 && sharedLimit >= 49152;
const canSmall = headDim <= 256 && sharedLimit >= smallRequired;
tier = canLarge ? 'tiled_large' : canSmall ? 'tiled_small' : 'streaming';
```

**No other browser framework** implements Flash Attention directly in WGSL. WebLLM uses TVM-compiled attention kernels.

Features:
- Online softmax (numerically stable)
- Grouped Query Attention (GQA) support
- Causal masking with absolute position tracking
- Tiled computation to avoid full attention matrix materialization
- f16 KV cache support (`_f16kv` variants) for 2x memory savings
- headDim tiling for large head dimensions (Gemma 3 4B: headDim=256)

### 2. GPU-Native MoE Routing (Dec 2025)

Full mixture-of-experts execution on GPU with zero CPU readback:

```
inputBuffer (GPU)
    |
computeRouterLogitsGPU() -> logitsBuffer (GPU matmul)
    |
runSoftmaxTopK() -> indices, weights (GPU fused softmax+topk)
    |
_runExpertGPU() x numExperts -> expertOutputsBuffer (GPU FFN per expert)
    |
runScatterAdd() -> outputBuffer (GPU weighted combination)
    |
outputBuffer (GPU) <- stays on GPU, no readback
```

**Custom WGSL kernels:**

| Kernel | Purpose |
|--------|---------|
| `topk.wgsl` | Top-K selection with 3 variants (default, small k=2/n<=8, fused softmax+topk) |
| `scatter_add.wgsl` | Weighted scatter-add for combining expert outputs (vec4 + accumulate variants) |
| `moe_gather.wgsl` | Token gathering by expert (available, not used in current impl) |

**Implementation note:** Runs all experts for all tokens, then uses scatter-add to select top-k contributions. Simpler than gather-compute-scatter for typical decode batches.

### 3. Tiered Memory System

| Tier | Hardware | Max Model |
|------|----------|-----------|
| 1 | Unified Memory (Apple Silicon) | 60GB |
| 2 | Memory64 (discrete GPU) | 40GB MoE |
| 3 | Basic | 8GB small MoE |

**Validation needed:** 60GB claim is theoretical based on unified memory architecture. No real-world testing with models this large.

### 4. Native Bridge for Local Files

Shell script bridge (`bridge/native/doppler-bridge.sh`) enables mmap access to local model files, bypassing OPFS limits.

```javascript
// Load via Native Bridge (mmap)
const bridgeClient = await createBridgeClient();
const manifestBytes = await bridgeClient.read(manifestPath);
```

No other browser LLM framework offers native file access.

---

## WGSL Kernel Inventory

| Kernel | Lines | Purpose |
|--------|-------|---------|
| `attention.wgsl` | 340+ | Flash Attention (tiled, large, headDim<=64) |
| `attention_small.wgsl` | 200+ | Flash Attention (tiled, small, headDim<=256) |
| `attention_streaming.wgsl` | 100+ | Flash Attention (no shared mem fallback) |
| `attention_f16kv.wgsl` | 340+ | Attention with f16 KV cache (large) |
| `attention_small_f16kv.wgsl` | 200+ | Attention with f16 KV cache (small) |
| `attention_streaming_f16kv.wgsl` | 100+ | Attention with f16 KV cache (streaming) |
| `matmul_f16.wgsl` | 130+ | FP16 matrix multiplication |
| `matmul_f32.wgsl` | 85+ | FP32 matrix multiplication |
| `matmul_f16w_f32a.wgsl` | 120+ | Mixed precision (f16 weights, f32 activations) |
| `rmsnorm.wgsl` | 250+ | RMS normalization |
| `rope.wgsl` | 320+ | Rotary position embeddings |
| `softmax.wgsl` | 360+ | Softmax with online normalization |
| `silu.wgsl` | 210+ | SiLU activation (gated) |
| `topk.wgsl` | 230+ | Top-K selection (3 variants) |
| `scatter_add.wgsl` | 200+ | MoE output combination |
| `moe_gather.wgsl` | 220+ | Token gathering by expert |
| `dequant_shared.wgsl` | 200+ | Dequantization (shared memory) |
| `dequant_subgroup.wgsl` | 170+ | Dequantization (subgroup ops) |
| `dequant_f16_out.wgsl` | 150+ | Dequantization with f16 output |
| `cast_f32_to_f16.wgsl` | 40+ | Type casting for KV cache |
| `gather.wgsl` | 80+ | Embedding lookup |
| `residual.wgsl` | 65+ | Residual addition |

**Total:** ~100KB+ of hand-written WGSL shader code

---

## Open Questions & Validation Needed

### Performance Benchmarks

- [ ] Tokens/sec vs WebLLM on same model (e.g., Llama 3 8B INT4)
- [ ] Tokens/sec vs WeInfer (claimed 3.76x over WebLLM)
- [ ] Prefill latency comparison
- [ ] Memory bandwidth utilization

### Large Model Support

- [ ] Actually run a 40GB+ model on unified memory Mac
- [ ] Verify MoE expert swapping works for Mixtral-class models
- [ ] Test Native Bridge mmap performance vs OPFS

### Browser Compatibility

- [ ] Safari buffer limit workarounds
- [ ] Firefox 141+ WebGPU testing
- [ ] Chrome on Android performance

### Kernel Correctness

- [ ] Flash Attention numerical accuracy vs reference
- [ ] MoE routing correctness with ground truth
- [ ] Quantization accuracy (INT4 vs FP16 vs FP32)

---

## ONNX Runtime Web: 4GB Limit Tracking

**Current State (Dec 2025):**

> "Currently, there is no way for ONNX Runtime Web to run models larger than 4GB."
>
> Source: [ONNX Runtime Docs](https://onnxruntime.ai/docs/tutorials/web/large-models.html), Dec 2025

**Planned Solutions:**
1. **WASM64** - 64-bit addressing would remove 4GB cap
2. **Direct GPU Weight Loading** - Bypass WASM entirely for weights

**Impact on DOPPLER:**
If either solution ships, Transformers.js (1.4M monthly users) instantly gains large model support, eliminating DOPPLER's size advantage.

**Track:** [GitHub Issue #13006](https://github.com/microsoft/onnxruntime/issues/13006)

---

## Competitive Threat Timeline

| Threat | Likelihood | Timeframe | Impact on DOPPLER |
|--------|------------|-----------|-------------------|
| WeInfer open-source release | Medium | 2025 H1-H2 | **High** - buffer/async techniques applicable to all |
| ONNX WASM64 | Low | 2025-2026 | **High** - removes 4GB limit for Transformers.js |
| WebLLM optimizes MoE | High | 2025 | **High** - DOPPLER must win on performance and VRAM |
| Chrome built-in AI (`window.ai`) | Medium | 2025-2026 | **High** - native APIs could obsolete frameworks |
| MediaPipe model expansion | High | Ongoing | Low - still Google-model focused |
| FlashInfer WebGPU port | Low | 2026+ | **High** - would match DOPPLER's attention perf |

### Defensive Priorities

1. **Urgent:** Validate performance vs WebLLM baseline
2. **High:** Implement WeInfer-style buffer pooling + async dispatch
3. **High:** Ship working MoE demo (Mixtral or similar)
4. **Medium:** Document Native Bridge advantages over OPFS
5. **Medium:** Ship useful P2P shard cache (distribution)
6. **Medium:** Track ONNX WASM64 progress

### DOPPLER's Defensible Moats

| Differentiator | Threat Level | Notes |
|----------------|--------------|-------|
| Flash Attention in WGSL | Safe (2025) | No competitor has this in browser |
| Hand-tuned MoE | Contested | WebLLM supports MoE. Battle is on performance |
| 60GB unified memory | Untested | If validated, unique advantage |
| Native Bridge (mmap) | Unique | No competitor offers local file access |
| P2P shard cache | Planned | Swarm shard distribution reduces origin bandwidth and improves cold start |
| Hand-written kernels | Double-edged | More control but WeInfer shows optimization gaps |

---

## Appendix: Sources & Citations

### Primary Sources (with dates)

1. **WebLLM Paper** (Dec 2024)
   - URL: https://arxiv.org/abs/2412.15803
   - Claims: 80% native performance
   - Accessed: Dec 2025

2. **WeInfer Paper** (April 2025)
   - URL: https://dl.acm.org/doi/10.1145/3696410.3714553
   - OpenReview: https://openreview.net/forum?id=Qu2itILaoZ
   - Claims: 3.76x speedup over WebLLM v0.2.46
   - Conference: ACM Web Conference 2025

3. **WebGPU Buffer Bugs Analysis** (2024)
   - URL: https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca
   - Key insight: 35% user compatibility issues, 128-993MB buffer limits

4. **ONNX Runtime Large Models** (Dec 2025)
   - URL: https://onnxruntime.ai/docs/tutorials/web/large-models.html
   - GitHub Issue: https://github.com/microsoft/onnxruntime/issues/13006
   - Key insight: 4GB WASM hard limit, WASM64 planned

5. **Google MediaPipe 7B Blog** (2024)
   - URL: https://research.google/blog/unlocking-7b-language-models-in-your-browser-a-deep-dive-with-google-ai-edges-mediapipe/
   - Key insight: Custom workarounds for 2GB ArrayBuffer limit

6. **Transformers.js v3 Blog** (Oct 2024)
   - URL: https://huggingface.co/blog/transformersjs-v3
   - Key insight: WebGPU support, 155 architectures, 1.4M users

7. **JSNation 2025 Talk** (2025)
   - URL: https://gitnation.com/contents/transformersjs-state-of-the-art-machine-learning-for-the-web
   - Key insight: Current Transformers.js scale and roadmap

8. **NVIDIA MoE Blog** (2025)
   - URL: https://blogs.nvidia.com/blog/mixture-of-experts-frontier-models/
   - Key insight: "Nearly all leading frontier models use MoE designs"

9. **Red Hat vLLM + DeepSeek** (Sept 2025)
   - URL: https://developers.redhat.com/articles/2025/09/08/scaling-deepseek-and-sparse-moe-models-vllm-llm-d
   - Key insight: Server-side MoE support in vLLM

10. **TVM Auto Optimization** (Oct 2018)
    - URL: https://tvm.apache.org/2018/10/03/auto-opt-all
    - Key insight: Comparable to hand-optimized kernels

11. **Modular on AI Compilers** (2024)
    - URL: https://www.modular.com/blog/democratizing-ai-compute-part-6-what-about-ai-compilers
    - Key insight: TVM/XLA as second-gen approach to hand-written kernels

### GitHub Repositories

| Repository | Stars | Last Checked |
|------------|-------|--------------|
| [WebLLM](https://github.com/mlc-ai/web-llm) | 16.9k | Dec 2025 |
| [Transformers.js](https://github.com/huggingface/transformers.js) | n/a | Dec 2025 |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) | n/a | Dec 2025 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | n/a | Dec 2025 |

### Additional Resources

- AI in Browser with WebGPU Guide: https://aicompetence.org/ai-in-browser-with-webgpu/
- WebLLM Model List: https://github.com/mlc-ai/web-llm/issues/683 (Dec 2025)
- TVM Mobile GPU Optimization: https://tvm.apache.org/2018/01/16/opt-mali-gpu (Jan 2018)
- MediaPipe Web Guide: https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js (Dec 2025)

---

*Last updated: December 2025*
