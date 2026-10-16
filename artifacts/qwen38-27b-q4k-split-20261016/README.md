# Qwen3.8-27B Q4K partition diagnostic — 2026-10-16

Native execution evidence, not a public split release. The exact retained Q4K
model executes across M3 Metal (embeddings and layer 0) and AMD Vulkan (layers
1–63 and output head). All 55 selected tokens match the whole-model control.
The frozen cross-host numerical gate remains open: step 1 has maximum absolute
logit error 0.0010237693786621094 against a 0.001 limit; the other 54 pass.
No threshold was changed after observing outputs.

| Control | Result |
| --- | --- |
| Whole AMD versus two local AMD stages | 55/55 tokens and all logits bit-identical |
| Mac → AMD | 55/55 tokens; 54/55 logit vectors within 0.001 |
| Retirement | Active, retained-model and deferred pool bytes return to zero; reusable buffers remain until pool/device destruction |
| Public Reploid split conversation | Not exercised or deployed |

## Identity and conditions

Manifest SHA256: `19ecff3e4ab9e7c1191e271f4a6e94f10a8a102206dcda9413bed728c33c271d`.
This is the 16,994,352,128-byte artifact, with a Q4 output head, not the larger
26.8 GB candidate. Weight payloads by stage are 2,759,168,448 and 14,235,183,680
bytes. Observed resident-weight buffers are 2,759,312,128 and 14,242,434,304 bytes.
Cross-host tracked device-buffer peaks were 2,767,148,384 and 14,512,049,744 bytes;
these are application buffer counters, not physical host memory measurements.

The [identity audit](identity-audit.json) freshly checks 256 model files (254
shards and two assets) and 1,956 runtime files against the retained qualification
inventory. Initial controls checked the manifest but did not hash every shard on
read. Subsequent boundary traces enabled shard verification, and their first two
handoff byte hashes match the original controls on each device.

The five-token prompt is `The capital of France is`, IDs
`[760, 6511, 314, 9338, 369]`; greedy generation produces 55 tokens. Context is
configured at 4096, without a chat template. This short diagnostic does not
qualify long context, varied prompts, quality retention, or concurrency. The
public whole-model Q4K, 0.8B and 2B providers stayed active: no isolated performance
or superiority claim is made. Full logit readback and private SSH JSON transport
are included in diagnostic elapsed times; these are not production chat latency.

## First differing boundary

[Boundary comparison](boundary-comparison.json) uses the captured five-token
prefill plus one decode token (11751) and independent F64 equations over the same
15 retained layer-0 tensors. Embeddings and normalized inputs match between GPUs.
The first captured difference is Q4 QKV prefill projection, maximum
Mac-versus-AMD error 1.9073486328125e-5. Layer-0 outputs differ by at most
1.9073486328125e-6 at prefill and 9.5367431640625e-7 at decode; their largest
errors versus F64 are 2.78940645870307e-6 and 4.279211927027404e-6 respectively.
This localizes an observed difference; it does not establish a defective unpacker,
the precise rounding mechanism, or a correction for later amplification.

The fused path's `post_attn` probe observes the attention update before residual
addition. The comparison explicitly maps that probe to F64 `post_oproj` rather
than pretending it observes the residual sum. Final `post_ffn` compares the full
layer output. No production arithmetic was changed.

## Reproduction and retained failures

Fixtures live in `tests/fixtures/qwen-partition-*`. CLI forms, with explicit
site-specific paths and native WebGPU provider configuration:

```sh
node tests/fixtures/qwen-partition-control.js CONFIG CONTRACT NEW_OUTPUT_DIR
node tests/fixtures/qwen-partition-cross-host.js CROSS_CONFIG NEW_OUTPUT_DIR
node tests/fixtures/qwen-partition-boundary-trace.js CONFIG INPUT NEW_OUTPUT_DIR
python3 tests/fixtures/qwen-partition-boundary-reference.py REFERENCE_CONTRACT INPUT MODEL_DIR REFERENCE_TOOLS NEW_OUTPUT_DIR
```

`amd-control-config.json`, `mac-trace-config.json`, `cross-host-config.json` and
`boundary-input.json` preserve run settings. The cross-host config redacts the
private SSH address to `amd-host`; its retained receipt hashes the original config,
not this redacted copy. Boundary F64 dependencies and hashes
are in `boundary-cpu-1/reference.json`; its equations/reader belong to Doppler's
retained Q4 qualification, not an independently requantized checkpoint.

Full whole-model logit vectors are retained on AMD at
`/home/x/.local/share/reploid/evidence/qwen38-27b-q4k-split-20261016/capitals55-whole.json`,
SHA256 `a12724c5caf53ec1d64c1b096308acd5ef4c520e77977a4fd5e8aeb3f6015286`.
Cross-host per-step error metrics and token IDs are retained; its full logit
vectors were not saved. Recomputing those metrics requires another bounded run.
Raw layer-0 arrays are included here.

Failures retained: missing explicit repetition window before GPU startup; a
controller process-exit race after the first whole control; and a cross-host
controller name-shadowing failure before GPU startup. Both controller defects
were corrected before the successful controls. Eight physical GPU process starts
consumed the frozen process cap, including failed attempts and boundary traces.
No further physical run was launched under this contract.

`executed-fixture-sha256.json` records the sources used for physical evidence.
Afterward, controllers were hardened so cleanup failure makes the overall verdict
false, and a failed retirement still attempts worker closure. A CPU-only injected
retirement failure verified a failing verdict and closure of both workers after
successful numerical comparison. Four JavaScript syntax checks, Python compilation,
and trace-to-original handoff SHA comparisons pass. No numerical requalification
is claimed for this subsequent harness-only change.

The owned model-file server and SSH tunnel were stopped. Final observation:
public 27B Q4K PID 482901, 0.8B PID 2963679 and 2B PID 2967869 remain active;
device-wide GTT usage is 22,113,550,336 bytes. No public service needed restoration.

Component: verification evidence. Intent: preserved. Boundary effects: test-only
diagnostic orchestration; no production API, arithmetic, UI or deployment change.
