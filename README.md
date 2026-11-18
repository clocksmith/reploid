# Reploid

Ask a model running on someone else’s computer, or contribute your own compute and storage. Reploid finds eligible participants and streams the answer back. A requester using a prepared peer can leave the model weights on the computers that run it.

**[Try Reploid](https://replo.id/)** · [Run locally](#run-it) · [Contribute a computer](docs/native-participant.md)

<picture>
  <source media="(max-width: 640px)" srcset="docs/diagrams/readme-architecture-mobile.svg">
  <img src="docs/diagrams/readme-architecture.svg" alt="A requester sends a prompt. Two contributors run successive layers of one model with Doppler, and the answer returns to the requester.">
</picture>

## Send your first request

1. Open Reploid and choose a model with a ready computer or a complete route. One computer can run a whole model. The diagram shows the other case, where contributors each hold part of it.
2. Review who receives your prompt, then send. A computer executing an ordinary remote request can read the input it receives. Sharing your own files or compute is a separate choice.
3. Watch the answer stream into your conversation. If a provider drops, the history keeps the partial answer. If no eligible provider is ready, keep your draft and wait or choose another available model.

Reploid is experimental. Model availability depends on who is online and prepared. The [quick start](docs/QUICK-START.md) walks through discovery and recovery. The [claim index](docs/status/surface-claim-index.json) records what has been verified on each surface.

## Run it

From the repository root, run

```sh
npm install
npm start
```

Open [localhost:8000](http://localhost:8000). Running a model in your own browser requires WebGPU and local model files. Requesting an answer from a prepared peer requires a browser and a connection to that peer. See the [testing guide](docs/TESTING.md) for development checks.

## Components

| I want to… | Start here |
| --- | --- |
| Work on chat, contribution, or the network view | [Product UI](apps/poolday), called Poolday internally |
| Embed conversations or coordinate peers | [Reploid library](packages/reploid/src) |
| Load or execute a model | [Doppler](https://github.com/clocksmith/doppler) and [Reploid’s runtime pin](shared/config/doppler-package.json) |
| Serve models or supply verified files from a desktop | [Native participant guide](docs/native-participant.md) |
| Run hosting, service APIs, or accounting | [Server](server) and [product contract](docs/product-specification.md) |
| Explore the separate Zero and X agent workspaces | [Setup and routes](docs/zero-x-quick-start.md) |

### Component ownership

Reploid handles discovery, permissions, placement, and accounting. Doppler executes the model on each participating GPU. The [technical architecture diagram](docs/open-mesh-architecture.md#component-ownership) follows a request across several stages.

## How a model is stored and split

A **piece** is a hash-verified portion of a model file. A machine can store and supply pieces without executing requests. A **stage** runs a contiguous range of model layers. On a split route, each stage keeps its own model state and forwards activations. The final stage samples the token that streams back to the requester.

One recorded three-stage route ran layers 0–7 in a browser and layers 8–23 in two native stages on a second machine. Its measured average was about 1.05 seconds per token on a quiet link. The reports identify the devices, arithmetic profile, and time spent in each part of that route. [Placement measurements](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/placement-c-envelope-20261015/README.md) · [Precision measurements](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/precision-recovery-20261015/README.md)

## Lifecycle of one request

A contributor advertises a prepared model or stage. Reploid selects an eligible route, reserves capacity, and binds permission to that attempt. A retry gets a new attempt and a new admission check. Completed and interrupted attempts keep their own work records. [Request flow and receipts](docs/glossary.md#2-one-request) · [Security and trust](docs/SECURITY.md)

## Credits and accounting

The project aims to let contributors exchange or sell the tokens their computers produce. Configured services can quote a request, reserve credits, and settle against execution receipts. The recorded local demonstration used test providers and a fixture model. [Product contract](docs/product-specification.md) · [Local accounting demonstration](https://github.com/clocksmith/reploid/blob/e543183bed54dfdf2b6e6139dd4c31c8686f47bd/artifacts/earning-ui-demo-20261015/README.md)

## Read next

[Documentation](docs/INDEX.md) · [Hash-verified historical evidence](docs/evidence-catalog/README.md) · [Goals](GOALS.md) · [Contributing](AGENTS.md)

## License

[MIT](LICENSE).
