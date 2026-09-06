# Complete Pack jobs

An application can explicitly delegate `generate`, `embed`, `rerank`, or
`encodeSequence` to a peer using the same signed operation protocol. An additional
adapter declares its workload, version, request/output validation and comparison.
The networking code does not branch on the operation name.

This API is available through `createPeerPackProvider` on the provider client and
`createPeerPackRequester` on the requester client, or the underlying
`peer-pack-provider.js` and `peer-pack-requester.js` factories. It requires exact
application-selected model pins on both ends. It does not enable unpublished
models in the public catalog or send local document inputs automatically.

## Application integration

1. Connect a dedicated reliable ordered RTCDataChannel. Wrap it with
   `createPackJobDataChannel({ channel })`. Share that bus with the peer client.
2. Configure the provider with full local model configurations and an
   `authorize(job)` callback. The default executor opens the signed Pack using
   the configured released runtime and application signer/eligibility policy.
   Missing admission denies execution. Recheck current consent and qualification
   in that callback; returning true grants this public job execution.
3. Call `provider.createAdvert({ limits, capabilities, expiresAt })` with current
   observations. It signs exact model identities, operations, input classes,
   available adapter/expert identities, resource budgets and load. Source URLs
   and local open options stay local. Deliver this signed advert through the
   application's discovery path.
4. Call `requester.run({ advert, model, input, options, limits, consent,
   comparisonPolicy, reference, resources, signal, onPartial, attemptNumber })`. An
   `adverts` array allows selection among multiple candidates. Consent must name the
   selected provider key and declare public input. Private input is unsupported.
5. Retain the returned signed job, updates, acceptance, exact reference and model
   pin. `verifyPackPeerEpisode` checks that archive at its original acceptance
   instant. Public availability and qualification require separate evidence.

Consent has schema `reploid.peer.public_operation_consent/v1`, `publicInput: true`,
and a `providerIds` array of explicitly permitted signing-key hashes. It is
signed with the request; possessing model bytes is insufficient authority.

Limits require positive integers for `maxInputBytes`, `maxOutputBytes`,
`maxStreamBytes`, `maxEvents`, and `maxJobMs`. Each request also sets a future
`deadlineAt`. Protocol ceilings are 4 MiB input, 4 MiB output per event, 64 MiB
stream traffic, 4,096 events, and 300,000 ms per job. Provider advertisements can
tighten these limits. The transport frames messages at 16 KiB and bounds pending
messages, buffering, reconstruction, lifetime traffic, and incomplete messages.
Frame accounting excludes SCTP/IP overhead and relay charges.

## Planning declared work

`pool-config.json.peerJobs.providerCapabilitySchema` declares observation bounds.
`assignmentPolicy` declares residency/fetching eligibility, required free budgets,
load rules, observation age and metric order. Missing policy or observations fail
before assignment. Free physical GPU/storage memory may be explicit null; policy
either rejects it or uses the provider's declared budget. The plan records which
memory observations were unknown. A willingness budget is not an attested memory
measurement or a guaranteed allocation. Providers verify their advertised
concurrency and current load against their own execution state before signing.

The normalized requirement identifies the exact model, operation, input class,
adapter/expert identities, permitted providers, job limits and resource request.
`resources` requires nonnegative `gpuBytes`, `storageBytes` and
`bandwidthBytesPerSecond`. Every provider supplies a timestamp, exact observed
artifact identities and states, supported operations, permitted input classes,
GPU identity or null, and all resource fields defined in `peer-capabilities.d.ts`.
These declarations inform eligibility; Doppler still owns actual allocation and
execution failure. Advertising an adapter or expert does not enable its execution.

`peer-planning.js.planOperationProviders()` receives already verified observations
and an explicit time. It returns deterministic candidate assessments, exclusions,
ordered provider IDs and policy/requirement digests. It performs no live lookup
or networking. A provider's latest observation supersedes its older advert under
the configured tie-break rule. History input is explicitly disabled and rejected.

The v3 intent retains all candidate adverts and the resulting plan. Admission
recomputes the same plan before execution. `peer-room.js.runPeerOperationJob()`
prepares this signed work through `requesterClient.createPeerOperationJob()`,
then asks the existing transport owner to connect the selected provider. The
connector returns a bus and `close()` handle. `runPrepared()` delivers the exact
prepared envelope without signing a replacement or choosing another provider.
Connection and execution share the declared deadline. Cancellation closes a
late connection before work can be sent. Product input contains no WebRTC state;
runtime composition supplies the transport connector.

## Acceptance and recovery

The current v3 assignment binds the signed intent, selected provider advert, route,
numbered attempt, exact adapter set, input class and limits. The signed intent
retains resolved operation and job policy snapshots and their digests. Live
admission rejects configuration drift. Offline verification restores the signed
policy using its compatible installed adapter, so subsequent configuration
changes do not reinterpret archived acceptance. Legacy v1/v2 archives remain
verifiable; new execution requires v3. Doppler records bind the complete operation request, exact
Pack closure, target plan, runtime, input and output. The provider signs each
ordered update; the requester checks both that chain and Doppler's event chain.
Completion is released only after the execution iterator closes and the attempt
remains current. The requester then applies the predeclared comparison policy.

