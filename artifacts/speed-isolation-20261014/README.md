# Where standalone speed goes in the partition path (2026-10-14)

**Question (ROADMAP, immediate performance question).** The retained browser receipt records
68.11 decode tokens/s for this model. The installed placement-B journey takes about 2.5 s per
token. This run compares four steps on one GPU, with matched inputs:

1. ordinary Doppler execution;
2. the whole model as one resident stage with the Capsule's paired profile;
3. three local partitions;
4. remote partitions.

It records where the time goes at each step.

**Setup.**
- **GPU:** `amd-host` (Radeon 8060S, RDNA3, RADV), the GPU named in the 68 tokens/s receipt.
- **Runtime:** the installed final-9 Doppler 0.6.28 package (runtime archive `2df37d88...`) on
  Node v22 with the `webgpu` 0.4.0 Dawn module, the same stack the native stages run.
- **Weights:** all modes use the same 18 Q4_K weight shards. The ordinary modes load Doppler's
  published ordinary manifest (`18fe30e2...`) over those shards; the run checks that both
  manifests list identical shard hashes. The paired modes load the Capsule manifest
  (`6b2cb026...`) with the TargetPlan's runtime configuration (two-F32 paired arithmetic,
  16-token prefill chunks).
- **Prompts:** the two answer-cause turns, 56 and 189 prompt tokens.
- **Decoding:** greedy (argmax or the Capsule sampler), up to 128 tokens, stopping at EOS in the
  paired modes.
- **Repeats:** one process per mode, each run twice; the tables use the second (warm) run. Both
  runs are in `amd-host/out/`.
- **Bounds and load:** each run used a bounded systemd scope. The public contributor on the host
  kept running at 90-130% of a CPU throughout, so these are matched controls, not an exclusive
  benchmark. The amdgpu error count stayed at 50.

[speed-ladder.mjs](speed-ladder.mjs) runs every mode, and [amd-host/run2.sh](amd-host/run2.sh)
drives the runs. The profile modes were added to the same file after the timing runs; the
timing modes' code did not change.

## Results (warm runs)

| Step | Mode | Prompt, 56 tokens | Prompt, 189 tokens | Decode per token, 56-token turn |
|---|---|---|---|---|
| 1 | Ordinary, `generateTokens` (manifest decode loop: 4 tokens per submit, readback every 8) | 0.29 s | 0.38 s | 22.4 ms mean (44.6 tokens/s) |
| 1 | Ordinary, one `decodeStepLogits` per token (logits read back every token) | 0.29 s | 0.33 s | 28.4 ms median |
| 2 | Paired, whole model in one stage | 17.3 s | 58.1 s | 600 ms median (189-token turn: 728 ms) |
| 3 | Paired, three local stages in one process (route-driven, frames serialized and validated) | 17.3 s | 58.2 s | 625 ms median: stages 193 / 182 / 244 ms; frames under 1 ms |
| 4 | Remote, placement B ([run 7](../signed-completion-journey-20261013/README.md); `mac-host`, `intel-host`, `amd-host`) | Intel stage about 1.0-1.1 s per prompt token | n/a | about 2.5 s: Mac 0.40, Intel 1.66-1.68, AMD 0.43-0.45 s |

Decode profile, GPU timestamps through Doppler's profiling recorder, 16 steps after the
56-token prompt:

| Kernel family | Ordinary, ms per step | Paired, ms per step |
|---|---|---|
| Recurrent gated delta | 1.74 | 132.78 |
| Matrix multiplies (incl. fused FFN) | 5.55 | 115.82 |
| Attention | 0.28 | 93.48 |
| Linear-attention prepare | (in other kernels) | 42.23 |
| RMSNorm | 0.51 | 36.13 |
| Pointwise | 0.11 | 19.94 |
| Convolution | 0.16 | 12.12 |
| **GPU total** | **8.4** | **453.6** |
| Wall time of the profiled step (median) | 36.3 | 577.4 |

## Findings

1. **The paired execution profile is where the speed goes.** On the same GPU and weights, a
   paired decode token takes 600 ms against 28.4 ms for ordinary per-token execution (21x).
   Prompt processing is about 60x slower: 17.3 s against 0.29 s for 56 tokens. The paired step
   is GPU-bound: 454 ms of its 577 ms profiled wall time is kernel time.
2. **Four paired kernel families take 85% of that GPU time:** the recurrent gated delta,
   matrix multiplies, attention and linear-attention prepare.
   - **Matrix multiplies (21x) match the arithmetic cost.** The paired matmul measurement
     (Doppler `artifacts/paired-matmul-prefill-cost-20261014`) found compensated arithmetic is
     88-93% of that kernel.
   - **Attention (330x), RMSNorm (70x) and the recurrent kernel (76x) are far beyond the
     arithmetic cost.** That points at how those kernels are parallelized, which still needs
     checking against their dispatch shapes, not at the arithmetic alone.
3. **Batching, readback and local partitioning cost little.**
   - Reading logits back every token instead of batching costs about 6 ms per token.
   - Splitting into three local stages adds 4%, with activation frames under 1 ms.
   - About 120 ms of each paired step is outside GPU kernels: submission, synchronization and
     readback. The cause is not isolated here.
4. **Remote placement B multiplies the paired cost by placing layers on slow devices.**
   - The same eight layers that take 182 ms per token on AMD take 1.66 s on Intel.
   - Placement B is about 4x the AMD-only paired route.
   - The AMD stage takes 0.43-0.45 s per token remotely against 244 ms locally. Transfer,
     waiting and publication are not separated in run 7's timing.

## What this leaves

These are ranked by the time they account for. Each one changes runtime or placement and needs
its applicable qualification.

- **Paired kernel efficiency (Doppler):** attention, RMSNorm, the recurrent gated delta and
  linear-attention prepare, then the matmul. Changing the reduction structure can change the
  rounding of paired results, so a repaired kernel must requalify against the frozen reference
  (55 prefixes, 0.001).
- **Whether Launch 1 must run the paired profile at all** is a numerical-contract decision for
  the owner. The ordinary f32 profile runs the same weights 21x faster per token. The paired
  profile exists for agreement with the frozen reference.
- **Placement (Reploid, Launch 3 ranking):** routes without the Intel stage. On this
  measurement, an AMD-only paired route is about 4x faster per token than placement B.
- **The roughly 120 ms per step outside GPU kernels** in the paired path.

**Not shown:**
- browser-surface numbers (all runs here are Node/Dawn);
- the 68 tokens/s receipt's batch-8 throughput profile;
- a matched remote run on one GPU type;
- per-dispatch shapes of the slow paired kernels.

`amd-host/failed-attempts/` keeps the two failed first launches:
- the model-file check required the piece index, which loading does not read;
- the ordinary modes first loaded the Capsule manifest, which declares paired attention and
  cannot run without the paired runtime configuration.
