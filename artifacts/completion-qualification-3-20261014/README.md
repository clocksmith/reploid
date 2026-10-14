# Campaign 3: chunked prefill (16 tokens) passes in both placements

Component: Reploid physical qualification fixtures. Intent preserved. Boundary effects: isolated
candidate and diagnostic processes only; public package, contributors, model reference and resource
limits unchanged. Machines are named `mac-host`, `amd-host` and `intel-host`.

## Why

The [phase timing run](../phase-timing-20261014/README.md) hung the Intel GPU on a 267-token prompt.
The signed Capsule chunks prefill at 256 tokens
(`programLoadPolicy.runtimeConfig.inference.session.prefillTokenChunkSize`), and a 256-row chunk ran
past i915's 7,500 ms preemption timeout on intel-host. Measured Intel cost is about 114 to 128 ms per
prompt row per layer, and no dispatch covers more than one layer, so a 16-token chunk bounds every
Intel prefill dispatch to about 2 s. The output head (about 1.1 s) does not depend on the chunk.
A changed configuration needs its applicable qualification, so this campaign requalifies archive
`2df37d88...` with `prefillTokenChunkSize: 16` (and the existing `prefillChunkLayers: 1`).

## What is unchanged

- **Inputs:** archive `2df37d88...`, manifest, execution graph, paired binding, request fixture and
  request contracts. The [freeze](freeze.js) asserts each by hash.
- **Reference and comparison:** the independent F64 reference, all 55 required prefixes and the
  0.001 tolerance.
- **Limits:** 300 s per stage, a 10 s cleanup limit and 1,420,000,000 allocated GPU bytes per
  executor.
- **Tooling:** the producer (`sha256:714cc204...`) and the evaluator (`sha256:90376dde...`).
- **Numerics:** the kernels use two-F32 compensated arithmetic with integer-based residual
  calculations.

## What changes

- **Policy:** the partition policy gets a new hash-bound copy, `<placement>/partition-policy.json`,
  with only `prefillTokenChunkSize` 256 changed to 16.
- **Expected execution identity:** the retained load-only observation, rebuilt by Doppler's
  `createInitialExecutionIdentityV2` with only that field changed. The freeze first checks that the
  unchanged rebuild reproduces the observed identity exactly. The live harness then requires every
  prepared stage to match the new identity before any token executes, so the chunk is proven live,
  not just configured.
- **Chunks exercised:** the three requests carry 19, 21 and 184 prompt tokens. Under chunk 256 none
  was split. Under chunk 16 they split into 2, 2 and 12 chunks on every stage.
- **Placements**, each with its own freeze, expectations, capture and reports:
  - **A:** mac-host browser stage 0, then amd-host native stage 1, then intel-host native stage 2,
    which carries the output head.
  - **B:** mac-host browser stage 0, then intel-host native stage 1, then amd-host native stage 2,
    which carries the output head on AMD.

  Machine-specific identities (executable, provider, native fixture) follow the machine; the
  execution identity is the same for every stage.

## Shared-machine bounds (fixed before running)

- **Native scopes:** each runs in a bounded user scope named `reploid-cold-reference-20261013`, as in campaign 2, because the hash-pinned `observe-native.js` refuses any other scope name. Limits: 10 GiB memory
  high, 12 GiB max, zero swap, 1,800 s runtime cap. The loopback delivery server has the same cap,
  and the read-only host sampler is limited to 1,800 s.
- **Public contributors** (amd-host 4103868 and 4121371; intel-host 297260 and 299769) are checked
  before each placement and never addressed.
- **Stop condition, GPU reset:** [`guard.sh`](guard.sh) polls intel-host's kernel journal every 5 s
  from the placement's start. Any i915 "Fence expiration", "GPU HANG" or "Resetting" line stops the
  controller, the Mac browser owner and both hosts' owned scopes at once. Nothing further runs.
- **Stop condition, limits:** the harness fails any stage over 300 s or any allocation over the
  limit, and stops on the first numerical failure.
- **Order:** placement B starts only after A's providers have exited and every owned scope and port
  is settled.
- **Ownership:** units, PIDs and times are recorded per placement in `<placement>/ownership.json`.

## Numerical: pass in both placements

Both placements compare all 55 required prefixes against the unchanged independent F64 reference
within 0.001. Maximum absolute error is `9.520044947919359e-07` in each, the same as campaign 2.
Request maxima are `8.40e-07` (request 0, 19 tokens), `8.90e-07` (request 1, 21 tokens) and
`9.52e-07` (request 2, 184 tokens). [`a2/summary.json`](a2/summary.json) and
[`b/summary.json`](b/summary.json) carry the capture hashes. The compressed captures are retained
locally and are not in Git.

**Chunking was exercised.** Before any token, the live harness required every prepared stage to
open with execution id `sha256:c4819f17...`, whose program load policy declares
`prefillTokenChunkSize` 16. Each of the three requests is longer than 16 tokens, so each stage
split it into 2, 2 and 12 chunks. Those counts are derived from that verified policy and Doppler's
`resolvePrefillTokenChunkSize`; chunks were not counted individually.

