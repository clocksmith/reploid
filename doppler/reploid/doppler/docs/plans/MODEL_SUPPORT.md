# Model Support Matrix

**Part of:** [VISION.md](../VISION.md) - Tracking model compatibility across phases

---

## Status Legend

| Status | Meaning |
|--------|---------|
| **Working** | E2E inference verified |
| **Partial** | Loads but has issues |
| **Planned** | Architecture supported, not tested |
| **Blocked** | Missing kernel or feature |

---

## Hardware Compatibility

| Vendor | Device | WebGPU | Status | Notes |
|--------|--------|--------|--------|-------|
| **Apple** | M3 (Apple Silicon) | Metal | **Working** | Primary dev target, Gemma 1B verified |
| Apple | M1/M2 (Apple Silicon) | Metal | Untested | Should work (same Metal backend) |
| AMD | Strix Halo | Vulkan | Untested | Needs testing |
| AMD | RDNA 2/3 (desktop) | Vulkan | Untested | Needs testing |
| NVIDIA | RTX 30xx/40xx | Vulkan | Untested | Needs testing |
| Intel | Arc | Vulkan | Untested | Needs testing |
| Intel | Integrated (UHD) | Vulkan | Untested | May lack VRAM |

### Hardware-Specific Concerns

| Issue | Affected | Notes |
|-------|----------|-------|
| Unified memory | Apple Silicon | Advantage: GPU/CPU share RAM |
| VRAM limits | Discrete GPUs | Must fit model in dedicated VRAM |
| Vulkan vs Metal | Non-Apple | Different shader compilation paths |
| F16 support | Older GPUs | May need F32 fallback |
| Workgroup limits | All | WGSL kernels tuned for 256 threads |

### Testing New Hardware

```bash
# Check WebGPU adapter info
npx tsx tools/gpu-info.ts

# Run smoke test
npx tsx tests/test-runner.ts gemma --direct --headed
```

Report results by updating this matrix.

---

## Dense Models

| Model | Params | Quant | VRAM | Status | Tested On | Notes |
|-------|--------|-------|------|--------|-----------|-------|
| **Gemma 3 1B** | 1B | Q4_K_M | ~1GB | **Working** | Apple M3 | Dec 2025: SiLU fix applied |
| Gemma 3 4B | 4B | Q4_K_M | ~3GB | Planned | - | Same arch as 1B |
| Llama 3.2 1B | 1B | Q4_K_M | ~1GB | Planned | - | Standard Llama |
| Llama 3.2 3B | 3B | Q4_K_M | ~2GB | Planned | - | Standard Llama |
| Llama 3.1 8B | 8B | Q4_K_M | ~5GB | Planned | - | Needs unified mem test |
| Mistral 7B | 7B | Q4_K_M | ~5GB | Planned | - | Standard Llama-like |

---

## MoE Models

| Model | Params | Active | Quant | VRAM | Status | Tested On | Notes |
|-------|--------|--------|-------|------|--------|-----------|-------|
| Mixtral 8x7B | 46.7B | 12.9B | Q4_K_M | ~24GB | Planned | - | Phase 2 target |
| **GPT-OSS 20B** | 20B | ~5B | MXFP4 | ~8GB | Partial | Apple M3 | Router works, experts loading |

---

## Architecture Support

| Feature | Status | Models Affected |
|---------|--------|-----------------|
| Standard attention | Working | All dense |
| GQA (Grouped Query) | Working | Llama 3, Gemma |
| Sliding window attention | Working | Mistral, GPT-OSS |
| RoPE standard | Working | Llama, Mistral |
| RoPE high theta (1M) | Working | Gemma 3 |
| RoPE YARN scaling | Working | GPT-OSS |
| RMSNorm | Working | All |
| SwiGLU activation | Working | All (fixed Dec 2025) |
| MoE routing (softmax+topk) | Working | Mixtral, GPT-OSS |
| MoE scatter-add | Working | Mixtral, GPT-OSS |
| Q4_K_M dequant | Working | Most models |
| MXFP4 dequant | Working | GPT-OSS |
| BF16 embeddings | Working | All |

---

## Quantization Support

| Format | Status | Notes |
|--------|--------|-------|
| **Q4_K_M** | Working | llama.cpp compatible |
| **MXFP4** | Working | GPT-OSS mixed-precision |
| **BF16** | Working | Embeddings, norms |
| Q8_0 | Planned | Higher precision option |
| F16 | Working | Intermediate activations |
| F32 | Working | Fallback |

---

## VRAM Requirements

| Model | Weights | KV Cache (4K ctx) | Total |
|-------|---------|-------------------|-------|
| Gemma 3 1B | ~0.8GB | ~0.1GB | ~1GB |
| Gemma 3 4B | ~2.5GB | ~0.3GB | ~3GB |
| Llama 3.2 3B | ~1.8GB | ~0.2GB | ~2GB |
| Llama 3.1 8B | ~4.5GB | ~0.5GB | ~5GB |
| Mistral 7B | ~4GB | ~0.5GB | ~5GB |
| Mixtral 8x7B (all experts) | ~26GB | ~0.5GB | ~27GB |
| Mixtral 8x7B (2 experts) | ~6GB | ~0.5GB | ~7GB |
| GPT-OSS 20B (4 experts) | ~8GB | ~0.3GB | ~8GB |

---

## Test Commands

```bash
# Run specific model test
npx tsx tests/test-runner.ts gemma --direct --headed

# Run with debug output
DEBUG=1 npx tsx tests/test-runner.ts gemma --direct --headed
```

---

## Known Issues

| Model | Issue | Status | Workaround |
|-------|-------|--------|------------|
| ~~Gemma 1B~~ | ~~SiLU gate ignored~~ | **Fixed** | ~~N/A~~ |
| GPT-OSS 20B | Expert loading slow | Open | Needs paging |
| All large | VRAM overflow | Open | Phase 3 (tiered memory) |
| All | Non-Apple untested | Open | Need community testing |

### Hardware Testing Priority

1. **AMD Strix Halo** - Important for gaming laptops with strong iGPU
2. **NVIDIA RTX 40xx** - Most common discrete GPU
3. **AMD RDNA 3** - Desktop GPU alternative
4. **Intel Arc** - Growing market share

---

## Conversion

Models are converted to RDRR format using:

```bash
npx tsx tools/convert-cli.ts \
  --input ~/models/model-name/ \
  --output ./models/model-name-q4/ \
  --quantize q4_k_m
```

See [RDRR_FORMAT.md](../spec/RDRR_FORMAT.md) for format details.

---

## Adding New Models

1. Check architecture support table above
2. Convert to RDRR with `convert-cli.ts`
3. Run E2E test: `npx tsx tests/test-runner.ts <model> --direct --headed`
4. If issues, check [DOPPLER-TROUBLESHOOTING.md](../DOPPLER-TROUBLESHOOTING.md)
5. Update this matrix with results

---

*Last updated: December 2025*
