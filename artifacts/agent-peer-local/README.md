# Local installed-agent recovery

[Acceptance record](acceptance.json) and [final journey](2026-09-15T01-15-22-113Z/report.json).

The installed `createReploid()` agent uses the accepted Doppler provider, invokes
an approved public peer task, consumes provisional text over native WebRTC, and
uses its verified result after the provider browser process restarts. The same
signed attempt is replayed. The original provider executes once; the replacement
executes zero times. Replayed progress does not duplicate display text.

This run uses two local Chromium 145.0.7632.6 processes on one Linux computer,
native IndexedDB, and injected model programs through the installed public
Doppler engine. It is contract and recovery evidence. It does not establish
physical model inference, independent peers, answer quality, publication or
deployment. The user deferred publication and deployment.

| Installed archive | SHA-256 |
| --- | --- |
| Doppler 0.6.2 | `4f9689b173ab80f2d664e7006f99dea98e37eb16e6e9d5b831e2902aee6b91b7` |
| Reploid 0.1.0 | `6f12af6f5d7ea31b23917d35eccc2aceacb29416a07af6441b58048d591f7a46` |

Both accepted archives are unchanged. The new code belongs to application
connection/recovery owners, not the accepted library provider. The
[lockfile](checks/installed-package-lock.json), producer fixture digest and
revision, source file digests, signed events, receipt, and accepted output remain
in the records. The fixture is retained in
`../reusable-products-2026-09-14/generation-fixture.json` and stays outside the
runtime package.

## Repairs and retained failures

- `onPrepared` persists validated signed work before connection; failed storage
  prevents delivery. `resumePeerOperationJob` reuses its signature, model pins,
  attempt and deadline. Disconnect ends delivery without signing a cancellation.
- The installed store sorts JSON object keys. The journal previously compared
  binding serialization order and rejected identical signed work after reload.
  Canonical comparison fixes that defect; changed values and array order still
  fail the native storage regression.
- Hosted providers previously exhausted five polls before delayed quorum opened
  reveal. Optional mode sent an early reveal; required mode failed prematurely.
  Both now wait with configured pacing, cancellation and a deadline. Late poll
  results cannot reveal. [Old failures](checks/reveal-before.json) are retained.

The initial harness note is retained at
`2026-09-15T01-05-07-552Z/interrupted.json`; its final report records a fixture
calling `getState()` instead of the public `getSnapshot()`. The next two journey reports retain
stalled recovery. Provider and agent state in
`2026-09-15T01-08-31-371Z/report.json` identify the journal rejection. The following failure records a missing
runtime-service injection in the test's offline verifier. The first passing
journey used an earlier candidate installation; only the two runs beginning
`01-13-43` and `01-15-22` used fresh installs of the exact archives above.

## Validation and reproduction

The [unit report](checks/unit-results.json) records 2,554 passes, 36 existing
skips, and zero failures. The [browser report](checks/browser-results.json)
records 15 passes, covering native journals, complete process replacement,
corruption, writer fencing, WebRTC, and Verification Worker acceptance. Repository
contract checks and declaration checks pass; commands are in `acceptance.json`.

Create a clean npm consumer with a package manifest, then install the two exact
archive paths using `npm install --ignore-scripts --no-audit --no-fund
--legacy-peer-deps`. Copy the retained producer fixture to that directory as
`generation-fixture.json`. From this checkout run:

```sh
DOPPLER_TEST_CONSUMER=/path/to/installed-consumer npm run test:agent-peer
```

Component: Poolday Evidence Runtime; Runtime Infrastructure; Verification Evidence.
Intent: preserved.
Acceptance evidence: linked reports, tests, and contract commands.
Boundary effects: application durable connection/recovery and hosted reveal waiting.

*Last updated: September 2026*