## Lifecycle: pass, with one thin margin

Every attempt closed on every resident, and all residents closed with no active, deferred-cleanup or
retained-model owners. Both native providers released their provider and exited 0 inside their
memory limits, with no high, max or OOM events.

| Placement | Resident close time (limit 10,000 ms) | GPU peak, bytes (limit 1,420,000,000) | Longest stage operation |
|---|---|---|---|
| A (`a2`) | 2,017 / 1,986 / 2,717 ms | 634,223,264 / 125,659,504 / 271,700,368 | 191.0 s (Intel prefill of 184 tokens) |
| B (`b`) | 1,781 / **9,654** / 1,486 ms | 634,223,264 / 125,659,504 / 271,700,368 | 187.8 s (Intel prefill of 184 tokens) |

In placement B, intel-host closed its stage-1 resident in 9,654 ms. That is inside the unchanged
limit by under 350 ms, comparable to campaign 2's 9,972 ms AMD close. GPU peaks follow the
partition, not the machine. No i915 fence expiration, GPU hang or engine reset occurred on
intel-host during either placement ([`guard.sh`](guard.sh) logs are empty; `journalctl -k` was
checked again at settlement). [`a2/support-settlement.json`](a2/support-settlement.json) and
[`b/support-settlement.json`](b/support-settlement.json) record the shutdown, and
[`ownership.json`](ownership.json) records units, PIDs and times.

## Evidence: reports produced and validated

The unchanged producer (`sha256:714cc204...`) converted each capture into `<placement>/reports/`:
one contract and three partition reports, each `passed` with a complete 55-step comparison.
`reports/hashes.json` lists their hashes. The expectations diffs against campaign 2 are as follows:

- **A** ([`a2/expectations-diff.json`](a2/expectations-diff.json)): only the three stages' execution
  ids change.
- **B** ([`b/expectations-diff.json`](b/expectations-diff.json)): the execution ids change, and so
  does the machine behind partitions 1 and 2. That moves the executor ids, executables, providers,
  native hosts and the contract's stage provider hashes.

**Attempt `a` refused, fail-closed.** It froze an identity rebuilt by hand with only the chunk size
changed. The harness refused it before any token: the live identity also changes
`runtimeEngine.resolvedRuntimeSessionId`, the digest of the whole resolved session.
[`observe-identity.js`](observe-identity.js) then made a load-only observation on mac-host with no
token ([`identity-observation/`](identity-observation/)). The freeze now checks that the observed
chunk-16 identity differs from the retained chunk-256 one only in these fields: the chunk size, the
resolved session id, `programLoadPolicyHash`, `runtimeEngineDigest` and `digest`. The attempt's
natives were never connected. Its logs are kept in [`a/`](a/), and the natives were stopped before
`a2` started.

## Signed Capsule

Doppler `artifacts/chunked-prefill-capsule-20261014` binds placement B. The rig admits a single
resident contract per Capsule, so one Capsule carries one placement.

- **Capsule:** semantic root `sha256:171132d4...`.
- **Release:** sequence 4, `sha256:7f62c19a...`, chained to the sequence-3 renewal. It expires
  2026-10-15T13:21:16Z.
- **Test authority only.** Production signing remains the public-promotion gate.

## Application: not established

These reports qualify direct resident execution on three physical hosts in two partition orders.
They do not prove signed opening of the new Capsule, peer acquisition, automatic route selection,
conversations, history, concurrency or cancellation. Each report records
`applicationQualification: false`.

## Timing observations (not performance acceptance)

Stage timers include diagnostic evidence persistence and controller transport.

| Request (prompt tokens) | Placement | Prefill per stage (s), stages 0 / 1 / 2 | Decode median per step (s), stages 0 / 1 / 2 | Decode sum per step |
|---|---|---|---|---|
| 0 (19) | A | 4.8 / 2.4 (amd) / 22.4 (intel) | 0.36 / 0.21 / 4.78 | 5.4 s |
| 0 (19) | B | 4.8 / 19.6 (intel) / 2.5 (amd) | 0.35 / 1.67 / 0.61 | 2.6 s |
| 1 (21) | A | 5.2 / 2.4 / 26.1 | 0.38 / 0.25 / 5.18 | 5.8 s |
| 1 (21) | B | 5.2 / 20.9 / 2.6 | 0.37 / 1.24 / 0.59 | 2.2 s |
| 2 (184) | A | 66.6 / 20.8 / 191.0 | 1.26 / 1.59 / 6.13 | 9.0 s |
| 2 (184) | B | 46.4 / 187.8 / 19.8 | 1.08 / 5.88 / 1.30 | 8.3 s |

- **Short prompts:** moving the output head to AMD cut the summed decode step by more than half.
- **The 184-token request:** the Intel stage's decode step is about 6 s in either role. Intel's
  per-step cost evidently grows with the context, which this harness cannot attribute further.
- **Chunking cost:** Intel's 184-token prefill took 191.0 s in 12 chunks, against 186.5 s unchunked
  in campaign 2.
- **Contention during B:** another session's CPU-bound process ran on intel-host; it was recorded
  and not addressed.
