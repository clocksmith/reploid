# REPLOID

Browser-native recursive self-improvement substrate.

Reploid boots in the browser, seeds an explicit self into a writable VFS, then runs a live loop that can read, write, and hot-load its own files. The primary path is the `/` route: a minimal boot UI, an explicit awakened self, and a small primitive tool surface.

## What Ships Now

| Route | Purpose |
|-------|---------|
| `/` | Primary Reploid boot. Minimal goal-first entry. |
| `/0` | Zero. Richer research surface. |
| `/x` | X. Prebuilt mature surface. |

The primary Reploid path is the simplest one:
- set the first objective
- optionally enter an access code
- optionally configure your own inference
- optionally enable swarm
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

- `First objective`
- `Access code`
- `Configure`
- `Swarm`
- `Awaken`

Inference states on `/`:

| State | Swarm | Result |
|-------|-------|--------|
| access code or BYOK | off | solo |
| access code or BYOK | on | provider |
| neither | on | consumer |
| neither | off | dead |

`Configure` means bring your own inference.

`Swarm` means opt in to peer collaboration. It does not force local inference sharing unless this Reploid actually has inference available.

## Awakened Self

Awaken clears prior live VFS state, writes the generated self manifests, exposes the canonical self source as a copy-on-write `/self` overlay, mounts Capsule, and starts the runtime.

Core system files:

```text
/.system/self.json
/.system/identity.json
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
- `LoadModule`

The goal is explicit self ownership. Reploid-owned logic lives in seeded self files, not in hidden product layers.

## Runtime Model

Reploid uses a small live loop:

1. read self and context
2. generate the next directive
3. execute tool calls
4. observe results
5. continue until parked, stopped, or capped

The awakened self can:
- read and rewrite its own files
- load new tools from `/tools` or `/self`
- mutate Capsule UI
- persist memory under `/.memory`
- emit artifacts under `/artifacts`

## Swarm Status

Swarm is part of the seeded self and is readable and evolvable like the rest of Reploid.

Current reality:
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
├── src/
│   ├── self/            # Explicit awakened self modules
│   ├── ui/capsule/      # Capsule shell
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
