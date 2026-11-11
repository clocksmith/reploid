# Private fleet browser HTTPS journey, fault recovery, queue/batching, 27B placement, fleet memory, longer conversations, and multi-user load qualification, November 11

This directory records physical verification on Reploid with `doppler-gpu` `0.7.0`
(`sha512-sRaOuz/K6YOhyitFlauZ3u8mFZdOmAEbcRKEhnm4rs7/ajCB/y7xPiI8mF+lpdvg39C+RPH+HDlbAQAen+lTjQ==`).
Prior November 10 deployment and disconnect-propagation artifacts remain intact in
[../20261110/README.md](../20261110/README.md).

## 1. Normal browser-to-private-fleet journey over HTTPS

- Unmodified Chrome `157.0.8103.39` (`launchFlagsDisabled: []`, `cdpPermissionOverrides: []`)
  opened https://replo.id/, paired via `https://reploid-fleet-api.reploid.workers.dev/bridge`
  with zero Local Network Access or CORS errors and zero requester weight downloads,
  and verified cross-device HTTPS access with `Origin: https://replo.id` (`HTTP 200`).
- Turn 1 (`service:peer:721778acd0c5f26a47f936d5:d9dfede7-4ce5-410b-b715-6bce3cc0b91c`)
  streamed `18` progressive samples on `qwen-3-5-2b-q4k-ehaf16`
  (`sha256:a0dc69e917133a82780823d17fc771c0f6b882d7c86c571deeaef45be2ff108b`) from
  `Computer B` (`peer:5c0ecd2fd5fd8a105a4f8068`), processed `203` prompt tokens in
  `1,290 ms` prefill, held `512` maximum credits, settled `19` non-cash service
  credits, and returned remaining holds to `0`.
- Turn 2 (`service:peer:721778acd0c5f26a47f936d5:7619335a-0e81-49e5-b645-25f207bfb6ba`)
  reused `199` KV prefix tokens on `Computer B`, computed `51` new prompt tokens in
  `430 ms` prefill (`66.7%` prefill latency reduction), and settled `21` credits.
  Reloading https://replo.id/ preserved both turns and remote provider attribution
  without resending.
- Mid-stream Stop (`service:peer:721778acd0c5f26a47f936d5:6339adb7-ab7d-4357-b93b-89975525202a`)
  transitioned the browser attempt to `cancelled` in `98 ms`, halted decode between
  Doppler steps on `Computer B`, signed `reploid.generation-terminal/v1`
  (`status: "cancelled"`, `charge: 0`), and closed the `512`-credit hold to `0`
  in `240 ms`.

## 2. Multi-GPU overlap, provider loss, reconnect, and requester termination

Physical campaign across `Computer A` (`peer:74f39d0c31c02e162acede13`),
`Computer B` (`peer:84cfcb5647a0114d487168e4`), and `Requester`
(`peer:867281caed4f7097e0e32ba8`) on `qwen-3-5-2b-q4k-ehaf16`:

- **Overlapping conversations**: Two concurrent 96-token requests dispatched
  simultaneously across `Computer A` (`firstDeltaMs: 559`, `endedAtMs: 4,615`) and
  `Computer B` (`firstDeltaMs: 984`, `endedAtMs: 6,715`) with `overlapMs: 4,615`,
  settling `96` credits on each computer.
- **Provider loss and replacement**: `SIGKILL` of `Computer A` at `578 ms` rejected
  `Computer A`'s active stream (`Execution peer disconnected; retry requires a new attempt`)
  while `Computer B`'s concurrent stream completed uninterrupted (`96` credits),
  and the replacement request routed to `Computer B` (`65` credits). The `96`-credit
  hold on `Computer A` remained held (`held: 96`) while `Computer A` was offline.
- **Provider reconnect cleanup**: Restarting `Computer A` ran pre-mesh startup
  recovery (`providerOpenMine` in `server/fleet/service.js` and
  `openNativeGenerationJournal.unfinished` in `server/native-generation-journal.js`),
  signed `reploid.generation-terminal/v1` (`status: "failed"`, `charge: 0`),
  released the orphaned hold to `0` (`+96`, `+257`, `-353`, `held: 0`), and
  restored `2` ready replicas.
