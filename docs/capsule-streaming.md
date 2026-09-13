# Installed Doppler incremental streaming

Set `requestSchema: 'doppler.capsule-operation-request/v2'` explicitly on local
Pack execution or a peer request to select incremental events. Omission preserves
the existing v1 contract. The signed peer intent binds this selection; providers
cannot substitute another event format.

The runtime service obtains `createCapsuleStreamAccumulator` from the configured
installed Doppler public entry. A runtime lacking the helper rejects v2 before
execution. Published Doppler 0.6.1 does not contain this candidate's streaming
implementation. Installed acceptance uses a recorded candidate archive, whose
digest is separate from the published package integrity.

Generation partial callbacks receive newly generated `delta.tokenIds` and stable
`delta.text`. Text can be empty while a Unicode byte sequence is incomplete.
Append text updates and batch DOM writes per animation frame. No page reload or
cumulative output reconstruction is required for display. Embedding callbacks
receive one newly completed `delta.item` with its zero-based `itemIndex`.

Local execution, peer requester/provider verification and offline episode replay
each maintain one Doppler accumulator. Completion preserves full output, resolved
settings, stopping reason and execution identity. The existing Reploid model,
adapter, assignment and acceptance checks still apply. An interrupted stream is
not a completion, and cancellation does not interrupt submitted GPU commands.

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

*Last updated: September 2026*
