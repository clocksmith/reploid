# Blueprint 0x000002: Application Orchestration

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/entry/start-app.js`, `/self/host/start-app.js`, `/self/host/reploid-launch.js`, `/self/host/start-reploid.js`, `/self/host/seed-vfs.js`, `/self/boot-helpers/index.js`, `/self/boot-spec.js`, `/tests/e2e/boot.spec.js`, `/tests/unit/boot-services.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `entry/start-app.js`

**Former Blueprint Paths:** `self/blueprints/0x000002-application-orchestration.md`
**Objective:** Define how a page reaches a running agent: seed the VFS, choose the launcher for the boot profile, show the route's home, and on the operator's Awaken either start the Reploid runtime or run the genesis boot that registers modules in the DI container.

**Prerequisites:** [0x000042](0x000042-dependency-injection-container.md) (DI Container), [0x000011](0x000011-advanced-storage-backend-indexeddb.md) (VFS), [0x00003C](0x00003C-genesis-snapshot-system.md) (Genesis Snapshot)

**Affected Artifacts:** `self/host/*.js`, `self/entry/*.js`, `self/boot-helpers/*.js`, `self/boot-spec.js`, `self/config/genesis-levels.json`, `self/config/module-resolution.js`

---

### 1. Files

There is no `app-logic.js` orchestrator. Orchestration is split across:

| File | Role |
| --- | --- |
| `self/boot-spec.js` | `SELF_BOOT_SPEC`: host entries (`seedEntry`, `startEntry`, `reploidStartEntry`, `vfsBootstrapEntry`, `serviceWorkerEntry`), runtime entries (`/self/runtime.js`, `/self/capsule/index.js`, `styles/capsule.css`) and writable roots |
| `self/host/seed-vfs.js` (`self/entry/seed-vfs.js` forwards to it) | Registers the VFS Service Worker, seeds or hydrates the IndexedDB VFS for the boot profile, then imports the launcher |
| `self/host/start-app.js` | Host launcher for the legacy and lab boots (Zero, X, wizard, locked homes) |
| `self/entry/start-app.js` | One line: `import '../host/start-app.js';` kept as a stable entry and fallback path |
| `self/host/start-reploid.js` | Minimal launcher for the primary Reploid route |
| `self/host/reploid-launch.js` | `createReploidLauncher(options)`: imports the Reploid runtime and capsule UI, mounts and reloads the UI, starts the runtime |
| `self/boot-helpers/index.js` | `boot(Utils, DIContainer)`: genesis-level module boot for Zero and X |

### 2. Launcher choice

`loadStartApp` in `self/host/seed-vfs.js` imports `SELF_BOOT_SPEC.host.reploidStartEntry` (`start-reploid.js`) for the `pool_home`, `reploid_home` and `substrate_console` boot profiles and `SELF_BOOT_SPEC.host.startEntry` (`host/start-app.js`) otherwise, falling back to `/entry/start-app.js` if the first import fails.

### 3. `host/start-app.js`

On load it removes the seed progress loader and reads the runtime mode, route mode and boot profile from globals set by the seed step. Unless the profile is `wizard`, it shows a locked home:

- `pool`: redirect to the product entry; the substrate never loads product modules;
- `reploid`: `/ui/reploid-home/index.js`, and prewarm the Reploid modules;
- `zero` or `x`: `/ui/zero-home/index.js`, and prewarm `boot-helpers` and the DI container;
- otherwise `/ui/boot-home/index.js`.

With the `wizard` profile it shows `/ui/boot-wizard/index.js`.

It then defines `window.triggerAwaken(goal)`, which the home or wizard calls when the operator awakens the agent:

- `reploid` mode: `launcher.awaken(goal, wizardContainer)` from `reploid-launch.js`.
- other modes: stop boot backgrounds, wait for `window.REPLOID_VFS_FULL_SEED_PROMISE`, run `boot(Utils, DIContainer)`, then `completeAwaken`, which resolves `EventBus`, optional `ErrorStore`, `WorkerManager`, `ArenaHarness` and `HITLController`, and `StateManager`, mounts the UI and calls `agent.run(goal)`.

If awaken fails after a container exists, it disposes the `ToolRunner` (or unloads its tools), runs UI cleanup, closes the `AgentLoop`, clears container instances and restores the window globals it had replaced. Saved files are never deleted. The error is rendered with `renderErrorUI`, or an inline box if that import fails.

### 4. `boot(Utils, DIContainer)`

`self/boot-helpers/index.js:27`, in order:

1. Initialize the iframe bridge.
2. Load `genesis-levels.json`, pick the genesis level (the lab route's level, else a valid stored `REPLOID_GENESIS_LEVEL`, else the default for the stored `REPLOID_MODE` or `defaultLevel`), load the module registry and overrides, and resolve the module list.
3. Fail if any of `AWAKEN_REQUIRED_MODULES` (`self/config/module-resolution.js`) is missing.
4. Create the DI container with `Utils`, load external dependencies (for example Transformers.js), and register the resolved modules.
5. Resolve `VFS`, reset session artifacts, create the genesis snapshot, initialize the swarm if enabled, resolve core services and install export helpers.
6. Return `{ container, genesisConfig, genesisLevel, resolvedModules, ...services }`.

### 5. Reploid launcher

`createReploidLauncher({ prepareInput, getLogger, reloadInitialUi, handleReloadErrors })` returns `{ awaken, loadModules, rotateIdentity }`. `awaken` removes the home, imports `createSelfRuntime` and the capsule UI, creates the runtime with the instance label, goal, environment, swarm flag, model config and seed overrides, mounts the capsule, and starts the runtime. A VFS change to the UI entry or `/self/capsule/` remounts the UI from the VFS after a 150 ms debounce. It exposes `window.REPLOID` (`mode`, `instanceId`, `runtime`) and `window.REPLOID_UI` (`reload`, `getVersion`).

### 6. Authority

Boot starts the agent only from the operator's Awaken. Loading a module or starting the runtime grants no permission beyond the grants the modules themselves enforce.

### 7. Verification

`tests/e2e/boot.spec.js`, `tests/e2e/boot-contract.spec.js` and `tests/e2e/boot-replay.spec.js` drive the real boot in a browser; `tests/unit/boot-services.test.js`, `tests/unit/boot-seed.test.js` and `tests/unit/boot-library-loading.test.js` cover the boot helpers.
