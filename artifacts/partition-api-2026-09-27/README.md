# Reploid resident partition API checkpoint

Component: Model Partition Coordination, Peer Transport and existing chat host.
Intent: preserved. Boundary effects: public `reploid/mesh` session APIs,
authenticated partition channels, activation-specific thread grants and a borrowed
partition service in the chat host. No Doppler source, deployment or publication.

## Delivered

- Explicit contribution preparation with loading/ready states, descriptor checks,
  resident reuse and per-attempt settlement separate from weight ownership.
- Signed grants binding mesh, model, plan, participants, thread, attempt, expiry and
  allocation limits. B's contribution remains independently approved.
- Existing certificate-bound peer identity verification before dedicated bounded
  binary WebRTC transfer. File custody and partition channels coexist.
- Fixed local A/remote B placement through the existing conversation interface,
  every token passing through both executors. Missing readiness never falls back
  to a complete model or implicit download.
- Isolated concurrent conversations, scoped remembered disclosure, revocation,
  cancellation settlement, history restoration and peer-loss handling. Repeated
  network shutdown waits for the same cleanup, including disconnected endpoints.
- A typed Doppler factory contract and executable per-token/logit comparison
  harness: [handoff](../../docs/doppler-partition-handoff.md).

## Acceptance evidence

- [153 unit tests](unit.log): partition API/runner/receiver/channel, conformance
  harness, chat/session/grants/workspace, identity, swarm and transport lifecycle.
  Command: `npx vitest run` with the 13 test files named in the log.
- [15 signaling/transport checks](swarm.log):
  `node --test scripts/repair-checks/swarm-join.test.js`.
- [22 browser cases](browser.log): `REPLOID_E2E_CHROMIUM_CHANNEL=chrome npx playwright test`
  with partition-chat, partition-data-channel, partition-runtime-delivery,
  release-boundaries and peer-pack-jobs specs, `--project=chromium`.
  The final network-settlement change received an additional
  [four-case rerun](browser-settlement.log) of partition-chat and release-boundaries.
- [Two-tab observations](two-tab-chat.json): real RTC certificate/signature proofs,
  signed grants and binary channels, concurrent streams through the existing UI,
  remembered approvals, revocation, cancellation, host-session history restoration
  and peer loss. The runtime uses injected arithmetic, not GPU inference.
- [17 installed-package checks](package-report.json), [log](package.log):
  `node tests/library-package-acceptance.js`; 145 served assets match package source,
  public imports/types resolve, deterministic browser consumers and worker checks pass.
  Full temporary installation artifacts were moved to `/tmp`; report paths describe
  their original run locations.
- `npm run verify:library-types`, `npm run verify:layers`, `npm run verify:catscan`,
  targeted ESLint and `git diff --check` passed.
- [Registry and generator evidence](registry.log): zero unresolved findings,
  39 component charters and unchanged generated manifests on the repeat run.
  The browser-only openclaw Genesis skip and 18 modules without architectural
  blueprints are existing informational classifications, not unresolved findings.

## Qualification boundary

Doppler's installed candidate supplies plan and activation codecs, but does not
implement the proposed `openResidentPartition` factory. The host accepts explicit
composition; it does not automatically advertise or prepare split inference.
The user owns the Doppler implementation described in the handoff.

No model is newly split-qualified. Numerical parity, actual partial-weight/cache
allocation, selective artifact acquisition and real generated answers still need
that implementation and measured evidence. Allocation descriptors are runtime
claims, not VRAM measurements or hardware attestation. The browser history test
recreates the chat host; it does not prove uninterrupted generation across reload.
Tests use local browser tabs as requested; physical machines remain separate.
