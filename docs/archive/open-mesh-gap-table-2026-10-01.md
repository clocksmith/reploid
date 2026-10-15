# Open-mesh gap table, 2026-10-01 (archived)

Archived on 2026-10-15 from [the architecture document](../open-mesh-architecture.md#2-what-exists-and-what-is-missing)
because its rows are obsolete and distracted from current ownership. It records the
implementation gaps observed against design baseline `7f3f91d7` on 2026-10-01. It is
history, not current status; the owner's private roadmap register holds current status.

| Boundary | Inspected implementation | Required delta |
| --- | --- | --- |
| Chat ownership | `packages/reploid/src/chat/` owns threads, grants, attempts and scheduling | Connect all execution paths through the same lifecycle and durable history |
| Application composition | `self/ui/pool-home/index.js` constructs `createChatSession` without its `partitions` port | Install a host-owned mesh coordinator and supply its partition execution port |
| Discovery | Automatic public bootstrap exists; `swarm-bootstrap.json` uses a public namespace with a 64-peer room ceiling | Discover beyond one room through bounded peer sampling and paged capability lookup |
| Whole-request execution | Normal chat uses prepared peer providers and Doppler | Complete actual-model acquisition/generation/failure acceptance |
| Model custody | Signed transfer, supplier fallback, verified files, OPFS staging and `createPieceAcquisition` exist | Connect the piece acquisition API to normal chat, Doppler's pinned piece index, complementary retention and repair |
| Storage bug | Whole shards are reread during preflight/weight loading; under a small quota repeated acquisition can exhaust transport/supply limits | Correct staging accounting; then move runtime range reads to independently authenticated pieces |
| Partition execution | Resident, runner, entry, grants and binary transport APIs exist | Automatic preparation, placement, catalog readiness and ordinary-page composition |
| Doppler delivery | Whole-model browser runtime is 0.6.2; installed/partition candidate is 0.6.3-dev.split.1 | One immutable package and browser delivery with matching public APIs |
| New Doppler source | Sibling source exports manifest residents and verified piece storage | Package, contract-test and integrate these exports; source existence is not delivered compatibility |
| Proof | Same-machine diagnostic partition evidence exists; latest normal-page P2P model test failed during loading | Public API, physical-device, origin-loss, combined-capacity and recovery evidence |
