# Explicit peer comparison

These fixtures are operator-local diagnostics. They do not register a shipping
model, change the installed runtime package, or establish performance superiority.
The caller supplies an immutable freeze with source, model, profile, request,
placement, resource and code identities.

## Common-weight profile migration

The JSON fixture is the byte-identical diagnostic profile previously included
in the vendored Doppler runtime. It is retained only for explicit peer comparison.
Its profile and authenticated model identifiers are unchanged; this migration
does not relabel historical artifacts or make the profile a shipping default.
The browser runtime and its manifests intentionally exclude it.

Vendoring excludes this profile through `scripts/doppler-browser-assets.json` and
checks its reviewed SHA-256 before omission. All retained runtime bytes remain
identical to the pinned archive. Its kernel registry therefore keeps historical
reachability labels from that archive; those labels do not select runtime paths.
Hosting rejects a reintroduced profile, and archive verification remains mandatory.

The runner defaults to metadata checks:

Owned model processes clear ambient `POOLED_*`, `DOPPLER_*`, `DAWN_OPTS`,
`UV_THREADPOOL_SIZE`, and `RN_DEBUG` settings, then apply only that arm's frozen
`environment` map. Omitting an SDK override retains its ordinary default;
an explicit empty string remains distinct from an unset variable. Both native
and peer processes follow this policy, recorded in the comparison report.

The native worker optionally accepts `expertLoadingObservation: true` for a
separately pinned diagnostic. It calls the selected source's declared
`model.advanced.getExpertLoadingStats()` after open and complete-request clocks
stop, and fails explicitly if that source lacks the capability. Ordinary runs
omit the flag and perform no snapshot work. Profiler phase counters and wait sums
are diagnostic attribution, not GPU time or matched speed qualification.

`clientSetupWallMs` uses the same owned-client clock for both engines: process
startup, any protocol preflight, and the complete open response. Its scope is
`owned-worker-startup-preflight-open/v1`. Engine-local `loadMs` and `openWallMs`
remain separately labeled because they cover different setup boundaries; do not
compare those fields as matched setup or silently apply the new clock to an old
receipt that did not record it.

```sh
node compare-complete.js /absolute/freeze.json \
  --sha256 FREEZE_SHA256 --output /absolute/new-preflight-directory
```

`metadataPreflightPassed` means metadata and selected files are available.
`sourceIntegrityReady` is separate. Model execution requires `--execute`, a
complete pinned content proof and the freeze's resource/ownership checks. An
existing output directory is never reused.
Preflight rejects duplicate or unsafe workload names and repeated prompt-ID
sequences, and requires both frozen and held-out cases. Relabeling a frozen
input as held-out is not new correctness coverage. Each admitted workload owns
distinct arm output directories.

## Content and identity

`source-integrity.js` derives required coverage from the admitted manifest and
piece index. It rejects a caller-selected subset as a model-wide proof. Creating
a proof requires explicit total-byte, read-buffer and time limits; it hashes
through no-follow descriptors, checks file and alias identity before and after
reading, awaits descriptor release, and publishes no successful partial proof.
The metadata configuration and receipt are each limited to 1 MiB.

```sh
node prove-source-integrity.js /absolute/proof-config.json \
  CONFIG_SHA256 /absolute/new-proof.json
```

This command reads only the explicitly selected local files and performs no SDK,
provider or model import. Its regular-file deadline is cooperative; an owned
process deadline is also needed if the caller requires a hard execution bound.
The operator pins the completed receipt hash in a new freeze before execution.

Separately completed proofs can be combined without rereading large source
files. `compose-source-integrity.js` takes the same three command arguments;
its configuration contains the complete `files` selection, `timeoutMs`, a
`maxProofBytes` total metadata budget (at most 1 MiB), and `proofs` entries with
absolute receipt `path` and `sha256`. Each component must bind unchanged files
from that selection. Missing, overlapping, unknown or differently identified
files fail. The combined receipt is usable only for its exact selected coverage;
a subset still cannot satisfy the comparison's full-model gate. Composition
does not replace content hashing with historical declarations or attestations.

Proof hashing happens outside timed requests. The peer's original disk reader
and conversion remain unchanged. Proof plus later filesystem continuity is not
per-read authentication of the peer's descriptors. Native inference retains its
authenticated-piece path. Runtime inventories bind selected filesystem code and
native dependencies; they do not attest loaded drivers or physical hardware.
Frozen source aliases bind their own identity and timestamps as well as the
canonical target. Replacing an alias and restoring it to the same target
invalidates that freeze; a matching target path alone does not satisfy continuity.
The metadata comparison also rejects an explicit native KV-cache dtype that
contradicts its selected kernel path. Receipts expose native and peer cache
precision separately; common effective weights do not imply identical cache
precision. Exact full-model token parity remains mandatory across those paths.

## Timing scopes

Both workers use the same JSONL response loop and one outstanding owned request.