Numerical operations use declared tolerances; generation currently requires an
exact-text reference. This is suitable for frozen qualification or reproduction
jobs. It does not yet define acceptance for arbitrary open-ended remote answers.
Signed records are evidence of key-bound claims, not hardware attestation or
proof of honest GPU execution. Matching browser outputs do not establish truth.

Lost delivery can resend the identical signed job with a bounded retry count.
The provider retains bounded responses and replays them without recalculating
that attempt during their lifetime. Conflicting duplicates, missing or reordered
events, incomplete results, expired jobs and failed comparisons reject. A new
attempt gets a new identity and an explicitly incremented attempt number; its
requester ignores previous-attempt results. The initial number comes from JSON
configuration. Delivery retry resends the same numbered attempt, never a new run.
Resource accounting includes repeated request and response delivery.

Cancellation and transport disconnect immediately invalidate the requester's
attempt. A signed cancellation requests cooperation; it does not prove immediate
GPU termination. The execution slot stays busy during runtime cleanup. A
cancellation that arrives before its delayed job leaves a bounded tombstone.
The provider now persists attempt claims, cancellation tombstones and signed
responses in native IndexedDB. The v2 journal records `accepted`, `running`,
`completed`, `cancelled`, `interrupted` and `expired`. Its immutable binding names
requester, job, request hash, assignment, operation, exact model, adapter set and
attempt number. A strict transaction commits `accepted` before preparing the
executor and `running` immediately before calling Doppler's public operation
method. It commits each response before transmission and cancellation before
acknowledgement. A lost send cannot overwrite
a saved completion with failure. After restart, the same provider key and
browser profile can replay the original signed response stream. The provider
rechecks signatures, request bindings and both event chains before replay.

A replacement writer marks an unfinished attempt interrupted and fences its
previous writer. It replays verified partial results followed by a signed
failure, without executing that attempt again. This does not establish that the
old GPU stopped. Only a currently active requester can accept output.

The checked-in `pool-config.json.peerJobs` policy declares retry count, retry
delay, message bounds, record count, saved bytes, retention and storage deadlines.
Its persistence policy permits 128 attempts and 64 MiB of serialized records.
Access marks expired records, retaining them for 300,000 ms after their deadline
before deletion. Application limits can tighten these bounds.
`provider.getJournalStats()` exposes byte and per-state accounting. Legacy
unfinished journal entries migrate to `interrupted` and cannot become runnable.
Storage failure, timeout, corruption or exhaustion denies execution. Browser-managed
storage can be evicted or deleted; changing origin, profile, journal name or
provider identity also loses this continuity. Signed responses expire with the
job, and this short recovery journal is separate from the application's evidence
archive. Delivery remains bounded at-least-once; exactly-once execution across
arbitrary restarts or storage loss is not claimed.

## Validation

- `tests/unit/pool-peer-pack-job.test.js`: real signatures with synthetic outputs,
  four operations, a fifth adapter, lost delivery, cancellation, deadlines,
  bounds, admission, assignment substitution, and archived acceptance.
- `tests/unit/pool-peer-operation-planning.test.js`: identical planning across
  operations, configured model/adapter residency, budgets, stale observations,
  permissions, duplicate ordering, immutable inputs and disabled history.
- `tests/e2e/peer-pack-jobs.spec.js`: two browser contexts exchange all four
  operations over real WebRTC, including large embedding inputs and outputs;
  model outputs are synthetic. The actual Verification Worker accepts the code.
  Native IndexedDB tests replace the entire Chromium process after acceptance,
  during generation, after completion before delivery, after cancellation and
  during an in-flight acceptance write. They count operation calls, fence two
  journal writers, verify numbered retry and expiry/cleanup, migrate unfinished
  legacy records, abort stalled transactions, exhaust storage bounds and reject
  corrupted persisted responses.
- [Physical ESM-2 remote episode](../status/esm2-remote-operation-2026-09-06/README.md):
  actual peer-reconstructed model execution, eight frozen reference checks, and
  a dropped result recovered by retry without a second remote calculation.
  One computer and one internal operator; separate from the synthetic tests.
- [Durable ESM-2 job episode](../status/esm2-durable-job-2026-09-06/README.md):
  the actual remote model result survives provider-object replacement through
  IndexedDB replay. Separate synthetic-model observations replace the entire
  browser process for completed, interrupted and cancelled attempts.
- [Numbered attempt episode](../status/esm2-attempt-v2-2026-09-06/README.md):
  the v2 signed policy and attempt binding execute the actual model and recover
  a dropped completion through persistent replay. A separate attachment records
  six whole-browser replacement cases, including acceptance and a pending write.

Independent operators, useful scheduling history, public release installations,
and model qualification remain separate acceptance gates.

*Last updated: September 2026*
