# Complete standalone attachment comparison

Component: public standalone Doppler compatibility session. Intent: preserved.

The corrected application-policy replay completes both exact ordered-message cases using diagnostic archive `7449618b1e3cf2b96ec18a2f30aa14ddf56c787ce9b871e535df7a9b107b367a`, inside the unchanged 1,420,000,000-byte allocation ceiling and 8192 context. It peaks at 1,218,394,732 bytes after the first case and 1,221,939,272 bytes after the follow-up. Opening uses 1,039,274,320 bytes, including 100,663,296 attention KV bytes: the hybrid allocation repair saves exactly 301,989,888 bytes against the preceding diagnostic's opening.

Both outputs exactly match the retained mesh answer:

> Based on the provided text: Tickets cost **$12** each. There are no additional fees.

Neither computes the requested $36/$48 totals or supplies the requested citation. This is a failed answer-quality result despite successful execution. Distribution is not necessary to reproduce the defect; this does not by itself distinguish conversion from runtime arithmetic or qualify the original source model. The original wrong assistant message remains in the follow-up input. `allocation-v3-session-policy-result.json` retains 127/166 prompt IDs and all 22 output IDs per case, including EOS, for independent attribution.

## Diagnostic configuration correction

The original `replay.mjs` and its extent/v2/initial-v3 derivatives placed the two prefill chunk fields under `runtimeConfig.inference`, while both actual Reploid hosts place them under `runtimeConfig.inference.session`. The runtime reads the latter. Consequently those earlier prefill rejections are **not valid comparisons of application prefill policy** and do not establish that the application working set requires a larger budget. They remain retained, including `allocation-v3-result.json` and its process log. The independent missing-RoPE-extent, unused-local-table, compatible-buffer-reuse, and unused-hybrid-KV regressions remain valid on their own scopes.

`allocation-v3-session-policy-replay.mjs` corrects this nesting and asserts the actual public `advanced.getResolvedRuntimeSession().runtime.session` values against the existing application policy before generation: `prefillChunkLayers=1`, `prefillTokenChunkSize=256`, `maxSeqLen=8192`. It records those observed values. No prompt, token budget, sampling policy, allocation ceiling, or runtime archive changes between the initial-v3 and corrected-policy runs.

## Identities and settlement

The outside-checkout consumer is `/var/tmp/reploid-attachment-allocation-v3-20261012` on x128, Node22.22.1, webgpu0.4.0/Vulkan. The archive was built with ordinary `npm pack --ignore-scripts`, applying the exact `940dc2a2` allocation diff to the earlier allocation-only archive. Its complete accepted-base comparison and patch are in Doppler `artifacts/rope-session-extent-20261012/accepted-allocation-v3-binding.json` and `accepted-allocation-v3-runtime.patch`, committed as `7adfa446`. Ten existing shipped files change and one declaration is added; all other accepted bytes remain identical. There are no numerical shader candidates. The source package correction is `940dc2a2`; no accepted Reploid pin changed.

A recursive byte comparison of all 1,898 installed Doppler files against the extracted exact archive passed. The Linux provider binary remains `fbfe599055b469963e4c9bfc900a702843db962dcaba0799b3c81ae33fa43db1`. The corrected process closed its session, awaited the actual candidate queue, destroyed its candidate pool/device, restored owned provider globals, and exited naturally with status0. GPU ownership was explicitly released. Unrelated participants remained untouched.

Acceptance evidence: both v3 receipts/process logs, corrected replay, and actual Verification Worker result (one nesting warning, zero errors; identical `.mjs` bytes analyzed under a `.js` virtual name). Syntax checking passes. Boundary effects: diagnostic input placement and retained evidence only; no deployment or package promotion.
