# Ordered signed release guard

The host wrapper previously spread the runtime's executeStage method without applying its existing release.assertCurrent guard. Three of four new tests fail on that source (before.txt): ordered execution skips the before/after check, fails to retain simultaneous execution/revocation errors, and executes after revocation while cleanup remains unsettled.

When the runtime exposes executeStage, it now uses the same invocation owner as legacy and canonical methods. Before-dispatch revocation prevents work; revocation during work withholds the result. Errors retain the computation and authorization failures together. closeAttempt and close preserve their existing independent settlement ownership; a failed close remains pending until explicit retry succeeds. Older runtimes without executeStage do not gain a fabricated method.

Tests use injected runtime/release ports, not signed physical GPU execution. tests.txt contains the ordered, canonical and host lifecycle controls. worker.json is the actual Verification Worker result, including warnings. Doppler's public signed-opener correction is independently committed as 1a829fef; neither source checkpoint promotes an archive or qualifies a physical placement.

Component: Model Partition Coordination. Intent: preserved. Boundary effects: ordered runtime methods receive the existing host release check; no additional permission or numerical policy.
