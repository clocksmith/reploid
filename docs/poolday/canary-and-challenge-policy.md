# Poolday Canary And Challenge Policy

Canaries and challenges turn receipts into audit-backed evidence.

## Canary Types

- fixed prompt deterministic output canary
- known token sequence canary
- model-load canary
- runtime-profile canary
- latency sanity canary
- quorum disagreement canary
- delayed challenge rerun

## Challenge Policy

Coordinator-authorized callers create a delayed rerun with:

```text
POST /pool/audits/challenge
{ "receiptHash": "sha256:...", "providerId": "optional-provider-override" }
```

The coordinator loads the prior receipt and source job, then binds the challenge to the original prompt, deterministic generation config, model requirements, expected output hash, expected token hash when present, source receipt hash, and source job id. The challenge is scheduled through the same provider assignment and receipt verification path as a canary.

Audit probability should increase for:

- new providers
- high-value jobs
- recent mismatches
- runtime-profile drift
- provider admission changes
- collusion-risk clusters

Failed canaries and failed challenges produce reputation events.
Passing canaries and challenges also produce reputation events.

Canary and challenge events use distinct event types. Routing quarantine is derived from unresolved failure balance so harmless event reordering or same-millisecond writes cannot change the result.

Canaries should not be easily distinguishable from ordinary jobs.

*Last updated: June 2026*
