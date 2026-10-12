# Native cold execution and the ordinary request deadline

Component: partition execution through the bounded transport.
Intent: preserved. No timeout, grant, package pin or provider policy changed.
Boundary effects: native preparation must qualify within the ordinary application contract.

The exact Doppler 0.6.28 diagnostic archive is
`102fd0c4900c6744fb7d103a4b3609365b57e8538657bd47b8dfd8e7ac3469e7`.
Both short native/browser placements returned correct logits and settled; see
[the physical receipts](../native-partition-0.6.28-20261012/README.md).
Those controls used the diagnostic controller's 20-minute operation bound, not
ordinary peer RPC. They do not establish responsive cold native chat.

## Observed producer and application consumer

In direction 0, the native layer-12 convolution was submitted at
`2026-10-12T21:45:55.308Z`. The first completed output was observed in the output
file at `2026-10-12T21:59:22.508Z`. Thus that step was already active for at least
807.200 seconds after the observed submission. Its exact request start was not
instrumented. Controller start to output was approximately 916.508 seconds,
including setup. These are different measurements.

The ordinary configuration in `self/config/partition-policy.json` sets:

- execution-channel request timeout: 300,000 ms;
- requester input-channel timeout: 900,000 ms;
- authorization grant lifetime: 900,000 ms.

`automatic-partitions.js` passes `config.executionChannel` to
`createPartitionPeer`, which passes those limits to `createPartitionDataChannel`.
Each `request` installs its timeout before sending. Expiry rejects with
`REQUEST_TIMEOUT`, sends cancellation and explicitly does not claim confirmed
remote cleanup. The relevant native execution therefore exceeded the ordinary
stage allowance by at least 507.200 seconds. This source trace predicts rejection
if that same delay occurs over ordinary RPC; the diagnostic did not reproduce an
ordinary RPC timeout physically.

Both the current policy and the isolated candidate browser policy hash to
`5a6f974f34b1cba00aff269857c3fe53728782317477bede684a0e11f2b6a235`.
The isolated candidate is
`/var/tmp/reploid-candidate-0.6.28-browser-20261012`.

## Remaining owner investigation

Reverse placement returned first output after 23.148 seconds from controller
start, but persistent compilation/driver cache state was uncontrolled. Neither
that difference nor the last submitted convolution establishes which compiler,
driver, pipeline or execution stage caused the long delay. The separately frozen
[preparation observer](../pipeline-preparation-observation-20261012/README.md)
can distinguish pending shader and pipeline construction from dispatch in a
subsequent reserved physical run. It was not injected into either finished run.

The repair must address the measured preparation/execution owner. Increasing the
ordinary deadline would not establish that repair. No responsive-chat or
complete-native-release acceptance is closed by this receipt.

## Validation

At Reploid `3cf951e11e1eb8eb11c21dfa709bd569cedfedc9`,
`npx vitest run tests/unit/partition-data-channel.test.js` passed 20 tests.
These include timeout/peer-loss error semantics, retaining uncooperative work
against budgets and isolating another request. They are CPU transport controls,
not physical inference or compilation measurements.
