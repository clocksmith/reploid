# Peer reconnection error ownership

Component: browser runtime host (`self/host/work-swarm.js`). Intent: preserved.
Boundary effects: transport events to application status; no transport, runtime,
permissions, placement or numerical changes.

## Reproduction and repair

Both public browser contributors reported Ready with the retained message
`Peer connection unavailable; check the invitation route and ICE/relay configuration`.
Their native counterparts were ready with zero active and unsettled reservations.
That observation alone does not establish recovery of every browser channel.

The focused regression establishes a host defect: after
`swarm:connection-failed {peerId: 'peer-a', message: 'Peer A unavailable'}`,
`swarm:peer-connected {peerId: 'peer-a'}` left that error unchanged.
The host copied a peer-specific event into a global string and ignored its
identity when the connection recovered.

The host now keeps the latest transport failure separate from operation errors.
Only reconnection of its recorded peer clears that failure. Another peer's
connection cannot clear it, and peer recovery cannot clear bootstrap or
contribution cleanup failure. Explicit reconnect/disconnect retires the old
transport warning. This does not claim all connected peers can execute requests.

## Validation

- `npx vitest run tests/unit/work-swarm-lifecycle.test.js
  tests/unit/work-partitions-lifecycle.test.js
  tests/unit/automatic-partition-lifecycle.test.js`: 65 passed.
- Original failure retained in `regression-before.log`; repaired run in
  `regression-after.log`.
- Actual classic Verification Worker: passed, warnings retained in
  `worker-verification.json`.
- Chromium desktop/phone-width chat rails and chat-workspace suites: 12 passed;
  `browser-checks.log`. These use interaction fixtures, not physical inference.
- Browser manifest: 1,909 served files,
  `sha256:5be2d8f1e10ddd9467b09b40ce7dbbdc2e1898952f8d988e0f5b2d590a225325`.

The accepted Doppler archive is unchanged. Numerical, signed physical opening,
complex document quality and simultaneous long-conversation acceptance remain
open. No complete release qualification follows from this host repair.
