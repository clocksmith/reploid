# Stable browser delivery during physical tests

Component: `reploid.tests`, `reploid.server`. Intent: preserved.
Boundary effects: the existing proxy accepts `REPLOID_STATIC_ROOT`; default
application serving is unchanged. Model execution and delivery bytes are unchanged.

A physical acceptance run served a mutable checkout while the assistant rebuilt
its browser assets. Its corrected record is retained in
[the reversed-run report](../reverse-recovery-20261011/README.md).

The physical runner now invokes the existing Hosting packager into an owned
temporary directory, checks the expected bundle identity, serves every browser
entry and asset from that directory, and removes it after browser/server cleanup.
The packager writes the bytes it validated instead of rereading changing source.
No binaries are rebuilt. Hosted deployment checks retain their separate scope.

Validation:

- A regression changes source and descriptor after validation, before output
  creation; the packaged bytes retain the original validated identity.
- An HTTP integration starts the real proxy and checks conversation, substrate,
  passport, design, audit, reset, pool assets, descriptor and shader routes.
  Missing files do not fall back to the checkout. Pool authorization is preserved.
- The real 1,900-file Hosting payload was packaged and independently rehashed
  against its descriptor. `verification.json` records the unchanged identity.
- `npm test`: 3,000 passed, 29 skipped; complete log retained.
- Syntax, diff and browser-manifest checks pass.

The focused two-host recovery run already in progress predates this harness
change. Its assets were held fixed manually; it does not exercise the new
snapshot mechanism. No numerical, task-quality or deployment gate is closed here.
