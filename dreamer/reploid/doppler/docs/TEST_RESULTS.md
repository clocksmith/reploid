# WebGPU Inference Test Results

Shared testing log for Gemma 3 1B and other DOPPLER models across different hardware configurations.

## Test Sessions

### Session 2025-12-14: AMD Strix Halo + Gemma 3 1B

**Tester**: Linux AMD machine
**GPU**: AMD Strix Halo integrated GPU (Radeon 8050S/8060S Graphics)
**Browser**: Google Chrome 142.0.7444.162
**OS**: Linux 6.17.0-7-generic
**Model**: Gemma 3 1B IT (Q4_K_M quantization)

#### Status: IN PROGRESS

**Steps completed**:
1. ✓ Located Gemma 3 1B model in HuggingFace cache
2. ✓ Converting to RDRR format (Q4_K_M quantization)
3. ⏳ Awaiting conversion completion
4. ⏳ Browser testing pending
5. ⏳ Results pending

**Model path**:
- Source: `/home/clocksmith/.cache/huggingface/hub/models--google--gemma-3-1b-it/snapshots/dcc83ea841ab6100d6b47a070329e1ba4cf78752`
- RDRR output: `dreamer/reploid/doppler/models/gemma-3-1b-q4/`

**Conversion command**:
```bash
node tools/convert-cli.js \
  --input /home/clocksmith/.cache/huggingface/hub/models--google--gemma-3-1b-it/snapshots/dcc83ea841ab6100d6b47a070329e1ba4cf78752 \
  --output models/gemma-3-1b-q4 \
  --quantize q4_k_m
```

**Expected model size**: ~1.2GB (340 tensors, 26 layers, 1152 hidden size)

#### Next steps:
1. Complete RDRR conversion
2. Run E2E test via Playwright: `npx playwright test doppler/tests/gemma-e2e.spec.js --headed`
3. Collect WebGPU adapter info from browser console
4. Test prompt: "the sky is"
5. Verify coherent token generation (not `<unused16>` garbage)
6. Record performance metrics (tok/s)

---

### Session 2025-12-14: Mac M3 + GPT-OSS 20B (parallel session)

**Tester**: MacBook with M3
**GPU**: Apple M3 (unified memory)
**Model**: GPT-OSS 20B MoE (Q4_K_M, 32 experts, topK=4)
**Status**: PARTIAL - MoE pipeline functional, output quality under investigation

**MoE Bug Fixed**:
- Root cause: WebGPU `layout: 'auto'` only includes bindings used by each entry point
- `count_and_map` used 4/6 bindings, `gather_tokens` used 6/6
- Bind group creation with mismatched layout caused silent failure
- Fix: Created explicit bind group layout with all 6 bindings
- See: `docs/MOE-EXPLICIT-LAYOUT-POSTMORTEM.md`

**Current Output (needs investigation)**:
```
Prompt: "the color of the sky is"
Top-5 tokens: ".hk"(5.9%), "_ASC"(2.9%), "adaptive"(2.7%), "ÅĤÄħ"(2.2%), "Hayden"(1.9%)
```
Output tokens are incoherent - ROOT CAUSE IDENTIFIED:
- Router weight (`mlp.router.weight`) is stored as Q4_K_M in manifest
- HuggingFace config says `modules_to_not_convert: ["model.layers.*.mlp.router"]`
- Q4_K_M quantization on router causes extreme logits (56 vs -39 range)
- Softmax collapses to single expert (weights 1.0, 0.0, 0.0, 0.0)

**Fix required**: Reconvert model keeping router weights in F16/F32 precision

**Test command**: `node tests/test-gptoss.js`

**Files modified**:
- `gpu/kernel-selector.js` - Added explicit bind group layout for MoE
- `gpu/kernels/moe_gather.wgsl` - Cleaned up, added layout note

---

## Hardware Configurations Tested

