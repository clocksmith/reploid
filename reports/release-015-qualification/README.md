# Reploid 0.1.5 + DopplerX 0.1.5 Qualification Evidence

This directory records the physical qualification receipts for `reploid@0.1.5` paired with `dopplerx@0.1.5` (`deploy/artifacts/dopplerx-0.1.5.tgz`).

## Receipts

- [signed-api-and-cancellation.json](signed-api-and-cancellation.json): Signed external HTTP API execution (`/v1/chat/completions` and `/v1/responses`) over WebRTC against an Apple Metal whole-model contributor (`qwen-3-5-0-8b-q4k-ef16-af32-vf16`) with SQLite service-credit settlement. Verifies zero weight files downloaded by the requester (`0`), Turn 1 signed settlement (`"Paris"`, `2` credits settled), Turn 2 prefix-cache reuse (`"Germany"`, `34` cached prompt tokens reused), mid-stream cancellation (`0` unacknowledged tokens charged, `0` open credit holds), and a subsequent independent `/v1/responses` request (`HTTP 200`, conserved zero-sum balances).
- [fresh-browser-conversation.json](fresh-browser-conversation.json): Fresh headless Chromium visit to the product workspace over WebRTC against a live Apple Metal contributor (`0` weight shard requests, `0` weight shard bytes downloaded). Verifies Turn 1 (`"42"`, `placement: "peer-whole-request"`), Turn 2 after provider restart and browser reload using the same Ed25519 identity (`"40"`, `repeatedApprovalModalShown: false`, `1` bound permission record), and Turn 3 after switching capacity to a different machine identity (`freshConsentModalRequired: true`, prompt held until explicit approval, then `"42"`).
- [backend-readiness-and-rollback.json](backend-readiness-and-rollback.json): Verifies `buildCoordinatorRuntimeBundle` source-revision binding (`imageBoundToSourceRevision: true`), fail-closed `/pool/deployment/check` rejection on unbound revisions (`unboundImageRejected: true`), and zero-downtime rollback/roll-forward (`0` dropped probes) while the live `jupiter` Flash contributor (`PID 1575058`) served uninterrupted.
- [peer-transfer-benchmark.json](peer-transfer-benchmark.json): Multi-peer verified piece custody transfer benchmark over WebRTC data channels (`16` verified `512 KiB` pieces = `8 MiB`). Compares 1 supplier (`7.10 MB/s`, `1,182 ms`, `0` duplicate reads) against 2 concurrent suppliers (`57.07 MB/s`, `147 ms`, `8 + 8` piece split, `0` duplicate reads, `8.04x` acquisition speedup) with explicit `receiverBackpressure` telemetry.
- [fleet-27b-readiness.json](fleet-27b-readiness.json): Records `suby` solo memory inspection (`20.94 GB` available RAM vs `29.2 GB` solo `qwen-3-8-27b-text-q4k-ef16-af32` files) and staged split-stage piece inventory (`Stage 0`: `1,051` verified shard ranges / `2.76 GB`; `Stage 1`: `4,461` verified shard ranges / `14.24 GB`). Live two-host `suby` + `bee` execution awaits `bee` returning online over SSH.
- [wire-visibility-audit.json](wire-visibility-audit.json): Reproducible packet- and store-capture receipt ([verify-wire-visibility.js](../../scripts/verify-wire-visibility.js), [wire-visibility.md](../../docs/wire-visibility.md)) proving `0` canary prompt or answer bytes appear in WebSocket signaling frames, DTLS-relayed UDP packets, coordinator stores, or `credits.sqlite`, with fail-closed HTTP `400` rejection on `/pool/peer/rooms` and `/pool/jobs`.

## Reproduction

```sh
npm run build
node scripts/qualify-release-015.js <path-to-qwen-3-5-0-8b-q4k-ef16-af32-vf16> reports/release-015-qualification
```
