# Installed Doppler incremental streaming

The request formats (`doppler.capsule-operation-request/v1` and `/v2`), display callbacks,
completion evidence and cancellation are documented in the
[browser library README](../packages/reploid/README.md#doppler-generation-and-streaming).
Selecting v2 is explicit (`requestSchema`), the signed peer intent binds it, and a runtime
without Doppler's stream accumulator rejects v2 before execution. The Doppler package Reploid
runs is pinned in [`shared/config/doppler-package.json`](../shared/config/doppler-package.json).

This page keeps the journal and validation details.

The IndexedDB journal upgrades to database version 2. Attempt metadata and signed
responses occupy separate stores. Existing cumulative records migrate in one
transaction without changing message values or order. Provider appends request
`{ snapshot: false }`; explicit claim/replay reads full history. The three-argument
append compatibility API still returns a snapshot and carries its copying cost.
Writer fencing, expiry, retention, bounded storage and corruption rejection stay
mandatory. Browser-managed persistence does not promise survival after eviction.

Validation uses the same installed Doppler archive as its standalone consumer:

```sh
DOPPLER_TEST_CONSUMER=/path/to/candidate/consumer node tests/fixtures/doppler-installed-generation.js
```

That fixture covers settings, stopping, cancellation, adapter replacement, signed
peer retry without re-execution, and replay verification with injected programs.
Its peer message bus and journal are synthetic; it is not a physical model or
WebRTC qualification. Native journal and WebRTC behavior have separate browser
tests in `tests/e2e/peer-pack-jobs.spec.js`, including a before/after copying probe.

*Last updated: November 2026*
