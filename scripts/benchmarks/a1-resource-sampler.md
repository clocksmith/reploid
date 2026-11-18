# Passive A1 resource sampling (unqualified diagnostic)

The companion Python script records Linux process I/O counters and `fincore`
residency without loading model contents, hashing them, warming caches, evicting
pages, locking memory, starting an inference process, or modifying a harness.
Use it alongside both comparison arms under the same instrumentation policy.
It does not establish performance, source identity, causal attribution or a win.

Example using explicit benchmark-owned process IDs and files:

```sh
python3 scripts/benchmarks/a1-resource-sampler.py \
  --pid 12345 --file /absolute/model.gguf --samples 60 --interval 1 \
  --phase-marker /absolute/phase.json --out /absolute/new-observations.jsonl
```

The benchmark owner must publish phase markers atomically using rename. Required
string fields are `runId`, `armId`, `phase`, and `eventId`. Use a unique `eventId`
for every transition, even when returning to the same phase name. Suggested
phases: staging, open, first-request, repeated-request, close. Missing markers
are explicitly unattributed. A delta is attributed only when observed marker
identities match across both endpoints and within the current sample. This is
sampling, not exact boundary timing; it cannot detect an incorrectly reused event
identity. Do not rewrite a pinned harness or freeze to add markers silently.

Counter semantics and limits:

- `read_bytes` is process-accounted storage read traffic, not model-specific bytes.
  `rchar` includes cached reads and unrelated reads. Neither is expert-upload bytes.
- Supply every known worker PID explicitly. Child processes are not automatically
  discovered or summed. PID start ticks guard reuse; missing/exited processes and
  counter regressions produce absent deltas, never invented zeros.
- `fincore` is an instantaneous file-residency observation, not GPU memory or proof
  of later cache state. Its diagnostics are retained, including a denied cachestat
  query when a tool version falls back to mincore. Only caller-owned regular files
  with unchanged before/after identity are admitted, because mincore may return
  synthetic all-resident bits for inaccessible files. Missing tools/errors stay explicit.
- Retain the immutable source/model/freeze identities separately. This helper does
  not validate file hashes or prevent replacement of a model pathname.
- Samples are bounded (maximum 3,600); residency collection times out after two
  seconds; collection time is recorded (JSON serialization, write and flush are excluded). The interval is a delay after each sample,
  not an exact fixed sampling frequency. Adjacent begin wall/monotonic clock readings
  bracket the start rather than mixing a begin timestamp with an end timestamp. File output is exclusive and never replaces
  prior evidence. All recorded paths and counters remain local unless reviewed.

Validation: `python3 -m unittest discover -s scripts/benchmarks -p test_a1_resource_sampler.py`.
CPU tests and a live shell smoke establish instrumentation behavior only. No A1
model campaign, GPU benchmark or acceptance comparison has been run with this helper.

## Existing frozen harness integration

The existing `compare-complete.py` publishes `report.json` before and after each
arm. Supply `--harness-report /absolute/campaign/report.json --freeze-sha256 HEX`
to retain its arm context after checking the expected freeze identity. This only
reads the existing report and needs no source, freeze, control or protocol changes.
Partial writes are unavailable samples. **The report does not expose per-request
start boundaries or worker PIDs**: this adapter therefore never labels its arm
state as staging/open/prefill/decode and never grants request-phase attribution.
Identify owned workers separately; retain their start ticks and parentage in the
campaign record. An actual controlled benchmark still needs the owner's resource
lease and a new explicit instrumentation protocol. Do not run `--execute` merely
to test this sidecar.

Report reads are capped at 64MiB and cached by identity/size/mtime. The actual
retained 46MB report took about 224ms to parse in one diagnostic, then about
0.22ms with cached context. These are collection observations, not total observer
overhead. Measure matched-arm observer effects before drawing performance conclusions.