| Date | GPU | VRAM | Browser | OS | Model | Status | Notes |
|------|-----|------|---------|----|----|-------|-------|
| 2025-12 | Apple M3 | Unified | Safari/Chrome | macOS | Gemma 3 1B | ✓ WORKING | Reference implementation |
| 2025-12-14 | AMD Strix Halo | Integrated | Chrome 142 | Linux | Gemma 3 1B | ⏳ TESTING | In progress |
| 2025-12-14 | Apple M3 | Unified | Chrome | macOS | GPT-OSS 20B | ⚠️ PARTIAL | MoE pipeline works, output quality poor |

## Test Protocol

### 1. Model Conversion
- Source format: GGUF or SafeTensors
- Target: RDRR with Q4_K_M quantization
- Tool: `doppler/tools/convert-cli.js`
- Verify: manifest.json created, shard files present

### 2. Browser Test (Automated)
```bash
cd dreamer/kernel-tests
npx playwright test doppler/tests/gemma-e2e.spec.js --headed
```

Expected output:
- Model loads without errors
- Generates coherent tokens for "the sky is"
- No `<unused16>` or garbage tokens
- Reasonable performance (>10 tok/s for 1B models)

### 3. Browser Test (Manual)
```bash
npx serve .
# Open http://localhost:3000/dreamer/reploid/doppler/demo/
```

Steps:
1. Select model from dropdown
2. Wait for load completion
3. Enter prompt in chat
4. Verify output quality

### 4. Collect Diagnostics

In browser console:
```javascript
const adapter = await navigator.gpu.requestAdapter();
const info = await adapter.requestAdapterInfo();
console.log('Adapter:', info);
console.log('Features:', Array.from(adapter.features));
console.log('Limits:', adapter.limits);
```

Record:
- Adapter vendor/device
- F16 support (shader-f16 feature)
- Subgroups support
- Buffer size limits

### 5. Performance Metrics

Collect if available:
- Time to first token (TTFT)
- Tokens per second (prefill)
- Tokens per second (decode)
- Peak VRAM usage

## Known Issues by Platform

### AMD GPUs
- **Driver requirements**: Mesa 23.0+ (Linux) or Adrenalin 23.0+ (Windows)
- **WebGPU status**: Generally good support in recent drivers
- **Strix Halo**: New integrated RDNA architecture, untested

### Apple Silicon
- **Unified memory advantage**: No PCIe overhead, can load larger models
- **Safari vs Chrome**: Both support WebGPU, Safari may have better integration
- **F16 support**: Excellent on M-series chips

### NVIDIA
- **Status**: Untested in DOPPLER
- **Expected**: Should work well with recent drivers
- **Driver**: 525+ required for WebGPU

## Debugging Common Issues

### Model loads but produces garbage tokens
**Symptom**: Output like `<unused16>`, random Unicode, or non-English text for English prompts

**Causes**:
1. Quantization format mismatch (Q4_K encoding issue)
2. BF16 conversion error
3. Gemma 3 norm offset not applied
4. GPU dequantization kernel bug

**Debug**:
- Check logs for "Prefill logits" top-5 distribution
- Look for negative hidden state values (should be present)
- Compare against known-working Mac M3 output

### WebGPU not available
**Symptom**: `navigator.gpu` is undefined

**Solutions**:
- Update browser (Chrome 113+, Edge 113+)
- Enable in Firefox: `about:config` → `dom.webgpu.enabled`
- Check GPU drivers are up to date

### Out of memory errors
**Symptom**: Buffer allocation fails, model won't load

**Solutions**:
- Try smaller model (Gemma 3 1B needs ~1.2GB)
- Close other GPU-intensive apps
- Check browser console for specific buffer size limits

## Contributing Results

After testing:
1. Update this file with your results
2. Update HARDWARE_COMPATIBILITY.md matrix
3. Commit and push changes
4. Share any issues or findings

---

*Last updated: 2025-12-14*
