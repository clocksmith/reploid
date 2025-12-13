# Dreamer: Competitive Landscape & Technical Context

> Last updated: December 2025

## TL;DR

Dreamer is a browser-native LLM inference engine using hand-written WebGPU (WGSL) kernels. Key differentiators:

1. **Flash Attention in WGSL** - No other browser framework implements tiled Flash Attention directly in WGSL
2. **GPU-native MoE routing** - Full mixture-of-experts on GPU with fused softmax+topk (as of Dec 2025)
3. **60GB model support (theoretical)** - Tiered memory system for unified memory architectures
4. **Native Bridge** - mmap access to local files, bypassing OPFS limits

**Caveat:** Performance benchmarks pending. Claims need validation against WebLLM baseline.

---

## Dreamer Roadmap: Beat Every Competitor

**Goal:** By end of 2025, Dreamer should demonstrably outperform all browser LLM frameworks.

### 1. Beat WeInfer (3.76x over WebLLM)

WeInfer's techniques are framework-agnostic. Dreamer must implement them first.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **1.1** Audit current buffer lifecycle in `buffer-pool.js` | P0 | TODO | `gpu/buffer-pool.js` |
| **1.2** Implement buffer reuse strategy (avoid create/destroy per inference) | P0 | TODO | `gpu/buffer-pool.js` |
| **1.3** Implement async pipeline: decouple resource prep from GPU dispatch | P0 | TODO | `inference/pipeline.js` |
| **1.4** Implement deferred result fetching (lazy GPU→CPU readback) | P0 | TODO | `inference/pipeline.js` |
| **1.5** Benchmark decode tok/s vs WebLLM on Llama-3.2-3B | P0 | TODO | `tests/` |
| **1.6** Benchmark decode tok/s vs WeInfer paper numbers (if code released) | P1 | BLOCKED | — |
| **1.7** Profile GPU timeline to identify remaining bottlenecks | P1 | TODO | — |

