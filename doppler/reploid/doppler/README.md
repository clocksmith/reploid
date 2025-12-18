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

## P2P Distribution (Planned)

DOPPLER's architecture enables peer-to-peer model distribution:

- **Swarm shard cache** - WebRTC mesh shares verified weight shards
- **Expert paging** - MoE experts fetched from nearest peer with inventory
- **Remote inference** - Offload prefill to faster peers in the swarm
- **Hierarchical routing** - Tier-1 gatekeeper prefetches expert clusters

```
Agent A ◄──── shard request ────► Agent B ◄──── shard request ────► Agent C
         └──────────────── mesh gossip: who has what ─────────────────┘
```

See [P2P Roadmap](docs/roadmap/PHASE_4_P2P.md) for implementation plan.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Inference Pipeline](inference/README.md) - Kernel graphs and execution flow
- [RDRR Format](docs/spec/RDRR_FORMAT.md) - Model packaging specification
- [Performance Roadmap](docs/roadmap/PHASE_1_PERFORMANCE.md) - Optimization targets

## Requirements

- WebGPU browser (Chrome 113+, Edge 113+, Firefox Nightly)
- GPU with 4GB+ VRAM for 7B models

## Related

- [REPLOID](../README.md) - Agent sandbox ([replo.id/r](https://replo.id/r))
- [Main README](../../../README.md) - Full project documentation
