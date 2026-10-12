# Reploid

A network where people and agents combine models, tools, storage, and compute.
Chat is the first interface; each participant controls contribution and disclosure.

**[Try Reploid](https://replo.id/)** · [Get started](docs/QUICK-START.md) · [Documentation](docs/INDEX.md)

<picture>
  <source media="(max-width: 640px)" srcset="docs/diagrams/readme-architecture-mobile.svg" />
  <img src="docs/diagrams/readme-architecture.svg" alt="A requester without model weights receives an answer from two Doppler contributors; a separate storage participant supplies their assigned pieces." />
</picture>

## Get started

From a repository checkout, install and start the browser application:

```sh
npm install
npm start
```

Open `http://localhost:8000`. Choose an available model, ask a question, and review
recipients before sharing inputs. A prepared peer can execute without requester
weight downloads. Local execution separately requires WebGPU and model files.

Conversations remain independent. After interruption, keep the partial answer
and explicitly retry. Storage and compute contribution are optional, with their
own permissions and limits. See the [conversation contract](docs/chat-mvp.md).

## Technical architecture

### Component ownership

![Ten components connect conversations, persistent history, discovery, admission, contribution controls, piece custody, a partition coordinator, and two Doppler executors.](docs/diagrams/technical-architecture.svg)

Discovery supplies candidates; admission checks the split, grants, and capacity.
Custody supplies verified pieces to executors. The coordinator sends ordered
steps: activations travel forward, selected tokens return for the next step,
and identified output reaches the conversation. Each executor owns separate
attempt state. Storage, compute, and disclosure permissions remain distinct.

Reploid coordinates, Doppler computes, and Poolday transports. These diagrams
explain the two-partition design; they do not establish deployment acceptance.

[Architecture and source owners](docs/open-mesh-architecture.md) · [Attempt recovery](docs/open-mesh-architecture.md#attempt-failure-and-recovery)

## Evidence

Partition execution is implemented; complete numerical and application
qualification remains open. The [surface claim index](docs/status/surface-claim-index.json)
records supported scopes and unresolved gates. Cross-host rendezvous still
requires signaling; a receipt alone does not prove honest execution.

Improvement is a separate workflow: independently evaluate changes, authorize
reversible adoption, then measure results. Model confidence never grants authority.
See [improvement episodes](docs/rsi-improvement-episodes.md).

## Read next

- [Architecture](docs/open-mesh-architecture.md) — coordination, custody, and recovery.
- [Security](docs/SECURITY.md) — permission and trust boundaries.
- [Zero and X](docs/zero-x-quick-start.md) — optional agent configurations.
- [Goals](GOALS.md) · [Contributing](AGENTS.md) — priorities and component ownership.

## License

[MIT](LICENSE).