- **Requester `SIGKILL` and WebRTC recovery**: A pre-dispatch reservation
  (`pre-dispatch-19f2262b-c8a1-4174-8936-db338ca27b9d`) recovered to `abandoned`
  (`charge: 0`). An active generation killed via `SIGKILL` after `3` deltas
  (`5a3d7204-a4ab-4834-b54b-3df06c61e810`) finished on `Computer B` and persisted
  its signed receipt in `generation.sqlite`; on restart, `Requester` queried
  `Computer B` over WebRTC (`reploid:generation-recover` /
  `reploid:generation-recovery` in `packages/reploid/src/transport/swarm.js`),
  countersigned and settled `96` credits without repeating GPU execution, matched
  idempotently on repeat `recover()` calls, completed a post-restart generation
  (`13` credits), and conserved balances to zero (`+96 + +366 + -462 = 0`,
  `held: 0`, `14` double-entry journal rows across `7` settled requests).

## 3. Fair round-robin queueing, UI queue count, and decode batching

- **Fair lane scheduling (`createFairLaneScheduler` in `server/fleet/native-host.js`)**:
  Submitting `[1a, 1b]` from conversation `1` alongside `2a` and `3a` behind a
  single replica dispatched in `[1a, 2a, 3a, 1b]` order instead of FIFO
  `[1a, 1b, 2a, 3a]`, surfaced `queuedRequests: 3` (`Online · requester · 3 queued`
  in `apps/poolday/ui/pool-home/private-computers-view.js`), and closed all holds
  to `0`.
- **Decode batching (`doppler-gpu@0.7.0` on `Computer B`, `qwen-3-5-2b-q4k-ehaf16`, 64 greedy output tokens)**:
  - `batchSize: 1, readbackInterval: 1`: `10.64` mean decode `tok/s` (`10.60` median),
    `6,177.7 ms` mean `wallMs`, `1.47 ms` abort stop latency,
    `answerSha256 = 848605fa4799d871e1584e7fe1878c9adf545394173706bc913633a68443c3ff`.
  - `batchSize: 4, readbackInterval: 4`: `12.47` mean decode `tok/s` (`12.44` median,
    `+17.2%`), `5,306.0 ms` mean `wallMs` (`-14.1%`), `1.48 ms` abort stop latency,
    identical `answerSha256 = 848605fa4799d871e1584e7fe1878c9adf545394173706bc913633a68443c3ff`.

## 4. `qwen3-8-27b-text-q4k-ehaf16` placement comparison

Workload: `58` prompt tokens, `128` greedy output tokens (`temperature: 0, topK: 1, topP: 1`),
model identity `sha256:e29626a8d3c41c0af8c0dd945d028464dcebfef2413ba85e4f5e8695d5910d06`,
`doppler-gpu` `0.7.0`. Flash-Next remains unintegrated because Doppler's
`2,187`-token prompt logit gate is still open.

