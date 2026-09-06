# Real model transfer across a browser restart, 2026-09-06

A requester recovered an interrupted ESM-2 model transfer after its entire
Chromium process exited. The replacement process reused 12 committed chunks
(7,616,727 bytes), fetched the missing pieces through WebRTC, reconstructed the
signed Pack and all 24 dependencies, and executed the real model through
`openPack().executeOperation()`. All eight frozen reference checks passed.

This closes the narrow gap between the previous seven-byte browser-restart test
and a real model transfer. It remains one internal operator on one physical AMD
computer, with three supplier browser contexts and a separately owned requester
browser process. It does not establish independently operated machines,
independent networks, voluntary reuse, or useful learned scheduling.

## What the run exercised

The harness interrupts chunk requests after eight weight responses; already
in-flight responses may finish. The incomplete transfer committed verified
pieces to native IndexedDB. It then closed the requester's persistent browser
context and confirmed that its owned Chrome process exited. The replacement
process had a different PID and opened the same origin and browser profile.
No saved chunks were imported or manually copied into the replacement process.

The coordinator retained this internal fixture's signing identity in memory and
restored it to the new process. Private keys are not in this archive. This tests
model storage recovery, separately from end-user identity persistence or recovery
after the coordinator itself exits. The browser was closed gracefully after an
injected connection interruption; an abrupt process kill or power failure was
not exercised.

| Measurement | Observed value |
| --- | --- |
| Verified chunks saved before restart | 12 |
| Verified bytes saved before restart | 7,616,727 |
| Those verified chunks requested again | 0 |
| Bytes received after restart | 125,888,162 |
| Final persistent chunks | 149 |
| Verified persistent chunk payload bytes | 133,504,889 |
| Entire requester profile, allocated filesystem bytes after closure | 144,986,112 |
| Accepted duplicate network bytes | 0 |
| Peak concurrent chunk payloads | 2,097,152 bytes |
| Time from resumed acquisition to runnable Pack | 13,070 ms |

The [profile storage observation](storage-observation.json) includes database
overhead, browser preferences, and caches; chunk payload accounting is separate.
The resume phase's larger `cacheBytes` counter also counts runtime rereads of
reconstructed artifacts; it is not a measurement of network bytes saved. The
7,616,727-byte saving is established by the committed pre-restart chunks and
absence of their chunk identities from subsequent network requests.

The requester made zero model-origin or mirror requests. Suppliers were populated
before origin access was disabled. A corrupt contribution was rejected before
the interruption; a supplier departed during recovery. The final model passed
exact token checks and the frozen numerical tolerances. Maximum sampled pooled
and token-vector errors were approximately 0.000512 and 0.000889, below 0.001.
The runtime was served from the installed 0.6.0 candidate. All 549 observed
Doppler runtime files [match their tarball entries](runtime-package-equivalence.json).
Peer model delivery does not establish independence from every software distributor.

## Retained evidence and reproduction

[index.json](index.json) hashes 32 retained files and identifies two externally
hosted weight shards at an immutable Hugging Face revision. The archive includes
the [episode](episode.json), signed non-weight Pack artifacts, reference checks,
license, source bases, and patches for the exact served browser files and proof
entrypoints. The installed runtime is the immutable local Doppler 0.6.0 candidate
with SHA-256 `95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10`,
retained in the [document assistant archive](../document-assistant-2026-09-06/README.md).
It matches clean release revision `09a359a5`. The Reploid source base is `ca710dc`
with the retained patch. The coordinator and reference evaluator still use the
recorded local checkouts. This is not npm publication or independent installation.

The [first attempt](attachments/episode.json) remains failed as recorded. Its
model execution and recovery passed, but the harness incorrectly required a
corrupt rejection in the post-restart phase alone. The correction requires a
real integrity rejection across either phase and preserves the supplier-departure
and full numerical checks. That first report does not include a separate complete
snapshot of its Node coordinator source.

Two successful source-checkout runs are also retained. The earlier one used a
convenience entry file absent from the package. The final run uses the shipped
browser API and serves all Doppler runtime files from the installed candidate;
it does not infer installability from the source-checkout runs.

```sh
npx vitest run tests/unit/retained-peer-pack-episode.test.js
node scripts/verify-peer-pack-execution.js --config /path/to/restart-config.json
```

For a physical rerun, restore the recorded source revisions and patches, restore
the two weights with their exact hashes, and remap paths in `episode.json`'s
`config`. Supply a fresh `restart.profileDirectory`. The source and patch hashes
are part of the reproduction boundary. The offline test verifies retained file
hashes, full operation receipt binding, prior accepted chunk identities, process
replacement observations, and retained failures; it does not rerun the GPU. [Final validation](validation.json) records 2,369
passing repository tests, 35 skipped, and four passing browser tests including
the Verification Worker.

Component: peer Pack acquisition verification. Intent: preserved.
Acceptance evidence: physical episode, retained artifact checks, and browser
custody tests. Boundary effects: whole-process recovery evidence for actual model
bytes; public admission, generic remote jobs, and independent operators remain
separate.
