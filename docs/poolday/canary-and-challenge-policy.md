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

Audit probability should increase for:

- new providers
- high-value jobs
- recent mismatches
- runtime-profile drift
- provider admission changes
- collusion-risk clusters

Failed canaries and failed challenges produce reputation events.
Passing canaries and challenges also produce reputation events.

Canaries should not be easily distinguishable from ordinary jobs.

*Last updated: June 2026*
