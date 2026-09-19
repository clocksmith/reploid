# Reploid

[![Test Suite](https://img.shields.io/github/actions/workflow/status/clocksmith/reploid/test.yml?branch=main&label=tests)](https://github.com/clocksmith/reploid/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Reploid is an evolving problem-solving agent for humans and other agents. It
pursues useful outcomes through authorized models, tools, observations, and
revision, and develops improvements to its own methods under independent
evaluation. It remains useful without peer participation.

Zero is its minimal starting configuration; X extends Zero with explicit
capabilities and supporting blueprints. Poolday supplies optional discovery,
artifact exchange, bounded peer computation, recovery, and reusable experience.
Evaluation, approval, and activation are separately authorized roles.
Change Passport remains an inactive alternative; Research Room-1 is an optional
scientific workflow with its own evidence and admission requirements.

## Who uses it

Repository mission, value, and durable strategy live in [GOALS.md](GOALS.md).
Poolday's user workflow and evidence boundary live in its
[product intent](docs/poolday/product-intent.md).

The repository serves:

- Humans and agents pursuing bounded goals through authorized tools and models.
- Experimenters testing capability acquisition and recursive improvement in Zero or X.
- Public protein catalog curators testing a disputed family or domain annotation.
- Research Room requesters, compute contributors, and accountable reviewers.
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

Start with a task and choose local Qwen 3.5 2B or the configured Gemini cloud
model. Optional controls enable helper agents, approved peer requests, and tested
tool improvements. Network connects participating devices; Improve shows
candidate code, test comparisons, adoption, and rollback. Try **Improve a tool**
for the registered JSON formatter. See the [workflow and its limits](docs/work-collaboration.md).

The product surface is:

| Surface | Route | Use |
| --- | --- | --- |
| [Reploid](docs/poolday/product-intent.md) | `/` | Work, Network, and Improve. |
| Zero | `/zero` | Minimal self-loading configuration for problem-solving and improvement experiments. |
| X | `/x` | Zero with prepared executable extensions and supporting blueprints. |

Poolday is an internal name for optional peer infrastructure, not a separate
public product. Zero's current inference default is the server proxy, with
optional local Doppler execution; a browser agent does not imply offline inference.
The signed executable-Pack path requires a qualified catalog entry and matching
released Doppler API. Existing model-name loading and adapter sharing do not
prove base-model Pack delivery.

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

The peer-execution path provides receipt-backed browser inference. Its claimed
local model execution and browser agent state stay in the browser; explicitly
selected cloud providers have their own execution boundary. Services may handle
authentication, rendezvous, policy enforcement, receipt anchors, and ledger
projections; they do not perform the claimed browser-local model execution.
The current enabled scientific peer catalog covers public protein inputs and
the pinned ESM-2 contract; that scope does not define every Reploid task.

## Limits and status

Reploid does not claim hardware attestation, independently trustworthy
browser/GPU execution, or guaranteed honest providers. Relay acknowledgement proves receipt of a relay
record, not execution truth. Capability claims require their declared evidence;
ordinary networking and experimental use do not establish improvement. Learned
routing and scientific-policy promotion retain their specific admission gates.
Read the claim index row before repeating a capability statement.

## Repository map

- [`self/`](self/): browser boot profiles, VFS, tools, and runtime
- [`docs/`](docs/): product intent, claims, security, architecture, and operator guides
- [`deploy/`](deploy/): deployment and access-window tooling
- [`doppler/`](doppler/): vendored or paired Doppler integration surface
- [`showcase/`](showcase/): demonstrations and recorded runs
- [`package.json`](package.json): package metadata and local commands

## Intent and component authority

- [GOALS.md](GOALS.md) owns the repository mission, value, and durable strategic goals.
- [CATSCAN.md](CATSCAN.md) is the root component charter. Child charters narrow its authority for independently meaningful components.
- The generated [component index](docs/component-index.md) lists every charter, parent, and target.
- [AGENTS.md](AGENTS.md) defines how code agents discover and obey the charter chain.
- The [workspace CATSCAN protocol](https://github.com/clocksmith/ouroboros/blob/main/deco/docs/catscan.md) defines the shared shape and precedence rules.

Run `npm run catscan:chain -- <path>` to print the charter chain for a target file. Run `npm run verify:catscan` to validate fields, parents, links, evidence paths, identifiers, size, and the generated index.

## Read next

- [Repository goals](GOALS.md)
- [Root component charter](CATSCAN.md)
- [Component index](docs/component-index.md)
- [Documentation index](docs/INDEX.md)
- [Poolday product intent](docs/poolday/product-intent.md)
- [Discovery Contract](docs/poolday/discovery-contract.md)
- [Poolday claims and non-claims](docs/poolday/claims-and-nonclaims.md)
- [Security model](docs/SECURITY.md)
- [RSI improvement episodes](docs/rsi-improvement-episodes.md)
- [Doppler](https://github.com/clocksmith/doppler)

## License

[MIT License](LICENSE). The package metadata also declares `MIT`.
