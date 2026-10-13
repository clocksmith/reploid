# Ordered ordinary grant boundary

Component: model partition grants. Intent adds explicit v4 ordinary coordinator-mediated disclosure. Existing v2 ordinary and v3 two-stage canonical signatures retain their schemas and behavior.

A v4 signature binds the complete immutable route/attempt, stage-zero coordinator, every activation observer path, token recipients, output recipients, generation digest, bounds and lifetime. Issuance requires the caller's explicit complete disclosure object, not an automatic upgrade of earlier approval. Execution and disclosure recheck exact stage/edge/recipient scopes. Revoked or expired grants can only settle the same signed stage identity; they cannot execute. Closing authority denies further verification.

`before.txt` preserves absent implementation. `old-test-generation-hash-failure.txt` preserves a test setup mismatch after the runner switched to Doppler's public generation hash; the integration test now uses that provider port. No runtime or grant validation was weakened to accept the old hash.

`after.txt` records six new controls and 42 legacy API controls. Actual WebCrypto signs/verifies v4 through the existing ordered runner with injected numerical stages. Mutation during signing, missing relay observers, changed resident identity, incorrect edges, changed budgets, expiry/revocation and tampering are rejected. `worker.json` is the actual Verification Worker result, with warnings; `types.txt` records declarations validation.

This is source protocol composition, not physical N-stage inference, distributed trust, publication, shared-device accounting or efficiency proof. The coordinator sees the declared intermediates. Direct adjacent-only payload routing remains a separate extension. No GPU, accepted package pin or served delivery changed.