| Placement | Eligible | Greedy `answerSha256` match | Mean complete `wallMs` | Request `tok/s` | Model `loadMs` | Shard & activation transfers | Peak GPU buffers / process RSS | Credit settlement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Workstation whole-model (`128 GB` unified memory, [jupiter.json](../../native-throughput/20261109/jupiter.json)) | Yes | Reference `f6e8951d...` | `22,005.3 ms` | `5.82` (`6.11` decode) | `104,460.5 ms` | Local SSD only (`0` runtime transfer) | Fits resident without paging | Baseline reference |
| 2-stage `[32]` partition (`Computer A` Stage 0 + `Computer B` Stage 1 over WebRTC) | Yes | `true` (`f6e8951d...` on both runs) | `106,819.2 ms` (`102,329.0` / `111,309.5`) | `1.20` (`1.25` / `1.15`) | Stage 0: `9,404.0 ms`; Stage 1: `18,136.3 ms` | Shards: `17.00 GB` (`693,349 ms`, `24.52 MB/s`) + `7.61 GB` (`366,426 ms`, `20.76 MB/s`); WebRTC activations: `3,788,800 B` (`3.79 MB`) / request | Stage 0: `9.62 GB` GPU / `778.0 MB` RSS; Stage 1: `7.80 GB` GPU / `6.36 GB` RSS | `64` credits + `64` own units / run (`-128` / `+128`, `held: 0`) |
| `Computer A` whole-model (`24 GiB` unified memory, Metal) | Yes (pages) | `true` (`f6e8951d...` on both runs) | `338,905.8 ms` (`320,985.0` / `356,826.7`) | `0.38` (`0.74` / `0.37` decode) | `84,100.9 ms` | Shards: `17.00 GB` (`693,349 ms`, `24.52 MB/s`); `0` runtime transfer | `17.62 GB` GPU / `309.2 MB` RSS (`19.83 GB` wired system pages) | Local execution |
| `Computer B` whole-model (AMD RDNA2 Vulkan) | No | N/A | N/A | N/A | N/A | `embed_tokens.weight` (`2,542,796,800 B`) exceeds Vulkan `maxStorageBufferBindingSize` (`2,147,483,648 B`) | Rejected before buffer allocation | N/A |

Comparative outcome:

- Against a single host with `128 GB` unified memory ([jupiter.json](../../native-throughput/20261109/jupiter.json)),
  2-stage WebRTC partitioning adds `4.85x` complete request latency (`106,819.2 ms`
  vs `22,005.3 ms`). Whole-model execution remains preferred whenever one eligible
  computer fits the model without memory paging.
- Across the two private-fleet desktops (`Computer A` `24 GiB` unified memory and
  `Computer B` AMD Vulkan), `Computer B` cannot load whole-model `27B` due to its
  `2.15 GB` storage-buffer binding limit, while `Computer A` whole-model pages
  unified memory (`338,905.8 ms` mean `wallMs`). Splitting at layer `32` places
  `embed_tokens.weight` on `Computer A` (`4.29 GB` Metal binding limit) and keeps
  both stages inside unpaged memory (`9.62 GB` and `7.80 GB` peak GPU buffers),
  reducing mean complete request latency on that two-machine pool by `68.5%`
  (`3.17x` request throughput).

## 5. Fleet memory accounting, reclamation, and UI telemetry

Verified on native release `sha256:f633fe407f8e9227b56d6759442f51c0fb3eb93790600f04d15175ff877b5d3d`:

- **Reclaimable host memory and resident observation (`server/fleet/native-host.js`)**:
  `availableHostBytes()` reads reclaimable host memory (`vm_stat` `Pages free + File-backed pages`
  on macOS, `/proc/meminfo` `MemAvailable` on Linux, `os.freemem()` fallback). `reconcile()`
  computes `ownedHostBudget` (`ownerPolicy.budgets.maxProcessResidentBytes` vs physical host RAM),
  tracks live `residentHostBytes` alongside `resident.gpuBytes`, `resident.peakGpuBytes`,
  `resident.cachedContexts`, and `resident.contextCacheBytes`, and sets
  `observation.freeHostBytes = Math.max(0, Math.min(hardware.freeHostBytes, ownedHostBudget - residentHostBytes))`
  so placement retains an active resident instead of falsely evicting it when unified/file-cache
  pages shift. `publishDemand()` estimates queued request tokens via UTF-8 byte length divided by
  `4` (`estimate: "input-utf8-bytes-div4"`).
