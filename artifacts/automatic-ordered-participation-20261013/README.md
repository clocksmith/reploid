# Explicit ordered automatic participation source checkpoint

The existing `createAutomaticPartitions` factory now accepts an explicit ordinary `ordered` mode. Hosts supply the actual local stage identity (or `stage: null` for a weightless requester), bounded route policy and the existing loader/network ports. Model geometry comes from the loaded Doppler plan; peer count never determines cuts. Default legacy and canonical modes remain separate.

The owner advertises stage inventory separately from complete entries, pins its actual local stage zero during route selection, and uses the existing bounded route-keyed authenticated network, peer, chat and entry owners. A node can use its own complete entry without RTC-to-self. Each reviewed request retains its route, exact recipients, ordered input and actual disclosure deadline. Healthy channels survive signaling/discovery loss. Stops wait for private attempts before retiring channels and weights; failed cleanup remains charged and blocks replacement until explicit retry. No scheduler or model arithmetic was added.

## Acceptance

`tests.json` records 74 passing tests across seven focused suites. Eighteen new ownership/approval controls cover malformed or throwing loader returns, failed preparation cleanup, all-edge opening rollback, unknown chat/network/resident cleanup, independent input/discovery cleanup, overlapping stop, late preparation, healthy route retention, queued cancellation, caller mutation, full-recipient review and route replacement after approval. `worker.json` records the real GPU-disabled Verification Worker pass, with its complexity/static-pattern warnings retained. Library declaration checking and all 39 component charters pass.

`automatic-ordered-network.test.js` composes four in-process participants through actual automatic discovery, route-keyed network, signed grants, peers, chat and entry. Three hosts load their explicitly assigned stages; the fourth loads no model. Concurrent local-coordinator and remote requests stream through all stages, then settle. There is no RTC-to-self connection, and only two execution-route channels are opened. Disabling peer enumeration does not remove the healthy channels. Certificate verification and numerical stage ports are injected; this does not establish physical authentication, GPU output, process-level shared memory, hardware speedup or model quality.

The initial queued-cancellation test incorrectly awaited cancellation before releasing an earlier same-stage task, and timed out. `initial-queued-cancel.json` retains that harness failure. The final check asserts cancelled work never executes and both attempt owners settle after the earlier lease is released; it does not promise immediate GPU preemption. Independent review also found draft cleanup gaps: malformed loader ownership loss, rollback skipping later edges, and independent networks skipped after failed stop. Those implementations were repaired, with focused regressions; they were not relabeled as acceptable behavior.

## Explicit gaps

This is source/component acceptance. Browser/native automatic host identity composition and source adapter checks remain separate. Cold automatic complementary-stage assignment, demand-driven replicas, physical N-stage execution, installed standard-package/signed qualification, capacity comparisons and cross-process GPU accounting remain open. Hosts still choose the actual local stage before contribution. Existing two-stage physical receipts cannot qualify this new source path. No deployment, package pin, model precision, numerical reference, document treatment or canonical history owner changed.

Component: model partition coordination. Intent: preserved. Boundary effects: explicit ordered composition of existing discovery, loader, network, chat and entry ports; no numerical or history ownership change.

Reproduce from Reploid:

```sh
npx vitest run tests/unit/automatic-ordered-partitions.test.js tests/unit/automatic-ordered-network.test.js tests/unit/automatic-partition-lifecycle.test.js tests/unit/automatic-partition-discovery-lifetime.test.js tests/unit/ordered-partition-network.test.js tests/unit/ordered-partition-chat-entry.test.js tests/unit/ordered-partition-peer.test.js
node artifacts/automatic-ordered-participation-20261013/verify-worker.mjs
npm run verify:library-types
npm run verify:catscan
```
