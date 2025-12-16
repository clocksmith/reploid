# DOPPLER Docs Index

Quick index for DOPPLER documentation.

---

## Vision & Roadmap

**Start here:** [VISION.md](VISION.md) - Phased roadmap from performance parity to P2P self-healing agents.

| Phase | Goal | Plan |
|-------|------|------|
| 1 | Performance parity with WebLLM | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md) |
| 2 | Efficient MoE support | [OPTIMIZATION_ROADMAP.md](plans/OPTIMIZATION_ROADMAP.md#moe-performance-vs-webllm-mixtral) |
| 3 | Scale beyond WebLLM (>31GB) | [VISION.md#phase-3](VISION.md#phase-3-scale-beyond-webllm) |
| 4 | P2P self-healing agents | [P2P.md](plans/P2P.md) |

---

## Core Docs

- [Architecture](ARCHITECTURE.md) - High-level module layout and subsystem responsibilities.
- [Glossary](GLOSSARY.md) - Terms and definitions used across DOPPLER.
- [Debug Guide](DEBUG.md) - Comprehensive debugging strategies for inference issues.
- [Inference README](../inference/README.md) - Step-by-step inference flow (init, load, prefill, decode).
- [Hardware Compatibility](HARDWARE_COMPATIBILITY.md) - Browser and GPU support notes.

---

## Plans (Detailed Roadmaps)

| Plan | Scope |
|------|-------|
| [Optimization Roadmap](plans/OPTIMIZATION_ROADMAP.md) | Buffer reuse, async pipeline, command batching, MoE |
| [P2P Distribution](plans/P2P.md) | Shard distribution, expert paging, remote inference |
| [Competitive Analysis](analysis/COMPETITIVE.md) | WebLLM, WeInfer, Transformers.js comparison |

---

## Specs & Testing

- [Benchmark Harness](spec/BENCHMARK_HARNESS.md) - Standardized benchmarking spec and JSON output schema.
- [Kernel Testing](spec/KERNEL_TESTING.md) - WGSL unit tests and pipeline segment tests.
- [Kernel Tests (Implemented)](../kernel-tests/TODO.md) - Kernel correctness and microbenchmark tracking.
- [Kernel Benchmarks](../kernel-tests/BENCHMARKS.md) - Baseline expectations and benchmark notes.

---

## Results

- [Test Results](TEST_RESULTS.md) - Benchmark and validation logs by session.

---

## Postmortems

Notes and incident writeups live in `docs/postmortems/`.

*Last updated: December 2025*
