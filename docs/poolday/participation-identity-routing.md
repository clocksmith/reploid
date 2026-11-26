# Poolday Participation, Identity, and Routing

Poolday separates permission to use the network from permission to contribute
resources. The browser stores one participation profile with three modes:

| Mode | Allowed role |
|------|--------------|
| `request` | Submit inference requests |
| `contribute` | Advertise an eligible local Doppler runtime and execute assignments |
| `both` | Request and contribute under the same device root |

The signed profile also limits concurrent runs, output tokens, adapter-cache
space, artifact relay, result verification, and the bandwidth value used to
rank artifact transfers. Publisher and adapter-creation capabilities are off by
default and are not implied by contribution.

## Identity

The browser creates an ECDSA P-256 device root. IndexedDB-capable browsers store
the private key as a non-exportable `CryptoKey`; the explicit fallback is an
exportable local browser key and is labeled as weaker protection. The device
root signs short role delegations for requester, provider, publisher, and
verifier keys. Every delegation binds the active participation-profile hash.
The device root lives in one browser profile on one device. Clearing site data
or switching browsers creates a new root; there is no cross-device sync, and the
device root by itself makes no user-verification claim.

A user may bind the device root to a WebAuthn passkey. A fresh passkey assertion
then accompanies role delegation. This proves possession of a registered
credential and continuity with its prior activity. It does not prove one human,
prevent identity cloning before enrollment, or make Sybil identities expensive
by itself. Reputation, rate limits, attestations, and endorsements remain
separate controls.

Peer-room messages and hosted coordinator requests verify the same profile and
delegation contract. Claims are rejected when the role key, role identifier,
device root, capability, profile hash, or advertised limits disagree.

## Artifact authority

Reploid does not decide that an adapter is good enough to use. The split of
authority and the evidence an adapter needs before it becomes routable are in
[Trained adapter promotion](../trained-adapter-promotion.md#authority).
Revocation removes an adapter from routing without rewriting prior receipts.

## Route decision

Routing first rejects incompatible candidates, then ranks the remainder. The
order is:

1. Exact model, manifest, runtime, backend, workload, and adapter identity.
2. Valid peer signature, participation proof, runtime profile, and policy.
3. Signed token, concurrency, and adapter-storage limits.
4. Active adapter, verified cache, then fetchable adapter.
5. Capacity, evidence history, transfer duration, expected latency, point cost,
   and a deterministic tie-break.

The route decision records every candidate, rejection reasons, selected
providers, and artifact source. Its hash is bound into each assignment,
adapter-acquisition record, peer transfer, and inference receipt. A receipt with
a different route hash cannot enter agreement.

## Pieces, partitions and routes

Stored model pieces, split computation and replicas are defined in the
[glossary](../glossary.md#terms-used-in-code). Which routes run a whole model on
one computer and which split it across stages is in the product specification's
[route table](../product-specification.md#5-contribution-and-execution).
Adapter chunks have a verified peer-transfer path.
