# JSON-configured native Qwen partition checks

All three checks passed through the installed Doppler 0.6.36 package,
`readNativeModelConfiguration`, `openNativePartition`, Reploid residents and the
ordinary ordered route runner. They ran serially on one AMD Radeon 8060S device
with Vulkan. Every stage read verified pieces from its exact pinned artifact.
The stage boundaries passed through Doppler's serializer and Reploid's runner;
the transport port copied those frames locally. There was no peer network.

| Model | Cuts | Stages | Compared rows | Result |
| --- | --- | --- | --- | --- |
| Qwen 3.8 27B Q4K | 32 | 2 | Prefill + 2 decode | Exact logit hashes and tokens |
| Qwen 3.6 35B A3B source Q4_0 | 10, 20, 30 | 4 | Prefill + 2 decode | Exact logit hashes and tokens |
| Qwen 3.8 Flash-Next Q4K, explicit F32 KV candidate | 16, 32 | 3 | Prefill + 2 decode | Exact logit hashes and tokens |

The controls are the
[whole-model versus split AMD checks](https://github.com/clocksmith/doppler/tree/main/reports/ordered-qwen-partitions-20261109).
Each successful native row matches all 248,320 values by its SHA-256, not merely
the selected token. All test-owned residents and the provider were closed without
reported cleanup failures; every acquisition owner reported zero active read
bytes at the end. These are same-device component checks, not an independent
correctness reference, a throughput result, or remote authorization evidence.

## Integration repair

The runner originally compared the boundary shape to `plan.hiddenSize`, the
embedding width. Flash-Next carries four residual streams, so its declared
boundary is 10,240 values rather than 2,560. A focused route test first failed
with `Ordered activation shape or allocation mismatch`; the runner now uses
Doppler's `tensorContract.hiddenSize`. It preserves all streams rather than
dropping or reducing them. The final native Flash-Next check exercises this
repaired runner with learned weights.

## Artifact integrity

Flash-Next's native piece index was prepared by Doppler's existing
`tools/build-verified-piece-index.js`, with a maximum piece size of 1,048,576
bytes. It rehashed all 185,482,224,544 shard bytes against the manifest, plus the
tokenizer, and produced 196,710 pieces across 1,244 files. Its 34,421,212-byte
index is bound as:

```
sha256:9d575c50a2b4e60809698792b72982059d65bcc553ef82ddcf7c59065d131f49
```

The manifest remains
`sha256:4902a0b730a9310903b00bc0f8f587528fa1af9f37a722d2f9287bafceceec09`.
No weights were copied, converted, or changed. Existing 27B and 35B piece indexes
were used unchanged. Per-stage summaries retain index identity, verified bytes,
piece/range counts and hashed inventories. Full receipts remain on the operator's
qualification volume; their exact byte hashes are in each retained summary.
Large logits, allocation-label lists and per-piece arrays are not duplicated here.

## Reproduction

The native source delivery was prepared from `e356f9e12` with the runner repair
in `f973020f3`. `receipt.json` identifies the installed archive, retained
summaries and harness. The final harness is
[native-ordered-model-physical.js](../../../tests/fixtures/native-ordered-model-physical.js).
Use the private JSON format in [native participant configuration](../../../docs/native-participant.md#model-and-split-json).

For each model, build a complete model descriptor with its exact source metadata,
the matching Doppler control's `generation` and `runtimeConfig`, and the cuts above.
Remove any previous `partitionPlan`/`partitionPlanId` before supplying a new request.
The test used explicit 32 GiB process budgets to hold all stages on the same
device. Those are test process ceilings, not recommended allocations for several
separate contributors or proof that their combined budgets fit a machine.

Configure an absolute JSON file with:

```json
{
  "schema": "reploid.native-ordered-physical/v1",
  "modelConfig": "/operator/model.json",
  "modelDirectory": "/models/exact-artifact",
  "reference": "/evidence/matching-doppler-result.json",
  "output": "/evidence/native-result.json",
  "webgpuModule": "/installed/node_modules/webgpu/index.js",
  "limits": {
    "maxTokens": 4,
    "maxPromptTokens": 48,
    "maxActivationBytes": 8388608,
    "maxOutputCharacters": 1024,
    "maxAttempts": 4,
    "maxConcurrentAttempts": 2,
    "maxStages": 4,
    "stageTimeoutMs": 300000
  }
}
```

```sh
REPLOID_NATIVE_ORDERED_CONFIG=/absolute/check.json \
  node tests/fixtures/native-ordered-model-physical.js
```

The harness checks exact manifest, plan, generation and runtime configuration
against the retained control before starting the GPU. Its authorization port
belongs to the offline test owner; it does not test authenticated remote grants.

## Remaining gates

No claim here qualifies multiple physical GPUs, peer loss, dynamic placement
under real load, signed N-stage opening, or public model release. Idle stage
assignment and new-request route choice exist; active conversations do not
migrate to different cuts. Flash-Next's independent long-context numerical gate
remains open, and public partition approvals were not changed. The public 27B
provider and local Flash-Next service were left active; no GPU kernel limit was
changed. The separate context-reuse rollout has its own deployment receipt.

Component: `server`, `packages/reploid/src/mesh/partitions`, tests.
Intent: preserved. Acceptance evidence: retained native receipts; 62 focused
route/peer/grant tests; earlier JSON, placement, type, layer and delivery checks.
Boundary effects: private operator model/split configuration and correct
multi-stream route framing; no public promotion or deployment from this lane.
