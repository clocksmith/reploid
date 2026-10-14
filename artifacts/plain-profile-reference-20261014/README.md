# Plain profile against the approved F64 reference (2026-10-14)

**Question.** Does the ordinary f32 execution profile meet Launch 1's correctness standard on its
own? The standard is the approved independent F64 reference over all 55 required prefixes, at the
unchanged 0.001 tolerance. Its weights, prompts and sampling are the same as the qualified paired
package's. The [speed isolation](../speed-isolation-20261014/README.md) measured the plain profile
at 21x faster per decode token on the same GPU.

**Setup.**
- **GPU:** `amd-host` (RDNA3).
- **Runtime:** the installed final-9 Doppler 0.6.28 package (runtime archive `2df37d88...`) on
  Node/Dawn.
- **Model:** the reference's own model identity, manifest `edeb69dd...`. It is ordinary f32
  execution with an f16 KV cache, no paired kernels, and the same 18 Q4_K shards as the Capsule.
- **Inputs:**
  - reference `approved-reference.json` (sha256 `ad26dfbc...`), checked with the same
    comparison as `tests/fixtures/ordered-partition-reference.js`;
  - the three frozen request contracts (`ba2a4668...`, `3cc051de...`, `8b21b154...`). Each
    rendered prompt equals its frozen token prefix.
- **Execution:** whole model on one machine, teacher-forced along the reference tokens.
- **Check per step:** every one of the 248,320 f32 logits must be within 0.001 of the F64 values,
  and the argmax token must equal the reference token.
- **Recording:** unlike the qualification harness, this check records every step instead of
  stopping at the first failure.
- **Scope:** a bounded systemd scope; the amdgpu error count was unchanged.
- **Script:** [plain-reference-check.mjs](plain-reference-check.mjs).

## Results

| Run | Request 0 (19 tokens, 2 steps) | Request 1 (21 tokens, 2 steps) | Request 2 (184 tokens, 51 steps) | Steps within 0.001 | Tokens equal |
|---|---|---|---|---|---|
| Plain, manifest defaults ([check-plain.json](check-plain.json)) | max 5.49e-4 | max 6.22e-4 | max 3.50e-3; 27 steps over | 28 / 55 | 55 / 55 |
| Plain with a two-F32 linear-attention recurrent state (`linearRecurrentStatePrecision: "two-f32"`, [check-recurrent-two-f32.json](check-recurrent-two-f32.json)) | max 6.70e-4 | max 5.38e-4 | max 2.88e-3; 18 steps over | 37 / 55 | 55 / 55 |
| Paired package, for comparison ([campaign 3](../completion-qualification-3-20261014/README.md)) | | | max 9.52e-7 | 55 / 55 | 55 / 55 |

**The plain profile fails the unchanged standard,** with every failure on the 184-token request.
The error is already 7.05e-4 on that request's first step, the prefill of the long prompt. It then
stays between about 6e-4 and 3.5e-3 without growing across the decode steps. Every selected token
still equals the reference token.

**Keeping only the recurrent state in two-F32 reduces the error but does not pass.** That rules
out the recurrent state as the sole cause, but not as one contributor.

## Next

The first divergent operation is not yet identified. The next step is to compare per-operator
outputs of the plain run on the 184-token prefill with an F64 forward of the same model at the
same points. Then test the narrowest correction that brings every step within 0.001 while
keeping most of the plain path's speed. If broader paired execution remains necessary, the
measured paired bottlenecks get optimized instead, under the same reference and tolerance. Any
passing configuration then needs its own qualification across placements and the installed
conversation lifecycle; it does not inherit acceptance from the paired package.
