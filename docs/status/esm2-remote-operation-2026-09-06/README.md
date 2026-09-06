# Actual model execution over the common peer-job interface

An internally operated requester browser sent an explicit public ESM-2 operation
to another browser over WebRTC. The provider had reconstructed the signed Pack
and all 24 dependencies from peers with origin and mirrors disabled. It executed
the real model through `openPack().executeOperation()`, returned its signed
assignment-bound result, and the requester verified and signed acceptance.

The fixture deliberately discarded the first completed response before transport
delivery. The requester resent the identical signed job. The provider replayed
its retained signed response and **executed that remote job once**. All eight
frozen source-reference checks passed on the remotely returned output. The
completed response exceeded 256 KiB and crossed the bounded frame transport.

| Measurement | Observation |
| --- | --- |
| Remote job deliveries | 2 |
| Remote model executions | 1 |
| Deliberately dropped completed responses | 1 |
| Request to accepted result, including the delivery retry | 2,044.6 ms |
| Request application bytes, including retry | 65,970 |
| Accepted response application bytes | 276,157 |
| Request channel frame bytes, including retry | 66,122 |
| Response channel frame bytes | 276,290 |
| Model acquisition to runnable Pack | 13,310 ms |
| Model download bytes, including rejected contribution | 134,553,465 |
| Accepted duplicate model bytes | 0 |

The earlier local control execution is separate from the one remote execution.
The runtime and weights were already loaded before the remote request; the
2,044.6 ms measurement is not cold startup or a pure inference benchmark.
Application and frame accounting exclude SCTP/IP overhead. A corrupt model
contribution was rejected and a supplier disappeared during acquisition.

The requester comparison policy froze a full-vector output from the previously
retained [browser restart episode](../esm2-process-restart-2026-09-06/README.md).
That same-machine baseline is not independent numerical qualification. The
separate eight-check source oracle uses the unchanged CPU reference: sampled
maximum errors were 0.000512 pooled and 0.000889 token embedding, below 0.001.
The episode does not establish full-vector CPU equivalence.

This is one operator, one physical AMD computer, and browser contexts sharing
that hardware. It does not demonstrate unrelated operators, separate networks,
remote process-restart deduplication, immediate GPU cancellation, independent
installation, public catalog admission, useful history, or return usage.

## Reproduction and retained failures

[index.json](index.json) hashes 34 retained files and names two unchanged weight
shards at an immutable Hugging Face revision. [episode.json](episode.json) includes
the signed request, operation receipt, update, acceptance, byte accounting,
reference results, model acquisition evidence, and served source hashes.
The source patches cover the served browser code and coordinator at Reploid
base `1b507d8` and Doppler release base `09a359a5`.

All 549 served Doppler runtime files
[match their installed package entries](attachments/runtime-package-equivalence.json).
The executed candidate tarball is SHA-256
`95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10`, retained
in the [document assistant archive](../document-assistant-2026-09-06/README.md).
It is not a published npm version.

The [first failed run log](attachments/attempt-01.txt) records a harness deadline
and an unobserved promise rejection; no complete episode was written. The
[second](attachments/attempt-02.json) and [third](attachments/attempt-03.json)
reports remain failed. The third captured duplicate provider construction in the
fixture's channel-open handler, which attempted overlapping use of one Pack
executor. The runtime rejected it. The final fixture installs the handler once.
The final run also adds rejection of re-signed duplicate attempts. The earlier successful run is retained as `attachments/attempt-04.json`. The final successful patch is retained; earlier failed attempts have source hashes
and reports, not separate complete source patches.

```sh
npx vitest run tests/unit/retained-peer-pack-episode.test.js
node scripts/verify-peer-pack-execution.js --config /path/to/config.json
```

Restore the source bases and patches, the exact two omitted weight shards, and
the installed runtime candidate. Remap paths in the episode configuration to
those files. `remoteOperation.referencePath` must point to the retained
`attachments/remote-reference.json` with its recorded hash. The offline test
recomputes signatures, event chains, request/output bindings and frozen
comparison at the original signed acceptance instant. It does not rerun the GPU.

Component: complete Pack peer jobs. Intent: preserved.
Acceptance evidence: retained physical episode, offline archive verification,
unit failure tests and browser WebRTC tests. Boundary effects: generic explicit
public delegation now reaches actual signed Pack execution; public admission
and independent-machine proofs remain separate.

*Last updated: September 2026*
