# Kernel Validation TODO

> Status: Complete | Started: Dec 2025

## Phase 1: Workspace Setup ✅

- [x] `package.json` - workspace config with vitest + playwright
- [x] `vitest.config.js` - unit test config
- [x] `playwright.config.js` - GPU test config with WebGPU flags
- [x] `browser/index.html` - test runner page
- [x] `browser/test-page.js` - GPU test initialization

## Phase 2: Test Harness ✅

- [x] `src/harness/tolerance.js` - FP comparison utilities
- [x] `src/harness/buffer-utils.js` - GPU buffer helpers
- [x] `src/harness/benchmark.js` - timing harness
- [x] `src/harness/index.js` - exports

## Phase 3: Reference Implementations ✅

Priority (newly implemented MoE kernels):
- [x] `src/reference/topk.js` - top-k selection
- [x] `src/reference/scatter-add.js` - weighted scatter-add

Core kernels:
- [x] `src/reference/matmul.js` - matrix multiplication
- [x] `src/reference/softmax.js` - online softmax
- [x] `src/reference/attention.js` - multi-head attention

Remaining:
- [x] `src/reference/rmsnorm.js`
- [x] `src/reference/rope.js`
- [x] `src/reference/silu.js`
- [x] `src/reference/gather.js`
- [x] `src/reference/residual.js`
- [x] `src/reference/moe-gather.js`
- [x] `src/reference/dequant.js`
- [x] `src/reference/index.js` - exports

## Phase 4: Correctness Tests ✅

Priority:
- [x] `tests/correctness/setup.js` - test utilities
- [x] `tests/correctness/topk.spec.js`
- [x] `tests/correctness/scatter-add.spec.js`
- [x] `tests/correctness/matmul.spec.js`

Remaining:
- [x] `tests/correctness/softmax.spec.js`
- [x] `tests/correctness/attention.spec.js`
- [x] `tests/correctness/rmsnorm.spec.js`
- [x] `tests/correctness/rope.spec.js`
- [x] `tests/correctness/silu.spec.js`
- [x] `tests/correctness/gather.spec.js`
- [x] `tests/correctness/residual.spec.js`
- [x] `tests/correctness/moe-gather.spec.js`
- [x] `tests/correctness/dequant.spec.js`

## Phase 5: Benchmarks ✅

- [x] `tests/benchmarks/config.js` - workload configs (Llama/Mixtral sizes)
- [x] `tests/benchmarks/matmul.bench.js`
- [x] `tests/benchmarks/moe-pipeline.bench.js` - end-to-end MoE routing
- [x] `tests/benchmarks/all-kernels.bench.js` - summary benchmark

## Phase 6: Integration ✅

- [x] Wire up `browser/test-page.js` to actual GPU kernels
- [x] Expose `window.testHarness` for Playwright tests
- [x] Create `BENCHMARKS.md` with baseline documentation

## Phase 7: CI (Optional)

- [ ] GitHub Actions workflow
- [ ] CI report script

---

## Running Tests

```bash
# Install dependencies
cd dreamer/kernel-tests
npm install

# Run all tests (unit + GPU)
npm test

# Run GPU tests only (requires Chrome with WebGPU)
npm run test:gpu

# Run GPU tests in headed mode (see browser)
npm run test:gpu:headed

# Run benchmarks
npm run bench

# Serve test page for manual testing
npm run serve
# Then open http://localhost:8080 in Chrome
```

## Test Configuration

The tests use Playwright with Chrome/Chromium with WebGPU flags:
- `--enable-unsafe-webgpu` - Enable WebGPU API
- `--enable-features=Vulkan` - Use Vulkan backend (better performance)

For CI, consider using SwiftShader for software rendering.

## Kernel Tolerances

| Kernel | Tolerance | Notes |
|--------|-----------|-------|
| matmul_f32 | rtol=1e-5 | Standard FP32 |
| matmul_f16 | rtol=1e-2 | FP16 has ~3 decimal digits |
| softmax | rtol=1e-5 | Numerically stable |
| topk indices | exact | Must match exactly |
| topk weights | rtol=1e-5 | After renormalization |
| scatter_add | rtol=1e-5 | Weighted sum |
| rmsnorm | rtol=1e-4 | Reduction tolerance |
| attention | rtol=1e-3 | Multiple reductions |
| dequant | rtol=1e-4 | Quantization error |

## Progress Log

### Dec 2025
- Created workspace structure
- Completed Phase 1: Workspace setup (package.json, vitest, playwright configs)
- Completed Phase 2: Test harness (tolerance, buffer-utils, benchmark)
- Completed Phase 3: All 12 reference implementations
- Completed Phase 4: All 12 correctness test files
- Completed Phase 5: Benchmark suite with model configs
- Completed Phase 6: Test harness integration with GPU kernels
