# Canonical contributor allocation

Component: Model Partition Coordination. Intent preserved: the contributor delegates canonical policy and transitions to an explicitly injected Doppler provider, using the existing reservation/FIFO/cancellation/settlement owner. The accepted legacy provider is unchanged and canonical use rejects when unsupported. Boundary effects: optional resident factory/session capability, with no RPC or publication integration yet.

`DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler node tests/canonical-resident-source.js` passes against source533affca. This CPU control uses the actual policy resolver and injected runtime sessions; no GPU executes. It covers allocation forwarding, exact generation/descriptor bindings, unsupported runtime refusal, both stage routes, commit queuing behind numerical settlement, cancellation, cleanup and legacy isolation. The new source test has no accepted-package claim.

Before fixing production, the initial fixture used the activation fingerprint for a generation descriptor, so it failed the existing identity guard. `initial-fixture-digest-failure.log` retains that harness error. After correcting the fixture to the actual descriptor hash, `before.log` records the real dropped-allocation failure. `after.log` passes.

Existing partition API/runner suite:65 tests passed. Package declarations and charter validation pass. Actual Verification Worker passes production source with6 warnings; exact source hashes are in `worker.json`. Library mirrors and browser manifest were regenerated; no pin, catalog, deployment, or canonical capability activation changed. Signed stage evidence and durable publication remain subsequent integration work.
