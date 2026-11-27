# Blueprint 0x000074: Model Configuration UI

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/ui/boot-wizard/state.js`, `/self/ui/boot-wizard/detection.js`, `/self/ui/boot-wizard/connection-tests.js`, `/self/ui/boot-wizard/steps/choose.js`, `/self/ui/boot-wizard/steps/direct.js`, `/self/ui/boot-wizard/steps/proxy.js`, `/self/ui/boot-wizard/steps/browser.js`

**Planned Artifacts:** None

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x000074-model-config-ui.md`

**Objective:** Choose and verify the inference connection for Zero and X before the agent starts.

**Related:** `0x000073` (Proxy Server) for the proxy health and chat endpoints the wizard probes.

**Category:** UI

---

## 1. Scope

Model configuration is part of the boot wizard in `self/ui/boot-wizard/`. There is no
separate `model-config/` directory; an earlier version of this blueprint planned one. The
wizard state lives in one module-level object in `state.js`, the step renderers in `steps/`
return HTML strings, and `index.js` wires them to the container. The wizard uses its own
`subscribe` listener list, not the event bus.

## 2. Steps

`STEPS` (`state.js:31`) is the step order:

| Step | Purpose |
| --- | --- |
| `start` | Check for a saved configuration that can be resumed |
| `detect` | Probe WebGPU, Doppler, Ollama and the proxy |
| `choose` | Pick the connection type (`steps/choose.js`) |
| `direct_config` | Cloud API with the key held in the browser (`steps/direct.js`) |
| `proxy_config` | Reploid proxy or Ollama server (`steps/proxy.js`) |
| `doppler_config` | Local Doppler model over WebGPU (`steps/browser.js`) |
| `goal` | Goal selection |
| `awaken` | Final initialization |

## 3. Connection types

`connectionType` is one of `direct`, `proxy`, `browser` or `external`. `external` (a
connected agent) is only offered in X mode on a loopback host (`isExternalBrainAvailable`,
`state.js:50`).

| Type | Saved `hostType` | Provider |
| --- | --- | --- |
| `direct` | `browser-cloud` | `anthropic`, `openai`, `gemini` or `other` with a base URL; model lists in `CLOUD_MODELS` (`steps/direct.js:8`) |
| `proxy` | `proxy-cloud`, or `proxy-local` for Ollama | Reploid proxy (`serverType: 'reploid'`), Ollama, or the managed Zero server proxy |
| `browser` | from `buildLocalDopplerModelConfig` | Local Doppler model, `queryMethod: 'browser'` |
| `external` | `direct` | `external-brain` |

Each connection carries a `verifyState` from `VERIFY_STATE` (`state.js:43`): `unverified`,
`testing`, `verified`, `failed`.

## 4. Detection and tests

| Export (`detection.js`) | Behavior |
| --- | --- |
| `runDetection(options)` (:799) | Sets HTTPS and WebGPU state, then runs the Doppler, Ollama and proxy probes in parallel. `skipLocalScan` and `skipDoppler` skip them. |
| `checkWebGPU()` (:533) | Browser WebGPU capability check |
| `checkDoppler()` (:736) | Preflights the Doppler provider URL, then initializes `DopplerProvider` |
| `probeOllama()` (:651) | `localhost:11434/api/tags` |
| `probeProxy()` (:690) | Same origin, then `localhost:8000` or `8080`, at `/api/health` |
| `testApiKey`, `testDirectModel` (:859, :1064) | Minimal provider request with the entered key |
| `testProxyConnection`, `testLocalConnection`, `testProxyModel` (:977, :1003, :1030) | Proxy health, Ollama tags, and a one-message chat through the proxy |

`createConnectionTestHandlers` (`connection-tests.js:6`) binds these tests to the step
buttons and writes the resulting `verifyState`.

## 5. Persistence

All keys go through the instance storage from `shared/instance.js`.

| Function (`state.js`) | Behavior |
| --- | --- |
| `checkSavedConfig()` (:408) | Reads `SELECTED_MODELS` and the primary provider's `REPLOID_KEY_<PROVIDER>` |
| `hydrateSavedConfig(saved, apiKey)` (:441) | Restores the connection type and its config; restored connections start `unverified` |
| `saveConfig()` (:506) | Writes `REPLOID_MODE`, `SELECTED_MODELS`, goal, environment and cycle interval. A direct API key is written to browser storage. |
| `forgetDevice()` (:616) | Removes the saved models, keys, mode, genesis level, HITL and security settings, then resets the wizard |
| `canAwaken()` (:623) | Requires a complete config for the chosen connection type; the route-locked Reploid mode uses `getReploidLaunchState` from `reploid-inference.js` |

## 6. Invariants

- A saved configuration is never treated as verified on resume.
- An API key entered in `direct` mode stays in this browser's storage; the page states this
  in the step copy.
- `forgetDevice()` is the one path that clears stored keys.
- The wizard selects inference only. It does not grant tool, VFS or promotion authority.

*Last updated: November 2026*
