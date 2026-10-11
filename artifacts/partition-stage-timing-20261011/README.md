# Partition waiting and output delivery measurements

Component: `reploid.mesh.partitions`. Intent: preserved. Boundary effects: additive
execution metrics and generated browser delivery; computation and scheduling unchanged.

Each token now records `leaseWaitMs` for this runner's shared FIFO and
`outputDeliveryMs` for the awaited output callback outside that lease. Empty
deltas record zero delivery cost. Existing compute, remote-request and transport
measurements retain their meaning. Fixed-size completion summaries aggregate
both fields; the maximum-token/output control frame still fits existing limits.

A controlled-clock regression holds one compute operation and then its output
callback. The other conversation completes while that callback is blocked. Its
lease wait is measured independently, and callback delay does not inflate the
first conversation's execution timing. Existing cancellation/rejection tests pass.

Validation: 25 focused checks, 2,999 repository tests (29 skipped), 17 installed-
consumer checks including public TypeScript declarations, and one browser journey
with real authenticated WebRTC/grants and injected computation. Browser assertions
verify timing fields survive ordinary conversation composition. Generated assets
match the canonical package. The exact installed test package and results are
retained in `installed-consumer.tar.gz`.

This prepares the missing observations in checklist item 23. No stage overlap
was introduced, and no physical workload has yet established its benefit. The
Mac/Linux run already in progress uses its original source and browser bundle;
it cannot qualify these new timing fields. The Doppler archive remains unchanged.
