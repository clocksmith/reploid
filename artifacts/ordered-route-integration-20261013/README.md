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

The `peer.mjs` variant composes the actual existing ordered peer ports and duplex binary channel with those facades and Doppler residents. Each logical participant receives its own generated identity; real v4 grants bind the coordinator-mediated path. The channels are in-process EventTargets with ordered cloned delivery, not WebRTC or separate authenticated machines. This exercises real message authorization, framing, checksums, pending output matching, receiver ordering, reservations, and settlement. It does not establish network behavior, GPU execution, canonical publication, capacity, or model usefulness.

`peer-final-result.json` passes four controls: altered grant rejection before numerical dispatch, incremental three-stage output, actual-output follow-up history delivery to the synthetic tokenizer, and cancellation with an independent survivor. It records 29 injected numerical calls, 11 private states each closed once, no unsettled reservations or retained tensor bytes, and matching sent/received channel byte counters. Only the middle stage sends reverse binary tensors; the final stage returns token control results. `peer-source-binding.json` records the exact exercised subset, including any concurrent runner source distinct from HEAD; before/after source hashes matched.

`peer-initial-result.json` and `peer-result.json` retain two harness failures. The first inherited an in-process error-text assertion although the bounded transport returns its declared generic cancellation error. The corrected check requires an explicitly aborted signal, a cancelled runner receipt with confirmed settlement, and successful survivor output. The second incorrectly expected reverse requests from the final stage; its actual token-only result needs none. No production correction or numerical/result transformation was made for these harness failures.

```sh
node artifacts/ordered-route-integration-20261013/peer.mjs /absolute/path/to/doppler /new/peer-report.json
```

`entry.mjs` extends that source composition through the actual `createPartitionEntry`, `createPartitionChat`, and explicit ordered `createPartitionRequester` APIs. The requester owns no tokenizer or numerical port: original ordered messages reach the coordinator's real resident facade, with its numerical/tokenizer substitutions unchanged. Entry permission decisions use an explicit local test policy; stage authorization uses the actual v4 signing and verification owner. Channels remain in-process, so this is not physical authentication or deployed discovery acceptance.

`entry-initial-result.json` retains the first direct-entry pass. `entry-final-result.json` adds the public requester helper; `entry-stable-result.json` repeats after the route-contract export change; `entry-snapshot-result.json` repeats after the final requester observer-snapshot repair. The latter passes five controls: changed route rejected before tokenization, incremental three-stage response, exact actual-output follow-up history, public requester selection with attempt-bound streaming callbacks, and cancelled request alongside a surviving conversation. There are 38 injected numerical calls and 14 private states each closed once. Peer retained tensor bytes, reservations, runner debt, and tokenizer-opening debt are all zero after confirmed settlement. All ten cleanup owners fulfill.

Independent review found the public retry helper still emitted A/B requests for ordered selections and read caller messages after asynchronous selection. The production owner repaired route selection, early history snapshots, and origin-bound streaming, then hardened observer callbacks against route mutation. This artifact uses those real repairs; it does not reshape failed requests to bypass the public APIs. Existing owner tests cover retry to a changed route and callback/input mutation. No claim is made for model quality, full physical mesh, GPU computation, canonical publication, installed package, or deployment.

```sh
node artifacts/ordered-route-integration-20261013/entry.mjs /absolute/path/to/doppler /new/entry-report.json
```

`entry-committed-result.json` is the final repeat after the committed chat approval-expiry guard. All five controls still pass. `entry-source-binding.json` verifies every named source file against committed Reploid `60da0eb2` (including native `33fa5b90`) and the recorded Doppler revision. Earlier passing runs remain historical snapshots, not claims about unexecuted later source.