- **Owner-budgeted KV prefix cache and telemetry (`packages/reploid/src/mesh/generation-context-cache.js`, `apps/poolday/providers/work-provider.js`, `apps/poolday/providers/work-resident-provider.js`)**:
  When an owner or runtime GPU buffer ceiling is configured, `contextCache.maxBytes` is capped to
  `Math.min(profile.contextCache.maxBytes, Math.max(67108864, Math.floor(configuredBufferBudget * 0.25)))`
  (`1,610,612,736 B` / `1.50 GiB` under a `6.0 GiB` `maxGpuBufferBytes` owner policy).
  `getStats()` reports `{ entries, activeEntries, allocatedBytes, cachedTokens, maxEntries, maxBytes, maxEntryBytes, hits, misses, evictions }`
  across LRU entry-count eviction, byte-budget eviction, and idle-timeout disposal.
- **Replay-window cap (`server/fleet/browser-bridge.js`)**:
  `createFleetBrowserBridgeHandler` enforces `maxSeenAttempts = 10000`, evicting the oldest
  settled `attemptId` entries while preserving active `pending` attempts.
- **Poolday UI telemetry (`apps/poolday/ui/pool-home/private-computers-view.js`)**:
  Online contributors with live resident metrics render
  `Resident GPU use` (`<GB> · <N> cached thread(s)`) in the per-computer details disclosure.

## 6. Longer conversations (`2,048` context ceiling and `262,144`-byte transport limit)

Executed on `qwen-3-5-2b-q4k-ehaf16` (`contextLength: 2048`, `maxOutputTokens: 512`, `batchSize: 4`)
across two isolated Metal WebGPU contributor processes (`Computer A (Replica 1)`
`peer:cfc626464bf664fad49322ad` and `Computer A (Replica 2)` `peer:373ee15789b1bfa3334a5902`,
each under `maxGpuBufferBytes: 6,442,450,944` and `maxProcessResidentBytes: 10,737,418,240`):

| Turn | Prompt tokens | Output tokens | Total context tokens | Stop reason | `wallMs` | `cachedTokens` (`hits`) | GPU live buffers | Credits settled |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `292` | `36` | `328` | `stop-token` | `9,497 ms` | `288` (`0`) | `2.26 GB` (`2,261,323,228 B`) | `36` |
| 2 | `617` | `36` | `653` | `stop-token` | `6,923 ms` | `613` (`1`) | `2.32 GB` (`2,322,297,388 B`) | `36` |
| 3 | `942` | `36` | `978` | `stop-token` | `6,771 ms` | `938` (`2`) | `2.35 GB` (`2,346,479,404 B`) | `36` |
| 4 | `1,267` | `36` | `1,303` | `stop-token` | `7,418 ms` | `1,263` (`3`) | `2.35 GB` (`2,346,479,404 B`) | `36` |
| 5 (clamped `512 -> 448`) | `1,600` | `36` | `1,636` | `stop-token` | `24,616 ms` | `1,596` (`4`) | `2.59 GB` (`2,594,459,180 B`) | `36` |
| 6 (clamped `512 -> 228`) | `1,820` | `228` | `2,048` | `max-tokens` | `48,872 ms` | `1,816` (`5`) | `2.71 GB` (`2,713,440,052 B`) | `228` |

- **Near-ceiling output clamping (`apps/poolday/providers/work-provider.js`)**:
  Before decode, `tokenizePrompt()` checks `maxSeqLen - promptTokens`; Turn 5 clamped
  `maxTokens` from `512` to `448` and Turn 6 clamped `maxTokens` from `512` to `228`,
  halting cleanly at `stopReason: "max-tokens"` (`1,820 + 228 = 2,048` tokens) with zero
  KV cache overflow.
- **Over-ceiling context rejection without resident retirement (`apps/poolday/providers/work-resident-provider.js`, `packages/reploid/src/mesh/peer-generation.js`, `server/fleet/requester.js`)**:
  Turn 7 (`2,921` prompt tokens, `10,977` UTF-8 bytes) failed pre-execution with
  `Conversation exceeds model context limit (2921 >= 2048 tokens)`, signed
  `reploid.generation-terminal/v1` (`status: "failed"`, `charge: 0`), settled the
  requester credit reservation immediately (`held: 0`), and kept both GPU replicas
  `ready: true` (`phase: "ready"`).