| Field | Boundary |
| --- | --- |
| `requestWallMs` | Reset through public generation and decoded output. |
| `decodeCompletionMs` | First public token through decoded completion. |
| `clientRequestWallMs` | Parent clock before request serialization through complete response JSON parsing. |
| `clientOverheadMs` | Client duration minus the core interval; a residual, not an independently timed phase. |
| `clientRequestBytes`, `clientResponseBytes` | Actual UTF-8 protocol bytes, including frame delimiters. |

The client includes local dispatch, response serialization, pipe delivery,
stdout auditing and parsing. Full engine-specific telemetry remains in each
response, so payload costs can differ and are reported by the byte counts. Core
timings remain available independently. Process initialization, provenance,
model loading and close are separate operations. Requests use exact frozen
pretokenized IDs; tokenization is outside these clocks.

This is local stdio timing. It does not measure production HTTP, discovery,
permissions, relay, WebRTC, client streaming or distributed inference.

Transport has explicit frame and request/arm deadlines, strict IDs and operation
echoes, separate stderr logs and owned process-group cleanup. A successful close
also requires natural exit code zero and complete stdout EOF. An acknowledged
close followed by a held worker, timer or GPU reference fails that gate;
termination is fallback cleanup and never proof of graceful retirement.

Protected provider observations bind the systemd MainPID, invocation identity,
complete service cgroup membership and each process's start identity. GPU counters
come from every observed DRM-owning member, including a Node child behind a
`flock` MainPID. Missing observations or changes in membership, process identity,
DRM ownership or counters invalidate the comparison. `protectedProviderPolicy`
defaults to `"active_unchanged"` (running beside an idle protected provider) and
also accepts `"paused_inactive"` when an operator explicitly pauses the unit and
requires it to remain inactive (`MainPID=0`) across every arm; `report.json`
records `runsBesideProtectedProvider` explicitly. These endpoint snapshots do
not establish global GPU idleness between observations.

`--execute` holds the freeze's `locks` (exclusive on the first path, shared on
the second, both non-blocking) through util-linux `flock(1)`, because Node has
no `flock(2)`; the execute path therefore needs a Linux host with `flock`.

Host and GPU preflight (`--check-host-preflight` for a read-only check, and
mandatory before admission and before every arm under `--execute`) gates on:
`MemAvailable`, truly free `MemFree` (`>= 16 GiB` default), `Shmem` (`<= 4 GiB`
default so `/tmp` and `/dev/shm` tmpfs usage cannot silently exhaust RAM),
`Dirty + Writeback`, AMD sysfs `mem_info_gtt_used` (`gttFreeBytes >= gpuCapBytes + 8 GiB`
plus any UMA evictable carve-out bytes), the `512 MiB` UMA VRAM carve-out
(`effectiveVramAvailableBytes >= 64 MiB` counting TTM-evictable userland
`drm-memory-vram` above a `4 MiB` per-client pinned reserve, `mem_info_preempt_used <= 64 MiB`,
and zero unexpected DRM compute clients holding `>= 64 MiB` GTT outside the
protected provider), `gpu_busy_percent`, and
absence of active bulk file-copy/archive tools or ambient whole-disk throughput
above `64 MiB/s`. When `protectedCachePolicy` is `"clear_before_candidate"` or
`"clear_each_arm"`, validated `/dev/shm` or `/tmp` protected piece caches are
removed synchronously before each cold candidate arm (and after candidate close
for `"clear_each_arm"`).

For matched two-machine split comparisons (`compare-split-single-clock.js`,
`split-complete-workers.js`, and `local-swarm-signaling.js`), one requester
monotonic clock (`single-requester-clock-monotonic/v1`) drives both engines over
the same owned JSONL protocol (`open`, three `request` calls, `receipts`, `close`)
with matched layer ranges (`expectedRanges`), loopback discovery signaling, and
deterministic cold-cache clearing, reporting `startupWallMs`,
`postOpenFirstRequestClientMs`, `openPlusFirstAnswerClientMs`, and
`repeatRequestClientMeanMs` separately.

Exact input/output, stop-token semantics, prefix reuse, recovery, placement,
allocation, receipt and lifecycle checks remain mandatory. Metadata dtype
compatibility alone does not establish physical materialization, token parity,
full-model isolation or competitive speed.

An operator can bind `requireNativeLifecycle: true` in a new comparison freeze,
including `native-complete-lifecycle.js` in `filePins`. Each native arm then runs
its full-model lifecycle check after the three timed requests: repeatability,
pre-aborted request, cancellation after the first token, settled GPU work and
source reads, observed buffer reuse and identical recovery. Final unload and
natural process exit remain mandatory. This adds real model work and must not
be enabled by editing an already frozen campaign. Historical freezes without
this field keep their original request sequence and do not qualify lifecycle.

An operator-local peer config may explicitly enable `sourceObservation: true`.
The adapter then snapshots scalar expert-store counters after reset, immediately
after stamping the first public token, and after decoded completion. The exported
`sourceObservation` reports prefill and decode deltas, rejects missing or reset
counters, and marks the request `performanceRepresentative: false`. The first-token
callback does additional work in this diagnostic; its clocks cannot qualify a
speed claim. The selected SDK, weights and ordinary request path are unchanged.
