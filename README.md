# Reploid

[![Test Suite](https://img.shields.io/github/actions/workflow/status/clocksmith/reploid/test.yml?branch=main&label=tests)](https://github.com/clocksmith/reploid/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Reploid is a browser runtime for receipt-backed inference and governed
self-modification experiments. Its main product route is Poolday. Zero and X
are separate experimental surfaces with separate state, tools, and evidence.

## Mission, goal, and value

Reploid’s mission is to connect browser computation, review, replication, and
scientific next actions without treating an execution receipt as proof of
truth.

The current goal is a usable Poolday Research Room. A requester submits a
bounded question and sequence, runs an approved browser inference path,
inspects the result and receipt, invites review, and approves the next bounded
action. Contributors can provide browser compute. Reviewers can accept, reject,
correct, or replicate evidence.

The repository serves:

- Poolday requesters, contributors, reviewers, and discovery users.
- Runtime and product contributors working on browser execution and room state.
- Security and claim reviewers checking records, relay boundaries, and evidence.
- Researchers designing the future active-science workflow.

## How to use Reploid

Install and start the local browser surface:

```bash
npm install
npm start
```

Open `http://localhost:8000`. The managed Gemini path requires `GEMINI_API_KEY`
in `.env` before starting.

The available surfaces are:

| Surface | Route | Use |
| --- | --- | --- |
| [Poolday](docs/poolday/product-intent.md) | `/` | Create or resume a Research Room for receipt-backed browser inference. |
| [Zero](self/config/surface-intents.js) | `/zero` | Run the minimal `CreateTool` RSI harness without the Poolday pool. |
| [X](self/config/surface-intents.js) | `/x` | Run the governed Seed → Shadow → Promote self-modification harness. |

Poolday is the public product name used in the documentation model; the public
application remains branded Reploid. Zero and X capabilities do not enter
Poolday unless a Poolday-owned policy, user contract, and promotion proof allow
it.

## Evidence and current surfaces

The [surface claim index](docs/status/surface-claim-index.json) owns the current
support claims and their evidence paths.

| Claim row | Current boundary |
| --- | --- |
| `local-execution` | A configured local executor runs slots in the current browser. |
| `peer-slot-placement` | Opted-in slots may run on joined peers; joining does not expose local inference without a local executor. |
| `browser-provider-roles` | Requesters and providers exchange assignments, outputs, and receipts through peer rooms. |
| `signaling` | Same-browser rooms can use `BroadcastChannel`; cross-host WebRTC uses signaling for rendezvous. |
| `sealed-credentials` | `npm start` can build sealed access windows; client artifacts omit the plaintext key. |
| `public-mesh` | Blocked as a signaling-free claim while cross-host rendezvous requires signaling. |

The current main product provides receipt-backed browser inference. Model
execution and agent state stay in the browser. Compatibility services may handle
authentication, rendezvous, policy enforcement, receipt anchors, and ledger
projections; they do not perform the claimed browser-local model execution.
Users can also provide their own browser inference.

The X surface records three self-modification states:

| State | Mutation | Evidence | Activation |
| --- | --- | --- | --- |
| Seed | Writes recoverable identity, prompt, tools, VFS, objective, and Blueprint `0x00007F`. | Boot manifest | Establishes the restorable self. |
| Shadow | Writes candidates under `/shadow`; `/self` remains unchanged. | RGR traces, scores, receipts, and rollback paths | Candidate remains provisional. |
| Promote | Copies an allowlisted candidate from `/shadow` into `/self`. | Anchored gate, replay result, and candidate hash | Changes the active self; validator mutations remain quarantined. |

## Long-term vision

The long-term research target is a signed, evolving Discovery Contract. It binds
a bounded question, competing hypotheses, uncertainty, candidate actions,
predicted observations, scientific costs, outcomes, and predeclared replication
or closure criteria.

The intended result is a network that can carry a research problem from an
uncertain question to an inspectable next action while retaining the records
needed to review and reproduce the decision. That target does not expand the
current browser-inference claim.

## Limits and status

Reploid does not claim hardware attestation, trustless browser/GPU execution, or
guaranteed honest providers. Relay acknowledgement proves receipt of a relay
record, not execution truth. Poolday, Zero, and X remain separate evidence
authorities. Read the claim index row before repeating a capability statement.

## Repository map

- [`self/`](self/) — boot profiles, VFS, tools, runtime, and self-modification
- [`docs/`](docs/) — product intent, claims, security, architecture, and operator guides
- [`deploy/`](deploy/) — deployment and access-window tooling
- [`doppler/`](doppler/) — vendored or paired Doppler integration surface
- [`showcase/`](showcase/) — demonstrations and recorded runs
- [`package.json`](package.json) — package metadata and local commands

## Read next

- [Documentation index](docs/INDEX.md)
- [Poolday product intent](docs/poolday/product-intent.md)
- [Discovery Contract](docs/poolday/discovery-contract.md)
- [Poolday claims and non-claims](docs/poolday/claims-and-nonclaims.md)
- [Security model](docs/SECURITY.md)
- [RGR runtime contract](self/blueprints/rgr-runtime-contract.md)
- [Tool-surface contract](self/config/tool-surfaces.js)
- [Doppler](https://github.com/clocksmith/doppler)

## License

[MIT License](LICENSE). The package metadata also declares `MIT`.