- **Oversized WebRTC envelope guard (`packages/reploid/src/mesh/peer-generation.js`)**:
  A `270,000`-byte UTF-8 conversation (`> policy.webrtc.maxMessageBytes = 262,144`) was
  rejected before `mesh.dispatch` (`Conversation exceeds transport payload limit (262144 bytes)`)
  with `0` credit reservations created and `held: 0`.

## 7. Sustained multi-user load (`6` concurrent users across `4` waves + mid-wave cancellations)

Executed across `Computer A (Replica 1)`, `Computer A (Replica 2)`, and `Requester`
(`followPlacement: true` fair-lane scheduler over `/bridge` HTTP/NDJSON):

- **Throughput, fairness, and latency**:
  `6` concurrent multi-turn conversations (`> contextCache.maxEntries = 4`) x `4` waves
  completed `24` generations (`13` served by `Replica 1`, `11` served by `Replica 2`),
  with end-to-end `wallMs` `p50 = 6,377 ms`, `p95 = 10,543 ms`, `max = 14,110 ms`
  (`queuedMs` `p50 = 2,805 ms`, `p95 = 8,662 ms`, `max = 8,690 ms`).
- **Active mid-wave user cancellations**:
  Two additional concurrent requests (`cancel-wave-2` at `4,139 ms` and `cancel-wave-3`
  at `4,901 ms`) aborted after `1` streamed delta, signed `reploid.generation-terminal/v1`
  (`status: "cancelled"`, `charge: 0`), and released holds to `0` without disrupting
  the `12` co-scheduled wave requests.
- **Context cache reuse, eviction, and GPU buffer stability**:
  Across the full `33`-request campaign, the two replicas recorded `18` KV prefix hits
  (`8` + `10`), `14` misses (`6` + `8`), and `4` LRU evictions (`1` + `3`), holding
  `entries <= 4` (`284,812,944 B` allocated per replica at Wave 4). Baseline loaded
  weights consumed `2,104,275,216 B` (`1.96 GiB`) GPU live buffers per replica
  (`688.6 MB` / `688.8 MB` RSS). Combined warm GPU live buffers moved from
  `5,226,653,384 B` at Wave 2 (`2.36 GB` + `2.87 GB`) to `5,262,370,712 B` at Wave 4
  (`2.39 GB` + `2.87 GB`, `+0.683%` drift across two full 6-user turnover waves and
  two mid-wave cancellations), RSS finished at `796.2 MB` and `855.6 MB`, and
  `reconcile()` returned `action: "retain"` on both replicas after every wave.
- **Credit conservation (`sustained-multiuser-load-replay.json`)**:
  `30` completed whole-model receipts and `3` signed `reploid.generation-terminal/v1`
  outcomes (`2` `cancelled` + `1` over-ceiling `failed`) settled `Replica 1: +104`,
  `Replica 2: +496`, `Requester: -600` (`+104 + +496 + -600 = 0`, `held: 0` on every
  account, `66` double-entry journal rows across `33` settled requests, zero duplicates).

## 8. Sanitized replay verification and privacy boundaries

Replay signatures, admission fences, maximum credit holds, settlements, duplicate
settlement idempotence, conflicting-settlement rejection, and balance conservation:

```sh
node tests/fixtures/fleet-credit-replay.js \
  reports/fleet-browser/20261111/hosted-unmodified-chrome-replay.json \
  reports/fleet-browser/20261111/fair-queue-replay.json \
  reports/fleet-browser/20261111/partition-27b-replay.json \
  reports/fleet-browser/20261111/sustained-multiuser-load-replay.json
```

- Valera's browser streaming path was updated separately on `valera` `main`
  (`e7542691947f5bc39a5daadba591a47a4b1c16d0`) to stream directly from Cloud Run
  with CORS and `/api/cloud/cancel` propagation while keeping Protected Mode's
  zero-cloud-egress default intact.
- Private non-cash service credits remain separate from public chat. The public
  `27B` provider remained untouched throughout all tests. Public partitioning and
  public payouts remain separately gated pending economic qualification.