**Success metric:** ≥4x decode speedup over WebLLM (beating WeInfer's 3.76x)

---

### 2. Beat ONNX WASM64 (When It Ships)

ONNX's 4GB limit will eventually be lifted. Dreamer must stay ahead.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **2.1** Validate 8GB model load via Native Bridge (mmap) | P0 | TODO | `bridge/`, `storage/` |
| **2.2** Validate 16GB model load on Apple Silicon unified memory | P0 | TODO | `memory/capability.js` |
| **2.3** Validate 40GB+ model load (theoretical 60GB claim) | P1 | TODO | — |
| **2.4** Benchmark Native Bridge vs OPFS load times | P1 | TODO | `storage/` |
| **2.5** Document memory tier auto-detection | P2 | TODO | `memory/capability.js` |
| **2.6** Track ONNX WASM64 progress monthly | P2 | TODO | — |

**Success metric:** Validated 40GB+ model running in browser before ONNX ships WASM64

---

### 3. Beat WebLLM Model Coverage (50+ variants)

WebLLM has extensive model catalog with VRAM requirements documented.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **3.1** Create model compatibility matrix (what works today) | P0 | TODO | `docs/` |
| **3.2** Test Llama-3.2-1B-Instruct E2E | P0 | TODO | `tests/` |
| **3.3** Test Llama-3.2-3B-Instruct E2E | P0 | TODO | `tests/` |
| **3.4** Test Llama-3.1-8B-Instruct E2E | P0 | TODO | `tests/` |
| **3.5** Test Qwen2.5-Coder-7B E2E | P1 | TODO | `tests/` |
| **3.6** Test Phi-3.5-mini-instruct E2E | P1 | TODO | `tests/` |
| **3.7** Test Gemma-2-2B E2E | P1 | TODO | `tests/` |
| **3.8** Test Mistral-7B-Instruct E2E | P1 | TODO | `tests/` |
| **3.9** Add GGUF import for any HuggingFace model | P1 | PARTIAL | `tools/gguf-parser.js` |
| **3.10** Create automated model test suite (CI) | P2 | TODO | `tests/` |
| **3.11** Document VRAM requirements per model | P2 | TODO | `docs/` |

**Success metric:** 20+ models tested E2E with documented VRAM requirements

---

### 4. Beat WebLLM/MediaPipe MoE Support (They Have None)

Dreamer has MoE kernels. Now prove they work.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **4.1** Convert Mixtral-8x7B-Instruct to RDRR format | P0 | TODO | `tools/convert-cli.js` |
| **4.2** Run Mixtral-8x7B-Instruct E2E (expert swapping) | P0 | TODO | `inference/pipeline.js` |
| **4.3** Benchmark MoE decode tok/s | P0 | TODO | `tests/` |
| **4.4** Test DeepSeek-MoE-16B (different routing) | P1 | TODO | — |
| **4.5** Verify `topk.wgsl` correctness vs CPU reference | P1 | TODO | `tests/` |
| **4.6** Verify `scatter_add.wgsl` correctness vs CPU reference | P1 | TODO | `tests/` |
| **4.7** Profile expert dispatch latency | P2 | TODO | — |
| **4.8** Implement expert caching for memory-constrained devices | P2 | TODO | `inference/` |

**Success metric:** Mixtral-8x7B running in browser with published benchmarks

---

### 5. Beat MediaPipe Multimodal (Gemma-3n Image+Audio)

MediaPipe supports image and audio input. Dreamer is text-only.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **5.1** Research vision encoder architectures (ViT, SigLIP) | P2 | TODO | — |
| **5.2** Implement image preprocessing pipeline (resize, normalize) | P2 | TODO | `inference/` |
| **5.3** Add vision encoder WGSL kernels (patch embed, attention) | P2 | TODO | `gpu/kernels/` |
| **5.4** Test LLaVA or similar vision-language model | P3 | TODO | — |
| **5.5** Research audio encoder (Whisper-style) | P3 | TODO | — |
| **5.6** Add audio preprocessing (mel spectrogram) | P3 | TODO | — |

**Success metric:** One vision-language model (e.g., Phi-3.5-vision) running E2E

---

### 6. Performance Validation (Prove All Claims)

No claim is valid without benchmarks.

| Action Item | Priority | Status | File(s) |
|-------------|----------|--------|---------|
| **6.1** Create standardized benchmark harness | P0 | TODO | `tests/benchmark/` |
| **6.2** Measure prefill tok/s (vary sequence length) | P0 | TODO | — |
| **6.3** Measure decode tok/s (single token generation) | P0 | TODO | — |
| **6.4** Measure time-to-first-token (TTFT) | P0 | TODO | — |
| **6.5** Measure peak VRAM usage | P0 | TODO | — |
| **6.6** Test on Apple M1/M2/M3 (unified memory) | P1 | TODO | — |
| **6.7** Test on NVIDIA RTX 3080/4090 (discrete GPU) | P1 | TODO | — |
| **6.8** Test on Chrome, Safari, Firefox | P1 | TODO | — |
| **6.9** Publish benchmark results in README | P1 | TODO | `README.md` |
| **6.10** Compare vs WebLLM on identical hardware/model | P0 | TODO | — |

**Success metric:** Published benchmarks showing Dreamer ≥ WebLLM on all metrics

---

### Priority Summary

| Priority | Count | Focus |
|----------|-------|-------|
| **P0** | 18 | Must ship - core competitive advantage |
| **P1** | 12 | Should ship - strengthens position |
| **P2** | 6 | Nice to have - future-proofing |
| **P3** | 2 | Stretch - multimodal expansion |

### Recommended Order of Attack

```
Phase 1: Prove What Exists
├── 6.1-6.5  Benchmark harness + baseline metrics
├── 3.2-3.4  Test 3 core models E2E (Llama family)
└── 4.1-4.3  Mixtral MoE demo

Phase 2: Beat WeInfer
├── 1.1-1.4  Buffer reuse + async pipeline
├── 1.5      Benchmark vs WebLLM
└── 1.7      Profile and optimize

Phase 3: Validate Scale
├── 2.1-2.3  Large model validation (8GB→40GB)
└── 3.5-3.8  Expand model coverage

Phase 4: Expand
├── 5.1-5.4  Vision-language support
└── 4.4-4.8  Advanced MoE models
```

---

## Browser LLM Frameworks (Dec 2025)

| Framework | Compiler | Max Model | MoE | Flash Attn | Maturity | Community |
|-----------|----------|-----------|-----|------------|----------|-----------|
| **[WebLLM](https://github.com/mlc-ai/web-llm)** | TVM/MLC | ~31GB VRAM | No | Via TVM | Production | 16.9k stars |
| **[Transformers.js](https://huggingface.co/docs/transformers.js)** | ONNX Runtime | **4GB hard** | No | No | Production | 1.4M monthly users |
| **[MediaPipe LLM](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js)** | TFLite | ~27GB | No | Unknown | Production | Google-backed |
| **[WeInfer](https://dl.acm.org/doi/10.1145/3696410.3714553)** | Custom | ~8GB | Unknown | Unknown | Research | Academic |
| **Dreamer** | None (raw WGSL) | Claims 60GB | **Yes (GPU-native)** | **Yes (custom)** | Prototype | — |

**Key gap (Dec 2025):** No browser framework currently supports full MoE models (Mixtral 8x7B, DeepSeek-V3) in-browser.

### WebLLM (MLC-AI)

The incumbent. Uses Apache TVM compiler for optimized WebGPU kernels.

> "Evaluations show that WebLLM can retain up to 80% native performance on the same device, with room to further close the gap."
> — [WebLLM Paper, arXiv 2412.15803](https://arxiv.org/abs/2412.15803), Dec 2024

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

**No MoE support** - Mixtral/DeepSeek-V3 not in model catalog

### WeInfer (ACM Web Conference 2025) — CRITICAL THREAT

Academic research showing significant improvements over WebLLM. **If open-sourced, could leapfrog both WebLLM and Dreamer.**

> "Evaluations across 9 different LLMs and 5 heterogeneous devices show that WeInfer delivers substantial improvements in decoding speed, achieving up to a 3.76x performance boost compared with WebLLM."
> — [ACM WWW 2025](https://dl.acm.org/doi/10.1145/3696410.3714553), April 2025

**Performance claims:**
- 3.76x faster decode vs WebLLM v0.2.46
- Tested: 9 LLMs, 5 devices (RTX 4090, Apple M2, Windows GPUs)
- Baseline: WebLLM v0.2.46 (Dec 2024)

**Key innovations (directly applicable to Dreamer):**

| Technique | Description | Dreamer Status |
|-----------|-------------|----------------|
| **Buffer Reuse** | Optimized WebGPU buffer lifecycle management | Partial (buffer-pool.js) |
| **Async Pipeline** | Decouples resource prep from GPU execution | Not implemented |
| **Deferred Result Fetching** | Parallelized computation with lazy readback | Not implemented |

**Threat assessment:**
- Paper published April 2025, no public repository yet (as of Dec 2025)
- Techniques are framework-agnostic — could be adopted by WebLLM
- Dreamer should implement similar buffer pooling and async dispatch
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
> — [ONNX Runtime Docs](https://onnxruntime.ai/docs/tutorials/web/large-models.html), Dec 2025

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
> — [Google AI Blog](https://research.google/blog/unlocking-7b-language-models-in-your-browser-a-deep-dive-with-google-ai-edges-mediapipe/), 2024

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
> — [WebGPU Bugs Article](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)

| Browser | Buffer Limit | Notes |
|---------|--------------|-------|
| Chrome | ~128MB | Often lower than reported |
| Safari (iPhone) | 256MB | Metal backend |
| Safari (iPad Pro) | 993MB | Better but still limited |
| Firefox | Varies | WebGPU in v141+ |

### Practical Model Sizes

> "Currently, models in the 1-8 billion parameter range are most practical with quantization. Larger models may run on powerful devices, but memory and latency make them less user-friendly in browser environments."
> — [AI Competence Guide](https://aicompetence.org/ai-in-browser-with-webgpu/)

| Model Size | VRAM Required | Browser Feasibility |
|------------|---------------|---------------------|
| 1-3B (INT4) | 1-2GB | Good |
| 7-8B (INT4) | 4-6GB | Marginal |
| 13B+ | 8GB+ | Challenging |
| MoE (Mixtral 8x7B) | 90GB | Requires expert swapping |

### The 35% Compatibility Problem

> "WebGPU's promise of democratizing AI through browser-based LLM inference remains tantalizingly close yet frustratingly unattainable due to implementation bugs and ecosystem fragmentation. While WebLLM demonstrates that browser-based inference can achieve 80% of native performance, the 20% performance gap combined with compatibility issues affecting 35% of users, memory limitations preventing large model deployment, and platform-specific bugs requiring extensive workarounds creates an environment where production deployment remains impractical for most use cases."
> — [Medium Analysis](https://medium.com/@marcelo.emmerich/webgpu-bugs-are-holding-back-the-browser-ai-revolution-27d5f8c1dfca)

---

## MoE Support Comparison (Dec 2025)

**Dreamer's key differentiator:** Only browser framework with GPU-native MoE routing.

| Framework | MoE Status | Models | Implementation |
|-----------|------------|--------|----------------|
| **Dreamer** | **Yes (GPU-native)** | Any (theoretical) | Custom WGSL topk + scatter_add |
| **WebLLM** | No | — | No MoE models in catalog |
| **Transformers.js** | No | — | 4GB limit blocks Mixtral |
| **MediaPipe** | No | — | Dense models only |
| **vLLM (server)** | Yes | DeepSeek-V3, Mixtral, Qwen3 | CUDA/FlashInfer |

### Why MoE Matters

> "Since early 2025, nearly all leading frontier models use MoE designs."
> — [NVIDIA MoE Blog](https://blogs.nvidia.com/blog/mixture-of-experts-frontier-models/), 2025

Top MoE models (server-side only as of Dec 2025):
- DeepSeek-V3 (671B params, 37B active)
- Mixtral 8x7B (46.7B params, 12.9B active)
- Qwen3 MoE variants
- Llama 4 Scout (109B params)

Source: [Red Hat vLLM+DeepSeek](https://developers.redhat.com/articles/2025/09/08/scaling-deepseek-and-sparse-moe-models-vllm-llm-d), Sept 2025

### Dreamer MoE Validation Needed

- [ ] Run actual MoE model (e.g., Mixtral-instruct) end-to-end
- [ ] Benchmark expert swapping latency
- [ ] Compare vs hypothetical WebLLM MoE (if added)

---

## TVM Compilation vs Hand-Written WGSL

### TVM Approach (WebLLM)

Apache TVM uses machine learning to auto-tune kernel configurations.

> "With an expressive code generator and an efficient search algorithm, we are able to generate kernels that are comparable to heavily hand-optimized ones."
> — [TVM Blog](https://tvm.apache.org/2018/10/03/auto-opt-all)

**Advantages:**
- Auto-tuning finds optimal tile sizes per device
- Cross-platform compilation
- Less manual optimization work

> "When compared against NCNN, a widely used hand-optimized kernel library that makes extensive use of NEON assembly instructions (with 13k lines of code for only 3x3 convolution layers), TVM outperforms it for all networks on Raspberry Pi 3B."
> — [TVM Mobile Optimization](https://tvm.apache.org/2018/01/16/opt-mali-gpu)

**Disadvantages:**
- Black box - harder to debug
- Some ops poorly optimized:

> "The scatter_nd op was reported to be almost 1000x slower than a naive hand-written CUDA implementation in one case."
> — [TVM Discussion](https://www.mail-archive.com/dev@tvm.apache.org/msg03451.html)

- Requires compilation step to add new models

### Hand-Written WGSL Approach (Dreamer)

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
> — [Modular Blog](https://www.modular.com/blog/democratizing-ai-compute-part-6-what-about-ai-compilers)

Dreamer intentionally takes the "first-generation" approach for WebGPU, betting that hand-tuned WGSL can outperform TVM-compiled kernels in the browser environment.

---

## Dreamer Technical Differentiators

### 1. Multi-Tier Flash Attention in WGSL

Dreamer implements **multi-tier Flash Attention** with automatic kernel selection based on device capabilities and model architecture:

| Tier | Kernel | headDim | Shared Memory | Use Case |
|------|--------|---------|---------------|----------|
| Large | `attention.wgsl` | <= 64 | 48KB | Standard models (Llama, Mistral) |
| Small | `attention_small.wgsl` | <= 256 | 8KB | Large heads (Gemma 3, custom) |
| Streaming | `attention_streaming.wgsl` | Any | None | Fallback for constrained devices |

```javascript
// Automatic tier selection in kernel-selector.js
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

Shell script bridge (`bridge/native/dreamer-bridge.sh`) enables mmap access to local model files, bypassing OPFS limits.

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
> — [ONNX Runtime Docs](https://onnxruntime.ai/docs/tutorials/web/large-models.html), Dec 2025

**Planned Solutions:**
1. **WASM64** - 64-bit addressing would remove 4GB cap
2. **Direct GPU Weight Loading** - Bypass WASM entirely for weights

**Impact on Dreamer:**
If either solution ships, Transformers.js (1.4M monthly users) instantly gains large model support, eliminating Dreamer's size advantage.

**Track:** [GitHub Issue #13006](https://github.com/microsoft/onnxruntime/issues/13006)

---

## Competitive Threat Timeline

| Threat | Likelihood | Timeframe | Impact on Dreamer |
|--------|------------|-----------|-------------------|
| WeInfer open-source release | Medium | 2025 H1-H2 | **High** - buffer/async techniques applicable to all |
| ONNX WASM64 | Low | 2025-2026 | **High** - removes 4GB limit for Transformers.js |
| WebLLM adds MoE support | Medium | 2025 | **Medium** - TVM can compile MoE architectures |
| Chrome built-in AI (`window.ai`) | Medium | 2025-2026 | **High** - native APIs could obsolete frameworks |
| MediaPipe model expansion | High | Ongoing | Low - still Google-model focused |
| FlashInfer WebGPU port | Low | 2026+ | **High** - would match Dreamer's attention perf |

### Defensive Priorities

1. **Urgent:** Validate performance vs WebLLM baseline
2. **High:** Implement WeInfer-style buffer pooling + async dispatch
3. **High:** Ship working MoE demo (Mixtral or similar)
4. **Medium:** Document Native Bridge advantages over OPFS
5. **Medium:** Track ONNX WASM64 progress

### Dreamer's Defensible Moats

| Differentiator | Threat Level | Notes |
|----------------|--------------|-------|
| Flash Attention in WGSL | Safe (2025) | No competitor has this in browser |
| GPU-native MoE | Safe (2025) | No browser framework runs MoE on GPU |
| 60GB unified memory | Untested | If validated, unique advantage |
| Native Bridge (mmap) | Unique | No competitor offers local file access |
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
| [Transformers.js](https://github.com/huggingface/transformers.js) | — | Dec 2025 |
| [MediaPipe](https://github.com/google-ai-edge/mediapipe) | — | Dec 2025 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | — | Dec 2025 |

### Additional Resources

- AI in Browser with WebGPU Guide: https://aicompetence.org/ai-in-browser-with-webgpu/
- WebLLM Model List: https://github.com/mlc-ai/web-llm/issues/683 (Dec 2025)
- TVM Mobile GPU Optimization: https://tvm.apache.org/2018/01/16/opt-mali-gpu (Jan 2018)
- MediaPipe Web Guide: https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js (Dec 2025)
