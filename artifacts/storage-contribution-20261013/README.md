# Independent bounded file participation

Source: `e8258bc7` (host/UI integration), following `563f5351` (transactional acquisition accounting and supply settlement).

Component: Reploid browser host and artifact custody. Intent preserved: separately approved file contribution, compute, and conversation execution. Boundary effects: the existing chat/swarm ports forward explicit file mode and allowance; no Doppler computation or runtime pin changes.

## Behavior

- Cached only: authenticate retained manifest/index metadata and verify local pieces. Rebuild inventory after reload, including pieces recoverable from a cached whole shard. Missing metadata fails unavailable; missing pieces are omitted. Supplier reads never fall back to origin, in any mode; eviction withdraws availability.
- Bounded acquisition: select complete authenticated pieces within the configured 64 MiB subset ceiling and separately approved cumulative download allowance. The host uses exact HTTP ranges or existing signed peer custody. It rejects an origin that ignores the range and rejects altered payloads. File sharing does not enable partition compute.
- Full-model seeding: an explicit separate mode, with storage and remaining-download preflight. It retains whole-file acquisition. The default approved acquisition allowance is 64 MiB; the configured maximum is 4 GiB. Full seeding must be approved with sufficient allowance.
- Download accounting uses the existing strict IndexedDB transaction machinery in a separate acquisition ledger. Reserve the declared artifact payload or requested chunk before transfer. Manifest/index payloads, failed attempts, cancellation after reservation, and retries consume the allowance; verified cache/checkpoint hits do not. This is conservative requested-payload accounting, not a measurement of HTTP/TLS/WebRTC control overhead or physical network usage. Existing storage/upload limits remain separate.
- Reload, reconnect, another tab, stopping, or changing modes never resets consumption. Existing caps are immutable; changing modes cannot increase an existing grant. No renewal feature is introduced. Cache-only reads can display an existing ledger without creating a new acquisition grant.
- Stop aborts only storage-owned acquisition and supply, withdraws offers, and awaits their settlement. It leaves the conversation and unrelated acquisitions running. Incurred reservations remain recorded.

## Passing evidence

[evidence.json](evidence.json) binds source files, the accepted Doppler pin, generated library manifest, browser cases, and runner version. [origin-receipt.json](origin-receipt.json) records the real catalog identity, requests, inventory and durable accounting.

- 116 unit tests passed; one optional installed signed-reader test was skipped because its separate package was not selected.
- 16 Chromium checks passed, including the real Verification Worker sandbox.
- The real-origin check acquired one 4,194,304-byte Qwen 3.5 0.8B piece plus the 214,203-byte pinned manifest and 34,258-byte piece index: exactly 4,442,765 reserved bytes. Its exact range was `bytes=0-4194303`; integrity verification and stopping passed. No compute was opened.
- Browser fixtures use real OPFS, strict IndexedDB, the installed piece-index validator, cryptographic hashes, and chat workspace. They verify contribution while an injected conversation is active, stop without chat cancellation, restored inventories/consumption, cache-only zero downloads, competing host tabs, failure/retry charging, range rejection, corrupt-piece rejection, full-model choice, and cached whole-shard recovery.
- Signed peer-transfer controls use the actual custody protocol owners with injected channels. They cover reservations before payloads, free checkpoint hits, failed chunk attempts across suppliers, failed reservation rejection, and supply settlement independent of acquisition.

The first fixture run exposed missing `provider: 'doppler'` in its synthetic chat model and missing required cancellation signals in two new custody tests. Those harness inputs were corrected; the production assertions were retained. A review also found that the old synchronous `stopSupply` did not expose pending supply settlement; the existing owner now does, with a regression assertion.

`npm run sync:library` also refreshed pre-existing stale generated chat/ordered-partition copies to their already committed canonical sources. All 209 generated library files and their manifest hashes match their owners. Ordered disclosure/activity regression tests are included in the unit count. This regeneration does not promote the browser bundle or change Doppler 0.6.27.

## Reproduce

```sh
npx vitest run --config tests/vitest.config.js \
  tests/unit/custody-exchange.test.js tests/unit/network-controls.test.js \
  tests/unit/chat-session.test.js tests/unit/work-partition-capsule-source.test.js \
  tests/unit/work-swarm-lifecycle.test.js tests/unit/chat-thread-grants.test.js \
  tests/unit/chat-ordered-thread-grants.test.js tests/unit/partition-summary.test.js \
  tests/unit/automatic-ordered-partitions.test.js tests/unit/automatic-ordered-network.test.js \
  tests/unit/automatic-ordered-isolation.test.js

REPLOID_STORAGE_ORIGIN_CHECK=1 npx playwright test --config tests/playwright.config.js \
  tests/e2e/custody-budget.spec.js tests/e2e/storage-contribution.spec.js --project chromium
```

Omit `REPLOID_STORAGE_ORIGIN_CHECK=1` to skip the explicitly bounded real model download. Each browser test uses an isolated storage context.

## Limits of this evidence

The chat execution in the storage lifecycle tests is injected. The real download check uses real model bytes with a transport fixture, not a live mesh or GPU conversation. These results do not qualify installed signed inference, Safari, arbitrary supplier/NAT conditions, or the complete distributed-chat release. REP-4/REP-5 retain their broader ordinary installed-journey acceptance. No deployment occurred.
