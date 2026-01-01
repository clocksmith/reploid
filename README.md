# REPLOID

**R**ecursive **E**volution **P**rotocol **L**oop **O**rchestrating **I**nference **D**oppler

Browser-native recursive self-improvement—an agent that rewrites its own code and kernels in a live loop. Powered by [Doppler](https://github.com/clocksmith/doppler).

Together, a recursive co-evolution: inference powers agency, agency reshapes inference.

**[Try it live](https://replo.id/r)** | **[GitHub](https://github.com/clocksmith/reploid)**

## Why This Works

Code lives in the VFS, modules load dynamically, and the Ouroboros loop moves updates through a tiny shared contract.

| Capability | Claim |
|------------|-------|
| **VFS hot-reload** | IndexedDB-backed filesystem ([BrowserFS/Doppio](https://github.com/jvilk/BrowserFS), [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) |
| **WebGPU in-process** | 80% native performance ([WebLLM 2024](https://arxiv.org/abs/2412.15803)) |
| **Zero-install** | URL distribution ([PWA Research 2020](https://www.researchgate.net/publication/343472764_Dawning_of_Progressive_Web_Applications_PWA_Edging_Out_the_Pitfalls_of_Traditional_Mobile_Development)) |
| **Tight loop** | RSI validated by [Gödel Agent 2024](https://arxiv.org/abs/2410.04444), [RISE NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/639d992f819c2b40387d4d5170b8ffd7-Paper-Conference.pdf) |

See [GUIDE.md](GUIDE.md) for full documentation.

## Quick Start

```bash
npm install
npm run serve     # Landing page + /r (Reploid) + /d (Doppler) at :8080
npm run dev       # Full dev server with API proxies at :8000
```

## Related

- [DOPPLER](https://github.com/clocksmith/doppler) - WebGPU inference engine ([replo.id/d](https://replo.id/d))

## Inspiration

- [Recursive self-improvement](https://en.wikipedia.org/wiki/Recursive_self-improvement) - Wikipedia
- [Gato](https://arxiv.org/abs/2205.06175) - A Generalist Agent (DeepMind)
- [GEPA](https://arxiv.org/abs/2507.19457) - Reflective Prompt Evolution Can Outperform Reinforcement Learning
- [ReAct](https://arxiv.org/abs/2210.03629) - Synergizing Reasoning and Acting (ICLR 2023)
- [Absolute Zero Reasoner](https://arxiv.org/abs/2505.03335) - Self-play RL with zero data
- [SWE-agent](https://arxiv.org/abs/2405.15793) - Agent-Computer Interfaces (NeurIPS 2024)
- [Tree of Thoughts](https://arxiv.org/abs/2305.10601) - Deliberate problem solving with LLMs
- [Chain of Thought](https://arxiv.org/abs/2201.11903) - Reasoning via intermediate steps
- [Reploid](https://megaman.fandom.com/wiki/Reploid) - Mega Man X series
