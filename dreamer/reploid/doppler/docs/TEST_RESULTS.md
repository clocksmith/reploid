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
2. ✓ Converted to RDRR format (Q4_K_M quantization) - 965MB, 15 shards
3. ✓ Test server running on http://localhost:8080
4. ✓ Playwright test infrastructure set up (headless mode)
5. ❌ **BLOCKED**: Headless browser cannot access WebGPU (no GPU in headless environment)

**Test Limitation**: The Linux environment runs headless without X server or GPU access. WebGPU requires either:
- A headed browser with GPU drivers (X11/Wayland + working GPU)
- OR Manual testing in a desktop environment

**Model is ready** - just needs a desktop browser to test.

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

#### Manual Test Instructions:

**Server is running at: http://localhost:8080**

1. Open Chrome browser and navigate to: `http://localhost:8080/dreamer/reploid/doppler/demo/`
2. Open DevTools Console (F12)
3. Run this to check WebGPU adapter:
   ```javascript
   const adapter = await navigator.gpu.requestAdapter();
   const info = await adapter.requestAdapterInfo();
   console.log('Adapter:', info);
   console.log('Features:', Array.from(adapter.features));
   ```
4. Select "Gemma 3 1B" from model dropdown
5. Wait for model to load (watch console for progress)
6. Enter test prompt: "the sky is"
7. **Verify output**: Should generate coherent tokens like "blue", "clear", "beautiful" (NOT `<unused16>` or garbage)
8. Record performance from console logs (tokens/sec)
9. Document results below

**Expected GPU**: AMD Strix Halo (Radeon 8050S/8060S Graphics)

---

### Session 2025-12-14: Mac M3 + GPT-OSS 20B (parallel session)

**Tester**: MacBook with M3
**GPU**: Apple M3 (unified memory)
**Model**: GPT-OSS 20B MoE (Q4_K_M, 32 experts, topK=4)
**Status**: PARTIAL - Router fixed, expert loading in progress

#### Bug Fix 1: MoE Gather Kernel (FIXED)
- Root cause: WebGPU `layout: 'auto'` only includes bindings used by each entry point
- `count_and_map` used 4/6 bindings, `gather_tokens` used 6/6
- Bind group creation with mismatched layout caused silent failure
- Fix: Created explicit bind group layout with all 6 bindings
- See: `docs/MOE-EXPLICIT-LAYOUT-POSTMORTEM.md`

#### Bug Fix 2: Router Weight Quantization (FIXED)
- Root cause: Router weights quantized to Q4_K_M despite HuggingFace config `modules_to_not_convert`
- Symptom: Router logits extreme (56 vs -39), softmax collapses to [1.0, 0.0, 0.0, 0.0]
- Fix: Updated `shouldQuantize()` in quantizer.js to check:
  1. Hard-coded `router` and `gate.weight` patterns
  2. HuggingFace `modules_to_not_convert` config from quantization_config
- Reconverted model: Router weights now BF16 (184KB vs 52KB Q4_K_M)
- **Result**: Router now produces distributed weights!
  ```
  [DEBUG MoE L0] Router logits (first 8 experts): -0.14, 0.59, 0.11, 0.88, -0.98, -1.73, 2.58, -0.54
  [DEBUG MoE L0] Expert weights: [0.5896, 0.1668, 0.1359, 0.1078, ...]
  ```
  vs before: `[1.0, 0.0, 0.0, 0.0]`

#### Current Status: Expert Loading
- Router works correctly (distributed weights)
- Expert tensor loading attempted but using wrong naming convention
- GPT-OSS uses packed MXFP4 experts (`model.layers.X.mlp.experts.gate_up_proj_blocks`)
- Loader fallback exists but may need debugging

**Test command**: `node tests/test-gptoss.js`

**Files modified**:
- `gpu/kernel-selector.js` - Added explicit bind group layout for MoE
- `gpu/kernels/moe_gather.wgsl` - Cleaned up, added layout note
- `tools/quantizer.js` - Added router check in `shouldQuantize()`
- `tools/convert-cli.js` - Pass `modules_to_not_convert` to shouldQuantize

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
