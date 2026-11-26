# REPLOID Substrate Architecture

The Zero/X boot sequence, genesis levels, core modules, infrastructure, safety stack, tools and
file layout are in [system-architecture.md](system-architecture.md). This page keeps what is
specific to the substrate: the Doppler contract, HITL modes, capability modules, proxy CORS,
blueprints and the module pattern.

The VFS root `/` maps to `self/` on disk: `/core/agent-loop.js` is `self/core/agent-loop.js`.

---

## Ouroboros Contract (Doppler Integration)

Reploid (driver) and Doppler (engine) are documented against a minimal substrate contract:
SharedArrayBuffer for control flags plus VFS files for payload exchange. This keeps the
API surface tiny and auditable. Parts of this contract remain research-facing until the
runtime wires the full exchange end-to-end.

### Contract Surface

```
/.system/
├── substrate.bin      # SharedArrayBuffer pointer
├── inference.rdrr     # Reploid -> Doppler (plan + inputs)
├── evolution.trace    # Doppler -> Reploid (results + metrics)
└── kernel.wgsl        # Reploid-authored kernel overrides (optional)
```

Coordination uses a single flag in the SharedArrayBuffer:

```javascript
const substrate = new SharedArrayBuffer(16);
const flag = new Int32Array(substrate, 0, 1);

// Reploid (driver) signals work, then waits.
Atomics.store(flag, 0, 1);
Atomics.wait(flag, 0, 1);

// Doppler (engine) waits for work, then signals completion.
Atomics.wait(flag, 0, 0);
Atomics.store(flag, 0, 0);
Atomics.notify(flag, 0);
```

### Kernel Evolution

Reploid can evolve Doppler kernels by writing a replacement WGSL file to
`/.system/kernel.wgsl` and updating the inference plan to reference the new hash.
Doppler validates the hash and recompiles only when it changes. This path is
gated by verification and rollback logic in Reploid.

See `../../doppler/docs/architecture.md` for Doppler's engine design details.

---

## HITL Modes

`self/infrastructure/hitl-controller.js` defines these modes:

| Mode | Behavior |
|------|----------|
| **AUTONOMOUS** | No approval required (the default) |
| **HITL** | Queue actions for approval |
| **EVERY_N** | Checkpoint every N steps |
| **INHERIT** | A per-module override that follows the global mode |

---

## Capabilities

Under `self/capabilities/`:

### Reflection (`reflection/`)
- `reflection-store.js` - Persistent storage for insights, errors, success patterns
- `reflection-analyzer.js` - Analyzes history to detect failure patterns
- Hypothesis reflections separate observation, suspected cause, alternatives,
  diagnostic, intervention, expected result, and falsifier. Saving text alone
  is not evidence that behavior improved.

### Cognition (`cognition/`)
- `semantic/` - Vector-based semantic search
- `symbolic/` - Entity-relationship storage and symbolic reasoning
- `episodic-memory.js`, `hybrid-retrieval.js`, `knowledge-tree.js`, and the GEPA modules

### Communication (`communication/`, multi-tab coordination)
- `webrtc-swarm.js` - WebRTC P2P transport with session-scoped rooms
- `swarm-sync.js` - LWW state synchronization with Lamport clocks

---

## Proxy CORS

`server/proxy-app.js` takes allowed origins from `server.corsOrigins` in the app config, then
the comma-separated `CORS_ORIGINS` environment variable, then its defaults:

```json
{
  "server": {
    "corsOrigins": ["http://localhost:8080", "https://your-domain.example"]
  }
}
```

---

## Blueprints

`self/blueprints/` (VFS path `/blueprints/`) holds maintained architectural decisions, not one
document per module; generated stubs were removed and the verifier forbids them. See the
[blueprint atlas](../self/blueprints/README.md) and
[canonical inventory](../self/blueprints/canonical-inventory.md).
`self/config/module-inventory.json` is the generated inventory for source paths, ownership,
imports and hashes.

Key blueprints:
- `0x000008` - Agent Cognitive Cycle
- `0x000032` - Reflection Store Architecture
- `0x000038` - WebRTC Swarm Transport
- `0x000040` - Verification Manager

---

## Adding New Modules

Use the factory pattern:

```javascript
const MyModule = {
  metadata: {
    id: 'MyModule',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;

    const init = async () => {
      // Initialize
      return true;
    };

    return { init };
  }
};

export default MyModule;
```

Which genesis level loads a module is set in
[`self/config/genesis-levels.json`](../self/config/genesis-levels.json); see
[system-architecture.md](system-architecture.md#3-genesis-levels-configgenesis-levelsjson).
Tests are described in [TESTING.md](TESTING.md).
