# REPLOID

Dead simple browser Recursive GEPA Ring seed.

Reploid boots in the browser, seeds an explicit self into a writable VFS, then runs a live loop that can read, write, hot-load its own files, and run a Recursive GEPA Ring in Shadow before any promotion. Peer transport is optional slot placement: ring slots can be local or remote.

## What Ships Now

| Route | Purpose |
|-------|---------|
| `/` | Primary Reploid boot. Minimal goal-first entry. |
| `/0` | Zero. Richer research surface. |
| `/x` | X. Prebuilt mature surface. |

The primary Reploid path is the simplest one:
- set the objective
- attach a local executor or enable remote slots
- awaken

## Quick Start

Install dependencies:

```bash
npm install
```

For local development, put your Gemini key in `.env`:

```bash
GEMINI_API_KEY=your_key_here
```

Start Reploid:

```bash
npm start
```

That command:
- provisions sealed Reploid Cloud access windows from `.env`
- starts the local dev server on `http://localhost:8000`

## Primary Boot

The `/` boot UI is intentionally small:

- peer identity
- ring topology
- objective
- peer slots
- `Awaken`

Root operating states:

| State | Meaning |
|-------|---------|
| Seed | Boot identity, prompt, tools, VFS, objective, and Blueprint `0x000112`. |
| Shadow | Execute, trace, reflect, mutate, score, and archive provisional candidates. |
| Promote | Change the active self only after the anchored gate passes. |

Ring topology:

| Topology | Meaning |
|----------|---------|
| local | Ring slots run in this browser when local inference is available. |
| peer-assisted | Some slots may run on remote peers or contribute anchor observations. |
| remote-wait | The browser parks until a remote host appears. |

`Configure` means bring your own local executor.

`Peer slots` means opt in to remote slot placement. It does not force local inference sharing unless this Reploid actually has inference available.

## Awakened Self

Awaken clears prior live VFS state, writes the generated self manifests, exposes the canonical self source as a copy-on-write `/self` overlay, mounts Capsule, and starts the runtime.

Core system files:

```text
/self/self.json
/self/identity.json
/self/prompts/kernel.md
/self/blueprints/0x000112-recursive-gepa-ring.md
/self/blueprints/rgr-slot-topology.md
/self/runtime.js
/self/bridge.js
/self/tool-runner.js
/self/manifest.js
/self/environment.js
/capsule/index.js
```

Collaboration and cloud access modules also live in self:

```text
/self/cloud-access.js
/self/cloud-access-status.js
/self/cloud-access-windows.js
/self/identity.js
/self/key-unsealer.js
/self/receipt.js
/self/reward-policy.js
/self/swarm.js
```

Primitive visible tools:

- `ReadFile`
- `WriteFile`
- `CreateTool`
- `LoadModule`

The goal is explicit self ownership. Reploid-owned logic lives in seeded self files, prompts, blueprints, traces, and receipts, not in hidden product layers.

## Runtime Model

Reploid uses a small live loop oriented around Blueprint `0x000112`:

1. read self and context
2. enter Shadow
3. execute, trace, reflect, mutate, score, and archive
4. use peers only as local or remote ring slots
5. promote only after anchored evidence passes

The awakened self can:
- read and rewrite its own files
- load new tools from `/tools` or `/self`
- mutate Capsule UI
- persist memory under `/.memory`
- emit artifacts under `/artifacts`
- write RGR traces and receipts under `/artifacts/rgr`

## Swarm Status

Swarm is part of the seeded self and is readable and evolvable like the rest of Reploid. In the product model, swarm only supplies remote ring slots and witness capacity.

Current reality:
- peer slots are enabled by default on the primary route
- same-browser swarm can fall back to `BroadcastChannel`
- cross-host swarm still uses signaling for WebRTC rendezvous
- browser-to-browser provider and consumer roles exist in the self model
- this is not yet a signaling-free public mesh

## Reploid Cloud

Local development currently supports a managed path:

- `npm start` provisions sealed access windows from `GEMINI_API_KEY`
- the generated client artifact stores sealed blobs, not the plaintext key
- the local operator codebook is written under `.reploid-cloud/` and ignored by git

Users can also bypass that path and use their own inference directly in the browser.

## Repository Shape

```text
reploid/
├── self/
│   ├── kernel/          # Boot shell and bootstrap entry
│   ├── host/            # VFS seeding and runtime handoff
│   ├── capsule/         # Capsule shell
│   ├── ui/boot-home/    # Primary boot UI
│   ├── core/            # Shared runtime helpers
│   ├── capabilities/    # Transport and other subsystems
│   └── blueprints/      # Architectural research notes
├── server/              # Local dev proxy and signaling
├── scripts/             # Build helpers
├── tests/               # Unit and E2E coverage
└── docs/                # Human-facing documentation
```

## Documentation

Start here:

- [docs/INDEX.md](docs/INDEX.md)
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- [docs/system-architecture.md](docs/system-architecture.md)
- [docs/SECURITY.md](docs/SECURITY.md)

## Related

- [Doppler](https://github.com/clocksmith/doppler): WebGPU inference engine used by the broader stack

## License

MIT

*Last updated: March 2026*
