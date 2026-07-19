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

Reploid does not decide that an adapter is good enough to use. Authority remains
split:

```text
Columbo / Tinker     creates a candidate adapter
Gamma                evaluates and selects under a frozen contract
human promotion      approves the exact candidate
Doppler              verifies compatibility and executes it
Reploid              publishes, routes, transfers, activates, and revokes it
```

An adapter becomes routable only after its bytes, Doppler parity receipt, Gamma
selection receipt, human-promotion receipt, signed publication, and exact base
model are present. Revocation removes it from routing without rewriting prior
receipts.

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

## Model-shard boundary

Every provider still loads and runs the complete selected model. Model manifests
and shards come from pinned artifact hosting and are cached locally by Doppler.
The shard-negotiation module can verify that a provider has an exact manifest
and shard set before dispatch, but the current live peer-room path does not
relay base-model shards between browsers. Adapter chunks do have a verified
peer-transfer path. Poolday does not claim tensor, layer, attention, or KV-cache
sharding.

