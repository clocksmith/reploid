# Ordered resident source integration

CPU-only integration of the existing Reploid ordered runner with Doppler's actual new resident `executeStage` API, using an explicitly selected Doppler checkout. This is ordinary source-level execution, not signed publication, installed-package, GPU, physical-capacity, tokenizer/model-quality or canonical-replay acceptance.

Run from Reploid:

```sh
node artifacts/ordered-route-integration-20261013/run.mjs /absolute/path/to/doppler /new/result.json
```

The tool uses the real three-stage plan, allocation and identity validation, private resident attempt/continuation lifecycle, sampler, stopping logic, incremental decoder, Reploid reservations and ordered orchestration. The host adapter maps the complete Reploid route identity to Doppler's declared attempt identity and back. It does not repair generation hashes, tensor layouts or numerical outputs. Authorization and transport are explicit local injected controls; they do not establish authenticated remote execution.

Following Doppler's `tests/inference/ordered-resident-execution.test.js`, only numerical layer execution, private GPU cache allocation, GPU readback and the kernel support assertion are substituted. Synthetic logits select tokens 3, 4, then EOS 5. A synthetic tokenizer records received ordered messages; therefore the follow-up proves exact history delivery to that boundary, not a real model's contextual reasoning. Tests assert:

- Three stages stream incremental output through the actual resident sampler/decoder, stopping naturally at EOS.
- A new attempt on the same conversation passes the actual first output in its ordered follow-up history.
- Cancelling one attempt while its middle stage is pending preserves another request, whose private continuation completes.
- All 11 allocated private states are closed exactly once, all reservation slots settle, and the runner retains no active or unknown owner.

`initial-result.json` retains the first genuine integration rejection: Reploid's length-prefixed generation hash disagreed with Doppler's canonical resolved-generation hash, before numerical dispatch. The initial receipt's explicitly named **post-failure** Reploid hash observation may include the concurrently prepared repair; it is not presented as an initial source freeze. The production owners repaired the public generation-hash boundary; this fixture did not translate around it.

`repaired-result.json` records the first passing composition. `final-result.json` adds before/after hashes for the named source subset and compact state observations: three cases passed, 29 injected numerical calls, 11 private states created and closed. These hashes identify the source subset exercised, not the complete installed package closure. All results are retained. `final-relay-result.json` repeats the checks after the coordinator-mediated disclosure update: activation paths explicitly include producer, coordinator and next stage (deduplicated), token paths name coordinator/target and output paths name final/coordinator/requester. This does not establish direct stage-to-stage network delivery or pipeline efficiency. `source-binding.json` verifies all eight named Doppler source files against pushed commit `81a5a345`. `worker.json` records actual GPU-disabled Verification Worker analysis of the artifact tooling.

The separate `tests/unit/partition-route-mutation.test.js` controls caller mutation during async plan hashing, replacement of mutable stage-port identities/methods, and nested authority immutability. It now checks Doppler's supplied generation digest rather than reproducing the rejected Reploid hash.

Component: verification evidence. Intent preserved. Boundary effects: source test adapter only; no production integration, package pin, deployment, model, or reference changes.

The subsequent `facade.mjs` control removes the test-owned identity adapter and reservation shim. It composes the actual Reploid `createResidentPartition` / `resident-route` facade with those same actual Doppler residents, and issues/verifies v4 grants with WebCrypto. `facade-result.json` retains the first three successful lifecycle controls; `facade-grants-result.json` additionally rejects a modified signature before any numerical work. All three facades reject reservation before Ready. The current run has four controls, 29 injected numerical calls and 11 private states closed once. Public keys, claims and signatures are retained; temporary signing private keys are neither written nor included in receipts.

These are **real grant signatures**, not signed execution-publication acceptance. Transport remains an in-process clone, and the tokenization/numerical/cache ports remain synthetic as above. A 64-byte synthetic weight descriptor satisfies the facade's nonempty-resident check; it is not allocated GPU memory or proof of model residency. The facade owns identity mapping and cleanup consistently, including an independent survivor after cancellation. The reviewer also found an inherited failure-path caller-mutation bug; native's source owner repaired it by using the captured identity for failed-reservation accounting and added its own regression.

Run the facade variant with the same explicit checkout/report arguments:

```sh
node artifacts/ordered-route-integration-20261013/facade.mjs /absolute/path/to/doppler /new/facade-report.json
```
