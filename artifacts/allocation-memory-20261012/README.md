# Original long-prompt allocation and lifecycle control

This checks the original 494/1,588-token workload against the allocation-only
diagnostic archive. The accepted application pin is unchanged. It is a
two-physical-browser runtime control with Node forwarding tensors and verified
local HTTP model storage, not signed mesh acquisition or numerical qualification.

## Frozen inputs and implementation

- Doppler archive: `7449618b1e3cf2b96ec18a2f30aa14ddf56c787ce9b871e535df7a9b107b367a`.
- Accepted parent archive: `9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
- Allocation changes: Doppler `eb306577`, `e953eb74`, `e7026002`, `940dc2a2`.
  The [archive binding](https://github.com/clocksmith/doppler/blob/main/artifacts/rope-session-extent-20261012/accepted-allocation-v3-binding.json)
  lists every changed shipped file. No numerical shader candidate is included.
- Original request SHA: `794960332f164cb2506cc25b3d3adbde2492bf7aad120f300dd0149294c0d19e`.
- Unmodified controller: `tests/fixtures/browser-partition-memory-completion.js`,
  SHA `6053a0eccc6fb54a728b7a0e7856ca85b400960a38d1f0cdffd2eb5225624c98`.
- Both hosts' 1,898 installed package files match exactly; compressed inventories
  are retained here. Harness/config hashes and hardware observations are separate.
- Fixed cap: **1,420,000,000 allocated GPU-buffer bytes per executor**;
  context 8,192; public session prefill chunks one layer / 256 tokens.
  This is allocation accounting, not process RAM or physical GPU residency.
- Generation is the existing application policy: maximum 4,096 output tokens,
  temperature zero, topK one, topP one, repetition penalty 1.1. The receipt also
  retains the original request's earlier generation settings explicitly.

## Execution and reproduction

The unchanged fixture ran from isolated delivery directory
`/var/tmp/reploid-memory-allocation-v3-20261012` on Mac and Linux. Each served the
same extracted archive at `/vendor/doppler/0.6.27/`, existing configuration at
`/config/`, and hash-verified model artifacts from the existing model server.
Only that isolated `doppler-package.json` points to `file:archive.tgz`.

Environment shared by both controller invocations:

```sh
export REPLOID_DIAGNOSTIC_REQUESTS="$PWD/tests/fixtures/distributed-memory-requests.json"
export REPLOID_EXECUTOR_WS='<owned Linux Playwright launch-server websocket>'
export REPLOID_E2E_BASE_URL=http://127.0.0.1:28780
export REPLOID_MODEL_BASE_URL=http://127.0.0.1:28781/
export REPLOID_PEER_MODEL_BASE_URL=http://127.0.0.1:28781/

REPLOID_MEMORY_PHASE=repetition REPLOID_CAPTURE_OUT="$PWD/memory-repetition.json" \
  node tests/fixtures/browser-partition-memory-completion.js
REPLOID_MEMORY_PHASE=cancellation REPLOID_REFERENCE_REVERSE=1 \
  REPLOID_CAPTURE_OUT="$PWD/memory-cancellation-reverse.json" \
  node tests/fixtures/browser-partition-memory-completion.js
```

The first phase keeps Mac layers 0–11 and AMD layers 12–23 resident through three
complete attempts. The second phase reverses placement, cancels during the first
prefill submission, rejects an allocation above the unchanged budget on both
devices, then completes the original 1,588-token request using those same weights.
Weights are opened once per phase, not once per attempt.

`summary.json` reports final outcomes and peaks. Raw JSON contains every retained
prefill snapshot and monotonic device peaks through decode. Closing residents
must settle retained model owners, active resources and deferred cleanup to zero;
reusable pool buffers may remain cached until browser closure. No pool destruction
is used to manufacture resident settlement.

Both controllers exited zero. The 494-token request completed after 1,348 output
steps; all three complete 1,588-token attempts reached EOS after 1,627 steps and
produced byte-identical text. The reverse cancelled attempt stopped before its
first output, and both allocation guards returned `RESOURCE_EXHAUSTED` before
the subsequent successful request. No WebGPU validation errors were retained.

| Placement | Mac peak allocated bytes | AMD peak allocated bytes |
|---|---:|---:|
| Mac input / AMD output, serial repetition | 809,459,080 | 446,967,976 |
| AMD input / Mac output, cancellation then reuse | 395,753,096 | 761,521,208 |

Weights remained unchanged across attempts in each phase. After resident close,
both devices had zero weight bytes and zero retained-model, active and deferred
resource owners. Owned test browsers, servers and the 28782 tunnel were closed;
`shutdown.json` records their disposition. Existing application sessions and the
unrelated public contributor were left running.

These controls do not exercise simultaneous long attempts, native Node execution,
signed opening, requester weight isolation, source-model usefulness or the
approved 0.001 numerical comparison. Prior failures remain in
`artifacts/attachment-standalone-20261012/` and historical memory evidence in
`artifacts/recovery-20261009/`; this result does not rewrite their dispositions.
