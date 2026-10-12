# AMD attachment replay after allocation repairs

Component: public standalone Doppler compatibility session. Intent: preserved.

Diagnostic archive `7ede3796905df580c1c39b7112ddeb6d6853ef7f86d620ac07f76d0d54e8b7d7` starts from accepted `9280ead5` and incorporates canonical allocation repairs `eb306577`, `e953eb74`, and `e7026002`. The numerical owner's exact six-file comparison is `doppler/artifacts/rope-session-extent-20261012/accepted-allocation-v2-binding.json`. No numerical shader candidate or accepted-pin change is included.

The exact 127-token first attachment prompt still fails before producing an answer, now at `matmul_output_1048576`: 1,048,576 requested with 1,419,176,824 live against the unchanged 1,420,000,000-byte ceiling. Context remains 8192 and the entire frozen input/generation policy remains unchanged. No output tokens exist; the second case was not reached. This is not source-model or distributed numerical evidence.

At rejection, public telemetry records 1,016,495,872 pool bytes, 442 active and two pooled buffers. Device categories are 402,653,200 attention bytes, 4,718,592 recurrent bytes and 1,011,805,032 other bytes. These do not expose reusable or deferred bytes independently, and cannot alone establish the minimum necessary working set. The previous rejection remains retained separately. The canonical pool reuse regression is fixed, but this complete prefill remains unqualified.

The outside-checkout consumer is `/var/tmp/reploid-attachment-allocation-v2-20261012` on x128, with Node22.22.1 and webgpu0.4.0/Vulkan. Install the archive and provider as for `extent-README.md`, then run `node allocation-v2-replay.mjs`. All 1,897 installed Doppler files match the archive; `allocation-v2-installed-identity.json` also binds the Linux provider binary. The process closed the session, awaited the candidate queue, destroyed its pool and actual device, restored provider globals, and exited naturally with status1. AMD ownership was explicitly released. Unrelated processes were untouched.

Acceptance evidence: `allocation-v2-result.json`, `allocation-v2-process.log`, installed identity, and actual Worker result. Worker analyzes the identical `.mjs` bytes using a `.js` virtual filename (one nesting warning, no errors). Syntax checking passes. Boundary effects: diagnostic consumer and retained evidence only; no deployment. The replay source was auto-committed unchanged by the concurrent workspace sync as Reploid `fe8dc44b`; this receipt preserves that identity rather than rewriting its history.
