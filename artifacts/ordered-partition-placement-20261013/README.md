# Ordered route selection

Component: model partition coordination. Intent deliberately extends the existing two-stage owner with an explicit ordered route; legacy placement/discovery behavior remains unchanged.

The source contract snapshots complete route/attempt identities before asynchronous hashing. It binds the provider's exact v3 plan hash, activation representation and each ordered participant/transport/resident/execution identity. A changed route cannot reuse an existing reservation. Adjacent edges derive from stage order; selection is not authorization.

Selection filters exact model/plan/layout/readiness/capacity/expiry before deterministic bipartite matching. Host-supplied peer, stage, inventory and search-step limits bound work. It does not enumerate replica combinations or claim optimal cost. The distinct-owner requirement identifies logical participants, not independent physical devices. Existing discovery admits v2 inventories only with an explicit stage-offer bound; its legacy index guard remains intact.

Validation: `before.txt` retains the missing-implementation failures. `after.txt` covers 20 tests: 2/3/4/7-stage replicas, a greedy-selection counterexample, missing middle stages, 100 multi-model peers, bounded search, immutable identities, and actual reservation retention. Twenty synthetic requests over twelve three-stage replicas occupy sixty slots with five per owner; this proves bookkeeping, not that sixty states fit GPU memory. The parent-owned runner has separate traversal/cleanup evidence in `ordered-route-runner-20261013`.

`provider-check.js` uses the actual sibling Doppler v3 public plan functions for uneven 24-layer splits and records source hashes in `provider-check.json`. It performs no model computation. `worker.json` records the actual Verification Worker result; warnings are retained. Types and charter checks are retained separately.

Still required: authenticated peer and host integration, authoritative route-wide grants/reservations, actual resident execution and physical qualification. Shared physical-device accounting, demand preparation, fairness across independent runner instances and performance ranking are not established here. No runtime pin, signed delivery, deployment or GPU process changed.
