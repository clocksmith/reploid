# Signed resident host integration

Component: Reploid browser host, model custody and installed Doppler consumer.
Intent: preserved. Boundary effects: host composition can explicitly choose the
existing signed resident factory using pinned custody and release policy.
Computation, qualification and artifact authenticity remain Doppler's owners.

`loadWorkPartition` now accepts an explicitly configured Capsule resident and
never silently falls back to the pinned-manifest path. The ordinary manifest
path remains separately scoped. No current catalog entry, standard Doppler
archive, model arithmetic or deployment was replaced.

The host binds the actual session to its approved executable Capsule identity,
schema, target, model manifest and exact signed piece-index verification. Partial
piece receipts cannot satisfy whole-job verification rules. Current managed
release authorization is checked at admission and around computation; retained
local use cannot authorize delegated execution. Revocation discards output,
including when an operation also fails. Cleanup attempts all owners, preserves
each failure, and concurrent close callers await the same settlement.

The acquisition adapter reuses existing pinned files, verified complete pieces,
local retention, custody grants and bounded transfer slots. Omitted optional
signals are valid; cancellation is checked before returning cached bytes. An
untrusted host range reader cannot authenticate bytes. Signed verification
records are reported separately from source acquisition counters; the session's
piece observation describes opening, not all later execution.

Validation on the final host source:

- 36 focused admission, source and lifecycle tests pass.
- Full repository suite: 3,043 passed, 29 declared skips.
- Three browser checks pass: actual host rejection cleanup, two-tab pinned
  contract delivery, and Verification Worker acceptance of the changed modules.
  GPU memory configuration is stubbed in the admission browser fixture.
- Browser manifest and component charters pass. The linked source hashes and
  compressed raw logs are in [bindings.json](bindings.json).

The exact new Doppler signed selective runtime is independently tested in a
[detached diagnostic package](https://github.com/clocksmith/doppler/tree/main/artifacts/signed-resident-pieces-20261011).
The standard Doppler archive remains SHA-256
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
Its older schema cannot enable this additive signed piece-index feature; a new
qualified ordinary package must pass the existing release gates first.

This completes the host implementation and synthetic contract coverage. It does
not establish real signed-partition inference, numerical qualification, a
successful distributed answer or release acceptance. Physical opening still
needs independently justified numerical results and signed qualifications for
each exact partition and target.
