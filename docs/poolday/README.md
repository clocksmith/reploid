# Poolday specialist-route documents

This folder covers the older hosted coordinator and the research lane on the
specialist routes (`/ask`, `/compute`, `/records`, `/room-1`, `/examples`,
`/experiments`). It does not describe the conversation product at `/`, which the
[glossary](../glossary.md#1-overview) defines along with the name Poolday, and
which the [product specification](../product-specification.md) governs. The
coordinator journeys were retired on 2026-11-26
([what moved where](../critical-user-journeys.md#archived-poolday-coordinator-lanes));
the code remains and is still served on the specialist routes.

| File | What it covers |
| --- | --- |
| [CATSCAN.md](CATSCAN.md) | Component charter for this folder |
| [claims-and-nonclaims.md](claims-and-nonclaims.md) | Claim pointer, nonclaims and network-value rejection conditions |
| [coordinator-protocol.md](coordinator-protocol.md) | Threat model, receipts, reputation, canaries and challenges, policy classes, agent API |
| [p2p-envelope-protocol.md](p2p-envelope-protocol.md) | Signed peer envelopes, relay delivery contract, fault matrix |
| [participation-identity-routing.md](participation-identity-routing.md) | Participation modes, device identity, route decision |
| [artifact-manifest.md](artifact-manifest.md) | Model and adapter custody, origins, delivery controls |
| [complete-pack-jobs.md](complete-pack-jobs.md) | Complete Pack jobs to one peer, including base model plus one signed adapter |
| [document-search.md](document-search.md) | Local document search and reviewed public tasks |
| [biological-sequence-lane.md](biological-sequence-lane.md) | Protein sequence workloads in the coordinator lane |
| [discovery-contract.md](discovery-contract.md) | Research Room Discovery Contract and its implemented subset |
| [../archive/room-1-pilot-charter.md](../archive/room-1-pilot-charter.md) | Archived Room-1 protein annotation adjudication pilot charter (inactive) |
| [receipt-backed-retrieval.md](receipt-backed-retrieval.md) | Retrieval and embedding direction for the research lane |
| [product-intent.md](product-intent.md) | Compatibility links only |
| [remote-operations.md](remote-operations.md) | Pointer; content moved to complete-pack-jobs.md and document-search.md |
| [threat-model.md](threat-model.md), [receipt-schema.md](receipt-schema.md), [reputation-ledger.md](reputation-ledger.md), [canary-and-challenge-policy.md](canary-and-challenge-policy.md), [policy-classes.md](policy-classes.md), [agent-api.md](agent-api.md) | Pointers into coordinator-protocol.md |
