# Poolday Product Intent

Poolday is the internal documentation name for the main Reploid product
surface. The public UI uses the Reploid name.

This document owns Poolday's product purpose and boundaries. Exact enabled
models, policies, trust tiers, routes, and transport requirements remain owned
by [`pool-config.json`](../../self/pool/pool-config.json) and the
[browser inference contract](../browser-inference-pool.md).

## Product outcome

A person or agent submits approved work with explicit intent and consent.
Opted-in contributor browsers run the complete approved model through Doppler.
The requester receives a useful result plus evidence that can be inspected,
verified, accepted or rejected, and reduced into policy and reputation state.
For the public protein lane, signed submissions, results, human claims,
corrections, and review decisions form a room-scoped evidence network.

The immediate public value is:

```text
get a result you can inspect and govern
```

The approved supporting claim is:

```text
receipt-backed, audit-backed, reputation-backed, policy-controlled browser inference
```

The receipt is evidence about an assignment and its declared execution
artifacts. It is not proof of honest browser code or hardware-attested GPU
execution.

## User roles

| Role | Product job |
| --- | --- |
| Requester | Submit admitted work, inspect the result and evidence, then accept or reject it. |
| Contributor | Opt in an eligible browser and execute assignments under declared capacity and policy limits. |
| Agent | Request, verify, accept, and budget work through the same contracts. |
| Reviewer or curator | Attach separately signed human claims, sources, corrections, confidence, experimental context, and bounded follow-up proposals. |

Contributors earn points only after accepted work. Participation does not grant
publisher, adapter-creation, or policy authority.

## Product principles

1. Lead with the useful result. Receipts, peers, hashes, and routing explain why
   the result is accountable.
2. Bind every result to the assignment, exact model artifacts, workload,
   runtime profile, policy, route, provider signature, and requester decision.
3. Keep execution consent explicit. A browser contributes only after its owner
   opts in and advertises bounded capacity.
4. Make additional participation improve availability, payload delivery, or
   redundant comparison. Peer count has no product value by itself.
5. Fail closed when model, artifact, workload, identity, policy, or receipt
   evidence does not match.
6. Keep experimental RSI evidence separate from Poolday product evidence until
   a capability passes the promotion boundary below.
7. Keep model facts and human claims separate. A human annotation is attributable
   evidence, not a model output, and earns evidence credit only after independent
   acceptance.

## P2P boundary

P2P is infrastructure. It supports provider discovery, direct payload transit,
availability, and quorum comparison. It is not the product claim and does not
turn Poolday into a decentralized compute marketplace.

Servers may provide authentication, rendezvous, compatibility coordination,
public anchoring, or rebuildable projections. They do not perform the claimed
browser-local model execution. The target control plane makes those services
optional in the normal work path without changing the receipt contract.

## Current product boundary

- Poolday is the main Reploid product surface.
- The configured launch model is the enabled ESM-2 35M protein-sequence model.
  The exact model, manifest, tokenizer, artifact, workload, and runtime identity
  come from `pool-config.json`.
- Public Poolday sequence work accepts only explicitly public protein sequences.
  It returns model outputs and evidence, not biological or medical
  interpretation.
- Each selected provider loads and executes the complete model. Poolday does
  not claim tensor, layer, attention, or KV-cache sharding.
- The public protein collection supports exact-contract flat similarity,
  evidence-aware reranking, deterministic clustering, text search, and
  approval-gated discovery tasks. Poolday is not a managed vector database.
- Poolday supports signed human review of public protein evidence. It is not a
  biological interpretation or diagnosis tool, and submitted human claims do
  not become model facts.

See the [claim boundary](./claims-and-nonclaims.md),
[biological sequence lane](./biological-sequence-lane.md), and
[retrieval direction](./receipt-backed-retrieval.md) for the corresponding
supported behavior and promotion gates.

## Reploid surface hierarchy

Reploid contains three browser surfaces with separate authority:

| Surface | Role now | Evidence boundary |
| --- | --- | --- |
| Poolday `/` | Main product surface for governed browser inference and participation. | Poolday assignments, routes, receipts, agreement, requester acceptance, points, and reputation. |
| Zero `/zero` | Experimental minimal RSI harness for growing capabilities from a small self and constrained tools. | Zero-local tool, state, verification, and recovery evidence. |
| X `/x` | Experimental governed RSI harness for self-modification, validation, swarm work, promotion, and rollback. | X candidate, validation, promotion, quarantine, replay, and rollback evidence. |

Zero or X evidence never substantiates a Poolday claim by itself.

## Long-term promotion boundary

Zero and X are discovery engines for automation, self-improvement, and new
capabilities. The long-term goal is governed integration into the main Reploid
product, not permanent isolation.

```text
Zero/X experiment
  -> evidence and verification
  -> human approval and rollback coverage
  -> Poolday-owned policy and user contract
  -> Poolday operational proof
  -> governed product capability
```

Before promotion, the behavior remains experimental. After promotion, Poolday
must support the capability through its own configuration, admission rules,
receipts, tests, and user-visible evidence.

Broader corpus indexing, private retrieval, ANN infrastructure, and autonomous
research action remain future directions. The supported evidence-network path
is public, room-scoped, exact-contract, local-first, and human-approved.

## Authority order

| Question | Canonical source |
| --- | --- |
| Why Poolday exists and how it relates to Zero and X | This document |
| Exact enabled model, policy, trust, and transport configuration | [`pool-config.json`](../../self/pool/pool-config.json) |
| Current runtime, peer, coordinator, and deployment behavior | [Browser inference contract](../browser-inference-pool.md) |
| Supported public language and nonclaims | [Claims and nonclaims](./claims-and-nonclaims.md) |
| Work queue and proof state | [`self/pool/TODO.md`](../../self/pool/TODO.md) |

Cross-project strategy may frame markets and future products, but it does not
override these project-owned sources.

---

*Last updated: August 2026*
