# Partition transport checkpoint

Component: Reploid partition coordination and Poolday peer transport.
Intent: preserved.
Boundary effects: public `reploid/webrtc` export `createPartitionDataChannel`,
required host authorization/serving ports, and generated browser delivery.
Doppler computation, application grant verification and conversations remain
separately owned. No deployment or package publication occurred.

## Changes

- A cancellation received before the first step finishes authorization or hashing
  now retains a bounded, identity-bound receiver tombstone. The original regression
  returned a token after cancellation; three added cases failed before repair.
- Partition requests carry binary activation bytes and bounded JSON metadata.
  The receiver authorizes before allocating the payload or acknowledging readiness;
  execution ingress and both result boundaries recheck authorization.
- Dedicated reliable ordered WebRTC channels have explicit frame, payload, pending
  memory, pending request, connection identity, buffering, total application-byte,
  and timeout limits. A serialized writer prevents concurrent buffer waiters from
  oversubscribing the send buffer. Replayed wire headers and malformed geometry
  fail closed. Host exception text is not transmitted.
- Cancelling a delivery aborts its owned signal and rejects the caller. A host
  callback ignoring abort continues to occupy its allocation until it settles.
  Transport cancellation is not GPU settlement. The host explicitly composes
  `PartitionStepReceiver.closeAttempt` for attempt settlement.
- The clean-package Work fixture was stale: its injected session omitted readiness,
  artifact identity and generation-reset members. It now supplies those members
  for the selected fixture model. Production readiness requirements were preserved.

## Evidence

- [56 unit tests](unit.json): 14 binary-channel contracts, 10 receiver cases,
  20 coordinator cases, 6 existing transport lifecycle cases and 6 custody cases.
- [21 browser tests](browser.json), [log](browser.log): actual local-tab WebRTC,
  candidate package delivery, existing peer-job persistence/transport cases,
  Verification Worker acceptance and immutable-bootstrap rejection.
- The new browser test runs concurrent three-step threads through an injected
  receiver, replays a completed step without re-execution, refuses revoked replay,
  cancels one held request while another continues, explicitly settles the retired
  attempt, and rejects pending delivery on peer loss.
- [Transfer receipt](transfer-receipt.json), captured before the final peer-loss
  case: A sent 25,021 application frame bytes and received 3,739. Endpoint counts
  agree; both retained zero payload bytes at capture. These are not SCTP/IP or relay
  byte measurements. SDP was exchanged by the local test harness.
- [Installed-package checks](package-report.json), [log](package.log): all checks
  pass, including matching canonical/installed/served assets, Node/browser public
  imports, declarations, and [seven Work lifecycle cases](package-work-lifecycle-report.json).
  Full temporary package runs are retained under
  `/tmp/reploid-partition-channel-package-runs/` on this host.
- Library types, layer/delivery boundaries, ESLint and 39 component charters pass.
  [Registry validation](registry.log) reports zero unresolved issues; 18 existing
  modules without blueprints remain informational. [Regeneration](idempotence.log)
  left all 140 inspected generated files byte-identical.

Reproduce:

```bash
npx vitest run tests/unit/partition-data-channel.test.js tests/unit/partition-step-receiver.test.js tests/unit/partition-runner.test.js tests/unit/p2p-transport-lifecycle.test.js tests/unit/pool-peer-pack-data-channel.test.js
REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test tests/e2e/partition-data-channel.spec.js tests/e2e/partition-runtime-delivery.spec.js tests/e2e/release-boundaries.spec.js tests/e2e/peer-pack-jobs.spec.js --project=chromium
node tests/library-package-acceptance.js
npm run verify:library-types
npm run verify:layers
npm run verify:catscan
```

## Milestone status

This is real binary WebRTC with injected computation and grant decisions. It does
not deliver a distributed model answer or prove signed host grants. The new
transport is a public library endpoint; existing chat does not yet compose it.
Resident partial Doppler sessions, actual host grant verification, conversation
wiring, real streamed two-tab answers and exact unsplit numerical comparison remain
required. Physical cross-device and capacity qualification remain separate from
this local-tab phase. The prior Doppler GPU RoPE baseline failure is documented in
[the loading checkpoint](../split-chat-local-tabs-2026-09-26/README.md).
