# DOPPLER

**D**istributed **O**n-device **P**ipeline **P**rocessing **L**arge **E**mbedded [**R**eploid](../README.md) (**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference [**D**oppler](README.md) (... ∞))

Browser-native LLM inference engine powered by WebGPU.

**[Try it live at replo.id/d](https://replo.id/d)**

## Features

- **WebGPU acceleration** - Custom WGSL kernels for attention, FFN, RMSNorm
- **Quantized models** - Q4_K_M and MXFP4 for efficient VRAM usage
- **Streaming inference** - Token-by-token generation with KV cache
- **RDRR format** - Sharded weights, on-demand loading from OPFS or remote
- **MoE support** - GPU-native expert routing with lazy expert loading

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Demo UI                          │
├─────────────────────────────────────────────────────┤
│             DOPPLER Inference Pipeline              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Tokenize │→│ Forward  │→│ Sample   │→ tokens    │
│  └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────┤
│              GPU Kernels (WebGPU)                   │
│  MatMul │ RMSNorm │ RoPE │ Attention │ SiLU        │
├─────────────────────────────────────────────────────┤
│           Memory / Buffer Management                │
├─────────────────────────────────────────────────────┤
│  Storage (OPFS)  │  RDRR Loader  │  Tokenizer      │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm start           # Dev server at :8080/d
doppler bench inference --headed  # Run benchmarks
```

## Model Support

| Architecture | Examples | Status |
|-------------|----------|--------|
| Gemma | Gemma 3 1B, 4B | Full support |
| LLaMA | LLaMA 2/3, Mistral | Full support |
| Mixtral | Mixtral 8x7B | MoE support |
| GPT-OSS | GPT-OSS 20B MoE | Experimental |

## P2P Evolution (Planned)

Weight shards use CDN (HuggingFace). P2P is for **dynamic components** that benefit from decentralized evolution:

| Component | Size | P2P Value |
|-----------|------|-----------|
| **LoRA adapters** | 50-200MB | Fine-tuned personalities, domain experts |
| **Router weights** | ~1MB | Learned MoE routing, hierarchical gating |
| **WGSL kernels** | ~5KB each | Device-specific optimizations |
| **Sampling strategies** | ~10KB | Novel decoding algorithms |

```
┌─────────────────────────────────────────────────────┐
│                  DOPPLER Swarm                      │
├─────────────────────────────────────────────────────┤
│  Peer A              Peer B              Peer C     │
│  ├─ LoRA: writer    ├─ LoRA: coder      ├─ LoRA: ? │
│  ├─ Router v2       ├─ Router v3        │          │
│  └─ Kernel: M3 Max  └─ Kernel: RTX 4090 │          │
│                                                     │
│  ◄──── LoRA/kernel/router exchange ────►           │
│  └────── swarm gossip: who has what ──────┘        │
└─────────────────────────────────────────────────────┘
```

See [P2P Roadmap](docs/roadmap/PHASE_4_P2P.md) and [Competitive Analysis](docs/analysis/COMPETITIVE.md#p2p-and-evolution-potential) for details.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Inference Pipeline](inference/README.md) - Kernel graphs and execution flow
- [RDRR Format](docs/spec/RDRR_FORMAT.md) - Model packaging specification
- [Competitive Analysis](docs/analysis/COMPETITIVE.md) - Landscape and differentiators

## Requirements

- WebGPU browser (Chrome 113+, Edge 113+, Firefox Nightly)
- GPU with 4GB+ VRAM for 7B models

## Related

- [REPLOID](../README.md) - Agent sandbox ([replo.id/r](https://replo.id/r))
- [Main README](../../../README.md) - Full project documentation
